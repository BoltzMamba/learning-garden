/**
 * remark plugin: concept references and definition anchors (see concepts.ts).
 *
 *   :concept[Context]{id="llm-context"}  →  <span class="concept" data-concept="llm-context">Context</span>
 *   :concept{id="llm-context"}           →  the term in the file's language
 *   :dfn[上下文]{#llm-context}            →  <dfn id="llm-context" class="concept-def">上下文</dfn>
 *
 * The directive syntax is registered by remark-marks (text directives only),
 * so code, inline code and math are never touched. Nothing is styled here:
 * the span is inert until the reader turns Concept Mode on, and the page adds
 * the definitions and source links (ConceptLayer.astro).
 *
 * Unknown concept ids, extra attributes and malformed anchors fail the build
 * with the file and the offending value. Inside headings the markup is
 * unwrapped with a warning (not supported in v1), so heading ids are unchanged.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { SLUG_RE } from './slug.ts';
import { parseRegistry, type Concept } from './concepts.ts';

interface MdNode {
  type: string;
  name?: string;
  value?: string;
  attributes?: Record<string, string | null | undefined> | null;
  children?: MdNode[];
  data?: Record<string, unknown>;
  position?: { start: { line?: number } };
}

export class ConceptMarkupError extends Error {}

function loadRegistry(file: string): Map<string, Concept> {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return new Map(); // no registry yet: any reference is unknown
  }
  // Registry problems are reported (and fail the build) by the concept check;
  // here only valid entries are usable.
  return parseRegistry(JSON.parse(text), text).concepts;
}

export interface TransformOptions {
  concepts: ReadonlyMap<string, Concept>;
  lang: 'zh' | 'en';
  file: string;
  warn: (message: string) => void;
}

/** The transform, exported for tests. Throws ConceptMarkupError on invalid markup. */
export function transformConcepts(tree: MdNode, { concepts, lang, file, warn }: TransformOptions): void {
  const fail = (node: MdNode, message: string): never => {
    throw new ConceptMarkupError(`${file}${node.position?.start.line ? `:${node.position.start.line}` : ''}: ${message}`);
  };
  const visit = (node: MdNode, inHeading: boolean) => {
    if (!node.children) return;
    const out: MdNode[] = [];
    for (const child of node.children) {
      const ours = child.type === 'textDirective' && (child.name === 'concept' || child.name === 'dfn');
      if (!ours) {
        visit(child, inHeading || child.type === 'heading');
        out.push(child);
        continue;
      }
      visit(child, inHeading);
      const attrs = child.attributes ?? {};
      if (inHeading) {
        warn(`:${child.name} is not supported in headings yet; rendered as plain heading text`);
        out.push(...(child.children ?? []));
        continue;
      }
      const extra = Object.keys(attrs).filter((k) => k !== 'id');
      if (extra.length) fail(child, `:${child.name} only accepts an id (got ${extra.join(', ')})`);
      const id = attrs.id ?? '';
      if (child.name === 'concept') {
        const concept = concepts.get(id);
        if (!concept) {
          fail(child, `:concept id "${id}" is not in src/data/concepts.json (references are never matched by name; add the concept first, after the author confirms it)`);
        }
        const children = child.children?.length ? child.children : [{ type: 'text', value: concept![lang].term }];
        out.push({ ...child, children, data: { hName: 'span', hProperties: { className: ['concept'], dataConcept: id } } });
      } else {
        if (!SLUG_RE.test(id)) fail(child, `:dfn needs a stable anchor like {#llm-context} (lowercase words and hyphens), got "${id}"`);
        if (!child.children?.length) fail(child, `:dfn[…]{#${id}} needs the defined term as its label`);
        out.push({ ...child, data: { hName: 'dfn', hProperties: { id, className: ['concept-def'] } } });
      }
    }
    node.children = out;
  };
  visit(tree, tree.type === 'heading');
}

export default function remarkConcepts(options: { registryFile?: string } = {}) {
  const registryFile = options.registryFile ?? path.join(process.cwd(), 'src/data/concepts.json');
  return (tree: unknown, file: { path?: string; history?: string[] }) => {
    const source = (file.path ?? file.history?.[0] ?? '').replace(/\\/g, '/');
    const name = source.split('/').slice(-2).join('/');
    const lang = /\/content\/notes-en\//.test(source) ? 'en' : 'zh';
    transformConcepts(tree as MdNode, {
      concepts: loadRegistry(registryFile),
      lang,
      file: name,
      warn: (message) => console.warn(`[concepts] ${name}: ${message}`),
    });
  };
}
