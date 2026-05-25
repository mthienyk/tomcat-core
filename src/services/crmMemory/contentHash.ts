import { createHash } from "node:crypto";
import { CRM_MEMORY_SCHEMA_VERSION } from "../../domain/crmMemory.js";

export const noteContentHash = (body: string): string =>
  createHash("sha256")
    .update(`${CRM_MEMORY_SCHEMA_VERSION}:${body.trim()}`)
    .digest("hex");

const MIN_INDEX_BODY_LENGTH = 100;

export const noteNeedsSemanticIndex = (input: {
  body: string;
  startupId: string | undefined;
  semanticIndexHash: string | null | undefined;
}): boolean => {
  if (!input.startupId) return false;
  if (input.body.trim().length < MIN_INDEX_BODY_LENGTH) return false;
  const expected = noteContentHash(input.body);
  return !input.semanticIndexHash || input.semanticIndexHash !== expected;
};
