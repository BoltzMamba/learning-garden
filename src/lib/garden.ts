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
import { buildGraph, type BuildResult } from './graph.ts';
import { githubCountsByDate, parseGithubActivity, type GithubActivity } from './github.ts';
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
  graph: BuildResult;
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
  const graph = buildGraph(
    notes.map((n) => ({ id: n.id, title: n.data.title, tags: n.data.tags, body: n.body ?? '' })),
    questions.map((q) => ({ id: q.id, title: q.data.title, note: q.data.note, public: q.data.public })),
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
    graph,
  };
}

export function getGarden(): Promise<GardenData> {
  cache ??= load();
  return cache;
}
