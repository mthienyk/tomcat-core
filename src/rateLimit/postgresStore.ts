import type { Db } from "../storage/pgClient.js";
import type {
  RateLimitResult,
  RateLimitRule,
  RateLimitRuleId,
  RateLimitStore,
} from "./types.js";

const maybeCleanup = async (db: Db): Promise<void> => {
  if (Math.random() > 0.01) return;
  await db`delete from rate_limit_buckets where expires_at < now()`;
};

export const createPostgresRateLimitStore = (db: Db): RateLimitStore => {
  const consume = async (
    ruleId: RateLimitRuleId,
    key: string,
    rule: RateLimitRule,
  ): Promise<RateLimitResult> => {
    if (rule.limit <= 0) return { allowed: true, retryAfter: 0 };

    const nowMs = Date.now();
    const windowMs = rule.windowSeconds * 1000;
    const windowStartMs = Math.floor(nowMs / windowMs) * windowMs;
    const bucket = `${ruleId}:${key}:${windowStartMs}`;
    const windowStart = new Date(windowStartMs);
    const expiresAt = new Date(windowStartMs + windowMs);

    return db.begin(async (tx) => {
      const rows = await tx<{ count: number }[]>`
        select count
        from rate_limit_buckets
        where bucket = ${bucket}
        for update
      `;

      const current = rows[0]?.count ?? 0;
      if (current >= rule.limit) {
        const retryAfter = Math.ceil(
          (windowMs - (nowMs - windowStartMs)) / 1000,
        );
        return { allowed: false, retryAfter };
      }

      if (current === 0) {
        await tx`
          insert into rate_limit_buckets (bucket, count, window_start, expires_at)
          values (${bucket}, 1, ${windowStart}, ${expiresAt})
        `;
      } else {
        await tx`
          update rate_limit_buckets
          set count = count + 1
          where bucket = ${bucket}
        `;
      }

      return { allowed: true, retryAfter: 0 };
    });
  };

  return {
    consume: async (ruleId, key, rule) => {
      const result = await consume(ruleId, key, rule);
      await maybeCleanup(db);
      return result;
    },
  };
};
