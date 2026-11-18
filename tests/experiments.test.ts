/** Learning Experiments: schema, cross-references, what pages show, and translation tracking (synthetic data only). */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  experimentSchema,
  isShowcased,
  localizeExperiment,
  noteExperiments,
  projectTierOf,
  showcasedExperiments,
  unpublishedProjectIds,
  validateExperiments,
  type Experiment,
  type ExperimentNoteInput,
} from '../src/lib/experiments.ts';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { classifyTranslation, hashContent, serializeEnglish } from '../src/lib/translation.ts';
import { scanTranslations } from '../src/lib/translation-check.ts';

const bi = (zh: string, en: string) => ({ zh, en });
const exp = (id: string, over: Partial<Experiment> = {}): Experiment => ({
  id,
  category: 'agent-learning',
  status: 'planned',
  public: true,
  title: bi(`实验 ${id}`, `Experiment ${id}`),
  description: bi('中文简介', 'English summary'),
  requirements: [bi('实现循环', 'Implement the loop')],
  links: [],
  ...over,
});
const note = (id: string, over: Partial<ExperimentNoteInput> = {}): ExperimentNoteInput => ({
  id,
  file: `src/content/notes/${id}.md`,
  section: 'knowledge',
  experiments: [],
  ...over,
});
const project = (id: string, experimentId: string, sourceNote: string, over: Partial<ExperimentNoteInput> = {}) =>
  note(id, { section: 'projects', projectTier: 'experiment', experimentId, sourceNote, ...over });
const CODE = { kind: 'code' as const, url: 'https://github.com/example/minimal-agent' };
const errorsOf = (entries: ExperimentNoteInput[]) => validateExperiments(entries).errors;

describe('experiment schema (one entry)', () => {
  const raw = {
    id: 'minimal-react-agent',
    category: 'agent-learning',
    status: 'planned',
    public: true,
    title: { zh: '从零实现最小 ReAct Agent', en: 'Build a Minimal ReAct Agent' },
    description: { zh: '不依赖框架。', en: 'Without an agent framework.' },
    requirements: [{ zh: '实现 Agent Loop', en: 'Implement the agent loop' }],
  };
  const fails = (over: Record<string, unknown>) => !experimentSchema.safeParse({ ...raw, ...over }).success;

  test('accepts the documented shape; links default to none', () => {
    const parsed = experimentSchema.parse(raw);
    assert.deepEqual(parsed.links, []);
  });

  test('rejects bad ids, statuses, categories and visibility', () => {
    for (const id of ['Minimal', 'a_b', 'a--b', '-a', '']) assert.ok(fails({ id }), id);
    assert.ok(fails({ status: 'done' }));
    assert.ok(fails({ category: 'ai-agent' }), 'topics are not experiment categories');
    assert.ok(fails({ public: 'yes' }));
    const { public: _p, ...noPublic } = raw;
    assert.ok(!experimentSchema.safeParse(noPublic).success, 'public is explicit');
  });

  test('requires both languages for every visible text and at least one requirement', () => {
    assert.ok(fails({ title: { zh: '标题' } }), 'missing en');
    assert.ok(fails({ title: { zh: '标题', en: '   ' } }), 'blank en');
    assert.ok(fails({ description: { en: 'only English' } }));
    assert.ok(fails({ requirements: [] }));
    assert.ok(fails({ requirements: [{ zh: '只有中文' }] }));
    assert.ok(fails({ title: { zh: '标题', en: 'Title', fr: 'Titre' } }), 'unknown language key');
    assert.ok(fails({ extra: 1 }), 'unknown field');
  });

  test('result links must be absolute http(s) URLs of a known kind', () => {
    assert.ok(!fails({ status: 'completed', links: [CODE] }));
    assert.ok(fails({ links: [{ kind: 'code', url: 'javascript:alert(1)' }] }));
    assert.ok(fails({ links: [{ kind: 'code', url: '../relative/' }] }));
    assert.ok(fails({ links: [{ kind: 'code', url: 'ftp://example.com/x' }] }));
    assert.ok(fails({ links: [{ kind: 'video', url: 'https://example.com' }] }));
  });
});

