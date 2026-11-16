/**
 * Learning Garden CLI — offline, deterministic, no API keys.
 *
 *   npm run garden -- new       create a note
 *   npm run garden -- review    record a review (one per note per day)
 *   npm run garden -- revise    record a meaningful revision
 *   npm run garden -- question  create a question
 *   npm run garden -- list      list notes
 *
 * Every prompt can also be given as a flag (see `npm run garden -- help`).
 * Set GARDEN_ROOT to operate on another checkout (used by tests).
 */
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface, type Interface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { CALENDAR_TIMEZONE, isValidCalendarDate, todayInTimeZone } from '../src/lib/dates.ts';
import {
  appendRevision,
  MASTERY_MAX,
  MASTERY_MIN,
  MASTERY_SCALE,
  upsertReview,
  validateReviewRecords,
  validateRevisionRecords,
  type ReviewRecord,
  type RevisionRecord,
} from '../src/lib/records.ts';
import { isValidSlug, slugify } from '../src/lib/slug.ts';

const ROOT = process.env.GARDEN_ROOT
  ? path.resolve(process.env.GARDEN_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOTES_DIR = path.join(ROOT, 'src/content/notes');
const QUESTIONS_DIR = path.join(ROOT, 'src/content/questions');
const REVIEWS_FILE = path.join(ROOT, 'src/data/reviews.json');
const REVISIONS_FILE = path.join(ROOT, 'src/data/revisions.json');
const CATEGORIES_FILE = path.join(ROOT, 'src/data/categories.json');

class UserError extends Error {}

// ---------------------------------------------------------------- utilities

const rel = (p: string) => path.relative(ROOT, p).replace(/\\/g, '/');

/** Write via temp file + rename so a crash never leaves a half-written file. */
async function writeFileAtomic(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    await writeFile(tmp, content, 'utf8');
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

async function readJsonArray(file: string): Promise<unknown[]> {
  if (!existsSync(file)) return [];
  const text = await readFile(file, 'utf8');
  try {
    const data = JSON.parse(text);
    if (!Array.isArray(data)) throw new Error('not an array');
    return data;
  } catch (err) {
    throw new UserError(`${rel(file)} is not a valid JSON array (${(err as Error).message}). Fix it before continuing; nothing was written.`);
  }
}

const toJson = (data: unknown) => `${JSON.stringify(data, null, 2)}\n`;
/** JSON strings are valid YAML double-quoted scalars, so this is safe frontmatter. */
const yamlString = (s: string) => JSON.stringify(s);

interface NoteSummary {
  id: string;
  title: string;
  published: string;
  category: string;
}

function frontmatterValue(frontmatter: string, key: string): string | undefined {
  const m = new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(frontmatter);
  if (!m) return undefined;
  const raw = m[1].trim();
  if (raw.startsWith('"')) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw.slice(1, -1);
    }
  }
  if (raw.startsWith("'")) return raw.slice(1, -1).replace(/''/g, "'");
  return raw;
}

async function loadNotes(): Promise<NoteSummary[]> {
  if (!existsSync(NOTES_DIR)) return [];
  const files = (await readdir(NOTES_DIR)).filter((f) => f.endsWith('.md'));
  const notes: NoteSummary[] = [];
  for (const file of files) {
    const text = await readFile(path.join(NOTES_DIR, file), 'utf8');
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
    notes.push({
      id: file.replace(/\.md$/, ''),
      title: frontmatterValue(fm, 'title') ?? file,
      published: frontmatterValue(fm, 'published') ?? '',
      category: frontmatterValue(fm, 'category') ?? '',
    });
  }
  return notes.sort((a, b) => b.published.localeCompare(a.published) || a.id.localeCompare(b.id));
}

// ------------------------------------------------------------------ prompts

class Prompter {
  private rl: Interface | undefined;
  readonly interactive = Boolean(process.stdin.isTTY);

  async ask(question: string, opts: { flag: string; default?: string; allowEmpty?: boolean } = { flag: '' }): Promise<string> {
    if (!this.interactive) {
      if (opts.default !== undefined) return opts.default;
      if (opts.allowEmpty) return '';
      throw new UserError(`Missing --${opts.flag} (no interactive terminal available).`);
    }
    this.rl ??= createInterface({ input: process.stdin, output: process.stdout });
    const suffix = opts.default ? ` [${opts.default}]` : '';
    const answer = (await this.rl.question(`${question}${suffix}: `)).trim();
    return answer || opts.default || '';
  }

