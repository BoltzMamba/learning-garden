import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { buildGraph, localGraph, noteConnections, noteNodeId } from '../src/lib/graph.ts';
import { extractNoteLinks, makeResolver } from '../src/lib/links.ts';
import remarkWikilinks from '../src/lib/remark-wikilinks.ts';

const notes = [
  { id: 'react-loop', title: 'ReAct Agent Loop', tags: ['agent'], body: '' },
  { id: 'dp-intro', title: '动态规划入门', tags: ['algorithms'], body: '' },
  { id: 'lonely', title: 'Lonely note', tags: [], body: 'no links here' },
];
const resolve = makeResolver(notes);

describe('internal link extraction', () => {
  test('wikilinks by slug, title, alias and heading', () => {
    const md = 'See [[dp-intro]], [[ReAct Agent Loop|the loop]], [[dp-intro#状态转移]] and [[Nope]].';
    const { targets, unresolved } = extractNoteLinks(md, 'lonely', resolve);
    assert.deepEqual(targets, ['dp-intro', 'react-loop']);
    assert.deepEqual(unresolved, ['Nope']);
  });

  test('markdown links: relative, absolute with base and locale, .md files, reference definitions', () => {
    const md = [
      '[a](../dp-intro/)',
      '[b](/learning-garden/en/notes/react-loop/#section)',
      '[c](./lonely.md)',
      '[d][ref]',
      '[ref]: https://boltzmamba.github.io/learning-garden/zh/notes/dp-intro/',
      '[ext](https://example.com/notes/dp-intro/)',
      '[cat](../category/agents/)',
      '[questions](/learning-garden/zh/questions/)',
    ].join('\n');
    const { targets, unresolved } = extractNoteLinks(md, 'react-loop', resolve);
    assert.deepEqual(targets, ['dp-intro', 'lonely']);
    assert.deepEqual(unresolved, []);
  });

  test('links inside code are ignored; self-links and duplicates collapse', () => {
    const md = '```md\n[[dp-intro]] [x](../dp-intro/)\n```\nInline `[[lonely]]` here. [[react-loop]] [[react-loop]] [again](../dp-intro/) [[dp-intro]]';
    const { targets } = extractNoteLinks(md, 'react-loop', resolve);
    assert.deepEqual(targets, ['dp-intro']);
  });

  test('a broken link to a missing note is reported', () => {
    assert.deepEqual(extractNoteLinks('[x](../missing-note/)', 'lonely', resolve).unresolved, ['../missing-note/']);
  });
});

describe('graph', () => {
  const input = notes.map((n) =>
    n.id === 'react-loop' ? { ...n, body: 'Builds on [[dp-intro]] and [[dp-intro]].' } : n.id === 'dp-intro' ? { ...n, body: 'Back to [the loop](../react-loop/).' } : n,
  );
  const questions = [
    { id: 'q-public', title: 'Why loops?', note: 'react-loop', public: true },
    { id: 'q-hidden', title: 'Hidden', note: 'react-loop', public: false },
  ];

  test('nodes come from real notes, tags and public questions; edges from written links only', () => {
    const g = buildGraph(input, questions);
    assert.deepEqual(g.nodes.map((n) => n.id).sort(), ['note:dp-intro', 'note:lonely', 'note:react-loop', 'q:q-public', 'tag:agent', 'tag:algorithms']);
    const noteEdges = g.links.filter((l) => l.kind === 'link');
    assert.equal(noteEdges.length, 1, 'mutual links are one undirected edge');
    assert.deepEqual(g.noteLinks, [
      { from: 'react-loop', to: 'dp-intro' },
      { from: 'dp-intro', to: 'react-loop' },
    ]);
    // The isolated note is still a node, with no edges.
    assert.equal(g.nodes.find((n) => n.id === 'note:lonely')?.degree, 0);
    // Hidden questions never appear.
    assert.ok(!g.nodes.some((n) => n.id === 'q:q-hidden'));
    assert.equal(buildGraph(input, questions, { tags: false }).nodes.filter((n) => n.kind === 'tag').length, 0);
  });

  test('backlinks, outlinks and local graph depth', () => {
    const g = buildGraph(input, questions);
    assert.deepEqual(noteConnections(g.noteLinks, 'dp-intro'), { backlinks: ['react-loop'], outlinks: ['react-loop'] });
    const one = localGraph(g, noteNodeId('dp-intro'), 1);
    assert.deepEqual(one.nodes.map((n) => n.id).sort(), ['note:dp-intro', 'note:react-loop', 'tag:algorithms']);
    const two = localGraph(g, noteNodeId('dp-intro'), 2);
    assert.ok(two.nodes.some((n) => n.id === 'q:q-public') && two.nodes.some((n) => n.id === 'tag:agent'));
    assert.ok(!two.nodes.some((n) => n.id === 'note:lonely'));
    assert.ok(two.links.every((l) => two.nodes.some((n) => n.id === l.source) && two.nodes.some((n) => n.id === l.target)));
  });
});

describe('wikilink remark plugin', () => {
  test('renders resolved links relative to the page and marks missing ones', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'wikilinks-'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'dp-intro.md'), '---\ntitle: "动态规划入门"\n---\nbody');
    try {
      const tree = {
        type: 'root',
        children: [
          { type: 'paragraph', children: [{ type: 'text', value: 'See [[dp-intro]], [[动态规划入门|DP]] and [[Missing]].' }] },
          { type: 'code', value: '[[dp-intro]]' },
        ],
      };
      const warn = console.warn;
      console.warn = () => {};
      remarkWikilinks({ notesDir: dir })(tree, { path: '/x/src/content/notes/other.md' });
      const questionTree = { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', value: '[[dp-intro]]' }] }] };
      remarkWikilinks({ notesDir: dir })(questionTree, { path: '/x/src/content/questions/q.md' });
      console.warn = warn;

      const para = tree.children[0].children as { type: string; url?: string; value?: string; children?: { value: string }[] }[];
      const links = para.filter((n) => n.type === 'link');
      assert.deepEqual(
        links.map((l) => [l.url, l.children![0].value]),
        [
          ['../dp-intro/', '动态规划入门'],
          ['../dp-intro/', 'DP'],
        ],
      );
      assert.ok(para.some((n) => n.type === 'html' && n.value!.includes('wikilink-missing')));
      assert.equal(tree.children[1].value, '[[dp-intro]]', 'code is untouched');
      assert.equal((questionTree.children[0].children[0] as { url?: string }).url, '../notes/dp-intro/');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
