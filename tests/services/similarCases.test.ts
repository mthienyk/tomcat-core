import { describe, expect, it, vi } from "vitest";
import { buildSimilarCasesService } from "../../src/services/crmMemory/similarCases.js";
import type { Identity } from "../../src/domain/identity.js";
import type { Startup } from "../../src/domain/entities.js";

const caller: Identity = {
  kind: "human",
  email: "mcp@tomcat.eu",
  domain: "tomcat.eu",
  role: "internal_team",
  team: undefined,
  investorId: undefined,
};

const refStartup: Startup = {
  id: "hs_ref",
  name: "Acme HR",
  sectors: ["saas"],
  stage: "seed",
  country: "FR",
  description: undefined,
  visibilityTier: "internal_only",
  sources: [{ system: "hubspot", externalId: "hs_ref" }],
};

const peerStartup: Startup = {
  id: "hs_peer",
  name: "PeerCo",
  sectors: ["saas"],
  stage: "series_a",
  country: "FR",
  description: undefined,
  visibilityTier: "internal_only",
  sources: [{ system: "hubspot", externalId: "hs_peer" }],
};

const chunkHit = {
  chunkId: "chunk_1",
  noteId: "note_1",
  startupId: "hs_peer",
  chunkKind: "investment_lens" as const,
  chunkText: "Crowded HR payroll market with accountant-led GTM.",
  score: 0.91,
  authorEmail: "elie.dupredesaintmaur@tomcat.eu",
  noteCreatedAt: "2024-03-01T10:00:00Z",
  meta: {
    noteKind: "m1_m2" as const,
    recap: "HR payroll seed with accountant channel",
    investmentLens: "Crowded market, wedge is credible",
    markets: ["HR payroll"],
    customerSegments: ["SMB"],
    businessModel: "SaaS",
    gtmMotion: "Accountant channel",
    redFlags: ["High churn"],
    positiveSignals: ["120 customers"],
    competitorNames: ["PayFit"],
    tomcatTake: "Interesting if churn improves",
    questionsToReuse: ["NRR by cohort?"],
    confidence: "high" as const,
    language: "en",
  },
};

const buildService = (overrides: {
  store?: Record<string, unknown>;
  startups?: Record<string, unknown>;
  embed?: ReturnType<typeof vi.fn>;
} = {}) => {
  const embed =
    overrides.embed
    ?? vi.fn().mockResolvedValue([Array(1536).fill(0.01)]);

  return buildSimilarCasesService({
    store: {
      countIndexedKnowledgeChunks: vi.fn().mockResolvedValue(12),
      searchKnowledgeChunks: vi.fn().mockResolvedValue([chunkHit]),
      getNoteById: vi.fn().mockResolvedValue({
        id: "note_1",
        startupId: "hs_peer",
        authorEmail: "elie.dupredesaintmaur@tomcat.eu",
        body: "M1 — PeerCo",
        sensitivity: "internal",
        createdAt: "2024-03-01T10:00:00Z",
        source: { system: "hubspot", externalId: "note_1" },
      }),
      ...overrides.store,
    } as never,
    startups: {
      searchStartups: vi.fn(async (_caller, query) => {
        if (query.startupId === "hs_ref") return [refStartup];
        if (query.startupId === "hs_peer") return [peerStartup];
        return [];
      }),
      listAccessibleNotes: vi.fn().mockResolvedValue([]),
      ...overrides.startups,
    } as never,
    embeddings: {
      model: "text-embedding-3-small",
      dimensions: 1536,
      embed,
    },
  });
};

describe("similarCases service", () => {
  it("aggregates vector hits from client searchTexts and excludes reference startup", async () => {
    const embed = vi.fn().mockResolvedValue([Array(1536).fill(0.01)]);
    const service = buildService({ embed });

    const result = await service.findSimilarCases(caller, {
      startupId: "hs_ref",
      searchTexts: [
        "M1 — SMB payroll SaaS with accountant-led GTM and churn concerns.",
      ],
      limit: 5,
    });

    expect(result.data.searchBasis).toBe("client_text");
    expect(result.data.matchCount).toBe(1);
    expect(result.data.matches[0]?.startupId).toBe("hs_peer");
    expect(result.data.matches[0]?.topEvidence[0]?.noteId).toBe("note_1");
    expect(embed).toHaveBeenCalledWith([
      "M1 — SMB payroll SaaS with accountant-led GTM and churn concerns.",
    ]);
    expect(result.nextSuggestedTools?.[0]?.toolName).toBe("read_startup_notes");
  });

  it("embeds query directly for free_text fallback", async () => {
    const embed = vi.fn().mockResolvedValue([Array(1536).fill(0.01)]);
    const service = buildService({ embed });

    const result = await service.findSimilarCases(caller, {
      query: "payroll B2B churn accountant channel",
    });

    expect(result.data.searchBasis).toBe("free_text");
    expect(embed).toHaveBeenCalledWith(["payroll B2B churn accountant channel"]);
  });

  it("requires searchTexts, query, or noteId", async () => {
    const service = buildService();

    await expect(
      service.findSimilarCases(caller, { startupId: "hs_ref" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("warns when the semantic index is empty", async () => {
    const service = buildService({
      store: {
        countIndexedKnowledgeChunks: vi.fn().mockResolvedValue(0),
        searchKnowledgeChunks: vi.fn().mockResolvedValue([]),
        getNoteById: vi.fn(),
      },
    });

    const result = await service.findSimilarCases(caller, {
      searchTexts: ["M1 — payroll SaaS"],
    });

    expect(result.warnings.some((w) => w.code === "CRM_MEMORY_INDEX_EMPTY")).toBe(
      true,
    );
  });

  it("returns empty results when sector filter matches no startups", async () => {
    const searchKnowledgeChunks = vi.fn();
    const service = buildService({
      store: {
        countIndexedKnowledgeChunks: vi.fn().mockResolvedValue(12),
        searchKnowledgeChunks,
        getNoteById: vi.fn(),
      },
      startups: {
        searchStartups: vi.fn(async (_caller, query) => {
          if (query.sector) return [];
          if (query.startupId === "hs_ref") return [refStartup];
          return [];
        }),
        listAccessibleNotes: vi.fn().mockResolvedValue([]),
      },
    });

    const result = await service.findSimilarCases(caller, {
      startupId: "hs_ref",
      sector: "nonexistent-vertical",
      searchTexts: ["M1 — payroll SaaS"],
    });

    expect(result.data.matchCount).toBe(0);
    expect(result.warnings.some((w) => w.code === "NO_SECTOR_MATCHES")).toBe(true);
    expect(searchKnowledgeChunks).not.toHaveBeenCalled();
  });

  it("rejects note anchors the caller cannot read", async () => {
    const service = buildService({
      store: {
        countIndexedKnowledgeChunks: vi.fn().mockResolvedValue(12),
        searchKnowledgeChunks: vi.fn(),
        getNoteById: vi.fn().mockResolvedValue({
          id: "note_secret",
          startupId: "hs_peer",
          authorEmail: "elie.dupredesaintmaur@tomcat.eu",
          body: "Confidential M1 note",
          sensitivity: "confidential",
          createdAt: "2024-03-01T10:00:00Z",
          source: { system: "hubspot", externalId: "note_secret" },
        }),
      },
      startups: {
        searchStartups: vi.fn(),
        listAccessibleNotes: vi.fn(),
      },
    });

    await expect(
      service.findSimilarCases(caller, { noteId: "note_secret" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});
