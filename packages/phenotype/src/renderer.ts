/**
 * Lane 2 M4B phenotype renderer: maps a resolved phenotype + LOD tier +
 * activity state to monochrome Canvas geometry.
 *
 * Design contract (from the handoff):
 * - readable from silhouette; six families distinguishable in monochrome;
 * - expressive through proportion, structure, motion — never faces;
 * - presentation encodings of simulated state, never invented anatomy;
 * - zoom reveals more information, never just a larger fixed sprite;
 * - same phenotype recognizable across LOD switches;
 * - normal presentation yields to analytical lenses: the renderer draws
 *   monochrome shape only. Lens color, selection markers, and world position
 *   stay with WorldCanvas (Phase 3 integration).
 * - no simulation mutation, no simulation RNG consumption.
 *
 * Dormancy has two strengths, gated by normalized dormancy response
 * (DORMANCY_STRONG_THRESHOLD): strong dormancy applies the full
 * family-specific transformation (contract / curl / retract / consolidate /
 * withdraw / fold); weak dormancy hollows the active silhouette and withdraws
 * secondary structures. Both are geometric — never just opacity.
 *
 * Pure geometry: renderPhenotypeGrid() returns a boolean grid with no DOM
 * dependency, so every claim below is unit-testable. drawGridToCanvas()
 * adapts a grid to any Canvas2D-like context for live use.
 */

import {
  DORMANCY_STRONG_THRESHOLD,
  LOD_GRID_SIZE,
  type LodTier,
  type PhenotypeFamily,
} from "./constants";
import { signedDirection, type ResolvedPhenotype } from "./model";

export type ActivityState = "active" | "dormant";

export interface PhenotypeGrid {
  readonly size: number;
  readonly cells: readonly boolean[];
}

interface MutableGrid {
  readonly size: number;
  readonly cells: boolean[];
  set(x: number, y: number, v?: boolean): void;
}

function makeGrid(size: number): MutableGrid {
  const cells = new Array<boolean>(size * size).fill(false);
  return {
    size,
    cells,
    set(x: number, y: number, v = true) {
      if (x >= 0 && y >= 0 && x < size && y < size) cells[y * size + x] = v;
    },
  };
}

/** Quantized index 0..4 for a 0..1 quantized parameter. */
function qi(v: number): number {
  return Math.max(0, Math.min(4, Math.round(v * 4)));
}

function clampInt(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Core radius for a grid size, nudged by quantized bulk (reproduction
 * threshold: modest mass/proportion influence only, never anatomy).
 */
function coreRadius(n: number, bulk: number): number {
  const adj = bulk >= 0.75 ? 1 : bulk <= 0.25 ? -1 : 0;
  return clampInt(Math.floor(n / 2) + adj, 1, Math.floor(n / 2));
}

function centerOf(n: number): number {
  return Math.floor((n - 1) / 2);
}

function fillEllipse(g: MutableGrid, cx: number, cy: number, rx: number, ry: number): void {
  for (let y = cy - ry; y <= cy + ry; y++) {
    for (let x = cx - rx; x <= cx + rx; x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1.0001) g.set(x, y);
    }
  }
}

/**
 * Hollow a solid silhouette: keep a filled cell only when a 4-neighbor is
 * empty (or off-grid). Thin (1-cell) structures survive unchanged, which is
 * why secondary structures are withdrawn separately for the weak transform.
 */
function outlineInto(dst: MutableGrid, src: MutableGrid): void {
  const n = src.size;
  const at = (x: number, y: number): boolean =>
    x < 0 || y < 0 || x >= n || y >= n ? false : (src.cells[y * n + x] ?? false);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!at(x, y)) continue;
      if (!at(x - 1, y) || !at(x + 1, y) || !at(x, y - 1) || !at(x, y + 1)) dst.set(x, y);
    }
  }
}

