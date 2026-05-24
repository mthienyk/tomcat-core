import { BadRequest } from "../errors/index.js";
import type { Connectors } from "../connectors/registry.js";
import type { DriveFolderRef, DriveItemRef } from "../connectors/types.js";
import type { Identity } from "../domain/identity.js";
import type { Citation } from "../domain/entities.js";
import {
  ToolWarningCodes,
  wrapToolOutput,
  type SuggestedToolCall,
  type ToolWarning,
} from "../domain/mcpToolOutput.js";
import type { SocietyService } from "./society.js";
import type { StartupsService } from "./startups.js";
import { listDriveFoldersForTokens } from "./driveTokenLookup.js";
import {
  rankDriveTokens,
  type DriveTokenCandidate,
} from "./entityResolution.js";

export type DriveFolderPurpose =
  | "company_root"
  | "series_a"
  | "pre_round"
  | "m2_financial"
  | "bp_inputs"
  | "reporting";

export type DriveFolderCandidate = {
  driveFolderId: string;
  name: string;
  path: string;
  purposeMatch: DriveFolderPurpose | undefined;
  modifiedTime: string;
};

export type DriveInventoryItem = {
  driveFileId: string;
  name: string;
  kind: "folder" | "file";
  mimeType: string;
  modifiedTime: string;
};

export type ResolveCompanyDriveFolderData = {
  portfolioCompanyId: string;
  canonicalName: string | undefined;
  purpose: DriveFolderPurpose;
  driveTokenUsed: string;
  driveTokensTried: string[];
  primaryFolder: DriveFolderCandidate | null;
  folderCandidates: DriveFolderCandidate[];
  inventory: DriveInventoryItem[];
  presentInputs: string[];
  missingInputs: string[];
};

const PURPOSE_KEYWORDS: Record<
  Exclude<DriveFolderPurpose, "company_root">,
  string[]
> = {
  series_a: ["série a", "serie a", "series a", "series-a"],
  pre_round: ["pre-round", "pre round", "preround", "pre round"],
  m2_financial: ["m2", "m-2", "financial", "finance"],
  bp_inputs: ["bp", "business plan", "business-plan"],
  reporting: ["reporting", "trimestriel", "quarterly", "q1", "q2", "q3", "q4"],
};

const INPUT_TEMPLATES: Record<
  Exclude<DriveFolderPurpose, "company_root">,
  string[]
> = {
  series_a: ["legal", "finance", "memo", "reporting"],
  pre_round: ["legal", "finance", "memo", "reporting"],
  m2_financial: ["dsn", "relev", "bank", "bancaire", "prêt", "pret", "loan"],
  bp_inputs: ["dsn", "prêt", "pret", "loan", "historique", "history"],
  reporting: ["reporting", "trimestriel", "quarterly", "financial"],
};

const normalizeKey = (value: string): string => value.trim().toLowerCase();

const matchesPurpose = (
  folderName: string,
  purpose: DriveFolderPurpose,
): boolean => {
  if (purpose === "company_root") return true;
  const haystack = normalizeKey(folderName);
  return PURPOSE_KEYWORDS[purpose].some((keyword) => haystack.includes(keyword));
};

const inferPurposeMatch = (
  folderName: string,
): DriveFolderPurpose | undefined => {
  const haystack = normalizeKey(folderName);
  for (const [purpose, keywords] of Object.entries(PURPOSE_KEYWORDS)) {
    if (keywords.some((keyword) => haystack.includes(keyword))) {
      return purpose as DriveFolderPurpose;
    }
  }
  return undefined;
};

const scoreFolderPath = (path: string, purpose: DriveFolderPurpose): number => {
  if (purpose !== "bp_inputs") return 0;
  const haystack = normalizeKey(path);
  let score = 0;
  if (/portfolio|liste startups|suivi de participation|accompagnement/.test(haystack)) {
    score += 25;
  }
  if (/pulse|comit[eé]|cambon|reporting kpi|investissement - corpo/.test(haystack)) {
    score -= 20;
  }
  return score;
};

const scoreFolder = (
  folder: DriveFolderRef,
  purpose: DriveFolderPurpose,
): number => {
  if (purpose === "company_root") return 0;
  const haystack = normalizeKey(folder.name);
  let score = 0;
  for (const keyword of PURPOSE_KEYWORDS[purpose]) {
    if (haystack.includes(keyword)) score += 10;
  }
  return score;
};

const collectInputMatches = (
  inventory: DriveItemRef[],
  expectedInputs: string[],
): { present: string[]; missing: string[] } => {
  const names = inventory.map((item) => normalizeKey(item.name));
  const present: string[] = [];
  const missing: string[] = [];

  for (const expected of expectedInputs) {
    const needle = normalizeKey(expected);
    const found = names.some((name) => name.includes(needle));
    if (found) {
      present.push(expected);
    } else {
      missing.push(expected);
    }
  }

  return { present, missing };
};

