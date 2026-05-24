import { randomUUID } from "node:crypto";
import type { Db } from "./pgClient.js";
import type {
  CoreStore,
  SyncRun,
  DatasetFreshness,
  UserRecord,
} from "./coreStore.js";
import type {
  Startup,
  Investor,
  PortfolioCompany,
  Deal,
  Note,
  Meeting,
  BoardPack,
  PortfolioSignal,
  Event,
  Stage,
  Sector,
  SourceRef,
  SignalKind,
  NoteSensitivity,
  EventVisibility,
} from "../domain/entities.js";
import type { Role } from "../domain/identity.js";
import type { ClubTier } from "../domain/entities.js";

const now = (): string => new Date().toISOString();

// --- Row types (snake_case columns from Postgres) ---

type StartupRow = {
  id: string;
  name: string;
  sectors: Sector[];
  stage: string;
  country: string | null;
  description: string | null;
  visibility_tier: string;
  sources: SourceRef[];
};

type InvestorRow = {
  id: string;
  name: string;
  email: string | null;
  tier: string;
  sectors_of_interest: Sector[];
  portfolio_company_ids: string[];
};

type PortfolioCompanyRow = {
  id: string;
  startup_id: string;
  invested_at: string;
  ownership_pct: number | null;
  status: string;
};

type DealRow = {
  id: string;
  startup_id: string;
  owner_email: string;
  status: string;
  amount_eur: number | null;
  updated_at: string;
  visibility_tier: string;
};

type NoteRow = {
  id: string;
  startup_id: string | null;
  author_email: string;
  body: string;
  sensitivity: string;
  created_at: string;
  source: SourceRef;
};

type MeetingRow = {
  id: string;
  startup_id: string | null;
  attendees: string[];
  subject: string;
  occurred_at: string;
  source: SourceRef;
};

type BoardPackRow = {
  id: string;
  portfolio_company_id: string;
  title: string;
  drive_file_id: string;
  created_at: string;
};

type PortfolioSignalRow = {
  id: string;
  portfolio_company_id: string;
  kind: string;
  summary: string;
  detected_at: string;
  source_url: string | null;
  visibility_tier: string;
};

type EventRow = {
  id: string;
  title: string;
  starts_at: string;
  location: string | null;
  visibility: string;
  invited_investor_ids: string[];
};

type SyncRunRow = {
  id: string;
  dataset: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  records_upserted: number;
  error_message: string | null;
  cursor_after: string | null;
};

type FreshnessRow = {
  dataset: string;
  last_sync_at: string | null;
  records_total: number;
  healthy: boolean;
  updated_at: string;
};

type UserRow = {
  email: string;
  role: string;
  team: string | null;
  active: boolean;
};

// --- Mappers ---

const mapStartup = (r: StartupRow): Startup => ({
  id: r.id,
  name: r.name,
  sectors: r.sectors,
  stage: r.stage as Stage,
  country: r.country ?? undefined,
  description: r.description ?? undefined,
  visibilityTier: r.visibility_tier as Startup["visibilityTier"],
  sources: r.sources,
});

const mapInvestor = (r: InvestorRow): Investor => ({
  id: r.id,
  name: r.name,
  email: r.email ?? undefined,
  tier: r.tier as ClubTier,
  sectorsOfInterest: r.sectors_of_interest,
  portfolioCompanyIds: r.portfolio_company_ids,
});

const mapPortfolioCompany = (r: PortfolioCompanyRow): PortfolioCompany => ({
  id: r.id,
  startupId: r.startup_id,
  investedAt: r.invested_at,
  ownershipPct: r.ownership_pct ?? undefined,
  status: r.status as PortfolioCompany["status"],
});

const mapDeal = (r: DealRow): Deal => ({
  id: r.id,
  startupId: r.startup_id,
  ownerEmail: r.owner_email,
  status: r.status as Deal["status"],
  amountEur: r.amount_eur ?? undefined,
  updatedAt: r.updated_at,
  visibilityTier: r.visibility_tier as Deal["visibilityTier"],
});

const mapNote = (r: NoteRow): Note => ({
  id: r.id,
  startupId: r.startup_id ?? undefined,
  authorEmail: r.author_email,
  body: r.body,
  sensitivity: r.sensitivity as NoteSensitivity,
  createdAt: r.created_at,
  source: r.source,
});

const mapMeeting = (r: MeetingRow): Meeting => ({
  id: r.id,
  startupId: r.startup_id ?? undefined,
  attendees: r.attendees,
  subject: r.subject,
  occurredAt: r.occurred_at,
  source: r.source,
});