/** Blob: compact generalist disc. Speed stretches; dormancy contracts. */
function blobCore(g: MutableGrid, res: ResolvedPhenotype): void {
  const n = g.size;
  const c = centerOf(n);
  const R = coreRadius(n, res.quantized.bulk);
  const ex = qi(res.quantized.elongation);
  const rx = clampInt(R + Math.round((ex * R) / 4), 1, Math.floor(n / 2));
  fillEllipse(g, c, c, rx, R);
}
function blobExtras(g: MutableGrid, res: ResolvedPhenotype): void {
  const n = g.size;
  const c = centerOf(n);
  const R = coreRadius(n, res.quantized.bulk);
  const ex = qi(res.quantized.elongation);
  const rx = clampInt(R + Math.round((ex * R) / 4), 1, Math.floor(n / 2));
  const proj = qi(res.quantized.projection);
  if (proj >= 2) {
    g.set(c + rx + 1, c);
    g.set(c - rx - 1, c);
  }
  if (proj >= 3) {
    g.set(c, c + R + 1);
    g.set(c, c - R - 1);
  }
  const asym = qi(res.quantized.asymmetry);
  if (asym >= 2) {
    const dir = signedDirection(res.dietSigned) || 1;
    g.set(c + dir * (rx + 1), c);
    if (asym >= 3) g.set(c + dir * (rx + 1), c + 1);
  }
}
function blobDormant(g: MutableGrid, res: ResolvedPhenotype): void {
  const n = g.size;
  const c = centerOf(n);
  const R = coreRadius(n, res.quantized.bulk);
  const rd = R - 1;
  if (rd < 1) g.set(c, c);
  else fillEllipse(g, c, c, rd, rd);
}

/** Segmented: directional articulated bars. Speed raises aspect/segments. */
function segmentedLayout(n: number, ex: number): { segs: number; totalW: number; startX: number } {
  let segs = 3 + Math.round((ex / 4) * 2); // 3..5 segments.
  // Single-cell segments with gaps, plus room for leading projections, so the
  // whole articulated body (and its antennae) stays on-grid and readable.
  while (segs > 2 && 2 * segs - 1 + 2 > n) segs--;
  const totalW = 2 * segs - 1;
  return { segs, totalW, startX: centerOf(n) - Math.floor(totalW / 2) };
}
function segmentedCore(g: MutableGrid, res: ResolvedPhenotype): void {
  const n = g.size;
  const c = centerOf(n);
  const { segs, startX } = segmentedLayout(n, qi(res.quantized.elongation));
  const startY = c - 2; // 3 rows spaced 2 apart.
  for (let r = 0; r < 3; r++) {
    const y = startY + r * 2;
    for (let s = 0; s < segs; s++) g.set(startX + s * 2, y);
  }
}
function segmentedExtras(g: MutableGrid, res: ResolvedPhenotype): void {
  const proj = qi(res.quantized.projection);
  if (proj < 2) return;
  // Leading projections on the diet side (front defaults +x).
  const n = g.size;
  const { totalW, startX } = segmentedLayout(n, qi(res.quantized.elongation));
  const startY = centerOf(n) - 2;
  const dir = signedDirection(res.dietSigned) || 1;
  const leadX = dir > 0 ? startX + totalW : startX - 1;
  g.set(leadX, startY);
  if (proj >= 3) g.set(leadX + dir, startY);
}
function segmentedDormant(g: MutableGrid, res: ResolvedPhenotype): void {
  // Curl/compress: fewer rows, no gaps, no leading projections.
  const n = g.size;
  const c = centerOf(n);
  const { segs, startX } = segmentedLayout(n, qi(res.quantized.elongation));
  for (let r = 0; r < 2; r++) {
    for (let s = 0; s < segs; s++) g.set(startX + s * 2, c - 1 + r);
  }
}

