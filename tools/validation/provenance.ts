import { mkdirSync, writeFileSync } from "node:fs";
import { UniverseSession } from "../../packages/sim-runtime/src/session.ts";
import type { EngineConfig } from "../../packages/contracts/src/index.ts";
import { ENGINE_VERSION } from "../../packages/sim-core/src/index.ts";

/**
 * Issue #30 closure: provenance measurement for two accepted claims whose
 * cited evidence does not exist in the repository.
 *
 *   1. CATALYST_MIN_STOCK_FRACTION (0.08), documented in
 *      packages/sim-decisions/src/index.ts as being set against surveyed
 *      universes that "graze field stocks to a 1-15% equilibrium within a few
 *      thousand ticks in every config (balanced, patchwork, harsh, abundant)".
 *      The cited artifact (ecology-survey-0.20.json) records NO stock
 *      fractions at all, and is two engine versions stale.
 *
 *   2. testTradeoffHolds, documented in tools/validation/dependency.ts as
 *      having "~35% headroom over the highest surveyed maximum (0.73,
 *      abundant)". No retained artifact records byproduct_use maxima, and the
 *      cited scan is not in the repository.
 *
 * This tool measures both on the CURRENT engine across exactly the configs the
 * claims name, and retains the raw distributions. It asserts NOTHING about the
 * constants: the ruling is that the evidence is retained first, and only then
 * judged. Changing a constant on the strength of a mismatch is a separate,
 * explicitly-authorised step.
 *
 * Usage: pnpm exec tsx tools/validation/provenance.ts
 * Retains to testdata/provenance-<engine>.json.
 */

type Regime = "balanced" | "patchwork" | "harsh" | "abundant";

const PRESETS: Record<Regime, { rich: number; patch: number; resdiv: number; pop: number; div: number; mr: number; press: number }> = {
  balanced: { rich: 0.60, patch: 0.60, resdiv: 1.0, pop: 30, div: 0.35, mr: 0.03, press: 0.45 },
  patchwork: { rich: 0.68, patch: 0.90, resdiv: 1.0, pop: 34, div: 0.45, mr: 0.03, press: 0.42 },
  harsh: { rich: 0.38, patch: 0.55, resdiv: 0.80, pop: 30, div: 0.35, mr: 0.04, press: 0.78 },
  abundant: { rich: 3.20, patch: 0.60, resdiv: 1.0, pop: 30, div: 0.35, mr: 0.03, press: 0.45 },
};

const SEEDS = [821947219, 2088626459, 3543950664, 2121676508];
const REGIMES: Regime[] = ["balanced", "patchwork", "harsh", "abundant"];
const HORIZON = 60000;
/** The claim is about a settled equilibrium, so the first samples are dropped. */
const SETTLE = 5000;
const SAMPLE_EVERY = 500;

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

function quantile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

const summary = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: sorted.length,
    min: sorted[0]!,
    p01: quantile(sorted, 0.01),
    p05: quantile(sorted, 0.05),
    p25: quantile(sorted, 0.25),
    p50: quantile(sorted, 0.5),
    p75: quantile(sorted, 0.75),
    p95: quantile(sorted, 0.95),
    p99: quantile(sorted, 0.99),
    max: sorted[sorted.length - 1]!,
    mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
  };
};

const result: any = {
  engine: ENGINE_VERSION,
  purpose: "provenance for CATALYST_MIN_STOCK_FRACTION and testTradeoffHolds",
  horizon: HORIZON,
  settleTicks: SETTLE,
  sampleEvery: SAMPLE_EVERY,
  seeds: SEEDS,
  regimes: {},
};

