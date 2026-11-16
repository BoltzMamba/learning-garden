/**
 * Small-fish simulation for the ASCII ocean (pure: no DOM, seeded RNG).
 *
 * - Schools: per-species flocking (separation / alignment / cohesion) with a
 *   spatial hash, light wander and vertical drag so schools travel mostly
 *   sideways.
 * - Feeding: `feed(x, y)` drops pellets that sink slowly. Fish sense them on
 *   staggered checks with a distance-dependent chance (so responses are
 *   delayed and distant fish often ignore them), steer smoothly with a
 *   limited force, nibble for a moment, then are "full" for a while and
 *   drift back into their schools.
 *
 * Units are CSS pixels and seconds.
 */

export type Rng = () => number;

/** Deterministic PRNG (mulberry32). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Species {
  name: string;
  /** Right-facing / left-facing glyphs; null = single heading-aware dash. */
  shape: { right: string; left: string } | null;
  /** Palette tone: 0 water, 1 ink, 2 strong ink. */
  tone: 0 | 1 | 2;
  cruise: number;
  maxSpeed: number;
  minSpeed: number;
  weight: number;
  school: [number, number];
  /** Preferred spacing in cells (x, y). */
  spacing: [number, number];
  align: number;
  cohesion: number;
  jitter: number;
  verticalDrag: number;
}

export const SPECIES: Species[] = [
  { name: 'sardine', shape: null, tone: 1, cruise: 36, maxSpeed: 64, minSpeed: 18, weight: 3, school: [14, 24], spacing: [1.8, 1.1], align: 1.6, cohesion: 1.5, jitter: 40, verticalDrag: 0.6 },
  { name: 'anchovy', shape: null, tone: 0, cruise: 44, maxSpeed: 76, minSpeed: 22, weight: 3, school: [16, 28], spacing: [1.5, 1], align: 3, cohesion: 0.5, jitter: 30, verticalDrag: 1.4 },
  { name: 'silverside', shape: null, tone: 2, cruise: 40, maxSpeed: 70, minSpeed: 20, weight: 2, school: [10, 16], spacing: [2, 1.1], align: 2.4, cohesion: 1.1, jitter: 35, verticalDrag: 1.6 },
  { name: 'mackerel', shape: { right: '><>', left: '<><' }, tone: 2, cruise: 30, maxSpeed: 58, minSpeed: 14, weight: 1, school: [3, 6], spacing: [5.5, 2.2], align: 2, cohesion: 0.9, jitter: 22, verticalDrag: 2 },
  { name: 'goby', shape: { right: '°>', left: '<°' }, tone: 1, cruise: 24, maxSpeed: 52, minSpeed: 10, weight: 0.8, school: [4, 7], spacing: [3.6, 1.8], align: 0.6, cohesion: 1.1, jitter: 70, verticalDrag: 0.4 },
];

export interface SmallFish {
  x: number;
  y: number;
  vx: number;
  vy: number;
  species: number;
  /** 0 = far/faint … 1 = near/bold. */
  depth: number;
  wander: number;
  /** Pellet id being pursued, or -1. */
  target: number;
  noticeAt: number;
  fullUntil: number;
  eatTime: number;
  eatLimit: number;
}

export interface Pellet {
  id: number;
  x: number;
  y: number;
  vy: number;
  amount: number;
  born: number;
  wobble: number;
}

export interface Crumb {
  x: number;
  y: number;
  born: number;
}

