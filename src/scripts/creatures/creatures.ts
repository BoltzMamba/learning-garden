/**
 * Big-creature motion: Reynolds steering (wander + patrol orbit + spacing)
 * on a follow-the-leader spine with per-joint stiffness.
 *
 * Adapted from ascii-sharks/src/world.ts (seed + stepSharks) by drewdi
 * (stackedlol), MIT License — see ./LICENSE-ascii-sharks.md.
 * Changes: no hunting (the small-fish sim lives in ocean-sim.ts), per-species
 * motion (speed, wing/tail beat, spine stiffness), and avoidance of the
 * page's profile ellipse instead of a fixed headline zone.
 */
import { SHAPES, type CreatureKind } from './shapes.ts';
import { angleDiff, clamp, rand, TAU } from './util.ts';

export const SPINE_NODES = 20;

export interface Creature {
  id: number;
  kind: CreatureKind;
  length: number;
  /** Spine positions, snout first: [x0, y0, x1, y1, ...]. */
  nodes: Float32Array;
  heading: number;
  speed: number;
  /** Tail-beat / wing-beat phase. */
  phase: number;
  /** Smoothed angular velocity; fins bank into turns. */
  turn: number;
  wander: number;
  orbitDir: 1 | -1;
  orbitRadius: number;
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

  constructor(scale = 1.2) {
    this.scale = scale;
  }

  seed(specs: CreatureSpec[], width: number, height: number) {
    this.width = width;
    this.height = height;
    const minSide = Math.min(width, height);
    const base = baseLength(width, height, this.scale);
    this.creatures = specs.map(({ kind, size }, i) => {
      const length = base * size;
      const orbitRadius = minSide * rand(0.28, 0.4);
      const a = (i / specs.length) * TAU + rand(-0.4, 0.4);
      const orbitDir: 1 | -1 = i % 2 === 0 ? 1 : -1;
      const x = width / 2 + Math.cos(a) * orbitRadius * (width / minSide) * 0.9;
      const y = height / 2 + Math.sin(a) * orbitRadius;
      const heading = a + (orbitDir * Math.PI) / 2;
      return this.make(i + 1, kind, length, x, y, heading, orbitDir, orbitRadius, size);
    });
    // Smaller (farther) creatures draw first so bigger ones pass over them.
    this.creatures.sort((a, b) => a.length - b.length);
  }

  /** Place one creature with a straight spine (used by the gallery too). */
  make(
    id: number,
    kind: CreatureKind,
    length: number,
    x: number,
    y: number,
    heading: number,
    orbitDir: 1 | -1 = 1,
    orbitRadius = 200,
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
      heading,
      speed: 30,
      phase: rand(0, TAU),
      turn: 0,
      wander: 0,
      orbitDir,
      orbitRadius,
      depth: clamp(depth, 0.5, 1),
    };
  }

  resize(width: number, height: number) {
    const sx = width / (this.width || width);
    const sy = height / (this.height || height);
    this.width = width;
    this.height = height;
    for (const c of this.creatures) {
      for (let k = 0; k < SPINE_NODES; k++) {
        c.nodes[k * 2] *= sx;
        c.nodes[k * 2 + 1] *= sy;
      }
    }
  }

  step(dt: number) {
    this.time += dt;
    const { creatures, width: W, height: H, time } = this;
    const minSide = Math.min(W, H);
    const cxW = W / 2;
    const cyW = H / 2;

    for (const sh of creatures) {
      const motion = SHAPES[sh.kind].motion;
      const L = sh.length;
      const nodes = sh.nodes;
      const hx = nodes[0];
      const hy = nodes[1];

      let dx = Math.cos(sh.heading);
      let dy = Math.sin(sh.heading);

      // Wander: a slowly drifting offset on a circle ahead of the snout.
      sh.wander = clamp(sh.wander + (Math.random() - 0.5) * dt * 3.2, -1.1, 1.1);
      dx += Math.cos(sh.heading + sh.wander) * 0.45;
      dy += Math.sin(sh.heading + sh.wander) * 0.45;

      // Patrol: a lazy circuit around the middle of the page.
      const rx = (hx - cxW) / (W / minSide);
      const ry = hy - cyW;
      const r = Math.hypot(rx, ry) || 1;
      const radius = sh.orbitRadius * (1 + 0.15 * Math.sin(time * 0.05 + sh.id));
      const radial = clamp((radius - r) / radius, -1, 1);
      dx += ((-ry / r) * sh.orbitDir + (rx / r) * radial * 0.9) * 0.55;
      dy += ((rx / r) * sh.orbitDir + (ry / r) * radial * 0.9) * 0.55;

      // Give each other room.
      for (const other of creatures) {
        if (other === sh) continue;
        for (let k = 0; k < SPINE_NODES; k += 4) {
          const ox = hx - other.nodes[k * 2];
          const oy = hy - other.nodes[k * 2 + 1];
          const d = Math.hypot(ox, oy);
          const range = (L + other.length) * 0.45;
          if (d < range && d > 1e-3) {
            const w = (1 - d / range) * 3;
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

      // Turn back once the snout leaves the frame.
      const over = Math.max(-hx, hx - W, -hy, hy - H);
      if (over > -L * 0.05) {
        const w = clamp((over + L * 0.05) / (L * 0.35), 0, 1) * 3.5;
        const toX = cxW - hx;
        const toY = cyW - hy;
        const d = Math.hypot(toX, toY) || 1;
        dx += (toX / d) * w;
        dy += (toY / d) * w;
      }

      const desired = Math.atan2(dy, dx);
      // The turning circle grows with speed: no pivoting on the spot.
      const agility = Math.min(0.8 * motion.agility, sh.speed / (L * 0.22));
      const maxTurn = agility * dt;
      const turned = clamp(angleDiff(sh.heading, desired), -maxTurn, maxTurn);
      sh.heading += turned;
      sh.turn += (turned / dt - sh.turn) * Math.min(1, dt * 3);

      const cruise = (30 + L * 0.04) * motion.speed;
      sh.speed += (cruise - sh.speed) * Math.min(1, dt * 1.1);
      sh.phase += dt * (2 + sh.speed / 24) * motion.beat;

      nodes[0] += Math.cos(sh.heading) * sh.speed * dt;
      nodes[1] += Math.sin(sh.heading) * sh.speed * dt;

      // Follow-the-leader spine with a stiffness limit per joint.
      const seg = L / (SPINE_NODES - 1);
      let prevAngle = sh.heading + Math.PI;
      for (let k = 1; k < SPINE_NODES; k++) {
        const px = nodes[(k - 1) * 2];
        const py = nodes[(k - 1) * 2 + 1];
        const maxBend = motion.bend(k / (SPINE_NODES - 1));
        let angle = Math.atan2(nodes[k * 2 + 1] - py, nodes[k * 2] - px);
        angle = prevAngle + clamp(angleDiff(prevAngle, angle), -maxBend, maxBend);
        nodes[k * 2] = px + Math.cos(angle) * seg;
        nodes[k * 2 + 1] = py + Math.sin(angle) * seg;
        prevAngle = angle;
      }
    }
  }
}
