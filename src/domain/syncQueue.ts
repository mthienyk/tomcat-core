export type SyncQueueReason =
  | "backfill"
  | "webhook"
  | "reconcile"
  | "manual"
  | "startup_seed";

export type SyncQueueStatus =
  | "pending"
  | "running"
  | "done"
  | "failed"
  | "dead";

export type SyncQueueTriggerContext = {
  hubspotModifiedAt?: string;
};

export type SyncQueueJob = {
  id: string;
  dataset: string;
  entityKind: string;
  entityId: string;
  reason: SyncQueueReason;
  priority: number;
  status: SyncQueueStatus;
  attempts: number;
  maxAttempts: number;
  scheduledAt: string;
  lockedAt: string | undefined;
  lockedBy: string | undefined;
  lastError: string | undefined;
  dedupeKey: string;
  triggerContext: SyncQueueTriggerContext | undefined;
  createdAt: string;
  updatedAt: string;
};

export type EnqueueSyncJobInput = {
  dataset: string;
  entityKind: string;
  entityId: string;
  reason: SyncQueueReason;
  priority?: number;
  maxAttempts?: number;
  scheduledAt?: string;
  triggerContext?: SyncQueueTriggerContext;
};

export type SyncQueueStats = {
  pending: number;
  running: number;
  failed: number;
  dead: number;
  doneLast24h: number;
};

export type HubspotCompanySyncState = {
  companyId: string;
  lastActivitySyncAt: string | undefined;
  lastHubspotModifiedAt: string | undefined;
  notesCount: number;
  dealsCount: number;
  meetingsCount: number;
  notesFingerprint: string | undefined;
  updatedAt: string;
};

export const HUBSPOT_ACTIVITY_DATASET = "hubspot.activity";
export const HUBSPOT_ACTIVITY_ENTITY_KIND = "startup";

export const buildHubspotActivityDedupeKey = (companyId: string): string =>
  `${HUBSPOT_ACTIVITY_DATASET}:${HUBSPOT_ACTIVITY_ENTITY_KIND}:${companyId}`;
