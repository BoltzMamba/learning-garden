/** Bilingual content: hashing, status classification, preservation checks and language views (synthetic data). */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  classifyTranslation,
  hashContent,
  normalizeBody,
  serializeEnglish,
  STRICT_FAILURES,
  TRANSLATION_RULES_VERSION,
  type EnglishFile,
  type TranslationMode,
} from '../src/lib/translation.ts';
import { localizeNotes, localizeSeries, titleLabels } from '../src/lib/bilingual.ts';
import { seriesMembers } from '../src/lib/content-model.ts';
import { buildGraph, localizeGraph, noteNodeId } from '../src/lib/graph.ts';
import { buildActivityEvents } from '../src/lib/activity.ts';

const zhFile = (title: string, description: string, body: string, extra = '') =>
  `---\ntitle: ${JSON.stringify(title)}\ndescription: ${JSON.stringify(description)}\ncategory: "knowledge"\ntags: []\npublished: "2026-11-10"\n${extra}---\n\n${body}\n`;

const ZH_BODY = [
  '智能体循环由观察、思考和行动组成。参见 [[react]] 与 [规划](../planning/)。',
  '',
  '![循环示意图](/learning-garden/images/loop.png)',
  '',
  '```python',
  'while not done:',
  '    act()',
  '```',
  '',
  '$$',
  'T(n) = O(n)',
  '$$',
].join('\n');
const EN_BODY = [
  'An agent loop consists of observing, thinking and acting. See [[react]] and [planning](../planning/).',
  '',
  '![Loop diagram](/learning-garden/images/loop.png)',
  '',
  '```python',
  'while not done:',
  '    act()',
  '```',
  '',
  '$$',
  'T(n) = O(n)',
  '$$',
].join('\n');

const ZH = zhFile('智能体循环', '智能体如何执行。', ZH_BODY);
const refs = [
  { id: 'agent-loop', title: '智能体循环' },
  { id: 'react', title: 'ReAct 模式' },
  { id: 'react', title: 'The ReAct Pattern' },
  { id: 'planning', title: '规划' },
];
const sourceHash = () => classifyTranslation({ id: 'agent-loop', zhText: ZH, refs }).sourceHash!;

function enFile(mode: TranslationMode, over: Partial<{ title: string; description: string; body: string; sourceHash: string; rulesVersion: number }> = {}) {
  const content = { title: over.title ?? 'The Agent Loop', description: over.description ?? 'How an agent executes.', body: over.body ?? EN_BODY };
  const file: EnglishFile = {
    ...content,
    translation: {
      mode,
      sourceHash: over.sourceHash ?? sourceHash(),
      generatedHash: mode === 'auto' ? hashContent(content) : undefined,
      rulesVersion: mode === 'auto' ? (over.rulesVersion ?? TRANSLATION_RULES_VERSION) : undefined,
    },
  };
  return serializeEnglish(file);
}
const classify = (enText: string | undefined, zhText: string | undefined = ZH, rulesVersion?: number) =>
  classifyTranslation({ id: 'agent-loop', zhText, enText, refs, rulesVersion });

describe('translation hashes', () => {
  test('are deterministic and pinned (changing the algorithm invalidates every translation)', () => {
    const content = { title: '标题', description: '描述', body: '正文\n\n第二段' };
    assert.equal(hashContent(content), hashContent({ ...content }));
    assert.match(hashContent(content), /^sha256:[0-9a-f]{64}$/);
    // Pinned values: must not drift between runs, machines or Node versions.
    assert.equal(hashContent(content), 'sha256:1566be163b23470d65d611d6be38f2e5a7d9def24c5d2b6d791d498004fb4165');
    assert.equal(hashContent({ title: 'a', description: 'b', body: 'c' }), 'sha256:bf2063e9c326561a82bbad2b5312bb5c05afcfbc08e9e43462ea2a4fba30b2b2');
  });

  test('ignore line endings, BOM, Unicode form, trailing spaces and surrounding blank lines', () => {
    const base = hashContent({ title: 'Café', description: 'd', body: 'line one\nline two\n\n## Heading\n' });
    assert.equal(hashContent({ title: ' Café ', description: 'd\r\n', body: '﻿\r\n\r\nline one  \r\nline two\t\r\n\r\n## Heading\r\n\r\n' }), base);
    assert.equal(hashContent({ title: 'Café', description: 'd', body: 'line one\nline two\n\n## Heading' }), base, 'NFC normalisation');
    assert.equal(normalizeBody('\r\n\r\na\r\nb  \r\n'), 'a\nb');
  });

  test('change when the title, description or body text changes', () => {
    const base = { title: 't', description: 'd', body: 'b' };
    const h = hashContent(base);
    assert.notEqual(hashContent({ ...base, title: 't2' }), h);
    assert.notEqual(hashContent({ ...base, description: 'd2' }), h);
    assert.notEqual(hashContent({ ...base, body: 'b2' }), h);
    // Field boundaries are unambiguous.
    assert.notEqual(hashContent({ title: 'ab', description: 'c', body: '' }), hashContent({ title: 'a', description: 'bc', body: '' }));
  });

  test('a CRLF checkout of the same files has the same status', () => {
    const en = enFile('auto');
    assert.equal(classify(en.replace(/\n/g, '\r\n'), ZH.replace(/\n/g, '\r\n')).status, 'AUTO_CURRENT');
  });
});

