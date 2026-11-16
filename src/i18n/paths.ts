import { LANGS, type Lang } from './ui.ts';

const BASE = import.meta.env.BASE_URL.replace(/\/+$/, '');

/** Prefix the configured base path. Pass paths with a trailing slash for pages. */
export function url(path: string): string {
  return `${BASE}/${path.replace(/^\/+/, '')}`;
}

/** Localised page URL, e.g. localePath('en', '/notes/') → /learning-garden/en/notes/ */
export function localePath(lang: Lang, path = '/'): string {
  return url(`${lang}/${path.replace(/^\/+/, '')}`);
}

/** Strip base and language prefix: /learning-garden/en/notes/x/ → /notes/x/ */
export function logicalPath(pathname: string): string {
  let p = pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname;
  const seg = p.split('/')[1];
  if ((LANGS as string[]).includes(seg)) p = p.slice(seg.length + 1);
  return p.startsWith('/') ? p : `/${p}`;
}
