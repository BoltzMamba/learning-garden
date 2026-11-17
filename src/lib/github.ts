/**
 * GitHub contribution data for the learning calendar (pure).
 *
 * Counting rules:
 * - Source: the account's public contribution calendar (everything GitHub
 *   counts: commits to default branches, pull requests, issues, reviews,
 *   new repositories…). Day attribution is GitHub's own — commits are dated
 *   in the commit's timezone (UTC+8 here, matching Asia/Singapore), so
 *   dates are used as-is and never re-bucketed.
 * - De-duplication: a commit to this site's repository that only changes
 *   learning records (notes, questions, reviews, revisions) is already a
 *   garden event, so it is subtracted from that day's GitHub count. The
 *   subtraction is capped by GitHub's own count of commits to this repo
 *   that day (and by the day's total), so it can never go negative.
 */
import { isValidCalendarDate } from './dates.ts';

export interface GithubActivity {
  login: string;
  fetchedAt: string;
  source: 'graphql' | 'html';
  /** Contributions per day, as GitHub counts them (zero days omitted). */
  days: Record<string, number>;
  /** Commits to this site's repo per day, as GitHub counts them (GraphQL only). */
  siteCommits?: Record<string, number>;
  /** Content-only commits to this repo per day, from git history. */
  contentCommits?: Record<string, number>;
  /** How duplicates were removed. */
  dedupe: 'content-commits' | 'site-repo' | 'none';
}

const isCountMap = (v: unknown): v is Record<string, number> =>
  !!v &&
  typeof v === 'object' &&
  Object.entries(v).every(([k, n]) => isValidCalendarDate(k) && Number.isInteger(n) && (n as number) >= 0);

/** Lenient validation: invalid data is ignored (the calendar falls back to notes only). */
export function parseGithubActivity(data: unknown): GithubActivity | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const d = data as Partial<GithubActivity>;
  if (typeof d.login !== 'string' || !isCountMap(d.days)) return undefined;
  if (d.siteCommits !== undefined && !isCountMap(d.siteCommits)) return undefined;
  if (d.contentCommits !== undefined && !isCountMap(d.contentCommits)) return undefined;
  return {
    login: d.login,
    fetchedAt: String(d.fetchedAt ?? ''),
    source: d.source === 'html' ? 'html' : 'graphql',
    days: d.days,
    siteCommits: d.siteCommits,
    contentCommits: d.contentCommits,
    dedupe: d.dedupe === 'content-commits' || d.dedupe === 'site-repo' ? d.dedupe : 'none',
  };
}

/** GitHub contributions per day after removing commits already counted as garden events. */
export function githubCountsByDate(activity: GithubActivity | undefined): Map<string, number> {
  const out = new Map<string, number>();
  if (!activity) return out;
  for (const [date, total] of Object.entries(activity.days)) {
    const reported = activity.siteCommits?.[date] ?? total;
    let duplicate = 0;
    if (activity.dedupe === 'content-commits') duplicate = Math.min(activity.contentCommits?.[date] ?? 0, reported);
    else if (activity.dedupe === 'site-repo') duplicate = activity.siteCommits?.[date] ?? 0;
    const count = Math.max(0, total - Math.min(duplicate, total));
    if (count > 0) out.set(date, count);
  }
  return out;
}

// ── fetch-result parsing (used by scripts/github-activity.ts) ──────────

interface GraphqlYear {
  contributionCalendar: { weeks: { contributionDays: { date: string; contributionCount: number }[] }[] };
  commitContributionsByRepository: {
    repository: { nameWithOwner: string };
    contributions: { nodes: { occurredAt: string; commitCount: number }[] };
  }[];
}

/**
 * Merge per-year GraphQL `contributionsCollection` results. Only dates inside
 * each year are kept (the calendar pads to whole weeks).
 */
export function parseGraphqlYears(years: Record<number, GraphqlYear>, siteRepo: string) {
  const days: Record<string, number> = {};
  const siteCommits: Record<string, number> = {};
  for (const [yearKey, y] of Object.entries(years)) {
    const year = String(yearKey);
    for (const w of y.contributionCalendar.weeks) {
      for (const d of w.contributionDays) {
        if (d.date.startsWith(year) && d.contributionCount > 0) days[d.date] = d.contributionCount;
      }
    }
    for (const r of y.commitContributionsByRepository) {
      if (r.repository.nameWithOwner.toLowerCase() !== siteRepo.toLowerCase()) continue;
      for (const c of r.contributions.nodes) {
        // occurredAt marks the day bucket; its UTC date matches the calendar's date.
        const date = c.occurredAt.slice(0, 10);
        if (date.startsWith(year)) siteCommits[date] = (siteCommits[date] ?? 0) + c.commitCount;
      }
    }
  }
  return { days, siteCommits };
}

/** Parse GitHub's public contributions page (fallback when the API is unavailable). */
export function parseContributionsHtml(html: string): Record<string, number> {
  const dateById = new Map<string, string>();
  for (const m of html.matchAll(/data-date="(\d{4}-\d{2}-\d{2})"[^>]*?\bid="([^"]+)"/g)) dateById.set(m[2], m[1]);
  for (const m of html.matchAll(/\bid="([^"]+)"[^>]*?data-date="(\d{4}-\d{2}-\d{2})"/g)) dateById.set(m[1], m[2]);
  const days: Record<string, number> = {};
  for (const m of html.matchAll(/<tool-tip\b[^>]*\bfor="([^"]+)"[^>]*>([^<]*)<\/tool-tip>/g)) {
    const date = dateById.get(m[1]);
    if (!date) continue;
    const n = /^\s*(\d[\d,]*)\s+contributions?\b/.exec(m[2]);
    const count = n ? Number(n[1].replace(/,/g, '')) : 0;
    if (count > 0) days[date] = count;
  }
  return days;
}

/** Content-only commits: every changed file is a learning record. */
export function isContentOnlyCommit(files: readonly string[]): boolean {
  return (
    files.length > 0 &&
    files.every((f) => /^src\/content\//.test(f) || f === 'src/data/reviews.json' || f === 'src/data/revisions.json')
  );
}
