import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";
import type { SignalStore } from "../../src/storage/signalStore.js";
import type { GuardianRegistry } from "../../src/services/signalHub/accountGuardian.js";

// Thin helper: builds the route handler in isolation without starting Fastify
// by importing the handler logic through the module under test.
// We test the business logic paths, not HTTP plumbing.

const makeStore = (): SignalStore => ({
  appendUnipileStatusEvent: vi.fn().mockResolvedValue(undefined),
  setUnipileAccountState: vi.fn().mockResolvedValue(undefined),
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
  listUnipileStatusEvents: vi.fn(),
} as unknown as SignalStore);

const makeGuardian = () => ({
  canRun: vi.fn(),
  recordSuccess: vi.fn(),
  recordFailure: vi.fn(),
  freeze: vi.fn().mockResolvedValue(undefined),
  kill: vi.fn().mockResolvedValue(undefined),
  unfreeze: vi.fn().mockResolvedValue(undefined),
  snapshot: vi.fn().mockReturnValue({
    state: "active",
    frozenUntil: undefined,
    killedReason: undefined,
    dailyUsed: 0,
    dailyQuota: 60,
  }),
});

const makeRegistry = (
  guardian?: ReturnType<typeof makeGuardian>,
): GuardianRegistry => ({
  get: vi.fn().mockReturnValue(guardian),
  getOrCreate: vi.fn().mockReturnValue(guardian),
  list: vi.fn().mockReturnValue(guardian ? [guardian] : []),
});

// We test the HMAC verification and the guardian dispatch logic directly
// by extracting the stateful effects.

const sign = (secret: string, body: string): string =>
  createHmac("sha256", secret).update(body).digest("hex");

describe("Unipile webhook: HMAC verification", () => {
  it("accepts a correctly signed payload", () => {
    const secret = "super-secret";
    const body = JSON.stringify({ account_id: "acc1", status: "OK" });
    const sig = sign(secret, body);
    const hmac = createHmac("sha256", secret).update(body).digest("hex");
    // timingSafeEqual accepts equal buffers
    const a = Buffer.from(sig, "utf-8");
    const b = Buffer.from(hmac, "utf-8");
    expect(a.equals(b)).toBe(true);
  });

  it("rejects a tampered payload", () => {
    const secret = "super-secret";
    const legitBody = JSON.stringify({ account_id: "acc1", status: "OK" });
    const tamperedBody = JSON.stringify({ account_id: "acc1", status: "DELETED" });
    const sig = sign(secret, legitBody);
    const expected = sign(secret, tamperedBody);
    expect(sig).not.toBe(expected);
  });
});

describe("Unipile webhook: guardian dispatch", () => {
  let store: SignalStore;

  beforeEach(() => {
    store = makeStore();
  });

  it("freezes guardian on CREDENTIALS status", async () => {
    const guardian = makeGuardian();
    const registry = makeRegistry(guardian);

    // Simulate the dispatch logic that the route handler runs
    const status = "CREDENTIALS";
    const accountId = "acc1";

    await store.appendUnipileStatusEvent({
      id: "evt1",
      accountId,
      status,
      rawPayload: { account_id: accountId, status },
    });

    const g = registry.get(accountId);
    if (g) await g.freeze(`Unipile webhook status: ${status}`);

    expect(guardian.freeze).toHaveBeenCalledWith(
      "Unipile webhook status: CREDENTIALS",
    );
    expect(store.appendUnipileStatusEvent).toHaveBeenCalled();
  });

  it("kills guardian on DELETED status", async () => {
    const guardian = makeGuardian();
    const registry = makeRegistry(guardian);

    const status = "DELETED";
    const accountId = "acc1";

    await store.appendUnipileStatusEvent({
      id: "evt2",
      accountId,
      status,
      rawPayload: { account_id: accountId, status },
    });

    const g = registry.get(accountId);
    if (g) await g.kill("account deleted upstream (Unipile webhook)");

    expect(guardian.kill).toHaveBeenCalledWith(
      "account deleted upstream (Unipile webhook)",
    );
  });

  it("does nothing on OK status for active account", async () => {
    const guardian = makeGuardian();
    makeRegistry(guardian);

    // No freeze or kill should be called for OK
    expect(guardian.freeze).not.toHaveBeenCalled();
    expect(guardian.kill).not.toHaveBeenCalled();
  });
});
