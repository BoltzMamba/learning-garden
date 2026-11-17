/**
 * The site root (/learning-garden/) has no content of its own: it sends the
 * visitor to a language. Rule: a language the visitor explicitly chose before
 * (stored by the header's language switch under `lg-lang`) wins; otherwise
 * English. The browser language is deliberately NOT consulted, so it can never
 * override an explicit choice, and first visits are predictable.
 *
 * Direct visits to /zh/… or /en/… never redirect and never change the stored
 * choice; only clicking the language switch does.
 */
export const LANG_STORAGE_KEY = 'lg-lang';

/** First-visit language (re-exported as DEFAULT_LANG by ui.ts). */
export const ENTRY_DEFAULT_LANG = 'en' as const;

/** The language to enter with. Pure, so it can be tested and inlined. */
export function pickEntryLang(stored: unknown, langs: readonly string[], fallback: string): string {
  return typeof stored === 'string' && langs.includes(stored) ? stored : fallback;
}

/**
 * The inline script for the root page. It is emitted before first paint, so it
 * is plain ES5-compatible text built from pickEntryLang itself.
 */
export function entryRedirectScript(targets: Readonly<Record<string, string>>, fallback: string): string {
  return [
    '(function () {',
    `  var targets = ${JSON.stringify(targets).replace(/</g, '\\u003c')};`,
    '  var stored = null;',
    `  try { stored = localStorage.getItem(${JSON.stringify(LANG_STORAGE_KEY)}); } catch (e) {}`,
    `  var pick = ${pickEntryLang.toString()};`,
    `  location.replace(targets[pick(stored, Object.keys(targets), ${JSON.stringify(fallback)})]);`,
    '})();',
  ].join('\n');
}
