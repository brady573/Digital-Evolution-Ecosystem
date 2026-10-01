import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { UniverseSession } from "../../packages/sim-runtime/src/session.ts";
import {
  APP_VERSION,
  ENGINE_VERSION,
  EXPORT_FORMAT_VERSION,
} from "../../packages/sim-core/src/index.ts";
import type { EngineConfig } from "../../packages/contracts/src/index.ts";

// Broad engine-0.22 ecology characterization survey (Task 1 scaffold).
//
// Reuses UniverseSession read APIs to retain per-run trajectories and
// identity. No biology changes, no config changes: the matrix below is the
// ecology-survey PRESETS mapping + config() verbatim, extended to the four
// surveyed archetypes.
//
// Fixed survey matrix (plan verbatim):
// - Archetypes (4): balanced, patchwork, harsh, abundant.
// - Seeds (8): stable reuse of the niche-survey set.
// - Horizon: 250000 ticks (matches the ecology-survey standard horizon;
//   exceeds the niche-survey 150k establishment window and the washout
//   60k-settle/120k-extended windows; covers the ~63k establishment
//   timescale noted in landscape-capture with headroom).
// - Trajectory sampling: every 5000 ticks (50 samples/run), scalars only.
//
// Usage:
//   pnpm exec tsx tools/validation/broad-ecology-022.ts -- --selfcheck
//   pnpm exec tsx tools/validation/broad-ecology-022.ts -- \
//     --ticks=6000 --out=/tmp/broad022-smoke.json \
//     --archetypes=balanced --seeds=821947219

export type Broad022Archetype = "balanced" | "patchwork" | "harsh" | "abundant";

export const MATRIX_ARCHETYPES: Broad022Archetype[] = [
  "balanced",
  "patchwork",
  "harsh",
  "abundant",
];

export const MATRIX_SEEDS = [
  24681357, 821947219, 3543950664, 111111111, 222222222, 333333333,
  444444444, 555555555,
];

export const BROAD022_HORIZON = 250000;
export const BROAD022_STRIDE = 5000;

// Task 3 matched-assay anchors (plan verbatim): fork at tick 60000 (washout
// SETTLE_TICKS mature-community anchor), branch 30000 ticks to separate the
// immediate mechanical effect at +1000 from the later ecological response at
// +30000. Disturbance assays run on fresh sessions only; the baseline 32 runs
// are never forked or intervened.
export const DISTURB_FORK_TICK = 60000;
export const DISTURB_IMMEDIATE_TICK = 61000;
export const DISTURB_LATE_TICK = 90000;

// Disturbance assay seed set (plan verbatim): the first 4 matrix seeds.
export const DISTURBANCE_SEEDS = [24681357, 821947219, 3543950664, 111111111];

export function horizon(): number {
  return BROAD022_HORIZON;
}

export function sampleStride(): number {
  return BROAD022_STRIDE;
}

// Verbatim from ecology-survey.ts:35-43 (which mirrors App.tsx:79-82
// archetype semantics). Sliders are 0-100 in the prototype; resdiv maps to
// resource_b_fraction = resdiv/100*.5, i.e. resdiv*0.5 here.
export const PRESETS: Record<
  Broad022Archetype,
  {
    rich: number;
    patch: number;
    resdiv: number;
    pop: number;
    div: number;
    mr: number;
    press: number;
  }
> = {
  balanced: { rich: 0.60, patch: 0.60, resdiv: 1.0, pop: 30, div: 0.35, mr: 0.03, press: 0.45 },
  patchwork: { rich: 0.68, patch: 0.90, resdiv: 1.0, pop: 34, div: 0.45, mr: 0.03, press: 0.42 },
  harsh: { rich: 0.38, patch: 0.55, resdiv: 0.80, pop: 30, div: 0.35, mr: 0.04, press: 0.78 },
  abundant: { rich: 3.20, patch: 0.60, resdiv: 1.0, pop: 30, div: 0.35, mr: 0.03, press: 0.45 },
};

export const BROAD022_MATRIX = {
  archetypes: MATRIX_ARCHETYPES,
  seeds: MATRIX_SEEDS,
  horizon: BROAD022_HORIZON,
  sampleStride: BROAD022_STRIDE,
  presets: PRESETS,
};

