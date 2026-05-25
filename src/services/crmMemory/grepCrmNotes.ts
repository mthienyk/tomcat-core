import { BadRequest } from "../../errors/index.js";
import type { Identity } from "../../domain/identity.js";
import type { Startup } from "../../domain/entities.js";
import {
  ToolWarningCodes,
  wrapToolOutput,
  type SuggestedToolCall,
  type ToolRunEnvelope,
} from "../../domain/mcpToolOutput.js";
import type { CoreStore } from "../../storage/coreStore.js";
import type { StartupsService } from "../startups.js";
import { canSeeNote } from "../../permissions/policies.js";
import { redactNoteBody } from "../../permissions/redact.js";
import { matchesAuthorEmail } from "../noteRanking.js";
import { parseGrepTerms } from "./grepTerms.js";

const EXCERPT_RADIUS = 120;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;
const ACL_SCAN_MULTIPLIER = 3;

export type GrepCrmNotesMatch = {
  noteId: string;
  startupId: string | undefined;
  startupName: string | undefined;
  authorEmail: string;
  createdAt: string;
  excerpt: string;
  bodyLength: number;
};

export type GrepCrmNotesData = {
  query: string;
  terms: string[];
  matchMode: "all" | "any";
  matches: GrepCrmNotesMatch[];
};

const excerptAroundTerm = (body: string, terms: readonly string[]): string => {
  const lowerBody = body.toLowerCase();
  let anchor = -1;

  for (const term of terms) {
    const index = lowerBody.indexOf(term.toLowerCase());
    if (index >= 0) {
      anchor = index;
      break;
    }
  }

  if (anchor < 0) {
    return body.length > EXCERPT_RADIUS * 2
      ? `${body.slice(0, EXCERPT_RADIUS * 2)}…`
      : body;
  }

  const start = Math.max(0, anchor - EXCERPT_RADIUS);
  const end = Math.min(body.length, anchor + EXCERPT_RADIUS);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < body.length ? "…" : "";
  return `${prefix}${body.slice(start, end)}${suffix}`;
};

const resolveScope = async (
  startups: StartupsService,
  caller: Identity,
  args: { startupId?: string; startupName?: string },
): Promise<{ visible: Startup[]; startupIds: string[] }> => {
  const visible = await startups.listAllVisibleStartups(caller);

  if (args.startupId) {
    const found = visible.find((startup) => startup.id === args.startupId);
    return {
      visible,
      startupIds: found ? [found.id] : [],
    };
  }

  if (args.startupName) {
    const needle = args.startupName.trim().toLowerCase();
    const matches = visible.filter((startup) =>
      startup.name.toLowerCase().includes(needle),
    );
    if (matches.length > 1) {
      throw BadRequest(
        "startupName matched multiple startups. Prefer startupId or resolve_entity.",
      );
    }
    return {
      visible,
      startupIds: matches[0] ? [matches[0].id] : [],
    };
  }

  return {
    visible,
    startupIds: visible.map((startup) => startup.id),
  };
};

export const buildGrepCrmNotesService = (deps: {
  store: CoreStore;
  startups: StartupsService;
}) => {
  const { store, startups } = deps;

  return {
    grepCrmNotes: async (
      caller: Identity,
      args: {
        query: string;
        matchMode?: "all" | "any";
        startupId?: string;
        startupName?: string;
        authorEmail?: string;
        sinceDays?: number;
        limit?: number;
      },
    ): Promise<ToolRunEnvelope<GrepCrmNotesData>> => {
      const terms = parseGrepTerms(args.query);
      if (terms.length === 0) {
        throw BadRequest(
          "query must contain at least one searchable term (min 2 characters). Use quotes for phrases.",
        );
      }

      const matchMode = args.matchMode ?? "all";
      const limit = Math.min(args.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
      const { visible, startupIds } = await resolveScope(startups, caller, args);
      const startupNameById = new Map(
        visible.map((startup) => [startup.id, startup.name] as const),
      );

      if (startupIds.length === 0) {
        return wrapToolOutput(
          {
            query: args.query,
            terms,
            matchMode,
            matches: [],
          },
          {
            warnings: [
              {
                code: ToolWarningCodes.CRM_GREP_NO_MATCHES,
                message: "No accessible startups matched the selector.",
                mitigation: "Call resolve_entity or pass startupId.",
              },
            ],
          },
        );
      }

      const hits = await store.grepNotes({
        terms,
        matchMode,
        startupIds,
        ...(args.authorEmail !== undefined ? { authorEmail: args.authorEmail } : {}),
        ...(args.sinceDays !== undefined ? { sinceDays: args.sinceDays } : {}),
        limit: limit * ACL_SCAN_MULTIPLIER,
      });

      const matches: GrepCrmNotesMatch[] = [];

      for (const hit of hits) {
        if (!canSeeNote(caller, hit.note)) continue;

        const note = redactNoteBody(caller, hit.note);
        if (
          args.authorEmail !== undefined
          && !matchesAuthorEmail(note, args.authorEmail)
        ) {
          continue;
        }

        matches.push({
          noteId: note.id,
          startupId: note.startupId,
          startupName:
            hit.startupName
            ?? (note.startupId ? startupNameById.get(note.startupId) : undefined),
          authorEmail: note.authorEmail,
          createdAt: note.createdAt,
          excerpt: excerptAroundTerm(note.body, terms),
          bodyLength: note.body.length,
        });

        if (matches.length >= limit) break;
      }

      const nextSuggestedTools: SuggestedToolCall[] = [];
      const topMatch = matches[0];
      if (topMatch?.startupId) {
        nextSuggestedTools.push({
          toolName: "read_startup_notes",
          reason: "Read the full CRM note for the top keyword hit",
          arguments: { startupId: topMatch.startupId },
        });
      }

      return wrapToolOutput(
        {
          query: args.query,
          terms,
          matchMode,
          matches,
        },
        {
          ...(matches.length === 0
            ? {
                warnings: [
                  {
                    code: ToolWarningCodes.CRM_GREP_NO_MATCHES,
                    message:
                      "No CRM notes matched the keyword query within accessible startups.",
                    mitigation:
                      "Try matchMode any, broaden sinceDays, remove startup filter, or use find_similar_cases for semantic recall.",
                  },
                ],
              }
            : {}),
          ...(nextSuggestedTools.length > 0
            ? { nextSuggestedTools }
            : {}),
        },
      );
    },
  };
};

export type GrepCrmNotesService = ReturnType<typeof buildGrepCrmNotesService>;
