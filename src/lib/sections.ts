/**
 * The four top-level sections ("栏目"). A note's frontmatter `category` is one
 * of these. Older free-form category slugs are still accepted and mapped, and
 * their old /notes/category/<slug>/ URLs redirect to the new section page.
 */
export const SECTIONS = ['guide', 'practice', 'knowledge', 'projects'] as const;
export type Section = (typeof SECTIONS)[number];

/** Pre-section category slugs → section. Keep entries so old links keep working. */
export const LEGACY_CATEGORIES: Readonly<Record<string, Section>> = {
  meta: 'guide',
  algorithms: 'practice',
  'ai-agents': 'knowledge',
  'software-engineering': 'knowledge',
};

export function isSection(value: unknown): value is Section {
  return typeof value === 'string' && (SECTIONS as readonly string[]).includes(value);
}

/** A section id, or the section a legacy category maps to; undefined if neither. */
export function toSection(value: string): Section | undefined {
  return isSection(value) ? value : LEGACY_CATEGORIES[value];
}
