import { describe, expect, it, vi } from "vitest";
import { buildCompanyContextService } from "../../src/services/companyContext.js";
import type { Connectors } from "../../src/connectors/registry.js";
import type { Identity } from "../../src/domain/identity.js";
import type { SocietyService } from "../../src/services/society.js";
import type { StartupsService } from "../../src/services/startups.js";
import type {
  Deal,
  Meeting,
  Note,
  PortfolioCompany,
  PortfolioSignal,
  Startup,
} from "../../src/domain/entities.js";

const internalCaller: Identity = {
  kind: "human",
  email: "team@tomcat.eu",
  domain: "tomcat.eu",
  role: "internal_team",
  team: undefined,
  investorId: undefined,
  investorTier: undefined,
};

const startup = (overrides: Partial<Startup>): Startup => ({
  id: "startup_1",
  name: "Atlas",
  sectors: ["saas"],
  stage: "seed",
  country: undefined,
  description: undefined,
  visibilityTier: "internal_only",
  sources: [],
  ...overrides,
});

const portfolioRow = (overrides: Partial<PortfolioCompany>): PortfolioCompany => ({
  id: "Atlas",
  startupId: "Atlas",
  investedAt: "2026-01-01",
  ownershipPct: undefined,
  status: "active",
  ...overrides,
});

type ServiceBundle = {
  service: ReturnType<typeof buildCompanyContextService>;
  startups: { [K in keyof StartupsService]: ReturnType<typeof vi.fn> };
  society: { [K in keyof SocietyService]: ReturnType<typeof vi.fn> };
  connectors: Connectors;
};

const buildBundle = (params: {
  startups?: Startup[];
  portfolio?: PortfolioCompany[];
  driveFiles?: { id: string; title: string; driveFileId: string; createdAt: string }[];
  signals?: PortfolioSignal[];
  events?: { id: string; title: string; startsAt: string; location: undefined; visibility: "public"; invitedInvestorIds: string[] }[];
  notes?: Note[];
  deals?: Deal[];
  meetings?: Meeting[];
  driveText?: string;
}): ServiceBundle => {
  const visibleStartups = params.startups ?? [];
  const portfolioRows = params.portfolio ?? [];
  const files = params.driveFiles ?? [];
  const signals = params.signals ?? [];
  const events = params.events ?? [];

  const startupsStub = {
    searchStartups: vi.fn(async (_id, query: { startupId?: string; startupName?: string; sector?: string }) => {
      if (query.startupId) {
        return visibleStartups.filter((s) => s.id === query.startupId);
      }
      if (query.startupName) {
        const needle = query.startupName.toLowerCase();
        return visibleStartups.filter((s) => s.name.toLowerCase().includes(needle));
      }
      return visibleStartups;
    }),
    findSimilar: vi.fn(),
    listAccessibleNotes: vi.fn(async () => params.notes ?? []),
    listAccessibleDeals: vi.fn(async () => params.deals ?? []),
    listAccessibleMeetings: vi.fn(async () => params.meetings ?? []),
  };

  const societyStub = {
    ensurePortfolioCompanyInScope: vi.fn(async () => undefined),
    getPortfolioSignals: vi.fn(async () => signals),
    getInvestorHome: vi.fn(),
  };

  const connectors = {
    monday: {
      listPortfolio: vi.fn(async () => portfolioRows),
      listSignals: vi.fn(async () => signals),
      listUpcomingEvents: vi.fn(async () => events),
    },
    drive: {
      listBoardPacksForCompany: vi.fn(async () => files),
      listCompanyFolders: vi.fn(async () => []),
      listFolderChildren: vi.fn(async () => []),
      resolveItemPath: vi.fn(async () => ""),
      fetchDocumentText: vi.fn(async () => params.driveText ?? "hello world"),
    },
    hubspot: {} as never,
    investors: {} as never,
  } as unknown as Connectors;

  const service = buildCompanyContextService({
    connectors,
    startups: startupsStub as unknown as StartupsService,
    society: societyStub as unknown as SocietyService,
  });

  return {
    service,
    startups: startupsStub as never,
    society: societyStub as never,
    connectors,
  };
};

