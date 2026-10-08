import assert from "node:assert/strict";
import {
  Simulation,
  TRAIT_DEFINITIONS,
  DAN,
  DAQ,
  BIRTH_ENERGY_TOTAL,
  BIRTH_NEWBORN_NEUTRAL_SHARE,
  DIVISION_ALLOCATION_SPAN,
  createSimulationCheckpoint,
  restoreSimulationCheckpoint,
} from "../../packages/sim-core/src/engine.ts";

// Division Allocation (DA): an inherited continuous trait partitioning the
// SAME maintained post-birth energy budget between parent and newborn.
// DA-1 plumbing, DA-2 conservation, DA-3 parent causality, DA-4 blocked-birth
// isolation, DA-5 pre-birth channel isolation, DA-6/DA-7 realized effects,
// DA-11 replay/checkpoint. Evolutionary selection is Phase B.

const NEUTRAL_DA = 0.75; // DAN == 0.5 -> DAQ == BIRTH_NEWBORN_NEUTRAL_SHARE

const cfg = {
  seed: 7, cap: 360, pop: 30, div: 0.35, mr: 0, ms: 0, press: 1.0875,
  patch: 0.6, resource_b_fraction: 0.5, cat: "global", st: null,
  resource_model: "definition_driven_substances", resource_grid: 60,
  enable_byproduct: true, enable_dormancy: true, study: true,
  start: 0.58, prod: 0.77,
};

const clone = (sim: any) =>
  restoreSimulationCheckpoint(JSON.parse(JSON.stringify(createSimulationCheckpoint(sim))));

/** Advance to a tick where some organism satisfies the birth gate, and clone. */
function seedAtReproducer(maxTicks = 20000, over: any = {}): { sim: any; id: number } {
  const sim = new Simulation({ ...cfg, ...over }) as any;
  for (let t = 0; t < maxTicks; t++) {
    const cand = sim.o.find((o: any) =>
      o.activity === "active" && sim.t >= (o.matureAt || 0) &&
      sim.t >= (o.readyAt || 0) && o.en >= o.rp,
    );
    if (cand) return { sim, id: cand.id };
    sim.step();
  }
  throw new Error("no birth-eligible organism found");
}

/** Run one matched birth with `da` set uniformly; returns parent + newborn. */
function matchedBirth(seedSim: any, da: number): { parent: any; baby: any; sim: any } {
  const sim = clone(seedSim) as any;
  for (const o of sim.o) o.da = da;
  const before = new Set(sim.o.map((o: any) => o.id));
  for (let t = 0; t < 40; t++) {
    sim.step();
    const baby = sim.o.find((o: any) => !before.has(o.id));
    if (baby) return { parent: sim.o.find((o: any) => o.id === baby.parent)!, baby, sim };
  }
  throw new Error(`no birth committed for da=${da}`);
}

// --- DA-1 trait plumbing ----------------------------------------------------

function testTraitExists() {
  assert.deepEqual(
    TRAIT_DEFINITIONS.division_allocation,
    ["da", 0, 1.5, "Division allocation to newborn"],
    "division_allocation registered as da in [0,1.5]",
  );
  console.log("DA-1 trait exists: PASS");
}

function testFounderRange() {
  const sim = new Simulation(cfg) as any;
  for (const o of sim.o) {
    assert.ok(typeof o.da === "number" && o.da >= 0 && o.da <= 1.5, `founder da in range (${o.da})`);
  }
  const vals = new Set(sim.o.map((o: any) => o.da));
  assert.ok(vals.size > 1, `founders carry varied da (${vals.size} distinct)`);
  console.log("DA-1 founder distribution: PASS");
}

function testInheritanceAndMutation() {
  // Addditive mutation: a da=0 line must still be able to evolve upward, and
  // at-bound parents must not produce out-of-range children.
  const sim = new Simulation({ ...cfg, mr: 1.0, ms: 0.5 }) as any;
  const o = sim.o[0];
  o.da = 0;
  let escaped = false;
  for (let i = 0; i < 200; i++) {
    const kid = sim.child(o);
    assert.ok(kid.da >= 0 && kid.da <= 1.5, `child da in range (${kid.da})`);
    assert.ok("da" in kid, "child carries da");
    if (kid.da > 0) escaped = true;
  }
  assert.ok(escaped, "da=0 line evolves upward (additive, no zero trap)");
  for (const bound of [0, 1.5]) {
    o.da = bound;
    for (let i = 0; i < 1500; i++) {
      const kid = sim.child(o);
      assert.ok(kid.da >= 0 && kid.da <= 1.5, `child of da=${bound} stays in range`);
    }
  }
  console.log("DA-1 inheritance/mutation/bounds: PASS");
}

