import type { Db } from "./pgClient.js";
import type {
  SignalStore,
  AddWatchedInput,
  ListEventsFilter,
  UpsertUnipileAccountInput,
} from "./signalStore.js";
import type {
  WatchedEntity,
  WatchedEntityPriority,
  SignalEvent,
  UnipileAccount,
  UnipileAccountState,
  UnipileAccountStatusEvent,
} from "../domain/signalHub.js";

const now = (): string => new Date().toISOString();

type WatchedRow = {
  id: string;
  startup_id: string | null;
  display_name: string;
  linkedin_url: string | null;
  linkedin_identifier: string | null;
  kind: string;
  priority: string;
  created_at: string;
};

type EventRow = {
  id: string;
  source: string;
  signal_type: string;
  watched_id: string | null;
  startup_id: string | null;
  unipile_account_id: string | null;
  emitted_at: string | null;
  ingested_at: string;
  url: string | null;
  raw_text: string | null;
  raw_payload: Record<string, unknown>;
  content_hash: string;
};

type AccountRow = {
  account_id: string;
  label: string;
  state: string;
  frozen_until: string | null;
  daily_quota: number;
  killed_reason: string | null;
  updated_at: string;
};

type StatusEventRow = {
  id: string;
  account_id: string;
  status: string;
  raw_payload: Record<string, unknown>;
  received_at: string;
};

const mapWatched = (r: WatchedRow): WatchedEntity => ({
  id: r.id,
  startupId: r.startup_id ?? undefined,
  displayName: r.display_name,
  linkedinUrl: r.linkedin_url ?? undefined,
  linkedinIdentifier: r.linkedin_identifier ?? undefined,
  kind: r.kind as WatchedEntity["kind"],
  priority: r.priority as WatchedEntityPriority,
  createdAt: r.created_at,
});

const mapEvent = (r: EventRow): SignalEvent => ({
  id: r.id,
  source: r.source as SignalEvent["source"],
  signalType: r.signal_type as SignalEvent["signalType"],
  watchedId: r.watched_id ?? undefined,
  startupId: r.startup_id ?? undefined,
  unipileAccountId: r.unipile_account_id ?? undefined,
  emittedAt: r.emitted_at ?? undefined,
  ingestedAt: r.ingested_at,
  url: r.url ?? undefined,
  rawText: r.raw_text ?? undefined,
  rawPayload: r.raw_payload,
  contentHash: r.content_hash,
});

const mapAccount = (r: AccountRow): UnipileAccount => ({
  accountId: r.account_id,
  label: r.label,
  state: r.state as UnipileAccountState,
  frozenUntil: r.frozen_until ?? undefined,
  dailyQuota: r.daily_quota,
  killedReason: r.killed_reason ?? undefined,
  updatedAt: r.updated_at,
});

const mapStatusEvent = (r: StatusEventRow): UnipileAccountStatusEvent => ({
  id: r.id,
  accountId: r.account_id,
  status: r.status,
  rawPayload: r.raw_payload,
  receivedAt: r.received_at,
});

