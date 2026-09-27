/**
 * Plated metabolism proof — procedural renderer, revision 2 (isolated prototype).
 *
 * Design Partner review (DESIGN TENSION) found revision 1 too flat/graphic:
 * opaque plates, blocky cell-noise, stacked disks, symbolic star highlights,
 * and value/coverage doing the work of biological activity. This revision
 * reworks the material grammar around the approved dark-sapphire reference:
 *
 * a. curved overlapping shell/teardrop plate masks (tapered tops);
 * b. dark interstitial recesses between plates;
 * c. cyan/pearl rim and ridge lighting following plate curvature;
 * d. cellular detail as dark-walled cells with modulated interiors, clipped
 *    to plate interiors (never blocky filled squares);
 * e. round shaded bead/pearl inclusions concentrated in seams and
 *    interstices (never crosses/stars);
 * f. metabolism-driven seam continuity, subsurface glow, inclusion density;
 * g. no symbolic highlights anywhere;
 * h. highlight clusters as ridge arcs, never scattered symbols;
 * i. LOD simplification that drops detail in order: speckle, then cells,
 *    then pearls — plates, rims, and seams survive to 16px.
 *
 * Kept from revision 1: structure derives only from family + non-metabolism
 * quantized inputs + seed (metabolism cannot move plates); activity channels
 * use seeded per-element thresholds (lit iff M > t: monotonic, stable,
 * deterministic). Plate BASE brightness is near-constant across M — higher
 * metabolism reads as more activity WITHIN the same material, not recolor.
 *
 * Reads PR 29 phenotype meaning (ResolvedPhenotype) without duplicating it.
 * No sim-core / sim-runtime imports (asserted in validation). No sim RNG.
 */
import type { ResolvedPhenotype } from "../../packages/phenotype/src/index.ts";

/** Handoff samples (prototype samples, not thresholds). */
export const SWEEP_M = [0.9, 0.7, 0.5, 0.3, 0.1] as const;
export const SWEEP_LABELS = ["M4", "M3", "M2", "M1", "M0"] as const;
export const FLIP_M = [0.1, 0.3] as const;
export const FLIP_LABELS = ["M0", "M1"] as const;
export const LOD_SIZES = [128, 64, 32, 16] as const;

/** Activity in [0,1] from normalized metabolism M in [0.10, 0.90]. */
export function activityOf(m: number): number {
  return Math.max(0, Math.min(1, (m - 0.1) / 0.8));
}

/** Deterministic 0..1 hash from integers (presentation-side only). */
export function hash01(...ns: number[]): number {
  let x = 0x811c9dc5;
  for (const n of ns) {
    x ^= (n | 0) + 0x9e3779b9 + (x << 6) + (x >>> 2);
    x = Math.imul(x, 0x01000193) >>> 0;
  }
  x ^= x >>> 13;
  x = Math.imul(x, 0x5bd1e995) >>> 0;
  x ^= x >>> 15;
  return (x >>> 0) / 4294967296;
}

export interface RGB {
  r: number;
  g: number;
  b: number;
}

/** Prototype palette (tuning inputs, not durable product semantics). */
export const PLATED_PALETTE = {
  recess: { r: 10, g: 18, b: 38 },
  recessDeep: { r: 6, g: 10, b: 22 },
  plateDeep: { r: 20, g: 44, b: 104 },
  plateMid: { r: 34, g: 78, b: 156 },
  plateHi: { r: 88, g: 140, b: 208 },
  wall: { r: 14, g: 30, b: 70 },
  pearl: { r: 226, g: 208, b: 172 },
  amber: { r: 232, g: 168, b: 104 },
  seam: { r: 104, g: 214, b: 238 },
  ridge: { r: 190, g: 232, b: 246 },
  subsurface: { r: 52, g: 120, b: 200 },
};

interface Plate {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  depth: number;
}

/**
 * Fixed shell/teardrop plate layout. Inputs EXCLUDE metabolism and seed
 * position jitter: identical quantized inputs always produce identical plate
 * geometry. Tops taper (shell-like); bottoms stay full and round.
 */
