/**
 * Rasterises big creatures into a character grid: every cell in a creature's
 * bounding box is supersampled against the species body plan; fully covered
 * cells become shaded skin (a grey block + a glyph from a density ramp),
 * partially covered cells become light edge glyphs.
 *
 * Adapted from ascii-sharks/src/renderer.ts (sampleShark, rasterizeSharks,
 * drawSharks) by drewdi (stackedlol), MIT License — see ./LICENSE-ascii-sharks.md.
 * Changes: theme-aware palette instead of fixed colours on black, a fade
 * mask around the page profile, thin "whip" tails drawn as line glyphs, and
 * original manta-ray and ocean-sunfish samplers (sampleManta, sampleSunfish).
 */
import { SPINE_NODES, type Creature } from './creatures.ts';
import { KINDS, SHAPES, type CreatureShape, type MantaShape, type SharkShape, type SunfishShape } from './shapes.ts';
import { clamp, hash3, inTriangle, smoothstep } from './util.ts';

export const FLAG_BODY = 1;
export const FLAG_EDGE = 2;
export const FLAG_FIN = 3;
export const FLAG_RIDGE = 4;
export const FLAG_EYE = 5;
export const FLAG_MARK = 6;
export const FLAG_PALE = 7;
export const FLAG_WHIP = 8;
/** Pale spot / ridge glyph on dark skin (whale shark). */
export const FLAG_SPOT = 9;
export const FLAG_MOUTH = 10;

// Sparse glyphs on bright skin, dense glyphs in shadow.
const SKIN_RAMP = ':;t%SX8#@';
const FIN_GLYPHS = '%;tS:';
const RIDGE_GLYPHS = '@8%';
const MARK_GLYPHS = '#%@';
const PALE_GLYPHS = 'o:;.';
const SPOT_GLYPHS = 'o°o.:';
const EDGE_HEAVY = ':;';
const EDGE_LIGHT = ".',`";
const WHIP_GLYPHS = ['-', '\\', '|', '/'];

// Sub-cell sample offsets for anti-aliased silhouettes.
const SUBSAMPLES = [0.25, 0.3, 0.75, 0.3, 0.25, 0.72, 0.75, 0.72];

type RGB = [number, number, number];

export interface CreaturePalette {
  bg: RGB;
  /** Block colour for skin in deepest shadow / brightest light. */
  shadow: RGB;
  light: RGB;
  /** Glyph colours on bright / dark blocks. */
  glyphOnLight: string;
  glyphOnDark: string;
  edge: RGB;
  eye: string;
  accents: string[];
  glint: string;
  /** 0 = ignore species tints, 1 = full tint. */
  tintStrength: number;
}

export function parseColor(value: string, fallback: RGB): RGB {
  const v = value.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.replace(/./g, (c) => c + c);
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(v);
  if (rgb) {
    const p = rgb[1].split(',').map((x) => parseFloat(x));
    if (p.length >= 3 && p.every((x) => Number.isFinite(x))) return [p[0], p[1], p[2]];
  }
  return fallback;
}

/** Read the creature palette from CSS custom properties on `el`. */
export function readCreaturePalette(el: Element): CreaturePalette {
  const s = getComputedStyle(el);
  const v = (name: string) => s.getPropertyValue(name).trim();
  return {
    bg: parseColor(v('--bg'), [247, 248, 245]),
    shadow: parseColor(v('--creature-shadow'), [140, 148, 153]),
    light: parseColor(v('--creature-light'), [228, 231, 233]),
    glyphOnLight: v('--creature-glyph-light') || '#15181d',
    glyphOnDark: v('--creature-glyph-dark') || '#1b1d24',
    edge: parseColor(v('--creature-edge'), [120, 128, 134]),
    eye: v('--creature-eye') || '#9aa0ad',
    accents: (v('--creature-accents') || '#e0892c #b44ae0 #33c8cc #3cb54a #3150e8').split(/\s+/),
    glint: v('--creature-glint') || '#ffffff',
    tintStrength: Number(v('--creature-tint')) || 1,
  };
}

const mixRGB = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c: RGB) => `rgb(${Math.round(clamp(c[0], 0, 255))},${Math.round(clamp(c[1], 0, 255))},${Math.round(clamp(c[2], 0, 255))})`;

