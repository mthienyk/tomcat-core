import { describe, expect, it } from "vitest";
import {
  classifyBpFilename,
  inferBpWorkflowMode,
  refineSpreadsheetClassification,
} from "../../src/services/bpClassify.js";

describe("bpClassify", () => {
  it("classifies founder BP xlsx vs analysis workbooks", () => {
    expect(classifyBpFilename("eSwit BP Tomcat.xlsx")).toBe("tomcat_labeled");
    expect(
      refineSpreadsheetClassification(
        "tomcat_labeled",
        "eSwit BP Tomcat.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ),
    ).toBe("founder_bp_xlsx");

    expect(classifyBpFilename("Supply Finder - BP synthèse M2.xlsx")).toBe("analysis");
  });

  it("infers hybrid when founder BP and payroll inputs coexist", () => {
    const { mode, rationale } = inferBpWorkflowMode({
      founderBpCount: 1,
      payrollInputCount: 1,
      debtInputCount: 0,
      canonicalTabHits: 0,
      canonicalTabTotal: 8,
    });
    expect(mode).toBe("hybrid");
    expect(rationale).toContain("overlay");
  });

  it("infers transform for founder BP alone", () => {
    const { mode } = inferBpWorkflowMode({
      founderBpCount: 1,
      payrollInputCount: 0,
      debtInputCount: 0,
      canonicalTabHits: 2,
      canonicalTabTotal: 8,
    });
    expect(mode).toBe("transform");
  });

  it("infers generate when only inputs present", () => {
    const { mode } = inferBpWorkflowMode({
      founderBpCount: 0,
      payrollInputCount: 1,
      debtInputCount: 1,
      canonicalTabHits: 0,
      canonicalTabTotal: 8,
    });
    expect(mode).toBe("generate");
  });
});
