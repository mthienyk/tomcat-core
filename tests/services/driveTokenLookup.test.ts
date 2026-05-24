import { describe, expect, it, vi } from "vitest";
import type { Connectors } from "../../src/connectors/registry.js";
import {
  listDriveFilesForTokens,
  listDriveFoldersForTokens,
} from "../../src/services/driveTokenLookup.js";

describe("driveTokenLookup", () => {
  it("listDriveFilesForTokens returns the first token with files", async () => {
    const drive = {
      listBoardPacksForCompany: vi.fn(async (token: string) =>
        token === "WENABI" ? [{ driveFileId: "f1", title: "Wenabi deck", createdAt: "2026-01-01" }] : [],
      ),
    } as unknown as Connectors["drive"];

    const result = await listDriveFilesForTokens(drive, ["Wenabi", "WENABI"]);
    expect(result?.token).toBe("WENABI");
    expect(result?.files).toHaveLength(1);
  });

  it("listDriveFoldersForTokens returns the first token with folders", async () => {
    const drive = {
      listCompanyFolders: vi.fn(async (token: string) =>
        token === "KOMEET (ex WENABI)"
          ? [
              {
                driveFolderId: "folder_1",
                name: "KOMEET (ex WENABI)",
                createdTime: "2026-01-01T00:00:00Z",
                modifiedTime: "2026-05-01T00:00:00Z",
                parentIds: [],
              },
            ]
          : [],
      ),
    } as unknown as Connectors["drive"];

    const result = await listDriveFoldersForTokens(drive, [
      "Wenabi",
      "KOMEET (ex WENABI)",
    ]);
    expect(result?.token).toBe("KOMEET (ex WENABI)");
    expect(result?.folders).toHaveLength(1);
  });
});
