import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { UniverseSession } from "../../packages/sim-runtime/src/session.ts";
import { ENGINE_VERSION } from "../../packages/sim-core/src/index.ts";
import {
  BROAD022_HORIZON,
  BROAD022_STRIDE,
  DISTURBANCE_SEEDS,
  DISTURB_FORK_TICK,
  DISTURB_IMMEDIATE_TICK,
  DISTURB_LATE_TICK,
  MATRIX_ARCHETYPES,
  MATRIX_SEEDS,
  PRESETS,
  captureSample,
  config,
  labelCrossfeeding,
  labelDormancy,
  labelNiche,
  labelResourcesWaste,
  settleTo,
  summarizeClades,
} from "./broad-ecology-022.ts";
import type {
  Broad022Archetype,
  Broad022Sample,
} from "./broad-ecology-022.ts";

// Broad engine-0.22 ecology summary generator (Task 4 aggregation layer).
//
// Read-only over the retained artifact: never re-runs biology except under
// the explicit `--spotcheck` flag, which replays retained baseline runs
// through the current engine determinism contract. Never edits the artifact.
//
// Usage:
//   pnpm exec tsx tools/validation/broad-ecology-022-summary.ts -- \
//     --in=testdata/broad-ecology-0.22.json \
//     --out=testdata/broad-ecology-0.22-summary.md \
//     --tables=testdata/broad-ecology-0.22-tables.json [--spotcheck]

const DEVICE_GAP =
  "no attributable representative-device environment in this tranche; " +
  "desktop/headless timings are harness costs, not device evidence";

function arg(name: string, fallback: string | null): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function hashSamples(samples: unknown): string {
  return sha256Hex(JSON.stringify(samples ?? null));
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Tiny structural deep-equal for the disturbance identity join. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, (b as unknown[])[i]));
  }
  const ka = Object.keys(a as Record<string, unknown>);
  const kb = new Set(Object.keys(b as Record<string, unknown>));
  if (ka.length !== kb.size) return false;
  return ka.every(
    (k) =>
      kb.has(k) &&
      deepEqual(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
      ),
  );
}

