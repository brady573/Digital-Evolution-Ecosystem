import { readFileSync, writeFileSync } from "node:fs";
import { UniverseSession } from "../../packages/sim-runtime/src/session.ts";
import { ENGINE_VERSION } from "../../packages/sim-core/src/index.ts";
import type { EngineConfig } from "../../packages/contracts/src/index.ts";

/**
 * Slice 1 interference-biology survey (Task 6): bounded ecological
 * characterization of costly secretion, costly resistance, exposure, and
 * acquisition suppression — plus a performance probe.
 *
 * Design (no target prevalence anywhere; the survey REPORTS, including runs
 * where interference never establishes):
 * - Reuses tools/validation/ecology.ts regimes, seeds, horizon (balanced /
 *   patchwork / harsh x 821947219 / 3543950664 x 40k ticks, pop 30, cap 360),
 *   plus three extra balanced seeds for range evidence.
 * - Per run records secretion/resistance mean trajectories, inhibitor field
 *   fraction, exposed share, per-stride acquisition-suppression share, and a
 *   descriptive outcome label (spread / recede-or-floor / coexistence /
 *   extinction). Labels are reporting conveniences with documented
 *   thresholds, never gates: this file asserts nothing about frequency.
 * - Matched assays use raw-sim clone()+step only (the niche-survey pattern):
 *   no intervene/createControlFork, so nothing here depends on the
 *   decisions/catalysts suites. Evolution is frozen (mr=0) inside assays so
 *   strain shares read as fitness directly.
 * - Performance probe: wall-time per tick with interference active vs the
 *   same workload silenced (traits pinned 0), at maintained workloads.
 *
 * Manual run (NOT part of `pnpm verify` — long, scientific class):
 *   npx tsx tools/validation/interference-survey.ts
 * Retains to testdata/interference-survey-0.23.json (resume-safe; artifact
 * retained, numbers reported — raw data files are not committed).
 */

const OUT = "testdata/interference-survey-0.23.json";
const HORIZON = 40000;
const SAMPLE_EVERY = 1000;
const ASSAY_TICKS = 8000;
const ASSAY_BASE = 12000;
const PERF_TICKS = 2000;

type Regime = "balanced" | "patchwork" | "harsh";
const REGIMES: Regime[] = ["balanced", "patchwork", "harsh"];
// ecology.ts seeds first (reuse), then extra balanced range seeds.
const SEEDS: Array<{ regime: Regime; seed: number }> = [
  { regime: "balanced", seed: 821947219 },
  { regime: "balanced", seed: 3543950664 },
  { regime: "patchwork", seed: 821947219 },
  { regime: "patchwork", seed: 3543950664 },
  { regime: "harsh", seed: 821947219 },
  { regime: "harsh", seed: 3543950664 },
  { regime: "balanced", seed: 111111111 },
  { regime: "balanced", seed: 222222222 },
  { regime: "balanced", seed: 333333333 },
];

function config(seed: number, regime: Regime): EngineConfig {
  const defs = {
    balanced: { rich: .60, press: .45, patch: .60, b: .50 },
    patchwork: { rich: .68, press: .52, patch: .92, b: .50 },
    harsh: { rich: .38, press: .78, patch: .55, b: .40 },
  }[regime];
  return {
    seed, start: .25 + defs.rich * .55, prod: .08 + defs.rich * 1.15, cap: 360, pop: 30, div: .35, mr: .035, ms: .12,
    press: .75 + defs.press * .75, patch: defs.patch, resource_b_fraction: defs.b, cat: "global", st: null,
    resource_model: "definition_driven_substances", resource_grid: 60, enable_byproduct: true, enable_dormancy: true, study: true,
  };
}

// ecology.ts settle pattern: advance() stops at a pending decision, so
// resolve everything keep-watching (a pure no-op choice) to reach horizon.
function settle(session: UniverseSession, target: number): void {
  for (let i = 0; i < 10000 && session.snapshot().tick < target; i++) {
    const snapshot = session.advance(1000);
    const pending = snapshot.pendingDecision;
    if (pending) session.resolveEventDecision(pending.opportunityId, "keep-watching");
  }
}

