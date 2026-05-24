import { BadRequest } from "../errors/index.js";
import type { Connectors } from "../connectors/registry.js";
import type { Identity } from "../domain/identity.js";
import type { Startup } from "../domain/entities.js";
import {
  ToolWarningCodes,
  wrapToolOutput,
  type SuggestedToolCall,
  type ToolRunEnvelope,
  type ToolWarning,
} from "../domain/mcpToolOutput.js";
import {
  rankDeckCandidates,
  type RankedDriveDocument,
} from "./driveDocuments.js";
import type { SocietyService } from "./society.js";
import type { StartupsService } from "./startups.js";

export type FindLatestDeckData = {
  portfolioCompanyId: string;
  startupId: string | undefined;
  canonicalName: string | undefined;
  driveTokenSource: "portfolio_company_id" | "startup_name";
  deck: {
    driveFileId: string;
    title: string;
    createdAt: string;
    relevance: string;
    relevanceScore: number;
    textExtractable: boolean;
    excerpt: string | undefined;
    excerptTruncated: boolean;
  } | null;
  alternates: Array<{
    driveFileId: string;
    title: string;
    createdAt: string;
    relevance: string;
  }>;
};

const DEFAULT_EXCERPT_CHARS = 4_000;
const MAX_EXCERPT_CHARS = 12_000;

const resolveDriveToken = async (
  startups: StartupsService,
  caller: Identity,
  args: {
    portfolioCompanyId?: string;
    startupId?: string;
    startupName?: string;
  },
): Promise<{
  portfolioCompanyId: string;
  startup: Startup | undefined;
  driveTokenSource: FindLatestDeckData["driveTokenSource"];
  warnings: ToolWarning[];
}> => {
  const warnings: ToolWarning[] = [];

  if (args.portfolioCompanyId) {
    if (args.startupId || args.startupName) {
      const matches = await startups.searchStartups(
        caller,
        {
          ...(args.startupId ? { startupId: args.startupId } : {}),
          ...(args.startupName ? { startupName: args.startupName } : {}),
        },
        { limit: 1 },
      );
      return {
        portfolioCompanyId: args.portfolioCompanyId,
        startup: matches[0],
        driveTokenSource: "portfolio_company_id",
        warnings,
      };
    }
    return {
      portfolioCompanyId: args.portfolioCompanyId,
      startup: undefined,
      driveTokenSource: "portfolio_company_id",
      warnings,
    };
  }

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
      throw BadRequest("Startup selector did not resolve to a visible CRM record.");
    }
    if (matches.length > 1) {
      throw BadRequest(
        "Startup selector matched multiple startups. Prefer startupId or call resolve_entity.",
      );
    }
    const startup = matches[0]!;
    warnings.push({
      code: ToolWarningCodes.PORTFOLIO_LINK_MISSING,
      message:
        "Drive lookup uses the HubSpot startup name as folder token; Monday portfolio name may differ.",
      mitigation:
        "Pass portfolioCompanyId from resolve_entity or resolve_company_drive_folder when names diverge (e.g. KOMEET vs Wenabi).",
    });
    return {
      portfolioCompanyId: startup.name,
      startup,
      driveTokenSource: "startup_name",
      warnings,
    };
  }

  throw BadRequest(
    "Provide portfolioCompanyId or startupId/startupName after resolve_entity.",
  );
};

const buildExcerpt = (
  fullText: string,
  maxChars: number,
): { excerpt: string; truncated: boolean } => {
  const codepoints = [...fullText];
  if (codepoints.length <= maxChars) {
    return { excerpt: fullText, truncated: false };
  }
  return {
    excerpt: codepoints.slice(0, maxChars).join(""),
    truncated: true,
  };
};

const isBinaryExtractionMessage = (fullText: string): boolean =>
  fullText.startsWith("[") && fullText.includes("binary format");