const mapBoardPack = (r: BoardPackRow): BoardPack => ({
  id: r.id,
  portfolioCompanyId: r.portfolio_company_id,
  title: r.title,
  driveFileId: r.drive_file_id,
  createdAt: r.created_at,
});

const mapPortfolioSignal = (r: PortfolioSignalRow): PortfolioSignal => ({
  id: r.id,
  portfolioCompanyId: r.portfolio_company_id,
  kind: r.kind as SignalKind,
  summary: r.summary,
  detectedAt: r.detected_at,
  sourceUrl: r.source_url ?? undefined,
  visibilityTier: r.visibility_tier as PortfolioSignal["visibilityTier"],
});

const mapEvent = (r: EventRow): Event => ({
  id: r.id,
  title: r.title,
  startsAt: r.starts_at,
  location: r.location ?? undefined,
  visibility: r.visibility as EventVisibility,
  invitedInvestorIds: r.invited_investor_ids,
});

const mapSyncRun = (r: SyncRunRow): SyncRun => ({
  id: r.id,
  dataset: r.dataset,
  startedAt: r.started_at,
  finishedAt: r.finished_at ?? undefined,
  status: r.status as SyncRun["status"],
  recordsUpserted: r.records_upserted,
  errorMessage: r.error_message ?? undefined,
  cursorAfter: r.cursor_after ?? undefined,
});

const mapFreshness = (r: FreshnessRow): DatasetFreshness => ({
  dataset: r.dataset,
  lastSyncAt: r.last_sync_at ?? undefined,
  recordsTotal: r.records_total,
  healthy: r.healthy,
  updatedAt: r.updated_at,
});

const mapUser = (r: UserRow): UserRecord => ({
  email: r.email,
  role: r.role as Role,
  team: r.team ?? undefined,
  active: r.active,
});

// --- Store factory ---

