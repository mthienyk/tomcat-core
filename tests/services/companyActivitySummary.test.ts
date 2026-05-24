import { describe, expect, it, vi } from "vitest";
import { buildCompanyActivitySummaryService } from "../../src/services/companyActivitySummary.js";
import type { Identity } from "../../src/domain/identity.js";
import type { Startup } from "../../src/domain/entities.js";

const caller: Identity = {
  kind: "human",
  email: "elie@tomcat.eu",
  domain: "tomcat.eu",
  role: "internal_team",
  team: undefined,
  investorId: undefined,
};

const wenabi: Startup = {
  id: "9426764108",
  name: "Wenabi",
  sectors: ["climate"],
  stage: "unknown",
  country: "FR",
  description: undefined,
  visibilityTier: "internal_only",
  sources: [{ system: "hubspot", externalId: "9426764108" }],
};

describe("companyActivitySummary service", () => {
  it("returns ranked CRM facts in a ToolRunEnvelope", async () => {
    const startups = {
      searchStartups: vi.fn(async () => [wenabi]),
      listAccessibleNotes: vi.fn(async () => [
        {
          id: "note_1",
          startupId: "9426764108",
          authorEmail: "elie@tomcat.eu",
          body: "M1 exec summary: strong enterprise traction and long sales cycles.",
          sensitivity: "internal",
          createdAt: "2026-05-20T10:00:00Z",
          source: { system: "hubspot", externalId: "note_1" },
        },
      ]),
      listAccessibleDeals: vi.fn(async () => [
        {
          id: "deal_1",
          startupId: "9426764108",
          ownerEmail: "elie@tomcat.eu",
          status: "invested",
          amountEur: 150_000,
          updatedAt: "2026-05-21T16:33:48Z",
          visibilityTier: "shared_with_investors",
        },
      ]),
      listAccessibleMeetings: vi.fn(async () => [
        {
          id: "meet_1",
          startupId: "9426764108",
          subject: "Call Wenabi - Tomcat Talents",
          attendees: [],
          occurredAt: "2026-05-22T14:00:00Z",
          source: { system: "hubspot", externalId: "meet_1" },
        },
      ]),
    };

    const service = buildCompanyActivitySummaryService({
      startups: startups as never,
    });

    const result = await service.summarizeCompanyActivity(caller, {
      startupId: "9426764108",
      factLimit: 5,
    });

    expect(result.data.canonicalName).toBe("Wenabi");
    expect(result.data.facts.length).toBeGreaterThan(0);
    expect(result.data.summary.notesScanned).toBe(1);
    expect(result.data.summary.activePipelineDeals).toBe(0);
    expect(result.citations.length).toBe(result.data.facts.length);
    expect(
      result.nextSuggestedTools?.some(
        (tool) => tool.toolName === "find_competitive_history",
      ),
    ).toBe(true);
    expect(
      result.nextSuggestedTools?.some(
        (tool) => tool.toolName === "find_latest_deck",
      ),
    ).toBe(true);
  });

  it("ranks substantive diligence notes above stale screening deals", async () => {
    const startups = {
      searchStartups: vi.fn(async () => [wenabi]),
      listAccessibleNotes: vi.fn(async () => [
        {
          id: "note_m1",
          startupId: "9426764108",
          authorEmail: "elie@tomcat.eu",
          body: "M1 exec summary: strong enterprise traction and long sales cycles.",
          sensitivity: "internal",
          createdAt: "2021-06-01T10:00:00Z",
          source: { system: "hubspot", externalId: "note_m1" },
        },
      ]),
      listAccessibleDeals: vi.fn(async () => [
        {
          id: "deal_screen",
          startupId: "9426764108",
          ownerEmail: "elie@tomcat.eu",
          status: "screening",
          amountEur: undefined,
          updatedAt: "2026-05-21T16:33:48Z",
          visibilityTier: "internal_only",
        },
      ]),
      listAccessibleMeetings: vi.fn(async () => []),
    };

    const service = buildCompanyActivitySummaryService({
      startups: startups as never,
    });

    const result = await service.summarizeCompanyActivity(caller, {
      startupId: "9426764108",
      factLimit: 3,
    });

    expect(result.data.facts[0]?.kind).toBe("note");
    expect(result.data.facts[0]?.id).toBe("note_m1");
  });

  it("warns when CRM activity is empty", async () => {
    const startups = {
      searchStartups: vi.fn(async () => [wenabi]),
      listAccessibleNotes: vi.fn(async () => []),
      listAccessibleDeals: vi.fn(async () => []),
      listAccessibleMeetings: vi.fn(async () => []),
    };

    const service = buildCompanyActivitySummaryService({
      startups: startups as never,
    });

    const result = await service.summarizeCompanyActivity(caller, {
      startupName: "Wenabi",
    });

    expect(result.warnings.some((w) => w.code === "CRM_ACTIVITY_EMPTY")).toBe(
      true,
    );
    expect(result.data.facts).toEqual([]);
  });
});
