/**
 * Concept Registry (src/data/concepts.json): a small dictionary of technical
 * terms that several notes use. Pure validation and Markdown scanning.
 *
 *   {
 *     "llm-context": {
 *       "zh": { "term": "上下文", "aliases": ["LLM 上下文"], "definition": "…" },
 *       "en": { "term": "Context", "aliases": ["LLM context"], "definition": "…" },
 *       "source": { "note": "what-is-agent", "anchor": "llm-context" }
 *     }
 *   }
 *
 * Boundaries: a Topic (topics.json) groups notes; a Concept explains a term
 * inline; the source note holds the full explanation. Concepts are not graph
 * nodes and never create graph edges. References are explicit
 * (:concept[…]{id="…"}); nothing is ever matched by name. Aliases only help
 * authors and agents find an existing entry.
 *
 * Markdown:
 *   :concept[visible text]{id="concept-id"}   reference (label optional: defaults to the term)
 *   :dfn[defined term]{#anchor-id}             the defining instance in the source note: <dfn id>
 */
import { SLUG_RE } from './slug.ts';
import { stripCode } from './links.ts';

export const CONCEPT_LANGS = ['zh', 'en'] as const;
export type ConceptLang = (typeof CONCEPT_LANGS)[number];

export interface ConceptText {
  term: string;
  aliases: string[];
  definition: string;
}

export interface Concept {
  id: string;
  zh: ConceptText;
  en: ConceptText;
  source: { note: string; anchor: string };
}

export interface RegistryCheck {
  concepts: Map<string, Concept>;
  errors: string[];
  warnings: string[];
}

/** Soft limits: longer definitions only warn (an accurate definition may be a little longer). */
export const DEFINITION_SOFT_LIMIT: Record<ConceptLang, { chars: number; sentences: number }> = {
  zh: { chars: 80, sentences: 3 },
  en: { chars: 280, sentences: 2 },
};

const normalizeTerm = (s: string) => s.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');

/** Top-level keys of a JSON object, in order, including duplicates JSON.parse would silently drop. */
export function topLevelKeys(text: string): string[] {
  const keys: string[] = [];
  let depth = 0;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      const raw = text.slice(i, j + 1);
      if (depth === 1 && /^\s*:/.test(text.slice(j + 1))) keys.push(JSON.parse(raw));
      i = j + 1;
      continue;
    }
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') depth--;
    i++;
  }
  return keys;
}

const sentences = (s: string) => s.split(/(?<=[.!?。！？])\s*/).filter((x) => x.trim()).length;

