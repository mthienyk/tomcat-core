import type { SignalStore } from "../../storage/signalStore.js";
import type { StartupsService } from "../startups.js";
import type { EntityResolution, WatchedEntity } from "../../domain/signalHub.js";
import type { Identity } from "../../domain/identity.js";

// Resolves a free-text query (name, LinkedIn URL, or identifier) to a
// WatchedEntity + optionally a HubSpot Startup.
// Strategy is deterministic: no LLM calls here. Order of precedence:
// 1. LinkedIn identifier extracted from URL or raw value
// 2. Exact name match against watchlist
// 3. Substring match against watchlist
// 4. HubSpot startup name search (cross-reference)

const extractLinkedinIdentifier = (input: string): string | undefined => {
  const urlMatch = input.match(
    /linkedin\.com\/(?:in|company)\/([A-Za-z0-9_-]+)/i,
  );
  return urlMatch ? urlMatch[1] : undefined;
};

const normalize = (s: string): string => s.toLowerCase().trim();

export type ResolverResult = EntityResolution & {
  watched: WatchedEntity | undefined;
};

export const createEntityResolver = (
  store: SignalStore,
  startups: StartupsService,
) => ({
  async resolve(caller: Identity, query: string): Promise<ResolverResult> {
    const trimmed = query.trim();

    // 1. LinkedIn identifier from URL
    const identifier = extractLinkedinIdentifier(trimmed);
    if (identifier) {
      const byIdentifier = await store.findWatchedByLinkedinIdentifier(identifier);
      if (byIdentifier) {
        return {
          resolved: true,
          watchedId: byIdentifier.id,
          startupId: byIdentifier.startupId,
          displayName: byIdentifier.displayName,
          watched: byIdentifier,
        };
      }
    }

    // 2. Exact watchlist name match
    const allWatched = await store.listWatched();
    const exact = allWatched.find(
      (w) => normalize(w.displayName) === normalize(trimmed),
    );
    if (exact) {
      return {
        resolved: true,
        watchedId: exact.id,
        startupId: exact.startupId,
        displayName: exact.displayName,
        watched: exact,
      };
    }

    // 3. Substring watchlist match
    const byName = await store.findWatchedByName(trimmed);
    if (byName.length === 1 && byName[0] !== undefined) {
      const sole = byName[0];
      return {
        resolved: true,
        watchedId: sole.id,
        startupId: sole.startupId,
        displayName: sole.displayName,
        watched: sole,
      };
    }
    if (byName.length > 1) {
      return {
        resolved: false,
        needsClarification: true,
        candidates: byName.map((w) => ({ watchedId: w.id, displayName: w.displayName })),
        watched: undefined,
      };
    }

    // 4. HubSpot startup cross-reference (for entities not yet watched but known in CRM)
    const startupResults = await startups.searchStartups(caller, { startupName: trimmed });
    const startupList = Array.isArray(startupResults)
      ? (startupResults as { id: string; name: string }[])
      : [];
    if (startupList.length > 0) {
      const first = startupList[0];
      if (first !== undefined) {
        const byStartup = await store.findWatchedByStartupId(first.id);
        if (byStartup) {
          return {
            resolved: true,
            watchedId: byStartup.id,
            startupId: first.id,
            displayName: byStartup.displayName,
            watched: byStartup,
          };
        }
        return {
          resolved: false,
          needsClarification: false,
          candidates: startupList.slice(0, 5).map((s) => ({
            watchedId: `hubspot:${s.id}`,
            displayName: s.name,
          })),
          watched: undefined,
        };
      }
    }

    return {
      resolved: false,
      needsClarification: false,
      candidates: [],
      watched: undefined,
    };
  },
});

export type EntityResolver = ReturnType<typeof createEntityResolver>;
