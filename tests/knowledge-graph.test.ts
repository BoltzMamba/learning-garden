/**
 * Unified knowledge graph: relation extraction, de-duplication, the two modes,
 * preview/local views and per-language localisation. All data is synthetic
 * and lives only in this file.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildGraph,
  filterMode,
  localGraph,
  localizeGraph,
  noteConnections,
  noteNodeId,
  previewGraph,
  type GraphArticleInput,
} from '../src/lib/graph.ts';
import { parseVocabulary } from '../src/lib/topics.ts';

const vocab = parseVocabulary({
  ai: { zh: '人工智能', en: 'Artificial Intelligence' },
  'ai-agent': { zh: 'AI Agent', en: 'AI Agent', parent: 'ai', aliases: ['llm-agent'] },
  mcp: { zh: 'MCP', en: 'MCP', parent: 'ai-agent' },
  unused: { zh: '未使用', en: 'Unused' },
});

const article = (id: string, extra: Partial<GraphArticleInput> = {}): GraphArticleInput => ({
  id,
  title: id.toUpperCase(),
  section: 'knowledge',
  contentType: 'note',
  related: [],
  topics: [],
  body: '',
  ...extra,
});

const articles = [
  // The overview's body has no links: its contents list is generated, never parsed.
  article('agents', { contentType: 'overview', topics: ['ai-agent'], body: 'An overview without links.' }),
  article('react', {
    series: 'agents',
    topics: ['ai-agent'],
    related: ['mcp-intro'],
    body: 'See [[mcp-intro]], [again](../mcp-intro/) and [external](https://example.com/notes/agents/).',
  }),
  article('mcp-intro', { series: 'agents', topics: ['mcp'], related: ['react'], body: 'Back to [ReAct](/learning-garden/en/notes/react/).' }),
  article('lonely'),
];
const questions = [
  { id: 'why', title: 'Why?', note: 'react', public: true },
  { id: 'hidden', title: 'Hidden', note: 'react', public: false },
];
const g = buildGraph(articles, questions, vocab);
const edges = (kind: string) => g.edges.filter((e) => e.kind === kind).map((e) => `${e.source}>${e.target}`).sort();

describe('unified graph: relations', () => {
  test('body links keep direction; external links are excluded', () => {
    assert.deepEqual(edges('links_to'), ['note:mcp-intro>note:react', 'note:react>note:mcp-intro']);
  });

  test('related is undirected: declaring it on both sides yields one edge', () => {
    assert.equal(edges('related_to').length, 1);
  });

  test('the same pair keeps different relation kinds (link + related)', () => {
    const pair = g.edges.filter((e) => [e.source, e.target].sort().join() === 'note:mcp-intro,note:react');
    assert.deepEqual([...new Set(pair.map((e) => e.kind))].sort(), ['links_to', 'related_to']);
  });

  test('series membership is a belongs_to edge; the generated contents add no body links', () => {
    assert.deepEqual(edges('belongs_to'), ['note:mcp-intro>note:agents', 'note:react>note:agents']);
    assert.ok(!g.edges.some((e) => e.kind === 'links_to' && e.source === noteNodeId('agents')));
  });

  test('topics: used ones and their ancestors only, with parent_of chains', () => {
    const topics = g.nodes.filter((n) => n.kind === 'topic').map((n) => n.id).sort();
    assert.deepEqual(topics, ['topic:ai', 'topic:ai-agent', 'topic:mcp']);
    assert.deepEqual(edges('parent_of'), ['topic:ai-agent>topic:mcp', 'topic:ai>topic:ai-agent']);
    assert.equal(g.nodes.find((n) => n.id === 'topic:ai-agent')?.labels?.zh, 'AI Agent');
  });

  test('two articles sharing a tag are not linked directly', () => {
    // agents and react share ai-agent but no edge exists between them except series membership.
    const between = g.edges.filter((e) => [e.source, e.target].sort().join() === 'note:agents,note:react');
    assert.deepEqual(between.map((e) => e.kind), ['belongs_to']);
  });

  test('a note without series is a normal node; hidden questions never appear', () => {
    assert.ok(g.nodes.some((n) => n.id === 'note:lonely'));
    assert.ok(g.nodes.some((n) => n.id === 'q:why'));
    assert.ok(!g.nodes.some((n) => n.id === 'q:hidden'));
  });

  test('noteConnections reports outlinks, backlinks and related', () => {
    assert.deepEqual(noteConnections(g, 'react'), { outlinks: ['mcp-intro'], backlinks: ['mcp-intro'], related: ['mcp-intro'] });
  });
});

describe('graph modes', () => {
  test('article mode: articles + questions; body, related, series and question edges', () => {
    const v = filterMode(g, 'article');
    assert.deepEqual(new Set(v.nodes.map((n) => n.kind)), new Set(['article', 'question']));
    assert.deepEqual(new Set(v.edges.map((e) => e.kind)), new Set(['links_to', 'related_to', 'belongs_to', 'asks_about']));
  });

  test('topic mode: articles + topics; tagged_with, parent_of and belongs_to only', () => {
    const v = filterMode(g, 'topic');
    assert.deepEqual(new Set(v.nodes.map((n) => n.kind)), new Set(['article', 'topic']));
    assert.deepEqual(new Set(v.edges.map((e) => e.kind)), new Set(['tagged_with', 'parent_of', 'belongs_to']));
  });

  test('isolated articles are kept in both modes with degree 0', () => {
    for (const mode of ['article', 'topic'] as const) {
      assert.equal(filterMode(g, mode).nodes.find((n) => n.id === 'note:lonely')?.degree, 0);
    }
  });

  test('local graph: one hop of article-mode relations around the centre', () => {
    const local = localGraph(g, noteNodeId('mcp-intro'), 'article', 1);
    assert.deepEqual(local.nodes.map((n) => n.id).sort(), ['note:agents', 'note:mcp-intro', 'note:react']);
    assert.ok(local.edges.every((e) => local.nodes.some((n) => n.id === e.source) && local.nodes.some((n) => n.id === e.target)));
    assert.deepEqual(localGraph(g, noteNodeId('lonely')).nodes.map((n) => n.id), ['note:lonely']);
  });

  test('preview keeps only connected nodes, best-connected first, within the cap', () => {
    const p = previewGraph(g, 'article', 24);
    assert.ok(!p.nodes.some((n) => n.id === 'note:lonely'));
    assert.ok(p.nodes.every((n) => (n.degree ?? 0) > 0));
    const small = previewGraph(g, 'article', 2);
    assert.ok(small.nodes.length <= 2 && small.edges.length > 0);
  });
});

describe('graph edge cases', () => {
  test('a single article: one node, no edges, empty preview', () => {
    const one = buildGraph([article('solo')], [], vocab);
    assert.equal(one.nodes.length, 1);
    assert.equal(one.edges.length, 0);
    assert.deepEqual(previewGraph(one), { nodes: [], edges: [] });
  });

  test('no valid relations at all: empty preview state, every article still a node', () => {
    const none = buildGraph([article('a'), article('b', { body: '[x](https://example.com/)' })], [], vocab);
    assert.equal(none.edges.length, 0);
    assert.equal(filterMode(none, 'article').nodes.length, 2);
    assert.equal(previewGraph(none).nodes.length, 0);
  });

  test('an empty overview is still a node', () => {
    const empty = buildGraph([article('series', { contentType: 'overview' })], [], vocab);
    assert.equal(empty.nodes[0].contentType, 'overview');
  });

  test('self links and repeated links collapse', () => {
    const r = buildGraph([article('a', { body: '[[a]] [[b]] [[b]] [b](../b/)' }), article('b')], [], vocab);
    assert.deepEqual(r.edges, [{ source: 'note:a', target: 'note:b', kind: 'links_to' }]);
  });
});

describe('languages share one logical node', () => {
  const href = (lang: 'zh' | 'en', p: string) => `/learning-garden/${lang}${p}`;
  test('zh and en copies have identical ids and edges; only names and hrefs differ', () => {
    const zh = localizeGraph(g, 'zh', href);
    const en = localizeGraph(g, 'en', href);
    assert.deepEqual(zh.nodes.map((n) => n.id), en.nodes.map((n) => n.id));
    assert.deepEqual(zh.edges, en.edges);
    const zhAi = zh.nodes.find((n) => n.id === 'topic:ai')!;
    const enAi = en.nodes.find((n) => n.id === 'topic:ai')!;
    assert.equal(zhAi.label, '人工智能');
    assert.equal(enAi.label, 'Artificial Intelligence');
    assert.equal(zh.nodes.find((n) => n.id === 'note:react')!.href, '/learning-garden/zh/notes/react/');
    assert.equal(en.nodes.find((n) => n.id === 'note:react')!.href, '/learning-garden/en/notes/react/');
  });
});
