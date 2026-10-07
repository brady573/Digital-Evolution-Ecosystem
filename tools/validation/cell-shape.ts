import assert from "node:assert/strict";
import { Simulation, TRAIT_DEFINITIONS, createSimulationCheckpoint, restoreSimulationCheckpoint } from "../../packages/sim-core/src/engine.ts";
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
  // elongation equal to organism state; metrics tracks it. Proposed Lane 2
  // input norm is el/1.5 (capability-trait convention); the mapping itself
  // is Lane 2's owned decision, never made here.
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
  // Tracks EL_DRAG in engine.ts (currently 0.25): if the constant moves,
  // this expectation moves with it — the pin is exactness, not the value.
  const ratio = (costEl - cost0) / (mc * (1.5 / 1.5) * 1.0875);
  console.log(`drag: base ${cost0.toFixed(5)} vs elongated ${costEl.toFixed(5)} (ratio ${ratio.toFixed(3)})`);
  assert.ok(ratio > 0.24 && ratio < 0.26, "drag factor exact at 0.25");
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

function testContactReach() {
  // Spatial-reach branch: an elongated body contacts food in its facing
  // cell even with an empty home cell. Same setup, compact organism takes
  // nothing. No uptake bonus: the standard single-take rule, more candidates.
  const setup = (el: number): any => {
    const sim = new Simulation(shapeConfig(7)) as any;
    for (let k = 0; k < 3; k++) sim.resources.stock[k]!.fill(0);
    const o = sim.o[0];
    o.x = 300; o.y = 300; o.h = 0; o.di = -1.5; o.ha = 0; o.bu = 0;
    o.el = el; o.en = 200; o.rp = 500;
    sim.resources.deposit(0, 315, 300, 500, null, null);
    return { sim, o };
  };
  const compact = setup(0);
  assert.equal(compact.sim.resources.consume(compact.o, null), null, "compact takes nothing with empty home cell");
  const long = setup(1.2);
  const meal = long.sim.resources.consume(long.o, null);
  assert.ok(meal && meal.amount > 0, "elongated contacts the facing cell");
  assert.ok(meal.gain > 0, "contact yields real energy through the standard rule");
  console.log("contact reach: PASS");
}

function testNoRateIncrease() {
  // "Local physical reach, not faster exploitation": with the home cell
  // richest, elongated and compact takes are byte-identical — reach adds
  // candidates, never rate.
  const setup = (el: number): any => {
    const sim = new Simulation(shapeConfig(7)) as any;
    for (let k = 0; k < 3; k++) sim.resources.stock[k]!.fill(0);
    const o = sim.o[0];
    o.x = 300; o.y = 300; o.h = 0; o.di = -1.5; o.ha = 0; o.bu = 0;
    o.el = el; o.en = 200; o.rp = 500;
    sim.resources.deposit(0, 305, 300, 500, null, null);
    sim.resources.deposit(0, 315, 300, 100, null, null);
    return { sim, o };
  };
  const a = setup(0), b = setup(1.2);
  const ma = a.sim.resources.consume(a.o, null);
  const mb = b.sim.resources.consume(b.o, null);
  assert.ok(ma && mb, "both eat from the rich home cell");
  assert.equal(mb.amount, ma.amount, "identical take amounts");
  assert.equal(mb.gain, ma.gain, "identical gains");
  console.log("no rate increase: PASS");
}

function testFacingDeterminism() {
  // Contact set is pure deterministic geometry: own cell plus elongation-
  // gated facing cells along the heading, toroidal wrap included.
  const sim = new Simulation(shapeConfig(7)) as any;
  const rs = sim.resources;
  const o = sim.o[0];
  o.x = 300; o.y = 300; o.h = 0; o.el = 0;
  assert.deepEqual(rs.contactCells(o), [rs.idx(300, 300)], "compact contacts only home");
  o.el = 1.2;
  const cells = rs.contactCells(o);
  assert.ok(cells.length > 1 && cells[0] === rs.idx(300, 300), "elongated contacts home plus facing");
  assert.ok(cells.includes(rs.idx(310, 300)), "facing cell one step ahead included");
  o.x = 595; o.h = 0;
  const wrapped = rs.contactCells(o);
  assert.ok(wrapped.includes(rs.idx(5, 300)), "toroidal wrap resolved");
  console.log("facing determinism: PASS");
}

testContactReach();
testNoRateIncrease();
testFacingDeterminism();

const regimeBase = {
  cap: 360, pop: 30, div: 0.35, mr: 0.03, ms: 0.12, press: 1.0875,
  resource_b_fraction: 0.5, cat: "global", st: null,
  resource_model: "definition_driven_substances", resource_grid: 60,
  enable_byproduct: true, enable_dormancy: true, study: true,
};

function lineageShare(sim: any, marked: Set<number>): number {
  if (!sim.o.length) return 0;
  let n = 0;
  for (const o of sim.o) {
    if (marked.has(o.id)) n++;
    else if (o.parent != null && marked.has(o.parent)) { marked.add(o.id); n++; }
  }
  return n / sim.o.length;
}

// Mixed-morph competition with enrichment tracking (2B lineage discipline:
// shares sampled every 5k so dead intermediate generations never hide
// living descendants; single-shot endpoints read false zero).
function compete(cfg: any, markedEl: number, stops: number[]): { traj: number[]; pop: number } {
  const sim = new Simulation(cfg) as any;
  const marked = new Set<number>();
  sim.o.forEach((o: any, i: number) => {
    o.el = i % 2 === 0 ? 1.2 : 0.05;
    if ((i % 2 === 0 ? 1.2 : 0.05) === markedEl) marked.add(o.id);
  });
  const traj = [lineageShare(sim, marked)];
  for (const stop of stops) {
    while (sim.t < stop) sim.step();
    traj.push(lineageShare(sim, marked));
  }
  return { traj, pop: sim.o.length };
}

