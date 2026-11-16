/**
 * ASCII ocean renderer: one canvas, one character grid.
 *
 * Layers (front-most claims a cell first):
 *   1. food pellets + crumbs   (click / tap to feed)
 *   2. big fish                (1–2 procedural glyph silhouettes)
 *   3. small fish schools      (simulated in ocean-sim.ts)
 *   4. bubbles, plankton, hover ripples
 *
 * Grid lines are CSS (also the no-JS fallback). Colours come from CSS custom
 * properties, so light/dark themes are handled in CSS.
 */
import { FEED, mulberry32, OceanSim, SPECIES, type Ellipse } from './ocean-sim.ts';

interface Palette {
  ink: string;
  inkStrong: string;
  water: string;
  block: string;
  blockStrength: number;
  accents: string[];
}

interface BigFish {
  x: number;
  y: number;
  baseY: number;
  len: number;
  h: number;
  speed: number;
  dir: 1 | -1;
  slope: number;
  phase: number;
  amp: number;
  seed: number;
  depth: number;
  bubbleAt: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  bubble: boolean;
}

interface Ripple {
  c: number;
  r: number;
  t0: number;
  strength: number;
}

const EDGE = ".,:;'`";
const MID = 'tSX%o:s';
const CORE = '8#@%XS8';
const PLANKTON = "·.'`,";
/** Glyph colour slots. */
const WATER = 0;
const INK = 1;
const STRONG = 2;
const FOOD = 3;

function hash3(a: number, b: number, c: number): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Single-cell fish: level dash, tilting only when clearly climbing/diving (screen y points down). */
function dashFor(vx: number, vy: number): string {
  const a = Math.atan2(Math.abs(vy), Math.abs(vx)); // 0 = level, π/2 = vertical
  if (a < 0.95) return '-';
  return vx * vy > 0 ? '\\' : '/';
}

export class AsciiOcean {
  private host: HTMLElement;
  private canvas: HTMLCanvasElement;
  private avoidEl: HTMLElement | null;
  private reducedMotion: boolean;
  private ctx: CanvasRenderingContext2D;
  private cell = 18;
  private cols = 0;
  private rows = 0;
  private dpr = 1;
  private palette!: Palette;
  private sim: OceanSim | undefined;
  private bigFish: BigFish[] = [];
  private particles: Particle[] = [];
  private ripples: Ripple[] = [];
  private time = 0;
  private last = 0;
  private raf = 0;
  private running = false;
  private seed = Math.floor(Math.random() * 1e6);
  /** Profile clearing in cell units. */
  private avoid = { cx: 0, cy: 0, rx: 1, ry: 1, top: 0, bottom: 0 };
  private glyph: string[] = [];
  private glyphAlpha = new Float32Array(0);
  private glyphColor = new Uint8Array(0);
  private blockAlpha = new Float32Array(0);
  private blockColor = new Uint8Array(0);
  private lastRipple = { c: -1, r: -1, t: 0 };

  constructor(host: HTMLElement, canvas: HTMLCanvasElement, avoidEl: HTMLElement | null, reducedMotion: boolean) {
    this.host = host;
    this.canvas = canvas;
    this.avoidEl = avoidEl;
    this.reducedMotion = reducedMotion;
    this.ctx = canvas.getContext('2d')!;
    this.readPalette();
    this.resize();
  }

  // ---------------------------------------------------------------- setup

  readPalette() {
    const s = getComputedStyle(this.host);
    const v = (name: string) => s.getPropertyValue(name).trim();
    this.palette = {
      ink: v('--ocean-ink'),
      inkStrong: v('--ocean-ink-strong'),
      water: v('--ocean-water'),
      block: v('--ocean-block'),
      blockStrength: Number(v('--ocean-block-strength')) || 1,
      accents: [v('--ocean-accent-1'), v('--ocean-accent-2'), v('--ocean-accent-3')],
    };
    if (!this.running) this.draw();
  }

