/**
 * Learning Experiments (pure). A knowledge note may register hands-on
 * experiments in its Chinese frontmatter (`experiments:`); the note is the
 * one authoritative place for an experiment's id, status, bilingual text and
 * requirements. A finished experiment may get its own project article
 * (`category: projects`, `projectTier: experiment`, `experimentId`,
 * `sourceNote`), which reuses that data instead of repeating it.
 *
 *   - Each experiment entry is checked on its own by `experimentSchema`.
 *   - `validateExperiments` checks what needs the whole collection: unique
 *     ids, project ↔ experiment ↔ source note links, publishing rules.
 *   - The remaining helpers decide what a page shows; pages only render.
 *
 * `public` is a display filter only: the repository is public.
 */
import { z } from 'astro/zod';
import { isValidSlug, SLUG_RE } from './slug.ts';

export const EXPERIMENT_STATUSES = ['planned', 'in-progress', 'completed'] as const;
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];

/** Controlled experiment categories (labels live in src/i18n/ui.ts). Not topics. */
export const EXPERIMENT_CATEGORIES = ['agent-learning', 'ai-fundamentals', 'algorithms', 'ai-engineering'] as const;
export type ExperimentCategory = (typeof EXPERIMENT_CATEGORIES)[number];

/** Kinds of result links (labels live in src/i18n/ui.ts). */
export const EXPERIMENT_LINK_KINDS = ['code', 'demo', 'result'] as const;
export type ExperimentLinkKind = (typeof EXPERIMENT_LINK_KINDS)[number];

/** Projects page tiers. A project article without `projectTier` is featured. */
export const PROJECT_TIERS = ['featured', 'experiment'] as const;
export type ProjectTier = (typeof PROJECT_TIERS)[number];

/** Requirements shown on a card before the rest folds into "show all". */
export const REQUIREMENTS_PREVIEW = 4;

export type Lang = 'zh' | 'en';

// ------------------------------------------------------------------ schema

const text = z.string().trim().min(1, 'must not be empty');
/** User-visible experiment text: both languages are required, never filled from the other. */
const bilingual = z.strictObject({ zh: text, en: text });

export const experimentSchema = z.strictObject({
  id: z.string().regex(SLUG_RE, 'must be lowercase letters, digits and single hyphens').max(80),
  category: z.enum(EXPERIMENT_CATEGORIES),
  status: z.enum(EXPERIMENT_STATUSES),
  /** Build-time display filter. NOT a privacy mechanism: the repo is public. */
  public: z.boolean(),
  title: bilingual,
  description: bilingual,
  requirements: z.array(bilingual).min(1, 'list at least one requirement'),
  links: z
    .array(
      z.strictObject({
        kind: z.enum(EXPERIMENT_LINK_KINDS),
        url: z.url({ protocol: /^https?$/, message: 'must be an absolute http(s) URL' }),
        label: bilingual.optional(),
      }),
    )
    .default([]),
});

export type Bilingual = z.infer<typeof bilingual>;
export type Experiment = z.infer<typeof experimentSchema>;
export type ExperimentLink = Experiment['links'][number];

// -------------------------------------------------------------- validation

export interface ExperimentNoteInput {
  id: string;
  /** For messages, e.g. src/content/notes/foo.md */
  file: string;
  section: string;
  experiments: readonly Experiment[];
  projectTier?: ProjectTier;
  experimentId?: string;
  sourceNote?: string;
}

/** An experiment with the note that defines it and, if any, its project article. */
export interface ResolvedExperiment extends Experiment {
  noteId: string;
  projectId?: string;
}

export interface ExperimentIndex {
  errors: string[];
  warnings: string[];
  /** All experiments (public or not), in note order then frontmatter order. */
  all: ResolvedExperiment[];
  byId: Map<string, ResolvedExperiment>;
  /** Project article id → the experiment it documents. */
  byProject: Map<string, ResolvedExperiment>;
}