describe("companyContext.resolveEntity", () => {
  it("rejects empty queries", async () => {
    const { service } = buildBundle({});
    await expect(service.resolveEntity(internalCaller, "   ")).rejects.toThrow(
      /at least one non-space/i,
    );
  });

  it("warns on too-short queries", async () => {
    const { service } = buildBundle({
      startups: [startup({ id: "s1", name: "Atlas" })],
      portfolio: [portfolioRow({ id: "Atlas", startupId: "Atlas" })],
    });
    const result = await service.resolveEntity(internalCaller, "a");
    expect(result.warnings.some((w) => /too short/i.test(w))).toBe(true);
  });

  it("merges HubSpot + Monday and returns a single candidate on exact match", async () => {
    const { service } = buildBundle({
      startups: [
        startup({ id: "s1", name: "Atlas" }),
        startup({ id: "s2", name: "Helios Labs" }),
      ],
      portfolio: [portfolioRow({ id: "Atlas", startupId: "Atlas" })],
    });
    const result = await service.resolveEntity(internalCaller, "Atlas");

    expect(result.needsClarification).toBe(false);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      canonicalName: "Atlas",
      startupId: "s1",
      portfolioCompanyId: "Atlas",
    });
    expect(result.candidates[0]?.matchedSources).toEqual(
      expect.arrayContaining(["hubspot", "monday"]),
    );
  });

  it("returns needsClarification when multiple candidates and no exact match", async () => {
    const { service } = buildBundle({
      startups: [
        startup({ id: "s1", name: "Atlas Bio" }),
        startup({ id: "s2", name: "Atlas Labs" }),
      ],
      portfolio: [],
    });
    const result = await service.resolveEntity(internalCaller, "atlas");
    expect(result.candidates.length).toBeGreaterThan(1);
    expect(result.needsClarification).toBe(true);
  });

  it("keeps both candidates when two HubSpot startups share the same canonical name", async () => {
    const { service } = buildBundle({
      startups: [
        startup({ id: "s1", name: "Atlas" }),
        startup({ id: "s2", name: "Atlas" }),
      ],
      portfolio: [],
    });
    const result = await service.resolveEntity(internalCaller, "atlas");
    expect(result.candidates).toHaveLength(2);
    expect(new Set(result.candidates.map((c) => c.startupId))).toEqual(
      new Set(["s1", "s2"]),
    );
    expect(result.needsClarification).toBe(true);
  });

  it("emits a warning when no candidate matches", async () => {
    const { service } = buildBundle({
      startups: [startup({ id: "s1", name: "Atlas" })],
      portfolio: [],
    });
    const result = await service.resolveEntity(internalCaller, "Unknown SAS");
    expect(result.candidates).toEqual([]);
    expect(result.warnings.some((w) => /no candidate/i.test(w))).toBe(true);
    expect(result.needsClarification).toBe(false);
  });

  it("exposes Monday-only rows when HubSpot returns nothing", async () => {
    const { service } = buildBundle({
      startups: [],
      portfolio: [portfolioRow({ id: "Atlas", startupId: "Atlas" })],
    });
    const result = await service.resolveEntity(internalCaller, "Atlas");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.startupId).toBeUndefined();
    expect(result.candidates[0]?.portfolioCompanyId).toBe("Atlas");
    expect(result.candidates[0]?.matchedSources).toEqual(["monday"]);
  });

  it("returns driveTokens with parenthetical aliases for cross-system names", async () => {
    const { service } = buildBundle({
      startups: [startup({ id: "9426764108", name: "Wenabi" })],
      portfolio: [
        portfolioRow({
          id: "KOMEET (ex WENABI)",
          startupId: "KOMEET",
        }),
      ],
    });
    const result = await service.resolveEntity(internalCaller, "Wenabi");

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.driveTokens.map((entry) => entry.token)).toEqual(
      expect.arrayContaining(["KOMEET (ex WENABI)", "WENABI"]),
    );
  });
});

describe("companyContext.listCompanyCrmActivity", () => {
  it("warns when selector is the portfolioCompanyId (board-name proxy)", async () => {
    const { service, startups } = buildBundle({
      notes: [],
      deals: [],
      meetings: [],
    });
    const result = await service.listCompanyCrmActivity(internalCaller, {
      portfolioCompanyId: "Atlas",
      includeNotes: true,
      includeDeals: true,
      includeMeetings: true,
    });
    expect(startups.listAccessibleNotes).toHaveBeenCalledWith(
      internalCaller,
      { startupName: "Atlas" },
      { limit: 15 },
    );
    expect(startups.listAccessibleDeals).toHaveBeenCalledWith(
      internalCaller,
      { startupName: "Atlas" },
      { limit: 10 },
    );
    expect(startups.listAccessibleMeetings).toHaveBeenCalledWith(
      internalCaller,
      { startupName: "Atlas" },
      { limit: 10 },
    );
    expect(result.warnings.some((w) => /board-derived/i.test(w))).toBe(true);
  });

  it("respects include flags", async () => {
    const { service, startups } = buildBundle({
      notes: [{ id: "n1", startupId: "s1", authorEmail: "a", body: "b", sensitivity: "internal", createdAt: "2026-01-01", source: { system: "hubspot", externalId: "n1", url: undefined } }],
      deals: [],
      meetings: [],
    });
    const result = await service.listCompanyCrmActivity(internalCaller, {
      startupId: "s1",
      includeNotes: false,
      includeDeals: true,
      includeMeetings: false,
    });
    expect(result.notes).toEqual([]);
    expect(startups.listAccessibleNotes).not.toHaveBeenCalled();
    expect(startups.listAccessibleDeals).toHaveBeenCalledOnce();
    expect(startups.listAccessibleMeetings).not.toHaveBeenCalled();
  });

  it("rejects when no selector is provided", async () => {
    const { service } = buildBundle({});
    await expect(
      service.listCompanyCrmActivity(internalCaller, {
        includeNotes: true,
        includeDeals: true,
        includeMeetings: true,
      }),
    ).rejects.toThrow(/Provide startupId/);
  });
});

