import { randomBytes, randomUUID } from "node:crypto";
import { normalizeEmail } from "../auth/email.js";
import { sha256Hex } from "../auth/mcpOauth/pkce.js";
import type { SocietyMember } from "../domain/society.js";
import type { Db } from "./pgClient.js";
import type {
  CoreStore,
  GrepIndexMetaHit,
  GrepNotesParams,
  IndexedNoteChunkRecord,
  SyncRun,
  DatasetFreshness,
  UserRecord,
  McpOAuthClientRecord,
  McpOAuthPendingAuthorize,
  McpOAuthAuthorizationCode,
  McpOAuthTokenRecord,
  McpOAuthStore,
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
import type {
  EnqueueSyncJobInput,
  HubspotCompanySyncState,
  SyncQueueJob,
  SyncQueueStats,
} from "../domain/syncQueue.js";
import type {
  CrmMemorySemanticCard,
  KnowledgeChunkSearchHit,
  KnowledgeChunkSearchParams,
  KnowledgeIndexChunkInput,
} from "../domain/crmMemory.js";
import { noteNeedsSemanticIndex } from "../services/crmMemory/contentHash.js";
import { MIN_SEMANTIC_INDEX_BODY_LENGTH } from "../services/crmMemory/indexEligibility.js";
import { planSemanticIndexOnNoteUpsert } from "../services/crmMemory/indexInvalidation.js";
import { buildIlikePattern, escapeIlikePattern } from "../services/crmMemory/grepTerms.js";
import { buildHubspotActivityDedupeKey } from "../domain/syncQueue.js";

const now = (): string => new Date().toISOString();

const toVectorLiteral = (embedding: number[]): string =>
  `[${embedding.join(",")}]`;

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
  semantic_index_hash: string | null;
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
  mime_type: string | null;
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

type SyncQueueRow = {
  id: string;
  dataset: string;
  entity_kind: string;
  entity_id: string;
  reason: string;
  priority: number;
  status: string;
  attempts: number;
  max_attempts: number;
  scheduled_at: string;
  locked_at: string | null;
  locked_by: string | null;
  last_error: string | null;
  dedupe_key: string;
  trigger_context: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type HubspotCompanySyncStateRow = {
  company_id: string;
  last_activity_sync_at: string | null;
  last_hubspot_modified_at: string | null;
  notes_count: number;
  deals_count: number;
  meetings_count: number;
  notes_fingerprint: string | null;
  updated_at: string;
};

type UserRow = {
  email: string;
  role: string;
  team: string | null;
  active: boolean;
};

type SocietyMemberRow = {
  member_id: string;
  email: string;
  kind: string;
  tier: string;
  investor_id: string | null;
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
  mimeType: r.mime_type ?? undefined,
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

const mapTriggerContext = (
  value: Record<string, unknown> | null,
): SyncQueueJob["triggerContext"] => {
  if (!value) return undefined;
  const hubspotModifiedAt = value["hubspotModifiedAt"];
  if (typeof hubspotModifiedAt !== "string") return undefined;
  return { hubspotModifiedAt };
};

const mapSyncQueueJob = (r: SyncQueueRow): SyncQueueJob => ({
  id: r.id,
  dataset: r.dataset,
  entityKind: r.entity_kind,
  entityId: r.entity_id,
  reason: r.reason as SyncQueueJob["reason"],
  priority: r.priority,
  status: r.status as SyncQueueJob["status"],
  attempts: r.attempts,
  maxAttempts: r.max_attempts,
  scheduledAt: r.scheduled_at,
  lockedAt: r.locked_at ?? undefined,
  lockedBy: r.locked_by ?? undefined,
  lastError: r.last_error ?? undefined,
  dedupeKey: r.dedupe_key,
  triggerContext: mapTriggerContext(r.trigger_context),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const mapHubspotCompanySyncState = (
  r: HubspotCompanySyncStateRow,
): HubspotCompanySyncState => ({
  companyId: r.company_id,
  lastActivitySyncAt: r.last_activity_sync_at ?? undefined,
  lastHubspotModifiedAt: r.last_hubspot_modified_at ?? undefined,
  notesCount: r.notes_count,
  dealsCount: r.deals_count,
  meetingsCount: r.meetings_count,
  notesFingerprint: r.notes_fingerprint ?? undefined,
  updatedAt: r.updated_at,
});

const mapUser = (r: UserRow): UserRecord => ({
  email: r.email,
  role: r.role as Role,
  team: r.team ?? undefined,
  active: r.active,
});

const mapSocietyMember = (r: SocietyMemberRow): SocietyMember => ({
  memberId: r.member_id,
  email: r.email,
  kind: r.kind as SocietyMember["kind"],
  tier: r.tier,
  investorId: r.investor_id ?? undefined,
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

    async insertStartupIfAbsent(s: Startup): Promise<boolean> {
      const t = now();
      const rows = await db<{ id: string }[]>`
        insert into startups
          (id, name, sectors, stage, country, description, visibility_tier, sources, synced_at)
        values (
          ${s.id}, ${s.name}, ${db.json(s.sectors)}, ${s.stage},
          ${s.country ?? null}, ${s.description ?? null}, ${s.visibilityTier},
          ${db.json(s.sources)}, ${t}
        )
        on conflict (id) do nothing
        returning id
      `;
      return rows.length > 0;
    },

    async listStartupIdsWithNotesMissingDirectoryEntry(): Promise<string[]> {
      const rows = await db<{ startup_id: string }[]>`
        select distinct n.startup_id
        from notes n
        left join startups s on s.id = n.startup_id
        where n.startup_id is not null
          and s.id is null
        order by n.startup_id
      `;
      return rows.map((row) => row.startup_id);
    },

    async listStartups(): Promise<Startup[]> {
      const rows = await db<StartupRow[]>`select * from startups order by name`;
      return rows.map(mapStartup);
    },

    async browseStartups(query): Promise<import("../domain/society.js").StartupBrowsePage> {
      const limit = Math.max(1, Math.min(100, Math.floor(query.limit)));
      const fetchLimit = limit + 1;

      let cursorName: string | undefined;
      let cursorId: string | undefined;
      if (query.cursor) {
        const cursorRows = await db<{ name: string; id: string }[]>`
          select name, id from startups where id = ${query.cursor}
        `;
        const cursorRow = cursorRows[0];
        if (!cursorRow) {
          return { items: [], nextCursor: undefined, hasMore: false };
        }
        cursorName = cursorRow.name;
        cursorId = cursorRow.id;
      }

      const qPattern =
        query.q !== undefined && query.q.trim().length > 0
          ? `%${query.q.trim().replace(/[%_\\]/g, "\\$&")}%`
          : undefined;
      const sector = query.sector?.trim().toLowerCase();

      const rows = await db<StartupRow[]>`
        select *
        from startups
        where
          (${query.includeInternalOnly} or visibility_tier <> 'internal_only')
          and (${qPattern ?? null}::text is null or name ilike ${qPattern ?? null})
          and (
            ${sector ?? null}::text is null
            or exists (
              select 1
              from jsonb_array_elements_text(sectors) as sector_value
              where lower(sector_value) = ${sector ?? null}
            )
          )
          and (
            ${cursorName ?? null}::text is null
            or name > ${cursorName ?? null}
            or (name = ${cursorName ?? null} and id > ${cursorId ?? null})
          )
        order by name asc, id asc
        limit ${fetchLimit}
      `;

      const hasMore = rows.length > limit;
      const pageRows = hasMore ? rows.slice(0, limit) : rows;
      const items = pageRows.map(mapStartup);
      const last = pageRows[pageRows.length - 1];

      return {
        items,
        nextCursor: hasMore && last ? last.id : undefined,
        hasMore,
      };
    },

    async getStartupById(id: string): Promise<Startup | undefined> {
      const rows = await db<StartupRow[]>`
        select * from startups where id = ${id}
      `;
      return rows[0] ? mapStartup(rows[0]) : undefined;
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
      const existingRows = await db<NoteRow[]>`
        select * from notes where id = ${n.id}
      `;
      const existing = existingRows[0] ? mapNote(existingRows[0]) : undefined;
      const plan = planSemanticIndexOnNoteUpsert(existing, n);

      if (plan.shouldDeleteChunks) {
        await db`
          delete from knowledge_index_chunks
          where source_kind = 'hubspot_note' and source_id = ${n.id}
        `;
      }

      const t = now();
      const semanticHashForInsert = plan.keepExistingHash
        ? null
        : plan.nextSemanticIndexHash;

      await db`
        insert into notes
          (id, startup_id, author_email, body, sensitivity, created_at, source, synced_at, semantic_index_hash)
        values (
          ${n.id}, ${n.startupId ?? null}, ${n.authorEmail}, ${n.body},
          ${n.sensitivity}, ${n.createdAt}, ${db.json(n.source)}, ${t},
          ${semanticHashForInsert}
        )
        on conflict (id) do update set
          startup_id = excluded.startup_id,
          author_email = excluded.author_email,
          body = excluded.body,
          sensitivity = excluded.sensitivity,
          created_at = excluded.created_at,
          source = excluded.source,
          synced_at = excluded.synced_at,
          semantic_index_hash = case
            when ${plan.keepExistingHash} then notes.semantic_index_hash
            else ${plan.nextSemanticIndexHash}
          end
      `;
    },

    async getNoteById(id: string): Promise<Note | undefined> {
      const rows = await db<NoteRow[]>`
        select * from notes where id = ${id}
      `;
      return rows[0] ? mapNote(rows[0]) : undefined;
    },

    async listNotesPendingIndex(limit: number): Promise<Note[]> {
      const scanLimit = Math.max(limit * 5, limit);
      const rows = await db<NoteRow[]>`
        select * from notes
        where startup_id is not null
          and length(trim(body)) >= ${MIN_SEMANTIC_INDEX_BODY_LENGTH}
          and (
            semantic_index_hash is null
            or semantic_index_hash not like 'skip:%'
          )
        order by synced_at desc nulls last, created_at desc
        limit ${scanLimit}
      `;

      return rows
        .filter((row) =>
          noteNeedsSemanticIndex({
            body: row.body,
            startupId: row.startup_id ?? undefined,
            semanticIndexHash: row.semantic_index_hash,
          }),
        )
        .slice(0, limit)
        .map(mapNote);
    },

    async markNoteIndexed(noteId: string, contentHash: string): Promise<void> {
      await db`
        update notes
        set semantic_index_hash = ${contentHash}
        where id = ${noteId}
      `;
    },

    async listNotesForStartup(startupId: string): Promise<Note[]> {
      const rows = await db<NoteRow[]>`
        select * from notes where startup_id = ${startupId} order by created_at desc
      `;
      return rows.map(mapNote);
    },

    async grepNotes(params: GrepNotesParams) {
      if (params.terms.length === 0 || params.startupIds.length === 0) {
        return [];
      }

      const sinceCutoff =
        params.sinceDays !== undefined
          ? new Date(
              Date.now() - params.sinceDays * 86_400_000,
            ).toISOString()
          : undefined;
      const authorPattern =
        params.authorEmail !== undefined
          ? `%${escapeIlikePattern(params.authorEmail.trim().toLowerCase())}%`
          : undefined;

      let termCondition = db`true`;
      if (params.matchMode === "all") {
        for (const term of params.terms) {
          termCondition = db`${termCondition} and body ilike ${buildIlikePattern(term)}`;
        }
      } else {
        termCondition = db`false`;
        for (const term of params.terms) {
          termCondition = db`${termCondition} or body ilike ${buildIlikePattern(term)}`;
        }
      }

      type GrepRow = NoteRow & { startup_name: string | null };

      const rows = await db<GrepRow[]>`
        select n.*, s.name as startup_name
        from notes n
        left join startups s on s.id = n.startup_id
        where n.startup_id = any(${params.startupIds})
          and ${termCondition}
          ${authorPattern !== undefined ? db`and lower(n.author_email) like ${authorPattern}` : db``}
          ${sinceCutoff !== undefined ? db`and n.created_at >= ${sinceCutoff}` : db``}
        order by n.created_at desc
        limit ${params.limit}
      `;

      return rows.map((row) => ({
        note: mapNote(row),
        startupName: row.startup_name ?? undefined,
      }));
    },

    async listKnowledgeChunksForNote(noteId: string) {
      type ChunkRow = {
        id: string;
        source_id: string;
        startup_id: string;
        chunk_kind: string;
        chunk_text: string;
        author_email: string;
        note_created_at: string;
        meta: CrmMemorySemanticCard;
      };

      const rows = await db<ChunkRow[]>`
        select
          id,
          source_id,
          startup_id,
          chunk_kind,
          chunk_text,
          author_email,
          note_created_at,
          meta
        from knowledge_index_chunks
        where source_kind = 'hubspot_note'
          and source_id = ${noteId}
          and embedding is not null
        order by chunk_idx asc
      `;

      return rows.map((row) => ({
        chunkId: row.id,
        noteId: row.source_id,
        startupId: row.startup_id,
        chunkKind: row.chunk_kind as IndexedNoteChunkRecord["chunkKind"],
        chunkText: row.chunk_text,
        authorEmail: row.author_email,
        noteCreatedAt: row.note_created_at,
        meta: row.meta,
      }));
    },

    async grepKnowledgeIndexMeta(params: GrepNotesParams) {
      if (params.terms.length === 0 || params.startupIds.length === 0) {
        return [];
      }

      const sinceCutoff =
        params.sinceDays !== undefined
          ? new Date(
              Date.now() - params.sinceDays * 86_400_000,
            ).toISOString()
          : undefined;
      const authorPattern =
        params.authorEmail !== undefined
          ? `%${escapeIlikePattern(params.authorEmail.trim().toLowerCase())}%`
          : undefined;

      type MetaRow = {
        source_id: string;
        startup_id: string;
        chunk_kind: string;
        chunk_text: string;
        author_email: string;
        note_created_at: string;
        matched_field: GrepIndexMetaHit["matchedField"];
        matched_term: string;
      };

      const hits: MetaRow[] = [];

      for (const term of params.terms) {
        const pattern = buildIlikePattern(term);
        const rows = await db<MetaRow[]>`
          select
            source_id,
            startup_id,
            chunk_kind,
            chunk_text,
            author_email,
            note_created_at,
            case
              when exists (
                select 1
                from jsonb_array_elements_text(meta->'competitorNames') cn
                where cn ilike ${pattern}
              ) then 'competitorNames'
              when exists (
                select 1
                from jsonb_array_elements_text(meta->'markets') mk
                where mk ilike ${pattern}
              ) then 'markets'
              else 'chunkText'
            end as matched_field,
            ${term} as matched_term
          from knowledge_index_chunks
          where source_kind = 'hubspot_note'
            and embedding is not null
            and startup_id = any(${params.startupIds})
            ${authorPattern !== undefined ? db`and lower(author_email) like ${authorPattern}` : db``}
            ${sinceCutoff !== undefined ? db`and note_created_at >= ${sinceCutoff}` : db``}
            and (
              chunk_text ilike ${pattern}
              or exists (
                select 1
                from jsonb_array_elements_text(meta->'competitorNames') cn
                where cn ilike ${pattern}
              )
              or exists (
                select 1
                from jsonb_array_elements_text(meta->'markets') mk
                where mk ilike ${pattern}
              )
            )
          order by note_created_at desc
          limit ${params.limit}
        `;
        hits.push(...rows);
      }

      if (params.matchMode === "all" && params.terms.length > 1) {
        const byNote = new Map<string, Set<string>>();
        for (const hit of hits) {
          const matched = byNote.get(hit.source_id) ?? new Set<string>();
          matched.add(hit.matched_term.toLowerCase());
          byNote.set(hit.source_id, matched);
        }
        const required = new Set(params.terms.map((term) => term.toLowerCase()));
        const filtered = hits.filter((hit) => {
          const matched = byNote.get(hit.source_id);
          if (!matched) return false;
          for (const term of required) {
            if (!matched.has(term)) return false;
          }
          return true;
        });
        return filtered.slice(0, params.limit).map((row) => ({
          noteId: row.source_id,
          startupId: row.startup_id,
          authorEmail: row.author_email,
          noteCreatedAt: row.note_created_at,
          chunkKind: row.chunk_kind as GrepIndexMetaHit["chunkKind"],
          chunkText: row.chunk_text,
          matchedField: row.matched_field,
          matchedTerm: row.matched_term,
        }));
      }

      const deduped = new Map<string, MetaRow>();
      for (const hit of hits) {
        const key = `${hit.source_id}:${hit.matched_field}:${hit.matched_term.toLowerCase()}`;
        if (!deduped.has(key)) {
          deduped.set(key, hit);
        }
      }

      return [...deduped.values()]
        .slice(0, params.limit)
        .map((row) => ({
          noteId: row.source_id,
          startupId: row.startup_id,
          authorEmail: row.author_email,
          noteCreatedAt: row.note_created_at,
          chunkKind: row.chunk_kind as GrepIndexMetaHit["chunkKind"],
          chunkText: row.chunk_text,
          matchedField: row.matched_field,
          matchedTerm: row.matched_term,
        }));
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
          (id, portfolio_company_id, title, drive_file_id, created_at, mime_type, synced_at)
        values (
          ${p.id}, ${p.portfolioCompanyId}, ${p.title}, ${p.driveFileId}, ${p.createdAt}, ${p.mimeType ?? null}, ${t}
        )
        on conflict (id) do update set
          portfolio_company_id = excluded.portfolio_company_id,
          title = excluded.title,
          drive_file_id = excluded.drive_file_id,
          created_at = excluded.created_at,
          mime_type = excluded.mime_type,
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

    async refreshDatasetFreshness(dataset: string): Promise<void> {
      await refreshFreshnessInternal(db, dataset);
    },

    async enqueueSyncJob(input: EnqueueSyncJobInput): Promise<"created" | "deduped"> {
      const t = now();
      const id = randomUUID();
      const dedupeKey =
        input.entityKind === "startup" && input.dataset === "hubspot.activity"
          ? buildHubspotActivityDedupeKey(input.entityId)
          : `${input.dataset}:${input.entityKind}:${input.entityId}`;
      const scheduledAt = input.scheduledAt ?? t;
      const priority = input.priority ?? 100;
      const maxAttempts = input.maxAttempts ?? 5;

      const existing = await db<{ id: string }[]>`
        select id from sync_queue
        where dedupe_key = ${dedupeKey}
          and status in ('pending', 'running')
        limit 1
      `;
      if (existing.length > 0) return "deduped";

      await db`
        insert into sync_queue (
          id, dataset, entity_kind, entity_id, reason, priority, status,
          attempts, max_attempts, scheduled_at, dedupe_key, trigger_context,
          created_at, updated_at
        )
        values (
          ${id}, ${input.dataset}, ${input.entityKind}, ${input.entityId},
          ${input.reason}, ${priority}, 'pending', 0, ${maxAttempts},
          ${scheduledAt}, ${dedupeKey},
          ${input.triggerContext ? db.json(input.triggerContext) : null},
          ${t}, ${t}
        )
      `;
      return "created";
    },

    async claimSyncJobs(
      dataset: string,
      limit: number,
      workerId: string,
    ): Promise<SyncQueueJob[]> {
      const t = now();
      const rows = await db<SyncQueueRow[]>`
        update sync_queue
        set
          status = 'running',
          locked_at = ${t},
          locked_by = ${workerId},
          attempts = attempts + 1,
          updated_at = ${t}
        where id in (
          select id from sync_queue
          where dataset = ${dataset}
            and status = 'pending'
            and scheduled_at <= ${t}
          order by priority asc, scheduled_at asc
          limit ${limit}
          for update skip locked
        )
        returning *
      `;
      return rows.map(mapSyncQueueJob);
    },

    async completeSyncJob(id: string): Promise<void> {
      const t = now();
      await db`
        update sync_queue
        set status = 'done', locked_at = null, locked_by = null, updated_at = ${t}
        where id = ${id}
      `;
    },

    async failSyncJob(
      id: string,
      errorMessage: string,
      retryDelayMs: number,
    ): Promise<void> {
      const t = now();
      const retryAt = new Date(Date.now() + retryDelayMs).toISOString();
      await db`
        update sync_queue
        set
          status = case
            when attempts >= max_attempts then 'dead'
            else 'pending'
          end,
          scheduled_at = case
            when attempts >= max_attempts then scheduled_at
            else ${retryAt}
          end,
          last_error = ${errorMessage.slice(0, 2000)},
          locked_at = null,
          locked_by = null,
          updated_at = ${t}
        where id = ${id}
      `;
    },

    async getSyncQueueStats(dataset: string): Promise<SyncQueueStats> {
      const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
      const rows = await db<
        { status: string; count: string }[]
      >`
        select status, count(*)::text as count
        from sync_queue
        where dataset = ${dataset}
        group by status
      `;
      const doneRows = await db<{ count: string }[]>`
        select count(*)::text as count
        from sync_queue
        where dataset = ${dataset}
          and status = 'done'
          and updated_at >= ${since}
      `;
      const byStatus = new Map(rows.map((r) => [r.status, parseInt(r.count, 10)]));
      return {
        pending: byStatus.get("pending") ?? 0,
        running: byStatus.get("running") ?? 0,
        failed: byStatus.get("failed") ?? 0,
        dead: byStatus.get("dead") ?? 0,
        doneLast24h: parseInt(doneRows[0]?.count ?? "0", 10),
      };
    },

    async releaseStaleSyncJobs(staleAfterMs: number): Promise<number> {
      const cutoff = new Date(Date.now() - staleAfterMs).toISOString();
      const t = now();
      const rows = await db<{ id: string }[]>`
        update sync_queue
        set
          status = 'pending',
          locked_at = null,
          locked_by = null,
          updated_at = ${t}
        where status = 'running' and locked_at < ${cutoff}
        returning id
      `;
      return rows.length;
    },

    async upsertHubspotCompanySyncState(
      state: HubspotCompanySyncState,
    ): Promise<void> {
      const t = now();
      await db`
        insert into hubspot_company_sync_state (
          company_id, last_activity_sync_at, last_hubspot_modified_at,
          notes_count, deals_count, meetings_count, notes_fingerprint, updated_at
        )
        values (
          ${state.companyId},
          ${state.lastActivitySyncAt ?? null},
          ${state.lastHubspotModifiedAt ?? null},
          ${state.notesCount},
          ${state.dealsCount},
          ${state.meetingsCount},
          ${state.notesFingerprint ?? null},
          ${t}
        )
        on conflict (company_id) do update set
          last_activity_sync_at = excluded.last_activity_sync_at,
          last_hubspot_modified_at = excluded.last_hubspot_modified_at,
          notes_count = excluded.notes_count,
          deals_count = excluded.deals_count,
          meetings_count = excluded.meetings_count,
          notes_fingerprint = excluded.notes_fingerprint,
          updated_at = excluded.updated_at
      `;
    },

    async getHubspotCompanySyncState(
      companyId: string,
    ): Promise<HubspotCompanySyncState | undefined> {
      const rows = await db<HubspotCompanySyncStateRow[]>`
        select * from hubspot_company_sync_state where company_id = ${companyId}
      `;
      return rows[0] ? mapHubspotCompanySyncState(rows[0]) : undefined;
    },

    async listHubspotCompanySyncStatesMissingActivity(): Promise<string[]> {
      const rows = await db<{ id: string }[]>`
        select s.id
        from startups s
        left join hubspot_company_sync_state h on h.company_id = s.id
        where h.company_id is null
        order by s.name
      `;
      return rows.map((r) => r.id);
    },

    async getSyncCursor(
      dataset: string,
      cursorKey = "default",
    ): Promise<string | undefined> {
      const rows = await db<{ cursor_value: string }[]>`
        select cursor_value from sync_cursors
        where dataset = ${dataset} and cursor_key = ${cursorKey}
      `;
      return rows[0]?.cursor_value;
    },

    async setSyncCursor(
      dataset: string,
      cursorValue: string,
      cursorKey = "default",
    ): Promise<void> {
      const t = now();
      await db`
        insert into sync_cursors (dataset, cursor_key, cursor_value, updated_at)
        values (${dataset}, ${cursorKey}, ${cursorValue}, ${t})
        on conflict (dataset, cursor_key) do update set
          cursor_value = excluded.cursor_value,
          updated_at = excluded.updated_at
      `;
    },

    async replaceKnowledgeChunksForNote(
      noteId: string,
      chunks: KnowledgeIndexChunkInput[],
    ): Promise<void> {
      const t = now();
      await db.begin(async (tx) => {
        await tx`
          delete from knowledge_index_chunks
          where source_kind = 'hubspot_note' and source_id = ${noteId}
        `;
        for (const chunk of chunks) {
          const embeddingSql =
            chunk.embedding !== undefined
              ? tx.unsafe(`'${toVectorLiteral(chunk.embedding)}'::vector`)
              : null;
          await tx`
            insert into knowledge_index_chunks (
              id, source_kind, source_id, parent_kind, parent_id,
              chunk_idx, chunk_kind, chunk_text, content_hash, meta,
              indexed_at, embedding_model, semantic_model, semantic_schema_version,
              startup_id, author_email, note_created_at, embedding, created_at, updated_at
            )
            values (
              ${chunk.id}, ${chunk.sourceKind}, ${chunk.sourceId},
              ${"startup"}, ${chunk.startupId},
              ${chunk.chunkIdx}, ${chunk.chunkKind}, ${chunk.chunkText},
              ${chunk.contentHash}, ${tx.json(chunk.meta)},
              ${t}, ${chunk.embeddingModel ?? null}, ${chunk.semanticModel ?? null},
              ${chunk.semanticSchemaVersion}, ${chunk.startupId},
              ${chunk.authorEmail}, ${chunk.noteCreatedAt},
              ${embeddingSql}, ${t}, ${t}
            )
          `;
        }
      });
    },

    async deleteKnowledgeChunksForNote(noteId: string): Promise<void> {
      await db`
        delete from knowledge_index_chunks
        where source_kind = 'hubspot_note' and source_id = ${noteId}
      `;
    },

    async searchKnowledgeChunks(
      params: KnowledgeChunkSearchParams,
    ): Promise<KnowledgeChunkSearchHit[]> {
      const vectorLiteral = toVectorLiteral(params.queryEmbedding);
      const sinceCutoff =
        params.sinceDays !== undefined
          ? new Date(
              Date.now() - params.sinceDays * 86_400_000,
            ).toISOString()
          : undefined;
      const authorPattern =
        params.authorEmail !== undefined
          ? `%${params.authorEmail.trim().toLowerCase()}%`
          : undefined;

      type SearchRow = {
        id: string;
        source_id: string;
        startup_id: string;
        chunk_kind: string;
        chunk_text: string;
        author_email: string;
        note_created_at: string;
        meta: CrmMemorySemanticCard;
        score: number;
      };

      const rows = await db<SearchRow[]>`
        select
          id,
          source_id,
          startup_id,
          chunk_kind,
          chunk_text,
          author_email,
          note_created_at,
          meta,
          1 - (embedding <=> ${vectorLiteral}::vector) as score
        from knowledge_index_chunks
        where embedding is not null
          and source_kind = 'hubspot_note'
          ${params.chunkKind !== undefined ? db`and chunk_kind = ${params.chunkKind}` : db``}
          ${authorPattern !== undefined ? db`and lower(author_email) like ${authorPattern}` : db``}
          ${params.excludeStartupId !== undefined ? db`and startup_id <> ${params.excludeStartupId}` : db``}
          ${sinceCutoff !== undefined ? db`and note_created_at >= ${sinceCutoff}` : db``}
          ${
            params.sectorStartupIds !== undefined && params.sectorStartupIds.length > 0
              ? db`and startup_id = any(${params.sectorStartupIds})`
              : db``
          }
        order by embedding <=> ${vectorLiteral}::vector
        limit ${params.limit}
      `;

      return rows.map((row) => ({
        chunkId: row.id,
        noteId: row.source_id,
        startupId: row.startup_id,
        chunkKind: row.chunk_kind as KnowledgeChunkSearchHit["chunkKind"],
        chunkText: row.chunk_text,
        score: row.score,
        authorEmail: row.author_email,
        noteCreatedAt: row.note_created_at,
        meta: row.meta,
      }));
    },

    async countIndexedKnowledgeChunks(): Promise<number> {
      const rows = await db<{ count: string }[]>`
        select count(*)::text as count
        from knowledge_index_chunks
        where indexed_at is not null and embedding is not null
      `;
      return parseInt(rows[0]?.count ?? "0", 10);
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

    async upsertSocietyMember(member: SocietyMember): Promise<void> {
      const email = normalizeEmail(member.email);
      await db`
        insert into society_members
          (member_id, email, kind, tier, investor_id, active, created_at, updated_at)
        values (
          ${member.memberId},
          ${email},
          ${member.kind},
          ${member.tier},
          ${member.investorId ?? null},
          ${member.active},
          now(),
          now()
        )
        on conflict (member_id) do update set
          email = excluded.email,
          kind = excluded.kind,
          tier = excluded.tier,
          investor_id = excluded.investor_id,
          active = excluded.active,
          updated_at = now()
      `;
    },

    async getSocietyMemberByEmail(email: string): Promise<SocietyMember | undefined> {
      const normalized = normalizeEmail(email);
      const rows = await db<SocietyMemberRow[]>`
        select *
        from society_members
        where lower(email) = lower(${normalized})
          and active = true
      `;
      return rows[0] ? mapSocietyMember(rows[0]) : undefined;
    },

    async listSocietyMembers(): Promise<SocietyMember[]> {
      const rows = await db<SocietyMemberRow[]>`
        select * from society_members order by email
      `;
      return rows.map(mapSocietyMember);
    },

    async createSocietyMagicLinkToken(
      email: string,
      ttlSeconds: number,
    ): Promise<string> {
      const normalized = normalizeEmail(email);
      const token = randomBytes(48).toString("base64url");
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
      await db`
        insert into society_magic_link_tokens (token_hash, email, expires_at)
        values (${sha256Hex(token)}, ${normalized}, ${expiresAt})
      `;
      return token;
    },

    async consumeSocietyMagicLinkToken(token: string): Promise<string | undefined> {
      const tokenHash = sha256Hex(token);
      const rows = await db<{ email: string }[]>`
        update society_magic_link_tokens
        set consumed_at = now()
        where token_hash = ${tokenHash}
          and consumed_at is null
          and expires_at > now()
        returning email
      `;
      return rows[0]?.email;
    },

    mcpOauth: buildMcpOauthStore(db),
  };
};

type McpOAuthClientRow = {
  client_id: string;
  client_secret_hash: string | null;
  client_name: string | null;
  redirect_uris: string[];
  grant_types: string[];
  is_public: boolean;
};

type McpOAuthPendingRow = {
  google_state: string;
  client_id: string;
  redirect_uri: string;
  mcp_state: string;
  code_challenge: string;
  code_challenge_method: string;
  scope: string;
  expires_at: Date;
};

type McpOAuthCodeRow = {
  code_hash: string;
  client_id: string;
  principal_email: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  scopes: string;
  expires_at: Date;
  used_at: Date | null;
};

type McpOAuthTokenRow = {
  token_hash: string;
  client_id: string;
  principal_email: string;
  token_type: "access" | "refresh";
  scopes: string;
  expires_at: Date;
  revoked_at: Date | null;
};

const mapClient = (r: McpOAuthClientRow): McpOAuthClientRecord => ({
  clientId: r.client_id,
  clientSecretHash: r.client_secret_hash ?? undefined,
  clientName: r.client_name ?? undefined,
  redirectUris: r.redirect_uris,
  grantTypes: r.grant_types,
  isPublic: r.is_public,
});

const buildMcpOauthStore = (db: Db): McpOAuthStore => ({
  async createClient(client: McpOAuthClientRecord): Promise<void> {
    await db`
      insert into mcp_oauth_clients
        (client_id, client_secret_hash, client_name, redirect_uris, grant_types, is_public)
      values (
        ${client.clientId},
        ${client.clientSecretHash ?? null},
        ${client.clientName ?? null},
        ${db.json(client.redirectUris)},
        ${db.json(client.grantTypes)},
        ${client.isPublic}
      )
    `;
  },

  async getClient(clientId: string): Promise<McpOAuthClientRecord | undefined> {
    const rows = await db<McpOAuthClientRow[]>`
      select * from mcp_oauth_clients where client_id = ${clientId}
    `;
    return rows[0] ? mapClient(rows[0]) : undefined;
  },

  async savePendingAuthorize(row): Promise<void> {
    await db`
      insert into mcp_oauth_pending_authorizes
        (google_state, client_id, redirect_uri, mcp_state,
         code_challenge, code_challenge_method, scope, expires_at)
      values (
        ${row.googleState}, ${row.clientId}, ${row.redirectUri},
        ${row.mcpState}, ${row.codeChallenge}, ${row.codeChallengeMethod},
        ${row.scope}, now() + (${row.ttlSeconds} || ' seconds')::interval
      )
    `;
  },

  async popPendingAuthorize(googleState): Promise<McpOAuthPendingAuthorize | undefined> {
    const rows = await db<McpOAuthPendingRow[]>`
      delete from mcp_oauth_pending_authorizes
      where google_state = ${googleState} and expires_at > now()
      returning *
    `;
    const row = rows[0];
    if (!row) return undefined;
    return {
      googleState: row.google_state,
      clientId: row.client_id,
      redirectUri: row.redirect_uri,
      mcpState: row.mcp_state,
      codeChallenge: row.code_challenge,
      codeChallengeMethod: row.code_challenge_method,
      scope: row.scope,
    };
  },

  async createAuthorizationCode(row): Promise<void> {
    await db`
      insert into mcp_oauth_authorization_codes
        (code_hash, client_id, principal_email, redirect_uri,
         code_challenge, code_challenge_method, scopes, expires_at)
      values (
        ${row.codeHash}, ${row.clientId}, ${row.principalEmail}, ${row.redirectUri},
        ${row.codeChallenge}, ${row.codeChallengeMethod}, ${row.scopes},
        now() + (${row.ttlSeconds} || ' seconds')::interval
      )
    `;
  },

  async consumeAuthorizationCode(
    codeHash,
  ): Promise<McpOAuthAuthorizationCode | undefined> {
    const rows = await db<McpOAuthCodeRow[]>`
      update mcp_oauth_authorization_codes
      set used_at = now()
      where code_hash = ${codeHash}
        and used_at is null
        and expires_at > now()
      returning *
    `;
    const row = rows[0];
    if (!row) return undefined;
    return {
      codeHash: row.code_hash,
      clientId: row.client_id,
      principalEmail: row.principal_email,
      redirectUri: row.redirect_uri,
      codeChallenge: row.code_challenge,
      codeChallengeMethod: row.code_challenge_method,
      scopes: row.scopes,
    };
  },

  async createToken(row: McpOAuthTokenRecord): Promise<void> {
    await db`
      insert into mcp_oauth_tokens
        (token_hash, client_id, principal_email, token_type, scopes, expires_at)
      values (
        ${row.tokenHash}, ${row.clientId}, ${row.principalEmail},
        ${row.tokenType}, ${row.scopes}, ${row.expiresAt}
      )
    `;
  },

  async findToken(tokenHash: string): Promise<McpOAuthTokenRecord | undefined> {
    const rows = await db<McpOAuthTokenRow[]>`
      select * from mcp_oauth_tokens
      where token_hash = ${tokenHash}
        and revoked_at is null
        and expires_at > now()
    `;
    const row = rows[0];
    if (!row) return undefined;
    return {
      tokenHash: row.token_hash,
      clientId: row.client_id,
      principalEmail: row.principal_email,
      tokenType: row.token_type,
      scopes: row.scopes,
      expiresAt: row.expires_at,
    };
  },

  async revokeTokensForPair(clientId: string, principalEmail: string): Promise<number> {
    const rows = await db<{ token_hash: string }[]>`
      update mcp_oauth_tokens
      set revoked_at = now()
      where client_id = ${clientId}
        and principal_email = ${principalEmail}
        and revoked_at is null
      returning token_hash
    `;
    return rows.length;
  },
});

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
