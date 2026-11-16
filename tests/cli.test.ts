/** Integration tests: run the real CLI against a temporary garden root. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { todayInTimeZone } from '../src/lib/dates.ts';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts/garden.ts');
let root: string;

function garden(...args: string[]) {
  const result = spawnSync(process.execPath, ['--no-warnings', CLI, ...args], {
    env: { ...process.env, GARDEN_ROOT: root },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'], // non-TTY: flags only, no prompts
  });
  return { code: result.status, out: result.stdout + result.stderr };
}
const reviews = () => JSON.parse(readFileSync(path.join(root, 'src/data/reviews.json'), 'utf8'));

describe('garden CLI', () => {
  before(() => {
    root = mkdtempSync(path.join(tmpdir(), 'garden-cli-'));
    mkdirSync(path.join(root, 'src/data'), { recursive: true });
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  test('new creates a note with valid frontmatter', () => {
    const r = garden('new', '--title', 'ReAct Agent Loop', '--category', 'ai-agents', '--tags', 'agent, llm,agent',
      '--description', 'How ReAct interleaves reasoning and acting.', '--date', '2026-11-10');
    assert.equal(r.code, 0, r.out);
    const text = readFileSync(path.join(root, 'src/content/notes/react-agent-loop.md'), 'utf8');
    assert.match(text, /^title: "ReAct Agent Loop"$/m);
    assert.match(text, /^tags: \["agent","llm"\]$/m);
    assert.match(text, /^published: "2026-11-10"$/m);
  });

  test('duplicate slugs are rejected without touching the file', () => {
    const file = path.join(root, 'src/content/notes/react-agent-loop.md');
    const before = readFileSync(file, 'utf8');
    const r = garden('new', '--title', 'ReAct Agent Loop', '--category', 'ai-agents', '--description', 'dup');
    assert.equal(r.code, 1);
    assert.match(r.out, /already exists/);
    assert.equal(readFileSync(file, 'utf8'), before);
  });

  test('Chinese-only titles require an explicit slug', () => {
    const r = garden('new', '--title', '动态规划入门', '--category', 'algorithms', '--description', 'd');
    assert.equal(r.code, 1);
    assert.match(r.out, /--slug/);
    const ok = garden('new', '--title', '动态规划入门', '--slug', 'dp-intro', '--category', 'algorithms', '--description', 'd');
    assert.equal(ok.code, 0, ok.out);
  });

  test('a repeated same-day review updates the existing record', () => {
    const first = garden('review', '--note', 'react-agent-loop', '--date', '2026-11-16', '--mastery', '2', '--reflection', 'shaky');
    assert.equal(first.code, 0, first.out);
    const second = garden('review', '--note', 'react-agent-loop', '--date', '2026-11-16', '--mastery', '4', '--reflection', 'better');
    assert.equal(second.code, 0, second.out);
    assert.match(second.out, /Updated the existing review/);
    assert.deepEqual(reviews(), [{ noteId: 'react-agent-loop', date: '2026-11-16', mastery: 4, reflection: 'better' }]);
  });

  test('review defaults to today in Asia/Singapore and rejects bad input', () => {
    const r = garden('review', '--note', 'dp-intro', '--mastery', '3', '--reflection', 'ok');
    assert.equal(r.code, 0, r.out);
    assert.ok(reviews().some((x: { noteId: string; date: string }) => x.noteId === 'dp-intro' && x.date === todayInTimeZone()));
    assert.equal(garden('review', '--note', 'nope', '--mastery', '3', '--reflection', 'x').code, 1);
    assert.equal(garden('review', '--note', 'dp-intro', '--mastery', '9', '--reflection', 'x').code, 1);
    assert.equal(garden('review', '--note', 'dp-intro', '--mastery', '3', '--reflection', 'x', '--date', '2999-01-01').code, 1);
    assert.equal(garden('review', '--note', 'dp-intro', '--mastery', '3', '--reflection', 'x', '--date', '2026-02-29').code, 1);
  });

  test('a corrupt reviews.json is never overwritten', () => {
    const file = path.join(root, 'src/data/reviews.json');
    const good = readFileSync(file, 'utf8');
    writeFileSync(file, '[{"broken": ');
    const r = garden('review', '--note', 'dp-intro', '--mastery', '3', '--reflection', 'x');
    assert.equal(r.code, 1);
    assert.equal(readFileSync(file, 'utf8'), '[{"broken": ');
    writeFileSync(file, good);
  });

  test('revise appends a stable revision id', () => {
    const args = ['revise', '--note', 'react-agent-loop', '--date', '2026-11-16', '--summary'];
    assert.equal(garden(...args, 'Corrected the tool-call loop').code, 0);
    assert.equal(garden(...args, 'Added failure modes').code, 0);
    const revs = JSON.parse(readFileSync(path.join(root, 'src/data/revisions.json'), 'utf8'));
    assert.deepEqual(
      revs.map((r: { id: string }) => r.id),
      ['react-agent-loop--2026-11-16--1', 'react-agent-loop--2026-11-16--2'],
    );
  });

  test('question creates an open question linked to a note', () => {
    const r = garden('question', '--title', 'Why does ReAct loop forever?', '--note', 'react-agent-loop',
      '--description', 'Sometimes the agent never stops.', '--public', 'n');
    assert.equal(r.code, 0, r.out);
    const text = readFileSync(path.join(root, 'src/content/questions/why-does-react-loop-forever.md'), 'utf8');
    assert.match(text, /^status: "open"$/m);
    assert.match(text, /^public: false$/m);
    assert.match(text, /^note: "react-agent-loop"$/m);
  });
});