export function validateExperiments(entries: readonly ExperimentNoteInput[]): ExperimentIndex {
  const errors: string[] = [];
  const warnings: string[] = [];
  const all: ResolvedExperiment[] = [];
  const byId = new Map<string, ResolvedExperiment>();
  const byProject = new Map<string, ResolvedExperiment>();
  const notes = new Map(entries.map((e) => [e.id, e]));

  // 1. Definitions: ids are global and stable.
  for (const note of entries) {
    if (note.experiments.length && note.section === 'projects') {
      errors.push(
        `${note.file}: experiments: a project article cannot define experiments; register them in the knowledge note they test and link the article with experimentId + sourceNote`,
      );
      continue;
    }
    note.experiments.forEach((exp, i) => {
      const at = `${note.file}: experiments[${i}]`;
      if (!isValidSlug(exp.id)) errors.push(`${at}.id: "${exp.id}" must be lowercase letters, digits and single hyphens`);
      if (!(EXPERIMENT_CATEGORIES as readonly string[]).includes(exp.category)) {
        errors.push(`${at}.category: "${exp.category}" is not one of ${EXPERIMENT_CATEGORIES.join(' | ')}`);
      }
      if (!(EXPERIMENT_STATUSES as readonly string[]).includes(exp.status)) {
        errors.push(`${at}.status: "${exp.status}" is not one of ${EXPERIMENT_STATUSES.join(' | ')}`);
      }
      if (!exp.requirements.length) errors.push(`${at}.requirements: list at least one requirement`);
      for (const [field, value] of [['title', exp.title], ['description', exp.description], ...exp.requirements.map((r, j) => [`requirements[${j}]`, r] as const)] as const) {
        for (const lang of ['zh', 'en'] as const) {
          if (!value?.[lang]?.trim()) errors.push(`${at}.${field}.${lang}: required, non-empty`);
        }
      }
      if (exp.status === 'planned' && exp.links.length) {
        errors.push(`${at}.links: a planned experiment has no results yet; set status to in-progress or completed first`);
      }
      for (const [j, link] of exp.links.entries()) {
        if (!/^https?:\/\/[^\s/]+/.test(link.url)) errors.push(`${at}.links[${j}].url: "${link.url}" must be an absolute http(s) URL`);
      }
      const previous = byId.get(exp.id);
      if (previous) {
        errors.push(
          previous.noteId === note.id
            ? `${at}.id: "${exp.id}" is listed more than once in this note`
            : `${at}.id: "${exp.id}" is already defined in ${notes.get(previous.noteId)?.file ?? previous.noteId}; experiment ids are global`,
        );
        return;
      }
      const resolved: ResolvedExperiment = { ...exp, noteId: note.id };
      byId.set(exp.id, resolved);
      all.push(resolved);
    });
  }

  // 2. Project articles: tier and the link back to one experiment.
  for (const note of entries) {
    const at = (field: string) => `${note.file}: ${field}`;
    const isProject = note.section === 'projects';
    if (!isProject) {
      for (const field of ['projectTier', 'experimentId', 'sourceNote'] as const) {
        if (note[field] !== undefined) errors.push(`${at(field)}: only project articles (category: projects) use this field`);
      }
      continue;
    }
    const linked = note.experimentId !== undefined || note.sourceNote !== undefined;
    if (note.projectTier !== 'experiment') {
      if (linked) errors.push(`${at('experimentId')}: a ${note.projectTier ?? 'featured'} project cannot document an experiment; set projectTier: experiment, or remove experimentId and sourceNote`);
      continue;
    }
    if (note.experimentId === undefined || note.sourceNote === undefined) {
      errors.push(`${at('projectTier')}: an experiment project needs both experimentId and sourceNote`);
      continue;
    }
    if (note.sourceNote === note.id) {
      errors.push(`${at('sourceNote')}: "${note.sourceNote}" is the project article itself; name the knowledge note that defines the experiment`);
      continue;
    }
    if (!notes.has(note.sourceNote)) {
      errors.push(`${at('sourceNote')}: "${note.sourceNote}" does not exist`);
      continue;
    }
    const exp = byId.get(note.experimentId);
    if (!exp) {
      errors.push(`${at('experimentId')}: "${note.experimentId}" is not defined in any note's experiments`);
      continue;
    }
    if (exp.noteId !== note.sourceNote) {
      errors.push(`${at('sourceNote')}: experiment "${exp.id}" is defined in "${exp.noteId}", not "${note.sourceNote}"`);
      continue;
    }
    if (exp.projectId !== undefined) {
      errors.push(`${at('experimentId')}: experiment "${exp.id}" already has the project article "${exp.projectId}"; one experiment has at most one article`);
      continue;
    }
    if (!exp.public) {
      errors.push(`${at('experimentId')}: experiment "${exp.id}" is not public, but this project article is published; set public: true or remove the article`);
      continue;
    }
    if (exp.status !== 'completed') {
      warnings.push(`${at('experimentId')}: experiment "${exp.id}" is ${exp.status}; this article stays an unpublished draft until the experiment is completed`);
    }
    exp.projectId = note.id;
    byProject.set(note.id, exp);
  }

  for (const exp of all) {
    if (exp.public && exp.status === 'completed' && !isShowcased(exp)) {
      warnings.push(`experiment "${exp.id}" (${exp.noteId}) is completed but has no links and no project article, so it is not listed under More Experiments`);
    }
  }
  return { errors, warnings, all, byId, byProject };
}