describe('translation status', () => {
  test('MISSING without an English file; ORPHAN without a Chinese source', () => {
    assert.equal(classify(undefined).status, 'MISSING');
    assert.equal(classifyTranslation({ id: 'agent-loop', zhText: undefined, enText: enFile('auto'), refs }).status, 'ORPHAN');
  });

  test('AUTO_CURRENT, then AUTO_STALE when the Chinese text changes', () => {
    const en = enFile('auto');
    assert.equal(classify(en).status, 'AUTO_CURRENT');
    const edited = zhFile('智能体循环', '智能体如何执行。', `${ZH_BODY}\n\n新增一段。`);
    const r = classify(en, edited);
    assert.equal(r.status, 'AUTO_STALE');
    assert.match(r.reasons.join(' '), /Chinese title, description or body changed/);
  });

  test('structural frontmatter changes (series, related, order, tags) do not make a translation stale', () => {
    const en = enFile('auto');
    const restructured = ZH.replace('tags: []', 'tags: ["agent"]\nseries: "agents"\norder: 20\nrelated: ["react"]');
    assert.equal(classify(en, restructured).status, 'AUTO_CURRENT');
  });

  test('MANUAL_CURRENT, then MANUAL_STALE (a warning, not a failure) when the Chinese text changes', () => {
    const en = enFile('manual', { body: 'A different structure, written for recruiters. See [[react]], [[planning]].\n\n![x](/learning-garden/images/loop.png)' });
    assert.equal(classify(en).status, 'MANUAL_CURRENT');
    const r = classify(en, ZH.replace('智能体如何执行。', '智能体如何执行与规划。'));
    assert.equal(r.status, 'MANUAL_STALE');
    assert.equal(STRICT_FAILURES.has('MANUAL_STALE'), false);
  });

  test('a manual edition may differ in structure: missing code or sections only warn', () => {
    const en = enFile('manual', { body: 'Short English edition. See [[react]].' });
    const r = classify(en);
    assert.equal(r.status, 'MANUAL_CURRENT');
    assert.ok(r.warnings.some((w) => /code blocks/.test(w)));
    assert.ok(r.warnings.some((w) => /links to "planning"/.test(w)));
  });

  test('AUTO_MODIFIED when an auto translation was edited by hand (takes precedence over staleness)', () => {
    const en = enFile('auto').replace('An agent loop consists', 'An agent loop, in my experience, consists');
    const r = classify(en);
    assert.equal(r.status, 'AUTO_MODIFIED');
    assert.match(r.reasons.join(' '), /adopt/);
    assert.equal(classify(en, ZH.replace('智能体如何执行。', '变了。')).status, 'AUTO_MODIFIED');
  });

  test('a newer translation-rules version makes auto translations stale, never manual ones', () => {
    assert.equal(classify(enFile('auto'), ZH, TRANSLATION_RULES_VERSION + 1).status, 'AUTO_STALE');
    assert.match(classify(enFile('auto'), ZH, TRANSLATION_RULES_VERSION + 1).reasons[0], /rules v/);
    assert.equal(classify(enFile('manual'), ZH, TRANSLATION_RULES_VERSION + 1).status, 'MANUAL_CURRENT');
    assert.equal(classify(enFile('auto', { rulesVersion: TRANSLATION_RULES_VERSION + 1 })).status, 'INVALID');
  });
});

