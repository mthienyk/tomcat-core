import type { Connectors } from "./registry.js";
import type { CoreStore, DatasetFreshness } from "../storage/coreStore.js";
import { inferMimeTypeFromTitle } from "../services/driveDocuments.js";

const FRESHNESS_TTL_MS = 5_000;

type CachedEntry = { value: DatasetFreshness; expiresAt: number };

/**
 * Returns Connectors backed by the CoreStore read model.
 * Falls back to the live HTTP connectors when the store has no synced data yet
 * (freshness.healthy === false) for list-heavy operations.
 * fetchDocumentText always goes live — Drive document text is not stored locally.
 *
 * Freshness checks are TTL-cached at 5 s to avoid N+1 DB queries on each request.
 */
export const buildStoreBackedConnectors = (
  store: CoreStore,
  live: Connectors,
): Connectors => {
  const cache = new Map<string, CachedEntry>();

  const getFreshness = async (dataset: string): Promise<DatasetFreshness> => {
    const hit = cache.get(dataset);
    if (hit && hit.expiresAt > Date.now()) return hit.value;
    const fresh = await store.getFreshness(dataset);
    cache.set(dataset, { value: fresh, expiresAt: Date.now() + FRESHNESS_TTL_MS });
    return fresh;
  };

  return {
    hubspot: {
      listStartups: async () => {
        const f = await getFreshness("hubspot.startups");
        if (!f.healthy) return live.hubspot.listStartups();
        return store.listStartups();
      },
      listDealsForStartup: async (startupId) => {
        const f = await getFreshness("hubspot.deals");
        if (!f.healthy) return live.hubspot.listDealsForStartup(startupId);
        return store.listDealsForStartup(startupId);
      },
      listNotesForStartup: async (startupId) => {
        const f = await getFreshness("hubspot.notes");
        if (!f.healthy) return live.hubspot.listNotesForStartup(startupId);
        return store.listNotesForStartup(startupId);
      },
      listMeetingsForStartup: async (startupId) => {
        const f = await getFreshness("hubspot.meetings");
        if (!f.healthy) return live.hubspot.listMeetingsForStartup(startupId);
        return store.listMeetingsForStartup(startupId);
      },
      listCompaniesModifiedSince: (sinceMs) =>
        live.hubspot.listCompaniesModifiedSince(sinceMs),
    },

    monday: {
      listPortfolio: async () => {
        const f = await getFreshness("monday.portfolio");
        if (!f.healthy) return live.monday.listPortfolio();
        return store.listPortfolioCompanies();
      },
      listSignals: async (sinceDays) => {
        const f = await getFreshness("monday.signals");
        if (!f.healthy) return live.monday.listSignals(sinceDays);
        return store.listPortfolioSignals({ sinceDays });
      },
      listUpcomingEvents: async () => {
        const f = await getFreshness("monday.events");
        if (!f.healthy) return live.monday.listUpcomingEvents();
        return store.listUpcomingEvents();
      },
    },

    drive: {
      listBoardPacksForCompany: async (portfolioCompanyId) => {
        const mapPack = (pack: {
          id: string;
          title: string;
          driveFileId: string;
          createdAt: string;
          mimeType?: string | undefined;
        }) => {
          const resolvedMime =
            pack.mimeType ?? inferMimeTypeFromTitle(pack.title);
          return {
            id: pack.id,
            title: pack.title,
            driveFileId: pack.driveFileId,
            createdAt: pack.createdAt,
            ...(resolvedMime !== undefined ? { mimeType: resolvedMime } : {}),
          };
        };

        const f = await getFreshness("drive.boardPacks");
        if (!f.healthy) {
          return live.drive.listBoardPacksForCompany(portfolioCompanyId);
        }

        const cached = await store.listBoardPacksForCompany(portfolioCompanyId);
        if (cached.length === 0) {
          return live.drive.listBoardPacksForCompany(portfolioCompanyId);
        }

        return cached.map(mapPack);
      },
      // Folder structure is not cached — always fetches live.
      listCompanyFolders: (portfolioCompanyId) =>
        live.drive.listCompanyFolders(portfolioCompanyId),
      listFolderChildren: (driveFolderId) =>
        live.drive.listFolderChildren(driveFolderId),
      resolveItemPath: (driveItemId) => live.drive.resolveItemPath(driveItemId),
      // Document text is never cached — always fetches live.
      fetchDocumentText: (driveFileId) => live.drive.fetchDocumentText(driveFileId),
      fetchDocumentBinary: (driveFileId) => live.drive.fetchDocumentBinary(driveFileId),
    },

    investors: {
      getInvestorById: (id) => store.getInvestorById(id),
    },
  };
};
