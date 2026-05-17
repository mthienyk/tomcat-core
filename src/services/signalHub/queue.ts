import { randomUUID } from "crypto";
import type { SignalStore } from "../../storage/signalStore.js";
import type { SerperConnector } from "../../connectors/serper.js";
import type { UnipileConnector } from "../../connectors/unipile.js";
import type { GuardianRegistry } from "./accountGuardian.js";
import type { WatchedEntity } from "../../domain/signalHub.js";
import {
  ingestSerperResult,
  ingestUnipilePost,
  summarise,
} from "./ingest.js";

type PublicJob = {
  kind: "public";
  jobId: string;
  watched: WatchedEntity;
  enqueuedAt: Date;
};

type UnipileJob = {
  kind: "unipile";
  jobId: string;
  watched: WatchedEntity;
  unipileAccountId: string;
  enqueuedAt: Date;
};

// Union type used for future exhaustive pattern matching over job kinds.
export type SignalJob = PublicJob | UnipileJob;

export type EnqueueResult = {
  jobId: string;
  accepted: true;
};

// --- Public lane (Serper) ---
// Simple in-process FIFO, not persisted. Jobs lost on restart are acceptable.
// Rate: up to SERPER_RATE_PER_MIN calls/min global.

const SERPER_INTERVAL_MS = 3_500; // ~17/min, comfortable under 20/min default limit

// --- Unipile lane ---
// Per-account. Each dequeue checks the guardian first; if refused, re-enqueues
// with the guardian's retryAfterMs. Uses setInterval polling to avoid busy loops.

const UNIPILE_POLL_INTERVAL_MS = 15_000;

export type SignalQueue = {
  enqueuePublic(watched: WatchedEntity): EnqueueResult;
  enqueueUnipile(watched: WatchedEntity, unipileAccountId: string): EnqueueResult;
  start(): void;
  stop(): void;
};

export const createSignalQueue = (deps: {
  store: SignalStore;
  serper: SerperConnector;
  unipile: UnipileConnector;
  guardians: GuardianRegistry;
}): SignalQueue => {
  const { store, serper, unipile, guardians } = deps;

  const publicQueue: PublicJob[] = [];
  const unipileQueue: UnipileJob[] = [];

  let publicTimer: ReturnType<typeof setInterval> | undefined;
  let unipileTimer: ReturnType<typeof setInterval> | undefined;
  let running = false;

  const processPublicJob = async (job: PublicJob): Promise<void> => {
    const { watched } = job;
    const query = watched.displayName;

    try {
      const results = await serper.searchLinkedinPosts(query, { limit: 10 });
      const outcomes = await Promise.all(
        results.map((r) =>
          ingestSerperResult(store, {
            watchedId: watched.id,
            startupId: watched.startupId,
            result: r,
          }),
        ),
      );
      const summary = summarise(outcomes);
      if (summary.created > 0 || summary.duplicates > 0) {
        // Structured log — the caller (logger) will pick this up
        process.stdout.write(
          JSON.stringify({
            level: "info",
            msg: "signal_hub.serper.ingested",
            watchedId: watched.id,
            displayName: watched.displayName,
            ...summary,
          }) + "\n",
        );
      }
    } catch {
      // Non-fatal — log and continue. The job is not re-enqueued automatically;
      // operator can trigger a refresh again.
      process.stderr.write(
        JSON.stringify({
          level: "warn",
          msg: "signal_hub.serper.job_failed",
          watchedId: watched.id,
          jobId: job.jobId,
        }) + "\n",
      );
    }
  };

  const processUnipileJob = async (job: UnipileJob): Promise<void> => {
    const { watched, unipileAccountId } = job;

    const guardian = guardians.get(unipileAccountId);
    if (!guardian) return; // account not registered yet — drop job

    const check = guardian.canRun();
    if (!check.allowed) {
      // Re-enqueue at the back with delay — the poll loop will pick it up
      setTimeout(() => unipileQueue.push(job), check.retryAfterMs);
      return;
    }

    if (!watched.linkedinIdentifier) return; // can't poll without identifier

    try {
      const { posts } = await unipile.listUserPosts(
        unipileAccountId,
        watched.linkedinIdentifier,
        { limit: 20 },
      );
      guardian.recordSuccess();

      const outcomes = await Promise.all(
        posts.map((p) =>
          ingestUnipilePost(store, {
            watchedId: watched.id,
            startupId: watched.startupId,
            unipileAccountId,
            post: p,
          }),
        ),
      );
      const summary = summarise(outcomes);
      if (summary.created > 0 || summary.duplicates > 0) {
        process.stdout.write(
          JSON.stringify({
            level: "info",
            msg: "signal_hub.unipile.ingested",
            watchedId: watched.id,
            displayName: watched.displayName,
            unipileAccountId,
            ...summary,
          }) + "\n",
        );
      }
    } catch (err) {
      const status =
        err instanceof Error && "details" in err
          ? ((err as { details?: { status?: number } }).details?.status ?? 0)
          : 0;
      guardian.recordFailure(status);
      process.stderr.write(
        JSON.stringify({
          level: "warn",
          msg: "signal_hub.unipile.job_failed",
          watchedId: watched.id,
          unipileAccountId,
          httpStatus: status,
        }) + "\n",
      );
    }
  };

  return {
    enqueuePublic(watched: WatchedEntity): EnqueueResult {
      const jobId = randomUUID();
      publicQueue.push({ kind: "public", jobId, watched, enqueuedAt: new Date() });
      return { jobId, accepted: true };
    },

    enqueueUnipile(watched: WatchedEntity, unipileAccountId: string): EnqueueResult {
      const jobId = randomUUID();
      unipileQueue.push({
        kind: "unipile",
        jobId,
        watched,
        unipileAccountId,
        enqueuedAt: new Date(),
      });
      return { jobId, accepted: true };
    },

    start(): void {
      if (running) return;
      running = true;

      publicTimer = setInterval(() => {
        const job = publicQueue.shift();
        if (job) void processPublicJob(job);
      }, SERPER_INTERVAL_MS);

      unipileTimer = setInterval(() => {
        const job = unipileQueue.shift();
        if (job) void processUnipileJob(job);
      }, UNIPILE_POLL_INTERVAL_MS);
    },

    stop(): void {
      if (!running) return;
      running = false;
      if (publicTimer !== undefined) clearInterval(publicTimer);
      if (unipileTimer !== undefined) clearInterval(unipileTimer);
    },
  };
};
