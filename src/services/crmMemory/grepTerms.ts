const MIN_TERM_LENGTH = 2;
const MAX_TERMS = 10;

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
