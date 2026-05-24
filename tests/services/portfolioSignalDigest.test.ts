import { describe, expect, it, vi } from "vitest";
import { buildPortfolioSignalDigestService } from "../../src/services/portfolioSignalDigest.js";
import type { Connectors } from "../../src/connectors/registry.js";
import type { Identity } from "../../src/domain/identity.js";
import type { SocietyService } from "../../src/services/society.js";
import type { StartupsService } from "../../src/services/startups.js";
import type { SignalHubService } from "../../src/services/signalHub/index.js";
import type {
  Investor,
  Note,
  PortfolioCompany,
  PortfolioSignal,
  Startup,
} from "../../src/domain/entities.js";

const internalCaller: Identity = {
  kind: "human",
  email: "elie@tomcat.eu",
  domain: "tomcat.eu",
  role: "internal_team",
  team: undefined,
  investorId: undefined,
};

const investorCaller: Identity = {
  kind: "human",
  email: "lp@fund.com",
  domain: "fund.com",
  role: "external_investor",
  team: undefined,
  investorId: "inv_1",
};

const startup: Startup = {
  id: "hs_webin",
  name: "Webin",
  sectors: ["saas"],
  stage: "series_a",
  country: "FR",
  description: undefined,
  visibilityTier: "internal_only",
  sources: [{ system: "hubspot", externalId: "hs_webin", url: undefined }],
};

const portfolioRow: PortfolioCompany = {
  id: "Webin",
  startupId: "Webin",
  investedAt: "2025-01-01",
  ownershipPct: undefined,
  status: "active",
};

const unlinkedPortfolioRow: PortfolioCompany = {
  id: "OrphanCo",
  startupId: "OrphanCo",
  investedAt: "2025-01-01",
  ownershipPct: undefined,
  status: "active",
};

type LinkedInEventFixture = {
  id: string;
  source: "serper_public";
  signalType: "post";
  watchedId: string | undefined;
  startupId: string | undefined;
  unipileAccountId: string | undefined;
  emittedAt: string | undefined;
  ingestedAt: string;
  url: string | undefined;
  rawText: string | undefined;
  rawPayload: Record<string, unknown>;
  contentHash: string;
};

type WatchedFixture = {
  id: string;
  displayName: string;
  startupId: string | undefined;
  priority: "hot" | "warm" | "cold";
  linkedInUrl: string | undefined;
  createdAt: string;
};

const buildService = (overrides?: {
  signals?: PortfolioSignal[];
  notes?: Note[];
  linkedInEvents?: LinkedInEventFixture[];
  watchedEntities?: WatchedFixture[];
  portfolio?: PortfolioCompany[];
  startups?: Startup[];
  investor?: Investor;
}) => {
  const allWatched = overrides?.watchedEntities ?? [];
  const society = {
    ensurePortfolioCompanyInScope: vi.fn(async () => undefined),
  };

  const startups = {
    searchStartups: vi.fn(async () => overrides?.startups ?? [startup]),
    listAccessibleNotes: vi.fn(async () => overrides?.notes ?? []),
  };

  const signalHub = {
    listEvents: vi.fn(async () => overrides?.linkedInEvents ?? []),
    listWatched: vi.fn(async (_caller, priority?: string) =>
      priority === undefined
        ? allWatched
        : allWatched.filter((entity) => entity.priority === priority),
    ),
  };

  const connectors = {
    monday: {
      listPortfolio: vi.fn(async () => overrides?.portfolio ?? [portfolioRow]),
      listSignals: vi.fn(async () => overrides?.signals ?? []),
    },
    hubspot: {} as never,
    drive: {} as never,
    investors: {
      getInvestorById: vi.fn(async () =>
        overrides?.investor ?? {
          id: "inv_1",
          name: "Fund LP",
          tier: "gold",
          portfolioCompanyIds: ["Webin"],
        },
      ),
    },
  } as unknown as Connectors;

  const service = buildPortfolioSignalDigestService({
    connectors,
    startups: startups as unknown as StartupsService,
    society: society as unknown as SocietyService,
    signalHub: signalHub as unknown as SignalHubService,
  });

  return { service, society, startups, signalHub, connectors };
};

