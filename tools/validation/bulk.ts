import assert from "node:assert/strict";
import { Simulation, TRAIT_DEFINITIONS, BKN, SCBK, RPBK, createSimulationCheckpoint, restoreSimulationCheckpoint } from "../../packages/sim-core/src/engine.ts";

// Bulk / body-mass plumbing (Task 2): inherited through the ordinary
// deterministic trait path, present in export/metrics state. Mechanically
// neutral at this step — bk must be behaviorally inert until Task 3.

const cfg = {
  seed: 7, cap: 360, pop: 30, div: 0.35, mr: 0.03, ms: 0.12, press: 1.0875,
  patch: 0.6, resource_b_fraction: 0.5, cat: "global", st: null,
  resource_model: "definition_driven_substances", resource_grid: 60,
  enable_byproduct: true, enable_dormancy: true, study: true,
  start: 0.58, prod: 0.77,
};

function testTraitExists() {
  assert.deepEqual(
    TRAIT_DEFINITIONS.bulk,
    ["bk", 0, 1.5, "Body mass / reserve allocation"],
    "bulk trait registered as bk in [0,1.5]",
  );
  console.log("trait exists: PASS");
}

function testTraitsAudit() {
  // Every T entry round-trips through founder state, child inheritance
  // keys, and export trait keys — bulk included, nothing silently dropped.
  const sim = new Simulation(cfg) as any;
  const o = sim.o[0];
  for (const [name, [key]] of Object.entries(TRAIT_DEFINITIONS) as any) {
    assert.equal(typeof o[key], "number", `founder carries ${name}/${key}`);
  }
  const baby = sim.child(o);
  for (const [, [key]] of Object.entries(TRAIT_DEFINITIONS) as any) {
    assert.equal(typeof baby[key], "number", `child carries ${key}`);
  }
  const exported = sim.out().living_creatures[0].traits;
  assert.equal(exported.bulk, o.bk, "export carries bulk equal to organism state");
  console.log("traits audit: PASS");
}

function testInheritance() {
  // bk=0 parents can still produce bk>0 children (additive mutation —
  // no multiplicative zero trap), and mutation stays in range.
  const sim = new Simulation({ ...cfg, mr: 1.0, ms: 0.5 }) as any;
  const o = sim.o[0];
  o.bk = 0;
  let escaped = false;
  for (let i = 0; i < 200; i++) {
    const baby = sim.child(o);
    assert.ok(baby.bk >= 0 && baby.bk <= 1.5, "child bk in range");
    if (baby.bk > 0) escaped = true;
  }
  assert.ok(escaped, "bk=0 line can evolve upward");
  console.log("inheritance: PASS");
}

function testBounds() {
  // At-bound parents never produce out-of-range children.
  const sim = new Simulation({ ...cfg, mr: 1.0, ms: 0.5 }) as any;
  for (const bk of [0, 1.5]) {
    const o = sim.o[0];
    o.bk = bk;
    for (let i = 0; i < 2500; i++) {
      const baby = sim.child(o);
      assert.ok(baby.bk >= 0 && baby.bk <= 1.5, `child of bk=${bk} in range`);
    }
  }
  console.log("bounds: PASS");
}

function testExportTruth() {
  // Export truthfulness (Lane 1→Lane 2 contract): living export carries
  // bulk equal to organism state; metrics tracks it. Proposed Lane 2
  // input norm is bk/1.5 (capability-trait convention); the mapping itself
  // is Lane 2's owned decision, never made here. The phenotype resolver
  // takes NO bulk input — family assignment cannot read mass until Lane 2
  // explicitly wires the channel (that rewire is a separate owned
  // decision, never a silent leak).
  const sim = new Simulation(cfg) as any;
  sim.o[0].bk = 1.2;
  const exported = sim.out().living_creatures[0].traits;
  assert.equal(exported.bulk, 1.2, "export bulk equals organism bk");
  const metrics = sim.metrics();
  assert.ok(metrics.traits.bulk, "metrics tracks bulk");
  assert.equal(metrics.traits.bulk.mean > 0, true, "bulk mean nonzero");
  console.log("export truth: PASS");
}

