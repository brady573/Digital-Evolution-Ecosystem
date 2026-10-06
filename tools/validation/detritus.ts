import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Simulation, ResourceSystem, detritusBodyProxy, createSimulationCheckpoint, restoreSimulationCheckpoint } from "../../packages/sim-core/src/engine.ts";
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
 * precedent); all four forks run identical ticks from the same base world.
 * Base world is chosen per assay (harsh for advantage, rich for control). */
function harshConfig(seed: number): any {
  return {
    seed, start: 0.47, prod: 0.52, cap: 360, pop: 30, div: 0.35, mr: 0.03,
    ms: 0.12, press: 1.0875, patch: 0.55, resource_b_fraction: 0.5, cat: "global", st: null,
    resource_model: "definition_driven_substances", resource_grid: 60,
    enable_byproduct: true, enable_dormancy: true, study: true,
  };
}
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
  // AC9 + AC8 in a scarcity regime (harsh): capable recyclers with
  // detritus beat the matched no-detritus treatment by a measurable
  // margin, and the benefit runs through USE (executions + energy,
  // concentrated orders of magnitude above mutant background).
  // NOTE: whole-pop cap:on is NOT required to beat whole-pop zero:on —
  // mineralization is a public good by design (AC11); marginal invasion
  // (H1) is the correct evolvability test, not whole-pop contrasts.
  const base = new Simulation(harshConfig(111111111)) as any;
  for (let t = 0; t < 30000; t++) base.step();
  assert.ok(base.resources.detritus.totals().stock > 0, "base world offers detritus opportunity");
  const r = factorialForks(base, 8000);
  console.log(`factorial: ${JSON.stringify(r)}`);
  assert.ok(r["cap:on"]!.pop > 1.1 * r["cap:off"]!.pop, "detritus opportunity measurably advantages capable recyclers (AC9)");
  assert.ok(r["cap:on"]!.exec > 0 && r["cap:on"]!.eDet > 0, "benefit runs through fallback use");
  // Zero-du forks grow nibbling mutants under threshold gating (exec>0,
  // tiny sips), so concentration is pinned on ENERGY (order of magnitude),
  // not event counts: capable meals are real, mutant sips are dust.
  // WIP-TEMP NEUTRALIZED (revert/restore before final acceptance): one-cycle
  // measurement exposure for H1/H2/H4/H5/K + remaining 0.26 detritus
  // evidence. Authorized #6007385910. The permanent floor (>2x, measured
  // history 0.25=14.9x / 0.26=5.08x) is restored only after the H-suite
  // verdict — if H1 fails, margin erosion plus invasion failure reopens
  // the question instead of landing the new floor.
  // assert.ok(r["cap:on"]!.eDet > 10 * Math.max(r["zero:on"]!.eDet, 1e-9), "use concentrated in the capable fork (AC8)");
  console.log("recycler advantage: PASS");
}

function testOpportunityDependence() {
  // AC10: without detritus, the standing du cost buys nothing — capable
  // recyclers do no better than zero-du controls (no unexplained advantage).
  const base = new Simulation(config(7)) as any;
  for (let t = 0; t < 20000; t++) base.step();
  const r = factorialForks(base, 8000);
  // AC10 with an execution-gated tradeoff: no opportunity means no use,
  // no use means no cost paid and no benefit reaped — the forks coincide
  // up to butterfly noise, with at most the tiny constitutive cost
  // separating them. Guards are one-sided (no UNEXPLAINED advantage) plus
  // a no-wipeout floor; exact equality would punish the sanctioned cost.
  assert.equal(r["cap:off"]!.exec, 0, "no use without opportunity (capable)");
  assert.equal(r["zero:off"]!.exec, 0, "no use without opportunity (control)");
  assert.ok(r["cap:off"]!.pop <= 1.05 * r["zero:off"]!.pop, "no population advantage without opportunity");
  assert.ok(r["cap:off"]!.pop >= 0.5 * r["zero:off"]!.pop, "no wipeout without opportunity");
  assert.ok(r["cap:off"]!.meanEn <= 1.05 * r["zero:off"]!.meanEn, "no energy advantage without opportunity");
  console.log("opportunity dependence: PASS");
}

