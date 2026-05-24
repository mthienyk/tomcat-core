import { describe, expect, it, vi } from "vitest";
import {
  buildBoardBriefService,
  projectLegacyBoardPrepEnvelope,
  toLegacyBoardPrepBody,
} from "../../src/services/boardBrief.js";
import type { Connectors } from "../../src/connectors/registry.js";
import type { Identity } from "../../src/domain/identity.js";
import type { SocietyService } from "../../src/services/society.js";
import type { StartupsService } from "../../src/services/startups.js";
import type { SignalHubService } from "../../src/services/signalHub/index.js";
import type {
  Deal,
  Meeting,
  Note,
  PortfolioCompany,
  PortfolioSignal,
  Startup,
} from "../../src/domain/entities.js";

const caller: Identity = {
  kind: "human",
  email: "elie@tomcat.eu",
  domain: "tomcat.eu",
  role: "internal_team",
  team: undefined,
  investorId: undefined,
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

const buildService = (overrides?: {
  signals?: PortfolioSignal[];
  notes?: Note[];
  deals?: Deal[];
  meetings?: Meeting[];
  driveFiles?: Array<{
    id: string;
    title: string;
    driveFileId: string;
    createdAt: string;
  }>;
  linkedInEvents?: Array<{
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
  }>;
}) => {
  const society = {
    ensurePortfolioCompanyInScope: vi.fn(async () => undefined),
  };

  const startups = {
    searchStartups: vi.fn(async () => [startup]),
    listAccessibleNotes: vi.fn(async () => overrides?.notes ?? []),
    listAccessibleDeals: vi.fn(async () => overrides?.deals ?? []),
    listAccessibleMeetings: vi.fn(async () => overrides?.meetings ?? []),
  };

  const signalHub = {
    listEvents: vi.fn(async () => overrides?.linkedInEvents ?? []),
  };

  const connectors = {
    monday: {
      listPortfolio: vi.fn(async () => [portfolioRow]),
      listSignals: vi.fn(async () => overrides?.signals ?? []),
    },
    drive: {
      listBoardPacksForCompany: vi.fn(async () => overrides?.driveFiles ?? []),
    },
    hubspot: {} as never,
    investors: {} as never,
  } as unknown as Connectors;

  const service = buildBoardBriefService({
    connectors,
    startups: startups as unknown as StartupsService,
    society: society as unknown as SocietyService,
    signalHub: signalHub as unknown as SignalHubService,
  });

  return { service, society, startups, signalHub, connectors };
};

describe("boardBrief service", () => {
  it("returns actionable brief with checklist and open questions", async () => {
    const { service } = buildService({
      signals: [
        {
          id: "sig_1",
          portfolioCompanyId: "Webin",
          kind: "product",
          summary: "Launched enterprise tier",
          detectedAt: "2026-05-01",
          sourceUrl: undefined,
          visibilityTier: "internal_only",
        },
        {
          id: "sig_2",
          portfolioCompanyId: "Webin",
          kind: "risk",
          summary: "Churn uptick on SMB segment",
          detectedAt: "2026-05-02",
          sourceUrl: undefined,
          visibilityTier: "internal_only",
        },
      ],
      notes: [
        {
          id: "note_1",
          startupId: "hs_webin",
          authorEmail: "elie@tomcat.eu",
          body: "Board prep: ARR grew 18% QoQ with strong enterprise upsell.",
          sensitivity: "internal",
          createdAt: "2026-05-10",
          source: { system: "hubspot", externalId: "note_1", url: undefined },
        },
      ],
      meetings: [
        {
          id: "meet_1",
          startupId: "hs_webin",
          attendees: ["founder@webin.io"],
          subject: "Board prep call",
          occurredAt: "2026-05-12",
          source: { system: "hubspot", externalId: "meet_1", url: undefined },
        },
      ],
      driveFiles: [
        {
          id: "pack_1",
          title: "Webin Q1 Board Pack",
          driveFileId: "drive_board_1",
          createdAt: "2026-04-15T00:00:00Z",
        },
      ],
      linkedInEvents: [
        {
          id: "li_1",
          source: "serper_public",
          signalType: "post",
          watchedId: "w_1",
          startupId: "hs_webin",
          unipileAccountId: undefined,
          emittedAt: "2026-05-11T00:00:00Z",
          ingestedAt: "2026-05-11T01:00:00Z",
          url: "https://linkedin.com/posts/example",
          rawText: "Excited to share our Q1 milestones.",
          rawPayload: {},
          contentHash: "abc",
        },
      ],
    });

    const result = await service.prepareBoardBrief(caller, {
      portfolioCompanyId: "Webin",
    });

    expect(result.data.canonicalName).toBe("Webin");
    expect(result.data.driveDocuments.latestBoardPack?.driveFileId).toBe(
      "drive_board_1",
    );
    expect(result.data.executiveSnapshot.headlineRisks).toContain(
      "Churn uptick on SMB segment",
    );
    expect(result.data.prepChecklist.some((item) => item.id === "board_deck")).toBe(
      true,
    );
    expect(result.data.prepChecklist.find((item) => item.id === "board_deck")?.status)
      .toBe("ready");
    expect(result.citations.length).toBeGreaterThan(0);
    expect(
      result.nextSuggestedTools?.some(
        (tool) => tool.toolName === "read_company_document_excerpt",
      ),
    ).toBe(true);
  });

  it("warns when all sources are empty", async () => {
    const { service } = buildService();
    const result = await service.prepareBoardBrief(caller, {
      portfolioCompanyId: "Webin",
    });

    expect(result.warnings[0]?.code).toBe("MONDAY_SIGNALS_EMPTY");
    expect(result.data.executiveSnapshot.openQuestions.length).toBeGreaterThan(0);
    expect(result.data.prepChecklist.filter((item) => item.status === "missing").length)
      .toBeGreaterThan(0);
    expect(
      result.nextSuggestedTools?.some(
        (tool) => tool.toolName === "signal_hub_recent_signals",
      ),
    ).toBe(true);
  });

  it("adds soft Monday warning when CRM and Drive cover the gap", async () => {
    const { service } = buildService({
      notes: [
        {
          id: "note_1",
          startupId: "hs_webin",
          authorEmail: "elie@tomcat.eu",
          body: "Recent CRM note for board context.",
          sensitivity: "internal",
          createdAt: "2026-05-10",
          source: { system: "hubspot", externalId: "note_1", url: undefined },
        },
      ],
    });

    const result = await service.prepareBoardBrief(caller, {
      portfolioCompanyId: "Webin",
    });

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.code).toBe("MONDAY_SIGNALS_EMPTY");
    expect(result.data.crmTimeline.recentNotes).toHaveLength(1);
  });

  it("requires a company selector", async () => {
    const { service } = buildService();
    await expect(service.prepareBoardBrief(caller, {})).rejects.toThrow(
      /portfolioCompanyId or at least one startup selector/i,
    );
  });

  it("projects legacy HTTP body from the same orchestration path", async () => {
    const { service } = buildService({
      signals: [
        {
          id: "sig_1",
          portfolioCompanyId: "Webin",
          kind: "product",
          summary: "Enterprise tier launched",
          detectedAt: "2026-05-01",
          sourceUrl: undefined,
          visibilityTier: "internal_only",
        },
      ],
    });

    const body = await service.legacyBoardPrepBody(caller, "Webin");

    expect(body.portfolioCompanyId).toBe("Webin");
    expect(body.highlights).toContain("Enterprise tier launched");
    expect(body.citations.length).toBeGreaterThan(0);
  });

  it("wraps legacy MCP output with deprecation warning", async () => {
    const envelope = {
      data: {
        portfolioCompanyId: "Webin",
        startupId: "hs_webin",
        canonicalName: "Webin",
        executiveSnapshot: {
          headlineHighlights: [],
          headlineRisks: [],
          openQuestions: [],
        },
        mondaySignals: { highlights: ["Hiring"], risks: [], signalCount: 1 },
        crmTimeline: { recentNotes: [], activeDeals: [], recentMeetings: [] },
        driveDocuments: { latestBoardPack: null, recentDocuments: [] },
        linkedInSignals: { signalCount: 0, recentSignals: [] },
        prepChecklist: [],
      },
      citations: [],
      warnings: [],
      nextSuggestedTools: [
        { toolName: "signal_hub_recent_signals", reason: "refresh" },
      ],
    };

    const legacy = projectLegacyBoardPrepEnvelope(envelope);

    expect(legacy.data.highlights).toEqual(["Hiring"]);
    expect(legacy.warnings[0]?.code).toBe("DEPRECATED_TOOL");
    expect(legacy.nextSuggestedTools?.[0]?.toolName).toBe("prepare_board_brief");
    expect(toLegacyBoardPrepBody(envelope.data, envelope.citations).startupId)
      .toBe("hs_webin");
  });
});