  /** Ask until `validate` returns null (valid) or an error message. */
  async askValid(
    question: string,
    flagValue: string | undefined,
    validate: (v: string) => string | null,
    opts: { flag: string; default?: string; allowEmpty?: boolean },
  ): Promise<string> {
    if (flagValue !== undefined) {
      const err = validate(flagValue.trim());
      if (err) throw new UserError(`--${opts.flag}: ${err}`);
      return flagValue.trim();
    }
    for (;;) {
      const value = await this.ask(question, opts);
      const err = validate(value);
      if (!err) return value;
      if (!this.interactive) throw new UserError(`--${opts.flag}: ${err}`);
      console.log(`  ✗ ${err}`);
    }
  }

  close() {
    this.rl?.close();
  }
}

// ---------------------------------------------------------------- validators

const required = (label: string, max = 200) => (v: string) =>
  !v ? `${label} is required` : v.length > max ? `${label} must be at most ${max} characters` : null;

function pastOrTodayDate(today: string) {
  return (v: string) => {
    if (!isValidCalendarDate(v)) return 'date must be a real calendar date in YYYY-MM-DD format';
    if (v > today) return `date ${v} is in the future (today in ${CALENDAR_TIMEZONE} is ${today})`;
    return null;
  };
}

async function selectNote(prompter: Prompter, flagValue: string | undefined): Promise<NoteSummary> {
  const notes = await loadNotes();
  if (!notes.length) throw new UserError('No notes found. Create one with: npm run garden -- new');
  const find = (v: string) => notes.find((n) => n.id === v) ?? (/^\d+$/.test(v) ? notes[Number(v) - 1] : undefined);
  if (flagValue === undefined && prompter.interactive) {
    console.log('\nNotes (most recent first):');
    notes.forEach((n, i) => console.log(`  ${String(i + 1).padStart(3)}. ${n.id}  ${n.title}`));
  }
  const value = await prompter.askValid(
    'Note (number or slug)',
    flagValue,
    (v) => (find(v) ? null : `unknown note "${v}" (run: npm run garden -- list)`),
    { flag: 'note' },
  );
  return find(value)!;
}

// ------------------------------------------------------------------ commands

async function cmdNew(flags: Flags, prompter: Prompter) {
  const today = todayInTimeZone();
  const existing = new Set((await loadNotes()).map((n) => n.id.toLowerCase()));

  const title = await prompter.askValid('Title', flags.title, required('title'), { flag: 'title' });
  const suggested = slugify(title);
  const slug = await prompter.askValid(
    suggested ? 'Slug' : 'Slug (the title has no Latin letters, so choose one, e.g. react-agent-loop)',
    flags.slug,
    (v) => {
      if (!isValidSlug(v)) return 'slug must use lowercase a-z, 0-9 and single hyphens (max 80 chars)';
      if (existing.has(v.toLowerCase())) return `a note with slug "${v}" already exists`;
      return null;
    },
    { flag: 'slug', default: suggested || undefined },
  );

  const categories = new Set<string>();
  if (existsSync(CATEGORIES_FILE)) Object.keys(JSON.parse(await readFile(CATEGORIES_FILE, 'utf8'))).forEach((c) => categories.add(c));
  (await loadNotes()).forEach((n) => n.category && categories.add(n.category));
  if (flags.category === undefined && prompter.interactive && categories.size) {
    console.log(`Existing categories: ${[...categories].sort().join(', ')}`);
  }
  const category = await prompter.askValid(
    'Category (slug)',
    flags.category,
    (v) => (isValidSlug(v) ? null : 'category must be a slug, e.g. ai-agents'),
    { flag: 'category' },
  );
  if (!categories.has(category)) {
    console.log(`  ℹ New category "${category}". Optionally add display names in ${rel(CATEGORIES_FILE)}.`);
  }

  const tagsRaw = flags.tags ?? (await prompter.ask('Tags (comma-separated, optional)', { flag: 'tags', allowEmpty: true }));
  const tags = [...new Set(tagsRaw.split(/[,，]/).map((t) => t.trim()).filter(Boolean))];
  const description = await prompter.askValid('One-line description', flags.description, required('description', 300), {
    flag: 'description',
  });
  const published = await prompter.askValid('Published date', flags.date, pastOrTodayDate(today), {
    flag: 'date',
    default: today,
  });

  const file = path.join(NOTES_DIR, `${slug}.md`);
  const content = [
    '---',
    `title: ${yamlString(title)}`,
    `description: ${yamlString(description)}`,
    `category: ${yamlString(category)}`,
    `tags: ${JSON.stringify(tags)}`,
    `published: ${yamlString(published)}`,
    '---',
    '',
    '## 要点',
    '',
    '',
  ].join('\n');
  await mkdir(NOTES_DIR, { recursive: true });
  try {
    await writeFile(file, content, { encoding: 'utf8', flag: 'wx' }); // never overwrite
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw new UserError(`${rel(file)} already exists`);
    throw err;
  }
  console.log(`✓ Created ${rel(file)} (published ${published})`);
  console.log('  Write the body, then commit and push to publish.');
}