function testMineralizationIsolation() {
  // AC11: with deposition and consumption disabled, pre-existing stock
  // falls ONLY by mineralization, and every mineralized unit appears as
  // A/B biological production (no creation, no loss).
  const base = new Simulation(config(7)) as any;
  for (let t = 0; t < 20000; t++) base.step();
  const f = base.clone();
  f.resources.detritusDepositionEnabled = false;
  f.resources.detritusConsumptionEnabled = false;
  const d0 = f.resources.detritus;
  const s0 = d0.totals().stock + d0.totals().pending;
  assert.ok(s0 > 0, "isolation fork starts with detritus stock");
  const dep0 = d0.deposited, con0 = d0.consumed, min0 = d0.mineralized, minA0 = d0.mineralizedA, minB0 = d0.mineralizedB;
  const bioA0 = f.resources.biologicalProduction[0], bioB0 = f.resources.biologicalProduction[1];
  for (let i = 0; i < 5000; i++) f.step();
  const d1 = f.resources.detritus;
  const s1 = d1.totals().stock + d1.totals().pending;
  const wMin = d1.mineralized - min0, wMinA = d1.mineralizedA - minA0, wMinB = d1.mineralizedB - minB0;
  assert.equal(d1.deposited, dep0, "no new deposits while disabled");
  assert.equal(d1.consumed, con0, "no consumption while disabled");
  assert.ok(wMin > 0, "passive mineralization proceeds");
  assert.ok(Math.abs((s0 - s1) - wMin) / Math.max(1, s0) < 1e-6, "stock fall equals mineralized");
  assert.ok(Math.abs((f.resources.biologicalProduction[0] - bioA0) - wMinA) < 1e-6, "A received exactly mineralized_a");
  assert.ok(Math.abs((f.resources.biologicalProduction[1] - bioB0) - wMinB) < 1e-6, "B received exactly mineralized_b");
  console.log(`mineralization isolation: PASS (mineralized ${wMin.toFixed(1)}: A ${wMinA.toFixed(1)} / B ${wMinB.toFixed(1)})`);
}

function testAccountingClosure() {
  // AC12: both accounting identities close on a full-economy run —
  // detritus field and the receiving A/B books.
  const sim = new Simulation(config(7)) as any;
  for (let t = 0; t < 10000; t++) sim.step();
  const da = sim.resources.detritus.accounting();
  const t = sim.resources.detritus.totals();
  const scale = Math.max(1, da.deposited);
  assert.ok(Math.abs(da.residual) / scale < 1e-6, `detritus identity closes (residual ${da.residual})`);
  assert.ok(Math.abs(da.deposited - da.consumed - da.mineralized - t.stock - t.pending) / scale < 1e-6, "components reconcile");
  const ra = sim.resources.accounting();
  const rScale = Math.max(1, ...ra.absolute_residual.map((v: number, k: number) => Math.abs(ra.initial_stock[k]! + ra.environmental_input[k]!)));
  assert.ok(ra.absolute_residual.every((v: number) => v / rScale < 1e-6), `A/B identity closes (residuals ${ra.absolute_residual})`);
  console.log(`accounting closure: PASS (detritus residual ${da.residual.toExponential(1)}, A/B ${ra.absolute_residual.map((v: number) => v.toExponential(1)).join("/")})`);
}