function testReserveIsolation() {
  // bk=0 keeps the legacy storage curve exactly; bk>0 raises the
  // penalty-free threshold (bounded reserve), never the rate.
  assert.equal(SCBK(150, 0), 0.000035 * 50 ** 2, "bk=0 storage cost is legacy SC");
  assert.equal(SCBK(150, 1.5), 0, "full bulk holds 150 penalty-free (threshold 220)");
  assert.equal(SCBK(250, 1.5), 0.000035 * 30 ** 2, "penalty above the raised threshold only");
  // Starvation buffer, same metabolism: the large morph outlasts the small.
  const starve = (bk: number, en: number): number => {
    const sim = new Simulation({ ...cfg, pop: 1 }) as any;
    const o = sim.o[0];
    o.bk = bk; o.en = en; o.sp = 1.0; o.me = 0.16; o.di = 0; o.bu = 0;
    let t = 0;
    while (sim.o.length && t < 30000) {
      for (let k = 0; k < 3; k++) sim.resources.stock[k]!.fill(0);
      sim.step();
      t++;
    }
    return t;
  };
  // Equal store: bulk never hurts survival — the reserve offsets its own drag.
  assert.ok(starve(1.5, 200) >= starve(0, 200), "equal store: large survives at least as long");
  // Full penalty-free capacity: small holds ~100, large ~220 — the bounded
  // reserve is real survival time, not just a number.
  const small = starve(0, 100), large = starve(1.5, 220);
  assert.ok(large > small * 1.3, `full reserve: large outlasts small (${large} vs ${small} ticks)`);
  // Dormant maintenance shares the reserve: same burden, less storage tax.
  const dormantOneTick = (bk: number): number => {
    const sim = new Simulation({ ...cfg, pop: 1 }) as any;
    for (let k = 0; k < 3; k++) sim.resources.stock[k]!.fill(0);
    const o = sim.o[0];
    o.bk = bk; o.en = 200; o.me = 0.16; o.sp = 1.0; o.activity = "dormant";
    const before = o.en;
    sim.step();
    return before - sim.o[0].en;
  };
  assert.ok(dormantOneTick(1.5) < dormantOneTick(0), "dormant large pays less storage tax");
  console.log("reserve isolation: PASS");
}

function testNoMovementPenalty() {
  // 0.25.0 experiment (PR #117): a continuous bulk movement tax suppressed
  // feeding and Waste throughput globally and removed protected niche
  // reachability. The reproduction-dominant placement must leave movement
  // cost EXACTLY independent of bulk.
  const oneTick = (bk: number): number => {
    const sim = new Simulation({ ...cfg, pop: 1 }) as any;
    for (let k = 0; k < 3; k++) sim.resources.stock[k]!.fill(0);
    const o = sim.o[0];
    o.bk = bk; o.en = 60; o.sp = 2.0; o.me = 0.16; o.di = 0; o.bu = 0; o.h = 0;
    const before = o.en;
    sim.step();
    return before - sim.o[0].en;
  };
  assert.equal(oneTick(0), oneTick(1.5), "movement and per-tick cost identical across bulk");
  console.log("no movement penalty: PASS");
}

function testReproCostExact() {
  // Effective reproduction threshold scales by exactly (1+BK_REPRO*BKN).
  assert.equal(RPBK(100, 0), 100, "bk=0 threshold unchanged");
  assert.equal(RPBK(100, 1.2), 196, "exact threshold ratio: 100*(1+1.2*0.8)");
  const reproduces = (bk: number, en: number): boolean => {
    const sim = new Simulation({ ...cfg, pop: 1 }) as any;
    const o = sim.o[0];
    o.bk = bk; o.en = en; o.rp = 100; o.matureAt = 0; o.readyAt = 0;
    sim.step();
    return sim.o.length > 1;
  };
  assert.equal(reproduces(0, 120), true, "small reproduces at en=120>=100");
  assert.equal(reproduces(1.2, 120), false, "large waits at en=120<196");
  assert.equal(reproduces(1.2, 210), true, "large reproduces at en=210>=196");
  console.log("repro cost exact: PASS");
}

function testMeOrthogonal() {
  // Matched pair differing ONLY in bk: at equal store (below both reserve
  // thresholds) the debit is byte-identical — bulk is metabolism-free.
  const oneTick = (bk: number): number => {
    const sim = new Simulation({ ...cfg, pop: 1 }) as any;
    for (let k = 0; k < 3; k++) sim.resources.stock[k]!.fill(0);
    const o = sim.o[0];
    o.bk = bk; o.en = 60; o.sp = 1.5; o.me = 0.3; o.di = 0; o.bu = 0; o.h = 0;
    const before = o.en;
    sim.step();
    return before - sim.o[0].en;
  };
  assert.equal(oneTick(0), oneTick(0.9), "identical debit at equal store");
  assert.equal(BKN({ bk: 0.9 } as any), 0.6, "norm helper exact");
  console.log("me orthogonal: PASS");
}

