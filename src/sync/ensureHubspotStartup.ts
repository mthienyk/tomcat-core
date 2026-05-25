import type { Connectors } from "../connectors/registry.js";
import type { CoreStore } from "../storage/coreStore.js";

export type EnsureHubspotStartupResult = "exists" | "created" | "missing";

export const ensureHubspotStartupForCompany = async (input: {
  store: CoreStore;
  connectors: Connectors;
  companyId: string;
}): Promise<EnsureHubspotStartupResult> => {
  const { store, connectors, companyId } = input;

  const existing = await store.getStartupById(companyId);
  if (existing) return "exists";

  const startup = await connectors.hubspot.getStartupById(companyId);
  if (!startup) return "missing";

  const inserted = await store.insertStartupIfAbsent(startup);
  return inserted ? "created" : "exists";
};

export const listStartupIdsMissingFromNotes = async (
  store: CoreStore,
): Promise<string[]> => {
  const ids = await store.listStartupIdsWithNotesMissingDirectoryEntry();
  return ids;
};