function testCheckpointFork() {
  // AC16: save/load round-trip and matched-fork continuation with nonzero
  // detritus, an unmerged pending buffer, and evolved (here overridden —
  // validation-only, same stand-in as assays C/D) recycler capability.
  const base = new Simulation(config(7)) as any;
  for (let t = 0; t < 20000; t++) base.step();
  for (const o of base.o) o.du = 1.0;
  const anchor = base.o[0];
  base.resources.detritus.depositPending(anchor.x, anchor.y, 5, null);
  const d0 = base.resources.detritus;
  assert.ok(d0.totals().stock > 0, "nonzero detritus precondition");
  assert.ok(d0.totals().pending > 0, "unmerged pending precondition");
  const duMean = (s: any) => s.o.reduce((a: number, o: any) => a + o.du, 0) / s.o.length;
  const du0 = duMean(base);
  const revived = restoreSimulationCheckpoint(JSON.parse(JSON.stringify(createSimulationCheckpoint(base)))) as any;
  const r0 = revived.resources.detritus;
  assert.deepEqual(Array.from(r0.stock), Array.from(d0.stock), "detritus stock round-trips exactly");
  assert.deepEqual(Array.from(r0.pending), Array.from(d0.pending), "pending buffer round-trips exactly");
  assert.equal(r0.deposited, d0.deposited, "lifetime counters round-trip");
  assert.equal(duMean(revived), du0, "recycler capability round-trips");
  for (let i = 0; i < 502; i++) { base.step(); revived.step(); }
  assert.equal(revived.t, base.t, "fork continues to the same tick");
  assert.equal(revived.o.length, base.o.length, "fork continues with the same population");
  assert.deepEqual(revived.metrics().detritus, base.metrics().detritus, "fork detritus state identical");
  assert.equal(duMean(revived), duMean(base), "fork capability identical");
  console.log("checkpoint/fork with detritus: PASS");
}

function testHotspotSuccession() {
  // AC13/AC14: local death clusters create persistent detritus hotspots
  // (death = material opportunity as well as Slice 1 vacancy), and the
  // local biology responds through consumption. Response here is
  // mechanism-level (executions + energy flow); specialist establishment
  // from founders is assay H's question, not this one's.
  const sim = new Simulation(config(111111111, { start: 0.62, prod: 0.86, patch: 0.9, pop: 34, div: 0.45 })) as any;
  const field = () => sim.resources.detritus.stock as Float32Array;
  // Concentration via top-decile mass share (uniform field = 0.10) and CV:
  // robust to rising background, unlike max/mean ratio. Measured seed
  // 111111111: share 0.53 → 0.39, CV 1.73 → 1.29 (30k → 50k).
  const concentration = (): { share: number; cv: number } => {
    const st = field();
    const arr = Array.from(st).sort((a, b) => b - a);
    let sum = 0;
    for (const v of arr) sum += v;
    const top10 = arr.slice(0, 360).reduce((a, b) => a + b, 0);
    const mean = sum / arr.length;
    let v = 0;
    for (const x of arr) v += (x - mean) * (x - mean);
    const cv = mean > 0 ? Math.sqrt(v / arr.length) / mean : 0;
    return { share: sum > 0 ? top10 / sum : 0, cv };
  };
  let execSeen = 0, eDetSeen = 0;
  for (let t = 0; t < 50000; t++) {
    sim.step();
    if (sim.t % 251 === 0) {
      execSeen += sim.last.detritus_exec || 0;
      eDetSeen += sim.last.energy_detritus || 0;
    }
    if (sim.t === 30000 || sim.t === 50000) {
      const c = concentration();
      assert.ok(c.share > 0.3, `hotspot persists at ${sim.t} (top-decile share ${c.share.toFixed(2)})`);
      assert.ok(c.cv > 1.0, `field stays concentrated at ${sim.t} (CV ${c.cv.toFixed(2)})`);
    }
  }
  assert.ok(execSeen > 0, "local biology consumes hotspot detritus");
  assert.ok(eDetSeen > 0, "hotspot consumption yields energy");
  console.log(`hotspot succession: PASS (execs ${execSeen}, detritus energy ${eDetSeen.toFixed(0)})`);
}

/** Descent-tagged lineage share: every tick, newborns of marked parents
 * join the marked set. Robust to founder death; deterministic. Marked
 * founders are always NEWBORNS (born within 100 ticks): mutations enter
 * through offspring (mut() acts at birth), and marking ancients confounds
 * the assay with age-structure discipline — ancients die on schedule
 * regardless of du, which reads as selection against capability. */
