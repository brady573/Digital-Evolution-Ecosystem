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
console.log("cell-shape validation: PASS (plumbing)");
