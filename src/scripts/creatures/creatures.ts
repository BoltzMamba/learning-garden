/**
 * Big-creature motion: persistent migration + bounded curved steering + shared feeding
 * with a rigid local body pose and staggered edge admissions.
 *
 * Adapted from ascii-sharks/src/world.ts (seed + stepSharks) by drewdi
 * (stackedlol), MIT License — see ./LICENSE-ascii-sharks.md.
 * Changes: shared food with the small-fish sim, per-species
 * motion (speed, wing/tail beat, spine stiffness), and avoidance of the
 * page's profile ellipse instead of a fixed headline zone.
 */
import { FEED, type Pellet } from '../ocean-sim.ts';
import { SHAPES, type CreatureKind } from './shapes.ts';
import { angleDiff, clamp, TAU } from './util.ts';

export const SPINE_NODES = 20;

export interface Creature {
  id: number;
  kind: CreatureKind;
  length: number;
  /** Spine positions, snout first: [x0, y0, x1, y1, ...]. */
  nodes: Float32Array;
  /** Translation direction, independent of the rigid body pose. */
  heading: number;
  pose: number;
  yaw: number;
  noiseTarget: number;
  noiseAt: number;
  speedFactor: number;
  active: boolean;
  visibleCells: number;
  leftCells: number;
  rightCells: number;
  seen: boolean;
  unseenSince: number;
  admissions: number;
  speed: number;
  /** Tail-beat / wing-beat phase. */
  phase: number;
  /** Smoothed angular velocity; fins bank into turns. */
  turn: number;
  wander: number;
  course: number;
  lane: number;
  target: number;
  targetBatch: number;
  lastMealBatch: number;
  rejectedBatch: number;
  rejectUntil: number;
  mealStart: number;
  turnSide: number;
  noticeAt: number;
  seekUntil: number;
  fullUntil: number;
  eaten: number;
  /** Increments only after the entire silhouette has left the viewport. */
  passage: number;
  mode: 'cruise' | 'seek' | 'feed' | 'recover';
  /** 0 far / dim → 1 near / bright. */
  depth: number;
}

export interface CreatureSpec {
  kind: CreatureKind;
  size: number;
}

export interface Ellipse {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

/** Base body length for the largest creature, from the shorter screen side. */
export function baseLength(width: number, height: number, scale = 1.2) {
  return clamp(Math.min(width, height) * 0.44, 170, 430) * scale;
}

export class CreatureWorld {
  width = 0;
  height = 0;
  time = 0;
  creatures: Creature[] = [];
  /** Region to keep clear (the profile). */
  avoid: Ellipse | undefined;
  scale: number;

  private scheduled = false;
  private nextAdmission = 0;
  private nextDensity = 0;
  private desiredVisible = 3;
  private exposureLeft = 0;
  private exposureRight = 0;
  private visibilityMeasured = false;
  private emptyLeft = 0;
  private emptyRight = 0;

  private rng: () => number;

  constructor(scale = 1.2, rng: () => number = Math.random) {
    this.rng = rng;
    this.scale = scale;
  }

  seed(specs: CreatureSpec[], width: number, height: number) {
    this.width = width;
    this.height = height;
    const base = baseLength(width, height, this.scale);
    this.time = 0;
    this.scheduled = specs.length > 0;
    this.visibilityMeasured = false;
    this.exposureLeft = this.exposureRight = 0;
    this.emptyLeft = this.emptyRight = 0;
    this.nextAdmission = 3;
    this.nextDensity = 16;
    this.desiredVisible = 3;
    this.creatures = specs.map(({ kind, size }, i) => {
      const c = this.make(i + 1, kind, base * size, -base * 3, -base * 3, 0, .55 + size * .4);
      c.active = false;
      return c;
    });
    this.creatures.sort((a, b) => a.length - b.length);
    // Two already-passing animals, with different exit times, not five fixed routes.
    const first = this.creatures.find(c => c.kind === 'sunfish') ?? this.creatures[0];
    const second = this.creatures.find(c => c.kind === 'whaleshark') ?? this.creatures[1];
    if (first) this.place(first, width * .28, height * .20, Math.PI);
    if (second && second !== first) this.place(second, width * .78, height * .78, 0);
  }

  /** Rigid local spine. Swimming waves remain in the existing rasteriser. */
  private poseSpine(c: Creature) {
    const x = c.nodes[0], y = c.nodes[1];
    const dx = Math.cos(c.pose) * c.length / (SPINE_NODES - 1);
    const dy = Math.sin(c.pose) * c.length / (SPINE_NODES - 1);
    for (let k = 1; k < SPINE_NODES; k++) {
      c.nodes[k*2] = x - dx*k;
      c.nodes[k*2+1] = y - dy*k;
    }
  }

