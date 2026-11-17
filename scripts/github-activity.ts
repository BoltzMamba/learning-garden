/**
 * Fetch the account's public GitHub contribution calendar and cache it in
 * src/data/github-activity.json for the build (no token ever reaches the
 * browser).
 *
 *   npm run github:sync
 *
 * Token: GITHUB_TOKEN / GH_TOKEN, or the local `gh auth token`. Without one
 * (or if the API fails) it falls back to the public contributions page. If
 * everything fails, the previous cache is kept and the script still exits 0,
 * so a GitHub outage never breaks a build.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { todayInTimeZone } from '../src/lib/dates.ts';
import { isContentOnlyCommit, parseContributionsHtml, parseGraphqlYears, type GithubActivity } from '../src/lib/github.ts';
import { GITHUB_OWNER, GITHUB_REPO } from '../src/lib/site.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src/data/github-activity.json');
const LOGIN = GITHUB_OWNER;
const SITE_REPO = `${GITHUB_OWNER}/${GITHUB_REPO}`;
const NOW_YEAR = Number(todayInTimeZone().slice(0, 4));

function log(msg: string) {
  console.log(`[github-activity] ${msg}`);
}

function token(): string | undefined {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || undefined;
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
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`);
  const json = (await res.json()) as { data?: any; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join('; '));
  return json.data;
}

async function viaGraphql(auth: string) {
  const user = await graphql(`query { user(login: "${LOGIN}") { createdAt } }`, auth);
  const first = Number(String(user.user.createdAt).slice(0, 4));
  const years: number[] = [];
  for (let y = first; y <= NOW_YEAR; y++) years.push(y);
  // One aliased contributionsCollection per calendar year (the API's max span), in UTC+8.
  const fields = years
    .map(
      (y) => `y${y}: contributionsCollection(from: "${y}-01-01T00:00:00+08:00", to: "${y}-12-31T23:59:59+08:00") {
        contributionCalendar { weeks { contributionDays { date contributionCount } } }
        commitContributionsByRepository(maxRepositories: 100) {
          repository { nameWithOwner }
          contributions(first: 100) { nodes { occurredAt commitCount } }
        }
      }`,
    )
    .join('\n');
  const data = await graphql(`query { user(login: "${LOGIN}") { ${fields} } }`, auth);
  const byYear = Object.fromEntries(years.map((y) => [y, data.user[`y${y}`]]));
  return parseGraphqlYears(byYear, SITE_REPO);
}

async function viaHtml() {
  const days: Record<string, number> = {};
  for (let y = NOW_YEAR; y >= NOW_YEAR - 10; y--) {
    const res = await fetch(`https://github.com/users/${LOGIN}/contributions?from=${y}-01-01&to=${y}-12-31`, {
      headers: { 'user-agent': 'learning-garden-build' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`contributions page HTTP ${res.status}`);
    const year = Object.fromEntries(Object.entries(parseContributionsHtml(await res.text())).filter(([d]) => d.startsWith(`${y}-`)));
    if (!Object.keys(year).length && y < NOW_YEAR) break; // before the account had activity
    Object.assign(days, year);
  }
  return days;
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

async function main() {
  let result: GithubActivity | undefined;
  const auth = token();
  const contentCommits = contentCommitsFromGit();
  if (auth) {
    try {
      const { days, siteCommits } = await viaGraphql(auth);
      result = {
        login: LOGIN,
        fetchedAt: new Date().toISOString(),
        source: 'graphql',
        days,
        siteCommits,
        contentCommits,
        dedupe: contentCommits ? 'content-commits' : 'site-repo',
      };
    } catch (err) {
      log(`GraphQL failed (${(err as Error).message}); trying the public contributions page`);
    }
  } else {
    log('no token; using the public contributions page');
  }
  if (!result) {
    try {
      const days = await viaHtml();
      result = {
        login: LOGIN,
        fetchedAt: new Date().toISOString(),
        source: 'html',
        days,
        contentCommits,
        dedupe: contentCommits ? 'content-commits' : 'none',
      };
    } catch (err) {
      log(`public page failed (${(err as Error).message})`);
    }
  }
  if (!result) {
    log(existsSync(OUT) ? 'keeping the previous cache' : 'no data; the calendar will show notes only');
    return;
  }
  const previous = existsSync(OUT) ? await readFile(OUT, 'utf8').catch(() => '') : '';
  const json = `${JSON.stringify(result, null, 2)}\n`;
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(`${OUT}.tmp`, json);
  await rename(`${OUT}.tmp`, OUT);
  const total = Object.values(result.days).reduce((a, b) => a + b, 0);
  log(
    `${result.source}: ${Object.keys(result.days).length} active days, ${total} contributions; ` +
      `de-duplication: ${result.dedupe}${previous ? '' : ' (new cache)'}`,
  );
}

main().catch((err) => {
  log(`unexpected error: ${(err as Error).message}`);
});