/** Radial: environmental reach. Sensing drives arm count/length. */
const RADIAL_DIRS: Record<string, readonly [number, number]> = {
  E: [1, 0],
  NE: [1, -1],
  N: [0, -1],
  NW: [-1, -1],
  W: [-1, 0],
  SW: [-1, 1],
  S: [0, 1],
  SE: [1, 1],
};
const RADIAL_SETS: Record<number, readonly string[]> = {
  3: ["E", "NW", "SW"],
  4: ["E", "N", "W", "S"],
  6: ["E", "NE", "NW", "W", "SW", "SE"],
  8: ["E", "NE", "N", "NW", "W", "SW", "S", "SE"],
};
function radialArmLength(res: ResolvedPhenotype, n: number): number {
  const R = coreRadius(n, res.quantized.bulk);
  return Math.max(1, 1 + Math.round(res.axes.sensing * (R - 1)));
}
function radialCore(g: MutableGrid, res: ResolvedPhenotype): void {
  const n = g.size;
  const c = centerOf(n);
  const proj = qi(res.quantized.projection);
  const armCounts = [3, 4, 6, 6, 8];
  const arms = armCounts[proj] ?? 4;
  const len = radialArmLength(res, n);
  g.set(c, c);
  if (n >= 9) {
    g.set(c - 1, c);
    g.set(c + 1, c);
    g.set(c, c - 1);
    g.set(c, c + 1);
  }
  const chosen = RADIAL_SETS[arms] ?? RADIAL_SETS[4]!;
  for (const key of chosen) {
    const [dx, dy] = RADIAL_DIRS[key]!;
    for (let i = 1; i <= len; i++) g.set(c + dx * i, c + dy * i);
  }
}
function radialExtras(g: MutableGrid, res: ResolvedPhenotype): void {
  // Speed biases reach toward the diet direction without destroying the
  // radial identity: at most +1 cell on the favored horizontal arm.
  const dirD = signedDirection(res.dietSigned);
  if (dirD === 0) return;
  const n = g.size;
  const c = centerOf(n);
  const len = radialArmLength(res, n);
  g.set(c + dirD * (len + 1), c);
}
function radialDormant(g: MutableGrid, res: ResolvedPhenotype): void {
  // Retract fully to the core.
  const c = centerOf(g.size);
  g.set(c, c);
  if (g.size >= 9) {
    g.set(c - 1, c);
    g.set(c + 1, c);
    g.set(c, c - 1);
    g.set(c, c + 1);
  }
}

/** Plated: dense compact core with plate gaps. Metabolism sets density. */
function platedCore(g: MutableGrid, res: ResolvedPhenotype): void {
  const n = g.size;
  const c = centerOf(n);
  const R = coreRadius(n, res.quantized.bulk);
  const density = qi(res.quantized.density);
  for (let y = c - R; y <= c + R; y++) {
    for (let x = c - R; x <= c + R; x++) g.set(x, y);
  }
  // Plate gaps: fewer, tighter plates at high metabolic density.
  const slits = density >= 2 ? [0] : [-1, 1];
  for (const off of slits) {
    for (let x = c - R; x <= c + R; x++) {
      const yy = c + off;
      if (yy >= 0 && yy < n && x >= 0 && x < n) g.cells[yy * n + x] = false;
    }
  }
  if (density <= 1) {
    // Porous low-density texture between plates.
    for (let y = c - R; y <= c + R; y++) {
      for (let x = c - R; x <= c + R; x++) {
        if ((x * 2 + y * 3) % 5 === 0) {
          if (x >= 0 && y >= 0 && x < n && y < n) g.cells[y * n + x] = false;
        }
      }
    }
  }
}
function platedExtras(g: MutableGrid, res: ResolvedPhenotype): void {
  // Speed biases the footprint toward the diet direction.
  const dir = signedDirection(res.dietSigned);
  if (dir === 0) return;
  const n = g.size;
  const c = centerOf(n);
  const R = coreRadius(n, res.quantized.bulk);
  for (let y = c - 1; y <= c + 1; y++) g.set(c + dir * (R + 1), y);
}
function platedDormant(g: MutableGrid, res: ResolvedPhenotype): void {
  // Consolidate: the solid core stands as drawn (no slits, no texture).
  const n = g.size;
  const c = centerOf(n);
  const R = coreRadius(n, res.quantized.bulk);
  for (let y = c - R; y <= c + R; y++) {
    for (let x = c - R; x <= c + R; x++) g.set(x, y);
  }
}

