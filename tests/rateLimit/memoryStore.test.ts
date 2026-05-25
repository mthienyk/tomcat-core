import { describe, expect, it } from "vitest";
import { createMemoryRateLimitStore } from "../../src/rateLimit/memoryStore.js";

describe("createMemoryRateLimitStore", () => {
  it("blocks after the configured limit within a window", async () => {
    const store = createMemoryRateLimitStore();
    const rule = { limit: 2, windowSeconds: 60 };

    expect(
      (await store.consume("society.auth.magic_link", "ip:1", rule)).allowed,
    ).toBe(true);
    expect(
      (await store.consume("society.auth.magic_link", "ip:1", rule)).allowed,
    ).toBe(true);
    const blocked = await store.consume("society.auth.magic_link", "ip:1", rule);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it("isolates keys under the same rule", async () => {
    const store = createMemoryRateLimitStore();
    const rule = { limit: 1, windowSeconds: 60 };

    expect(
      (await store.consume("society.auth.magic_link", "ip:a", rule)).allowed,
    ).toBe(true);
    expect(
      (await store.consume("society.auth.magic_link", "ip:b", rule)).allowed,
    ).toBe(true);
  });
});
