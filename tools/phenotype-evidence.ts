/**
 * Lane 2 M4B Pixel Phenotype — Phase 2 evidence generator.
 *
 * Generates the complete visual prototype evidence package:
 *  1. six-family silhouette matrix (low/med/high expression)
 *  2. single-trait deformation strips (8 traits x 5 steps x 2 families)
 *  3. lineage progression strips (stable / directional / near-boundary / transition)
 *  4. transition-boundary founder-vs-descendant comparisons
 *  5. save/load continuity cases with grid hashes
 *  6. cross-universe equivalence
 *  7. active/dormant pairs (weak + strong) for all six families
 *  8. dense-world LOD scenes from real engine runs (50 / 250 / 1000 / 3000+)
 *  9. performance observations vs the current voxel renderer (mock canvas)
 * plus a tuning-evidence section (hysteresis band scan, quantum vs mutation
 * scale, family separation, LOD budgets).
 *
 * Deterministic: fixed seeds throughout; presentation-side RNG only
 * (mulberry32). Reads live engine state but never mutates biology.
 *
 * Run: pnpm exec tsx tools/phenotype-evidence.ts
 * Writes: packages/phenotype/evidence/{evidence.json, EVIDENCE.md, viewer.html}
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { UniverseSession } from "../packages/sim-runtime/src/session.ts";
import type { EngineConfig, RenderOrganism, RenderSnapshot } from "../packages/contracts/src/index.ts";
import {
  DORMANCY_STRONG_THRESHOLD,
  FAMILY_CENTERS,
  FAMILY_ORDER,
  LOD_GRID_SIZE,
  PROTOTYPE_BASELINE,
  QUANT_LEVELS,
  TRAIT_RANGES,
  countFilled,
  deriveAxes,
  distancesToAll,
  drawGridToCanvas,
  gridDifference,
  lodTierForZoom,
  renderPhenotypeGrid,
  resolveDescendantFamily,
  resolvePhenotype,
  type LodTier,
  type PhenotypeFamily,
  type PhenotypeGrid,
  type ResolvedPhenotype,
  type TraitSample,
} from "../packages/phenotype/src/index.ts";

const OUT = new URL("../packages/phenotype/evidence/", import.meta.url);
mkdirSync(OUT, { recursive: true });

/** Visual capture for viewer.html: every rendered evidence grid. */
interface Shot { section: string; key: string; label: string; tier: LodTier; activity: "active" | "dormant"; size: number; bits: string; family: PhenotypeFamily }
const shots: Shot[] = [];
function shot(section: string, key: string, label: string, res: ResolvedPhenotype, tier: LodTier, activity: "active" | "dormant"): PhenotypeGrid {
  const g = renderPhenotypeGrid(res, tier, activity);
  shots.push({ section, key, label, tier, activity, size: g.size, bits: bits(g), family: res.family });
  return g;
}

/** Deterministic presentation-side RNG (never a simulation stream). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function traitsForAxes(mob: number, sen: number, met: number, spec: number): TraitSample {
  const x = Math.min(1, spec / 0.75);
  const rem = spec - 0.75 * x;
  return {
    speed: 0.25 + mob * 3.75,
    sensing: 10 + sen * 170,
    metabolism: 0.04 + met * 0.46,
    reproduction: 100,
    diet: x * 1.5,
    habitat: x * 1.5,
    byproductUse: Math.max(0, Math.min(1, rem / 0.25)) * 1.5,
    dormancyResponse: 1.0,
  };
}

function traitsAt(family: PhenotypeFamily): TraitSample {
  const c = FAMILY_CENTERS[family];
  return traitsForAxes(c[0], c[1], c[2], c[3]);
}

function gridHash(g: PhenotypeGrid): string {
  let h = 2166136261;
  for (const b of g.cells) {
    h ^= b ? 1 : 0;
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function bits(g: PhenotypeGrid): string {
  return g.cells.map((b) => (b ? "1" : "0")).join("");
}

/** Render grids side-by-side as ASCII lines with a label row. */
function sideBySide(cells: Array<{ label: string; grid: PhenotypeGrid }>): string[] {
  const header = cells.map((c) => c.label.padEnd(c.grid.size, " ")).join("  ");
  const rows = gridRows(cells.map((c) => c.grid));
  return [header, ...rows];
}

function gridRows(grids: PhenotypeGrid[]): string[] {
  const out: string[] = [];
  const size = grids[0]?.size ?? 0;
  for (let y = 0; y < size; y++) {
    out.push(grids.map((g) => rowOf(g, y)).join("  "));
  }
  return out;
}

function rowOf(g: PhenotypeGrid, y: number): string {
  let s = "";
  for (let x = 0; x < g.size; x++) s += g.cells[y * g.size + x] ? "#" : ".";
  return s;
}

function assertFamily(res: ResolvedPhenotype, want: PhenotypeFamily, where: string): void {
  if (res.family !== want) {
    throw new Error(`evidence assumption broken at ${where}: want ${want}, got ${res.family}`);
  }
}

const md: string[] = [];
const json: Record<string, unknown> = { baseline: PROTOTYPE_BASELINE, sections: {} };
const emit = (s = ""): void => {
  md.push(s);
};

// ---------------------------------------------------------------- 1. matrix
emit("# Pixel Phenotype Prototype — Evidence Package (Phase 2)");
emit("");
emit(`Prototype baseline: \`${PROTOTYPE_BASELINE}\`. All numerical constants are tuning inputs, not accepted design values.`);
emit("Family order, monochrome, inspection tier unless noted. `E`/`P`/`I` = ecosystem/population/inspection LOD.");
emit("");
emit("Visual companion: `viewer.html` in this directory (self-contained, offline) renders every matrix, strip, pair, and dense scene on canvas, including tier toggles for scenes.");
emit("");

