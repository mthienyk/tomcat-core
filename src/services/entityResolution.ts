export type DriveTokenSource =
  | "hubspot_name"
  | "monday_portfolio"
  | "name_token"
  | "parenthetical_alias";

export type DriveTokenCandidate = {
  token: string;
  source: DriveTokenSource;
  confidence: number;
  matchReason: string;
};

export type EntityMatchReason =
  | "exact"
  | "substring"
  | "token_overlap"
  | "startup_id";

export const normalizeEntityKey = (value: string): string =>
  value.trim().toLowerCase();

const PARENTHETICAL_ALIAS = /\(\s*(?:ex|formerly|fka|aka)\s+([^)]+)\)/i;

export const tokenizeEntityName = (value: string): string[] => {
  const normalized = normalizeEntityKey(value)
    .replace(/[()[\]/\\|]/g, " ")
    .replace(/[^a-z0-9@.+_\s-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return [];
  return [...new Set(normalized.split(" ").filter((token) => token.length >= 2))];
};

export const extractParentheticalAliases = (value: string): string[] => {
  const match = value.match(PARENTHETICAL_ALIAS);
  if (!match?.[1]) return [];
  const alias = match[1].trim();
  return alias ? [alias] : [];
};

export const tokenOverlapScore = (left: string, right: string): number => {
  const leftTokens = new Set(tokenizeEntityName(left));
  const rightTokens = new Set(tokenizeEntityName(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1;
  }
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union === 0 ? 0 : overlap / union;
};

export const matchConfidence = (
  query: string,
  candidate: string,
): { confidence: number; reason: EntityMatchReason | undefined } => {
  const q = normalizeEntityKey(query);
  const c = normalizeEntityKey(candidate);
  if (!q || !c) return { confidence: 0, reason: undefined };
  if (q === c) return { confidence: 1, reason: "exact" };
  if (c.includes(q) || q.includes(c)) {
    return { confidence: 0.88, reason: "substring" };
  }

  const overlap = tokenOverlapScore(q, c);
  if (overlap >= 0.34) {
    return { confidence: Math.min(0.84, 0.55 + overlap), reason: "token_overlap" };
  }
  return { confidence: 0, reason: undefined };
};

export const buildDriveTokens = (input: {
  canonicalName: string;
  portfolioCompanyId: string | undefined;
}): DriveTokenCandidate[] => {
  const tokens: DriveTokenCandidate[] = [];
  const seen = new Set<string>();

  const push = (candidate: DriveTokenCandidate): void => {
    const key = normalizeEntityKey(candidate.token);
    if (!key || seen.has(key)) return;
    seen.add(key);
    tokens.push(candidate);
  };

  if (input.portfolioCompanyId) {
    push({
      token: input.portfolioCompanyId,
      source: "monday_portfolio",
      confidence: 0.95,
      matchReason: "monday_portfolio_id",
    });
    for (const alias of extractParentheticalAliases(input.portfolioCompanyId)) {
      push({
        token: alias,
        source: "parenthetical_alias",
        confidence: 0.82,
        matchReason: "parenthetical_alias",
      });
    }
  }

  if (input.canonicalName) {
    push({
      token: input.canonicalName,
      source: "hubspot_name",
      confidence: input.portfolioCompanyId ? 0.78 : 0.85,
      matchReason: "hubspot_canonical_name",
    });
  }

  const tokenSources = [
    input.portfolioCompanyId,
    input.canonicalName,
    ...extractParentheticalAliases(input.portfolioCompanyId ?? ""),
  ].filter((value): value is string => Boolean(value));

  for (const source of tokenSources) {
    for (const token of tokenizeEntityName(source)) {
      if (token.length < 4) continue;
      push({
        token,
        source: "name_token",
        confidence: 0.62,
        matchReason: "name_token",
      });
    }
  }

  return tokens.sort((left, right) => right.confidence - left.confidence);
};

export const rankDriveTokens = (
  primary: string | undefined,
  candidates: DriveTokenCandidate[],
): string[] => {
  const ordered: string[] = [];
  const seen = new Set<string>();

  const add = (token: string | undefined): void => {
    if (!token) return;
    const key = normalizeEntityKey(token);
    if (!key || seen.has(key)) return;
    seen.add(key);
    ordered.push(token);
  };

  add(primary);
  for (const candidate of candidates) {
    add(candidate.token);
  }
  return ordered;
};
