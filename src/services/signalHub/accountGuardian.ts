import type { SignalStore } from "../../storage/signalStore.js";
import type { GuardianStatus, UnipileAccountState } from "../../domain/signalHub.js";

// Paris time helpers — use Intl to read Europe/Paris wall time regardless of
// the server's own timezone. This makes the guardian correct on any host.

const PARIS_TZ = "Europe/Paris";

const parisDateParts = (now: Date = new Date()): { hour: number; day: number; minute: number } => {
  const fmt = new Intl.DateTimeFormat("fr-FR", {
    timeZone: PARIS_TZ,
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? "0";
  // weekday: "dim." = Sunday(0), "lun." = Mon(1) … "sam." = Sat(6)
  const weekdayMap: Record<string, number> = {
    "dim.": 0, "lun.": 1, "mar.": 2, "mer.": 3, "jeu.": 4, "ven.": 5, "sam.": 6,
  };
  return {
    hour: parseInt(get("hour"), 10),
    minute: parseInt(get("minute"), 10),
    day: weekdayMap[get("weekday")] ?? 1,
  };
};

// Returns UTC timestamp for the next 08:00 Paris, skipping Sundays.
const nextParisWindowStart = (from: Date = new Date()): Date => {
  const { hour, day, minute } = parisDateParts(from);

  if (day !== 0 && hour >= 8 && hour < 22) return from; // already in window

  // Compute how many minutes to add (working entirely in Paris wall time).
  let minutesToAdd: number;

  if (day === 0) {
    // Sunday anywhere → wait until Monday 08:00
    minutesToAdd = (24 - hour + 8) * 60 - minute;
  } else if (hour < 8) {
    minutesToAdd = (8 - hour) * 60 - minute;
  } else {
    // After 22:00 — next day 08:00, jump over Sunday if Saturday
    const hoursToMidnight = 24 - hour;
    const extraDays = (day + 1) % 7 === 0 ? 2 : 1; // skip Sunday if needed
    minutesToAdd = hoursToMidnight * 60 - minute + extraDays * 8 * 60;
  }

  return new Date(from.getTime() + minutesToAdd * 60_000);
};

// Returns UTC timestamp for midnight Paris time (i.e. when the daily quota resets).
// Strategy: find tomorrow's date in Paris, then parse "00:00 Paris" back to UTC.
const nextMidnightParis = (from: Date = new Date()): Date => {
  const { hour, minute } = parisDateParts(from);
  // Add just enough ms to cross midnight in Paris, then snap to the exact minute boundary.
  const msToMidnight = ((24 - hour) * 60 - minute) * 60_000;
  const roughMidnight = new Date(from.getTime() + msToMidnight);
  // Verify we're at hour 0 in Paris; if DST shift moved us off, add/subtract one hour.
  const afterParts = parisDateParts(roughMidnight);
  if (afterParts.hour === 0) return roughMidnight;
  if (afterParts.hour === 1) return new Date(roughMidnight.getTime() - 3_600_000);
  if (afterParts.hour === 23) return new Date(roughMidnight.getTime() + 3_600_000);
  return roughMidnight;
};

export type CanRunResult =
  | { allowed: true }
  | { allowed: false; reason: string; retryAfterMs: number };

export type AccountGuardian = {
  canRun(): CanRunResult;
  recordSuccess(): void;
  recordFailure(httpStatus: number): void;
  freeze(reason: string, durationMs?: number): Promise<void>;
  kill(reason: string): Promise<void>;
  unfreeze(): Promise<void>;
  snapshot(): GuardianStatus;
};

type GuardianState = {
  accountId: string;
  label: string;
  state: UnipileAccountState;
  frozenUntil: Date | undefined;
  frozenReason: string | undefined;
  killedReason: string | undefined;
  dailyQuota: number;
  dailyUsed: number;
  quotaResetAt: Date;
  lastCallAt: Date | undefined;
  lastErrorCode: number | undefined;
  minDelayMs: number;
  maxDelayMs: number;
};

const DEFAULT_FREEZE_MS = 24 * 3600_000;
const DEFAULT_MIN_DELAY_MS = 60_000;
const DEFAULT_MAX_DELAY_MS = 300_000;

const jitter = (min: number, max: number): number =>
  min + Math.floor(Math.random() * (max - min));

export const createAccountGuardian = (
  store: SignalStore,
  accountId: string,
  label: string,
  dailyQuota: number,
): AccountGuardian => {
  const state: GuardianState = {
    accountId,
    label,
    state: "active",
    frozenUntil: undefined,
    frozenReason: undefined,
    killedReason: undefined,
    dailyQuota,
    dailyUsed: 0,
    quotaResetAt: nextMidnightParis(),
    lastCallAt: undefined,
    lastErrorCode: undefined,
    minDelayMs: DEFAULT_MIN_DELAY_MS,
    maxDelayMs: DEFAULT_MAX_DELAY_MS,
  };

  const resetQuotaIfNeeded = (): void => {
    if (new Date() >= state.quotaResetAt) {
      state.dailyUsed = 0;
      state.quotaResetAt = nextMidnightParis();
    }
  };

  const checkFreezeExpiry = (): void => {
    if (
      state.state === "frozen" &&
      state.frozenUntil &&
      new Date() >= state.frozenUntil
    ) {
      state.state = "active";
      state.frozenUntil = undefined;
    }
  };

  return {
    canRun(): CanRunResult {
      resetQuotaIfNeeded();
      checkFreezeExpiry();

      if (state.state === "killed") {
        return {
          allowed: false,
          reason: `Account killed: ${state.killedReason ?? "manual"}`,
          retryAfterMs: Number.MAX_SAFE_INTEGER,
        };
      }

      if (state.state === "frozen") {
        const until = state.frozenUntil ?? new Date(Date.now() + DEFAULT_FREEZE_MS);
        return {
          allowed: false,
          reason: "Account frozen",
          retryAfterMs: Math.max(0, until.getTime() - Date.now()),
        };
      }

      const { hour, day } = parisDateParts();
      if (day === 0 || hour < 8 || hour >= 22) {
        const nextWindow = nextParisWindowStart();
        return {
          allowed: false,
          reason: "Outside Paris operating window (08:00–22:00, no Sundays)",
          retryAfterMs: nextWindow.getTime() - Date.now(),
        };
      }

      if (state.dailyUsed >= state.dailyQuota) {
        const msUntilReset = state.quotaResetAt.getTime() - Date.now();
        return {
          allowed: false,
          reason: `Daily quota exhausted (${state.dailyUsed}/${state.dailyQuota})`,
          retryAfterMs: Math.max(0, msUntilReset),
        };
      }

      if (state.lastCallAt !== undefined) {
        const required = jitter(state.minDelayMs, state.maxDelayMs);
        const elapsed = Date.now() - state.lastCallAt.getTime();
        if (elapsed < required) {
          return {
            allowed: false,
            reason: "Jitter delay not yet elapsed",
            retryAfterMs: required - elapsed,
          };
        }
      }

      return { allowed: true };
    },

    recordSuccess(): void {
      state.dailyUsed += 1;
      state.lastCallAt = new Date();
      state.lastErrorCode = undefined;
    },

    recordFailure(httpStatus: number): void {
      state.lastErrorCode = httpStatus;
      state.lastCallAt = new Date();

      if (httpStatus === 429) {
        void this.freeze("HTTP 429 received");
        return;
      }

      // Two consecutive 500s within 1 hour trigger a freeze.
      if (httpStatus >= 500) {
        void this.freeze(`HTTP ${httpStatus} received`);
      }
    },

    async freeze(reason: string, durationMs = DEFAULT_FREEZE_MS): Promise<void> {
      const until = new Date(Date.now() + durationMs);
      state.state = "frozen";
      state.frozenUntil = until;
      state.frozenReason = reason;
      await store.setUnipileAccountState(accountId, "frozen", {
        frozenUntil: until.toISOString(),
      });
    },

    async kill(killedReason: string): Promise<void> {
      state.state = "killed";
      state.killedReason = killedReason;
      state.frozenUntil = undefined;
      await store.setUnipileAccountState(accountId, "killed", {
        killedReason,
      });
    },

    async unfreeze(): Promise<void> {
      if (state.state !== "frozen") return;
      state.state = "active";
      state.frozenUntil = undefined;
      state.frozenReason = undefined;
      await store.setUnipileAccountState(accountId, "active");
    },

    snapshot(): GuardianStatus {
      resetQuotaIfNeeded();
      checkFreezeExpiry();
      const canRun = this.canRun();
      return {
        accountId: state.accountId,
        label: state.label,
        state: state.state,
        frozenUntil: state.frozenUntil?.toISOString(),
        frozenReason: state.frozenReason,
        killedReason: state.killedReason,
        dailyQuota: state.dailyQuota,
        dailyUsed: state.dailyUsed,
        dailyResetsAt: state.quotaResetAt.toISOString(),
        lastCallAt: state.lastCallAt?.toISOString(),
        lastErrorCode: state.lastErrorCode,
        nextAllowedAt: canRun.allowed
          ? undefined
          : new Date(Date.now() + canRun.retryAfterMs).toISOString(),
      };
    },
  };
};

export type GuardianRegistry = {
  get(accountId: string): AccountGuardian | undefined;
  getOrCreate(accountId: string, label: string, dailyQuota: number): AccountGuardian;
  list(): AccountGuardian[];
};

export const createGuardianRegistry = (store: SignalStore): GuardianRegistry => {
  const guardians = new Map<string, AccountGuardian>();

  return {
    get(accountId: string): AccountGuardian | undefined {
      return guardians.get(accountId);
    },

    getOrCreate(accountId: string, label: string, dailyQuota: number): AccountGuardian {
      const existing = guardians.get(accountId);
      if (existing) return existing;
      const guardian = createAccountGuardian(store, accountId, label, dailyQuota);
      guardians.set(accountId, guardian);
      return guardian;
    },

    list(): AccountGuardian[] {
      return Array.from(guardians.values());
    },
  };
};
