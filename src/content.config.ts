import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { normalizeCalendarDate } from './lib/dates.ts';
import { SLUG_RE } from './lib/slug.ts';

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
    category: slug,
    tags: z.array(z.string().min(1)).default([]),
    published: calendarDate,
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

export const collections = { notes, questions };