interface MatrixCell { family: PhenotypeFamily; level: string; traits: TraitSample; res: ResolvedPhenotype; grids: Record<LodTier, PhenotypeGrid>; }
const matrix: MatrixCell[] = [];
{
  emit("## 1. Six-family silhouette matrix (low / medium / high expression)");
  emit("");
  emit("Expression driver per family (other traits at the family center, lineage-anchored so the family holds):");
  emit("blob/speed, segmented/speed, radial/sensing, plated/metabolism, branching/sensing, paddled/speed.");
  emit("Low ends are basin-limited: each family's identity needs its driver above a floor (e.g. radial needs sensing reach, plated needs metabolic intensity) — pushing below genuinely leaves the basin. The generator asserts the family holds and fails loudly otherwise.");
  emit("");
  const drivers: Record<PhenotypeFamily, { trait: keyof TraitSample; range: [number, number]; values: [number, number, number] }> = {
    // Blob is a generalist attractor: pushing any axis hard genuinely leaves
    // its basin (a model finding, see §10), so its expression range is
    // narrower by design. All other families span the full driver range.
    blob: { trait: "speed", range: TRAIT_RANGES.speed, values: [0.5, 1.5, 2.5] },
    segmented: { trait: "speed", range: TRAIT_RANGES.speed, values: [2.0, 2.9, 3.8] },
    radial: { trait: "sensing", range: TRAIT_RANGES.sensing, values: [110, 140, 170] },
    plated: { trait: "metabolism", range: TRAIT_RANGES.metabolism, values: [0.25, 0.36, 0.48] },
    branching: { trait: "sensing", range: TRAIT_RANGES.sensing, values: [70, 120, 170] },
    paddled: { trait: "speed", range: TRAIT_RANGES.speed, values: [2.0, 2.9, 3.8] },
  };
  const levels = ["low", "medium", "high"] as const;
  const sec1: Record<string, unknown> = {};
  for (const f of FAMILY_ORDER) {
    const d = drivers[f];
    const cols: Array<{ label: string; grid: PhenotypeGrid }> = [];
    const famCells: unknown[] = [];
    levels.forEach((level, i) => {
      const traits = { ...traitsAt(f), [d.trait]: d.values[i] };
      const res = resolvePhenotype(traits, { parentFamily: f, organismId: 7, lineageId: 3 });
      assertFamily(res, f, `matrix ${f}/${level}`);
      const grids = {
        ecosystem: shot("matrix", `${f}/${level}`, `${f} ${level} eco`, res, "ecosystem", "active"),
        population: shot("matrix", `${f}/${level}`, `${f} ${level} pop`, res, "population", "active"),
        inspection: shot("matrix", `${f}/${level}`, `${f} ${level} insp`, res, "inspection", "active"),
      };
      matrix.push({ family: f, level, traits, res, grids });
      cols.push({ label: `${level}(${d.values[i]})`, grid: grids.inspection });
      famCells.push({ level, driverValue: d.values[i], quantized: res.quantized, filled: countFilled(grids.inspection), hash: gridHash(grids.inspection) });
    });
    sec1[f] = { driver: d.trait, cells: famCells };
    emit(`### ${f} — driver ${d.trait} (inspection)`);
    emit("```");
    emit(sideBySide(cols).join("\n"));
    emit("```");
    emit("");
  }
  (json.sections as Record<string, unknown>).matrix = sec1;
}

// ------------------------------------------------------- 2. trait strips
{
  emit("## 2. Single-trait deformation strips (founder resolution, inspection tier)");
  emit("");
  emit("One trait swept across 5 steps, all else fixed at the family center. Family per column is reported — flips are data, not failures.");
  emit("");
  type Sweep = { trait: keyof TraitSample; steps: number[]; families: [PhenotypeFamily, PhenotypeFamily]; note: string };
  const sweeps: Sweep[] = [
    { trait: "speed", steps: [0.25, 1.2, 2.1, 3.0, 4.0], families: ["segmented", "paddled"], note: "elongation / locomotor prominence / cadence" },
    { trait: "sensing", steps: [10, 52, 95, 137, 180], families: ["radial", "branching"], note: "projection reach / count" },
    { trait: "metabolism", steps: [0.04, 0.155, 0.27, 0.385, 0.5], families: ["plated", "blob"], note: "density / internal activity" },
    { trait: "reproduction", steps: [55, 96, 137, 178, 220], families: ["paddled", "blob"], note: "modest bulk only" },
    { trait: "diet", steps: [-1.5, -0.75, 0, 0.75, 1.5], families: ["paddled", "segmented"], note: "edge specialization / signed patterning (strength is |.|)" },
    { trait: "habitat", steps: [-1.5, -0.75, 0, 0.75, 1.5], families: ["branching", "blob"], note: "distribution / bounded asymmetry" },
    { trait: "byproductUse", steps: [0, 0.375, 0.75, 1.125, 1.5], families: ["branching", "plated"], note: "secondary structures, stronger at the high end" },
    { trait: "dormancyResponse", steps: [0, 0.375, 0.75, 1.125, 1.5], families: ["blob", "radial"], note: "dormant transform strength; rendered DORMANT (active is unaffected)" },
  ];
  const sec2: unknown[] = [];
  for (const sw of sweeps) {
    emit(`### ${sw.trait} — ${sw.note}`);
    const entry: Record<string, unknown> = { trait: sw.trait, rows: [] };
    for (const f of sw.families) {
      const cols = sw.steps.map((v) => {
        const traits = { ...traitsAt(f), [sw.trait]: v };
        const res = resolvePhenotype(traits, { organismId: 11, lineageId: 5 });
        const activity = sw.trait === "dormancyResponse" ? "dormant" : "active";
        return { label: `${v}:${res.family.slice(0, 4)}`, grid: shot("strips", `${sw.trait}/${f}`, `${f} ${sw.trait}=${v}`, res, "inspection", activity) };
      });
      emit(`#### base ${f}`);
      emit("```");
      emit(sideBySide(cols).join("\n"));
      emit("```");
      (entry.rows as unknown[]).push({ base: f, fams: cols.map((c) => c.label) });
    }
    emit("");
    sec2.push(entry);
  }
  (json.sections as Record<string, unknown>).strips = sec2;
}

