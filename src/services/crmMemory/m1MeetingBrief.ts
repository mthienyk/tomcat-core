import { BadRequest } from "../../errors/index.js";
import type { Identity } from "../../domain/identity.js";
import type { Startup } from "../../domain/entities.js";
import type { SimilarCasesData } from "../../domain/crmMemory.js";
import {
  ToolWarningCodes,
  wrapToolOutput,
  type SuggestedToolCall,
  type ToolRunEnvelope,
  type ToolWarning,
} from "../../domain/mcpToolOutput.js";
import type { CompanyActivitySummaryService } from "../companyActivitySummary.js";
import type { FindLatestDeckService } from "../findLatestDeck.js";
import type { SimilarCasesService } from "./similarCases.js";
import type { GrepCrmNotesService } from "./grepCrmNotes.js";
import type { StartupsService } from "../startups.js";
import type { CrmMemorySemanticLlm } from "./semanticLlm.js";
import { buildM1SearchTextsSystemPrompt } from "../../prompts/crmMemory/m1SearchTextsPrompt.js";
import { M1SearchTextsSchema } from "../../prompts/crmMemory/m1SearchTextsSchema.js";
import { ELIE_NOTE_AUTHOR_EMAIL } from "../noteRanking.js";

const DEFAULT_SINCE_DAYS = 1095;
const DEFAULT_SIMILAR_LIMIT = 5;
const DECK_EXCERPT_MAX = 6000;

export type M1MeetingBriefData = {
  referenceStartup: {
    id: string;
    name: string;
    sectors: string[];
    stage: string;
    description: string | undefined;
  };
  deck: {
    driveFileId: string;
    title: string;
    excerpt: string | undefined;
  } | null;
  generatedSearchTexts: string[];
  competitorHints: string[];
  prepAngles: string[];
  similarCases: SimilarCasesData;
  competitorGrep: Array<{
    query: string;
    matchCount: number;
    topStartupNames: string[];
  }>;
  existingCrmHighlights: Array<{
    noteId: string;
    headline: string;
    createdAt: string;
  }>;
};

const resolveStartup = async (
  startups: StartupsService,
  caller: Identity,
  args: { startupId?: string; startupName?: string },
): Promise<Startup> => {
  const matches = await startups.searchStartups(
    caller,
    {
      ...(args.startupId ? { startupId: args.startupId } : {}),
      ...(args.startupName ? { startupName: args.startupName } : {}),
    },
    { limit: 2 },
  );

  if (matches.length === 0) {
    throw BadRequest("Startup not found or not visible to this caller.");
  }
  if (matches.length > 1) {
    throw BadRequest(
      "startupName matched multiple startups. Prefer startupId or resolve_entity.",
    );
  }
  return matches[0]!;
};

