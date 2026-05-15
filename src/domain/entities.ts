export type ISODate = string;

export type Sector =
  | "fintech"
  | "saas"
  | "marketplace"
  | "deeptech"
  | "climate"
  | "consumer"
  | "health"
  | "other";

export type Stage =
  | "unknown"
  | "pre_seed"
  | "seed"
  | "series_a"
  | "series_b"
  | "series_c+";

export type Startup = {
  id: string;
  name: string;
  sectors: Sector[];
  stage: Stage;
  country: string | undefined;
  description: string | undefined;
  visibilityTier: "bronze" | "silver" | "gold" | "platinum" | "internal_only";
  sources: SourceRef[];
};

export type Investor = {
  id: string;
  name: string;
  email: string | undefined;
  tier: "bronze" | "silver" | "gold" | "platinum";
  sectorsOfInterest: Sector[];
  portfolioCompanyIds: string[];
};

export type PortfolioCompany = {
  id: string;
  startupId: string;
  investedAt: ISODate;
  ownershipPct: number | undefined;
  status: "active" | "exited" | "wrote_off";
};

export type Deal = {
  id: string;
  startupId: string;
  ownerEmail: string;
  status: "screening" | "diligence" | "passed" | "invested" | "lost";
  amountEur: number | undefined;
  updatedAt: ISODate;
  visibilityTier: "internal_only" | "shared_with_investors";
};

export type Meeting = {
  id: string;
  startupId: string | undefined;
  attendees: string[];
  subject: string;
  occurredAt: ISODate;
  source: SourceRef;
};

export type NoteSensitivity = "public" | "investor_visible" | "internal" | "confidential";

export type Note = {
  id: string;
  startupId: string | undefined;
  authorEmail: string;
  body: string;
  sensitivity: NoteSensitivity;
  createdAt: ISODate;
  source: SourceRef;
};

export type BoardPack = {
  id: string;
  portfolioCompanyId: string;
  title: string;
  driveFileId: string;
  createdAt: ISODate;
};

export type SignalKind =
  | "hire"
  | "funding"
  | "press"
  | "product"
  | "risk"
  | "other";

export type PortfolioSignal = {
  id: string;
  portfolioCompanyId: string;
  kind: SignalKind;
  summary: string;
  detectedAt: ISODate;
  sourceUrl: string | undefined;
  visibilityTier: "internal_only" | "shared_with_investors";
};

export type EventVisibility = "public" | "investors_only" | "internal_only";

export type Event = {
  id: string;
  title: string;
  startsAt: ISODate;
  location: string | undefined;
  visibility: EventVisibility;
  invitedInvestorIds: string[];
};

export type SourceRef = {
  system: "hubspot" | "drive" | "monday" | "manual";
  externalId: string;
  url: string | undefined;
};

export type Citation = {
  label: string;
  source: SourceRef;
};
