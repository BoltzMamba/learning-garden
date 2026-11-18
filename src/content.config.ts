import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { normalizeCalendarDate } from './lib/dates.ts';
import { SLUG_RE } from './lib/slug.ts';
import { LEGACY_CATEGORIES, SECTIONS, toSection } from './lib/sections.ts';
import { CONTENT_TYPES } from './lib/content-model.ts';
import { TRANSLATION_MODES } from './lib/translation.ts';
import { experimentSchema, PROJECT_TIERS } from './lib/experiments.ts';

/** `YYYY-MM-DD`; tolerates YAML auto-dates without timezone shifts. */
const calendarDate = z.union([z.string(), z.date()]).transform((value, ctx) => {
  try {
    return normalizeCalendarDate(value);
  } catch (err) {
    ctx.addIssue({ code: 'custom', message: (err as Error).message });
    return z.NEVER;
  }
});

const slug = z.string().regex(SLUG_RE, 'must be lowercase letters, digits and single hyphens');

/** The file name (without extension) is the one and only id. */
const idFromFileName = ({ entry }: { entry: string }) => entry.replace(/\.mdx?$/, '');

const notes = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/notes', generateId: idFromFileName }),
  schema: z.object({
    title: z.string().min(1),
    description: z.string().min(1),
    /** Section: guide | practice | knowledge | projects (legacy category slugs are mapped). */
    category: slug.transform((value, ctx) => {
      const section = toSection(value);
      if (section) return section;
      ctx.addIssue({
        code: 'custom',
        message: `"${value}" is not a section; use one of ${SECTIONS.join(', ')} (legacy: ${Object.keys(LEGACY_CATEGORIES).join(', ')})`,
      });
      return z.NEVER;
    }),
    /** Topic ids or aliases from src/data/topics.json (checked in src/lib/garden.ts). */
    tags: z.array(z.string().min(1)).default([]),
    published: calendarDate,
    /** `overview` = a series' landing note; `note` = an ordinary article. */
    contentType: z.enum(CONTENT_TYPES).default('note'),
    /** Id of the overview this note belongs to (at most one series). */
    series: slug.optional(),
    /** Position within the series; gaps are fine (10, 20, 30). */
    order: z.number().optional(),
    /** Ids of notes the author has confirmed as related (undirected). */
    related: z.array(slug).default([]),
    /**
     * Hands-on experiments for this note (src/lib/experiments.ts). Optional;
     * ids, links and project articles are cross-checked there.
     */
    experiments: z.array(experimentSchema).default([]),
    /** Projects only: `featured` (default) or `experiment`. */
    projectTier: z.enum(PROJECT_TIERS).optional(),
    /** Experiment projects only: the experiment this article documents … */
    experimentId: slug.optional(),
    /** … and the note that defines it. */
    sourceNote: slug.optional(),
  }),
});

/**
 * English editions of notes: same file name (= logical id) as the Chinese
 * source, language only. Structure (section, tags, series, related, dates)
 * always comes from src/content/notes. The translation block is checked in
 * depth by src/lib/translation.ts (`npm run translate:check`); this schema only
 * keeps the build from rendering something unusable.
 */
const notesEn = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/notes-en', generateId: idFromFileName }),
  schema: z.object({
    title: z.string().min(1),
    description: z.string().min(1),
    translation: z.looseObject({ mode: z.enum(TRANSLATION_MODES) }),
  }),
});

const questions = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/questions', generateId: idFromFileName }),
  schema: z
    .object({
      title: z.string().min(1),
      /** Related note id (file name in src/content/notes). */
      note: slug.optional(),
      status: z.enum(['open', 'resolved']),
      /** Build-time display filter only. NOT a privacy mechanism: the repo is public. */
      public: z.boolean(),
      created: calendarDate,
      resolvedOn: calendarDate.optional(),
      description: z.string().min(1),
      sources: z.array(z.object({ title: z.string().min(1), url: z.url() })).default([]),
    })
    .superRefine((q, ctx) => {
      if (q.status === 'resolved' && !q.resolvedOn) {
        ctx.addIssue({ code: 'custom', path: ['resolvedOn'], message: 'resolved questions need resolvedOn' });
      }
      if (q.status === 'open' && q.resolvedOn) {
        ctx.addIssue({ code: 'custom', path: ['resolvedOn'], message: 'open questions must not have resolvedOn' });
      }
    }),
});

export const collections = { notes, notesEn, questions };
