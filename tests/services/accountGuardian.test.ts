import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { createAccountGuardian } from "../../src/services/signalHub/accountGuardian.js";
import type { SignalStore } from "../../src/storage/signalStore.js";

const makeStore = (): SignalStore => ({
  addWatched: vi.fn(),
  getWatched: vi.fn(),
  findWatchedByName: vi.fn(),
  findWatchedByLinkedinIdentifier: vi.fn(),
  findWatchedByStartupId: vi.fn(),
  listWatched: vi.fn(),
  updateWatchedPriority: vi.fn(),
  appendEvent: vi.fn(),
  findEventByHash: vi.fn(),
  listEvents: vi.fn(),
  upsertUnipileAccount: vi.fn(),
  getUnipileAccount: vi.fn(),
  listUnipileAccounts: vi.fn(),
  setUnipileAccountState: vi.fn().mockResolvedValue(undefined),
  appendUnipileStatusEvent: vi.fn(),
  listUnipileStatusEvents: vi.fn(),
} as unknown as SignalStore);

describe("AccountGuardian", () => {
  let store: SignalStore;

  beforeEach(() => {
    store = makeStore();
    vi.useFakeTimers();
    // Tuesday 10:00 UTC+1 Paris = 09:00 UTC — within operating window
    vi.setSystemTime(new Date("2026-05-19T09:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows a call within the operating window", () => {
    const guardian = createAccountGuardian(store, "acc1", "Test", 60);
    const result = guardian.canRun();
    expect(result.allowed).toBe(true);
  });

  it("blocks when state is killed", async () => {
    const guardian = createAccountGuardian(store, "acc1", "Test", 60);
    await guardian.kill("manual");
    const result = guardian.canRun();
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toContain("killed");
      expect(result.retryAfterMs).toBe(Number.MAX_SAFE_INTEGER);
    }
  });

  it("blocks when state is frozen", async () => {
    const guardian = createAccountGuardian(store, "acc1", "Test", 60);
    await guardian.freeze("test freeze", 5_000);
    const result = guardian.canRun();
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe("Account frozen");
      expect(result.retryAfterMs).toBeGreaterThan(0);
      expect(result.retryAfterMs).toBeLessThanOrEqual(5_000);
    }
  });

  it("auto-unfreezes after freeze duration elapses", async () => {
    const guardian = createAccountGuardian(store, "acc1", "Test", 60);
    await guardian.freeze("short freeze", 1_000);
    vi.advanceTimersByTime(2_000);
    const result = guardian.canRun();
    expect(result.allowed).toBe(true);
  });

  it("blocks outside Paris operating window (02:00 UTC = 03:00 Paris)", () => {
    vi.setSystemTime(new Date("2026-05-19T01:00:00.000Z")); // 02:00 UTC+1
    const guardian = createAccountGuardian(store, "acc1", "Test", 60);
    const result = guardian.canRun();
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toContain("operating window");
    }
  });

  it("blocks on Sunday", () => {
    // Sunday 2026-05-17 at 10:00 UTC
    vi.setSystemTime(new Date("2026-05-17T09:00:00.000Z"));
    const guardian = createAccountGuardian(store, "acc1", "Test", 60);
    const result = guardian.canRun();
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toContain("operating window");
    }
  });

  it("blocks when daily quota is exhausted", () => {
    const guardian = createAccountGuardian(store, "acc1", "Test", 2);
    // Simulate min delay by advancing time between calls
    guardian.recordSuccess();
    vi.advanceTimersByTime(400_000);
    guardian.recordSuccess();
    vi.advanceTimersByTime(400_000);
    const result = guardian.canRun();
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toContain("quota exhausted");
    }
  });

  it("blocks before jitter delay elapses after a call", () => {
    const guardian = createAccountGuardian(store, "acc1", "Test", 60);
    guardian.recordSuccess();
    // No time advance — jitter not yet elapsed
    const result = guardian.canRun();
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toContain("Jitter delay");
    }
  });

  it("freezes on 429 and persists to store", async () => {
    const guardian = createAccountGuardian(store, "acc1", "Test", 60);
    guardian.recordFailure(429);
    // Give the async freeze a tick
    await Promise.resolve();
    const result = guardian.canRun();
    expect(result.allowed).toBe(false);
    expect(store.setUnipileAccountState).toHaveBeenCalledWith(
      "acc1",
      "frozen",
      expect.objectContaining({ frozenUntil: expect.any(String) }),
    );
  });

  it("snapshot reflects current state", async () => {
    const guardian = createAccountGuardian(store, "acc1", "Test Account", 60);
    const snap = guardian.snapshot();
    expect(snap.accountId).toBe("acc1");
    expect(snap.label).toBe("Test Account");
    expect(snap.state).toBe("active");
    expect(snap.dailyUsed).toBe(0);
    expect(snap.dailyQuota).toBe(60);
  });
});
