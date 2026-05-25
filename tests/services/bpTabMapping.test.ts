import { describe, expect, it } from "vitest";
import { mapFounderWorkbookTabs } from "../../src/services/bpTabMapping.js";

describe("bpTabMapping", () => {
  it("maps Webyn-style tabs without swallowing duplicates silently in unmapped", () => {
    const { mappings, duplicateFounderTabs } = mapFounderWorkbookTabs([
      "BP-Revenues",
      "HYP-Revenues",
      "BP-People Costs",
      "BNP Loan",
    ]);
    expect(mappings.some((m) => m.canonicalSlug === "ca")).toBe(true);
    expect(mappings.some((m) => m.canonicalSlug === "rh")).toBe(true);
    expect(mappings.some((m) => m.canonicalSlug === "financement")).toBe(true);
    expect(duplicateFounderTabs).toContain("HYP-Revenues");
  });
});