/** Branching: sensing/specialization reach. Mobility suppresses sprawl. */
function branchingCore(g: MutableGrid, res: ResolvedPhenotype): void {
  const n = g.size;
  const c = centerOf(n);
  const R = coreRadius(n, res.quantized.bulk);
  const proj = qi(res.quantized.projection);
  const asym = qi(res.quantized.asymmetry);
  const sec = qi(res.quantized.secondary);
  const H = clampInt(3 + Math.round((proj / 4) * R), 2, n - 1);
  const top = n - H;
  for (let y = top; y < n; y++) g.set(c, y);
  let len = Math.max(1, 1 + Math.round((proj / 4) * (R - 1)) + (sec >= 2 ? 1 : 0));
  if (res.axes.mobility >= 0.6) len = Math.max(1, len - 1); // sprawl suppression.
  const levels = 1 + Math.round((asym / 4) * 2); // 1..3 branch tiers.
  const dirD = signedDirection(res.dietSigned);
  const step = Math.max(1, Math.floor((H - 1) / levels));
  for (let i = 0; i < levels; i++) {
    const y = n - 2 - i * step;
    if (y <= top) break;
    const favorLeft = dirD < 0 ? 1 : 0;
    const favorRight = dirD > 0 ? 1 : 0;
    const leftLen = Math.max(1, len - favorRight + favorLeft);
    const rightLen = Math.max(1, len - favorLeft + favorRight);
    for (let k = 1; k <= leftLen; k++) g.set(c - k, y);
    for (let k = 1; k <= rightLen; k++) g.set(c + k, y);
  }
}
function branchingExtras(g: MutableGrid, res: ResolvedPhenotype): void {
  const sec = qi(res.quantized.secondary);
  if (sec < 2) return;
  const n = g.size;
  const c = centerOf(n);
  const R = coreRadius(n, res.quantized.bulk);
  const proj = qi(res.quantized.projection);
  const asym = qi(res.quantized.asymmetry);
  const H = clampInt(3 + Math.round((proj / 4) * R), 2, n - 1);
  const top = n - H;
  let len = Math.max(1, 1 + Math.round((proj / 4) * (R - 1)) + 1);
  if (res.axes.mobility >= 0.6) len = Math.max(1, len - 1);
  const levels = 1 + Math.round((asym / 4) * 2);
  const dirD = signedDirection(res.dietSigned);
  const dirH = signedDirection(res.habitatSigned);
  const step = Math.max(1, Math.floor((H - 1) / levels));
  for (let i = 0; i < levels; i++) {
    const y = n - 2 - i * step;
    if (y <= top) break;
    const favorLeft = dirD < 0 ? 1 : 0;
    const favorRight = dirD > 0 ? 1 : 0;
    const leftLen = Math.max(1, len - favorRight + favorLeft);
    const rightLen = Math.max(1, len - favorLeft + favorRight);
    // Secondary twigs rise from the branch tips.
    g.set(c - leftLen, y - 1);
    g.set(c + rightLen, y - 1);
  }
  if (dirH > 0) g.set(c, top - 1); // leader shoot patterning.
}
function branchingDormant(g: MutableGrid, res: ResolvedPhenotype): void {
  // Withdraw branches: a short trunk with one tier, no secondaries.
  const n = g.size;
  const c = centerOf(n);
  for (let y = n - 2; y < n; y++) g.set(c, y);
  g.set(c - 1, n - 2);
  g.set(c + 1, n - 2);
}

/** Paddled: locomotion-dominant. Speed shapes paddles/streamlining. */
function paddledCore(g: MutableGrid, res: ResolvedPhenotype): void {
  const n = g.size;
  const c = centerOf(n);
  const R = coreRadius(n, res.quantized.bulk);
  const ex = qi(res.quantized.elongation);
  const rx = Math.max(2, R + Math.round((ex * R) / 3));
  const ry = n >= 13 ? 2 : 1;
  fillEllipse(g, c, c, clampInt(rx, 1, Math.floor(n / 2)), ry);
  const ps = 1 + Math.round((ex / 4) * 2); // paddle prominence 1..3.
  const rear = c - 1;
  for (let r = 1; r <= ps; r++) {
    for (let k = -1; k <= 1; k++) {
      g.set(rear + k, c - ry - r);
      g.set(rear + k, c + ry + r);
    }
  }
}
function paddledExtras(g: MutableGrid, res: ResolvedPhenotype): void {
  // Leading sensory structures toward the diet direction (front defaults +x).
  const proj = qi(res.quantized.projection);
  const n = g.size;
  const c = centerOf(n);
  const R = coreRadius(n, res.quantized.bulk);
  const ex = qi(res.quantized.elongation);
  const rx = clampInt(Math.max(2, R + Math.round((ex * R) / 3)), 1, Math.floor(n / 2));
  const dir = signedDirection(res.dietSigned) || 1;
  const fx = c + dir * (rx + 1);
  const nubs = 1 + Math.round((proj / 4) * 2);
  for (let k = 0; k < nubs && k < 3; k++) g.set(fx, c - 1 + k);
  if (proj >= 3) g.set(fx + dir, c);
}
function paddledDormant(g: MutableGrid, res: ResolvedPhenotype): void {
  // Fold paddles inward: shortened body alone.
  const n = g.size;
  const c = centerOf(n);
  const R = coreRadius(n, res.quantized.bulk);
  const rx = Math.max(1, R - 1);
  fillEllipse(g, c, c, clampInt(rx, 1, Math.floor(n / 2)), 1);
}