export function plateLayout(res: ResolvedPhenotype, _seed: number): Plate[] {
  const q = res.quantized;
  const wide = 1 + q.elongation * 0.1;
  const tall = 1 + q.bulk * 0.08;
  const lean = (q.asymmetry - 0.5) * 0.08;
  const base: Array<[number, number, number, number]> = [
    [0.5 + lean * 0.3, 0.64, 0.35 * wide, 0.2 * tall],
    [0.3 + lean * 0.2, 0.52, 0.23 * wide, 0.17 * tall],
    [0.7 + lean * 0.2, 0.52, 0.23 * wide, 0.17 * tall],
    [0.5, 0.4, 0.26 * wide, 0.18 * tall],
    [0.37, 0.25, 0.17 * wide, 0.13 * tall],
    [0.63, 0.25, 0.17 * wide, 0.13 * tall],
  ];
  return base.map(([cx, cy, rx, ry], i) => ({ cx, cy, rx, ry, depth: i }));
}

/** Teardrop mask: 1 inside, rim band, angle; 0 outside. Tapered tops. */
function shellMask(
  nx: number, ny: number, pl: Plate,
): { inside: boolean; d: number; upperLeft: boolean } {
  const dx = (nx - pl.cx) / pl.rx;
  let dy = (ny - pl.cy) / pl.ry;
  if (dy < 0) dy /= 0.55;
  const d = dx * dx + dy * dy;
  if (d > 1) return { inside: false, d, upperLeft: false };
  const ang = Math.atan2(dy, dx);
  const upperLeft = ang > Math.PI * 0.55 && ang < Math.PI * 1.15;
  return { inside: true, d, upperLeft };
}

export interface PlatedPixels {
  size: number;
  /** length size*size; 0 = transparent background. */
  kind: Uint8Array;
  rgb: Uint8Array;
}

const K_BG = 0;
const K_RECESS = 1;
const K_PLATE = 2;
const K_CELL = 3;
const K_WALL = 4;
const K_SEAM = 5;
const K_PEARL = 6;
const K_RIDGE = 7;
const K_SUB = 8;

export interface LodBudget {
  cells: boolean;
  pearls: number;
  speckle: boolean;
  seams: boolean;
}

/** Detail drops in order: speckle, cells, pearls — plates/rims/seams survive. */
export function lodBudget(size: number): LodBudget {
  if (size <= 16) return { cells: false, pearls: 2, speckle: false, seams: true };
  if (size <= 32) return { cells: true, pearls: 6, speckle: false, seams: true };
  if (size <= 64) return { cells: true, pearls: 12, speckle: true, seams: true };
  return { cells: true, pearls: 26, speckle: true, seams: true };
}

/**
 * Render one Plated organism. res supplies family/structure/seed; m is raw
 * normalized metabolism (0.10..0.90); size is the LOD output (128/64/32/16).
 */
