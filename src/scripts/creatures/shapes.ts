/**
 * Species body plans for the big ASCII creatures (top-down view).
 *
 * Coordinates: s ∈ [0, 1] along the spine (snout → tail tip), v across it,
 * both as fractions of body length L.
 *
 * The eight shark plans (classic … nurse) and their marking functions are
 * adapted from ascii-sharks/src/renderer.ts by drewdi (stackedlol), MIT
 * License — see ./LICENSE-ascii-sharks.md.
 *
 * The whale shark, manta ray and ocean sunfish plans are original to this
 * project (Learning Garden).
 */
import { hash3, smoothstep } from './util.ts';

export type SharkKind =
  | 'classic'
  | 'hammerhead'
  | 'zebra'
  | 'tiger'
  | 'greathammer'
  | 'mako'
  | 'thresher'
  | 'nurse'
  | 'whaleshark';
export type CreatureKind = SharkKind | 'manta' | 'sunfish';

/** 0 = plain skin, 1 = dark marking, 2 = pale patch, 3 = pale spot on dark skin. */
export type Mark = 0 | 1 | 2 | 3;

export interface Motion {
  /** Cruise speed multiplier. */
  speed: number;
  /** Tail-beat / wing-beat rate multiplier. */
  beat: number;
  /** Body-wave amplitude (fraction of L) at s; 0 = rigid. */
  wave: (s: number) => number;
  /** Max bend between spine joints at s (radians). */
  bend: (s: number) => number;
  /** How far the outline reaches sideways (fraction of L), for bounding boxes. */
  reach: number;
  /** Turn agility multiplier. */
  agility: number;
}

export interface SharkShape {
  plan: 'shark';
  halfWidth: (s: number) => number;
  /** Pectoral fin: leading root, trailing root, tip position along the body, and reach. */
  pectoral: [number, number, number, number];
  falcate: boolean;
  pelvic: [number, number, number, number];
  /** Forked caudal fin reach, or 0 for a ribbon tail. */
  caudal: number;
  dorsal: [number, number];
  secondDorsal: [number, number];
  /** Hammerhead cephalofoil (fractions of L). */
  head?: { span: number; sweep: number; depth: number; notch: number };
  /** null when the eyes sit on the cephalofoil tips. */
  eye: [number, number] | null;
  gills: [number, number];
  /** Skin colour multipliers (r, g, b). */
  tint: [number, number, number];
  /** Overall skin brightness multiplier. */
  tone: number;
  /** Skin markings at (s, v·L, L, across, id). */
  mark?: (s: number, v: number, L: number, across: number, id: number) => Mark;
  /** Spine fraction after which a thin tail is drawn as a line ("whip"). */
  whipFrom?: number;
  /** Dark terminal mouth across the snout (whale shark). */
  mouth?: number;
  motion: Motion;
}

export interface MantaShape {
  plan: 'manta';
  /** Spine fraction where the disc ends and the tail whip begins. */
  disc: number;
  /** Spine fraction of the wing tips. */
  tipAt: number;
  /** Wing half-span (fraction of L). */
  span: number;
  /** Half-width of the head / cephalic fins. */
  head: number;
  tint: [number, number, number];
  tone: number;
  whipFrom: number;
  motion: Motion;
}

export interface SunfishShape {
  plan: 'sunfish';
  /** Body ellipse: centre and half-length along s, half-height across. */
  centre: number;
  halfLength: number;
  halfHeight: number;
  /** Clavus (truncated tail fringe) start and end along s. */
  clavus: [number, number];
  /** Dorsal / anal fin: leading root, trailing root, tip along s, reach across. */
  fin: [number, number, number, number];
  tint: [number, number, number];
  tone: number;
  motion: Motion;
}

export type CreatureShape = SharkShape | MantaShape | SunfishShape;

// ── sharks (adapted from ascii-sharks) ──────────────────────────────────

/** Classic top-down half-width at s, as a fraction of length. */
function classicHalfWidth(s: number) {
  if (s < 0.13) return 0.09 * Math.pow(Math.sin(((s / 0.13) * Math.PI) / 2), 0.95);
  if (s < 0.3) return 0.09 + 0.016 * smoothstep(0.13, 0.3, s);
  if (s < 0.84) return 0.019 + 0.087 * Math.pow(1 - (s - 0.3) / 0.54, 1.25);
  const k = (s - 0.84) / 0.16;
  return 0.019 * (1 - k) + 0.012 * Math.sin(k * Math.PI);
}

