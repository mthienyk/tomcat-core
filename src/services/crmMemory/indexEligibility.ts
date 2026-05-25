import { noteContentHash } from "./contentHash.js";
import type { CrmMemoryNoteKind } from "../../domain/crmMemory.js";

export const MIN_SEMANTIC_INDEX_BODY_LENGTH = 500;

export type IndexSkipReason = "short" | "ops";

export const noteIndexSkipHash = (
  reason: IndexSkipReason,
  body: string,
): string => `skip:${reason}:${noteContentHash(body)}`;

export type SemanticIndexState =
  | { kind: "pending" }
  | { kind: "indexed"; contentHash: string }
  | { kind: "skipped"; reason: IndexSkipReason; contentHash: string };

export const parseSemanticIndexState = (
  hash: string | null | undefined,
): SemanticIndexState => {
  if (!hash) return { kind: "pending" };
  if (hash.startsWith("skip:")) {
    const [, reason, ...rest] = hash.split(":");
    const contentHash = rest.join(":");
    if (reason === "short" || reason === "ops") {
      return { kind: "skipped", reason, contentHash };
    }
  }
  return { kind: "indexed", contentHash: hash };
};

export const noteNeedsSemanticIndex = (input: {
  body: string;
  startupId: string | undefined;
  semanticIndexHash: string | null | undefined;
}): boolean => {
  if (!input.startupId) return false;
  if (input.body.trim().length < MIN_SEMANTIC_INDEX_BODY_LENGTH) return false;

  const expected = noteContentHash(input.body);
  const state = parseSemanticIndexState(input.semanticIndexHash);

  if (state.kind === "pending") return true;
  return state.contentHash !== expected;
};

export const preIndexSkipReason = (
  body: string,
): IndexSkipReason | undefined => {
  if (body.trim().length < MIN_SEMANTIC_INDEX_BODY_LENGTH) {
    return "short";
  }
  return undefined;
};

export const postCardSkipReason = (
  noteKind: CrmMemoryNoteKind,
): IndexSkipReason | undefined => {
  if (noteKind === "ops") return "ops";
  return undefined;
};