/** Validate the registry. `rawText` (the file text) enables the duplicate-id check. */
export function parseRegistry(data: unknown, rawText?: string): RegistryCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const concepts = new Map<string, Concept>();
  if (rawText !== undefined) {
    const seen = new Set<string>();
    for (const k of topLevelKeys(rawText)) {
      if (seen.has(k)) errors.push(`"${k}": duplicate concept id (JSON keeps only the last one)`);
      seen.add(k);
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { concepts, errors: [...errors, 'the registry must be a JSON object of { "<id>": { zh, en, source } }'], warnings };
  }

  const termOwners: Record<ConceptLang, Map<string, string[]>> = { zh: new Map(), en: new Map() };
  for (const [id, raw] of Object.entries(data as Record<string, unknown>)) {
    const at = (field: string) => `"${id}".${field}`;
    const before = errors.length;
    if (!SLUG_RE.test(id)) errors.push(`"${id}": concept ids are lowercase words joined by single hyphens (e.g. llm-context)`);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push(`"${id}": must be an object with zh, en and source`);
      continue;
    }
    const r = raw as Record<string, unknown>;
    for (const key of Object.keys(r)) if (!['zh', 'en', 'source'].includes(key)) errors.push(`${at(key)}: unknown field`);

    const texts: Partial<Record<ConceptLang, ConceptText>> = {};
    for (const lang of CONCEPT_LANGS) {
      const t = r[lang];
      if (!t || typeof t !== 'object' || Array.isArray(t)) {
        errors.push(`${at(lang)}: required ({ term, definition, aliases? })`);
        continue;
      }
      const tt = t as Record<string, unknown>;
      for (const key of Object.keys(tt)) if (!['term', 'aliases', 'definition'].includes(key)) errors.push(`${at(`${lang}.${key}`)}: unknown field`);
      const term = typeof tt.term === 'string' ? tt.term.trim() : '';
      const definition = typeof tt.definition === 'string' ? tt.definition.trim() : '';
      if (!term) errors.push(`${at(`${lang}.term`)}: required, non-empty`);
      if (!definition) errors.push(`${at(`${lang}.definition`)}: required, non-empty`);
      let aliases: string[] = [];
      if (tt.aliases !== undefined) {
        if (!Array.isArray(tt.aliases) || tt.aliases.some((a) => typeof a !== 'string' || !a.trim())) {
          errors.push(`${at(`${lang}.aliases`)}: must be an array of non-empty strings`);
        } else aliases = tt.aliases.map((a: string) => a.trim());
      }
      // Within one concept: no repeated names.
      const names = [term, ...aliases].filter(Boolean);
      const dup = names.filter((n, i) => names.findIndex((m) => normalizeTerm(m) === normalizeTerm(n)) !== i);
      for (const d of new Set(dup)) errors.push(`${at(`${lang}.aliases`)}: "${d}" is listed twice (as the term or another alias)`);
      for (const n of new Set(names.map(normalizeTerm))) termOwners[lang].set(n, [...(termOwners[lang].get(n) ?? []), id]);

      const limit = DEFINITION_SOFT_LIMIT[lang];
      const length = [...definition].length;
      if (definition && (length > limit.chars || sentences(definition) > limit.sentences)) {
        warnings.push(
          `${at(`${lang}.definition`)}: ${length} characters / ${sentences(definition)} sentences; keep it a short "what is it" (the full explanation belongs in the source note)`,
        );
      }
      if (term && definition) texts[lang] = { term, aliases, definition };
    }

    const s = r.source;
    let source: Concept['source'] | undefined;
    if (!s || typeof s !== 'object' || Array.isArray(s)) errors.push(`${at('source')}: required ({ note, anchor })`);
    else {
      const ss = s as Record<string, unknown>;
      for (const key of Object.keys(ss)) if (!['note', 'anchor'].includes(key)) errors.push(`${at(`source.${key}`)}: unknown field`);
      if (typeof ss.note !== 'string' || !SLUG_RE.test(ss.note)) errors.push(`${at('source.note')}: the id of the note that explains this concept`);
      if (typeof ss.anchor !== 'string' || !SLUG_RE.test(ss.anchor)) {
        errors.push(`${at('source.anchor')}: a stable anchor id written in that note as :dfn[…]{#anchor}`);
      }
      if (typeof ss.note === 'string' && typeof ss.anchor === 'string') source = { note: ss.note, anchor: ss.anchor };
    }
    if (errors.length === before && texts.zh && texts.en && source) concepts.set(id, { id, zh: texts.zh, en: texts.en, source });
  }

  // Across concepts the same name is allowed (Context in LLMs vs. in React are
  // different concepts) but worth knowing: references must always use the id.
  for (const lang of CONCEPT_LANGS) {
    for (const [name, owners] of termOwners[lang]) {
      if (owners.length > 1) warnings.push(`${lang} name "${name}" is shared by ${owners.join(', ')}; make sure each is a distinct concept and reference them by id`);
    }
  }
  const anchors = new Map<string, string>();
  for (const c of concepts.values()) {
    const key = `${c.source.note}#${c.source.anchor}`;
    if (anchors.has(key)) errors.push(`"${c.id}".source: ${key} is already the source of "${anchors.get(key)}"; each concept needs its own anchor`);
    else anchors.set(key, c.id);
  }
  return { concepts, errors, warnings };
}

// ------------------------------------------------------------- Markdown scan

/** Label of text, [single brackets] or [[wikilinks]], then optional {attributes}. */
const DIRECTIVE_RE = /(?<![:\w]):(concept|dfn)\[((?:[^[\]\n]|\[\[[^\]\n]*\]\]|\[[^[\]\n]*\])*)\](?:\{([^}\n]*)\})?/g;

export interface ConceptUsage {
  /** Referenced concept ids, in order (repeats kept). */
  references: string[];
  /** :dfn anchors, in order (repeats kept). */
  anchors: string[];
}

/** Concept references and definition anchors written in a note body (code and math ignored). */
export function scanConceptMarkup(body: string): ConceptUsage {
  const prose = stripCode(body.replace(/\r\n?/g, '\n'))
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\$[^$\n]+\$/g, ' ');
  const references: string[] = [];
  const anchors: string[] = [];
  for (const m of prose.matchAll(DIRECTIVE_RE)) {
    const attrs = m[3] ?? '';
    if (m[1] === 'concept') references.push(/(?:^|\s)id\s*=\s*["']?([^"'\s}]+)/.exec(attrs)?.[1] ?? '');
    else anchors.push(/(?:^|\s)#([^\s"'.#}]+)/.exec(attrs)?.[1] ?? /(?:^|\s)id\s*=\s*["']?([^"'\s}]+)/.exec(attrs)?.[1] ?? '');
  }
  return { references, anchors };
}
