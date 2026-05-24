import type { Identity } from "../domain/identity.js";
import type { Deal, Meeting, Note, Startup } from "../domain/entities.js";
import { BadRequest } from "../errors/index.js";
import { canSeeDeal, canSeeNote, canSeeStartup } from "../permissions/policies.js";
import { redactNoteBody } from "../permissions/redact.js";
import type { Connectors } from "../connectors/registry.js";

type StartupSeed = {
  startupId: string | undefined;
  startupName: string | undefined;
  sector: string | undefined;
};

type StartupLookup = {
  startupId?: string | undefined;
  startupName?: string | undefined;
};

type ListOptions = {
  limit?: number;
};

const MAX_LIMIT = 200;
const DEFAULT_DISCOVERY_LIMIT = 25;
const DEFAULT_ACTIVITY_LIMIT = 50;
const VISIBLE_STARTUPS_CACHE_TTL_MS = 60_000;

type VisibleStartupsCacheEntry = {
  expiresAt: number;
  startups: Startup[];
};

const cacheKeyForCaller = (caller: Identity): string => {
  if (caller.kind === "human") {
    return `human:${caller.email}:${caller.role}:${caller.investorId ?? ""}`;
  }
  const delegated = caller.onBehalfOf;
  return `service:${caller.clientId}:${delegated?.investorId ?? ""}:${delegated?.role ?? ""}`;
};

const normalize = (value: string): string => value.trim().toLowerCase();

const clampLimit = (limit: number | undefined, fallback: number): number => {
  if (limit === undefined) return fallback;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit)));
};

export const buildStartupsService = (deps: { connectors: Connectors }) => {
  const { connectors } = deps;
  const visibleStartupsCache = new Map<string, VisibleStartupsCacheEntry>();

  const listVisibleStartups = async (caller: Identity): Promise<Startup[]> => {
    const cacheKey = cacheKeyForCaller(caller);
    const hit = visibleStartupsCache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) {
      return hit.startups;
    }

    const all = await connectors.hubspot.listStartups();
    const visible = all.filter((startup) => canSeeStartup(caller, startup));
    visibleStartupsCache.set(cacheKey, {
      startups: visible,
      expiresAt: Date.now() + VISIBLE_STARTUPS_CACHE_TTL_MS,
    });
    return visible;
  };

  const resolveStartup = (
    startups: Startup[],
    lookup: StartupLookup | string,
  ): Startup | undefined => {
    if (typeof lookup === "string") {
      const byId = startups.find((startup) => startup.id === lookup);
      if (byId) return byId;
      const matches = startups.filter(
        (startup) => normalize(startup.name) === normalize(lookup),
      );
      if (matches.length > 1) {
        throw BadRequest("Ambiguous startupName. Provide startupId instead.", {
          startupName: lookup,
          matches: matches.map((startup) => ({
            id: startup.id,
            name: startup.name,
          })),
        });
      }
      return matches[0];
    }

    if (lookup.startupId) {
      return startups.find((startup) => startup.id === lookup.startupId);
    }
    const startupName = lookup.startupName;
    if (startupName !== undefined) {
      const matches = startups.filter(
        (startup) => normalize(startup.name) === normalize(startupName),
      );
      if (matches.length > 1) {
        throw BadRequest("Ambiguous startupName. Provide startupId instead.", {
          startupName,
          matches: matches.map((startup) => ({
            id: startup.id,
            name: startup.name,
          })),
        });
      }
      return matches[0];
    }
    throw BadRequest("Missing startup selector. Provide startupId or startupName.");
  };

  return {
    searchStartups: async (
      caller: Identity,
      query: { startupId?: string; startupName?: string; sector?: string },
      options?: ListOptions,
    ): Promise<Startup[]> => {
      const visible = await listVisibleStartups(caller);
      const limit = clampLimit(options?.limit, DEFAULT_ACTIVITY_LIMIT);

      if (query.startupId) {
        const found = visible.find((s) => s.id === query.startupId);
        return found ? [found] : [];
      }
      if (query.startupName) {
        const needle = normalize(query.startupName);
        return visible
          .filter((s) => normalize(s.name).includes(needle))
          .slice(0, limit);
      }
      if (query.sector) {
        const sector = query.sector.toLowerCase();
        return visible
          .filter((s) => s.sectors.some((sec) => sec.toLowerCase() === sector))
          .slice(0, limit);
      }
      return visible.slice(0, limit);
    },

    findSimilar: async (
      caller: Identity,
      seed: StartupSeed,
      options?: ListOptions,
    ): Promise<Startup[]> => {
      const visible = await listVisibleStartups(caller);
      const limit = clampLimit(
        options?.limit,
        seed.sector || seed.startupName || seed.startupId
          ? DEFAULT_ACTIVITY_LIMIT
          : DEFAULT_DISCOVERY_LIMIT,
      );

      if (seed.sector) {
        return visible.filter((s) =>
          s.sectors.some((sec) => sec.toLowerCase() === seed.sector?.toLowerCase()),
        ).slice(0, limit);
      }
      if (seed.startupName || seed.startupId) {
        const lookup = {
          ...(seed.startupId !== undefined ? { startupId: seed.startupId } : {}),
          ...(seed.startupName !== undefined ? { startupName: seed.startupName } : {}),
        };
        const ref = resolveStartup(visible, lookup);
        if (!ref) return [];
        return visible.filter(
          (s) =>
            s.id !== ref.id &&
            s.sectors.some((sec) => ref.sectors.includes(sec)),
        ).slice(0, limit);
      }
      return visible.slice(0, limit);
    },

    listAccessibleNotes: async (
      caller: Identity,
      startup: StartupLookup | string,
      options?: ListOptions,
    ): Promise<Note[]> => {
      const visible = await listVisibleStartups(caller);
      const target = resolveStartup(visible, startup);
      if (!target) return [];

      const notes = await connectors.hubspot.listNotesForStartup(target.id);
      const limit = clampLimit(options?.limit, DEFAULT_ACTIVITY_LIMIT);
      return notes
        .filter((note) => canSeeNote(caller, note))
        .map((note) => redactNoteBody(caller, note))
        .sort((left, right) =>
          right.createdAt.localeCompare(left.createdAt),
        )
        .slice(0, limit);
    },

    listAccessibleDeals: async (
      caller: Identity,
      startup: StartupLookup | string,
      options?: ListOptions,
    ): Promise<Deal[]> => {
      const visible = await listVisibleStartups(caller);
      const target = resolveStartup(visible, startup);
      if (!target) return [];

      const deals = await connectors.hubspot.listDealsForStartup(target.id);
      const limit = clampLimit(options?.limit, DEFAULT_ACTIVITY_LIMIT);
      return deals
        .filter((deal) => canSeeDeal(caller, deal))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, limit);
    },

    listAccessibleMeetings: async (
      caller: Identity,
      startup: StartupLookup | string,
      options?: ListOptions,
    ): Promise<Meeting[]> => {
      const visible = await listVisibleStartups(caller);
      const target = resolveStartup(visible, startup);
      if (!target) return [];

      const meetings = await connectors.hubspot.listMeetingsForStartup(target.id);
      const limit = clampLimit(options?.limit, DEFAULT_ACTIVITY_LIMIT);
      return meetings
        .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
        .slice(0, limit);
    },
  };
};

export type StartupsService = ReturnType<typeof buildStartupsService>;