describe('validateExperiments (cross-references)', () => {
  test('notes without experiments are fine', () => {
    const r = validateExperiments([note('a'), note('b', { section: 'projects' })]);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.all, []);
  });

  test('a planned experiment needs no links and no project article', () => {
    const r = validateExperiments([note('agent-loop', { experiments: [exp('minimal-agent')] })]);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.warnings, []);
    assert.equal(r.byId.get('minimal-agent')?.noteId, 'agent-loop');
  });

  test('a completed experiment may have only result links', () => {
    const r = validateExperiments([note('agent-loop', { experiments: [exp('minimal-agent', { status: 'completed', links: [CODE] })] })]);
    assert.deepEqual(r.errors, []);
    assert.ok(isShowcased(r.byId.get('minimal-agent')!));
  });

  test('a completed experiment may have a project article, linked both ways', () => {
    const r = validateExperiments([
      note('agent-loop', { experiments: [exp('minimal-agent', { status: 'completed' })] }),
      project('minimal-agent-project', 'minimal-agent', 'agent-loop'),
    ]);
    assert.deepEqual(r.errors, []);
    assert.equal(r.byId.get('minimal-agent')?.projectId, 'minimal-agent-project');
    assert.equal(r.byProject.get('minimal-agent-project')?.id, 'minimal-agent');
  });

  test('duplicate ids, within a note and across notes', () => {
    assert.match(errorsOf([note('a', { experiments: [exp('x'), exp('x')] })]).join('\n'), /listed more than once in this note/);
    assert.match(
      errorsOf([note('a', { experiments: [exp('x')] }), note('b', { experiments: [exp('x')] })]).join('\n'),
      /already defined in src\/content\/notes\/a\.md; experiment ids are global/,
    );
  });

  test('invalid values that reach the validator are still reported', () => {
    const bad = exp('Bad_Id', { category: 'robots' as never, status: 'done' as never, requirements: [], title: bi('标题', '') });
    const errs = errorsOf([note('a', { experiments: [bad] })]).join('\n');
    assert.match(errs, /\.id: "Bad_Id"/);
    assert.match(errs, /\.category: "robots"/);
    assert.match(errs, /\.status: "done"/);
    assert.match(errs, /requirements: list at least one/);
    assert.match(errs, /\.title\.en: required/);
  });

  test('planned experiments cannot carry result links; links must be http(s)', () => {
    assert.match(errorsOf([note('a', { experiments: [exp('x', { links: [CODE] })] })]).join('\n'), /planned experiment has no results/);
    const bad = exp('x', { status: 'completed', links: [{ kind: 'demo', url: 'javascript:alert(1)' }] });
    assert.match(errorsOf([note('a', { experiments: [bad] })]).join('\n'), /absolute http\(s\) URL/);
  });

  test('project articles: missing experiment, wrong source note, double binding, self reference', () => {
    const base = note('agent-loop', { experiments: [exp('minimal-agent', { status: 'completed' })] });
    assert.match(errorsOf([base, project('p', 'ghost', 'agent-loop')]).join('\n'), /"ghost" is not defined/);
    assert.match(errorsOf([base, note('other'), project('p', 'minimal-agent', 'other')]).join('\n'), /defined in "agent-loop", not "other"/);
    assert.match(errorsOf([base, project('p', 'minimal-agent', 'nowhere')]).join('\n'), /sourceNote: "nowhere" does not exist/);
    assert.match(
      errorsOf([base, project('p1', 'minimal-agent', 'agent-loop'), project('p2', 'minimal-agent', 'agent-loop')]).join('\n'),
      /already has the project article "p1"/,
    );
    assert.match(errorsOf([base, project('p', 'minimal-agent', 'p')]).join('\n'), /is the project article itself/);
    assert.match(errorsOf([base, project('p', 'minimal-agent', undefined as never)]).join('\n'), /needs both experimentId and sourceNote/);
  });

  test('project articles cannot define experiments (no self-association)', () => {
    const errs = errorsOf([note('p', { section: 'projects', experiments: [exp('x')] })]).join('\n');
    assert.match(errs, /a project article cannot define experiments/);
  });

  test('featured projects are never treated as experiments', () => {
    const base = note('agent-loop', { experiments: [exp('minimal-agent', { status: 'completed' })] });
    const featured = note('big', { section: 'projects', experimentId: 'minimal-agent', sourceNote: 'agent-loop' });
    assert.match(errorsOf([base, featured]).join('\n'), /a featured project cannot document an experiment/);
    assert.match(errorsOf([base, { ...featured, projectTier: 'featured' }]).join('\n'), /featured project cannot/);
    assert.match(errorsOf([note('k', { projectTier: 'experiment' })]).join('\n'), /only project articles/);
    assert.equal(projectTierOf({}), 'featured');
    assert.equal(projectTierOf({ projectTier: 'experiment' }), 'experiment');
  });

  test('a project article cannot publish a non-public experiment', () => {
    const hidden = note('agent-loop', { experiments: [exp('minimal-agent', { status: 'completed', public: false })] });
    assert.match(errorsOf([hidden, project('p', 'minimal-agent', 'agent-loop')]).join('\n'), /is not public/);
  });

  test('warnings, not errors: unfinished experiment with an article; completed without results', () => {
    const r = validateExperiments([
      note('agent-loop', { experiments: [exp('wip', { status: 'in-progress' }), exp('done', { status: 'completed' })] }),
      project('p', 'wip', 'agent-loop'),
    ]);
    assert.deepEqual(r.errors, []);
    assert.match(r.warnings.join('\n'), /"wip" is in-progress/);
    assert.match(r.warnings.join('\n'), /"done" .* is completed but has no links and no project article/);
  });
});

