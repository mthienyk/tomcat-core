import {
  CRM_MEMORY_SCHEMA_VERSION,
  type CrmMemoryChunkKind,
  type KnowledgeIndexChunkInput,
  type NoteIndexingContext,
} from "../../domain/crmMemory.js";
import type { CoreStore } from "../../storage/coreStore.js";
import type { EmbeddingProvider } from "../../llm/embeddings/types.js";
import type { Logger } from "../../logger/index.js";
import type { SemanticCardGenerator } from "./semanticCard.js";
import { noteContentHash } from "./contentHash.js";
import {
  noteIndexSkipHash,
  postCardSkipReason,
  preIndexSkipReason,
} from "./indexEligibility.js";

const chunkId = (
  noteId: string,
  chunkKind: CrmMemoryChunkKind,
  contentHash: string,
): string => `${noteId}:${chunkKind}:${contentHash.slice(0, 12)}`;

const assertEmbeddings = (
  provider: EmbeddingProvider,
  texts: readonly string[],
  embeddings: readonly number[][],
): void => {
  if (embeddings.length !== texts.length) {
    throw new Error(
      `Embedding provider returned ${embeddings.length} vectors for ${texts.length} texts`,
    );
  }

  for (const [index, embedding] of embeddings.entries()) {
    if (embedding.length !== provider.dimensions) {
      throw new Error(
        `Embedding ${index} has dimension ${embedding.length}, expected ${provider.dimensions}`,
      );
    }
  }
};

export const buildNoteIndexer = (deps: {
  store: CoreStore;
  semanticCards: SemanticCardGenerator;
  embeddingProvider: EmbeddingProvider;
  semanticModel: string | undefined;
  concurrency: number;
  logger?: Logger;
  resolveStartupForNote?: (startupId: string) => Promise<void>;
}) => {
  const {
    store,
    semanticCards,
    embeddingProvider,
    semanticModel,
    concurrency,
    logger,
    resolveStartupForNote,
  } = deps;

  const skipNote = async (
    noteId: string,
    body: string,
    reason: "short" | "ops",
  ): Promise<void> => {
    await store.replaceKnowledgeChunksForNote(noteId, []);
    await store.markNoteIndexed(noteId, noteIndexSkipHash(reason, body));
  };

  const indexNote = async (context: NoteIndexingContext): Promise<void> => {
    const contentHash = noteContentHash(context.note.body);
    const preSkip = preIndexSkipReason(context.note.body);
    if (preSkip) {
      await skipNote(context.note.id, context.note.body, preSkip);
      return;
    }

    const card = await semanticCards.generateSemanticCard(context);
    const postSkip = postCardSkipReason(card.noteKind);
    if (postSkip) {
      await skipNote(context.note.id, context.note.body, postSkip);
      return;
    }

    const chunkSpecs: Array<{ kind: CrmMemoryChunkKind; text: string; idx: number }> = [
      { kind: "recap", text: card.recap, idx: 0 },
      { kind: "investment_lens", text: card.investmentLens, idx: 1 },
    ];

    const embeddings = await embeddingProvider.embed(
      chunkSpecs.map((spec) => spec.text),
    );
    assertEmbeddings(embeddingProvider, chunkSpecs.map((spec) => spec.text), embeddings);

    const chunks: KnowledgeIndexChunkInput[] = chunkSpecs.map((spec, index) => ({
      id: chunkId(context.note.id, spec.kind, contentHash),
      sourceKind: "hubspot_note",
      sourceId: context.note.id,
      chunkKind: spec.kind,
      chunkIdx: spec.idx,
      chunkText: spec.text,
      contentHash,
      embedding: embeddings[index],
      embeddingModel: embeddingProvider.model,
      semanticModel,
      semanticSchemaVersion: CRM_MEMORY_SCHEMA_VERSION,
      startupId: context.startup.id,
      authorEmail: context.note.authorEmail,
      noteCreatedAt: context.note.createdAt,
      meta: card,
    }));

    await store.replaceKnowledgeChunksForNote(context.note.id, chunks);
    await store.markNoteIndexed(context.note.id, contentHash);
  };

  const indexPendingBatch = async (limit: number): Promise<number> => {
    const notes = await store.listNotesPendingIndex(limit);
    let indexed = 0;

    const runOne = async (note: (typeof notes)[number]): Promise<void> => {
      if (!note.startupId) {
        return;
      }

      let startup = await store.getStartupById(note.startupId);
      if (!startup && resolveStartupForNote) {
        await resolveStartupForNote(note.startupId);
        startup = await store.getStartupById(note.startupId);
      }
      if (!startup) {
        logger?.warn(
          { noteId: note.id, startupId: note.startupId },
          "crm_memory_index_skipped_missing_startup",
        );
        return;
      }

      await indexNote({
        note: {
          id: note.id,
          body: note.body,
          authorEmail: note.authorEmail,
          createdAt: note.createdAt,
          sensitivity: note.sensitivity,
        },
        startup: {
          id: startup.id,
          name: startup.name,
          sectors: startup.sectors,
          stage: startup.stage,
          country: startup.country,
          description: startup.description,
        },
      });
      indexed += 1;
    };

    let cursor = 0;
    const workers = Array.from(
      { length: Math.min(concurrency, notes.length) },
      async () => {
        while (cursor < notes.length) {
          const index = cursor;
          cursor += 1;
          const note = notes[index];
          if (!note) continue;
          try {
            await runOne(note);
          } catch (err) {
            logger?.error(
              { err, noteId: note.id, startupId: note.startupId },
              "crm_memory_index_note_failed",
            );
          }
        }
      },
    );
    await Promise.all(workers);
    return indexed;
  };

  return { indexNote, indexPendingBatch };
};

export type NoteIndexer = ReturnType<typeof buildNoteIndexer>;