  private place(c: Creature, x: number, y: number, heading: number) {
    c.nodes[0] = x; c.nodes[1] = y;
    c.heading = c.pose = c.course = heading;
    c.lane = Math.abs(Math.cos(heading)) > .7 ? y : x;
    c.turn = c.yaw = c.wander = c.noiseTarget = 0;
    c.noiseAt = this.time + 2 + this.rng()*4;
    c.speedFactor = .9 + this.rng()*.2;
    c.speed = (20+c.length*.028)*SHAPES[c.kind].motion.speed*c.speedFactor;
    c.depth = .64 + this.rng()*.32;
    c.active = true; c.seen = false; c.visibleCells = 0;
    c.leftCells = c.rightCells = 0;
    c.unseenSince = this.time;
    c.target = c.targetBatch = -1; c.noticeAt = this.time; c.turnSide = 0; c.mode = 'cruise'; c.fullUntil = this.time+1;
    c.admissions++;
    this.poseSpine(c);
  }

  /** Actual surviving raster cells after overlap, clipping and profile clearing. */
  observeVisibility(counts: Int32Array, left: Int32Array, right: Int32Array) {
    this.visibilityMeasured = true;
    for (const c of this.creatures) {
      c.visibleCells = counts[c.id] ?? 0;
      c.leftCells = left[c.id] ?? 0; c.rightCells = right[c.id] ?? 0;
      if (c.visibleCells > 0) { c.seen = true; c.unseenSince = this.time; }
    }
  }

  get visibleCount() { return this.creatures.reduce((n,c) => n + Number(c.active && c.visibleCells > 0), 0); }

  private schedule(dt: number) {
    if (!this.scheduled) return;
    this.exposureLeft *= Math.exp(-dt/45);
    this.exposureRight *= Math.exp(-dt/45);
    this.emptyLeft = this.creatures.some(c=>c.active && c.leftCells>0) ? 0 : this.emptyLeft+dt;
    this.emptyRight = this.creatures.some(c=>c.active && c.rightCells>0) ? 0 : this.emptyRight+dt;
    this.exposureLeft += this.creatures.reduce((n,c)=>n+Number(c.active && c.leftCells>0),0)*dt;
    this.exposureRight += this.creatures.reduce((n,c)=>n+Number(c.active && c.rightCells>0),0)*dt;
    if (this.time >= this.nextDensity) {
      const roll = this.rng();
      this.desiredVisible = roll < .14 ? 1 : roll < .65 ? 2 : roll < .94 ? 3 : 4;
      this.nextDensity = this.time + 9 + this.rng()*9;
    }
    let active = 0, incoming = 0;
    for (const c of this.creatures) if (c.active) { active++; if (!c.seen) incoming++; }
    const visible = this.visibilityMeasured ? this.visibleCount : active;
    if (!this.visibilityMeasured) incoming = 0;
    const unbalanced = this.visibilityMeasured && Math.max(this.emptyLeft,this.emptyRight)>10;
    const departing = this.creatures.some(c => c.active && c.visibleCells > 0 && (
      Math.cos(c.course)>.7 && c.nodes[0]>this.width-c.length*.12 ||
      Math.cos(c.course)<-.7 && c.nodes[0]<c.length*.12));
    const refill = this.visibilityMeasured && visible<=2 && incoming<2 && departing;
    const target = refill ? Math.min(4,visible+incoming+1) : unbalanced ? Math.min(4,visible+1) : Math.max(2,this.desiredVisible);
    // Incoming animals reserve slots. Never delete an on-screen animal to hit a target.
    if (active >= 4 || (this.time < this.nextAdmission && !refill) || visible + incoming >= target) return;
    let next: Creature | undefined;
    for (const c of this.creatures) if (!c.active && (!next || c.admissions < next.admissions)) next = c;
    if (!next) return;
    const left = unbalanced ? this.emptyLeft > this.emptyRight : this.rng() < (this.exposureLeft <= this.exposureRight ? .8 : .2);
    const vertical = this.width >= 640 && next.kind !== 'sunfish' && this.rng() < .16;
    const margin = next.length * .22 + 16;
    const lane = (this.rng() < .5 ? .18 : .80) + (this.rng()-.5)*.055;
    if (vertical) {
      const down = this.rng() < .5;
      this.place(next, this.width*(left ? .15 : .85), down ? -margin : this.height+margin, down ? Math.PI/2 : -Math.PI/2);
    } else this.place(next, left ? -margin : this.width+margin, this.height*lane, left ? 0 : Math.PI);
    this.nextAdmission = this.time + 5 + this.rng()*6;
  }

