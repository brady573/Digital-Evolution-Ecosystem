/**
 * Slice 1 interference-biology validation (Task 1+; this file grows by task).
 *
 * Task 1: two independent inheritable traits — `secretion` (code `in`) and
 * `resistance` (code `re`), range [0, 1.5], present on founders and newborns,
 * mutating through the generic mut() path with no coupling between them.
 *
 * Run: npx tsx tools/validation/interference.ts
 */
import assert from "node:assert/strict";
import type { EngineConfig } from "../../packages/contracts/src/index.ts";
import {
  Simulation,
  TRAIT_DEFINITIONS,
  createSimulationCheckpoint,
  restoreSimulationCheckpoint,
} from "../../packages/sim-core/src/engine.ts";

function config(seed: number, overrides: Partial<EngineConfig> = {}): EngineConfig {
  return {
    seed, start: 0.58, prod: 0.77, cap: 360, pop: 30, div: 0.35, mr: 0.03,
    ms: 0.12, press: 1.0875, patch: 0.6, resource_b_fraction: 0.5, cat: "global", st: null,
    resource_model: "definition_driven_substances", resource_grid: 60,
    enable_byproduct: true, enable_dormancy: true, study: true,
    ...overrides,
  };
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
    syy += (ys[i]! - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}

function testTwoIndependentTraitsExist() {
  // Both traits are registered with the exact codes and range.
  for (const [name, code] of [["secretion", "in"], ["resistance", "re"]] as const) {
    const def = (TRAIT_DEFINITIONS as Record<string, [string, number, number, string]>)[name];
    assert.ok(def, `TRAIT_DEFINITIONS must contain ${name}`);
    assert.equal(def[0], code, `${name} code must be ${code}`);
    assert.deepEqual([def[1], def[2]], [0, 1.5], `${name} range must be [0, 1.5]`);
  }

  // Present on every founder, in range, and varying (independent H01 salts).
  const sim = new Simulation(config(24681357));
  const founders = (sim as any).o as any[];
  assert.ok(founders.length > 0, "founders must exist");
  const ins: number[] = [];
  const res: number[] = [];
  for (const o of founders) {
    assert.ok(Number.isFinite(o.in), `founder ${o.id} must carry a finite in`);
    assert.ok(Number.isFinite(o.re), `founder ${o.id} must carry a finite re`);
    assert.ok(o.in >= 0 && o.in <= 1.5, `founder in in [0, 1.5], got ${o.in}`);
    assert.ok(o.re >= 0 && o.re <= 1.5, `founder re in [0, 1.5], got ${o.re}`);
    ins.push(o.in);
    res.push(o.re);
  }
  const spread = (a: number[]) => Math.max(...a) - Math.min(...a);
  assert.ok(spread(ins) > 0.01, `founder in must vary, spread=${spread(ins)}`);
  assert.ok(spread(res) > 0.01, `founder re must vary, spread=${spread(res)}`);

  // High `in` does not imply high `re`: independent initialization salts must
  // not couple the two traits across the founder population.
  const r = pearson(ins, res);
  assert.ok(Math.abs(r) < 0.7, `founder in/re must be uncorrelated, |r|=${Math.abs(r)}`);

  // Present on newborns via child().
  for (let i = 0; i < 5; i++) {
    const baby = (sim as any).child(founders[i % founders.length]) as any;
    assert.ok(Number.isFinite(baby.in) && baby.in >= 0 && baby.in <= 1.5, `newborn in range, got ${baby.in}`);
    assert.ok(Number.isFinite(baby.re) && baby.re >= 0 && baby.re <= 1.5, `newborn re range, got ${baby.re}`);
  }
  console.log("testTwoIndependentTraitsExist: PASS");
}

function testTraitsParticipateInMutationSystem() {
  // A birth cohort under strong mutation shows both traits varying, without
  // coupling: both traits travel the generic mut() path, not a special case.
  const sim = new Simulation(config(13579111, { mr: 0.5, ms: 0.5 }));
  const founders = (sim as any).o as any[];
  const ins: number[] = [];
  const res: number[] = [];
  for (let i = 0; i < 400; i++) {
    const baby = (sim as any).child(founders[i % founders.length]) as any;
    ins.push(baby.in);
    res.push(baby.re);
  }
  const std = (a: number[]) => {
    const m = a.reduce((x, y) => x + y, 0) / a.length;
    return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length);
  };
  assert.ok(std(ins) > 0.01, `cohort in must vary under mutation, std=${std(ins)}`);
  assert.ok(std(res) > 0.01, `cohort re must vary under mutation, std=${std(res)}`);
  const r = pearson(ins, res);
  assert.ok(Math.abs(r) < 0.5, `cohort in/re must not be coupled, |r|=${Math.abs(r)}`);

  // Both traits still clamp to [0, 1.5] after mutation.
  assert.ok(ins.every((v) => v >= 0 && v <= 1.5), "mutated in stays in [0, 1.5]");
  assert.ok(res.every((v) => v >= 0 && v <= 1.5), "mutated re stays in [0, 1.5]");
  console.log("testTraitsParticipateInMutationSystem: PASS");
}

