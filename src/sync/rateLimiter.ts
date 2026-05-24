export type RateLimiter = {
  acquire(): Promise<void>;
};

export type RateLimiterOptions = {
  maxRequests: number;
  windowMs: number;
};

/**
 * Sliding-window rate limiter for outbound HubSpot API calls.
 * Default targets ~90% of the private-app burst cap (100 req / 10 s).
 */
export const createRateLimiter = (
  options: RateLimiterOptions,
): RateLimiter => {
  const timestamps: number[] = [];

  const prune = (now: number): void => {
    const cutoff = now - options.windowMs;
    while (timestamps.length > 0 && timestamps[0]! < cutoff) {
      timestamps.shift();
    }
  };

  const acquire = async (): Promise<void> => {
    for (;;) {
      const now = Date.now();
      prune(now);
      if (timestamps.length < options.maxRequests) {
        timestamps.push(now);
        return;
      }
      const waitMs = options.windowMs - (now - timestamps[0]!) + 5;
      await new Promise((resolve) => setTimeout(resolve, Math.max(waitMs, 10)));
    }
  };

  return { acquire };
};

export const createHubspotRateLimiter = (
  maxRequestsPer10s = 90,
): RateLimiter =>
  createRateLimiter({ maxRequests: maxRequestsPer10s, windowMs: 10_000 });
