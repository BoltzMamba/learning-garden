/**
 * Fetch the account's GitHub contribution calendar (GraphQL
 * contributionsCollection.contributionCalendar, one call per calendar year
 * since the account was created) and cache it in src/data/github-activity.json
 * for the build. No token ever reaches the browser or the cache file.
 *
 *   npm run github:sync            # sync; a failure keeps the old snapshot, marked as failed
 *   npm run github:sync -- --strict  # exit 1 if no fresh data could be fetched
 *
 * Token (first found): CONTRIBUTIONS_TOKEN, GITHUB_TOKEN, GH_TOKEN, then the
 * local `gh auth token`. Which contributions GitHub returns depends on whose
 * token it is: the account's own token sees its private contributions (if
 * GitHub counts them); any other token sees the public calendar, which
 * includes private work only as anonymous counts when the profile setting
 * "Include private contributions on my profile" is on.
 *
 * Without a token, or if GraphQL fails, the public contributions page is used.
 * If everything fails the previous snapshot is kept but marked with
 * `lastError`, and the calendar shows how far the data reaches — a failed sync
 * is never shown as "no contributions".
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { todayInTimeZone } from '../src/lib/dates.ts';
import {
  isContentOnlyCommit,
  parseContributionsHtml,
  parseGithubActivity,
  parseGraphqlYears,
  summarizeGithubActivity,
  type GithubActivity,
} from '../src/lib/github.ts';
import { GITHUB_OWNER, GITHUB_REPO } from '../src/lib/site.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src/data/github-activity.json');
const LOGIN = GITHUB_OWNER;
const SITE_REPO = `${GITHUB_OWNER}/${GITHUB_REPO}`;
const TODAY = todayInTimeZone();
const NOW_YEAR = Number(TODAY.slice(0, 4));
const STRICT = process.argv.includes('--strict');
const IN_ACTIONS = process.env.GITHUB_ACTIONS === 'true';

function log(msg: string) {
  console.log(`[github-activity] ${msg}`);
}

function warn(msg: string) {
  // Shows up as an annotation on the workflow run.
  console.log(IN_ACTIONS ? `::warning title=GitHub contributions::${msg}` : `[github-activity] WARNING: ${msg}`);
}

/** The token and where it came from (the name only is ever logged). */
function token(): { value: string; source: string } | undefined {
  for (const name of ['CONTRIBUTIONS_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN']) {
    const value = process.env[name]?.trim();
    if (value) return { value, source: `$${name}` };
  }
  try {
    const value = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return value ? { value, source: 'gh auth token' } : undefined;
  } catch {
    return undefined;
  }
}

async function graphql(query: string, auth: string) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { authorization: `bearer ${auth}`, 'content-type': 'application/json', 'user-agent': 'learning-garden-build' },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const hint = res.status === 401 ? ' (token invalid or expired)' : res.status === 403 ? ' (forbidden or rate-limited)' : '';
    throw new Error(`GraphQL HTTP ${res.status}${hint}`);
  }
  const json = (await res.json()) as { data?: any; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join('; '));
  return json.data;
}

async function viaGraphql(auth: string) {
  const user = await graphql(`query { user(login: "${LOGIN}") { createdAt } }`, auth);
  if (!user.user) throw new Error(`GitHub user "${LOGIN}" not found`);
  // Diagnostic only: installation tokens (Actions' github.token) may not expose a viewer.
  user.viewer = await graphql('query { viewer { login } }', auth)
    .then((d) => d.viewer)
    .catch(() => ({ login: 'workflow/app token' }));
  const first = Number(String(user.user.createdAt).slice(0, 4));
  const years: number[] = [];
  for (let y = first; y <= NOW_YEAR; y++) years.push(y);
  // One aliased contributionsCollection per calendar year (the API's max span), in UTC+8.
  const fields = years
    .map(
      (y) => `y${y}: contributionsCollection(from: "${y}-01-01T00:00:00+08:00", to: "${y}-12-31T23:59:59+08:00") {
        restrictedContributionsCount
        contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } }
        commitContributionsByRepository(maxRepositories: 100) {
          repository { nameWithOwner }
          contributions(first: 100) { nodes { occurredAt commitCount } }
        }
      }`,
    )
    .join('\n');
  const data = await graphql(`query { user(login: "${LOGIN}") { ${fields} } }`, auth);
  const byYear = Object.fromEntries(years.map((y) => [y, data.user[`y${y}`]]));
  return { ...parseGraphqlYears(byYear, SITE_REPO), viewer: String(user.viewer?.login ?? ''), from: `${first}-01-01` };
}

