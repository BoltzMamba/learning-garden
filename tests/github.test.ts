import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  daysBetween,
  githubCountsByDate,
  githubSyncedThrough,
  isContentOnlyCommit,
  parseContributionsHtml,
  parseGithubActivity,
  parseGraphqlYears,
  summarizeGithubActivity,
  type GithubActivity,
} from '../src/lib/github.ts';

const base: GithubActivity = {
  login: 'BoltzMamba',
  fetchedAt: '2026-11-17T00:00:00Z',
  source: 'graphql',
  days: { '2026-11-16': 4, '2026-11-17': 1, '2026-11-18': 6 },
  siteCommits: { '2026-11-16': 3, '2026-11-17': 1 },
  contentCommits: { '2026-11-16': 1, '2026-11-17': 2, '2026-11-18': 1 },
  dedupe: 'content-commits',
};

describe('GitHub contributions', () => {
  test('content-only site commits are subtracted, capped by what GitHub counted', () => {
    const counts = githubCountsByDate(base);
    assert.equal(counts.get('2026-11-16'), 3); // 4 − 1 content commit
    assert.equal(counts.has('2026-11-17'), false); // 1 − min(2, 1 site commit) = 0
    // No GitHub-reported site commits that day → no subtraction beyond what GitHub counted.
    assert.equal(counts.get('2026-11-18'), 5); // 6 − min(1, siteCommits missing → total 6)
  });

  test('without git history every site-repo commit is treated as a duplicate; never negative', () => {
    const counts = githubCountsByDate({ ...base, dedupe: 'site-repo' });
    assert.equal(counts.get('2026-11-16'), 1);
    assert.equal(counts.has('2026-11-17'), false);
    assert.equal(counts.get('2026-11-18'), 6);
    assert.equal(githubCountsByDate({ ...base, dedupe: 'none' }).get('2026-11-16'), 4);
    assert.equal(githubCountsByDate(undefined).size, 0);
  });

  test('invalid cache files are ignored rather than breaking the build', () => {
    assert.equal(parseGithubActivity(null), undefined);
    assert.equal(parseGithubActivity({ login: 'x', days: { 'not-a-date': 1 } }), undefined);
    assert.equal(parseGithubActivity({ login: 'x', days: { '2026-02-30': 1 } }), undefined);
    assert.equal(parseGithubActivity({ login: 'x', days: { '2026-11-16': -2 } }), undefined);
    assert.deepEqual(parseGithubActivity(JSON.parse(JSON.stringify(base))), base);
  });

  test('GraphQL years merge, keeping only dates inside each year', () => {
    const year = (dates: [string, number][], site: [string, number][]) => ({
      contributionCalendar: { weeks: [{ contributionDays: dates.map(([date, contributionCount]) => ({ date, contributionCount })) }] },
      commitContributionsByRepository: [
        { repository: { nameWithOwner: 'BoltzMamba/learning-garden' }, contributions: { nodes: site.map(([occurredAt, commitCount]) => ({ occurredAt, commitCount })) } },
        { repository: { nameWithOwner: 'BoltzMamba/other' }, contributions: { nodes: [{ occurredAt: '2026-11-16T08:00:00Z', commitCount: 9 }] } },
      ],
    });
    const { days, siteCommits } = parseGraphqlYears(
      {
        2025: year([['2025-12-31', 2], ['2026-01-01', 7]], []),
        2026: year([['2025-12-31', 2], ['2026-11-16', 4], ['2026-11-17', 0]], [['2026-11-16T08:00:00Z', 3]]),
      },
      'BoltzMamba/learning-garden',
    );
    assert.deepEqual(days, { '2025-12-31': 2, '2026-11-16': 4 });
    assert.deepEqual(siteCommits, { '2026-11-16': 3 });
  });

  test('public contributions page fallback', () => {
    const html = `
      <td data-date="2026-11-15" id="contribution-day-component-0-52" data-level="0" class="ContributionCalendar-day"></td>
      <td data-date="2026-11-16" id="contribution-day-component-1-52" data-level="4" class="ContributionCalendar-day"></td>
      <td data-date="2026-11-17" id="contribution-day-component-2-52" data-level="1" class="ContributionCalendar-day"></td>
      <tool-tip for="contribution-day-component-0-52" class="sr-only">No contributions on November 15th.</tool-tip>
      <tool-tip for="contribution-day-component-1-52" class="sr-only">1,204 contributions on November 16th.</tool-tip>
      <tool-tip for="contribution-day-component-2-52" class="sr-only">1 contribution on November 17th.</tool-tip>`;
    assert.deepEqual(parseContributionsHtml(html), { '2026-11-16': 1204, '2026-11-17': 1 });
  });

  test('GraphQL years also report GitHub totals and anonymous private counts', () => {
    const r = parseGraphqlYears(
      {
        2026: {
          restrictedContributionsCount: 2,
          contributionCalendar: { totalContributions: 5, weeks: [{ contributionDays: [{ date: '2026-03-01', contributionCount: 5 }] }] },
          commitContributionsByRepository: [],
        },
      },
      'BoltzMamba/learning-garden',
    );
    assert.deepEqual(r.yearTotals, { 2026: 5 });
    assert.deepEqual(r.restricted, { 2026: 2 });
  });

  test('freshness: synced-through date, and a failed sync is kept as an error, not as zero', () => {
    const snap = parseGithubActivity({ ...base, range: { from: '2025-01-01', to: '2026-11-10' }, lastError: { at: 'x', message: 'HTTP 401' } })!;
    assert.equal(githubSyncedThrough(snap), '2026-11-10');
    assert.equal(snap.lastError?.message, 'HTTP 401');
    // Older caches without a range fall back to the fetch date in UTC+8.
    assert.equal(githubSyncedThrough({ ...base, fetchedAt: '2026-11-17T20:00:00Z' }), '2026-11-18');
    assert.equal(githubSyncedThrough(undefined), undefined);
    assert.equal(daysBetween('2026-11-10', '2026-11-17'), 7);
  });

  test('summary checks the per-day sum against GitHub totals', () => {
    const ok = summarizeGithubActivity({ ...base, yearTotals: { 2026: 11 } });
    assert.equal(ok.total, 11);
    assert.equal(ok.nonZeroDays, 3);
    assert.equal(ok.consistent, true);
    assert.equal(summarizeGithubActivity({ ...base, yearTotals: { 2026: 12 } }).consistent, false);
  });

  test('content-only commits are pure learning records', () => {
    assert.equal(isContentOnlyCommit(['src/content/notes/a.md', 'src/data/reviews.json']), true);
    assert.equal(isContentOnlyCommit(['src/content/notes/a.md', 'src/components/X.astro']), false);
    assert.equal(isContentOnlyCommit(['src/data/categories.json']), false);
    assert.equal(isContentOnlyCommit([]), false);
  });
});
