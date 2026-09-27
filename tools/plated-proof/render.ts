/**
 * Plated metabolism proof — procedural renderer, revision 3 (isolated prototype).
 *
 * Design review found revision 2 still too graphic: rectangular cell grid
 * (brickwork read), stacked bands instead of individual shells, placed (not
 * embedded) pearls, opaque material. This revision restructures the base
 * rendering model (metabolism mapping is unchanged in spirit):
 *
 * - Individually parameterized shell/teardrop plates: own center, radii,
 *   top taper, horizontal lean, and light angle. Painted strictly
 *   back-to-front (strong overlap occlusion).
 * - Per-plate curvature lighting: surface normals from finite differences of
 *   the mask function; ridge response follows real curvature, not arcs.
 * - Irregular cellular interiors: per-plate Voronoi diagrams from seeded
 *   points (no rectangular grid anywhere). Dark walls where nearest and
 *   second-nearest seeds nearly tie; interiors shaded per Voronoi cell.
 * - Gap-derived pearls: candidate slots sampled from actual inter-plate gap
 *   pixels (inside mound, outside all plates), clustered, round and shaded.
 * - Metabolism as interior emission: cell-interior brightness, seam
 *   continuity, subsurface lift. Plate base brightness is constant in M.
 * - Three material variants over one renderer: translucent / specular /
 *   dark-bio. Same inputs, same masks, same silhouette — material differs.
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
  let a = 0x811c9dc5;
  for (const n of ns) {
    a ^= (n | 0) + 0x9e3779b9 + (a << 6) + (a >>> 2);
    a = Math.imul(a, 0x01000193) >>> 0;
  }
  a ^= a >>> 13;
  a = Math.imul(a, 0x5bd1e995) >>> 0;
  a ^= a >>> 15;
  return (a >>> 0) / 4294967296;
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
  wall: { r: 13, g: 28, b: 66 },
  pearl: { r: 226, g: 208, b: 172 },
  amber: { r: 232, g: 168, b: 104 },
  seam: { r: 104, g: 214, b: 238 },
  ridge: { r: 190, g: 232, b: 246 },
  subsurface: { r: 52, g: 120, b: 200 },
};

export type MaterialVariant = "translucent" | "specular" | "darkbio";

export interface MaterialParams {
  /** Base plate brightness multiplier. */
  base: number;
  /** Top-light gradient strength. */
  topLight: number;
  /** Ridge/specular response strength. */
  specular: number;
  /** Wall darkness (1 = full wall color). */
  wallStrength: number;
  /** Emission (interior brightness from M). */
  emission: number;
  /** Seam brightness multiplier. */
  seamBoost: number;
  /** Subsurface lift strength. */
  subsurface: number;
  /** Pearl brightness multiplier. */
  pearlBoost: number;
}

export const MATERIALS: Record<MaterialVariant, MaterialParams> = {
  // Softer translucent plates: lighter base, gentler walls, strong subsurface.
  translucent: { base: 1.12, topLight: 0.22, specular: 0.7, wallStrength: 0.7, emission: 0.9, seamBoost: 0.9, subsurface: 1.3, pearlBoost: 0.95 },
  // Stronger pearlescent/specular plates: bright ridges, crisp walls.
  specular: { base: 1.0, topLight: 0.34, specular: 1.4, wallStrength: 1.0, emission: 1.0, seamBoost: 1.1, subsurface: 0.8, pearlBoost: 1.15 },
  // Darker biological plates with brighter interstitial glow.
  darkbio: { base: 0.8, topLight: 0.26, specular: 0.9, wallStrength: 1.1, emission: 1.2, seamBoost: 1.5, subsurface: 1.5, pearlBoost: 1.0 },
};

export interface ShellPlate {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** Top taper <1 (shell/teardrop); bottom stays round. */
  taper: number;
  /** Horizontal skew of the shell. */
  lean: number;
  /** Light direction angle for curvature response. */
  lightAng: number;
  depth: number;
}

/**
 * Fixed shell layout. Inputs EXCLUDE metabolism and seed position jitter:
 * identical quantized inputs always produce identical plate geometry.
 */