export const buildM1MeetingBriefService = (deps: {
  startups: StartupsService;
  findLatestDeck: FindLatestDeckService;
  companyActivitySummary: CompanyActivitySummaryService;
  similarCases: SimilarCasesService | undefined;
  grepCrmNotes: GrepCrmNotesService | undefined;
  semanticLlm: CrmMemorySemanticLlm | undefined;
}) => {
  const {
    startups,
    findLatestDeck,
    companyActivitySummary,
    similarCases,
    grepCrmNotes,
    semanticLlm,
  } = deps;

  const generateSearchTexts = async (input: {
    startup: Startup;
    deckExcerpt: string | undefined;
    oralContext: string | undefined;
  }): Promise<{
    searchTexts: string[];
    competitorHints: string[];
    prepAngles: string[];
  }> => {
    if (!semanticLlm) {
      const fallback = [
        `${input.startup.name} — ${input.startup.sectors.join(", ")}. `
        + `${input.startup.description ?? ""} `
        + `${input.deckExcerpt?.slice(0, 800) ?? ""}`.trim(),
      ];
      return {
        searchTexts: fallback.filter((text) => text.length >= 20),
        competitorHints: [],
        prepAngles: [],
      };
    }

    const userPayload = {
      startup: {
        name: input.startup.name,
        sectors: input.startup.sectors,
        stage: input.startup.stage,
        country: input.startup.country,
        description: input.startup.description,
      },
      deckExcerpt: input.deckExcerpt?.slice(0, DECK_EXCERPT_MAX),
      oralContext: input.oralContext,
    };

    const result = await semanticLlm.provider.generateStructured({
      model: semanticLlm.model,
      ...(semanticLlm.reasoningEffort !== undefined
        ? { reasoningEffort: semanticLlm.reasoningEffort }
        : {}),
      schemaName: "M1SearchTexts",
      schema: M1SearchTextsSchema,
      system: buildM1SearchTextsSystemPrompt(),
      user: JSON.stringify(userPayload, null, 2),
      maxTokens: 1200,
    });

    return {
      searchTexts: result.searchTexts,
      competitorHints: result.competitorHints,
      prepAngles: result.prepAngles,
    };
  };

  return {
    prepareM1MeetingBrief: async (
      caller: Identity,
      args: {
        startupId?: string;
        startupName?: string;
        oralContext?: string;
        sinceDays?: number;
        similarLimit?: number;
      },
    ): Promise<ToolRunEnvelope<M1MeetingBriefData>> => {
      if (!similarCases) {
        throw BadRequest(
          "M1 brief requires semantic CRM memory (embeddings + Postgres read model).",
        );
      }

      const warnings: ToolWarning[] = [];
      const sinceDays = args.sinceDays ?? DEFAULT_SINCE_DAYS;
      const similarLimit = args.similarLimit ?? DEFAULT_SIMILAR_LIMIT;

      const startup = await resolveStartup(startups, caller, args);

      const [deckResult, activityResult] = await Promise.all([
        findLatestDeck.findLatestDeck(caller, {
          startupId: startup.id,
          startupName: startup.name,
        }),
        companyActivitySummary.summarizeCompanyActivity(caller, {
          startupId: startup.id,
          notesLimit: 8,
        }),
      ]);

      const deckExcerpt = deckResult.data.deck?.excerpt;
      if (!deckResult.data.deck) {
        warnings.push({
          code: ToolWarningCodes.DRIVE_DECK_NOT_FOUND,
          message: "No investor deck found in Drive for this startup.",
          mitigation: "Proceed with CRM + oral context only, or upload a deck.",
        });
      }

      const generated = await generateSearchTexts({
        startup,
        deckExcerpt,
        oralContext: args.oralContext,
      });

      if (generated.searchTexts.length === 0) {
        throw BadRequest(
          "Could not generate searchTexts for semantic memory. Provide oralContext or ensure deck/startup profile has content.",
        );
      }

      if (!semanticLlm) {
        warnings.push({
          code: ToolWarningCodes.NO_SIMILAR_CASES,
          message:
            "LLM unavailable — searchTexts built from startup profile/deck only (lower recall).",
          mitigation:
            "Rewrite searchTexts manually or retry when semantic LLM is configured.",
        });
      }

      const similarEnvelope = await similarCases.findSimilarCases(caller, {
        startupId: startup.id,
        searchTexts: generated.searchTexts,
        chunkKind: "recap",
        sinceDays,
        limit: similarLimit,
      });

      const competitorGrep: M1MeetingBriefData["competitorGrep"] = [];
      const hints = [...new Set(generated.competitorHints)].slice(0, 5);

      if (grepCrmNotes && hints.length > 0) {
        for (const hint of hints) {
          const grepResult = await grepCrmNotes.grepCrmNotes(caller, {
            query: hint,
            matchMode: "all",
            sinceDays,
            limit: 5,
          });
          competitorGrep.push({
            query: hint,
            matchCount: grepResult.data.matches.length,
            topStartupNames: [
              ...new Set(
                grepResult.data.matches
                  .map((match) => match.startupName)
                  .filter((name): name is string => Boolean(name)),
              ),
            ].slice(0, 5),
          });
        }
      }

      const existingCrmHighlights = activityResult.data.facts
        .filter((fact) => fact.kind === "note")
        .slice(0, 5)
        .map((fact) => ({
          noteId: fact.id,
          headline: fact.headline,
          createdAt: fact.occurredAt,
        }));

      const nextSuggestedTools: SuggestedToolCall[] = [];
      const topMatch = similarEnvelope.data.matches[0];
      if (topMatch) {
        nextSuggestedTools.push({
          toolName: "read_startup_notes",
          reason: "Read Élie's full notes on the closest historical match",
          arguments: {
            startupId: topMatch.startupId,
            authorEmail: ELIE_NOTE_AUTHOR_EMAIL,
            minBodyLength: 500,
          },
        });
      }

      const data: M1MeetingBriefData = {
        referenceStartup: {
          id: startup.id,
          name: startup.name,
          sectors: startup.sectors,
          stage: startup.stage,
          description: startup.description,
        },
        deck: deckResult.data.deck
          ? {
              driveFileId: deckResult.data.deck.driveFileId,
              title: deckResult.data.deck.title,
              excerpt: deckExcerpt,
            }
          : null,
        generatedSearchTexts: generated.searchTexts,
        competitorHints: generated.competitorHints,
        prepAngles: generated.prepAngles,
        similarCases: similarEnvelope.data,
        competitorGrep,
        existingCrmHighlights,
      };

      return wrapToolOutput(data, {
        warnings: [...warnings, ...similarEnvelope.warnings],
        nextSuggestedTools,
      });
    },
  };
};

export type M1MeetingBriefService = ReturnType<
  typeof buildM1MeetingBriefService
>;