  /** Place one creature with a straight spine (used by the gallery too). */
  make(
    id: number,
    kind: CreatureKind,
    length: number,
    x: number,
    y: number,
    heading: number,
    depth = 1,
  ): Creature {
    const nodes = new Float32Array(SPINE_NODES * 2);
    const seg = length / (SPINE_NODES - 1);
    for (let n = 0; n < SPINE_NODES; n++) {
      nodes[n * 2] = x - Math.cos(heading) * seg * n;
      nodes[n * 2 + 1] = y - Math.sin(heading) * seg * n;
    }
    return {
      id,
      kind,
      length,
      nodes,
      heading, pose: heading, yaw: 0, noiseTarget: 0, noiseAt: 0,
      speedFactor: 1, active: true, visibleCells: 0, leftCells: 0, rightCells: 0,
      seen: false, unseenSince: 0, admissions: 0,
      speed: (20 + length*.028)*SHAPES[kind].motion.speed,
      phase: this.rng()*TAU,
      turn: 0,
      wander: 0,
      course: heading,
      lane: Math.abs(Math.cos(heading)) > .7 ? y : x,
      target: -1, targetBatch: -1, lastMealBatch: -1, rejectedBatch: -1, rejectUntil: 0, mealStart: 0, turnSide: 0, noticeAt: id * .17, seekUntil: 0, fullUntil: 0,
      eaten: 0, passage: 0, mode: 'cruise',
      depth: clamp(depth, 0.5, 1),
    };
  }

  resize(width: number, height: number) {
    const sx = width / (this.width || width);
    const sy = height / (this.height || height);
    this.width = width;
    this.height = height;
    for (const c of this.creatures) {
      c.lane *= Math.abs(Math.cos(c.course)) > .7 ? sy : sx;
      c.nodes[0] *= sx; c.nodes[1] *= sy;
      this.poseSpine(c);
    }
  }

  private release(c: Creature, success: boolean) {
    if (success || c.eaten > c.mealStart + .02) c.lastMealBatch = c.targetBatch;
    else { c.rejectedBatch = c.targetBatch; c.rejectUntil = this.time + 4; }
    c.target = c.targetBatch = -1;
    c.seekUntil = 0; c.turnSide = 0;
    c.fullUntil = this.time + (success ? 4 + c.id % 3 : 1.5);
    c.noticeAt = c.fullUntil;
    c.mode = 'recover';
    // Continue along the new heading instead of undoing the feeding turn.
    c.course = c.heading;
    c.lane = Math.abs(Math.cos(c.course)) > .7 ? c.nodes[1] : c.nodes[0];
  }

