/**
 * Build-time data access. Loads collections + JSON records, validates
 * cross-references (the build fails on bad data) and derives activity.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getCollection, type CollectionEntry } from 'astro:content';
import reviewsJson from '../data/reviews.json';
import revisionsJson from '../data/revisions.json';
import { buildActivityEvents, groupEventsByDate, type ActivityEvent } from './activity.ts';
import topicsJson from '../data/topics.json';
import { seriesMembers, validateContent } from './content-model.ts';
import { buildGraph, type BuildResult } from './graph.ts';
import { parseVocabulary, type Vocabulary } from './topics.ts';
import { todayInTimeZone } from './dates.ts';
import {
  daysBetween,
  githubCountsByDate,
  githubSyncedThrough,
  parseGithubActivity,
  summarizeGithubActivity,
  type GithubActivity,
} from './github.ts';
import { validateReviewRecords, validateRevisionRecords, type RevisionRecord } from './records.ts';
import { localizeNotes, localizeSeries, titleLabels, type ContentLang, type LocalNote } from './bilingual.ts';
import { formatScan, scanTranslations, type TranslationScan } from './translation-check.ts';
import { checkConcepts } from './concepts-check.ts';
import type { Concept } from './concepts.ts';

/** A note's Chinese source entry: the structure of every logical note. */
export type SourceNote = CollectionEntry<'notes'>;
export type EnglishNote = CollectionEntry<'notesEn'>;
/** A note as shown on a page of one language (English text on /en/ pages). */
export type Note = LocalNote<SourceNote, EnglishNote>;
export type Question = CollectionEntry<'questions'>;

interface LanguageData {
  notes: Note[];
  notesById: Map<string, Note>;
  /** Overview id → its member notes in reading order. */
  seriesByOverview: Map<string, Note[]>;
}

interface GardenData {
  /** Chinese source entries: one per logical note. */
  sources: SourceNote[];
  /** Per-language views; same notes, same order, localised text. */
  views: Record<ContentLang, LanguageData>;
  translations: TranslationScan;
  /** Concept Registry (src/data/concepts.json), validated. */
  concepts: Map<string, Concept>;
  questions: Question[];
  publicQuestions: Question[];
  events: ActivityEvent[];
  eventsByDate: Map<string, ActivityEvent[]>;
  revisionsByNote: Map<string, RevisionRecord[]>;
  reviewDatesByNote: Map<string, string[]>;
  /** GitHub contributions per day after de-duplication (empty when unavailable). */
  github: Map<string, number>;
  githubActivity: GithubActivity | undefined;
  /** Last date the GitHub snapshot covers; later dates are "not synced", not zero. */
  githubThrough: string | undefined;
  graph: BuildResult;
  vocab: Vocabulary;
  /** Note id → resolved topic ids. */
  topicsByNote: Map<string, string[]>;
}

/**
 * Cached GitHub activity (written by `npm run github:sync`). Missing or
 * invalid data is not an error: the calendar then shows notes only.
 */
