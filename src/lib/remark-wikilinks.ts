/**
 * remark plugin: render [[wikilinks]] as links to notes.
 *
 *   [[slug]]  [[Note Title]]  [[slug|label]]  [[slug#Heading]]
 *
 * Targets resolve with the same rules as the knowledge graph (src/lib/links.ts),
 * so every rendered wikilink is also an edge in the graph. Links are relative
 * (../slug/), which keeps the reader in the current language. Unresolved
 * targets render as muted text and print a build warning.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { makeResolver, WIKILINK_RE, type NoteRef, type Resolver } from './links.ts';

interface MdNode {
  type: string;
  value?: string;
  url?: string;
  children?: MdNode[];
  data?: Record<string, unknown>;
}

const SKIP = new Set(['code', 'inlineCode', 'link', 'linkReference', 'definition', 'html', 'math', 'inlineMath']);

function loadNoteRefs(dir: string): NoteRef[] {
  try {
    return readdirSync(dir)
      .filter((f) => /\.mdx?$/.test(f))
      .map((f) => {
        const text = readFileSync(path.join(dir, f), 'utf8');
        const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
        const raw = /^title:\s*(.*)$/m.exec(fm)?.[1]?.trim() ?? '';
        let title = raw;
        if (raw.startsWith('"')) {
          try {
            title = JSON.parse(raw);
          } catch {
            title = raw.slice(1, -1);
          }
        } else if (raw.startsWith("'")) title = raw.slice(1, -1).replace(/''/g, "'");
        return { id: f.replace(/\.mdx?$/, ''), title };
      });
  } catch {
    return [];
  }
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Approximate the heading ids Astro generates (github-slugger style). */
const headingId = (h: string) =>
  h
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-');

export default function remarkWikilinks(options: { notesDir?: string } = {}) {
  const dir = options.notesDir ?? path.join(process.cwd(), 'src/content/notes');
  let refs = loadNoteRefs(dir);
  let resolve: Resolver = makeResolver(refs);
  const titleOf = (id: string) => refs.find((r) => r.id === id)?.title ?? id;

  return (tree: unknown, file: { path?: string; history?: string[] }) => {
    const source = file.path ?? file.history?.[0] ?? '';
    // Notes render at /<lang>/notes/<slug>/, question answers at /<lang>/questions/.
    const prefix = /[\\/]content[\\/]questions[\\/]/.test(source) ? '../notes/' : '../';

    const lookup = (target: string) => {
      let id = resolve(target);
      if (id === undefined) {
        // A note added while the dev server runs: refresh once.
        refs = loadNoteRefs(dir);
        resolve = makeResolver(refs);
        id = resolve(target);
      }
      return id;
    };

    const transform = (text: string): MdNode[] => {
      const out: MdNode[] = [];
      let last = 0;
      for (const m of text.matchAll(WIKILINK_RE)) {
        const start = m.index ?? 0;
        if (start > last) out.push({ type: 'text', value: text.slice(last, start) });
        const target = m[1].trim();
        const heading = m[2] ? m[2].slice(1) : '';
        const id = lookup(target);
        const label = (m[3] ?? (id && id === target ? titleOf(id) : target) + (heading ? ` › ${heading}` : '')).trim();
        if (id) {
          out.push({
            type: 'link',
            url: `${prefix}${id}/${heading ? `#${headingId(heading)}` : ''}`,
            children: [{ type: 'text', value: label }],
            data: { hProperties: { className: ['wikilink'] } },
          });
        } else {
          console.warn(`[wikilinks] ${path.basename(source)}: no note matches [[${target}]]`);
          out.push({ type: 'html', value: `<span class="wikilink wikilink-missing" title="Missing note">${escapeHtml(label)}</span>` });
        }
        last = start + m[0].length;
      }
      if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
      return out;
    };

    const visit = (node: MdNode) => {
      if (!node.children || SKIP.has(node.type)) return;
      const next: MdNode[] = [];
      for (const child of node.children) {
        if (child.type === 'text' && child.value?.includes('[[')) next.push(...transform(child.value));
        else {
          visit(child);
          next.push(child);
        }
      }
      node.children = next;
    };
    visit(tree as MdNode);
  };
}