  step(dt: number, pellets: readonly Pellet[] = [], foodClock = this.time) {
    this.time += dt;
    const { creatures, width: W, height: H, time } = this;

    this.schedule(dt);
    for (const sh of creatures) {
      if (!sh.active) continue;
      const motion = SHAPES[sh.kind].motion;
      const L = sh.length;
      const nodes = sh.nodes;
      const hx = nodes[0];
      const hy = nodes[1];

      const sunfish = sh.kind === 'sunfish';
      const ray = sh.kind === 'manta';
      const whale = sh.kind === 'whaleshark';
      const yawLimit = sunfish ? .085 : ray ? .20 : whale ? .24 : .30;
      const poseLimit = sunfish ? .07 : ray ? .17 : whale ? .21 : .26;
      const cruise = (20 + L * 0.028) * motion.speed * sh.speedFactor;
      const horizontal = Math.abs(Math.cos(sh.course)) > .7;
      // A mean-reverting, low-pass random process with non-periodic targets.
      // The compass course persists; noise never accumulates into a full rotation.
      if (time >= sh.noiseAt) {
        sh.noiseTarget = (this.rng()-.5)*(sunfish ? .13 : ray ? .30 : .40);
        sh.noiseAt = time + (sunfish ? 7 : 4) + this.rng()*7;
      }
      sh.wander += (sh.noiseTarget-sh.wander)*(1-Math.exp(-dt/(sunfish ? 5 : 3)));
      const bend = sh.wander;
      let dx = Math.cos(sh.course + bend);
      let dy = Math.sin(sh.course + bend);
      const laneError = (sh.lane - (horizontal ? hy : hx)) / Math.max(140, L);
      if (horizontal) dy += clamp(laneError, -.35, .35);
      else dx += clamp(laneError, -.35, .35);

      let food = sh.target < 0 ? undefined : pellets.find(p => p.id === sh.target && p.amount > 0);
      if (sh.target >= 0 && (!food || time > sh.seekUntil)) {
        this.release(sh, false); food = undefined;
      }
      // The abstract food represents a mixed marine ration. Filter feeders
      // (manta / whale shark) sense further and graze more slowly than sharks.
      const filter = sh.kind === 'manta' || sh.kind === 'whaleshark';
      if (!food && time >= sh.fullUntil && time >= sh.noticeAt) {
        sh.noticeAt = time + .65 + (sh.id % 3) * .17;
        let best = Math.max(180, Math.min(420, L * (filter ? 1.0 : .85)));
        let responders = 0;
        for (const c of creatures) if (c.active && c.target >= 0) responders++;
        if (responders < 2) for (const p of pellets) {
          if (p.amount <= 0) continue;
          const px = p.x - hx, py = p.y - hy;
          const d = Math.hypot(px, py);
          const batch = p.batch ?? p.id;
          if (batch <= sh.lastMealBatch || (batch === sh.rejectedBatch && time < sh.rejectUntil)) continue;
          const turn = Math.abs(angleDiff(sh.heading, Math.atan2(py, px)));
          const remaining = FEED.life - (foodClock - p.born);
          // Budget the turn at the body's (slower) angular speed, not just velocity yaw.
          const feasible = turn / poseLimit + 3 < remaining;
          const clear = !this.avoid || Math.hypot((p.x-this.avoid.cx)/this.avoid.rx, (p.y-this.avoid.cy)/this.avoid.ry) > 1.12;
          if (d < best && feasible && clear) { food = p; best = d; }
        }
        if (food) {
          sh.target = food.id; sh.targetBatch = food.batch ?? food.id;
          sh.mealStart = sh.eaten;
          const angle = angleDiff(sh.heading, Math.atan2(food.y-hy, food.x-hx));
          sh.turnSide = Math.abs(angle) > Math.PI/2 ? Math.sign(angle) || 1 : 0;
          sh.seekUntil = time + Math.min(FEED.life-(foodClock-food.born), Math.max(14, Math.abs(angle)/poseLimit+5));
        }
      }
      let targetSpeed = cruise;
      sh.mode = time < sh.fullUntil ? 'recover' : 'cruise';
      if (food) {
        const px = food.x - hx, py = food.y - hy;
        const distance = Math.hypot(px, py);
        // Aim ahead of the sinking pellet; consumption still uses its real position.
        const lead = Math.min(2.5, distance / Math.max(cruise, 1));
        const aimY = py + food.vy * lead;
        const aimDistance = Math.hypot(px, aimY) || 1;
        dx = px / aimDistance * 2.5;
        dy = aimY / aimDistance * 2.5;
        targetSpeed = Math.max(food.vy + 6, cruise * clamp(distance / 90, .3, 1.25));
        // Brake before a sideways intercept, not after passing the pellet.
        const alignment = Math.cos(angleDiff(sh.heading, Math.atan2(aimY,px)));
        targetSpeed *= clamp(alignment, .2, 1);
        sh.mode = 'seek';
        const mouthRadius = clamp(L * .045, 12, 22);
        if (distance < mouthRadius) {
          sh.mode = 'feed';
          const bite = Math.min(food.amount, dt * (filter ? .75 : 1.1));
          food.amount -= bite;
          sh.eaten += bite;
          if (food.amount <= .001) {
            this.release(sh, true); food = undefined;
          }
        }
      }

      // Give each other room.
      for (const other of creatures) {
        if (other === sh || !other.active) continue;
        // Body-centre separation catches parallel silhouettes that head-only avoidance misses.
        const cx = hx - Math.cos(sh.pose)*L*.4;
        const cy = hy - Math.sin(sh.pose)*L*.4;
        const ox = other.nodes[0]-Math.cos(other.pose)*other.length*.4-cx;
        const oy = other.nodes[1]-Math.sin(other.pose)*other.length*.4-cy;
        const along = ox*Math.cos(sh.heading)+oy*Math.sin(sh.heading);
        const across = -ox*Math.sin(sh.heading)+oy*Math.cos(sh.heading);
        const proximity = Math.hypot(along/((L+other.length)*.48), across/((L+other.length)*.19));
        if (proximity < 1) {
          const pressure = 1-proximity;
          const order = sh.id < other.id ? -1 : 1;
          targetSpeed *= 1 + order*.18*pressure;
          const side = Math.abs(across)>2 ? -Math.sign(across) : order;
          const steer = side*pressure*(food ? .10 : .24);
          dx -= Math.sin(sh.heading)*steer;
          dy += Math.cos(sh.heading)*steer;
        }
        for (let k = 0; k < SPINE_NODES; k += 4) {
          const ox = hx - other.nodes[k * 2];
          const oy = hy - other.nodes[k * 2 + 1];
          const d = Math.hypot(ox, oy);
          const range = (L + other.length) * 0.20;
          if (d < range && d > 1e-3) {
            const w = (1 - d / range) * (food ? .18 : .4);
            dx += (ox / d) * w;
            dy += (oy / d) * w;
          }
        }
      }

      // Keep the profile clear: a soft elliptical no-swim zone around it.
      const a = this.avoid;
      if (a) {
        const ex = (hx - a.cx) / (a.rx + L * 0.12);
        const ey = (hy - a.cy) / (a.ry + L * 0.12);
        const e2 = ex * ex + ey * ey;
        if (e2 < 1.2) {
          const e = Math.sqrt(e2) || 1e-3;
          const w = (1.2 - e) * 3;
          dx += (ex / e) * w;
          dy += (ey / e) * w;
        }
      }

      let desired = Math.atan2(dy, dx);
      if (!food) {
        const excursion = sunfish ? .65 : 1.65;
        desired = sh.course + clamp(angleDiff(sh.course, desired), -excursion, excursion);
      } else if (sh.turnSide) {
        // Keep one committed turning side across the +/- pi seam.
        const error = angleDiff(sh.heading, desired);
        if (Math.abs(error) < .6) sh.turnSide = 0;
        else if (Math.sign(error) !== sh.turnSide) desired = sh.heading + sh.turnSide * Math.PI;
      }
      const wantedYaw = clamp(angleDiff(sh.heading, desired)*1.4, -yawLimit, yawLimit);
      sh.yaw += clamp(wantedYaw-sh.yaw, -dt*(sunfish ? .045 : .18), dt*(sunfish ? .045 : .18));
      sh.heading += sh.yaw*dt;
      // Pose lags translation slightly, but never stretches the local body model.
      const poseStep = clamp(angleDiff(sh.pose, sh.heading)*(sunfish ? 1.4 : 2), -poseLimit, poseLimit)*dt;
      sh.pose += poseStep;
      sh.heading = sh.pose + clamp(angleDiff(sh.pose,sh.heading), -.18, .18);
      sh.turn += (poseStep/dt - sh.turn)*Math.min(1,dt*2);

      sh.speed += (targetSpeed - sh.speed) * Math.min(1, dt * 1.1);
      sh.phase += dt * (1.3 + sh.speed / 30) * motion.beat;

      nodes[0] += Math.cos(sh.heading) * sh.speed * dt;
      nodes[1] += Math.sin(sh.heading) * sh.speed * dt;

      this.poseSpine(sh);

      // Re-enter only after ALL body nodes and the widest fins have exited.
      // Translate the whole spine; no visible head-only teleport or border U-turn.
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let k = 0; k < SPINE_NODES; k++) {
        minX = Math.min(minX, nodes[k*2]); maxX = Math.max(maxX, nodes[k*2]);
        minY = Math.min(minY, nodes[k*2+1]); maxY = Math.max(maxY, nodes[k*2+1]);
      }
      const margin = L * motion.reach + 32;
      let shiftX = 0, shiftY = 0;
      if (minX > W + margin && Math.cos(sh.course) > .7) shiftX = -maxX - margin;
      else if (maxX < -margin && Math.cos(sh.course) < -.7) shiftX = W + margin - minX;
      else if (minY > H + margin && Math.sin(sh.course) > .7) shiftY = -maxY - margin;
      else if (maxY < -margin && Math.sin(sh.course) < -.7) shiftY = H + margin - minY;
      const headOutside = hx < -24 || hx > W+24 || hy < -24 || hy > H+24;
      const rasterExited = this.visibilityMeasured && sh.seen && sh.visibleCells === 0 && headOutside && time-sh.unseenSince > .5;
      if ((shiftX || shiftY || rasterExited) && this.scheduled) {
        sh.active = false; sh.visibleCells = 0; sh.target = -1; sh.passage++;
        continue;
      }
      if (shiftX || shiftY) {
        for (let k = 0; k < SPINE_NODES; k++) { nodes[k*2] += shiftX; nodes[k*2+1] += shiftY; }
        sh.passage++;
        sh.target = -1;
        sh.fullUntil = time + 2;
      }
    }
  }
}