testTwoIndependentTraitsExist();
testTraitsParticipateInMutationSystem();

// --- Task 2: InhibitorField with closed mass accounting. ---

function inhibitorStockSum(inh: any): number {
  const st = inh.stock as Float32Array;
  let s = 0;
  for (let i = 0; i < st.length; i++) s += st[i]!;
  return s;
}

function testFieldDepositionDiffusionDecay() {
  const sim = new Simulation(config(918273645));
  const rs = (sim as any).resources as any;
  assert.ok(rs.inhibitor, "RS must construct rs.inhibitor (InhibitorField)");
  const inh = rs.inhibitor;
  for (const m of ["deposit", "fractionAt", "amountAt", "stepInhibitor", "totals", "accounting", "clone", "export"]) {
    assert.equal(typeof inh[m], "function", `rs.inhibitor must expose ${m}()`);
  }
  const perCell = (inh.cap as Float32Array)[0]!;
  assert.ok(perCell > 0, "inhibitor per-cell cap must be positive");

  // Deposit below cap at cell (0,0) center (cell size 10 world units).
  const N = perCell * 0.5;
  const iv: any = {};
  const added = inh.deposit(5, 5, N, iv);
  assert.ok(Math.abs(added - N) < 1e-9, `below-cap deposit fully accepted, added=${added} N=${N}`);
  assert.ok(Math.abs(iv.secreted_i - added) < 1e-12, "deposit counted in interval secreted_i");
  assert.ok(Math.abs(inhibitorStockSum(inh) - N) < 1e-6, "stock sum equals deposited mass");
  assert.ok(Math.abs(inh.fractionAt(5, 5) - N / perCell) < 1e-6, "fractionAt reflects deposited fraction");
  const center = inh.idx(5, 5);
  assert.equal(center, 0, "cell (0,0) center maps to index 0");

  // Decay-only ticks: no t multiple of 100, so stepInhibitor never diffuses.
  const div: any = {};
  for (let t = 1; t <= 60; t++) inh.stepInhibitor(t, div);
  const after = inhibitorStockSum(inh);
  assert.ok(after < N, "decay-only ticks reduce stock");
  assert.ok(after > 0, "decay does not annihilate stock over 60 ticks");
  assert.ok(Math.abs((inh.stock as Float32Array)[1]!) < 1e-12, "neighbor cell gains nothing without diffusion");
  assert.ok(
    Math.abs(N - after - (inh.decayed as number)) < 1e-6,
    `decay identity: N - final (${N - after}) must equal decayed (${inh.decayed})`,
  );
  assert.ok(
    Math.abs((div.decayed_i as number) - (inh.decayed as number)) < 1e-9,
    "interval decayed_i tracks the decayed total",
  );

  // Diffusion moves mass to the neighbor cell.
  const beforeDiffuse = (inh.stock as Float32Array)[center]!;
  inh.diffuseOne();
  assert.ok((inh.stock as Float32Array)[1]! > 0, "neighbor cell gains mass only via diffusion");
  assert.ok((inh.stock as Float32Array)[center]! < beforeDiffuse, "source cell loses mass via diffusion");

  // Closed accounting against the independent stock sum.
  const a = inh.accounting();
  assert.ok(typeof a.identity === "string" && a.identity.length > 0, "accounting carries an identity string");
  for (const term of ["produced", "decayed", "clamp", "saturated", "final", "residual"]) {
    assert.ok(
      a.identity.toLowerCase().includes(term),
      `accounting identity must name ${term}: ${a.identity}`,
    );
  }
  // Closed stock identity (WasteField semantics: produced counts accepted
  // mass only, so saturated loss is reported separately, not subtracted here):
  // produced - decayed + clamp - final ≈ 0. In this test saturated loss is
  // separately asserted zero above, matching the brief's closed form.
  assert.ok((a.saturated_loss as number) === 0, "no saturated loss in the below-cap test");
  const residual =
    (a.produced as number) -
    (a.decayed as number) +
    (a.clamp_adjustment as number) -
    inhibitorStockSum(inh);
  assert.ok(Math.abs(residual) < 1e-4, `produced - decayed + clamp - final ≈ 0, got ${residual}`);
  assert.ok(Math.abs(a.residual as number) < 1e-4, `accounting residual ≈ 0, got ${a.residual}`);
  console.log("testFieldDepositionDiffusionDecay: PASS");
}

function testSaturationLossIsExplicit() {
  const sim = new Simulation(config(1122334455));
  const inh = (sim as any).resources.inhibitor;
  assert.ok(inh, "RS must construct rs.inhibitor (InhibitorField)");
  const perCell = (inh.cap as Float32Array)[0]!;
  const over = perCell * 10;
  const iv: any = {};
  const added = inh.deposit(5, 5, over, iv);
  const lost = over - added;
  assert.ok(added > 0 && added <= perCell + 1e-9, `deposit clamps at per-cell cap, added=${added}`);
  assert.ok(lost > 0, "a surplus exists when overfilling one cell");
  assert.ok(Math.abs((inh.discarded as number) - lost) < 1e-6, "surplus counted in discarded");
  assert.ok(Math.abs((iv.saturated_i as number) - lost) < 1e-6, "surplus counted in interval saturated_i");
  assert.ok(Math.abs((iv.secreted_i as number) - added) < 1e-6, "accepted mass counted in interval secreted_i");
  // Generated = deposited + saturated loss: nothing vanishes.
  assert.ok(
    Math.abs((inh.produced as number) + (inh.discarded as number) - over) < 1e-6,
    "produced + discarded equals attempted generation",
  );
  const a = inh.accounting();
  assert.ok(Math.abs((a.saturated_loss as number) - lost) < 1e-6, "accounting reports the saturated loss");
  assert.ok(
    Math.abs(
      (a.produced as number) -
        (a.decayed as number) +
        (a.clamp_adjustment as number) -
        inhibitorStockSum(inh),
    ) < 1e-4,
    "accounting still closes after saturation",
  );
  console.log("testSaturationLossIsExplicit: PASS");
}

