import { describe, expect, it } from "vitest";
import type { Note } from "../../src/domain/entities.js";
import {
  isM1M2SynthesisNote,
  matchesAuthorEmail,
  noteQualityBoost,
  rankNotesByQuality,
} from "../../src/services/noteRanking.js";

const note = (overrides: Partial<Note> & Pick<Note, "id" | "body">): Note => ({
  startupId: "hs_1",
  authorEmail: "elie.dupredesaintmaur@tomcat.eu",
  sensitivity: "internal",
  createdAt: "2026-05-01T10:00:00Z",
  source: { system: "hubspot", externalId: overrides.id },
  ...overrides,
});

describe("noteRanking", () => {
  it("boosts M1/M2 and exec summary patterns", () => {
    expect(noteQualityBoost("Short ops ping")).toBe(0);
    expect(noteQualityBoost("M1 — strong team, weak GTM")).toBe(60);
    expect(noteQualityBoost("Exec summary for board")).toBe(80);
  });

  it("matches author email case-insensitively", () => {
    const elieNote = note({
      id: "n1",
      body: "test",
      authorEmail: "Elie.DupreDesaintMaur@tomcat.eu",
    });
    expect(matchesAuthorEmail(elieNote, "elie.dupredesaintmaur@tomcat.eu")).toBe(
      true,
    );
    expect(matchesAuthorEmail(elieNote, "kevin@tomcat.eu")).toBe(false);
  });

  it("ranks M1 synthesis above recent short notes", () => {
    const ranked = rankNotesByQuality([
      note({
        id: "recent_short",
        body: "Quick follow-up",
        createdAt: "2026-05-20T10:00:00Z",
      }),
      note({
        id: "old_m1",
        body: "M2 exec summary: payroll B2B churn remains high.",
        createdAt: "2024-01-01T10:00:00Z",
      }),
    ]);

    expect(ranked[0]?.id).toBe("old_m1");
    expect(isM1M2SynthesisNote(ranked[0]!.body)).toBe(true);
  });
});
