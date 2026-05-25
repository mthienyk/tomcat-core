import { createHash } from "node:crypto";
import type { Note } from "../domain/entities.js";
import type { HubspotCompanySyncState } from "../domain/syncQueue.js";
import {
  HUBSPOT_ACTIVITY_DATASET,
  HUBSPOT_ACTIVITY_ENTITY_KIND,
} from "../domain/syncQueue.js";
import type { CoreStore } from "../storage/coreStore.js";
import type { Connectors } from "../connectors/registry.js";
import { ensureHubspotStartupForCompany } from "./ensureHubspotStartup.js";

export type HubspotActivitySyncResult = {
  companyId: string;
  deals: number;
  notes: number;
  meetings: number;
  notesFingerprint: string;
  startupEnsure?: Awaited<ReturnType<typeof ensureHubspotStartupForCompany>>;
  skipped?: boolean;
};

const HUBSPOT_ACTIVITY_DATASETS = [
  "hubspot.notes",
  "hubspot.deals",
  "hubspot.meetings",
] as const;

export const computeNotesFingerprint = (notes: Note[]): string => {
  const payload = notes
    .map((n) => `${n.id}:${n.createdAt}:${n.body.length}`)
    .sort()
    .join("|");
  return createHash("sha256").update(payload).digest("hex");
};

export const syncHubspotCompanyActivity = async (input: {
  store: CoreStore;
  connectors: Connectors;
  companyId: string;
  hubspotModifiedAt?: string;
}): Promise<HubspotActivitySyncResult> => {
  const { store, connectors, companyId, hubspotModifiedAt } = input;

  const startupEnsure = await ensureHubspotStartupForCompany({
    store,
    connectors,
    companyId,
  });

  if (hubspotModifiedAt) {
    const existing = await store.getHubspotCompanySyncState(companyId);
    if (
      existing?.lastHubspotModifiedAt
      && existing.lastHubspotModifiedAt === hubspotModifiedAt
    ) {
      return {
        companyId,
        deals: existing.dealsCount,
        notes: existing.notesCount,
        meetings: existing.meetingsCount,
        notesFingerprint: existing.notesFingerprint ?? "",
        startupEnsure,
        skipped: true,
      };
    }
  }

  const [dealList, noteList, meetingList] = await Promise.all([
    connectors.hubspot.listDealsForStartup(companyId),
    connectors.hubspot.listNotesForStartup(companyId),
    connectors.hubspot.listMeetingsForStartup(companyId),
  ]);

  for (const deal of dealList) await store.upsertDeal(deal);
  for (const note of noteList) await store.upsertNote(note);
  for (const meeting of meetingList) await store.upsertMeeting(meeting);

  const notesFingerprint = computeNotesFingerprint(noteList);
  const syncedAt = new Date().toISOString();
  const state: HubspotCompanySyncState = {
    companyId,
    lastActivitySyncAt: syncedAt,
    lastHubspotModifiedAt: hubspotModifiedAt,
    notesCount: noteList.length,
    dealsCount: dealList.length,
    meetingsCount: meetingList.length,
    notesFingerprint,
    updatedAt: syncedAt,
  };
  await store.upsertHubspotCompanySyncState(state);

  return {
    companyId,
    deals: dealList.length,
    notes: noteList.length,
    meetings: meetingList.length,
    notesFingerprint,
    startupEnsure,
  };
};

export const refreshHubspotActivityFreshness = async (
  store: CoreStore,
): Promise<void> => {
  for (const dataset of HUBSPOT_ACTIVITY_DATASETS) {
    await store.refreshDatasetFreshness(dataset);
  }
};

export const hubspotActivityQueueDataset = "hubspot.activity.queue" as const;
export const hubspotActivityBackfillDataset =
  "hubspot.activity.backfill" as const;
export const hubspotActivityReconcileDataset =
  "hubspot.activity.reconcile" as const;

export const hubspotActivitySyncDataset = HUBSPOT_ACTIVITY_DATASET;
export const hubspotActivityEntityKind = HUBSPOT_ACTIVITY_ENTITY_KIND;
