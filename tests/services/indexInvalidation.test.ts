import { describe, expect, it } from "vitest";
import {
  planSemanticIndexOnNoteUpsert,
  semanticIndexFieldsChanged,
} from "../../src/services/crmMemory/indexInvalidation.js";
import {
  MIN_SEMANTIC_INDEX_BODY_LENGTH,
  noteIndexSkipHash,
} from "../../src/services/crmMemory/indexEligibility.js";

const longBody = "M1 — strong team, payroll wedge, churn cohort. ".repeat(12);
const shortBody = "Short ops note.";

describe("indexInvalidation", () => {
  it("detects semantic index field changes", () => {
    expect(
      semanticIndexFieldsChanged(
        { body: longBody, startupId: "1", authorEmail: "a@tomcat.eu" },
        { body: `${longBody} updated`, startupId: "1", authorEmail: "a@tomcat.eu" },
      ),
    ).toBe(true);
    expect(
      semanticIndexFieldsChanged(
        { body: longBody, startupId: "1", authorEmail: "a@tomcat.eu" },
        { body: longBody, startupId: "1", authorEmail: "a@tomcat.eu" },
      ),
    ).toBe(false);
  });

  it("marks new short notes as skip:short immediately", () => {
    const plan = planSemanticIndexOnNoteUpsert(undefined, {
      body: shortBody,
      startupId: "42",
      authorEmail: "a@tomcat.eu",
    });

    expect(plan.shouldDeleteChunks).toBe(true);
    expect(plan.keepExistingHash).toBe(false);
    expect(plan.nextSemanticIndexHash).toBe(
      noteIndexSkipHash("short", shortBody),
    );
  });

  it("reopens indexing when a long note body changes", () => {
    const plan = planSemanticIndexOnNoteUpsert(
      {
        body: longBody,
        startupId: "42",
        authorEmail: "a@tomcat.eu",
      },
      {
        body: `${longBody} updated`,
        startupId: "42",
        authorEmail: "a@tomcat.eu",
      },
    );

    expect(plan.shouldDeleteChunks).toBe(true);
    expect(plan.nextSemanticIndexHash).toBeNull();
  });

  it("preserves hash when non-index fields would change only", () => {
    const plan = planSemanticIndexOnNoteUpsert(
      {
        body: longBody,
        startupId: "42",
        authorEmail: "a@tomcat.eu",
      },
      {
        body: longBody,
        startupId: "42",
        authorEmail: "a@tomcat.eu",
      },
    );

    expect(plan.keepExistingHash).toBe(true);
    expect(plan.shouldDeleteChunks).toBe(false);
  });

  it("uses the 500-char threshold for short-note detection", () => {
    const borderline = "x".repeat(MIN_SEMANTIC_INDEX_BODY_LENGTH - 1);
    expect(planSemanticIndexOnNoteUpsert(undefined, {
      body: borderline,
      startupId: "42",
      authorEmail: "a@tomcat.eu",
    }).nextSemanticIndexHash).toMatch(/^skip:short:/);
  });
});
