/**
 * Bilingual content pipeline — deterministic helpers. This command never
 * translates: the natural-language work is done by the developer agent
 * (Claude/Codex) following AGENTS.md. It checks state, computes hashes and
 * writes files safely.
 *
 *   npm run translate:check                      status of every note
 *   npm run translate:check -- --note <id>       one note
 *   npm run translate:check -- --json            machine-readable
 *   npm run translate:check -- --strict          exit 1 on anything that blocks publishing
 *
 *   npm run translate -- apply   --note <id>     install .translations/<id>.md as the auto translation
 *   npm run translate -- confirm --note <id>     author confirms the English still matches the Chinese
 *   npm run translate -- adopt   --note <id>     keep edits to an auto translation: make it manual
 *
 * Set GARDEN_ROOT to operate on another checkout (used by tests).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { EN_DIR, formatScan, scanTranslations, ZH_DIR } from '../src/lib/translation-check.ts';
import {
  hashContent,
  parseMarkdownFile,
  serializeEnglish,
  STRICT_FAILURES,
  TRANSLATION_RULES_VERSION,
  type EnglishFile,
} from '../src/lib/translation.ts';

const ROOT = process.env.GARDEN_ROOT
  ? path.resolve(process.env.GARDEN_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CANDIDATE_DIR = '.translations';

class UserError extends Error {}

const enFile = (id: string) => path.join(ROOT, EN_DIR, `${id}.md`);
const zhFile = (id: string) => path.join(ROOT, ZH_DIR, `${id}.md`);
const candidateFile = (id: string) => path.join(ROOT, CANDIDATE_DIR, `${id}.md`);
const rel = (p: string) => path.relative(ROOT, p).replace(/\\/g, '/');

/** Write via temp file + rename so a crash never leaves a half-written file. */
function writeAtomic(file: string, content: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, content, 'utf8');
    renameSync(tmp, file);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

function requireNote(id: string | undefined): string {
  if (!id) throw new UserError('--note <id> is required');
  if (!existsSync(zhFile(id))) throw new UserError(`no Chinese source ${ZH_DIR}/${id}.md`);
  return id;
}

function statusOf(id: string) {
  return scanTranslations(ROOT, { only: id }).notes[0];
}

// -------------------------------------------------------------------- check

function check(opts: { note?: string; json?: boolean; strict?: boolean }): number {
  if (opts.note && !existsSync(zhFile(opts.note)) && !existsSync(enFile(opts.note))) {
    throw new UserError(`unknown note "${opts.note}"`);
  }
  const scan = scanTranslations(ROOT, { only: opts.note });
  const blocked = opts.strict && scan.failures.length > 0;
  if (opts.json) {
    console.log(JSON.stringify({ rulesVersion: TRANSLATION_RULES_VERSION, strict: !!opts.strict, ok: !blocked, ...scan }, null, 2));
  } else {
    console.log(formatScan(scan).join('\n'));
    if (scan.manualStale.length) {
      console.log(`! ${scan.manualStale.length} manual English edition(s) need the author's review (warning, not blocking).`);
    }
    if (blocked) {
      console.error(
        `\n✗ Strict bilingual publishing: ${scan.failures.length} note(s) block the build:\n` +
          scan.failures.map((f) => `  ${f.id}: ${f.status} — ${f.reasons[0] ?? ''}`).join('\n') +
          '\n  Nothing was built or deployed. Fix the notes above (see AGENTS.md → "Translating notes").',
      );
    } else if (opts.strict) {
      console.log('✓ Strict bilingual check passed (files and sync state are consistent; this does not prove the translation is correct).');
    }
  }
  return blocked ? 1 : 0;
}

// -------------------------------------------------------------------- apply

/**
 * Install a candidate translation written by the agent to .translations/<id>.md
 * (frontmatter: title, description; then the English body). Refuses to touch
 * manual translations, edited auto translations and invalid files; validates
 * the result and rolls back if it is not AUTO_CURRENT.
 */
