/**
 * Knowledge-graph renderer: a d3-force layout drawn on one canvas.
 *
 * Interactions: drag nodes, drag the background to pan, zoom with the wheel
 * (full page) or ctrl/⌘ + wheel (embedded views, so page scrolling is not
 * hijacked), pinch to zoom on touch, hover to highlight a node with its edges
 * and neighbours, click/tap to open, locate() to find a node. Under
 * prefers-reduced-motion the layout is computed up front and shown without
 * animation. The simulation pauses while the tab is hidden.
 *
 * Loaded lazily (dynamic import) only when a graph scrolls into view.
 */
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import type { EdgeKind, NodeKind } from '../lib/graph-modes.ts';

export interface GraphPayloadNode {
  id: string;
  kind: NodeKind;
  contentType?: 'overview' | 'note';
  label: string;
  href: string;
  degree?: number;
}

export interface GraphPayload {
  nodes: GraphPayloadNode[];
  edges: { source: string; target: string; kind: EdgeKind }[];
  center?: string;
}

interface Node extends SimulationNodeDatum, GraphPayloadNode {
  r: number;
}
/** One drawn line per node pair; `kind` is the strongest relation between them. */
type Link = SimulationLinkDatum<Node> & { kind: EdgeKind; kinds: EdgeKind[] };

interface Colors {
  bg: string;
  text: string;
  muted: string;
  border: string;
  accent: string;
  grid: string;
}

export interface GraphOptions {
  /** Wheel zooms without a modifier key (full page). */
  wheelZoom: boolean;
  /** Always show labels on small graphs (otherwise only when zoomed in or highlighted). */
  labels: boolean;
  reducedMotion: boolean;
}

/** Drawing priority when two nodes share several relations. */
const PRIORITY: EdgeKind[] = ['links_to', 'related_to', 'asks_about', 'belongs_to', 'parent_of', 'tagged_with'];

const EDGE_STYLE: Record<EdgeKind, { dash: number[]; width: number; alpha: number; distance: number; strength: number }> = {
  links_to: { dash: [], width: 1.2, alpha: 1, distance: 96, strength: 0.7 },
  related_to: { dash: [5, 3], width: 1.1, alpha: 1, distance: 96, strength: 0.6 },
  asks_about: { dash: [1.5, 3], width: 1, alpha: 0.8, distance: 66, strength: 0.45 },
  belongs_to: { dash: [2, 4], width: 1, alpha: 0.7, distance: 80, strength: 0.5 },
  parent_of: { dash: [], width: 1, alpha: 0.7, distance: 64, strength: 0.5 },
  tagged_with: { dash: [], width: 0.8, alpha: 0.5, distance: 72, strength: 0.4 },
};

const radius = (n: GraphPayloadNode) => {
  const d = Math.sqrt(n.degree ?? 0);
  if (n.kind === 'topic') return 3.4 + d * 0.8;
  if (n.kind === 'question') return 3.6;
  return (n.contentType === 'overview' ? 6 : 4) + d * 1.5;
};

export class GraphView {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private options: GraphOptions;
  private data: GraphPayload;
  private nodes: Node[] = [];
  private links: Link[] = [];
  private neighbors = new Map<string, Set<string>>();
  private sim: Simulation<Node, Link> | undefined;
  private colors!: Colors;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private view = { k: 1, x: 0, y: 0 };
  private userMoved = false;
  private hover: Node | null = null;
  /** Node chosen with locate(); stays highlighted until cleared. */
  private pinned: string | null = null;
  private center: string | undefined;
  private frame = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private drag: { node: Node | null; startX: number; startY: number; moved: boolean; pinch?: number; viewK?: number } | null = null;
  private abort = new AbortController();
  private resizeObserver: ResizeObserver;