function testDiffusionConservesMass() {
  const sim = new Simulation(config(5566778899));
  const inh = (sim as any).resources.inhibitor;
  assert.ok(inh, "RS must construct rs.inhibitor (InhibitorField)");
  const perCell = (inh.cap as Float32Array)[0]!;
  inh.deposit(5, 5, perCell * 0.4, null);
  const before = inhibitorStockSum(inh);
  const clampBefore = inh.clampAdj as number;
  inh.diffuseOne();
  const after = inhibitorStockSum(inh);
  const clampDelta = (inh.clampAdj as number) - clampBefore;
  assert.ok(
    Math.abs(after - before - clampDelta) < 1e-9,
    `total stock change (${after - before}) must equal clamp adjustment only (${clampDelta})`,
  );
  assert.ok(Math.abs(after - before) < 1e-6, `below-cap spike diffusion conserves mass, drift=${after - before}`);
  console.log("testDiffusionConservesMass: PASS");
}

function testInhibitorCheckpointAndClone() {
  const sim = new Simulation(config(42424242)) as any;
  const inh = sim.resources.inhibitor;
  assert.ok(inh, "RS must construct rs.inhibitor (InhibitorField)");
  const perCell = (inh.cap as Float32Array)[0]!;
  inh.deposit(5, 5, perCell * 0.3, null);
  const sumBefore = inhibitorStockSum(inh);

  // Checkpoint codec round-trip under the "inhibitor-field" tag.
  const cp = createSimulationCheckpoint(sim);
  const revived = restoreSimulationCheckpoint(JSON.parse(JSON.stringify(cp))) as any;
  const rInh = revived.resources.inhibitor;
  assert.ok(rInh, "checkpoint restores rs.inhibitor");
  assert.ok(
    Math.abs(inhibitorStockSum(rInh) - sumBefore) < 1e-6,
    "restored inhibitor stock matches",
  );
  assert.ok(
    Math.abs(rInh.produced - inh.produced) < 1e-9 && Math.abs(rInh.discarded - inh.discarded) < 1e-9,
    "restored inhibitor counters match",
  );

  // Clone independence: the fork must not share field state.
  const fork = sim.clone();
  assert.ok(fork.resources.inhibitor, "clone carries rs.inhibitor");
  assert.ok(
    fork.resources.inhibitor !== sim.resources.inhibitor &&
      fork.resources.inhibitor.stock !== sim.resources.inhibitor.stock,
    "clone must not share inhibitor field state",
  );
  fork.resources.inhibitor.deposit(5, 5, perCell * 0.1, null);
  assert.ok(
    Math.abs(inhibitorStockSum(fork.resources.inhibitor) - (sumBefore + perCell * 0.1)) < 1e-6,
    "fork deposit lands in the fork",
  );
  assert.ok(
    Math.abs(inhibitorStockSum(sim.resources.inhibitor) - sumBefore) < 1e-9,
    "original untouched by fork deposit",
  );
  console.log("testInhibitorCheckpointAndClone: PASS");
}

testFieldDepositionDiffusionDecay();
testSaturationLossIsExplicit();
testDiffusionConservesMass();
testInhibitorCheckpointAndClone();
console.log("interference validation (task 2): PASS");

// --- Task 3: costly secretion, costly resistance, exposure, suppression. ---

// White-box single-organism harness: drop all founders but one so interval
// and lineage accounting attribute to exactly one organism. Founder ids are
// sequential from 1 regardless of seed; cell (5,5) center maps to index 0.
function isolateFirst(sim: any): any {
  const o = (sim as any).o[0] as any;
  (sim as any).o = [o];
  return o;
}

function zeroStocks(sim: any): void {
  const rs = (sim as any).resources as any;
  for (let k = 0; k < 3; k++) {
    ((rs.stock as Float32Array[])[k] as Float32Array).fill(0);
    (rs.totalStock as number[])[k] = 0;
  }
}

function setCellStock(sim: any, kind: number, x: number, y: number, mass: number): number {
  const rs = (sim as any).resources as any;
  const i = (rs.idx as (x: number, y: number) => number)(x, y);
  const arr = (rs.stock as Float32Array[])[kind] as Float32Array;
  const before = arr[i]!;
  arr[i] = mass;
  (rs.totalStock as number[])[kind]! += mass - before;
  return i;
}