export function plateLayout(res: ResolvedPhenotype, _seed: number): ShellPlate[] {
  const q = res.quantized;
  const wide = 1 + q.elongation * 0.1;
  const tall = 1 + q.bulk * 0.08;
  const leanBase = (q.asymmetry - 0.5) * 0.08;
  const defs: Array<[number, number, number, number, number, number, number]> = [
    // cx, cy, rx, ry, taper, lean, lightAng
    [0.5 + leanBase * 0.3, 0.64, 0.35 * wide, 0.2 * tall, 0.62, 0.0, 2.4],
    [0.3 + leanBase * 0.2, 0.52, 0.23 * wide, 0.17 * tall, 0.55, -0.12, 2.2],
    [0.7 + leanBase * 0.2, 0.52, 0.23 * wide, 0.17 * tall, 0.55, 0.12, 2.6],
    [0.5, 0.4, 0.26 * wide, 0.18 * tall, 0.5, 0.0, 2.4],
    [0.37, 0.25, 0.17 * wide, 0.13 * tall, 0.45, -0.08, 2.1],
    [0.63, 0.25, 0.17 * wide, 0.13 * tall, 0.45, 0.08, 2.7],
  ];
  return defs.map(([cx, cy, rx, ry, taper, lean, lightAng], i) => ({ cx, cy, rx, ry, taper, lean, lightAng, depth: i }));
}

