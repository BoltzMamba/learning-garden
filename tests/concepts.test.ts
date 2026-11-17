/** Concept Registry: validation, Markdown rendering, whole-site checks, translation and graph boundaries. */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { unified, type RemarkPlugin } from '@astrojs/markdown-remark';
import { markdownProcessorOptions, shikiConfig } from '../src/lib/markdown.ts';
import remarkConcepts from '../src/lib/remark-concepts.ts';
import { parseRegistry, scanConceptMarkup, topLevelKeys } from '../src/lib/concepts.ts';
import { checkConcepts, headingIds } from '../src/lib/concepts-check.ts';
import { classifyTranslation, hashContent, serializeEnglish } from '../src/lib/translation.ts';
import { extractNoteLinks, makeResolver } from '../src/lib/links.ts';
import { buildGraph } from '../src/lib/graph.ts';
import { placeCard } from '../src/scripts/concept-card.ts';

const entry = (over: Record<string, unknown> = {}) => ({
  zh: { term: '上下文', aliases: ['LLM 上下文'], definition: '模型在当前一次推理中能够直接访问的信息，例如系统指令、对话内容和工具结果。' },
  en: { term: 'Context', aliases: ['LLM context'], definition: 'Information directly available to a model during its current inference, such as instructions, conversation content and tool results.' },
  source: { note: 'what-is-agent', anchor: 'llm-context' },
  ...over,
});
const REGISTRY = {
  'llm-context': entry(),
  'react-context': entry({
    zh: { term: 'React Context', definition: 'React 中在组件树里共享数据、无需逐层传递 props 的机制。' },
    en: { term: 'Context', aliases: ['React Context'], definition: 'A React mechanism for sharing data across a component tree without passing props at every level.' },
    source: { note: 'react-notes', anchor: 'react-context' },
  }),
};

describe('registry validation', () => {
  test('a valid registry; the same name in different contexts is two concepts (warning only)', () => {
    const r = parseRegistry(REGISTRY, JSON.stringify(REGISTRY));
    assert.deepEqual(r.errors, []);
    assert.deepEqual([...r.concepts.keys()], ['llm-context', 'react-context']);
    assert.ok(r.warnings.some((w) => /en name "context" is shared by llm-context, react-context/.test(w)));
    assert.deepEqual(parseRegistry({}).errors, [], 'empty registry is fine');
  });

  test('missing languages, terms and definitions are errors', () => {
    const cases: [unknown, RegExp][] = [
      [{ a: entry({ en: undefined }) }, /"a"\.en: required/],
      [{ a: entry({ zh: { term: '上下文', definition: '' } }) }, /"a"\.zh\.definition: required/],
      [{ a: entry({ en: { definition: 'x' } }) }, /"a"\.en\.term: required/],
      [{ a: entry({ source: undefined }) }, /"a"\.source: required/],
      [{ a: entry({ source: { note: 'x', anchor: 'Bad Anchor' } }) }, /source\.anchor/],
      [{ 'Bad Id': entry() }, /lowercase words/],
      [{ a: entry({ extra: 1 }) }, /"a"\.extra: unknown field/],
      [[], /must be a JSON object/],
    ];
    for (const [data, reason] of cases) {
      const r = parseRegistry(data);
      assert.match(r.errors.join(' | '), reason);
      assert.equal(r.concepts.size, 0);
    }
  });

  test('duplicate ids (which JSON.parse would silently merge) are reported', () => {
    const text = '{\n  "llm-context": {"zh": {"term": "a"}},\n  "llm-context": {"zh": {"term": "b"}}\n}';
    assert.deepEqual(topLevelKeys(text), ['llm-context', 'llm-context']);
    assert.match(parseRegistry(JSON.parse(text), text).errors.join(' '), /duplicate concept id/);
  });

  test('repeated aliases inside one concept are errors; two concepts sharing a source anchor too', () => {
    const r = parseRegistry({ a: entry({ en: { term: 'Context', aliases: ['context', 'X'], definition: 'd' } }) });
    assert.match(r.errors.join(' '), /"context" is listed twice/);
    const shared = parseRegistry({ a: entry(), b: entry() });
    assert.match(shared.errors.join(' '), /already the source of "a"/);
  });

  test('long definitions only warn', () => {
    const long = 'x'.repeat(120);
    const r = parseRegistry({ a: entry({ zh: { term: 't', definition: long } }) });
    assert.deepEqual(r.errors, []);
    assert.match(r.warnings.join(' '), /"a"\.zh\.definition: 120 characters/);
  });
});