function apply(opts: { note?: string; discardEdits?: boolean; replaceInvalid?: boolean; keep?: boolean }): number {
  const id = requireNote(opts.note);
  const source = candidateFile(id);
  if (!existsSync(source)) throw new UserError(`no candidate ${rel(source)}; write the English title, description and body there first`);

  const before = statusOf(id);
  if (!before.sourceHash) throw new UserError(`the Chinese source cannot be read: ${before.reasons.join('; ')}`);
  if (before.mode === 'manual') {
    throw new UserError(
      `${EN_DIR}/${id}.md is a MANUAL translation (${before.status}); it is never overwritten. ` +
        'If the author wants it replaced, they must delete the file or set translation.mode themselves.',
    );
  }
  if (before.status === 'AUTO_MODIFIED' && !opts.discardEdits) {
    throw new UserError(
      `${EN_DIR}/${id}.md was edited after it was generated (AUTO_MODIFIED). Ask the author: keep the edits ` +
        `(\`npm run translate -- adopt --note ${id}\`) or regenerate (\`apply --note ${id} --discard-edits\`). Nothing was written.`,
    );
  }
  if (before.status === 'INVALID' && existsSync(enFile(id)) && !opts.replaceInvalid) {
    throw new UserError(
      `${EN_DIR}/${id}.md is INVALID (${before.reasons.join('; ')}). It may contain hand-written text: fix it, or pass --replace-invalid if the author agrees. Nothing was written.`,
    );
  }

  let candidate;
  try {
    candidate = parseMarkdownFile(readFileSync(source, 'utf8'));
  } catch (err) {
    throw new UserError(`${rel(source)}: ${(err as Error).message}`);
  }
  const { title, description } = candidate.frontmatter;
  if (typeof title !== 'string' || !title.trim()) throw new UserError(`${rel(source)}: title is required`);
  if (typeof description !== 'string' || !description.trim()) throw new UserError(`${rel(source)}: description is required`);
  const extra = Object.keys(candidate.frontmatter).filter((k) => k !== 'title' && k !== 'description');
  if (extra.length) throw new UserError(`${rel(source)}: only title and description belong in a candidate (found ${extra.join(', ')})`);

  const file: EnglishFile = {
    title,
    description,
    body: candidate.body,
    translation: {
      mode: 'auto',
      sourceHash: before.sourceHash!,
      generatedHash: hashContent({ title, description, body: candidate.body }),
      rulesVersion: TRANSLATION_RULES_VERSION,
    },
  };
  const target = enFile(id);
  const previous = existsSync(target) ? readFileSync(target, 'utf8') : undefined;
  writeAtomic(target, serializeEnglish(file));

  const after = statusOf(id);
  if (after.status !== 'AUTO_CURRENT') {
    // Never leave a broken or half-valid file behind: restore what was there.
    if (previous === undefined) rmSync(target, { force: true });
    else writeAtomic(target, previous);
    console.error(formatScan({ notes: [after], counts: {} as never, failures: [], manualStale: [] }).slice(0, -2).join('\n'));
    throw new UserError(`the candidate does not pass the checks (${after.status}); ${rel(target)} was left unchanged and the candidate kept`);
  }
  if (!opts.keep) rmSync(source, { force: true });
  console.log(`✓ ${rel(target)}: AUTO_CURRENT (was ${before.status})`);
  for (const w of after.warnings) console.log(`  ~ ${w}`);
  return 0;
}

// ---------------------------------------------------- confirm / adopt edits

/** Replace one key inside the frontmatter's translation block, keeping the rest of the file byte-for-byte. */
function editTranslationBlock(text: string, edit: (lines: string[]) => string[]): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const end = lines.indexOf('---', 1);
  const start = lines.findIndex((l, i) => i > 0 && i < end && /^translation:\s*$/.test(l));
  if (lines[0].replace(/^﻿/, '') !== '---' || end < 0 || start < 0) {
    throw new UserError('expected a block-style `translation:` mapping in the frontmatter');
  }
  let stop = start + 1;
  while (stop < end && /^\s+\S/.test(lines[stop])) stop++;
  const block = edit(lines.slice(start + 1, stop));
  return [...lines.slice(0, start + 1), ...block, ...lines.slice(stop)].join(eol);
}