export class CreatureRaster {
  cols = 0;
  rows = 0;
  cw = 12;
  ch = 17;

  flag = new Uint8Array(0);
  shade = new Float32Array(0);
  key = new Uint32Array(0);
  depth = new Float32Array(0);
  kind = new Uint8Array(0);
  angle = new Float32Array(0);
  fade = new Float32Array(0);

  private spine = new Float32Array(SPINE_NODES * 2);
  private arc = new Float32Array(SPINE_NODES);
  private arcTotal = 1;
  private shape: CreatureShape = SHAPES.classic;
  private id = 0;
  private phase = 0;
  private finTipLeft = 0;
  private finTipRight = 0;
  private bank = 0;
  // Scratch outputs of sample().
  private hitFlag = 0;
  private hitShade = 0;
  private hitS = 0;
  private hitV = 0;
  private hitDist = 0;

  resize(cols: number, rows: number, cw: number, ch: number) {
    this.cw = cw;
    this.ch = ch;
    if (cols === this.cols && rows === this.rows) return;
    this.cols = cols;
    this.rows = rows;
    const n = cols * rows;
    this.flag = new Uint8Array(n);
    this.shade = new Float32Array(n);
    this.key = new Uint32Array(n);
    this.depth = new Float32Array(n);
    this.kind = new Uint8Array(n);
    this.angle = new Float32Array(n);
    this.fade = new Float32Array(n);
  }

  occupied(i: number) {
    return this.flag[i] !== 0;
  }

  // ── sampling ─────────────────────────────────────────────────────────

  /**
   * Classify one point against the current creature (spine/arc already
   * built). Writes hit* fields and returns whether the point is on it.
   */
  private sample(px: number, py: number, L: number) {
    const { spine, arc } = this;
    let best = Infinity;
    let bestS = 0;
    let bestSign = 1;
    let bestNx = 0;
    let bestNy = 0;
    for (let k = 0; k < SPINE_NODES - 1; k++) {
      const ax = spine[k * 2];
      const ay = spine[k * 2 + 1];
      const sx = spine[(k + 1) * 2] - ax;
      const sy = spine[(k + 1) * 2 + 1] - ay;
      const len2 = sx * sx + sy * sy || 1;
      const u = clamp(((px - ax) * sx + (py - ay) * sy) / len2, 0, 1);
      const qx = ax + sx * u;
      const qy = ay + sy * u;
      const d2 = (px - qx) ** 2 + (py - qy) ** 2;
      if (d2 < best) {
        best = d2;
        const len = Math.sqrt(len2);
        bestS = (arc[k] + u * len) / this.arcTotal;
        bestSign = sx * (py - ay) - sy * (px - ax) >= 0 ? 1 : -1;
        bestNx = (-sy / len) * bestSign;
        bestNy = (sx / len) * bestSign;
      }
    }
    const a = Math.sqrt(best);
    this.hitDist = a;
    this.hitS = bestS;
    this.hitV = a * bestSign;
    const shape = this.shape;
    if (shape.plan === 'manta') return this.sampleManta(shape, bestS, a, bestSign, bestNx, bestNy, L);
    if (shape.plan === 'sunfish') return this.sampleSunfish(shape, bestS, a, bestSign, L);
    return this.sampleShark(shape, bestS, a, bestSign, bestNx, bestNy, L);
  }