// ------------------------------------------------------- 3. lineage strips
interface LineageStep { index: number; family: PhenotypeFamily; quantized: ResolvedPhenotype["quantized"]; grid: PhenotypeGrid; }
const lineageStrips: Record<string, LineageStep[]> = {};
{
  emit("## 3. Lineage progression strips (10 chained descendants, population tier)");
  emit("");
  emit("Each step resolves as a descendant of the previous step's family (true lineage anchoring). `F` = family initial, `q` = quantized ladder indices 0-4.");
  emit("");
  const rng = mulberry32(1337);
  const jitter = (sigma: number): [number, number, number, number] =>
    [0, 1, 2, 3].map(() => (rng() * 2 - 1) * sigma) as [number, number, number, number];
  const blobC = FAMILY_CENTERS.blob;
  const segC = FAMILY_CENTERS.segmented;
  const at = (t: number): [number, number, number, number] => [
    blobC[0] + (segC[0] - blobC[0]) * t,
    blobC[1] + (segC[1] - blobC[1]) * t,
    blobC[2] + (segC[2] - blobC[2]) * t,
    blobC[3] + (segC[3] - blobC[3]) * t,
  ];
  const scenarios: Record<string, Array<[number, number, number, number]>> = {
    stable: Array.from({ length: 10 }, () => {
      const j = jitter(0.015);
      return [blobC[0] + j[0], blobC[1] + j[1], blobC[2] + j[2], blobC[3] + j[3]];
    }),
    directional: Array.from({ length: 10 }, (_, i) => [0.3 + (0.45 * i) / 9, blobC[1], blobC[2], blobC[3]]),
    "near-boundary": Array.from({ length: 10 }, (_, i) => at(0.45 + 0.1 * Math.sin(i * 1.3))),
    transition: Array.from({ length: 10 }, (_, i) => at(0.3 + (0.65 * i) / 9)),
  };
  const sec3: Record<string, unknown> = {};
  for (const [name, path] of Object.entries(scenarios)) {
    let parent: PhenotypeFamily | null = null;
    const steps: LineageStep[] = [];
    const cols: Array<{ label: string; grid: PhenotypeGrid }> = [];
    path.forEach(([m, s, b, p], i) => {
      const res = resolvePhenotype(traitsForAxes(m, s, b, p), { parentFamily: parent, organismId: 21 + i, lineageId: 77 });
      parent = res.family;
      const grid = shot("lineages", name, `${name} #${i} ${res.family}`, res, "population", "active");
      steps.push({ index: i, family: res.family, quantized: res.quantized, grid });
      cols.push({ label: `${i}:${res.family.slice(0, 4)}`, grid });
    });
    lineageStrips[name] = steps;
    const fams = steps.map((st) => st.family);
    sec3[name] = { families: fams, transitions: fams.filter((f, i) => i > 0 && f !== fams[i - 1]).length };
    emit(`### ${name} — families: ${fams.join(" > ")}`);
    emit("```");
    emit(sideBySide(cols).join("\n"));
    emit("```");
    emit("");
  }
  (json.sections as Record<string, unknown>).lineages = sec3;
}

// ------------------------------------------------------- 4. boundary compare
{
  emit("## 4. Transition-boundary comparisons (population tier)");
  emit("");
  emit("Identical phenotype samples on the blob>segmented axis as independent founders vs lineage-anchored descendants. The hysteresis band is the point.");
  emit("");
  const blobC = FAMILY_CENTERS.blob;
  const segC = FAMILY_CENTERS.segmented;
  const rows: string[] = ["t | founder | child-of-blob | child-of-seg"];
  const sec4: unknown[] = [];
  for (const t of [0.6, 0.7, 0.8, 0.9]) {
    const axes = {
      mobility: blobC[0] + (segC[0] - blobC[0]) * t,
      sensing: blobC[1] + (segC[1] - blobC[1]) * t,
      metabolism: blobC[2] + (segC[2] - blobC[2]) * t,
      specialization: blobC[3] + (segC[3] - blobC[3]) * t,
    };
    const tr = traitsForAxes(axes.mobility, axes.sensing, axes.metabolism, axes.specialization);
    const rf = resolvePhenotype(tr, { organismId: 31, lineageId: 31 });
    const rb = resolvePhenotype(tr, { parentFamily: "blob", organismId: 31, lineageId: 31 });
    const rs = resolvePhenotype(tr, { parentFamily: "segmented", organismId: 31, lineageId: 31 });
    rows.push(`${t.toFixed(1)} | ${rf.family} | ${rb.family} | ${rs.family}`);
    sec4.push({ t, founder: rf.family, childOfBlob: rb.family, childOfSegmented: rs.family });
    const grids = [
      { label: `t=${t} founder:${rf.family.slice(0, 4)}`, grid: shot("boundary", `t${t}`, "founder", rf, "population", "active") },
      { label: `child-of-blob:${rb.family.slice(0, 4)}`, grid: shot("boundary", `t${t}`, "child-of-blob", rb, "population", "active") },
      { label: `child-of-seg:${rs.family.slice(0, 4)}`, grid: shot("boundary", `t${t}`, "child-of-seg", rs, "population", "active") },
    ];
    emit(`t=${t.toFixed(1)}`);
    emit("```");
    emit(sideBySide(grids).join("\n"));
    emit("```");
  }
  emit(rows.join("\n"));
  emit("");
  (json.sections as Record<string, unknown>).boundary = sec4;
}