async function cmdReview(flags: Flags, prompter: Prompter) {
  const today = todayInTimeZone();
  // Validate existing data first so we never write on top of a broken file.
  const reviews = validateReviewRecords(await readJsonArray(REVIEWS_FILE), rel(REVIEWS_FILE));
  const note = await selectNote(prompter, flags.note);
  const date = await prompter.askValid('Review date', flags.date, pastOrTodayDate(today), { flag: 'date', default: today });
  if (note.published && date < note.published) {
    console.log(`  ℹ ${date} is before the note's published date (${note.published}).`);
  }

  if (flags.mastery === undefined && prompter.interactive) {
    console.log('\nMastery scale:');
    for (let m = MASTERY_MIN; m <= MASTERY_MAX; m++) console.log(`  ${m} — ${MASTERY_SCALE[m].en} / ${MASTERY_SCALE[m].zh}`);
  }
  const mastery = Number(
    await prompter.askValid(
      `Mastery (${MASTERY_MIN}-${MASTERY_MAX})`,
      flags.mastery,
      (v) => (/^[1-5]$/.test(v) ? null : `mastery must be an integer from ${MASTERY_MIN} to ${MASTERY_MAX}`),
      { flag: 'mastery' },
    ),
  );
  const reflection = await prompter.askValid('Short reflection', flags.reflection, required('reflection', 500), {
    flag: 'reflection',
  });

  const previous = reviews.find((r) => r.noteId === note.id && r.date === date);
  const record: ReviewRecord = { noteId: note.id, date, mastery, reflection };
  const { reviews: next, action } = upsertReview(reviews, record);
  await writeFileAtomic(REVIEWS_FILE, toJson(next));

  if (action === 'updated') {
    console.log(`✓ Updated the existing review of "${note.id}" on ${date} (one review per note per day).`);
    console.log(`  mastery ${previous!.mastery} → ${mastery}`);
  } else {
    console.log(`✓ Recorded review of "${note.id}" on ${date} (mastery ${mastery}).`);
  }
  console.log(`  Note: ${rel(REVIEWS_FILE)} is public in the repository, including the reflection text.`);
}

async function cmdRevise(flags: Flags, prompter: Prompter) {
  const today = todayInTimeZone();
  const revisions: RevisionRecord[] = validateRevisionRecords(await readJsonArray(REVISIONS_FILE), rel(REVISIONS_FILE));
  const note = await selectNote(prompter, flags.note);
  const date = await prompter.askValid('Revision date', flags.date, pastOrTodayDate(today), {
    flag: 'date',
    default: today,
  });
  const summary = await prompter.askValid(
    'What meaningfully changed? (not typos/formatting)',
    flags.summary,
    required('summary', 300),
    { flag: 'summary' },
  );
  const next = appendRevision(revisions, { noteId: note.id, date, summary });
  const added = next.find((r) => !revisions.some((old) => old.id === r.id))!;
  await writeFileAtomic(REVISIONS_FILE, toJson(next));
  console.log(`✓ Recorded revision ${added.id}`);
}