async function viaHtml() {
  const days: Record<string, number> = {};
  let from = `${NOW_YEAR}-01-01`;
  for (let y = NOW_YEAR; y >= NOW_YEAR - 10; y--) {
    const res = await fetch(`https://github.com/users/${LOGIN}/contributions?from=${y}-01-01&to=${y}-12-31`, {
      headers: { 'user-agent': 'learning-garden-build' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`contributions page HTTP ${res.status}`);
    const year = Object.fromEntries(Object.entries(parseContributionsHtml(await res.text())).filter(([d]) => d.startsWith(`${y}-`)));
    if (!Object.keys(year).length && y < NOW_YEAR) break; // before the account had activity
    Object.assign(days, year);
    from = `${y}-01-01`;
  }
  return { days, from };
}

/**
 * Content-only commits to this repo per day (in each commit's own timezone,
 * which is how GitHub dates them). Undefined when history is unavailable.
 */
function contentCommitsFromGit(): Record<string, number> | undefined {
  try {
    const shallow = execFileSync('git', ['rev-parse', '--is-shallow-repository'], { cwd: ROOT, encoding: 'utf8' }).trim();
    if (shallow === 'true') return undefined;
    const out = execFileSync('git', ['log', '--no-merges', '--format=%x1e%aI%x1f%an%x1f%ae', '--name-only'], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    const counts: Record<string, number> = {};
    for (const chunk of out.split('\x1e').slice(1)) {
      const [head, ...rest] = chunk.split('\n');
      const [date, name, email] = head.split('\x1f');
      const mine = name === LOGIN || email.toLowerCase().endsWith(`+${LOGIN.toLowerCase()}@users.noreply.github.com`);
      const files = rest.map((l) => l.trim()).filter(Boolean);
      if (mine && isContentOnlyCommit(files)) counts[date.slice(0, 10)] = (counts[date.slice(0, 10)] ?? 0) + 1;
    }
    return counts;
  } catch {
    return undefined;
  }
}

async function readPrevious(): Promise<GithubActivity | undefined> {
  if (!existsSync(OUT)) return undefined;
  try {
    return parseGithubActivity(JSON.parse(await readFile(OUT, 'utf8')));
  } catch {
    return undefined;
  }
}

async function save(activity: GithubActivity) {
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(`${OUT}.tmp`, `${JSON.stringify(activity, null, 2)}\n`);
  await rename(`${OUT}.tmp`, OUT);
}

async function main() {
  let result: GithubActivity | undefined;
  const errors: string[] = [];
  const auth = token();
  const contentCommits = contentCommitsFromGit();
  log(`user: ${LOGIN}; token: ${auth ? auth.source : 'none'}; today (Asia/Singapore): ${TODAY}`);
  if (auth) {
    try {
      const { days, siteCommits, yearTotals, restricted, viewer, from } = await viaGraphql(auth.value);
      log(`GraphQL viewer: ${viewer || 'unknown'}${viewer.toLowerCase() === LOGIN.toLowerCase() ? ' (the account itself: its private contributions are visible if GitHub counts them)' : ' (not the account: public calendar only)'}`);
      result = {
        login: LOGIN,
        fetchedAt: new Date().toISOString(),
        source: 'graphql',
        days,
        siteCommits,
        contentCommits,
        dedupe: contentCommits ? 'content-commits' : 'site-repo',
        range: { from, to: TODAY },
        viewer,
        yearTotals,
        restricted,
      };
    } catch (err) {
      errors.push(`GraphQL: ${(err as Error).message}`);
      log(`GraphQL failed (${(err as Error).message}); trying the public contributions page`);
    }
  } else {
    log('no token; using the public contributions page');
  }
  if (!result) {
    try {
      const { days, from } = await viaHtml();
      result = {
        login: LOGIN,
        fetchedAt: new Date().toISOString(),
        source: 'html',
        days,
        contentCommits,
        dedupe: contentCommits ? 'content-commits' : 'none',
        range: { from, to: TODAY },
      };
    } catch (err) {
      errors.push(`public page: ${(err as Error).message}`);
      log(`public page failed (${(err as Error).message})`);
    }
  }

  if (!result) {
    const message = errors.join('; ') || 'unknown error';
    const previous = await readPrevious();
    if (previous) {
      // Keep the last good data, but record that today's sync failed.
      await save({ ...previous, lastError: { at: new Date().toISOString(), message } });
      warn(`sync failed (${message}); keeping the snapshot from ${previous.fetchedAt}. The calendar will show GitHub data only up to that date.`);
    } else {
      warn(`sync failed (${message}) and there is no previous snapshot; the calendar will show garden activity only and say that GitHub data is unavailable.`);
    }
    if (STRICT) process.exitCode = 1;
    return;
  }

  await save(result);
  const sum = summarizeGithubActivity(result);
  log(`range: ${sum.range?.from} .. ${sum.range?.to} (source: ${sum.source})`);
  log(`contributions: ${sum.total} on ${sum.nonZeroDays} non-zero days` + (sum.apiTotal !== undefined ? `; GitHub yearly totals: ${sum.apiTotal}` : ''));
  if (sum.restricted !== undefined) log(`anonymous private contributions reported by GitHub: ${sum.restricted}`);
  log(`de-duplication: ${result.dedupe}; content-only site commits in git history: ${Object.values(contentCommits ?? {}).reduce((a, b) => a + b, 0)}`);
  if (!sum.consistent) warn(`per-day sum (${sum.total}) differs from GitHub's yearly totals (${sum.apiTotal}); check the date windows.`);
}

main().catch((err) => {
  warn(`unexpected error: ${(err as Error).message}`);
  if (STRICT) process.exitCode = 1;
});
