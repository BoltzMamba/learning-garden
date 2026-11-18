/**
 * Bilingual content: deterministic translation state (pure apart from hashing).
 *
 * The Chinese file in src/content/notes/<id>.md is the source of truth for a
 * note's knowledge structure (section, tags, series, related, published) and
 * its Chinese text. The English file src/content/notes-en/<id>.md carries only
 * language: title, description, body and a `translation` block.
 *
 *   translation:
 *     mode: auto | manual
 *     sourceHash: "sha256:…"     hash of the Chinese title + description + body it matches
 *     generatedHash: "sha256:…"  auto only: hash of the English text as generated
 *     rulesVersion: 1            auto only: TRANSLATION_RULES_VERSION it was produced under
 *
 * Hashes are computed here, never written by hand or by a model. Structural
 * frontmatter changes (series, related, order, tags…) do not change the
 * source hash: they only need a rebuild, not a new translation.
 *
 * Learning experiments keep both languages in the Chinese frontmatter
 * (`experiments[].title/description/requirements` with `zh` and `en`). Their
 * Chinese text is part of the source hash, so editing it makes the English
 * edition stale until the `en` text is reviewed; notes without experiments
 * hash exactly as before.
 */
import { createHash } from 'node:crypto';
import { parseFrontmatter } from '@astrojs/markdown-remark';
import { extractNoteLinks, makeResolver, noteSlugFromHref, stripCode, type NoteRef } from './links.ts';
import { scanConceptMarkup } from './concepts.ts';
import { experimentSourceText } from './experiments.ts';

/**
 * Version of the translation rules (AGENTS.md → "Translating notes"). Bump it
 * only when the rules change enough that existing automatic translations
 * should be redone; every `auto` file then reports AUTO_STALE.
 */
export const TRANSLATION_RULES_VERSION = 1;

export const TRANSLATION_STATUSES = [
  'MISSING',
  'AUTO_CURRENT',
  'AUTO_STALE',
  'AUTO_MODIFIED',
  'MANUAL_CURRENT',
  'MANUAL_STALE',
  'INVALID',
  'ORPHAN',
] as const;
export type TranslationStatus = (typeof TRANSLATION_STATUSES)[number];

/** Statuses that block a production build / deployment. MANUAL_STALE only warns. */
export const STRICT_FAILURES: ReadonlySet<TranslationStatus> = new Set([
  'MISSING',
  'AUTO_STALE',
  'AUTO_MODIFIED',
  'INVALID',
  'ORPHAN',
]);

export const TRANSLATION_MODES = ['auto', 'manual'] as const;
export type TranslationMode = (typeof TRANSLATION_MODES)[number];

/** Frontmatter keys that belong to the Chinese source only. */
export const STRUCTURAL_KEYS = [
  'category',
  'tags',
  'published',
  'contentType',
  'series',
  'order',
  'related',
  'experiments',
  'projectTier',
  'experimentId',
  'sourceNote',
] as const;
const EN_KEYS = new Set(['title', 'description', 'translation']);
const TRANSLATION_KEYS = new Set(['mode', 'sourceHash', 'generatedHash', 'rulesVersion']);
export const HASH_RE = /^sha256:[0-9a-f]{64}$/;

// ------------------------------------------------------------ normalisation

/** Line endings, BOM and Unicode form: identical text hashes identically on every OS. */
export function normalizeText(value: string): string {
  return value.replace(/^﻿/, '').replace(/\r\n?/g, '\n').normalize('NFC');
}

/** Title / description: normalised and trimmed. */
export function normalizeField(value: string): string {
  return normalizeText(value).trim();
}

/**
 * Markdown body: normalised, trailing whitespace removed from every line,
 * leading blank lines and trailing whitespace of the document dropped.
 * (Editors strip trailing spaces; that must not make a translation stale.)
 */
export function normalizeBody(value: string): string {
  return normalizeText(value)
    .replace(/[ \t]+$/gm, '')
    .replace(/^\n+/, '')
    .replace(/\s+$/, '');
}

