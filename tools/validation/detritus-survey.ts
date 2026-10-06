import { readFileSync, writeFileSync } from "node:fs";
import { UniverseSession } from "../../packages/sim-runtime/src/session.ts";
import type { EngineConfig } from "../../packages/contracts/src/index.ts";
import { ENGINE_VERSION } from "../../packages/sim-core/src/index.ts";

/**
 * Foundation Slice 2 regime survey: detritus dynamics across fixed seeds on
 * the three calibration configs (patchwork / balanced / harsh). Specialism,
 * succession, abundance-only use, and absence are ALL retained as evidence;
 * nothing here asserts a target frequency. Deterministic: re-running
 * reproduces every row bit-for-bit.
 *
 * Manual run (NOT part of `pnpm verify` — too long for the gate):
 *   pnpm exec tsx tools/validation/detritus-survey.ts
 * Retains to testdata/detritus-survey-0.26.json (resume-safe). The
 * detritus gate checks the retained artifact in. The 0.25 file stays as
 * historical provenance; seeds, configs, horizon, response classes, and
 * niche-sweep fields are unchanged between survey generations.
 */

const OUT = "testdata/detritus-survey-0.26.json";
const SEEDS = [24681357, 821947219, 3543950664, 111111111, 222222222, 333333333];
const HORIZON = 100000;

function config(name: string, seed: number): EngineConfig {
  const base = {
    seed, cap: 360, pop: 30, div: 0.35, mr: 0.03,
    ms: 0.12, press: 1.0875, patch: 0.6, resource_b_fraction: 0.5, cat: "global", st: null,
    resource_model: "definition_driven_substances", resource_grid: 60,
    enable_byproduct: true, enable_dormancy: true, study: true,
  } as const;
  if (name === "patchwork") return { ...base, start: 0.62, prod: 0.86, patch: 0.9, pop: 34, div: 0.45 };
  if (name === "harsh") return { ...base, start: 0.47, prod: 0.52, patch: 0.55 };
  return { ...base, start: 0.58, prod: 0.77 };
}

function settle(session: UniverseSession, target: number): void {
  for (let i = 0; i < 2000 && session.snapshot().tick < target; i++) {
    const snapshot = session.advance(1000);
    const pending = snapshot.pendingDecision;
    if (pending) session.resolveEventDecision(pending.opportunityId, "keep-watching");
  }
  const leftover = session.snapshot().pendingDecision;
  if (leftover) session.resolveEventDecision(leftover.opportunityId, "keep-watching");
}

const result: any = {
  engine: ENGINE_VERSION,
  horizon: HORIZON,
  rule: "response classes: specialization (sustained detritivore share), succession (hotspot + consumption response), abundance-only (use without structure), absent (no use)",
  rows: [],
};
try {
  const prior = JSON.parse(readFileSync(OUT, "utf8"));
  if (prior.engine === result.engine && Array.isArray(prior.rows)) {
    result.rows = prior.rows;
    console.log(`resuming: ${result.rows.length} rows already retained`);
  }
} catch { /* fresh run */ }
const done = new Set(result.rows.map((r: any) => `${r.config}/${r.seed}`));

for (const name of ["patchwork", "balanced", "harsh"]) {
  for (const seed of SEEDS) {
    if (done.has(`${name}/${seed}`)) {
      console.log(`${name}/${seed}: already retained, skipping`);
      continue;
    }
    const session = new UniverseSession();
    session.create(config(name, seed));
    let detMax = 0, detrivMaxShare = 0, eDet = 0, execs = 0;
    let duBase = -1, duMax = 0, wasteMax = 0;
    for (let i = 0; i < 2000 && session.snapshot().tick < HORIZON; i++) {
      const snapshot = session.advance(1000);
      const pending = snapshot.pendingDecision;
      if (pending) session.resolveEventDecision(pending.opportunityId, "keep-watching");
      const sim = session.simulation as any;
      const m = session.snapshot().metrics as any;
      const t = sim.resources.detritus.totals();
      detMax = Math.max(detMax, t.stock);
      wasteMax = Math.max(wasteMax, m.waste.fraction);
      const roles = m.metabolic_roles.counts;
      const share = m.population ? (roles.detritivore || 0) / m.population : 0;
      detrivMaxShare = Math.max(detrivMaxShare, share);
      if (duBase < 0) duBase = m.traits.detritus_use.mean;
      duMax = Math.max(duMax, m.traits.detritus_use.mean);
      const L = sim.last;
      eDet += L.energy_detritus || 0;
      execs += L.detritus_exec || 0;
    }
    const leftover = session.snapshot().pendingDecision;
    if (leftover) session.resolveEventDecision(leftover.opportunityId, "keep-watching");
    const sim = session.simulation as any;
    const m = session.snapshot().metrics as any;
    const t = sim.resources.detritus.totals();
    // Niche-reachability sweep (2B §9): the same runs double as the bounded
    // search for Waste niche construction under detritus wealth. Track waste
    // peak + niche records per row; 0 establishments across all rows feeds
    // the TENSION verdict, any establishment feeds the two-layer re-pin.
    const nrecs = ((session.analysis as any).records as any[]).filter((r: any) => r.kind === "niche");
    const nicheEst = nrecs.filter((r: any) => r.phase === "established").map((r: any) => r.tick);
    // Hotspot flag: top-decile mass share (uniform field = 0.10).
    const arr = Array.from(sim.resources.detritus.stock as Float32Array).sort((a: number, b: number) => b - a);
    const sum = arr.reduce((a: number, b: number) => a + b, 0);
    const hotspot = sum > 0 && arr.slice(0, 360).reduce((a: number, b: number) => a + b, 0) / sum > 0.3;
    const minIn = sim.resources.biologicalProduction[0] + sim.resources.biologicalProduction[1];
    const regIn = sim.resources.input[0] + sim.resources.input[1];
    const entry: any = {
      config: name, seed, horizon: session.snapshot().tick,
      detMax: +detMax.toFixed(1),
      detFinal: +t.stock.toFixed(1),
      detCapFraction: +(t.capacity ? t.stock / t.capacity : 0).toFixed(4),
      detrivMaxShare: +detrivMaxShare.toFixed(4),
      duBase: +duBase.toFixed(4),
      duFinal: +m.traits.detritus_use.mean.toFixed(4),
      duMax: +duMax.toFixed(4),
      hotspot,
      energyDetritus: +eDet.toFixed(1),
      detritusExecs: execs,
      mineralShareAB: +(minIn / Math.max(1, minIn + regIn)).toFixed(3),
      population: m.population,
      wasteMax: +wasteMax.toFixed(4),
      nicheState: (session.analysis as any).niche.state,
      nicheEstablished: nicheEst,
    };
    entry.response =
      entry.detrivMaxShare >= 0.05 ? "specialization" :
      hotspot && eDet > 0 ? "succession" :
      eDet > 0 ? "abundance-only" : "absent";
    result.rows.push(entry);
    writeFileSync(OUT, JSON.stringify(result, null, 2) + "\n");
    console.log(`${name}/${seed}: ${entry.response} detMax=${entry.detMax} detriv=${entry.detrivMaxShare} du=${entry.duBase}->${entry.duFinal} pop=${entry.population}`);
  }
}

console.log(`detritus survey retained: ${result.rows.length} rows -> ${OUT} (engine ${ENGINE_VERSION})`);
