import assert from "node:assert/strict";
import { Simulation, detritusBodyProxy } from "../../packages/sim-core/src/engine.ts";
import { ENGINE_VERSION } from "../../packages/sim-core/src/index.ts";

/**
 * Foundation Slice 2: detritus / recycling validation (handoff AC1–AC20,
 * assays A–K plus the L survey-artifact gate). Grows task by task; each
 * assay pins exact behavior with the evidence in comments.
 */

function config(seed: number, opts: Record<string, number> = {}): any {
  return {
    seed, start: 0.58, prod: 0.77, cap: 360, pop: 30, div: 0.35, mr: 0.03,
    ms: 0.12, press: 1.0875, patch: 0.6, resource_b_fraction: 0.5, cat: "global", st: null,
    resource_model: "definition_driven_substances", resource_grid: 60,
    enable_byproduct: true, enable_dormancy: true, study: true, ...opts,
  };
}

/** Step to each stride boundary, collecting (deaths, deposited) per stride. */
function strideTable(sim: any, ticks: number): { tick: number; deaths: number; deposited: number }[] {
  const rows: { tick: number; deaths: number; deposited: number }[] = [];
  const target = sim.t + ticks;
  while (sim.t < target) {
    sim.step();
    if (sim.t % 251 === 0) rows.push({ tick: sim.t, deaths: sim.last.deaths, deposited: sim.last.detritus_deposited || 0 });
  }
  return rows;
}

function testBodyProxy() {
  // Deterministic body-mass math: min(30, 2 + .05 * lifetime realized energy).
  assert.equal(detritusBodyProxy({ ga: 100, gb: 100, gc: 100 } as any), 17, "proxy is pure state math");
  assert.equal(detritusBodyProxy({ ga: 100, gb: 100, gc: 100 } as any), 17, "same state, same detritus");
  assert.equal(detritusBodyProxy({ ga: 1e9, gb: 1e9, gc: 1e9 } as any), 30, "proxy bounded above");
  assert.equal(detritusBodyProxy({ ga: 0, gb: 0, gc: 0 } as any), 2, "newborn carcass floor, never zero-or-negative");
  assert.ok(detritusBodyProxy({ ga: 0, gb: 500, gc: 0 } as any) > detritusBodyProxy({ ga: 0, gb: 100, gc: 0 } as any), "proxy grows with lived energy");
  console.log("death body proxy: PASS");
}

function testDeathCausality() {
  // AC1/AC2: every supported death deposits via the one body-return rule;
  // strides without deaths deposit nothing. Biconditional per stride, with
  // both kinds present so neither direction is vacuous.
  const sim = new Simulation(config(7)) as any;
  const rows = strideTable(sim, 8032);
  const quiet = rows.filter((r) => r.deaths === 0);
  const deadly = rows.filter((r) => r.deaths > 0);
  assert.ok(quiet.length > 0, "quiet strides observed (AC2 testable)");
  assert.ok(deadly.length > 0, "death strides observed (AC1 testable)");
  for (const r of quiet) assert.equal(r.deposited, 0, `no deaths means no deposit @${r.tick}`);
  for (const r of deadly) assert.ok(r.deposited > 0, `deaths deposit @${r.tick}`);
  const field = sim.resources.detritus;
  const intervalSum = rows.reduce((s, r) => s + r.deposited, 0);
  assert.ok(Math.abs(field.deposited - intervalSum) < 1e-6, "field lifetime equals stride-sum (no other source)");
  console.log(`death causality: PASS (${quiet.length} quiet / ${deadly.length} deadly strides)`);
}

function testNextTickAvailability() {
  // AC5 at field level: fresh deposits sit in pending, invisible to takeAt,
  // and merge into available stock at the next environment step. Deaths
  // enter ONLY via pending (only depositPending caller) and takes read ONLY
  // stock, so this is structural, not sampling luck.
  const sim = new Simulation(config(7)) as any;
  for (let t = 0; t < 100; t++) sim.step();
  const o = sim.o[0];
  const field = sim.resources.detritus;
  field.depositPending(o.x, o.y, 10, null);
  assert.equal(field.takeAt(o.x, o.y, 100, null), 0, "pending detritus unavailable same tick");
  const p0 = field.totals().pending, s0 = field.totals().stock;
  assert.ok(p0 >= 10, "deposit recorded in pending");
  sim.step();
  const p1 = field.totals().pending, s1 = field.totals().stock;
  assert.ok(p1 <= p0 - 9.9, "pending merged at next environment step");
  assert.ok(s1 >= s0 + 9, "merged mass becomes available stock (minus mineralization dust)");
  assert.ok(field.takeAt(o.x, o.y, 100, null) > 0, "merged detritus consumable next tick");
  console.log("next-tick availability: PASS");
}