function inhSum(sim: any): number {
  const st = (sim as any).resources.inhibitor.stock as Float32Array;
  let s = 0;
  for (let i = 0; i < st.length; i++) s += st[i]!;
  return s;
}

// Existing physiology cost shapes, replicated to isolate the NEW secretion
// term in the organism energy delta (movement + base + diet + size + byproduct).
function otherPhysiology(o: any, press: number): number {
  const pc = 0.8 * o.me + 0.0055 / o.me;
  const mc = 0.01 * o.sp * o.sp + 0.004 * o.sp ** 4;
  const dc = 0.008 * o.di * o.di;
  const sc = 0.000035 * Math.max(0, o.en - 100) ** 2;
  const buc = 0.01 * (o.bu || 0) * (o.bu || 0);
  return (pc + mc + dc + sc + buc) * press;
}

function testSecretionCostsAndDeposits() {
  const sim = new Simulation(config(777001)) as any;
  zeroStocks(sim);
  const o = isolateFirst(sim);
  o.x = 5; o.y = 5; o.h = 0; o.sp = 0.3; o.en = 200;
  o.in = 1.0; o.re = 0; o.to = 0; o.cu = 0; o.bu = 0.2;
  const press = sim.c.press as number;
  const enBefore = o.en as number;
  const other = otherPhysiology(o, press);
  const prodBefore = sim.resources.inhibitor.produced as number;
  sim.step();
  const cur = sim.cur as any;
  assert.ok(cur.secretion_energy > 0, "secretion costs energy while active");
  assert.ok(cur.secreted_i > 0, "active secretor deposits inhibitor mass");
  assert.ok(
    Math.abs((sim.resources.inhibitor.produced as number) - prodBefore - cur.secreted_i) < 1e-6,
    "field gains exactly the recorded secreted_i",
  );
  assert.ok(
    Math.abs(inhSum(sim) - cur.secreted_i) < 1e-6,
    "fresh-field stock sum equals secreted mass (no decay/diffusion on tick 1)",
  );
  // No food, no waste, no resistance: energy delta is other physiology plus
  // exactly the recorded secretion cost.
  assert.ok(
    Math.abs(enBefore - (o.en as number) - (other + cur.secretion_energy)) < 1e-9,
    "organism loses energy exactly equal to recorded secretion_energy plus known costs",
  );
  const flows = sim.readIntervalFlows();
  assert.ok(
    Math.abs(flows.totals.secretion_energy - cur.secretion_energy) < 1e-12,
    "lineage secretion_energy reconciles to the interval total",
  );
  assert.ok(
    Math.abs(flows.totals.secreted_i - cur.secreted_i) < 1e-12,
    "lineage secreted_i reconciles to the interval total",
  );

  // Zero-energy organisms deposit nothing: no free production.
  const sim2 = new Simulation(config(777002)) as any;
  zeroStocks(sim2);
  const z = isolateFirst(sim2);
  z.x = 5; z.y = 5; z.h = 0; z.sp = 0.3; z.en = 0;
  z.in = 1.5; z.re = 0; z.to = 0; z.cu = 0;
  sim2.step();
  assert.equal(sim2.cur.secreted_i, 0, "broke organism secretes nothing");
  assert.equal(sim2.cur.secretion_energy, 0, "broke organism pays no secretion cost");
  assert.equal(sim2.resources.inhibitor.produced, 0, "no free production enters the field");
  console.log("testSecretionCostsAndDeposits: PASS");
}

function testNoProducerImmunity() {
  // Same seed, same cell, same dose, same resistance: the only difference
  // is the secretion trait. The secretor must be exposed under the same
  // rule — it additionally feels its own exhaust, proving no exemption.
  const mk = (ino: number): any => {
    const sim = new Simulation(config(888001)) as any;
    zeroStocks(sim);
    const o = isolateFirst(sim);
    o.x = 5; o.y = 5; o.h = 0; o.sp = 0.3; o.en = 200;
    o.in = ino; o.re = 0.5; o.to = 0; o.cu = 0;
    const perCell = (sim.resources.inhibitor.cap as Float32Array)[0]!;
    sim.resources.inhibitor.deposit(5, 5, perCell * 0.4, null);
    return sim;
  };
  const simS = mk(1.5);
  const simN = mk(0);
  simS.step();
  simN.step();
  const effS = simS.cur.exposure_i as number;
  const effN = simN.cur.exposure_i as number;
  assert.ok(effN > 0, "non-secretor placed at a dosed cell is exposed");
  assert.ok(effS > effN, "secretor feels its own exhaust too: no producer immunity");
  assert.ok(Number.isFinite(effS) && Number.isFinite(effN), "exposures are finite");
  const flowsN = simN.readIntervalFlows();
  assert.ok(
    Math.abs(flowsN.totals.exposure_i - effN) < 1e-12,
    "lineage exposure_i reconciles to the interval total",
  );
  console.log("testNoProducerImmunity: PASS");
}

