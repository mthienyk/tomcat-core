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
} from "../domain/entities.js";
import type { Role } from "../domain/identity.js";
import type {
  EnqueueSyncJobInput,
  HubspotCompanySyncState,
  SyncQueueJob,
  SyncQueueStats,
} from "../domain/syncQueue.js";
import type {
  CrmMemoryChunkKind,
  CrmMemorySemanticCard,
  KnowledgeChunkSearchHit,
  KnowledgeChunkSearchParams,
  KnowledgeIndexChunkInput,
} from "../domain/crmMemory.js";
import type {
  SocietyMember,
  StartupBrowsePage,
  StartupBrowseQuery,
} from "../domain/society.js";
import type { StartupDirectoryTier } from "../domain/startupDirectory.js";

export type GrepNotesParams = {
  terms: string[];
  matchMode: "all" | "any";
  startupIds: string[];
  authorEmail?: string;
  sinceDays?: number;
  limit: number;
};

export type GrepNoteStoreHit = {
  note: Note;
  startupName: string | undefined;
};

export type IndexedNoteChunkRecord = {
  chunkId: string;
  noteId: string;
  startupId: string;
  chunkKind: CrmMemoryChunkKind;
  chunkText: string;
  authorEmail: string;
  noteCreatedAt: string;
  meta: CrmMemorySemanticCard;
};

export type GrepIndexMetaHit = {
  noteId: string;
  startupId: string;
  authorEmail: string;
  noteCreatedAt: string;
  chunkKind: CrmMemoryChunkKind;
  chunkText: string;
  matchedField: "competitorNames" | "markets" | "chunkText";
  matchedTerm: string;
};

export type SyncStatus = "running" | "success" | "failed";

export type SyncRun = {
  id: string;
  dataset: string;
  startedAt: string;
  finishedAt: string | undefined;
  status: SyncStatus;
  recordsUpserted: number;
  errorMessage: string | undefined;
  cursorAfter: string | undefined;
};

export type DatasetFreshness = {
  dataset: string;
  lastSyncAt: string | undefined;
  recordsTotal: number;
  healthy: boolean;
  updatedAt: string;
};

export type UserRecord = {
  email: string;
  role: Role;
  team: string | undefined;
  active: boolean;
};

export interface CoreStore {
  // Startups
  upsertStartup(startup: Startup): Promise<void>;
  insertStartupIfAbsent(startup: Startup): Promise<boolean>;
  updateStartupDirectoryClassification(input: {
    id: string;
    directoryTier: StartupDirectoryTier;
    visibilityTier: Startup["visibilityTier"];
  }): Promise<void>;
  listStartups(): Promise<Startup[]>;
  listInvestedStartupIds(): Promise<string[]>;
  browseStartups(query: StartupBrowseQuery): Promise<StartupBrowsePage>;
  listStartupIdsWithNotesMissingDirectoryEntry(): Promise<string[]>;

  // Investors (business profile, not Google accounts)
  upsertInvestor(investor: Investor): Promise<void>;
  getInvestorById(id: string): Promise<Investor | undefined>;
  listInvestors(): Promise<Investor[]>;

  // Portfolio companies
  upsertPortfolioCompany(company: PortfolioCompany): Promise<void>;
  getPortfolioCompany(id: string): Promise<PortfolioCompany | undefined>;
  listPortfolioCompanies(): Promise<PortfolioCompany[]>;

  // Deals
  upsertDeal(deal: Deal): Promise<void>;
  listDealsForStartup(startupId: string): Promise<Deal[]>;

  // Notes
  upsertNote(note: Note): Promise<void>;
  listNotesForStartup(startupId: string): Promise<Note[]>;
  getNoteById(id: string): Promise<Note | undefined>;
  listNotesPendingIndex(limit: number): Promise<Note[]>;
  markNoteIndexed(noteId: string, contentHash: string): Promise<void>;
  grepNotes(params: GrepNotesParams): Promise<GrepNoteStoreHit[]>;
  listKnowledgeChunksForNote(
    noteId: string,
  ): Promise<IndexedNoteChunkRecord[]>;
  grepKnowledgeIndexMeta(
    params: GrepNotesParams,
  ): Promise<GrepIndexMetaHit[]>;

  // CRM semantic memory index
  replaceKnowledgeChunksForNote(
    noteId: string,
    chunks: KnowledgeIndexChunkInput[],
  ): Promise<void>;
  deleteKnowledgeChunksForNote(noteId: string): Promise<void>;
  searchKnowledgeChunks(
    params: KnowledgeChunkSearchParams,
  ): Promise<KnowledgeChunkSearchHit[]>;
  countIndexedKnowledgeChunks(): Promise<number>;
  getStartupById(id: string): Promise<Startup | undefined>;

  // Meetings
  upsertMeeting(meeting: Meeting): Promise<void>;
  listMeetingsForStartup(startupId: string): Promise<Meeting[]>;

  // Board packs
  upsertBoardPack(pack: BoardPack): Promise<void>;
  listBoardPacksForCompany(portfolioCompanyId: string): Promise<BoardPack[]>;

