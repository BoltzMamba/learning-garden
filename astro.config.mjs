// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import { unified } from '@astrojs/markdown-remark';
import { markdownProcessorOptions, shikiConfig } from './src/lib/markdown.ts';

// Project site on GitHub Pages: https://boltzmamba.github.io/learning-garden/
export default defineConfig({
  site: 'https://boltzmamba.github.io',
  base: '/learning-garden',
  trailingSlash: 'always',
  output: 'static',
  build: { format: 'directory' },
  markdown: {
    // The unified (remark/rehype) processor: KaTeX math, colour marks and
    // [[wikilinks]] between notes (see src/lib/markdown.ts).
    processor: unified(markdownProcessorOptions),
    shikiConfig,
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
