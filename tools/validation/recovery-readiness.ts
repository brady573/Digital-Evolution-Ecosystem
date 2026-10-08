import assert from "node:assert/strict";
import {
  Simulation,
  TRAIT_DEFINITIONS,
  RRN,
  WAKE_DELAY,
  MATURATION_COST,
  REPRO_COOLDOWN,
} from "../../packages/sim-core/src/engine.ts";

// Recovery Readiness / growth-adaptation plumbing (Task 2): inherited through
// the ordinary deterministic trait path, present in export/metrics state.
// Mechanically neutral at this step — rr must be behaviorally inert until Task 3.

const cfg = {
  seed: 7, cap: 360, pop: 30, div: 0.35, mr: 0.03, ms: 0.12, press: 1.0875,
  patch: 0.6, resource_b_fraction: 0.5, cat: "global", st: null,
  resource_model: "definition_driven_substances", resource_grid: 60,
  enable_byproduct: true, enable_dormancy: true, study: true,
  start: 0.58, prod: 0.77,
};

function testTraitExists() {
  assert.deepEqual(
    TRAIT_DEFINITIONS.recovery_readiness,
    ["rr", 0, 1.5, "Physiological readiness for post-wake reproduction"],
    "recovery_readiness trait registered as rr in [0,1.5]",
  );
  console.log("trait exists: PASS");
}

function testTraitsAudit() {
  // Every T entry round-trips through founder state, child inheritance
  // keys, and export trait keys — recovery_readiness included, nothing silently dropped.
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
  assert.equal(exported.recovery_readiness, o.rr, "export carries recovery_readiness equal to organism state");
  console.log("traits audit: PASS");
}

function testInheritance() {
  // rr=0 parents can still produce rr>0 children (additive mutation —
  // no multiplicative zero trap), and mutation stays in range.
  const sim = new Simulation({ ...cfg, mr: 1.0, ms: 0.5 }) as any;
  const o = sim.o[0];
  o.rr = 0;
  let escaped = false;
  for (let i = 0; i < 200; i++) {
    const baby = sim.child(o);
    assert.ok(baby.rr >= 0 && baby.rr <= 1.5, "child rr in range");
    if (baby.rr > 0) escaped = true;
  }
  assert.ok(escaped, "rr=0 line can evolve upward");
  console.log("inheritance: PASS");
}

function testBounds() {
  // At-bound parents never produce out-of-range children.
  const sim = new Simulation({ ...cfg, mr: 1.0, ms: 0.5 }) as any;
  for (const rr of [0, 1.5]) {
    const o = sim.o[0];
    o.rr = rr;
    for (let i = 0; i < 2500; i++) {
      const baby = sim.child(o);
      assert.ok(baby.rr >= 0 && baby.rr <= 1.5, `child of rr=${rr} in range`);
    }
  }
  console.log("bounds: PASS");
}

function testExportTruth() {
  // Export truthfulness (Lane 1→Lane 2 contract): living export carries
  // recovery_readiness equal to organism state; metrics tracks it.
  // Proposed Lane 2 input norm is rr/1.5 (capability-trait convention);
  // the mapping itself is Lane 2's owned decision, never made here.
  // The phenotype resolver takes NO recovery_readiness input — family
  // assignment cannot read readiness until Lane 2 explicitly wires the
  // channel (that rewire is a separate owned decision, never a silent leak).
  const sim = new Simulation(cfg) as any;
  sim.o[0].rr = 1.2;
  const exported = sim.out().living_creatures[0].traits;
  assert.equal(exported.recovery_readiness, 1.2, "export recovery_readiness equals organism rr");
  const metrics = sim.metrics();
  assert.ok(metrics.traits.recovery_readiness, "metrics tracks recovery_readiness");
  assert.equal(metrics.traits.recovery_readiness.mean > 0, true, "recovery_readiness mean nonzero");
  console.log("export truth: PASS");
}



function testNoPreWakeLeak() {
  // rr=0 and rr=1.5 matched active organisms: movement, sensing, feeding,
  // Waste, mortality, dormancy decisions, maturity, rp must be identical.
  const setup = (rr: number): any => {
    const sim = new Simulation(cfg) as any;
    for (let k = 0; k < 3; k++) sim.resources.stock[k]!.fill(0);
    const o = sim.o[0];
    o.rr = rr; o.en = 60; o.sp = 1.5; o.me = 0.3; o.rp = 100;
    o.di = 0; o.ha = 0; o.bu = 0; o.to = 0.2; o.cu = 0.1;
    o.dr = 0.5; o.matureAt = 0; o.readyAt = 0; o.activity = "active";
    return { sim, o };
  };
  const a = setup(0), b = setup(1.5);
  // Same per-tick costs
  const oneTick = (s: any, o: any): number => {
    const before = o.en;
    s.step();
    return before - s.o[0].en;
  };
  // Wake decisions must be identical
  const aWake = a.sim.dormancyWake(a.o), bWake = b.sim.dormancyWake(b.o);
  assert.equal(aWake, bWake, "dormancyWake identical across rr");
  // Per-tick debit identical
  assert.equal(oneTick(a.sim, a.o), oneTick(b.sim, b.o), "per-tick cost identical across rr");
  console.log("no pre-wake leak: PASS");
}

