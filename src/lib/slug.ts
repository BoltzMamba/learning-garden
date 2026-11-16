/** Stable identifiers: lowercase ASCII words separated by single hyphens. */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSlug(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 80 && SLUG_RE.test(value);
}

/**
 * Derive a slug from a title. Non-Latin text (e.g. Chinese) is dropped, so the
 * result may be empty; callers must then ask for an explicit slug.
 */
export function slugify(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}