const CORES: Record<PhenotypeFamily, (g: MutableGrid, res: ResolvedPhenotype) => void> = {
  blob: blobCore,
  segmented: segmentedCore,
  radial: radialCore,
  plated: platedCore,
  branching: branchingCore,
  paddled: paddledCore,
};

const EXTRAS: Record<PhenotypeFamily, (g: MutableGrid, res: ResolvedPhenotype) => void> = {
  blob: blobExtras,
  segmented: segmentedExtras,
  radial: radialExtras,
  plated: platedExtras,
  branching: branchingExtras,
  paddled: paddledExtras,
};

const DORMANT: Record<PhenotypeFamily, (g: MutableGrid, res: ResolvedPhenotype) => void> = {
  blob: blobDormant,
  segmented: segmentedDormant,
  radial: radialDormant,
  plated: platedDormant,
  branching: branchingDormant,
  paddled: paddledDormant,
};

/**
 * Bounded cosmetic variation from identity (a marking pixel). Inspection
 * tier only: at most one cell, so any two identities differ by at most two
 * cells and never reshape the silhouette. Ecosystem and population tiers
 * carry no cosmetic pixels so dense-world readability and cross-LOD identity
 * hold. Animation phase (model.phaseForTick) is the other cosmetic channel.
 */
function applyCosmetic(g: MutableGrid, res: ResolvedPhenotype, tier: LodTier): void {
  if (tier !== "inspection") return;
  const n = g.size;
  const s = res.cosmeticSeed >>> 0;
  g.set(1 + ((s >>> 3) % (n - 2)), 1 + ((s >>> 11) % (n - 2)));
}

/** Render the monochrome phenotype grid for a resolved phenotype. */
export function renderPhenotypeGrid(
  res: ResolvedPhenotype,
  tier: LodTier,
  activity: ActivityState,
): PhenotypeGrid {
  const size = LOD_GRID_SIZE[tier];
  const g = makeGrid(size);
  if (activity === "dormant" && res.dormancyNorm < DORMANCY_STRONG_THRESHOLD) {
    // Weak dormant transform: hollow the active core, withdraw secondaries.
    const core = makeGrid(size);
    CORES[res.family](core, res);
    outlineInto(g, core);
  } else if (activity === "dormant") {
    DORMANT[res.family](g, res);
  } else {
    CORES[res.family](g, res);
    EXTRAS[res.family](g, res);
  }
  applyCosmetic(g, res, tier);
  return { size, cells: [...g.cells] };
}

/** Hamming distance between equal-size grids; Infinity when sizes differ. */
export function gridDifference(a: PhenotypeGrid, b: PhenotypeGrid): number {
  if (a.size !== b.size || a.cells.length !== b.cells.length) return Infinity;
  let d = 0;
  for (let i = 0; i < a.cells.length; i++) if (a.cells[i] !== b.cells[i]) d++;
  return d;
}

export function countFilled(grid: PhenotypeGrid): number {
  return grid.cells.filter(Boolean).length;
}

/** ASCII rendering for fixtures and evidence matrices ('#' filled). */
export function gridToAscii(grid: PhenotypeGrid): string {
  const rows: string[] = [];
  for (let y = 0; y < grid.size; y++) {
    let row = "";
    for (let x = 0; x < grid.size; x++) row += grid.cells[y * grid.size + x] ? "#" : ".";
    rows.push(row);
  }
  return rows.join("\n");
}

/** Minimal Canvas2D surface. The caller owns fillStyle (lens/selection). */
export interface FillSurface {
  fillRect(x: number, y: number, w: number, h: number): void;
}

/** Draw grid cells as unit rects at an origin. Color is caller-owned. */
export function drawGridToCanvas(
  ctx: FillSurface,
  grid: PhenotypeGrid,
  originX: number,
  originY: number,
  unit: number,
): void {
  for (let y = 0; y < grid.size; y++) {
    for (let x = 0; x < grid.size; x++) {
      if (grid.cells[y * grid.size + x]) ctx.fillRect(originX + x * unit, originY + y * unit, unit, unit);
    }
  }
}