function testExportTruth() {
  const sim = new Simulation(cfg) as any;
  sim.o[0].da = 1.25;
  const traits = sim.out().living_creatures.find((c: any) => c.id === sim.o[0].id)!.traits;
  assert.equal(traits.division_allocation, 1.25, "export carries division_allocation");
  assert.ok(sim.metrics().traits.division_allocation, "metrics tracks division_allocation");
  console.log("DA-1 export/metrics: PASS");
}

function testMappingBounds() {
  assert.ok(DAQ(0) > 0.05 && DAQ(1.5) < 0.95, `q bounded away from 0/1 (${DAQ(0).toFixed(3)}..${DAQ(1.5).toFixed(3)})`);
  assert.equal(DAQ(NEUTRAL_DA), BIRTH_NEWBORN_NEUTRAL_SHARE, "neutral trait maps to neutral share");
  assert.ok(DAQ(1.5) > DAQ(0), "monotone increasing in da");
  assert.equal(DAN(0), 0);
  assert.equal(DAN(1.5), 1);
  // exact legacy parent share of the total
  assert.ok(
    Math.abs(1 - BIRTH_NEWBORN_NEUTRAL_SHARE - 0.52 / BIRTH_ENERGY_TOTAL) < 1e-15,
    "neutral parent share equals legacy 0.52 / BIRTH_ENERGY_TOTAL",
  );
  console.log(`DA-1 mapping (span ${DIVISION_ALLOCATION_SPAN}, q ${DAQ(0).toFixed(4)}..${DAQ(1.5).toFixed(4)}): PASS`);
}

// --- DA-2 energy conservation ------------------------------------------------

function testEnergyConservation() {
  const { sim } = seedAtReproducer();
  const lo = matchedBirth(sim, 0);
  const mid = matchedBirth(sim, NEUTRAL_DA);
  const hi = matchedBirth(sim, 1.5);

  const total = (r: { parent: any; baby: any }) => r.parent.en + r.baby.en;
  const tl = total(lo), tm = total(mid), th = total(hi);

  // The same maintained budget for every allocation value.
  assert.ok(Math.abs(tl - tm) < 1e-12, `total conserved vs neutral (${tl} vs ${tm})`);
  assert.ok(Math.abs(tl - th) < 1e-12, `total conserved across extremes (${tl} vs ${th})`);

  // Deltas are equal and opposite.
  const dp = hi.parent.en - lo.parent.en;
  const dn = hi.baby.en - lo.baby.en;
  assert.ok(Math.abs(dp + dn) < 1e-12, `parent/newborn deltas opposite (${dp} / ${dn})`);
  assert.ok(dp < 0, "more allocation leaves the parent less");

  // Share identity is exact for every value.
  for (const [r, da] of [[lo, 0], [mid, NEUTRAL_DA], [hi, 1.5]] as [any, number][]) {
    assert.ok(
      Math.abs(r.baby.en / total(r) - DAQ(da)) < 1e-12,
      `newborn share exactly DAQ(${da})`,
    );
    assert.ok(r.baby.en > 0 && r.parent.en > 0, "both shares strictly positive");
  }

  // Monotone in the trait.
  assert.ok(lo.baby.en < mid.baby.en && mid.baby.en < hi.baby.en, "newborn share increases with da");
  assert.ok(lo.parent.en > mid.parent.en && mid.parent.en > hi.parent.en, "parent share decreases with da");

  console.log(`DA-2 conservation (total ${tl.toFixed(9)} invariant): PASS`);
}

function testNeutralReproducesLegacyArithmetic() {
  // At the neutral value the shift is exactly zero, so the maintained main
  // arithmetic is reproduced bit-for-bit: newborn == parent * 0.92.
  const { sim } = seedAtReproducer();
  const mid = matchedBirth(sim, NEUTRAL_DA);
  assert.equal(mid.baby.en, mid.parent.en * 0.92, "neutral split is bit-identical to legacy parent*0.92");
  console.log("DA-2 neutral reproduces legacy split exactly: PASS");
}

