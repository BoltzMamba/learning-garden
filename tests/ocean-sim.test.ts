import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { FEED, fishCountFor, mulberry32, OceanSim, SPECIES, type Ellipse } from '../src/scripts/ocean-sim.ts';

const W = 1440;
const H = 900;
const CELL = 18;
const avoid: Ellipse = { cx: W / 2, cy: H / 2, rx: 330, ry: 230 };
const make = (seed = 7) => new OceanSim({ width: W, height: H, cell: CELL, rng: mulberry32(seed), avoid });
const near = (sim: OceanSim, x: number, y: number, r: number) =>
  sim.fish.filter((f) => Math.hypot(f.x - x, f.y - y) < r).length;
const run = (sim: OceanSim, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 30) sim.step(1 / 30);
};

describe('ocean simulation', () => {
  test('fish count scales with area and stays bounded on mobile', () => {
    assert.equal(fishCountFor(1440, 900), 295);
    assert.equal(fishCountFor(375, 700), 60);
    assert.equal(fishCountFor(600, 2000), 90);
    assert.equal(fishCountFor(3840, 2160), 320);
    const sim = make();
    assert.equal(sim.fish.length, 295);
    const species = new Set(sim.fish.map((f) => f.species));
    assert.ok(species.size >= 3, `expected several species, got ${species.size}`);
  });

  test('fish move smoothly: no step exceeds max speed (wrap-around excluded)', () => {
    const sim = make(3);
    for (let s = 0; s < 300; s++) {
      const before = sim.fish.map((f) => [f.x, f.y]);
      sim.step(1 / 30);
      sim.fish.forEach((f, i) => {
        const d = Math.hypot(f.x - before[i][0], f.y - before[i][1]);
        if (d > W / 3) return; // offscreen wrap
        assert.ok(d <= (SPECIES[f.species].maxSpeed / 30) * 1.01, `fish ${i} jumped ${d.toFixed(2)}px`);
      });
    }
  });

  test('schools keep out of the profile clearing', () => {
    const sim = make(11);
    run(sim, 20);
    const inside = sim.fish.filter((f) => sim.avoidDistance(f.x, f.y) < 0.85).length;
    assert.ok(inside / sim.fish.length < 0.03, `${inside} fish inside the profile`);
  });

  test('feeding: delayed response, nearby fish gather, pellets are eaten, then fish disperse', () => {
    const sim = make(5);
    run(sim, 5);
    const P = { x: 220, y: 160 };
    const radius = CELL * 3;
    const baseline = near(sim, P.x, P.y, radius);

    assert.ok(sim.feed(P.x, P.y) >= FEED.perClick[0]);
    const ids = sim.pellets.map((p) => p.id);

    // Not instantaneous: right after the click only a few fish have noticed.
    sim.step(0.05);
    const sense = FEED.senseCells * CELL;
    const inRange = sim.fish.filter((f) => Math.hypot(f.x - P.x, f.y - P.y) < sense).length;
    const early = sim.fish.filter((f) => f.target >= 0).length;
    assert.ok(early < Math.max(3, inRange * 0.5), `too many instant responders: ${early}/${inRange}`);

    // Fish converge on the food (pellets sink, so measure around the pellets).
    let peak = 0;
    let crumbs = 0;
    let maxChasing = 0;
    for (let s = 0; s < 30 * 8; s++) {
      sim.step(1 / 30);
      maxChasing = Math.max(maxChasing, sim.fish.filter((f) => f.target >= 0).length);
      const live = sim.pellets.filter((p) => ids.includes(p.id));
      const cx = live.length ? live.reduce((a, p) => a + p.x, 0) / live.length : P.x;
      const cy = live.length ? live.reduce((a, p) => a + p.y, 0) / live.length : P.y;
      peak = Math.max(peak, near(sim, cx, cy, radius));
      crumbs = Math.max(crumbs, sim.crumbs.length);
    }
    assert.ok(peak >= baseline + 4, `no gathering (baseline ${baseline}, peak ${peak})`);
    assert.ok(crumbs > 0, 'no pellet was eaten');
    // A small crowd, not the whole ocean.
    assert.ok(maxChasing <= ids.length * FEED.maxChasers, `too many chasers: ${maxChasing}`);

    // Far fish do not all rush in: most of the school never targeted food.
    const far = sim.fish.filter((f) => Math.hypot(f.x - P.x, f.y - P.y) > sense * 1.5);
    assert.ok(far.length > sim.fish.length * 0.4);

    // All pellets gone within their lifetime, and the crowd disperses.
    run(sim, FEED.life + 12);
    assert.equal(sim.pellets.filter((p) => ids.includes(p.id)).length, 0);
    assert.equal(sim.fish.filter((f) => f.target >= 0).length, 0);
    const after = near(sim, P.x, P.y + 40, radius);
    assert.ok(after < peak, `still clumped: ${after} near the feeding spot (peak ${peak})`);
  });

  test('pellet count is capped under rapid clicking', () => {
    const sim = make(9);
    for (let i = 0; i < 25; i++) sim.feed(100 + i * 20, 120);
    assert.ok(sim.pellets.length <= FEED.maxPellets);
    run(sim, 2);
    assert.ok(sim.pellets.length <= FEED.maxPellets);
  });

  test('deterministic with the same seed', () => {
    const a = make(42);
    const b = make(42);
    run(a, 3);
    run(b, 3);
    assert.deepEqual(
      a.fish.slice(0, 5).map((f) => [f.x.toFixed(3), f.y.toFixed(3)]),
      b.fish.slice(0, 5).map((f) => [f.x.toFixed(3), f.y.toFixed(3)]),
    );
  });
});