function loadGithubActivity(): GithubActivity | undefined {
  try {
    const file = path.join(process.cwd(), 'src/data/github-activity.json');
    return parseGithubActivity(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return undefined;
  }
}

let cache: Promise<GardenData> | undefined;

async function load(): Promise<GardenData> {
  const notes = (await getCollection('notes')).sort(
    (a, b) => b.data.published.localeCompare(a.data.published) || a.data.title.localeCompare(b.data.title),
  );
  const editions = new Map((await getCollection('notesEn')).map((e) => [e.id, e]));

  // Bilingual state, with the same rules as `npm run translate:check`.
  // Production builds are strict; `astro dev` only warns so drafts stay editable.
  const translations = scanTranslations(process.cwd());
  for (const n of translations.manualStale) console.warn(`[translation] ${n.id}: MANUAL_STALE — ${n.reasons[0]}`);
  if (translations.failures.length) {
    const lines = formatScan({ ...translations, notes: translations.failures }, { verbose: false });
    if (import.meta.env.DEV) {
      console.warn(['[translation] incomplete English content (a production build would fail):', ...lines].join('\n  '));
    } else {
      throw new Error(
        ['Strict bilingual publishing: these notes block the build (run `npm run translate:check`):', ...lines].join('\n  '),
      );
    }
  }
  const statuses = new Map(translations.notes.map((n) => [n.id, n.status]));

  // Concept Registry: sources, anchors and references must resolve in both languages.
  const conceptScan = checkConcepts(process.cwd());
  for (const w of conceptScan.warnings) console.warn(`[concepts] ${w}`);
  if (conceptScan.errors.length) {
    const message = ['Concept Registry problems (run `npm run concepts:check`):', ...conceptScan.errors].join('\n  ');
    if (import.meta.env.DEV) console.warn(message);
    else throw new Error(message);
  }
  const questions = (await getCollection('questions')).sort((a, b) => b.data.created.localeCompare(a.data.created));
  const reviews = validateReviewRecords(reviewsJson, 'src/data/reviews.json');
  const revisions = validateRevisionRecords(revisionsJson, 'src/data/revisions.json');

  const events = buildActivityEvents({
    notes: notes.map((n) => ({ id: n.id, title: n.data.title, published: n.data.published })),
    reviews,
    revisions,
    questions: questions.map((q) => ({
      id: q.id,
      title: q.data.title,
      noteId: q.data.note,
      status: q.data.status,
      resolvedOn: q.data.resolvedOn,
      public: q.data.public,
    })),
  });

  const revisionsByNote = new Map<string, RevisionRecord[]>();
  for (const r of revisions) revisionsByNote.set(r.noteId, [...(revisionsByNote.get(r.noteId) ?? []), r]);
  const reviewDatesByNote = new Map<string, string[]>();
  for (const r of reviews) reviewDatesByNote.set(r.noteId, [...(reviewDatesByNote.get(r.noteId) ?? []), r.date].sort());

  const githubActivity = loadGithubActivity();
  const githubThrough = githubSyncedThrough(githubActivity);
  if (githubActivity) {
    const sum = summarizeGithubActivity(githubActivity);
    console.log(
      `[github] ${sum.login} via ${sum.source}${sum.viewer ? ` (viewer ${sum.viewer})` : ''}: ` +
        `${sum.total} contributions on ${sum.nonZeroDays} days, ${sum.range?.from ?? '?'} .. ${githubThrough ?? '?'}`,
    );
    const age = githubThrough ? daysBetween(githubThrough, todayInTimeZone()) : Infinity;
    if (age > 1) console.warn(`[github] snapshot is ${age} days old; run \`npm run github:sync\` (dates after ${githubThrough} show as not synced)`);
    if (githubActivity.lastError) console.warn(`[github] last sync failed at ${githubActivity.lastError.at}: ${githubActivity.lastError.message}`);
    if (!sum.consistent) console.warn(`[github] per-day sum ${sum.total} differs from GitHub's totals ${sum.apiTotal}`);
  } else {
    console.warn('[github] no GitHub snapshot (src/data/github-activity.json missing or invalid); the calendar shows garden activity only');
  }

  // Cross-entry checks: series, related and tags. Bad references fail the build.
  const vocab = parseVocabulary(topicsJson);
  const check = validateContent(
    notes.map((n) => ({
      id: n.id,
      file: n.filePath ?? `src/content/notes/${n.id}.md`,
      title: n.data.title,
      published: n.data.published,
      contentType: n.data.contentType,
      series: n.data.series,
      order: n.data.order,
      related: n.data.related,
      tags: n.data.tags,
    })),
    vocab,
  );
  for (const w of check.warnings) console.warn(`[content] ${w}`);
  if (check.errors.length) throw new Error(['Invalid note metadata:', ...check.errors].join('\n  '));

  // Series membership and order come from the Chinese source; each language
  // view maps the same ids to its own titles.
  const seriesIds = new Map<string, string[]>();
  for (const n of notes) {
    if (n.data.contentType !== 'overview') continue;
    const members = seriesMembers(
      notes.map((m) => ({ id: m.id, series: m.data.series, order: m.data.order, published: m.data.published })),
      n.id,
    );
    seriesIds.set(n.id, members.map((m) => m.id));
  }
  const view = (lang: ContentLang): LanguageData => {
    const { notes: localized, notesById } = localizeNotes(notes, lang, editions, statuses);
    return { notes: localized, notesById, seriesByOverview: localizeSeries(seriesIds, notesById) };
  };

  const graph = buildGraph(
    notes.map((n) => ({
      id: n.id,
      title: n.data.title,
      labels: titleLabels(n, editions.get(n.id)),
      section: n.data.category,
      contentType: n.data.contentType,
      series: n.data.series,
      related: n.data.related,
      topics: check.topics.get(n.id) ?? [],
      body: n.body ?? '',
    })),
    questions.map((q) => ({ id: q.id, title: q.data.title, note: q.data.note, public: q.data.public })),
    vocab,
  );
  for (const u of graph.unresolved) console.warn(`[graph] ${u.from}: link "${u.target}" does not point to a note`);

  return {
    sources: notes,
    views: { zh: view('zh'), en: view('en') },
    translations,
    concepts: conceptScan.concepts,
    questions,
    publicQuestions: questions.filter((q) => q.data.public),
    events,
    eventsByDate: groupEventsByDate(events),
    revisionsByNote,
    reviewDatesByNote,
    github: githubCountsByDate(githubActivity),
    githubActivity,
    githubThrough,
    graph,
    vocab,
    topicsByNote: check.topics,
  };
}

export function getGarden(): Promise<GardenData> {
  cache ??= load();
  return cache;
}

/** Everything a page of one language needs: the shared garden plus that language's notes. */
export async function getGardenView(lang: ContentLang) {
  const garden = await getGarden();
  return { ...garden, ...garden.views[lang] };
}