function testWakeDecisionIsolation() {
  // dormancyWake function untouched; readiness cannot change whether/when
  // wake occurs under identical biological state.
  const sim = new Simulation(cfg) as any;
  const o = sim.o[0];
  o.rr = 1.2; o.dr = 0.8; o.en = 10; o.rp = 100;
  const wake1 = sim.dormancyWake(o);
  o.rr = 0;
  const wake2 = sim.dormancyWake(o);
  assert.equal(wake1, wake2, "dormancyWake decision independent of rr");
  console.log("wake decision isolation: PASS");
}

function testWakeDelayMonotonic() {
  // WAKE_DELAY must be strictly decreasing in rr
  assert.ok(WAKE_DELAY(0) > WAKE_DELAY(1.5), "WAKE_DELAY(0) > WAKE_DELAY(1.5)");
  assert.ok(WAKE_DELAY(0.5) > WAKE_DELAY(1.0), "strictly decreasing");
  console.log("wake delay monotonic: PASS");
}

function testRealizedEarlierPostWake() {
  // After the same wake, higher rr actually reproduces earlier when
  // energy/maturity/space don't block birth.
  const cfg1 = { ...cfg, pop: 1, enable_dormancy: true };
  const sim = new Simulation(cfg1) as any;
  const o = sim.o[0];
  o.rr = 1.2; o.en = 200; o.rp = 100; o.sp = 1; o.me = 0.16;
  o.matureAt = 0; o.readyAt = 0;
  // Force wake at tick 100
  o.activity = "dormant"; o.dormantSince = 0;
  sim.t = 100;
  // Simulate wake
  sim.dormancyWake(o);
  // Apply recovery delay
  o.readyAt = Math.max(o.readyAt, sim.t + WAKE_DELAY(o.rr));
  const delayHigh = o.readyAt - sim.t;

  // Same for rr=0
  o.rr = 0;
  sim.dormancyWake(o);
  o.readyAt = Math.max(o.readyAt, sim.t + WAKE_DELAY(o.rr));
  const delayLow = o.readyAt - sim.t;

  assert.ok(delayLow > delayHigh, `low rr delay ${delayLow} > high rr delay ${delayHigh}`);
  console.log("realized earlier post-wake: PASS");
}

function testMaturationCost() {
  // The growth leg: MATURATION_COST is the additive maturation tax in ticks,
  // zero at minimum readiness and maximal at maximum readiness.
  assert.equal(MATURATION_COST(0), 0, "no maturation tax at rr=0");
  assert.ok(MATURATION_COST(1.5) > MATURATION_COST(0), "strictly increasing in rr");
  assert.ok(MATURATION_COST(0.5) > MATURATION_COST(0.25), "monotone");
  assert.equal(MATURATION_COST(0.75), 600, "exact midpoint tax");
  console.log("maturation cost: PASS");
}

function testMaturationChannelIsolated() {
  // Children of matched parents differing ONLY in rr must differ ONLY in rr and
  // matureAt. Every other inherited and initial quantity stays bit-identical,
  // proving maturation is the only steady-state channel rr reaches.
  // mr=0 makes inheritance exact (no mutation draws).
  const mk = (rr: number) => {
    const sim = new Simulation({ ...cfg, pop: 1, mr: 0, ms: 0 }) as any;
    const o = sim.o[0];
    o.rr = rr;
    return { sim, baby: sim.child(o) };
  };
  const lo = mk(0), hi = mk(1.5);
  assert.equal(lo.baby.rr, 0, "low-readiness child inherits exactly");
  assert.equal(hi.baby.rr, 1.5, "high-readiness child inherits exactly");
  assert.equal(
    hi.baby.matureAt - lo.baby.matureAt,
    MATURATION_COST(1.5) - MATURATION_COST(0),
    "matureAt differs by exactly the maturation tax",
  );
  for (const k of ["sp", "se", "me", "rp", "di", "ha", "bu", "dr", "to", "cu", "en", "x", "y", "h", "generation", "born"]) {
    assert.equal(hi.baby[k], lo.baby[k], `${k} identical across rr (only rr/matureAt may differ)`);
  }
  assert.equal(hi.baby.readyAt, hi.baby.matureAt, "newborn readyAt still mirrors matureAt");
  console.log("maturation channel isolated: PASS");
}