describe('what pages show', () => {
  const index = validateExperiments([
    note('agent-loop', {
      experiments: [
        exp('planned-one'),
        exp('hidden', { public: false, status: 'completed', links: [CODE] }),
        exp('wip', { status: 'in-progress', links: [CODE] }),
        exp('with-links', { status: 'completed', links: [CODE], category: 'algorithms' }),
        exp('with-article', { status: 'completed' }),
        exp('no-result', { status: 'completed' }),
      ],
    }),
    note('plain'),
    project('article', 'with-article', 'agent-loop'),
  ]);

  test('note cards: none without experiments; all public ones in order; never private ones', () => {
    assert.equal(index.errors.length, 0);
    assert.deepEqual(noteExperiments(index, 'plain'), []);
    assert.deepEqual(
      noteExperiments(index, 'agent-loop').map((e) => e.id),
      ['planned-one', 'wip', 'with-links', 'with-article', 'no-result'],
    );
  });

  test('More Experiments: completed + public + a result only; category filter', () => {
    assert.deepEqual(showcasedExperiments(index).map((e) => e.id), ['with-links', 'with-article']);
    assert.deepEqual(showcasedExperiments(index, 'algorithms').map((e) => e.id), ['with-links']);
    assert.deepEqual(showcasedExperiments(index, 'ai-engineering'), []);
  });

  test('localized text: one language per page, never mixed', () => {
    const e = index.byId.get('with-article')!;
    const zh = localizeExperiment(e, 'zh');
    const en = localizeExperiment(e, 'en');
    assert.equal(zh.title, '实验 with-article');
    assert.equal(en.title, 'Experiment with-article');
    assert.deepEqual(en.requirements, ['Implement the loop']);
    assert.equal(en.projectId, 'article', 'a write-up link only when an article exists');
    assert.equal(localizeExperiment(index.byId.get('with-links')!, 'en').projectId, undefined);
    const custom = localizeExperiment(
      { ...index.byId.get('with-links')!, links: [{ ...CODE, label: bi('源码仓库', 'Source repository') }] },
      'en',
    );
    assert.deepEqual(custom.links, [{ kind: 'code', url: CODE.url, label: 'Source repository' }]);
  });

  test('requirements beyond the preview fold away; planned experiments never link anywhere', () => {
    const many = { ...exp('many'), noteId: 'n', requirements: [1, 2, 3, 4, 5, 6].map((i) => bi(`要求${i}`, `Req ${i}`)) };
    const local = localizeExperiment(many, 'en');
    assert.deepEqual(local.requirements, ['Req 1', 'Req 2', 'Req 3', 'Req 4']);
    assert.deepEqual(local.moreRequirements, ['Req 5', 'Req 6']);
    assert.deepEqual(localizeExperiment({ ...many, links: [CODE] }, 'zh').links, [], 'planned → no links');
  });
});

