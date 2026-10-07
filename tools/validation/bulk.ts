import assert from "node:assert/strict";
import { Simulation, TRAIT_DEFINITIONS } from "../../packages/sim-core/src/engine.ts";

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

testTraitExists();
testTraitsAudit();
testInheritance();
testBounds();
testExportTruth();
console.log("bulk validation: PASS (plumbing)");