  constructor(canvas: HTMLCanvasElement, payload: GraphPayload, options: GraphOptions) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.options = options;
    this.data = payload;
    this.center = payload.center;
    this.readColors();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    this.build();
    this.bindEvents();
  }

  destroy() {
    this.abort.abort();
    this.resizeObserver.disconnect();
    this.sim?.stop();
    cancelAnimationFrame(this.frame);
  }

  /** Replace the data (mode switch). Nodes present before keep their positions. */
  setData(payload: GraphPayload) {
    this.data = payload;
    this.center = payload.center;
    this.pinned = null;
    this.hover = null;
    this.userMoved = false;
    this.build();
  }

  resetView() {
    this.userMoved = false;
    this.pinned = null;
    this.fit();
    this.requestDraw();
  }

  /** Highlight a node and bring it to the middle of the view. */
  locate(id: string): boolean {
    const n = this.nodes.find((x) => x.id === id);
    if (!n) return false;
    this.pinned = id;
    this.view.k = Math.max(this.view.k, 1.3);
    this.view.x = -(n.x ?? 0) * this.view.k;
    this.view.y = -(n.y ?? 0) * this.view.k;
    this.userMoved = true;
    this.requestDraw();
    return true;
  }

  readColors() {
    const s = getComputedStyle(this.canvas);
    const v = (n: string, f: string) => s.getPropertyValue(n).trim() || f;
    this.colors = {
      bg: v('--bg', '#f7f8f5'),
      text: v('--text', '#1f2a2e'),
      muted: v('--text-muted', '#5b6b6e'),
      border: v('--border', '#d9e0dc'),
      accent: v('--accent', '#2c7a63'),
      grid: v('--ocean-grid', 'rgba(31,42,46,0.045)'),
    };
    this.requestDraw();
  }

  // ── data & layout ─────────────────────────────────────────────────────

  private build() {
    const previous = new Map(this.nodes.map((n) => [n.id, n]));
    this.nodes = this.data.nodes.map((n) => {
      const old = previous.get(n.id);
      return { ...n, r: radius(n), x: old?.x, y: old?.y, vx: old?.vx, vy: old?.vy };
    });
    const ids = new Set(this.nodes.map((n) => n.id));

    // Merge the relations of each node pair into one drawn line.
    const pairs = new Map<string, Link>();
    for (const e of this.data.edges) {
      if (!ids.has(e.source) || !ids.has(e.target)) continue;
      const key = [e.source, e.target].sort().join('~');
      const existing = pairs.get(key);
      if (!existing) pairs.set(key, { source: e.source, target: e.target, kind: e.kind, kinds: [e.kind] });
      else {
        existing.kinds.push(e.kind);
        if (PRIORITY.indexOf(e.kind) < PRIORITY.indexOf(existing.kind)) existing.kind = e.kind;
      }
    }
    this.links = [...pairs.values()];
    this.neighbors = new Map(this.nodes.map((n) => [n.id, new Set<string>()]));
    for (const l of this.links) {
      this.neighbors.get(l.source as string)!.add(l.target as string);
      this.neighbors.get(l.target as string)!.add(l.source as string);
    }

    this.sim?.stop();
    const sim = forceSimulation<Node, Link>(this.nodes)
      .force(
        'link',
        forceLink<Node, Link>(this.links)
          .id((d) => d.id)
          .distance((l) => EDGE_STYLE[l.kind].distance)
          .strength((l) => EDGE_STYLE[l.kind].strength),
      )
      .force('charge', forceManyBody<Node>().strength((d) => (d.kind === 'article' ? -260 : -130)).distanceMax(480))
      // Room for the label under each node.
      .force('collide', forceCollide<Node>((d) => d.r + 16))
      // Gentle pull to the middle keeps unconnected articles in view.
      .force('x', forceX<Node>(0).strength(0.05))
      .force('y', forceY<Node>(0).strength(0.07))
      .alphaDecay(0.035);
    this.sim = sim;

    if (this.options.reducedMotion) {
      sim.stop();
      sim.tick(300);
      this.fit();
      this.requestDraw();
    } else {
      // Settle a little before the first frame so it doesn't start as a dot cloud.
      sim.tick(60);
      this.fit();
      sim.on('tick', () => {
        if (!this.userMoved) this.fit();
        this.requestDraw();
      });
      sim.alpha(0.4).restart();
      if (document.hidden) sim.stop();
    }
  }

  private fit() {
    if (!this.nodes.length || !this.width) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of this.nodes) {
      minX = Math.min(minX, (n.x ?? 0) - n.r);
      maxX = Math.max(maxX, (n.x ?? 0) + n.r);
      minY = Math.min(minY, (n.y ?? 0) - n.r);
      maxY = Math.max(maxY, (n.y ?? 0) + n.r);
    }
    // Horizontal room for the centred labels under edge nodes.
    const padX = Math.min(90, Math.max(48, this.width * 0.16));
    const padY = 48;
    const w = Math.max(maxX - minX, 1);
    const h = Math.max(maxY - minY, 1);
    // Never zoom in past 1.6×, so a single note stays a small star.
    const k = Math.max(0.2, Math.min(1.6, (this.width - padX * 2) / w, (this.height - padY * 2) / h));
    this.view = { k, x: -((minX + maxX) / 2) * k, y: -((minY + maxY) / 2) * k };
  }

  // ── drawing ───────────────────────────────────────────────────────────

  private resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    this.width = rect.width;
    this.height = rect.height;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
    if (!this.userMoved) this.fit();
    this.requestDraw();
  }

  private requestDraw() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private toScreen(n: Node) {
    return { x: (n.x ?? 0) * this.view.k + this.width / 2 + this.view.x, y: (n.y ?? 0) * this.view.k + this.height / 2 + this.view.y };
  }

  private toWorld(x: number, y: number) {
    return { x: (x - this.width / 2 - this.view.x) / this.view.k, y: (y - this.height / 2 - this.view.y) / this.view.k };
  }

  private draw() {
    const { ctx, colors: c, width: W, height: H, view } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // Faint dot grid, echoing the ocean's character grid.
    ctx.fillStyle = c.grid;
    const step = 24 * view.k >= 12 ? 24 * view.k : 24 * view.k * Math.ceil(12 / (24 * view.k));
    const ox = (((W / 2 + view.x) % step) + step) % step;
    const oy = (((H / 2 + view.y) % step) + step) % step;
    for (let x = ox; x < W; x += step) for (let y = oy; y < H; y += step) ctx.fillRect(x, y, 1.5, 1.5);

    const focus = this.hover?.id ?? (this.drag?.node?.id || undefined) ?? this.pinned ?? undefined;
    const lit = focus ? this.neighbors.get(focus) : undefined;
    const isLit = (id: string) => !focus || id === focus || !!lit?.has(id);

    // Edges
    for (const l of this.links) {
      const s = l.source as Node;
      const t = l.target as Node;
      const a = this.toScreen(s);
      const b = this.toScreen(t);
      const style = EDGE_STYLE[l.kind];
      const hot = !!focus && (s.id === focus || t.id === focus);
      ctx.globalAlpha = focus && !hot ? style.alpha * 0.3 : style.alpha;
      ctx.strokeStyle = hot ? c.accent : l.kind === 'links_to' || l.kind === 'related_to' ? c.muted : c.border;
      if (!hot && (l.kind === 'links_to' || l.kind === 'related_to')) ctx.globalAlpha *= 0.45;
      ctx.lineWidth = hot ? style.width + 0.4 : style.width;
      ctx.setLineDash(style.dash);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Nodes. Small graphs label every article; large ones only when zoomed in (plus highlights).
    const many = this.nodes.length > 40;
    const showAllLabels = (this.options.labels && !many) || view.k >= (many ? 1.8 : 1.1);
    const labels: { n: Node; x: number; y: number; strong: boolean }[] = [];
    for (const n of this.nodes) {
      const p = this.toScreen(n);
      if (p.x < -20 || p.y < -20 || p.x > W + 20 || p.y > H + 20) continue;
      const r = n.r * Math.max(0.75, Math.min(1.4, view.k));
      const isCenter = n.id === this.center;
      const isFocus = n.id === focus;
      const near = !!focus && !!lit?.has(n.id);
      ctx.globalAlpha = isLit(n.id) ? 1 : 0.28;
      const ink = isCenter || isFocus ? c.accent : near ? c.text : c.muted;
      ctx.lineWidth = 1.2;
      if (n.kind === 'topic') {
        ctx.strokeStyle = isCenter || isFocus || near ? ink : c.muted;
        ctx.fillStyle = c.bg;
        if (!(isCenter || isFocus || near)) ctx.globalAlpha *= 0.75;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (n.kind === 'question') {
        ctx.fillStyle = c.bg;
        ctx.strokeStyle = ink;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - r);
        ctx.lineTo(p.x + r, p.y);
        ctx.lineTo(p.x, p.y + r);
        ctx.lineTo(p.x - r, p.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        if (n.contentType === 'overview') {
          // Series: a soft accent ring around a slightly larger dot.
          ctx.fillStyle = c.accent;
          const a = ctx.globalAlpha;
          ctx.globalAlpha = a * 0.16;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r + 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = a;
        }
        ctx.fillStyle = n.contentType === 'overview' && !near && !isFocus && !isCenter ? c.accent : ink;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      if (isCenter || (isFocus && this.pinned === n.id)) {
        ctx.strokeStyle = c.accent;
        ctx.globalAlpha = 0.45;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      const wantLabel =
        isCenter || isFocus || near || (showAllLabels && (n.kind !== 'topic' || view.k >= 1.4 || this.nodes.length <= 24));
      if (wantLabel) labels.push({ n, x: p.x, y: p.y + r + 11, strong: isCenter || isFocus || near });
    }

    // Labels last, with a background halo for legibility.
    ctx.font = `11px "JetBrains Mono", ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    // Greedy placement: highlighted labels first, then better-connected nodes;
    // a label that would overlap one already placed is skipped.
    labels.sort((a, b) => Number(b.strong) - Number(a.strong) || (b.n.degree ?? 0) - (a.n.degree ?? 0));
    const placed: { l: number; r: number; t: number; b: number }[] = [];
    for (const { n, x, y, strong } of labels) {
      const base = n.kind === 'topic' ? `#${n.label}` : n.label;
      const text = base.length > 22 ? `${base.slice(0, 21)}…` : base;
      const w = ctx.measureText(text).width + 6;
      const box = { l: x - w / 2, r: x + w / 2, t: y - 8, b: y + 8 };
      if (placed.some((o) => box.l < o.r && box.r > o.l && box.t < o.b && box.b > o.t)) continue;
      placed.push(box);
      ctx.globalAlpha = isLit(n.id) ? 1 : 0.3;
      ctx.lineWidth = 4;
      ctx.strokeStyle = c.bg;
      ctx.strokeText(text, x, y);
      ctx.fillStyle = strong ? c.text : c.muted;
      ctx.fillText(text, x, y);
    }
    ctx.globalAlpha = 1;
  }

  // ── interaction ───────────────────────────────────────────────────────

  private hit(x: number, y: number): Node | null {
    let best: Node | null = null;
    let bestD = Infinity;
    for (const n of this.nodes) {
      const p = this.toScreen(n);
      const d = Math.hypot(p.x - x, p.y - y);
      const reach = Math.max(10, n.r * this.view.k + 6);
      if (d < reach && d < bestD) {
        best = n;
        bestD = d;
      }
    }
    return best;
  }

  private local(e: PointerEvent | WheelEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private zoomAt(x: number, y: number, factor: number) {
    const k = Math.min(4, Math.max(0.3, this.view.k * factor));
    const w = this.toWorld(x, y);
    this.view.k = k;
    this.view.x = x - this.width / 2 - w.x * k;
    this.view.y = y - this.height / 2 - w.y * k;
    this.userMoved = true;
    this.requestDraw();
  }

  /** Zoom around the middle of the canvas (buttons). */
  zoomBy(factor: number) {
    this.zoomAt(this.width / 2, this.height / 2, factor);
  }

  private bindEvents() {
    const c = this.canvas;
    const signal = this.abort.signal;

    // Pause the simulation while the tab is hidden; resume where it left off.
    document.addEventListener(
      'visibilitychange',
      () => {
        if (!this.sim || this.options.reducedMotion) return;
        if (document.hidden) this.sim.stop();
        else if (this.sim.alpha() > this.sim.alphaMin()) this.sim.restart();
      },
      { signal },
    );

    c.addEventListener(
      'pointerdown',
      (e) => {
        const p = this.local(e);
        this.pointers.set(e.pointerId, p);
        if (this.pointers.size === 2) {
          const [a, b] = [...this.pointers.values()];
          this.drag = { node: null, startX: p.x, startY: p.y, moved: true, pinch: Math.hypot(a.x - b.x, a.y - b.y), viewK: this.view.k };
          return;
        }
        const node = this.hit(p.x, p.y);
        this.drag = { node, startX: p.x, startY: p.y, moved: false };
        c.setPointerCapture(e.pointerId);
        if (node) {
          node.fx = node.x;
          node.fy = node.y;
          if (!this.options.reducedMotion) this.sim?.alphaTarget(0.25).restart();
        }
      },
      { signal },
    );

    c.addEventListener(
      'pointermove',
      (e) => {
        const p = this.local(e);
        const prev = this.pointers.get(e.pointerId);
        if (prev) this.pointers.set(e.pointerId, p);
        const d = this.drag;
        if (d?.pinch !== undefined && this.pointers.size === 2) {
          const [a, b] = [...this.pointers.values()];
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          this.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, (d.viewK! * (dist / d.pinch)) / this.view.k);
          return;
        }
        if (d && prev) {
          if (Math.hypot(p.x - d.startX, p.y - d.startY) > 4) d.moved = true;
          if (d.node) {
            const w = this.toWorld(p.x, p.y);
            d.node.fx = w.x;
            d.node.fy = w.y;
            if (this.options.reducedMotion) {
              d.node.x = w.x;
              d.node.y = w.y;
            }
            this.userMoved = true;
          } else if (d.moved) {
            this.view.x += p.x - prev.x;
            this.view.y += p.y - prev.y;
            this.userMoved = true;
          }
          this.requestDraw();
          return;
        }
        const h = this.hit(p.x, p.y);
        if (h !== this.hover) {
          this.hover = h;
          c.style.cursor = h ? 'pointer' : 'grab';
          c.title = h ? h.label : '';
          this.requestDraw();
        }
      },
      { signal },
    );

    const end = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      const d = this.drag;
      if (!d) return;
      if (d.pinch !== undefined) {
        if (this.pointers.size === 0) this.drag = null;
        return;
      }
      this.drag = null;
      if (d.node) {
        d.node.fx = null;
        d.node.fy = null;
        this.sim?.alphaTarget(0);
        if (!d.moved && e.type === 'pointerup') {
          window.location.href = d.node.href;
          return;
        }
      } else if (!d.moved && this.pinned) {
        this.pinned = null; // a tap on the background clears a located node
      }
      this.requestDraw();
    };
    c.addEventListener('pointerup', end, { signal });
    c.addEventListener('pointercancel', end, { signal });
    c.addEventListener(
      'pointerleave',
      () => {
        if (this.hover && !this.drag) {
          this.hover = null;
          this.requestDraw();
        }
      },
      { signal },
    );

    c.addEventListener(
      'wheel',
      (e) => {
        if (!this.options.wheelZoom && !e.ctrlKey && !e.metaKey) return; // let the page scroll
        e.preventDefault();
        const p = this.local(e);
        this.zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015));
      },
      { passive: false, signal },
    );
  }
}
