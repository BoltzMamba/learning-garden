/**
 * ASCII ocean renderer: one canvas, one character grid.
 *
 * Layers:
 *   1. big creatures — sharks, a manta, a whale shark and a sunfish,
 *      rasterised from species body plans (./creatures/, partly adapted from
 *      ascii-sharks, MIT — see ./creatures/LICENSE-ascii-sharks.md)
 *   2. food pellets + crumbs (click / tap to feed)
 *   3. small fish schools (simulated in ocean-sim.ts), skipping creature cells
 *   4. hover ripples and plankton
 *
 * Cells are glyph-shaped (≈ 12 × 17 px on desktop), like the reference. The
 * CSS grid lines on the host read the same size from --ocean-cw / --ocean-ch.
 */
import { CreatureWorld } from './creatures/creatures.ts';
import { CreatureRaster, readCreaturePalette, type CreaturePalette } from './creatures/raster.ts';
import { DEFAULT_LINEUP } from './creatures/shapes.ts';
import { FEED, fishCountFor, mulberry32, OceanSim, type Ellipse } from './ocean-sim.ts';

import { SchoolDensity } from './school-density.ts';

interface Palette {
  ink: string;
  inkStrong: string;
  water: string;
  food: string;
  ripple: string;
  school: string;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
}

interface Ripple {
  x: number;
  y: number;
  t0: number;
  strength: number;
}

const PLANKTON = "·.'`,";
const STEP = 1 / 60;
/** Glyph colour slots (small fish use their species tone: 0 water, 1 ink, 2 strong). */
const WATER = 0;
const FOOD = 3;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

function hash3(a: number, b: number, c: number): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Creature line-up for a viewport width: the full species mix at every breakpoint. */
function lineupFor() {
  return DEFAULT_LINEUP;
}

