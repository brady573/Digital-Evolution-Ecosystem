import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Simulation } from "../../../packages/sim-core/src/engine.ts";
import { UniverseSession } from "../../../packages/sim-runtime/src/session.ts";
import { ENGINE_VERSION } from "../../../packages/sim-core/src/version.ts";

/**
 * Evolutionary Substrate Diagnostic — shared harness.
 *
 * Issue #97 comment 6060686372. Diagnostic-only and evidence-only: nothing in
 * this directory is registered in tools/validation/manifest.ts, nothing here is
 * merge-gating, and nothing here changes production biology. Every number is
 * observation of maintained main through its existing public surface.
 *
 * Two rules govern every script in this directory:
 *
 *  1. Measurement is separated from inference. Where a quantity cannot be read
 *     directly from maintained state (blocked births are the one case: the
 *     engine only publishes a run-level counter), the field is suffixed
 *     `Inferred` and its method is documented at the point of use.
 *  2. Every emitted record carries engine version, commit, seed, config and
 *     horizon, so a row can never be read out of context.
 */

/** The maintained substrate. Do not branch this from a failed feature branch. */
export const BASELINE = {
  engine: ENGINE_VERSION,
  base: "origin/main",
  commit: process.env.SUBSTRATE_COMMIT ?? "unset",
};

/** Maintained survey configs, copied from tools/validation/niche-survey.ts. */
export function maintainedConfig(name: string, seed: number): any {
  const base = {
    seed, cap: 360, pop: 30, div: 0.35, mr: 0.03,
    ms: 0.12, press: 1.0875, patch: 0.6, resource_b_fraction: 0.5, cat: "global", st: null,
    resource_model: "definition_driven_substances", resource_grid: 60,
    enable_byproduct: true, enable_dormancy: true, study: true,
  } as const;
  if (name === "patchwork") return { ...base, start: 0.62, prod: 0.86, patch: 0.9, pop: 34, div: 0.45 };
  if (name === "harsh") return { ...base, start: 0.47, prod: 0.52, patch: 0.55 };
  if (name === "balanced") return { ...base, start: 0.58, prod: 0.77 };
  throw new Error(`unknown maintained config: ${name}`);
}

/**
 * Q-C regime perturbations. These are world-setting scalars the product already
 * exposes (nutrient stock fraction, nutrient production, founder dispersion),
 * used to create a replete / marginal / scarce ladder WITHOUT touching any
 * biological rule constant. `start`/`prod` are field stock and regrowth, `div`
 * is founder trait dispersion. None of them is a simulation rule.
 */
export const REGIMES: Record<string, any> = {
  // Resource-replete: high stock, high regrowth, same biology.
  replete: { start: 1.4, prod: 1.4 },
  // Maintained balanced calibration, unchanged.
  marginal: { start: 0.58, prod: 0.77 },
  // Scarce field, same rules.
  scarce: { start: 0.22, prod: 0.22 },
};

/** Predeclared seeds. Chosen before any result was seen; never edited after. */
export const SEEDS = [111111111, 222222222, 333333333, 444444444, 555555555];

export function outPath(file: string): string {
  return `testdata/substrate-diagnostic/${file}`;
}

export function header(extra: Record<string, unknown> = {}) {
  return { ...BASELINE, generatedBy: "tools/diagnostics/substrate", ...extra };
}

/** Append one JSON record per line. Append-only so a remote run can resume. */
export function emit(file: string, record: unknown): void {
  const path = outPath(file);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`);
}

export function emitFresh(file: string, record: unknown): void {
  const path = outPath(file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(record)}\n`);
}

/** Markdown table writer, so raw tables can be pasted into the return. */
export function table(headers: string[], rows: (string | number)[][]): string {
  const head = `| ${headers.join(" | ")} |`;
  const rule = `| ${headers.map(() => "---").join(" | ")} |`;
  return [head, rule, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
}

export function summarise(label: string, headers: string[], rows: (string | number)[][]): void {
  console.log(`\n### ${label}\n`);
  console.log(table(headers, rows));
}

/**
 * Advance a raw Simulation, accumulating interval counters into `acc`.
 *
 * `sim.cur` is CUMULATIVE within a stride: the engine increments it every tick
 * and only replaces it every EVENT_STRIDE (251) ticks. Summing the raw value
 * every tick therefore sums prefixes of the same running total and inflates
 * every counter by roughly EVENT_STRIDE/2. Measured on seed 333333333 over 1000
 * ticks: per-tick summing reported 3027 births where observation counted 30.
 *
 * So counters must be SAMPLED every tick and DIFFERENCEd. A drop below the
 * previous value is the stride reset, and the current value is then the whole
 * delta. This mirrors the stride-safe accumulator already used by
 * tools/validation/spatial-occupancy.ts.
 */
export function drain(sim: any, acc: Record<string, number>, prev?: Record<string, number>): Record<string, number> {
  const prior = prev ?? {};
  for (const [k, v] of Object.entries(sim.cur as Record<string, unknown>)) {
    if (typeof v !== "number") continue;
    const before = prior[k] ?? 0;
    acc[k] = (acc[k] ?? 0) + (v >= before ? v - before : v);
    prior[k] = v;
  }
  return prior;
}

export function newAcc(): Record<string, number> {
  return {};
}

/**
 * Settle a UniverseSession to a tick using the maintained decision contract
 * (a pending decision is a hard pause; the survey resolves it as
 * "keep-watching"). Used wherever maintained detector semantics are required.
 */
export function settleSession(session: any, target: number): void {
  for (let i = 0; i < 2000 && session.snapshot().tick < target; i++) {
    const snapshot = session.advance(1000);
    const pending = snapshot.pendingDecision;
    if (pending) session.resolveEventDecision(pending.opportunityId, "keep-watching");
  }
  const leftover = session.snapshot().pendingDecision;
  if (leftover) session.resolveEventDecision(leftover.opportunityId, "keep-watching");
}

/** Maintained protected-capability detectors, read through the session analysis. */
export function protectedCapabilities(session: any): Record<string, unknown> {
  const analysis = session.analysis as any;
  const metrics = session.snapshot().metrics as any;
  const nicheRecords = ((analysis.records ?? []) as any[]).filter((r) => r.kind === "niche");
  return {
    // Waste-niche establishment: maintained detector, established phase only.
    wasteNiche: analysis.niche?.state ?? "unknown",
    wasteNicheEstablishedTick: analysis.niche?.establishedTick ?? null,
    wasteNicheRecords: nicheRecords.map((r) => `${r.phase}@${r.tick}`),
    // Cross-feeding dependency guild: maintained observer state.
    dependency: analysis.dep?.state ?? "unknown",
    dependencyEstablishedTick: analysis.dep?.establishedTick ?? null,
    // Dormancy seed bank: maintained observer state plus returned clades.
    seedBank: analysis.seedbank?.state ?? "unknown",
    seedBankReturnedClades: Object.keys(analysis.seedbank?.returnedClades ?? {}).length,
    // A/B partitioning: maintained PART_* persistence test, read from metrics.
    partitioning: metrics.niche_structure?.persistent_partitioning ?? null,
    partitioningNow: metrics.niche_structure?.partitioned_now ?? null,
    // Context only; never an acceptance criterion.
    population: metrics.population,
    dormantFraction: metrics.dormant_fraction,
  };
}

export function newSession(config: any): any {
  const session = new UniverseSession();
  session.create(config);
  return session;
}

export { Simulation, UniverseSession };
