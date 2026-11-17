// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import { unified } from '@astrojs/markdown-remark';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import remarkWikilinks from './src/lib/remark-wikilinks.ts';

// Project site on GitHub Pages: https://boltzmamba.github.io/learning-garden/
export default defineConfig({
  site: 'https://boltzmamba.github.io',
  base: '/learning-garden',
  trailingSlash: 'always',
  output: 'static',
  build: { format: 'directory' },
  markdown: {
    // The unified (remark/rehype) processor: KaTeX math + [[wikilinks]] between notes.
    processor: unified({ remarkPlugins: [remarkMath, remarkWikilinks], rehypePlugins: [rehypeKatex] }),
    shikiConfig: {
      themes: { light: 'github-light', dark: 'github-dark-dimmed' },
      wrap: false,
    },
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
