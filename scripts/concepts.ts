/**
 * Concept Registry check — deterministic, no network.
 *
 *   npm run concepts:check            errors exit 1; warnings are printed
 *   npm run concepts:check -- --list  also list every concept and where it is used
 *
 * Set GARDEN_ROOT to check another checkout (used by tests).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkConcepts } from '../src/lib/concepts-check.ts';

const ROOT = process.env.GARDEN_ROOT
  ? path.resolve(process.env.GARDEN_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const scan = checkConcepts(ROOT);
if (process.argv.includes('--list')) {
  for (const c of scan.concepts.values()) {
    const users = [...scan.referencedBy].filter(([, ids]) => ids.includes(c.id)).map(([note]) => note);
    console.log(`${c.id}  ${c.zh.term} / ${c.en.term}  → ${c.source.note}#${c.source.anchor}  used in: ${users.join(', ') || '—'}`);
  }
}
for (const w of scan.warnings) console.warn(`~ ${w}`);
if (scan.errors.length) {
  console.error(`✗ ${scan.errors.length} concept problem(s):\n  ${scan.errors.join('\n  ')}`);
  process.exitCode = 1;
} else {
  const refs = [...scan.referencedBy.values()].reduce((n, ids) => n + ids.length, 0);
  console.log(`✓ ${scan.concepts.size} concept(s), ${refs} reference(s) across notes; sources and anchors resolve in both languages`);
}