// Verbatim from ecology-survey.ts:52-74.
export function config(seed: number, archetype: Broad022Archetype): EngineConfig {
  const p = PRESETS[archetype];
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

/**
 * Advance a session to `target`, resolving every pending decision as
 * keep-watching (a pure no-op choice, so surveyed ticks are real ticks and
 * determinism is unaffected). Mirrors ecology-survey.ts:92-99. Throws
 * `survey stalled before tick N` when no progress is possible.
 *
 * Resolutions are appended to `commands` when provided, keeping the run's
 * command sequence (create + settle chunks + resolve list) reproducible.
 */
export function settleTo(
  session: UniverseSession,
  target: number,
  commands: string[] | null = null,
): void {
  for (let i = 0; i < 1000 && session.snapshot().tick < target; i++) {
    const snapshot = session.advance(
      Math.min(BROAD022_STRIDE, target - session.snapshot().tick),
    );
    const pending = snapshot.pendingDecision;
    if (pending) {
      session.resolveEventDecision(pending.opportunityId, "keep-watching");
      if (commands) commands.push(`resolve:${pending.opportunityId}:keep-watching`);
    }
  }
  if (session.snapshot().tick < target) {
    throw new Error(`survey stalled before tick ${target}`);
  }
}

export interface Broad022Sample {
  tick: number;
  population: number;
  // Observed engine scalars below: present-and-finite values pass through
  // verbatim, anything absent (or non-finite) is null, never 0. A zero in one
  // of these fields therefore always means the engine reported zero (e.g. an
  // extinct run's dormant_fraction), never "we did not look".
  dormant_fraction: number | null;
  dormant_population: number | null;
  /** Wakes in the engine's most recently completed stride interval (read-only
   *  `simulation.last.wakes`; null when that interval observation is
   *  unavailable). Interval-scoped, not cumulative. */
  wakes: number | null;
  crossfeeder_fraction: number | null;
  /** Energy-share basis (`resource_energy.c_share`, else `resource_use.c_share`). */
  c_share: number | null;
  /** Living-energy C share (`resource_energy.living_c_share`; the engine
   *  itself emits null here when there is no living energy to share). */
  c_energy_share: number | null;
  metabolite_c_produced: number | null;
  metabolite_c_consumed: number | null;
  waste_fraction: number | null;
  nutrient_a: number | null;
  nutrient_b: number | null;
  /** Max over `nutrient_field.accounting.absolute_residual` (null when the
   *  accounting block is absent). */
  accounting_residual_max: number | null;
  effective_niches: number | null;
  lineages_active: number | null;
  lineages_effective: number | null;
  clades_active: number | null;
  clades_effective: number | null;
  families_active: number | null;
  families_effective: number | null;
  trait_diversity: number | null;
  tolerance_mean: number | null;
  cleanup_mean: number | null;
  ecological_outcome: string | null;
  extinct_tick: number | null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/**
 * Fail-closed per-sample capture: every scalar goes through a typeof guard,
 * so an engine that omits (or non-finitely reports) a key yields null rather
 * than a fabricated 0. Pure over its inputs: no simulation access, no
 * mutation, safe to unit-probe with `{}`.
 */
export function captureSample(
  tick: number,
  metrics: unknown,
  wakes: unknown,
): Broad022Sample {
  const m: any =
    metrics !== null && typeof metrics === "object" ? metrics : {};
  const mc: any = m.metabolite_c ?? {};
  const waste: any = m.waste ?? {};
  const nf: any = m.nutrient_field ?? {};
  const re: any = m.resource_energy ?? {};
  const ru: any = m.resource_use ?? {};
  const mr: any = m.metabolic_roles ?? {};
  const lin: any = m.lineages ?? {};
  const cla: any = m.clades ?? {};
  const fam: any = m.families ?? {};
  const tr: any = m.traits ?? {};
  let accounting_residual_max: number | null = null;
  const resid: unknown = nf.accounting?.absolute_residual;
  if (Array.isArray(resid)) {
    for (const v of resid) {
      const n = num(v);
      if (n !== null) {
        accounting_residual_max =
          accounting_residual_max === null ? n : Math.max(accounting_residual_max, n);
      }
    }
  }
  return {
    tick,
    population: num(m.population) ?? 0,
    dormant_fraction: num(m.dormant_fraction),
    dormant_population: num(m.dormant_population),
    wakes: num(wakes),
    crossfeeder_fraction: num(mr.crossfeeder_fraction),
    c_share: num(re.c_share) ?? num(ru.c_share),
    c_energy_share: num(re.living_c_share),
    metabolite_c_produced: num(mc.produced),
    metabolite_c_consumed: num(mc.consumed),
    waste_fraction: num(waste.fraction),
    nutrient_a: num(nf.a),
    nutrient_b: num(nf.b),
    accounting_residual_max,
    effective_niches: num(m.effective_niches),
    lineages_active: num(lin.active),
    lineages_effective: num(lin.effective),
    clades_active: num(cla.active),
    clades_effective: num(cla.effective),
    families_active: num(fam.active),
    families_effective: num(fam.effective),
    trait_diversity: num(m.trait_diversity),
    tolerance_mean: num(tr.tolerance?.mean),
    cleanup_mean: num(tr.cleanup?.mean),
    ecological_outcome: str(m.ecological_outcome),
    extinct_tick: num(m.extinct_tick),
  };
}

// Qualitative trajectory labels for Task 4 aggregation. Every label is
// derived from the measured sample series and the observed record headers
// only: descriptive, never causal. Threshold numbers below are read-only
// context from the sim-analysis detector and the niche-survey rule, never
// overrides of them (an observer verdict always outranks a series heuristic).

export type Broad022ResourceWasteLabel =
  | "accumulation"
  | "depletion"
  | "cycling/recovery"
  | "sustained-limitation"
  | "sustained-burden"
  | "transient-spike"
  | "flat/absent";

export type Broad022DormancyLabel =
  | "established-with-return"
  | "established-no-return-observed"
  | "transient"
  | "negligible/absent";

export type Broad022CrossfeedingLabel =
  | "capability-only"
  | "in-use"
  | "ecologically-relied"
  | "weak/transient"
  | "absent";

export type Broad022NicheLabel =
  | "established"
  | "strategy-shift-without-establishment"
  | "exposure-without-shift"
  | "no-modification"
  | "no-response";

export interface Broad022Labels {
  resources_waste: Broad022ResourceWasteLabel;
  dormancy: Broad022DormancyLabel;
  crossfeeding: Broad022CrossfeedingLabel;
  niche: Broad022NicheLabel;
}

/** Minimal record view the label functions read (headers plus evidence). */
export interface Broad022LabelRecord {
  kind: unknown;
  phase: unknown;
  tick: unknown;
  evidence?: any;
}

function mean(ns: number[]): number | null {
  if (ns.length === 0) return null;
  let s = 0;
  for (const n of ns) s += n;
  return s / ns.length;
}

/** Waste/nutrient trajectory from the measured series only. */
export function labelResourcesWaste(samples: Broad022Sample[]): Broad022ResourceWasteLabel {
  const waste: number[] = [];
  const nutr: number[] = [];
  for (const s of samples) {
    if (typeof s.waste_fraction === "number") waste.push(s.waste_fraction);
    if (typeof s.nutrient_a === "number" && typeof s.nutrient_b === "number") {
      nutr.push(s.nutrient_a + s.nutrient_b);
    }
  }
  // Modification threshold context: NC_FORM_WASTE (0.05) in sim-analysis.
  const MOD = 0.05;
  const mod = waste.map((w) => w >= MOD);
  const modFrac = waste.length ? mod.filter(Boolean).length / waste.length : 0;
  let crossings = 0;
  for (let i = 1; i < mod.length; i++) {
    if (mod[i] !== mod[i - 1]) crossings++;
  }
  const recovered =
    nutr.length >= 2 &&
    nutr[0]! > 0 &&
    Math.min(...nutr) < 0.5 * nutr[0]! &&
    nutr[nutr.length - 1]! >= 0.8 * nutr[0]!;
  if (crossings >= 3 || recovered) return "cycling/recovery";
  if (modFrac >= 0.5) return "sustained-burden";
  if (waste.length >= 3) {
    const third = Math.max(1, Math.floor(waste.length / 3));
    const first = mean(waste.slice(0, third));
    const last = mean(waste.slice(-third));
    const lastPoint = waste[waste.length - 1]!;
    if (first !== null && last !== null && lastPoint >= MOD) {
      if ((first === 0 && last >= MOD) || (first > 0 && last > 2 * first)) {
        return "accumulation";
      }
    }
  }
  if (
    waste.length > 0 &&
    Math.max(...waste) >= MOD &&
    modFrac < 0.5 &&
    crossings <= 2 &&
    waste[waste.length - 1]! < MOD
  ) {
    return "transient-spike";
  }
  if (nutr.length >= 2 && nutr[0]! > 0) {
    const first = nutr[0]!;
    if (nutr[nutr.length - 1]! < 0.5 * first) return "depletion";
    const below = nutr.filter((n) => n < 0.5 * first).length / nutr.length;
    if (below >= 0.5) return "sustained-limitation";
  }
  return "flat/absent";
}

/**
 * Dormancy trajectory. Return means a `recovered` dormancy record was
 * observed, or a dormancy record carries non-empty `wake_clades` evidence
 * (a dormant clade measurably woke). Observer verdicts outrank the series:
 * any establishment record decides the top two labels.
 */
export function labelDormancy(
  samples: Broad022Sample[],
  records: Broad022LabelRecord[],
): Broad022DormancyLabel {
  const dorm = records.filter((r) => r.kind === "dormancy");
  const established = dorm.some((r) => r.phase === "established");
  const recoveredRecord = dorm.some((r) => r.phase === "recovered");
  const wakeEvidence = dorm.some((r) => {
    const wc = r.evidence?.wake_clades;
    return (
      wc !== null &&
      typeof wc === "object" &&
      Object.values(wc).some((v) => typeof v === "number" && v > 0)
    );
  });
  if (established && (recoveredRecord || wakeEvidence)) return "established-with-return";
  if (established) return "established-no-return-observed";
  // Forming-threshold context: the observer opens a dormancy arc at 0.08.
  let maxDorm: number | null = null;
  for (const s of samples) {
    if (typeof s.dormant_fraction === "number") {
      maxDorm = maxDorm === null ? s.dormant_fraction : Math.max(maxDorm, s.dormant_fraction);
    }
  }
  if (maxDorm !== null && maxDorm >= 0.08) return "transient";
  return "negligible/absent";
}

/**
 * Cross-feeding trajectory. Forming-level context comes from the observer
 * rule (C share >= 0.035 with crossfeeder fraction >= 0.04); an
 * establishment record (crossfeeding or the C-use guild arc) decides
 * `in-use`. `ecologically-relied` is never emitted here: reliance needs
 * matched-assay support from Task 3+, and a single run cannot provide it.
 */
export function labelCrossfeeding(
  samples: Broad022Sample[],
  records: Broad022LabelRecord[],
): Broad022CrossfeedingLabel {
  const established = records.some(
    (r) =>
      (r.kind === "crossfeeding" || r.kind === "cuse") && r.phase === "established",
  );
  if (established) return "in-use";
  let formSeen = false;
  let capabilitySeen = false;
  for (const s of samples) {
    const ce =
      typeof s.c_energy_share === "number"
        ? s.c_energy_share
        : typeof s.c_share === "number"
          ? s.c_share
          : null;
    const xf = typeof s.crossfeeder_fraction === "number" ? s.crossfeeder_fraction : null;
    if (ce !== null && xf !== null && ce >= 0.035 && xf >= 0.04) formSeen = true;
    if (xf !== null && xf > 0) capabilitySeen = true;
  }
  if (formSeen) return "weak/transient";
  if (capabilitySeen) return "capability-only";
  return "absent";
}

/**
 * Niche trajectory: the niche-survey response rule applied to the captured
 * series (establishment needs a niche record; otherwise the forming baseline
 * is the first waste-modified sample and a >= 0.05 tolerance/cleanup shift
 * is a strategy shift). The brief's verbatim label for the exposure case is
 * `exposure-without-shift` (the survey file words it
 * `exposure-without-strategy-shift`); the rule is identical.
 */
export function labelNiche(
  samples: Broad022Sample[],
  records: Broad022LabelRecord[],
): Broad022NicheLabel {
  if (records.some((r) => r.kind === "niche")) return "established";
  let baseTol = -1;
  let baseCu = -1;
  let maxTolD = 0;
  let maxCuD = 0;
  let maxWaste = 0;
  for (const s of samples) {
    if (typeof s.waste_fraction === "number") {
      maxWaste = Math.max(maxWaste, s.waste_fraction);
      if (
        s.waste_fraction >= 0.05 &&
        baseTol < 0 &&
        typeof s.tolerance_mean === "number" &&
        typeof s.cleanup_mean === "number"
      ) {
        baseTol = s.tolerance_mean;
        baseCu = s.cleanup_mean;
      }
    }
    if (
      baseTol >= 0 &&
      typeof s.tolerance_mean === "number" &&
      typeof s.cleanup_mean === "number"
    ) {
      maxTolD = Math.max(maxTolD, s.tolerance_mean - baseTol);
      maxCuD = Math.max(maxCuD, s.cleanup_mean - baseCu);
    }
  }
  if (baseTol < 0) return "no-modification";
  if (maxTolD >= 0.05 || maxCuD >= 0.05) return "strategy-shift-without-establishment";
  if (maxWaste >= 0.05) return "exposure-without-shift";
  return "no-response";
}

// Task 3: clade turnover summary. The per-sample clade/lineage time-series
// itself is the Task 2 `lineages_active/effective`, `clades_active/effective`
// sample fields (fail-closed null when unobserved); no duplicate `cladeSeries`
// array is retained, per the artifact-size Review Focus. What Task 3 adds is
// the terminal turnover read below: max + final richness plus
// replacement/collapse/recovery verdicts from record/series evidence only, so
// a single end-of-run richness count is never the only clade evidence.
//
// A verdict is `false` only when there was something to judge (records and/or
// a usable series with no event); it is `"not-observed"` where the series
// cannot distinguish (no records at all and fewer than 2 non-null clade
// samples) rather than a forced label. Descriptive, never causal.
export type Broad022TurnoverVerdict = boolean | "not-observed";

export interface Broad022CladeTurnover {
  /** Max `clades_active` over samples (null when never observed). */
  everActiveMax: number | null;
  /** Last sample's `clades_active` (null when unobserved). */
  finalActive: number | null;
  /** Leading-lineage change across cuse/niche records (lineage entity-ref
   *  IDs in tick order; >1 distinct ID means the attributed lineage turned
   *  over). "not-observed" when no cuse/niche record names a lineage. */
  replacementsObserved: Broad022TurnoverVerdict;
  /** Observer `disrupted`/`superseded` record, or a series wipe (non-null
   *  richness >= 1 followed later by non-null 0; extinction-driven zeros
   *  count, with extinction itself recorded separately in terminal). */
  collapseObserved: Broad022TurnoverVerdict;
  /** Observer `recovered` record, or a series rebound (>= 1 after a wipe). */
  recoveryObserved: Broad022TurnoverVerdict;
}

/** Minimal record view the turnover summary reads (full in-memory records;
 *  only scalar headers are retained on the run). */
export interface Broad022TurnoverRecord {
  kind: unknown;
  phase: unknown;
  tick: unknown;
  entity_refs?: unknown;
}

/**
 * Derive the clade turnover summary from the measured sample series plus the
 * observed full records. Pure over its inputs: no simulation access, no
 * mutation, safe to unit-probe.
 */
export function summarizeClades(
  samples: Broad022Sample[],
  records: Broad022TurnoverRecord[],
): Broad022CladeTurnover {
  const actives: number[] = [];
  for (const s of samples) {
    const a = s.clades_active;
    if (typeof a === "number" && Number.isFinite(a)) actives.push(a);
  }
  const everActiveMax = actives.length > 0 ? Math.max(...actives) : null;
  const last = samples.length > 0 ? samples[samples.length - 1]!.clades_active : null;
  const finalActive = typeof last === "number" && Number.isFinite(last) ? last : null;
  // Leading-lineage identities across cuse/niche records, tick-ordered.
  const ordered = [...records].sort((a, b) =>
    typeof a.tick === "number" && typeof b.tick === "number" ? a.tick - b.tick : 0,
  );
  const lineageIds: number[] = [];
  for (const r of ordered) {
    if (r.kind !== "cuse" && r.kind !== "niche") continue;
    const refs = (r as { entity_refs?: unknown }).entity_refs;
    if (!Array.isArray(refs)) continue;
    for (const ref of refs) {
      if (
        ref !== null &&
        typeof ref === "object" &&
        (ref as { kind?: unknown }).kind === "lineage" &&
        typeof (ref as { id?: unknown }).id === "number" &&
        Number.isFinite((ref as { id?: unknown }).id)
      ) {
        lineageIds.push((ref as { id: number }).id);
      }
    }
  }
  const replacementsObserved: Broad022TurnoverVerdict =
    lineageIds.length === 0 ? "not-observed" : new Set(lineageIds).size > 1;
  let disrupted = false;
  let recovered = false;
  for (const r of records) {
    if (r.phase === "disrupted" || r.phase === "superseded") disrupted = true;
    else if (r.phase === "recovered") recovered = true;
  }
  let seenPositive = false;
  let wipe = false;
  let rebound = false;
  for (const s of samples) {
    const a = s.clades_active;
    if (typeof a !== "number" || !Number.isFinite(a)) continue;
    if (a >= 1) {
      if (wipe) rebound = true;
      seenPositive = true;
    } else if (seenPositive) {
      wipe = true;
    }
  }
  const noSignal = records.length === 0 && actives.length < 2;
  const collapseObserved: Broad022TurnoverVerdict =
    disrupted || wipe ? true : noSignal ? "not-observed" : false;
  const recoveryObserved: Broad022TurnoverVerdict =
    recovered || rebound ? true : noSignal ? "not-observed" : false;
  return {
    everActiveMax,
    finalActive,
    replacementsObserved,
    collapseObserved,
    recoveryObserved,
  };
}

export interface Broad022Run {
  archetype: Broad022Archetype;
  seed: number;
  identity: {
    engine: string;
    appVersion: string;
    exportFormatVersion: string;
    resolvedConfig: unknown;
    archetype: Broad022Archetype;
    seed: number;
    commandSequence: string[];
    horizon: number;
    provenance: unknown;
    durationMs: number;
  };
  samples: Broad022Sample[];
  terminal: {
    tick: number;
    population: number;
    extinct: boolean;
    extinctTick: number | null;
    outcome: unknown;
    labels: Broad022Labels;
    clades: Broad022CladeTurnover;
  };
  // Scalar-only record headers (washout v3 precedent: no nested evidence
  // frames). entityRefKinds names what each tagged ref denotes so a consumer
  // never infers a namespace from a bare number; a non-string kind is kept
  // as null rather than dropped or guessed.
  records: Array<{
    kind: unknown;
    phase: unknown;
    tick: unknown;
    entityRefKinds: Array<string | null>;
  }>;
}

function surveyRun(
  archetype: Broad022Archetype,
  seed: number,
  ticks: number,
): Broad022Run {
  const t0 = Date.now();
  const session = new UniverseSession();
  session.create(config(seed, archetype));
  const commandSequence: string[] = [`create:${archetype}/${seed}`];
  const resolvedConfig = JSON.parse(JSON.stringify(session.snapshot().config));
  const samples: Broad022Sample[] = [];
  for (let done = 0; done < ticks; done += BROAD022_STRIDE) {
    const from = session.snapshot().tick;
    settleTo(session, Math.min(done + BROAD022_STRIDE, ticks), commandSequence);
    const snap = session.snapshot();
    commandSequence.push(`advance:${snap.tick - from}:${from}->${snap.tick}`);
    // Wakes are interval-scoped engine state, not part of metrics(): read the
    // most recently completed stride interval read-only. Unavailable (or a
    // shape change) fails closed to null via the capture guard.
    let wakes: unknown = null;
    try {
      wakes = session.simulation?.last?.wakes ?? null;
    } catch {
      wakes = null;
    }
    samples.push(captureSample(snap.tick, (snap as any).metrics, wakes));
    if (snap.population === 0) break;
  }
  const terminal = session.snapshot();
  const tm: any = terminal.metrics;
  const extinctTick = num(tm.extinct_tick);
  let provenance: unknown = {
    cleanliness: "unknown",
    revision: { git_commit: null },
  };
  try {
    const evidence: any = session.exportEvidence();
    if (evidence && evidence.provenance) provenance = evidence.provenance;
  } catch {
    /* read-only observation unavailable; keep the unknown fallback */
  }
  // Full records stay in memory for label derivation (return evidence such
  // as wake_clades lives in the frames); only scalar headers are retained.
  let fullRecords: any[] = [];
  let records: Broad022Run["records"] = [];
  try {
    const raw: any[] = session.analysis.records;
    if (Array.isArray(raw)) {
      fullRecords = raw;
      records = raw.map((r: any) => ({
        kind: r.kind,
        phase: r.phase,
        tick: r.tick,
        entityRefKinds: Array.isArray(r.entity_refs)
          ? r.entity_refs.map((ref: any) =>
              ref !== null && typeof ref === "object" && typeof ref.kind === "string"
                ? (ref.kind as string)
                : null,
            )
          : [],
      }));
    }
  } catch {
    /* keep records empty rather than failing the run */
  }
  const labels: Broad022Labels = {
    resources_waste: labelResourcesWaste(samples),
    dormancy: labelDormancy(samples, fullRecords),
    crossfeeding: labelCrossfeeding(samples, fullRecords),
    niche: labelNiche(samples, fullRecords),
  };
  const clades = summarizeClades(samples, fullRecords);
  return {
    archetype,
    seed,
    identity: {
      engine: ENGINE_VERSION,
      appVersion: APP_VERSION,
      exportFormatVersion: EXPORT_FORMAT_VERSION,
      resolvedConfig,
      archetype,
      seed,
      commandSequence,
      horizon: BROAD022_HORIZON,
      provenance,
      durationMs: Date.now() - t0,
    },
    samples,
    terminal: {
      tick: terminal.tick,
      population: terminal.population,
      extinct: (extinctTick !== null && extinctTick !== undefined) || terminal.population === 0,
      extinctTick,
      outcome: str(tm.ecological_outcome),
      labels,
      clades,
    },
    records,
  };
}

export interface Broad022DisturbancePair {
  tick: number;
  live: number | null;
  control: number | null;
  liveA: number | null;
  controlA: number | null;
}

export interface Broad022DisturbanceLate extends Broad022DisturbancePair {
  liveOutcome: string | null;
  controlOutcome: string | null;
}

// Matched droughtA disturbance pair (Task 3). Top-level live/control
// population + outcome names follow the ecology-survey precedent (late-pair
// values); the nested immediate/late pairs carry the checkable +1000/+30000
// ticks. `diverged` is a matched comparison only — live A-stock below control
// A-stock at the late pair — descriptive, never causal.
export interface Broad022Disturbance {
  archetype: Broad022Archetype;
  seed: number;
  forkTick: number;
  forkPopulation: number;
  livePopulation: number | null;
  controlPopulation: number | null;
  liveOutcome: string | null;
  controlOutcome: string | null;
  immediate: Broad022DisturbancePair;
  late: Broad022DisturbanceLate;
  diverged: boolean;
  commands: string[];
}

function readDisturbancePair(snap: any): Broad022DisturbancePair {
  const liveM: any = snap.metrics ?? {};
  const ctrl: any = snap.control ?? null;
  const ctrlM: any = ctrl?.metrics ?? {};
  return {
    tick: snap.tick,
    live: num(snap.population),
    control: ctrl ? num(ctrl.population) : null,
    liveA: num(liveM.nutrient_field?.a),
    controlA: num(ctrlM.nutrient_field?.a),
  };
}

/**
 * One matched droughtA assay on a fresh session: settle to the fork anchor,
 * fork-before-intervene always, then read the immediate (+1000, mechanical)
 * and late (+30000, ecological) live/control pairs. The baseline 32 runs are
 * never forked or intervened; this session is assay-local and discarded.
 */
export function assayDisturbance(
  archetype: Broad022Archetype,
  seed: number,
): Broad022Disturbance {
  const session = new UniverseSession();
  session.create(config(seed, archetype));
  const commands: string[] = [`create:${archetype}/${seed}`];
  const fromF = session.snapshot().tick;
  settleTo(session, DISTURB_FORK_TICK, commands);
  commands.push(`advance:${session.snapshot().tick - fromF}:${fromF}->${session.snapshot().tick}`);
  // Boundary gate: settleTo leaves a decision pending when it fires exactly
  // at the target tick, and intervene() refuses under a pending choice. The
  // same no-op keep-watching policy as the baseline keeps assay ticks real.
  let pre: any = session.snapshot();
  if (pre.pendingDecision) {
    session.resolveEventDecision(pre.pendingDecision.opportunityId, "keep-watching");
    commands.push(`resolve:${pre.pendingDecision.opportunityId}:keep-watching`);
    pre = session.snapshot();
  }
  session.createControlFork();
  commands.push(`fork:${pre.tick}`);
  const fork: any = session.snapshot();
  session.intervene("droughtA");
  commands.push(`intervene:droughtA@${fork.tick}`);
  const fromI = session.snapshot().tick;
  settleTo(session, DISTURB_IMMEDIATE_TICK, commands);
  commands.push(`advance:${session.snapshot().tick - fromI}:${fromI}->${session.snapshot().tick}`);
  const immediateSnap: any = session.snapshot();
  const immediate = readDisturbancePair(immediateSnap);
  const fromL = immediateSnap.tick;
  settleTo(session, DISTURB_LATE_TICK, commands);
  commands.push(`advance:${session.snapshot().tick - fromL}:${fromL}->${session.snapshot().tick}`);
  const lateSnap: any = session.snapshot();
  const lateM: any = lateSnap.metrics ?? {};
  const lateCtrlM: any = lateSnap.control?.metrics ?? {};
  const late: Broad022DisturbanceLate = {
    ...readDisturbancePair(lateSnap),
    liveOutcome: str(lateM.ecological_outcome),
    controlOutcome: str(lateCtrlM.ecological_outcome),
  };
  // `false` covers both "no divergence" and "stocks unobserved" (the retained
  // stocks show which); Task 4 must check nulls before reading a finding.
  const diverged =
    late.liveA !== null && late.controlA !== null ? late.liveA < late.controlA : false;
  return {
    archetype,
    seed,
    forkTick: fork.tick,
    forkPopulation: num(fork.population) ?? 0,
    livePopulation: late.live,
    controlPopulation: late.control,
    liveOutcome: late.liveOutcome,
    controlOutcome: late.controlOutcome,
    immediate,
    late,
    diverged,
    commands,
  };
}

function writeResult(out: string, result: unknown): void {
  // Crash-safe: write fully to a temp file, then rename, so a killed run
  // never leaves a truncated artifact behind. Every completed run is
  // retained even if a later one dies.
  const tmp = `${out}.tmp`;
  writeFileSync(tmp, JSON.stringify(result, null, 2));
  renameSync(tmp, out);
}

function selfcheck(): void {
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`selfcheck failed: ${msg}`);
  };
  assert(MATRIX_SEEDS.length === 8, `MATRIX_SEEDS.length === ${MATRIX_SEEDS.length}`);
  assert(MATRIX_ARCHETYPES.length === 4, `MATRIX_ARCHETYPES.length === ${MATRIX_ARCHETYPES.length}`);
  assert(horizon() === 250000, `horizon() === ${horizon()}`);
  assert(sampleStride() === 5000, `sampleStride() === ${sampleStride()}`);
  assert(DISTURB_FORK_TICK === 60000, `DISTURB_FORK_TICK === ${DISTURB_FORK_TICK}`);
  assert(DISTURB_IMMEDIATE_TICK - DISTURB_FORK_TICK === 1000, "immediate pair at +1000");
  assert(DISTURB_LATE_TICK - DISTURB_FORK_TICK === 30000, "late pair at +30000");
  assert(DISTURBANCE_SEEDS.length === 4, `DISTURBANCE_SEEDS.length === ${DISTURBANCE_SEEDS.length}`);
  console.log("broad-ecology-022 selfcheck: PASS");
}