describe('English frontmatter and content validation', () => {
  const head = (fm: string, body = EN_BODY) => `---\n${fm}\n---\n\n${body}\n`;
  const meta = () => `translation:\n  mode: manual\n  sourceHash: "${sourceHash()}"`;

  test('structural keys, unknown keys, missing fields and malformed hashes are INVALID', () => {
    const cases: [string, RegExp][] = [
      [`title: "T"\ndescription: "D"\ncategory: "knowledge"\n${meta()}`, /structural metadata/],
      [`title: "T"\ndescription: "D"\nrelated: ["react"]\n${meta()}`, /structural metadata/],
      [`title: "T"\ndescription: "D"\nfoo: 1\n${meta()}`, /unknown frontmatter key "foo"/],
      [`description: "D"\n${meta()}`, /title: required/],
      [`title: "T"\ndescription: "D"`, /translation: required/],
      [`title: "T"\ndescription: "D"\ntranslation:\n  mode: manual\n  sourceHash: "sha256:abc"`, /sourceHash/],
      [`title: "T"\ndescription: "D"\ntranslation:\n  mode: robot\n  sourceHash: "${sourceHash()}"`, /mode/],
      [`title: "T"\ndescription: "D"\ntranslation:\n  mode: auto\n  sourceHash: "${sourceHash()}"`, /generatedHash/],
      [`title: "T"\ndescription: "D"\n${meta()}\n  note: x`, /translation.note: unknown key/],
    ];
    for (const [fm, reason] of cases) {
      const r = classify(head(fm));
      assert.equal(r.status, 'INVALID', fm);
      assert.match(r.reasons.join(' | '), reason, fm);
    }
    assert.equal(classify('no frontmatter').status, 'INVALID');
    assert.equal(classify(head(`title: "T"\ndescription: "D"\n${meta()}`, '')).status, 'INVALID', 'empty English body');
  });

  test('internal links in the English text must resolve (by id, Chinese or English title)', () => {
    const body = EN_BODY.replace('[[react]]', '[[The ReAct Pattern]]');
    assert.equal(classify(enFile('auto', { body })).status, 'AUTO_CURRENT');
    const broken = classify(enFile('auto', { body: `${EN_BODY}\n\nAlso [[no-such-note]].` }));
    assert.equal(broken.status, 'INVALID');
    assert.match(broken.reasons.join(' '), /"no-such-note" does not point to an existing note/);
    const manual = classify(enFile('manual', { body: `${EN_BODY}\n\n[x](../ghost/)` }));
    assert.equal(manual.status, 'INVALID', 'broken links are invalid in manual editions too');
  });

  test('auto translations must keep wikilinks, note links, images, code blocks and formulas', () => {
    const drops: [string, RegExp][] = [
      [EN_BODY.replace('[[react]]', 'ReAct'), /links to "react"/],
      [EN_BODY.replace('[planning](../planning/)', 'planning'), /links to "planning"/],
      [EN_BODY.replace('![Loop diagram](/learning-garden/images/loop.png)', ''), /image .*loop\.png/],
      [EN_BODY.replace(/```python[\s\S]*?```/, ''), /code blocks: Chinese has 1, English has 0/],
      [EN_BODY.replace(/\$\$[\s\S]*\$\$/, ''), /display formulas/],
    ];
    for (const [body, reason] of drops) {
      const r = classify(enFile('auto', { body }));
      assert.equal(r.status, 'INVALID', String(reason));
      assert.match(r.reasons.join(' | '), reason);
    }
  });

  test('extra links and links into /zh/ are reported but do not change the knowledge graph', () => {
    const r = classify(enFile('auto', { body: `${EN_BODY}\n\nCompare [[agent-loop]] … and [the Chinese page](/learning-garden/zh/notes/react/).` }));
    assert.equal(r.status, 'AUTO_CURRENT');
    assert.ok(r.warnings.some((w) => /Chinese site/.test(w)));
  });

  test('serialised English files round-trip to AUTO_CURRENT, including quotes and YAML-special characters', () => {
    const tricky = enFile('auto', { title: 'Agents: "loops" & #tags — 100% \\ done', description: "It's: [not] {yaml}" });
    assert.equal(classify(tricky).status, 'AUTO_CURRENT');
  });
});

