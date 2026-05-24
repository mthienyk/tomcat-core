import { describe, expect, it, vi } from "vitest";
import { buildStoreBackedConnectors } from "../../src/connectors/storeBacked.js";
import type { CoreStore } from "../../src/storage/coreStore.js";
import type { Connectors } from "../../src/connectors/registry.js";

describe("storeBacked drive listing", () => {
  it("falls back to live Drive when cache is empty for a company", async () => {
    const store = {
      getFreshness: vi.fn(async () => ({
        dataset: "drive.boardPacks",
        healthy: true,
        lastSyncAt: "2026-01-01T00:00:00Z",
        recordsTotal: 10,
        updatedAt: "2026-01-01T00:00:00Z",
      })),
      listBoardPacksForCompany: vi.fn(async () => []),
    } as unknown as CoreStore;

    const live = {
      drive: {
        listBoardPacksForCompany: vi.fn(async () => [
          {
            id: "live1",
            title: "Casawatt - Business plan.xlsx",
            driveFileId: "live1",
            createdAt: "2026-01-13",
            mimeType:
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          },
        ]),
      },
    } as unknown as Connectors;

    const connectors = buildStoreBackedConnectors(store, live);
    const files = await connectors.drive.listBoardPacksForCompany("Casawatt");

    expect(files).toHaveLength(1);
    expect(live.drive.listBoardPacksForCompany).toHaveBeenCalledWith("Casawatt");
  });
});