  private sampleShark(shape: SharkShape, s: number, a: number, sign: number, nx: number, ny: number, L: number) {
    const u = s * L;
    const w = shape.halfWidth(s) * L;

    const head = shape.head;
    if (head && u < L * (head.sweep + head.depth + head.notch)) {
      // Cephalofoil: a wide wing across the snout, tips swept back to the eyes.
      const span = L * head.span;
      const r = a / span;
      const front = L * head.sweep * r * r + L * head.notch * Math.max(0, 1 - r / 0.14);
      const depth = L * head.depth * (1 - 0.2 * r * r * r * r);
      if (r <= 1 && u >= front && u <= front + depth) {
        // Eyes at the tips (zone kept ≥ ~1 cell deep so they never fall between samples).
        this.hitFlag = r > 0.76 ? FLAG_EYE : FLAG_BODY;
        this.hitShade = r > 0.76 ? 0 : 0.62 - 0.2 * r + (u < front + L * 0.012 ? 0.1 : 0);
        return true;
      }
    }

    if (a <= w) {
      const across = a / (w || 1);
      // Keep the eye zone at least ~0.04 L long so it is never lost between cell samples.
      const eyePad = shape.eye ? Math.max(0, (0.04 - (shape.eye[1] - shape.eye[0])) / 2) : 0;
      // Rounded back lit from the top-left; flanks fall off into shadow.
      const facing = (nx * -0.6 + ny * -0.8) * across;
      let shade = 0.58 - across * across * 0.42 + facing * 0.26;
      let flag = FLAG_BODY;
      if (shape.mouth && s < shape.mouth && across < 0.86) {
        // Whale shark: a wide dark terminal mouth across the blunt snout.
        flag = FLAG_MOUTH;
        shade = 0;
      } else if (s > shape.dorsal[0] && s < shape.dorsal[1] && across < 0.3) {
        flag = FLAG_RIDGE;
        shade = 1;
      } else if (s > shape.secondDorsal[0] && s < shape.secondDorsal[1] && across < 0.4) {
        shade = Math.max(shade, 0.82);
      } else if (shape.eye && s > shape.eye[0] - eyePad && s < shape.eye[1] + eyePad && across > 0.55) {
        flag = FLAG_EYE;
        shade = 0;
      } else if (s > shape.gills[0] && s < shape.gills[1] && across > 0.58) {
        if (Math.floor(((s - shape.gills[0]) / (shape.gills[1] - shape.gills[0])) * 5) % 2 === 0) shade *= 0.45;
      } else if (s < 0.05 && !shape.mouth) {
        shade = Math.max(shade, 0.7);
      } else if (shape.mark) {
        const m = shape.mark(s, a * sign, L, across, this.id);
        if (m === 1) flag = FLAG_MARK;
        else if (m === 2) {
          flag = FLAG_PALE;
          shade = Math.max(shade, 0.85);
        } else if (m === 3) flag = FLAG_SPOT;
      }
      this.hitFlag = flag;
      this.hitShade = shade * shape.tone + (1 - shape.tone) * 0.1;
      return true;
    }

    const tip = sign > 0 ? this.finTipRight : this.finTipLeft;
    const [p0, p1, p2] = shape.pectoral;
    if (
      inTriangle(u, a, L * p0, 0, L * p1, 0, L * p2, tip) &&
      // Falcate (sickle) fins get a concave trailing edge.
      !(shape.falcate && inTriangle(u, a, L * p1, 0, L * (p1 + (p2 - p1) * 0.33), tip * 0.55, L * p2, tip))
    ) {
      const marked = shape.mark ? shape.mark(s, a * sign, L, 0, this.id) : 0;
      this.hitFlag = marked === 1 ? FLAG_MARK : marked === 2 ? FLAG_PALE : marked === 3 ? FLAG_SPOT : FLAG_FIN;
      this.hitShade = (0.38 + 0.22 * (1 - clamp(a / tip, 0, 1))) * shape.tone + (1 - shape.tone) * 0.1;
      return true;
    }
    const [v0, v1, v2, vr] = shape.pelvic;
    if (
      inTriangle(u, a, L * v0, 0, L * v1, 0, L * v2, L * vr) ||
      (shape.caudal > 0 && inTriangle(u, a, L * 0.86, 0, L * 0.95, 0, L, L * shape.caudal))
    ) {
      this.hitFlag = FLAG_FIN;
      this.hitShade = 0.36 * shape.tone + (1 - shape.tone) * 0.1;
      return true;
    }
    return false;
  }

