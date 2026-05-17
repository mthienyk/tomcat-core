import { randomUUID } from "crypto";
import type { SignalStore } from "../../storage/signalStore.js";
import type { SignalQueue, EnqueueResult } from "./queue.js";
import type { EntityResolver } from "./resolver.js";
import type { GuardianRegistry } from "./accountGuardian.js";
import type { Identity } from "../../domain/identity.js";
import type {
  WatchedEntity,
  WatchedEntityPriority,
  GuardianStatus,
  SignalEvent,
} from "../../domain/signalHub.js";
import type { ListEventsFilter } from "../../storage/signalStore.js";
import { Forbidden, NotFound, BadRequest } from "../../errors/index.js";
import { effectiveHuman } from "../../domain/identity.js";

export type AddWatchedArgs = {
  displayName: string;
  linkedinUrl?: string;
  linkedinIdentifier?: string;
  startupId?: string;
  kind?: "person" | "company";
  priority?: WatchedEntityPriority;
};

export type RequestRefreshArgs = {
  watchedId: string;
  source?: "serper_public" | "unipile" | undefined;
  unipileAccountId?: string | undefined;
};

export type SignalHubService = {
  addWatched(caller: Identity, args: AddWatchedArgs): Promise<WatchedEntity>;
  listWatched(caller: Identity, priority?: WatchedEntityPriority): Promise<WatchedEntity[]>;
  setPriority(caller: Identity, watchedId: string, priority: WatchedEntityPriority): Promise<void>;
  resolveEntity(caller: Identity, query: string): Promise<Awaited<ReturnType<EntityResolver["resolve"]>>>;
  listEvents(caller: Identity, filter: ListEventsFilter): Promise<SignalEvent[]>;
  requestRefresh(caller: Identity, args: RequestRefreshArgs): Promise<EnqueueResult>;
  listUnipileAccounts(caller: Identity): Promise<UnipileAccountView[]>;
  freezeUnipileAccount(caller: Identity, accountId: string, reason: string, durationMs?: number): Promise<void>;
  killUnipileAccount(caller: Identity, accountId: string, reason: string): Promise<void>;
  unfreezeUnipileAccount(caller: Identity, accountId: string): Promise<void>;
};

export type UnipileAccountView = {
  account: Awaited<ReturnType<SignalStore["getUnipileAccount"]>>;
  guardian: GuardianStatus;
};

const requireInternalTeam = (caller: Identity): void => {
  const human = effectiveHuman(caller);
  if (!human || human.role !== "internal_team") {
    throw Forbidden("Signal Hub management requires internal_team role");
  }
};

