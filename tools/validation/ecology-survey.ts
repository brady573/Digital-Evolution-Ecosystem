import { writeFileSync } from "node:fs";
import { UniverseSession } from "../../packages/sim-runtime/src/session.ts";
import type { EngineConfig } from "../../packages/contracts/src/index.ts";

// Multi-seed ecological survey on engine 0.19.0, mirroring the v0.28.2
// headless validation design (shared seeds x regimes, long runs).
//
// Regime inference (prototype defaults, NOT the approximations in ecology.ts):
// - legacy/prototype/digital_evolution_prototype_v0_28_2.html PRESETS:
//   balanced {rich:60,patch:60,resdiv:100,pop:30,var:35,mut:3,press:45},
//   patchwork {rich:68,patch:90,resdiv:100,pop:34,var:45,mut:3,press:42},
//   harsh {rich:38,patch:55,resdiv:80,pop:30,var:35,mut:4,press:78}
//   (sliders are 0-100; resdiv maps to resource_b_fraction = resdiv/100*.5)
// - Engine mapping matches presetCalibrationConfig in the same file and
//   configFromSettings in apps/explorer/src/App.tsx:
//   start=.25+rich*.55, prod=.08+rich*1.15, press=.75+(press/100)*.75.
// - Seeds reuse observed long-run seeds, including the repo default 821947219.
// - Severe regime is INFERRED (no prototype preset; the v0.28.2 report's
//   Severe diagnostics have no published parameters): harsher than harsh
//   along the same axes, intended to probe collapse/extinction. A non-collapse
//   result is valid evidence, not a failure.
// - Trait-replay assay mirrors the report's evolved-trait counterfactual:
//   evolve, clone, disable mutation in both branches, revert one branch to
//   founder-mean traits, compare abundance and partitioning.
//
// Usage:
//   pnpm test:survey -- --ticks=250000 --out=ecology-survey.json [--full]
// --full adds severe x seeds x 120k plus patchwork assay x seeds
// (evolve 150k + branch 100k). Full run is CI-scale; default is standard
// regimes only. Use small --ticks for local smoke tests.

type Regime = "balanced" | "patchwork" | "harsh" | "severe";

const PRESETS: Record<Regime, { rich: number; patch: number; resdiv: number; pop: number; div: number; mr: number; press: number }> = {
  balanced: { rich: 0.60, patch: 0.60, resdiv: 1.0, pop: 30, div: 0.35, mr: 0.03, press: 0.45 },
  patchwork: { rich: 0.68, patch: 0.90, resdiv: 1.0, pop: 34, div: 0.45, mr: 0.03, press: 0.42 },
  harsh: { rich: 0.38, patch: 0.55, resdiv: 0.80, pop: 30, div: 0.35, mr: 0.04, press: 0.78 },
  severe: { rich: 0.25, patch: 0.50, resdiv: 0.60, pop: 30, div: 0.30, mr: 0.04, press: 0.95 },
};

const SEEDS = [821947219, 2088626459, 3543950664, 2121676508];
const REGIMES: Regime[] = ["balanced", "patchwork", "harsh"];
const SEVERE_TICKS = 120000;
const ASSAY_EVOLVE = 150000;
const ASSAY_BRANCH = 100000;
const TRAIT_KEYS = ["sp", "se", "me", "rp", "di", "ha", "bu", "dr"] as const;

function config(seed: number, regime: Regime): EngineConfig {
  const p = PRESETS[regime];
  return {
    seed: seed >>> 0,
    start: 0.25 + p.rich * 0.55,
    prod: 0.08 + p.rich * 1.15,
    cap: 360,
    pop: p.pop,
    div: p.div,
    mr: p.mr,
    ms: 0.12,
    press: 0.75 + p.press * 0.75,
    patch: p.patch,
    resource_b_fraction: p.resdiv * 0.5,
    cat: "global",
    st: null,
    resource_model: "definition_driven_substances",
    resource_grid: 60,
    enable_byproduct: true,
    enable_dormancy: true,
    study: true,
  };
}

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const TICKS = Math.max(1000, Math.floor(Number(arg("ticks", "250000"))));
const OUT = arg("out", "ecology-survey.json");
const FULL = process.argv.includes("--full");
const CHUNK = 5000;

