/**
 * Cross-entry rules for notes (pure). The Zod schema checks each file on its
 * own; this checks what needs the whole collection:
 *
 *   series   must name an existing `overview`; overviews cannot be in a series
 *   related  must name existing notes; no self-references or duplicates
 *   tags     must resolve to a topic in the controlled vocabulary
 *
 * Every problem is reported with its file, field and offending value.
 */
import { resolveTag, type Vocabulary } from './topics.ts';

export const CONTENT_TYPES = ['overview', 'note'] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export interface ContentEntry {
  id: string;
  /** For messages, e.g. src/content/notes/foo.md */
  file: string;
  title: string;
  published: string;
  contentType: string;
  series?: string;
  order?: number;
  related: readonly string[];
  tags: readonly string[];
}

export interface ContentCheck {
  errors: string[];
  warnings: string[];
  /** Note id → resolved topic ids (deduplicated, in frontmatter order). */
  topics: Map<string, string[]>;
}

export function validateContent(entries: readonly ContentEntry[], vocab: Vocabulary): ContentCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const topics = new Map<string, string[]>();
  const byId = new Map(entries.map((e) => [e.id, e]));

  for (const e of entries) {
    const at = (field: string) => `${e.file}: ${field}`;

    if (!(CONTENT_TYPES as readonly string[]).includes(e.contentType)) {
      errors.push(`${at('contentType')}: "${e.contentType}" is not one of ${CONTENT_TYPES.join(' | ')}`);
    }

    if (e.series !== undefined) {
      const target = byId.get(e.series);
      if (e.series === e.id) errors.push(`${at('series')}: a note cannot belong to itself`);
      else if (!target) errors.push(`${at('series')}: "${e.series}" does not exist (expected the id of an overview note)`);
      else if (target.contentType !== 'overview') {
        errors.push(`${at('series')}: "${e.series}" is a ${target.contentType}, not an overview`);
      }
      if (e.contentType === 'overview') {
        errors.push(`${at('series')}: an overview cannot belong to another series (nested series are not supported)`);
      }
    } else if (e.order !== undefined) {
      warnings.push(`${at('order')}: ignored because the note has no series`);
    }
    if (e.order !== undefined && !Number.isFinite(e.order)) errors.push(`${at('order')}: must be a finite number`);

    const seen = new Set<string>();
    for (const r of e.related) {
      if (r === e.id) errors.push(`${at('related')}: "${r}" is the note itself`);
      else if (!byId.has(r)) errors.push(`${at('related')}: "${r}" does not exist`);
      if (seen.has(r)) errors.push(`${at('related')}: "${r}" is listed more than once`);
      seen.add(r);
    }

    const resolved: string[] = [];
    for (const tag of e.tags) {
      const id = resolveTag(vocab, tag);
      if (id === undefined) {
        errors.push(`${at('tags')}: "${tag}" is not in the topic vocabulary (add it, or an alias, to src/data/topics.json)`);
      } else if (!resolved.includes(id)) resolved.push(id);
    }
    topics.set(e.id, resolved);
  }
  return { errors, warnings, topics };
}

/**
 * Members of a series in reading order: `order` ascending (notes without one
 * come after those with one), then published date, then id — so the order is
 * stable even when values tie or are missing.
 */
export function seriesMembers<T extends Pick<ContentEntry, 'id' | 'series' | 'order' | 'published'>>(
  entries: readonly T[],
  overviewId: string,
): T[] {
  return entries
    .filter((e) => e.series === overviewId)
    .sort((a, b) => {
      const ao = a.order ?? Infinity;
      const bo = b.order ?? Infinity;
      if (ao !== bo) return ao < bo ? -1 : 1;
      return a.published.localeCompare(b.published) || a.id.localeCompare(b.id);
    });
}