  resize() {
    const rect = this.host.getBoundingClientRect();
    this.cell = Number(getComputedStyle(this.host).getPropertyValue('--ocean-cell').replace('px', '')) || 18;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    this.cols = Math.ceil(rect.width / this.cell);
    this.rows = Math.ceil(rect.height / this.cell);
    const n = this.cols * this.rows;
    this.glyph = new Array(n).fill('');
    this.glyphAlpha = new Float32Array(n);
    this.glyphColor = new Uint8Array(n);
    this.blockAlpha = new Float32Array(n);
    this.blockColor = new Uint8Array(n);

    if (this.avoidEl) {
      const a = this.avoidEl.getBoundingClientRect();
      const left = (a.left - rect.left) / this.cell;
      const top = (a.top - rect.top) / this.cell;
      const w = a.width / this.cell;
      const h = a.height / this.cell;
      this.avoid = { cx: left + w / 2, cy: top + h / 2, rx: w / 2 + 3, ry: h / 2 + 2.5, top, bottom: top + h };
    } else {
      this.avoid = { cx: this.cols / 2, cy: this.rows / 2, rx: 1, ry: 1, top: this.rows / 2, bottom: this.rows / 2 };
    }
    const avoidPx: Ellipse = {
      cx: this.avoid.cx * this.cell,
      cy: this.avoid.cy * this.cell,
      rx: this.avoid.rx * this.cell,
      ry: this.avoid.ry * this.cell,
    };

    if (this.sim) {
      this.sim.resize(rect.width, rect.height, this.cell, avoidPx);
    } else {
      this.sim = new OceanSim({
        width: rect.width,
        height: rect.height,
        cell: this.cell,
        rng: mulberry32(this.seed),
        avoid: avoidPx,
      });
      // Let schools form before the first frame (also the reduced-motion still).
      this.sim.step(3);
    }

    const narrow = this.cols < 40;
    this.bigFish = [];
    for (let i = 0; i < (narrow ? 1 : 2); i++) this.bigFish.push(this.spawnBig(i, true));
    this.particles = [];
    const plankton = Math.round((this.cols * this.rows) / 320);
    for (let i = 0; i < plankton; i++) this.particles.push(this.spawnPlankton(true));
    this.draw();
  }

  private rand(i: number, salt: number) {
    return hash3(this.seed + i * 7919, salt, Math.floor(this.time * 10));
  }

  /** Lanes are the bands above and below the profile. */
  private pickLane(r: number, h: number): number {
    const headerRows = Math.ceil(64 / this.cell);
    const topBand: [number, number] = [headerRows + h + 1, this.avoid.top - h - 1.5];
    const bottomBand: [number, number] = [this.avoid.bottom + h + 1.5, this.rows - h - 2];
    const bands = [topBand, bottomBand].filter(([a, b]) => b - a >= 1);
    if (!bands.length) return lerp(headerRows + h, this.rows - h - 2, r);
    const sizes = bands.map(([a, b]) => b - a);
    const total = sizes.reduce((x, y) => x + y, 0);
    let pick = r * total;
    for (let i = 0; i < bands.length; i++) {
      if (pick <= sizes[i]) return bands[i][0] + pick;
      pick -= sizes[i];
    }
    return bands[0][0];
  }

  private spawnBig(i: number, initial: boolean): BigFish {
    const narrow = this.cols < 40;
    const depth = this.rand(i, 1);
    const len = narrow ? lerp(7, 9, depth) : lerp(10, 15, depth);
    const h = len * 0.27;
    const dir: 1 | -1 = this.rand(i, 2) < 0.5 ? 1 : -1;
    const baseY = this.pickLane(this.rand(i, 3), h);
    const x = initial ? this.rand(i, 4) * (this.cols + len) - len / 2 : dir === 1 ? -len - 2 : this.cols + len + 2;
    return {
      x,
      y: baseY,
      baseY,
      len,
      h,
      speed: lerp(0.8, 1.5, depth) * (narrow ? 0.8 : 1),
      dir,
      slope: (this.rand(i, 9) - 0.5) * 0.4,
      phase: this.rand(i, 5) * Math.PI * 2,
      amp: lerp(0.3, 1.2, this.rand(i, 6)),
      seed: Math.floor(this.rand(i, 7) * 1e6),
      depth,
      bubbleAt: this.time + 2 + this.rand(i, 8) * 6,
    };
  }

  private spawnPlankton(initial: boolean): Particle {
    const r = Math.random;
    return {
      x: r() * this.cols,
      y: initial ? r() * this.rows : this.rows + 1,
      vx: (r() - 0.5) * 0.15,
      vy: -lerp(0.08, 0.25, r()),
      life: initial ? r() * 30 : 0,
      max: 40 + r() * 30,
      bubble: false,
    };
  }

  // ------------------------------------------------------------ lifecycle