export interface Ellipse {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export interface Obstacle {
  x: number;
  y: number;
  r: number;
}

export const FEED = {
  /** Pellets per click. */
  perClick: [4, 6] as [number, number],
  /** Max pellets alive at once (oldest are dropped). */
  maxPellets: 30,
  /** Seconds before an uneaten pellet dissolves. */
  life: 20,
  /** Sensing radius in cells. */
  senseCells: 11,
  /** At most this many fish pursue one pellet; the rest ignore it. */
  maxChasers: 7,
  /** How much of a pellet one fish eats per second. */
  biteRate: 0.35,
  /** Seconds a fish ignores food after eating. */
  full: [5, 10] as [number, number],
};

const SEPARATION = 420;
const ALIGN = 1.4;
const COHESION = 1;
const AVOID = 900;
const MAX_FORCE_SEEK = 170;

export interface SimOptions {
  width: number;
  height: number;
  cell: number;
  rng: Rng;
  /** Region fish keep out of (the profile). */
  avoid?: Ellipse;
  count?: number;
}

export function fishCountFor(width: number, height: number): number {
  const cap = width < 640 ? 90 : 320;
  return Math.max(60, Math.min(cap, Math.round((width * height) / 4400)));
}

export class OceanSim {
  width: number;
  height: number;
  cell: number;
  rng: Rng;
  avoid: Ellipse | undefined;
  time = 0;
  fish: SmallFish[] = [];
  pellets: Pellet[] = [];
  crumbs: Crumb[] = [];
  obstacles: Obstacle[] = [];
  /** Chasers allowed per pellet, scaled to the population (smaller on mobile). */
  maxChasers: number = FEED.maxChasers;
  private nextPellet = 1;
  private perception: number;
  private bucketCols = 0;
  private bucketRows = 0;
  private head = new Int32Array(0);
  private next = new Int32Array(0);

  constructor(opts: SimOptions) {
    this.width = opts.width;
    this.height = opts.height;
    this.cell = opts.cell;
    this.rng = opts.rng;
    this.avoid = opts.avoid;
    this.perception = Math.max(60, opts.cell * 5);
    this.seed(opts.count ?? fishCountFor(opts.width, opts.height));
  }

  private range(a: number, b: number) {
    return a + (b - a) * this.rng();
  }

  private pickSpecies(): number {
    const total = SPECIES.reduce((s, x) => s + x.weight, 0);
    let r = this.rng() * total;
    for (let i = 0; i < SPECIES.length; i++) {
      r -= SPECIES[i].weight;
      if (r <= 0) return i;
    }
    return 0;
  }

  /** Inside-ness of the avoid ellipse: < 1 means inside. */
  avoidDistance(x: number, y: number): number {
    const a = this.avoid;
    if (!a) return Infinity;
    const dx = (x - a.cx) / a.rx;
    const dy = (y - a.cy) / a.ry;
    return Math.sqrt(dx * dx + dy * dy);
  }

  seed(count: number) {
    this.fish = [];
    let guard = 0;
    while (this.fish.length < count && guard++ < 500) {
      const s = this.pickSpecies();
      const sp = SPECIES[s];
      // Smaller populations (mobile) get smaller schools, so several species still appear.
      const cap = Math.max(4, Math.ceil(count / 6));
      const size = Math.min(Math.round(this.range(sp.school[0], sp.school[1] + 1)), cap, count - this.fish.length);
      let cx = 0;
      let cy = 0;
      for (let tries = 0; tries < 20; tries++) {
        cx = this.range(this.width * 0.04, this.width * 0.96);
        cy = this.range(this.height * 0.06, this.height * 0.94);
        if (this.avoidDistance(cx, cy) > 1.3) break;
      }
      const heading = (this.rng() < 0.5 ? 0 : Math.PI) + this.range(-0.4, 0.4);
      const spreadX = sp.spacing[0] * this.cell * Math.sqrt(size) * 0.9;
      const spreadY = sp.spacing[1] * this.cell * Math.sqrt(size) * 0.55;
      for (let i = 0; i < size; i++) {
        const speed = sp.cruise * this.range(0.85, 1.15);
        this.fish.push({
          x: cx + this.range(-1, 1) * spreadX,
          y: cy + this.range(-1, 1) * spreadY,
          vx: Math.cos(heading) * speed,
          vy: Math.sin(heading) * speed,
          species: s,
          depth: this.range(0.35, 1),
          wander: this.range(-1, 1),
          target: -1,
          noticeAt: this.range(0, 0.6),
          fullUntil: 0,
          eatTime: 0,
          eatLimit: this.range(1.2, 2.6),
        });
      }
    }
    this.next = new Int32Array(this.fish.length);
    this.maxChasers = Math.max(3, Math.min(FEED.maxChasers, Math.round(this.fish.length / 40)));
  }

