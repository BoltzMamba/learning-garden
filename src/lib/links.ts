/**
 * Internal-link extraction for notes (pure, shared by the wikilink remark
 * plugin and the knowledge graph).
 *
 * Supported link forms inside a note's Markdown:
 *   [[slug]]  [[slug|label]]  [[slug#heading]]  [[Note Title]]     (wikilinks)
 *   [text](../slug/)  [text](/learning-garden/zh/notes/slug/)      (site URLs)
 *   [text](./slug.md)  [text](slug.md)                              (file links)
 *   [ref]: ../slug/                                                 (reference definitions)
 * Code blocks and inline code are ignored. Links are only ever taken from
 * what the author wrote — never inferred from titles or similarity.
 */
import { SITE_BASE } from './site.ts';

export const WIKILINK_RE = /\[\[([^[\]|#\n]+?)(#[^[\]|\n]*)?(?:\|([^[\]\n]+))?\]\]/g;

export interface NoteRef {
  id: string;
  title: string;
}

export type Resolver = (target: string) => string | undefined;

/** Resolve a wikilink target or slug to a note id: exact id, then case-insensitive id, then title. */
export function makeResolver(notes: readonly NoteRef[]): Resolver {
  const byId = new Map(notes.map((n) => [n.id, n.id]));
  const byLowerId = new Map(notes.map((n) => [n.id.toLowerCase(), n.id]));
  const byTitle = new Map(notes.map((n) => [n.title.trim().toLowerCase(), n.id]));
  return (target) => {
    const t = target.trim();
    return byId.get(t) ?? byLowerId.get(t.toLowerCase()) ?? byTitle.get(t.toLowerCase());
  };
}

/** Remove fenced code blocks and inline code so example links inside them are ignored. */
export function stripCode(markdown: string): string {
  return markdown
    // Indent is [ \t]*, not \s*: under /m, \s* would swallow blank lines and pair the wrong fences.
    .replace(/^([ \t]*)(```|~~~)[^\n]*\n[\s\S]*?^\1\2[^\n]*$/gm, '')
    .replace(/`[^`\n]*`/g, '');
}

/**
 * The note slug an href points at (by URL shape only), or undefined if it is
 * not a note link. `fromId` is the linking note: relative links resolve from
 * its page, /<lang>/notes/<fromId>/.
 */
export function noteSlugFromHref(href: string, fromId: string): string | undefined {
  const raw = href.trim();
  if (!raw || raw.startsWith('#')) return undefined;
  let url: URL;
  try {
    url = new URL(raw, `https://site.invalid${SITE_BASE}/zh/notes/${fromId}/`);
  } catch {
    return undefined;
  }
  if (url.hostname !== 'site.invalid' && url.hostname !== 'boltzmamba.github.io') return undefined;
  let path = decodeURIComponent(url.pathname);
  // Obsidian-style file links: other-note.md
  const file = /\/([^/]+)\.mdx?$/.exec(path);
  if (file) return file[1];
  if (path.startsWith(SITE_BASE)) path = path.slice(SITE_BASE.length);
  const m = /^\/(?:zh|en)\/notes\/([^/]+)\/?$/.exec(path) ?? /^\/notes\/([^/]+)\/?$/.exec(path);
  if (!m || m[1] === 'category') return undefined;
  return m[1];
}

/** Map an href to an existing note id, or undefined. */
export function noteIdFromHref(href: string, fromId: string, resolve: Resolver): string | undefined {
  const slug = noteSlugFromHref(href, fromId);
  return slug === undefined ? undefined : resolve(slug);
}

export interface ExtractedLinks {
  /** Distinct note ids linked from this note (excluding itself), in order of appearance. */
  targets: string[];
  /** Wikilink targets / note-looking hrefs that did not resolve. */
  unresolved: string[];
}

export function extractNoteLinks(markdown: string, fromId: string, resolve: Resolver): ExtractedLinks {
  const text = stripCode(markdown);
  const targets: string[] = [];
  const unresolved: string[] = [];
  const add = (id: string | undefined, raw: string) => {
    if (id === undefined) unresolved.push(raw);
    else if (id !== fromId && !targets.includes(id)) targets.push(id);
  };

  for (const m of text.matchAll(WIKILINK_RE)) add(resolve(m[1]), m[1].trim());

  const hrefs: string[] = [];
  for (const m of text.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+["'(][^)]*)?\)/g)) hrefs.push(m[1]);
  for (const m of text.matchAll(/^\s{0,3}\[[^\]]+\]:\s*<?(\S+?)>?(?:\s|$)/gm)) hrefs.push(m[1]);
  for (const href of hrefs) {
    const slug = noteSlugFromHref(href, fromId);
    if (slug !== undefined) add(resolve(slug), href);
  }
  return { targets, unresolved };
}