export interface TextContent {
  title: string;
  description: string;
  body: string;
  /** Chinese experiment text (see experimentSourceText); omitted or empty for most notes. */
  experiments?: readonly (readonly string[])[];
}

const HASH_DOMAIN = 'learning-garden/translation-text/v1';

/** SHA-256 over the normalised title, description, body and (when present) experiment text. */
export function hashContent(content: TextContent): string {
  const experiments = (content.experiments ?? []).map((e) => e.map(normalizeField));
  const canonical = JSON.stringify([
    HASH_DOMAIN,
    normalizeField(content.title),
    normalizeField(content.description),
    normalizeBody(content.body),
    // Appended only when present, so notes without experiments keep their hashes.
    ...(experiments.length ? [['experiments', experiments]] : []),
  ]);
  return `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
}

// ------------------------------------------------------------------ parsing

export interface ParsedFile {
  frontmatter: Record<string, unknown>;
  body: string;
}

/** Parse with the same YAML frontmatter parser Astro uses. Throws on invalid YAML. */
export function parseMarkdownFile(text: string): ParsedFile {
  const normalized = normalizeText(text);
  if (!/^---\n/.test(normalized)) throw new Error('missing YAML frontmatter (the file must start with ---)');
  const { frontmatter, content } = parseFrontmatter(normalized);
  return { frontmatter: frontmatter as Record<string, unknown>, body: content };
}

export interface TranslationMeta {
  mode: TranslationMode;
  sourceHash: string;
  generatedHash?: string;
  rulesVersion?: number;
}

export interface EnglishFile {
  title: string;
  description: string;
  body: string;
  translation: TranslationMeta;
}

/** Validate an English file's frontmatter. Returns the problems, or the typed file. */
export function validateEnglish(parsed: ParsedFile): { file?: EnglishFile; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fm = parsed.frontmatter;
  for (const key of Object.keys(fm)) {
    if ((STRUCTURAL_KEYS as readonly string[]).includes(key)) {
      errors.push(`"${key}" is structural metadata; it lives in the Chinese source only (src/content/notes/)`);
    } else if (!EN_KEYS.has(key)) errors.push(`unknown frontmatter key "${key}" (allowed: title, description, translation)`);
  }
  const str = (key: string) => (typeof fm[key] === 'string' && (fm[key] as string).trim() ? (fm[key] as string) : undefined);
  const title = str('title');
  const description = str('description');
  if (!title) errors.push('title: required, non-empty string');
  if (!description) errors.push('description: required, non-empty string');

  const t = fm.translation;
  let meta: TranslationMeta | undefined;
  if (!t || typeof t !== 'object' || Array.isArray(t)) {
    errors.push('translation: required block with mode and sourceHash');
  } else {
    const tr = t as Record<string, unknown>;
    for (const key of Object.keys(tr)) if (!TRANSLATION_KEYS.has(key)) errors.push(`translation.${key}: unknown key`);
    const mode = tr.mode;
    if (mode !== 'auto' && mode !== 'manual') errors.push(`translation.mode: must be "auto" or "manual", got ${JSON.stringify(mode)}`);
    const sourceHash = tr.sourceHash;
    if (typeof sourceHash !== 'string' || !HASH_RE.test(sourceHash)) {
      errors.push('translation.sourceHash: must be "sha256:<64 hex>" computed by `npm run translate` (never written by hand)');
    }
    if (mode === 'auto') {
      if (typeof tr.generatedHash !== 'string' || !HASH_RE.test(tr.generatedHash)) {
        errors.push('translation.generatedHash: auto translations need the "sha256:<64 hex>" written by `npm run translate -- apply`');
      }
      if (!Number.isInteger(tr.rulesVersion) || (tr.rulesVersion as number) < 1) {
        errors.push('translation.rulesVersion: auto translations need a positive integer');
      }
    } else if (mode === 'manual' && tr.generatedHash !== undefined) {
      warnings.push('translation.generatedHash is ignored for manual translations (remove it, or use `npm run translate -- adopt`)');
    }
    if (!errors.some((e) => e.startsWith('translation.'))) {
      meta = {
        mode: mode as TranslationMode,
        sourceHash: sourceHash as string,
        generatedHash: mode === 'auto' ? (tr.generatedHash as string) : undefined,
        rulesVersion: mode === 'auto' ? (tr.rulesVersion as number) : undefined,
      };
    }
  }
  if (errors.length || !title || !description || !meta) return { errors, warnings };
  return { file: { title, description, body: parsed.body, translation: meta }, errors, warnings };
}

// -------------------------------------------------------- content invariants

export interface PreservedParts {
  /** Note ids linked from the body (wikilinks and note URLs), resolved. */
  links: string[];
  /** Link targets that resolve to no note. */
  unresolved: string[];
  /** Image sources, in order of appearance (deduplicated). */
  images: string[];
  /** Number of fenced code blocks. */
  codeBlocks: number;
  /** Number of display-math blocks ($$ … $$). */
  mathBlocks: number;
  /** Absolute links into the Chinese site (/zh/…). */
  zhLinks: string[];
  /** Colour marks and how often each occurs: "==" (yellow shorthand), "hl:<color>", "ink:<color>". */
  marks: Record<string, number>;
}

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[^\n]*$/gm;

export function preservedParts(body: string, id: string, refs: readonly NoteRef[]): PreservedParts {
  const text = normalizeText(body);
  const { targets, unresolved } = extractNoteLinks(text, id, makeResolver(refs));
  const prose = stripCode(text);
  const images = new Set<string>();
  for (const m of prose.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^)]*)?\)/g)) images.add(m[1]);
  for (const m of prose.matchAll(/<img\b[^>]*\ssrc=["']([^"']+)["']/gi)) images.add(m[1]);
  const zhLinks: string[] = [];
  for (const m of prose.matchAll(/\]\(\s*<?([^)\s>]+)>?/g)) {
    if (/(?:^|\/)zh\/notes\//.test(m[1]) && noteSlugFromHref(m[1], id)) zhLinks.push(m[1]);
  }
  return {
    links: targets,
    unresolved,
    images: [...images],
    codeBlocks: [...text.matchAll(FENCE_RE)].length,
    mathBlocks: (prose.match(/^\s*\$\$/gm) ?? []).length,
    zhLinks,
    marks: countMarks(prose),
  };
}

/** :hl / :ink with a label of text, [single brackets] or [[wikilinks]], and optional {attributes}. */
const MARK_DIRECTIVE_RE = /(?<![:\w]):(hl|ink)\[(?:[^[\]\n]|\[\[[^\]\n]*\]\]|\[[^[\]\n]*\])*\](?:\{([^}\n]*)\})?/g;

/**
 * Count colour marks in prose (code already removed; math removed here).
 * Mirrors src/lib/remark-marks.ts closely enough to compare two languages.
 */
export function countMarks(prose: string): Record<string, number> {
  const text = prose.replace(/\$\$[\s\S]*?\$\$/g, ' ').replace(/\$[^$\n]+\$/g, ' ');
  const marks: Record<string, number> = {};
  const add = (key: string) => (marks[key] = (marks[key] ?? 0) + 1);
  const rest = text.replace(MARK_DIRECTIVE_RE, (_match, name: string, attrs: string | undefined) => {
    const color = /(?:^|\s)color\s*=\s*["']?([\w-]+)/.exec(attrs ?? '')?.[1] ?? (name === 'hl' ? 'yellow' : 'default');
    add(`${name}:${color}`);
    return ' ';
  });
  const pairs = Math.floor((rest.match(/(?<![=\\])==(?!=)/g) ?? []).length / 2);
  if (pairs) marks['=='] = pairs;
  // Concept references and definition anchors keep their ids in every language.
  const { references, anchors } = scanConceptMarkup(prose);
  for (const id of references) add(`concept:${id}`);
  for (const a of anchors) add(`dfn:${a}`);
  return marks;
}

/**
 * Compare what an English body keeps of the Chinese one. For automatic
 * translations losing a link, image, code block or formula is an error; a
 * manual English edition may be structured differently, so it only warns.
 */
export function compareParts(zh: PreservedParts, en: PreservedParts, mode: TranslationMode): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const loss = mode === 'auto' ? errors : warnings;
  for (const u of en.unresolved) errors.push(`link "${u}" does not point to an existing note`);
  for (const l of zh.links) if (!en.links.includes(l)) loss.push(`the Chinese text links to "${l}" but the English text does not`);
  for (const l of en.links) {
    if (!zh.links.includes(l)) {
      warnings.push(`the English text links to "${l}" but the Chinese text does not; the knowledge graph follows the Chinese source, so this link adds no relation`);
    }
  }
  for (const img of zh.images) if (!en.images.includes(img)) loss.push(`image "${img}" from the Chinese text is missing`);
  if (zh.codeBlocks !== en.codeBlocks) loss.push(`code blocks: Chinese has ${zh.codeBlocks}, English has ${en.codeBlocks}`);
  if (zh.mathBlocks !== en.mathBlocks) loss.push(`display formulas: Chinese has ${zh.mathBlocks}, English has ${en.mathBlocks}`);
  for (const k of [...new Set([...Object.keys(zh.marks), ...Object.keys(en.marks)])].sort()) {
    const [a, b] = [zh.marks[k] ?? 0, en.marks[k] ?? 0];
    if (a === b) continue;
    const [name, value] = k.split(':');
    const label =
      k === '==' ? '==…== highlights'
      : name === 'concept' ? `:concept[…]{id="${value}"} references`
      : name === 'dfn' ? `:dfn[…]{#${value}} anchors`
      : `:${name}[…]{color="${value}"} marks`;
    loss.push(`${label}: Chinese has ${a}, English has ${b} (keep every colour mark and its colour)`);
  }
  for (const l of en.zhLinks) warnings.push(`"${l}" sends English readers to the Chinese site; use [[id]] or ../id/ to stay in the reader's language`);
  return { errors, warnings };
}

