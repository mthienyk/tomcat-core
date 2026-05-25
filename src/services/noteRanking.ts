import type { Note } from "../domain/entities.js";

/** Canonical HubSpot author email for Élie's M1/M2 synthesis notes. */
export const ELIE_NOTE_AUTHOR_EMAIL = "elie.dupredesaintmaur@tomcat.eu";

const MS_PER_DAY = 86_400_000;

export const noteQualityBoost = (body: string): number => {
  if (/\bexec\s*sum/i.test(body)) return 80;
  if (/\bM[0-4]\b/.test(body)) return 60;
  if (/\bboard\b/i.test(body)) return 40;
  return 0;
};

export const matchesAuthorEmail = (
  note: Note,
  authorEmail: string,
): boolean =>
  note.authorEmail.toLowerCase().includes(authorEmail.trim().toLowerCase());

export const isWithinSinceDays = (
  isoDate: string,
  sinceDays: number,
  nowMs: number,
): boolean => {
  const parsed = Date.parse(isoDate);
  if (Number.isNaN(parsed)) return false;
  const cutoffMs = nowMs - sinceDays * MS_PER_DAY;
  return parsed >= cutoffMs;
};

export const rankNotesByQuality = (
  notes: Note[],
): Note[] =>
  [...notes].sort((left, right) => {
    const leftQuality = noteQualityBoost(left.body);
    const rightQuality = noteQualityBoost(right.body);
    if (rightQuality !== leftQuality) {
      return rightQuality - leftQuality;
    }
    return right.createdAt.localeCompare(left.createdAt);
  });

export const isM1M2SynthesisNote = (body: string): boolean =>
  noteQualityBoost(body) >= 60;