  /**
   * Manta ray seen from above: a flat rhombic disc with long swept wings,
   * paired cephalic fins framing the mouth, pale shoulder patches, small
   * pelvic fins, and a thin tail whip. Wings flap (span breathes) and bank.
   */
  private sampleManta(shape: MantaShape, s: number, a: number, sign: number, nx: number, ny: number, L: number) {
    const u = s * L;
    if (s > shape.disc) {
      // Tail root thickness; the rest of the tail is drawn as a whip.
      const w = L * 0.012 * (1 - smoothstep(shape.disc, shape.disc + 0.08, s));
      if (a > w) return false;
      this.hitFlag = FLAG_BODY;
      this.hitShade = 0.3;
      return true;
    }
    const flap = 1 + 0.12 * Math.sin(this.phase);
    const span = L * shape.span * flap * (sign > 0 ? 1 - this.bank : 1 + this.bank);
    const head = L * shape.head;
    const wingFrom = 0.06;
    let hw: number;
    if (s < wingFrom) hw = head;
    else if (s < shape.tipAt) {
      // Nearly straight leading edge, swept back to tips near the rear of the disc.
      const k = (s - wingFrom) / (shape.tipAt - wingFrom);
      hw = head + (span - head) * Math.pow(k, 0.92);
    } else {
      // Short concave trailing edge back to the body: pointed, falcate tips.
      const k = (s - shape.tipAt) / (shape.disc - shape.tipAt);
      const core = L * (0.07 * (1 - smoothstep(0.3, shape.disc, s)) + 0.025);
      hw = Math.max(span * Math.pow(1 - k, 1.35), core);
    }

    // Pelvic fins at the back of the disc.
    if (a > hw && inTriangle(u, a, L * (shape.disc - 0.05), 0, L * (shape.disc + 0.02), 0, L * (shape.disc + 0.015), L * 0.05)) {
      this.hitFlag = FLAG_FIN;
      this.hitShade = 0.35;
      return true;
    }
    if (a > hw) return false;

    // Mouth: a notch between the two cephalic fins.
    if (s < 0.025 && a < head * 0.42) return false;

    const across = a / (hw || 1);
    const facing = (nx * -0.6 + ny * -0.8) * across;
    let shade = 0.42 - across * across * 0.22 + facing * 0.22;
    let flag = FLAG_BODY;
    if (s < wingFrom && a > head * 0.42) {
      // Cephalic fins: two horn-like lobes either side of the mouth.
      flag = FLAG_FIN;
      shade = 0.55;
    } else if (s > wingFrom && s < wingFrom + 0.035 && a > head * 0.8 && a < head * 1.35) {
      flag = FLAG_EYE;
      shade = 0;
    } else if (s > 0.09 && s < 0.26 && Math.abs(across - (0.1 + (s - 0.09) * 2)) < 0.15 && across < 0.55) {
      // Pale shoulder chevrons, the manta's signature marking.
      flag = FLAG_PALE;
      shade = 0.92;
    } else if (across < 0.04 && s > wingFrom) {
      shade = Math.max(shade, 0.6);
    } else if (across > 0.88) {
      shade *= 0.7;
    }
    this.hitFlag = flag;
    this.hitShade = shade * shape.tone + (1 - shape.tone) * 0.1;
    return true;
  }