function runSurvey(): void {
  const TICKS = Math.max(1000, Math.floor(Number(arg("ticks", String(BROAD022_HORIZON)))));
  const OUT = arg("out", "testdata/broad-ecology-0.22.json");
  const archetypes = arg("archetypes", MATRIX_ARCHETYPES.join(","))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean) as Broad022Archetype[];
  for (const a of archetypes) {
    if (!MATRIX_ARCHETYPES.includes(a)) throw new Error(`unknown archetype: ${a}`);
  }
  const seeds = arg("seeds", MATRIX_SEEDS.join(","))
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
  for (const s of seeds) {
    if (!MATRIX_SEEDS.includes(s)) throw new Error(`seed ${s} is outside the fixed survey matrix`);
  }

  const result: any = {
    engine: ENGINE_VERSION,
    horizon: BROAD022_HORIZON,
    sampleStride: BROAD022_STRIDE,
    horizonJustification:
      "Matches the ecology-survey standard horizon; exceeds the niche-survey 150k establishment window and the washout 60k-settle/120k-extended windows; covers the ~63k establishment timescale noted in landscape-capture with headroom for persistence/turnover/recovery.",
    ticks: TICKS,
    archetypes,
    seeds,
    runs: [],
    disturbance: [],
  };

  // Resume: completed (archetype, seed) rows in an existing artifact are
  // kept when it belongs to this engine and horizon, so a killed run can be
  // re-invoked to finish only the missing rows. A row counts as completed
  // when it reached the requested ticks or went extinct, AND carries the
  // Task 2 terminal labels plus the Task 3 clade turnover (earlier-schema
  // rows predate them and are re-run deterministically to gain full capture).
  try {
    const prior = JSON.parse(readFileSync(OUT, "utf8"));
    if (
      prior.engine === ENGINE_VERSION &&
      prior.horizon === BROAD022_HORIZON &&
      Array.isArray(prior.runs)
    ) {
      const kept = prior.runs.filter(
        (r: any) => r && r.terminal && r.terminal.labels && r.terminal.clades && (r.terminal.tick >= TICKS || r.terminal.extinct || r.terminal.population === 0),
      );
      result.runs = kept;
      console.log(`resuming: ${kept.length} rows already retained`);
      // Disturbance pairs are carried across invocations either way, so a
      // baseline-only re-run never wipes retained pairs. A pair counts as
      // completed when its late (+30000) pair is present.
      const keptDist = Array.isArray(prior.disturbance)
        ? prior.disturbance.filter(
            (d: any) =>
              d && typeof d.forkTick === "number" && d.late && typeof d.late.tick === "number" && d.late.tick >= DISTURB_LATE_TICK,
          )
        : [];
      result.disturbance = keptDist;
      if (keptDist.length > 0) console.log(`resuming: ${keptDist.length} disturbance rows already retained`);
    }
  } catch {
    /* fresh run */
  }
  const done = new Set(result.runs.map((r: any) => `${r.archetype}/${r.seed}`));

  const runs: Broad022Run[] = result.runs;
  for (const archetype of archetypes) {
    for (const seed of seeds) {
      if (done.has(`${archetype}/${seed}`)) {
        console.log(`${archetype}/${seed}: already retained, skipping`);
        continue;
      }
      const row = surveyRun(archetype, seed, TICKS);
      runs.push(row);
      writeResult(OUT, result);
      console.log(
        `${archetype}/${seed}: tick ${row.terminal.tick}, pop ${row.terminal.population}, outcome ${row.terminal.outcome}, labels ${row.terminal.labels.resources_waste}/${row.terminal.labels.dormancy}/${row.terminal.labels.crossfeeding}/${row.terminal.labels.niche}`,
      );
    }
  }
  writeResult(OUT, result);
  if (process.argv.includes("--disturbance")) {
    runDisturbanceSection(OUT, result, archetypes, seeds);
  }
  writeResult(OUT, result);
  console.log(`broad ecology 0.22 survey: DONE -> ${OUT}`);
}