export const buildCompanyDriveFolderService = (deps: {
  connectors: Connectors;
  startups: StartupsService;
  society: SocietyService;
}) => {
  const { connectors, startups, society } = deps;

  const resolvePortfolioCompanyId = async (
    caller: Identity,
    args: {
      portfolioCompanyId?: string;
      startupId?: string;
      startupName?: string;
    },
  ): Promise<{ portfolioCompanyId: string; canonicalName: string | undefined }> => {
    if (args.portfolioCompanyId) {
      return {
        portfolioCompanyId: args.portfolioCompanyId,
        canonicalName: undefined,
      };
    }

    const portfolio = await connectors.monday.listPortfolio();

    if (args.startupId || args.startupName) {
      const matches = await startups.searchStartups(
        caller,
        {
          ...(args.startupId ? { startupId: args.startupId } : {}),
          ...(args.startupName ? { startupName: args.startupName } : {}),
        },
        { limit: 5 },
      );
      if (matches.length === 0) {
        throw BadRequest(
          "Startup selector did not resolve to a visible CRM record.",
        );
      }
      if (matches.length > 1) {
        throw BadRequest(
          "Startup selector matched multiple startups. Prefer startupId or call resolve_entity.",
          {
            matches: matches.map((item) => ({
              startupId: item.id,
              name: item.name,
            })),
          },
        );
      }
      const startup = matches[0]!;
      const portfolioCompanyId = portfolio.find(
        (row) => normalizeKey(row.startupId) === normalizeKey(startup.name),
      )?.id;
      if (!portfolioCompanyId) {
        throw BadRequest(
          "No Monday portfolio identifier linked to this startup. Call resolve_entity.",
          { startupId: startup.id, startupName: startup.name },
        );
      }
      return { portfolioCompanyId, canonicalName: startup.name };
    }

    throw BadRequest(
      "Provide portfolioCompanyId or at least one startup selector (startupId/startupName).",
    );
  };

  return {
    resolveCompanyDriveFolder: async (
      caller: Identity,
      args: {
        portfolioCompanyId?: string;
        startupId?: string;
        startupName?: string;
        driveTokens?: DriveTokenCandidate[];
        purpose?: DriveFolderPurpose;
        folderLimit?: number;
        inventoryLimit?: number;
      },
    ) => {
      const purpose = args.purpose ?? "company_root";
      const folderLimit = Math.min(args.folderLimit ?? 10, 25);
      const inventoryLimit = Math.min(args.inventoryLimit ?? 50, 100);
      const warnings: ToolWarning[] = [];

      const { portfolioCompanyId, canonicalName } =
        await resolvePortfolioCompanyId(caller, args);
      await society.ensurePortfolioCompanyInScope(caller, portfolioCompanyId);

      const driveTokensTried = rankDriveTokens(
        portfolioCompanyId,
        args.driveTokens ?? [],
      );
      const folderLookup = await listDriveFoldersForTokens(
        connectors.drive,
        driveTokensTried,
      );
      const driveTokenUsed = folderLookup?.token ?? driveTokensTried[0] ?? portfolioCompanyId;
      const rawFolders = folderLookup?.folders ?? [];

      if (
        folderLookup &&
        folderLookup.token !== driveTokensTried[0] &&
        driveTokensTried[0]
      ) {
        warnings.push({
          code: ToolWarningCodes.PORTFOLIO_LINK_MISSING,
          message:
            `Drive folders found under alternate token "${folderLookup.token}" (primary "${driveTokensTried[0]}" was empty).`,
          mitigation:
            "Reuse driveTokens from resolve_entity for downstream Drive reads.",
        });
      }

      const scoredFolders = await Promise.all(
        rawFolders.map(async (folder) => {
          const path = await connectors.drive.resolveItemPath(folder.driveFolderId);
          return {
            folder,
            path,
            score: scoreFolder(folder, purpose) + scoreFolderPath(path, purpose),
          };
        }),
      );

      scoredFolders.sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        return right.folder.modifiedTime.localeCompare(left.folder.modifiedTime);
      });

      const folderCandidates: DriveFolderCandidate[] = scoredFolders
        .slice(0, folderLimit)
        .map(({ folder, path }) => ({
          driveFolderId: folder.driveFolderId,
          name: folder.name,
          path,
          purposeMatch: inferPurposeMatch(folder.name),
          modifiedTime: folder.modifiedTime,
        }));

      let primaryFolder: DriveFolderCandidate | null = null;
      if (purpose === "company_root") {
        primaryFolder = folderCandidates[0] ?? null;
      } else {
        primaryFolder =
          folderCandidates.find((candidate) =>
            matchesPurpose(candidate.name, purpose),
          ) ??
          folderCandidates[0] ??
          null;
      }

      let inventory: DriveInventoryItem[] = [];
      if (primaryFolder) {
        const children = await connectors.drive.listFolderChildren(
          primaryFolder.driveFolderId,
        );
        inventory = children.slice(0, inventoryLimit).map((item) => ({
          driveFileId: item.driveFileId,
          name: item.name,
          kind: item.kind,
          mimeType: item.mimeType,
          modifiedTime: item.modifiedTime,
        }));
        if (children.length > inventoryLimit) {
          warnings.push({
            code: "INVENTORY_TRUNCATED",
            message: `Folder inventory truncated to ${String(inventoryLimit)} items.`,
            mitigation: "Narrow purpose or inspect subfolders manually in Drive.",
          });
        }
      }

      let presentInputs: string[] = [];
      let missingInputs: string[] = [];
      if (purpose !== "company_root" && primaryFolder) {
        const template = INPUT_TEMPLATES[purpose];
        const matches = collectInputMatches(
          inventory.map((item) => ({
            driveFileId: item.driveFileId,
            name: item.name,
            mimeType: item.mimeType,
            kind: item.kind,
            createdTime: item.modifiedTime,
            modifiedTime: item.modifiedTime,
          })),
          template,
        );
        presentInputs = matches.present;
        missingInputs = matches.missing;
        if (missingInputs.length > 0) {
        warnings.push({
          code: ToolWarningCodes.DRIVE_INPUTS_INCOMPLETE,
            message: `Expected inputs missing for ${purpose}: ${missingInputs.join(", ")}.`,
            mitigation:
              "Ask the founder for missing files or call list_company_documents as fallback.",
          });
        }
      }

      if (folderCandidates.length === 0) {
        warnings.push({
          code: ToolWarningCodes.DRIVE_FOLDER_NOT_FOUND,
          message:
            `No Drive folder matched after trying tokens: ${driveTokensTried.join(", ")}.`,
          mitigation:
            "Call resolve_entity and pass driveTokens[], or verify GOOGLE_DRIVE_SHARED_DRIVE_ID is set on the server.",
        });
      } else if (folderCandidates.length > 1 && purpose !== "company_root") {
        const purposeMatches = folderCandidates.filter((candidate) =>
          matchesPurpose(candidate.name, purpose),
        );
        if (purposeMatches.length > 1) {
          warnings.push({
            code: ToolWarningCodes.DRIVE_FOLDER_AMBIGUOUS,
            message: "Multiple folders match the requested purpose.",
            mitigation:
              "Confirm the correct folder with the user or pass a narrower portfolioCompanyId.",
          });
        }
      }

      if (
        purpose !== "company_root" &&
        primaryFolder &&
        !matchesPurpose(primaryFolder.name, purpose)
      ) {
        warnings.push({
          code: ToolWarningCodes.PORTFOLIO_LINK_MISSING,
          message:
            `No folder explicitly matched purpose "${purpose}"; using best available candidate.`,
          mitigation: "Confirm folder path with the user before M2 or BP workflows.",
        });
      }

      const citations: Citation[] = [];
      if (primaryFolder) {
        citations.push({
          label: primaryFolder.path,
          source: {
            system: "drive",
            externalId: primaryFolder.driveFolderId,
            url: undefined,
          },
        });
      }

      const nextSuggestedTools: SuggestedToolCall[] = [];
      if (primaryFolder && inventory.length > 0) {
        const firstFile = inventory.find((item) => item.kind === "file");
        if (firstFile) {
          nextSuggestedTools.push({
            toolName: "read_company_document_excerpt",
            reason: "Extract text from a listed Drive file",
            arguments: {
              portfolioCompanyId,
              driveFileId: firstFile.driveFileId,
            },
          });
        }
      }
      if (missingInputs.length > 0 || folderCandidates.length === 0) {
        nextSuggestedTools.push({
          toolName: "list_company_documents",
          reason: "Fallback flat file search when folder structure is incomplete",
          arguments: { portfolioCompanyId },
        });
      }

      const data: ResolveCompanyDriveFolderData = {
        portfolioCompanyId,
        canonicalName,
        purpose,
        driveTokenUsed,
        driveTokensTried,
        primaryFolder,
        folderCandidates,
        inventory,
        presentInputs,
        missingInputs,
      };

      return wrapToolOutput(data, {
        citations,
        warnings,
        ...(nextSuggestedTools.length > 0 ? { nextSuggestedTools } : {}),
      });
    },
  };
};

export type CompanyDriveFolderService = ReturnType<
  typeof buildCompanyDriveFolderService
>;