function testSuppressionAppliesToABC() {
  // Same dose, same resistance, one substrate stocked per run: the realized
  // take must fall under one coherent rule, and suppressed mass must never
  // leave the stock (stock delta + suppressed = full take).
  const PHI = 0.5;
  const keys = [
    { c: "consumed_a", s: "suppressed_a", e: "suppressed_ea", g: "energy_a" },
    { c: "consumed_b", s: "suppressed_b", e: "suppressed_eb", g: "energy_b" },
    { c: "consumed_c", s: "suppressed_c", e: "suppressed_ec", g: "energy_c" },
  ];
  const runFor = (setup: (o: any) => void, k: number): number => {
    const sim = new Simulation(config(999001)) as any;
    zeroStocks(sim);
    const o = isolateFirst(sim);
    o.x = 5; o.y = 5; o.h = 0; o.sp = 0.3; o.en = 200;
    o.in = 0; o.re = 0; o.to = 0; o.cu = 0;
    setup(o);
    const rs = sim.resources as any;
    const idx = rs.idx(5, 5) as number;
    const cap = (rs.cap[k] as Float32Array)[idx]!;
    const S0 = cap * 0.8;
    setCellStock(sim, k, 5, 5, S0);
    const perCell = (rs.inhibitor.cap as Float32Array)[0]!;
    rs.inhibitor.deposit(5, 5, PHI * perCell, null);
    sim.step();
    const S1 = (rs.stock[k] as Float32Array)[idx]!;
    const cur = sim.cur as any;
    const actual = S0 - S1;
    assert.ok(
      Math.abs(actual - (cur[keys[k]!.c] as number)) < 1e-6,
      `substrate ${k}: stock delta reconciles to ${keys[k]!.c}`,
    );
    const full = Math.min(S0, (rs.uptake as number) * (0.55 + 0.45 * Math.min(1, Math.max(0, S0 / cap))));
    const supp = cur[keys[k]!.s] as number;
    assert.ok(supp > 0 && actual < full, `substrate ${k}: exposure suppresses the take`);
    assert.ok(
      Math.abs(actual + supp - full) < 1e-6,
      `substrate ${k}: suppressed mass stays in stock (actual + suppressed = full take)`,
    );
    // Forgone energy accrues at exactly the realized gain rate. Tolerance is
    // 1e-4, not 1e-9: `actual` comes from Float32 field stock, so its
    // rounding (~1e-7 relative) dominates the rate comparison; the engine
    // values forgone from f64 supp/take exactly.
    const gain = cur[keys[k]!.g] as number;
    const forgone = cur[keys[k]!.e] as number;
    assert.ok(
      Math.abs(forgone / supp - gain / actual) < 1e-4,
      `substrate ${k}: suppressed energy is forgone at the realized rate`,
    );
    return actual / full;
  };
  const fA = runFor((o) => { o.di = -1.5; o.ha = -1.5; o.bu = 0; }, 0);
  const fB = runFor((o) => { o.di = 1.5; o.ha = 1.5; o.bu = 0; }, 1);
  const fC = runFor((o) => { o.di = 0; o.ha = 0; o.bu = 1.5; }, 2);
  for (const [name, f] of [["A", fA], ["B", fB], ["C", fC]] as const) {
    assert.ok(f > 0 && f <= 1, `substrate ${name}: factor stays in (0, 1], got ${f}`);
  }
  // Tolerance is 1e-5: the factor divides a Float32 stock delta, so the
  // comparison carries field precision (~1e-6 at these stock levels), not
  // f64 precision. A different rule per substrate would diverge by O(1).
  assert.ok(Math.abs(fA - fB) < 1e-5 && Math.abs(fB - fC) < 1e-5, `one coherent rule across A/B/C: ${fA} ${fB} ${fC}`);
  console.log("testSuppressionAppliesToABC: PASS");
}

function testSuppressionMonotonicBounded() {
  // Fixed food, rising dose: the realized fraction of the full take must
  // never improve, must stay in (0, 1], and must equal 1 at zero exposure.
  const fs = [0, 0.1, 0.25, 0.5].map((m) => {
    const sim = new Simulation(config(666001)) as any;
    zeroStocks(sim);
    const o = isolateFirst(sim);
    o.x = 5; o.y = 5; o.h = 0; o.sp = 0.3; o.en = 200;
    o.in = 0; o.re = 0; o.to = 0; o.cu = 0; o.di = -1.5; o.ha = -1.5; o.bu = 0;
    const rs = sim.resources as any;
    const idx = rs.idx(5, 5) as number;
    const cap = (rs.cap[0] as Float32Array)[idx]!;
    const S0 = cap * 0.8;
    setCellStock(sim, 0, 5, 5, S0);
    const perCell = (rs.inhibitor.cap as Float32Array)[0]!;
    if (m > 0) rs.inhibitor.deposit(5, 5, m * perCell, null);
    sim.step();
    const S1 = (rs.stock[0] as Float32Array)[idx]!;
    const actual = S0 - S1;
    const full = Math.min(S0, (rs.uptake as number) * (0.55 + 0.45 * Math.min(1, Math.max(0, S0 / cap))));
    return { f: actual / full, supp: (sim.cur as any).suppressed_a as number };
  });
  assert.ok(Math.abs(fs[0]!.f - 1) < 1e-6, `factor is 1 at zero exposure, got ${fs[0]!.f}`);
  assert.equal(fs[0]!.supp, 0, "nothing suppressed at zero exposure");
  for (let j = 1; j < fs.length; j++) {
    assert.ok(fs[j]!.f > 0 && fs[j]!.f <= 1, `dose ${j}: factor stays in (0, 1], got ${fs[j]!.f}`);
    assert.ok(fs[j]!.f < fs[j - 1]!.f, `greater effective exposure never improves acquisition (${fs[j - 1]!.f} -> ${fs[j]!.f})`);
  }
  console.log("testSuppressionMonotonicBounded: PASS");
}

