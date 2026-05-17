import { createHash } from "crypto";
import { randomUUID } from "crypto";
import type { SignalStore } from "../../storage/signalStore.js";
import type { SignalEvent } from "../../domain/signalHub.js";
import type { SerperSearchResult } from "../../connectors/serper.js";
import type { UnipilePost } from "../../connectors/unipile.js";

// Returns SHA-256 of normalised content, truncated to 64 chars.
// Normalisation strips whitespace variation to avoid near-duplicate events.
const buildHash = (...parts: string[]): string =>
  createHash("sha256")
    .update(parts.join("\x00").replace(/\s+/g, " ").trim())
    .digest("hex")
    .slice(0, 64);

type IngestResult =
  | { status: "created"; event: SignalEvent }
  | { status: "duplicate" };

// --- Serper / public SERP ---

export type SerperIngestInput = {
  watchedId: string | undefined;
  startupId: string | undefined;
  result: SerperSearchResult;
};

export const ingestSerperResult = async (
  store: SignalStore,
  input: SerperIngestInput,
): Promise<IngestResult> => {
  const { result, watchedId, startupId } = input;

  const contentHash = buildHash(result.link, result.snippet);
  const existing = await store.findEventByHash("serper_public", "post", contentHash);
  if (existing) return { status: "duplicate" };

  const event = await store.appendEvent({
    id: randomUUID(),
    source: "serper_public",
    signalType: "post",
    watchedId,
    startupId,
    unipileAccountId: undefined,
    emittedAt: result.date,
    url: result.link,
    rawText: `${result.title}\n${result.snippet}`,
    rawPayload: result as unknown as Record<string, unknown>,
    contentHash,
  });

  return { status: "created", event };
};

// --- Unipile / LinkedIn private ---

export type UnipilePostIngestInput = {
  watchedId: string | undefined;
  startupId: string | undefined;
  unipileAccountId: string;
  post: UnipilePost;
};

export const ingestUnipilePost = async (
  store: SignalStore,
  input: UnipilePostIngestInput,
): Promise<IngestResult> => {
  const { post, watchedId, startupId, unipileAccountId } = input;

  const contentHash = buildHash(post.socialId || post.id, post.text);
  const existing = await store.findEventByHash("unipile", "post", contentHash);
  if (existing) return { status: "duplicate" };

  const event = await store.appendEvent({
    id: randomUUID(),
    source: "unipile",
    signalType: "post",
    watchedId,
    startupId,
    unipileAccountId,
    emittedAt: post.parsedDatetime ?? post.date,
    url: post.shareUrl,
    rawText: post.text,
    rawPayload: post as unknown as Record<string, unknown>,
    contentHash,
  });

  return { status: "created", event };
};

export type IngestSummary = {
  created: number;
  duplicates: number;
};

export const summarise = (results: IngestResult[]): IngestSummary => ({
  created: results.filter((r) => r.status === "created").length,
  duplicates: results.filter((r) => r.status === "duplicate").length,
});