const setKey = (block: string[], key: string, value: string) => {
  const i = block.findIndex((l) => new RegExp(`^\\s+${key}:`).test(l));
  const line = `  ${key}: ${value}`;
  if (i >= 0) block[i] = line;
  else block.push(line);
  return block;
};
const dropKey = (block: string[], key: string) => block.filter((l) => !new RegExp(`^\\s+${key}:`).test(l));

/**
 * The author has checked that the English text matches the current Chinese
 * text: record the current source hash. Works for manual translations and for
 * unedited auto translations; refuses edited auto translations.
 */
function confirm(opts: { note?: string }): number {
  const id = requireNote(opts.note);
  const before = statusOf(id);
  const ok = ['MANUAL_STALE', 'MANUAL_CURRENT', 'AUTO_STALE', 'AUTO_CURRENT'];
  if (!ok.includes(before.status)) throw new UserError(`${id} is ${before.status}; confirm only applies to ${ok.join(', ')}`);
  const target = enFile(id);
  const text = readFileSync(target, 'utf8');
  const next = editTranslationBlock(text, (block) => {
    let b = setKey(block, 'sourceHash', JSON.stringify(before.sourceHash));
    if (before.mode === 'auto') b = setKey(b, 'rulesVersion', String(TRANSLATION_RULES_VERSION));
    return b;
  });
  writeAtomic(target, next);
  const after = statusOf(id);
  if (!['MANUAL_CURRENT', 'AUTO_CURRENT'].includes(after.status)) {
    writeAtomic(target, text);
    throw new UserError(`confirm did not produce a current state (${after.status}: ${after.reasons.join('; ')}); file restored`);
  }
  console.log(`✓ ${rel(target)}: ${before.status} → ${after.status}`);
  return 0;
}

/** Keep the author's edits to an auto translation by making it a manual translation. */
function adopt(opts: { note?: string }): number {
  const id = requireNote(opts.note);
  const before = statusOf(id);
  if (before.mode !== 'auto') throw new UserError(`${id} is ${before.status}; adopt only applies to auto translations`);
  const target = enFile(id);
  const text = readFileSync(target, 'utf8');
  writeAtomic(
    target,
    editTranslationBlock(text, (block) =>
      dropKey(dropKey(block, 'generatedHash'), 'rulesVersion').map((l) => l.replace(/^(\s+mode:\s*).*$/, '$1manual')),
    ),
  );
  const after = statusOf(id);
  console.log(`✓ ${rel(target)}: ${before.status} → ${after.status} (now protected from automatic regeneration)`);
  for (const r of after.reasons) console.log(`  - ${r}`);
  return 0;
}

// --------------------------------------------------------------------- main

const HELP = `Usage: npm run translate -- <command> [options]

  check   [--note <id>] [--json] [--strict]   translation status (also: npm run translate:check)
  apply   --note <id> [--discard-edits] [--replace-invalid] [--keep]
          install ${CANDIDATE_DIR}/<id>.md (title, description, English body) as the auto translation
  confirm --note <id>   the author checked the English against the current Chinese text
  adopt   --note <id>   keep edits to an auto translation by making it manual

Statuses: MISSING, AUTO_CURRENT, AUTO_STALE, AUTO_MODIFIED, MANUAL_CURRENT,
MANUAL_STALE (warning only), INVALID, ORPHAN. Strict mode fails on: ${[...STRICT_FAILURES].join(', ')}.`;

export function main(argv: string[]): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      note: { type: 'string' },
      json: { type: 'boolean' },
      strict: { type: 'boolean' },
      'discard-edits': { type: 'boolean' },
      'replace-invalid': { type: 'boolean' },
      keep: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const command = positionals[0] ?? 'check';
  if (values.help || command === 'help') {
    console.log(HELP);
    return 0;
  }
  switch (command) {
    case 'check':
      return check(values);
    case 'apply':
      return apply({ note: values.note, discardEdits: values['discard-edits'], replaceInvalid: values['replace-invalid'], keep: values.keep });
    case 'confirm':
      return confirm(values);
    case 'adopt':
      return adopt(values);
    default:
      throw new UserError(`unknown command "${command}"\n\n${HELP}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    if (err instanceof UserError || (err as { code?: string }).code?.startsWith('ERR_PARSE_ARGS')) {
      console.error(`✗ ${(err as Error).message}`);
      process.exitCode = 2;
    } else throw err;
  }
}
