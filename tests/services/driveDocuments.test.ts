import { describe, expect, it } from "vitest";
import {
  isMarketingDriveAsset,
  isTextExtractableDriveFile,
  prepareDriveDocumentList,
  rankDeckCandidates,
  scoreDriveDocumentRelevance,
} from "../../src/services/driveDocuments.js";

describe("driveDocuments", () => {
  it("ranks board packs and decks above legal PDFs", () => {
    const { documents, warnings } = prepareDriveDocumentList(
      [
        {
          driveFileId: "pdf_1",
          title: "20241025_Wenabi x Vendredi_PV attribution actions.pdf",
          createdAt: "2026-05-01",
          mimeType: "application/pdf",
        },
        {
          driveFileId: "deck_1",
          title: "Wenabi Investor Deck Q1",
          createdAt: "2026-04-01",
        },
        {
          driveFileId: "board_1",
          title: "Wenabi Q1 Board Pack",
          createdAt: "2026-03-01",
        },
      ],
      { includeBinaries: false, limit: 5 },
    );

    expect(documents.map((file) => file.driveFileId)).toEqual(["board_1", "deck_1"]);
    expect(warnings.some((warning) => /binary file/i.test(warning))).toBe(true);
  });

  it("detects binary formats from mime type or extension", () => {
    expect(
      isTextExtractableDriveFile("application/pdf", "report.pdf"),
    ).toBe(false);
    expect(
      isTextExtractableDriveFile(
        "application/vnd.google-apps.presentation",
        "Pitch",
      ),
    ).toBe(true);
    expect(scoreDriveDocumentRelevance("Atlas board pack 2026").relevance).toBe(
      "board_pack",
    );
  });

  it("filters marketing assets and ranks deck candidates by relevance and date", () => {
    expect(isMarketingDriveAsset("Wenabi logo pack")).toBe(true);
    expect(isMarketingDriveAsset("Wenabi Investor Deck Q2")).toBe(false);

    const ranked = rankDeckCandidates([
      {
        driveFileId: "logo_1",
        title: "Wenabi logo pack",
        createdAt: "2026-05-01",
        mimeType: "image/png",
      },
      {
        driveFileId: "deck_old",
        title: "Wenabi pitch deck 2024",
        createdAt: "2024-01-01",
      },
      {
        driveFileId: "deck_new",
        title: "Wenabi Investor Deck Q2",
        createdAt: "2026-04-15",
        mimeType: "application/vnd.google-apps.presentation",
      },
    ]);

    expect(ranked.map((file) => file.driveFileId)).toEqual(["deck_new", "deck_old"]);
  });

  it("prefers pitch decks over financial business plans", () => {
    const ranked = rankDeckCandidates([
      {
        driveFileId: "bp_1",
        title: "20210505 - wenabi - BP Financier V2 - CONFIDENTIEL.xlsx",
        createdAt: "2026-05-01",
      },
      {
        driveFileId: "deck_1",
        title: "Wenabi Investor Deck Q2",
        createdAt: "2026-04-01",
        mimeType: "application/vnd.google-apps.presentation",
      },
    ]);

    expect(ranked[0]?.driveFileId).toBe("deck_1");
  });
});