  // Portfolio signals
  upsertPortfolioSignal(signal: PortfolioSignal): Promise<void>;
  listPortfolioSignals(options?: {
    portfolioCompanyId?: string;
    sinceDays?: number;
  }): Promise<PortfolioSignal[]>;

  // Events
  upsertEvent(event: Event): Promise<void>;
  listUpcomingEvents(): Promise<Event[]>;

  // Sync management
  startSyncRun(dataset: string): Promise<SyncRun>;
  finishSyncRun(
    id: string,
    options: { recordsUpserted: number; cursorAfter?: string },
  ): Promise<void>;
  failSyncRun(id: string, errorMessage: string): Promise<void>;
  getLatestSyncRun(dataset: string): Promise<SyncRun | undefined>;
  failAllRunningSyncRuns(errorMessage: string): Promise<number>;
  hasRecentRunningSyncRun(withinMinutes: number): Promise<boolean>;
  ping(): Promise<void>;

  // Freshness
  getFreshness(dataset: string): Promise<DatasetFreshness>;
  listFreshness(): Promise<DatasetFreshness[]>;
  refreshDatasetFreshness(dataset: string): Promise<void>;

  // Sync queue (HubSpot activity and future datasets)
  enqueueSyncJob(input: EnqueueSyncJobInput): Promise<"created" | "deduped">;
  claimSyncJobs(
    dataset: string,
    limit: number,
    workerId: string,
  ): Promise<SyncQueueJob[]>;
  completeSyncJob(id: string): Promise<void>;
  failSyncJob(
    id: string,
    errorMessage: string,
    retryDelayMs: number,
  ): Promise<void>;
  getSyncQueueStats(dataset: string): Promise<SyncQueueStats>;
  releaseStaleSyncJobs(staleAfterMs: number): Promise<number>;

  // HubSpot incremental sync state
  upsertHubspotCompanySyncState(state: HubspotCompanySyncState): Promise<void>;
  getHubspotCompanySyncState(
    companyId: string,
  ): Promise<HubspotCompanySyncState | undefined>;
  listHubspotCompanySyncStatesMissingActivity(): Promise<string[]>;

  getSyncCursor(dataset: string, cursorKey?: string): Promise<string | undefined>;
  setSyncCursor(
    dataset: string,
    cursorValue: string,
    cursorKey?: string,
  ): Promise<void>;

  // Users (internal Tomcat employees, for DB role resolver)
  upsertUser(user: UserRecord): Promise<void>;
  insertUserIfAbsent(user: UserRecord): Promise<boolean>;
  findUserByEmail(email: string): Promise<UserRecord | undefined>;
  getUserByEmail(email: string): Promise<UserRecord | undefined>;
  listUsers(): Promise<UserRecord[]>;

  // Society members (investor allowlist for magic link auth)
  upsertSocietyMember(member: SocietyMember): Promise<void>;
  getSocietyMemberByEmail(email: string): Promise<SocietyMember | undefined>;
  listSocietyMembers(): Promise<SocietyMember[]>;
  createSocietyMagicLinkToken(email: string, ttlSeconds: number): Promise<string>;
  consumeSocietyMagicLinkToken(token: string): Promise<string | undefined>;

  // MCP OAuth broker (Tomcat Core acts as Authorization Server)
  mcpOauth: McpOAuthStore;
}

export type McpOAuthClientRecord = {
  clientId: string;
  clientSecretHash: string | undefined;
  clientName: string | undefined;
  redirectUris: string[];
  grantTypes: string[];
  isPublic: boolean;
};

export type McpOAuthPendingAuthorize = {
  googleState: string;
  clientId: string;
  redirectUri: string;
  mcpState: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope: string;
};

export type McpOAuthAuthorizationCode = {
  codeHash: string;
  clientId: string;
  principalEmail: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scopes: string;
};

export type McpOAuthTokenRecord = {
  tokenHash: string;
  clientId: string;
  principalEmail: string;
  tokenType: "access" | "refresh";
  scopes: string;
  expiresAt: Date;
};

export interface McpOAuthStore {
  createClient(client: McpOAuthClientRecord): Promise<void>;
  getClient(clientId: string): Promise<McpOAuthClientRecord | undefined>;

  savePendingAuthorize(
    row: McpOAuthPendingAuthorize & { ttlSeconds: number },
  ): Promise<void>;
  popPendingAuthorize(
    googleState: string,
  ): Promise<McpOAuthPendingAuthorize | undefined>;

  createAuthorizationCode(
    row: McpOAuthAuthorizationCode & { ttlSeconds: number },
  ): Promise<void>;
  consumeAuthorizationCode(
    codeHash: string,
  ): Promise<McpOAuthAuthorizationCode | undefined>;

  createToken(row: McpOAuthTokenRecord): Promise<void>;
  findToken(tokenHash: string): Promise<McpOAuthTokenRecord | undefined>;
  revokeTokenByHash(tokenHash: string): Promise<boolean>;
  revokeTokensForPair(clientId: string, principalEmail: string): Promise<number>;
  revokeTokensForPrincipalEmail(principalEmail: string): Promise<number>;
}
