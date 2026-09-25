import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { UniverseSession } from "../../packages/sim-runtime/src/session.ts";
import type { EngineConfig } from "../../packages/contracts/src/index.ts";
import { ENGINE_VERSION } from "../../packages/sim-core/src/index.ts";

/**
 * Issue #30 Stage 2 Level-3 multi-seed evidence: matched C-washout assays
 * across fixed seeds on the balanced config. Establishment, material
 * response, weak response, and non-establishment are ALL retained as
 * evidence; nothing here asserts a target frequency. Deterministic:
 * re-running reproduces every row bit-for-bit.
 *
 * Usage: pnpm exec tsx tools/validation/washout-reliance.ts
 * Retains to testdata/washout-reliance-0.20.json (resume-safe).
 */

const OUT = "testdata/washout-reliance-0.21.json";
const SEEDS = [821947219, 2088626459, 3543950664, 2121676508, 111111111, 222222222, 333333333, 444444444];
const SETTLE_TICKS = 60000;
const EXTENDED_TICKS = 120000;
const ASSAY_TICKS = 15000;

function config(seed: number): EngineConfig {
  return {
    seed, start: 0.58, prod: 0.77, cap: 360, pop: 30, div: 0.35, mr: 0.03,
    ms: 0.12, press: 1.0875, patch: 0.6, resource_b_fraction: 0.5, cat: "global", st: null,
    resource_model: "definition_driven_substances", resource_grid: 60,
    enable_byproduct: true, enable_dormancy: true, study: true,
  };
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
  config: "balanced",
  settleTicks: SETTLE_TICKS,
  assayTicks: ASSAY_TICKS,
  intervention: { schemaVersion: 1, kind: "nutrient_disturbance", mode: "c_washout" },
  rows: [],
};
try {
  const prior = JSON.parse(readFileSync(OUT, "utf8"));
  if (prior.engine === result.engine && Array.isArray(prior.rows)) {
    result.rows = prior.rows;
    console.log(`resuming: ${result.rows.length} rows already retained`);
  }
} catch { /* fresh run */ }
const done = new Set(result.rows.filter((r: any) => r.applicable || r.extended).map((r: any) => r.seed));

for (const seed of SEEDS) {
  if (done.has(seed)) {
    console.log(`${seed}: already retained, skipping`);
    continue;
  }
  // Re-run rows that were non-applicable at 60k out to the extended horizon.
  const horizon = result.rows.some((r: any) => r.seed === seed) ? EXTENDED_TICKS : SETTLE_TICKS;
  const session = new UniverseSession();
  session.create(config(seed));
  settle(session, horizon);
  const established = ((session.analysis as any).records as any[]).filter(
    (r: any) => r.kind === "cuse" && r.phase === "established",
  );
  const entry: any = { seed, horizon };
  if (established.length === 0) {
    entry.applicable = false;
    entry.extended = horizon >= EXTENDED_TICKS;
    entry.reason = `no C-use guild established by ${horizon / 1000}k`;
    const prior = result.rows.findIndex((r: any) => r.seed === seed);
    if (prior >= 0) result.rows.splice(prior, 1);
    result.rows.push(entry);
  } else {
    session.createControlFork();
    const forkTick = session.snapshot().tick;
    session.applyIntervention(result.intervention, "reliance survey");
    const washTick = session.snapshot().tick;
    settle(session, washTick + ASSAY_TICKS);
    const snap = session.snapshot();
    const live = snap.metrics as any;
    const control = snap.control!.metrics as any;
    const liveShare = (live.metabolic_roles?.counts?.byproduct_scavenger || 0) / live.population;
    const controlShare = (control.metabolic_roles?.counts?.byproduct_scavenger || 0) / control.population;
    const liveRemovals = live.nutrient_field.accounting.removal_events as any[];
    const controlRemovals = control.nutrient_field.accounting.removal_events as any[];
    // Structural invariants hold on every row; the OUTCOME is evidence.
    assert.equal(controlRemovals.length, 0, `${seed}: control records no removals`);
    assert.ok(liveRemovals.some((e: any) => e.type === "cWashout"), `${seed}: washout recorded`);
    assert.ok(liveRemovals.every((e: any) => e.type === "cWashout"), `${seed}: C-only removals`);
    const stale = result.rows.findIndex((r: any) => r.seed === seed);
    if (stale >= 0) result.rows.splice(stale, 1);
    result.rows.push({
      seed, horizon, applicable: true, forkTick, washTick,
      establishedTick: established[0].tick,
      livePopulation: live.population, controlPopulation: control.population,
      liveScavengerShare: liveShare, controlScavengerShare: controlShare,
      liveCStock: live.metabolite_c.stock, controlCStock: control.metabolite_c.stock,
      materialResponse: liveShare < controlShare / 2,
    });
  }
  writeFileSync(OUT, JSON.stringify(result, null, 2));
  const row = result.rows[result.rows.length - 1];
  assert.equal(row.seed, seed, "just-written row belongs to this seed");
  console.log(
    row.applicable
      ? `${seed}: live ${(row.liveScavengerShare * 100).toFixed(1)}% vs control ${(row.controlScavengerShare * 100).toFixed(1)}% material=${row.materialResponse}`
      : `${seed}: not applicable (${row.reason})`,
  );
}

const applicable = result.rows.filter((r: any) => r.applicable);
for (const seed of SEEDS) {
  assert.ok(result.rows.some((r: any) => r.seed === seed), `missing row for seed ${seed}`);
}
console.log(
  `washout reliance survey: DONE -> ${OUT} ` +
  `(${applicable.length}/${result.rows.length} applicable, ` +
  `material=${applicable.filter((r: any) => r.materialResponse).length})`,
);
