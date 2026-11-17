/** Colour marks: rendered through the site's real Markdown pipeline (src/lib/markdown.ts). */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { unified } from '@astrojs/markdown-remark';
import { markdownProcessorOptions, shikiConfig } from '../src/lib/markdown.ts';
import { HIGHLIGHT_COLORS, INK_COLORS } from '../src/lib/remark-marks.ts';
import { classifyTranslation, countMarks, hashContent, serializeEnglish } from '../src/lib/translation.ts';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const renderer = await unified(markdownProcessorOptions).createRenderer({ shikiConfig });
let warnings: string[] = [];
const originalWarn = console.warn;
before(() => {
  console.warn = (...args: unknown[]) => warnings.push(args.join(' '));
});
after(() => {
  console.warn = originalWarn;
});

async function render(md: string, file = 'src/content/notes/sample.md') {
  warnings = [];
  const out = await renderer.render(md, { fileURL: pathToFileURL(path.join(REPO, file)) });
  return { html: out.code, headings: out.metadata.headings, warnings: [...warnings] };
}
const marks = (html: string) => [...html.matchAll(/<(mark|span) class="((?:hl|ink)[^"]*)">([\s\S]*?)<\/\1>/g)].map((m) => [m[1], m[2], m[3]]);

describe('highlight syntax', () => {
  test('==text== is a yellow highlight, identical to :hl[…]{color="yellow"}', async () => {
    const short = await render('Flow Matching 中，==velocity 是模型学习的核心目标==。');
    const long = await render('Flow Matching 中，:hl[velocity 是模型学习的核心目标]{color="yellow"}。');
    assert.equal(short.html, '<p>Flow Matching 中，<mark class="hl hl-yellow">velocity 是模型学习的核心目标</mark>。</p>');
    assert.equal(long.html, short.html);
  });

  test('all five highlight colours', async () => {
    for (const color of HIGHLIGHT_COLORS) {
      const { html } = await render(`:hl[结论]{color="${color}"}`);
      assert.equal(html, `<p><mark class="hl hl-${color}">结论</mark></p>`);
    }
    assert.equal((await render(':hl[无颜色]')).html, '<p><mark class="hl hl-yellow">无颜色</mark></p>', 'defaults to yellow');
  });

  test('all five text colours', async () => {
    for (const color of INK_COLORS) {
      const { html } = await render(`:ink[文字]{color="${color}"}`);
      assert.equal(html, `<p><span class="ink ink-${color}">文字</span></p>`);
    }
    assert.equal((await render(':ink[x]')).html, '<p><span class="ink ink-default">x</span></p>');
  });

  test('emphasis, links and inline code inside a highlight', async () => {
    const { html } = await render('==这是 **非常重要** 的 *内容*，见 [文档](https://example.com/a==b) 与 `x==y`==');
    assert.equal(
      html,
      '<p><mark class="hl hl-yellow">这是 <strong>非常重要</strong> 的 <em>内容</em>，见 <a href="https://example.com/a==b">文档</a> 与 <code>x==y</code></mark></p>',
    );
  });

  test('marks nest: a text colour inside a highlight and vice versa', async () => {
    const { html } = await render(':hl[注意 :ink[风险]{color="red"} 部分]{color="blue"} 与 :ink[==重点==]{color="gray"}');
    assert.deepEqual(marks(html).map(([tag, cls]) => [tag, cls]), [
      ['mark', 'hl hl-blue'],
      ['span', 'ink ink-gray'],
    ]);
    assert.match(html, /<mark class="hl hl-blue">注意 <span class="ink ink-red">风险<\/span> 部分<\/mark>/);
    assert.match(html, /<span class="ink ink-gray"><mark class="hl hl-yellow">重点<\/mark><\/span>/);
  });

  test('lists, block quotes and table cells', async () => {
    const { html } = await render(
      ['- 列表 ==高亮==', '', '> 引用 :ink[说明]{color="gray"}', '', '| A | B |', '|---|---|', '| ==c== | :hl[d]{color="green"} |'].join('\n'),
    );
    assert.match(html, /<li>列表 <mark class="hl hl-yellow">高亮<\/mark><\/li>/);
    assert.match(html, /<blockquote>\s*<p>引用 <span class="ink ink-gray">说明<\/span><\/p>/);
    assert.match(html, /<td><mark class="hl hl-yellow">c<\/mark><\/td>\s*<td><mark class="hl hl-green">d<\/mark><\/td>/);
  });

  test('mixed Chinese and English text', async () => {
    const { html } = await render('在 Agent Loop 中，==模型会反复决定 next action==，而 :ink[Observation 是输入]{color="blue"}。');
    assert.deepEqual(marks(html).map(([, , text]) => text), ['模型会反复决定 next action', 'Observation 是输入']);
  });
});

