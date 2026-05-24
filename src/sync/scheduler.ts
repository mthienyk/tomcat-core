import type { SyncWorker, SyncWorkerDeps } from "./types.js";
import type { Db } from "../storage/pgClient.js";
import type { CoreStore } from "../storage/coreStore.js";
import {
  SYNC_QUEUE_LOCK_KEY,
  SYNC_SCHEDULER_LOCK_KEY,
  releaseAdvisoryLock,
  tryAdvisoryLock,
} from "../storage/pgAdvisoryLock.js";
import {
  createHubspotActivityQueueWorker,
  createHubspotActivityReconcileWorker,
  hubspotActivityBackfillWorker,
  hubspotStartupsWorker,
} from "./hubspot.js";
import {
  mondayPortfolioWorker,
  mondaySignalsWorker,
  mondayEventsWorker,
} from "./monday.js";
import { driveBoardPacksWorker } from "./drive.js";

export type SyncSchedulerConfig = {
  overlapGraceMinutes: number;
  queuePollIntervalMs: number;
  queueBatchSize: number;
  queueStaleJobMs: number;
  queueRetryDelayMs: number;
  reconcileIntervalMs: number;
  reconcileLookbackMs: number;
};

export type SyncScheduler = {
  start(): void;
  stop(): void;
  runNow(dataset: string): Promise<void>;
};

const PERIODIC_INTERVAL_MS = 15 * 60 * 1000;
const STARTUP_DELAY_MS = 10_000;

export const createSyncScheduler = (
  deps: SyncWorkerDeps,
  db: Db,
  store: CoreStore,
  config: SyncSchedulerConfig,
): SyncScheduler => {
  const reconcileWorker = createHubspotActivityReconcileWorker({
    lookbackMs: config.reconcileLookbackMs,
  });
  const queueWorker = createHubspotActivityQueueWorker({
    batchSize: config.queueBatchSize,
    staleJobMs: config.queueStaleJobMs,
    retryDelayMs: config.queueRetryDelayMs,
  });

  const periodicWorkers: SyncWorker[] = [
    hubspotStartupsWorker,
    mondayPortfolioWorker,
    hubspotActivityBackfillWorker,
    mondaySignalsWorker,
    mondayEventsWorker,
    driveBoardPacksWorker,
  ];

  const allWorkers = [...periodicWorkers, queueWorker];

  let startupTimer: ReturnType<typeof setTimeout> | undefined;
  let periodicTimer: ReturnType<typeof setInterval> | undefined;
  let queueTimer: ReturnType<typeof setInterval> | undefined;
  let reconcileTimer: ReturnType<typeof setInterval> | undefined;
  let queueRunning = false;
  let periodicRunning = false;

  const withLeaderLock = async (
    lockKey: number,
    fn: () => Promise<void>,
  ): Promise<void> => {
    const acquired = await tryAdvisoryLock(db, lockKey);
    if (!acquired) return;
    try {
      await fn();
    } finally {
      await releaseAdvisoryLock(db, lockKey);
    }
  };

  const runPeriodic = async (): Promise<void> => {
    if (periodicRunning) return;
    if (await store.hasRecentRunningSyncRun(config.overlapGraceMinutes)) {
      deps.logger.debug("sync_periodic_skipped_recent_running");
      return;
    }

    await withLeaderLock(SYNC_SCHEDULER_LOCK_KEY, async () => {
      periodicRunning = true;
      try {
        for (const worker of periodicWorkers) {
          await worker.run(deps);
        }
      } finally {
        periodicRunning = false;
      }
    });
  };

  const runQueue = async (): Promise<void> => {
    if (queueRunning) return;
    await withLeaderLock(SYNC_QUEUE_LOCK_KEY, async () => {
      queueRunning = true;
      try {
        await queueWorker.run(deps);
      } finally {
        queueRunning = false;
      }
    });
  };

  return {
    start() {
      startupTimer = setTimeout(() => {
        startupTimer = undefined;
        void runPeriodic();
        void runQueue();

        periodicTimer = setInterval(() => {
          void runPeriodic();
        }, PERIODIC_INTERVAL_MS);

        queueTimer = setInterval(() => {
          void runQueue();
        }, config.queuePollIntervalMs);

        reconcileTimer = setInterval(() => {
          void withLeaderLock(SYNC_SCHEDULER_LOCK_KEY, async () => {
            await reconcileWorker.run(deps);
          });
        }, config.reconcileIntervalMs);
      }, STARTUP_DELAY_MS);
    },

    stop() {
      if (startupTimer !== undefined) {
        clearTimeout(startupTimer);
        startupTimer = undefined;
      }
      if (periodicTimer !== undefined) {
        clearInterval(periodicTimer);
        periodicTimer = undefined;
      }
      if (queueTimer !== undefined) {
        clearInterval(queueTimer);
        queueTimer = undefined;
      }
      if (reconcileTimer !== undefined) {
        clearInterval(reconcileTimer);
        reconcileTimer = undefined;
      }
    },

    async runNow(dataset: string): Promise<void> {
      const worker = allWorkers.find((w) => w.dataset === dataset);
      if (!worker) throw new Error(`Unknown sync dataset: ${dataset}`);
      await withLeaderLock(SYNC_SCHEDULER_LOCK_KEY, async () => {
        await worker.run(deps);
      });
    },
  };
};
