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
