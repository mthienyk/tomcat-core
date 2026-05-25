import { describe, expect, it } from "vitest";
import {
  buildIlikePattern,
  escapeIlikePattern,
  parseGrepTerms,
} from "../../src/services/crmMemory/grepTerms.js";

describe("grepTerms", () => {
  it("parses quoted phrases and plain terms", () => {
    expect(parseGrepTerms('"gestion locative" Silae PayFit')).toEqual([
      "gestion locative",
      "Silae",
      "PayFit",
    ]);
  });

  it("deduplicates terms case-insensitively", () => {
    expect(parseGrepTerms("Silae silae payfit")).toEqual(["Silae", "payfit"]);
  });

  it("drops terms shorter than two characters", () => {
    expect(parseGrepTerms("M1 a Silae")).toEqual(["M1", "Silae"]);
  });

  it("escapes ilike wildcards", () => {
    expect(escapeIlikePattern("100%_done")).toBe("100\\%\\_done");
    expect(buildIlikePattern("100%_done")).toBe("%100\\%\\_done%");
  });
});