describe('experiment write-ups publish with their experiment', () => {
  const src = (id: string, data: Record<string, unknown>) => ({ id, data });
  const withStatus = (status: string) => src('agent-loop', { category: 'knowledge', experiments: [{ id: 'minimal-agent', status }] });
  const article = src('write-up', { category: 'projects', projectTier: 'experiment', experimentId: 'minimal-agent', sourceNote: 'agent-loop' });

  test('the article is a draft until the experiment is completed', () => {
    assert.deepEqual([...unpublishedProjectIds([withStatus('planned'), article])], ['write-up']);
    assert.deepEqual([...unpublishedProjectIds([withStatus('in-progress'), article])], ['write-up']);
    assert.deepEqual([...unpublishedProjectIds([withStatus('completed'), article])], []);
  });

  test('featured projects, ordinary notes and broken references are never hidden', () => {
    const featured = src('big', { category: 'projects' });
    const ghost = src('ghost-article', { category: 'projects', projectTier: 'experiment', experimentId: 'ghost' });
    assert.deepEqual([...unpublishedProjectIds([withStatus('planned'), featured, ghost, src('k', { category: 'knowledge' })])], []);
  });

  test('the card links to the write-up only once it is published', () => {
    const index = validateExperiments([
      note('agent-loop', { experiments: [exp('minimal-agent', { status: 'in-progress' })] }),
      project('write-up', 'minimal-agent', 'agent-loop'),
    ]);
    assert.equal(index.byId.get('minimal-agent')?.projectId, 'write-up', 'still bound and validated');
    assert.equal(localizeExperiment(index.byId.get('minimal-agent')!, 'zh').projectId, undefined);
    assert.equal(localizeExperiment({ ...index.byId.get('minimal-agent')!, status: 'completed' }, 'zh').projectId, 'write-up');
  });

  test('a draft without an English edition does not block the strict translation check', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'garden-drafts-'));
    try {
      const write = (id: string, fm: string) => {
        mkdirSync(path.join(root, 'src/content/notes'), { recursive: true });
        writeFileSync(path.join(root, 'src/content/notes', `${id}.md`), `---\ntitle: "${id}"\ndescription: "d"\n${fm}---\n\n正文\n`);
      };
      const loop = (status: string) =>
        `category: knowledge\nexperiments:\n  - { id: minimal-agent, status: ${status}, title: { zh: "a", en: "b" } }\n`;
      write('write-up', 'category: projects\nprojectTier: experiment\nexperimentId: minimal-agent\nsourceNote: agent-loop\n');
      write('agent-loop', loop('in-progress'));
      let scan = scanTranslations(root);
      assert.deepEqual(scan.drafts, ['write-up']);
      assert.deepEqual(scan.failures.map((f) => f.id), ['agent-loop'], 'only the published note needs English');
      write('agent-loop', loop('completed'));
      scan = scanTranslations(root);
      assert.deepEqual(scan.drafts, []);
      assert.deepEqual(scan.failures.map((f) => f.id), ['agent-loop', 'write-up'], 'once completed, the article needs English too');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('experiments and the translation pipeline', () => {
  const EXPERIMENTS = (title = '从零实现最小 Agent', en = 'Build a Minimal Agent', status = 'planned') =>
    [
      'experiments:',
      '  - id: minimal-agent',
      '    category: agent-learning',
      `    status: ${status}`,
      '    public: true',
      `    title: { zh: "${title}", en: "${en}" }`,
      '    description: { zh: "不依赖框架。", en: "Without a framework." }',
      '    requirements:',
      '      - { zh: "实现循环", en: "Implement the loop" }',
      '',
    ].join('\n');
  const zhFile = (extra = '') =>
    `---\ntitle: "智能体循环"\ndescription: "摘要"\ncategory: "knowledge"\ntags: []\npublished: "2026-11-10"\n${extra}---\n\n正文。\n`;
  const refs = [{ id: 'agent-loop', title: '智能体循环' }];
  const classify = (zhText: string, enText?: string) => classifyTranslation({ id: 'agent-loop', zhText, enText, refs });
  const enFor = (zhText: string, over: Record<string, unknown> = {}) => {
    const content = { title: 'The Agent Loop', description: 'Summary', body: 'Body.' };
    const text = serializeEnglish({
      ...content,
      translation: { mode: 'auto', sourceHash: classify(zhText).sourceHash!, generatedHash: hashContent(content), rulesVersion: 1 },
    });
    return Object.keys(over).length ? text.replace('translation:', `${Object.entries(over).map(([k, v]) => `${k}: ${v}`).join('\n')}\ntranslation:`) : text;
  };

  test('notes without experiments hash exactly as before (no translation becomes stale)', () => {
    const content = { title: '标题', description: '描述', body: '正文\n\n第二段' };
    assert.equal(hashContent({ ...content, experiments: [] }), 'sha256:1566be163b23470d65d611d6be38f2e5a7d9def24c5d2b6d791d498004fb4165');
    assert.equal(classify(zhFile()).sourceHash, hashContent({ title: '智能体循环', description: '摘要', body: '\n正文。\n' }));
  });

  test('changing Chinese experiment text makes the English edition stale', () => {
    const zh = zhFile(EXPERIMENTS());
    const en = enFor(zh);
    assert.equal(classify(zh, en).status, 'AUTO_CURRENT');
    assert.equal(classify(zhFile(EXPERIMENTS('从零实现最小 ReAct Agent')), en).status, 'AUTO_STALE');
    assert.equal(classify(zhFile(), en).status, 'AUTO_STALE', 'removing experiments changes the source too');
  });

  test('status and the English text are not translation sources', () => {
    const zh = zhFile(EXPERIMENTS());
    const en = enFor(zh);
    assert.equal(classify(zhFile(EXPERIMENTS(undefined, 'Build a Tiny Agent', 'completed')), en).status, 'AUTO_CURRENT');
  });

  test('English files cannot carry experiment or project-link fields', () => {
    const zh = zhFile(EXPERIMENTS());
    for (const key of ['experiments', 'projectTier', 'experimentId', 'sourceNote']) {
      const r = classify(zh, enFor(zh, { [key]: '[]' }));
      assert.equal(r.status, 'INVALID', key);
      assert.match(r.reasons.join('\n'), new RegExp(`"${key}" is structural metadata`));
    }
  });
});