describe("companyContext.listCompanyDocuments", () => {
  it("calls society scope guard and returns documents with citations", async () => {
    const { service, society } = buildBundle({
      driveFiles: [
        { id: "f1", driveFileId: "f1", title: "Board pack Q1", createdAt: "2026-01-01" },
        { id: "f2", driveFileId: "f2", title: "Memo Atlas", createdAt: "2026-02-01" },
      ],
    });
    const result = await service.listCompanyDocuments(internalCaller, "Atlas");
    expect(society.ensurePortfolioCompanyInScope).toHaveBeenCalledWith(
      internalCaller,
      "Atlas",
    );
    expect(result.documents).toHaveLength(2);
    expect(result.documents[0]?.citation).toMatchObject({
      system: "drive",
      externalId: "f1",
    });
  });

  it("applies titleContains filter", async () => {
    const { service } = buildBundle({
      driveFiles: [
        { id: "f1", driveFileId: "f1", title: "Board pack Q1", createdAt: "2026-01-01" },
        { id: "f2", driveFileId: "f2", title: "Memo Atlas", createdAt: "2026-02-01" },
      ],
    });
    const result = await service.listCompanyDocuments(internalCaller, "Atlas", {
      titleContains: "memo",
    });
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]?.title).toBe("Memo Atlas");
  });

  it("truncates and warns when limit is exceeded", async () => {
    const files = Array.from({ length: 30 }, (_, i) => ({
      id: `f${i}`,
      driveFileId: `f${i}`,
      title: `File ${i}`,
      createdAt: "2026-01-01",
    }));
    const { service } = buildBundle({ driveFiles: files });
    const result = await service.listCompanyDocuments(internalCaller, "Atlas", {
      limit: 5,
    });
    expect(result.documents).toHaveLength(5);
    expect(result.warnings.some((w) => /truncated/i.test(w))).toBe(true);
  });

  it("warns when Drive returns no files", async () => {
    const { service } = buildBundle({ driveFiles: [] });
    const result = await service.listCompanyDocuments(internalCaller, "Atlas");
    expect(result.documents).toEqual([]);
    expect(result.warnings.some((w) => /No Drive files/i.test(w))).toBe(true);
  });

  it("omits binary files by default and exposes relevance metadata", async () => {
    const { service } = buildBundle({
      driveFiles: [
        {
          id: "pdf_1",
          driveFileId: "pdf_1",
          title: "Legal PV.pdf",
          createdAt: "2026-05-01",
          mimeType: "application/pdf",
        },
        {
          id: "deck_1",
          driveFileId: "deck_1",
          title: "Atlas pitch deck",
          createdAt: "2026-04-01",
        },
      ],
    });
    const result = await service.listCompanyDocuments(internalCaller, "Atlas");
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]?.driveFileId).toBe("deck_1");
    expect(result.documents[0]?.relevance).toBe("deck");
    expect(result.documents[0]?.textExtractable).toBe(true);
  });
});

