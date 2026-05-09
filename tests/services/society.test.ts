import { describe, expect, it } from "vitest";
import { buildSocietyService } from "../../src/services/society.js";
import type { Connectors } from "../../src/connectors/registry.js";
import type { Identity } from "../../src/domain/identity.js";
import type {
  Event,
  Investor,
  PortfolioSignal,
  Startup,
} from "../../src/domain/entities.js";

const startups: Startup[] = [
  {
    id: "startup_silver",
    name: "Startup Silver",
    sectors: ["saas"],
    stage: "seed",
    country: undefined,
    description: undefined,
    visibilityTier: "silver",
    sources: [],
  },
  {
    id: "startup_internal",
    name: "Startup Internal",
    sectors: ["saas"],
    stage: "seed",
    country: undefined,
    description: undefined,
    visibilityTier: "internal_only",
    sources: [],
  },
];

const signals: PortfolioSignal[] = [
  {
    id: "signal_visible",
    portfolioCompanyId: "portfolio_owned",
    kind: "other",
    summary: "Visible signal",
    detectedAt: "2026-01-01",
    sourceUrl: undefined,
    visibilityTier: "shared_with_investors",
  },
  {
    id: "signal_internal",
    portfolioCompanyId: "portfolio_owned",
    kind: "risk",
    summary: "Internal signal",
    detectedAt: "2026-01-01",
    sourceUrl: undefined,
    visibilityTier: "internal_only",
  },
];

const events: Event[] = [
  {
    id: "event_invited",
    title: "Invited event",
    startsAt: "2026-01-01",
    location: undefined,
    visibility: "investors_only",
    invitedInvestorIds: ["investor_owned"],
  },
];

const investors: Investor[] = [
  {
    id: "investor_owned",
    name: "Investor Owned",
    email: undefined,
    tier: "platinum",
    sectorsOfInterest: [],
    portfolioCompanyIds: ["portfolio_owned"],
  },
  {
    id: "investor_other",
    name: "Investor Other",
    email: undefined,
    tier: "gold",
    sectorsOfInterest: [],
    portfolioCompanyIds: [],
  },
];

const connectors: Connectors = {
  hubspot: {
    listStartups: async () => startups,
    listDealsForStartup: async () => [],
    listMeetingsForStartup: async () => [],
    listNotesForStartup: async () => [],
  },
  monday: {
    listPortfolio: async () => [],
    listSignals: async () => signals,
    listUpcomingEvents: async () => events,
  },
  drive: {
    listBoardPacksForCompany: async () => [],
    fetchDocumentText: async () => "",
  },
  investors: {
    getInvestorById: async (id) => investors.find((investor) => investor.id === id),
  },
};

const internalCaller: Identity = {
  kind: "human",
  email: "alice@tomcat.eu",
  domain: "tomcat.eu",
  role: "internal_team",
  team: undefined,
  investorId: undefined,
  investorTier: undefined,
};

const investorAxa: Identity = {
  kind: "human",
  email: "owned@example.test",
  domain: "example.test",
  role: "external_investor",
  team: undefined,
  investorId: "investor_owned",
  investorTier: "platinum",
};

const investorOther: Identity = {
  kind: "human",
  email: "other@example.test",
  domain: "example.test",
  role: "external_investor",
  team: undefined,
  investorId: "investor_other",
  investorTier: "gold",
};

const serviceWithoutDelegation: Identity = {
  kind: "service",
  clientId: "society",
  scopes: ["society.read"],
  onBehalfOf: undefined,
};

const delegatedServiceInvestorOwned: Identity = {
  kind: "service",
  clientId: "society",
  scopes: ["society.read"],
  onBehalfOf: {
    kind: "human",
    email: "owned@example.test",
    domain: "example.test",
    role: "external_investor",
    team: undefined,
    investorId: "investor_owned",
    investorTier: undefined,
  },
};

describe("SocietyService.getInvestorHome", () => {
  const society = buildSocietyService({ connectors });

  it("filters startups by tier visibility", async () => {
    const home = await society.getInvestorHome(investorAxa, "investor_owned");
    const ids = home.visibleStartups.map((s) => s.id);
    expect(ids).toContain("startup_silver");
    expect(ids).not.toContain("startup_internal");
  });

  it("internal sees internal_only startups", async () => {
    const home = await society.getInvestorHome(internalCaller, "investor_owned");
    const ids = home.visibleStartups.map((s) => s.id);
    expect(ids).toContain("startup_internal");
  });

  it("blocks investor from accessing another investor's home", async () => {
    await expect(
      society.getInvestorHome(investorAxa, "investor_other"),
    ).rejects.toThrow(/own scope/);
  });

  it("hides internal-only signals from external investor", async () => {
    const home = await society.getInvestorHome(investorAxa, "investor_owned");
    expect(home.recentSignals.map((signal) => signal.id)).toEqual([
      "signal_visible",
    ]);
  });

  it("does not surface signals for portfolio companies the investor does not own", async () => {
    const home = await society.getInvestorHome(investorOther, "investor_other");
    expect(home.recentSignals).toHaveLength(0);
  });

  it("hides invitations to events the investor is not invited to", async () => {
    const home = await society.getInvestorHome(investorOther, "investor_other");
    expect(
      home.upcomingEvents.find((event) => event.id === "event_invited"),
    ).toBeUndefined();
  });

  it("rejects service callers without delegated investor identity", async () => {
    await expect(
      society.getInvestorHome(serviceWithoutDelegation, "investor_owned"),
    ).rejects.toThrow(/delegated investor identity/);
  });

  it("rejects service caller when delegated investor scope does not match path", async () => {
    await expect(
      society.getInvestorHome(delegatedServiceInvestorOwned, "investor_other"),
    ).rejects.toThrow(/own scope/);
  });
});

describe("SocietyService.getPortfolioSignals", () => {
  const society = buildSocietyService({ connectors });

  it("rejects service callers without delegated investor identity", async () => {
    await expect(
      society.getPortfolioSignals(serviceWithoutDelegation, "portfolio_owned", 30),
    ).rejects.toThrow(/delegated investor identity/);
  });

  it("rejects delegated investor outside portfolio scope", async () => {
    await expect(
      society.getPortfolioSignals(
        delegatedServiceInvestorOwned,
        "portfolio_not_owned",
        30,
      ),
    ).rejects.toThrow(/outside caller scope/);
  });
});
