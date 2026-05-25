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
import { resolveNoteAnchorQueryTexts } from "./noteAnchorTexts.js";
import {
  applyNoteQualityBoost,
  buildSearchQualitySignals,
} from "./searchQualitySignals.js";

const EXCERPT_MAX = 400;
const SEARCH_POOL = 60;
const EVIDENCE_PER_CASE = 3;
const MAX_SEARCH_TEXTS = 3;

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
    const boostedScore = applyNoteQualityBoost(
      hit.score,
      hit.meta.noteKind,
      hit.meta.confidence,
    );
    const boostedHit = { ...hit, score: boostedScore };
    const bucket = grouped.get(hit.startupId) ?? [];
    bucket.push(boostedHit);
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

const normalizeSearchTexts = (texts: readonly string[]): string[] =>
  texts.map((text) => text.trim()).filter(Boolean).slice(0, MAX_SEARCH_TEXTS);

export const buildSimilarCasesService = (deps: {
  store: CoreStore;
  startups: StartupsService;
  embeddings: EmbeddingProvider | undefined;
}) => {
  const { store, startups, embeddings } = deps;

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
        searchTexts?: string[];
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
          code: ToolWarningCodes.CRM_MEMORY_INDEX_EMPTY,
          message: "Semantic CRM memory index has no embedded chunks yet.",
          mitigation:
            "Wait for the indexing worker or run a backfill before calling find_similar_cases.",
        });
      }

      const hasSearchInput =
        args.noteId !== undefined
        || args.searchTexts !== undefined
        || args.query !== undefined;
      if (!hasSearchInput) {
        throw BadRequest(
          "Provide searchTexts (preferred), query, or noteId to search Tomcat CRM memory.",
        );
      }

      const referenceStartup = await resolveReferenceStartup(caller, args);
      const sectorStartupIds = await resolveSectorStartupIds(caller, args.sector);

      if (args.sector !== undefined && sectorStartupIds?.length === 0) {
        const data: SimilarCasesData = {
          searchBasis: args.noteId
            ? "note_anchor"
            : args.searchTexts?.length
              ? "client_text"
              : "free_text",
          referenceStartup: referenceStartup
            ? {
                id: referenceStartup.id,
                name: referenceStartup.name,
                sectors: referenceStartup.sectors,
              }
            : null,
          matchCount: 0,
          matches: [],
          indexStats: { chunksIndexed: indexedChunks },
        };
        warnings.push({
          code: ToolWarningCodes.NO_SECTOR_MATCHES,
          message: `No startups matched sector filter "${args.sector}".`,
          mitigation: "Try a broader sector label or remove the sector filter.",
        });
        return wrapToolOutput(data, { warnings });
      }

      let searchBasis: SimilarCasesData["searchBasis"] = "free_text";
      let queryTexts: string[] = [];

      if (args.noteId) {
        searchBasis = "note_anchor";
        const note = await store.getNoteById(args.noteId);
        if (!note) {
          throw BadRequest(`No note found for noteId "${args.noteId}".`);
        }
        if (!canSeeNote(caller, note)) {
          throw BadRequest(`Note "${args.noteId}" is not visible to this caller.`);
        }
        const indexedChunks = await store.listKnowledgeChunksForNote(args.noteId);
        const anchor = resolveNoteAnchorQueryTexts({
          chunks: indexedChunks,
          noteBody: note.body,
        });
        if (anchor.queryTexts.length === 0) {
          throw BadRequest(`Note "${args.noteId}" has no searchable body content.`);
        }
        queryTexts = anchor.queryTexts;
        if (!anchor.usedIndexedChunks) {
          warnings.push({
            code: ToolWarningCodes.NO_SIMILAR_CASES,
            message:
              "Note anchor used raw HubSpot body because indexed recap/lens chunks are missing.",
            mitigation:
              "Wait for the indexing worker or use searchTexts written in recap/investment_lens style.",
          });
        }
      } else if (args.searchTexts !== undefined) {
        queryTexts = normalizeSearchTexts(args.searchTexts);
        if (queryTexts.length === 0) {
          throw BadRequest("searchTexts must contain at least one non-empty string.");
        }
        searchBasis = "client_text";
      } else if (args.query) {
        const query = args.query.trim();
        if (!query) {
          throw BadRequest("query must be a non-empty string.");
        }
        queryTexts = [query];
        searchBasis = "free_text";
      }

      if (
        (args.startupId !== undefined || args.startupName !== undefined)
        && !referenceStartup
      ) {
        throw BadRequest(
          "Reference startup not found or not visible to this caller.",
        );
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

      if (matches.length === 0) {
        warnings.push({
          code: ToolWarningCodes.NO_SIMILAR_CASES,
          message: "No semantically similar historical cases matched the query.",
          mitigation:
            "Rewrite searchTexts as refined recap/investment_lens excerpts with operational vocabulary, try chunkKind recap for product wedge, or broaden sinceDays.",
        });
      }

      const qualityInputTexts =
        searchBasis === "client_text" || searchBasis === "free_text"
          ? queryTexts
          : [];
      const qualitySignalsBundle =
        qualityInputTexts.length > 0 && matches.length > 0
          ? buildSearchQualitySignals({
              searchTexts: qualityInputTexts,
              matches,
            })
          : undefined;

      if (qualitySignalsBundle?.regimeSignals.scoreLevel === "low") {
        warnings.push({
          code: ToolWarningCodes.NO_SIMILAR_CASES,
          message:
            "Top semantic score is low — searchTexts may be outside the refined excerpt encoding regime.",
          mitigation:
            qualitySignalsBundle.suggestedRewrite
            ?? "Rewrite searchTexts as operational recap/investment_lens excerpts, not a user question.",
        });
      }

      if (qualitySignalsBundle?.qualitySignals.noisyTopMatch) {
        warnings.push({
          code: ToolWarningCodes.NO_SIMILAR_CASES,
          message:
            "Top match may be a high-score outlier — inspect top 2–3 and consider chunkKind recap or refined searchTexts.",
          mitigation:
            "Ignore top 1 if off-theme; prefer matches that cluster thematically in whySimilar.",
        });
      }

      const nextSuggestedTools: SuggestedToolCall[] = [];
      if (matches[0]) {
        nextSuggestedTools.push({
          toolName: "read_startup_notes",
          reason: "Read full CRM notes for the closest similar case",
          arguments: {
            startupId: matches[0].startupId,
          },
        });
      }
      if (referenceStartup) {
        nextSuggestedTools.push({
          toolName: "find_competitive_history",
          reason:
            "Broad portfolio scan by HubSpot sector tag (complement only, not product-wedge search)",
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
        ...(qualitySignalsBundle?.regimeSignals !== undefined
          ? { regimeSignals: qualitySignalsBundle.regimeSignals }
          : {}),
        ...(qualitySignalsBundle?.qualitySignals !== undefined
          ? { qualitySignals: qualitySignalsBundle.qualitySignals }
          : {}),
        ...(qualitySignalsBundle?.suggestedRewrite !== undefined
          ? { suggestedRewrite: qualitySignalsBundle.suggestedRewrite }
          : {}),
        indexStats: { chunksIndexed: indexedChunks },
      };

      return wrapToolOutput(data, { warnings, nextSuggestedTools });
    },
  };
};

export type SimilarCasesService = ReturnType<typeof buildSimilarCasesService>;
