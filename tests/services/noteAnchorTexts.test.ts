import { describe, expect, it } from "vitest";
import { resolveNoteAnchorQueryTexts } from "../../src/services/crmMemory/noteAnchorTexts.js";

describe("resolveNoteAnchorQueryTexts", () => {
  it("prefers indexed recap and investment_lens over raw body", () => {
    const result = resolveNoteAnchorQueryTexts({
      chunks: [
        { chunkKind: "recap", chunkText: "Empowill — HR Tech SaaS, 100 k€ MRR." },
        {
          chunkKind: "investment_lens",
          chunkText: "Strong go M2 on blue-collar SMB retention.",
        },
      ],
      noteBody: "Long raw HubSpot M1 note body…",
    });

    expect(result.usedIndexedChunks).toBe(true);
    expect(result.queryTexts).toEqual([
      "Empowill — HR Tech SaaS, 100 k€ MRR.",
      "Strong go M2 on blue-collar SMB retention.",
    ]);
  });

  it("falls back to raw body when no indexed chunks exist", () => {
    const body = "M1 debrief with long content.";
    const result = resolveNoteAnchorQueryTexts({
      chunks: [],
      noteBody: body,
    });

    expect(result.usedIndexedChunks).toBe(false);
    expect(result.queryTexts).toEqual([body]);
  });
});