  /**
   * Ocean sunfish basking on its side, seen from above: a tall round body
   * with a beak-like mouth, a big eye, a small pectoral fin and gill slit,
   * very tall dorsal and anal fins that scull alternately, and a scalloped
   * clavus where a tail would be. Mottled skin.
   */
  private sampleSunfish(shape: SunfishShape, s: number, a: number, sign: number, L: number) {
    const u = s * L;
    const v = a * sign; // < 0: dorsal side
    const t = (s - shape.centre) / shape.halfLength;
    let hb = Math.abs(t) <= 1 ? shape.halfHeight * L * Math.sqrt(1 - t * t) : 0;
    const [c0, c1] = shape.clavus;
    let clavus = false;
    if (s >= c0) {
      // Truncated rear: a fringe whose back edge is scalloped into lobes.
      const tc = (c0 - shape.centre) / shape.halfLength;
      const h0 = shape.halfHeight * L * Math.sqrt(Math.max(0, 1 - tc * tc));
      const lobes = 0.5 - 0.5 * Math.cos((a / (L * 0.075)) * Math.PI * 2);
      const rear = c1 - 0.035 * lobes - 0.05 * (a / (h0 || 1)) ** 2;
      if (s <= rear) {
        hb = Math.max(hb, h0 * (1 - 0.1 * (s - c0) / (c1 - c0)));
        clavus = s > c0 + 0.02;
      } else hb = 0;
    }

    if (a <= hb) {
      const across = a / (hb || 1);
      let shade = 0.62 - across * across * 0.3 + (sign < 0 ? 0.08 : -0.06) * across;
      let flag = FLAG_BODY;
      const ex = (s - 0.12) * L;
      const ey = v + L * 0.07;
      if (s < 0.03 && Math.abs(v) < L * 0.025) {
        flag = FLAG_EYE; // small beak mouth
        shade = 0;
      } else if (ex * ex + ey * ey < (L * 0.028) ** 2) {
        flag = FLAG_EYE;
        shade = 0;
      } else if (s > 0.2 && s < 0.215 && Math.abs(v - L * 0.01) < L * 0.055) {
        flag = FLAG_MARK; // gill slit
      } else if (s > 0.23 && s < 0.31 && v > -L * 0.035 && v < L * 0.05) {
        flag = FLAG_FIN; // pectoral fin
        shade = 0.42;
      } else if (clavus) {
        flag = FLAG_FIN;
        shade = 0.5 + 0.15 * Math.sin(a / (L * 0.03));
      } else if (hash3(Math.round(s * 46), Math.round((v / L) * 46), this.id + 5) < 0.07) {
        flag = FLAG_MARK; // mottling
      }
      this.hitFlag = flag;
      this.hitShade = shade * shape.tone + (1 - shape.tone) * 0.1;
      return true;
    }

    // Tall dorsal (one side) and anal (other side) fins, sculling in turn.
    const [f0, f1, ftip, freach] = shape.fin;
    const sweep = 0.05 * Math.sin(this.phase) * (sign < 0 ? 1 : -1);
    const reach = L * freach * (1 - 0.06 * Math.cos(this.phase));
    if (inTriangle(u, a, L * f0, 0, L * f1, 0, L * (ftip + sweep), reach)) {
      this.hitFlag = FLAG_FIN;
      this.hitShade = (0.34 + 0.24 * (1 - a / reach)) * shape.tone;
      return true;
    }
    return false;
  }

  // ── rasterisation ────────────────────────────────────────────────────

