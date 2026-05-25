import { describe, expect, it } from "vitest";
import {
  MIN_SEMANTIC_INDEX_BODY_LENGTH,
  noteIndexSkipHash,
  noteNeedsSemanticIndex,
  parseSemanticIndexState,
  postCardSkipReason,
  preIndexSkipReason,
} from "../../src/services/crmMemory/indexEligibility.js";
import { noteContentHash } from "../../src/services/crmMemory/contentHash.js";

describe("indexEligibility", () => {
  it("skips notes shorter than 500 characters before indexing", () => {
    const body = "Short prep note. ".repeat(10);
    expect(body.trim().length).toBeLessThan(MIN_SEMANTIC_INDEX_BODY_LENGTH);
    expect(preIndexSkipReason(body)).toBe("short");
    expect(
      noteNeedsSemanticIndex({
        body,
        startupId: "42",
        semanticIndexHash: null,
      }),
    ).toBe(false);
  });

  it("marks skipped notes with a stable skip hash", () => {
    const body = "M1 — ".repeat(120);
    const skipHash = noteIndexSkipHash("ops", body);
    expect(parseSemanticIndexState(skipHash)).toEqual({
      kind: "skipped",
      reason: "ops",
      contentHash: noteContentHash(body),
    });
    expect(
      noteNeedsSemanticIndex({
        body,
        startupId: "42",
        semanticIndexHash: skipHash,
      }),
    ).toBe(false);
  });

  it("reopens skipped notes when body changes", () => {
    const body = "M1 — ".repeat(120);
    const skipHash = noteIndexSkipHash("ops", body);
    expect(
      noteNeedsSemanticIndex({
        body: `${body} updated`,
        startupId: "42",
        semanticIndexHash: skipHash,
      }),
    ).toBe(true);
  });

  it("skips ops notes after semantic card extraction", () => {
    expect(postCardSkipReason("ops")).toBe("ops");
    expect(postCardSkipReason("m1_m2")).toBeUndefined();
  });
});
