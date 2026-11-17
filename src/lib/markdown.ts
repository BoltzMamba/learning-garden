/**
 * The Markdown pipeline, shared by astro.config.mjs and the tests so both
 * render notes exactly the same way.
 *
 *   remark-math       $inline$ and $$display$$ math (before marks: `=` in math is never a mark)
 *   remark-marks      ==highlight==, :hl[…]{color}, :ink[…]{color}  (also registers text directives)
 *   remark-concepts   :concept[…]{id} references and :dfn[…]{#anchor} definitions
 *   remark-wikilinks  [[note]] links between notes
 *   rehype-katex      renders the math
 *
 * Astro's unified processor adds GFM (tables, strikethrough…), smart
 * punctuation and Shiki highlighting with the config below.
 */
import type { RemarkPlugin, ShikiConfig, UnifiedProcessorOptions } from '@astrojs/markdown-remark';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import remarkMarks from './remark-marks.ts';
import remarkConcepts from './remark-concepts.ts';
import remarkWikilinks from './remark-wikilinks.ts';

export const markdownProcessorOptions: UnifiedProcessorOptions = {
  remarkPlugins: [
    remarkMath,
    remarkMarks as unknown as RemarkPlugin,
    remarkConcepts as unknown as RemarkPlugin,
    remarkWikilinks as unknown as RemarkPlugin,
  ],
  rehypePlugins: [rehypeKatex],
};

export const shikiConfig: Partial<ShikiConfig> = {
  themes: { light: 'github-light', dark: 'github-dark-dimmed' },
  wrap: false,
};
