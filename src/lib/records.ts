/**
 * Review and revision records (stored in src/data/*.json).
 *
 * Pure functions shared by the build and the CLI.
 */
import { isValidCalendarDate } from './dates.ts';
import { isValidSlug } from './slug.ts';

export const MASTERY_MIN = 1;
export const MASTERY_MAX = 5;

export const MASTERY_SCALE: Record<number, { zh: string; en: string }> = {
  1: { zh: '几乎忘了，需要重学', en: 'Barely remember; needs relearning' },
  2: { zh: '有印象，但离不开笔记', en: 'Vague; still depends on the notes' },
  3: { zh: '能复述核心要点', en: 'Can explain the main points' },
  4: { zh: '能独立应用到问题中', en: 'Can apply it independently' },
  5: { zh: '能讲给别人听并回答追问', en: 'Can teach it and handle follow-ups' },
};

/** One deliberate review of one note on one calendar date. */
export interface ReviewRecord {
  noteId: string;
  date: string;
  mastery: number;
  reflection: string;
}

/** One explicit, meaningful change to a note's knowledge content. */
export interface RevisionRecord {
  id: string;
  noteId: string;
  date: string;
  summary: string;
}

export function reviewKey(r: Pick<ReviewRecord, 'noteId' | 'date'>): string {
  return `${r.noteId}@${r.date}`;
}

function fail(errors: string[], label: string): never {
  throw new Error(`Invalid ${label}:\n  - ${errors.join('\n  - ')}`);
}

export function validateReviewRecords(data: unknown, label = 'reviews.json'): ReviewRecord[] {
  if (!Array.isArray(data)) fail(['top-level value must be an array'], label);
  const errors: string[] = [];
  const out: ReviewRecord[] = [];
  data.forEach((raw, i) => {
    const r = raw as Partial<ReviewRecord>;
    const where = `[${i}]`;
    if (!r || typeof r !== 'object') return void errors.push(`${where} is not an object`);
    if (!isValidSlug(r.noteId)) errors.push(`${where}.noteId must be a valid note slug`);
    if (!isValidCalendarDate(r.date)) errors.push(`${where}.date must be YYYY-MM-DD`);
    if (!Number.isInteger(r.mastery) || r.mastery! < MASTERY_MIN || r.mastery! > MASTERY_MAX) {
      errors.push(`${where}.mastery must be an integer ${MASTERY_MIN}-${MASTERY_MAX}`);
    }
    if (typeof r.reflection !== 'string') errors.push(`${where}.reflection must be a string`);
    out.push(r as ReviewRecord);
  });
  const seen = new Set<string>();
  for (const r of out) {
    const key = reviewKey(r);
    if (seen.has(key)) errors.push(`duplicate review for "${r.noteId}" on ${r.date} (one review per note per day)`);
    seen.add(key);
  }
  if (errors.length) fail(errors, label);
  return out;
}

export function validateRevisionRecords(data: unknown, label = 'revisions.json'): RevisionRecord[] {
  if (!Array.isArray(data)) fail(['top-level value must be an array'], label);
  const errors: string[] = [];
  const ids = new Set<string>();
  data.forEach((raw, i) => {
    const r = raw as Partial<RevisionRecord>;
    const where = `[${i}]`;
    if (!r || typeof r !== 'object') return void errors.push(`${where} is not an object`);
    if (typeof r.id !== 'string' || !r.id) errors.push(`${where}.id is required`);
    else if (ids.has(r.id)) errors.push(`${where}.id "${r.id}" is duplicated`);
    else ids.add(r.id);
    if (!isValidSlug(r.noteId)) errors.push(`${where}.noteId must be a valid note slug`);
    if (!isValidCalendarDate(r.date)) errors.push(`${where}.date must be YYYY-MM-DD`);
    if (typeof r.summary !== 'string' || !r.summary.trim()) errors.push(`${where}.summary is required`);
  });
  if (errors.length) fail(errors, label);
  return data as RevisionRecord[];
}

function byDateThenNote<T extends { date: string; noteId: string }>(a: T, b: T): number {
  return a.date.localeCompare(b.date) || a.noteId.localeCompare(b.noteId);
}

/**
 * Insert a review, or replace the existing review for the same note and date.
 * Preserves the one-review-per-note-per-day invariant.
 */
export function upsertReview(
  reviews: readonly ReviewRecord[],
  review: ReviewRecord,
): { reviews: ReviewRecord[]; action: 'created' | 'updated' } {
  const key = reviewKey(review);
  const exists = reviews.some((r) => reviewKey(r) === key);
  const next = reviews.filter((r) => reviewKey(r) !== key);
  next.push({ ...review });
  next.sort(byDateThenNote);
  return { reviews: next, action: exists ? 'updated' : 'created' };
}

/** Deterministic, stable ID: `<noteId>--<date>--<n>` (n = nth revision that day). */
export function nextRevisionId(revisions: readonly RevisionRecord[], noteId: string, date: string): string {
  const prefix = `${noteId}--${date}--`;
  let n = 1;
  const taken = new Set(revisions.map((r) => r.id));
  while (taken.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

export function appendRevision(revisions: readonly RevisionRecord[], revision: Omit<RevisionRecord, 'id'>): RevisionRecord[] {
  const id = nextRevisionId(revisions, revision.noteId, revision.date);
  return [...revisions, { id, ...revision }].sort(byDateThenNote);
}