// ---------------------------------------------------------------- statuses

export interface NoteTranslationReport {
  id: string;
  status: TranslationStatus;
  mode?: TranslationMode;
  /** Why the status is what it is / what to do (problems for failing statuses). */
  reasons: string[];
  /** Non-blocking findings. */
  warnings: string[];
  /** Current hash of the Chinese source (undefined for ORPHAN or an unreadable source). */
  sourceHash?: string;
}

export interface ClassifyInput {
  id: string;
  /** Raw Chinese file text; undefined when there is none (an orphan English file). */
  zhText?: string;
  /** Raw English file text; undefined when missing. */
  enText?: string;
  /** Every note: id and Chinese title, plus English titles where known (for link resolution). */
  refs: readonly NoteRef[];
  rulesVersion?: number;
}

/** Classify one logical note. Deterministic: same files, same answer. */
export function classifyTranslation(input: ClassifyInput): NoteTranslationReport {
  const { id, zhText, enText, refs } = input;
  const rules = input.rulesVersion ?? TRANSLATION_RULES_VERSION;
  const report = (status: TranslationStatus, extra: Partial<NoteTranslationReport> = {}): NoteTranslationReport => ({
    id,
    status,
    reasons: [],
    warnings: [],
    ...extra,
  });

  if (zhText === undefined) {
    return report('ORPHAN', {
      reasons: [`src/content/notes-en/${id}.md has no Chinese source src/content/notes/${id}.md (rename it to match, or delete it)`],
    });
  }
  let zh: ParsedFile;
  try {
    zh = parseMarkdownFile(zhText);
  } catch (err) {
    return report('INVALID', { reasons: [`Chinese source cannot be parsed: ${(err as Error).message}`] });
  }
  const zhTitle = typeof zh.frontmatter.title === 'string' ? zh.frontmatter.title : '';
  const zhDescription = typeof zh.frontmatter.description === 'string' ? zh.frontmatter.description : '';
  const sourceHash = hashContent({
    title: zhTitle,
    description: zhDescription,
    body: zh.body,
    experiments: experimentSourceText(zh.frontmatter.experiments),
  });

  if (enText === undefined) {
    return report('MISSING', { sourceHash, reasons: [`no English file src/content/notes-en/${id}.md`] });
  }
  let parsed: ParsedFile;
  try {
    parsed = parseMarkdownFile(enText);
  } catch (err) {
    return report('INVALID', { sourceHash, reasons: [`English file cannot be parsed: ${(err as Error).message}`] });
  }
  const checked = validateEnglish(parsed);
  if (!checked.file) return report('INVALID', { sourceHash, reasons: checked.errors, warnings: checked.warnings });
  const en = checked.file;
  const mode = en.translation.mode;
  const warnings = [...checked.warnings];

  const zhBodyEmpty = normalizeBody(zh.body) === '';
  if (!zhBodyEmpty && normalizeBody(en.body) === '') {
    return report('INVALID', { sourceHash, mode, reasons: ['English body is empty but the Chinese body is not'], warnings });
  }
  const parts = compareParts(preservedParts(zh.body, id, refs), preservedParts(en.body, id, refs), mode);
  warnings.push(...parts.warnings);

  if (mode === 'auto') {
    const current = hashContent(en);
    if (current !== en.translation.generatedHash) {
      // An edited automatic translation: never overwrite it silently.
      return report('AUTO_MODIFIED', {
        sourceHash,
        mode,
        reasons: [
          'the English text was edited after it was generated (generatedHash no longer matches)',
          'decide: keep the edits (`npm run translate -- adopt --note ' + id + '` → manual) or regenerate (`apply --discard-edits`)',
        ],
        warnings,
      });
    }
    if (parts.errors.length) return report('INVALID', { sourceHash, mode, reasons: parts.errors, warnings });
    const stale: string[] = [];
    if (en.translation.sourceHash !== sourceHash) stale.push('the Chinese title, description, body or experiment text changed since this translation');
    if ((en.translation.rulesVersion ?? 0) < rules) {
      stale.push(`translated under rules v${en.translation.rulesVersion}; current rules are v${rules}`);
    } else if ((en.translation.rulesVersion ?? 0) > rules) {
      return report('INVALID', { sourceHash, mode, reasons: [`translation.rulesVersion ${en.translation.rulesVersion} is newer than the current rules v${rules}`], warnings });
    }
    if (stale.length) return report('AUTO_STALE', { sourceHash, mode, reasons: [...stale, 'regenerate the English text'], warnings });
    return report('AUTO_CURRENT', { sourceHash, mode, warnings });
  }

  if (parts.errors.length) return report('INVALID', { sourceHash, mode, reasons: parts.errors, warnings });
  if (en.translation.sourceHash !== sourceHash) {
    return report('MANUAL_STALE', {
      sourceHash,
      mode,
      reasons: [
        'the Chinese text (or experiment text) changed since the English edition was last confirmed; check facts, results, contributions and the `en` text of any experiments, then `npm run translate -- confirm --note ' + id + '`',
      ],
      warnings,
    });
  }
  return report('MANUAL_CURRENT', { sourceHash, mode, warnings });
}

// ---------------------------------------------------------------- serialise

/** JSON strings are valid YAML double-quoted scalars. */
const yamlString = (s: string) => JSON.stringify(s);

/** Serialise an English file. The result parses back to the same hashes on every OS. */
export function serializeEnglish(file: EnglishFile): string {
  const t = file.translation;
  const lines = [
    '---',
    `title: ${yamlString(normalizeField(file.title))}`,
    `description: ${yamlString(normalizeField(file.description))}`,
    'translation:',
    `  mode: ${t.mode}`,
    `  sourceHash: ${yamlString(t.sourceHash)}`,
  ];
  if (t.mode === 'auto') {
    lines.push(`  generatedHash: ${yamlString(t.generatedHash!)}`, `  rulesVersion: ${t.rulesVersion}`);
  }
  lines.push('---', '', normalizeBody(file.body), '');
  return lines.join('\n');
}
