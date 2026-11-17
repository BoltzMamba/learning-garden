/**
 * Knowledge-graph data (pure). Nodes are notes, their tags and public
 * questions; edges are only relationships that exist in the content:
 *   note → note      an internal link or wikilink written in the note
 *   note → tag       the note's frontmatter tags          (optional)
 *   question → note  the question's `note` field
 */
import { extractNoteLinks, makeResolver } from './links.ts';

export type NodeKind = 'note' | 'tag' | 'question';
export type LinkKind = 'link' | 'tag' | 'question';

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  /** Language-neutral page path, e.g. /notes/foo/ (pages prefix the locale). */
  path: string;
  degree: number;
}

export interface GraphLink {
  source: string;
  target: string;
  kind: LinkKind;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export interface GraphNoteInput {
  id: string;
  title: string;
  tags: readonly string[];
  body: string;
}

export interface GraphQuestionInput {
  id: string;
  title: string;
  note?: string;
  public: boolean;
}

export const noteNodeId = (id: string) => `note:${id}`;
export const tagNodeId = (tag: string) => `tag:${tag}`;
export const questionNodeId = (id: string) => `q:${id}`;

export interface BuildResult extends GraphData {
  /** Per note: link targets that did not resolve to a note (for warnings). */
  unresolved: { from: string; target: string }[];
  /** Directed note → note links as written (for backlinks / outlinks). */
  noteLinks: { from: string; to: string }[];
}

export function buildGraph(
  notes: readonly GraphNoteInput[],
  questions: readonly GraphQuestionInput[] = [],
  options: { tags?: boolean } = {},
): BuildResult {
  const { tags = true } = options;
  const resolve = makeResolver(notes);
  const nodes = new Map<string, GraphNode>();
  const links: GraphLink[] = [];
  const seen = new Set<string>();
  const unresolved: BuildResult['unresolved'] = [];
  const noteLinks: BuildResult['noteLinks'] = [];

  const addLink = (source: string, target: string, kind: LinkKind) => {
    // Treat note↔note links as undirected for de-duplication.
    const key = kind === 'link' ? [source, target].sort().join('|') : `${source}|${target}`;
    if (source === target || seen.has(key)) return;
    seen.add(key);
    links.push({ source, target, kind });
  };

  for (const n of notes) {
    nodes.set(noteNodeId(n.id), { id: noteNodeId(n.id), kind: 'note', label: n.title, path: `/notes/${n.id}/`, degree: 0 });
  }
  for (const n of notes) {
    const { targets, unresolved: missing } = extractNoteLinks(n.body, n.id, resolve);
    for (const t of targets) {
      noteLinks.push({ from: n.id, to: t });
      addLink(noteNodeId(n.id), noteNodeId(t), 'link');
    }
    for (const target of missing) unresolved.push({ from: n.id, target });
    if (tags) {
      for (const tag of n.tags) {
        const id = tagNodeId(tag);
        if (!nodes.has(id)) {
          nodes.set(id, { id, kind: 'tag', label: `#${tag}`, path: `/notes/?tag=${encodeURIComponent(tag)}`, degree: 0 });
        }
        addLink(noteNodeId(n.id), id, 'tag');
      }
    }
  }
  for (const q of questions) {
    if (!q.public) continue;
    const id = questionNodeId(q.id);
    nodes.set(id, { id, kind: 'question', label: q.title, path: `/questions/#q-${q.id}`, degree: 0 });
    if (q.note && nodes.has(noteNodeId(q.note))) addLink(id, noteNodeId(q.note), 'question');
  }

  for (const l of links) {
    nodes.get(l.source)!.degree++;
    nodes.get(l.target)!.degree++;
  }
  return { nodes: [...nodes.values()], links, unresolved, noteLinks };
}

/** Nodes within `depth` hops of `centerId` (Quartz's local graph). */
export function localGraph(data: GraphData, centerId: string, depth = 1): GraphData {
  const adjacency = new Map<string, string[]>();
  for (const l of data.links) {
    (adjacency.get(l.source) ?? adjacency.set(l.source, []).get(l.source)!).push(l.target);
    (adjacency.get(l.target) ?? adjacency.set(l.target, []).get(l.target)!).push(l.source);
  }
  const keep = new Set([centerId]);
  let frontier = [centerId];
  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const id of frontier) for (const n of adjacency.get(id) ?? []) if (!keep.has(n)) (keep.add(n), next.push(n));
    frontier = next;
  }
  return {
    nodes: data.nodes.filter((n) => keep.has(n.id)),
    links: data.links.filter((l) => keep.has(l.source) && keep.has(l.target)),
  };
}

/** Notes linking to `noteId` (backlinks) and notes it links to (outlinks). */
export function noteConnections(
  noteLinks: readonly { from: string; to: string }[],
  noteId: string,
): { backlinks: string[]; outlinks: string[] } {
  return {
    backlinks: noteLinks.filter((l) => l.to === noteId).map((l) => l.from),
    outlinks: noteLinks.filter((l) => l.from === noteId).map((l) => l.to),
  };
}