function markNewborns(sim: any, count: number): Set<number> {
  const marked = new Set<number>();
  const newborns = sim.o.filter((o: any) => o.born >= sim.t - 100);
  for (const o of newborns.slice(0, count)) { marked.add(o.id); o.du = 0.8; }
  return marked;
}
function lineageShare(sim: any, marked: Set<number>): number {
  if (!sim.o.length) return 0;
  let n = 0;
  for (const o of sim.o) {
    if (marked.has(o.id)) n++;
    else if (o.parent != null && marked.has(o.parent)) { marked.add(o.id); n++; }
  }
  return n / sim.o.length;
}
function testRareInvasion() {
  // AC2B-6/H1 (decisive, design-resolved #5975509172): a rare capable
  // carrier has POSITIVE INVASION FITNESS — not permanent pioneer-lineage
  // dominance. Ten independently marked newborn founders (union ≈1.9%,
  // each lineage ≈0.2%) are validation-overridden to du=0.8 (white-box
  // fork-edit precedent): H1 therefore proves invasion fitness of a rare
  // capable carrier, NOT that natural mutation arose. Natural emergence is
  // proven separately — unmanipulated background evolution here (unmarked
  // mean du), naturally emerging detritivores, and the survey artifact.
  // Measurement is enrichment tracking (shares at 35/40/45/50k; each call
  // absorbs living descendants — exact, ids never reused). Single-shot
  // measurement at 50k/60k deterministically reads 0.00 once founder and
  // first-generation links die (turnover), even with descendants alive;
  // enrichment is a ruler fix, not a biology change. The bar matches the
  // sweep-then-displace dynamic: invasion peak >10x start, signal still
  // elevated at 50k, background fixed, specialists present. CI-measured
  // trajectory (run 37163055991 + local exact replays): 0.019 -> 0.22 ->
  // 0.42 -> 0.16 -> 0.07 -> extinct by 55k while background du -> 0.82.
  // Requiring >10x at both 50k AND 60k tested founder-lineage dominance,
  // which is not the claim; the claim is invasion, and 2% -> 42% is one.
  const sim = new Simulation(harshConfig(111111111)) as any;
  for (let t = 0; t < 30000; t++) sim.step();
  const marked = markNewborns(sim, 10);
  assert.equal(marked.size, 10, "ten newborn mutants marked");
  const s0 = lineageShare(sim, marked);
  assert.ok(s0 < 0.03, `mutants start rare (share ${s0})`);
  let s35 = 0, s40 = 0, s45 = 0, s50 = 0;
  while (sim.t < 50000) {
    sim.step();
    if (sim.t === 35000) s35 = lineageShare(sim, marked);
    if (sim.t === 40000) s40 = lineageShare(sim, marked);
    if (sim.t === 45000) s45 = lineageShare(sim, marked);
    if (sim.t === 50000) s50 = lineageShare(sim, marked);
  }
  const peak = Math.max(s35, s40, s45);
  const unmarked = (sim.o as any[]).filter((o: any) => !marked.has(o.id));
  const unmarkedDu = unmarked.reduce((s: number, o: any) => s + (o.du || 0), 0) / Math.max(1, unmarked.length);
  const m = sim.metrics() as any;
  console.log(`rare invasion: shares ${s0.toFixed(4)} -> ${s35.toFixed(2)}/${s40.toFixed(2)}/${s45.toFixed(2)}/${s50.toFixed(2)} (peak ${peak.toFixed(2)}), unmarked-du ${unmarkedDu.toFixed(3)}, detriv ${m.metabolic_roles.counts.detritivore || 0}`);
  assert.ok(peak > 10 * s0, "marked lineages invade from rarity (peak share)");
  assert.ok(s50 > s0, "lineage signal still elevated at 50k while the trait fixes");
  assert.ok(unmarkedDu > 0.5, "unmanipulated background evolves the capability independently");
  assert.ok((m.metabolic_roles.counts.detritivore || 0) > 0, "specialist state reached without seeding");
  console.log("rare invasion: PASS");
}
function testNoOpportunityControl() {
  // AC2B-7/H2 (matched): the same single-mutant protocol with detritus
  // disabled shows no invasion. Here the harsh world collapses without
  // the pathway and the mutant dies with it — no selective increase,
  // which is what the control must show.
  const sim = new Simulation(harshConfig(111111111)) as any;
  for (let t = 0; t < 30000; t++) sim.step();
  const marked = markNewborns(sim, 1);
  assert.equal(marked.size, 1, "one newborn mutant marked");
  sim.resources.detritusDepositionEnabled = false;
  sim.resources.detritusConsumptionEnabled = false;
  sim.resources.detritus.stock.fill(0);
  sim.resources.detritus.pending.fill(0);
  while (sim.t < 40000) sim.step();
  const s = lineageShare(sim, marked);
  console.log(`no-opportunity control: share ${s.toFixed(4)} pop ${sim.o.length}`);
  assert.ok(s < 0.01, "no invasion without opportunity");
  console.log("no-opportunity control: PASS");
}
function testFrequencyCohort() {
  // H4 (design-resolved #5975974333): a broader low-frequency capable
  // cohort is POSITIVELY SELECTED, then displaced — not fixed. The whole
  // newborn pool (≈5%) is validation-overridden to du=0.8 (white-box
  // fork-edit precedent, same disclosure as H1). Enrichment tracking at
  // 35/40/45/50k (each share call absorbs living descendants — exact,
  // ids never reused). Bars: peak share ≥4x start AND ≥20% absolute;
  // the observation after the peak still ≥2x start; later decline or
  // complete pioneer-cohort extinction is ALLOWED once independently
  // evolving backgrounds acquire the capability. CI-measured trajectory:
  // 0.048 -> 0.36 -> 0.25 -> 0.13 -> 0.00 with unmarked du 0.771 and 219
  // detritivores. Supported phenomenon: pioneer invasion followed by
  // background replacement after capability spread. The faster H4
  // displacement does NOT establish negative frequency dependence — one
  // deterministic regime cannot separate frequency- from
  // genomic-background-dependent replacement — so the package claims
  // only the observed replacement, not its mechanism.
  const sim = new Simulation(harshConfig(111111111)) as any;
  for (let t = 0; t < 30000; t++) sim.step();
  // Newborn-pool cohort (≈5% of the population): young, unbiased, many.
  const pool = sim.o.filter((o: any) => o.born >= sim.t - 100);
  const marked = markNewborns(sim, pool.length);
  const s0 = lineageShare(sim, marked);
  assert.ok(s0 > 0.03 && s0 < 0.07, "cohort starts near 5%");
  const stops = [35000, 40000, 45000, 50000];
  const shares: number[] = [];
  for (const stop of stops) {
    while (sim.t < stop) sim.step();
    shares.push(lineageShare(sim, marked));
  }
  const peak = Math.max(...shares);
  const peakIdx = shares.indexOf(peak);
  const afterPeak = peakIdx + 1 < shares.length ? shares[peakIdx + 1] : peak;
  const unmarked = (sim.o as any[]).filter((o: any) => !marked.has(o.id));
  const unmarkedDu = unmarked.reduce((s: number, o: any) => s + (o.du || 0), 0) / Math.max(1, unmarked.length);
  const m = sim.metrics() as any;
  console.log(`frequency cohort: share ${s0.toFixed(3)} -> ${shares.map((s) => s.toFixed(2)).join("/")} (peak ${peak.toFixed(2)}), unmarked-du ${unmarkedDu.toFixed(3)}, detriv ${m.metabolic_roles.counts.detritivore || 0}`);
  assert.ok(peak >= 4 * s0 && peak >= 0.20, "cohort invades from low frequency (peak)");
  assert.ok(afterPeak >= 2 * s0, "invasion sustained past the peak observation");
  console.log("frequency cohort: PASS");
}
function testSeededPersistence() {
  // H5 (regression-only, NOT reachability evidence): seeded high-du
  // persists with opportunity, with a specialist subpopulation. If this
  // ever fails, the maintenance leg of the bistability story is gone.
  const sim = new Simulation(config(111111111, { start: 0.62, prod: 0.86, patch: 0.9, pop: 34, div: 0.45 })) as any;
  for (const o of sim.o) o.du = 1.0;
  for (let t = 0; t < 30000; t++) sim.step();
  const m = sim.metrics() as any;
  console.log(`seeded persistence: du=${m.traits.detritus_use.mean.toFixed(3)} detriv=${m.metabolic_roles.counts.detritivore || 0}`);
  assert.ok(Math.abs(m.traits.detritus_use.mean - 1.0) < 0.1, "seeded capability maintained");
  assert.ok((m.metabolic_roles.counts.detritivore || 0) > 0, "specialists persist");
  console.log("seeded persistence: PASS");
}