function testResistanceMitigatesButCosts() {
  // Same dose, rising resistance: effective exposure must fall but stay
  // positive (mitigates, never immunizes), and resistance must cost energy
  // even where there is nothing to resist.
  const exposures: number[] = [];
  for (const re of [0, 0.75, 1.5]) {
    const sim = new Simulation(config(555001)) as any;
    zeroStocks(sim);
    const o = isolateFirst(sim);
    o.x = 5; o.y = 5; o.h = 0; o.sp = 0.3; o.en = 200;
    o.in = 0; o.re = re; o.to = 0; o.cu = 0;
    const perCell = (sim.resources.inhibitor.cap as Float32Array)[0]!;
    sim.resources.inhibitor.deposit(5, 5, perCell * 0.4, null);
    sim.step();
    exposures.push((sim.cur as any).exposure_i as number);
    if (re > 0) assert.ok((sim.cur as any).resistance_energy > 0, `re=${re}: resistance costs energy`);
    else assert.equal((sim.cur as any).resistance_energy, 0, "re=0 pays no resistance cost");
  }
  assert.ok(exposures[0]! > exposures[1]!, `higher re lowers exposure (${exposures[0]} -> ${exposures[1]})`);
  assert.ok(exposures[1]! > exposures[2]!, `higher re lowers exposure (${exposures[1]} -> ${exposures[2]})`);
  assert.ok(exposures[2]! > 0, "max resistance still leaves positive exposure: no immunity");

  const clean = new Simulation(config(555002)) as any;
  zeroStocks(clean);
  const c = isolateFirst(clean);
  c.x = 5; c.y = 5; c.h = 0; c.sp = 0.3; c.en = 200;
  c.in = 0; c.re = 1.0; c.to = 0; c.cu = 0;
  clean.step();
  assert.ok((clean.cur as any).resistance_energy > 0, "resistance costs even in a clean field while active");
  assert.equal((clean.cur as any).exposure_i, 0, "no exposure in a clean field");
  assert.equal((clean.cur as any).secreted_i, 0, "no secretion without the secretion trait");
  console.log("testResistanceMitigatesButCosts: PASS");
}

function testDormancyInteraction() {
  // Founder id 5: dormancy checks ((t+5)%40) first fire at t=35, so ticks
  // 1..25 run check-free — dormancy persists trivially while the field
  // still decays (inhibitor bucket 0 processes at t=20).
  const sim = new Simulation(config(444001)) as any;
  zeroStocks(sim);
  const o = ((sim as any).o as any[]).find((f: any) => f.id === 5);
  assert.ok(o, "founder id 5 exists");
  (sim as any).o = [o];
  o.x = 5; o.y = 5; o.h = 0; o.sp = 0.3; o.en = 200;
  o.in = 1.5; o.re = 1.5; o.to = 0; o.cu = 0; o.di = -1.5; o.ha = -1.5;
  o.activity = "dormant";
  o.dormantSince = 0;
  const rs = sim.resources as any;
  const idx = rs.idx(5, 5) as number;
  const capA = (rs.cap[0] as Float32Array)[idx]!;
  setCellStock(sim, 0, 5, 5, capA * 0.8);
  const perCell = (rs.inhibitor.cap as Float32Array)[0]!;
  rs.inhibitor.deposit(5, 5, perCell * 0.4, null);
  const inhBefore = inhSum(sim);
  for (let t = 0; t < 25; t++) sim.step();
  assert.equal(o.activity, "dormant", "dormant organism stays dormant");
  assert.equal((sim.cur as any).secreted_i, 0, "dormant organisms secrete nothing");
  assert.equal((sim.cur as any).secretion_energy, 0, "dormant organisms pay no secretion cost");
  assert.equal((sim.cur as any).resistance_energy, 0, "dormant organisms pay no resistance cost");
  assert.equal((sim.cur as any).consumed_a, 0, "dormant organisms acquire nothing");
  assert.ok(inhSum(sim) < inhBefore, "field keeps evolving (decay) while dormant");
  assert.ok((rs.inhibitor.decayed as number) > 0, "decay is recorded while dormant");
  // Wake resumes the full physiology: exposure, secretion, acquisition.
  o.activity = "active";
  sim.step();
  assert.ok((sim.cur as any).exposure_i > 0, "exposure resumes on wake");
  assert.ok((sim.cur as any).secreted_i > 0, "secretion resumes on wake");
  assert.ok((sim.cur as any).consumed_a > 0, "acquisition resumes on wake");
  console.log("testDormancyInteraction: PASS");
}

