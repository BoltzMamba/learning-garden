/**
 * Verify every internal href/src in dist/ resolves to a built file, and that
 * no internal link forgets the GitHub Pages base path.
 *
 *   npm run build && npm run check:links
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const BASE = '/learning-garden/';
const DIST = path.resolve('dist');

function htmlFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? htmlFiles(full) : name.endsWith('.html') ? [full] : [];
  });
}

function resolveTarget(pathname: string): boolean {
  const local = path.join(DIST, decodeURIComponent(pathname.slice(BASE.length)));
  if (pathname.endsWith('/')) return existsSync(path.join(local, 'index.html'));
  return existsSync(local) && statSync(local).isFile();
}

if (!existsSync(DIST)) {
  console.error('dist/ not found. Run `npm run build` first.');
  process.exit(1);
}

const problems: string[] = [];
let checked = 0;
const ids = new Map<string, Set<string>>();

for (const file of htmlFiles(DIST)) {
  const html = readFileSync(file, 'utf8');
  const pagePath = `${BASE}${path.relative(DIST, path.dirname(file)).replace(/\\/g, '/')}/`.replace(/\/+$/, '/');
  ids.set(pagePath, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));

  for (const m of html.matchAll(/\s(?:href|src)="([^"]*)"/g)) {
    const raw = m[1].replace(/&amp;/g, '&');
    if (!raw || /^(https?:|mailto:|data:|javascript:|#)/.test(raw)) continue;
    checked++;
    const where = path.relative(DIST, file).replace(/\\/g, '/');
    const target = new URL(raw, `https://example.test${pagePath}`);
    if (!target.pathname.startsWith(BASE)) {
      problems.push(`${where}: "${raw}" is missing the ${BASE} base path`);
    } else if (!resolveTarget(target.pathname)) {
      problems.push(`${where}: "${raw}" does not resolve to a built file`);
    }
  }
}

// Fragment links to other pages (e.g. questions/#q-id) must hit a real id.
for (const file of htmlFiles(DIST)) {
  const html = readFileSync(file, 'utf8');
  // Same-page anchors (e.g. a note's table of contents, in either language).
  // Ids of this very file (index.html and 404.html share a directory).
  const own = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  for (const m of html.matchAll(/\shref="#([^"]+)"/g)) {
    checked++;
    if (!own.has(decodeURIComponent(m[1].replace(/&amp;/g, '&')))) {
      problems.push(`${path.relative(DIST, file)}: "#${m[1]}" points to a missing anchor on the same page`);
    }
  }
  for (const m of html.matchAll(/\shref="(\/learning-garden\/[^"#]*)#([^"]+)"/g)) {
    const targetIds = ids.get(m[1]);
    if (targetIds && !targetIds.has(decodeURIComponent(m[2]))) {
      problems.push(`${path.relative(DIST, file)}: "${m[1]}#${m[2]}" points to a missing anchor`);
    }
  }
}

if (problems.length) {
  console.error(`✗ ${problems.length} broken internal link(s):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`✓ ${checked} internal links checked across ${htmlFiles(DIST).length} pages; all resolve under ${BASE}`);
