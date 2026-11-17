/**
 * Per-language views of notes (pure). One logical note = one Chinese source
 * entry; its English edition only replaces the language fields. Everything
 * structural (id, section, tags, series, order, related, published) is read
 * from the Chinese entry, so lists, counts, series and the graph stay
 * identical across languages and nothing is counted twice.
 */
import type { TranslationStatus } from './translation.ts';

export type ContentLang = 'zh' | 'en';

export interface SourceEntry {
  id: string;
  data: { title: string; description: string };
  body?: string;
  filePath?: string;
}

export interface EditionEntry {
  id: string;
  data: { title: string; description: string };
  body?: string;
  filePath?: string;
}

export type LocalNote<T extends SourceEntry, E extends EditionEntry = EditionEntry> = T & {
  /** Language of the page. */
  lang: ContentLang;
  /** Language the title/description/body are actually in (differs only for a missing translation in dev). */
  contentLang: ContentLang;
  /** The entry to render (the English edition on English pages). */
  contentEntry: T | E;
  /** The Chinese source entry (structure, original text). */
  source: T;
  translationStatus?: TranslationStatus;
};

/**
 * The note as shown on a `lang` page. English pages use the English edition
 * when it exists; without one (only possible in dev — production builds are
 * strict) they fall back to the Chinese text and say so via `contentLang`.
 */
export function localizeNote<T extends SourceEntry, E extends EditionEntry>(
  note: T,
  lang: ContentLang,
  edition: E | undefined,
  status?: TranslationStatus,
): LocalNote<T, E> {
  const base = { lang, source: note, translationStatus: lang === 'en' ? status : undefined };
  if (lang === 'zh' || !edition) {
    return { ...note, ...base, contentLang: 'zh', contentEntry: note };
  }
  return {
    ...note,
    ...base,
    data: { ...note.data, title: edition.data.title, description: edition.data.description },
    body: edition.body,
    filePath: edition.filePath,
    contentLang: 'en',
    contentEntry: edition,
  };
}

export interface LanguageView<T extends SourceEntry, E extends EditionEntry> {
  notes: LocalNote<T, E>[];
  notesById: Map<string, LocalNote<T, E>>;
}

/** All notes in one language, in the (language-independent) source order. */
export function localizeNotes<T extends SourceEntry, E extends EditionEntry>(
  notes: readonly T[],
  lang: ContentLang,
  editions: ReadonlyMap<string, E>,
  statuses: ReadonlyMap<string, TranslationStatus> = new Map(),
): LanguageView<T, E> {
  const localized = notes.map((n) => localizeNote(n, lang, editions.get(n.id), statuses.get(n.id)));
  return { notes: localized, notesById: new Map(localized.map((n) => [n.id, n])) };
}

/** Per-language display names for graph nodes: English falls back to Chinese. */
export function titleLabels(note: SourceEntry, edition: EditionEntry | undefined): { zh: string; en: string } {
  return { zh: note.data.title, en: edition?.data.title ?? note.data.title };
}

/**
 * Series contents in one language: membership and order are given as ids
 * (decided by the Chinese source); each language maps them to its own notes.
 */
export function localizeSeries<N extends { id: string }>(
  seriesIds: ReadonlyMap<string, readonly string[]>,
  notesById: ReadonlyMap<string, N>,
): Map<string, N[]> {
  return new Map(
    [...seriesIds].map(([overview, members]) => [overview, members.map((id) => notesById.get(id)).filter((n): n is N => !!n)]),
  );
}
