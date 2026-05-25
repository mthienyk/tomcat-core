const MIN_TERM_LENGTH = 2;
const MAX_TERMS = 10;

/** French terms too ambiguous for matchMode any (match many unrelated notes). */
const GREP_AMBIGUOUS_TERMS_FR = new Set([
  "avance",
  "avances",
  "salaire",
  "salaires",
  "paie",
  "paiement",
  "paiements",
  "mois",
  "rh",
  "hrtech",
  "hr",
]);

export const filterGrepTerms = (
  terms: readonly string[],
  matchMode: "all" | "any",
): string[] => {
  if (matchMode === "all" || terms.length <= 1) {
    return [...terms];
  }

  const filtered = terms.filter(
    (term) => !GREP_AMBIGUOUS_TERMS_FR.has(term.toLowerCase()),
  );
  return filtered.length > 0 ? filtered : [...terms];
};

export const escapeIlikePattern = (value: string): string =>
  value.replace(/[%_\\]/g, (char) => `\\${char}`);

export const parseGrepTerms = (query: string): string[] => {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const quoted = [...trimmed.matchAll(/"([^"]+)"/g)]
    .map((match) => match[1]?.trim() ?? "")
    .filter((term) => term.length >= MIN_TERM_LENGTH);

  const withoutQuoted = trimmed.replace(/"([^"]+)"/g, " ").trim();
  const words = withoutQuoted
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= MIN_TERM_LENGTH);

  const seen = new Set<string>();
  const terms: string[] = [];

  for (const term of [...quoted, ...words]) {
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
    if (terms.length >= MAX_TERMS) break;
  }

  return terms;
};

export const buildIlikePattern = (term: string): string =>
  `%${escapeIlikePattern(term)}%`;
