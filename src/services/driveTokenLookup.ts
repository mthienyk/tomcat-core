import type { Connectors } from "../connectors/registry.js";
import type { DriveFolderRef } from "../connectors/types.js";

export type DriveListing = Awaited<
  ReturnType<Connectors["drive"]["listBoardPacksForCompany"]>
>[number];

export type DriveTokenLookupResult = {
  token: string;
  files: DriveListing[];
};

export type DriveFolderTokenLookupResult = {
  token: string;
  folders: DriveFolderRef[];
};

export const listDriveFilesForTokens = async (
  drive: Connectors["drive"],
  tokens: string[],
): Promise<DriveTokenLookupResult | undefined> => {
  for (const token of tokens) {
    const files = await drive.listBoardPacksForCompany(token);
    if (files.length > 0) {
      return { token, files };
    }
  }
  return undefined;
};

export const listDriveFoldersForTokens = async (
  drive: Connectors["drive"],
  tokens: string[],
): Promise<DriveFolderTokenLookupResult | undefined> => {
  for (const token of tokens) {
    const folders = await drive.listCompanyFolders(token);
    if (folders.length > 0) {
      return { token, folders };
    }
  }
  return undefined;
};
