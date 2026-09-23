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
//
// Usage: pnpm test:survey [-- --ticks=250000 --out=ecology-survey.json]
// Full 4-seed x 3-regime x 250k survey is CI-scale (~30 min on a phone);
// use small --ticks for local smoke tests.

type Regime = "balanced" | "patchwork" | "harsh";

const PRESETS: Record<Regime, { rich: number; patch: number; resdiv: number; pop: number; div: number; mr: number; press: number }> = {
  balanced: { rich: 0.60, patch: 0.60, resdiv: 1.0, pop: 30, div: 0.35, mr: 0.03, press: 0.45 },
  patchwork: { rich: 0.68, patch: 0.90, resdiv: 1.0, pop: 34, div: 0.45, mr: 0.03, press: 0.42 },
  harsh: { rich: 0.38, patch: 0.55, resdiv: 0.80, pop: 30, div: 0.35, mr: 0.04, press: 0.78 },
};

const SEEDS = [821947219, 2088626459, 3543950664, 2121676508];
const REGIMES: Regime[] = ["balanced", "patchwork", "harsh"];

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
const CHUNK = 5000;

const runs: any[] = [];
for (const regime of REGIMES) {
  for (const seed of SEEDS) {
    const session = new UniverseSession();
    session.create(config(seed, regime));
    let maxDormant = 0, maxCross = 0, maxCEnergy = 0;
    let maxPopulation = 0, minPopulation = Infinity;
    for (let done = 0; done < TICKS; done += CHUNK) {
      const snapshot = session.advance(Math.min(CHUNK, TICKS - done));
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
    const rows = {
      regime, seed, tick: final.tick, finalPopulation: final.population,
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
    runs.push(rows);
    console.log(`${regime}/${seed}: tick ${rows.tick}, pop ${rows.finalPopulation}, outcome ${rows.outcome}`);
  }
}

const result = {
  engine: "0.19.0",
  ticks: TICKS,
  regimes: REGIMES,
  seeds: SEEDS,
  runs,
  observations: {
    distinctFinalPopulations: new Set(runs.map((r) => r.finalPopulation)).size,
    dormancyObserved: runs.some((r) => r.maxDormantFraction > 0),
    crossfeedingObserved: runs.some((r) => r.maxCrossfeederFraction >= 0.04 || r.maxCEnergyShare >= 0.035),
    extinctionObserved: runs.some((r) => r.extinct),
    partitioningObserved: runs.some((r) => String(r.outcome).includes("partitioning")),
    ecologyRecordsObserved: runs.some((r) => r.analysisRecords > 0),
  },
};
writeFileSync(OUT, JSON.stringify(result, null, 2));
console.log(`ecology survey: DONE -> ${OUT}`);
