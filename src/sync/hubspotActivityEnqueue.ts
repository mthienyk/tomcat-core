import type { SyncQueueReason } from "../domain/syncQueue.js";
import type { CoreStore } from "../storage/coreStore.js";
import {
  hubspotActivityEntityKind,
  hubspotActivitySyncDataset,
} from "./hubspotActivitySync.js";

/**
 * Lower number = higher priority when the queue worker claims jobs.
 * Webhook beats reconcile; backfill is lowest (bulk catch-up).
 */
export const HUBSPOT_ACTIVITY_SYNC_PRIORITIES: Record<
  SyncQueueReason,
  number
> = {
  webhook: 50,
  manual: 120,
  reconcile: 150,
  startup_seed: 180,
  backfill: 200,
};

export type EnqueueHubspotActivityResult = "created" | "deduped";

export const enqueueHubspotCompanyActivitySync = async (
  store: CoreStore,
  input: {
    companyId: string;
    reason: SyncQueueReason;
    priority?: number;
    hubspotModifiedAt?: string;
  },
): Promise<EnqueueHubspotActivityResult> =>
  store.enqueueSyncJob({
    dataset: hubspotActivitySyncDataset,
    entityKind: hubspotActivityEntityKind,
    entityId: input.companyId,
    reason: input.reason,
    priority:
      input.priority ?? HUBSPOT_ACTIVITY_SYNC_PRIORITIES[input.reason],
    ...(input.hubspotModifiedAt
      ? { triggerContext: { hubspotModifiedAt: input.hubspotModifiedAt } }
      : {}),
  });

export type HubspotActivityBackfillResult = {
  missing: string[];
  enqueued: number;
  deduped: number;
};

/**
 * Enqueues activity sync for startups present in the directory but never synced.
 * This is the sole automatic path for first-time activity backfill after
 * hubspot.startups refreshes the company directory.
 */
export const enqueueHubspotActivityBackfill = async (
  store: CoreStore,
): Promise<HubspotActivityBackfillResult> => {
  const missing = await store.listHubspotCompanySyncStatesMissingActivity();
  let enqueued = 0;
  let deduped = 0;

  for (const companyId of missing) {
    const result = await enqueueHubspotCompanyActivitySync(store, {
      companyId,
      reason: "backfill",
    });
    if (result === "created") enqueued += 1;
    else deduped += 1;
  }

  return { missing, enqueued, deduped };
};