function runDisturbanceSection(OUT: string, result: any, archetypes: Broad022Archetype[], seeds: number[]): void {
  // Matched droughtA assays for the requested archetypes x the requested
  // seeds intersected with the 4-seed assay set (full run: 4x4 = 16 pairs).
  // Each assay settles a FRESH session; the baseline runs above are never
  // forked or intervened. Resume-safe like baseline rows.
  const assaySeeds = seeds.filter((s) => DISTURBANCE_SEEDS.includes(s));
  if (assaySeeds.length === 0) {
    console.log("disturbance: no requested seed is in the 4-seed assay set, skipping");
    return;
  }
  const done = new Set((result.disturbance as any[]).map((d: any) => `${d.archetype}/${d.seed}`));
  for (const archetype of archetypes) {
    for (const seed of assaySeeds) {
      if (done.has(`${archetype}/${seed}`)) {
        console.log(`disturbance/${archetype}/${seed}: already retained, skipping`);
        continue;
      }
      const row = assayDisturbance(archetype, seed);
      (result.disturbance as any[]).push(row);
      writeResult(OUT, result);
      console.log(
        `disturbance/${archetype}/${seed}: fork ${row.forkTick} pop ${row.forkPopulation}, immediate live ${row.immediate.live} vs control ${row.immediate.control}, late live ${row.late.live} vs control ${row.late.control}, diverged=${row.diverged}`,
      );
    }
  }
}

const invokedAsScript =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedAsScript) {
  if (process.argv.includes("--selfcheck")) {
    selfcheck();
  } else if (
    process.argv.some((a) =>
      ["--ticks=", "--out=", "--archetypes=", "--seeds=", "--disturbance"].some(
        (f) => a === f || a.startsWith(f),
      ),
    )
  ) {
    runSurvey();
  } else {
    console.error(
      "usage: tsx tools/validation/broad-ecology-022.ts -- [--selfcheck | --ticks=N --out=PATH --archetypes=A,.. --seeds=S,.. [--disturbance]]",
    );
    process.exitCode = 2;
  }
}
