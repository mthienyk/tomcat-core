import Database from "better-sqlite3";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { randomUUID } from "crypto";
import type {
  WatchedEntity,
  WatchedEntityPriority,
  SignalEvent,
  UnipileAccount,
  UnipileAccountState,
  UnipileAccountStatusEvent,
} from "../domain/signalHub.js";
import type {
  SignalStore,
  AddWatchedInput,
  ListEventsFilter,
  UpsertUnipileAccountInput,
} from "./signalStore.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const MIGRATION_PATH = join(__dirname, "migrations", "001_signal_hub.sql");

// --- Row mappers ---

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
  raw_payload: string;
  content_hash: string;
};

type UnipileAccountRow = {
  account_id: string;
  label: string;
  state: string;
  frozen_until: string | null;
  daily_quota: number;
  killed_reason: string | null;
  updated_at: string;
};

type UnipileStatusEventRow = {
  id: string;
  account_id: string;
  status: string;
  raw_payload: string;
  received_at: string;
};

const mapWatched = (row: WatchedRow): WatchedEntity => ({
  id: row.id,
  startupId: row.startup_id ?? undefined,
  displayName: row.display_name,
  linkedinUrl: row.linkedin_url ?? undefined,
  linkedinIdentifier: row.linkedin_identifier ?? undefined,
  kind: (row.kind as WatchedEntity["kind"]),
  priority: (row.priority as WatchedEntityPriority),
  createdAt: row.created_at,
});

const mapEvent = (row: EventRow): SignalEvent => ({
  id: row.id,
  source: (row.source as SignalEvent["source"]),
  signalType: (row.signal_type as SignalEvent["signalType"]),
  watchedId: row.watched_id ?? undefined,
  startupId: row.startup_id ?? undefined,
  unipileAccountId: row.unipile_account_id ?? undefined,
  emittedAt: row.emitted_at ?? undefined,
  ingestedAt: row.ingested_at,
  url: row.url ?? undefined,
  rawText: row.raw_text ?? undefined,
  rawPayload: JSON.parse(row.raw_payload) as Record<string, unknown>,
  contentHash: row.content_hash,
});

const mapUnipileAccount = (row: UnipileAccountRow): UnipileAccount => ({
  accountId: row.account_id,
  label: row.label,
  state: (row.state as UnipileAccountState),
  frozenUntil: row.frozen_until ?? undefined,
  dailyQuota: row.daily_quota,
  killedReason: row.killed_reason ?? undefined,
  updatedAt: row.updated_at,
});

const mapStatusEvent = (row: UnipileStatusEventRow): UnipileAccountStatusEvent => ({
  id: row.id,
  accountId: row.account_id,
  status: row.status,
  rawPayload: JSON.parse(row.raw_payload) as Record<string, unknown>,
  receivedAt: row.received_at,
});

// --- Store ---

