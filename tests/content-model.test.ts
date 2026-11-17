/** Topic vocabulary and cross-note content rules (synthetic data only). */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { seriesMembers, validateContent, type ContentEntry } from '../src/lib/content-model.ts';
import { toSection } from '../src/lib/sections.ts';
import { normalizeTag, parseVocabulary, resolveTag, topicAncestors } from '../src/lib/topics.ts';

const vocab = parseVocabulary({
  ai: { zh: '人工智能', en: 'Artificial Intelligence' },
  'ai-agent': { zh: 'AI Agent', en: 'AI Agent', parent: 'ai', aliases: ['LLM Agent', 'agents'] },
  react: { zh: 'ReAct', en: 'ReAct', parent: 'ai-agent' },
});

describe('topic vocabulary', () => {
  test('synonyms and case/spacing variants resolve to one id', () => {
    assert.equal(normalizeTag('  LLM_Agent '), 'llm-agent');
    for (const t of ['ai-agent', 'AI Agent', 'llm agent', 'LLM-Agent', 'agents']) assert.equal(resolveTag(vocab, t), 'ai-agent');
    assert.equal(resolveTag(vocab, 'nope'), undefined);
    // Display names resolve as well, below ids and aliases.
    assert.equal(resolveTag(vocab, 'Artificial Intelligence'), 'ai');
    assert.equal(resolveTag(vocab, '人工智能'), 'ai');
    assert.deepEqual(topicAncestors(vocab, 'react'), ['ai-agent', 'ai']);
  });

  test('unknown parents, cycles, clashing aliases, missing names and deep trees are rejected', () => {
    assert.throws(() => parseVocabulary({ a: { zh: 'A', en: 'A', parent: 'ghost' } }), /parent "ghost" does not exist/);
    assert.throws(
      () => parseVocabulary({ a: { zh: 'A', en: 'A', parent: 'b' }, b: { zh: 'B', en: 'B', parent: 'a' } }),
      /parent cycle/,
    );
    assert.throws(() => parseVocabulary({ a: { zh: 'A', en: 'A', parent: 'a' } }), /own parent|cycle/);
    assert.throws(
      () => parseVocabulary({ a: { zh: 'A', en: 'A', aliases: ['x'] }, b: { zh: 'B', en: 'B', aliases: ['X'] } }),
      /alias "X" of "b" already names topic "a"/,
    );
    assert.throws(() => parseVocabulary({ a: { zh: 'A', en: 'A', aliases: ['b'] }, b: { zh: 'B', en: 'B' } }), /already names/);
    assert.throws(() => parseVocabulary({ a: { en: 'A' } }), /missing "zh"/);
    assert.throws(() => parseVocabulary({ 'Bad Id': { zh: 'A', en: 'A' } }), /lowercase/);
    assert.throws(
      () =>
        parseVocabulary({
          a: { zh: 'A', en: 'A' },
          b: { zh: 'B', en: 'B', parent: 'a' },
          c: { zh: 'C', en: 'C', parent: 'b' },
          d: { zh: 'D', en: 'D', parent: 'c' },
        }),
      /4 levels deep/,
    );
  });

  test('the real vocabulary file is valid', () => {
    const real = parseVocabulary(JSON.parse(readFileSync(new URL('../src/data/topics.json', import.meta.url), 'utf8')));
    assert.ok(real.topics.size > 0);
    assert.equal(resolveTag(real, 'LLM Agent'), 'ai-agent');
  });
});

const entry = (id: string, extra: Partial<ContentEntry> = {}): ContentEntry => ({
  id,
  file: `src/content/notes/${id}.md`,
  title: id,
  published: '2026-11-01',
  contentType: 'note',
  related: [],
  tags: [],
  ...extra,
});

describe('content rules', () => {
  const overview = entry('agents', { contentType: 'overview' });

  test('a valid series, related and synonym tags pass and are normalised', () => {
    const r = validateContent(
      [overview, entry('a', { series: 'agents', order: 10, related: ['b'], tags: ['LLM Agent', 'ai-agent'] }), entry('b')],
      vocab,
    );
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.topics.get('a'), ['ai-agent']);
  });

  test('invalid contentType', () => {
    const r = validateContent([entry('a', { contentType: 'essay' })], vocab);
    assert.match(r.errors[0], /src\/content\/notes\/a\.md: contentType: "essay" is not one of overview \| note/);
  });

  test('series must exist and be an overview', () => {
    const r = validateContent([entry('a', { series: 'ghost' }), entry('b'), entry('c', { series: 'b' })], vocab);
    assert.ok(r.errors.some((e) => /a\.md: series: "ghost" does not exist/.test(e)));
    assert.ok(r.errors.some((e) => /c\.md: series: "b" is a note, not an overview/.test(e)));
  });

  test('nested series and self-membership are rejected', () => {
    const r = validateContent([overview, entry('sub', { contentType: 'overview', series: 'agents' }), entry('me', { series: 'me' })], vocab);
    assert.ok(r.errors.some((e) => /sub\.md: series: an overview cannot belong to another series/.test(e)));
    assert.ok(r.errors.some((e) => /me\.md: series: a note cannot belong to itself/.test(e)));
  });

  test('related: missing targets, self-references and duplicates', () => {
    const r = validateContent([entry('a', { related: ['a', 'ghost', 'b', 'b'] }), entry('b')], vocab);
    assert.ok(r.errors.some((e) => /related: "a" is the note itself/.test(e)));
    assert.ok(r.errors.some((e) => /related: "ghost" does not exist/.test(e)));
    assert.ok(r.errors.some((e) => /related: "b" is listed more than once/.test(e)));
  });

  test('unknown topic ids are reported with file and field', () => {
    const r = validateContent([entry('a', { tags: ['quantum-gravity'] })], vocab);
    assert.match(r.errors[0], /a\.md: tags: "quantum-gravity" is not in the topic vocabulary/);
  });

  test('order without a series is a warning, not an error', () => {
    const r = validateContent([entry('a', { order: 3 })], vocab);
    assert.deepEqual(r.errors, []);
    assert.match(r.warnings[0], /order: ignored/);
  });
});

describe('series ordering', () => {
  const members = [
    entry('late', { series: 's', published: '2026-03-01' }),
    entry('b', { series: 's', order: 20 }),
    entry('early', { series: 's', published: '2026-01-01' }),
    entry('a', { series: 's', order: 20 }),
    entry('first', { series: 's', order: 5 }),
    entry('elsewhere', { series: 'other', order: 1 }),
  ];
  test('order ascending (gaps allowed); ties and missing orders fall back to date then id', () => {
    assert.deepEqual(seriesMembers(members, 's').map((m) => m.id), ['first', 'a', 'b', 'early', 'late']);
  });
  test('an empty series has no members', () => {
    assert.deepEqual(seriesMembers(members, 'nothing'), []);
  });
});

describe('sections', () => {
  test('section ids pass; legacy categories map; unknown values do not', () => {
    assert.equal(toSection('practice'), 'practice');
    assert.equal(toSection('meta'), 'guide');
    assert.equal(toSection('ai-agents'), 'knowledge');
    assert.equal(toSection('cooking'), undefined);
  });
});
