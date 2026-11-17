/**
 * Verify the learning calendar end to end: the cached GitHub snapshot, the
 * de-duplicated counts the build uses, and what the built pages contain.
 * Prints no tokens (it never reads one).
 *
 *   npm run github:sync && npm run build && npm run github:check
 *
 * Exits 1 if a GitHub count in dist/ differs from the snapshot, a non-zero
 * GitHub day is missing, or a year with data has no year tab.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { todayInTimeZone } from '../src/lib/dates.ts';
import { githubCountsByDate, githubSyncedThrough, parseGithubActivity, summarizeGithubActivity } from '../src/lib/github.ts';

const ROOT = process.cwd();
const CACHE = path.join(ROOT, 'src/data/github-activity.json');
const problems: string[] = [];
const log = (msg: string) => console.log(`[github:check] ${msg}`);

if (!existsSync(CACHE)) {
  console.error('src/data/github-activity.json not found. Run `npm run github:sync` first.');
  process.exit(1);
}
const activity = parseGithubActivity(JSON.parse(readFileSync(CACHE, 'utf8')));
if (!activity) {
  console.error('src/data/github-activity.json is not a valid snapshot.');
  process.exit(1);
}

// 1. Snapshot
const sum = summarizeGithubActivity(activity);
const through = githubSyncedThrough(activity)!;
log(`user: ${sum.login}; source: ${sum.source}; viewer: ${sum.viewer ?? 'unknown'}; fetched: ${sum.fetchedAt}`);
log(`queried range: ${sum.range?.from ?? '?'} .. ${sum.range?.to ?? '?'} (synced through ${through}; today ${todayInTimeZone()})`);
log(`API: ${sum.total} contributions on ${sum.nonZeroDays} non-zero days` + (sum.apiTotal !== undefined ? `; GitHub yearly totals ${sum.apiTotal}` : ''));
if (sum.restricted !== undefined) log(`anonymous private contributions: ${sum.restricted}`);
if (!sum.consistent) problems.push(`per-day sum ${sum.total} ≠ GitHub yearly totals ${sum.apiTotal}`);
if (activity.lastError) log(`NOTE last sync failed at ${activity.lastError.at}: ${activity.lastError.message}`);

// 2. Aggregation used by the build
const expected = githubCountsByDate(activity);
const removed = Object.entries(activity.days).filter(([d, n]) => (expected.get(d) ?? 0) !== n);
log(`after de-duplication (${activity.dedupe}): ${[...expected.values()].reduce((a, b) => a + b, 0)} on ${expected.size} days` +
  (removed.length ? `; adjusted days: ${removed.map(([d, n]) => `${d} ${n}→${expected.get(d) ?? 0}`).join(', ')}` : '; nothing removed'));

// 3. Built pages
for (const lang of ['zh', 'en']) {
  const file = path.join(ROOT, 'dist', lang, 'index.html');
  if (!existsSync(file)) {
    problems.push(`dist/${lang}/index.html missing (run npm run build)`);
    continue;
  }
  const html = readFileSync(file, 'utf8');
  const cells = new Map<string, { github: number; notes: number; level: number; unsynced: boolean }>();
  for (const m of html.matchAll(/<button\b[^>]*\bclass="cell"[^>]*>/g)) {
    const attr = (name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(m[0])?.[1];
    const date = attr('data-date');
    if (!date) continue;
    cells.set(date, {
      github: Number(attr('data-github') ?? 0),
      notes: Number(attr('data-notes') ?? 0),
      level: Number(attr('data-level') ?? 0),
      unsynced: /\sdata-github-unsynced(=|\s|>)/.test(m[0]),
    });
  }
  const years = new Set([...html.matchAll(/data-year-button="(\d{4})"/g)].map((m) => m[1]));
  const shownYears = years.size ? years : new Set([...cells.keys()].map((d) => d.slice(0, 4)));

  let mismatches = 0;
  for (const [date, n] of expected) {
    const cell = cells.get(date);
    if (!cell) {
      problems.push(`dist/${lang}: ${date} (GitHub ${n}) has no calendar cell`);
      mismatches++;
    } else if (cell.github !== n) {
      problems.push(`dist/${lang}: ${date} shows GitHub ${cell.github}, snapshot says ${n}`);
      mismatches++;
    } else if (cell.level === 0) {
      problems.push(`dist/${lang}: ${date} has GitHub ${n} but intensity level 0`);
      mismatches++;
    }
  }
  for (const [date, c] of cells) {
    if (c.github > 0 && !expected.has(date)) problems.push(`dist/${lang}: ${date} shows GitHub ${c.github} not in the snapshot`);
  }
  for (const y of new Set([...expected.keys()].map((d) => d.slice(0, 4)))) {
    if (!shownYears.has(y)) problems.push(`dist/${lang}: year ${y} has GitHub data but no year tab`);
  }
  const ghDays = [...cells.values()].filter((c) => c.github > 0).length;
  const learning = [...cells.values()].reduce((a, c) => a + c.notes, 0);
  const learningDays = [...cells.values()].filter((c) => c.notes > 0).length;
  const activeDays = [...cells.values()].filter((c) => c.level > 0).length;
  const unsynced = [...cells.values()].filter((c) => c.unsynced).length;
  log(
    `dist/${lang}: years [${[...shownYears].sort().join(', ')}]; GitHub days ${ghDays}; learning records ${learning} on ${learningDays} days; ` +
      `active days ${activeDays}; unsynced days ${unsynced}; mismatches ${mismatches}`,
  );
}

// 4. Spot checks: the busiest GitHub days, raw → aggregated → page.
const zh = path.join(ROOT, 'dist/zh/index.html');
if (existsSync(zh)) {
  const html = readFileSync(zh, 'utf8');
  const sample = Object.entries(activity.days).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5);
  for (const [date, raw] of sample) {
    const shown = new RegExp(`data-date="${date}"[^>]*data-github="(\\d+)"`).exec(html)?.[1];
    log(`spot check ${date}: API ${raw} → calendar ${expected.get(date) ?? 0} → page ${shown ?? 'missing'}`);
  }
}

if (problems.length) {
  console.error(`✗ ${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
log('✓ every GitHub day in the snapshot is in the built calendar with the same count');
