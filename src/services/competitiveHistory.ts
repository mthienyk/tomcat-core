import { BadRequest } from "../errors/index.js";
import type { Identity } from "../domain/identity.js";
import type { Note, Startup } from "../domain/entities.js";
import {
  ToolWarningCodes,
  wrapToolOutput,
  type SuggestedToolCall,
  type ToolWarning,
} from "../domain/mcpToolOutput.js";
import type { StartupsService } from "./startups.js";
import { rankNotesByQuality } from "./noteRanking.js";

export type CompetitiveHistoryMatch = {
  startupId: string;
  name: string;
  sectors: string[];
  sharedSectors: string[];
  recentNotes: Array<{
    id: string;
    excerpt: string;
    authorEmail: string;
    sensitivity: string;
    createdAt: string;
  }>;
};

export type CompetitiveHistoryData = {
  referenceStartup: {
    id: string;
    name: string;
    sectors: string[];
  } | null;
  searchBasis: "sector_filter" | "shared_sectors_with_reference";
  matchCount: number;
  matches: CompetitiveHistoryMatch[];
};

export const buildCompetitiveHistoryService = (deps: {
  startups: StartupsService;
}) => {
  const { startups } = deps;

  const selectRankedNotes = (notes: Note[], notesLimit: number): Note[] =>
    rankNotesByQuality(notes).slice(0, notesLimit);

  return {
    findCompetitiveHistory: async (
      caller: Identity,
      args: {
        startupId?: string;
        startupName?: string;
        sector?: string;
        limit?: number;
        notesPerMatch?: number;
        authorEmail?: string;
      },
    ) => {
      const hasSeed =
        args.startupId !== undefined ||
        args.startupName !== undefined ||
        args.sector !== undefined;
      if (!hasSeed) {
        throw BadRequest(
          "Provide startupId, startupName, or sector to search Tomcat history.",
        );
      }

      const matchLimit = Math.min(args.limit ?? 10, 25);
      const notesLimit = Math.min(args.notesPerMatch ?? 5, 10);
      const notesFetchLimit = Math.min(Math.max(notesLimit * 5, 25), 50);
      const warnings: ToolWarning[] = [];

      let referenceStartup: Startup | undefined;
      if (args.startupId !== undefined) {
        const found = await startups.searchStartups(
          caller,
          { startupId: args.startupId },
          { limit: 1 },
        );
        referenceStartup = found[0];
      } else if (args.startupName !== undefined) {
        const found = await startups.searchStartups(
          caller,
          { startupName: args.startupName },
          { limit: 5 },
        );
        if (found.length > 1) {
          return wrapToolOutput<CompetitiveHistoryData>(
            {
              referenceStartup: null,
              searchBasis: "shared_sectors_with_reference",
              matchCount: 0,
              matches: [],
            },
            {
              warnings: [
                {
                  code: "AMBIGUOUS_STARTUP",
                  message: "Multiple startups match the name fragment.",
                  mitigation: "Call resolve_entity or pass startupId.",
                },
              ],
              nextSuggestedTools: [
                {
                  toolName: "resolve_entity",
                  reason: "Disambiguate the reference startup",
                  arguments: { query: args.startupName },
                },
              ],
            },
          );
        }
        referenceStartup = found[0];
      }

      if (
        args.startupId !== undefined &&
        referenceStartup === undefined &&
        args.sector === undefined
      ) {
        warnings.push({
          code: "REFERENCE_NOT_FOUND",
          message: `No visible startup matches startupId "${args.startupId}".`,
          mitigation: "Call resolve_entity or verify the id with search_startups.",
        });
      }

      const sectorSeed =
        args.sector ??
        referenceStartup?.sectors[0];

      const similar = await startups.findSimilar(
        caller,
        {
          startupId: referenceStartup?.id ?? args.startupId,
          startupName: referenceStartup === undefined ? args.startupName : undefined,
          sector: referenceStartup === undefined ? sectorSeed : undefined,
        },
        { limit: matchLimit },
      );

      const refSectors =
        referenceStartup?.sectors ??
        (args.sector !== undefined ? [args.sector] : []);

      const matches: CompetitiveHistoryMatch[] = await Promise.all(
        similar.map(async (startup) => {
          const notes = await startups.listAccessibleNotes(caller, startup.id, {
            limit: notesFetchLimit,
            ...(args.authorEmail !== undefined
              ? { authorEmail: args.authorEmail }
              : {}),
          });
          const sharedSectors = startup.sectors.filter((sec) =>
            refSectors.some((ref) => ref.toLowerCase() === sec.toLowerCase()),
          );
          const rankedNotes = selectRankedNotes(notes, notesLimit);
          return {
            startupId: startup.id,
            name: startup.name,
            sectors: startup.sectors,
            sharedSectors,
            recentNotes: rankedNotes.map((note) => ({
              id: note.id,
              excerpt:
                note.body.length > 400
                  ? `${note.body.slice(0, 400)}…`
                  : note.body,
              authorEmail: note.authorEmail,
              sensitivity: note.sensitivity,
              createdAt: note.createdAt,
            })),
          };
        }),
      );

      if (referenceStartup && matches.length === 0) {
        warnings.push({
          code: ToolWarningCodes.NO_SECTOR_MATCHES,
          message:
            "No other visible startups share sectors with the reference company.",
          mitigation:
            "Try search_startups with a broader sector filter or widen the funnel stage.",
        });
      }
      if (
        !referenceStartup &&
        args.sector === undefined &&
        args.startupId === undefined
      ) {
        warnings.push({
          code: "REFERENCE_NOT_FOUND",
          message: "Reference startup was not resolved; results may be incomplete.",
          mitigation: "Call resolve_entity with the company name.",
        });
      }

      const nextSuggestedTools: SuggestedToolCall[] = [];
      if (matches.length > 0) {
        const topMatch = matches[0]!;
        nextSuggestedTools.push({
          toolName: "read_startup_notes",
          reason: "Read full notes for the closest historical match",
          arguments: {
            startupId: topMatch.startupId,
            ...(args.authorEmail !== undefined
              ? { authorEmail: args.authorEmail }
              : {}),
          },
        });
        if (referenceStartup) {
          nextSuggestedTools.push({
            toolName: "find_similar_cases",
            reason: "Find semantically similar historical cases beyond sector tags",
            arguments: { startupId: referenceStartup.id },
          });
          nextSuggestedTools.push({
            toolName: "list_company_crm_activity",
            reason: "Compare CRM timeline on the reference vs a match",
            arguments: { startupId: referenceStartup.id },
          });
        }
      }

      const data: CompetitiveHistoryData = {
        referenceStartup: referenceStartup
          ? {
              id: referenceStartup.id,
              name: referenceStartup.name,
              sectors: referenceStartup.sectors,
            }
          : null,
        searchBasis:
          args.sector !== undefined && referenceStartup === undefined
            ? "sector_filter"
            : "shared_sectors_with_reference",
        matchCount: matches.length,
        matches,
      };

      return wrapToolOutput(data, { warnings, nextSuggestedTools });
    },
  };
};

export type CompetitiveHistoryService = ReturnType<
  typeof buildCompetitiveHistoryService
>;