/** Shell mask with taper + lean; returns inside flag, depth value, normal. */
function shellField(
  nx: number, ny: number, pl: ShellPlate,
): { inside: boolean; d: number; nx: number; ny: number } {
  const sx = nx - pl.cx - pl.lean * (ny - pl.cy);
  let sy = (ny - pl.cy) / pl.ry;
  const ryEff = sy < 0 ? pl.ry * (0.55 + 0.45 * pl.taper) : pl.ry;
  sy = (ny - pl.cy) / ryEff;
  const dx = sx / pl.rx;
  const d = dx * dx + sy * sy;
  if (d > 1) return { inside: false, d, nx: 0, ny: 0 };
  // Surface normal via finite differences of the field.
  const e = 0.004;
  const fx = (px: number, py: number): number => {
    const qx = (px - pl.cx - pl.lean * (py - pl.cy)) / pl.rx;
    let qy = (py - pl.cy) / pl.ry;
    if (qy < 0) qy /= 0.55 + 0.45 * pl.taper;
    return qx * qx + qy * qy;
  };
  let gx = (fx(nx + e, ny) - fx(nx - e, ny)) / (2 * e);
  let gy = (fx(nx, ny + e) - fx(nx, ny - e)) / (2 * e);
  const len = Math.hypot(gx, gy) || 1;
  gx /= len;
  gy /= len;
  return { inside: true, d, nx: gx, ny: gy };
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

interface Voronoi {
  px: number[];
  py: number[];
  tone: number[];
}

/** Seeded Voronoi sites in normalized plate-local coords (fixed count). */
function voronoiSites(seed: number, pi: number, count: number): Voronoi {
  const px: number[] = [];
  const py: number[] = [];
  const tone: number[] = [];
  const grid = Math.ceil(Math.sqrt(count));
  let i = 0;
  for (let gy = 0; gy < grid && i < count; gy++) {
    for (let gx = 0; gx < grid && i < count; gx++) {
      px.push((gx + 0.15 + 0.7 * hash01(seed, pi, 500 + i)) / grid * 2 - 1);
      py.push((gy + 0.15 + 0.7 * hash01(seed, pi, 600 + i)) / grid * 2 - 1);
      tone.push(0.85 + 0.3 * hash01(seed, pi, 700 + i));
      i++;
    }
  }
  return { px, py, tone };
}

/**
 * Render one Plated organism. res supplies family/structure/seed; m is raw
 * normalized metabolism (0.10..0.90); size is the LOD output; variant selects
 * the material parameter set (same inputs, same silhouette).
 */
export function renderPlated(
  res: ResolvedPhenotype,
  m: number,
  size: number,
  variant: MaterialVariant = "translucent",
): PlatedPixels {
  if (res.family !== "plated") throw new Error(`plated renderer got family ${res.family}`);
  const a = activityOf(m);
  const mat = MATERIALS[variant];
  const seed = res.cosmeticSeed >>> 0;
  const budget = lodBudget(size);
  const kind = new Uint8Array(size * size);
  const rgb = new Uint8Array(size * size * 3);
  const plates = plateLayout(res, seed);
  const vorSites = plates.map((_, pi) => voronoiSites(seed, pi, 26));

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

  // Gap map: pixels inside the mound but outside every plate (pearl beds).
  const gapAt = (nx: number, ny: number): boolean => {
    if (!mound(nx * size - 0.5, ny * size - 0.5)) return false;
    for (const pl of plates) {
      if (shellField(nx, ny, pl).inside) return false;
    }
    return true;
  };

  // Plates back-to-front (strong overlap occlusion by paint order).
  plates.forEach((pl, pi) => {
    const shade = 0.78 + (pi / plates.length) * 0.3;
    const lx = Math.cos(pl.lightAng);
    const ly = Math.sin(pl.lightAng);
    const sites = vorSites[pi]!;
    // Overlap shadow halo: narrow dark-sapphire band so each shell reads as
    // overlapping the shell behind it. Halo narrows at small LODs: a fixed
    // 1.5px band would bury back-plate rims (and their seams) entirely.
    const halo = (size >= 64 ? 1.5 : 0.75) / size;
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
        const s = shellField(nx, ny, pl);
        if (!s.inside) continue;
        // Base shell: top-light gradient, CONSTANT in M (metabolism reads as
        // interior activity, never recolor).
        const light = (0.84 + mat.topLight * (1 - ny)) * mat.base;
        paint(x, y, K_PLATE, {
          r: Math.min(255, Math.round(PLATED_PALETTE.plateDeep.r * shade * light + 8)),
          g: Math.min(255, Math.round(PLATED_PALETTE.plateDeep.g * shade * light + 10)),
          b: Math.min(255, Math.round(PLATED_PALETTE.plateDeep.b * shade * light + 14)),
        });
        // Ridge response from real surface curvature vs the plate light dir.
        const facing = Math.max(0, -(s.nx * lx + s.ny * ly));
        if (s.d > 0.55 && facing > 0.45) {
          const rb = facing * mat.specular * (0.5 + 0.3 * a);
          const cur = kind[y * size + x];
          if (cur === K_PLATE) {
            paint(x, y, K_RIDGE, {
              r: Math.min(255, Math.round(PLATED_PALETTE.ridge.r * rb)),
              g: Math.min(255, Math.round(PLATED_PALETTE.ridge.g * rb)),
              b: Math.min(255, Math.round(PLATED_PALETTE.ridge.b * rb)),
            });
          }
        }
        // Seam rim: continuity + brightness grow with M. Evaluated before
        // the cells gate so seams survive at small LODs (16px ordering).
        if (budget.seams && s.d > 0.8 && s.d <= 1) {
          const order = hash01(seed, pi, x, y);
          if (order < 0.25 + 0.7 * a) {
            const sb = (0.35 + 0.65 * a) * mat.seamBoost;
            paint(x, y, K_SEAM, {
              r: Math.min(255, Math.round(PLATED_PALETTE.seam.r * sb)),
              g: Math.min(255, Math.round(PLATED_PALETTE.seam.g * sb)),
              b: Math.min(255, Math.round(PLATED_PALETTE.seam.b * sb)),
            });
          }
        }
        if (!budget.cells) continue;
        // Voronoi interior: nearest/second-nearest seeded sites in plate space.
        const lx0 = ((nx - (pl.cx - pl.rx)) / (2 * pl.rx)) * 2 - 1;
        const ly0 = ((ny - (pl.cy - pl.ry)) / (2 * pl.ry)) * 2 - 1;
        let best = Infinity;
        let second = Infinity;
        let bestTone = 1;
        for (let vi = 0; vi < sites.px.length; vi++) {
          const ddx = lx0 - sites.px[vi]!;
          const ddy = ly0 - sites.py[vi]!;
          const dd = ddx * ddx + ddy * ddy;
          if (dd < best) {
            second = best;
            best = dd;
            bestTone = sites.tone[vi]!;
          } else if (dd < second) {
            second = dd;
          }
        }
        // Dark walls where two cells nearly tie.
        if (second - best < 0.02 && s.d < 0.92) {
          const w = PLATED_PALETTE.wall;
          const ws = mat.wallStrength;
          paint(x, y, K_WALL, {
            r: Math.min(255, Math.round(w.r * ws + 6)),
            g: Math.min(255, Math.round(w.g * ws + 6)),
            b: Math.min(255, Math.round(w.b * ws + 8)),
          });
          continue;
        }
        // Cell interior: per-cell tone + metabolism emission.
        const t = hash01(seed, pi, Math.floor(best * 997));
        const litAt = 0.9 - 0.75 * a;
        if (t > litAt && s.d < 0.86) {
          const glow = (0.5 + 0.5 * a) * bestTone;
          paint(x, y, K_CELL, {
            r: Math.min(255, Math.round(PLATED_PALETTE.plateHi.r * glow)),
            g: Math.min(255, Math.round(PLATED_PALETTE.plateHi.g * glow)),
            b: Math.min(255, Math.round(PLATED_PALETTE.plateHi.b * glow)),
          });
          if (t > litAt + 0.05 && a > 0.3) {
            const jx = x + (hash01(seed, pi, x, y) > 0.5 ? 1 : -1);
            const jy = y + (hash01(seed, pi, y, x) > 0.5 ? 1 : -1);
            if (jx >= 0 && jy >= 0 && jx < size && jy < size) {
              const j = jy * size + jx;
              if (kind[j] === K_PLATE) {
                const sm = PLATED_PALETTE.subsurface;
                const ss = mat.subsurface;
                paint(jx, jy, K_SUB, {
                  r: Math.min(255, Math.round(sm.r * ss)),
                  g: Math.min(255, Math.round(sm.g * ss)),
                  b: Math.min(255, Math.round(sm.b * ss)),
                });
              }
            }
          }
        }
      }
    }
  });

  // Gap-derived pearl clusters: seeded points sampled from actual gap pixels.
  const gapPts: Array<[number, number]> = [];
  {
    let guard = 0;
    while (gapPts.length < 40 && guard++ < 4000) {
      const gx = hash01(seed, 9000 + guard);
      const gy = 0.3 + hash01(seed, 9100 + guard) * 0.55;
      if (gapAt(gx, gy)) gapPts.push([Math.floor(gx * size), Math.floor(gy * size)]);
    }
  }
  gapPts.sort((p, q) => hash01(seed, p[0], p[1]) - hash01(seed, q[0], q[1]));
  const takePearls = Math.min(budget.pearls, gapPts.length);
  const wantPearls = Math.min(takePearls, Math.round(2 + 20 * a));
  for (let k = 0; k < wantPearls; k++) {
    const [cx, cy] = gapPts[k]!;
    const r = Math.max(1, Math.round(size / 64) + (k % 2));
    const amber = hash01(seed, 780, k) > 0.45;
    const col = amber ? PLATED_PALETTE.amber : PLATED_PALETTE.pearl;
    const pb = mat.pearlBoost;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        if (cx + dx < 0 || cy + dy < 0 || cx + dx >= size || cy + dy >= size) continue;
        const i = (cy + dy) * size + (cx + dx);
        if (kind[i] === K_BG) continue;
        const edge = dx * dx + dy * dy >= (r - 0.5) * (r - 0.5);
        const hi = dx <= 0 && dy <= 0 && !edge;
        const cc = hi
          ? { r: 244, g: 238, b: 222 }
          : edge
            ? { r: Math.round(col.r * 0.55), g: Math.round(col.g * 0.55), b: Math.round(col.b * 0.6) }
            : { r: Math.min(255, Math.round(col.r * pb)), g: Math.min(255, Math.round(col.g * pb)), b: Math.min(255, Math.round(col.b * pb)) };
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