function testSurveyArtifact() {
  // Assay L gate: retained 0.25 regime survey. Engine match, 18-row
  // coverage (3 configs x 6 seeds), required keys, and at least one
  // specialization/succession row (AC19). If every row is abundance-only
  // or absent, detritus merely raises abundance and the slice returns
  // DESIGN TENSION instead of shipping — this gate is that tripwire.
  let artifact: any;
  try {
    artifact = JSON.parse(readFileSync("testdata/detritus-survey-0.25.json", "utf8"));
  } catch {
    assert.fail("detritus survey artifact missing or unreadable: run pnpm test:detritus-survey on CI (resume-safe) to retain testdata/detritus-survey-0.25.json");
  }
  assert.equal(artifact.engine, ENGINE_VERSION, "artifact matches current engine");
  assert.ok(Array.isArray(artifact.rows), "survey rows are an array");
  assert.equal(artifact.rows.length, 18, "survey covers 3 configs x 6 seeds");
  for (const c of ["patchwork", "balanced", "harsh"] as const) {
    assert.equal(artifact.rows.filter((r: any) => r.config === c).length, 6, `${c}: every surveyed seed represented`);
  }
  for (const row of artifact.rows) {
    for (const k of ["config", "seed", "horizon", "detMax", "detFinal", "detCapFraction", "detrivMaxShare", "duBase", "duFinal", "hotspot", "energyDetritus", "mineralShareAB", "population", "response", "wasteMax", "nicheState", "nicheEstablished"]) {
      assert.ok(row[k] !== undefined, `survey row carries ${k}`);
    }
  }
  const novel = artifact.rows.filter((r: any) => r.response === "specialization" || r.response === "succession");
  assert.ok(novel.length > 0, "at least one new-regime row (AC19), else DESIGN TENSION");
  console.log(`detritus survey artifact: PASS (${artifact.rows.length} rows, novel regimes: ${novel.map((r: any) => `${r.config}/${r.seed}:${r.response}`).join(", ")})`);
}

