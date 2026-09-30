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
  };
  records: Array<{ kind: unknown; phase: unknown; tick: unknown }>;
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
    samples.push({ tick: snap.tick, population: snap.population });
    if (snap.population === 0) break;
  }
  const terminal = session.snapshot();
  const tm: any = terminal.metrics;
  const extinctTick = tm.extinct_tick ?? null;
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
  let records: Broad022Run["records"] = [];
  try {
    const raw: any[] = session.analysis.records;
    if (Array.isArray(raw)) {
      records = raw.map((r: any) => ({ kind: r.kind, phase: r.phase, tick: r.tick }));
    }
  } catch {
    /* keep records empty rather than failing the run */
  }
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
      outcome: tm.ecological_outcome ?? null,
    },
    records,
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
  console.log("broad-ecology-022 selfcheck: PASS");
}

function runSurvey(): void {
  if (process.argv.includes("--disturbance")) {
    throw new Error("broad-ecology-022: --disturbance lands in Task 3 (not implemented in the Task 1 scaffold)");
  }
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
  };

  // Resume: completed (archetype, seed) rows in an existing artifact are
  // kept when it belongs to this engine and horizon, so a killed run can be
  // re-invoked to finish only the missing rows. A row counts as completed
  // when it reached the requested ticks or went extinct.
  try {
    const prior = JSON.parse(readFileSync(OUT, "utf8"));
    if (
      prior.engine === ENGINE_VERSION &&
      prior.horizon === BROAD022_HORIZON &&
      Array.isArray(prior.runs)
    ) {
      const kept = prior.runs.filter(
        (r: any) => r && r.terminal && (r.terminal.tick >= TICKS || r.terminal.extinct || r.terminal.population === 0),
      );
      result.runs = kept;
      console.log(`resuming: ${kept.length} rows already retained`);
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
        `${archetype}/${seed}: tick ${row.terminal.tick}, pop ${row.terminal.population}, outcome ${row.terminal.outcome}`,
      );
    }
  }
  writeResult(OUT, result);
  console.log(`broad ecology 0.22 survey: DONE -> ${OUT}`);
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
      "usage: tsx tools/validation/broad-ecology-022.ts -- [--selfcheck | --ticks=N --out=PATH --archetypes=A,.. --seeds=S,..]",
    );
    process.exitCode = 2;
  }
}
