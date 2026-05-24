import { describe, expect, it, vi } from "vitest";
import {
  assertDriveFileInCompanyScope,
  rankDriveFilesForBpWorkflow,
} from "../../src/services/driveCompanyFiles.js";
import type { Connectors } from "../../src/connectors/registry.js";

describe("driveCompanyFiles", () => {
  it("rankDriveFilesForBpWorkflow prioritizes BP spreadsheets over reporting PDFs", () => {
    const ranked = rankDriveFilesForBpWorkflow([
      {
        id: "r1",
        driveFileId: "r1",
        title: "202603 - Seedext - Reporting Q1.pdf",
        createdAt: "2026-03-01",
        mimeType: "application/pdf",
      },
      {
        id: "bp1",
        driveFileId: "bp1",
        title: "20251124_Seedext_Suivi financier.xlsx",
        createdAt: "2025-11-24",
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    ]);

    expect(ranked[0]?.driveFileId).toBe("bp1");
  });

  it("assertDriveFileInCompanyScope tries alternate drive tokens", async () => {
    const drive = {
      listBoardPacksForCompany: vi.fn(async (token: string) =>
        token === "KOMEET (ex WENABI)"
          ? [
              {
                id: "f1",
                driveFileId: "f1",
                title: "Wenabi BP.xlsx",
                createdAt: "2026-01-01",
                mimeType:
                  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              },
            ]
          : [],
      ),
    } as unknown as Connectors["drive"];

    const hit = await assertDriveFileInCompanyScope(drive, "Wenabi", "f1", [
      {
        token: "Wenabi",
        source: "hubspot_name",
        confidence: 0.85,
        matchReason: "hubspot_canonical_name",
      },
      {
        token: "KOMEET (ex WENABI)",
        source: "parenthetical_alias",
        confidence: 0.9,
        matchReason: "parenthetical_alias",
      },
    ]);

    expect(hit.driveFileId).toBe("f1");
  });
});