  /**
   * Build a smooth, undulating render spine from each creature's sim spine,
   * then supersample every cell in its bounding box against its body plan.
   * `fadeAt(col, row)` returns 0…1 to dim cells (e.g. near the profile).
   */
  rasterize(creatures: Creature[], fadeAt?: (c: number, r: number) => number) {
    const { flag, shade: shadeBuf, key: keyBuf, depth: depthBuf, kind: kindBuf, angle: angleBuf, fade, spine, arc, cw, ch, cols, rows } = this;
    flag.fill(0);
    const N = SPINE_NODES;

    for (const sh of creatures) {
      const L = sh.length;
      const n = sh.nodes;
      const shape = SHAPES[sh.kind];
      const motion = shape.motion;
      const swim = clamp(sh.speed / 60, 0.4, 1.4);
      this.shape = shape;
      this.id = sh.id;
      this.phase = sh.phase;
      const kindIndex = KINDS.indexOf(sh.kind);

      // Travelling body wave, per species.
      for (let k = 0; k < N; k++) {
        const s = k / (N - 1);
        const a = Math.max(0, k - 1);
        const b = Math.min(N - 1, k + 1);
        let tx = n[a * 2] - n[b * 2];
        let ty = n[a * 2 + 1] - n[b * 2 + 1];
        const tl = Math.hypot(tx, ty) || 1;
        tx /= tl;
        ty /= tl;
        const off = L * motion.wave(s) * swim * Math.sin(sh.phase - s * 5.2);
        spine[k * 2] = n[k * 2] - ty * off;
        spine[k * 2 + 1] = n[k * 2 + 1] + tx * off;
      }
      arc[0] = 0;
      for (let k = 1; k < N; k++) {
        arc[k] = arc[k - 1] + Math.hypot(spine[k * 2] - spine[(k - 1) * 2], spine[k * 2 + 1] - spine[(k - 1) * 2 + 1]);
      }
      this.arcTotal = arc[N - 1] || 1;

      // Bank into turns: the inside fin foreshortens, the outside one spreads.
      this.bank = clamp(sh.turn * 0.45, -0.35, 0.35);
      if (shape.plan === 'shark') {
        const flex = 1 + 0.06 * Math.sin(sh.phase * 0.5);
        this.finTipRight = L * shape.pectoral[3] * flex * (1 - this.bank);
        this.finTipLeft = L * shape.pectoral[3] * flex * (1 + this.bank);
      }

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let k = 0; k < N; k++) {
        minX = Math.min(minX, spine[k * 2]);
        maxX = Math.max(maxX, spine[k * 2]);
        minY = Math.min(minY, spine[k * 2 + 1]);
        maxY = Math.max(maxY, spine[k * 2 + 1]);
      }
      const reach = L * motion.reach;
      const c0 = Math.max(0, Math.floor((minX - reach) / cw));
      const c1 = Math.min(cols - 1, Math.floor((maxX + reach) / cw));
      const r0 = Math.max(0, Math.floor((minY - reach) / ch));
      const r1 = Math.min(rows - 1, Math.floor((maxY + reach) / ch));
      if (c0 > c1 || r0 > r1) continue;

      const skipBeyond = reach + Math.hypot(cw, ch);
      const whipFrom = 'whipFrom' in shape ? shape.whipFrom : undefined;

      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const x = c * cw;
          const y = r * ch;
          const centerHit = this.sample(x + cw / 2, y + ch / 2, L);
          const s = this.hitS;
          const v = this.hitV;
          const i = r * cols + c;

          if (!centerHit && this.hitDist > skipBeyond) continue;
          // The thin tail is drawn as a line below; skip its soft fringe here.
          if (whipFrom !== undefined && s > whipFrom && !centerHit) continue;
          const hitFlag = this.hitFlag;
          const hitShade = this.hitShade;

          let hits = centerHit ? 1 : 0;
          for (let k = 0; k < SUBSAMPLES.length; k += 2) {
            if (this.sample(x + SUBSAMPLES[k] * cw, y + SUBSAMPLES[k + 1] * ch, L)) hits++;
          }
          if (hits === 0) continue;
          const coverage = hits / 5;

          // Body-anchored key so each glyph rides along with the skin.
          keyBuf[i] = (hash3(Math.round(s * 52), Math.round(v / (cw * 0.9)), sh.id) * 4294967295) >>> 0;
          depthBuf[i] = sh.depth;
          kindBuf[i] = kindIndex;
          fade[i] = fadeAt ? fadeAt(c, r) : 1;

          if (centerHit && coverage >= 0.6) {
            flag[i] = hitFlag;
            shadeBuf[i] = clamp(hitShade, 0, 1);
          } else {
            flag[i] = FLAG_EDGE;
            shadeBuf[i] = coverage;
          }
        }
      }

      // Thin tails: walk the render spine so the line of glyphs is unbroken.
      if (whipFrom !== undefined) {
        const startArc = whipFrom * this.arcTotal;
        const stepLen = Math.min(cw, ch) / 3;
        for (let k = 0; k < N - 1; k++) {
          if (arc[k + 1] < startArc) continue;
          const ax = spine[k * 2];
          const ay = spine[k * 2 + 1];
          const dx = spine[(k + 1) * 2] - ax;
          const dy = spine[(k + 1) * 2 + 1] - ay;
          const len = Math.hypot(dx, dy) || 1;
          const ang = Math.atan2(dy, dx);
          for (let d = 0; d <= len; d += stepLen) {
            const at = arc[k] + d;
            if (at < startArc) continue;
            const c = Math.floor((ax + (dx * d) / len) / cw);
            const r = Math.floor((ay + (dy * d) / len) / ch);
            if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
            const i = r * cols + c;
            flag[i] = FLAG_WHIP;
            angleBuf[i] = ang;
            // Fades a little toward the tip.
            shadeBuf[i] = 1 - 0.6 * ((at / this.arcTotal - whipFrom) / (1 - whipFrom));
            depthBuf[i] = sh.depth;
            kindBuf[i] = kindIndex;
            keyBuf[i] = (hash3(k, 0, sh.id) * 4294967295) >>> 0;
            fade[i] = fadeAt ? fadeAt(c, r) : 1;
          }
        }
      }
    }
  }

  // ── drawing ──────────────────────────────────────────────────────────

  draw(ctx: CanvasRenderingContext2D, palette: CreaturePalette, t: number) {
    const { cols, rows, cw, ch, flag, shade: shadeBuf, key: keyBuf, depth: depthBuf, kind: kindBuf, angle: angleBuf, fade } = this;
    const n = cols * rows;
    for (let i = 0; i < n; i++) {
      const f = flag[i];
      if (!f) continue;
      const alpha = fade[i];
      if (alpha <= 0.02) continue;
      ctx.globalAlpha = alpha;
      const x = (i % cols) * cw;
      const y = ((i / cols) | 0) * ch;
      const key = keyBuf[i];
      const shade = shadeBuf[i];
      const dim = 0.7 + 0.3 * depthBuf[i];
      const raw = SHAPES[KINDS[kindBuf[i]]].tint;
      const k = palette.tintStrength;
      const tint = [1 + (raw[0] - 1) * k, 1 + (raw[1] - 1) * k, 1 + (raw[2] - 1) * k];
      const tinted = (c: RGB): RGB => mixRGB(palette.bg, [c[0] * tint[0], c[1] * tint[1], c[2] * tint[2]], dim);

      // Colours re-roll on a staggered clock so the hide shimmers.
      const tick = Math.floor(t * 2.4 + (key % 997) / 97);
      const roll = hash3(key, tick, 7);

      if (f === FLAG_WHIP) {
        const q = ((Math.round(angleBuf[i] / (Math.PI / 4)) % 4) + 4) % 4;
        ctx.fillStyle = css(tinted(mixRGB(palette.edge, palette.shadow, 0.5 + 0.5 * shade)));
        ctx.fillText(WHIP_GLYPHS[q], x + cw / 2, y + ch / 2 + 1);
        continue;
      }
      if (f === FLAG_EDGE) {
        const set = shade >= 0.5 ? EDGE_HEAVY : EDGE_LIGHT;
        ctx.fillStyle =
          roll < 0.06 ? palette.accents[key % palette.accents.length] : css(tinted(mixRGB(palette.bg, palette.edge, 0.55 + 0.45 * shade)));
        ctx.fillText(set[(key >>> 8) % set.length], x + cw / 2, y + ch / 2 + 1);
        continue;
      }

      let level: number;
      let glyph: string;
      if (f === FLAG_RIDGE) {
        level = 0.95;
        glyph = RIDGE_GLYPHS[(key >>> 8) % RIDGE_GLYPHS.length];
      } else if (f === FLAG_EYE) {
        level = 0;
        glyph = 'o';
      } else if (f === FLAG_MARK) {
        level = 0.04 + shade * 0.1;
        glyph = MARK_GLYPHS[(key >>> 8) % MARK_GLYPHS.length];
      } else if (f === FLAG_PALE) {
        level = 0.9;
        glyph = PALE_GLYPHS[(key >>> 8) % PALE_GLYPHS.length];
      } else if (f === FLAG_SPOT) {
        level = 0.12 + shade * 0.22;
        glyph = SPOT_GLYPHS[(key >>> 8) % SPOT_GLYPHS.length];
      } else if (f === FLAG_MOUTH) {
        level = 0;
        glyph = '=';
      } else if (f === FLAG_FIN) {
        level = 0.05 + shade * 0.6;
        glyph = FIN_GLYPHS[(key >>> 8) % FIN_GLYPHS.length];
      } else {
        level = 0.08 + shade * 0.78;
        const jitter = ((key >>> 4) % 3) - 1;
        glyph = SKIN_RAMP[clamp(Math.floor((1 - shade) * 8.99) + jitter, 0, SKIN_RAMP.length - 1)];
      }
      const block = f === FLAG_EYE || f === FLAG_MOUTH ? mixRGB(palette.shadow, [0, 0, 0], 0.55) : mixRGB(palette.shadow, palette.light, level);
      ctx.fillStyle = css(tinted(block));
      ctx.fillRect(x + 1, y + 1, cw - 1, ch - 1);

      let color: string;
      if (f === FLAG_EYE) color = palette.eye;
      else if (f === FLAG_SPOT) color = palette.glint;
      else if (f === FLAG_MOUTH) color = palette.glyphOnDark;
      else if (f === FLAG_MARK) color = palette.glyphOnDark;
      else if (roll < 0.08) color = palette.accents[key % palette.accents.length];
      else if (roll < 0.11) color = palette.glint;
      else color = level > 0.45 ? palette.glyphOnLight : palette.glyphOnDark;
      ctx.fillStyle = color;
      ctx.fillText(glyph, x + cw / 2, y + ch / 2 + 1);
    }
    ctx.globalAlpha = 1;
  }
}
