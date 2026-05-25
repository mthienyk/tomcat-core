import type {
  RegimeScoreLevel,
  ScoreDispersion,
  SimilarCaseMatch,
  SimilarCasesQualitySignals,
  SimilarCasesRegimeSignals,
  VocabularyMatchLevel,
} from "../../domain/crmMemory.js";

const STOP_WORDS = new Set([
  "avec",
  "dans",
  "pour",
  "plus",
  "sans",
  "sont",
  "cette",
  "comme",
  "entre",
  "leurs",
  "notre",
  "that",
  "this",
  "with",
  "from",
  "have",
  "been",
  "their",
  "about",
]);

const tokenize = (text: string): Set<string> => {
  const tokens = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length >= 4 && !STOP_WORDS.has(token));
  return new Set(tokens);
};

const jaccard = (left: Set<string>, right: Set<string>): number => {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }
  return intersection / (left.size + right.size - intersection);
};

export const scoreToRegimeLevel = (score: number): RegimeScoreLevel => {
  if (score >= 0.65) return "high";
  if (score >= 0.55) return "mid";
  return "low";
};

export const computeVocabularyMatch = (
  searchTexts: readonly string[],
  matches: readonly Pick<SimilarCaseMatch, "whySimilar">[],
  topN = 5,
): VocabularyMatchLevel => {
  const queryTokens = tokenize(searchTexts.join(" "));
  if (queryTokens.size === 0) return "low";

  const overlaps = matches
    .slice(0, topN)
    .map((match) => jaccard(queryTokens, tokenize(match.whySimilar)));
  const average =
    overlaps.reduce((sum, value) => sum + value, 0) / (overlaps.length || 1);

  if (average >= 0.12) return "high";
  if (average >= 0.06) return "medium";
  return "low";
};

export const computeTopClusterCoherence = (
  matches: readonly Pick<SimilarCaseMatch, "whySimilar">[],
  topN = 8,
): number => {
  const slice = matches.slice(0, topN);
  if (slice.length < 2) return 1;

  const tokenSets = slice.map((match) => tokenize(match.whySimilar));
  let sum = 0;
  let pairs = 0;

  for (let leftIndex = 0; leftIndex < tokenSets.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < tokenSets.length;
      rightIndex += 1
    ) {
      sum += jaccard(tokenSets[leftIndex]!, tokenSets[rightIndex]!);
      pairs += 1;
    }
  }

  return pairs > 0 ? Math.round((sum / pairs) * 100) / 100 : 1;
};

export const computeScoreDispersion = (
  scores: readonly number[],
): ScoreDispersion => {
  if (scores.length === 0) return "wide_low";

  const top = scores[0] ?? 0;
  const bottom = scores[scores.length - 1] ?? top;
  const spread = top - bottom;

  if (top >= 0.65 && spread <= 0.05) return "narrow_high";
  if (top >= 0.55 && spread <= 0.12) return "wide_mid";
  return "wide_low";
};

export const detectNoisyTopMatch = (
  matches: readonly Pick<SimilarCaseMatch, "whySimilar" | "similarityScore">[],
  clusterCoherence: number,
): boolean => {
  if (matches.length < 3) return false;

  const top = matches[0]!;
  const rest = matches.slice(1, Math.min(8, matches.length));
  const clusterTokens = new Set<string>();
  for (const match of rest) {
    for (const token of tokenize(match.whySimilar)) {
      clusterTokens.add(token);
    }
  }

  const overlap = jaccard(tokenize(top.whySimilar), clusterTokens);
  const scoreGap = top.similarityScore - (matches[1]?.similarityScore ?? 0);

  return overlap < 0.12 && scoreGap < 0.025 && clusterCoherence >= 0.08;
};

export const suggestSearchRewrite = (
  searchTexts: readonly string[],
  regimeLevel: RegimeScoreLevel,
  vocabularyMatch: VocabularyMatchLevel,
): string | undefined => {
  if (regimeLevel !== "low" && vocabularyMatch !== "low") {
    return undefined;
  }

  const joined = searchTexts.join(" ");
  if (joined.includes("?")) {
    return (
      "Rewrite as a refined excerpt (product facts + Tomcat judgment), "
      + "not a user question."
    );
  }

  return (
    "Use operational vocabulary from Tomcat refined excerpts "
    + "(product facts, GTM, metrics, named competitors), not industry jargon "
    + "or raw questions. Prefer 1 recap-style chunk; add investment_lens only "
    + "when searching for judgment-profile matches."
  );
};

export const buildSearchQualitySignals = (input: {
  searchTexts: readonly string[];
  matches: SimilarCaseMatch[];
}): {
  regimeSignals: SimilarCasesRegimeSignals;
  qualitySignals: SimilarCasesQualitySignals;
  suggestedRewrite?: string;
} => {
  const topScore = input.matches[0]?.similarityScore ?? 0;
  const scoreLevel = scoreToRegimeLevel(topScore);
  const vocabularyMatch = computeVocabularyMatch(
    input.searchTexts,
    input.matches,
  );
  const topClusterCoherence = computeTopClusterCoherence(input.matches);
  const scoreDispersion = computeScoreDispersion(
    input.matches.map((match) => match.similarityScore),
  );
  const noisyTopMatch = detectNoisyTopMatch(input.matches, topClusterCoherence);
  const suggestedRewrite = suggestSearchRewrite(
    input.searchTexts,
    scoreLevel,
    vocabularyMatch,
  );

  return {
    regimeSignals: {
      scoreLevel,
      vocabularyMatch,
      topScore: Number(topScore.toFixed(4)),
    },
    qualitySignals: {
      scoreDispersion,
      topClusterCoherence,
      noisyTopMatch,
    },
    ...(suggestedRewrite !== undefined ? { suggestedRewrite } : {}),
  };
};

export const applyNoteQualityBoost = (
  score: number,
  noteKind: string,
  confidence: string,
): number => {
  let multiplier = 1;
  switch (noteKind) {
    case "m1_m2":
      multiplier = 1.08;
      break;
    case "board":
      multiplier = 1.04;
      break;
    case "ops":
      multiplier = 0.85;
      break;
    default:
      multiplier = 0.95;
  }

  if (confidence === "high") multiplier += 0.02;
  else if (confidence === "low") multiplier -= 0.02;

  return score * multiplier;
};