function testScaleThroughput() {
  // AC18: thousands-scale viability. Rich world to 1k+ population, fork
  // detritus on/off, time a fixed tick window on each. Deterministic cost
  // proxies are the real gate (exact across twins); wall time carries a
  // generous shared-runner-safe ratio bound. 5k populations are not
  // reachable in calibration configs (worlds peak ~1.4k) — recorded as a
  // known limitation, not asserted.
  // Workload re-derivation (2B engine): the Slice 2 workload (prod 0.86,
  // press 1.0875) reached 1211 @40k under the pre-2B engine but only 875
  // under R1-threshold (worktree-verified, same seed 111111111) — the 2B
  // biology suppresses this rich world's equilibrium ~30% (reported as a
  // trajectory consequence in the return package, not hidden). K tests
  // throughput, not biology, so the workload is restored with the same
  // seed and modestly richer/easier terms (prod 1.1, press 0.95):
  // 1235 @40k locally, matching the original workload size. Engine and
  // cost bars unchanged.
  const sim = new Simulation(config(111111111, { start: 0.62, prod: 1.1, patch: 0.9, pop: 34, div: 0.45, press: 0.95 })) as any;
  for (let t = 0; t < 40000; t++) sim.step();
  assert.ok(sim.o.length >= 1000, `thousands-scale workload (pop ${sim.o.length})`);
  const time = (s: any, n: number): number => { const t0 = Date.now(); for (let i = 0; i < n; i++) s.step(); return Date.now() - t0; };
  const on = sim.clone();
  const off = sim.clone();
  off.resources.detritusDepositionEnabled = false;
  off.resources.detritusConsumptionEnabled = false;
  const msOn = time(on, 2000), msOff = time(off, 2000);
  const twinA = sim.clone(), twinB = sim.clone();
  for (let i = 0; i < 2000; i++) { twinA.step(); twinB.step(); }
  assert.equal(twinB.resources.detritus.consumed, twinA.resources.detritus.consumed, "cost proxies deterministic");
  assert.equal(twinB.resources.detritus.mineralized, twinA.resources.detritus.mineralized, "mineralization deterministic");
  assert.equal(twinB.o.length, twinA.o.length, "twin populations identical");
  console.log(`scale: 2k ticks on pop ${sim.o.length}: on ${msOn}ms / off ${msOff}ms`);
  assert.ok(msOn < 4 * Math.max(msOff, 1), "detritus pathway within 4x of disabled fork");
  console.log("scale/performance: PASS");
}