function sample(session: UniverseSession): any {
  const snap = session.snapshot();
  const m: any = snap.metrics;
  const sim: any = session.simulation;
  // Exposed share mirrors observerSnapshot logic (read-only white-box read).
  let exposed = 0;
  for (const o of sim.o as any[]) {
    if (sim.resources.inhibitor.fractionAt(o.x, o.y) > 0) exposed++;
  }
  // Suppression share of the most recently banked stride (251-tick window).
  const last: any = sim.last ?? {};
  const supp = (last.suppressed_a ?? 0) + (last.suppressed_b ?? 0) + (last.suppressed_c ?? 0);
  const cons = (last.consumed_a ?? 0) + (last.consumed_b ?? 0) + (last.consumed_c ?? 0);
  return {
    tick: snap.tick,
    population: snap.population,
    secretionMean: +m.traits.secretion.mean.toFixed(4),
    resistanceMean: +m.traits.resistance.mean.toFixed(4),
    inhibitorFraction: +m.inhibitor.fraction.toFixed(4),
    inhibitorProduced: +m.inhibitor.produced.toFixed(2),
    exposedShare: snap.population ? +(exposed / snap.population).toFixed(4) : 0,
    suppressionShare: cons + supp > 0 ? +(supp / (cons + supp)).toFixed(4) : null,
  };
}

// Descriptive outcome label. Survey-local reporting vocabulary -- deliberately
// DISTINCT from the emitter's ecological_outcome field (which classifies
// niche partitioning: "A-adapted dominance", "Mixed eco-strategies", ...).
// These labels describe only secretion/resistance mean movement and gate
// nothing. Threshold rationale (asymmetric by construction, documented here
// instead of asserted): founder secretion/resistance means sit at ~0.16 with
// a hard floor at 0, so recession is range-compressed (a -0.03 move is ~20%
// of the founder value and well above sampling noise at pop 150-380, while
// larger sustained drops are common); elevation is unbounded above (range to
// 1.5), so claiming "elevated" requires a +0.05 move that survives 40k ticks
// of mutation-selection balance. Resistance uses symmetric +/-0.02 because
// it moves in both directions across runs with no floor compression
// (founders ~0.16-0.20, observed range 0.15-0.22).
function labelOutcome(first: any, last: any): string {
  if (last.population === 0) return "extinction";
  const dSec = last.secretionMean - first.secretionMean;
  const dRes = last.resistanceMean - first.resistanceMean;
  const sec = dSec <= -0.03 ? "secretion-receded" : dSec >= 0.05 ? "secretion-elevated" : "secretion-floor";
  const res = dRes >= 0.02 ? "resistance-rose" : dRes <= -0.02 ? "resistance-fell" : "resistance-stable";
  return `${sec}+${res}`;
}

function surveyRun(regime: Regime, seed: number): any {
  const session = new UniverseSession();
  session.create(config(seed, regime));
  const trajectory: any[] = [];
  for (let t = SAMPLE_EVERY; t <= HORIZON; t += SAMPLE_EVERY) {
    settle(session, t);
    trajectory.push(sample(session));
    if (session.snapshot().population === 0) break;
  }
  const final = session.snapshot();
  const fm: any = final.metrics;
  return {
    engine: ENGINE_VERSION, regime, seed, horizon: HORIZON,
    tick: final.tick, finalPopulation: final.population,
    extinct: fm.extinct_tick !== null && fm.extinct_tick !== undefined,
    outcome: fm.ecological_outcome,
    firstSample: trajectory[0],
    lastSample: trajectory[trajectory.length - 1],
    descriptiveOutcome: labelOutcome(trajectory[0], trajectory[trajectory.length - 1]),
    trajectory,
  };
}

// Within-world strain competition: freeze evolution, pin half the organisms
// hi and half lo for one trait, step, compare shares. Frozen traits make the
// end shares a direct fitness reading (secretion-hi extinction = causal
// cost-driven failure; resistance-hi sweep = causal counter-advantage).
function strainAssay(regime: Regime, seed: number, trait: "in" | "re", hi: number): any {
  const session = new UniverseSession();
  session.create(config(seed, regime));
  settle(session, ASSAY_BASE);
  const base = sample(session);
  const sim: any = session.simulation;
  sim.c.mr = 0;
  const b = sim.clone();
  b.c.mr = 0;
  const orgs = [...b.o].sort((a: any, c: any) => a.id - c.id);
  orgs.forEach((o: any, i: number) => { o[trait] = i % 2 === 0 ? hi : 0; });
  const hi0 = Math.ceil(orgs.length / 2);
  for (let k = 0; k < ASSAY_TICKS; k++) b.step();
  let hiN = 0, loN = 0;
  for (const o of b.o as any[]) { if ((o[trait] as number) > hi / 2) hiN++; else loN++; }
  return {
    engine: ENGINE_VERSION, kind: "strain-competition", regime, seed, trait, hiValue: hi,
    baseTick: base.tick, basePopulation: base.population, baseInhibitor: base.inhibitorFraction,
    assayTicks: ASSAY_TICKS, hiStart: hi0, loStart: orgs.length - hi0, hiEnd: hiN, loEnd: loN,
    hiShareEnd: hiN + loN > 0 ? +(hiN / (hiN + loN)).toFixed(4) : null,
    endPopulation: hiN + loN,
  };
}

