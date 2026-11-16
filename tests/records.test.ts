import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  appendRevision,
  nextRevisionId,
  upsertReview,
  validateReviewRecords,
  validateRevisionRecords,
  type ReviewRecord,
} from '../src/lib/records.ts';
import { isValidSlug, slugify } from '../src/lib/slug.ts';
import { githubHistoryUrl } from '../src/lib/site.ts';

describe('reviews', () => {
  const base: ReviewRecord = { noteId: 'note-a', date: '2026-11-16', mastery: 2, reflection: 'first' };

  test('repeated same-day review updates the existing record', () => {
    const first = upsertReview([], base);
    assert.equal(first.action, 'created');
    const second = upsertReview(first.reviews, { ...base, mastery: 4, reflection: 'second' });
    assert.equal(second.action, 'updated');
    assert.equal(second.reviews.length, 1);
    assert.deepEqual(second.reviews[0], { ...base, mastery: 4, reflection: 'second' });
  });

  test('other notes or other days create new records', () => {
    let { reviews } = upsertReview([], base);
    reviews = upsertReview(reviews, { ...base, noteId: 'note-b' }).reviews;
    reviews = upsertReview(reviews, { ...base, date: '2026-11-17' }).reviews;
    assert.equal(reviews.length, 3);
  });

  test('validation rejects duplicates and bad values', () => {
    assert.throws(() => validateReviewRecords([base, base]), /duplicate review/);
    assert.throws(() => validateReviewRecords([{ ...base, mastery: 6 }]), /mastery/);
    assert.throws(() => validateReviewRecords([{ ...base, date: '2026-02-30' }]), /date/);
    assert.throws(() => validateReviewRecords({}), /array/);
    assert.deepEqual(validateReviewRecords([base]), [base]);
  });
});

describe('revisions', () => {
  test('ids are deterministic and unique per note per day', () => {
    assert.equal(nextRevisionId([], 'note-a', '2026-11-16'), 'note-a--2026-11-16--1');
    const one = appendRevision([], { noteId: 'note-a', date: '2026-11-16', summary: 'x' });
    const two = appendRevision(one, { noteId: 'note-a', date: '2026-11-16', summary: 'y' });
    assert.deepEqual(
      two.map((r) => r.id),
      ['note-a--2026-11-16--1', 'note-a--2026-11-16--2'],
    );
    assert.doesNotThrow(() => validateRevisionRecords(two));
    assert.throws(() => validateRevisionRecords([...two, two[0]]), /duplicated/);
  });
});

describe('slugs and links', () => {
  test('slugify', () => {
    assert.equal(slugify('ReAct: Reasoning + Acting in LLM Agents'), 'react-reasoning-acting-in-llm-agents');
    assert.equal(slugify('Café déjà vu'), 'cafe-deja-vu');
    assert.equal(slugify('动态规划入门'), '');
    assert.equal(isValidSlug('dp-101'), true);
    assert.equal(isValidSlug('Bad_Slug'), false);
    assert.equal(isValidSlug('a--b'), false);
  });

  test('GitHub history URL encodes each path segment', () => {
    assert.equal(
      githubHistoryUrl('src/content/notes/how-this-garden-works.md'),
      'https://github.com/BoltzMamba/learning-garden/commits/main/src/content/notes/how-this-garden-works.md',
    );
    assert.equal(
      githubHistoryUrl('src\\content\\notes\\a b#c.md'),
      'https://github.com/BoltzMamba/learning-garden/commits/main/src/content/notes/a%20b%23c.md',
    );
  });
});
