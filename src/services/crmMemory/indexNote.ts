import {
  CRM_MEMORY_SCHEMA_VERSION,
  type CrmMemoryChunkKind,
  type KnowledgeIndexChunkInput,
  type NoteIndexingContext,
} from "../../domain/crmMemory.js";
import type { CoreStore } from "../../storage/coreStore.js";
import type { EmbeddingProvider } from "../../llm/embeddings/types.js";
import type { SemanticCardGenerator } from "./semanticCard.js";
import { noteContentHash } from "./contentHash.js";

const MIN_BODY_LENGTH = 100;

const chunkId = (
  noteId: string,
  chunkKind: CrmMemoryChunkKind,
  contentHash: string,
): string => `${noteId}:${chunkKind}:${contentHash.slice(0, 12)}`;

const mapWithConcurrency = async <T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> => {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await fn(items[index]!);
      }
    },
  );
  await Promise.all(workers);
  return results;
};

export const buildNoteIndexer = (deps: {
  store: CoreStore;
  semanticCards: SemanticCardGenerator;
  embeddingProvider: EmbeddingProvider;
  semanticModel: string | undefined;
  concurrency: number;
}) => {
  const { store, semanticCards, embeddingProvider, semanticModel, concurrency } =
    deps;

  const indexNote = async (context: NoteIndexingContext): Promise<void> => {
    const contentHash = noteContentHash(context.note.body);
    const card = await semanticCards.generateSemanticCard(context);

    const chunkSpecs: Array<{ kind: CrmMemoryChunkKind; text: string; idx: number }> = [
      { kind: "recap", text: card.recap, idx: 0 },
      { kind: "investment_lens", text: card.investmentLens, idx: 1 },
    ];

    const embeddings = await embeddingProvider.embed(
      chunkSpecs.map((spec) => spec.text),
    );

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
    const contexts: NoteIndexingContext[] = [];

    for (const note of notes) {
      if (!note.startupId || note.body.trim().length < MIN_BODY_LENGTH) {
        continue;
      }
      const startup = await store.getStartupById(note.startupId);
      if (!startup) {
        continue;
      }

      contexts.push({
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
    }

    await mapWithConcurrency(contexts, concurrency, indexNote);
    return contexts.length;
  };

  return { indexNote, indexPendingBatch };
};

export type NoteIndexer = ReturnType<typeof buildNoteIndexer>;