export const buildFindLatestDeckService = (deps: {
  connectors: Connectors;
  startups: StartupsService;
  society: SocietyService;
}) => {
  const { connectors, startups, society } = deps;

  return {
    findLatestDeck: async (
      caller: Identity,
      args: {
        portfolioCompanyId?: string;
        startupId?: string;
        startupName?: string;
        maxExcerptChars?: number;
        alternateLimit?: number;
      },
    ): Promise<ToolRunEnvelope<FindLatestDeckData>> => {
      const resolved = await resolveDriveToken(startups, caller, args);
      await society.ensurePortfolioCompanyInScope(
        caller,
        resolved.portfolioCompanyId,
      );

      const maxExcerptChars = Math.min(
        args.maxExcerptChars ?? DEFAULT_EXCERPT_CHARS,
        MAX_EXCERPT_CHARS,
      );
      const alternateLimit = Math.min(args.alternateLimit ?? 3, 8);

      const raw = await connectors.drive.listBoardPacksForCompany(
        resolved.portfolioCompanyId,
      );
      const listings = raw.map((file) => ({
        driveFileId: file.driveFileId,
        title: file.title,
        createdAt: file.createdAt,
        ...(file.mimeType !== undefined ? { mimeType: file.mimeType } : {}),
      }));

      const candidates = rankDeckCandidates(listings);
      const warnings = [...resolved.warnings];
      const primary = candidates[0] ?? null;

      if (raw.length === 0) {
        warnings.push({
          code: ToolWarningCodes.DRIVE_FOLDER_NOT_FOUND,
          message:
            "No Drive files indexed for this company token.",
          mitigation:
            "Call resolve_company_drive_folder with the Monday portfolio name or a known alias.",
        });
      } else if (!primary) {
        warnings.push({
          code: ToolWarningCodes.DRIVE_DECK_NOT_FOUND,
          message:
            "Drive files exist but none matched deck-like filters (deck, pitch, BP, board pack, Slides).",
          mitigation:
            "Call list_company_documents with includeBinaries=true or resolve_company_drive_folder.",
        });
      }

      let excerpt: string | undefined;
      let excerptTruncated = false;
      let extractionFailed = false;

      if (primary?.textExtractable) {
        try {
          const fullText = await connectors.drive.fetchDocumentText(
            primary.driveFileId,
          );
          if (isBinaryExtractionMessage(fullText)) {
            extractionFailed = true;
            warnings.push({
              code: ToolWarningCodes.DRIVE_BINARY_NOT_EXTRACTABLE,
              message:
                "Latest deck candidate could not be text-extracted (binary or unsupported format).",
              mitigation:
                "Open the cited Drive file directly or use a Google Docs/Slides export.",
            });
          } else {
            const built = buildExcerpt(fullText, maxExcerptChars);
            excerpt = built.excerpt;
            excerptTruncated = built.truncated;
          }
        } catch {
          extractionFailed = true;
          warnings.push({
            code: ToolWarningCodes.CONNECTOR_DEGRADED,
            message: "Drive text extraction failed for the selected deck candidate.",
          });
        }
      } else if (primary) {
        warnings.push({
          code: ToolWarningCodes.DRIVE_BINARY_NOT_EXTRACTABLE,
          message:
            "Latest deck candidate is a binary file (PDF, XLSX, PPTX). Metadata returned without text excerpt.",
          mitigation: "Open the cited Drive file directly.",
        });
      }

      const alternates = candidates.slice(1, 1 + alternateLimit).map(
        (file: RankedDriveDocument) => ({
          driveFileId: file.driveFileId,
          title: file.title,
          createdAt: file.createdAt,
          relevance: file.relevance,
        }),
      );

      const nextSuggestedTools: SuggestedToolCall[] = [];
      if (primary && !excerpt && primary.textExtractable && extractionFailed) {
        nextSuggestedTools.push({
          toolName: "read_company_document_excerpt",
          reason: "Retry text extraction with a larger window",
          arguments: {
            portfolioCompanyId: resolved.portfolioCompanyId,
            driveFileId: primary.driveFileId,
            maxChars: maxExcerptChars,
          },
        });
      }
      if (resolved.startup?.id) {
        nextSuggestedTools.push({
          toolName: "summarize_company_activity",
          reason: "Cross-check CRM context against the deck",
          arguments: { startupId: resolved.startup.id },
        });
      }
      if (
        !primary ||
        resolved.driveTokenSource === "startup_name" ||
        warnings.some((warning) => warning.code === ToolWarningCodes.DRIVE_DECK_NOT_FOUND)
      ) {
        nextSuggestedTools.push({
          toolName: "resolve_company_drive_folder",
          reason: "Browse the portfolio folder if the Drive token or deck search missed",
          arguments: { portfolioCompanyId: resolved.portfolioCompanyId },
        });
      }

      const data: FindLatestDeckData = {
        portfolioCompanyId: resolved.portfolioCompanyId,
        startupId: resolved.startup?.id,
        canonicalName: resolved.startup?.name,
        driveTokenSource: resolved.driveTokenSource,
        deck: primary
          ? {
              driveFileId: primary.driveFileId,
              title: primary.title,
              createdAt: primary.createdAt,
              relevance: primary.relevance,
              relevanceScore: primary.relevanceScore,
              textExtractable: primary.textExtractable,
              excerpt,
              excerptTruncated,
            }
          : null,
        alternates,
      };

      return wrapToolOutput(data, {
        citations: primary
          ? [
              {
                label: primary.title,
                source: {
                  system: "drive",
                  externalId: primary.driveFileId,
                  url: undefined,
                },
              },
            ]
          : [],
        warnings,
        nextSuggestedTools,
      });
    },
  };
};

export type FindLatestDeckService = ReturnType<typeof buildFindLatestDeckService>;