const sharkMotion = (over: Partial<Motion> = {}): Motion => ({
  speed: 1,
  beat: 1,
  wave: (s) => 0.05 * (0.1 + 0.9 * Math.pow(s, 1.8)),
  bend: () => 0.16,
  reach: 0.36,
  agility: 1,
  ...over,
});

/** Tiger shark: wavy vertical bars over the back half. */
function tigerMark(s: number, v: number, L: number, across: number): Mark {
  if (s < 0.2 || s > 0.9 || across > 0.85) return 0;
  const wobble = 0.35 * Math.sin((v / L) * 25 + s * 5);
  const bar = Math.sin(s * Math.PI * 2 * 9 + wobble);
  return bar > 0.65 - 0.5 * smoothstep(0.2, 0.42, s) + 0.4 * smoothstep(0.8, 0.9, s) ? 1 : 0;
}

/** Zebra shark: leopard spots on a jittered grid, plus pale ridges down the back. */
function zebraMark(s: number, v: number, L: number, across: number, id: number): Mark {
  if (s > 0.08 && s < 0.55 && (across < 0.1 || Math.abs(across - 0.6) < 0.08)) return 2;
  if (s < 0.07) return 0;
  const gu = (s * L) / (L * 0.06);
  const gv = v / (L * 0.045);
  const cu = Math.floor(gu);
  const cv = Math.floor(gv);
  const jx = hash3(cu, cv, id) * 0.5 + 0.25;
  const jy = hash3(cu, cv, id + 11) * 0.5 + 0.25;
  return (gu - cu - jx) ** 2 + (gv - cv - jy) ** 2 < 0.08 ? 1 : 0;
}

// ── whale shark (original) ──────────────────────────────────────────────

/** Broad, flat, square-fronted head; long heavy body; tall crescent tail. */
function whaleSharkHalfWidth(s: number) {
  if (s < 0.04) return 0.112 * Math.pow(Math.sin(((s / 0.04) * Math.PI) / 2), 0.28);
  if (s < 0.3) return 0.112 + 0.006 * smoothstep(0.04, 0.3, s);
  if (s < 0.86) return 0.02 + 0.098 * Math.pow(1 - (s - 0.3) / 0.56, 1.15);
  const k = (s - 0.86) / 0.14;
  return 0.02 * (1 - k) + 0.012 * Math.sin(k * Math.PI);
}

/**
 * Whale shark skin: a checkerboard of pale spots between pale transverse
 * stripes, with three pale ridges running down the back.
 */
function whaleSharkMark(s: number, v: number, L: number, across: number, id: number): Mark {
  if (s < 0.05) return 0;
  // Longitudinal ridges (spine + one along each flank).
  if (s > 0.12 && s < 0.82 && (across < 0.05 || Math.abs(across - 0.55) < 0.04)) return 3;
  const gu = (s * L) / (L * 0.038);
  const gv = v / (L * 0.03);
  const cu = Math.floor(gu);
  const cv = Math.floor(gv);
  // Thin pale stripes across the back, every third column.
  if (s > 0.16 && s < 0.8 && cu % 3 === 0 && gu - cu < 0.2 && across < 0.9) return 3;
  const jx = hash3(cu, cv, id + 3) * 0.3 + 0.35;
  const jy = hash3(cu, cv, id + 17) * 0.3 + 0.35;
  return (gu - cu - jx) ** 2 + (gv - cv - jy) ** 2 < 0.06 ? 3 : 0;
}

