import { describe, expect, it } from "vitest";
import {
  buildDriveTokens,
  extractParentheticalAliases,
  matchConfidence,
  rankDriveTokens,
  tokenOverlapScore,
  tokenizeEntityName,
} from "../../src/services/entityResolution.js";

describe("entityResolution", () => {
  it("extracts parenthetical aliases", () => {
    expect(extractParentheticalAliases("KOMEET (ex WENABI)")).toEqual(["WENABI"]);
    expect(extractParentheticalAliases("Atlas (formerly Atlas Bio)")).toEqual([
      "Atlas Bio",
    ]);
  });

  it("tokenizes entity names", () => {
    expect(tokenizeEntityName("KOMEET (ex WENABI)")).toEqual(["komeet", "ex", "wenabi"]);
  });

  it("scores token overlap", () => {
    expect(tokenOverlapScore("Wenabi", "KOMEET ex WENABI")).toBeGreaterThan(0.3);
    expect(tokenOverlapScore("Atlas", "Bloom")).toBe(0);
  });

  it("ranks match confidence", () => {
    expect(matchConfidence("Atlas", "Atlas")).toEqual({
      confidence: 1,
      reason: "exact",
    });
    expect(matchConfidence("wenabi", "KOMEET (ex WENABI)").confidence).toBeGreaterThan(
      0.5,
    );
  });

  it("builds drive tokens from portfolio id and canonical name", () => {
    const tokens = buildDriveTokens({
      canonicalName: "Wenabi",
      portfolioCompanyId: "KOMEET (ex WENABI)",
    });

    expect(tokens.map((entry) => entry.token)).toEqual(
      expect.arrayContaining(["KOMEET (ex WENABI)", "WENABI", "komeet"]),
    );
    expect(tokens[0]?.token).toBe("KOMEET (ex WENABI)");
  });

  it("ranks drive tokens with primary first", () => {
    const ranked = rankDriveTokens("Wenabi", buildDriveTokens({
      canonicalName: "Wenabi",
      portfolioCompanyId: "KOMEET (ex WENABI)",
    }));

    expect(ranked[0]).toBe("Wenabi");
    expect(ranked).toContain("KOMEET (ex WENABI)");
  });
});
