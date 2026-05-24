import type { Connectors } from "../connectors/registry.js";

export type DriveListing = Awaited<
  ReturnType<Connectors["drive"]["listBoardPacksForCompany"]>
>[number];

export type DriveTokenLookupResult = {
  token: string;
  files: DriveListing[];
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