export class AsciiOcean {
  private host: HTMLElement;
  private canvas: HTMLCanvasElement;
  private avoidEl: HTMLElement | null;
  private reducedMotion: boolean;
  private ctx: CanvasRenderingContext2D;
  private cw = 12;
  private ch = 17;
  private cols = 0;
  private rows = 0;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private palette!: Palette;
  private creaturePalette!: CreaturePalette;
  private sim: OceanSim | undefined;
  private world = new CreatureWorld();
  private raster = new CreatureRaster();
  private seededWidth = 0;
  private schoolDensity = new SchoolDensity(0);
  private schoolCells = new Int32Array(12);
  private particles: Particle[] = [];
  private ripples: Ripple[] = [];
  private time = 0;
  private acc = 0;
  private last = 0;
  private raf = 0;
  private running = false;
  private seed = Math.floor(Math.random() * 1e6);
  /** Profile clearing in px. */
  private avoid: Ellipse = { cx: 0, cy: 0, rx: 1, ry: 1 };
  /** The profile's own box (px): nothing is ever drawn inside it. */
  private avoidRect = { l: 0, t: 0, r: 0, b: 0 };
  private glyph: string[] = [];
  private glyphAlpha = new Float32Array(0);
  private glyphColor = new Uint8Array(0);
  private lastRipple = { x: -1e9, y: -1e9, t: 0 };

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
      food: v('--ocean-accent-2'),
      ripple: v('--ocean-ripple'),
      school: v('--ocean-school'),
    };
    this.creaturePalette = readCreaturePalette(this.host);
    if (!this.running) this.draw();
  }

  resize() {
    const rect = this.host.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const W = rect.width;
    const H = rect.height;
    this.width = W;
    this.height = H;
    // Glyph-shaped cells, as in the reference renderer.
    this.cw = clamp(Math.round(W / 124), 8, 13);
    this.ch = Math.round(this.cw * 1.45);
    this.host.style.setProperty('--ocean-cw', `${this.cw}px`);
    this.host.style.setProperty('--ocean-ch', `${this.ch}px`);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(W * this.dpr);
    this.canvas.height = Math.round(H * this.dpr);
    this.canvas.style.width = `${W}px`;
    this.canvas.style.height = `${H}px`;
    this.cols = Math.ceil(W / this.cw);
    this.rows = Math.ceil(H / this.ch);
    const n = this.cols * this.rows;
    this.glyph = new Array(n).fill('');
    this.glyphAlpha = new Float32Array(n);
    this.glyphColor = new Uint8Array(n);
    // Large silhouettes have their own fine grid; school spacing stays unchanged.
    const creatureCell = W < 640 ? 5 : 7;
    this.raster.resize(Math.ceil(W / creatureCell), Math.ceil(H / (creatureCell * 1.5)), creatureCell, creatureCell * 1.5);

    if (this.avoidEl) {
      const a = this.avoidEl.getBoundingClientRect();
      this.avoidRect = {
        l: a.left - rect.left - this.cw,
        t: a.top - rect.top - this.ch * 0.5,
        r: a.right - rect.left + this.cw,
        b: a.bottom - rect.top + this.ch * 0.5,
      };
      this.avoid = {
        cx: a.left - rect.left + a.width / 2,
        cy: a.top - rect.top + a.height / 2,
        rx: a.width / 2 + this.cw * 3,
        ry: a.height / 2 + this.ch * 2.5,
      };
    } else {
      this.avoid = { cx: W / 2, cy: H / 2, rx: 1, ry: 1 };
      this.avoidRect = { l: 0, t: 0, r: 0, b: 0 };
    }

    if (this.sim) {
      this.sim.resize(W, H, this.cw, this.avoid, this.ch);
    } else {
      this.sim = new OceanSim({ width: W, height: H, cell: this.cw, cellH: this.ch, rng: mulberry32(this.seed), avoid: this.avoid, count: Math.round(fishCountFor(W,H)*3.45) });
      this.schoolDensity = new SchoolDensity(this.sim.fish.length);
      // Keep the original simultaneous feeding limit despite the larger display reserve.
      this.sim.maxChasers = Math.max(3,Math.min(FEED.maxChasers,Math.round(fishCountFor(W,H)/40)));
      this.sim.step(3); // let schools form before the first frame
    }

    // Big creatures: seed once (or when the layout class changes), then settle.
    this.world.avoid = this.avoid;
    if (!this.seededWidth || (this.seededWidth < 640) !== (W < 640)) {
      this.world.seed(lineupFor(), W, H);
      for (let i = 0; i < 30; i++) this.world.step(STEP);
      this.seededWidth = W;
    } else {
      this.world.resize(W, H);
    }

    this.particles = [];
    const plankton = Math.round((this.cols * this.rows) / 360);
    for (let i = 0; i < plankton; i++) this.particles.push(this.spawnPlankton(true));
    this.draw();
  }

  private spawnPlankton(initial: boolean): Particle {
    const r = Math.random;
    return {
      x: r() * this.width,
      y: initial ? r() * this.height : this.height + 4,
      vx: (r() - 0.5) * 2,
      vy: -(2 + r() * 3),
      life: initial ? r() * 30 : 0,
      max: 40 + r() * 30,
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
      if (dt < 1 / 30) return; // render at ~30 fps; physics uses fixed steps
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
      for (const c of this.world.creatures) { c.target = -1; c.mode = 'cruise'; }
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
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (Math.hypot(x - this.lastRipple.x, y - this.lastRipple.y) < this.cw * 4 && this.time - this.lastRipple.t < 0.6) return;
    this.lastRipple = { x, y, t: this.time };
    this.ripples.push({ x, y, t0: this.time, strength: 0.65 });
    if (this.ripples.length > 8) this.ripples.shift();
  }

  /** Drop food at a viewport point. Returns false when feeding is disabled. */
  feedAt(clientX: number, clientY: number): boolean {
    if (this.reducedMotion || !this.sim) return false;
    const rect = this.host.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    this.sim.feed(x, y);
    this.ripples.push({ x, y, t0: this.time, strength: 0.8 });
    if (!this.running) this.draw();
    return true;
  }

  /** Debug hooks (?ocean-debug): simulation state. */
  get state() {
    return this.sim;
  }

  get creatures() {
    return this.world.creatures;
  }

  // --------------------------------------------------------------- update

  private update(dt: number) {
    this.time += dt;
    // Fixed-step creature physics.
    this.acc += dt;
    let steps = 0;
    while (this.acc >= STEP && steps < 6) {
      this.world.step(STEP, this.sim!.pellets, this.sim!.time);
      this.sim!.step(STEP);
      this.acc -= STEP;
      steps++;
    }
    if (steps === 6) this.acc = 0;

    const sim = this.sim!;
    this.schoolDensity.step(dt,this.world.visibleCount,sim.fish);
    // Small fish give the big creatures room (points along each spine).
    let obstacleIndex = 0;
    for (const c of this.world.creatures) {
      if (!c.active) continue;
      const r = c.length * (c.kind === 'manta' ? 0.34 : c.kind === 'sunfish' ? 0.3 : 0.18) + 18;
      for (let k = 0; k <= 12; k += 4) {
        const ob = sim.obstacles[obstacleIndex] ?? (sim.obstacles[obstacleIndex] = { x: 0, y: 0, r: 0 });
        ob.x = c.nodes[k * 2]; ob.y = c.nodes[k * 2 + 1]; ob.r = r;
        obstacleIndex++;
      }
    }
    sim.obstacles.length = obstacleIndex;

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.life > p.max || p.y < -4 || p.x < -4 || p.x > this.width + 4) this.particles[i] = this.spawnPlankton(false);
    }
    this.ripples = this.ripples.filter((rp) => this.time - rp.t0 < 1.6);
  }

  /** 0 inside the profile clearing, 1 well outside it (cell coordinates). */
  private clearing(c: number, r: number): number {
    const x = (c + 0.5) * this.cw;
    const y = (r + 0.5) * this.ch;
    const box = this.avoidRect;
    if (x > box.l && x < box.r && y > box.t && y < box.b) return 0;
    const dx = (x - this.avoid.cx) / this.avoid.rx;
    const dy = (y - this.avoid.cy) / this.avoid.ry;
    return smoothstep(0.8, 1.35, Math.sqrt(dx * dx + dy * dy));
  }

  // ----------------------------------------------------------------- draw

  /** Claim a free cell for the small-glyph layer. */
  private put(i: number, ch: string, alpha: number, color: number, overCreatures = false): boolean {
    if (this.glyph[i] || (!overCreatures && this.raster.occupied(Math.floor(((i / this.cols | 0) + .5) * this.ch / this.raster.ch) * this.raster.cols + Math.floor((i % this.cols + .5) * this.cw / this.raster.cw)))) return false;
    this.glyph[i] = ch;
    this.glyphAlpha[i] = alpha;
    this.glyphColor[i] = color;
    return true;
  }

  private cellIndex(x: number, y: number): number {
    const c = Math.floor(x / this.cw);
    const r = Math.floor(y / this.ch);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
    return r * this.cols + c;
  }

  draw() {
    const { ctx, cols, rows, cw, ch, palette, sim } = this;
    if (!palette || !sim || !cols) return;
    const n = cols * rows;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.font = `400 ${Math.round(ch * 0.74)}px "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 1. Big creatures.
    ctx.font = `400 ${this.raster.ch * .88}px "JetBrains Mono", Consolas, monospace`;
    this.raster.rasterize(this.world.creatures, (c, r) => this.clearing((c + .5) * this.raster.cw / cw - .5, (r + .5) * this.raster.ch / ch - .5));
    this.raster.draw(ctx, this.creaturePalette, this.time);
    this.world.observeVisibility(this.raster.visibleCells, this.raster.leftCells, this.raster.rightCells);
    ctx.font = `400 ${Math.round(ch * .74)}px "JetBrains Mono", Consolas, monospace`;

    this.glyph.fill('');
    this.glyphAlpha.fill(0);
    const t = sim.time;

    // 2. Food, on top of everything.
    for (const p of sim.pellets) {
      const i = this.cellIndex(p.x, p.y);
      if (i < 0) continue;
      const age = t - p.born;
      const fadeIn = Math.min(1, age / 0.25);
      const fadeOut = Math.min(1, (FEED.life - age) / 2);
      this.put(i, p.amount > 0.45 ? '•' : '·', Math.max(0, 0.95 * fadeIn * fadeOut * (0.45 + 0.55 * p.amount)), FOOD, true);
    }
    for (const c of sim.crumbs) {
      const k = (t - c.born) / 0.8;
      for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1]]) {
        const i = this.cellIndex(c.x + ox * cw * (0.6 + k), c.y + oy * ch * (0.4 + k));
        if (i >= 0) this.put(i, '.', 0.6 * (1 - k), FOOD, true);
      }
    }

    // 3. A school member is one sprite / one simulation entity. In particular,
    // "--" is measured, claimed and drawn atomically, never as two particles.
    this.schoolCells.fill(0);
    const unit = ctx.measureText('-').width;
    ctx.fillStyle = palette.school;
    for (let fi=0;fi<sim.fish.length;fi++) {
      const f = sim.fish[fi];
      const presence = this.schoolDensity.alpha[fi];
      if (presence < .02) continue;
      const r = Math.floor(f.y / ch);
      const half = unit * f.glyph.length / 2;
      const c0 = Math.floor((f.x-half)/cw), c1 = Math.floor((f.x+half)/cw);
      if (r<0 || r>=rows || c0<0 || c1>=cols) continue;
      let free = true, fade = 1;
      for(let c=c0;c<=c1;c++) {
        fade = Math.min(fade,this.clearing(c,r));
        if(this.glyph[r*cols+c]) { free=false; break; }
      }
      // Test the full sprite footprint against the large-fish raster.
      for(let rr=Math.max(0,Math.floor((f.y-ch*.35)/this.raster.ch));free && rr<=Math.min(this.raster.rows-1,Math.floor((f.y+ch*.35)/this.raster.ch));rr++)
        for(let cc=Math.max(0,Math.floor((f.x-half)/this.raster.cw));cc<=Math.min(this.raster.cols-1,Math.floor((f.x+half)/this.raster.cw));cc++)
          if(this.raster.occupied(rr*this.raster.cols+cc)) {free=false;break;}
      if(!free || fade<.03)continue;
      for(let c=c0;c<=c1;c++)this.glyph[r*cols+c]='\0';
      ctx.globalAlpha = (.32 + .24*f.depth + (f.target>=0?.04:0))*fade*presence;
      ctx.fillText(f.glyph,f.x,f.y+1);
      if(ctx.globalAlpha>=.12 && f.x>=0 && f.x<this.width && f.y>=0 && f.y<this.height) {
        const region=Math.floor(f.x/this.width*4)+4*Math.floor(f.y/this.height*3);
        this.schoolCells[region]++;
      }
    }

    sim.observeSchoolCoverage(this.schoolCells,this.schoolDensity.alpha);

    // 4. Ripples and plankton.
    for (const rp of this.ripples) {
      const age = this.time - rp.t0;
      const radius = age * 3.2;
      const fadeOut = 1 - age / 1.6;
      const steps = Math.max(8, Math.round(radius * 7));
      for (let s = 0; s < steps; s++) {
        const ang = (s / steps) * Math.PI * 2;
        const i = this.cellIndex(rp.x + Math.cos(ang) * radius * cw * 1.3, rp.y + Math.sin(ang) * radius * ch * 0.6);
        if (i < 0) continue;
        this.put(i, Math.abs(Math.sin(ang)) < 0.5 ? '~' : '·', rp.strength * fadeOut * this.clearing(i % cols, (i / cols) | 0), 4);
      }
    }
    for (const p of this.particles) {
      const i = this.cellIndex(p.x, p.y);
      if (i < 0) continue;
      const c = i % cols;
      const r = (i / cols) | 0;
      const tw = Math.min(1, p.life / 3, (p.max - p.life) / 3);
      this.put(i, PLANKTON[Math.floor(hash3(c, r, 3) * PLANKTON.length)], 0.3 * tw * this.clearing(c, r), WATER);
    }

    const glyphColors = [palette.water, palette.ink, palette.inkStrong, palette.food, palette.ripple];
    for (let color = 0; color < glyphColors.length; color++) {
      ctx.fillStyle = glyphColors[color];
      for (let i = 0; i < n; i++) {
        const g = this.glyph[i];
        if (!g || g === '\0' || this.glyphColor[i] !== color) continue;
        const a = this.glyphAlpha[i];
        if (a <= 0.01) continue;
        ctx.globalAlpha = Math.min(1, a);
        ctx.fillText(g, (i % cols) * cw + cw / 2, ((i / cols) | 0) * ch + ch / 2 + 1);
      }
    }
    ctx.globalAlpha = 1;
  }
}