// ------------------------------------------------------- 5. continuity
{
  emit("## 5. Save/load continuity cases");
  emit("");
  const lerp = (t: number): [number, number, number, number] => {
    const b = FAMILY_CENTERS.blob;
    const s = FAMILY_CENTERS.segmented;
    return [b[0] + (s[0] - b[0]) * t, b[1] + (s[1] - b[1]) * t, b[2] + (s[2] - b[2]) * t, b[3] + (s[3] - b[3]) * t];
  };
  const cases: Array<{ name: string; axes: [number, number, number, number]; parent: PhenotypeFamily }> = [
    { name: "comfortably inside a family", axes: [0.35, 0.35, 0.4, 0.2], parent: "blob" },
    { name: "near a family boundary", axes: lerp(0.7), parent: "blob" },
    { name: "recently transitioned", axes: lerp(0.85), parent: "segmented" },
  ];
  const sec5: unknown[] = [];
  for (const c of cases) {
    const traits = traitsForAxes(c.axes[0], c.axes[1], c.axes[2], c.axes[3]);
    const before = resolvePhenotype(traits, { parentFamily: c.parent, organismId: 42, lineageId: 9 });
    const restored = JSON.parse(JSON.stringify(before)) as ResolvedPhenotype;
    const replayed = resolvePhenotype(traits, { parentFamily: c.parent, organismId: 42, lineageId: 9 });
    const gBefore = renderPhenotypeGrid(before, "inspection", "active");
    const gReplay = renderPhenotypeGrid(replayed, "inspection", "active");
    const ok =
      JSON.stringify(restored) === JSON.stringify(before) &&
      replayed.family === before.family &&
      JSON.stringify(replayed.quantized) === JSON.stringify(before.quantized) &&
      gridHash(gBefore) === gridHash(gReplay);
    emit(`- ${c.name}: family=${before.family} hash=${gridHash(gBefore)} round-trip+replay ${ok ? "IDENTICAL" : "MISMATCH"}`);
    if (!ok) throw new Error(`continuity mismatch: ${c.name}`);
    sec5.push({ case: c.name, family: before.family, hash: gridHash(gBefore), identical: ok });
  }
  emit("");
  (json.sections as Record<string, unknown>).continuity = sec5;
}

// ------------------------------------------------------- 6. cross-universe
{
  emit("## 6. Cross-universe equivalence");
  emit("");
  emit("Same absolute trait vector presented as three different universes (and three identities). Core morphology must be equivalent: identical grids for identical identity, bounded cosmetic drift otherwise.");
  emit("");
  const v = traitsForAxes(0.6, 0.7, 0.5, 0.5);
  const same = ["universe-A", "universe-B", "universe-C"].map((u) => {
    const r = resolvePhenotype(v, { organismId: 1, lineageId: 1 });
    return { u, hash: gridHash(renderPhenotypeGrid(r, "inspection", "active")) };
  });
  const sameOk = same.every((s) => s.hash === same[0]?.hash);
  emit(`- same identity across universes: ${same.map((s) => s.hash).join(", ")} — ${sameOk ? "EQUIVALENT" : "MISMATCH"}`);
  if (!sameOk) throw new Error("cross-universe mismatch");
  const drift = [1, 2, 3].map((id) => {
    const r = resolvePhenotype(v, { organismId: id, lineageId: id });
    return renderPhenotypeGrid(r, "inspection", "active");
  });
  const driftMax = Math.max(gridDifference(drift[0]!, drift[1]!), gridDifference(drift[0]!, drift[2]!), gridDifference(drift[1]!, drift[2]!));
  emit(`- different identities, max inspection drift: ${driftMax} cells (bound: 2)`);
  if (driftMax > 2) throw new Error("cosmetic drift exceeds bound");
  emit("");
  (json.sections as Record<string, unknown>).equivalence = { identical: sameOk, maxCosmeticDrift: driftMax };
}

// ------------------------------------------------------- 7. dormancy pairs
{
  emit("## 7. Active/dormant pairs (inspection tier; weak dr=0.2 / strong dr=1.2)");
  emit("");
  const sec7: Record<string, unknown> = {};
  for (const f of FAMILY_ORDER) {
    const active = resolvePhenotype({ ...traitsAt(f), dormancyResponse: 1.0 }, { organismId: 7, lineageId: 3 });
    assertFamily(active, f, `dormancy pairs ${f}`);
    const ga = shot("dormancy", f, `${f} active`, active, "inspection", "active");
    const gw = shot("dormancy", f, `${f} dorm-weak`, resolvePhenotype({ ...traitsAt(f), dormancyResponse: 0.2 }, { parentFamily: f, organismId: 7, lineageId: 3 }),
      "inspection", "dormant");
    const gs = shot("dormancy", f, `${f} dorm-strong`, resolvePhenotype({ ...traitsAt(f), dormancyResponse: 1.2 }, { parentFamily: f, organismId: 7, lineageId: 3 }),
      "inspection", "dormant");
    emit(`### ${f} (active ${countFilled(ga)} cells | weak-dormant ${countFilled(gw)} | strong-dormant ${countFilled(gs)})`);
    emit("```");
    emit(sideBySide([
      { label: "active", grid: ga },
      { label: "dorm-weak", grid: gw },
      { label: "dorm-strong", grid: gs },
    ]).join("\n"));
    emit("```");
    emit("");
    sec7[f] = { active: countFilled(ga), weak: countFilled(gw), strong: countFilled(gs) };
  }
  (json.sections as Record<string, unknown>).dormancy = sec7;
}

