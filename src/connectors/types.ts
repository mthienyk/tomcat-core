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
  getStartupById(companyId: string): Promise<Startup | undefined>;
  listDealsForStartup(startupId: string): Promise<Deal[]>;
  listMeetingsForStartup(startupId: string): Promise<Meeting[]>;
  listNotesForStartup(startupId: string): Promise<Note[]>;
  listCompaniesModifiedSince(
    sinceMs: number,
  ): Promise<Array<{ id: string; modifiedAt: string }>>;
}

export type DriveFolderRef = {
  driveFolderId: string;
  name: string;
  createdTime: string;
  modifiedTime: string;
  parentIds: string[];
};

export type DriveItemRef = {
  driveFileId: string;
  name: string;
  mimeType: string;
  kind: "folder" | "file";
  createdTime: string;
  modifiedTime: string;
};

export interface DriveConnector {
  listBoardPacksForCompany(
    portfolioCompanyId: string,
  ): Promise<
    {
      id: string;
      title: string;
      driveFileId: string;
      createdAt: string;
      mimeType?: string;
    }[]
  >;
  listCompanyFolders(portfolioCompanyId: string): Promise<DriveFolderRef[]>;
  listFolderChildren(driveFolderId: string): Promise<DriveItemRef[]>;
  resolveItemPath(driveItemId: string): Promise<string>;
  fetchDocumentText(driveFileId: string): Promise<string>;
  fetchDocumentBinary(
    driveFileId: string,
  ): Promise<{ name: string; mimeType: string; buffer: Buffer }>;
}

export interface MondayConnector {
  listPortfolio(): Promise<PortfolioCompany[]>;
  listSignals(sinceDays: number): Promise<PortfolioSignal[]>;
  listUpcomingEvents(): Promise<Event[]>;
}

export interface InvestorsConnector {
  getInvestorById(investorId: string): Promise<Investor | undefined>;
}
