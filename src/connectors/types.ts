import type {
  Deal,
  Event,
  Investor,
  Meeting,
  Note,
  PortfolioCompany,
  PortfolioSignal,
  Startup,
} from "../domain/entities.js";

export interface HubspotConnector {
  listStartups(): Promise<Startup[]>;
  listDealsForStartup(startupId: string): Promise<Deal[]>;
  listMeetingsForStartup(startupId: string): Promise<Meeting[]>;
  listNotesForStartup(startupId: string): Promise<Note[]>;
}

export interface DriveConnector {
  listBoardPacksForCompany(
    portfolioCompanyId: string,
  ): Promise<{ id: string; title: string; driveFileId: string; createdAt: string }[]>;
  fetchDocumentText(driveFileId: string): Promise<string>;
}

export interface MondayConnector {
  listPortfolio(): Promise<PortfolioCompany[]>;
  listSignals(sinceDays: number): Promise<PortfolioSignal[]>;
  listUpcomingEvents(): Promise<Event[]>;
}

export interface InvestorsConnector {
  getInvestorById(investorId: string): Promise<Investor | undefined>;
}
