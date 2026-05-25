import { describe, expect, it } from "vitest";
import { buildCoverageReport, buildBpReviewBrief } from "../../src/services/bpReviewBrief.js";
import type { BpBusinessPlanDraft } from "../../src/playbooks/bp/template-schema.js";

const baseDraft = (overrides: Partial<BpBusinessPlanDraft> = {}): BpBusinessPlanDraft => ({
  portfolioCompanyId: "webyn",
  mode: "transform",
  tabMappings: [],
  manualReviewTabs: ["ca", "aace"],
  unmappedFounderTabs: [],
  financement: {
    tabSlug: "financement",
    instruments: [{ label: "BNP", instrumentType: "private_loan", amount: 200_000 }],
  },
  rh: {
    tabSlug: "rh",
    roles: [{ role: "CEO", headcount: 1 }],
  },
  ...overrides,
});

describe("bpReviewBrief", () => {
  it("reports honest editable-tab coverage", () => {
    const coverage = buildCoverageReport({ draft: baseDraft(), placeholdersUsed: false });
    expect(coverage.editableTabsTotal).toBe(4);
    expect(coverage.editableTabsAutoFilled).toBe(2);
    expect(coverage.autoFillPct).toBe(50);
  });

  it("builds French review brief for the agent", () => {
    const draft = baseDraft();
    const coverage = buildCoverageReport({ draft, placeholdersUsed: false });
    const brief = buildBpReviewBrief({
      companyLabel: "Webyn",
      draft,
      coverage,
      mode: "transform",
      sourceBpTitle: "20260106_Webyn_Business Plan.xlsx",
    });
    expect(brief.summaryForChat).toContain("Webyn");
    expect(brief.agentTasks.some((t) => t.includes("utilisateur"))).toBe(true);
    expect(brief.confirmBeforeExport.some((t) => t.includes("export"))).toBe(true);
  });
});
