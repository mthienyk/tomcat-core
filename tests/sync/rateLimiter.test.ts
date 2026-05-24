import { describe, expect, it } from "vitest";
import { createRateLimiter } from "../../src/sync/rateLimiter.js";

describe("createRateLimiter", () => {
  it("allows bursts up to maxRequests within the window", async () => {
    const limiter = createRateLimiter({
      maxRequests: 3,
      windowMs: 1_000,
    });

    const start = Date.now();
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(200);
  });

  it("blocks when the window is full", async () => {
    const limiter = createRateLimiter({
      maxRequests: 2,
      windowMs: 80,
    });

    await limiter.acquire();
    await limiter.acquire();
    const start = Date.now();
    await limiter.acquire();
    expect(Date.now() - start).toBeGreaterThanOrEqual(10);
  });
});