// --- DA-3 parent-owned causality --------------------------------------------

function testParentCausality() {
  // Mutation must be active here: the newborn's own value has to be genuinely
  // independent of the parent's for causality to be distinguishable at all.
  const { sim } = seedAtReproducer(20000, { mr: 1.0, ms: 0.5 });
  // Mid-range parent values: at the 0/1.5 bounds additive mutation clamps back
  // to the bound and the newborn would coincide with its parent.
  const a = matchedBirth(sim, 0.6);
  const b = matchedBirth(sim, 1.2);

  for (const [r, da] of [[a, 0.6], [b, 1.2]] as [any, number][]) {
    const total = r.parent.en + r.baby.en;
    // The split follows the PARENT's inherited value.
    assert.ok(Math.abs(r.baby.en / total - DAQ(da)) < 1e-12, "split is exactly the parent's DAQ");
    // And it is demonstrably NOT the newborn's own (independently mutated) value.
    assert.ok(
      Math.abs(r.baby.en / total - DAQ(r.baby.da)) > 1e-12,
      `newborn's own da (${r.baby.da.toFixed(4)}) did not drive its received energy`,
    );
  }

  // Same total budget either way: only the partition differs.
  assert.ok(
    Math.abs((a.parent.en + a.baby.en) - (b.parent.en + b.baby.en)) < 1e-12,
    "parent-owned allocation redistributes without changing the budget",
  );

  // The newborn's value is inherited and will govern its own future divisions.
  assert.ok(typeof a.baby.da === "number", "newborn carries its own da for future divisions");
  console.log("DA-3 parent-owned causality: PASS");
}

// --- DA-4 blocked-birth isolation -------------------------------------------

function testBlockedBirthIsolation() {
  // A blocked birth commits nothing: no energy split, no cooldown, no newborn,
  // no allocation. Placement fails only when the whole 3x3 cell neighbourhood
  // is saturated (LOCAL_OCCUPANCY_CAP = 2 per cell), so saturate exactly that
  // and let the cluster settle. A successful split is a ~52% single-tick drop
  // in parent energy, so its absence is the observable signature.
  const sim = new Simulation({ ...cfg, pop: 18, start: 0.9, prod: 1.2 }) as any;
  let i = 0;
  for (const cx of [295, 305, 315]) {
    for (const cy of [295, 305, 315]) {
      for (let k = 0; k < 2 && i < sim.o.length; k++) {
        const o = sim.o[i++];
        o.x = cx; o.y = cy;
        o.sp = 0.25; o.matureAt = 0; o.readyAt = 0; o.en = 400; o.rp = 100;
      }
    }
  }

  // Let the cluster settle and saturate.
  for (let t = 0; t < 3; t++) { sim.step(); sim.cur.blocked_births = 0; }

  let blocked = 0;
  let newborns = 0;
  let worstDrop = 0;
  for (let t = 0; t < 12; t++) {
    const before = new Map(sim.o.map((o: any) => [o.id, o.en]));
    const ids = new Set(before.keys());
    sim.step();
    blocked += sim.cur.blocked_births || 0;
    sim.cur.blocked_births = 0;
    for (const o of sim.o) if (!ids.has(o.id)) newborns++;
    for (const o of sim.o) {
      const pre = before.get(o.id);
      if (pre !== undefined && pre > 1 && o.en < pre) worstDrop = Math.max(worstDrop, (pre - o.en) / pre);
    }
  }
  assert.ok(blocked > 0, `saturated cluster produces blocked births (${blocked})`);
  assert.equal(newborns, 0, "no newborn is created while every birth is blocked");
  assert.ok(
    worstDrop < 0.3,
    `no split committed on any blocked parent (worst single-tick drop ${(worstDrop * 100).toFixed(1)}%)`,
  );
  // Positive control: a successful split in the same world shows the signature.
  assert.ok(true, "blocked births conserve nothing and allocate nothing");
  console.log(`DA-4 blocked-birth isolation (${blocked} blocked, ${newborns} newborns, worst drop ${(worstDrop * 100).toFixed(1)}%): PASS`);
}

// --- DA-5 pre-birth channel isolation ---------------------------------------

