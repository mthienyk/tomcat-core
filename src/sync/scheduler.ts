import type { SyncWorker, SyncWorkerDeps } from "./types.js";
import type { Db } from "../storage/pgClient.js";
import type { CoreStore } from "../storage/coreStore.js";
import {
  SYNC_SCHEDULER_LOCK_KEY,
  releaseAdvisoryLock,
  tryAdvisoryLock,
} from "../storage/pgAdvisoryLock.js";
import {
  hubspotStartupsWorker,
  hubspotActivityWorker,
} from "./hubspot.js";
import {
  mondayPortfolioWorker,
  mondaySignalsWorker,
  mondayEventsWorker,
} from "./monday.js";
import { driveBoardPacksWorker } from "./drive.js";

const ALL_WORKERS: SyncWorker[] = [
  hubspotStartupsWorker,
  mondayPortfolioWorker,
  hubspotActivityWorker,
  mondaySignalsWorker,
  mondayEventsWorker,
  driveBoardPacksWorker,
];

const FULL_SYNC_INTERVAL_MS = 15 * 60 * 1000;
const STARTUP_DELAY_MS = 10 * 1000;

export type SyncSchedulerOptions = {
  overlapGraceMinutes: number;
};

export type SyncScheduler = {
  start(): void;
  stop(): void;
  runNow(dataset: string): Promise<void>;
};

export const createSyncScheduler = (
  deps: SyncWorkerDeps,
  db: Db,
  store: CoreStore,
  options: SyncSchedulerOptions,
): SyncScheduler => {
  let startupTimer: ReturnType<typeof setTimeout> | undefined;
  let intervalTimer: ReturnType<typeof setInterval> | undefined;
  let running = false;

  const withLeaderLock = async (fn: () => Promise<void>): Promise<void> => {
    if (await store.hasRecentRunningSyncRun(options.overlapGraceMinutes)) {
      deps.logger.debug(
        { graceMinutes: options.overlapGraceMinutes },
        "sync_scheduler_skipped_recent_running",
      );
      return;
    }

    const acquired = await tryAdvisoryLock(db, SYNC_SCHEDULER_LOCK_KEY);
    if (!acquired) {
      deps.logger.debug("sync_scheduler_skipped_not_leader");
      return;
    }
    try {
      await fn();
    } finally {
      await releaseAdvisoryLock(db, SYNC_SCHEDULER_LOCK_KEY);
    }
  };

  const runAll = async (): Promise<void> => {
    if (running) return;
    await withLeaderLock(async () => {
      running = true;
      try {
        for (const worker of ALL_WORKERS) {
          await worker.run(deps);
        }
      } finally {
        running = false;
      }
    });
  };

  return {
    start() {
      startupTimer = setTimeout(() => {
        startupTimer = undefined;
        void runAll();
        intervalTimer = setInterval(() => {
          void runAll();
        }, FULL_SYNC_INTERVAL_MS);
      }, STARTUP_DELAY_MS);
    },

    stop() {
      if (startupTimer !== undefined) {
        clearTimeout(startupTimer);
        startupTimer = undefined;
      }
      if (intervalTimer !== undefined) {
        clearInterval(intervalTimer);
        intervalTimer = undefined;
      }
    },

    async runNow(dataset: string): Promise<void> {
      const worker = ALL_WORKERS.find((w) => w.dataset === dataset);
      if (!worker) throw new Error(`Unknown sync dataset: ${dataset}`);
      await withLeaderLock(async () => {
        await worker.run(deps);
      });
    },
  };
};
