export type RateLimitRuleId =
  | "society.auth.magic_link"
  | "oauth.register"
  | "society.bff.oauth_google"
  | "society.bff.startups";

export type RateLimitRule = {
  limit: number;
  windowSeconds: number;
};

export type RateLimitResult = {
  allowed: boolean;
  retryAfter: number;
};

export type RateLimitStore = {
  consume(
    ruleId: RateLimitRuleId,
    key: string,
    rule: RateLimitRule,
  ): Promise<RateLimitResult>;
};

export type RateLimitService = {
  consume(ruleId: RateLimitRuleId, key: string): Promise<RateLimitResult>;
};
