import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ActivityValidationError, buildActivityEvents, countEventsByDate, type NoteInput } from '../src/lib/activity.ts';
import type { ReviewRecord } from '../src/lib/records.ts';

const notes: NoteInput[] = [
  { id: 'note-a', title: 'Article A', published: '2026-11-01' },
  { id: 'note-b', title: 'Article B', published: '2026-11-02' },
];
const review = (noteId: string, date: string, mastery = 3): ReviewRecord => ({ noteId, date, mastery, reflection: 'r' });
const countOn = (events: ReturnType<typeof buildActivityEvents>, date: string, type?: string) =>
  events.filter((e) => e.date === date && (!type || e.type === type)).length;

describe('activity aggregation', () => {
  test('same note reviewed twice on one date → one review activity', () => {
    const events = buildActivityEvents({
      notes,
      reviews: [review('note-a', '2026-11-16', 2), review('note-a', '2026-11-16', 4)],
    });
    assert.equal(countOn(events, '2026-11-16', 'review'), 1);
    assert.equal(countEventsByDate(events).get('2026-11-16'), 1);
  });

  test('different notes reviewed on one date → separate activities', () => {
    const events = buildActivityEvents({
      notes,
      reviews: [review('note-a', '2026-11-16'), review('note-b', '2026-11-16')],
    });
    assert.equal(countOn(events, '2026-11-16', 'review'), 2);
  });

  test('publish and review of the same note on one date → two activities', () => {
    const events = buildActivityEvents({ notes, reviews: [review('note-a', '2026-11-01')] });
    assert.equal(countOn(events, '2026-11-01'), 2);
    assert.deepEqual(
      events.filter((e) => e.date === '2026-11-01').map((e) => e.type),
      ['publish', 'review'],
    );
  });

  test('review and question resolution on one date are not deduplicated', () => {
    const events = buildActivityEvents({
      notes,
      reviews: [review('note-a', '2026-11-16')],
      questions: [{ id: 'q1', title: 'Q', noteId: 'note-a', status: 'resolved', resolvedOn: '2026-11-16', public: true }],
    });
    assert.equal(countOn(events, '2026-11-16'), 2);
  });

  test('meaningful revisions each count once by stable id', () => {
    const events = buildActivityEvents({
      notes,
      revisions: [
        { id: 'note-a--2026-11-10--1', noteId: 'note-a', date: '2026-11-10', summary: 'fix proof' },
        { id: 'note-a--2026-11-10--2', noteId: 'note-a', date: '2026-11-10', summary: 'add example' },
        { id: 'note-b--2026-11-11--1', noteId: 'note-b', date: '2026-11-11', summary: 'new section' },
      ],
    });
    assert.equal(countOn(events, '2026-11-10', 'revision'), 2);
    assert.equal(countOn(events, '2026-11-11', 'revision'), 1);
    assert.equal(events.find((e) => e.id === 'revision:note-a--2026-11-10--2')?.detail, 'add example');
  });

  test('duplicate revision ids are rejected', () => {
    const dup = { id: 'x', noteId: 'note-a', date: '2026-11-10', summary: 's' };
    assert.throws(() => buildActivityEvents({ notes, revisions: [dup, dup] }), ActivityValidationError);
  });

  test('ordinary Git commits do not create learning activities', () => {
    // Only explicit records are inputs. Extra data such as commit history is ignored.
    const withCommits = {
      notes: notes.map((n) => ({ ...n, commits: ['2026-11-03', '2026-11-04', '2026-11-04'] })),
    };
    const events = buildActivityEvents(withCommits);
    assert.deepEqual(
      events.map((e) => e.type),
      ['publish', 'publish'],
    );
    assert.equal(countOn(events, '2026-11-03'), 0);
    assert.equal(countOn(events, '2026-11-04'), 0);
  });

  test('question resolution dates generate activities (public + resolved only)', () => {
    const events = buildActivityEvents({
      notes,
      questions: [
        { id: 'resolved-public', title: 'A', noteId: 'note-a', status: 'resolved', resolvedOn: '2026-11-12', public: true },
        { id: 'resolved-hidden', title: 'B', status: 'resolved', resolvedOn: '2026-11-12', public: false },
        { id: 'still-open', title: 'C', status: 'open', public: true },
      ],
    });
    const q = events.filter((e) => e.type === 'question');
    assert.equal(q.length, 1);
    assert.equal(q[0].date, '2026-11-12');
    assert.equal(q[0].questionId, 'resolved-public');
  });

  test('resolved question without resolvedOn is rejected', () => {
    assert.throws(
      () => buildActivityEvents({ notes, questions: [{ id: 'q', title: 'Q', status: 'resolved', public: true }] }),
      /needs a valid resolvedOn/,
    );
  });

  test('invalid note references are rejected', () => {
    assert.throws(() => buildActivityEvents({ notes, reviews: [review('missing', '2026-11-16')] }), /unknown note "missing"/);
    assert.throws(
      () => buildActivityEvents({ notes, revisions: [{ id: 'r', noteId: 'missing', date: '2026-11-16', summary: 's' }] }),
      /unknown note "missing"/,
    );
    assert.throws(
      () => buildActivityEvents({ notes, questions: [{ id: 'q', title: 'Q', noteId: 'missing', status: 'open', public: false }] }),
      /unknown note "missing"/,
    );
  });

  test('duplicate note ids and invalid slugs are rejected', () => {
    assert.throws(() => buildActivityEvents({ notes: [notes[0], notes[0]] }), /duplicate note id "note-a"/);
    assert.throws(
      () => buildActivityEvents({ notes: [{ id: 'Bad Slug', title: 't', published: '2026-01-01' }] }),
      /not a valid slug/,
    );
  });

  test('invalid dates are rejected (e.g. Feb 29 in a non-leap year)', () => {
    assert.throws(() => buildActivityEvents({ notes, reviews: [review('note-a', '2025-02-29')] }), /invalid date/);
  });

  test('leap day 2028-02-29 is a valid activity date', () => {
    const events = buildActivityEvents({ notes, reviews: [review('note-a', '2028-02-29')] });
    assert.equal(countOn(events, '2028-02-29'), 1);
  });
});
