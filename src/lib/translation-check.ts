/**
 * Scan src/content/notes (Chinese source) and src/content/notes-en (English)
 * and classify every logical note. Shared by `npm run translate` and the
 * Astro build, so the CLI and the site always agree.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { NoteRef } from './links.ts';
import {
  classifyTranslation,
  parseMarkdownFile,
  STRICT_FAILURES,
  TRANSLATION_STATUSES,
  type NoteTranslationReport,
  type TranslationStatus,
} from './translation.ts';
import { unpublishedProjectIds } from './experiments.ts';

export const ZH_DIR = 'src/content/notes';
export const EN_DIR = 'src/content/notes-en';

export interface TranslationScan {
  notes: NoteTranslationReport[];
  counts: Record<TranslationStatus, number>;
  /** Reports that block a strict (production) build. */
  failures: NoteTranslationReport[];
  /** MANUAL_STALE reports: shown, never blocking. */
  manualStale: NoteTranslationReport[];
  /** Unpublished experiment write-ups: reported, never blocking until their experiment is completed. */
  drafts?: string[];
}

function markdownFiles(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  if (!existsSync(dir)) return files;
  for (const name of readdirSync(dir).sort()) {
    if (name.endsWith('.md')) files.set(name.slice(0, -3), readFileSync(path.join(dir, name), 'utf8'));
  }
  return files;
}

function frontmatterOf(text: string): Record<string, unknown> {
  try {
    return parseMarkdownFile(text).frontmatter;
  } catch {
    return {};
  }
}

function titleOf(text: string): string | undefined {
  const t = frontmatterOf(text).title;
  return typeof t === 'string' ? t : undefined;
}

export function scanTranslations(root: string, options: { only?: string } = {}): TranslationScan {
  const zh = markdownFiles(path.join(root, ZH_DIR));
  const en = markdownFiles(path.join(root, EN_DIR));
  // Links resolve by id, Chinese title or English title — never to an orphan.
  const refs: NoteRef[] = [];
  for (const [id, text] of zh) {
    refs.push({ id, title: titleOf(text) ?? id });
    const enText = en.get(id);
    const enTitle = enText ? titleOf(enText) : undefined;
    if (enTitle) refs.push({ id, title: enTitle });
  }

  const ids = [...new Set([...zh.keys(), ...en.keys()])].sort();
  const notes = ids
    .filter((id) => options.only === undefined || id === options.only)
    .map((id) => classifyTranslation({ id, zhText: zh.get(id), enText: en.get(id), refs }));

  // Same rule as the build: experiment write-ups are drafts until the experiment is completed.
  const drafts = unpublishedProjectIds([...zh].map(([id, text]) => ({ id, data: frontmatterOf(text) })));
  const counts = Object.fromEntries(TRANSLATION_STATUSES.map((s) => [s, 0])) as Record<TranslationStatus, number>;
  for (const n of notes) counts[n.status]++;
  return {
    notes,
    counts,
    failures: notes.filter((n) => STRICT_FAILURES.has(n.status) && !drafts.has(n.id)),
    manualStale: notes.filter((n) => n.status === 'MANUAL_STALE' && !drafts.has(n.id)),
    drafts: notes.filter((n) => drafts.has(n.id)).map((n) => n.id),
  };
}

/** Human-readable report lines. */
export function formatScan(scan: TranslationScan, { verbose = true } = {}): string[] {
  const lines: string[] = [];
  for (const n of scan.notes) {
    const draft = scan.drafts?.includes(n.id);
    const mark = draft ? '·' : STRICT_FAILURES.has(n.status) ? '✗' : n.status === 'MANUAL_STALE' ? '!' : '✓';
    lines.push(`${mark} ${n.status.padEnd(14)} ${n.id}${draft ? '  (unpublished draft: not required until its experiment is completed)' : ''}`);
    for (const r of n.reasons) lines.push(`    - ${r}`);
    if (verbose) for (const w of n.warnings) lines.push(`    ~ ${w}`);
  }
  const summary = Object.entries(scan.counts)
    .filter(([, c]) => c > 0)
    .map(([s, c]) => `${s} ${c}`)
    .join(' · ');
  lines.push('', `${scan.notes.length} note(s): ${summary || 'none'}`);
  return lines;
}
