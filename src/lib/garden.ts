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

export type Note = CollectionEntry<'notes'>;
export type Question = CollectionEntry<'questions'>;

interface GardenData {
  notes: Note[];
  notesById: Map<string, Note>;
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
  /** Overview id → its member notes in reading order. */
  seriesByOverview: Map<string, Note[]>;
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

  const seriesByOverview = new Map<string, Note[]>();
  for (const n of notes) {
    if (n.data.contentType !== 'overview') continue;
    const members = seriesMembers(
      notes.map((m) => ({ id: m.id, series: m.data.series, order: m.data.order, published: m.data.published, note: m })),
      n.id,
    );
    seriesByOverview.set(n.id, members.map((m) => m.note));
  }

  const graph = buildGraph(
    notes.map((n) => ({
      id: n.id,
      title: n.data.title,
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
    notes,
    notesById: new Map(notes.map((n) => [n.id, n])),
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
    seriesByOverview,
  };
}

export function getGarden(): Promise<GardenData> {
  cache ??= load();
  return cache;
}