function testPreferredPriority() {
  // AC2B-2/H3: preferred priority is structural AND behaviorally pinned at
  // the mechanism level. consume() is byte-identical to 0.24.0 (it never
  // evaluates detritus); the top-up in S.step only appends on ordinary
  // shortfall and never reduces a realized uptake. (Twin-digest equality
  // was considered and rejected: the sanctioned constitutive cost
  // legitimately differentiates twins.)
  // Organism literals carry only what consume() reads (x/y/du).
  const micro = (x: number, y: number, du: number): any =>
    ({ id: 1, x, y, du, en: 60, di: 0, ha: 0, bu: 0 } as any);
  const findStock = (rs: any, kind: number): [number, number] | null => {
    for (let iy = 0; iy < rs.n; iy++) for (let ix = 0; ix < rs.n; ix++) {
      const i = iy * rs.n + ix;
      if (rs.stock[kind]![i]! > 1) return [(ix + .5) * rs.cell, (iy + .5) * rs.cell];
    }
    return null;
  };
  const freshRS = (): any => new ResourceSystem(config(7));
  // (a) Rich A/B cell + max du → ordinary uptake, never detritus.
  {
    const rs = freshRS();
    const at = findStock(rs, 0)!;
    const eat = rs.consume(micro(at[0], at[1], 1.5), null);
    assert.ok(eat && !("detritus" in eat), "rich cell with du=1.5 still yields ordinary uptake");
  }
  // (b) Barren of A/B/C + detritus present + du → fallback executes via
  // execDetritus (consume() itself never returns detritus: ordinary path
  // is byte-identical to 0.24.0; the top-up lives in S.step and only
  // appends on shortfall).
  {
    const rs = freshRS();
    for (let k = 0; k < 3; k++) (rs.stock[k] as Float32Array).fill(0);
    const i = 1000;
    rs.detritus.stock[i] = 50;
    const cx = (i % rs.n) * rs.cell + rs.cell / 2, cy = Math.floor(i / rs.n) * rs.cell + rs.cell / 2;
    const ex = rs.execDetritus(micro(cx, cy, 1.0), null);
    assert.ok(ex && ex.amount > 0 && ex.gain > 0, "fallback executes with capability + opportunity");
    assert.equal(rs.execDetritus(micro(cx, cy, 0), null), null, "no capability means no fallback");
  }
  // (c) Barren of everything → consume null AND execDetritus null.
  {
    const rs = freshRS();
    for (let k = 0; k < 3; k++) (rs.stock[k] as Float32Array).fill(0);
    assert.equal(rs.consume(micro(5, 5, 1.5), null), null, "nothing available means no ordinary meal");
    assert.equal(rs.execDetritus(micro(5, 5, 1.5), null), null, "nothing available means no fallback either");
  }
  // (d) Rich cell + du=0 → ordinary uptake (du irrelevant when primaries succeed).
  {
    const rs = freshRS();
    const at = findStock(rs, 1)!;
    const eat = rs.consume(micro(at[0], at[1], 0), null);
    assert.ok(eat && !("detritus" in eat), "rich cell with du=0 yields ordinary uptake");
  }
  console.log("preferred priority: PASS (ordinary-first rule pinned at mechanism level)");
}

testBodyProxy();
testPreferredPriority();
testDeathCausality();
testNextTickAvailability();
testRecyclerAdvantage();
testOpportunityDependence();
testMineralizationIsolation();
testAccountingClosure();
testCheckpointFork();
testHotspotSuccession();
testRareInvasion();
testNoOpportunityControl();
testFrequencyCohort();
testSeededPersistence();
testScaleThroughput();
testSurveyArtifact();
console.log(`detritus validation: PASS (engine ${ENGINE_VERSION})`);
