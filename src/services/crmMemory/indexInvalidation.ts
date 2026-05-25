import type { Note } from "../../domain/entities.js";
import { noteIndexSkipHash, preIndexSkipReason } from "./indexEligibility.js";

export type SemanticIndexUpsertPlan = {
  shouldDeleteChunks: boolean;
  keepExistingHash: boolean;
  nextSemanticIndexHash: string | null;
};

type IndexableNoteFields = Pick<Note, "body" | "startupId" | "authorEmail">;

export const semanticIndexFieldsChanged = (
  existing: IndexableNoteFields | undefined,
  incoming: IndexableNoteFields,
): boolean =>
  existing === undefined
  || existing.body !== incoming.body
  || existing.startupId !== incoming.startupId
  || existing.authorEmail !== incoming.authorEmail;

export const planSemanticIndexOnNoteUpsert = (
  existing: IndexableNoteFields | undefined,
  incoming: IndexableNoteFields,
): SemanticIndexUpsertPlan => {
  const indexFieldsChanged = semanticIndexFieldsChanged(existing, incoming);

  if (!indexFieldsChanged) {
    return {
      shouldDeleteChunks: false,
      keepExistingHash: true,
      nextSemanticIndexHash: null,
    };
  }

  const shortSkip = preIndexSkipReason(incoming.body);
  if (shortSkip) {
    return {
      shouldDeleteChunks: true,
      keepExistingHash: false,
      nextSemanticIndexHash: noteIndexSkipHash(shortSkip, incoming.body),
    };
  }

  return {
    shouldDeleteChunks: true,
    keepExistingHash: false,
    nextSemanticIndexHash: null,
  };
};
