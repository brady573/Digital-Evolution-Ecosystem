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

const CU_RATE = 0.09, CU_ACTIVE = 0.6, CU_STANDING = 0.0015, PRESS = 1.0875;

/** First-N organisms teleported to a waste cell with fixed traits. */
function placeCohort(sim: any, x: number, y: number, cu: number[], lineageBase: number): void {
  let n = 0;
  for (const o of sim.o) {
    if (n >= cu.length) break;
    o.x = x; o.y = y; o.to = 0.5; o.cu = cu[n]!; o.en = 200; o.rp = 50; o.dr = 0;
    o.l = lineageBase + n;
    n++;
  }
  assert.equal(n, cu.length, "placed cleaner cohort");
}

function lineageRemoved(sim: any, lineage: number): number {
  const f = (sim.lineageInterval as Map<number, any>).get(lineage);
  return (f && f.wasteRemoved) || 0;
}

function testLowContentionParity() {
  // AC2C-3: an isolated cleaner receives its FULL current-process request
  // (CU_RATE x capability). Staging must not make a lone cleaner ineffective.
  const sim = new Simulation(wasteConfig(7)) as any;
  sim.resources.waste.deposit(105, 105, 0.5, null);
  placeCohort(sim, 105, 105, [1.0], 3000);
  sim.step();
  const expected = CU_RATE * (1.0 / 1.5);
  assert.equal(lineageRemoved(sim, 3000), expected, "isolated cleaner request fulfilled exactly");
  const f = (sim.lineageInterval as Map<number, any>).get(3000);
  assert.equal(f.cleanupExec, 1, "execution attributed on actual removal");
  console.log("low-contention parity: PASS");
}

function testSaturationBound() {
  // AC2C-4: at fixed local waste, aggregate removal is concave in cleaner
  // count and bounded — headcount cannot scale removal without bound.
  // Bars are structural (margins, not constants): per-capita and marginal
  // shares strictly decline, and the 16-cleaner total stays finite.
  const agg = (count: number): number => {
    const sim = new Simulation(wasteConfig(7)) as any;
    const waste = sim.resources.waste;
    waste.deposit(105, 105, waste.cap[waste.idx(105, 105)]!, null);
    placeCohort(sim, 105, 105, new Array(count).fill(0.3), 3100);
    sim.step();
    let s = 0;
    for (let k = 0; k < count; k++) s += lineageRemoved(sim, 3100 + k);
    return s;
  };
  const a2 = agg(2), a4 = agg(4), a8 = agg(8), a16 = agg(16);
  console.log(`saturation: 2=${a2.toFixed(4)} 4=${a4.toFixed(4)} 8=${a8.toFixed(4)} 16=${a16.toFixed(4)}`);
  assert.ok(a16 <= 0.26, "16-cleaner aggregate bounded (finite cell-local flux)");
  assert.ok(a16 / 16 < 0.9 * (a4 / 4), "per-capita share strictly declines");
  assert.ok(1.5 * ((a16 - a8) / 8) < (a8 - a4) / 4, "marginal share strictly diminishes");
  console.log("saturation bound: PASS");
}

function testPermutationInvariance() {
  // AC2C-5: oversubscribed allocation depends only on the request multiset,
  // never on organism order. Same requests in shuffled id order yield the
  // identical per-lineage actual multiset. Contention binds (stock < demand).
  const run = (cus: number[]): number[] => {
    const sim = new Simulation(wasteConfig(7)) as any;
    sim.resources.waste.deposit(105, 105, 0.1, null);
    placeCohort(sim, 105, 105, cus, 4000);
    sim.step();
    return cus.map((_, k) => lineageRemoved(sim, 4000 + k)).sort((a, b) => a - b);
  };
  const a = run([0.3, 0.6, 0.9, 1.5]);
  const b = run([1.5, 0.9, 0.6, 0.3]);
  assert.deepEqual(a, b, "allocation is order-blind under contention");
  assert.ok(a[3]! < 0.09 * (1.5 / 1.5), "largest request is capped below its full ask");
  console.log("permutation invariance: PASS");
}