async function cmdQuestion(flags: Flags, prompter: Prompter) {
  const today = todayInTimeZone();
  const notes = await loadNotes();
  const title = await prompter.askValid('Question title', flags.title, required('title'), { flag: 'title' });
  const suggested = slugify(title);
  const id = await prompter.askValid(
    'Question id (slug)',
    flags.slug,
    (v) => {
      if (!isValidSlug(v)) return 'id must use lowercase a-z, 0-9 and single hyphens';
      if (existsSync(path.join(QUESTIONS_DIR, `${v}.md`))) return `question "${v}" already exists`;
      return null;
    },
    { flag: 'slug', default: suggested || undefined },
  );
  const noteId = await prompter.askValid(
    'Related note slug (optional)',
    flags.note,
    (v) => (!v || notes.some((n) => n.id === v) ? null : `unknown note "${v}"`),
    { flag: 'note', allowEmpty: true },
  );
  const description = await prompter.askValid('Describe the question', flags.description, required('description', 1000), {
    flag: 'description',
  });
  const visibility = await prompter.askValid(
    'Show on the public website? (y/n)',
    flags.public,
    (v) => (/^(y|yes|n|no|true|false)$/i.test(v) ? null : 'answer y or n'),
    { flag: 'public', default: 'y' },
  );
  const isPublic = /^(y|yes|true)$/i.test(visibility);

  const file = path.join(QUESTIONS_DIR, `${id}.md`);
  const lines = ['---', `title: ${yamlString(title)}`];
  if (noteId) lines.push(`note: ${yamlString(noteId)}`);
  lines.push(
    'status: "open"',
    `public: ${isPublic}`,
    `created: ${yamlString(today)}`,
    `description: ${yamlString(description)}`,
    'sources: []',
    '# When answered: set status: "resolved", add resolvedOn: "YYYY-MM-DD",',
    '# and write the answer below the frontmatter.',
    '---',
    '',
  );
  await mkdir(QUESTIONS_DIR, { recursive: true });
  try {
    await writeFile(file, lines.join('\n'), { encoding: 'utf8', flag: 'wx' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw new UserError(`${rel(file)} already exists`);
    throw err;
  }
  console.log(`✓ Created ${rel(file)}${isPublic ? '' : ' (hidden from the site — but still public in the repository)'}`);
}

async function cmdList() {
  const notes = await loadNotes();
  const reviews = validateReviewRecords(await readJsonArray(REVIEWS_FILE), rel(REVIEWS_FILE));
  if (!notes.length) return console.log('No notes yet.');
  for (const n of notes) {
    const count = reviews.filter((r) => r.noteId === n.id).length;
    console.log(`${n.published}  ${n.id.padEnd(36)} ${String(count).padStart(2)} reviews  ${n.title}`);
  }
}

const HELP = `Learning Garden CLI

Usage: npm run garden -- <command> [flags]

Commands
  new        Create a note            --title --slug --category --tags --description --date
  review     Record a review          --note --date --mastery --reflection
  revise     Record a revision        --note --date --summary
  question   Create a question        --title --slug --note --description --public
  list       List notes and review counts
  help       Show this help

Dates are YYYY-MM-DD and default to today in ${CALENDAR_TIMEZONE}.
Reviewing the same note again on the same date UPDATES that day's review.

Mastery scale
${Object.entries(MASTERY_SCALE)
  .map(([m, s]) => `  ${m} — ${s.en} / ${s.zh}`)
  .join('\n')}
`;

// --------------------------------------------------------------------- main

const options = {
  title: { type: 'string' },
  slug: { type: 'string' },
  category: { type: 'string' },
  tags: { type: 'string' },
  description: { type: 'string' },
  date: { type: 'string' },
  note: { type: 'string' },
  mastery: { type: 'string' },
  reflection: { type: 'string' },
  summary: { type: 'string' },
  public: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
} as const;
type Flags = Partial<Record<Exclude<keyof typeof options, 'help'>, string>>;

async function main() {
  let parsed;
  try {
    parsed = parseArgs({ options, allowPositionals: true, strict: true });
  } catch (err) {
    throw new UserError(`${(err as Error).message}\n\n${HELP}`);
  }
  const [command = 'help'] = parsed.positionals;
  const { help, ...flags } = parsed.values;
  if (help || command === 'help') return console.log(HELP);

  const prompter = new Prompter();
  try {
    switch (command) {
      case 'new':
        return await cmdNew(flags, prompter);
      case 'review':
        return await cmdReview(flags, prompter);
      case 'revise':
        return await cmdRevise(flags, prompter);
      case 'question':
        return await cmdQuestion(flags, prompter);
      case 'list':
        return await cmdList();
      default:
        throw new UserError(`Unknown command "${command}".\n\n${HELP}`);
    }
  } finally {
    prompter.close();
  }
}

main().catch((err) => {
  if (err instanceof UserError) {
    console.error(`✗ ${err.message}`);
  } else if (err instanceof Error && err.message.startsWith('Invalid ')) {
    console.error(`✗ ${err.message}\nNothing was written.`);
  } else {
    console.error(err);
  }
  process.exitCode = 1;
});
