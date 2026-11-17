/**
 * Knowledge-graph renderer: a d3-force layout drawn on one canvas.
 *
 * Interactions: drag nodes, drag the background to pan, zoom with the wheel
 * (full page) or ctrl/⌘ + wheel (embedded previews, so page scrolling is not
 * hijacked), pinch to zoom on touch, hover to highlight a node and its
 * neighbours, click/tap to open. Under prefers-reduced-motion the layout is
 * computed up front and shown without animation.
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

export interface GraphPayloadNode {
  id: string;
  kind: 'note' | 'tag' | 'question';
  label: string;
  href: string;
  degree: number;
}

export interface GraphPayload {
  nodes: GraphPayloadNode[];
  links: { source: string; target: string; kind: string }[];
  center?: string;
}

interface Node extends SimulationNodeDatum, GraphPayloadNode {
  r: number;
}
type Link = SimulationLinkDatum<Node> & { kind: string };

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
  /** Always show labels (otherwise only when zoomed in or highlighted). */
  labels: boolean;
  reducedMotion: boolean;
}

const radius = (n: GraphPayloadNode) =>
  n.kind === 'note' ? 4 + Math.sqrt(n.degree) * 1.6 : n.kind === 'question' ? 3.6 : 3;

export class GraphView {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private options: GraphOptions;
  private all: GraphPayload;
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
  private center: string | undefined;
  private showTags = true;
  private frame = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private drag: { node: Node | null; startX: number; startY: number; moved: boolean; pinch?: number; viewK?: number } | null = null;
  private abort = new AbortController();
  private resizeObserver: ResizeObserver;

  constructor(canvas: HTMLCanvasElement, payload: GraphPayload, options: GraphOptions) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.options = options;
    this.all = payload;
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

  setShowTags(show: boolean) {
    this.showTags = show;
    this.build();
  }

  resetView() {
    this.userMoved = false;
    this.fit();
    this.requestDraw();
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
    const keep = (n: GraphPayloadNode) => this.showTags || n.kind !== 'tag';
    this.nodes = this.all.nodes.filter(keep).map((n) => {
      const old = previous.get(n.id);
      return { ...n, r: radius(n), x: old?.x, y: old?.y, vx: old?.vx, vy: old?.vy };
    });
    const ids = new Set(this.nodes.map((n) => n.id));
    this.links = this.all.links
      .filter((l) => ids.has(l.source) && ids.has(l.target))
      .map((l) => ({ source: l.source, target: l.target, kind: l.kind }));
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
          .distance((l) => (l.kind === 'tag' ? 70 : l.kind === 'question' ? 66 : 96))
          .strength((l) => (l.kind === 'link' ? 0.7 : 0.45)),
      )
      .force('charge', forceManyBody<Node>().strength((d) => (d.kind === 'note' ? -260 : -120)).distanceMax(480))
      // Room for the label under each node.
      .force('collide', forceCollide<Node>((d) => d.r + 16))
      // Gentle pull to the middle keeps unlinked notes in view.
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
    const pad = 48;
    const w = Math.max(maxX - minX, 1);
    const h = Math.max(maxY - minY, 1);
    // Never zoom in past 1.6×, so a single note stays a small star.
    const k = Math.min(1.6, (this.width - pad * 2) / w, (this.height - pad * 2) / h);
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

    const focus = this.hover?.id ?? (this.drag?.node?.id || undefined);
    const lit = focus ? this.neighbors.get(focus) : undefined;
    const isLit = (id: string) => !focus || id === focus || !!lit?.has(id);

    // Links
    for (const l of this.links) {
      const s = l.source as Node;
      const t = l.target as Node;
      const a = this.toScreen(s);
      const b = this.toScreen(t);
      const hot = !!focus && (s.id === focus || t.id === focus);
      ctx.globalAlpha = focus && !hot ? 0.25 : l.kind === 'link' ? 0.9 : 0.6;
      ctx.strokeStyle = hot ? c.accent : c.border;
      ctx.lineWidth = hot ? 1.4 : l.kind === 'link' ? 1.1 : 0.8;
      ctx.setLineDash(l.kind === 'link' ? [] : [2, 3]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Nodes
    // Small graphs label every note; large ones only when zoomed in (plus highlights).
    const showAllLabels = (this.options.labels && this.nodes.length <= 40) || view.k >= (this.nodes.length > 40 ? 1.8 : 1.1);
    const labels: { n: Node; x: number; y: number; strong: boolean }[] = [];
    for (const n of this.nodes) {
      const p = this.toScreen(n);
      if (p.x < -20 || p.y < -20 || p.x > W + 20 || p.y > H + 20) continue;
      const r = n.r * Math.max(0.75, Math.min(1.4, view.k));
      const isCenter = n.id === this.center;
      const isFocus = n.id === focus;
      ctx.globalAlpha = isLit(n.id) ? 1 : 0.28;
      const fill = isCenter || isFocus ? c.accent : focus && lit?.has(n.id) ? c.text : c.muted;
      ctx.lineWidth = 1.2;
      if (n.kind === 'tag') {
        ctx.strokeStyle = fill;
        ctx.fillStyle = c.bg;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (n.kind === 'question') {
        ctx.fillStyle = c.bg;
        ctx.strokeStyle = fill;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - r);
        ctx.lineTo(p.x + r, p.y);
        ctx.lineTo(p.x, p.y + r);
        ctx.lineTo(p.x - r, p.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      if (isCenter) {
        ctx.strokeStyle = c.accent;
        ctx.globalAlpha = 0.45;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      const wantLabel = isCenter || isFocus || (focus && lit?.has(n.id)) || (showAllLabels && (n.kind === 'note' || view.k >= 1.4));
      if (wantLabel) labels.push({ n, x: p.x, y: p.y + r + 11, strong: !!(isCenter || isFocus || (focus && lit?.has(n.id))) });
    }

    // Labels last, with a background halo for legibility.
    ctx.font = `11px "JetBrains Mono", ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    // Greedy placement: highlighted labels first, then better-connected nodes;
    // a label that would overlap one already placed is skipped.
    labels.sort((a, b) => Number(b.strong) - Number(a.strong) || b.n.degree - a.n.degree);
    const placed: { l: number; r: number; t: number; b: number }[] = [];
    for (const { n, x, y, strong } of labels) {
      const text = n.label.length > 22 ? `${n.label.slice(0, 21)}…` : n.label;
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

  private bindEvents() {
    const c = this.canvas;
    const signal = this.abort.signal;

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
