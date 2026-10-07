import assert from "node:assert/strict";
import { Simulation, TRAIT_DEFINITIONS } from "../../packages/sim-core/src/engine.ts";
import { resolveFounderFamily } from "../../packages/phenotype/src/model.ts";

/**
 * Cell-shape structural axis (accepted design D): continuous inherited
 * elongation with reach-vs-drag tradeoffs. Grows task by task; each assay
 * pins exact behavior with the evidence in comments.
 */

function shapeConfig(seed: number): any {
  return {
    seed, start: 0.58, prod: 0.77, cap: 360, pop: 30, div: 0.35, mr: 0.03,
    ms: 0.12, press: 1.0875, patch: 0.6, resource_b_fraction: 0.5, cat: "global", st: null,
    resource_model: "definition_driven_substances", resource_grid: 60,
    enable_byproduct: true, enable_dormancy: true, study: true,
  };
}

function testTraitExists() {
  // The trait table carries elongation like any capability trait:
  // short field el, range [0, 1.5], multiplicative mutation (NOT the
  // additive diet/habitat/bu/dr list).
  const def = (TRAIT_DEFINITIONS as any).elongation;
  assert.deepEqual(def.slice(0, 3), ["el", 0, 1.5], "elongation registered with capability-trait range");
  const sim = new Simulation(shapeConfig(7)) as any;
  const els = sim.o.map((o: any) => o.el);
  assert.ok(els.every((v: number) => typeof v === "number" && v >= 0.05 && v <= 0.3),
    "founders initialize in the to/cu convention band");
  const mean = els.reduce((s: number, v: number) => s + v, 0) / els.length;
  assert.ok(mean > 0.12 && mean < 0.23, `founder mean in convention band (${mean.toFixed(3)})`);
  // Children carry el through the standard child path (mutation may move it).
  for (let t = 0; t < 2000 && sim.o.length < 60; t++) sim.step();
  assert.ok(sim.o.every((o: any) => typeof o.el === "number" && o.el >= 0 && o.el <= 1.5),
    "el persists in range across generations");
  console.log("trait exists: PASS");
}

function testTraitsAudit() {
  // Export truthfulness (Lane 1→Lane 2 contract): living export carries
  // elongation equal to organism state; metrics tracks it. The phenotype
  // resolver takes NO elongation input — family assignment cannot read
  // shape until Lane 2 explicitly wires the channel (that rewire is a
  // separate owned decision, never a silent leak).
  const sim = new Simulation(shapeConfig(7)) as any;
  for (const o of sim.o.slice(0, 3)) o.el = 1.2;
  const exported = sim.out() as any;
  const creatures = exported.living_creatures.slice(0, 3);
  assert.ok(creatures.every((c: any) => c.traits.elongation === 1.2), "export carries elongation");
  const m = sim.metrics() as any;
  assert.ok(m.traits.elongation && Math.abs(m.traits.elongation.mean - 1.2 * 3 / sim.o.length) < 0.2,
    "metrics tracks elongation");
  const base = { speed: 1.5, sensing: 40, metabolism: 0.12, reproduction: 80, diet: 0, habitat: 0, byproductUse: 0.2, dormancyResponse: 0.2 };
  assert.equal(
    resolveFounderFamily({ ...base, el: 999 } as any),
    resolveFounderFamily(base),
    "resolver ignores elongation until Lane 2 wires it",
  );
  console.log("traits audit: PASS");
}

testTraitExists();
testTraitsAudit();

