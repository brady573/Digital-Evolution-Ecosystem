import assert from "node:assert/strict";
import { Simulation } from "../../packages/sim-core/src/engine.ts";

/**
 * Foundation Slice 2C: staged cell-local waste cleanup fixtures.
 * Grows task by task in handoff validation order (§6.1 mechanism first).
 */

function wasteConfig(seed: number): any {
  return {
    seed, start: 0.58, prod: 0.77, cap: 360, pop: 30, div: 0.35, mr: 0.03,
    ms: 0.12, press: 1.0875, patch: 0.6, resource_b_fraction: 0.5, cat: "global", st: null,
    resource_model: "definition_driven_substances", resource_grid: 60,
    enable_byproduct: true, enable_dormancy: true, study: true,
  };
}

/** Six same-cell cleaners, identical tolerance, unique lineages, rich energy. */
function placeCleaners(sim: any, x: number, y: number, count: number): void {
  const waste = sim.resources.waste;
  const i = waste.idx(x, y);
  waste.deposit(x, y, 6 * 0.06 * 4, null);
  let n = 0;
  for (const o of sim.o) {
    if (n >= count) break;
    o.x = x; o.y = y; o.to = 0.5; o.cu = 1.0; o.en = 200; o.rp = 50; o.dr = 0;
    o.l = 1000 + n;
    n++;
  }
  assert.equal(n, count, "placed cleaner cohort");
}

function burdenOf(sim: any, lineage: number): number {
  const f = (sim.lineageInterval as Map<number, any>).get(lineage);
  return f ? f.burdenEnergy || 0 : 0;
}

function testSharedExposure() {
  // AC2C-1: same-cell active cleaners with identical tolerance read the
  // SAME pre-cleanup burden — no cleaner free-rides on earlier cleanup
  // within the tick. Under immediate per-organism removal, later cleaners
  // see a depleted field and read strictly lower burden.
  const sim = new Simulation(wasteConfig(7)) as any;
  placeCleaners(sim, 105, 105, 6);
  sim.step();
  const burdens = [0, 1, 2, 3, 4, 5].map((k) => burdenOf(sim, 1000 + k));
  assert.ok(burdens.every((b) => b > 0), `all cleaners burdened (${burdens.map((b) => b.toFixed(4)).join(",")})`);
  assert.ok(burdens.every((b) => b === burdens[0]), `identical burden from shared snapshot (${burdens.map((b) => b.toFixed(4)).join(",")})`);
  console.log("shared exposure: PASS");
}

function testNoWasteNoOp() {
  // AC2C-2 + standing-cost half of AC2C-7: cleanup requires LOCAL waste.
  // A capable cleaner in a waste-free cell removes nothing and pays no
  // active cost (standing still applies); with the economy disabled on a
  // fork, nothing is removed and nothing is charged at all.
  const sim = new Simulation(wasteConfig(7)) as any;
  sim.resources.waste.deposit(505, 505, 5, null);
  let n = 0;
  for (const o of sim.o) {
    if (n >= 3) break;
    o.x = 105; o.y = 105; o.cu = 1.0; o.en = 200; o.rp = 50; o.dr = 0;
    o.l = 2000 + n;
    n++;
  }
  sim.step();
  const waste = sim.resources.waste;
  let removed = 0, exec = 0;
  for (let k = 0; k < 3; k++) {
    const f = (sim.lineageInterval as Map<number, any>).get(2000 + k);
    removed += (f && f.wasteRemoved) || 0;
    exec += (f && f.cleanupExec) || 0;
  }
  assert.equal(removed, 0, "no removal without local opportunity");
  assert.equal(exec, 0, "no executions without local opportunity");
  const f0 = (sim.lineageInterval as Map<number, any>).get(2000);
  assert.ok((f0.cleanupEnergy || 0) > 0, "standing capability cost still charged");
  // Disabled-economy fork: full no-op through the staged path.
  const off = new Simulation(wasteConfig(7)) as any;
  off.resources.enabledWaste = false;
  for (const o of off.o.slice(0, 3)) { o.cu = 1.0; o.en = 200; o.rp = 50; o.dr = 0; }
  for (let t = 0; t < 5; t++) off.step();
  assert.equal(off.resources.waste.bioRemoved, 0, "disabled economy removes nothing");
  assert.equal(off.cur.cleanup_exec || 0, 0, "disabled economy executes nothing");
  console.log("no-waste no-op: PASS");
}

testSharedExposure();
testNoWasteNoOp();
console.log("waste-cleanup validation: PASS (mechanism fixtures)");
