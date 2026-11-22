/**
 * Controlled topic vocabulary (pure). Topics live in src/data/topics.json:
 *
 *   "ai-agent": { "zh": "AI Agent", "en": "AI Agent", "parent": "artificial-intelligence",
 *                 "aliases": ["llm-agent", "agents"] }
 *
 * Three levels at most — domain › subfield › concept — derived from `parent`.
 * A note's frontmatter `tags` may use a topic id or any alias; both resolve to
 * the one stable id, so "LLM Agent" and "AI Agent" never become two nodes.
 */
import { SLUG_RE } from './slug.ts';

export const MAX_TOPIC_DEPTH = 3;

/**
 * Optional exam frequency of a knowledge point (practice topics only). The
 * basis (CodeTop snapshot + author judgement) is documented in README.md.
 */
export const TOPIC_FREQUENCIES = ['high', 'medium', 'low'] as const;
export type TopicFrequency = (typeof TOPIC_FREQUENCIES)[number];

export interface Topic {
  id: string;
  zh: string;
  en: string;
  parent?: string;
  aliases: string[];
  frequency?: TopicFrequency;
}

export interface Vocabulary {
  topics: Map<string, Topic>;
  /** Normalised id or alias → topic id. */
  lookup: Map<string, string>;
}

/** Case-, space- and underscore-insensitive key: "LLM Agent" → "llm-agent". */
export function normalizeTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/-+/g, '-');
}

/**
 * Validate the raw JSON and build a lookup. Throws one error listing every
 * problem (unknown parent, cycles, duplicate aliases, missing names…).
 */
export function parseVocabulary(raw: unknown, file = 'src/data/topics.json'): Vocabulary {
  const errors: string[] = [];
  const topics = new Map<string, Topic>();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${file}: must be an object of topics keyed by id`);

  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const at = `${file}: topic "${id}"`;
    if (!SLUG_RE.test(id)) errors.push(`${at}: id must be lowercase letters, digits and single hyphens`);
    const v = (value ?? {}) as Record<string, unknown>;
    for (const lang of ['zh', 'en'] as const) {
      if (typeof v[lang] !== 'string' || !(v[lang] as string).trim()) errors.push(`${at}: missing "${lang}" display name`);
    }
    if (v.parent !== undefined && typeof v.parent !== 'string') errors.push(`${at}: "parent" must be a topic id`);
    if (v.aliases !== undefined && !(Array.isArray(v.aliases) && v.aliases.every((a) => typeof a === 'string' && a.trim()))) {
      errors.push(`${at}: "aliases" must be an array of non-empty strings`);
    }
    if (v.frequency !== undefined && !(TOPIC_FREQUENCIES as readonly unknown[]).includes(v.frequency)) {
      errors.push(`${at}: "frequency" must be one of ${TOPIC_FREQUENCIES.join(' | ')}`);
    }
    topics.set(id, {
      id,
      zh: String(v.zh ?? id),
      en: String(v.en ?? id),
      parent: typeof v.parent === 'string' ? v.parent : undefined,
      aliases: Array.isArray(v.aliases) ? (v.aliases as string[]) : [],
      frequency: (TOPIC_FREQUENCIES as readonly unknown[]).includes(v.frequency) ? (v.frequency as TopicFrequency) : undefined,
    });
  }

  const lookup = new Map<string, string>();
  for (const t of topics.values()) lookup.set(normalizeTag(t.id), t.id);
  for (const t of topics.values()) {
    if (t.parent !== undefined && !topics.has(t.parent)) errors.push(`${file}: topic "${t.id}": parent "${t.parent}" does not exist`);
    if (t.parent === t.id) errors.push(`${file}: topic "${t.id}": cannot be its own parent`);
    for (const alias of t.aliases) {
      const key = normalizeTag(alias);
      const owner = lookup.get(key);
      if (owner !== undefined && owner !== t.id) errors.push(`${file}: alias "${alias}" of "${t.id}" already names topic "${owner}"`);
      else lookup.set(key, t.id);
    }
  }
  // Display names resolve too ("ReAct", "大语言模型"), but never override an id or alias.
  for (const t of topics.values()) {
    for (const name of [t.en, t.zh]) {
      const key = normalizeTag(name);
      if (!lookup.has(key)) lookup.set(key, t.id);
    }
  }

  // Parent cycles and depth.
  for (const t of topics.values()) {
    const seen = [t.id];
    let cur = t.parent;
    while (cur !== undefined && topics.has(cur)) {
      if (seen.includes(cur)) {
        errors.push(`${file}: parent cycle ${[...seen, cur].join(' → ')}`);
        break;
      }
      seen.push(cur);
      cur = topics.get(cur)!.parent;
    }
    if (seen.length > MAX_TOPIC_DEPTH && cur === undefined) {
      errors.push(`${file}: topic "${t.id}" is ${seen.length} levels deep (max ${MAX_TOPIC_DEPTH}: domain › subfield › concept)`);
    }
  }

  if (errors.length) throw new Error(`Invalid topic vocabulary:\n  ${[...new Set(errors)].join('\n  ')}`);
  return { topics, lookup };
}

/** Resolve a tag (id or alias, any case) to its topic id. */
export function resolveTag(vocab: Vocabulary, raw: string): string | undefined {
  return vocab.lookup.get(normalizeTag(raw));
}

/** The topic and its ancestors, nearest first. */
export function topicAncestors(vocab: Vocabulary, id: string): string[] {
  const out: string[] = [];
  let cur = vocab.topics.get(id)?.parent;
  while (cur !== undefined && !out.includes(cur)) {
    out.push(cur);
    cur = vocab.topics.get(cur)?.parent;
  }
  return out;
}

export function topicLabel(vocab: Vocabulary, id: string, lang: 'zh' | 'en'): string {
  return vocab.topics.get(id)?.[lang] ?? id;
}
