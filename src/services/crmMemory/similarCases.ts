import { BadRequest } from "../../errors/index.js";
import type { Identity } from "../../domain/identity.js";
import type { Startup } from "../../domain/entities.js";
import type {
  CrmMemoryChunkKind,
  KnowledgeChunkSearchHit,
  KnowledgeChunkSearchParams,
  SimilarCaseMatch,
  SimilarCasesData,
} from "../../domain/crmMemory.js";
import {
  ToolWarningCodes,
  wrapToolOutput,
  type SuggestedToolCall,
  type ToolRunEnvelope,
  type ToolWarning,
} from "../../domain/mcpToolOutput.js";
import type { CoreStore } from "../../storage/coreStore.js";
import type { EmbeddingProvider } from "../../llm/embeddings/types.js";
import type { StartupsService } from "../startups.js";
import { canSeeNote } from "../../permissions/policies.js";
import { matchesAuthorEmail } from "../noteRanking.js";
import type { HydeQueryGenerator } from "./hydeQuery.js";

const EXCERPT_MAX = 400;
const SEARCH_POOL = 60;
const EVIDENCE_PER_CASE = 3;

const excerpt = (text: string): string =>
  text.length > EXCERPT_MAX ? `${text.slice(0, EXCERPT_MAX)}…` : text;

type AggregatedCase = {
  startupId: string;
  score: number;
  hits: KnowledgeChunkSearchHit[];
};

const aggregateByStartup = (
  hits: KnowledgeChunkSearchHit[],
): AggregatedCase[] => {
  const grouped = new Map<string, KnowledgeChunkSearchHit[]>();
  for (const hit of hits) {
    const bucket = grouped.get(hit.startupId) ?? [];
    bucket.push(hit);
    grouped.set(hit.startupId, bucket);
  }

  return [...grouped.entries()]
    .map(([startupId, caseHits]) => ({
      startupId,
      score: Math.max(...caseHits.map((hit) => hit.score)),
      hits: caseHits.sort((left, right) => right.score - left.score),
    }))
    .sort((left, right) => right.score - left.score);
};

const buildWhySimilar = (hits: KnowledgeChunkSearchHit[]): string => {
  const top = hits[0];
  if (!top) return "Similar historical CRM case.";
  return top.meta.recap || top.chunkText;
};

const buildSoWhat = (hits: KnowledgeChunkSearchHit[]): string => {
  const top = hits.find((hit) => hit.chunkKind === "investment_lens") ?? hits[0];
  if (!top) return "Review prior Tomcat judgment before the meeting.";
  return top.meta.tomcatTake || top.meta.investmentLens || top.chunkText;
};