function testClosureReconciliation() {
  // AC2C-6/7: allocated removal reconciles across field, interval, lineage;
  // active cost is exactly CU_ACTIVE x actual (standing separate).
  const sim = new Simulation(wasteConfig(7)) as any;
  sim.resources.waste.deposit(105, 105, 0.5, null);
  placeCohort(sim, 105, 105, [1.0, 1.0, 1.0, 1.0], 5000);
  const bioBefore: number = sim.resources.waste.bioRemoved;
  sim.step();
  const close = (a: number, b: number, label: string): void => {
    assert.ok(Math.abs(a - b) < 1e-9 * Math.max(1, Math.abs(a)), `${label} (${a} vs ${b})`);
  };
  let attributed = 0;
  for (const [, f] of sim.lineageInterval as Map<number, any>) attributed += f.wasteRemoved || 0;
  const fieldDelta: number = sim.resources.waste.bioRemoved - bioBefore;
  close(attributed, fieldDelta, "lineage sum reconciles to field delta");
  close(sim.cur.removed_w || 0, fieldDelta, "interval removal reconciles to field delta");
  for (let k = 0; k < 4; k++) {
    const f = (sim.lineageInterval as Map<number, any>).get(5000 + k);
    const actual: number = f.wasteRemoved;
    close(
      f.cleanupEnergy,
      (CU_STANDING * 1.0) * PRESS + (CU_ACTIVE * actual) * PRESS,
      `active cost exact on actual for cleaner ${k}`,
    );
    assert.equal(f.cleanupExec, 1, `execution counted for cleaner ${k}`);
  }
  console.log("closure reconciliation: PASS");
}

function testSameTickDepositOrder() {
  // Same-tick production deposits join NEXT tick's state: with the whole
  // population sharing one cell and depositing all tick long, the last
  // organism reads exactly the first organism's burden. (cu=0 isolates the
  // deposit effect from cleanup entirely.)
  const sim = new Simulation(wasteConfig(7)) as any;
  sim.resources.waste.deposit(105, 105, 0.3, null);
  for (const o of sim.o) { o.x = 105; o.y = 105; o.to = 0.5; o.cu = 0; o.en = 200; o.rp = 50; o.dr = 0; }
  const byId = [...sim.o].sort((a: any, b: any) => a.id - b.id);
  const firstL = byId[0].l, lastL = byId[byId.length - 1].l;
  sim.step();
  const b0 = burdenOf(sim, firstL), b1 = burdenOf(sim, lastL);
  assert.ok(b0 > 0 && b1 > 0, "shared cell burdens the cohort");
  assert.equal(b1, b0, "last reader sees the first reader's burden (deposits deferred)");
  console.log("same-tick deposit order: PASS");
}

function testDormantEligibility() {
  // Dormant cleaners submit no intents: no removal, no executions.
  // (Fresh-sim first tick never evaluates wake checks for ids 0..29, since
  // (1+id)%40 != 0, so dormancy holds through the measurement.)
  const sim = new Simulation(wasteConfig(7)) as any;
  sim.resources.waste.deposit(105, 105, 0.5, null);
  let n = 0;
  for (const o of sim.o) {
    if (n >= 2) break;
    o.x = 105; o.y = 105; o.to = 0.5; o.cu = 1.0; o.en = 200;
    o.activity = "dormant"; o.dormantSince = 0;
    o.l = 6000 + n;
    n++;
  }
  sim.step();
  for (let k = 0; k < 2; k++) {
    assert.equal(lineageRemoved(sim, 6000 + k), 0, `dormant cleaner ${k} removes nothing`);
    const f = (sim.lineageInterval as Map<number, any>).get(6000 + k);
    assert.equal((f && f.cleanupExec) || 0, 0, `dormant cleaner ${k} executes nothing`);
  }
  console.log("dormant eligibility: PASS");
}

testLowContentionParity();
testSaturationBound();
testPermutationInvariance();
testClosureReconciliation();
testSameTickDepositOrder();
testDormantEligibility();

const stratConfig = wasteConfig;

function meanEnergy(sim: any): number {
  return sim.o.reduce((t: number, o: any) => t + o.en, 0) / Math.max(1, sim.o.length);
}