// Branch assay under forced heavy exposure: pin secretion high for all,
// resistance high vs zero, frozen evolution. Tests whether the resistance
// counter-advantage is conditional on resource regime (rich vs harsh).
function forcedExposureAssay(regime: Regime, seed: number): any {
  const session = new UniverseSession();
  session.create(config(seed, regime));
  settle(session, ASSAY_BASE);
  const base = sample(session);
  const sim: any = session.simulation;
  sim.c.mr = 0;
  const mk = (re: number) => {
    const b = sim.clone();
    b.c.mr = 0;
    for (const o of b.o as any[]) { o.in = 1.0; o.re = re; }
    return b;
  };
  const hiR = mk(1.0), loR = mk(0);
  for (let k = 0; k < ASSAY_TICKS; k++) { hiR.step(); loR.step(); }
  const hm: any = hiR.metrics(), lm: any = loR.metrics();
  return {
    engine: ENGINE_VERSION, kind: "forced-exposure", regime, seed,
    baseTick: base.tick, basePopulation: base.population, assayTicks: ASSAY_TICKS,
    resistantPopulation: hm.population, sensitivePopulation: lm.population,
    resistantInhibitor: +hm.inhibitor.fraction.toFixed(4),
    delta: hm.population - lm.population,
  };
}

function perfProbe(): any {
  const session = new UniverseSession();
  session.create(config(821947219, "balanced"));
  settle(session, ASSAY_BASE);
  const sim: any = session.simulation;
  const active = sim.clone();
  const silent = sim.clone();
  // Like-for-like: evolution frozen in BOTH branches (mr-confound fix --
  // previously only the silent branch was frozen, so the active branch kept
  // evolving during the timed window while the silent branch did not; the
  // timed difference now isolates trait EXPRESSION only). Active keeps its
  // evolved secretion/resistance; silent pins both to zero.
  active.c.mr = 0;
  silent.c.mr = 0;
  for (const o of silent.o as any[]) { o.in = 0; o.re = 0; }
  const popBefore = active.o.length;
  let t0 = performance.now();
  for (let k = 0; k < PERF_TICKS; k++) active.step();
  const activeMsPerTick = (performance.now() - t0) / PERF_TICKS;
  t0 = performance.now();
  for (let k = 0; k < PERF_TICKS; k++) silent.step();
  const silentMsPerTick = (performance.now() - t0) / PERF_TICKS;
  return {
    engine: ENGINE_VERSION, kind: "step-wall-time", regime: "balanced", seed: 821947219,
    baseTick: ASSAY_BASE, ticks: PERF_TICKS, startPopulation: popBefore,
    activeEndPopulation: active.o.length, silentEndPopulation: silent.o.length,
    activeMsPerTick: +activeMsPerTick.toFixed(4),
    silentMsPerTick: +silentMsPerTick.toFixed(4),
    // Silent still executes the interference code path (zero-quantity deposit
    // / exposure reads), so this is the cost of ACTIVE secretion-exposure-
    // suppression work, not of the code path itself.
    overhead: +((activeMsPerTick - silentMsPerTick) / silentMsPerTick).toFixed(4),
  };
}

const result: any = { engine: ENGINE_VERSION, horizon: HORIZON, runs: [], assays: [], perf: null, observations: {} };
try {
  const prior = JSON.parse(readFileSync(OUT, "utf8"));
  if (prior.engine === result.engine && prior.horizon === HORIZON && Array.isArray(prior.runs)) {
    result.runs = prior.runs;
    result.assays = Array.isArray(prior.assays) ? prior.assays : [];
    result.perf = prior.perf ?? null;
    console.log(`resuming: ${result.runs.length} runs, ${result.assays.length} assays already retained`);
  }
} catch { /* fresh run */ }

const done = new Set(result.runs.map((r: any) => `${r.regime}/${r.seed}`));
for (const { regime, seed } of SEEDS) {
  if (done.has(`${regime}/${seed}`)) {
    console.log(`${regime}/${seed}: already retained, skipping`);
    continue;
  }
  const row = surveyRun(regime, seed);
  result.runs.push(row);
  writeFileSync(OUT, JSON.stringify(result, null, 2));
  const f = row.firstSample, l = row.lastSample;
  console.log(
    `${regime}/${seed}@${row.tick} pop ${l.population} [${row.descriptiveOutcome}] ` +
    `sec ${f.secretionMean}->${l.secretionMean} res ${f.resistanceMean}->${l.resistanceMean} ` +
    `inh ${l.inhibitorFraction} sup ${l.suppressionShare} outcome ${row.outcome}`,
  );
}