describe("portfolioSignalDigest service", () => {
  it("aggregates Monday, Signal Hub, and CRM notes per company in ToolRunEnvelope", async () => {
    const { service } = buildService({
      signals: [
        {
          id: "sig_1",
          portfolioCompanyId: "Webin",
          kind: "product",
          summary: "Launched enterprise tier",
          detectedAt: "2026-05-20T10:00:00Z",
          sourceUrl: undefined,
          visibilityTier: "internal_only",
        },
      ],
      notes: [
        {
          id: "note_1",
          startupId: "hs_webin",
          authorEmail: "elie@tomcat.eu",
          body: "Strong Q1 board feedback from lead investor.",
          sensitivity: "internal",
          createdAt: "2026-05-21T09:00:00Z",
          source: { system: "hubspot", externalId: "note_1", url: undefined },
        },
      ],
      linkedInEvents: [
        {
          id: "evt_1",
          source: "serper_public",
          signalType: "post",
          watchedId: "watch_1",
          startupId: "hs_webin",
          unipileAccountId: undefined,
          emittedAt: undefined,
          ingestedAt: "2026-05-22T08:00:00Z",
          url: "https://linkedin.com/posts/webin-1",
          rawText: "We are hiring senior engineers in Paris.",
          rawPayload: {},
          contentHash: "hash_1",
        },
      ],
      watchedEntities: [
        {
          id: "watch_1",
          displayName: "Webin CEO",
          startupId: "hs_webin",
          priority: "hot",
          linkedInUrl: undefined,
          createdAt: "2026-01-01T00:00:00Z",
        },
      ],
    });

    const result = await service.generatePortfolioSignalDigest(internalCaller, {
      sinceDays: 7,
    });

    expect(result.data.companies).toHaveLength(1);
    const row = result.data.companies[0];
    expect(row?.portfolioCompanyId).toBe("Webin");
    expect(row?.mondaySignals).toHaveLength(1);
    expect(row?.linkedInSignals).toHaveLength(1);
    expect(row?.crmNotes).toHaveLength(1);
    expect(row?.sourceChannels).toEqual(["monday", "signal_hub", "hubspot"]);
    expect(row?.factCount).toBe(3);
    expect(result.data.summary.totalFacts).toBe(3);
    expect(result.data.summary.companiesWithActivity).toBe(1);
    expect(result.citations.length).toBeGreaterThanOrEqual(3);
    expect(
      result.nextSuggestedTools?.some(
        (tool) => tool.toolName === "signal_hub_recent_signals",
      ),
    ).toBe(true);
    expect(
      result.nextSuggestedTools?.some(
        (tool) => tool.toolName === "prepare_board_brief",
      ),
    ).toBe(true);
  });

  it("maps LinkedIn via full watchlist when priority filter excludes the watched entity", async () => {
    const { service } = buildService({
      linkedInEvents: [
        {
          id: "evt_warm",
          source: "serper_public",
          signalType: "post",
          watchedId: "watch_warm",
          startupId: undefined,
          unipileAccountId: undefined,
          emittedAt: undefined,
          ingestedAt: "2026-05-22T08:00:00Z",
          url: "https://linkedin.com/posts/warm",
          rawText: "Warm priority founder update",
          rawPayload: {},
          contentHash: "hash_warm",
        },
      ],
      watchedEntities: [
        {
          id: "watch_warm",
          displayName: "Webin CEO",
          startupId: "hs_webin",
          priority: "warm",
          linkedInUrl: undefined,
          createdAt: "2026-01-01T00:00:00Z",
        },
      ],
    });

    const result = await service.generatePortfolioSignalDigest(internalCaller, {
      priority: "hot",
      includeQuietCompanies: true,
    });

    expect(result.data.companies[0]?.linkedInSignals).toHaveLength(0);
    expect(result.data.unlinkedLinkedInSignals).toHaveLength(0);
    expect(
      result.warnings.some((warning) => warning.code === "PORTFOLIO_LINK_MISSING"),
    ).toBe(false);
  });

  it("includes CRM notes from the time window even when newer notes are older", async () => {
    const { service, startups } = buildService({
      notes: [
        {
          id: "note_old",
          startupId: "hs_webin",
          authorEmail: "elie@tomcat.eu",
          body: "Very recent but outside the digest window.",
          sensitivity: "internal",
          createdAt: "2020-01-01T00:00:00Z",
          source: { system: "hubspot", externalId: "note_old", url: undefined },
        },
        {
          id: "note_in_window",
          startupId: "hs_webin",
          authorEmail: "elie@tomcat.eu",
          body: "Inside the weekly window.",
          sensitivity: "internal",
          createdAt: "2026-05-21T09:00:00Z",
          source: {
            system: "hubspot",
            externalId: "note_in_window",
            url: undefined,
          },
        },
      ],
    });

    const result = await service.generatePortfolioSignalDigest(internalCaller, {
      sinceDays: 7,
      notesPerCompany: 1,
    });

    expect(result.data.companies[0]?.crmNotes).toHaveLength(1);
    expect(result.data.companies[0]?.crmNotes[0]?.id).toBe("note_in_window");
    expect(startups.listAccessibleNotes).toHaveBeenCalledWith(
      internalCaller,
      { startupId: "hs_webin" },
      { limit: 10 },
    );
  });

  it("keeps the newest Monday signals when truncating per company", async () => {
    const { service } = buildService({
      signals: [
        {
          id: "sig_old",
          portfolioCompanyId: "Webin",
          kind: "product",
          summary: "Old launch",
          detectedAt: "2026-05-10T10:00:00Z",
          sourceUrl: undefined,
          visibilityTier: "internal_only",
        },
        {
          id: "sig_new",
          portfolioCompanyId: "Webin",
          kind: "risk",
          summary: "Recent risk",
          detectedAt: "2026-05-22T10:00:00Z",
          sourceUrl: undefined,
          visibilityTier: "internal_only",
        },
      ],
    });

    const result = await service.generatePortfolioSignalDigest(internalCaller, {
      sinceDays: 30,
      signalsPerCompany: 1,
    });

    expect(result.data.companies[0]?.mondaySignals).toHaveLength(1);
    expect(result.data.companies[0]?.mondaySignals[0]?.id).toBe("sig_new");
  });

  it("warns when HubSpot startup link is missing", async () => {
    const { service } = buildService({
      portfolio: [unlinkedPortfolioRow],
      startups: [],
    });

    const result = await service.generatePortfolioSignalDigest(internalCaller, {});

    expect(result.data.companies[0]?.startupId).toBeUndefined();
    expect(
      result.warnings.some(
        (warning) =>
          warning.code === "PORTFOLIO_LINK_MISSING"
          && warning.message.includes("HubSpot"),
      ),
    ).toBe(true);
  });

  it("warns on unlinked LinkedIn signals and empty watchlist", async () => {
    const { service } = buildService({
      linkedInEvents: [
        {
          id: "evt_orphan",
          source: "serper_public",
          signalType: "post",
          watchedId: undefined,
          startupId: undefined,
          unipileAccountId: undefined,
          emittedAt: undefined,
          ingestedAt: "2026-05-22T08:00:00Z",
          url: "https://linkedin.com/posts/orphan",
          rawText: "Unmapped founder post",
          rawPayload: {},
          contentHash: "hash_orphan",
        },
      ],
    });

    const result = await service.generatePortfolioSignalDigest(internalCaller, {});

    expect(result.data.unlinkedLinkedInSignals).toHaveLength(1);
    expect(
      result.warnings.some(
        (warning) =>
          warning.code === "PORTFOLIO_LINK_MISSING"
          && warning.message.includes("LinkedIn"),
      ),
    ).toBe(true);
    expect(
      result.warnings.some((warning) => warning.code === "WATCHLIST_EMPTY"),
    ).toBe(true);
    expect(result.nextSuggestedTools).toBeUndefined();
  });

  it("hides unlinked LinkedIn excerpts from external investors", async () => {
    const { service } = buildService({
      linkedInEvents: [
        {
          id: "evt_orphan",
          source: "serper_public",
          signalType: "post",
          watchedId: undefined,
          startupId: undefined,
          unipileAccountId: undefined,
          emittedAt: undefined,
          ingestedAt: "2026-05-22T08:00:00Z",
          url: "https://linkedin.com/posts/orphan",
          rawText: "Sensitive unmapped founder post",
          rawPayload: {},
          contentHash: "hash_orphan",
        },
      ],
    });

    const result = await service.generatePortfolioSignalDigest(investorCaller, {});

    expect(result.data.unlinkedLinkedInSignals).toHaveLength(0);
    expect(result.data.summary.unlinkedLinkedInCount).toBe(1);
    expect(
      result.warnings.some(
        (warning) =>
          warning.code === "PORTFOLIO_LINK_MISSING"
          && warning.message.includes("LinkedIn"),
      ),
    ).toBe(false);
  });

  it("warns when LinkedIn events hit the fetch cap", async () => {
    const linkedInEvents = Array.from({ length: 500 }, (_, index) => ({
      id: `evt_${String(index)}`,
      source: "serper_public" as const,
      signalType: "post" as const,
      watchedId: undefined,
      startupId: undefined,
      unipileAccountId: undefined,
      emittedAt: undefined,
      ingestedAt: "2026-05-22T08:00:00Z",
      url: undefined,
      rawText: `Post ${String(index)}`,
      rawPayload: {},
      contentHash: `hash_${String(index)}`,
    }));

    const { service } = buildService({ linkedInEvents });

    const result = await service.generatePortfolioSignalDigest(internalCaller, {});

    expect(
      result.warnings.some(
        (warning) => warning.code === "LINKEDIN_EVENTS_TRUNCATED",
      ),
    ).toBe(true);
  });

  it("omits quiet companies by default", async () => {
    const quietRow: PortfolioCompany = {
      id: "QuietCo",
      startupId: "QuietCo",
      investedAt: "2025-01-01",
      ownershipPct: undefined,
      status: "active",
    };

    const { service } = buildService({
      portfolio: [portfolioRow, quietRow],
      startups: [
        startup,
        {
          ...startup,
          id: "hs_quiet",
          name: "QuietCo",
        },
      ],
      signals: [
        {
          id: "sig_1",
          portfolioCompanyId: "Webin",
          kind: "product",
          summary: "Active signal",
          detectedAt: "2026-05-20T10:00:00Z",
          sourceUrl: undefined,
          visibilityTier: "internal_only",
        },
      ],
    });

    const result = await service.generatePortfolioSignalDigest(internalCaller, {});

    expect(result.data.companies).toHaveLength(1);
    expect(result.data.companies[0]?.portfolioCompanyId).toBe("Webin");
    expect(result.data.scope.quietCompaniesOmitted).toBe(1);
  });
});
