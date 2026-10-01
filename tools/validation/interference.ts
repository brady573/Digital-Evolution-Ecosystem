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
console.log("interference validation (task 1): PASS");
