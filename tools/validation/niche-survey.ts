import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { UniverseSession } from "../../packages/sim-runtime/src/session.ts";
import type { EngineConfig } from "../../packages/contracts/src/index.ts";
import { ENGINE_VERSION } from "../../packages/sim-core/src/index.ts";

/**
 * Issue #30 Slice 2 multi-seed evidence: niche-construction survey across
 * fixed seeds on the three calibration configs (patchwork / balanced /
 * harsh). Establishment, response types, weak responses, and
 * non-establishment are ALL retained as evidence; nothing here asserts a
 * target frequency. Deterministic: re-running reproduces every row
 * bit-for-bit.
 *
 * Manual run (NOT part of `pnpm verify` — too long for the gate):
 *   pnpm exec tsx tools/validation/niche-survey.ts
 * Retains to testdata/niche-survey-0.22.json (resume-safe). The fast gate
 * in tools/validation/niche.ts checks the retained artifact in.
 */

const OUT = "testdata/niche-survey-0.22.json";
const SEEDS = [24681357, 821947219, 3543950664, 111111111, 222222222, 333333333, 444444444, 555555555];
const HORIZON = 150000;
const ASSAY_TICKS = 15000;

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
  assayTicks: ASSAY_TICKS,
  rule: "establishment needs persistent modification plus a durable tolerance/cleanup composition shift; exposure is supporting context only",
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
    let baseTol = -1, baseCu = -1, maxTolD = 0, maxCuD = 0, maxWaste = 0;
    // Matched counterfactual is anchored at ESTABLISHMENT (the first
    // established record), not at the horizon end: forking a world that has
    // already disrupted measures the wrong regime. Clones only — the main
    // run is never perturbed by the assay.
    let assay: any = null;
    for (let i = 0; i < 2000 && session.snapshot().tick < HORIZON; i++) {
      const snapshot = session.advance(1000);
      const pending = snapshot.pendingDecision;
      if (pending) session.resolveEventDecision(pending.opportunityId, "keep-watching");
      const m = session.snapshot().metrics as any;
      if (m.waste.fraction >= 0.05 && baseTol < 0) {
        baseTol = m.traits.tolerance.mean;
        baseCu = m.traits.cleanup.mean;
      }
      if (baseTol >= 0) {
        maxTolD = Math.max(maxTolD, m.traits.tolerance.mean - baseTol);
        maxCuD = Math.max(maxCuD, m.traits.cleanup.mean - baseCu);
      }
      maxWaste = Math.max(maxWaste, m.waste.fraction);
      if (!assay) {
        const established = (((session.analysis as any).records as any[])
          .find((r: any) => r.kind === "niche" && r.phase === "established") ?? null) as any;
        if (established) {
          const sim = session.simulation as any;
          const kept = sim.clone();
          const clean = sim.clone();
          clean.resources.enabledWaste = false;
          clean.resources.waste.stock.fill(0);
          for (let k = 0; k < ASSAY_TICKS; k++) {
            kept.step();
            clean.step();
          }
          const km = kept.metrics();
          const cm = clean.metrics();
          const popGap = Math.abs(cm.population - km.population) / km.population;
          assay = {
            anchoredAt: established.tick,
            assayTicks: ASSAY_TICKS,
            keptWaste: +km.waste.fraction.toFixed(4),
            cleanWaste: +cm.waste.fraction.toFixed(4),
            keptCu: +km.traits.cleanup.mean.toFixed(4),
            cleanCu: +cm.traits.cleanup.mean.toFixed(4),
            cuDelta: +(km.traits.cleanup.mean - cm.traits.cleanup.mean).toFixed(4),
            keptTol: +km.traits.tolerance.mean.toFixed(4),
            cleanTol: +cm.traits.tolerance.mean.toFixed(4),
            tolDelta: +(km.traits.tolerance.mean - cm.traits.tolerance.mean).toFixed(4),
            keptPop: km.population,
            cleanPop: cm.population,
            popGap: +popGap.toFixed(4),
          };
          // Observed matched-response class: material reliance, weak/no
          // effect, or confounded (populations not comparable). Weak is
          // wanted evidence, not something to manufacture.
          assay.response = popGap >= 0.2
            ? "confounded"
            : assay.cuDelta > 0.03 ? "material" : "weak";
        }
      }
    }
    const leftover = session.snapshot().pendingDecision;
    if (leftover) session.resolveEventDecision(leftover.opportunityId, "keep-watching");
    const niche = (session.analysis as any).niche;
    const records = ((session.analysis as any).records as any[])
      .filter((r: any) => r.kind === "niche")
      .map((r: any) => ({ phase: r.phase, tick: r.tick, refs: r.entity_refs }));
    const m = session.snapshot().metrics as any;
    const exposedFinal = +((m.waste_exposed_share ?? 0)).toFixed(4);
    const entry: any = {
      config: name, seed, horizon: session.snapshot().tick,
      nicheState: niche.state, records,
      wasteMax: +maxWaste.toFixed(4),
      wasteFinal: +m.waste.fraction.toFixed(4),
      exposedFinal,
      tolBase: baseTol < 0 ? null : +baseTol.toFixed(4),
      tolMaxDelta: +maxTolD.toFixed(4),
      cuBase: baseCu < 0 ? null : +baseCu.toFixed(4),
      cuMaxDelta: +maxCuD.toFixed(4),
      tolFinal: +m.traits.tolerance.mean.toFixed(4),
      cuFinal: +m.traits.cleanup.mean.toFixed(4),
      population: m.population,
    };
    // Observed response label per row (data, never a frequency claim).
    entry.response =
      records.length > 0 ? "established" :
      baseTol < 0 ? "no-modification" :
      maxTolD >= 0.05 || maxCuD >= 0.05 ? "strategy-shift-without-establishment" :
      maxWaste >= 0.05 ? "exposure-without-strategy-shift" : "no-response";
    entry.assay = assay ?? { applicable: false, reason: records.length > 0 ? "assay window ended before an establishment observation" : "no established regime to fork" };
    result.rows.push(entry);
    writeFileSync(OUT, JSON.stringify(result, null, 2) + "\n");
    const assayLabel = entry.assay.applicable === false
      ? "n/a"
      : `${entry.assay.response}(cuΔ ${entry.assay.cuDelta})`;
    console.log(`${name}/${seed}: ${entry.response} recs=${records.length} assay=${assayLabel}`);
  }
}

console.log(`niche survey retained: ${result.rows.length} rows -> ${OUT} (engine ${ENGINE_VERSION})`);