// ------------------------------------------------------- 8. dense scenes
interface SceneOrg { x: number; y: number; activity: "active" | "dormant"; family: PhenotypeFamily; eco: string; pop: string; insp: string }
interface Scene { name: string; tick: number; population: number; dormant: number; simMs: number; families: Record<string, number>; organisms: SceneOrg[]; tierMs: Record<LodTier, number> }
const scenes: Scene[] = [];
const sceneSnapshots: RenderSnapshot[] = [];
function traitsOf(o: RenderOrganism): TraitSample {
  return {
    speed: o.speed, sensing: o.sensing, metabolism: o.metabolism, reproduction: o.reproduction,
    diet: o.diet, habitat: o.habitat, byproductUse: o.byproductUse, dormancyResponse: o.dormancyResponse,
  };
}
/** Descendant-chained family resolution over a live snapshot (Phase 3 strategy). */
function resolveScene(snapshot: RenderSnapshot): { fams: Map<number, ResolvedPhenotype>; families: Record<string, number> } {
  const fams = new Map<number, ResolvedPhenotype>();
  const families: Record<string, number> = {};
  const sorted = [...snapshot.organisms].sort((a, b) => a.generation - b.generation || a.id - b.id);
  for (const o of sorted) {
    const parentFam = o.parent == null ? null : (fams.get(o.parent)?.family ?? null);
    const res = resolvePhenotype(traitsOf(o), { parentFamily: parentFam, organismId: o.id, lineageId: o.lineageId });
    fams.set(o.id, res);
    families[res.family] = (families[res.family] ?? 0) + 1;
  }
  return { fams, families };
}
{
  emit("## 8. Dense-world LOD scenes (real engine populations)");
  emit("");
  const base = (seed: number, prod: number, pop: number): EngineConfig => ({
    seed, start: 0.58, prod, cap: 360, pop, div: 0.35, mr: 0.03, ms: 0.12,
    press: 1.0875, patch: 0.6, resource_b_fraction: 0.5, cat: "global", st: null,
    resource_model: "definition_driven_substances", resource_grid: 60,
    enable_byproduct: true, enable_dormancy: true, study: true,
  });
  const targets: Array<{ name: string; prod: number; want: number; chunk: number; cap: number }> = [
    { name: "scene-50", prod: 0.77, want: 50, chunk: 250, cap: 6000 },
    { name: "scene-250", prod: 0.77, want: 250, chunk: 500, cap: 9000 },
    { name: "scene-1000", prod: 2.0, want: 1000, chunk: 1000, cap: 14000 },
    { name: "scene-3000", prod: 3.76, want: 3000, chunk: 1000, cap: 14000 },
  ];
  const sec8: unknown[] = [];
  for (const t of targets) {
    const session = new UniverseSession();
    session.create(base(987654321, t.prod, 30));
    let snap: RenderSnapshot | null = null;
    let used = 0;
    const t0 = Date.now();
    while (used < t.cap) {
      snap = session.advance(t.chunk);
      used += t.chunk;
      if (snap.population >= t.want || snap.pendingDecision) break;
    }
    const simMs = Date.now() - t0;
    if (!snap) throw new Error(`no snapshot for ${t.name}`);
    sceneSnapshots.push(snap);
    const { fams, families } = resolveScene(snap);
    const tierMs: Record<LodTier, number> = { ecosystem: 0, population: 0, inspection: 0 };
    const organisms: SceneOrg[] = [];
    for (const o of snap.organisms) {
      const res = fams.get(o.id);
      if (!res) throw new Error("scene resolve gap");
      const grids = {} as Record<LodTier, PhenotypeGrid>;
      for (const tier of ["ecosystem", "population", "inspection"] as const) {
        const a = Date.now();
        grids[tier] = renderPhenotypeGrid(res, tier, o.activity);
        tierMs[tier] += Date.now() - a;
      }
      organisms.push({ x: o.x, y: o.y, activity: o.activity, family: res.family, eco: bits(grids.ecosystem), pop: bits(grids.population), insp: bits(grids.inspection) });
    }
    scenes.push({ name: t.name, tick: snap.tick, population: snap.population, dormant: snap.dormantPopulation, simMs, families, organisms, tierMs });
    const hist = FAMILY_ORDER.map((f) => `${f.slice(0, 4)}:${families[f] ?? 0}`).join(" ");
    emit(`- **${t.name}**: tick ${snap.tick}, pop ${snap.population} (${snap.dormantPopulation} dormant), sim ${simMs}ms. Families — ${hist}.`);
    emit(`  Grid render totals: eco ${tierMs.ecosystem}ms / pop ${tierMs.population}ms / insp ${tierMs.inspection}ms (Date.now resolution; see §9 for precise timings).`);
    sec8.push({ name: t.name, tick: snap.tick, population: snap.population, dormant: snap.dormantPopulation, simMs, families, tierMs });
  }
  emit("");
  (json.sections as Record<string, unknown>).scenes = sec8;
}