export const createSqliteSignalStore = (dbPath: string): SignalStore => {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const migration = readFileSync(MIGRATION_PATH, "utf-8");
  db.exec(migration);

  return {
    async addWatched(input: AddWatchedInput): Promise<WatchedEntity> {
      const now = new Date().toISOString();
      db.prepare(`
        insert into watched_entities
          (id, startup_id, display_name, linkedin_url, linkedin_identifier, kind, priority, created_at)
        values (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.id,
        input.startupId ?? null,
        input.displayName,
        input.linkedinUrl ?? null,
        input.linkedinIdentifier ?? null,
        input.kind ?? "person",
        input.priority ?? "warm",
        now,
      );
      return {
        id: input.id,
        startupId: input.startupId,
        displayName: input.displayName,
        linkedinUrl: input.linkedinUrl,
        linkedinIdentifier: input.linkedinIdentifier,
        kind: input.kind ?? "person",
        priority: input.priority ?? "warm",
        createdAt: now,
      };
    },

    async getWatched(id: string): Promise<WatchedEntity | undefined> {
      const row = db.prepare(
        "select * from watched_entities where id = ?",
      ).get(id) as WatchedRow | undefined;
      return row ? mapWatched(row) : undefined;
    },

    async findWatchedByName(name: string): Promise<WatchedEntity[]> {
      const rows = db.prepare(
        "select * from watched_entities where lower(display_name) like lower(?)",
      ).all(`%${name}%`) as WatchedRow[];
      return rows.map(mapWatched);
    },

    async findWatchedByLinkedinIdentifier(identifier: string): Promise<WatchedEntity | undefined> {
      const row = db.prepare(
        "select * from watched_entities where linkedin_identifier = ?",
      ).get(identifier) as WatchedRow | undefined;
      return row ? mapWatched(row) : undefined;
    },

    async findWatchedByStartupId(startupId: string): Promise<WatchedEntity | undefined> {
      const row = db.prepare(
        "select * from watched_entities where startup_id = ?",
      ).get(startupId) as WatchedRow | undefined;
      return row ? mapWatched(row) : undefined;
    },

    async listWatched(priority?: WatchedEntityPriority): Promise<WatchedEntity[]> {
      const rows = priority
        ? (db.prepare(
          "select * from watched_entities where priority = ? order by created_at asc",
        ).all(priority) as WatchedRow[])
        : (db.prepare(
          "select * from watched_entities order by priority asc, created_at asc",
        ).all() as WatchedRow[]);
      return rows.map(mapWatched);
    },

    async updateWatchedPriority(id: string, priority: WatchedEntityPriority): Promise<void> {
      db.prepare(
        "update watched_entities set priority = ? where id = ?",
      ).run(priority, id);
    },

    async appendEvent(event: Omit<SignalEvent, "ingestedAt">): Promise<SignalEvent> {
      const ingestedAt = new Date().toISOString();
      db.prepare(`
        insert into signal_events
          (id, source, signal_type, watched_id, startup_id, unipile_account_id,
           emitted_at, ingested_at, url, raw_text, raw_payload, content_hash)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        event.id,
        event.source,
        event.signalType,
        event.watchedId ?? null,
        event.startupId ?? null,
        event.unipileAccountId ?? null,
        event.emittedAt ?? null,
        ingestedAt,
        event.url ?? null,
        event.rawText ?? null,
        JSON.stringify(event.rawPayload),
        event.contentHash,
      );
      return { ...event, ingestedAt };
    },

    async findEventByHash(
      source: string,
      signalType: string,
      contentHash: string,
    ): Promise<SignalEvent | undefined> {
      const row = db.prepare(
        "select * from signal_events where source = ? and signal_type = ? and content_hash = ?",
      ).get(source, signalType, contentHash) as EventRow | undefined;
      return row ? mapEvent(row) : undefined;
    },

    async listEvents(filter: ListEventsFilter): Promise<SignalEvent[]> {
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (filter.watchedId) {
        conditions.push("watched_id = ?");
        params.push(filter.watchedId);
      }
      if (filter.startupId) {
        conditions.push("startup_id = ?");
        params.push(filter.startupId);
      }
      if (filter.source) {
        conditions.push("source = ?");
        params.push(filter.source);
      }
      if (filter.signalType) {
        conditions.push("signal_type = ?");
        params.push(filter.signalType);
      }
      if (filter.sinceIso) {
        conditions.push("ingested_at >= ?");
        params.push(filter.sinceIso);
      }
      if (filter.textContains) {
        conditions.push("lower(raw_text) like lower(?)");
        params.push(`%${filter.textContains}%`);
      }

      const where = conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";
      const limit = filter.limit ?? 50;
      const rows = db.prepare(
        `select * from signal_events ${where} order by ingested_at desc limit ?`,
      ).all(...params, limit) as EventRow[];
      return rows.map(mapEvent);
    },

    async upsertUnipileAccount(input: UpsertUnipileAccountInput): Promise<UnipileAccount> {
      const now = new Date().toISOString();
      db.prepare(`
        insert into unipile_accounts (account_id, label, daily_quota, updated_at)
        values (?, ?, ?, ?)
        on conflict(account_id) do update set
          label = excluded.label,
          daily_quota = excluded.daily_quota,
          updated_at = excluded.updated_at
      `).run(
        input.accountId,
        input.label,
        input.dailyQuota ?? 60,
        now,
      );
      const row = db.prepare(
        "select * from unipile_accounts where account_id = ?",
      ).get(input.accountId) as UnipileAccountRow;
      return mapUnipileAccount(row);
    },

    async getUnipileAccount(accountId: string): Promise<UnipileAccount | undefined> {
      const row = db.prepare(
        "select * from unipile_accounts where account_id = ?",
      ).get(accountId) as UnipileAccountRow | undefined;
      return row ? mapUnipileAccount(row) : undefined;
    },

    async listUnipileAccounts(): Promise<UnipileAccount[]> {
      const rows = db.prepare(
        "select * from unipile_accounts order by label asc",
      ).all() as UnipileAccountRow[];
      return rows.map(mapUnipileAccount);
    },

    async setUnipileAccountState(
      accountId: string,
      state: UnipileAccountState,
      opts?: { frozenUntil?: string; killedReason?: string },
    ): Promise<void> {
      db.prepare(`
        update unipile_accounts set
          state = ?,
          frozen_until = ?,
          killed_reason = ?,
          updated_at = ?
        where account_id = ?
      `).run(
        state,
        opts?.frozenUntil ?? null,
        opts?.killedReason ?? null,
        new Date().toISOString(),
        accountId,
      );
    },

    async appendUnipileStatusEvent(
      event: Omit<UnipileAccountStatusEvent, "receivedAt">,
    ): Promise<void> {
      const id = event.id || randomUUID();
      db.prepare(`
        insert into unipile_account_status_events
          (id, account_id, status, raw_payload, received_at)
        values (?, ?, ?, ?, ?)
      `).run(
        id,
        event.accountId,
        event.status,
        JSON.stringify(event.rawPayload),
        new Date().toISOString(),
      );
    },

    async listUnipileStatusEvents(
      accountId: string,
      limit = 20,
    ): Promise<UnipileAccountStatusEvent[]> {
      const rows = db.prepare(`
        select * from unipile_account_status_events
        where account_id = ?
        order by received_at desc
        limit ?
      `).all(accountId, limit) as UnipileStatusEventRow[];
      return rows.map(mapStatusEvent);
    },
  };
};