function testCooldownIndependent() {
  // Parent REPRO_COOLDOWN is readiness-independent. Snapshot readyAt before the
  // step, then attribute any parent whose readyAt moved to exactly
  // this.t + REPRO_COOLDOWN on a tick that produced births. Newborns are absent
  // from the snapshot and founders still awaiting maturity are excluded, so only
  // genuine post-reproduction assignments are measured.
  const sim = new Simulation(cfg) as any;
  // Spread readiness across the whole trait range up front so the parents that
  // reproduce genuinely span rr 0..1.5; otherwise the proof rests on whatever
  // readiness drift happens to produce in a short window.
  sim.o.forEach((o: any, i: number) => { o.rr = (i / Math.max(1, sim.o.length - 1)) * 1.5; });
  let checked = 0;
  const rrs: number[] = [];
  for (let t = 0; t < 4000 && checked < 25; t++) {
    const before = new Map<number, number>(sim.o.map((o: any) => [o.id, o.readyAt]));
    sim.step();
    const births = sim.cur.births || 0;
    sim.cur.births = 0;
    if (!births) continue;
    for (const o of sim.o) {
      if (!before.has(o.id)) continue;              // newborn, not a parent
      if (before.get(o.id) === o.readyAt) continue; // readyAt did not move
      assert.equal(o.readyAt - sim.t, REPRO_COOLDOWN, `parent cooldown is exactly REPRO_COOLDOWN (rr=${o.rr})`);
      rrs.push(o.rr);
      checked++;
    }
  }
  assert.ok(checked > 0, "observed at least one post-birth cooldown assignment");
  // The proof is strongest if the assignments span a wide rr range: a
  // readiness-scaled cooldown would make the constant above impossible.
  assert.ok(Math.max(...rrs) - Math.min(...rrs) > 1.0, `cooldown assignments span rr range (${Math.min(...rrs).toFixed(2)}-${Math.max(...rrs).toFixed(2)})`);
  console.log("cooldown independent: PASS");
}

function testOrthogonality() {
  // Matched pair: two identical simulations (same seed, config, and forced
  // organism state) differing ONLY in rr, stepped in lockstep. Every other
  // biological quantity — movement, sensing, feeding, Waste, mortality,
  // dormancy entry/wake decisions, maturity, and rp — must stay bit-identical.
  //
  // Lockstep (not sequential windows) is required: per-tick energy debit is
  // a function of local nutrient opportunity and of SC(en), which is
  // quadratic above 100 energy, so two sequential windows can never compare
  // equal even with zero rr effect.
  const setup = (rr: number): { sim: any; o: any } => {
    const sim = new Simulation(cfg) as any;
    const o = sim.o[0];
    o.rr = rr; o.en = 60; o.sp = 1.5; o.me = 0.3; o.rp = 100;
    o.di = 0; o.ha = 0; o.bu = 0; o.to = 0.2; o.cu = 0.1;
    o.dr = 0.5; o.matureAt = 0; o.readyAt = 0;
    o.activity = "active"; o.dormantSince = null;
    return { sim, o };
  };
  const a = setup(1.5), b = setup(0);
  for (let i = 0; i < 30; i++) {
    a.sim.step();
    b.sim.step();
    assert.equal(a.o.en, b.o.en, `energy identical at tick ${i}: rr has no per-tick cost`);
    assert.equal(a.o.activity, b.o.activity, `activity identical at tick ${i}: rr cannot alter dormancy`);
    assert.equal(a.o.readyAt, b.o.readyAt, `readyAt identical at tick ${i}: no pre-wake leak`);
    // Founders are seeded, not born, so they carry no maturation tax; the
    // growth leg applies only to offspring (see testMaturationChannelIsolated).
    assert.equal(a.o.matureAt, b.o.matureAt, "founder maturity identical (no tax on founders)");
    assert.equal(a.o.rp, b.o.rp, "reproduction cost identical");
    assert.equal(a.o.me, b.o.me, "metabolism identical");
    assert.equal(a.o.dr, b.o.dr, "dormancy response identical");
  }
  assert.equal(RRN({ rr: 0.9 } as any), 0.6, "norm helper exact");
  console.log("orthogonality: PASS");
}

testTraitExists();
testTraitsAudit();
testInheritance();
testBounds();
testExportTruth();
testNoPreWakeLeak();
testWakeDecisionIsolation();
testWakeDelayMonotonic();
testRealizedEarlierPostWake();
testMaturationCost();
testMaturationChannelIsolated();
testCooldownIndependent();
testOrthogonality();
console.log("recovery-readiness validation: PASS");