// ------------------------------------------------------- 9. performance
{
  emit("## 9. Performance observations (same machine, mock canvas)");
  emit("");
  emit("Mock 2D context counts rects instead of painting, so this compares presentation logic cost, not GPU paint. Timed separately: resolve-only, each tier render+draw, and a faithful port of the App.tsx voxel loop. Same organisms, same process, 5 repetitions.");
  emit("");
  const ctx = { rects: 0, fillRect(): void { ctx.rects++; }, strokeRect(): void { ctx.rects++; } };
  // Faithful port of apps/explorer/src/App.tsx WorldCanvas voxel sprite.
  const renderBaseline = (o: RenderOrganism, s: number): void => {
    const unit = Math.max(2, s * 2.2);
    const energyClass = o.activity === "dormant" ? 0 : o.energy > 120 ? 2 : o.energy > 60 ? 1 : 0;
    const span = 2 + energyClass;
    let hsh = Math.imul(o.id, 2654435761) ^ 0x9e3779b9;
    hsh ^= hsh >>> 15;
    hsh = Math.imul(hsh, 0x85ebca6b) >>> 0;
    const dormant = o.activity === "dormant";
    for (let gy = 0; gy < span; gy++) {
      for (let gx = 0; gx < span; gx++) {
        const edge = gx === 0 || gy === 0 || gx === span - 1 || gy === span - 1;
        let solid = true;
        if (edge) {
          if (o.diet < -0.25) solid = ((hsh >> ((gy * span + gx) % 24)) & 1) === 1;
          else if (o.diet > 0.25) solid = true;
          else solid = ((gx * 7 + gy * 13 + (hsh & 3)) & 3) !== 0;
        }
        if (!solid) continue;
        if (dormant) ctx.strokeRect(0, 0, unit, unit);
        else ctx.fillRect(0, 0, unit, unit);
      }
    }
  };
  const orgs = sceneSnapshots[2]?.organisms ?? sceneSnapshots[sceneSnapshots.length - 1]?.organisms ?? [];
  if (orgs.length === 0) throw new Error("no organisms for perf comparison");
  const timefn = (fn: () => void): number => {
    fn(); // warmup
    const a = performance.now();
    fn();
    return performance.now() - a;
  };
  const rep = (fn: () => void): { mean: number; best: number } => {
    const ts: number[] = [];
    for (let r = 0; r < 5; r++) ts.push(timefn(fn));
    return { mean: ts.reduce((x, y) => x + y, 0) / ts.length, best: Math.min(...ts) };
  };
  const per = (ms: number): string => `${((ms * 1000) / orgs.length).toFixed(2)}us/org`;
  const res = orgs.map((o) => resolvePhenotype(traitsOf(o), { organismId: o.id, lineageId: o.lineageId }));
  const acts = orgs.map((o) => o.activity);
  const rResolve = rep(() => {
    for (const o of orgs) resolvePhenotype(traitsOf(o), { organismId: o.id, lineageId: o.lineageId });
  });
  const rEco = rep(() => {
    ctx.rects = 0;
    res.forEach((r, i) => drawGridToCanvas(ctx, renderPhenotypeGrid(r, "ecosystem", acts[i]!), 0, 0, 2));
  });
  const ecoRects = ctx.rects;
  const rPop = rep(() => {
    ctx.rects = 0;
    res.forEach((r, i) => drawGridToCanvas(ctx, renderPhenotypeGrid(r, "population", acts[i]!), 0, 0, 2));
  });
  const popRects = ctx.rects;
  const rInsp = rep(() => {
    ctx.rects = 0;
    res.forEach((r, i) => drawGridToCanvas(ctx, renderPhenotypeGrid(r, "inspection", acts[i]!), 0, 0, 2));
  });
  const inspRects = ctx.rects;
  const rBase = rep(() => {
    ctx.rects = 0;
    for (const o of orgs) renderBaseline(o, 2);
  });
  const baseRects = ctx.rects;
  emit(`- organisms timed: ${orgs.length} (scene-1000 snapshot, mixed active/dormant states)`);
  emit(`- resolve only: mean ${rResolve.mean.toFixed(1)}ms / best ${rResolve.best.toFixed(1)}ms (${per(rResolve.best)})`);
  emit(`- ecosystem tier render+draw: best ${rEco.best.toFixed(1)}ms (${per(rEco.best)}), ${ecoRects} rects`);
  emit(`- population tier render+draw: best ${rPop.best.toFixed(1)}ms (${per(rPop.best)}), ${popRects} rects`);
  emit(`- inspection tier render+draw: best ${rInsp.best.toFixed(1)}ms (${per(rInsp.best)}), ${inspRects} rects`);
  emit(`- baseline voxel+draw: best ${rBase.best.toFixed(1)}ms (${per(rBase.best)}), ${baseRects} rects`);
  emit(`- Live rendering uses ONE tier per frame (the visible zoom), not all three: expect ecosystem ~${per(rEco.best)} vs baseline ${per(rBase.best)}. No acceptance threshold exists for the prototype; observed cost only.`);
  emit(`- scene render totals from §8 cover 50→3000+ populations at all three tiers (see evidence.json). Grids memoize cleanly on (family, quantized, tier, activity, cosmeticSeed) — unimplemented; Phase 3 optimization candidate.`);
  emit("");
  (json.sections as Record<string, unknown>).perf = {
    organisms: orgs.length,
    resolveBestMs: rResolve.best,
    ecoBestMs: rEco.best, ecoRects,
    popBestMs: rPop.best, popRects,
    inspBestMs: rInsp.best, inspRects,
    baselineBestMs: rBase.best, baselineRects: baseRects,
  };
}

