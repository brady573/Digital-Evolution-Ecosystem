import assert from "node:assert/strict";
import { Simulation, TRAIT_DEFINITIONS } from "../../packages/sim-core/src/engine.ts";

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

testTraitExists();
testTraitsAudit();
testInheritance();
testBounds();
testExportTruth();
console.log("recovery-readiness validation: PASS (plumbing)");
