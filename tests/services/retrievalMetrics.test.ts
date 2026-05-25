import { describe, expect, it } from "vitest";
import {
  hitAtK,
  namesMatch,
  ndcgAtK,
  recallInTopK,
  relevanceGrade,
} from "../../src/services/crmMemory/retrievalMetrics.js";

describe("retrievalMetrics", () => {
  it("matches startup names case-insensitively with partial overlap", () => {
    expect(namesMatch("Pinql", "pinql")).toBe(true);
    expect(namesMatch("Lisy ex Snapkey", "Lisy")).toBe(true);
  });

  it("assigns descending relevance grades for ordered expectations", () => {
    const expected = ["NessPay", "Empowill", "Vysion"];
    expect(relevanceGrade("NessPay", expected)).toBe(3);
    expect(relevanceGrade("Empowill", expected)).toBe(2);
    expect(relevanceGrade("InterFast", expected)).toBe(0);
  });

  it("computes nDCG@5 with perfect ranking", () => {
    const retrieved = ["Pinql", "Nopillo", "Avis-Locataire", "Other"];
    const expected = ["Pinql", "Nopillo", "Avis-Locataire"];
    expect(ndcgAtK(retrieved, expected, 5)).toBe(1);
  });

  it("computes nDCG@5 below 1 when ranking is imperfect", () => {
    const retrieved = ["Nopillo", "Pinql", "Avis-Locataire"];
    const expected = ["Pinql", "Nopillo", "Avis-Locataire"];
    expect(ndcgAtK(retrieved, expected, 5)).toBeLessThan(1);
    expect(ndcgAtK(retrieved, expected, 5)).toBeGreaterThan(0.8);
  });

  it("computes hit@k and recall@k", () => {
    const retrieved = ["A", "B", "C", "D", "E"];
    expect(hitAtK(retrieved, ["B", "Z"], 3)).toBe(true);
    expect(recallInTopK(retrieved, ["B", "Z"], 5)).toBe(0.5);
  });
});