  resize(width: number, height: number, cell: number, avoid?: Ellipse) {
    const sx = width / (this.width || width);
    const sy = height / (this.height || height);
    this.width = width;
    this.height = height;
    this.cell = cell;
    this.avoid = avoid;
    this.perception = Math.max(60, cell * 5);
    for (const f of this.fish) {
      f.x *= sx;
      f.y *= sy;
    }
    for (const p of this.pellets) {
      p.x *= sx;
      p.y *= sy;
    }
  }

  /** Drop a few pellets at (x, y). Returns the number created. */
  feed(x: number, y: number): number {
    const [lo, hi] = FEED.perClick;
    const n = lo + Math.floor(this.rng() * (hi - lo + 1));
    for (let i = 0; i < n; i++) {
      this.pellets.push({
        id: this.nextPellet++,
        x: x + this.range(-1, 1) * this.cell * 0.9,
        y: y + this.range(-0.6, 0.6) * this.cell,
        vy: this.range(5, 11),
        amount: 1,
        born: this.time,
        wobble: this.range(0, Math.PI * 2),
      });
    }
    while (this.pellets.length > FEED.maxPellets) this.pellets.shift();
    return n;
  }

  private pellet(id: number): Pellet | undefined {
    for (const p of this.pellets) if (p.id === id) return p;
    return undefined;
  }

  private rebuildHash() {
    const size = this.perception;
    this.bucketCols = Math.max(1, Math.ceil(this.width / size) + 2);
    this.bucketRows = Math.max(1, Math.ceil(this.height / size) + 2);
    const n = this.bucketCols * this.bucketRows;
    if (this.head.length !== n) this.head = new Int32Array(n);
    this.head.fill(-1);
    if (this.next.length !== this.fish.length) this.next = new Int32Array(this.fish.length);
    for (let i = 0; i < this.fish.length; i++) {
      const b = this.bucket(this.fish[i].x, this.fish[i].y);
      this.next[i] = this.head[b];
      this.head[b] = i;
    }
  }

  private bucket(x: number, y: number) {
    const c = Math.min(this.bucketCols - 1, Math.max(0, Math.floor(x / this.perception) + 1));
    const r = Math.min(this.bucketRows - 1, Math.max(0, Math.floor(y / this.perception) + 1));
    return r * this.bucketCols + c;
  }

  step(dt: number) {
    // Sub-step long frames so steering stays stable.
    while (dt > 0) {
      const h = Math.min(dt, 1 / 30);
      this.stepOnce(h);
      dt -= h;
    }
  }

