import type {
  RateLimitResult,
  RateLimitRule,
  RateLimitRuleId,
  RateLimitStore,
} from "./types.js";

type WindowBucket = { count: number; windowStart: number };

export const createMemoryRateLimitStore = (): RateLimitStore => {
  const buckets = new Map<string, WindowBucket>();

  const consume = async (
    ruleId: RateLimitRuleId,
    key: string,
    rule: RateLimitRule,
  ): Promise<RateLimitResult> => {
    if (rule.limit <= 0) return { allowed: true, retryAfter: 0 };

    const now = Date.now();
    const windowMs = rule.windowSeconds * 1000;
    const bucketKey = `${ruleId}:${key}`;
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const bucket = buckets.get(bucketKey);

    if (!bucket || bucket.windowStart !== windowStart) {
      buckets.set(bucketKey, { count: 1, windowStart });
      return { allowed: true, retryAfter: 0 };
    }

    if (bucket.count >= rule.limit) {
      const retryAfter = Math.ceil(
        (windowMs - (now - bucket.windowStart)) / 1000,
      );
      return { allowed: false, retryAfter };
    }

    bucket.count += 1;
    return { allowed: true, retryAfter: 0 };
  };

  return { consume };
};
