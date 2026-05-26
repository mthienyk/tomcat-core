import { describe, expect, it, vi } from "vitest";
import { buildGrepCrmNotesService } from "../../src/services/crmMemory/grepCrmNotes.js";
import type { Identity } from "../../src/domain/identity.js";

const caller: Identity = {
  kind: "human",
  email: "mcp@tomcat.eu",
  domain: "tomcat.eu",
  role: "internal_team",
  team: undefined,
  investorId: undefined,
};

describe("grepCrmNotes service", () => {
  it("suggests find_similar_cases when keyword search returns no matches", async () => {
    const service = buildGrepCrmNotesService({
      store: {
        grepNotes: vi.fn().mockResolvedValue([]),
        grepKnowledgeIndexMeta: vi.fn().mockResolvedValue([]),
      },
      startups: {
        listAllVisibleStartups: vi.fn().mockResolvedValue([
          {
            id: "hs_1",
            name: "Acme",
            sectors: [],
            stage: "seed",
            country: "FR",
            description: undefined,
            visibilityTier: "internal_only",
            sources: [],
          },
        ]),
      },
    } as never);

    const result = await service.grepCrmNotes(caller, {
      query: "perd des utilisateurs",
    });

    expect(result.data.matches).toHaveLength(0);
    expect(result.nextSuggestedTools?.[0]).toEqual({
      toolName: "find_similar_cases",
      reason: "Semantic fallback when keywords are absent from note bodies",
      arguments: { query: "perd des utilisateurs" },
    });
  });
});
