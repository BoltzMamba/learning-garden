/**
 * Whole-site concept check (filesystem). Shared by `npm run concepts:check`,
 * `npm run build` and the Astro build (src/lib/garden.ts):
 *
 *   - the registry is valid (concepts.ts)
 *   - every :concept id in every Chinese and English note exists
 *   - every concept's source note exists, and its :dfn anchor is written in
 *     the Chinese note AND in the English edition (same anchor id)
 *   - an anchor is unique in its note and does not collide with a heading id
 *
 * Whether an automatic translation kept the same references and anchors is
 * checked by the translation checker (it counts concept:<id> and dfn:<anchor>).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import GithubSlugger from 'github-slugger';
import { stripCode } from './links.ts';
import { parseRegistry, scanConceptMarkup, type Concept } from './concepts.ts';
import { parseMarkdownFile } from './translation.ts';

export const REGISTRY_FILE = 'src/data/concepts.json';
const DIRS = { zh: 'src/content/notes', en: 'src/content/notes-en' } as const;

export interface ConceptScan {
  concepts: Map<string, Concept>;
  errors: string[];
  warnings: string[];
  /** Note id → concept ids it references (Chinese source). */
  referencedBy: Map<string, string[]>;
}

function bodies(root: string, dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const full = path.join(root, dir);
  if (!existsSync(full)) return out;
  for (const name of readdirSync(full).sort()) {
    if (!name.endsWith('.md')) continue;
    try {
      out.set(name.slice(0, -3), parseMarkdownFile(readFileSync(path.join(full, name), 'utf8')).body);
    } catch {
      /* unparsable files are reported by the content and translation checks */
    }
  }
  return out;
}

/** Heading ids as Astro generates them (github-slugger, in document order). */
export function headingIds(body: string): string[] {
  const slugger = new GithubSlugger();
  return [...stripCode(body.replace(/\r\n?/g, '\n')).matchAll(/^ {0,3}#{1,6}[ \t]+(.+?)[ \t#]*$/gm)].map((m) =>
    slugger.slug(m[1].replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, '')),
  );
}

export function checkConcepts(root: string): ConceptScan {
  const errors: string[] = [];
  const registryPath = path.join(root, REGISTRY_FILE);
  let parsed = parseRegistry({});
  if (existsSync(registryPath)) {
    const text = readFileSync(registryPath, 'utf8');
    try {
      parsed = parseRegistry(JSON.parse(text), text);
    } catch (err) {
      errors.push(`${REGISTRY_FILE}: not valid JSON (${(err as Error).message})`);
    }
  }
  errors.push(...parsed.errors.map((e) => `${REGISTRY_FILE}: ${e}`));
  const { concepts, warnings } = parsed;
  const notes = { zh: bodies(root, DIRS.zh), en: bodies(root, DIRS.en) };
  const anchorsOf = { zh: new Map<string, string[]>(), en: new Map<string, string[]>() };
  const referencedBy = new Map<string, string[]>();

  for (const lang of ['zh', 'en'] as const) {
    for (const [id, body] of notes[lang]) {
      const file = `${DIRS[lang]}/${id}.md`;
      const { references, anchors } = scanConceptMarkup(body);
      for (const ref of new Set(references)) {
        if (!concepts.has(ref)) errors.push(`${file}: :concept id "${ref}" is not in ${REGISTRY_FILE}`);
      }
      if (lang === 'zh') referencedBy.set(id, [...new Set(references)]);
      const headings = new Set(headingIds(body));
      const seen = new Set<string>();
      for (const a of anchors) {
        if (seen.has(a)) errors.push(`${file}: anchor #${a} is defined more than once`);
        if (headings.has(a)) errors.push(`${file}: anchor #${a} collides with a heading id; choose another anchor`);
        seen.add(a);
      }
      anchorsOf[lang].set(id, anchors);
    }
  }

  for (const c of concepts.values()) {
    const { note, anchor } = c.source;
    const where = `${REGISTRY_FILE}: "${c.id}".source`;
    if (!notes.zh.has(note)) {
      errors.push(`${where}: note "${note}" does not exist in ${DIRS.zh}`);
      continue;
    }
    if (!anchorsOf.zh.get(note)!.includes(anchor)) {
      errors.push(`${where}: ${DIRS.zh}/${note}.md has no :dfn[…]{#${anchor}} (write it where the concept is defined)`);
    }
    if (notes.en.has(note) && !anchorsOf.en.get(note)!.includes(anchor)) {
      errors.push(`${where}: ${DIRS.en}/${note}.md has no :dfn[…]{#${anchor}}; both languages need the same anchor (manual translations are fixed by the author)`);
    }
  }
  return { concepts, errors, warnings, referencedBy };
}
