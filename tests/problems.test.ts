/** Practice problems: schema and cross-entry rules (synthetic data only). */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { problemKey, problemSchema, validateProblems, type Problem, type ProblemNoteInput } from '../src/lib/problems.ts';
import { parseVocabulary } from '../src/lib/topics.ts';

const lc = (over: Partial<Problem> = {}): Problem => ({
  platform: 'leetcode',
  number: 15,
  url: 'https://leetcode.cn/problems/3sum/',
  difficulty: 'medium',
  exam: false,
  listed: true,
  ...over,
});
const nc = (over: Partial<Problem> = {}): Problem => ({
  platform: 'nowcoder',
  url: 'https://www.nowcoder.com/practice/9b6955921efc4f0b97701641e0402a29',
  difficulty: 'medium',
  exam: true,
  listed: false,
  ...over,
});
const note = (id: string, problem?: Problem, section = 'practice'): ProblemNoteInput => ({
  id,
  file: `src/content/notes/${id}.md`,
  section,
  problem,
});

describe('problemSchema', () => {
  test('accepts a LeetCode problem; exam defaults to false and listed to true', () => {
    const parsed = problemSchema.parse({ platform: 'leetcode', number: 15, url: 'https://leetcode.cn/problems/3sum/', difficulty: 'medium' });
    assert.equal(parsed.exam, false);
    assert.equal(parsed.listed, true);
  });
  test('rejects unknown difficulty, unknown keys and non-https URLs', () => {
    assert.equal(problemSchema.safeParse({ ...lc(), difficulty: '中等' }).success, false);
    assert.equal(problemSchema.safeParse({ ...lc(), frequency: 'high' }).success, false);
    assert.equal(problemSchema.safeParse({ ...lc(), url: 'http://leetcode.cn/problems/3sum/' }).success, false);
  });
});

describe('validateProblems', () => {
  test('valid LeetCode and Nowcoder notes pass; notes without a problem are ignored', () => {
    assert.deepEqual(validateProblems([note('lc-15-3sum', lc()), note('nc-good', nc()), note('plain', undefined, 'knowledge')]).errors, []);
  });
  test('only practice notes may describe a problem', () => {
    const { errors } = validateProblems([note('a', lc(), 'knowledge')]);
    assert.match(errors[0], /only practice notes/);
  });
  test('LeetCode needs a number; Nowcoder has none', () => {
    assert.match(validateProblems([note('a', lc({ number: undefined }))]).errors[0], /number: required/);
    assert.match(validateProblems([note('a', nc({ number: 3 }))]).errors[0], /have no number/);
  });
  test('the URL must belong to the platform', () => {
    assert.match(validateProblems([note('a', lc({ url: 'https://www.nowcoder.com/practice/x' }))]).errors[0], /not a leetcode host/);
  });
  test('one problem has one note, across leetcode.cn and leetcode.com and trailing slashes', () => {
    const lcDup = validateProblems([note('a', lc()), note('b', lc({ url: 'https://leetcode.com/problems/3sum/' }))]);
    assert.match(lcDup.errors[0], /already documented in src\/content\/notes\/a\.md/);
    const ncDup = validateProblems([note('a', nc()), note('b', nc({ url: 'https://nowcoder.com/practice/9b6955921efc4f0b97701641e0402a29/' }))]);
    assert.equal(ncDup.errors.length, 1);
  });
  test('problemKey', () => {
    assert.equal(problemKey(lc()), 'leetcode:15');
    assert.equal(problemKey(nc()), 'nowcoder:nowcoder.com/practice/9b6955921efc4f0b97701641e0402a29');
  });
});

describe('topic frequency', () => {
  const base = { algorithms: { zh: '算法', en: 'Algorithms' } };
  test('knowledge points may carry high | medium | low', () => {
    const vocab = parseVocabulary({ ...base, 'hash-table': { zh: '哈希表', en: 'Hash Table', parent: 'algorithms', frequency: 'high' } });
    assert.equal(vocab.topics.get('hash-table')?.frequency, 'high');
    assert.equal(vocab.topics.get('algorithms')?.frequency, undefined);
  });
  test('any other value is rejected', () => {
    assert.throws(() => parseVocabulary({ ...base, x: { zh: 'x', en: 'x', frequency: '高' } }), /"frequency" must be one of high \| medium \| low/);
  });
});
