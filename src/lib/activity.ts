/**
 * Learning-activity aggregation (pure, framework-free, unit-tested).
 *
 * Events are derived ONLY from explicit records:
 *   - publish   : a note's `published` date            (1 per note)
 *   - revision  : an entry in revisions.json             (1 per stable revision id)
 *   - review    : an entry in reviews.json               (1 per note per calendar date)
 *   - question  : a public question's `resolvedOn` date  (1 per resolved question)
 *
 * Git commits, page views and file modification times are never inputs, so
 * they can never become learning activity.
 */
import { isValidCalendarDate } from './dates.ts';
import { reviewKey, type ReviewRecord, type RevisionRecord } from './records.ts';
import { isValidSlug } from './slug.ts';

export type ActivityType = 'publish' | 'revision' | 'review' | 'question';

export interface NoteInput {
  id: string;
  title: string;
  published: string;
}

export interface QuestionInput {
  id: string;
  title: string;
  noteId?: string;
  status: 'open' | 'resolved';
  resolvedOn?: string;
  public: boolean;
}

export interface ActivityInput {
  notes: readonly NoteInput[];
  reviews?: readonly ReviewRecord[];
  revisions?: readonly RevisionRecord[];
  questions?: readonly QuestionInput[];
}

export interface ActivityEvent {
  /** Stable, unique event id. */
  id: string;
  type: ActivityType;
  date: string;
  title: string;
  noteId?: string;
  questionId?: string;
  /** Public one-line description (revision summary). */
  detail?: string;
}

export class ActivityValidationError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Learning data is invalid:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ActivityValidationError';
    this.problems = problems;
  }
}

const TYPE_ORDER: Record<ActivityType, number> = { publish: 0, revision: 1, review: 2, question: 3 };

export function buildActivityEvents(input: ActivityInput): ActivityEvent[] {
  const { notes, reviews = [], revisions = [], questions = [] } = input;
  const problems: string[] = [];

  const notesById = new Map<string, NoteInput>();
  for (const note of notes) {
    if (!isValidSlug(note.id)) problems.push(`note id "${note.id}" is not a valid slug (lowercase a-z, 0-9, hyphens)`);
    if (notesById.has(note.id)) problems.push(`duplicate note id "${note.id}"`);
    if (!isValidCalendarDate(note.published)) problems.push(`note "${note.id}" has invalid published date "${note.published}"`);
    notesById.set(note.id, note);
  }

  const checkNoteRef = (noteId: string, where: string) => {
    if (!notesById.has(noteId)) problems.push(`${where} references unknown note "${noteId}"`);
  };

  for (const r of reviews) {
    checkNoteRef(r.noteId, `review on ${r.date}`);
    if (!isValidCalendarDate(r.date)) problems.push(`review of "${r.noteId}" has invalid date "${r.date}"`);
  }
  const revisionIds = new Set<string>();
  for (const r of revisions) {
    checkNoteRef(r.noteId, `revision "${r.id}"`);
    if (!isValidCalendarDate(r.date)) problems.push(`revision "${r.id}" has invalid date "${r.date}"`);
    if (revisionIds.has(r.id)) problems.push(`duplicate revision id "${r.id}"`);
    revisionIds.add(r.id);
  }
  const questionIds = new Set<string>();
  for (const q of questions) {
    if (q.noteId) checkNoteRef(q.noteId, `question "${q.id}"`);
    if (questionIds.has(q.id)) problems.push(`duplicate question id "${q.id}"`);
    questionIds.add(q.id);
    if (q.status === 'resolved' && !isValidCalendarDate(q.resolvedOn)) {
      problems.push(`resolved question "${q.id}" needs a valid resolvedOn date`);
    }
    if (q.status === 'open' && q.resolvedOn) problems.push(`open question "${q.id}" must not have resolvedOn`);
  }

  if (problems.length) throw new ActivityValidationError(problems);

  const events: ActivityEvent[] = [];

  for (const note of notes) {
    events.push({ id: `publish:${note.id}`, type: 'publish', date: note.published, title: note.title, noteId: note.id });
  }

  for (const r of revisions) {
    events.push({
      id: `revision:${r.id}`,
      type: 'revision',
      date: r.date,
      title: notesById.get(r.noteId)!.title,
      noteId: r.noteId,
      detail: r.summary,
    });
  }

  // Critical rule: reviews are unique per note per calendar date.
  const reviewEvents = new Map<string, ActivityEvent>();
  for (const r of reviews) {
    const key = reviewKey(r);
    reviewEvents.set(key, {
      id: `review:${key}`,
      type: 'review',
      date: r.date,
      title: notesById.get(r.noteId)!.title,
      noteId: r.noteId,
    });
  }
  events.push(...reviewEvents.values());

  for (const q of questions) {
    if (!q.public || q.status !== 'resolved' || !q.resolvedOn) continue;
    events.push({
      id: `question:${q.id}`,
      type: 'question',
      date: q.resolvedOn,
      title: q.title,
      questionId: q.id,
      noteId: q.noteId,
    });
  }

  return events.sort(
    (a, b) => a.date.localeCompare(b.date) || TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || a.id.localeCompare(b.id),
  );
}

export function groupEventsByDate(events: readonly ActivityEvent[]): Map<string, ActivityEvent[]> {
  const map = new Map<string, ActivityEvent[]>();
  for (const e of events) {
    const list = map.get(e.date);
    if (list) list.push(e);
    else map.set(e.date, [e]);
  }
  return map;
}

export function countEventsByDate(events: readonly ActivityEvent[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const e of events) map.set(e.date, (map.get(e.date) ?? 0) + 1);
  return map;
}
