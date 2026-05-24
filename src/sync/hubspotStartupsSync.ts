import type { SyncWorkerDeps } from "./types.js";

export type HubspotStartupsDirectorySyncResult = {
  startupCount: number;
};

/**
 * Refreshes the startup directory from HubSpot (metadata only).
 * Does not enqueue activity sync — that is handled by backfill (new companies),
 * reconcile (modified companies), and webhooks (push).
 */
export const runHubspotStartupsDirectorySync = async (
  deps: SyncWorkerDeps,
): Promise<HubspotStartupsDirectorySyncResult> => {
  const { store, connectors } = deps;
  const startups = await connectors.hubspot.listStartups();

  for (const startup of startups) {
    await store.upsertStartup(startup);
  }

  return { startupCount: startups.length };
};