export function renderPlated(res: ResolvedPhenotype, m: number, size: number): PlatedPixels {
  if (res.family !== "plated") throw new Error(`plated renderer got family ${res.family}`);
  const a = activityOf(m);
  const seed = res.cosmeticSeed >>> 0;
  const budget = lodBudget(size);
  const kind = new Uint8Array(size * size);
  const rgb = new Uint8Array(size * size * 3);
  const plates = plateLayout(res, seed);
  const cellScale = 0.24;

  const paint = (x: number, y: number, k: number, c: RGB): void => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = y * size + x;
    kind[i] = k;
    rgb[i * 3] = c.r;
    rgb[i * 3 + 1] = c.g;
    rgb[i * 3 + 2] = c.b;
  };

  // Mound recess floor first (dark interstices show through plate gaps).
  const mound = (x: number, y: number): boolean => {
    const nx = (x + 0.5) / size - 0.5;
    const ny = (y + 0.5) / size - 0.52;
    return (nx * nx) / 0.16 + (ny * ny) / 0.1 < 1;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (mound(x, y)) paint(x, y, K_RECESS, PLATED_PALETTE.recessDeep);
    }
  }

  // Plates back-to-front.
  plates.forEach((pl, pi) => {
    const shade = 0.78 + (pi / plates.length) * 0.3;
    // Overlap shadow halo: narrow dark-sapphire band so each shell reads as
    // overlapping the shell behind it.
    const halo = 1.5 / size;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const nx = (x + 0.5) / size;
        const ny = (y + 0.5) / size;
        const ex = (nx - pl.cx) / (pl.rx + halo);
        let ey = (ny - pl.cy) / (pl.ry + halo);
        if (ey < 0) ey /= 0.55;
        if (ex * ex + ey * ey > 1) continue;
        const i = y * size + x;
        if (kind[i] === K_BG) continue;
        paint(x, y, K_RECESS, PLATED_PALETTE.recess);
      }
    }
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const nx = (x + 0.5) / size;
        const ny = (y + 0.5) / size;
        const s = shellMask(nx, ny, pl);
        if (!s.inside) continue;
        // Base shell: top-light gradient, near-constant across M (tension 5:
        // metabolism adds activity WITHIN the material, not recolor).
        const light = 0.84 + 0.3 * (1 - ny) + 0.04 * a;
        const r = Math.min(255, Math.round(PLATED_PALETTE.plateDeep.r * shade * light + 8));
        const g = Math.min(255, Math.round(PLATED_PALETTE.plateDeep.g * shade * light + 10));
        const b = Math.min(255, Math.round(PLATED_PALETTE.plateDeep.b * shade * light + 14));
        paint(x, y, K_PLATE, { r, g, b });
        // Ridge lighting: pearl-cyan arc on the upper-left curvature.
        if (s.d > 0.62 && s.upperLeft) {
          const rb = 0.55 + 0.3 * a;
          paint(x, y, K_RIDGE, {
            r: Math.round(PLATED_PALETTE.ridge.r * rb),
            g: Math.round(PLATED_PALETTE.ridge.g * rb),
            b: Math.round(PLATED_PALETTE.ridge.b * rb),
          });
        }
        // Seam rim: continuity + brightness grow with M. Evaluated before
        // the cells gate so seams survive at small LODs (tension: 16px must
        // still order M0..M4).
        if (budget.seams && s.d > 0.8 && s.d <= 1) {
          const order = hash01(seed, pi, x, y);
          if (order < 0.25 + 0.7 * a) {
            const sb = 0.35 + 0.65 * a;
            paint(x, y, K_SEAM, {
              r: Math.round(PLATED_PALETTE.seam.r * sb),
              g: Math.round(PLATED_PALETTE.seam.g * sb),
              b: Math.round(PLATED_PALETTE.seam.b * sb),
            });
          }
        }
        if (!budget.cells) continue;
        // Cellular detail: dark walls + modulated interiors, clipped inside.
        const gx = nx * size * cellScale + (Math.floor(ny * size * cellScale) % 2) * 0.5;
        const gy = ny * size * cellScale;
        const fx = gx - Math.floor(gx);
        const fy = gy - Math.floor(gy);
        const wallDist = Math.min(fx, 1 - fx, fy, 1 - fy);
        if (wallDist < 0.16 && s.d < 0.9) {
          paint(x, y, K_WALL, PLATED_PALETTE.wall);
          continue;
        }
        const t = hash01(seed, pi, Math.floor(gx), Math.floor(gy));
        const interior = 0.9 + 0.2 * hash01(seed, pi, Math.floor(gx) + 999, Math.floor(gy));
        const litAt = 0.92 - 0.78 * a;
        if (t > litAt && s.d < 0.86) {
          const glow = 0.55 + 0.45 * a;
          paint(x, y, K_CELL, {
            r: Math.round(PLATED_PALETTE.plateHi.r * glow * interior),
            g: Math.round(PLATED_PALETTE.plateHi.g * glow * interior),
            b: Math.round(PLATED_PALETTE.plateHi.b * glow * interior),
          });
          // Subsurface lift on already-dark neighbors (soft, restrained).
          if (t > litAt + 0.05 && a > 0.3) {
            const jx = x + (hash01(seed, pi, x, y) > 0.5 ? 1 : -1);
            const jy = y + (hash01(seed, pi, y, x) > 0.5 ? 1 : -1);
            if (jx >= 0 && jy >= 0 && jx < size && jy < size) {
              const j = jy * size + jx;
              if (kind[j] === K_PLATE) {
                paint(jx, jy, K_SUB, PLATED_PALETTE.subsurface);
              }
            }
          }
        }
      }
    }
  });

  // Interstitial bead pearls: round shaded beads in seam/interstice zones.
  // Slots are ordered once by seeded key and filled as a PREFIX of length
  // pearlCount(a): higher metabolism adds pearls without moving or removing
  // existing ones, so sets nest across M (monotonic by construction).
  const slots: Array<{ order: number; s: number }> = [];
  for (let s = 0; s < 26; s++) slots.push({ order: hash01(seed, 779, s), s });
  slots.sort((p, q) => p.order - q.order);
  const take = Math.min(budget.pearls, slots.filter((sl) => sl.order <= 0.12 + 0.8 * a).length);
  for (let k = 0; k < take; k++) {
    const s = slots[k]!.s;
    const px = hash01(seed, 777, s);
    const py = hash01(seed, 778, s);
    const cx = Math.floor(px * size);
    const cy = Math.floor((0.3 + py * 0.55) * size);
    const r = Math.max(1, Math.round(size / 64) + (s % 2));
    const amber = hash01(seed, 780, s) > 0.45;
    const col = amber ? PLATED_PALETTE.amber : PLATED_PALETTE.pearl;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        if (cx + dx < 0 || cy + dy < 0 || cx + dx >= size || cy + dy >= size) continue;
        const i = (cy + dy) * size + (cx + dx);
        if (kind[i] === K_BG) continue;
        // Round bead shading: bright upper-left dot, warm body.
        const edge = dx * dx + dy * dy >= (r - 0.5) * (r - 0.5);
        const hi = dx <= 0 && dy <= 0 && !edge;
        const cc = hi
          ? { r: 244, g: 238, b: 222 }
          : edge
            ? { r: Math.round(col.r * 0.55), g: Math.round(col.g * 0.55), b: Math.round(col.b * 0.6) }
            : col;
        paint(cx + dx, cy + dy, K_PEARL, cc);
      }
    }
  }

  // Sparse embedded micro-dots (round, single-pixel, plate interiors only).
  if (budget.speckle) {
    const speckN = Math.round(size * (0.05 + 0.08 * a));
    for (let s = 0; s < speckN; s++) {
      const x = Math.floor(hash01(seed, 999, s) * size);
      const y = Math.floor(hash01(seed, 998, s) * size);
      const i = y * size + x;
      if (kind[i] === K_PLATE) paint(x, y, K_PLATE, PLATED_PALETTE.pearl);
    }
  }
  return { size, kind, rgb };
}

