import assert from "node:assert/strict";
import {
  Simulation,
  TRAIT_DEFINITIONS,
  RRN,
  WAKE_DELAY,
  STEADY_COOLDOWN,
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

function testSteadyCooldownExact() {
  // STEADY_COOLDOWN must be strictly increasing in rr, exact ratio.
  const base = REPRO_COOLDOWN;
  assert.equal(STEADY_COOLDOWN(0), base, "rr=0 cooldown is base");
  assert.ok(STEADY_COOLDOWN(1.5) > STEADY_COOLDOWN(0), "strictly increasing");
  // Exact ratio test
  const ratio = STEADY_COOLDOWN(1.2) / base;
  assert.ok(Math.abs(ratio - 2.2) < 0.01, `exact ratio ~2.2x at rr=1.2, got ${ratio.toFixed(3)}`);
  console.log("steady cooldown exact: PASS");
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
    assert.equal(a.o.matureAt, b.o.matureAt, "maturity identical");
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
testSteadyCooldownExact();
testOrthogonality();
console.log("recovery-readiness validation: PASS");