const verdicts: Record<string, boolean> = {};

function testCompactRegime() {
  // Uniform-rich world: home cells rarely stay empty-competitive...
  // measured instead — elongated invades early (share 0.68 @5k) then is
  // contained and excluded (0.006 @40k): drag compounds while contact
  // edges saturate once every body is elongated. Compact wins stably.
  // CI-measured trajectory (seed 7): 0.500/0.679/0.579/0.466/0.269/
  // 0.197/0.127/0.050/0.006 @0-40k. Bar pins the stable endpoint with
  // daylight; the trajectory is logged, not overfit.
  const { traj, pop } = compete(
    { ...regimeBase, seed: 7, start: 0.75, prod: 1.0, patch: 0.25 },
    1.2, [5000, 10000, 15000, 20000, 25000, 30000, 35000, 40000],
  );
  console.log(`compact regime (uniform, mark-hi): ${traj.map((s) => s.toFixed(3)).join("/")} pop=${pop}`);
  assert.ok(pop > 0, "world viable at assay end");
  assert.ok(traj[traj.length - 1]! < 0.1, "elongated lineage excluded by 40k in uniform-rich");
  verdicts.compact = true;
  console.log("compact regime: PASS");
}

function testElongatedRegime() {
  // Harsh-sparse world (start .25/prod .3/patch .95 — home cells often
  // empty, facing cells sometimes not): the compact lineage is excluded
  // (0.000 @35-40k) while elongated fixes. Contact extent creates reachable
  // opportunity with no ghost-chasing (no travel required).
  // CI-measured trajectory (seed 7): 0.500/0.186/0.110/0.254/0.125/
  // 0.073/0.037/0.000/0.000 @0-40k.
  const { traj, pop } = compete(
    { ...regimeBase, seed: 7, start: 0.25, prod: 0.3, patch: 0.95 },
    0.05, [5000, 10000, 15000, 20000, 25000, 30000, 35000, 40000],
  );
  console.log(`elongated regime (harsh-sparse, mark-lo): ${traj.map((s) => s.toFixed(3)).join("/")} pop=${pop}`);
  assert.ok(pop > 0, "world viable at assay end (no wipeout confound)");
  assert.ok(traj[traj.length - 1]! < 0.05, "compact lineage excluded by 40k in harsh-sparse");
  verdicts.elongated = true;
  console.log("elongated regime: PASS");
}

function testNoUniversalOptimum() {
  // Evidence #5: the two regime verdicts jointly — each morph is excluded
  // somewhere, so neither is a universal directional optimum.
  assert.ok(verdicts.compact && verdicts.elongated, "both ends won a regime (see trajectories above)");
  console.log("no universal optimum: PASS");
}

testCompactRegime();
testElongatedRegime();
testNoUniversalOptimum();

function testElDeterminism() {
  // Same engine/seed/config replays exactly, including el trajectories.
  const cfg = { ...regimeBase, seed: 7, start: 0.58, prod: 0.77, patch: 0.6 };
  const snapOf = (sim: any): string => JSON.stringify({
    t: sim.t, pop: sim.o.length,
    stock0: Array.from(sim.resources.stock[0] as Float32Array).map((v) => +v.toFixed(6)),
    orgs: sim.o.map((o: any) => [o.id, +o.x.toFixed(4), +o.y.toFixed(4), +o.en.toFixed(6), +o.el.toFixed(6)]),
  });
  const run = (): string => {
    const sim = new Simulation(cfg) as any;
    for (let t = 0; t < 3000; t++) sim.step();
    return snapOf(sim);
  };
  assert.equal(run(), run(), "identical replay including elongation");
  console.log("determinism: PASS");
}

function testElCheckpoint() {
  // Checkpoint with nonzero el restores exactly and continues identically.
  // Cross-version note (probed, not gated): branch@el0 diverges from main
  // 0.24.0 at the second birth, by one extra mutation-stream draw per birth
  // for the new trait — inherent to adding inherited state, version-gated
  // by design (precedent: every trait addition). Mechanism neutrality at
  // el=0 (single-cell contact, unit reach/drag factors) is pinned
  // structurally above; trajectory identity across versions is not claimed.
  const cfg = { ...regimeBase, seed: 7, start: 0.58, prod: 0.77, patch: 0.6 };
  const snapOf = (sim: any): string => JSON.stringify({
    t: sim.t,
    orgs: sim.o.map((o: any) => [o.id, +o.x.toFixed(4), +o.y.toFixed(4), +o.en.toFixed(6), +o.el.toFixed(6)]),
    waste: Array.from(sim.resources.waste.stock as Float32Array).map((v) => +v.toFixed(6)),
  });
  const sim = new Simulation(cfg) as any;
  for (const o of sim.o.slice(0, 5)) o.el = 1.2;
  for (let t = 0; t < 2000; t++) sim.step();
  const restored = restoreSimulationCheckpoint(JSON.parse(JSON.stringify(createSimulationCheckpoint(sim))));
  assert.equal(snapOf(restored), snapOf(sim), "checkpoint restores el state exactly");
  for (let t = 0; t < 1000; t++) { sim.step(); restored.step(); }
  assert.equal(snapOf(restored), snapOf(sim), "restored continuation identical");
  console.log("checkpoint: PASS");
}

testElDeterminism();
testElCheckpoint();
console.log("cell-shape validation: PASS (plumbing)");
