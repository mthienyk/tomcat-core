import type { SyncWorker, SyncWorkerDeps } from "./types.js";
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

// Run order matters: startups before activity, portfolio before board packs.
const ALL_WORKERS: SyncWorker[] = [
  hubspotStartupsWorker,
  mondayPortfolioWorker,
  hubspotActivityWorker,
  mondaySignalsWorker,
  mondayEventsWorker,
  driveBoardPacksWorker,
];

const FULL_SYNC_INTERVAL_MS = 15 * 60 * 1000; // 15 min
const STARTUP_DELAY_MS = 10 * 1000; // 10 s initial delay before first run

export type SyncScheduler = {
  start(): void;
  stop(): void;
  runNow(dataset: string): Promise<void>;
};

export const createSyncScheduler = (deps: SyncWorkerDeps): SyncScheduler => {
  let startupTimer: ReturnType<typeof setTimeout> | undefined;
  let intervalTimer: ReturnType<typeof setInterval> | undefined;
  let running = false;

  const runAll = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      for (const worker of ALL_WORKERS) {
        await worker.run(deps);
      }
    } finally {
      running = false;
    }
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
      await worker.run(deps);
    },
  };
};