export const createPgSignalStore = async (db: Db): Promise<SignalStore> => {
  return {
    async addWatched(input: AddWatchedInput): Promise<WatchedEntity> {
      const createdAt = now();
      await db`
        insert into watched_entities
          (id, startup_id, display_name, linkedin_url, linkedin_identifier, kind, priority, created_at)
        values (
          ${input.id}, ${input.startupId ?? null}, ${input.displayName},
          ${input.linkedinUrl ?? null}, ${input.linkedinIdentifier ?? null},
          ${input.kind ?? "person"}, ${input.priority ?? "warm"}, ${createdAt}
        )
      `;
      return {
        id: input.id,
        startupId: input.startupId,
        displayName: input.displayName,
        linkedinUrl: input.linkedinUrl,
        linkedinIdentifier: input.linkedinIdentifier,
        kind: input.kind ?? "person",
        priority: input.priority ?? "warm",
        createdAt,
      };
    },

    async getWatched(id: string): Promise<WatchedEntity | undefined> {
      const rows = await db<WatchedRow[]>`
        select * from watched_entities where id = ${id}
      `;
      return rows[0] ? mapWatched(rows[0]) : undefined;
    },

    async findWatchedByName(name: string): Promise<WatchedEntity[]> {
      const rows = await db<WatchedRow[]>`
        select * from watched_entities where lower(display_name) like lower(${"%" + name + "%"})
      `;
      return rows.map(mapWatched);
    },

    async findWatchedByLinkedinIdentifier(
      identifier: string,
    ): Promise<WatchedEntity | undefined> {
      const rows = await db<WatchedRow[]>`
        select * from watched_entities where linkedin_identifier = ${identifier}
      `;
      return rows[0] ? mapWatched(rows[0]) : undefined;
    },

    async findWatchedByStartupId(startupId: string): Promise<WatchedEntity | undefined> {
      const rows = await db<WatchedRow[]>`
        select * from watched_entities where startup_id = ${startupId}
      `;
      return rows[0] ? mapWatched(rows[0]) : undefined;
    },

    async listWatched(priority?: WatchedEntityPriority): Promise<WatchedEntity[]> {
      const rows = priority
        ? await db<WatchedRow[]>`
            select * from watched_entities
            where priority = ${priority}
            order by created_at asc
          `
        : await db<WatchedRow[]>`
            select * from watched_entities order by priority asc, created_at asc
          `;
      return rows.map(mapWatched);
    },

    async updateWatchedPriority(
      id: string,
      priority: WatchedEntityPriority,
    ): Promise<void> {
      await db`update watched_entities set priority = ${priority} where id = ${id}`;
    },

    async appendEvent(
      event: Omit<SignalEvent, "ingestedAt">,
    ): Promise<SignalEvent> {
      const ingestedAt = now();
      await db`
        insert into signal_events
          (id, source, signal_type, watched_id, startup_id, unipile_account_id,
           emitted_at, ingested_at, url, raw_text, raw_payload, content_hash)
        values (
          ${event.id}, ${event.source}, ${event.signalType},
          ${event.watchedId ?? null}, ${event.startupId ?? null},
          ${event.unipileAccountId ?? null}, ${event.emittedAt ?? null},
          ${ingestedAt}, ${event.url ?? null}, ${event.rawText ?? null},
          ${db.json(event.rawPayload as Parameters<typeof db.json>[0])}, ${event.contentHash}
        )
      `;
      return { ...event, ingestedAt };
    },

    async findEventByHash(
      source: string,
      signalType: string,
      contentHash: string,
    ): Promise<SignalEvent | undefined> {
      const rows = await db<EventRow[]>`
        select * from signal_events
        where source = ${source} and signal_type = ${signalType} and content_hash = ${contentHash}
      `;
      return rows[0] ? mapEvent(rows[0]) : undefined;
    },

    async listEvents(filter: ListEventsFilter): Promise<SignalEvent[]> {
      const parts: string[] = ["select * from signal_events where 1=1"];
      const params: (string | number)[] = [];
      let i = 1;

      if (filter.watchedId) {
        parts.push(`and watched_id = $${String(i++)}`);
        params.push(filter.watchedId);
      }
      if (filter.startupId) {
        parts.push(`and startup_id = $${String(i++)}`);
        params.push(filter.startupId);
      }
      if (filter.source) {
        parts.push(`and source = $${String(i++)}`);
        params.push(filter.source);
      }
      if (filter.signalType) {
        parts.push(`and signal_type = $${String(i++)}`);
        params.push(filter.signalType);
      }
      if (filter.sinceIso) {
        parts.push(`and ingested_at >= $${String(i++)}`);
        params.push(filter.sinceIso);
      }
      if (filter.textContains) {
        parts.push(`and lower(raw_text) like lower($${String(i++)})`);
        params.push(`%${filter.textContains}%`);
      }

      parts.push("order by ingested_at desc");

      if (filter.limit) {
        parts.push(`limit $${String(i++)}`);
        params.push(filter.limit);
      }

      const rows = await db.unsafe<EventRow[]>(parts.join(" "), params);
      return rows.map(mapEvent);
    },

    async upsertUnipileAccount(
      input: UpsertUnipileAccountInput,
    ): Promise<UnipileAccount> {
      const t = now();
      const quota = input.dailyQuota ?? 60;
      await db`
        insert into unipile_accounts (account_id, label, state, daily_quota, updated_at)
        values (${input.accountId}, ${input.label}, 'active', ${quota}, ${t})
        on conflict (account_id) do update set
          label = excluded.label,
          daily_quota = coalesce(${quota}, unipile_accounts.daily_quota),
          updated_at = excluded.updated_at
      `;
      const rows = await db<AccountRow[]>`
        select * from unipile_accounts where account_id = ${input.accountId}
      `;
      return mapAccount(rows[0]!);
    },

    async getUnipileAccount(accountId: string): Promise<UnipileAccount | undefined> {
      const rows = await db<AccountRow[]>`
        select * from unipile_accounts where account_id = ${accountId}
      `;
      return rows[0] ? mapAccount(rows[0]) : undefined;
    },

    async listUnipileAccounts(): Promise<UnipileAccount[]> {
      const rows = await db<AccountRow[]>`select * from unipile_accounts`;
      return rows.map(mapAccount);
    },

    async setUnipileAccountState(
      accountId: string,
      state: UnipileAccountState,
      opts?: { frozenUntil?: string; killedReason?: string },
    ): Promise<void> {
      const t = now();
      await db`
        update unipile_accounts set
          state = ${state},
          frozen_until = ${opts?.frozenUntil ?? null},
          killed_reason = ${opts?.killedReason ?? null},
          updated_at = ${t}
        where account_id = ${accountId}
      `;
    },

    async appendUnipileStatusEvent(
      event: Omit<UnipileAccountStatusEvent, "receivedAt">,
    ): Promise<void> {
      const receivedAt = now();
      await db`
        insert into unipile_account_status_events
          (id, account_id, status, raw_payload, received_at)
        values (
          ${event.id}, ${event.accountId}, ${event.status},
          ${db.json(event.rawPayload as Parameters<typeof db.json>[0])}, ${receivedAt}
        )
      `;
    },

    async listUnipileStatusEvents(
      accountId: string,
      limit = 50,
    ): Promise<UnipileAccountStatusEvent[]> {
      const rows = await db<StatusEventRow[]>`
        select * from unipile_account_status_events
        where account_id = ${accountId}
        order by received_at desc
        limit ${limit}
      `;
      return rows.map(mapStatusEvent);
    },
  };
};