// ------------------------------------------------------------------ rendering

const dir = mkdtempSync(path.join(tmpdir(), 'concepts-'));
const registryFile = path.join(dir, 'concepts.json');
writeFileSync(registryFile, JSON.stringify(REGISTRY));
const renderer = await unified({
  ...markdownProcessorOptions,
  remarkPlugins: markdownProcessorOptions.remarkPlugins!.map((p) => (p === (remarkConcepts as unknown) ? ([remarkConcepts, { registryFile }] as unknown as RemarkPlugin) : p)),
}).createRenderer({ shikiConfig });
let warnings: string[] = [];
const originalWarn = console.warn;
before(() => (console.warn = (...a: unknown[]) => warnings.push(a.join(' '))));
after(() => {
  console.warn = originalWarn;
  rmSync(dir, { recursive: true, force: true });
});
const REPO = path.resolve(import.meta.dirname, '..');
async function render(md: string, file = 'src/content/notes/sample.md') {
  warnings = [];
  const out = await renderer.render(md, { fileURL: pathToFileURL(path.join(REPO, file)) });
  return { html: out.code, headings: out.metadata.headings, warnings: [...warnings] };
}
const span = (id: string, text: string) => `<span class="concept" data-concept="${id}">${text}</span>`;

describe('concept markup', () => {
  test('a reference keeps its visible text and carries only the id', async () => {
    const { html } = await render('Agent 的行为受到 :concept[Context]{id="llm-context"} 的影响。');
    assert.equal(html, `<p>Agent 的行为受到 ${span('llm-context', 'Context')} 的影响。</p>`);
  });

  test('an empty label shows the term in the file language', async () => {
    assert.equal((await render(':concept{id="llm-context"}')).html, `<p>${span('llm-context', '上下文')}</p>`);
    assert.equal((await render(':concept{id="llm-context"}', 'src/content/notes-en/sample.md')).html, `<p>${span('llm-context', 'Context')}</p>`);
  });

  test('lists, block quotes, table cells; repeated references all render', async () => {
    const { html } = await render(
      ['- 列表 :concept[上下文]{id="llm-context"}', '', '> 引用 :concept[Context]{id="react-context"}', '', '| a |', '|---|', '| :concept[上下文]{id="llm-context"} 与 :concept[上下文]{id="llm-context"} |'].join('\n'),
    );
    assert.match(html, new RegExp(`<li>列表 ${span('llm-context', '上下文')}</li>`));
    assert.match(html, new RegExp(`<blockquote>\\s*<p>引用 ${span('react-context', 'Context')}</p>`));
    assert.equal((html.match(/data-concept="llm-context"/g) ?? []).length, 3);
  });

  test('code blocks, inline code and math are untouched', async () => {
    const { html } = await render('```md\n:concept[x]{id="nope"}\n```\n\n`:concept[x]{id="nope"}` and $a:b$\n\n$$\nf:concept\n$$');
    assert.doesNotMatch(html, /class="concept"/);
    assert.match(html, /<code>:concept\[x\]\{id="nope"\}<\/code>/);
  });

  test('coexists with wikilinks, highlights and text colours', async () => {
    const { html } = await render('==:concept[上下文]{id="llm-context"} 见 [[how-this-garden-works|指南]]== 和 :ink[:concept[Context]{id="react-context"}]{color="blue"}');
    assert.match(html, new RegExp(`<mark class="hl hl-yellow">${span('llm-context', '上下文')} 见 <a href="\\.\\./how-this-garden-works/" class="wikilink">指南</a></mark>`));
    assert.match(html, new RegExp(`<span class="ink ink-blue">${span('react-context', 'Context')}</span>`));
  });

  test('unknown ids, name-only references and extra attributes fail the build with the file name', async () => {
    await assert.rejects(render(':concept[Context]{id="no-such"}'), /sample\.md:1: :concept id "no-such" is not in src\/data\/concepts\.json/);
    await assert.rejects(render(':concept[Context]'), /:concept id "" is not in/);
    await assert.rejects(render(':concept[Context]{id="llm-context" style="color:red"}'), /only accepts an id \(got style\)/);
    await assert.rejects(render(':concept[Context]{id="llm-context" .evil}'), /only accepts an id \(got class\)/);
  });

  test(':dfn renders a stable anchor; malformed anchors fail', async () => {
    const { html } = await render('## 什么是上下文\n\n:dfn[上下文]{#llm-context}是模型能直接访问的信息。');
    assert.match(html, /<h2 id="什么是上下文">什么是上下文<\/h2>/);
    assert.match(html, /<dfn id="llm-context" class="concept-def">上下文<\/dfn>是/);
    assert.equal((await render(':dfn[ctx]{id="llm-context"}')).html, '<p><dfn id="llm-context" class="concept-def">ctx</dfn></p>');
    await assert.rejects(render(':dfn[上下文]{#Bad_Anchor}'), /stable anchor/);
    await assert.rejects(render(':dfn[]{#llm-context}'), /needs the defined term/);
  });

  test('in headings the markup is unwrapped, so heading ids stay plain', async () => {
    const { html, headings, warnings: w } = await render('## 关于 :concept[上下文]{id="llm-context"}');
    assert.equal(html, '<h2 id="关于-上下文">关于 上下文</h2>');
    assert.equal(headings[0].slug, '关于-上下文');
    assert.equal(w.length, 1);
  });
});