export const buildSignalHubService = (deps: {
  store: SignalStore;
  queue: SignalQueue;
  resolver: EntityResolver;
  guardians: GuardianRegistry;
}): SignalHubService => {
  const { store, queue, resolver, guardians } = deps;

  return {
    async addWatched(caller: Identity, args: AddWatchedArgs): Promise<WatchedEntity> {
      requireInternalTeam(caller);

      // Extract LinkedIn identifier from URL if provided
      let linkedinIdentifier = args.linkedinIdentifier;
      if (!linkedinIdentifier && args.linkedinUrl) {
        const match = args.linkedinUrl.match(
          /linkedin\.com\/(?:in|company)\/([A-Za-z0-9_-]+)/i,
        );
        if (match) linkedinIdentifier = match[1];
      }

      // Prevent duplicate entries for the same LinkedIn identifier
      if (linkedinIdentifier) {
        const existing = await store.findWatchedByLinkedinIdentifier(linkedinIdentifier);
        if (existing) {
          throw BadRequest(
            `Entity with LinkedIn identifier "${linkedinIdentifier}" already exists`,
            { existingId: existing.id, displayName: existing.displayName },
          );
        }
      }

      return store.addWatched({
        id: randomUUID(),
        displayName: args.displayName,
        ...(args.linkedinUrl !== undefined ? { linkedinUrl: args.linkedinUrl } : {}),
        ...(linkedinIdentifier !== undefined ? { linkedinIdentifier } : {}),
        ...(args.startupId !== undefined ? { startupId: args.startupId } : {}),
        kind: args.kind ?? "person",
        priority: args.priority ?? "warm",
      });
    },

    async listWatched(
      _caller: Identity,
      priority?: WatchedEntityPriority,
    ): Promise<WatchedEntity[]> {
      return store.listWatched(priority);
    },

    async setPriority(
      caller: Identity,
      watchedId: string,
      priority: WatchedEntityPriority,
    ): Promise<void> {
      requireInternalTeam(caller);
      const entity = await store.getWatched(watchedId);
      if (!entity) throw NotFound(`Watched entity ${watchedId} not found`);
      await store.updateWatchedPriority(watchedId, priority);
    },

    async resolveEntity(caller: Identity, query: string) {
      return resolver.resolve(caller, query);
    },

    async listEvents(_caller: Identity, filter: ListEventsFilter): Promise<SignalEvent[]> {
      return store.listEvents(filter);
    },

    async requestRefresh(caller: Identity, args: RequestRefreshArgs): Promise<EnqueueResult> {
      requireInternalTeam(caller);

      const watched = await store.getWatched(args.watchedId);
      if (!watched) throw NotFound(`Watched entity ${args.watchedId} not found`);

      const source = args.source ?? "serper_public";

      if (source === "unipile") {
        if (!args.unipileAccountId) {
          throw BadRequest("unipileAccountId is required for unipile source");
        }
        if (!watched.linkedinIdentifier) {
          throw BadRequest(
            `Entity "${watched.displayName}" has no linkedinIdentifier — Unipile cannot poll without it. ` +
            `Update the entity or use serper_public instead.`,
          );
        }
        const guardian = guardians.get(args.unipileAccountId);
        if (!guardian) {
          throw BadRequest(
            `Unipile account ${args.unipileAccountId} not registered. Add it via the store first.`,
          );
        }
        const check = guardian.canRun();
        if (!check.allowed && check.retryAfterMs === Number.MAX_SAFE_INTEGER) {
          throw BadRequest(`Account is killed: ${check.reason}`);
        }
        return queue.enqueueUnipile(watched, args.unipileAccountId);
      }

      return queue.enqueuePublic(watched);
    },

    async listUnipileAccounts(_caller: Identity): Promise<UnipileAccountView[]> {
      const accounts = await store.listUnipileAccounts();
      return accounts.map((account) => {
        const guardian = guardians.get(account.accountId);
        return {
          account,
          guardian: guardian
            ? guardian.snapshot()
            : {
              accountId: account.accountId,
              label: account.label,
              state: account.state,
              frozenUntil: account.frozenUntil,
              frozenReason: undefined,
              killedReason: account.killedReason,
              dailyQuota: account.dailyQuota,
              dailyUsed: 0,
              dailyResetsAt: new Date().toISOString(),
              lastCallAt: undefined,
              lastErrorCode: undefined,
              nextAllowedAt: undefined,
            },
        };
      });
    },

    async freezeUnipileAccount(
      caller: Identity,
      accountId: string,
      reason: string,
      durationMs?: number,
    ): Promise<void> {
      requireInternalTeam(caller);
      const guardian = guardians.get(accountId);
      if (!guardian) throw NotFound(`Guardian for account ${accountId} not found`);
      await guardian.freeze(reason, durationMs);
    },

    async killUnipileAccount(
      caller: Identity,
      accountId: string,
      reason: string,
    ): Promise<void> {
      requireInternalTeam(caller);
      const guardian = guardians.get(accountId);
      if (!guardian) throw NotFound(`Guardian for account ${accountId} not found`);
      await guardian.kill(reason);
    },

    async unfreezeUnipileAccount(
      caller: Identity,
      accountId: string,
    ): Promise<void> {
      requireInternalTeam(caller);
      const guardian = guardians.get(accountId);
      if (!guardian) throw NotFound(`Guardian for account ${accountId} not found`);
      await guardian.unfreeze();
    },
  };
};
