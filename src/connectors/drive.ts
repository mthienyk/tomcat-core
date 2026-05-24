import { readFileSync } from "fs";
import { GoogleAuth } from "google-auth-library";
import { ConnectorFailed, ConnectorNotConfigured, CoreError } from "../errors/index.js";
import type { DriveConnector } from "./types.js";
import { createHttpClient, type HttpClient } from "./http.js";

const DRIVE_BASE = "https://www.googleapis.com/drive/v3";

const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";
const GOOGLE_SLIDES_MIME = "application/vnd.google-apps.presentation";
const GOOGLE_SHEET_MIME = "application/vnd.google-apps.spreadsheet";

const TEXT_EXPORT_MIMES: Partial<Record<string, string>> = {
  [GOOGLE_DOC_MIME]: "text/plain",
  [GOOGLE_SLIDES_MIME]: "text/plain",
  [GOOGLE_SHEET_MIME]: "text/csv",
};

const FOLDER_MIME = "application/vnd.google-apps.folder";

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  createdTime: string;
  modifiedTime?: string;
  parents?: string[];
};

type DriveListResponse = {
  files?: DriveFile[];
  nextPageToken?: string;
};

const escapeQuery = (raw: string): string => raw.replace(/'/g, "\\'");

export const createUnconfiguredDriveConnector = (): DriveConnector => ({
  listBoardPacksForCompany: () =>
    Promise.reject(ConnectorNotConfigured("drive", "listBoardPacksForCompany")),
  listCompanyFolders: () =>
    Promise.reject(ConnectorNotConfigured("drive", "listCompanyFolders")),
  listFolderChildren: () =>
    Promise.reject(ConnectorNotConfigured("drive", "listFolderChildren")),
  resolveItemPath: () =>
    Promise.reject(ConnectorNotConfigured("drive", "resolveItemPath")),
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
    if (!token) throw ConnectorFailed("drive: failed to obtain access token");
    return token;
  };

  const buildClient = async (): Promise<HttpClient> => {
    const token = await getToken();
    return createHttpClient({
      connector: "drive",
      baseUrl: DRIVE_BASE,
      defaultHeaders: { Authorization: `Bearer ${token}` },
      timeoutMs: 20_000,
      maxAttempts: 3,
    });
  };

  const listFiles = async (
    client: HttpClient,
    query: string,
  ): Promise<DriveFile[]> => {
    const out: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        q: query,
        pageSize: "100",
        fields:
          "nextPageToken, files(id,name,mimeType,createdTime,modifiedTime,parents)",
        includeItemsFromAllDrives: "true",
        supportsAllDrives: "true",
        orderBy: "createdTime desc",
      });
      if (sharedDriveId) {
        params.set("corpora", "drive");
        params.set("driveId", sharedDriveId);
      }
      if (pageToken) params.set("pageToken", pageToken);

      const data = await client.json<DriveListResponse>(
        `/files?${params.toString()}`,
      );
      out.push(...(data.files ?? []));
      pageToken = data.nextPageToken;
    } while (pageToken);
    return out;
  };

  return {
    async listCompanyFolders(portfolioCompanyId) {
      try {
        const client = await buildClient();
        const escapedName = escapeQuery(portfolioCompanyId);
        const query =
          `name contains '${escapedName}' and trashed = false and mimeType = '${FOLDER_MIME}'`;
        const files = await listFiles(client, query);
        return files.map((folder) => ({
          driveFolderId: folder.id,
          name: folder.name,
          createdTime: folder.createdTime,
          modifiedTime: folder.modifiedTime ?? folder.createdTime,
          parentIds: folder.parents ?? [],
        }));
      } catch (err) {
        if (err instanceof CoreError) throw err;
        throw ConnectorFailed("drive.listCompanyFolders failed", {
          cause: String(err),
        });
      }
    },

    async listFolderChildren(driveFolderId) {
      try {
        const client = await buildClient();
        const escapedId = escapeQuery(driveFolderId);
        const query = `'${escapedId}' in parents and trashed = false`;
        const files = await listFiles(client, query);
        return files.map((item) => ({
          driveFileId: item.id,
          name: item.name,
          mimeType: item.mimeType,
          kind: item.mimeType === FOLDER_MIME ? "folder" as const : "file" as const,
          createdTime: item.createdTime,
          modifiedTime: item.modifiedTime ?? item.createdTime,
        }));
      } catch (err) {
        if (err instanceof CoreError) throw err;
        throw ConnectorFailed("drive.listFolderChildren failed", {
          cause: String(err),
        });
      }
    },

    async resolveItemPath(driveItemId) {
      try {
        const client = await buildClient();
        const segments: string[] = [];
        let currentId: string | undefined = driveItemId;

        type DrivePathMeta = {
          id: string;
          name: string;
          parents?: string[];
        };

        while (currentId) {
          const itemMeta: DrivePathMeta = await client.json<DrivePathMeta>(
            `/files/${currentId}?fields=id,name,parents&supportsAllDrives=true`,
          );
          segments.unshift(itemMeta.name);
          currentId = itemMeta.parents?.[0];
        }

        return segments.join(" / ");
      } catch (err) {
        if (err instanceof CoreError) throw err;
        throw ConnectorFailed("drive.resolveItemPath failed", {
          cause: String(err),
        });
      }
    },

    async listBoardPacksForCompany(portfolioCompanyId) {
      try {
        const client = await buildClient();
        // Search across the entire shared drive (any folder), not only its root.
        // Drive's `name contains` is a substring match without word boundaries,
        // so we keep the company name as-is and rely on the indexer.
        const escapedName = escapeQuery(portfolioCompanyId);
        const query = `name contains '${escapedName}' and trashed = false and mimeType != 'application/vnd.google-apps.folder'`;

        const files = await listFiles(client, query);
        return files.map((f) => ({
          id: f.id,
          title: f.name,
          driveFileId: f.id,
          createdAt: f.createdTime,
          mimeType: f.mimeType,
        }));
      } catch (err) {
        if (err instanceof CoreError) throw err;
        throw ConnectorFailed("drive.listBoardPacksForCompany failed", {
          cause: String(err),
        });
      }
    },

    async fetchDocumentText(driveFileId) {
      try {
        const client = await buildClient();
        const meta = await client.json<{ id: string; name: string; mimeType: string }>(
          `/files/${driveFileId}?fields=id,name,mimeType&supportsAllDrives=true`,
        );

        const exportMime = TEXT_EXPORT_MIMES[meta.mimeType];
        if (exportMime) {
          const exportRes = await client.request(
            `/files/${driveFileId}/export?mimeType=${encodeURIComponent(exportMime)}&supportsAllDrives=true`,
          );
          return exportRes.text();
        }

        // PDFs and other binary formats need a dedicated extraction pipeline.
        return `[${meta.name} — binary format (${meta.mimeType}), text extraction not supported]`;
      } catch (err) {
        if (err instanceof CoreError) throw err;
        throw ConnectorFailed("drive.fetchDocumentText failed", {
          cause: String(err),
        });
      }
    },
  };
};