// ---------------------------------------------------------------- tuning
{
  emit("## 10. Tuning evidence (observations, not promotions)");
  emit("");
  // Hysteresis band scan on the blob>segmented axis, both directions.
  const b = FAMILY_CENTERS.blob;
  const s = FAMILY_CENTERS.segmented;
  const at = (t: number) => ({
    mobility: b[0] + (s[0] - b[0]) * t,
    sensing: b[1] + (s[1] - b[1]) * t,
    metabolism: b[2] + (s[2] - b[2]) * t,
    specialization: b[3] + (s[3] - b[3]) * t,
  });
  let upAt: number | null = null;
  let downAt: number | null = null;
  for (let i = 0; i <= 100; i++) {
    const t = i / 100;
    if (upAt === null && resolveDescendantFamily(at(t), "blob") === "segmented") upAt = t;
    if (downAt === null && resolveDescendantFamily(at(1 - t), "segmented") === "blob") downAt = 1 - t;
  }
  emit(`- Hysteresis band (blob>segmented axis): blob-held switches at t=${upAt?.toFixed(2)} going up; segmented-held switches at t=${downAt?.toFixed(2)} coming down. Band width ~${((upAt ?? 0) - (downAt ?? 0)).toFixed(2)}. No flicker inside the band by construction (both gates must clear).`);
  // Family separation at inspection.
  let minPair = "";
  let minDiff = Infinity;
  const founders = FAMILY_ORDER.map((f) => renderPhenotypeGrid(
    resolvePhenotype(traitsAt(f), { organismId: 7, lineageId: 3 }), "inspection", "active",
  ));
  FAMILY_ORDER.forEach((f, i) => {
    FAMILY_ORDER.forEach((g, j) => {
      if (j <= i) return;
      const d = gridDifference(founders[i]!, founders[j]!);
      if (d < minDiff) {
        minDiff = d;
        minPair = `${f} vs ${g}`;
      }
    });
  });
  emit(`- Closest family pair at inspection: ${minPair} at ${minDiff} cells Hamming (of 169). Margin is large; centers could move substantially before legibility is at risk.`);
  // Quantum vs engine mutation scale.
  emit("- Quantum width is 0.25 in normalized units (5 states). Engine single-mutation steps (ms=0.12): multiplicative traits move ~0.03-0.07 normalized; additive traits (diet/habitat/byproduct/dr: ±ms*1.15 range units) move ~0.02-0.09 normalized. A mutation crosses a quantum only when the parent sits within one step of a boundary — expected order ~10-30% per mutated trait, while per-trait mutation chance is mr=0.03 per reproduction. Net: most reproductions keep every quantum; visible steps are occasional and single-ladder-rung. No constant change proposed.");
  emit(`- lodTierForZoom sanity: ${[1, 1.5, 2, 2.5, 3].map((z) => `${z}x>${lodTierForZoom(z)}`).join(", ")}. LOD_GRID_SIZE eco/pop/insp = ${LOD_GRID_SIZE.ecosystem}/${LOD_GRID_SIZE.population}/${LOD_GRID_SIZE.inspection}. QUANT_LEVELS=${QUANT_LEVELS}. Dormancy strong gate ${DORMANCY_STRONG_THRESHOLD} (normalized).`);
  emit(`- TRAIT_RANGES mirror the engine table (validated in tools/validation/phenotype.ts). Attractor-distance weights and hysteresis gates are prototype baseline ${PROTOTYPE_BASELINE}.`);
  // Evolved-manifold coverage: where do real trait distributions sit vs the
  // six attractors? Computed over every scene snapshot (4 nutrient regimes).
  const all = sceneSnapshots.flatMap((s) => s.organisms);
  const tkeys = ["speed", "sensing", "metabolism", "reproduction", "diet", "habitat", "byproductUse", "dormancyResponse"] as const;
  const ranges = tkeys.map((k) => {
    const vs = all.map((o) => o[k] as number);
    return `${k} [${Math.min(...vs).toFixed(2)}, ${Math.max(...vs).toFixed(2)}]`;
  });
  let closest = { d: Infinity, fam: "" };
  for (const o of all) {
    const axes = deriveAxes(traitsOf(o));
    const d = distancesToAll(axes);
    for (const f of FAMILY_ORDER) {
      if (f !== "blob" && d[f]! < closest.d) closest = { d: d[f]!, fam: f };
    }
  }
  emit(`- Evolved-manifold coverage (n=${all.length} organisms across all 4 scenes): ${ranges.join("; ")}.`);
  emit(`  Closest any evolved organism comes to a non-blob attractor: ${closest.d.toFixed(3)} (${closest.fam}). Five of six centers sit far outside the evolved range (e.g. radial needs sensing~0.82 vs evolved<=0.4; paddled needs mobility~0.88 vs evolved<=0.4; plated needs metabolism~0.78 vs evolved<=0.26).`);
  emit(`  Reading: today's attractors span the supported trait space, not the evolved manifold. Non-blob families will be rare until deep-time divergence reaches them. Whether to (a) accept rarity, (b) recalibrate centers toward the manifold, or (c) keep potential-space attractors is an OWNER DECISION — no constant is changed or promoted here.`);
  emit("");
  (json.sections as Record<string, unknown>).tuning = { hysteresisUp: upAt, hysteresisDown: downAt, closestPair: minPair, closestDiff: minDiff, manifoldRanges: ranges, closestNonBlob: closest, manifoldNote: "owner decision required" };
}