  private stepOnce(dt: number) {
    this.time += dt;
    const t = this.time;
    this.rebuildHash();

    // Pellets sink and wobble; dissolve when eaten or old.
    for (let i = this.pellets.length - 1; i >= 0; i--) {
      const p = this.pellets[i];
      p.y = Math.min(this.height - this.cell, p.y + p.vy * dt);
      p.x += Math.sin(t * 1.7 + p.wobble) * 4 * dt;
      if (p.amount <= 0) {
        this.crumbs.push({ x: p.x, y: p.y, born: t });
        this.pellets.splice(i, 1);
      } else if (t - p.born > FEED.life) {
        this.pellets.splice(i, 1);
      }
    }
    this.crumbs = this.crumbs.filter((c) => t - c.born < 0.8);

    // How many fish already pursue each pellet (keeps crowds small).
    const chasers = new Map<number, number>();
    for (const f of this.fish) if (f.target >= 0) chasers.set(f.target, (chasers.get(f.target) ?? 0) + 1);

    const perception2 = this.perception * this.perception;
    const sense = FEED.senseCells * this.cell;
    const eatRadius = this.cell * 0.9;

    for (let i = 0; i < this.fish.length; i++) {
      const f = this.fish[i];
      const sp = SPECIES[f.species];
      const sepX = sp.spacing[0] * this.cell;
      const sepY = sp.spacing[1] * this.cell;
      let ax = 0;
      let ay = 0;

      // --- food: sense (staggered, probabilistic), then seek ---
      let food: Pellet | undefined = f.target >= 0 ? this.pellet(f.target) : undefined;
      if (f.target >= 0 && !food) {
        // Pellet vanished: look again soon, otherwise drift back.
        f.target = -1;
        f.eatTime = 0;
        f.noticeAt = t + this.range(0.2, 0.6);
      }
      if (!food && this.pellets.length && t >= f.noticeAt && t >= f.fullUntil) {
        f.noticeAt = t + this.range(0.3, 0.8);
        let best: Pellet | undefined;
        let bestD = Infinity;
        for (const p of this.pellets) {
          if ((chasers.get(p.id) ?? 0) >= this.maxChasers) continue;
          const d = Math.hypot(p.x - f.x, p.y - f.y);
          if (d < bestD) {
            bestD = d;
            best = p;
          }
        }
        if (best && bestD < sense) {
          const k = 1 - bestD / sense;
          if (this.rng() < 0.05 + 0.55 * k * k) {
            f.target = best.id;
            food = best;
            chasers.set(best.id, (chasers.get(best.id) ?? 0) + 1);
          }
        }
      }

      // --- flocking (weaker while feeding) ---
      const social = food ? 0.3 : 1;
      let n = 0;
      let avx = 0;
      let avy = 0;
      let cx = 0;
      let cy = 0;
      const bc = Math.min(this.bucketCols - 1, Math.max(0, Math.floor(f.x / this.perception) + 1));
      const br = Math.min(this.bucketRows - 1, Math.max(0, Math.floor(f.y / this.perception) + 1));
      for (let r = Math.max(0, br - 1); r <= Math.min(this.bucketRows - 1, br + 1); r++) {
        for (let c = Math.max(0, bc - 1); c <= Math.min(this.bucketCols - 1, bc + 1); c++) {
          for (let j = this.head[r * this.bucketCols + c]; j !== -1; j = this.next[j]) {
            if (j === i) continue;
            const o = this.fish[j];
            const dx = o.x - f.x;
            const dy = o.y - f.y;
            const d2 = dx * dx + dy * dy;
            if (d2 > perception2 || d2 < 1e-6) continue;
            const ex = dx / sepX;
            const ey = dy / sepY;
            const e2 = ex * ex + ey * ey;
            if (e2 < 1) {
              const e = Math.sqrt(e2) || 0.001;
              const push = Math.min(4, (1 - e) / e);
              ax -= ex * push * SEPARATION * 0.5;
              ay -= ey * push * SEPARATION * 0.5;
            }
            if (o.species === f.species) {
              avx += o.vx;
              avy += o.vy;
              cx += dx;
              cy += dy;
              n++;
            }
          }
        }
      }
      if (n > 0) {
        ax += (avx / n - f.vx) * ALIGN * sp.align * social;
        ay += (avy / n - f.vy) * ALIGN * sp.align * social;
        ax += (cx / n) * COHESION * sp.cohesion * social;
        ay += (cy / n) * COHESION * sp.cohesion * social;
      }

      // --- wander: gentle mean-reverting sideways bias + small per-step noise ---
      // (a persistent sideways force would make fish swim in circles)
      f.wander += (this.rng() - 0.5) * dt * 2.4 - f.wander * dt * 0.8;
      const speed0 = Math.hypot(f.vx, f.vy) || 1;
      const hx = f.vx / speed0;
      const hy = f.vy / speed0;
      const side = (f.wander * 0.35 + (this.rng() - 0.5) * 0.6) * sp.jitter * social;
      ax += -hy * side;
      ay += hx * side;
      // Fish prefer level swimming; while seeking they still arc in mostly sideways.
      ay -= f.vy * sp.verticalDrag * (food ? 0.5 : 1);

      // --- keep out of the profile clearing ---
      const k = this.avoidDistance(f.x, f.y);
      if (k < 1.15 && this.avoid) {
        const dx = (f.x - this.avoid.cx) / (this.avoid.rx * this.avoid.rx);
        const dy = (f.y - this.avoid.cy) / (this.avoid.ry * this.avoid.ry);
        const len = Math.hypot(dx, dy) || 1;
        ax += (dx / len) * AVOID * (1.15 - k);
        ay += (dy / len) * AVOID * (1.15 - k);
      }

      // --- give big fish room ---
      for (const ob of this.obstacles) {
        const dx = f.x - ob.x;
        const dy = f.y - ob.y;
        const d = Math.hypot(dx, dy);
        if (d < ob.r && d > 0.001) {
          const s = (1 - d / ob.r) * 500;
          ax += (dx / d) * s;
          ay += (dy / d) * s;
        }
      }

      // --- seek food, then nibble ---
      let minSpeed = sp.minSpeed;
      let targetSpeed = sp.cruise;
      if (food) {
        const dx = food.x - f.x;
        const dy = food.y - f.y;
        const d = Math.hypot(dx, dy) || 0.001;
        const want = d < 40 ? Math.max(6, (sp.cruise * d) / 40) : sp.cruise * 1.35;
        let sx = (dx / d) * want - f.vx;
        let sy = (dy / d) * want - f.vy;
        const sl = Math.hypot(sx, sy);
        const limit = MAX_FORCE_SEEK;
        if (sl > limit) {
          sx = (sx / sl) * limit;
          sy = (sy / sl) * limit;
        }
        ax += sx * 2.2;
        ay += sy * 2.2;
        minSpeed = 4;
        targetSpeed = want;
        if (d < eatRadius) {
          // Nibbling: small darting jitter around the pellet.
          food.amount -= FEED.biteRate * dt;
          f.eatTime += dt;
          ax += (this.rng() - 0.5) * 260;
          ay += (this.rng() - 0.5) * 160;
          if (f.eatTime > f.eatLimit) {
            f.target = -1;
            f.eatTime = 0;
            f.eatLimit = this.range(1.2, 2.6);
            f.fullUntil = t + this.range(FEED.full[0], FEED.full[1]);
            // A gentle push away so the crowd loosens.
            ax -= (dx / d) * 400;
            ay -= (dy / d) * 400;
          }
        }
      }

      // --- integrate with speed limits (no teleporting) ---
      f.vx += ax * dt;
      f.vy += ay * dt;
      let speed = Math.hypot(f.vx, f.vy) || 0.001;
      // Relax toward the preferred speed.
      speed += (targetSpeed - speed) * Math.min(1, dt * 0.9);
      speed = Math.max(minSpeed, Math.min(sp.maxSpeed, speed));
      const norm = speed / (Math.hypot(f.vx, f.vy) || 0.001);
      f.vx *= norm;
      f.vy *= norm;
      f.x += f.vx * dt;
      f.y += f.vy * dt;

      // --- wrap around well outside the view ---
      const m = this.cell * 4;
      if (f.x < -m) f.x += this.width + 2 * m;
      else if (f.x > this.width + m) f.x -= this.width + 2 * m;
      if (f.y < -m) f.y += this.height + 2 * m;
      else if (f.y > this.height + m) f.y -= this.height + 2 * m;
    }
  }
}
