import { readFileSync } from "fs";
import { GoogleAuth } from "google-auth-library";
import { ConnectorFailed, ConnectorNotConfigured, CoreError } from "../errors/index.js";
import type { DriveConnector } from "./types.js";

const DRIVE_BASE = "https://www.googleapis.com/drive/v3";

const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";
const GOOGLE_SLIDES_MIME = "application/vnd.google-apps.presentation";
const EXPORTABLE_MIMES = new Set([GOOGLE_DOC_MIME, GOOGLE_SLIDES_MIME]);

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  createdTime: string;
};

export const createUnconfiguredDriveConnector = (): DriveConnector => ({
  listBoardPacksForCompany: () =>
    Promise.reject(ConnectorNotConfigured("drive", "listBoardPacksForCompany")),
  fetchDocumentText: () =>
    Promise.reject(ConnectorNotConfigured("drive", "fetchDocumentText")),
});

export const createHttpDriveConnector = (
  credentialsSource: string,
  sharedDriveId?: string,
): DriveConnector => {
  const credentials = credentialsSource.trimStart().startsWith("{")
    ? JSON.parse(credentialsSource)
    : JSON.parse(readFileSync(credentialsSource, "utf-8"));

  const auth = new GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });

  const getToken = async (): Promise<string> => {
    const token = await auth.getAccessToken();
    if (!token) throw ConnectorFailed("Drive: failed to obtain access token");
    return token;
  };

  const driveGet = async (path: string, params: Record<string, string> = {}): Promise<unknown> => {
    const token = await getToken();
    const url = new URL(`${DRIVE_BASE}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Drive GET ${path} → HTTP ${res.status}`);
    return res.json();
  };

  const driveGetRaw = async (url: string): Promise<string> => {
    const token = await getToken();
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Drive fetch ${url} → HTTP ${res.status}`);
    return res.text();
  };

  return {
    async listBoardPacksForCompany(portfolioCompanyId) {
      try {
        // portfolioCompanyId is the normalized company name (e.g. "Aistos"), set by Monday connector.
        const escapedName = portfolioCompanyId.replace(/'/g, "\\'");
        const driveClause = sharedDriveId ? ` and '${sharedDriveId}' in parents` : "";
        const q = `name contains '${escapedName}' and trashed = false${driveClause}`;

        const params: Record<string, string> = {
          q,
          pageSize: "100",
          fields: "files(id,name,mimeType,createdTime)",
          includeItemsFromAllDrives: "true",
          supportsAllDrives: "true",
          orderBy: "createdTime desc",
        };
        if (sharedDriveId) {
          params.driveId = sharedDriveId;
          params.corpora = "drive";
        }

        const data = await driveGet("/files", params) as { files?: DriveFile[] };

        return (data.files ?? []).map((f) => ({
          id: f.id,
          title: f.name,
          driveFileId: f.id,
          createdAt: f.createdTime,
        }));
      } catch (err) {
        if (err instanceof CoreError) throw err;
        throw ConnectorFailed("drive.listBoardPacksForCompany failed", { cause: String(err) });
      }
    },

    async fetchDocumentText(driveFileId) {
      try {
        const meta = await driveGet(`/files/${driveFileId}`, {
          fields: "id,name,mimeType",
          supportsAllDrives: "true",
        }) as { id: string; name: string; mimeType: string };

        if (EXPORTABLE_MIMES.has(meta.mimeType)) {
          const exportUrl =
            `${DRIVE_BASE}/files/${driveFileId}/export?mimeType=text%2Fplain&supportsAllDrives=true`;
          return driveGetRaw(exportUrl);
        }

        // PDFs and other binary formats cannot be exported as plain text without a
        // dedicated extraction library. Return metadata so callers know the file exists.
        return `[${meta.name} — binary format (${meta.mimeType}), text extraction not supported]`;
      } catch (err) {
        if (err instanceof CoreError) throw err;
        throw ConnectorFailed("drive.fetchDocumentText failed", { cause: String(err) });
      }
    },
  };
};
