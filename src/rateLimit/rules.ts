import type { AppConfig } from "../config/env.js";
import type { RateLimitRule, RateLimitRuleId } from "./types.js";

export const resolveRateLimitRule = (
  ruleId: RateLimitRuleId,
  config: AppConfig,
): RateLimitRule => {
  switch (ruleId) {
    case "society.auth.magic_link":
      return {
        limit: config.auth.societyAuth.magicLinkRateLimitPerMinute,
        windowSeconds: 60,
      };
    case "oauth.register":
      return {
        limit: config.auth.oauthBroker.registerRateLimitPerMinute,
        windowSeconds: 60,
      };
    case "society.bff.oauth_google":
      return {
        limit: config.rateLimit.societyBffOauthGooglePerMinute,
        windowSeconds: 60,
      };
    case "society.bff.startups":
      return {
        limit: config.rateLimit.societyBffStartupsPerMinute,
        windowSeconds: 60,
      };
    default: {
      const _exhaustive: never = ruleId;
      return _exhaustive;
    }
  }
};