// ------------------------------------------------------------ what to show

/**
 * Experiment write-ups publish with their experiment: a project article with
 * `projectTier: experiment` stays an unpublished draft (no page, no list
 * entry, no graph node, no calendar event, no strict translation check) until
 * the experiment it names is `completed`. The experiment's card on its note is
 * public on its own terms (`public`).
 *
 * Works on raw frontmatter (the translate CLI) and on parsed entries (the
 * build) alike. An article naming an unknown experiment is not a draft, so
 * validation reports it instead of hiding it.
 */
export function unpublishedProjectIds(notes: Iterable<{ id: string; data: Record<string, unknown> }>): Set<string> {
  const list = [...notes];
  const status = new Map<string, unknown>();
  for (const n of list) {
    if (!Array.isArray(n.data.experiments)) continue;
    for (const e of n.data.experiments) if (e && typeof e === 'object' && 'id' in e) status.set(String(e.id), (e as { status?: unknown }).status);
  }
  const drafts = new Set<string>();
  for (const n of list) {
    const { category, projectTier, experimentId } = n.data;
    if (category !== 'projects' || projectTier !== 'experiment' || typeof experimentId !== 'string') continue;
    if (status.has(experimentId) && status.get(experimentId) !== 'completed') drafts.add(n.id);
  }
  return drafts;
}

/** Projects page tier of a project article; articles without a tier stay featured. */
export function projectTierOf(note: { projectTier?: ProjectTier }): ProjectTier {
  return note.projectTier ?? 'featured';
}

/** Public experiments defined in one note, in frontmatter order (cards under the note). */
export function noteExperiments(index: Pick<ExperimentIndex, 'all'>, noteId: string): ResolvedExperiment[] {
  return index.all.filter((e) => e.noteId === noteId && e.public);
}

/** Listed under Projects → More Experiments: completed, public, with a visible result. */
export function isShowcased(exp: ResolvedExperiment): boolean {
  return exp.public && exp.status === 'completed' && (exp.links.length > 0 || exp.projectId !== undefined);
}

export function showcasedExperiments(index: Pick<ExperimentIndex, 'all'>, category?: ExperimentCategory): ResolvedExperiment[] {
  return index.all.filter((e) => isShowcased(e) && (category === undefined || e.category === category));
}

export interface LocalExperiment {
  id: string;
  category: ExperimentCategory;
  status: ExperimentStatus;
  noteId: string;
  projectId?: string;
  title: string;
  description: string;
  /** First requirements, always visible. */
  requirements: string[];
  /** The rest, folded on cards. */
  moreRequirements: string[];
  links: { kind: ExperimentLinkKind; url: string; label?: string }[];
}

/** Text in one language only: English pages never show Chinese experiment text. */
export function localizeExperiment(exp: ResolvedExperiment, lang: Lang, preview = REQUIREMENTS_PREVIEW): LocalExperiment {
  const reqs = exp.requirements.map((r) => r[lang]);
  return {
    id: exp.id,
    category: exp.category,
    status: exp.status,
    noteId: exp.noteId,
    // The write-up is published only once the experiment is completed.
    projectId: exp.status === 'completed' ? exp.projectId : undefined,
    title: exp.title[lang],
    description: exp.description[lang],
    requirements: reqs.slice(0, preview),
    moreRequirements: reqs.slice(preview),
    // Results only once work has started (planned experiments never link anywhere).
    links: exp.status === 'planned' ? [] : exp.links.map((l) => ({ kind: l.kind, url: l.url, label: l.label?.[lang] })),
  };
}

// ------------------------------------------------------ translation tracking

/**
 * The Chinese experiment text that an English reader also sees (title,
 * description, requirements), from raw frontmatter. Part of the translation
 * source hash, so changing it marks the note's English edition stale and the
 * matching `en` text gets reviewed. Status, links and `public` are structure
 * and do not count. Tolerant of malformed input: the schema reports that.
 */
export function experimentSourceText(raw: unknown): string[][] {
  if (!Array.isArray(raw)) return [];
  const zh = (v: unknown) => (v && typeof v === 'object' && typeof (v as Bilingual).zh === 'string' ? (v as Bilingual).zh.trim() : '');
  return raw
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    .map((e) => [
      String(e.id ?? ''),
      zh(e.title),
      zh(e.description),
      ...(Array.isArray(e.requirements) ? e.requirements.map(zh) : []),
    ]);
}
