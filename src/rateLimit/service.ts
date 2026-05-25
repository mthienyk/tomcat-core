import type { AppConfig } from "../config/env.js";
import { resolveRateLimitRule } from "./rules.js";
import type {
  RateLimitResult,
  RateLimitRuleId,
  RateLimitService,
  RateLimitStore,
} from "./types.js";

export const createRateLimitService = (
  store: RateLimitStore,
  config: AppConfig,
): RateLimitService => ({
  consume: async (
    ruleId: RateLimitRuleId,
    key: string,
  ): Promise<RateLimitResult> => {
    const rule = resolveRateLimitRule(ruleId, config);
    return store.consume(ruleId, key, rule);
  },
});