for (const regime of REGIMES) {
  // Nutrient stock fractions (stock/capacity) and byproduct_use trait maxima,
  // pooled over seeds and post-settle sample points.
  const aFractions: number[] = [];
  const bFractions: number[] = [];
  const cFractions: number[] = [];
  const allFractions: number[] = [];
  const buMaxima: number[] = [];
  const perSeed: any[] = [];

  for (const seed of SEEDS) {
    const session = new UniverseSession();
    session.create(config(seed, regime));
    const rs = () => (session.simulation as any).resources;
    const seedA: number[] = [];
    const seedB: number[] = [];
    const seedC: number[] = [];
    let buMax = 0;
    for (let t = 0; t < HORIZON; t += SAMPLE_EVERY) {
      let advanced = 0;
      while (session.snapshot().tick < t && advanced < 200) {
        const snapshot = session.advance(SAMPLE_EVERY);
        advanced += SAMPLE_EVERY;
        const pending = snapshot.pendingDecision;
        if (pending) session.resolveEventDecision(pending.opportunityId, "keep-watching");
      }
      const tick = session.snapshot().tick;
      if (tick < SETTLE) continue;
      // Field-level fractions, not single-cell: the claim is about how a
      // universe grazes its stocks, and a single cell can be locally bare
      // while the field is healthy. RS.totals() reports the combined primary
      // fraction and c_fraction, so a and b are derived from the same totals.
      const totals = rs().totals() as any;
      const per = [
        ["a", totals.a / (totals.a_capacity || 1), seedA],
        ["b", totals.b / (totals.b_capacity || 1), seedB],
        ["c", totals.c / (totals.c_capacity || 1), seedC],
      ] as const;
      for (const [, f, sink] of per) if (Number.isFinite(f)) sink.push(f);
      const bu = (session.snapshot().metrics as any).traits?.byproduct_use ?? {};
      if (Number.isFinite(bu.max)) buMax = Math.max(buMax, bu.max);
    }
    aFractions.push(...seedA);
    bFractions.push(...seedB);
    cFractions.push(...seedC);
    allFractions.push(...seedA, ...seedB, ...seedC);
    buMaxima.push(buMax);
    perSeed.push({
      seed,
      byproductUseMax: buMax,
      a: summary(seedA),
      b: summary(seedB),
      c: summary(seedC),
    });
  }

  result.regimes[regime] = {
    nutrientFraction: summary(allFractions),
    aFraction: summary(aFractions),
    bFraction: summary(bFractions),
    cFraction: summary(cFractions),
    byproductUseMax: { perSeed: buMaxima, highest: Math.max(...buMaxima) },
    perSeed,
  };
  const n = result.regimes[regime];
  console.log(
    `${regime}: fraction p05=${n.nutrientFraction.p05.toFixed(3)} p50=${n.nutrientFraction.p50.toFixed(3)} ` +
    `p95=${n.nutrientFraction.p95.toFixed(3)} max=${n.nutrientFraction.max.toFixed(3)} | ` +
    `bu.max highest=${n.byproductUseMax.highest.toFixed(3)} [${buMaxima.map((v) => v.toFixed(2)).join(", ")}]`,
  );
}

// The two claims, restated so the artifact carries what it is meant to test.
result.claimsUnderTest = {
  catalystMinStockFraction: {
    constant: 0.08,
    citedBand: "1-15% equilibrium in every config (balanced, patchwork, harsh, abundant)",
    citedArtifact: "testdata/ecology-survey-0.20.json",
    citedArtifactRecordsStockFractions: false,
    note: "Measurements above are on the current engine. No assertion is made here about whether the constant is correct.",
  },
  byproductUseTradeoff: {
    threshold: 1.0,
    citedHighestSurveyedMaximum: 0.73,
    citedConfig: "abundant",
    citedArtifactRetained: false,
    note: "Measurements above are on the current engine. No assertion is made here about whether the constant is correct.",
  },
};

mkdirSync("testdata", { recursive: true });
const out = `testdata/provenance-${ENGINE_VERSION}.json`;
writeFileSync(out, JSON.stringify(result, null, 2));
console.log(`provenance measurements: DONE -> ${out}`);
