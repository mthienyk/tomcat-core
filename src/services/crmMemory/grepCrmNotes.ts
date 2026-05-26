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
import { parseGrepTerms, filterGrepTerms } from "./grepTerms.js";

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
  matchSource: "note_body" | "index_meta";
  matchedField?: "competitorNames" | "markets" | "chunkText";
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
      const parsedTerms = parseGrepTerms(args.query);
      if (parsedTerms.length === 0) {
        throw BadRequest(
          "query must contain at least one searchable term (min 2 characters). Use quotes for phrases.",
        );
      }

      const matchMode = args.matchMode ?? "all";
      const terms = filterGrepTerms(parsedTerms, matchMode);
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
      const seenNoteIds = new Set<string>();

      for (const hit of hits) {
        if (!canSeeNote(caller, hit.note)) continue;

        const note = redactNoteBody(caller, hit.note);
        if (
          args.authorEmail !== undefined
          && !matchesAuthorEmail(note, args.authorEmail)
        ) {
          continue;
        }

        seenNoteIds.add(note.id);
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
          matchSource: "note_body",
        });

        if (matches.length >= limit) break;
      }

      if (matches.length < limit) {
        const metaHits = await store.grepKnowledgeIndexMeta({
          terms,
          matchMode,
          startupIds,
          ...(args.authorEmail !== undefined ? { authorEmail: args.authorEmail } : {}),
          ...(args.sinceDays !== undefined ? { sinceDays: args.sinceDays } : {}),
          limit: limit * ACL_SCAN_MULTIPLIER,
        });

        for (const hit of metaHits) {
          if (seenNoteIds.has(hit.noteId)) continue;

          const note = await store.getNoteById(hit.noteId);
          if (!note || !canSeeNote(caller, note)) continue;

          const redacted = redactNoteBody(caller, note);
          if (
            args.authorEmail !== undefined
            && !matchesAuthorEmail(redacted, args.authorEmail)
          ) {
            continue;
          }

          seenNoteIds.add(hit.noteId);
          matches.push({
            noteId: hit.noteId,
            startupId: hit.startupId,
            startupName: startupNameById.get(hit.startupId),
            authorEmail: hit.authorEmail,
            createdAt: hit.noteCreatedAt,
            excerpt: excerptAroundTerm(hit.chunkText, terms),
            bodyLength: redacted.body.length,
            matchSource: "index_meta",
            matchedField: hit.matchedField,
          });

          if (matches.length >= limit) break;
        }
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
                      "Try matchMode any, broaden sinceDays, remove startup filter, or call find_similar_cases with query for conceptual recall.",
                  },
                ],
                nextSuggestedTools: [
                  {
                    toolName: "find_similar_cases",
                    reason:
                      "Semantic fallback when keywords are absent from note bodies",
                    arguments: { query: args.query },
                  },
                ],
              }
            : {}),
          ...(matches.length > 0 && nextSuggestedTools.length > 0
            ? { nextSuggestedTools }
            : {}),
        },
      );
    },
  };
};

export type GrepCrmNotesService = ReturnType<typeof buildGrepCrmNotesService>;