// ------------------------------------------------------------ whole-site check

function garden(files: Record<string, string>) {
  const root = mkdtempSync(path.join(tmpdir(), 'concept-garden-'));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  return root;
}
const zhNote = (body: string) => `---\ntitle: "T"\ndescription: "D"\ncategory: "knowledge"\npublished: "2026-11-18"\n---\n\n${body}\n`;
const enNote = (body: string) => `---\ntitle: "T"\ndescription: "D"\ntranslation:\n  mode: manual\n  sourceHash: "sha256:${'0'.repeat(64)}"\n---\n\n${body}\n`;
const ONE = { 'llm-context': entry() };

describe('whole-site concept check', () => {
  const check = (files: Record<string, string>) => {
    const root = garden(files);
    try {
      return checkConcepts(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };

  test('valid: source and anchor in both languages, references resolve', () => {
    const r = check({
      'src/data/concepts.json': JSON.stringify(ONE),
      'src/content/notes/what-is-agent.md': zhNote(':dfn[上下文]{#llm-context}是……'),
      'src/content/notes-en/what-is-agent.md': enNote(':dfn[Context]{#llm-context} is …'),
      'src/content/notes/other.md': zhNote('受 :concept[上下文]{id="llm-context"} 影响'),
    });
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.referencedBy.get('other'), ['llm-context']);
  });

  test('no registry file, or an empty one, and notes without concepts are fine', () => {
    assert.deepEqual(check({ 'src/content/notes/a.md': zhNote('plain') }).errors, []);
    assert.deepEqual(check({ 'src/data/concepts.json': '{}', 'src/content/notes/a.md': zhNote('plain') }).errors, []);
  });

  test('missing source note, missing anchors (zh or en), unknown references', () => {
    assert.match(check({ 'src/data/concepts.json': JSON.stringify(ONE) }).errors.join(' '), /note "what-is-agent" does not exist/);
    assert.match(
      check({ 'src/data/concepts.json': JSON.stringify(ONE), 'src/content/notes/what-is-agent.md': zhNote('没有锚点') }).errors.join(' '),
      /notes\/what-is-agent\.md has no :dfn\[…\]\{#llm-context\}/,
    );
    assert.match(
      check({
        'src/data/concepts.json': JSON.stringify(ONE),
        'src/content/notes/what-is-agent.md': zhNote(':dfn[上下文]{#llm-context}'),
        'src/content/notes-en/what-is-agent.md': enNote('Context is … (anchor forgotten)'),
      }).errors.join(' '),
      /notes-en\/what-is-agent\.md has no :dfn\[…\]\{#llm-context\}; both languages need the same anchor/,
    );
    assert.match(check({ 'src/content/notes-en/x.md': enNote(':concept[x]{id="ghost"}') }).errors.join(' '), /notes-en\/x\.md: :concept id "ghost"/);
  });

  test('anchors must be unique and must not collide with heading ids', () => {
    assert.deepEqual(headingIds('## Memory\n\n## Memory\n\n```\n## not a heading\n```'), ['memory', 'memory-1']);
    const r = check({ 'src/content/notes/a.md': zhNote('## Memory\n\n:dfn[m]{#memory} :dfn[x]{#x} :dfn[y]{#x}') });
    assert.match(r.errors.join(' '), /#memory collides with a heading id/);
    assert.match(r.errors.join(' '), /#x is defined more than once/);
  });

  test('scanning ignores code and math', () => {
    assert.deepEqual(scanConceptMarkup('`:concept[x]{id="a"}`\n\n```\n:dfn[y]{#b}\n```\n\n:concept[z]{id="c"} :dfn[w]{#d}'), { references: ['c'], anchors: ['d'] });
  });
});

describe('translation and graph boundaries', () => {
  const zh = zhNote('Agent 需要管理 :concept[上下文]{id="llm-context"}。');
  const autoEn = (body: string) => {
    const content = { title: 'T', description: 'D', body };
    const sourceHash = classifyTranslation({ id: 'n', zhText: zh, refs: [] }).sourceHash!;
    return serializeEnglish({ ...content, translation: { mode: 'auto', sourceHash, generatedHash: hashContent(content), rulesVersion: 1 } });
  };

  test('auto translations keep concept ids (the label is translated)', () => {
    assert.equal(classifyTranslation({ id: 'n', zhText: zh, enText: autoEn('An agent must manage its :concept[context]{id="llm-context"}.'), refs: [] }).status, 'AUTO_CURRENT');
    const dropped = classifyTranslation({ id: 'n', zhText: zh, enText: autoEn('An agent must manage its context.'), refs: [] });
    assert.equal(dropped.status, 'INVALID');
    assert.match(dropped.reasons.join(' '), /:concept\[…\]\{id="llm-context"\} references: Chinese has 1, English has 0/);
    const swapped = classifyTranslation({ id: 'n', zhText: zh, enText: autoEn('… :concept[context]{id="react-context"}.'), refs: [] });
    assert.equal(swapped.status, 'INVALID');
  });

  test('concept markup creates no graph edges', () => {
    const body = 'Uses :concept[上下文]{id="llm-context"} and :dfn[x]{#x}.';
    assert.deepEqual(extractNoteLinks(body, 'a', makeResolver([{ id: 'what-is-agent', title: 'W' }])).targets, []);
    const g = buildGraph([
      { id: 'a', title: 'A', section: 'knowledge', contentType: 'note', related: [], topics: [], body },
      { id: 'what-is-agent', title: 'W', section: 'knowledge', contentType: 'note', related: [], topics: [], body: ':dfn[上下文]{#llm-context}' },
    ]);
    assert.equal(g.edges.length, 0);
    assert.equal(g.nodes.length, 2);
  });
});

describe('card placement', () => {
  const vp = { width: 390, height: 800 };
  const card = { width: 300, height: 120 };
  const term = (top: number, left: number, w = 60) => ({ top, left, bottom: top + 20, right: left + w });

  test('below the term when there is room, above near the bottom edge', () => {
    assert.deepEqual(placeCard([term(100, 20)], card, vp), { top: 126, left: 20, side: 'below' });
    assert.deepEqual(placeCard([term(740, 20)], card, vp), { top: 614, left: 20, side: 'above' });
  });

  test('clamped inside the viewport horizontally; a wrapped term uses its last line below', () => {
    assert.equal(placeCard([term(100, 350)], card, vp).left, 82);
    assert.equal(placeCard([term(100, -5)], card, vp).left, 8);
    assert.equal(placeCard([term(100, 300), term(124, 16)], card, vp).top, 150);
  });
});