function testSnapshotMeansAndOutTraits() {
  const sim = new Simulation(config(31337)) as any;
  for (let t = 0; t < 300; t++) sim.step();
  const m = sim.metrics();
  assert.ok(m.inhibitor && Number.isFinite(m.inhibitor.fraction), "metrics carries inhibitor totals");
  assert.ok((m.inhibitor.produced as number) > 0, "founders secrete over 300 ticks");
  const snap = sim.observerSnapshot(m, sim.cur);
  for (const k of ["secretion_mean", "resistance_mean", "inhibitor_fraction", "inhibitor_exposed_share"]) {
    assert.ok(Number.isFinite(snap[k]), `observerSnapshot carries finite ${k}`);
  }
  assert.ok(snap.secretion_mean > 0 && snap.resistance_mean > 0, "trait means positive");
  assert.ok(snap.inhibitor_fraction > 0 && snap.inhibitor_exposed_share > 0, "secretion registers in the field");
  const out = sim.out();
  assert.equal(out.interpretation_model.trait_diversity, "mean normalized standard deviation across twelve evolvable traits", "trait-count prose fixed (12)");
  const cr = out.living_creatures[0];
  assert.ok(Number.isFinite(cr.traits.secretion) && Number.isFinite(cr.traits.resistance), "out() living-creature traits include secretion/resistance");
  console.log("testSnapshotMeansAndOutTraits: PASS");
}

testSecretionCostsAndDeposits();
testNoProducerImmunity();
testSuppressionAppliesToABC();
testSuppressionMonotonicBounded();
testResistanceMitigatesButCosts();
testDormancyInteraction();
testSnapshotMeansAndOutTraits();
console.log("interference validation (task 3): PASS");

// --- Task 4: Versioning, checkpoint schema 0.5, persistence contract. ---

import { ENGINE_VERSION } from "../../packages/sim-core/src/version.ts";
import {
  CHECKPOINT_MIGRATION_RULES,
  CURRENT_SCHEMA,
  SUPPORTED_SCHEMAS,
  validateCheckpoint,
} from "../../packages/contracts/src/index.ts";
import {
  CHECKPOINT_SCHEMA_VERSION as SESSION_SCHEMA_VERSION,
  UniverseSession,
} from "../../packages/sim-runtime/src/session.ts";

function testCheckpointRoundTripWithInterference() {
  // Version anchors first: these fail before the Task 4 bump, giving the
  // required red run (version/schema mismatch).
  assert.equal(ENGINE_VERSION, "0.23.0", "engine version bumped for interference persistence");
  assert.equal(CURRENT_SCHEMA, "0.5", "current checkpoint schema is 0.5");
  assert.ok(
    (SUPPORTED_SCHEMAS as readonly string[]).includes("0.5"),
    "0.5 is a supported schema",
  );

  const sim = new Simulation(config(20260501)) as any;
  // Pin nonzero interference traits white-box (Task-3 pattern) so the
  // round-trip has nonzero trait state to preserve.
  sim.o[0].in = 1.0;
  sim.o[0].re = 0.5;
  for (let t = 0; t < 60; t++) sim.step();
  const stockBefore = inhSum(sim);
  assert.ok(stockBefore > 0, `field holds secreted mass before checkpoint, stock=${stockBefore}`);
  const liveIn = (sim.o as any[]).map((o) => o.in as number);
  assert.ok(liveIn.some((v) => v > 0), "nonzero secretion traits present before checkpoint");

  const cp = JSON.parse(JSON.stringify(createSimulationCheckpoint(sim)));
  const revived = restoreSimulationCheckpoint(cp) as any;
  assert.ok(revived.resources.inhibitor, "checkpoint restores rs.inhibitor");
  assert.ok(
    Math.abs(inhSum(revived) - stockBefore) < 1e-9,
    "restored inhibitor stock matches exactly",
  );
  const rInh = revived.resources.inhibitor;
  const oInh = sim.resources.inhibitor;
  for (const k of ["produced", "decayed", "discarded", "clampAdj"] as const) {
    assert.equal(rInh[k], oInh[k], `restored inhibitor counter ${k} matches`);
  }
  // Traits restore per organism, by id.
  const beforeById = new Map((sim.o as any[]).map((o) => [o.id, o]));
  for (const o of revived.o as any[]) {
    const b = beforeById.get(o.id);
    assert.ok(b, `restored organism ${o.id} existed before`);
    assert.equal(o.in, b.in, `organism ${o.id} secretion trait restores exactly`);
    assert.equal(o.re, b.re, `organism ${o.id} resistance trait restores exactly`);
  }
  // Byte-equivalence: re-encoding the revived world yields the same bytes.
  const cp2 = JSON.parse(JSON.stringify(createSimulationCheckpoint(revived)));
  assert.deepStrictEqual(cp2, cp, "checkpoint round-trip is byte-equivalent");
  // Restored accounting still closes.
  const a = rInh.accounting();
  assert.ok(Math.abs(a.residual as number) < 1e-4, `restored accounting closes, residual=${a.residual}`);
  console.log("testCheckpointRoundTripWithInterference: PASS");
}

