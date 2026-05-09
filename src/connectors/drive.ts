import { ConnectorFailed, ConnectorNotConfigured } from "../errors/index.js";
import type { DriveConnector } from "./types.js";

export const createUnconfiguredDriveConnector = (): DriveConnector => ({
  listBoardPacksForCompany: async () =>
    Promise.reject(
      ConnectorNotConfigured("drive", "listBoardPacksForCompany"),
    ),
  fetchDocumentText: async () =>
    Promise.reject(ConnectorNotConfigured("drive", "fetchDocumentText")),
});

export const createHttpDriveConnector = (_jsonCreds: string): DriveConnector => {
  const notImplemented = (op: string): never => {
    throw ConnectorFailed(
      `Drive connector "${op}" not yet implemented. Provide GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON and complete the client.`,
    );
  };
  return {
    listBoardPacksForCompany: async () => notImplemented("listBoardPacksForCompany"),
    fetchDocumentText: async () => notImplemented("fetchDocumentText"),
  };
};
