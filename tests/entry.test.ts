/** Root entry redirect: run the exact inline script the root page ships, in a sandbox. */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { entryRedirectScript, pickEntryLang } from '../src/i18n/entry.ts';
import { ENTRY_DEFAULT_LANG as DEFAULT_LANG } from '../src/i18n/entry.ts';

const targets = { zh: '/learning-garden/zh/', en: '/learning-garden/en/' };

function visit(stored: string | null | Error, browserLanguages: string[] = ['zh-CN']) {
  let redirectedTo: string | undefined;
  runInNewContext(entryRedirectScript(targets, DEFAULT_LANG), {
    localStorage: {
      getItem: (key: string) => {
        assert.equal(key, 'lg-lang');
        if (stored instanceof Error) throw stored;
        return stored;
      },
    },
    navigator: { languages: browserLanguages, language: browserLanguages[0] },
    location: { replace: (to: string) => (redirectedTo = to) },
  });
  return redirectedTo;
}

describe('root entry', () => {
  test('first visit goes to English, even with a Chinese browser', () => {
    assert.equal(DEFAULT_LANG, 'en');
    assert.equal(visit(null), '/learning-garden/en/');
    assert.equal(visit(null, ['zh-CN', 'zh']), '/learning-garden/en/');
  });

  test('an explicit earlier choice is kept', () => {
    assert.equal(visit('zh', ['en-US']), '/learning-garden/zh/');
    assert.equal(visit('en', ['zh-CN']), '/learning-garden/en/');
  });

  test('unknown stored values and unavailable storage fall back to English', () => {
    assert.equal(visit('fr'), '/learning-garden/en/');
    assert.equal(visit(new Error('SecurityError')), '/learning-garden/en/');
    assert.equal(pickEntryLang(42, ['zh', 'en'], 'en'), 'en');
  });

  test('the script is self-contained text (no module syntax) and escapes </script>', () => {
    const script = entryRedirectScript({ en: '/a</script>/' }, 'en');
    assert.doesNotMatch(script, /<\/script>/);
    assert.doesNotMatch(script, /\bimport\b|\bexport\b|: string/);
  });
});