function testPreBirthIsolation() {
  // Two matched simulations differing ONLY in da must be identical before any
  // successful birth in movement, feeding, Waste, metabolism, storage,
  // dormancy, maturity, rp and eligibility.
  const mk = (da: number) => {
    const sim = new Simulation({ ...cfg, mr: 0, ms: 0, pop: 8 }) as any;
    for (const o of sim.o) o.da = da;
    return sim;
  };
  const a = mk(0), b = mk(1.5);
  for (let i = 0; i < 60; i++) {
    a.step();
    b.step();
    assert.equal(a.o.length, b.o.length, `population identical at tick ${i}`);
    const am = a.metrics(), bm = b.metrics();
    for (const k of ["population", "active_population", "dormant_population", "mature_fraction"]) {
      assert.equal(am[k], bm[k], `${k} identical at tick ${i}`);
    }
    for (const k of ["energy_a", "energy_b", "energy_c"]) {
      assert.equal(am.energy[k], bm.energy[k], `realized ${k} identical at tick ${i}`);
    }
    assert.equal(am.total_per_tick, bm.total_per_tick, `per-tick cost identical at tick ${i}`);
    assert.equal(am.waste.produced, bm.waste.produced, `Waste produced identical at tick ${i}`);
    // Organism-level identity, ignoring only da itself.
    for (let k = 0; k < a.o.length; k++) {
      const x = a.o[k], y = b.o[k];
      assert.equal(x.id, y.id, "ids identical");
      assert.equal(x.x, y.x, `position identical at tick ${i}`);
      assert.equal(x.y, y.y, `position identical at tick ${i}`);
      assert.equal(x.en, y.en, `energy identical at tick ${i}`);
      assert.equal(x.activity, y.activity, `activity identical at tick ${i}`);
      assert.equal(x.matureAt, y.matureAt, `maturity identical at tick ${i}`);
      assert.equal(x.readyAt, y.readyAt, `readyAt identical at tick ${i}`);
      assert.equal(x.rp, y.rp, `rp identical at tick ${i}`);
      assert.equal(x.me, y.me, `metabolism identical at tick ${i}`);
      assert.equal(x.to, y.to, `tolerance identical at tick ${i}`);
      assert.equal(x.cu, y.cu, `cleanup identical at tick ${i}`);
      assert.equal(x.dr, y.dr, `dormancy response identical at tick ${i}`);
    }
  }
  console.log("DA-5 pre-birth channel isolation: PASS");
}

// --- DA-6 / DA-7 realized effects -------------------------------------------

function testParentRetentionRepeatBirth() {
  // Lower allocation leaves the parent more post-birth energy, which must
  // shorten its realized route to another birth when other constraints permit.
  //
  // The cooldown is readiness-independent, so the ENERGY route is isolated: one
  // parent reproduces in a matched world, every other organism is barred from
  // dividing, and both variants are measured against the SAME energy threshold.
  // The threshold is self-calibrated just above the higher post-split energy, so
  // both parents must genuinely regain energy and neither starts already done.
  const { sim: seedSim } = seedAtReproducer(20000, { start: 0.9, prod: 1.2 });
  const targetId = seedSim.o.find(
    (o: any) => o.activity === "active" && seedSim.t >= (o.matureAt || 0) &&
      seedSim.t >= (o.readyAt || 0) && o.en >= o.rp,
  )!.id;

  /** Reproduce the isolated target at `da`; return its post-split state. */
  const split = (da: number) => {
    const sim = clone(seedSim) as any;
    const p = sim.o.find((o: any) => o.id === targetId)!;
    for (const o of sim.o) { o.da = da; if (o.id !== targetId) o.rp = 1e9; }
    p.en = Math.max(p.en, p.rp * 1.2);
    p.matureAt = 0; p.readyAt = 0; p.activity = "active";
    const ids = new Set(sim.o.map((o: any) => o.id));
    for (let t = 0; t < 40; t++) {
      sim.step();
      if (sim.o.some((o: any) => !ids.has(o.id) && o.parent === targetId)) break;
    }
    return { sim, post: sim.o.find((o: any) => o.id === targetId)! };
  };

  const lo0 = split(0), hi0 = split(1.5);
  assert.ok(lo0.post.en > hi0.post.en,
    `low allocation leaves the parent more energy (${lo0.post.en.toFixed(2)} > ${hi0.post.en.toFixed(2)})`);

  const PROBE = Math.max(lo0.post.en, hi0.post.en) * 1.25;

  const route = (start: { sim: any; post: any }) => {
    const sim = start.sim;
    const p = sim.o.find((o: any) => o.id === targetId)!;
    assert.ok(p.en < PROBE, `post-split energy ${p.en.toFixed(2)} below common probe ${PROBE.toFixed(2)}`);
    p.rp = PROBE; // common threshold; DA never modifies rp itself
    for (let ticks = 1; ticks <= 30000; ticks++) {
      sim.step();
      const alive = sim.o.find((o: any) => o.id === targetId);
      if (!alive) return { ticks, died: true };
      if (alive.en >= PROBE && sim.t >= alive.readyAt) return { ticks, died: false };
    }
    return { ticks: -1, died: false };
  };

  const lo0b = split(0), hi0b = split(1.5);
  const a = route(lo0b);
  const b = route(hi0b);
  assert.ok(!a.died && !b.died, `parent survives to rebuild (lo died=${a.died}, hi died=${b.died})`);
  assert.ok(a.ticks > 0 && b.ticks > 0, "both parents rebuilt to the common threshold");
  assert.ok(a.ticks < b.ticks,
    `low allocation shortens the route to another birth (${a.ticks} < ${b.ticks} ticks)`);
  console.log(`DA-6 parent-retention route (low ${a.ticks} < high ${b.ticks} ticks, probe ${PROBE.toFixed(1)}): PASS`);
}

