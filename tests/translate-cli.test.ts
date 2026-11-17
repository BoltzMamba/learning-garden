/** Integration tests: run the real `npm run translate` CLI against temporary gardens. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { scanTranslations } from '../src/lib/translation-check.ts';
import remarkWikilinks from '../src/lib/remark-wikilinks.ts';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(REPO, 'scripts/translate.ts');
let root: string;

function translate(...args: string[]) {
  const r = spawnSync(process.execPath, ['--no-warnings', CLI, ...args], {
    env: { ...process.env, GARDEN_ROOT: root },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { code: r.status, out: r.stdout + r.stderr };
}
const zhPath = (id: string) => path.join(root, 'src/content/notes', `${id}.md`);
const enPath = (id: string) => path.join(root, 'src/content/notes-en', `${id}.md`);
const candidatePath = (id: string) => path.join(root, '.translations', `${id}.md`);
const write = (file: string, text: string) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text, 'utf8');
};
const zh = (title: string, body: string) =>
  `---\ntitle: "${title}"\ndescription: "中文摘要"\ncategory: "knowledge"\ntags: []\npublished: "2026-11-10"\n---\n\n${body}\n`;
const candidate = (title: string, body: string) => `---\ntitle: "${title}"\ndescription: "English summary"\n---\n\n${body}\n`;
const status = (id: string) => scanTranslations(root, { only: id }).notes[0].status;

describe('translate CLI', () => {
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'garden-translate-'));
    write(zhPath('agent-loop'), zh('智能体循环', '正文，参见 [[react]]。\n\n```bash\nnpm run dev\n```'));
    write(zhPath('react'), zh('ReAct 模式', 'ReAct 正文。'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test('check reports MISSING; --strict blocks with the note id and reason', () => {
    const loose = translate('check');
    assert.equal(loose.code, 0, loose.out);
    assert.match(loose.out, /MISSING\s+agent-loop/);
    const strict = translate('check', '--strict');
    assert.equal(strict.code, 1);
    assert.match(strict.out, /agent-loop: MISSING — no English file/);
    assert.match(strict.out, /react: MISSING/);
  });

  test('--json and --note', () => {
    const r = translate('check', '--json', '--note', 'react');
    assert.equal(r.code, 0, r.out);
    const data = JSON.parse(r.out);
    assert.deepEqual(data.notes.map((n: { id: string }) => n.id), ['react']);
    assert.equal(data.notes[0].status, 'MISSING');
    assert.equal(translate('check', '--note', 'ghost').code, 2);
  });

  test('apply installs a candidate with computed hashes; complete content passes strict', () => {
    write(candidatePath('agent-loop'), candidate('The Agent Loop', 'Body, see [[react]].\n\n```bash\nnpm run dev\n```'));
    write(candidatePath('react'), candidate('The ReAct Pattern', 'ReAct body.'));
    assert.equal(translate('apply', '--note', 'agent-loop').code, 0);
    assert.equal(translate('apply', '--note', 'react').code, 0);
    const text = readFileSync(enPath('agent-loop'), 'utf8');
    assert.match(text, /^ {2}mode: auto$/m);
    assert.match(text, /^ {2}sourceHash: "sha256:[0-9a-f]{64}"$/m);
    assert.match(text, /^ {2}generatedHash: "sha256:[0-9a-f]{64}"$/m);
    assert.doesNotMatch(text, /^category:/m);
    assert.equal(existsSync(candidatePath('agent-loop')), false, 'candidate consumed');
    const strict = translate('check', '--strict');
    assert.equal(strict.code, 0, strict.out);
    assert.match(strict.out, /does not prove the translation is correct/);
  });

  test('a candidate that drops content is rejected and nothing is written', () => {
    write(candidatePath('agent-loop'), candidate('The Agent Loop', 'Body without the link or the code.'));
    const r = translate('apply', '--note', 'agent-loop');
    assert.equal(r.code, 2);
    assert.match(r.out, /links to "react"/);
    assert.equal(existsSync(enPath('agent-loop')), false);
    assert.equal(existsSync(candidatePath('agent-loop')), true, 'candidate kept for fixing');
  });

  test('manual translations are never overwritten, even when stale', () => {
    write(candidatePath('react'), candidate('The ReAct Pattern', 'ReAct body.'));
    translate('apply', '--note', 'react');
    translate('adopt', '--note', 'react');
    const manual = readFileSync(enPath('react'), 'utf8');
    assert.match(manual, /mode: manual/);
    assert.equal(status('react'), 'MANUAL_CURRENT');
    write(zhPath('react'), zh('ReAct 模式', 'ReAct 正文，已更新。'));
    assert.equal(status('react'), 'MANUAL_STALE');
    write(candidatePath('react'), candidate('Regenerated', 'Regenerated body.'));
    for (const flags of [[], ['--discard-edits'], ['--replace-invalid']]) {
      const r = translate('apply', '--note', 'react', ...flags);
      assert.equal(r.code, 2);
      assert.match(r.out, /MANUAL translation .* never overwritten/);
    }
    assert.equal(readFileSync(enPath('react'), 'utf8'), manual);
  });

  test('manual stale only warns in strict mode; confirm records the review', () => {
    for (const id of ['agent-loop', 'react']) {
      write(candidatePath(id), candidate(id, id === 'agent-loop' ? 'Body, see [[react]].\n\n```bash\nnpm run dev\n```' : 'ReAct body.'));
      translate('apply', '--note', id);
    }
    translate('adopt', '--note', 'react');
    write(zhPath('react'), zh('ReAct 模式', 'ReAct 正文，已更新。'));
    const strict = translate('check', '--strict');
    assert.equal(strict.code, 0, strict.out);
    assert.match(strict.out, /MANUAL_STALE\s+react/);
    assert.match(strict.out, /need the author's review/);
    assert.equal(translate('confirm', '--note', 'react').code, 0);
    assert.equal(status('react'), 'MANUAL_CURRENT');
  });

  test('an edited auto translation is a conflict: apply refuses until the author decides', () => {
    write(candidatePath('react'), candidate('The ReAct Pattern', 'ReAct body.'));
    translate('apply', '--note', 'react');
    const edited = readFileSync(enPath('react'), 'utf8').replace('ReAct body.', 'ReAct body, polished by hand.');
    write(enPath('react'), edited);
    assert.equal(status('react'), 'AUTO_MODIFIED');
    assert.equal(translate('check', '--strict').code, 1);

    write(candidatePath('react'), candidate('The ReAct Pattern', 'Regenerated body.'));
    const refused = translate('apply', '--note', 'react');
    assert.equal(refused.code, 2);
    assert.match(refused.out, /AUTO_MODIFIED/);
    assert.equal(readFileSync(enPath('react'), 'utf8'), edited, 'edits untouched');

    // Author decision A: keep the edits.
    assert.equal(translate('adopt', '--note', 'react').code, 0);
    assert.equal(status('react'), 'MANUAL_CURRENT');
    assert.match(readFileSync(enPath('react'), 'utf8'), /polished by hand/);
    assert.doesNotMatch(readFileSync(enPath('react'), 'utf8'), /generatedHash/);
  });

  test('author decision B: regenerate with --discard-edits', () => {
    write(candidatePath('react'), candidate('The ReAct Pattern', 'ReAct body.'));
    translate('apply', '--note', 'react');
    write(enPath('react'), readFileSync(enPath('react'), 'utf8').replace('ReAct body.', 'Edited.'));
    write(candidatePath('react'), candidate('The ReAct Pattern', 'Fresh body.'));
    assert.equal(translate('apply', '--note', 'react', '--discard-edits').code, 0);
    assert.equal(status('react'), 'AUTO_CURRENT');
  });

  test('invalid English files and orphans block strict mode; invalid files are not replaced silently', () => {
    write(enPath('react'), '---\ntitle: "Hand-written"\ndescription: "x"\ncategory: "knowledge"\n---\n\nPrecious text.\n');
    write(enPath('ghost'), '---\ntitle: "G"\ndescription: "x"\n---\n\nx\n');
    const r = translate('check', '--strict');
    assert.equal(r.code, 1);
    assert.match(r.out, /react: INVALID — "category" is structural metadata/);
    assert.match(r.out, /ghost: ORPHAN/);
    write(candidatePath('react'), candidate('The ReAct Pattern', 'ReAct body.'));
    assert.equal(translate('apply', '--note', 'react').code, 2);
    assert.match(readFileSync(enPath('react'), 'utf8'), /Precious text/);
  });

  test('stale auto translations block strict mode', () => {
    write(candidatePath('react'), candidate('The ReAct Pattern', 'ReAct body.'));
    translate('apply', '--note', 'react');
    write(zhPath('react'), zh('ReAct 模式', '改写后的正文。'));
    const r = translate('check', '--strict', '--note', 'react');
    assert.equal(r.code, 1);
    assert.match(r.out, /react: AUTO_STALE/);
  });
});

describe('English wikilinks', () => {
  test('resolve by English title and are labelled with the English title; links stay relative', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'garden-wiki-'));
    try {
      write(path.join(dir, 'notes/react.md'), zh('ReAct 模式', 'x'));
      write(path.join(dir, 'notes-en/react.md'), '---\ntitle: "The ReAct Pattern"\ndescription: "d"\n---\n');
      const plugin = remarkWikilinks({ notesDir: path.join(dir, 'notes') });
      type Node = { type: string; value?: string; url?: string; children?: Node[] };
      const run = (file: string, md: string) => {
        const tree: Node = { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', value: md }] }] };
        plugin(tree, { path: path.join(dir, 'src/content', file) });
        return tree.children![0].children!.filter((n) => n.type === 'link').map((l) => [l.url, l.children![0].value]);
      };
      // The plugin finds the note directories relative to notesDir; paths only need the content folder name.
      const en = run('notes-en/x.md', 'See [[react]], [[The ReAct Pattern|this]] and [[ReAct 模式]].');
      assert.deepEqual(en, [
        ['../react/', 'The ReAct Pattern'],
        ['../react/', 'this'],
        ['../react/', 'ReAct 模式'],
      ]);
      assert.deepEqual(run('notes/x.md', 'See [[react]].'), [['../react/', 'ReAct 模式']]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('this repository', () => {
  test('every note has a current English edition (what the production build enforces)', () => {
    const scan = scanTranslations(REPO);
    assert.ok(scan.notes.length > 0);
    assert.deepEqual(
      scan.failures.map((f) => `${f.id}: ${f.status} ${f.reasons.join('; ')}`),
      [],
    );
  });
});
