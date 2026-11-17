/**
 * Graph types and the views over the unified graph (pure, browser-safe: the
 * global graph page switches modes on the client with these same functions).
 *
 *   article  articles + public questions; links_to, related_to, belongs_to, asks_about
 *   topic    articles + topics;           tagged_with, parent_of, belongs_to
 *
 * Every article appears in both modes, connected or not (isolated articles are
 * drawn and listed, never dropped). Topic nodes exist only when a note uses
 * them or one of their descendants.
 */
export type NodeKind = 'article' | 'topic' | 'question';
export type EdgeKind = 'links_to' | 'related_to' | 'belongs_to' | 'tagged_with' | 'parent_of' | 'asks_about';
export type GraphMode = 'article' | 'topic';
export const GRAPH_MODES: readonly GraphMode[] = ['article', 'topic'];

export interface GraphNode {
  id: string;
  kind: NodeKind;
  /** Display name (article title; topic English name). */
  label: string;
  /** Per-language display names (topics). */
  labels?: { zh: string; en: string };
  /** Language-neutral path, e.g. /notes/foo/ — pages add base + locale. */
  path: string;
  contentType?: 'overview' | 'note';
  section?: string;
  /** Number of edges in the current view (set by the filters below). */
  degree?: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  kind: EdgeKind;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export const MODE_NODES: Readonly<Record<GraphMode, readonly NodeKind[]>> = {
  article: ['article', 'question'],
  topic: ['article', 'topic'],
};
export const MODE_EDGES: Readonly<Record<GraphMode, readonly EdgeKind[]>> = {
  article: ['links_to', 'related_to', 'belongs_to', 'asks_about'],
  topic: ['tagged_with', 'parent_of', 'belongs_to'],
};

function withDegrees(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): GraphData {
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  return { nodes: nodes.map((n) => ({ ...n, degree: degree.get(n.id) ?? 0 })), edges: [...edges] };
}

/** The nodes and edges one mode shows. */
export function filterMode(data: GraphData, mode: GraphMode): GraphData {
  const kinds = MODE_NODES[mode];
  const nodes = data.nodes.filter((n) => kinds.includes(n.kind));
  const ids = new Set(nodes.map((n) => n.id));
  const edges = data.edges.filter((e) => MODE_EDGES[mode].includes(e.kind) && ids.has(e.source) && ids.has(e.target));
  return withDegrees(nodes, edges);
}

/** Nodes within `depth` hops of `centerId` in a mode, with the edges among them. */
export function localGraph(data: GraphData, centerId: string, mode: GraphMode = 'article', depth = 1): GraphData {
  const view = filterMode(data, mode);
  const adjacency = new Map<string, string[]>();
  for (const e of view.edges) {
    (adjacency.get(e.source) ?? adjacency.set(e.source, []).get(e.source)!).push(e.target);
    (adjacency.get(e.target) ?? adjacency.set(e.target, []).get(e.target)!).push(e.source);
  }
  const keep = new Set([centerId]);
  let frontier = [centerId];
  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const id of frontier) for (const n of adjacency.get(id) ?? []) if (!keep.has(n)) (keep.add(n), next.push(n));
    frontier = next;
  }
  return withDegrees(
    view.nodes.filter((n) => keep.has(n.id)),
    view.edges.filter((e) => keep.has(e.source) && keep.has(e.target)),
  );
}

/**
 * Homepage preview: only connected nodes, the best-connected first, capped at
 * `limit`. Nodes left without an edge inside the cap are dropped, so the
 * preview never shows a loose dot. Empty when nothing is connected yet.
 */
export function previewGraph(data: GraphData, mode: GraphMode = 'article', limit = 24): GraphData {
  const view = filterMode(data, mode);
  const ranked = view.nodes
    .filter((n) => (n.degree ?? 0) > 0)
    .sort((a, b) => (b.degree ?? 0) - (a.degree ?? 0) || a.id.localeCompare(b.id))
    .slice(0, limit);
  const ids = new Set(ranked.map((n) => n.id));
  const edges = view.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  const linked = new Set(edges.flatMap((e) => [e.source, e.target]));
  return withDegrees(
    ranked.filter((n) => linked.has(n.id)),
    edges,
  );
}

/**
 * Per-language copy of the graph: same ids, localised names and hrefs. Both
 * languages therefore share one logical node per note.
 */
export type LocalizedNode = GraphNode & { href: string };

export function localizeGraph<L extends 'zh' | 'en'>(
  data: GraphData,
  lang: L,
  href: (lang: L, path: string) => string,
): { nodes: LocalizedNode[]; edges: GraphEdge[] } {
  return {
    nodes: data.nodes.map((n) => ({ ...n, label: n.labels?.[lang] ?? n.label, href: href(lang, n.path) })),
    edges: data.edges,
  };
}