export const createPgCoreStore = async (db: Db): Promise<CoreStore> => {
  const findUserByEmail = async (
    email: string,
  ): Promise<UserRecord | undefined> => {
    const rows = await db<UserRow[]>`
      select * from users where email = ${email}
    `;
    return rows[0] ? mapUser(rows[0]) : undefined;
  };

  return {
    // --- Startups ---
    async upsertStartup(s: Startup): Promise<void> {
      const t = now();
      await db`
        insert into startups
          (id, name, sectors, stage, country, description, visibility_tier, sources, synced_at)
        values (
          ${s.id}, ${s.name}, ${db.json(s.sectors)}, ${s.stage},
          ${s.country ?? null}, ${s.description ?? null}, ${s.visibilityTier},
          ${db.json(s.sources)}, ${t}
        )
        on conflict (id) do update set
          name = excluded.name,
          sectors = excluded.sectors,
          stage = excluded.stage,
          country = excluded.country,
          description = excluded.description,
          visibility_tier = excluded.visibility_tier,
          sources = excluded.sources,
          synced_at = excluded.synced_at
      `;
    },

    async listStartups(): Promise<Startup[]> {
      const rows = await db<StartupRow[]>`select * from startups order by name`;
      return rows.map(mapStartup);
    },

    // --- Investors ---
    async upsertInvestor(inv: Investor): Promise<void> {
      const t = now();
      await db`
        insert into investor_records
          (id, name, email, tier, sectors_of_interest, portfolio_company_ids, created_at, updated_at)
        values (
          ${inv.id}, ${inv.name}, ${inv.email ?? null}, ${inv.tier},
          ${db.json(inv.sectorsOfInterest)}, ${db.json(inv.portfolioCompanyIds)},
          ${t}, ${t}
        )
        on conflict (id) do update set
          name = excluded.name,
          email = excluded.email,
          tier = excluded.tier,
          sectors_of_interest = excluded.sectors_of_interest,
          portfolio_company_ids = excluded.portfolio_company_ids,
          updated_at = excluded.updated_at
      `;
    },

    async getInvestorById(id: string): Promise<Investor | undefined> {
      const rows = await db<InvestorRow[]>`
        select id, name, email, tier, sectors_of_interest, portfolio_company_ids
        from investor_records where id = ${id}
      `;
      return rows[0] ? mapInvestor(rows[0]) : undefined;
    },

    async listInvestors(): Promise<Investor[]> {
      const rows = await db<InvestorRow[]>`
        select id, name, email, tier, sectors_of_interest, portfolio_company_ids
        from investor_records order by name
      `;
      return rows.map(mapInvestor);
    },

    // --- Portfolio companies ---
    async upsertPortfolioCompany(c: PortfolioCompany): Promise<void> {
      const t = now();
      await db`
        insert into portfolio_companies
          (id, startup_id, invested_at, ownership_pct, status, synced_at)
        values (
          ${c.id}, ${c.startupId}, ${c.investedAt},
          ${c.ownershipPct ?? null}, ${c.status}, ${t}
        )
        on conflict (id) do update set
          startup_id = excluded.startup_id,
          invested_at = excluded.invested_at,
          ownership_pct = excluded.ownership_pct,
          status = excluded.status,
          synced_at = excluded.synced_at
      `;
    },

    async getPortfolioCompany(id: string): Promise<PortfolioCompany | undefined> {
      const rows = await db<PortfolioCompanyRow[]>`
        select * from portfolio_companies where id = ${id}
      `;
      return rows[0] ? mapPortfolioCompany(rows[0]) : undefined;
    },

    async listPortfolioCompanies(): Promise<PortfolioCompany[]> {
      const rows = await db<PortfolioCompanyRow[]>`
        select * from portfolio_companies order by invested_at desc
      `;
      return rows.map(mapPortfolioCompany);
    },

    // --- Deals ---
    async upsertDeal(d: Deal): Promise<void> {
      const t = now();
      await db`
        insert into deals
          (id, startup_id, owner_email, status, amount_eur, updated_at, visibility_tier, synced_at)
        values (
          ${d.id}, ${d.startupId}, ${d.ownerEmail}, ${d.status},
          ${d.amountEur ?? null}, ${d.updatedAt}, ${d.visibilityTier}, ${t}
        )
        on conflict (id) do update set
          startup_id = excluded.startup_id,
          owner_email = excluded.owner_email,
          status = excluded.status,
          amount_eur = excluded.amount_eur,
          updated_at = excluded.updated_at,
          visibility_tier = excluded.visibility_tier,
          synced_at = excluded.synced_at
      `;
    },

    async listDealsForStartup(startupId: string): Promise<Deal[]> {
      const rows = await db<DealRow[]>`
        select * from deals where startup_id = ${startupId} order by updated_at desc
      `;
      return rows.map(mapDeal);
    },

    // --- Notes ---
    async upsertNote(n: Note): Promise<void> {
      const t = now();
      await db`
        insert into notes
          (id, startup_id, author_email, body, sensitivity, created_at, source, synced_at)
        values (
          ${n.id}, ${n.startupId ?? null}, ${n.authorEmail}, ${n.body},
          ${n.sensitivity}, ${n.createdAt}, ${db.json(n.source)}, ${t}
        )
        on conflict (id) do update set
          startup_id = excluded.startup_id,
          author_email = excluded.author_email,
          body = excluded.body,
          sensitivity = excluded.sensitivity,
          created_at = excluded.created_at,
          source = excluded.source,
          synced_at = excluded.synced_at
      `;
    },

    async listNotesForStartup(startupId: string): Promise<Note[]> {
      const rows = await db<NoteRow[]>`
        select * from notes where startup_id = ${startupId} order by created_at desc
      `;
      return rows.map(mapNote);
    },

    // --- Meetings ---
    async upsertMeeting(m: Meeting): Promise<void> {
      const t = now();
      await db`
        insert into meetings
          (id, startup_id, attendees, subject, occurred_at, source, synced_at)
        values (
          ${m.id}, ${m.startupId ?? null}, ${db.json(m.attendees)},
          ${m.subject}, ${m.occurredAt}, ${db.json(m.source)}, ${t}
        )
        on conflict (id) do update set
          startup_id = excluded.startup_id,
          attendees = excluded.attendees,
          subject = excluded.subject,
          occurred_at = excluded.occurred_at,
          source = excluded.source,
          synced_at = excluded.synced_at
      `;
    },

    async listMeetingsForStartup(startupId: string): Promise<Meeting[]> {
      const rows = await db<MeetingRow[]>`
        select * from meetings where startup_id = ${startupId} order by occurred_at desc
      `;
      return rows.map(mapMeeting);
    },

    // --- Board packs ---
    async upsertBoardPack(p: BoardPack): Promise<void> {
      const t = now();
      await db`
        insert into board_packs
          (id, portfolio_company_id, title, drive_file_id, created_at, synced_at)
        values (
          ${p.id}, ${p.portfolioCompanyId}, ${p.title}, ${p.driveFileId}, ${p.createdAt}, ${t}
        )
        on conflict (id) do update set
          portfolio_company_id = excluded.portfolio_company_id,
          title = excluded.title,
          drive_file_id = excluded.drive_file_id,
          created_at = excluded.created_at,
          synced_at = excluded.synced_at
      `;
    },

    async listBoardPacksForCompany(portfolioCompanyId: string): Promise<BoardPack[]> {
      const rows = await db<BoardPackRow[]>`
        select * from board_packs
        where portfolio_company_id = ${portfolioCompanyId}
        order by created_at desc
      `;
      return rows.map(mapBoardPack);
    },

    // --- Portfolio signals ---
    async upsertPortfolioSignal(s: PortfolioSignal): Promise<void> {
      const t = now();
      await db`
        insert into portfolio_signals
          (id, portfolio_company_id, kind, summary, detected_at, source_url, visibility_tier, synced_at)
        values (
          ${s.id}, ${s.portfolioCompanyId}, ${s.kind}, ${s.summary},
          ${s.detectedAt}, ${s.sourceUrl ?? null}, ${s.visibilityTier}, ${t}
        )
        on conflict (id) do update set
          portfolio_company_id = excluded.portfolio_company_id,
          kind = excluded.kind,
          summary = excluded.summary,
          detected_at = excluded.detected_at,
          source_url = excluded.source_url,
          visibility_tier = excluded.visibility_tier,
          synced_at = excluded.synced_at
      `;
    },

    async listPortfolioSignals(
      options?: { portfolioCompanyId?: string; sinceDays?: number },
    ): Promise<PortfolioSignal[]> {
      const cutoff = options?.sinceDays
        ? new Date(Date.now() - options.sinceDays * 86_400_000).toISOString()
        : undefined;
      const companyId = options?.portfolioCompanyId;

      let rows: PortfolioSignalRow[];

      if (companyId && cutoff) {
        rows = await db<PortfolioSignalRow[]>`
          select * from portfolio_signals
          where portfolio_company_id = ${companyId} and detected_at >= ${cutoff}
          order by detected_at desc
        `;
      } else if (companyId) {
        rows = await db<PortfolioSignalRow[]>`
          select * from portfolio_signals
          where portfolio_company_id = ${companyId}
          order by detected_at desc
        `;
      } else if (cutoff) {
        rows = await db<PortfolioSignalRow[]>`
          select * from portfolio_signals where detected_at >= ${cutoff}
          order by detected_at desc
        `;
      } else {
        rows = await db<PortfolioSignalRow[]>`
          select * from portfolio_signals order by detected_at desc
        `;
      }

      return rows.map(mapPortfolioSignal);
    },

    // --- Events ---
    async upsertEvent(e: Event): Promise<void> {
      const t = now();
      await db`
        insert into events
          (id, title, starts_at, location, visibility, invited_investor_ids, synced_at)
        values (
          ${e.id}, ${e.title}, ${e.startsAt}, ${e.location ?? null},
          ${e.visibility}, ${db.json(e.invitedInvestorIds)}, ${t}
        )
        on conflict (id) do update set
          title = excluded.title,
          starts_at = excluded.starts_at,
          location = excluded.location,
          visibility = excluded.visibility,
          invited_investor_ids = excluded.invited_investor_ids,
          synced_at = excluded.synced_at
      `;
    },

    async listUpcomingEvents(): Promise<Event[]> {
      const cutoff = new Date().toISOString();
      const rows = await db<EventRow[]>`
        select * from events where starts_at >= ${cutoff} order by starts_at asc
      `;
      return rows.map(mapEvent);
    },

    // --- Sync management ---
    async startSyncRun(dataset: string): Promise<SyncRun> {
      const id = randomUUID();
      const startedAt = now();
      await db`
        insert into sync_runs (id, dataset, started_at, status)
        values (${id}, ${dataset}, ${startedAt}, 'running')
      `;
      return {
        id,
        dataset,
        startedAt,
        finishedAt: undefined,
        status: "running",
        recordsUpserted: 0,
        errorMessage: undefined,
        cursorAfter: undefined,
      };
    },

    async finishSyncRun(
      id: string,
      options: { recordsUpserted: number; cursorAfter?: string },
    ): Promise<void> {
      const finishedAt = now();
      await db`
        update sync_runs set
          finished_at = ${finishedAt},
          status = 'success',
          records_upserted = ${options.recordsUpserted},
          cursor_after = ${options.cursorAfter ?? null}
        where id = ${id}
      `;
      // Refresh materialized freshness
      const [run] = await db<{ dataset: string }[]>`
        select dataset from sync_runs where id = ${id}
      `;
      if (run) await refreshFreshnessInternal(db, run.dataset);
    },

    async failSyncRun(id: string, errorMessage: string): Promise<void> {
      const finishedAt = now();
      await db`
        update sync_runs set
          finished_at = ${finishedAt},
          status = 'failed',
          error_message = ${errorMessage}
        where id = ${id}
      `;
    },

    async getLatestSyncRun(dataset: string): Promise<SyncRun | undefined> {
      const rows = await db<SyncRunRow[]>`
        select * from sync_runs
        where dataset = ${dataset}
        order by started_at desc
        limit 1
      `;
      return rows[0] ? mapSyncRun(rows[0]) : undefined;
    },

    async failAllRunningSyncRuns(errorMessage: string): Promise<number> {
      const finishedAt = now();
      const rows = await db<{ id: string }[]>`
        update sync_runs set
          finished_at = ${finishedAt},
          status = 'failed',
          error_message = ${errorMessage}
        where status = 'running'
        returning id
      `;
      return rows.length;
    },

    async hasRecentRunningSyncRun(withinMinutes: number): Promise<boolean> {
      const cutoff = new Date(Date.now() - withinMinutes * 60_000).toISOString();
      const rows = await db<{ id: string }[]>`
        select id from sync_runs
        where status = 'running' and started_at >= ${cutoff}
        limit 1
      `;
      return rows.length > 0;
    },

    async ping(): Promise<void> {
      await db`select 1`;
    },

    // --- Freshness ---
    async getFreshness(dataset: string): Promise<DatasetFreshness> {
      const rows = await db<FreshnessRow[]>`
        select * from dataset_freshness where dataset = ${dataset}
      `;
      return rows[0]
        ? mapFreshness(rows[0])
        : { dataset, lastSyncAt: undefined, recordsTotal: 0, healthy: false, updatedAt: now() };
    },

    async listFreshness(): Promise<DatasetFreshness[]> {
      const rows = await db<FreshnessRow[]>`
        select * from dataset_freshness order by dataset
      `;
      return rows.map(mapFreshness);
    },

    // --- Users ---
    async upsertUser(user: UserRecord): Promise<void> {
      const t = now();
      await db`
        insert into users (email, role, team, active, created_at, updated_at)
        values (${user.email}, ${user.role}, ${user.team ?? null}, ${user.active}, ${t}, ${t})
        on conflict (email) do update set
          role = excluded.role,
          team = excluded.team,
          active = excluded.active,
          updated_at = excluded.updated_at
      `;
    },

    async insertUserIfAbsent(user: UserRecord): Promise<boolean> {
      const t = now();
      const rows = await db<{ email: string }[]>`
        insert into users (email, role, team, active, created_at, updated_at)
        values (${user.email}, ${user.role}, ${user.team ?? null}, ${user.active}, ${t}, ${t})
        on conflict (email) do nothing
        returning email
      `;
      return rows.length > 0;
    },

    findUserByEmail,

    async getUserByEmail(email: string): Promise<UserRecord | undefined> {
      const user = await findUserByEmail(email);
      return user?.active ? user : undefined;
    },

    async listUsers(): Promise<UserRecord[]> {
      const rows = await db<UserRow[]>`select * from users order by email`;
      return rows.map(mapUser);
    },
  };
};

async function refreshFreshnessInternal(db: Db, dataset: string): Promise<void> {
  const table = datasetToTable(dataset);
  if (!table) return;
  const t = now();
  const countRows = await db<{ count: string }[]>`
    select count(*)::text as count from ${db(table)}
  `;
  const total = parseInt(countRows[0]?.count ?? "0", 10);
  await db`
    insert into dataset_freshness (dataset, last_sync_at, records_total, healthy, updated_at)
    values (${dataset}, ${t}, ${total}, true, ${t})
    on conflict (dataset) do update set
      last_sync_at = excluded.last_sync_at,
      records_total = excluded.records_total,
      healthy = excluded.healthy,
      updated_at = excluded.updated_at
  `;
}

const DATASET_TABLE_MAP: Record<string, string> = {
  "hubspot.startups": "startups",
  "hubspot.deals": "deals",
  "hubspot.notes": "notes",
  "hubspot.meetings": "meetings",
  "monday.portfolio": "portfolio_companies",
  "monday.signals": "portfolio_signals",
  "monday.events": "events",
  "drive.boardPacks": "board_packs",
};

const datasetToTable = (dataset: string): string | undefined =>
  DATASET_TABLE_MAP[dataset];