describe('what never becomes a mark', () => {
  test('code blocks, inline code and math keep their == untouched', async () => {
    const { html } = await render('```js\nif (a == b && c==d) return ==x==;\n```\n\n`a==b==c` and $a==b$ and\n\n$$\nx == y\n$$');
    assert.doesNotMatch(html, /<mark/);
    assert.match(html, /<code>a==b==c<\/code>/);
    assert.equal((html.match(/class="katex"/g) ?? []).length, 2, 'both formulas still render');
  });

  test('single =, spaced comparisons, ===, unpaired and escaped == stay text', async () => {
    for (const md of ['x = 1', 'a == b', 'a === b', '==unclosed', 'closed==', '\\==not a mark==', '== 空格 ==']) {
      const { html } = await render(md);
      assert.doesNotMatch(html, /<mark/, md);
    }
  });

  test('a highlight never spans paragraphs; empty marks are dropped', async () => {
    assert.equal((await render('==第一段\n\n第二段==')).html, '<p>==第一段</p>\n<p>第二段==</p>');
    const empty = await render('前 :hl[]{color="red"} 后 :ink[ ]{color="blue"}');
    assert.doesNotMatch(empty.html, /<mark|<span class="ink/);
    assert.equal(empty.warnings.length, 2);
  });

  test('other ":name" text is restored exactly (directives are not enabled for anything else)', async () => {
    const md = 'key:value, Note:abc, a:b:c, 10:30, C:\\path, :smile: and :other[label]{x="1"}';
    const { html } = await render(md);
    assert.equal(html, `<p>${md.replace('C:\\path', 'C:\\path')}</p>`.replace('C:\\path', 'C:\\path'));
  });

  test('invalid colours and extra attributes render plain text, never pass through', async () => {
    const { html, warnings: w } = await render(
      ':hl[a]{color="purple"} :hl[b]{color="#ff0000"} :ink[c]{style="color:red"} :ink[d]{color="red" onclick="x()"} :hl[e]{.evil #id}',
    );
    assert.equal(html, '<p>a b c d e</p>');
    assert.equal(w.length, 5);
    assert.doesNotMatch(html, /style=|onclick|evil|#ff0000/);
  });

  test('malformed attribute syntax stays visible text and never becomes an HTML attribute', async () => {
    const { html } = await render(':hl[f]{color="red\\" onmouseover=\\"x"}');
    assert.match(html, /^<p><mark class="hl hl-yellow">f<\/mark>\{color=/);
    assert.doesNotMatch(html, /<[^>]+onmouseover/);
  });

  test('HTML inside a label is treated exactly as Markdown inline HTML elsewhere (marks add no capability)', async () => {
    const inside = await render(':hl[<kbd>Ctrl</kbd>]{color="red"}');
    const plain = await render('<kbd>Ctrl</kbd>');
    assert.equal(inside.html, plain.html.replace('<p>', '<p><mark class="hl hl-red">').replace('</p>', '</mark></p>'));
  });

  test('marks in headings become plain heading text, so ids and the table of contents are unchanged', async () => {
    const { html, headings, warnings: w } = await render('## 核心 ==结论== 与 :ink[概念]{color="blue"}');
    assert.equal(html, '<h2 id="核心-结论-与-概念">核心 结论 与 概念</h2>');
    assert.deepEqual(headings, [{ depth: 2, slug: '核心-结论-与-概念', text: '核心 结论 与 概念' }]);
    assert.equal(w.length, 2);
  });
});

describe('links', () => {
  test('wikilinks inside and around marks keep their target', async () => {
    const { html } = await render('==见 [[how-this-garden-works|指南]]== 和 :hl[[[how-this-garden-works]]]{color="blue"}');
    assert.match(html, /<mark class="hl hl-yellow">见 <a href="\.\.\/how-this-garden-works\/" class="wikilink">指南<\/a><\/mark>/);
    assert.match(html, /<mark class="hl hl-blue"><a href="\.\.\/how-this-garden-works\/" class="wikilink">[^<]+<\/a><\/mark>/);
  });

  test('English files: wikilinks inside marks get English titles', async () => {
    const { html } = await render('==see [[how-this-garden-works]]==', 'src/content/notes-en/sample.md');
    assert.match(html, /<mark class="hl hl-yellow">see <a href="\.\.\/how-this-garden-works\/" class="wikilink">Learning Garden Guide/);
  });

  test('== inside a link URL or title is not parsed', async () => {
    const { html } = await render('[a](https://x.test/?q==1== "t==x==") ==b==');
    assert.match(html, /href="https:\/\/x\.test\/\?q==1=="/);
    assert.match(html, /title="t==x=="/);
    assert.equal(marks(html).length, 1);
  });
});

describe('existing Markdown keeps working', () => {
  test('GFM, math, Shiki and wikilinks render as before', async () => {
    const { html } = await render(
      ['~~删~~ **粗** *斜*', '', '- [x] 任务', '', '$E = mc^2$', '', '```ts\nconst a = 1;\n```', '', '[[how-this-garden-works]]'].join('\n'),
    );
    assert.match(html, /<del>删<\/del>/);
    assert.match(html, /<strong>粗<\/strong>/);
    assert.match(html, /type="checkbox"/);
    assert.match(html, /class="katex"/);
    assert.match(html, /class="astro-code/);
    assert.match(html, /class="wikilink"/);
    assert.doesNotMatch(html, /<mark/);
  });
});

describe('CSS tokens', () => {
  const css = readFileSync(path.join(REPO, 'src/styles/global.css'), 'utf8');
  const block = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    return css.slice(start, css.indexOf('\n}', start));
  };
  const light = block(':root');
  const dark = block(":root[data-theme='dark']");
  const value = (scope: string, name: string, theme = scope) => {
    const raw = new RegExp(`--${name}:\\s*([^;]+);`).exec(scope)?.[1].trim();
    if (raw === 'var(--text)') return value(theme, 'text');
    return raw;
  };
  const tokens = [...INK_COLORS.map((c) => `ink-${c}`), ...HIGHLIGHT_COLORS.map((c) => `highlight-${c}`), 'highlight-foreground'];

  test('every token is defined for light and dark, and every class has a rule', () => {
    for (const t of tokens) {
      assert.ok(value(light, t), `light --${t}`);
      assert.ok(value(dark, t), `dark --${t}`);
    }
    for (const c of INK_COLORS) assert.match(css, new RegExp(`\\.prose \\.ink-${c} \\{ --ink-color: var\\(--ink-${c}\\); \\}`));
    for (const c of HIGHLIGHT_COLORS) assert.match(css, new RegExp(`\\.prose \\.hl-${c} \\{ --hl-bg: var\\(--highlight-${c}\\);`));
    const rules = css.slice(css.indexOf('/* Article marks (src/lib'), css.indexOf('/* Shiki dual themes'));
    assert.ok(rules.length > 0);
    assert.doesNotMatch(rules, /!important/);
  });

  const lum = (hex: string) => {
    const [r, g, b] = hex.replace('#', '').match(/../g)!.map((x) => parseInt(x, 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a: string, b: string) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };

  for (const [name, scope] of [['light', light], ['dark', dark]] as const) {
    test(`${name}: text colours and highlighted text meet WCAG AA (4.5:1)`, () => {
      const bg = value(scope, 'bg')!;
      for (const c of INK_COLORS) {
        const r = ratio(value(scope, `ink-${c}`)!, bg);
        assert.ok(r >= 4.5, `ink-${c} on bg: ${r.toFixed(2)}`);
      }
      const fg = value(scope, 'highlight-foreground')!;
      for (const c of HIGHLIGHT_COLORS) {
        const r = ratio(fg, value(scope, `highlight-${c}`)!);
        assert.ok(r >= 4.5, `text on highlight-${c}: ${r.toFixed(2)}`);
      }
    });
  }
});

describe('translation keeps colour marks', () => {
  const zhBody = '在 Agent Loop 中，==模型会反复决定下一步行动==。\n\n:hl[工具调用失败需要处理]{color="red"}\n\n:ink[Observation 是下一轮推理的输入]{color="blue"}';
  const zh = `---\ntitle: "循环"\ndescription: "说明"\ncategory: "knowledge"\npublished: "2026-11-18"\n---\n\n${zhBody}\n`;
  const sourceHash = () => classifyTranslation({ id: 'n', zhText: zh, refs: [] }).sourceHash!;
  const en = (body: string) => {
    const content = { title: 'Loop', description: 'About', body };
    return serializeEnglish({ ...content, translation: { mode: 'auto', sourceHash: sourceHash(), generatedHash: hashContent(content), rulesVersion: 1 } });
  };
  const good = 'In an agent loop, ==the model repeatedly decides what to do next==.\n\n:hl[Tool execution failures must be handled]{color="red"}\n\n:ink[Observations become inputs to the next reasoning step]{color="blue"}';

  test('counts marks by kind and colour, ignoring code and math', () => {
    assert.deepEqual(countMarks(zhBody), { '==': 1, 'hl:red': 1, 'ink:blue': 1 });
    assert.deepEqual(countMarks('$a==b$ and $$\nx==y\n$$'), {});
  });

  test('a faithful translation is current; a dropped or recoloured mark is INVALID', () => {
    assert.equal(classifyTranslation({ id: 'n', zhText: zh, enText: en(good), refs: [] }).status, 'AUTO_CURRENT');
    const dropped = classifyTranslation({ id: 'n', zhText: zh, enText: en(good.replace(/==/g, '')), refs: [] });
    assert.equal(dropped.status, 'INVALID');
    assert.match(dropped.reasons.join(' '), /==…== highlights: Chinese has 1, English has 0/);
    const recoloured = classifyTranslation({ id: 'n', zhText: zh, enText: en(good.replace('color="red"', 'color="pink"')), refs: [] });
    assert.equal(recoloured.status, 'INVALID');
    assert.match(recoloured.reasons.join(' '), /:hl\[…\]\{color="red"\} marks: Chinese has 1, English has 0/);
  });

  test('changing a mark in the Chinese source changes the source hash', () => {
    const plain = classifyTranslation({ id: 'n', zhText: zh.replace(/==/g, ''), refs: [] }).sourceHash;
    assert.notEqual(plain, sourceHash());
  });
});