/** Bright-activity pixel ratio: the monotonic readability metric (AC4). */
export function activityMetric(p: PlatedPixels): number {
  let n = 0;
  for (let i = 0; i < p.kind.length; i++) {
    const k = p.kind[i];
    if (k === K_CELL || k === K_SEAM || k === K_PEARL || k === K_SUB) n++;
  }
  return n / p.kind.length;
}

/** Silhouette mask: any non-background pixel. */
export function silhouette(p: PlatedPixels): Uint8Array {
  const out = new Uint8Array(p.kind.length);
  for (let i = 0; i < out.length; i++) out[i] = p.kind[i] === K_BG ? 0 : 1;
  return out;
}

/** IoU of two same-size silhouettes (AC6 structural stability). */
export function silhouetteIoU(a: Uint8Array, b: Uint8Array): number {
  let inter = 0;
  let union = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 1 && b[i] === 1) inter++;
    if (a[i] === 1 || b[i] === 1) union++;
  }
  return union === 0 ? 1 : inter / union;
}

/** Luminance grid for the monochrome structural comparison. */
export function luminance(p: PlatedPixels): Uint8Array {
  const out = new Uint8Array(p.kind.length);
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.round(0.299 * p.rgb[i * 3]! + 0.587 * p.rgb[i * 3 + 1]! + 0.114 * p.rgb[i * 3 + 2]!);
  }
  return out;
}
