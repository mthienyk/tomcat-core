import { describe, it, expect, beforeEach } from "vitest";
import { ingestSerperResult, ingestUnipilePost, summarise } from "../../src/services/signalHub/ingest.js";
import type { SignalStore } from "../../src/storage/signalStore.js";
import type { SignalEvent } from "../../src/domain/signalHub.js";

const makeStore = (): SignalStore & { events: SignalEvent[] } => {
  const events: SignalEvent[] = [];

  return {
    events,
    async addWatched() { throw new Error("not implemented"); },
    async getWatched() { return undefined; },
    async findWatchedByName() { return []; },
    async findWatchedByLinkedinIdentifier() { return undefined; },
    async findWatchedByStartupId() { return undefined; },
    async listWatched() { return []; },
    async updateWatchedPriority() {},

    async appendEvent(event) {
      const full: SignalEvent = { ...event, ingestedAt: new Date().toISOString() };
      events.push(full);
      return full;
    },
    async findEventByHash(source, signalType, contentHash) {
      return events.find(
        (e) => e.source === source && e.signalType === signalType && e.contentHash === contentHash,
      );
    },
    async listEvents() { return events; },

    async upsertUnipileAccount() { throw new Error("not implemented"); },
    async getUnipileAccount() { return undefined; },
    async listUnipileAccounts() { return []; },
    async setUnipileAccountState() {},
    async appendUnipileStatusEvent() {},
    async listUnipileStatusEvents() { return []; },
  } as unknown as SignalStore & { events: SignalEvent[] };
};

const serperResult = {
  title: "Founder posts about AI",
  link: "https://linkedin.com/posts/john-activity-123",
  snippet: "We just launched our new AI product",
  date: "2026-05-17",
};

describe("ingestSerperResult", () => {
  let store: ReturnType<typeof makeStore>;
  beforeEach(() => { store = makeStore(); });

  it("creates a new event for a new result", async () => {
    const outcome = await ingestSerperResult(store, {
      watchedId: "w1",
      startupId: "s1",
      result: serperResult,
    });
    expect(outcome.status).toBe("created");
    expect(store.events).toHaveLength(1);
    expect(store.events[0].source).toBe("serper_public");
    expect(store.events[0].signalType).toBe("post");
    expect(store.events[0].watchedId).toBe("w1");
    expect(store.events[0].startupId).toBe("s1");
  });

  it("deduplicates identical results", async () => {
    await ingestSerperResult(store, { watchedId: "w1", startupId: "s1", result: serperResult });
    const second = await ingestSerperResult(store, {
      watchedId: "w1",
      startupId: "s1",
      result: serperResult,
    });
    expect(second.status).toBe("duplicate");
    expect(store.events).toHaveLength(1);
  });

  it("creates distinct events for different results", async () => {
    await ingestSerperResult(store, { watchedId: "w1", startupId: "s1", result: serperResult });
    await ingestSerperResult(store, {
      watchedId: "w1",
      startupId: "s1",
      result: { ...serperResult, link: "https://linkedin.com/posts/john-activity-456", snippet: "Different content here" },
    });
    expect(store.events).toHaveLength(2);
  });
});

describe("ingestUnipilePost", () => {
  let store: ReturnType<typeof makeStore>;
  beforeEach(() => { store = makeStore(); });

  const post = {
    id: "123456",
    socialId: "urn:li:activity:123456",
    shareUrl: "https://linkedin.com/posts/john-activity-123456",
    date: "3d",
    parsedDatetime: "2026-05-14T10:00:00.000Z",
    text: "Excited to share our funding news",
    authorName: "John Doe",
    authorIdentifier: "john-doe",
    isCompany: false,
    reactionCounter: 42,
    commentCounter: 5,
    repostCounter: 2,
    isRepost: false,
  };

  it("creates an event from a Unipile post", async () => {
    const outcome = await ingestUnipilePost(store, {
      watchedId: "w1",
      startupId: "s1",
      unipileAccountId: "acc1",
      post,
    });
    expect(outcome.status).toBe("created");
    expect(store.events[0].source).toBe("unipile");
    expect(store.events[0].unipileAccountId).toBe("acc1");
    expect(store.events[0].rawText).toBe(post.text);
  });

  it("deduplicates on same socialId + text", async () => {
    await ingestUnipilePost(store, { watchedId: "w1", startupId: "s1", unipileAccountId: "acc1", post });
    const second = await ingestUnipilePost(store, {
      watchedId: "w1",
      startupId: "s1",
      unipileAccountId: "acc1",
      post,
    });
    expect(second.status).toBe("duplicate");
    expect(store.events).toHaveLength(1);
  });
});

describe("summarise", () => {
  it("counts created and duplicate outcomes", () => {
    const results = [
      { status: "created" as const, event: {} as SignalEvent },
      { status: "duplicate" as const },
      { status: "created" as const, event: {} as SignalEvent },
    ];
    expect(summarise(results)).toEqual({ created: 2, duplicates: 1 });
  });
});