function testReachIsolation() {
  // Elongated forms sense farther: probe distances scale with elongation.
  // Direct white-box sense() call on a static field (no ticks, so regen
  // cannot interfere): A-stock sits in exactly one cell at distance 150,
  // inside the elongated far probe but beyond every compact probe.
  const setup = (el: number): any => {
    const sim = new Simulation(shapeConfig(7)) as any;
    for (let k = 0; k < 3; k++) sim.resources.stock[k]!.fill(0);
    sim.resources.deposit(0, 455, 300, 500, null, null);
    const o = sim.o[0];
    o.x = 300; o.y = 300; o.h = Math.PI / 2; o.se = 100;
    o.di = -1.5; o.ha = 0; o.bu = 0; o.el = el;
    return { sim, o };
  };
  const c = setup(0);
  const compact = c.sim.resources.sense(c.o);
  const run = setup(1.5);
  const elongated = run.sim.resources.sense(run.o);
  console.log(`reach: compact angle ${compact.angle.toFixed(2)} score ${compact.score.toFixed(3)} | elongated angle ${elongated.angle.toFixed(2)} score ${elongated.score.toFixed(3)}`);
  assert.equal(compact.angle, Math.PI / 2, "compact sees nothing, holds heading");
  assert.equal(compact.score, 0, "compact scores nothing at range");
  const angDist = Math.abs(((elongated.angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI));
  assert.ok(angDist < 0.3 || angDist > 2 * Math.PI - 0.3, "elongated orients to the distant stock");
  assert.ok(elongated.score > 0, "elongated scores the distant stock");
  console.log("reach isolation: PASS");
}

function testDragIsolation() {
  // Elongation drags locomotion: matched clones, zeroed field (no eating),
  // one tick — the extra energy cost equals exactly the drag factor.
  const run = (el: number): number => {
    const sim = new Simulation(shapeConfig(7)) as any;
    for (let k = 0; k < 3; k++) sim.resources.stock[k]!.fill(0);
    const o = sim.o[0];
    o.sp = 2.0; o.el = el; o.en = 200; o.rp = 500; o.dr = 0;
    const before = o.en;
    sim.step();
    return before - o.en;
  };
  const cost0 = run(0);
  const costEl = run(1.5);
  const mc = 0.01 * 2 * 2 + 0.004 * 2 * 2 * 2 * 2;
  const ratio = (costEl - cost0) / (mc * (1.5 / 1.5) * 1.0875);
  console.log(`drag: base ${cost0.toFixed(5)} vs elongated ${costEl.toFixed(5)} (ratio ${ratio.toFixed(3)})`);
  assert.ok(ratio > 0.99 && ratio < 1.01, "drag factor exact at 1.0");
  console.log("drag isolation: PASS");
}

function testGeometryUntouched() {
  // Drag changes cost, never geometry: on a tick with no sensing evaluation
  // for an organism ((1+id)%4 != 0), its displacement is byte-identical
  // across elongation — same draws, same distances. (Sensing ticks may
  // legitimately bend paths: farther sight is the reach effect itself.)
  // Energies still diverge by drag cost.
  const run = (el: number): any[] => {
    const sim = new Simulation(shapeConfig(7)) as any;
    for (let k = 0; k < 3; k++) sim.resources.stock[k]!.fill(0);
    for (const o of sim.o) { o.sp = 2.0; o.el = el; o.en = 200; o.rp = 500; o.dr = 0; }
    sim.step();
    return sim.o.map((o: any) => [o.id, o.x, o.y, o.en]);
  };
  const a = run(0), b = run(1.5);
  const key = (r: any[]): number => r[0];
  const aMap = new Map(a.map((r) => [key(r), r]));
  let compared = 0, diverged = 0;
  for (const r of b) {
    if ((1 + (r[0] as number)) % 4 === 0) continue;
    compared++;
    const s = aMap.get(r[0])!;
    assert.deepEqual([r[1], r[2]], [s[1], s[2]], `organism ${r[0]} displacement identical`);
    if (r[3] !== s[3]) diverged++;
  }
  assert.ok(compared > 0 && diverged > 0, `compared ${compared}, cost-diverged ${diverged}`);
  console.log("geometry untouched: PASS");
}

testReachIsolation();
testDragIsolation();
testGeometryUntouched();
console.log("cell-shape validation: PASS (plumbing)");
