import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CreatureWorld, SPINE_NODES } from '../src/scripts/creatures/creatures.ts';
import {
  CreatureRaster,
  FLAG_EYE,
  FLAG_FIN,
  FLAG_MARK,
  FLAG_MOUTH,
  FLAG_SPOT,
  FLAG_WHIP,
} from '../src/scripts/creatures/raster.ts';
import { DEFAULT_LINEUP, KINDS, type CreatureKind } from '../src/scripts/creatures/shapes.ts';

const CW = 12;
const CH = 17;
const COLS = 100;
const ROWS = 60;
const L = 440;

/** Rasterise one creature, heading right, centred in a 1200×1020 grid. */
function render(kind: CreatureKind, length = L, y = 510) {
  const world = new CreatureWorld();
  const c = world.make(1, kind, length, 600 + length / 2, y, 0);
  c.phase = 0;
  c.speed = 40;
  const raster = new CreatureRaster();
  raster.resize(COLS, ROWS, CW, CH);
  raster.rasterize([c]);
  const cells: { c: number; r: number; f: number }[] = [];
  for (let i = 0; i < COLS * ROWS; i++) if (raster.flag[i]) cells.push({ c: i % COLS, r: (i / COLS) | 0, f: raster.flag[i] });
  return cells;
}

const spineRow = 510 / CH;

describe('creature body plans', () => {
  test('every species is a dense character silhouette with eyes (any grid alignment)', () => {
    for (const kind of KINDS) for (const y of [510, 514, 518]) {
      const cells = render(kind, L, y);
      assert.ok(cells.length >= 90, `${kind}@${y}: only ${cells.length} cells`);
      assert.ok(cells.some((x) => x.f === FLAG_EYE), `${kind}@${y}: no eye`);
    }
  });

  test('hammerheads carry their eyes on a wide cephalofoil', () => {
    for (const kind of ['hammerhead', 'greathammer'] as const) {
      const eyes = render(kind).filter((x) => x.f === FLAG_EYE);
      const spread = (Math.max(...eyes.map((e) => e.r)) - Math.min(...eyes.map((e) => e.r))) * CH;
      assert.ok(spread > L * 0.25, `${kind}: eyes only ${spread}px apart`);
    }
  });

  test('manta: wings far wider than the disc is long, with a long tail whip', () => {
    const cells = render('manta');
    const disc = cells.filter((x) => x.f !== FLAG_WHIP);
    const height = (Math.max(...disc.map((x) => x.r)) - Math.min(...disc.map((x) => x.r)) + 1) * CH;
    const discLength = (Math.max(...disc.map((x) => x.c)) - Math.min(...disc.map((x) => x.c)) + 1) * CW;
    assert.ok(height > discLength * 1.6, `span ${height}px vs disc ${discLength}px`);
    const whip = cells.filter((x) => x.f === FLAG_WHIP);
    assert.ok(whip.length * CW > L * 0.35, 'tail too short');
  });

  test('thin tails are drawn as one unbroken line', () => {
    for (const kind of ['manta', 'thresher'] as const) {
      const whip = render(kind).filter((x) => x.f === FLAG_WHIP);
      const key = (x: { c: number; r: number }) => `${x.c},${x.r}`;
      const set = new Set(whip.map(key));
      const seen = new Set<string>([key(whip[0])]);
      const stack: { c: number; r: number }[] = [whip[0]];
      while (stack.length) {
        const p = stack.pop()!;
        for (let dc = -1; dc <= 1; dc++)
          for (let dr = -1; dr <= 1; dr++) {
            const k = `${p.c + dc},${p.r + dr}`;
            if (set.has(k) && !seen.has(k)) {
              seen.add(k);
              stack.push({ c: p.c + dc, r: p.r + dr });
            }
          }
      }
      assert.equal(seen.size, whip.length, `${kind}: whip broken into pieces`);
    }
  });

  test('species markings: whale-shark spots and mouth, tiger stripes, sunfish fins both sides', () => {
    for (const y of [510, 514, 518]) {
      const whale = render('whaleshark', L, y);
      assert.ok(whale.filter((x) => x.f === FLAG_SPOT).length >= 15, 'whale shark needs pale spots');
      assert.ok(whale.some((x) => x.f === FLAG_MOUTH), `whale shark needs a terminal mouth (y=${y})`);
    }
    assert.ok(render('tiger').some((x) => x.f === FLAG_MARK), 'tiger shark needs bars');
    const sun = render('sunfish', 300).filter((x) => x.f === FLAG_FIN);
    assert.ok(sun.some((x) => x.r < spineRow - 6), 'sunfish needs a dorsal fin');
    assert.ok(sun.some((x) => x.r > spineRow + 6), 'sunfish needs an anal fin');
  });
});

describe('creature motion', () => {
  test('spines keep their length and snouts stay out of the profile', () => {
    const world = new CreatureWorld();
    world.avoid = { cx: 720, cy: 450, rx: 330, ry: 230 };
    world.seed(DEFAULT_LINEUP, 1440, 900);
    let inside = 0;
    let samples = 0;
    for (let i = 0; i < 60 * 30; i++) {
      world.step(1 / 60);
      if (i % 30 !== 0) continue;
      for (const c of world.creatures) {
        const e = Math.hypot((c.nodes[0] - 720) / 330, (c.nodes[1] - 450) / 230);
        samples++;
        if (e < 0.7) inside++;
      }
    }
    assert.ok(inside / samples < 0.05, `snouts inside the profile ${inside}/${samples}`);
    for (const c of world.creatures) {
      const seg = c.length / (SPINE_NODES - 1);
      for (let k = 1; k < SPINE_NODES; k++) {
        const d = Math.hypot(c.nodes[k * 2] - c.nodes[(k - 1) * 2], c.nodes[k * 2 + 1] - c.nodes[(k - 1) * 2 + 1]);
        assert.ok(Math.abs(d - seg) < seg * 0.01, `${c.kind} spine stretched`);
      }
    }
  });
});