function testCapableVsIncapable() {
  // AC2C-8: cleanup is selectively useful in a real Waste-rich regime.
  // Matched exact-twin forks from an evolved 10k world (clone preserves
  // state+RNG continuity): capable (cu=0.8) contains waste and sustains
  // population+energy; incapable (cu=0) drowns. CI-measured (seed
  // 24681357): A pop 627 vs B 313, meanEn 43.24 vs 33.25, wasteFrac
  // 0.0048 vs 0.7221. Bars are structural with wide margins, not digits.
  const sim = new Simulation(stratConfig(24681357)) as any;
  for (let t = 0; t < 10000; t++) sim.step();
  const cap = sim.clone(), inc = sim.clone();
  for (const o of cap.o) o.cu = 0.8;
  for (const o of inc.o) o.cu = 0;
  for (let t = 0; t < 5000; t++) { cap.step(); inc.step(); }
  const capFrac = cap.resources.waste.totals().fraction;
  const incFrac = inc.resources.waste.totals().fraction;
  console.log(`capable: pop ${cap.o.length} en ${meanEnergy(cap).toFixed(2)} waste ${capFrac.toFixed(4)} | incapable: pop ${inc.o.length} en ${meanEnergy(inc).toFixed(2)} waste ${incFrac.toFixed(4)}`);
  assert.ok(cap.o.length > 1.5 * inc.o.length, "capable fork sustains markedly more population");
  assert.ok(meanEnergy(cap) > 1.15 * meanEnergy(inc), "capable fork holds markedly more energy");
  assert.ok(capFrac < 0.1 && incFrac > 0.3, "capable contains waste, incapable drowns");
  console.log("capable vs incapable: PASS");
}

function testToleranceDistinction() {
  // Tolerance and cleanup are SEPARATE strategies: tolerance mitigates
  // burden without removing anything; cleanup removes mass from the field.
  // Single-tick mechanistic cohorts, same cell, same snapshot.
  const setup = (): any => {
    const sim = new Simulation(stratConfig(7)) as any;
    sim.resources.waste.deposit(105, 105, 0.4, null);
    const cohorts: any[][] = [[], [], []];
    let n = 0;
    for (const o of sim.o) {
      if (n >= 9) break;
      o.x = 105; o.y = 105; o.en = 200; o.rp = 50; o.dr = 0;
      const k = n % 3;
      if (k === 0) { o.to = 1.2; o.cu = 0; }
      if (k === 1) { o.to = 0; o.cu = 1.2; }
      if (k === 2) { o.to = 0; o.cu = 0; }
      o.l = 7000 + n;
      cohorts[k]!.push(o.l);
      n++;
    }
    return { sim, cohorts };
  };
  const burdenSum = (sim: any, ls: number[]): number =>
    ls.reduce((s, l) => s + burdenOf(sim, l), 0);
  const removedSum = (sim: any, ls: number[]): number =>
    ls.reduce((s, l) => s + lineageRemoved(sim, l), 0);
  const { sim, cohorts } = setup();
  sim.step();
  const tolRemoved = removedSum(sim, cohorts[0]!);
  const cleanRemoved = removedSum(sim, cohorts[1]!);
  const noneRemoved = removedSum(sim, cohorts[2]!);
  assert.equal(tolRemoved, 0, "tolerance removes nothing");
  assert.equal(noneRemoved, 0, "no-trait control removes nothing");
  assert.ok(cleanRemoved > 0, "cleanup removes field mass");
  assert.ok(
    burdenSum(sim, cohorts[0]!) < burdenSum(sim, cohorts[2]!),
    "tolerance mitigates burden without removing",
  );
  console.log("tolerance distinction: PASS");
}

function testDisabledEconomy() {
  // Opportunity control: with the economy disabled, the outer gate skips
  // the waste block for both forks, so capability is fully inert — the
  // capable fork must NOT differ at all. (This also proves the Task-5
  // advantage flows through the waste path, not the cu override itself:
  // identical trajectories when the path is off.)
  const setup = (cu: number): any => {
    const sim = new Simulation(stratConfig(7)) as any;
    sim.resources.enabledWaste = false;
    for (const o of sim.o) { o.to = 0; o.cu = cu; o.en = 200; o.rp = 50; o.dr = 0; }
    return sim;
  };
  const cap = setup(0.8), inc = setup(0);
  cap.step(); inc.step();
  assert.equal(cap.resources.waste.bioRemoved, 0, "disabled economy removes nothing (capable)");
  assert.equal(inc.resources.waste.bioRemoved, 0, "disabled economy removes nothing (incapable)");
  assert.equal(meanEnergy(cap), meanEnergy(inc), "capability without opportunity is fully inert");
  console.log("disabled economy: PASS");
}

testCapableVsIncapable();
testToleranceDistinction();
testDisabledEconomy();
console.log("waste-cleanup validation: PASS (mechanism fixtures)");
