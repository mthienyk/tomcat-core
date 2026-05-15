import { describe, expect, it, vi, beforeEach } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Stub googleapis auth before importing the connector under test.
vi.mock("google-auth-library", () => ({
  GoogleAuth: class {
    async getAccessToken(): Promise<string> {
      return "fake-token";
    }
  },
}));

const { createHttpDriveConnector } = await import("../../src/connectors/drive.js");

const writeFakeCreds = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "tomcat-drive-"));
  const path = join(dir, "creds.json");
  writeFileSync(
    path,
    JSON.stringify({
      type: "service_account",
      client_email: "fake@example.iam.gserviceaccount.com",
      private_key: "fake",
    }),
  );
  return path;
};

const okJson = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const okText = (body: string): Response =>
  new Response(body, { status: 200, headers: { "Content-Type": "text/plain" } });

describe("createHttpDriveConnector", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("paginates listBoardPacksForCompany across nextPageToken", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        okJson({
          files: [
            { id: "1", name: "Aistos Q1", mimeType: "application/pdf", createdTime: "2026-01-01T00:00:00Z" },
          ],
          nextPageToken: "p2",
        }),
      )
      .mockResolvedValueOnce(
        okJson({
          files: [
            { id: "2", name: "Aistos Q2", mimeType: "application/pdf", createdTime: "2026-04-01T00:00:00Z" },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchImpl);

    const drive = createHttpDriveConnector(writeFakeCreds(), "shared-drive-id");
    const packs = await drive.listBoardPacksForCompany("Aistos");

    expect(packs).toHaveLength(2);
    expect(packs.map((p) => p.id)).toEqual(["1", "2"]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const firstUrl = String(fetchImpl.mock.calls[0]?.[0]);
    expect(firstUrl).toContain("driveId=shared-drive-id");
    expect(firstUrl).toContain("corpora=drive");
    expect(firstUrl).toContain("includeItemsFromAllDrives=true");
    expect(firstUrl).toContain("mimeType+%21%3D+%27application%2Fvnd.google-apps.folder%27");
  });

  it("exports Google Sheets as CSV", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        okJson({
          id: "abc",
          name: "Captable",
          mimeType: "application/vnd.google-apps.spreadsheet",
        }),
      )
      .mockResolvedValueOnce(okText("a,b\n1,2\n"));
    vi.stubGlobal("fetch", fetchImpl);

    const drive = createHttpDriveConnector(writeFakeCreds());
    const text = await drive.fetchDocumentText("abc");

    expect(text).toContain("a,b");
    const exportUrl = String(fetchImpl.mock.calls[1]?.[0]);
    expect(exportUrl).toContain("export?mimeType=text%2Fcsv");
  });

  it("returns descriptive placeholder for binary mimes", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      okJson({ id: "p", name: "Deck.pdf", mimeType: "application/pdf" }),
    );
    vi.stubGlobal("fetch", fetchImpl);

    const drive = createHttpDriveConnector(writeFakeCreds());
    const text = await drive.fetchDocumentText("p");
    expect(text).toContain("binary format");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