function countBy<T>(items: T[], key: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    const k = key(item);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

function range(ns: number[]): { min: number; max: number } | null {
  if (ns.length === 0) return null;
  return { min: Math.min(...ns), max: Math.max(...ns) };
}

function fmtRange(r: { min: number; max: number } | null): string {
  return r === null ? "not observed" : `${r.min}..${r.max}`;
}

function rowName(archetype: unknown, seed: unknown): string {
  return `${String(archetype)}/${String(seed)}`;
}

interface SpotcheckRow {
  run: string;
  expectedHash: string;
  actualHash: string;
  match: boolean;
  tickMatch: boolean;
  populationMatch: boolean;
  engineMatch: boolean;
  note: string | null;
}

/**
 * Re-run one retained baseline run with identical engine/config/seed/stride
 * and compare tick, population, and a stable hash of the scalar samples.
 * Uses the current engine determinism contract only: an engine mismatch is
 * reported, not asserted.
 */
function spotcheckRun(retained: any): SpotcheckRow {
  const name = rowName(retained?.archetype, retained?.seed);
  const fail = (
    note: string,
    expectedHash = "",
    actualHash = "",
  ): SpotcheckRow => ({
    run: name,
    expectedHash,
    actualHash,
    match: false,
    tickMatch: false,
    populationMatch: false,
    engineMatch: false,
    note,
  });
  if (!retained || typeof retained !== "object") return fail("retained row is not an object");
  const { archetype, seed } = retained as { archetype: unknown; seed: unknown };
  if (!MATRIX_ARCHETYPES.includes(archetype as Broad022Archetype)) {
    return fail(`archetype ${String(archetype)} is outside the fixed survey matrix`);
  }
  if (typeof seed !== "number" || !Number.isFinite(seed)) {
    return fail(`seed ${String(seed)} is not a finite number`);
  }
  const target = num(retained?.terminal?.tick);
  if (target === null || target < 0) return fail("retained terminal.tick is not observable");
  const expectedHash = hashSamples(retained.samples);
  if (retained?.identity?.engine !== ENGINE_VERSION) {
    return fail(
      `engine changed (retained ${String(retained?.identity?.engine)} vs current ${ENGINE_VERSION}); determinism contract does not span versions`,
      expectedHash,
    );
  }
  const session = new UniverseSession();
  session.create(config(seed, archetype as Broad022Archetype));
  const samples: Broad022Sample[] = [];
  for (let done = 0; done < target; done += BROAD022_STRIDE) {
    settleTo(session, Math.min(done + BROAD022_STRIDE, target));
    const snap = session.snapshot();
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
  const actualHash = hashSamples(samples);
  const tickMatch = terminal.tick === retained.terminal.tick;
  const populationMatch = terminal.population === retained.terminal.population;
  const hashMatch = actualHash === expectedHash;
  // Labels/clades recomputed from the fresh run's full records as a
  // consistency read only; the asserted contract is tick + population + hash.
  let labelsMatch = true;
  try {
    const raw: any[] = Array.isArray(session.analysis.records)
      ? session.analysis.records
      : [];
    const fresh = {
      resources_waste: labelResourcesWaste(samples),
      dormancy: labelDormancy(samples, raw),
      crossfeeding: labelCrossfeeding(samples, raw),
      niche: labelNiche(samples, raw),
    };
    const kept = retained.terminal.labels;
    labelsMatch =
      !!kept &&
      fresh.resources_waste === kept.resources_waste &&
      fresh.dormancy === kept.dormancy &&
      fresh.crossfeeding === kept.crossfeeding &&
      fresh.niche === kept.niche;
    void summarizeClades(samples, raw);
  } catch {
    labelsMatch = false;
  }
  const match = tickMatch && populationMatch && hashMatch;
  return {
    run: name,
    expectedHash,
    actualHash,
    match,
    tickMatch,
    populationMatch,
    engineMatch: true,
    note: labelsMatch ? null : "terminal labels recomputed from the fresh run disagree with the retained labels",
  };
}

function generate(inPath: string, outPath: string, tablesPath: string, spotcheck: boolean): void {
  const artifact: any = JSON.parse(readFileSync(inPath, "utf8"));
  if (!artifact || !Array.isArray(artifact.runs)) {
    throw new Error(`artifact ${inPath} has no runs[]; refusing to summarize`);
  }
  const runs: any[] = artifact.runs;
  const disturbance: any[] = Array.isArray(artifact.disturbance) ? artifact.disturbance : [];

  // --- Per-run rows (fail-closed reads; missing fields are not-observed) ----
  const extinct = runs.filter(
    (r) => r?.terminal?.extinct === true || num(r?.terminal?.population) === 0,
  );
  const labelCounts = {
    resources_waste: countBy(runs, (r) => String(r?.terminal?.labels?.resources_waste ?? "not-observed")),
    dormancy: countBy(runs, (r) => String(r?.terminal?.labels?.dormancy ?? "not-observed")),
    crossfeeding: countBy(runs, (r) => String(r?.terminal?.labels?.crossfeeding ?? "not-observed")),
    niche: countBy(runs, (r) => String(r?.terminal?.labels?.niche ?? "not-observed")),
  };
  const outcomes = countBy(runs, (r) => String(r?.terminal?.outcome ?? "not-observed"));
  const terminalPops = runs
    .map((r) => num(r?.terminal?.population))
    .filter((n): n is number => n !== null);
  const terminalTicks = runs
    .map((r) => num(r?.terminal?.tick))
    .filter((n): n is number => n !== null);
  const byArchetype: Record<string, { runs: number; extinct: number; pop: number[] }> = {};
  for (const a of MATRIX_ARCHETYPES) byArchetype[a] = { runs: 0, extinct: 0, pop: [] };
  for (const r of runs) {
    const slot = byArchetype[String(r?.archetype)];
    if (!slot) continue;
    slot.runs++;
    if (r?.terminal?.extinct === true || num(r?.terminal?.population) === 0) slot.extinct++;
    const p = num(r?.terminal?.population);
    if (p !== null) slot.pop.push(p);
  }
  // Last-sample scalar ranges (measured quantities only; nulls excluded).
  const lastOf = (r: any, f: string): number | null => {
    const ss = Array.isArray(r?.samples) && r.samples.length > 0 ? r.samples[r.samples.length - 1] : null;
    return num(ss?.[f]);
  };
  const wasteLast = range(runs.map((r) => lastOf(r, "waste_fraction")).filter((n): n is number => n !== null));
  const dormMax = range(
    runs
      .map((r) => {
        const vals = Array.isArray(r?.samples)
          ? r.samples.map((s: any) => num(s?.dormant_fraction)).filter((n: number | null): n is number => n !== null)
          : [];
        return vals.length > 0 ? Math.max(...vals) : null;
      })
      .filter((n): n is number => n !== null),
  );

  // --- Negative cases (representative rows named, never dropped) -------------
  const noDormancy = runs.filter((r) => r?.terminal?.labels?.dormancy === "negligible/absent");
  const noCrossfeeding = runs.filter((r) => r?.terminal?.labels?.crossfeeding === "absent");
  const noNiche = runs.filter((r) => r?.terminal?.labels?.niche === "no-modification");
  // Mandatory carry (c): the niche no-response label is unreachable under the
  // ported rule, so it is never expected in aggregates; its absence is a rule
  // artifact, not a finding.
  const noResponseCount = runs.filter((r) => r?.terminal?.labels?.niche === "no-response").length;

  // --- Disturbance: join each pair to baseline identity before citing --------
  // Mandatory carries (a)+(d): NULL-check late.liveA/late.controlA before
  // citing diverged (null-stock rows are not-observed, never no-divergence),
  // and join each pair to baseline identity (engine + resolvedConfig via
  // archetype/seed/commands) before citing comparability under AC1.
  const baselineByKey = new Map<string, any>();
  for (const r of runs) baselineByKey.set(rowName(r?.archetype, r?.seed), r);
  const disturbanceRows = disturbance.map((d) => {
    const base = baselineByKey.get(rowName(d?.archetype, d?.seed)) ?? null;
    const stocksObserved = d?.late?.liveA !== null && d?.late?.liveA !== undefined && d?.late?.controlA !== null && d?.late?.controlA !== undefined &&
      typeof d?.late?.liveA === "number" && Number.isFinite(d.late.liveA) &&
      typeof d?.late?.controlA === "number" && Number.isFinite(d.late.controlA);
    const recomputed = stocksObserved ? (d.late.liveA as number) < (d.late.controlA as number) : null;
    const cited = stocksObserved ? (recomputed ? "diverged" : "no-divergence") : "not-observed";
    const retainedFlag = d?.diverged === true;
    const flagAgrees = stocksObserved ? retainedFlag === recomputed : true;
    let configMatch: boolean | "not-observed" = "not-observed";
    if (base && MATRIX_ARCHETYPES.includes(d?.archetype) && typeof d?.seed === "number") {
      try {
        configMatch = deepEqual(base?.identity?.resolvedConfig, config(d.seed, d.archetype));
      } catch {
        configMatch = false;
      }
    }
    return {
      archetype: d?.archetype ?? null,
      seed: d?.seed ?? null,
      forkTick: d?.forkTick ?? null,
      forkPopulation: d?.forkPopulation ?? null,
      immediate: d?.immediate ?? null,
      late: d?.late ?? null,
      liveOutcome: d?.liveOutcome ?? null,
      controlOutcome: d?.controlOutcome ?? null,
      divergedRetained: retainedFlag,
      divergedRecomputed: recomputed,
      divergedCited: cited,
      flagAgrees,
      join: {
        baselineFound: base !== null,
        engine: base?.identity?.engine ?? null,
        configMatch,
        baselineCommandsRetained: Array.isArray(base?.identity?.commandSequence) && base.identity.commandSequence.length > 0,
        assayCommandsRetained: Array.isArray(d?.commands) && d.commands.length > 0,
      },
    };
  });
  const divergedRows = disturbanceRows.filter((d) => d.divergedCited === "diverged");
  const noDivergenceRows = disturbanceRows.filter((d) => d.divergedCited === "no-divergence");
  const stocksNotObservedRows = disturbanceRows.filter((d) => d.divergedCited === "not-observed");
  const flagMismatches = disturbanceRows.filter((d) => !d.flagAgrees);

  // --- Clade turnover aggregates ---------------------------------------------
  // Mandatory carry (e): replacementsObserved=false is never read as evidence
  // against silent richness drift; the sample series is the drift evidence.
  const turnoverCounts = {
    replacements: countBy(runs, (r) => String(r?.terminal?.clades?.replacementsObserved ?? "not-observed")),
    collapse: countBy(runs, (r) => String(r?.terminal?.clades?.collapseObserved ?? "not-observed")),
    recovery: countBy(runs, (r) => String(r?.terminal?.clades?.recoveryObserved ?? "not-observed")),
  };
  const cladeMax = range(
    runs.map((r) => num(r?.terminal?.clades?.everActiveMax)).filter((n): n is number => n !== null),
  );

  // --- Spot check --------------------------------------------------------------
  let spotcheckRows: SpotcheckRow[] | null = null;
  if (spotcheck) {
    const first = runs.length > 0 ? runs[0] : null;
    const edge = runs.find((r) => r?.terminal?.extinct === true) ?? null;
    const last = runs.length > 0 ? runs[runs.length - 1] : null;
    const picks = [first, edge ?? last].filter((r) => r !== null && r !== undefined);
    const deduped = picks.filter(
      (r, i) => picks.findIndex((q) => rowName(q?.archetype, q?.seed) === rowName(r?.archetype, r?.seed)) === i,
    );
    spotcheckRows = deduped.map((r) => spotcheckRun(r));
  }

  // --- Claims ------------------------------------------------------------------
  const supportedClaims = [
    `Retained ${runs.length} baseline runs (${MATRIX_ARCHETYPES.join("/")}) with per-${BROAD022_STRIDE}-tick scalar trajectories (${runs.length > 0 ? "up to 50 samples/run" : "no runs retained"}).`,
    `Terminal populations range ${fmtRange(range(terminalPops))} across ${terminalPops.length} retained runs; ${extinct.length} of ${runs.length} runs extinct.`,
    `Label distributions are as tabulated (counts, never best-run-only); negative cases are named in the tables.`,
    disturbedClaim(),
    spotcheckClaim(),
  ];
  function disturbedClaim(): string {
    if (disturbanceRows.length === 0) return "No matched disturbance pairs retained; no disturbance claim is supported.";
    return (
      `${disturbanceRows.length} matched droughtA pairs retained (fork ${DISTURB_FORK_TICK}, immediate +1000, late +30000): ` +
      `${divergedRows.length} diverged, ${noDivergenceRows.length} no-divergence, ${stocksNotObservedRows.length} stocks-not-observed; ` +
      `comparability is cited only through the baseline identity join (engine + resolvedConfig).`
    );
  }
  function spotcheckClaim(): string {
    if (spotcheckRows === null) return "Reproducibility spot check not run in this invocation (no --spotcheck flag).";
    const matched = spotcheckRows.filter((r) => r.match).length;
    return `Reproducibility spot check: ${matched}/${spotcheckRows.length} re-runs identical in tick, population, and scalar-sample hash under the current engine determinism contract.`;
  }
  const notSupportedClaims = [
    "Exactness of engine behaviour: this is characterisation across seeds, not proof that any trajectory is exact.",
    "Representative-device performance: " + DEVICE_GAP + ".",
    "Causal attribution of late-pair divergence to the droughtA intervention beyond the matched comparison: the pairs are descriptive, never causal.",
    "Ecological reliance on cross-feeding from single-run labels alone: reliance needs matched-assay support; per-run labels top out at in-use.",
    "Absence of the niche no-response label as a biological finding: it is unreachable under the ported rule (rule artifact).",
    "Absence of silent richness drift from replacementsObserved=false: the sample series is the drift evidence, not the verdict flag.",
    "No-divergence readings from null-stock disturbance rows: diverged=false conflates no-divergence with stocks-unobserved.",
  ];
  const defects: string[] = [];
  for (const d of flagMismatches) {
    defects.push(
      `Retained diverged flag disagrees with recomputed liveA<controlA comparison on ${rowName(d.archetype, d.seed)} (reported, not fixed).`,
    );
  }
  if (defects.length === 0) {
    defects.push("No biology defect observed in the retained artifact. None fixed: this generator is read-only.");
  }

  // --- Tables JSON ---------------------------------------------------------------
  const tables = {
    meta: {
      generator: "tools/validation/broad-ecology-022-summary.ts",
      in: inPath,
      engine: artifact.engine ?? null,
      currentEngine: ENGINE_VERSION,
      engineMatch: artifact.engine === ENGINE_VERSION,
      horizon: artifact.horizon ?? BROAD022_HORIZON,
      sampleStride: artifact.sampleStride ?? BROAD022_STRIDE,
      horizonJustification: artifact.horizon ?? null,
      runCount: runs.length,
      disturbanceCount: disturbanceRows.length,
    },
    matrix: {
      archetypes: MATRIX_ARCHETYPES,
      seeds: MATRIX_SEEDS,
      horizon: BROAD022_HORIZON,
      sampleStride: BROAD022_STRIDE,
      presets: PRESETS,
      disturbanceSeeds: DISTURBANCE_SEEDS,
      forkTick: DISTURB_FORK_TICK,
      immediateTick: DISTURB_IMMEDIATE_TICK,
      lateTick: DISTURB_LATE_TICK,
    },
    runs: runs.map((r) => ({
      archetype: r?.archetype ?? null,
      seed: r?.seed ?? null,
      tick: num(r?.terminal?.tick),
      population: num(r?.terminal?.population),
      extinct: r?.terminal?.extinct === true,
      extinctTick: num(r?.terminal?.extinctTick),
      outcome: r?.terminal?.outcome ?? null,
      labels: r?.terminal?.labels ?? null,
      clades: r?.terminal?.clades ?? null,
      samplesRetained: Array.isArray(r?.samples) ? r.samples.length : 0,
      engine: r?.identity?.engine ?? null,
    })),
    distributions: {
      terminalPopulation: range(terminalPops),
      terminalTick: range(terminalTicks),
      extinctCount: extinct.length,
      byArchetype: Object.fromEntries(
        Object.entries(byArchetype).map(([k, v]) => [k, { runs: v.runs, extinct: v.extinct, population: range(v.pop) }]),
      ),
      labels: labelCounts,
      outcomes: outcomes,
      lastSampleWasteFraction: wasteLast,
      maxDormantFraction: dormMax,
      cladeEverActiveMax: cladeMax,
      turnover: turnoverCounts,
      nicheNoResponseCount: noResponseCount,
    },
    negativeCases: {
      extinct: extinct.map((r) => rowName(r?.archetype, r?.seed)),
      noDormancy: noDormancy.map((r) => rowName(r?.archetype, r?.seed)),
      noCrossfeeding: noCrossfeeding.map((r) => rowName(r?.archetype, r?.seed)),
      noNiche: noNiche.map((r) => rowName(r?.archetype, r?.seed)),
      noDivergence: noDivergenceRows.map((d) => rowName(d.archetype, d.seed)),
      stocksNotObserved: stocksNotObservedRows.map((d) => rowName(d.archetype, d.seed)),
      diverged: divergedRows.map((d) => rowName(d.archetype, d.seed)),
    },
    disturbance: disturbanceRows,
    spotcheck: spotcheckRows,
    supportedClaims,
    notSupportedClaims,
    defects,
    notes: {
      wakes: "Per-sample wakes comes from read-only simulation.last.wakes (interval-scoped, null-fallback); it is part of the per-sample source list.",
      nicheNoResponse:
        "The niche no-response label is unreachable under the ported rule and is never expected in aggregates; its absence is a rule artifact, not a finding.",
      replacementsObserved:
        "replacementsObserved=false is never read as evidence against silent richness drift; the clades_active sample series is the drift evidence.",
      divergedNulls:
        "diverged=false conflates no-divergence with stocks-unobserved; only rows with non-null late.liveA/late.controlA are cited as diverged or no-divergence, the rest as not-observed.",
    },
  };
  writeFileSync(tablesPath, JSON.stringify(tables, null, 2));

  // --- Markdown summary (five verbatim sections) -----------------------------------
  const L: string[] = [];
  L.push("# Broad engine-0.22 ecology characterization — summary");
  L.push("");
  L.push(`Read-only aggregation over \`${inPath}\` (engine ${String(artifact.engine ?? "unknown")}, ${runs.length} baseline runs, ${disturbanceRows.length} matched pairs). This file characterises; it proves nothing exact.`);
  L.push("");
  L.push("## Survey matrix");
  L.push("");
  L.push(`- Archetypes (4): ${MATRIX_ARCHETYPES.join(", ")}.`);
  L.push(`- Seeds (8, niche-survey set): ${MATRIX_SEEDS.join(", ")}.`);
  L.push(`- Horizon: ${BROAD022_HORIZON} ticks; trajectory sampling every ${BROAD022_STRIDE} ticks (50 samples/run), scalars only.`);
  L.push(`- Configs: the ecology-survey PRESETS mapping + config() verbatim per archetype: ${MATRIX_ARCHETYPES.map((a) => `${a} ${JSON.stringify((PRESETS as any)[a])}`).join("; ")}.`);
  L.push(`- Disturbance: maintained droughtA via createControlFork() + intervene("droughtA"), fork at tick ${DISTURB_FORK_TICK}, immediate pair at +1000 (tick ${DISTURB_IMMEDIATE_TICK}), late pair at +30000 (tick ${DISTURB_LATE_TICK}); assay seeds ${DISTURBANCE_SEEDS.join(", ")}.`);
  L.push(`- Horizon justification pointer: artifact field horizonJustification — ${String(artifact.horizonJustification ?? "absent")}`);
  L.push("");
  L.push("## Observed");
  L.push("");
  L.push(`Per 5000-tick sample, observed scalars only (typeof-guarded; absent is null, never 0): population, dormant_fraction, dormant_population, wakes (read-only simulation.last.wakes, interval-scoped, null-fallback), crossfeeder_fraction, c_share (resource_energy.c_share else resource_use.c_share), c_energy_share (living-energy C share; null when no living energy), metabolite_c produced/consumed, waste fraction, nutrient A/B plus accounting absolute_residual max, effective_niches, lineages/clades/families active/effective, trait_diversity, traits tolerance/cleanup means, ecological_outcome, extinct_tick. Terminal adds record headers {kind, phase, tick, entityRefKinds} and trajectory labels. Every run retained, including extinct/empty.`);
  L.push("");
  L.push(`Retained: ${runs.length} runs; terminal ticks ${fmtRange(range(terminalTicks))}; terminal populations ${fmtRange(range(terminalPops))}; ${extinct.length} extinct (${extinct.map((r) => rowName(r?.archetype, r?.seed)).join(", ") || "none"}). Outcomes: ${Object.entries(outcomes).map(([k, v]) => `${k} x${v}`).join("; ") || "none"}.`);
  L.push("");
  L.push("## Distributional characterization");
  L.push("");
  for (const [a, v] of Object.entries(byArchetype)) {
    L.push(`- ${a}: ${v.runs} run${v.runs === 1 ? "" : "s"}, ${v.extinct} extinct, terminal population ${fmtRange(range(v.pop))}.`);
  }
  L.push(`- resources/waste labels: ${Object.entries(labelCounts.resources_waste).map(([k, v]) => `${k} x${v}`).join("; ")}.`);
  L.push(`- dormancy labels: ${Object.entries(labelCounts.dormancy).map(([k, v]) => `${k} x${v}`).join("; ")}.`);
  L.push(`- cross-feeding labels: ${Object.entries(labelCounts.crossfeeding).map(([k, v]) => `${k} x${v}`).join("; ")} (ecologically-relied is never emitted from single runs; reliance needs matched-assay support).`);
  L.push(`- niche labels: ${Object.entries(labelCounts.niche).map(([k, v]) => `${k} x${v}`).join("; ")} (no-response count ${noResponseCount}; absence is a rule artifact, see notes).`);
  L.push(`- Last-sample waste fraction range: ${fmtRange(wasteLast)}; max dormant fraction range: ${fmtRange(dormMax)}.`);
  L.push(`- Clade ever-active-max range: ${fmtRange(cladeMax)}; turnover verdicts replacements ${JSON.stringify(turnoverCounts.replacements)}, collapse ${JSON.stringify(turnoverCounts.collapse)}, recovery ${JSON.stringify(turnoverCounts.recovery)}.`);
  L.push(`- Representative negative cases named: extinct [${extinct.map((r) => rowName(r?.archetype, r?.seed)).join(", ") || "none"}]; no-dormancy [${noDormancy.map((r) => rowName(r?.archetype, r?.seed)).join(", ") || "none"}]; no-crossfeeding [${noCrossfeeding.map((r) => rowName(r?.archetype, r?.seed)).join(", ") || "none"}]; no-niche [${noNiche.map((r) => rowName(r?.archetype, r?.seed)).join(", ") || "none"}]; no-divergence [${noDivergenceRows.map((d) => rowName(d.archetype, d.seed)).join(", ") || "none"}].`);
  L.push("");
  L.push("## Matched evidence");
  L.push("");
  L.push(`Matching basis: each droughtA pair settles a fresh session on the Task 1 config to tick ${DISTURB_FORK_TICK}, forks before intervening (baseline 32 runs never forked), and reads live/control pairs at +1000 (mechanical) and +30000 (ecological). Comparability under AC1 is cited only through the per-pair join to baseline identity (engine + resolvedConfig via archetype/seed/commands).`);
  L.push("");
  if (disturbanceRows.length === 0) {
    L.push("No matched disturbance pairs retained.");
  } else {
    for (const d of disturbanceRows) {
      L.push(
        `- ${rowName(d.archetype, d.seed)}: fork ${String(d.forkTick)} pop ${String(d.forkPopulation)}; ` +
        `immediate live ${String(d.immediate?.live)} vs control ${String(d.immediate?.control)}; ` +
        `late live ${String(d.late?.live)} vs control ${String(d.late?.control)} (outcomes ${String(d.liveOutcome)} / ${String(d.controlOutcome)}); ` +
        `cited ${d.divergedCited}${d.divergedCited === "not-observed" ? " (stocks unobserved)" : ""}; ` +
        `join: baseline ${d.join.baselineFound ? "found" : "MISSING"} engine ${String(d.join.engine)} configMatch ${String(d.join.configMatch)}.`,
      );
    }
  }
  L.push("");
  L.push("## Mechanistic support");
  L.push("");
  L.push(`Measured quantities cited: late-pair nutrient A stocks (liveA vs controlA) for divergence; C-share/crossfeeder series for in-use vs weak/transient; waste/nutrient series for accumulation/depletion/cycling; dormant fraction plus wake_clades evidence for established-with-return; tolerance/cleanup shifts for strategy-shift-without-establishment. replacementsObserved=false is never read as evidence against silent richness drift; the clades_active sample series is the drift evidence.`);
  L.push("");
  L.push("## Not established");
  L.push("");
  for (const c of notSupportedClaims) L.push(`- ${c}`);
  L.push("");
  L.push("## Device-performance gap");
  L.push("");
  L.push(`- ${DEVICE_GAP}.`);
  L.push("");
  L.push("## Supported claims");
  L.push("");
  for (const c of supportedClaims) L.push(`- ${c}`);
  L.push("");
  L.push("## Not-supported claims");
  L.push("");
  for (const c of notSupportedClaims) L.push(`- ${c}`);
  L.push("");
  L.push("## Biology defects");
  L.push("");
  for (const d of defects) L.push(`- ${d}`);
  L.push("");
  L.push("## Reproducibility spot check");
  L.push("");
  if (spotcheckRows === null) {
    L.push("Not run in this invocation (pass --spotcheck to re-run retained baselines under the current engine determinism contract).");
  } else if (spotcheckRows.length === 0) {
    L.push("No retained baseline runs to re-run.");
  } else {
    L.push(`Re-ran ${spotcheckRows.length} retained baseline runs (first + one extinct/edge if present, else last) with identical engine/config/seed/commands; asserted identical tick, population, and stable hash of the retained scalar samples.`);
    for (const r of spotcheckRows) {
      L.push(`- ${r.run}: match=${r.match} (tick ${r.tickMatch}, population ${r.populationMatch}, hash ${r.actualHash === r.expectedHash})${r.note ? `; note: ${r.note}` : ""}`);
    }
  }
  L.push("");
  writeFileSync(outPath, L.join("\n"));
  console.log(`broad ecology 0.22 summary: DONE -> ${outPath} + ${tablesPath}`);
  if (spotcheckRows !== null) {
    const matched = spotcheckRows.filter((r) => r.match).length;
    console.log(`spotcheck: ${matched}/${spotcheckRows.length} match`);
    if (matched !== spotcheckRows.length) {
      process.exitCode = 1;
    }
  }
}

const invokedAsScript =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedAsScript) {
  const IN = arg("in", null);
  const OUT = arg("out", null);
  let TABLES = arg("tables", null);
  const SPOTCHECK = process.argv.includes("--spotcheck");
  if (IN === null || OUT === null) {
    console.error(
      "usage: tsx tools/validation/broad-ecology-022-summary.ts -- --in=ARTIFACT --out=SUMMARY.md [--tables=TABLES.json] [--spotcheck]",
    );
    process.exitCode = 2;
  } else {
    if (TABLES === null) {
      TABLES = OUT.endsWith(".md") ? OUT.slice(0, -3) + "-tables.json" : `${OUT}-tables.json`;
    }
    try {
      generate(IN, OUT, TABLES, SPOTCHECK);
    } catch (err) {
      console.error(`broad-ecology-022-summary: FAIL: ${(err as Error).message}`);
      process.exitCode = 1;
    }
  }
}