export const buildSimilarCasesService = (deps: {
  store: CoreStore;
  startups: StartupsService;
  embeddings: EmbeddingProvider | undefined;
  hyde: HydeQueryGenerator;
}) => {
  const { store, startups, embeddings, hyde } = deps;

  const resolveReferenceStartup = async (
    caller: Identity,
    args: { startupId?: string; startupName?: string },
  ): Promise<Startup | undefined> => {
    if (args.startupId) {
      const matches = await startups.searchStartups(
        caller,
        { startupId: args.startupId },
        { limit: 1 },
      );
      return matches[0];
    }
    if (args.startupName) {
      const matches = await startups.searchStartups(
        caller,
        { startupName: args.startupName },
        { limit: 2 },
      );
      if (matches.length > 1) {
        throw BadRequest(
          "startupName matched multiple startups. Prefer startupId or resolve_entity.",
        );
      }
      return matches[0];
    }
    return undefined;
  };

  const resolveSectorStartupIds = async (
    caller: Identity,
    sector: string | undefined,
  ): Promise<string[] | undefined> => {
    if (!sector) return undefined;
    const matches = await startups.searchStartups(
      caller,
      { sector },
      { limit: 200 },
    );
    return matches.map((startup) => startup.id);
  };

  const embedQueries = async (texts: string[]): Promise<number[][]> => {
    if (!embeddings) {
      throw BadRequest("Semantic CRM memory index is not configured (embeddings unavailable).");
    }
    return embeddings.embed(texts);
  };

  const searchWithQueries = async (input: {
    queryTexts: string[];
    chunkKind?: CrmMemoryChunkKind;
    authorEmail?: string;
    sectorStartupIds?: string[];
    sinceDays?: number;
    excludeStartupId?: string;
  }): Promise<KnowledgeChunkSearchHit[]> => {
    const vectors = await embedQueries(input.queryTexts);
    const merged = new Map<string, KnowledgeChunkSearchHit>();

    for (const queryEmbedding of vectors) {
      const searchParams: KnowledgeChunkSearchParams = {
        queryEmbedding,
        limit: SEARCH_POOL,
        ...(input.chunkKind !== undefined ? { chunkKind: input.chunkKind } : {}),
        ...(input.authorEmail !== undefined ? { authorEmail: input.authorEmail } : {}),
        ...(input.sectorStartupIds !== undefined
          ? { sectorStartupIds: input.sectorStartupIds }
          : {}),
        ...(input.sinceDays !== undefined ? { sinceDays: input.sinceDays } : {}),
        ...(input.excludeStartupId !== undefined
          ? { excludeStartupId: input.excludeStartupId }
          : {}),
      };
      const hits = await store.searchKnowledgeChunks(searchParams);
      for (const hit of hits) {
        const existing = merged.get(hit.chunkId);
        if (!existing || hit.score > existing.score) {
          merged.set(hit.chunkId, hit);
        }
      }
    }

    return [...merged.values()].sort((left, right) => right.score - left.score);
  };

  return {
    findSimilarCases: async (
      caller: Identity,
      args: {
        startupId?: string;
        startupName?: string;
        query?: string;
        noteId?: string;
        authorEmail?: string;
        sector?: string;
        sinceDays?: number;
        chunkKind?: CrmMemoryChunkKind;
        limit?: number;
      },
    ): Promise<ToolRunEnvelope<SimilarCasesData>> => {
      const warnings: ToolWarning[] = [];
      const matchLimit = Math.min(args.limit ?? 10, 25);
      const indexedChunks = await store.countIndexedKnowledgeChunks();

      if (indexedChunks === 0) {
        warnings.push({
          code: "CRM_MEMORY_INDEX_EMPTY",
          message: "Semantic CRM memory index has no embedded chunks yet.",
          mitigation:
            "Wait for the indexing worker or run a backfill before calling find_similar_cases.",
        });
      }

      const hasSeed =
        args.startupId !== undefined
        || args.startupName !== undefined
        || args.query !== undefined
        || args.noteId !== undefined;
      if (!hasSeed) {
        throw BadRequest(
          "Provide startupId, startupName, query, or noteId to search Tomcat CRM memory.",
        );
      }

      const referenceStartup = await resolveReferenceStartup(caller, args);
      const sectorStartupIds = await resolveSectorStartupIds(caller, args.sector);

      let searchBasis: SimilarCasesData["searchBasis"] = "free_text";
      let queryTexts: string[] = [];

      if (args.noteId) {
        searchBasis = "note_anchor";
        const note = await store.getNoteById(args.noteId);
        if (!note) {
          throw BadRequest(`No note found for noteId "${args.noteId}".`);
        }
        queryTexts = [note.body.slice(0, 2000)];
      } else if (referenceStartup) {
        searchBasis = "startup_profile";
        const recentNotes = await startups.listAccessibleNotes(
          caller,
          { startupId: referenceStartup.id },
          { limit: 1, minBodyLength: 100 },
        );
        const hydeResult = await hyde.generateHydeQueries({
          mode: "startup_profile",
          startup: referenceStartup,
          recentNoteExcerpt: recentNotes[0]?.body.slice(0, 800),
        });
        queryTexts = hydeResult.hypotheticalNotes;
      } else if (args.query) {
        const hydeResult = await hyde.generateHydeQueries({
          mode: "free_text",
          query: args.query,
        });
        queryTexts = hydeResult.hypotheticalNotes;
      }

      if (queryTexts.length === 0) {
        throw BadRequest("Could not build a semantic search query from the provided input.");
      }

      const rawHits = await searchWithQueries({
        queryTexts,
        ...(args.chunkKind !== undefined ? { chunkKind: args.chunkKind } : {}),
        ...(args.authorEmail !== undefined ? { authorEmail: args.authorEmail } : {}),
        ...(sectorStartupIds !== undefined
          ? { sectorStartupIds }
          : {}),
        ...(args.sinceDays !== undefined ? { sinceDays: args.sinceDays } : {}),
        ...(referenceStartup?.id !== undefined
          ? { excludeStartupId: referenceStartup.id }
          : {}),
      });

      const visibleHits: KnowledgeChunkSearchHit[] = [];
      for (const hit of rawHits) {
        const note = await store.getNoteById(hit.noteId);
        if (!note) continue;
        if (!canSeeNote(caller, note)) continue;
        if (
          args.authorEmail !== undefined
          && !matchesAuthorEmail(note, args.authorEmail)
        ) {
          continue;
        }
        visibleHits.push(hit);
      }

      const aggregated = aggregateByStartup(visibleHits).slice(0, matchLimit);
      const matches: SimilarCaseMatch[] = [];

      for (const item of aggregated) {
        const startupMatches = await startups.searchStartups(
          caller,
          { startupId: item.startupId },
          { limit: 1 },
        );
        const startup = startupMatches[0];
        if (!startup) continue;

        matches.push({
          startupId: startup.id,
          name: startup.name,
          sectors: startup.sectors,
          similarityScore: Number(item.score.toFixed(4)),
          whySimilar: buildWhySimilar(item.hits),
          soWhat: buildSoWhat(item.hits),
          topEvidence: item.hits.slice(0, EVIDENCE_PER_CASE).map((hit) => ({
            noteId: hit.noteId,
            authorEmail: hit.authorEmail,
            createdAt: hit.noteCreatedAt,
            excerpt: excerpt(hit.chunkText),
            noteKind: hit.meta.noteKind,
            chunkKind: hit.chunkKind,
          })),
        });
      }

      if (referenceStartup && matches.length === 0) {
        warnings.push({
          code: ToolWarningCodes.NO_SECTOR_MATCHES,
          message: "No semantically similar historical cases matched the reference startup.",
          mitigation:
            "Try find_competitive_history for sector peers, or broaden filters (sinceDays, authorEmail).",
        });
      }

      const nextSuggestedTools: SuggestedToolCall[] = [];
      if (matches[0]) {
        nextSuggestedTools.push({
          toolName: "read_startup_notes",
          reason: "Read full CRM notes for the closest similar case",
          arguments: {
            startupId: matches[0].startupId,
            ...(args.authorEmail !== undefined
              ? { authorEmail: args.authorEmail }
              : {}),
          },
        });
      }
      if (referenceStartup) {
        nextSuggestedTools.push({
          toolName: "find_competitive_history",
          reason: "Compare sector-tagged peers as a complement to semantic memory",
          arguments: { startupId: referenceStartup.id, notesPerMatch: 5 },
        });
      }

      const data: SimilarCasesData = {
        searchBasis,
        referenceStartup: referenceStartup
          ? {
              id: referenceStartup.id,
              name: referenceStartup.name,
              sectors: referenceStartup.sectors,
            }
          : null,
        matchCount: matches.length,
        matches,
        indexStats: { chunksIndexed: indexedChunks },
      };

      return wrapToolOutput(data, { warnings, nextSuggestedTools });
    },
  };
};

export type SimilarCasesService = ReturnType<typeof buildSimilarCasesService>;
