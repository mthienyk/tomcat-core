import { describe, expect, it, vi } from "vitest";
import type { Startup } from "../../src/domain/entities.js";
import type { CoreStore } from "../../src/storage/coreStore.js";
import type { SyncWorkerDeps } from "../../src/sync/types.js";
import {
  enqueueHubspotActivityBackfill,
  enqueueHubspotCompanyActivitySync,
  HUBSPOT_ACTIVITY_SYNC_PRIORITIES,
} from "../../src/sync/hubspotActivityEnqueue.js";
import {
  hubspotActivityBackfillWorker,
  hubspotStartupsWorker,
} from "../../src/sync/hubspot.js";
import { runHubspotStartupsDirectorySync } from "../../src/sync/hubspotStartupsSync.js";

const sampleStartup = (id: string): Startup => ({
  id,
  name: `Startup ${id}`,
  sectors: ["fintech"],
  stage: "seed",
  visibilityTier: "internal_only",
  sources: [{ system: "hubspot", externalId: id }],
});

const createMockStore = (): CoreStore & {
  enqueueCalls: Parameters<CoreStore["enqueueSyncJob"]>[0][];
} => {
  const enqueueCalls: Parameters<CoreStore["enqueueSyncJob"]>[0][] = [];
  return {
    enqueueCalls,
    upsertStartup: vi.fn(async () => undefined),
    listHubspotCompanySyncStatesMissingActivity: vi.fn(async () => ["42", "99"]),
    enqueueSyncJob: vi.fn(async (input) => {
      enqueueCalls.push(input);
      return "created";
    }),
  } as unknown as CoreStore & {
    enqueueCalls: Parameters<CoreStore["enqueueSyncJob"]>[0][];
  };
};

describe("runHubspotStartupsDirectorySync", () => {
  it("upserts startups without enqueueing activity jobs", async () => {
    const store = createMockStore();
    const startups = [sampleStartup("1"), sampleStartup("2")];
    const deps: SyncWorkerDeps = {
      store,
      connectors: {
        hubspot: {
          listStartups: vi.fn(async () => startups),
        },
      } as SyncWorkerDeps["connectors"],
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
    };

    const result = await runHubspotStartupsDirectorySync(deps);

    expect(result.startupCount).toBe(2);
    expect(store.upsertStartup).toHaveBeenCalledTimes(2);
    expect(store.enqueueSyncJob).not.toHaveBeenCalled();
  });
});

describe("hubspotStartupsWorker", () => {
  it("refreshes directory only and never enqueues activity sync", async () => {
    const store = createMockStore();
    const deps: SyncWorkerDeps = {
      store,
      connectors: {
        hubspot: {
          listStartups: vi.fn(async () => [sampleStartup("1")]),
        },
      } as SyncWorkerDeps["connectors"],
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
    };

    store.startSyncRun = vi.fn(async () => ({
      id: "run-1",
      dataset: "hubspot.startups",
      startedAt: new Date().toISOString(),
      finishedAt: undefined,
      status: "running",
      recordsUpserted: 0,
      errorMessage: undefined,
      cursorAfter: undefined,
    }));
    store.finishSyncRun = vi.fn(async () => undefined);
    store.failSyncRun = vi.fn(async () => undefined);

    await hubspotStartupsWorker.run(deps);

    expect(store.finishSyncRun).toHaveBeenCalledWith("run-1", {
      recordsUpserted: 1,
    });
    expect(store.enqueueSyncJob).not.toHaveBeenCalled();
  });
});

describe("enqueueHubspotCompanyActivitySync", () => {
  it("uses documented priority per reason", async () => {
    const store = createMockStore();

    await enqueueHubspotCompanyActivitySync(store, {
      companyId: "42",
      reason: "webhook",
    });
    await enqueueHubspotCompanyActivitySync(store, {
      companyId: "43",
      reason: "reconcile",
    });
    await enqueueHubspotCompanyActivitySync(store, {
      companyId: "44",
      reason: "backfill",
    });

    expect(store.enqueueCalls).toEqual([
      expect.objectContaining({
        entityId: "42",
        reason: "webhook",
        priority: HUBSPOT_ACTIVITY_SYNC_PRIORITIES.webhook,
      }),
      expect.objectContaining({
        entityId: "43",
        reason: "reconcile",
        priority: HUBSPOT_ACTIVITY_SYNC_PRIORITIES.reconcile,
      }),
      expect.objectContaining({
        entityId: "44",
        reason: "backfill",
        priority: HUBSPOT_ACTIVITY_SYNC_PRIORITIES.backfill,
      }),
    ]);
  });
});

describe("enqueueHubspotActivityBackfill", () => {
  it("enqueues only companies missing sync state", async () => {
    const store = createMockStore();

    const result = await enqueueHubspotActivityBackfill(store);

    expect(result.missing).toEqual(["42", "99"]);
    expect(result.enqueued).toBe(2);
    expect(result.deduped).toBe(0);
    expect(store.enqueueCalls.every((call) => call.reason === "backfill")).toBe(
      true,
    );
  });
});

describe("hubspotActivityBackfillWorker", () => {
  it("delegates to backfill enqueue helper", async () => {
    const store = createMockStore();
    store.startSyncRun = vi.fn(async () => ({
      id: "run-backfill",
      dataset: "hubspot.activity.backfill",
      startedAt: new Date().toISOString(),
      finishedAt: undefined,
      status: "running",
      recordsUpserted: 0,
      errorMessage: undefined,
      cursorAfter: undefined,
    }));
    store.finishSyncRun = vi.fn(async () => undefined);

    await hubspotActivityBackfillWorker.run({
      store,
      connectors: {} as SyncWorkerDeps["connectors"],
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
    });

    expect(store.finishSyncRun).toHaveBeenCalledWith("run-backfill", {
      recordsUpserted: 2,
    });
    expect(store.enqueueCalls).toHaveLength(2);
  });
});
