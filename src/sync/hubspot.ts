import { hostname } from "node:os";
import type { SyncWorker, SyncWorkerDeps } from "./types.js";
import {
  enqueueHubspotActivityBackfill,
  enqueueHubspotCompanyActivitySync,
} from "./hubspotActivityEnqueue.js";
import {
  hubspotActivityBackfillDataset,
  hubspotActivityQueueDataset,
  hubspotActivityReconcileDataset,
  hubspotActivitySyncDataset,
  refreshHubspotActivityFreshness,
  syncHubspotCompanyActivity,
} from "./hubspotActivitySync.js";
import { runHubspotStartupsDirectorySync } from "./hubspotStartupsSync.js";

const workerId = (): string => `${hostname()}:${process.pid}`;

export const hubspotStartupsWorker: SyncWorker = {
  dataset: "hubspot.startups",

  async run(deps: SyncWorkerDeps): Promise<void> {
    const { store, logger } = deps;
    const run = await store.startSyncRun("hubspot.startups");
    try {
      const { startupCount } = await runHubspotStartupsDirectorySync(deps);
      await store.finishSyncRun(run.id, { recordsUpserted: startupCount });

      logger.info(
        { dataset: "hubspot.startups", count: startupCount },
        "directory sync complete",
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await store.failSyncRun(run.id, message);
      logger.error({ dataset: "hubspot.startups", err }, "sync failed");
    }
  },
};

export const hubspotActivityBackfillWorker: SyncWorker = {
  dataset: hubspotActivityBackfillDataset,

  async run({ store, logger }: SyncWorkerDeps): Promise<void> {
    const run = await store.startSyncRun(hubspotActivityBackfillDataset);
    try {
      const { missing, enqueued, deduped } =
        await enqueueHubspotActivityBackfill(store);
      await store.finishSyncRun(run.id, { recordsUpserted: enqueued });
      logger.info(
        {
          dataset: hubspotActivityBackfillDataset,
          missing: missing.length,
          enqueued,
          deduped,
        },
        "backfill enqueue complete",
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await store.failSyncRun(run.id, message);
      logger.error({ dataset: hubspotActivityBackfillDataset, err }, "backfill failed");
    }
  },
};

export type HubspotQueueWorkerOptions = {
  batchSize: number;
  staleJobMs: number;
  retryDelayMs: number;
};

export const createHubspotActivityQueueWorker = (
  options: HubspotQueueWorkerOptions,
): SyncWorker => ({
  dataset: hubspotActivityQueueDataset,

  async run({
    store,
    connectors,
    logger,
    onHubspotNotesSynced,
  }: SyncWorkerDeps): Promise<void> {
    const released = await store.releaseStaleSyncJobs(options.staleJobMs);
    if (released > 0) {
      logger.warn({ released }, "sync_queue_stale_jobs_released");
    }

    const jobs = await store.claimSyncJobs(
      hubspotActivitySyncDataset,
      options.batchSize,
      workerId(),
    );
    if (jobs.length === 0) return;

    const run = await store.startSyncRun(hubspotActivityQueueDataset);
    let records = 0;
    let failures = 0;
    let notesSynced = 0;

    try {
      for (const job of jobs) {
        try {
          const result = await syncHubspotCompanyActivity({
            store,
            connectors,
            companyId: job.entityId,
            ...(job.triggerContext?.hubspotModifiedAt
              ? { hubspotModifiedAt: job.triggerContext.hubspotModifiedAt }
              : {}),
          });
          await store.completeSyncJob(job.id);
          if (!result.skipped) {
            records += result.notes + result.deals + result.meetings;
            notesSynced += result.notes;
          }
        } catch (err) {
          failures += 1;
          const message = err instanceof Error ? err.message : String(err);
          await store.failSyncJob(job.id, message, options.retryDelayMs);
          logger.error(
            { jobId: job.id, companyId: job.entityId, err: message },
            "hubspot_activity_sync_job_failed",
          );
        }
      }

      await refreshHubspotActivityFreshness(store);
      await store.finishSyncRun(run.id, { recordsUpserted: records });

      if (notesSynced > 0 && onHubspotNotesSynced) {
        onHubspotNotesSynced({ notesUpserted: notesSynced });
      }

      logger.info(
        {
          dataset: hubspotActivityQueueDataset,
          processed: jobs.length,
          records,
          notesSynced,
          failures,
        },
        "queue batch complete",
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await store.failSyncRun(run.id, message);
      throw err;
    }
  },
});

export type HubspotReconcileWorkerOptions = {
  lookbackMs: number;
};

export const createHubspotActivityReconcileWorker = (
  options: HubspotReconcileWorkerOptions,
): SyncWorker => ({
  dataset: hubspotActivityReconcileDataset,

  async run({ store, connectors, logger }: SyncWorkerDeps): Promise<void> {
    const run = await store.startSyncRun(hubspotActivityReconcileDataset);
    try {
      const cursor = await store.getSyncCursor(hubspotActivityReconcileDataset);
      const sinceMs = cursor
        ? Date.parse(cursor) - options.lookbackMs
        : Date.now() - 24 * 60 * 60_000;

      const modified = await connectors.hubspot.listCompaniesModifiedSince(sinceMs);
      let enqueued = 0;
      let maxModifiedAt = cursor ?? new Date(sinceMs).toISOString();

      for (const company of modified) {
        const result = await enqueueHubspotCompanyActivitySync(store, {
          companyId: company.id,
          reason: "reconcile",
          hubspotModifiedAt: company.modifiedAt,
        });
        if (result === "created") enqueued += 1;
        if (Date.parse(company.modifiedAt) > Date.parse(maxModifiedAt)) {
          maxModifiedAt = company.modifiedAt;
        }
      }

      await store.setSyncCursor(
        hubspotActivityReconcileDataset,
        maxModifiedAt,
      );
      await store.finishSyncRun(run.id, {
        recordsUpserted: enqueued,
        cursorAfter: maxModifiedAt,
      });
      logger.info(
        {
          dataset: hubspotActivityReconcileDataset,
          scanned: modified.length,
          enqueued,
          cursor: maxModifiedAt,
        },
        "reconcile complete",
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await store.failSyncRun(run.id, message);
      logger.error({ dataset: hubspotActivityReconcileDataset, err }, "reconcile failed");
    }
  },
});

/** @deprecated Full-scan worker replaced by queue + reconcile. Kept for manual recovery. */
export const hubspotActivityWorker: SyncWorker = {
  dataset: "hubspot.activity.legacy",

  async run({ store, logger }: SyncWorkerDeps): Promise<void> {
    const run = await store.startSyncRun("hubspot.activity.legacy");
    try {
      const startups = await store.listStartups();
      let enqueued = 0;
      for (const startup of startups) {
        const result = await enqueueHubspotCompanyActivitySync(store, {
          companyId: startup.id,
          reason: "manual",
        });
        if (result === "created") enqueued += 1;
      }
      await store.finishSyncRun(run.id, { recordsUpserted: enqueued });
      logger.info(
        { dataset: "hubspot.activity.legacy", enqueued },
        "legacy activity sync enqueued companies",
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await store.failSyncRun(run.id, message);
      logger.error({ dataset: "hubspot.activity.legacy", err }, "legacy enqueue failed");
    }
  },
};
