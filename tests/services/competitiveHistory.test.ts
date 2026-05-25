import { describe, expect, it, vi } from "vitest";
import { buildCompetitiveHistoryService } from "../../src/services/competitiveHistory.js";
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

describe("competitiveHistory service", () => {
  it("returns matches with note excerpts in ToolRunEnvelope", async () => {
    const startups = {
      searchStartups: vi.fn().mockResolvedValue([refStartup]),
      findSimilar: vi.fn().mockResolvedValue([peerStartup]),
      listAccessibleNotes: vi.fn().mockResolvedValue([
        {
          id: "note_1",
          body: "Strong M1 — competitive with legacy HR suites.",
          sensitivity: "internal",
          createdAt: "2026-05-01",
          startupId: "hs_peer",
          authorEmail: "elie@tomcat.eu",
          source: { system: "hubspot", externalId: "note_1" },
        },
      ]),
    };

    const service = buildCompetitiveHistoryService({ startups: startups as never });
    const result = await service.findCompetitiveHistory(caller, {
      startupId: "hs_ref",
    });

    expect(result.data.referenceStartup?.id).toBe("hs_ref");
    expect(result.data.matchCount).toBe(1);
    expect(result.data.matches[0]?.recentNotes[0]?.id).toBe("note_1");
    expect(result.nextSuggestedTools?.[0]?.toolName).toBe("read_startup_notes");
  });

  it("returns ambiguous warning when startupName matches multiple", async () => {
    const startups = {
      searchStartups: vi.fn().mockResolvedValue([refStartup, peerStartup]),
      findSimilar: vi.fn(),
      listAccessibleNotes: vi.fn(),
    };

    const service = buildCompetitiveHistoryService({ startups: startups as never });
    const result = await service.findCompetitiveHistory(caller, {
      startupName: "Acme",
    });

    expect(result.data.matchCount).toBe(0);
    expect(result.warnings[0]?.code).toBe("AMBIGUOUS_STARTUP");
    expect(result.nextSuggestedTools?.[0]?.toolName).toBe("resolve_entity");
  });

  it("rejects calls with no seed selector", async () => {
    const service = buildCompetitiveHistoryService({
      startups: {} as never,
    });
    await expect(service.findCompetitiveHistory(caller, {})).rejects.toThrow(
      /Provide startupId, startupName, or sector/,
    );
  });

  it("warns when startupId is unknown", async () => {
    const startups = {
      searchStartups: vi.fn().mockResolvedValue([]),
      findSimilar: vi.fn().mockResolvedValue([]),
      listAccessibleNotes: vi.fn(),
    };
    const service = buildCompetitiveHistoryService({ startups: startups as never });
    const result = await service.findCompetitiveHistory(caller, {
      startupId: "hs_missing",
    });

    expect(result.warnings.some((w) => w.code === "REFERENCE_NOT_FOUND")).toBe(
      true,
    );
    expect(result.data.matchCount).toBe(0);
  });

  it("supports sector-only filter with searchBasis sector_filter", async () => {
    const startups = {
      searchStartups: vi.fn(),
      findSimilar: vi.fn().mockResolvedValue([peerStartup]),
      listAccessibleNotes: vi.fn().mockResolvedValue([]),
    };
    const service = buildCompetitiveHistoryService({ startups: startups as never });
    const result = await service.findCompetitiveHistory(caller, {
      sector: "saas",
    });

    expect(result.data.searchBasis).toBe("sector_filter");
    expect(result.data.matchCount).toBe(1);
    expect(
      result.warnings.some((w) => w.code === "REFERENCE_NOT_FOUND"),
    ).toBe(false);
  });

  it("uses NO_SECTOR_MATCHES when reference has no peers", async () => {
    const startups = {
      searchStartups: vi.fn().mockResolvedValue([refStartup]),
      findSimilar: vi.fn().mockResolvedValue([]),
      listAccessibleNotes: vi.fn(),
    };
    const service = buildCompetitiveHistoryService({ startups: startups as never });
    const result = await service.findCompetitiveHistory(caller, {
      startupId: "hs_ref",
    });

    expect(result.warnings[0]?.code).toBe("NO_SECTOR_MATCHES");
  });

  it("passes authorEmail filter and ranks M1 notes above recent short notes", async () => {
    const startups = {
      searchStartups: vi.fn().mockResolvedValue([refStartup]),
      findSimilar: vi.fn().mockResolvedValue([peerStartup]),
      listAccessibleNotes: vi.fn().mockResolvedValue([
        {
          id: "note_short",
          body: "Quick ping after call.",
          sensitivity: "internal",
          createdAt: "2026-05-20T10:00:00Z",
          startupId: "hs_peer",
          authorEmail: "elie.dupredesaintmaur@tomcat.eu",
          source: { system: "hubspot", externalId: "note_short" },
        },
        {
          id: "note_m1",
          body: "M1 — competitive with legacy HR suites on payroll.",
          sensitivity: "internal",
          createdAt: "2024-03-01T10:00:00Z",
          startupId: "hs_peer",
          authorEmail: "elie.dupredesaintmaur@tomcat.eu",
          source: { system: "hubspot", externalId: "note_m1" },
        },
      ]),
    };

    const service = buildCompetitiveHistoryService({ startups: startups as never });
    const result = await service.findCompetitiveHistory(caller, {
      startupId: "hs_ref",
      authorEmail: "elie.dupredesaintmaur@tomcat.eu",
      notesPerMatch: 1,
    });

    expect(startups.listAccessibleNotes).toHaveBeenCalledWith(
      caller,
      "hs_peer",
      expect.objectContaining({
        authorEmail: "elie.dupredesaintmaur@tomcat.eu",
      }),
    );
    expect(result.data.matches[0]?.recentNotes[0]?.id).toBe("note_m1");
    expect(result.data.matches[0]?.recentNotes[0]?.authorEmail).toBe(
      "elie.dupredesaintmaur@tomcat.eu",
    );
  });

  it("falls back to sector when startupId is unknown and does not warn REFERENCE_NOT_FOUND", async () => {
    const startups = {
      searchStartups: vi.fn().mockResolvedValue([]),
      findSimilar: vi.fn().mockResolvedValue([peerStartup]),
      listAccessibleNotes: vi.fn().mockResolvedValue([]),
    };
    const service = buildCompetitiveHistoryService({ startups: startups as never });
    const result = await service.findCompetitiveHistory(caller, {
      startupId: "hs_missing",
      sector: "saas",
    });

    expect(result.data.searchBasis).toBe("sector_filter");
    expect(result.data.matchCount).toBe(1);
    expect(
      result.warnings.some((w) => w.code === "REFERENCE_NOT_FOUND"),
    ).toBe(false);
    expect(startups.findSimilar).toHaveBeenCalledWith(
      caller,
      expect.objectContaining({ sector: "saas" }),
      expect.anything(),
    );
  });
});