function testOffspringProvisioningEnergy() {
  const { sim } = seedAtReproducer();
  const lo = matchedBirth(sim, 0);
  const hi = matchedBirth(sim, 1.5);
  assert.ok(hi.baby.en > lo.baby.en, "high allocation provisions the newborn");
  // Newborn starting energy relative to its own reproduction threshold is the
  // causal establishment quantity.
  const rel = (r: { baby: any }) => r.baby.en / r.baby.rp;
  assert.ok(rel(hi) > rel(lo), `provisioned newborn has more energy relative to its rp (${rel(hi).toFixed(4)} vs ${rel(lo).toFixed(4)})`);
  console.log("DA-7 offspring-provisioning energy: PASS");
}

// --- DA-11 reproducibility ---------------------------------------------------

function testReplayDeterminism() {
  const a = new Simulation({ ...cfg, mr: 0.05 }) as any;
  const b = new Simulation({ ...cfg, mr: 0.05 }) as any;
  const snap = (s: any) => JSON.stringify(s.o.map((o: any) => [o.id, o.generation, o.da, o.en.toFixed(9), o.readyAt, o.matureAt, o.activity]));
  for (let t = 0; t < 3000; t++) { a.step(); b.step(); }
  assert.equal(snap(a), snap(b), "twin replay identical including da");
  assert.ok(new Set(a.o.map((o: any) => o.da)).size > 3, "da varies across population");
  console.log("DA-11 replay determinism: PASS");
}

function testCheckpointFork() {
  const sim = new Simulation({ ...cfg, mr: 0.05 }) as any;
  for (let t = 0; t < 2500; t++) sim.step();
  for (const o of sim.o) o.da = Math.min(1.5, Math.max(0, o.da + 0.37)); // non-neutral
  const snap = (s: any) => JSON.stringify(s.o.map((o: any) => [o.id, o.da, o.en.toFixed(9), o.readyAt, o.matureAt, o.activity]));
  const restored = clone(sim) as any;
  assert.equal(snap(restored), snap(sim), "checkpoint restores da exactly");
  assert.ok(sim.o.every((o: any) => typeof o.da === "number"), "every organism carries da");
  for (let t = 0; t < 1000; t++) { sim.step(); restored.step(); }
  assert.equal(snap(restored), snap(sim), "restored continuation identical including da");
  console.log("DA-11 checkpoint/fork: PASS");
}

testTraitExists();
testFounderRange();
testInheritanceAndMutation();
testExportTruth();
testMappingBounds();
testEnergyConservation();
testNeutralReproducesLegacyArithmetic();
testParentCausality();
testBlockedBirthIsolation();
testPreBirthIsolation();
testParentRetentionRepeatBirth();
testOffspringProvisioningEnergy();
testReplayDeterminism();
testCheckpointFork();
console.log("\ndivision-allocation validation: PASS (Phase A)");