export const SHAPES: Record<CreatureKind, CreatureShape> = {
  classic: {
    plan: 'shark',
    halfWidth: classicHalfWidth,
    pectoral: [0.15, 0.43, 0.55, 0.26],
    falcate: true,
    pelvic: [0.57, 0.65, 0.69, 0.085],
    caudal: 0.085,
    dorsal: [0.33, 0.47],
    secondDorsal: [0.71, 0.76],
    eye: [0.1, 0.14],
    gills: [0.19, 0.29],
    tint: [0.92, 0.97, 1.05],
    tone: 1,
    motion: sharkMotion(),
  },
  hammerhead: {
    plan: 'shark',
    halfWidth: (s) => {
      if (s < 0.06) return 0.045;
      if (s < 0.3) return 0.045 + 0.061 * smoothstep(0.06, 0.3, s);
      return classicHalfWidth(s) * 0.92;
    },
    head: { span: 0.17, sweep: 0.035, depth: 0.09, notch: 0 },
    pectoral: [0.17, 0.4, 0.5, 0.22],
    falcate: true,
    pelvic: [0.56, 0.63, 0.67, 0.075],
    caudal: 0.11,
    dorsal: [0.28, 0.44],
    secondDorsal: [0.7, 0.74],
    eye: null,
    gills: [0.16, 0.26],
    tint: [0.96, 0.98, 0.9],
    tone: 1,
    motion: sharkMotion(),
  },
  tiger: {
    plan: 'shark',
    halfWidth: (s) => {
      if (s < 0.13) return 0.1 * Math.pow(Math.sin(((s / 0.13) * Math.PI) / 2), 0.45);
      if (s < 0.3) return 0.1 + 0.014 * smoothstep(0.13, 0.3, s);
      if (s < 0.84) return 0.019 + 0.095 * Math.pow(1 - (s - 0.3) / 0.54, 1.2);
      const k = (s - 0.84) / 0.16;
      return 0.019 * (1 - k) + 0.012 * Math.sin(k * Math.PI);
    },
    pectoral: [0.15, 0.42, 0.53, 0.25],
    falcate: true,
    pelvic: [0.57, 0.65, 0.69, 0.085],
    caudal: 0.095,
    dorsal: [0.33, 0.46],
    secondDorsal: [0.71, 0.75],
    eye: [0.08, 0.12],
    gills: [0.19, 0.28],
    tint: [1.02, 0.95, 0.84],
    tone: 1,
    mark: tigerMark,
    motion: sharkMotion(),
  },
  zebra: {
    plan: 'shark',
    halfWidth: (s) => {
      if (s < 0.1) return 0.075 * Math.pow(Math.sin(((s / 0.1) * Math.PI) / 2), 0.7);
      if (s < 0.28) return 0.075 + 0.025 * smoothstep(0.1, 0.28, s);
      if (s < 0.55) return 0.022 + 0.078 * Math.pow(1 - (s - 0.28) / 0.27, 1.1);
      const k = (s - 0.55) / 0.45;
      return 0.022 * (1 - k * k) + 0.012 * Math.sin(k * Math.PI);
    },
    pectoral: [0.12, 0.3, 0.36, 0.19],
    falcate: false,
    pelvic: [0.42, 0.48, 0.51, 0.065],
    caudal: 0,
    dorsal: [0.36, 0.44],
    secondDorsal: [0.49, 0.53],
    eye: [0.06, 0.09],
    gills: [0.13, 0.2],
    tint: [1.08, 0.97, 0.74],
    tone: 1,
    mark: zebraMark,
    motion: sharkMotion(),
  },
  greathammer: {
    plan: 'shark',
    halfWidth: (s) => {
      if (s < 0.05) return 0.04;
      if (s < 0.3) return 0.04 + 0.07 * smoothstep(0.05, 0.3, s);
      return classicHalfWidth(s) * 0.95;
    },
    head: { span: 0.21, sweep: 0.006, depth: 0.085, notch: 0.014 },
    pectoral: [0.16, 0.38, 0.49, 0.24],
    falcate: true,
    pelvic: [0.55, 0.62, 0.67, 0.085],
    caudal: 0.13,
    dorsal: [0.24, 0.45],
    secondDorsal: [0.68, 0.74],
    eye: null,
    gills: [0.15, 0.25],
    tint: [0.86, 0.93, 1.02],
    tone: 1,
    motion: sharkMotion(),
  },
  mako: {
    plan: 'shark',
    halfWidth: (s) => {
      if (s < 0.17) return 0.088 * Math.pow(Math.sin(((s / 0.17) * Math.PI) / 2), 1.5);
      if (s < 0.32) return 0.088 + 0.012 * smoothstep(0.17, 0.32, s);
      if (s < 0.86) return 0.014 + 0.086 * Math.pow(1 - (s - 0.32) / 0.54, 1.45);
      const k = (s - 0.86) / 0.14;
      return 0.014 * (1 - k) + 0.01 * Math.sin(k * Math.PI);
    },
    pectoral: [0.18, 0.4, 0.5, 0.21],
    falcate: true,
    pelvic: [0.58, 0.64, 0.68, 0.06],
    caudal: 0.13,
    dorsal: [0.34, 0.45],
    secondDorsal: [0.76, 0.79],
    eye: [0.11, 0.15],
    gills: [0.2, 0.3],
    tint: [0.78, 0.9, 1.2],
    tone: 1,
    motion: sharkMotion({ speed: 1.15 }),
  },
  thresher: {
    plan: 'shark',
    halfWidth: (s) => {
      if (s < 0.08) return 0.07 * Math.pow(Math.sin(((s / 0.08) * Math.PI) / 2), 0.75);
      if (s < 0.2) return 0.07 + 0.02 * smoothstep(0.08, 0.2, s);
      if (s < 0.48) return 0.012 + 0.078 * Math.pow(1 - (s - 0.2) / 0.28, 1.3);
      const k = (s - 0.48) / 0.52;
      return 0.012 * (1 - k) + 0.006 * Math.sin(k * Math.PI * 0.9) + 0.002;
    },
    pectoral: [0.12, 0.27, 0.36, 0.2],
    falcate: true,
    pelvic: [0.37, 0.41, 0.44, 0.045],
    caudal: 0,
    dorsal: [0.24, 0.32],
    secondDorsal: [0.45, 0.47],
    eye: [0.05, 0.1],
    gills: [0.11, 0.18],
    tint: [1.0, 0.9, 1.08],
    tone: 1,
    whipFrom: 0.55,
    motion: sharkMotion(),
  },
  nurse: {
    plan: 'shark',
    halfWidth: (s) => {
      if (s < 0.08) return 0.085 * Math.pow(Math.sin(((s / 0.08) * Math.PI) / 2), 0.4);
      if (s < 0.3) return 0.085 + 0.02 * smoothstep(0.08, 0.3, s);
      if (s < 0.72) return 0.022 + 0.083 * Math.pow(1 - (s - 0.3) / 0.42, 1.1);
      const k = (s - 0.72) / 0.28;
      return 0.022 * (1 - k * k) + 0.014 * Math.sin(k * Math.PI);
    },
    pectoral: [0.16, 0.34, 0.4, 0.17],
    falcate: false,
    pelvic: [0.45, 0.52, 0.55, 0.075],
    caudal: 0,
    dorsal: [0.5, 0.58],
    secondDorsal: [0.63, 0.69],
    eye: [0.05, 0.075],
    gills: [0.14, 0.22],
    tint: [1.1, 0.96, 0.76],
    tone: 1,
    motion: sharkMotion({ speed: 0.85 }),
  },

  // ── original plans ──
  whaleshark: {
    plan: 'shark',
    halfWidth: whaleSharkHalfWidth,
    pectoral: [0.2, 0.39, 0.5, 0.24],
    falcate: true,
    pelvic: [0.6, 0.66, 0.7, 0.06],
    caudal: 0.15,
    dorsal: [0.42, 0.53],
    secondDorsal: [0.74, 0.77],
    eye: [0.035, 0.065],
    gills: [0.1, 0.2],
    tint: [0.82, 0.92, 1.12],
    tone: 0.6,
    mark: whaleSharkMark,
    mouth: 0.03,
    motion: sharkMotion({ speed: 0.72, beat: 0.7, wave: (s) => 0.035 * (0.1 + 0.9 * Math.pow(s, 2)), agility: 0.8 }),
  },
  manta: {
    plan: 'manta',
    disc: 0.45,
    tipAt: 0.31,
    span: 0.55,
    head: 0.075,
    tint: [0.9, 0.96, 1.06],
    tone: 0.55,
    whipFrom: 0.47,
    motion: {
      speed: 0.8,
      beat: 0.45,
      // The disc stays flat; only the tail whip trails and sways.
      wave: (s) => (s < 0.45 ? 0.004 : 0.004 + 0.05 * Math.pow((s - 0.45) / 0.55, 1.5)),
      bend: (s) => (s < 0.45 ? 0.02 : 0.22),
      reach: 0.6,
      agility: 0.7,
    },
  },
  sunfish: {
    plan: 'sunfish',
    centre: 0.34,
    halfLength: 0.34,
    halfHeight: 0.32,
    clavus: [0.6, 0.8],
    fin: [0.34, 0.7, 0.6, 0.6],
    tint: [1.04, 1.0, 0.94],
    tone: 0.95,
    motion: {
      speed: 0.55,
      beat: 0.9,
      wave: () => 0.004,
      bend: () => 0.03,
      reach: 0.65,
      agility: 0.6,
    },
  },
};

export const KINDS = Object.keys(SHAPES) as CreatureKind[];

/**
 * Default line-up, after character-ocean's "mixed" ocean (app.ts by jiezi1234,
 * MIT — https://github.com/jiezi1234/character-ocean).
 */
export const DEFAULT_LINEUP: { kind: CreatureKind; size: number }[] = [
  { kind: 'whaleshark', size: 1 },
  { kind: 'manta', size: 0.83 },
  { kind: 'hammerhead', size: 0.86 },
  { kind: 'sunfish', size: 0.64 },
  { kind: 'classic', size: 0.78 },
];
