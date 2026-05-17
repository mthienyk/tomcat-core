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
  listStartups(): Promise<Startup[]>;

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

  // Freshness
  getFreshness(dataset: string): Promise<DatasetFreshness>;
  listFreshness(): Promise<DatasetFreshness[]>;

  // Users (internal Tomcat employees, for DB role resolver)
  upsertUser(user: UserRecord): Promise<void>;
  getUserByEmail(email: string): Promise<UserRecord | undefined>;
  listUsers(): Promise<UserRecord[]>;
}