const assayDone = new Set(result.assays.map((a: any) => `${a.kind}/${a.trait ?? "na"}/${a.regime}/${a.seed}`));
function need(kind: string, trait: string, regime: string, seed: number): boolean {
  return !assayDone.has(`${kind}/${trait}/${regime}/${seed}`);
}
const assaySpecs: Array<() => any> = [];
if (need("strain-competition", "in", "balanced", 222222222)) assaySpecs.push(() => strainAssay("balanced", 222222222, "in", 1.0));
if (need("strain-competition", "re", "balanced", 222222222)) assaySpecs.push(() => strainAssay("balanced", 222222222, "re", 1.0));
if (need("strain-competition", "in", "harsh", 821947219)) assaySpecs.push(() => strainAssay("harsh", 821947219, "in", 1.0));
if (need("strain-competition", "re", "harsh", 821947219)) assaySpecs.push(() => strainAssay("harsh", 821947219, "re", 1.0));
if (need("forced-exposure", "na", "balanced", 821947219)) assaySpecs.push(() => forcedExposureAssay("balanced", 821947219));
if (need("forced-exposure", "na", "harsh", 821947219)) assaySpecs.push(() => forcedExposureAssay("harsh", 821947219));
for (const run of assaySpecs) {
  const row = run();
  result.assays.push(row);
  writeFileSync(OUT, JSON.stringify(result, null, 2));
  if (row.kind === "strain-competition") {
    console.log(`assay ${row.trait}/${row.regime}/${row.seed}: hi ${row.hiStart}->${row.hiEnd}, lo ${row.loStart}->${row.loEnd} (share ${row.hiShareEnd})`);
  } else {
    console.log(`assay forced-exposure ${row.regime}/${row.seed}: resistant ${row.resistantPopulation} vs sensitive ${row.sensitivePopulation} (delta ${row.delta})`);
  }
}

if (!result.perf) {
  result.perf = perfProbe();
  writeFileSync(OUT, JSON.stringify(result, null, 2));
}
const p = result.perf;
console.log(`perf: active ${p.activeMsPerTick} ms/tick (pop ${p.startPopulation}->${p.activeEndPopulation}) vs silent ${p.silentMsPerTick} ms/tick (->${p.silentEndPopulation}); overhead ${p.overhead}`);

// Reported, never asserted: counts say where each pattern did and did not appear.
const runs: any[] = result.runs;
const strains = result.assays.filter((a: any) => a.kind === "strain-competition");
const forced = result.assays.filter((a: any) => a.kind === "forced-exposure");
result.observations = {
  secretionRecededOrFloor: runs.filter((r) => String(r.descriptiveOutcome).startsWith("secretion-receded") || String(r.descriptiveOutcome).startsWith("secretion-floor")).length,
  secretionElevated: runs.filter((r) => String(r.descriptiveOutcome).startsWith("secretion-elevated")).map((r) => `${r.regime}/${r.seed}`),
  resistanceRose: runs.filter((r) => String(r.descriptiveOutcome).includes("resistance-rose")).length,
  extinct: runs.filter((r) => r.extinct).length,
  secretionHiStrainShareEnd: strains.filter((a: any) => a.trait === "in").map((a: any) => `${a.regime}/${a.seed}:${a.hiShareEnd}`),
  resistanceHiStrainShareEnd: strains.filter((a: any) => a.trait === "re").map((a: any) => `${a.regime}/${a.seed}:${a.hiShareEnd}`),
  forcedExposureDelta: forced.map((a: any) => `${a.regime}/${a.seed}:${a.delta}`),
  // Legs below are DERIVED from the retained assay data by the stated rules
  // (not author verdicts): secretionAdvantage holds iff any secretion-hi
  // strain ends above 0.5 share; costFailure holds iff every secretion-hi
  // strain ends below 0.5; resistanceCounterAdvantage holds iff every
  // resistance-hi strain ends above 0.5. Follow-up combo-genotype and
  // local-field investigations (probe3/7/8/9) are reported in task-6-report
  // follow-up; none overturns these readings (see DESIGN TENSION note).
  secretionAdvantageDemonstrated: strains.filter((a: any) => a.trait === "in").some((a: any) => (a.hiShareEnd ?? 0) > 0.5),
  costFailureDemonstrated: strains.filter((a: any) => a.trait === "in").every((a: any) => (a.hiShareEnd ?? 1) < 0.5),
  resistanceCounterAdvantageDemonstrated: strains.filter((a: any) => a.trait === "re").every((a: any) => (a.hiShareEnd ?? 0) > 0.5),
  of: runs.length,
};
writeFileSync(OUT, JSON.stringify(result, null, 2));
console.log(`interference survey: DONE -> ${OUT} (${runs.length} runs, ${result.assays.length} assays)`);
console.log(JSON.stringify(result.observations, null, 2));