  start() {
    if (this.reducedMotion || this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      const dt = (now - this.last) / 1000;
      if (dt < 1 / 30) return; // ~30 fps is plenty for slow motion
      this.last = now;
      this.update(Math.min(dt, 0.1));
      this.draw();
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  setReducedMotion(reduced: boolean) {
    this.reducedMotion = reduced;
    if (reduced) {
      this.stop();
      this.ripples = [];
      if (this.sim) {
        this.sim.pellets = [];
        this.sim.crumbs = [];
        for (const f of this.sim.fish) f.target = -1;
      }
      this.draw();
    }
  }

  /** Hover ripple (mouse only). */
  pointer(clientX: number, clientY: number) {
    if (this.reducedMotion) return;
    const rect = this.host.getBoundingClientRect();
    const c = Math.floor((clientX - rect.left) / this.cell);
    const r = Math.floor((clientY - rect.top) / this.cell);
    const now = this.time;
    if (Math.abs(c - this.lastRipple.c) + Math.abs(r - this.lastRipple.r) < 4 && now - this.lastRipple.t < 0.6) return;
    this.lastRipple = { c, r, t: now };
    this.ripples.push({ c, r, t0: now, strength: 0.35 });
    if (this.ripples.length > 8) this.ripples.shift();
  }

  /** Drop food at a viewport point. Returns false when feeding is disabled. */
  feedAt(clientX: number, clientY: number): boolean {
    if (this.reducedMotion || !this.sim) return false;
    const rect = this.host.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    this.sim.feed(x, y);
    this.ripples.push({ c: Math.floor(x / this.cell), r: Math.floor(y / this.cell), t0: this.time, strength: 0.6 });
    if (!this.running) this.draw();
    return true;
  }

  /** Test/debug hook: current simulation state. */
  get state() {
    return this.sim;
  }

  // --------------------------------------------------------------- update

  private update(dt: number) {
    this.time += dt;
    const sim = this.sim!;
    // Big fish give the schools some room.
    sim.obstacles = this.bigFish.map((f) => ({ x: f.x * this.cell, y: f.y * this.cell, r: f.len * this.cell * 0.6 }));
    sim.step(dt);

    this.bigFish.forEach((f, i) => {
      f.x += f.dir * f.speed * dt;
      f.baseY += f.slope * f.speed * dt;
      f.y = f.baseY + Math.sin(f.phase + this.time * 0.22) * f.amp;
      const gone =
        (f.dir === 1 && f.x > this.cols + f.len + 2) ||
        (f.dir === -1 && f.x < -f.len - 2) ||
        f.y < -f.len ||
        f.y > this.rows + f.len;
      if (gone) this.bigFish[i] = this.spawnBig(i + Math.floor(this.time), false);
      if (this.time > f.bubbleAt) {
        f.bubbleAt = this.time + 4 + Math.random() * 8;
        this.particles.push({ x: f.x + (f.dir * f.len) / 2, y: f.y - f.h * 0.3, vx: 0, vy: -0.6, life: 0, max: 5, bubble: true });
      }
    });
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      p.x += p.vx * dt + (p.bubble ? Math.sin(p.life * 3) * 0.02 : 0);
      p.y += p.vy * dt;
      if (p.life > p.max || p.y < -1 || p.x < -1 || p.x > this.cols + 1) {
        if (p.bubble) this.particles.splice(i, 1);
        else this.particles[i] = this.spawnPlankton(false);
      }
    }
    this.ripples = this.ripples.filter((rp) => this.time - rp.t0 < 1.6);
  }

  /** 0 inside the profile clearing, 1 well outside it. */
  private clearing(c: number, r: number): number {
    const dx = (c + 0.5 - this.avoid.cx) / this.avoid.rx;
    const dy = (r + 0.5 - this.avoid.cy) / this.avoid.ry;
    return smoothstep(0.8, 1.35, Math.sqrt(dx * dx + dy * dy));
  }

  // ----------------------------------------------------------------- draw

  /** Claim a free cell. Returns false if it was already taken. */
  private put(i: number, ch: string, alpha: number, color: number): boolean {
    if (this.glyph[i]) return false;
    this.glyph[i] = ch;
    this.glyphAlpha[i] = alpha;
    this.glyphColor[i] = color;
    return true;
  }

  private rasterBigFish(f: BigFish) {
    const { cols, rows } = this;
    const vx = f.dir * f.speed;
    const vy = f.slope * f.speed + f.amp * 0.22 * Math.cos(f.phase + this.time * 0.22);
    const ang = Math.max(-0.6, Math.min(0.6, Math.atan(vy / vx)));
    const fx = Math.cos(ang) * f.dir;
    const fy = Math.sin(ang) * f.dir;
    const nx = -fy * f.dir;
    const ny = fx * f.dir;
    const alpha = lerp(0.62, 1, f.depth);
    const reach = f.len * 0.6 + 2;
    const r0 = Math.max(0, Math.floor(f.y - reach));
    const r1 = Math.min(rows - 1, Math.ceil(f.y + reach));
    const c0 = Math.max(0, Math.floor(f.x - reach));
    const c1 = Math.min(cols - 1, Math.ceil(f.x + reach));
    const half = f.len / 2;

    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const dx = c + 0.5 - f.x;
        const dy = r + 0.5 - f.y;
        const lx = dx * fx + dy * fy;
        const ly0 = dx * nx + dy * ny;
        const u = (half - lx) / f.len; // 0 = nose, 1 = tail tip
        if (u < 0 || u > 1) continue;
        const ly = ly0 - Math.sin(this.time * 2.4 + f.phase - u * 5) * f.h * 0.35 * u * u;
        const up = ly < 0;
        let hb: number;
        let inner = 0;
        if (u < 0.28) hb = f.h * Math.pow(u / 0.28, 0.5);
        else if (u < 0.78) hb = f.h * (1 - Math.pow((u - 0.28) / 0.5, 1.4) * 0.74);
        else {
          const k = (u - 0.78) / 0.22;
          hb = f.h * (0.28 + 0.95 * k);
          inner = f.h * 0.75 * Math.max(0, (k - 0.45) / 0.55);
        }
        if (up && u > 0.24 && u < 0.54) hb += f.h * 0.7 * Math.sin((Math.PI * (u - 0.24)) / 0.3);
        if (!up && u > 0.3 && u < 0.46) hb += f.h * 0.35 * Math.sin((Math.PI * (u - 0.3)) / 0.16);
        const a = Math.abs(ly);
        if (a > hb + 0.15 || a < inner) continue;

        const i = r * cols + c;
        const fade = this.clearing(c, r);
        if (fade <= 0.02) continue;
        let d = Math.max(0, 1 - a / Math.max(hb, 0.5));
        if (u > 0.78) d *= 0.6;
        const k = alpha * fade;
        const g = hash3(f.seed, Math.round(u * f.len), Math.round(ly) + 50);
        const eye = Math.abs(u - 0.14) < 0.55 / f.len && Math.abs(ly + f.h * 0.3) < 0.6;
        let ch: string;
        let color = INK;
        if (eye) {
          ch = 'o';
          color = STRONG;
        } else if (d < 0.22) ch = EDGE[Math.floor(g * EDGE.length)];
        else if (d < 0.55) ch = MID[Math.floor(g * MID.length)];
        else {
          ch = CORE[Math.floor(g * CORE.length)];
          color = STRONG;
        }
        if (!this.put(i, ch, k * lerp(0.55, 1, d), color)) continue;
        const accent = hash3(f.seed, Math.round(u * f.len) + 11, Math.round(ly) + 77);
        this.blockAlpha[i] = k * (0.07 + 0.3 * d) * this.palette.blockStrength * (d < 0.12 ? 0.35 : 1);
        this.blockColor[i] = accent < 0.05 && d > 0.25 ? 1 + (Math.floor(accent * 60) % 3) : 0;
      }
    }
  }

  private cellIndex(x: number, y: number): number {
    const c = Math.floor(x / this.cell);
    const r = Math.floor(y / this.cell);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
    return r * this.cols + c;
  }

  draw() {
    const { ctx, cols, rows, cell, palette, sim } = this;
    if (!palette || !sim) return;
    const n = cols * rows;
    this.glyph.fill('');
    this.glyphAlpha.fill(0);
    this.blockAlpha.fill(0);
    this.blockColor.fill(0);
    const t = sim.time;

    // 1. Food (front-most so it is always visible).
    for (const p of sim.pellets) {
      const i = this.cellIndex(p.x, p.y);
      if (i < 0) continue;
      const age = t - p.born;
      const fadeIn = Math.min(1, age / 0.25);
      const fadeOut = Math.min(1, (FEED.life - age) / 2);
      this.put(i, p.amount > 0.45 ? '•' : '·', Math.max(0, 0.95 * fadeIn * fadeOut * (0.45 + 0.55 * p.amount)), FOOD);
    }
    for (const c of sim.crumbs) {
      const k = (t - c.born) / 0.8;
      for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1]]) {
        const i = this.cellIndex(c.x + ox * cell * (0.6 + k), c.y + oy * cell * (0.4 + k));
        if (i >= 0) this.put(i, '.', 0.6 * (1 - k), FOOD);
      }
    }

    // 2. Big fish, nearest first so it wins overlaps.
    [...this.bigFish].sort((a, b) => b.depth - a.depth).forEach((f) => this.rasterBigFish(f));

    // 3. Small fish schools.
    for (const f of sim.fish) {
      const c = Math.floor(f.x / cell);
      const r = Math.floor(f.y / cell);
      if (r < 0 || r >= rows) continue;
      const sp = SPECIES[f.species];
      const fade = this.clearing(c, r);
      if (fade <= 0.02) continue;
      const alpha = (0.4 + 0.6 * f.depth + (f.target >= 0 ? 0.15 : 0)) * fade;
      if (!sp.shape) {
        if (c >= 0 && c < cols) this.put(r * cols + c, dashFor(f.vx, f.vy), alpha, sp.tone);
        continue;
      }
      const right = f.vx >= 0;
      const text = right ? sp.shape.right : sp.shape.left;
      for (let k = 0; k < text.length; k++) {
        // Head sits on the fish's cell; the body trails behind it.
        const cc = right ? c - (text.length - 1 - k) : c + k;
        if (cc < 0 || cc >= cols) continue;
        this.put(r * cols + cc, text[k], alpha, sp.tone);
      }
    }

    // 4. Ripples, bubbles, plankton.
    for (const rp of this.ripples) {
      const age = this.time - rp.t0;
      const radius = age * 3.2;
      const fadeOut = 1 - age / 1.6;
      const steps = Math.max(8, Math.round(radius * 7));
      for (let s = 0; s < steps; s++) {
        const ang = (s / steps) * Math.PI * 2;
        const c = Math.round(rp.c + Math.cos(ang) * radius * 1.4);
        const r = Math.round(rp.r + Math.sin(ang) * radius * 0.8);
        if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
        this.put(r * cols + c, Math.abs(Math.sin(ang)) < 0.5 ? '~' : '·', rp.strength * fadeOut * this.clearing(c, r), WATER);
      }
    }
    for (const p of this.particles) {
      const c = Math.floor(p.x);
      const r = Math.floor(p.y);
      if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
      const i = r * cols + c;
      if (p.bubble) {
        const k = p.life / p.max;
        this.put(i, k < 0.35 ? 'o' : k < 0.7 ? '°' : '.', 0.6 * (1 - k) * this.clearing(c, r), INK);
      } else {
        const tw = Math.min(1, p.life / 3, (p.max - p.life) / 3);
        this.put(i, PLANKTON[Math.floor(hash3(c, r, 3) * PLANKTON.length)], 0.3 * tw * this.clearing(c, r), WATER);
      }
    }

    // Render
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, cols * cell, rows * cell);
    const blockColors = [palette.block, ...palette.accents];
    const glyphColors = [palette.water, palette.ink, palette.inkStrong, palette.accents[1]];
    for (let i = 0; i < n; i++) {
      const a = this.blockAlpha[i];
      if (a <= 0.005) continue;
      ctx.globalAlpha = this.blockColor[i] ? Math.min(0.55, a * 2.2) : a;
      ctx.fillStyle = blockColors[this.blockColor[i]];
      ctx.fillRect((i % cols) * cell + 1, Math.floor(i / cols) * cell + 1, cell - 1, cell - 1);
    }
    ctx.font = `500 ${Math.round(cell * 0.76)}px "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let color = 0; color < glyphColors.length; color++) {
      ctx.fillStyle = glyphColors[color];
      for (let i = 0; i < n; i++) {
        const ch = this.glyph[i];
        if (!ch || this.glyphColor[i] !== color) continue;
        const a = this.glyphAlpha[i];
        if (a <= 0.01) continue;
        ctx.globalAlpha = Math.min(1, a);
        ctx.fillText(ch, (i % cols) * cell + cell / 2, Math.floor(i / cols) * cell + cell / 2 + 0.5);
      }
    }
    ctx.globalAlpha = 1;
  }
}
