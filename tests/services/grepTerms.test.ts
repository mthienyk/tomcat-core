import { describe, expect, it } from "vitest";
import {
  buildIlikePattern,
  escapeIlikePattern,
  filterGrepTerms,
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

  it("filters ambiguous French terms in matchMode any", () => {
    expect(filterGrepTerms(["Rosaly", "avance", "salaire"], "any")).toEqual([
      "Rosaly",
    ]);
  });

  it("keeps all terms in matchMode all", () => {
    expect(filterGrepTerms(["Rosaly", "avance"], "all")).toEqual([
      "Rosaly",
      "avance",
    ]);
  });
});