function surveyRun(session: UniverseSession, ticks: number): any {
  let maxDormant = 0, maxCross = 0, maxCEnergy = 0;
  let maxPopulation = 0, minPopulation = Infinity;
  for (let done = 0; done < ticks; done += CHUNK) {
    const snapshot = session.advance(Math.min(CHUNK, ticks - done));
    const m: any = snapshot.metrics;
    maxDormant = Math.max(maxDormant, m.dormant_fraction || 0);
    maxCross = Math.max(maxCross, m.metabolic_roles?.crossfeeder_fraction || 0);
    maxCEnergy = Math.max(maxCEnergy, m.resource_energy?.c_share || 0);
    maxPopulation = Math.max(maxPopulation, m.population);
    minPopulation = Math.min(minPopulation, m.population);
    if (m.population === 0) break;
  }
  const final = session.snapshot();
  const fm: any = final.metrics;
  return {
    tick: final.tick, finalPopulation: final.population,
    minPopulation: minPopulation === Infinity ? 0 : minPopulation, maxPopulation,
    extinct: fm.extinct_tick !== null && fm.extinct_tick !== undefined,
    extinctTick: fm.extinct_tick ?? null,
    peakPopulation: fm.peak_population, outcome: fm.ecological_outcome,
    effectiveNiches: fm.effective_niches, maxDormantFraction: maxDormant,
    maxCrossfeederFraction: maxCross, maxCEnergyShare: maxCEnergy,
    metaboliteCProduced: fm.metabolite_c?.produced ?? 0,
    analysisRecords: (final.analysis.records as any[]).length,
    eras: (final.analysis.eras as any[]).length,
  };
}

const runs: any[] = [];
for (const regime of REGIMES) {
  for (const seed of SEEDS) {
    const session = new UniverseSession();
    session.create(config(seed, regime));
    const row = { regime, seed, ...surveyRun(session, TICKS) };
    runs.push(row);
    console.log(`${regime}/${seed}: tick ${row.tick}, pop ${row.finalPopulation}, outcome ${row.outcome}`);
  }
}

const severeRuns: any[] = [];
if (FULL) {
  for (const seed of SEEDS) {
    const session = new UniverseSession();
    session.create(config(seed, "severe"));
    const row = { regime: "severe", seed, ...surveyRun(session, SEVERE_TICKS) };
    severeRuns.push(row);
    console.log(`severe/${seed}: tick ${row.tick}, pop ${row.finalPopulation}, extinct=${row.extinct}, outcome ${row.outcome}`);
  }
}

const assays: any[] = [];
if (FULL) {
  for (const seed of SEEDS) {
    const session = new UniverseSession();
    session.create(config(seed, "patchwork"));
    const sim: any = session.simulation;
    const founderMeans: Record<string, number> = {};
    for (const k of TRAIT_KEYS) {
      founderMeans[k] = sim.o.reduce((s: number, o: any) => s + (o[k] || 0), 0) / Math.max(1, sim.o.length);
    }
    session.advance(ASSAY_EVOLVE);
    const atFork = session.snapshot();
    sim.c.mr = 0;
    const reverted: any = sim.clone();
    reverted.c.mr = 0;
    for (const o of reverted.o) for (const k of TRAIT_KEYS) o[k] = founderMeans[k];
    for (let done = 0; done < ASSAY_BRANCH; done += CHUNK) {
      session.advance(Math.min(CHUNK, ASSAY_BRANCH - done));
      for (let i = 0; i < Math.min(CHUNK, ASSAY_BRANCH - done); i++) reverted.step();
    }
    const evolvedFinal: any = session.snapshot();
    const revertedMetrics: any = reverted.metrics();
    const row = {
      seed, forkTick: atFork.tick, forkPopulation: atFork.population,
      evolvedPopulation: evolvedFinal.population, revertedPopulation: reverted.o.length,
      abundanceDelta: evolvedFinal.population - reverted.o.length,
      evolvedOutcome: evolvedFinal.metrics.ecological_outcome,
      revertedOutcome: revertedMetrics.ecological_outcome,
      evolvedCrossfeeder: evolvedFinal.metrics.metabolic_roles?.crossfeeder_fraction ?? 0,
      revertedCrossfeeder: revertedMetrics.metabolic_roles?.crossfeeder_fraction ?? 0,
    };
    assays.push(row);
    console.log(`assay/${seed}: evolved ${row.evolvedPopulation} vs reverted ${row.revertedPopulation} (delta ${row.abundanceDelta})`);
  }
}

const result = {
  engine: "0.19.0",
  ticks: TICKS,
  full: FULL,
  regimes: REGIMES,
  seeds: SEEDS,
  runs,
  severeRuns,
  assays,
  observations: {
    distinctFinalPopulations: new Set(runs.map((r) => r.finalPopulation)).size,
    dormancyObserved: runs.some((r) => r.maxDormantFraction > 0),
    crossfeedingObserved: runs.some((r) => r.maxCrossfeederFraction >= 0.04 || r.maxCEnergyShare >= 0.035),
    extinctionObserved: runs.some((r) => r.extinct) || severeRuns.some((r) => r.extinct),
    partitioningObserved: runs.some((r) => String(r.outcome).includes("partitioning")),
    ecologyRecordsObserved: runs.some((r) => r.analysisRecords > 0),
  },
};
writeFileSync(OUT, JSON.stringify(result, null, 2));
console.log(`ecology survey: DONE -> ${OUT}`);