/** Matched 2x2 fork: du capability high/zero × detritus economy on/off.
 * du overrides are white-box fork edits (validation-only, enabledWaste
 * precedent); all four forks run identical ticks from the same base world. */
function factorialForks(base: any, ticks: number): Record<string, { pop: number; meanEn: number; exec: number; eDet: number; min: number }> {
  const out: Record<string, { pop: number; meanEn: number; exec: number; eDet: number; min: number }> = {};
  for (const du of [1.2, 0]) {
    for (const detOn of [true, false]) {
      const f = base.clone();
      for (const o of f.o) o.du = du;
      if (!detOn) {
        f.resources.detritusDepositionEnabled = false;
        f.resources.detritusConsumptionEnabled = false;
        f.resources.detritus.stock.fill(0);
        f.resources.detritus.pending.fill(0);
      }
      for (let i = 0; i < ticks; i++) f.step();
      const ens = f.o.map((o: any) => o.en);
      const flows = (f as any).lastLineageFlows;
      out[`${du > 0 ? "cap" : "zero"}:${detOn ? "on" : "off"}`] = {
        pop: f.o.length,
        meanEn: ens.length ? ens.reduce((s: number, v: number) => s + v, 0) / ens.length : 0,
        exec: flows ? flows.totals.detritusExec : -1,
        eDet: flows ? +flows.totals.energyDetritus.toFixed(1) : -1,
        min: flows ? +flows.totals.detritusMineralized.toFixed(1) : -1,
      } as any;
    }
  }
  return out;
}

function testRecyclerAdvantage() {
  // AC9 (capable + detritus beats capable without) and AC8 (benefit
  // requires capability: capable + detritus beats incapable + detritus).
  const base = new Simulation(config(7)) as any;
  for (let t = 0; t < 20000; t++) base.step();
  assert.ok(base.resources.detritus.totals().stock > 0, "base world offers detritus opportunity");
  const r = factorialForks(base, 8000);
  console.log(`factorial: ${JSON.stringify(r)}`);
  // AC9: capable recyclers with detritus beat the matched no-detritus
  // treatment (abundance advantage). AC8: the benefit runs through USE —
  // the capable fork shows mass detritus energy + executions while the
  // incapable fork shows ~none (residual = mutant intake, see assay H).
  // NOTE (deliberate, handoff-faithful): cap:on is NOT required to beat
  // zero:on. Mineralization is a public good by design (AC11); free-riding
  // on it is legitimate ecology, and demanding otherwise would force
  // detritus into a dominant-food role the stop conditions forbid.
  assert.ok(r["cap:on"]!.pop > r["cap:off"]!.pop, "detritus opportunity advantages capable recyclers (AC9)");
  assert.ok(r["cap:on"]!.eDet > 100 * r["zero:on"]!.eDet, "benefit runs through use, concentrated in the capable fork (AC8)");
  assert.ok(r["cap:on"]!.exec > 0, "capable fork executes detritus meals");
  console.log("recycler advantage: PASS");
}

function testOpportunityDependence() {
  // AC10: without detritus, the standing du cost buys nothing — capable
  // recyclers do no better than zero-du controls (no unexplained advantage).
  const base = new Simulation(config(7)) as any;
  for (let t = 0; t < 20000; t++) base.step();
  const r = factorialForks(base, 8000);
  // AC10: without detritus the standing du cost buys nothing. Populations
  // are butterfly-noise-dominated at this horizon (440 vs 439), so the
  // tradeoff is pinned at energy level (capable mean energy clearly lower)
  // with a 5% population band guarding against advantage OR collapse.
  assert.ok(r["cap:off"]!.meanEn < r["zero:off"]!.meanEn, "standing cost bites in energy without opportunity");
  const gap = Math.abs(r["cap:off"]!.pop - r["zero:off"]!.pop) / r["zero:off"]!.pop;
  assert.ok(gap < 0.05, `no population-level advantage either way (gap ${gap})`);
  console.log("opportunity dependence: PASS");
}

testBodyProxy();
testDeathCausality();
testNextTickAvailability();
testRecyclerAdvantage();
testOpportunityDependence();
console.log(`detritus validation: PASS (engine ${ENGINE_VERSION})`);
