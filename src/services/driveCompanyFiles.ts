import { BadRequest } from "../errors/index.js";
import type { Connectors } from "../connectors/registry.js";
import {
  classifyBpFilename,
  matchesBpWorkflowTitle,
  refineSpreadsheetClassification,
  type BpDriveFileClassification,
} from "./bpClassify.js";
import { inferMimeTypeFromTitle, scoreDriveDocumentRelevance } from "./driveDocuments.js";
import { rankDriveTokens, type DriveTokenCandidate } from "./entityResolution.js";
import { listDriveFilesForTokens } from "./driveTokenLookup.js";

export type DriveCompanyFileRef = {
  id: string;
  title: string;
  driveFileId: string;
  createdAt: string;
  mimeType?: string;
};

const BP_CLASSIFICATION_BOOST: Partial<Record<BpDriveFileClassification, number>> = {
  founder_bp_xlsx: 45,
  tomcat_labeled: 35,
  debt_input: 30,
  payroll_input: 20,
  founder_bp_other: 15,
  analysis: 5,
  template_ref: -100,
};

export const resolveDriveFileMimeType = (
  title: string,
  mimeType: string | undefined,
): string | undefined => mimeType ?? inferMimeTypeFromTitle(title);

/** BP-aware relevance ranking before truncation (spreadsheets and BP titles first). */
export const rankDriveFilesForBpWorkflow = (
  files: DriveCompanyFileRef[],
): DriveCompanyFileRef[] =>
  [...files]
    .map((file) => {
      const mimeType = resolveDriveFileMimeType(file.title, file.mimeType);
      const base = classifyBpFilename(file.title);
      const classification = refineSpreadsheetClassification(
        base,
        file.title,
        mimeType,
      );
      const { score: titleScore } = scoreDriveDocumentRelevance(file.title);
      const classBoost = BP_CLASSIFICATION_BOOST[classification] ?? 0;
      const ranked: DriveCompanyFileRef = {
        id: file.id,
        title: file.title,
        driveFileId: file.driveFileId,
        createdAt: file.createdAt,
        ...(mimeType !== undefined ? { mimeType } : {}),
      };
      return { file: ranked, score: titleScore + classBoost };
    })
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return right.file.createdAt.localeCompare(left.file.createdAt);
    })
    .map((entry) => entry.file);

export const assertDriveFileInCompanyScope = async (
  drive: Connectors["drive"],
  portfolioCompanyId: string,
  driveFileId: string,
  driveTokens?: DriveTokenCandidate[],
): Promise<DriveCompanyFileRef> => {
  const tokens = rankDriveTokens(portfolioCompanyId, driveTokens ?? []);
  for (const token of tokens) {
    const files = await drive.listBoardPacksForCompany(token);
    const hit = files.find((file) => file.driveFileId === driveFileId);
    if (hit) {
      const mimeType = resolveDriveFileMimeType(hit.title, hit.mimeType);
      return {
        id: hit.id,
        title: hit.title,
        driveFileId: hit.driveFileId,
        createdAt: hit.createdAt,
        ...(mimeType !== undefined ? { mimeType } : {}),
      };
    }
  }

  throw BadRequest(
    "driveFileId is not listed for this portfolio company. Call assemble_company_finance_pack or list_company_documents first.",
    {
      driveFileId,
      portfolioCompanyId,
      scopeReason: "not_in_drive_listing",
    },
  );
};

export const listRankedDriveFilesForTokens = async (
  drive: Connectors["drive"],
  portfolioCompanyId: string,
  driveTokens: DriveTokenCandidate[] | undefined,
  titleContains: string | undefined,
  options?: { bpWorkflowTitlesOnly?: boolean },
): Promise<{
  files: DriveCompanyFileRef[];
  driveTokenUsed: string;
  driveTokensTried: string[];
  listedBeforeFilter: number;
}> => {
  const driveTokensTried = rankDriveTokens(portfolioCompanyId, driveTokens ?? []);
  const lookup = await listDriveFilesForTokens(drive, driveTokensTried);
  const ranked = rankDriveFilesForBpWorkflow(lookup?.files ?? []);
  const listedBeforeFilter = ranked.length;
  let files = ranked;
  if (titleContains?.trim()) {
    const needle = titleContains.trim().toLowerCase();
    files = files.filter((file) => file.title.toLowerCase().includes(needle));
  } else if (options?.bpWorkflowTitlesOnly) {
    files = files.filter((file) => matchesBpWorkflowTitle(file.title));
  }
  return {
    files,
    driveTokenUsed: lookup?.token ?? driveTokensTried[0] ?? portfolioCompanyId,
    driveTokensTried,
    listedBeforeFilter,
  };
};