describe("companyContext.readCompanyDocumentExcerpt", () => {
  it("rejects driveFileId that is not in the listing", async () => {
    const { service } = buildBundle({
      driveFiles: [{ id: "f1", driveFileId: "f1", title: "X", createdAt: "2026-01-01" }],
    });
    await expect(
      service.readCompanyDocumentExcerpt(internalCaller, {
        portfolioCompanyId: "Atlas",
        driveFileId: "other",
        maxChars: 2000,
      }),
    ).rejects.toThrow(/not listed/);
  });

  it("returns the excerpt and detects offset past end", async () => {
    const text = "Lorem ipsum ".repeat(20);
    const { service } = buildBundle({
      driveFiles: [{ id: "f1", driveFileId: "f1", title: "X", createdAt: "2026-01-01" }],
      driveText: text,
    });
    const result = await service.readCompanyDocumentExcerpt(internalCaller, {
      portfolioCompanyId: "Atlas",
      driveFileId: "f1",
      maxChars: 9000,
      charOffset: text.length + 10,
    });
    expect(result.excerpt).toBe("");
    expect(result.warnings.some((w) => /past document end/i.test(w))).toBe(true);
  });

  it("warns when maxChars is clamped to the minimum window", async () => {
    const { service } = buildBundle({
      driveFiles: [{ id: "f1", driveFileId: "f1", title: "X", createdAt: "2026-01-01" }],
      driveText: "x".repeat(1000),
    });
    const result = await service.readCompanyDocumentExcerpt(internalCaller, {
      portfolioCompanyId: "Atlas",
      driveFileId: "f1",
      maxChars: 100,
    });
    expect(result.warnings.some((w) => /clamped/i.test(w))).toBe(true);
  });

  it("flags binary content", async () => {
    const { service } = buildBundle({
      driveFiles: [{ id: "f1", driveFileId: "f1", title: "X.pdf", createdAt: "2026-01-01" }],
      driveText: "[X.pdf — binary format (application/pdf), text extraction not supported]",
    });
    const result = await service.readCompanyDocumentExcerpt(internalCaller, {
      portfolioCompanyId: "Atlas",
      driveFileId: "f1",
      maxChars: 2000,
    });
    expect(result.warnings.some((w) => /binar/i.test(w))).toBe(true);
  });
});

describe("companyContext.listPortfolioContext", () => {
  it("returns scoped data and warns when row missing", async () => {
    const { service } = buildBundle({
      portfolio: [],
      signals: [
        {
          id: "sig",
          portfolioCompanyId: "Atlas",
          kind: "risk",
          summary: "Cash runway",
          detectedAt: "2026-01-01",
          sourceUrl: undefined,
          visibilityTier: "internal_only",
        },
      ],
    });
    const result = await service.listPortfolioContext(internalCaller, "Atlas");
    expect(result.signals).toHaveLength(1);
    expect(result.portfolioRow).toBeUndefined();
    expect(result.warnings.some((w) => /not present in Monday/i.test(w))).toBe(true);
  });
});

describe("companyContext.buildCompany360Context", () => {
  it("rejects when no selector is provided", async () => {
    const { service } = buildBundle({});
    await expect(
      service.buildCompany360Context(internalCaller, { sections: ["profile"] }),
    ).rejects.toThrow(/Provide portfolioCompanyId/);
  });

  it("throws with matches list when startupName is ambiguous", async () => {
    const { service } = buildBundle({
      startups: [
        startup({ id: "s1", name: "Atlas Bio" }),
        startup({ id: "s2", name: "Atlas Labs" }),
      ],
    });
    await expect(
      service.buildCompany360Context(internalCaller, {
        sections: ["profile"],
        startupName: "atlas",
      }),
    ).rejects.toThrow(/multiple startups/i);
  });

  it("warns when portfolioCompanyId-only request needs CRM sections", async () => {
    const { service } = buildBundle({
      portfolio: [portfolioRow({ id: "Atlas", startupId: "Atlas" })],
      startups: [],
      driveFiles: [],
    });
    const result = await service.buildCompany360Context(internalCaller, {
      sections: ["profile", "crm_activity"],
      portfolioCompanyId: "Atlas",
    });
    expect(result.warnings.some((w) => /board-derived/i.test(w))).toBe(true);
  });

  it("assembles documents + signals when only portfolio selector is given", async () => {
    const { service } = buildBundle({
      portfolio: [portfolioRow({ id: "Atlas", startupId: "Atlas" })],
      startups: [],
      driveFiles: [
        { id: "f1", driveFileId: "f1", title: "Board pack", createdAt: "2026-01-01" },
      ],
      signals: [
        {
          id: "sig",
          portfolioCompanyId: "Atlas",
          kind: "press",
          summary: "Featured in Les Echos",
          detectedAt: "2026-01-01",
          sourceUrl: undefined,
          visibilityTier: "shared_with_investors",
        },
      ],
    });
    const result = await service.buildCompany360Context(internalCaller, {
      sections: ["documents", "portfolio_signals"],
      portfolioCompanyId: "Atlas",
    });
    expect(result.documents).toHaveLength(1);
    expect(result.signals).toHaveLength(1);
  });
});