function testRestoredContinuationMatchesUninterrupted() {
  // Restore mid-stride (T=300: stride at 251 banked, 49 ticks accumulated)
  // then cross the next stride boundary (502) on both branches.
  const T = 300, N = 250;
  const a = new Simulation(config(313377)) as any;
  for (let t = 0; t < T; t++) a.step();
  const b = restoreSimulationCheckpoint(
    JSON.parse(JSON.stringify(createSimulationCheckpoint(a))),
  ) as any;
  for (let t = 0; t < N; t++) {
    a.step();
    b.step();
  }
  assert.equal(b.t, a.t, "restored and uninterrupted worlds agree on tick");
  assert.deepStrictEqual(b.o, a.o, "organisms identical after restore + advance");
  assert.deepStrictEqual(
    Array.from(b.resources.inhibitor.stock as Float32Array),
    Array.from(a.resources.inhibitor.stock as Float32Array),
    "inhibitor field stock identical after restore + advance",
  );
  assert.deepStrictEqual(
    b.readIntervalFlows(),
    a.readIntervalFlows(),
    "interval flows identical after restore + advance",
  );
  console.log("testRestoredContinuationMatchesUninterrupted: PASS");
}

function testMatchedForkExactAtFork() {
  const sim = new Simulation(config(777123)) as any;
  for (let t = 0; t < 60; t++) sim.step();
  const cpJson = (s: any) => JSON.parse(JSON.stringify(createSimulationCheckpoint(s)));
  // Fork before any branch-specific action: byte-equivalent, including the
  // RS.clone inhibitor branch (Task 3 coverage target).
  const fork = sim.clone();
  assert.deepStrictEqual(cpJson(fork), cpJson(sim), "fork checkpoint is byte-equivalent at fork time");
  // Behavior: identical advance stays identical.
  for (let t = 0; t < 25; t++) {
    sim.step();
    fork.step();
  }
  assert.deepStrictEqual(cpJson(fork), cpJson(sim), "fork and original advance identically");
  assert.ok(inhSum(fork) > 0 && inhSum(sim) > 0, "both branches carry inhibitor field state");
  console.log("testMatchedForkExactAtFork: PASS");
}

function testOldSavesRefusedExplicitly() {
  assert.equal(SESSION_SCHEMA_VERSION, "0.5", "session writes schema 0.5");
  const session = new UniverseSession();
  session.create(config(424242));
  const payload: any = JSON.parse(JSON.stringify(session.checkpoint()));
  assert.equal(payload.checkpointSchemaVersion, "0.5", "fresh checkpoints declare 0.5");
  assert.equal(payload.engineVersion, "0.23.0", "fresh checkpoints carry engine 0.23.0");

  // Faithful 0.4 shape: schema + engine downgraded consistently, interference
  // state absent — no 0.22.0 build ever wrote it.
  const oldSave: any = JSON.parse(JSON.stringify(payload));
  oldSave.checkpointSchemaVersion = "0.4";
  oldSave.engineVersion = "0.22.0";
  oldSave.experiment.engine_version = "0.22.0";
  for (const o of oldSave.experiment.state.props.o) {
    delete o.in;
    delete o.re;
  }
  delete oldSave.experiment.state.props.resources.props.inhibitor;

  // Scoping proof: the old shape passes *validation* (no interference
  // requirement applies pre-0.5) and is refused by the engine-version gate.
  validateCheckpoint(oldSave);
  let refusal: unknown = null;
  try {
    new UniverseSession().restore(oldSave);
  } catch (e) {
    refusal = e;
  }
  assert.ok(refusal instanceof Error, "a 0.4/0.22.0 save is refused");
  assert.match((refusal as Error).message, /0\.22\.0/, "refusal names the save's engine version");
  assert.match((refusal as Error).message, /0\.23\.0/, "refusal names the running engine version");

  // Same gate at the sim-core layer.
  const scp: any = JSON.parse(
    JSON.stringify(createSimulationCheckpoint(new Simulation(config(99)) as any)),
  );
  scp.engine_version = "0.22.0";
  let coreRefusal: unknown = null;
  try {
    restoreSimulationCheckpoint(scp);
  } catch (e) {
    coreRefusal = e;
  }
  assert.ok(coreRefusal instanceof Error, "sim-core refuses a 0.22.0 payload");
  assert.match((coreRefusal as Error).message, /0\.22\.0/, "core refusal names the save's engine");
  assert.match((coreRefusal as Error).message, /0\.23\.0/, "core refusal names the running engine");

  // No migration rule defaults interference state: old worlds are refused,
  // never reinterpreted with invented traits or field mass.
  for (const rule of CHECKPOINT_MIGRATION_RULES) {
    const text = `${rule.id} ${rule.path}`;
    assert.ok(
      !/inhibitor|interference|secretion|resistance/i.test(text),
      `${rule.id} must not default interference state`,
    );
    assert.ok(
      !/\[\]\.(in|re)\b/.test(rule.path),
      `${rule.id} must not default the interference traits`,
    );
  }
  console.log("testOldSavesRefusedExplicitly: PASS");
}

testCheckpointRoundTripWithInterference();
testRestoredContinuationMatchesUninterrupted();
testMatchedForkExactAtFork();
testOldSavesRefusedExplicitly();
console.log("interference validation (task 4): PASS");