describe('language views', () => {
  const sources = [
    { id: 'agents', data: { title: '智能体专题', description: '综述', contentType: 'overview', published: '2026-11-01' }, body: '', filePath: 'src/content/notes/agents.md' },
    { id: 'agent-loop', data: { title: '智能体循环', description: '中文摘要', series: 'agents', order: 20, published: '2026-11-03' }, body: '正文 [[react]]', filePath: 'src/content/notes/agent-loop.md' },
    { id: 'react', data: { title: 'ReAct 模式', description: '中文', series: 'agents', order: 10, published: '2026-11-02' }, body: '正文', filePath: 'src/content/notes/react.md' },
  ];
  const editions = new Map([
    ['agents', { id: 'agents', data: { title: 'Agents series', description: 'Overview' }, body: '', filePath: 'src/content/notes-en/agents.md' }],
    ['agent-loop', { id: 'agent-loop', data: { title: 'The Agent Loop', description: 'English summary' }, body: 'Body [[react]] and [[agents]]', filePath: 'src/content/notes-en/agent-loop.md' }],
  ]);

  test('Chinese and English share logical ids; English replaces only the language fields', () => {
    const en = localizeNotes(sources, 'en', editions);
    const zh = localizeNotes(sources, 'zh', editions);
    assert.deepEqual(en.notes.map((n) => n.id), sources.map((n) => n.id));
    assert.deepEqual(zh.notes.map((n) => n.id), sources.map((n) => n.id));
    const loop = en.notesById.get('agent-loop')!;
    assert.equal(loop.data.title, 'The Agent Loop');
    assert.equal(loop.data.description, 'English summary');
    assert.equal(loop.data.series, 'agents', 'structure comes from the Chinese source');
    assert.equal(loop.data.order, 20);
    assert.equal(loop.contentLang, 'en');
    assert.equal(loop.contentEntry, editions.get('agent-loop'));
    assert.equal(loop.filePath, 'src/content/notes-en/agent-loop.md');
    assert.equal(zh.notesById.get('agent-loop')!.data.title, '智能体循环');
    // No English edition (dev only): Chinese text, flagged as such.
    const react = en.notesById.get('react')!;
    assert.equal(react.contentLang, 'zh');
    assert.equal(react.data.title, 'ReAct 模式');
  });

  test('series contents: order from the Chinese source, titles in the page language', () => {
    const ids = new Map([['agents', seriesMembers(sources.map((s) => ({ id: s.id, ...s.data })) as never[], 'agents').map((m: { id: string }) => m.id)]]);
    assert.deepEqual(ids.get('agents'), ['react', 'agent-loop']);
    const en = localizeSeries(ids, localizeNotes(sources, 'en', editions).notesById);
    const zh = localizeSeries(ids, localizeNotes(sources, 'zh', editions).notesById);
    assert.deepEqual(en.get('agents')!.map((n) => n.data.title), ['ReAct 模式', 'The Agent Loop']);
    assert.deepEqual(zh.get('agents')!.map((n) => n.data.title), ['ReAct 模式', '智能体循环']);
  });

  test('graph: one node per logical note, English names on English pages, relations from the Chinese source only', () => {
    const graph = buildGraph(
      sources.map((s) => ({
        id: s.id,
        title: s.data.title,
        labels: titleLabels(s, editions.get(s.id)),
        section: 'knowledge',
        contentType: s.id === 'agents' ? ('overview' as const) : ('note' as const),
        series: (s.data as { series?: string }).series,
        related: [],
        topics: [],
        body: s.body,
      })),
    );
    assert.equal(graph.nodes.length, 3, 'English editions add no nodes');
    const href = (l: string, p: string) => `/${l}${p}`;
    const en = localizeGraph(graph, 'en', href);
    const zh = localizeGraph(graph, 'zh', href);
    assert.equal(en.nodes.find((n) => n.id === noteNodeId('agent-loop'))!.label, 'The Agent Loop');
    assert.equal(en.nodes.find((n) => n.id === noteNodeId('agent-loop'))!.href, '/en/notes/agent-loop/');
    assert.equal(zh.nodes.find((n) => n.id === noteNodeId('agent-loop'))!.label, '智能体循环');
    assert.equal(en.nodes.find((n) => n.id === noteNodeId('react'))!.label, 'ReAct 模式', 'falls back to Chinese');
    // The English body links to [[agents]], the Chinese one does not: no links_to edge for it.
    assert.equal(graph.edges.some((e) => e.kind === 'links_to' && e.target === noteNodeId('agents')), false);
    assert.equal(graph.edges.filter((e) => e.kind === 'links_to').length, 1);
  });

  test('one publish activity per logical note, whatever its languages', () => {
    const events = buildActivityEvents({ notes: sources.map((s) => ({ id: s.id, title: s.data.title, published: s.data.published })) });
    assert.equal(events.filter((e) => e.type === 'publish').length, sources.length);
    assert.equal(localizeNotes(sources, 'en', editions).notes.length, sources.length);
  });
});
