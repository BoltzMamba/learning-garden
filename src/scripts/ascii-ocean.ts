/**
 * ASCII ocean renderer: a character grid drawn on one canvas.
 *
 * Layers (back → front, all in the same grid):
 *   1. currents  – sparse dash streaks from drifting value noise
 *   2. plankton  – a few slow particles, plus bubbles from fish
 *   3. ripples   – short-lived rings where the pointer moves
 *   4. fish      – procedural silhouettes rasterised into glyph cells
 *
 * The grid lines themselves are CSS (so they also show without JS).
 * Fish swim in lanes above/below the profile and fade near it.
 * Colours come from CSS custom properties, so both themes are handled in CSS.
 */

interface Palette {
  ink: string;
  inkStrong: string;
  water: string;
  block: string;
  blockStrength: number;
  accents: string[];
}

interface Fish {
  x: number;
  y: number;
  baseY: number;
  len: number;
  h: number;
  speed: number;
  dir: 1 | -1;
  /** Vertical cells travelled per horizontal cell (slanted paths). */
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
}

const EDGE = ".,:;'`";
const MID = 'tSX%o:s';
const CORE = '8#@%XS8';
const PLANKTON = "·.'`,";

function hash3(a: number, b: number, c: number): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function noise2(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash3(xi, yi, seed);
  const b = hash3(xi + 1, yi, seed);
  const c = hash3(xi, yi + 1, seed);
  const d = hash3(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class AsciiOcean {
  private ctx: CanvasRenderingContext2D;
  private cell = 18;
  private cols = 0;
  private rows = 0;
  private dpr = 1;
  private palette!: Palette;
  private fish: Fish[] = [];
  private particles: Particle[] = [];
  private ripples: Ripple[] = [];
  private time = 0;
  private last = 0;
  private raf = 0;
  private running = false;
  private seed = Math.floor(Math.random() * 1e6);
  /** Profile exclusion ellipse in cell units. */
  private avoid = { cx: 0, cy: 0, rx: 1, ry: 1, top: 0, bottom: 0 };
  // Per-frame cell buffers
  private glyph: string[] = [];
  private glyphAlpha = new Float32Array(0);
  private glyphColor = new Uint8Array(0);
  private blockAlpha = new Float32Array(0);
  private blockColor = new Uint8Array(0);
  private lastRipple = { c: -1, r: -1, t: 0 };

  private host: HTMLElement;
  private canvas: HTMLCanvasElement;
  private avoidEl: HTMLElement | null;
  private reducedMotion: boolean;

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

    const narrow = this.cols < 40;
    const count = Math.max(3, Math.min(7, Math.round((this.cols * this.rows) / (narrow ? 420 : 650))));
    this.fish = [];
    for (let i = 0; i < count; i++) this.fish.push(this.spawn(i, true));
    this.particles = [];
    const plankton = Math.round((this.cols * this.rows) / 140);
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

  private spawn(i: number, initial: boolean): Fish {
    const narrow = this.cols < 40;
    const depth = this.rand(i, 1);
    const len = narrow ? lerp(8, 12, depth) : lerp(11, 22, depth);
    const h = len * 0.27;
    const dir: 1 | -1 = this.rand(i, 2) < 0.5 ? 1 : -1;
    const baseY = this.pickLane(this.rand(i, 3), h);
    // Initially spread across the scene; later, enter from the side it swims from.
    const x = initial ? this.rand(i, 4) * (this.cols + len) - len / 2 : dir === 1 ? -len - 2 : this.cols + len + 2;
    return {
      x,
      y: baseY,
      baseY,
      len,
      h,
      speed: lerp(0.45, 1.15, depth) * (narrow ? 0.8 : 1),
      dir,
      slope: (this.rand(i, 9) - 0.5) * 0.5,
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
      this.draw();
    }
  }

  pointer(clientX: number, clientY: number) {
    if (this.reducedMotion) return;
    const rect = this.host.getBoundingClientRect();
    const c = Math.floor((clientX - rect.left) / this.cell);
    const r = Math.floor((clientY - rect.top) / this.cell);
    const now = this.time;
    if (Math.abs(c - this.lastRipple.c) + Math.abs(r - this.lastRipple.r) < 3 && now - this.lastRipple.t < 0.4) return;
    this.lastRipple = { c, r, t: now };
    this.ripples.push({ c, r, t0: now });
    if (this.ripples.length > 12) this.ripples.shift();
  }

  // --------------------------------------------------------------- update

  private update(dt: number) {
    this.time += dt;
    this.fish.forEach((f, i) => {
      f.x += f.dir * f.speed * dt;
      f.baseY += f.slope * f.speed * dt;
      f.y = f.baseY + Math.sin(f.phase + this.time * 0.22) * f.amp;
      const gone =
        (f.dir === 1 && f.x > this.cols + f.len + 2) ||
        (f.dir === -1 && f.x < -f.len - 2) ||
        f.y < -f.len ||
        f.y > this.rows + f.len;
      if (gone) {
        this.fish[i] = this.spawn(i + Math.floor(this.time), false);
      }
      if (this.time > f.bubbleAt) {
        f.bubbleAt = this.time + 4 + Math.random() * 8;
        this.particles.push({
          x: f.x + (f.dir * f.len) / 2,
          y: f.y - f.h * 0.3,
          vx: 0,
          vy: -0.6,
          life: 0,
          max: 4 + Math.random() * 2,
          bubble: true,
        });
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

  private put(i: number, ch: string, alpha: number, color: number) {
    this.glyph[i] = ch;
    this.glyphAlpha[i] = alpha;
    this.glyphColor[i] = color;
  }

  private rasterFish(f: Fish) {
    const { cols, rows } = this;
    // Orient the body along its motion vector (forward F, dorsal side N).
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
        if (up && u > 0.24 && u < 0.54) hb += f.h * 0.7 * Math.sin((Math.PI * (u - 0.24)) / 0.3); // dorsal fin
        if (!up && u > 0.3 && u < 0.46) hb += f.h * 0.35 * Math.sin((Math.PI * (u - 0.3)) / 0.16); // pectoral fin
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
        let color = 1; // ink
        if (eye) {
          ch = 'o';
          color = 2;
        } else if (d < 0.22) ch = EDGE[Math.floor(g * EDGE.length)];
        else if (d < 0.55) ch = MID[Math.floor(g * MID.length)];
        else {
          ch = CORE[Math.floor(g * CORE.length)];
          color = 2;
        }
        this.put(i, ch, k * lerp(0.55, 1, d), color);
        const accent = hash3(f.seed, Math.round(u * f.len) + 11, Math.round(ly) + 77);
        this.blockAlpha[i] = k * (0.07 + 0.3 * d) * this.palette.blockStrength * (d < 0.12 ? 0.35 : 1);
        this.blockColor[i] = accent < 0.05 && d > 0.25 ? 1 + Math.floor(accent * 60) % 3 : 0;
      }
    }
  }

  draw() {
    const { ctx, cols, rows, cell, palette } = this;
    if (!palette) return;
    const n = cols * rows;
    this.glyph.fill('');
    this.glyphAlpha.fill(0);
    this.blockAlpha.fill(0);
    this.blockColor.fill(0);

    // Fish first (front-most layer claims cells), nearest fish last so it wins.
    [...this.fish].sort((a, b) => a.depth - b.depth).forEach((f) => this.rasterFish(f));

    const t = this.time;
    // Ripples
    for (const rp of this.ripples) {
      const age = t - rp.t0;
      const radius = age * 3.2;
      const fadeOut = 1 - age / 1.6;
      const steps = Math.max(8, Math.round(radius * 7));
      for (let s = 0; s < steps; s++) {
        const ang = (s / steps) * Math.PI * 2;
        const c = Math.round(rp.c + Math.cos(ang) * radius * 1.4);
        const r = Math.round(rp.r + Math.sin(ang) * radius * 0.8);
        if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
        const i = r * cols + c;
        if (this.glyph[i]) continue;
        this.put(i, Math.abs(Math.sin(ang)) < 0.5 ? '~' : '·', 0.55 * fadeOut * this.clearing(c, r), 0);
      }
    }

    // Particles
    for (const p of this.particles) {
      const c = Math.floor(p.x);
      const r = Math.floor(p.y);
      if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
      const i = r * cols + c;
      if (this.glyph[i]) continue;
      if (p.bubble) {
        const k = p.life / p.max;
        this.put(i, k < 0.35 ? 'o' : k < 0.7 ? '°' : '.', 0.6 * (1 - k) * this.clearing(c, r), 1);
      } else {
        const tw = Math.min(1, p.life / 3, (p.max - p.life) / 3);
        this.put(i, PLANKTON[Math.floor(hash3(c, r, 3) * PLANKTON.length)], 0.35 * tw * this.clearing(c, r), 0);
      }
    }

    // Currents: dash streaks where drifting noise peaks
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (this.glyph[i]) continue;
        const density = noise2(c * 0.035 + 50, r * 0.07 - t * 0.012, this.seed + 2);
        const v = noise2(c * 0.11 - t * 0.09, r * 0.42 + Math.sin(c * 0.05 + t * 0.2) * 0.3, this.seed + 1);
        const threshold = 0.82 - density * 0.15;
        if (v < threshold) continue;
        if (hash3(c, r, this.seed + 9) < 0.38) continue; // broken, hand-drawn streaks
        const fade = this.clearing(c, r) * 0.75 + 0.25;
        const strength = Math.min(1, (v - threshold) / 0.12);
        const alt = hash3(c, r, this.seed);
        this.put(i, alt < 0.06 ? '~' : alt < 0.1 ? '=' : '-', (0.18 + 0.5 * strength) * fade, 0);
      }
    }

    // Render
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, cols * cell, rows * cell);
    const blockColors = [palette.block, ...palette.accents];
    const glyphColors = [palette.water, palette.ink, palette.inkStrong];
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
    for (let color = 0; color < 3; color++) {
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