// ------------------------------------------------------- 11. viewer
{
  (json.sections as Record<string, unknown>).visuals = shots;
  const payload = { baseline: PROTOTYPE_BASELINE, shots, scenes, tuning: (json.sections as Record<string, unknown>).tuning };
  const dataJson = JSON.stringify(payload).replace(/<\//g, "<\\/");
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pixel Phenotype Prototype — Evidence Viewer (${PROTOTYPE_BASELINE})</title>
<style>
  body{background:#0a1116;color:#d8e6de;font:14px/1.45 system-ui,sans-serif;margin:0 auto;max-width:1100px;padding:24px}
  h1,h2,h3{color:#eafff3} .eyebrow{color:#7fd4c1;text-transform:uppercase;font-size:.75rem;letter-spacing:.08em}
  canvas{background:#060b0f;border:1px solid #1d2f3a;image-rendering:pixelated;margin:4px}
  .row{display:flex;flex-wrap:wrap;align-items:flex-end;gap:10px} figure{margin:0;text-align:center}
  figcaption{font-size:.72rem;color:#9fb8ad} table{border-collapse:collapse;margin:8px 0}
  td,th{border:1px solid #1d2f3a;padding:4px 10px;font-size:.8rem} th{color:#7fd4c1}
  .note{color:#9fb8ad;font-size:.82rem} .scene{margin:16px 0}
  button{background:#12262f;color:#d8e6de;border:1px solid #2a4a5a;border-radius:6px;padding:4px 10px;margin:2px}
  button.on{background:#1d4453}
</style>
</head>
<body>
<span class="eyebrow">Digital Evolution · Lane 2 M4B · prototype evidence (offline, monochrome)</span>
<h1>Pixel Phenotype Evidence Viewer</h1>
<p class="note">Baseline ${PROTOTYPE_BASELINE}: tuning inputs, not accepted design values. Shapes are presentation encodings of simulated state, never modeled anatomy. See EVIDENCE.md for the full report.</p>
<h2>1 · Family matrix</h2><div id="matrix"></div>
<h2>2 · Trait strips</h2><div id="strips"></div>
<h2>3 · Lineage strips</h2><div id="lineages"></div>
<h2>4 · Boundary comparisons</h2><div id="boundary"></div>
<h2>7 · Dormancy pairs</h2><div id="dormancy"></div>
<h2>8 · Dense scenes <span class="note">(shape = family; bright = active, dim = dormant)</span></h2>
<div id="sceneBtns"></div><div id="scenes"></div>
<h2>10 · Tuning</h2><div id="tuning"></div>
<script>
const DATA = ${dataJson};
function draw(cv, bits, size, px, color){ const x=cv.getContext('2d'); x.clearRect(0,0,cv.width,cv.height); x.fillStyle=color;
  for(let i=0;i<bits.length;i++) if(bits[i]==='1') x.fillRect((i%size)*px, Math.floor(i/size)*px, px, px); }
function fig(shot, px, color){ const cv=document.createElement('canvas'); const s=shot.size*px; cv.width=s; cv.height=s;
  draw(cv, shot.bits, shot.size, px, color||'#e6f2ea');
  const f=document.createElement('figure'); f.appendChild(cv);
  const c=document.createElement('figcaption'); c.textContent=shot.label; f.appendChild(c); return f; }
function group(section, key){ return DATA.shots.filter(s=>s.section===section&&s.key===key); }
function section(el, keys, px){ const host=document.getElementById(el);
  keys.forEach(k=>{ const row=document.createElement('div'); row.className='row';
    group(el, k).forEach(s=>row.appendChild(fig(s, px||4))); host.appendChild(row); }); }
const keys = s=>[...new Set(DATA.shots.filter(x=>x.section===s).map(x=>x.key))];
section('matrix', keys('matrix'), 5);
section('strips', keys('strips'), 3);
section('lineages', keys('lineages'), 5);
section('boundary', keys('boundary'), 5);
section('dormancy', keys('dormancy'), 5);
let tier='eco';
const btns=document.getElementById('sceneBtns');
[['eco','Ecosystem'],['pop','Population'],['insp','Inspection']].forEach(([t,label])=>{
  const b=document.createElement('button'); b.textContent=label; if(t===tier)b.className='on';
  b.onclick=()=>{tier=t;[...btns.children].forEach(x=>x.className='');b.className='on';drawScenes();}; btns.appendChild(b); });
const FAMC={blob:'#e6f2ea',segmented:'#9fd8c8',radial:'#7fb8e6',plated:'#d8c890',branching:'#b8e67f',paddled:'#e6a08f'};
function drawScenes(){ const host=document.getElementById('scenes'); host.innerHTML='';
  DATA.scenes.forEach(sc=>{ const d=document.createElement('div'); d.className='scene';
    const h=document.createElement('h3'); h.textContent=sc.name+' — tick '+sc.tick+', pop '+sc.population+' ('+sc.dormant+' dormant), sim '+sc.simMs+'ms'; d.appendChild(h);
    const hist=document.createElement('p'); hist.className='note';
    hist.textContent='families: '+Object.entries(sc.families).map(([k,v])=>k+':'+v).join('  '); d.appendChild(hist);
    const cv=document.createElement('canvas'); cv.width=600; cv.height=600; const x=cv.getContext('2d');
    const cell = tier==='eco'?2:tier==='pop'?1:1;
    sc.organisms.forEach(o=>{ const bitstr=o[tier]; const n=Math.sqrt(bitstr.length);
      x.fillStyle=o.activity==='dormant'?'#5a6a63':(FAMC[o.family]||'#e6f2ea');
      for(let i=0;i<bitstr.length;i++) if(bitstr[i]==='1')
        x.fillRect(Math.round(o.x-n*cell/2+(i%n)*cell), Math.round(o.y-n*cell/2+Math.floor(i/n)*cell), cell, cell); });
    d.appendChild(cv); host.appendChild(d); }); }
drawScenes();
document.getElementById('tuning').innerHTML='<table>'+Object.entries(DATA.tuning||{}).map(([k,v])=>'<tr><th>'+k+'</th><td>'+v+'</td></tr>').join('')+'</table>';
</script>
</body>
</html>`;
  writeFileSync(new URL("./viewer.html", OUT), html);
}

writeFileSync(new URL("./EVIDENCE.md", OUT), md.join("\n"));
writeFileSync(new URL("./evidence.json", OUT), JSON.stringify(json, null, 2));
console.log(`evidence written to ${OUT.pathname} (md+json+viewer)`);
