import type { CrmMemoryChunkKind } from "../../domain/crmMemory.js";

export type NoteAnchorChunk = {
  chunkKind: CrmMemoryChunkKind;
  chunkText: string;
};

const ANCHOR_BODY_FALLBACK_MAX = 2000;

export const resolveNoteAnchorQueryTexts = (input: {
  chunks: readonly NoteAnchorChunk[];
  noteBody: string;
}): { queryTexts: string[]; usedIndexedChunks: boolean } => {
  const recap = input.chunks.find((chunk) => chunk.chunkKind === "recap")?.chunkText
    .trim();
  const lens = input.chunks
    .find((chunk) => chunk.chunkKind === "investment_lens")
    ?.chunkText.trim();

  const indexed = [recap, lens].filter(
    (text): text is string => Boolean(text),
  );

  if (indexed.length > 0) {
    return { queryTexts: indexed, usedIndexedChunks: true };
  }

  const fallback = input.noteBody.trim().slice(0, ANCHOR_BODY_FALLBACK_MAX);
  return {
    queryTexts: fallback ? [fallback] : [],
    usedIndexedChunks: false,
  };
};