function testNoBonusLeak() {
  // Sensing, uptake take, yield, diet access, waste burden, and analysis
  // role are bit-identical across bk — size grants no other bonus.
  const setup = (bk: number): any => {
    const sim = new Simulation({ ...cfg, pop: 1 }) as any;
    for (let k = 0; k < 3; k++) sim.resources.stock[k]!.fill(0);
    const o = sim.o[0];
    o.x = 300; o.y = 300; o.h = 0; o.di = 0.5; o.ha = 0; o.se = 55;
    o.me = 0.16; o.sp = 1.0; o.bu = 0.2; o.to = 0.2; o.cu = 0.1;
    o.bk = bk; o.en = 60;
    sim.resources.deposit(0, 300, 300, 500, null, null);
    return { sim, o };
  };
  const a = setup(0), b = setup(1.5);
  assert.deepEqual(a.sim.resources.sense(a.o), b.sim.resources.sense(b.o), "sense identical");
  assert.equal(a.sim.resources.access(a.o, 0), b.sim.resources.access(b.o, 0), "access identical");
  const ma = a.sim.resources.consume(a.o, null), mb = b.sim.resources.consume(b.o, null);
  assert.equal(mb.amount, ma.amount, "identical take amounts");
  assert.equal(mb.gain, ma.gain, "identical gains");
  console.log("no bonus leak: PASS");
}

function testThresholdBoundary() {
  // en exactly at the raised threshold is unpenalized, stably across ticks.
  const th = 100 + 120 * 0.8;
  assert.equal(SCBK(th, 1.2), 0, "exactly at threshold: no penalty");
  assert.ok(SCBK(th + 0.001, 1.2) > 0, "above threshold: penalized");
  assert.equal(SCBK(100, 0), 0, "legacy boundary preserved");
  console.log("threshold boundary: PASS");
}

function testBkDeterminism() {
  // Same engine/seed/config replays exactly, including bk trajectories.
  const snapOf = (sim: any): string => JSON.stringify({
    t: sim.t, pop: sim.o.length,
    stock0: Array.from(sim.resources.stock[0] as Float32Array).map((v) => +v.toFixed(6)),
    orgs: sim.o.map((o: any) => [o.id, +o.x.toFixed(4), +o.y.toFixed(4), +o.en.toFixed(6), +o.bk.toFixed(6)]),
  });
  const run = (): string => {
    const sim = new Simulation(cfg) as any;
    for (let t = 0; t < 3000; t++) sim.step();
    return snapOf(sim);
  };
  assert.equal(run(), run(), "identical replay including bulk");
  console.log("determinism: PASS");
}

function testBkCheckpoint() {
  // Checkpoint with nonzero bk restores exactly and continues identically.
  // Cross-version note: 0.24.0→0.25.0 trajectory identity is neither
  // expected nor required — one extra mutation-stream draw per birth
  // shifts post-first-birth sequences by design (precedent: every trait
  // addition). Twin determinism within one engine is the pinned property.
  const sim = new Simulation(cfg) as any;
  for (const o of sim.o.slice(0, 5)) o.bk = 1.2;
  for (let t = 0; t < 2000; t++) sim.step();
  const snapOf = (s: any): string => JSON.stringify({
    t: s.t,
    orgs: s.o.map((o: any) => [o.id, +o.x.toFixed(4), +o.y.toFixed(4), +o.en.toFixed(6), +o.bk.toFixed(6)]),
  });
  const restored = restoreSimulationCheckpoint(JSON.parse(JSON.stringify(createSimulationCheckpoint(sim))));
  assert.equal(snapOf(restored), snapOf(sim), "checkpoint restores bk state exactly");
  for (let t = 0; t < 1000; t++) { sim.step(); restored.step(); }
  assert.equal(snapOf(restored), snapOf(sim), "restored continuation identical");
  console.log("checkpoint: PASS");
}

testTraitExists();
testTraitsAudit();
testInheritance();
testBounds();
testExportTruth();
testReserveIsolation();
testNoMovementPenalty();
testReproCostExact();
testMeOrthogonal();
testNoBonusLeak();
testThresholdBoundary();
testBkDeterminism();
testBkCheckpoint();

console.log("bulk validation: PASS (mechanism)");
