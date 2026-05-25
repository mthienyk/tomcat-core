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

describe("similarCases service", () => {
  it("aggregates vector hits by startup and returns company-level matches", async () => {
    const store = {
      countIndexedKnowledgeChunks: vi.fn().mockResolvedValue(12),
      searchKnowledgeChunks: vi.fn().mockResolvedValue([
        {
          chunkId: "chunk_1",
          noteId: "note_1",
          startupId: "hs_peer",
          chunkKind: "investment_lens",
          chunkText: "Crowded HR payroll market with accountant-led GTM.",
          score: 0.91,
          authorEmail: "elie.dupredesaintmaur@tomcat.eu",
          noteCreatedAt: "2024-03-01T10:00:00Z",
          meta: {
            noteKind: "m1_m2",
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
            confidence: "high",
            language: "en",
          },
        },
      ]),
      getNoteById: vi.fn().mockResolvedValue({
        id: "note_1",
        startupId: "hs_peer",
        authorEmail: "elie.dupredesaintmaur@tomcat.eu",
        body: "M1 — PeerCo",
        sensitivity: "internal",
        createdAt: "2024-03-01T10:00:00Z",
        source: { system: "hubspot", externalId: "note_1" },
      }),
    };

    const startups = {
      searchStartups: vi.fn(async (_caller, query) => {
        if (query.startupId === "hs_ref") return [refStartup];
        if (query.startupId === "hs_peer") return [peerStartup];
        return [];
      }),
      listAccessibleNotes: vi.fn().mockResolvedValue([]),
    };

    const hyde = {
      generateHydeQueries: vi.fn().mockResolvedValue({
        searchIntent: "Find similar HR payroll cases",
        hypotheticalNotes: [
          "M1 — SMB payroll SaaS with accountant-led GTM and churn concerns.",
        ],
      }),
    };

    const embeddings = {
      model: "text-embedding-3-small",
      dimensions: 1536,
      embed: vi.fn().mockResolvedValue([Array(1536).fill(0.01)]),
    };

    const service = buildSimilarCasesService({
      store: store as never,
      startups: startups as never,
      embeddings,
      hyde,
    });

    const result = await service.findSimilarCases(caller, {
      startupId: "hs_ref",
      limit: 5,
    });

    expect(result.data.searchBasis).toBe("startup_profile");
    expect(result.data.matchCount).toBe(1);
    expect(result.data.matches[0]?.startupId).toBe("hs_peer");
    expect(result.data.matches[0]?.topEvidence[0]?.noteId).toBe("note_1");
    expect(result.nextSuggestedTools?.[0]?.toolName).toBe("read_startup_notes");
  });

  it("warns when the semantic index is empty", async () => {
    const service = buildSimilarCasesService({
      store: {
        countIndexedKnowledgeChunks: vi.fn().mockResolvedValue(0),
        searchKnowledgeChunks: vi.fn().mockResolvedValue([]),
        getNoteById: vi.fn(),
      } as never,
      startups: {
        searchStartups: vi.fn().mockResolvedValue([refStartup]),
        listAccessibleNotes: vi.fn().mockResolvedValue([]),
      } as never,
      embeddings: {
        model: "text-embedding-3-small",
        dimensions: 1536,
        embed: vi.fn().mockResolvedValue([Array(1536).fill(0.01)]),
      },
      hyde: {
        generateHydeQueries: vi.fn().mockResolvedValue({
          searchIntent: "test",
          hypotheticalNotes: ["test note"],
        }),
      },
    });

    const result = await service.findSimilarCases(caller, {
      startupId: "hs_ref",
    });

    expect(result.warnings.some((w) => w.code === "CRM_MEMORY_INDEX_EMPTY")).toBe(
      true,
    );
  });
});
