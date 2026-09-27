/**
 * Plated metabolism proof — procedural renderer (isolated prototype).
 *
 * Handoff: "Plated Metabolism" art-direction proof. Renders the approved
 * pearlescent/bioluminescent pixel-naturalist grammar for ONE Plated lineage
 * across a five-state metabolism sweep (M0..M4), at 128/64/32/16.
 *
 * Architecture (def deliberate split):
 * - STRUCTURE (plate count/order, silhouette, hierarchy) derives ONLY from
 *   family + non-metabolism quantized inputs + cosmetic seed. Metabolism can
 *   never reorder plates or change the silhouette (AC6 by construction).
 * - ACTIVITY (cell fill, pearls, seam brightness/continuity, glow, speckle)
 *   derives from RAW normalized metabolism via seeded per-element thresholds:
 *   element (i,j) with threshold t is lit iff M > t. Monotonic in M (AC4),
 *   stable across rerenders (AC7), identical lineage layout across M (AC5).
 *
 * Reads PR 29 phenotype meaning (ResolvedPhenotype) without duplicating it.
 * No sim-core / sim-runtime imports (asserted in validation). No sim RNG:
 * all variation comes from hashCosmeticSeed-style integer hashing of stable
 * presentation inputs.
 */
import type { ResolvedPhenotype } from "../../packages/phenotype/src/index.ts";

/** Handoff samples (prototype samples, not thresholds). Under the hybrid
 * calibration the full M0..M4 sweep holds Plated along one descending lineage
 * (M0/M1 resolve blob as founders but retain plated under lineage anchoring —
 * hysteresis working as designed). See fixtures.flipSamples() for the pair. */
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
  recess: { r: 8, g: 14, b: 26 },
  plateDeep: { r: 22, g: 48, b: 112 },
  plateMid: { r: 38, g: 86, b: 168 },
  plateHi: { r: 96, g: 150, b: 220 },
  pearl: { r: 232, g: 214, b: 178 },
  amber: { r: 238, g: 176, b: 112 },
  seam: { r: 110, g: 220, b: 245 },
  glow: { r: 70, g: 150, b: 230 },
};

interface Plate {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  depth: number;
}

/**
 * Fixed plate layout for a resolved phenotype. Inputs EXCLUDE metabolism and
 * seed position jitter, so the M-sweep cannot move plates: identical quantized
 * inputs always produce identical plate geometry. The cosmetic seed drives
 * only thresholds (cell lit order), seam draw order, pearl slots, and speckle.
 */
export function plateLayout(res: ResolvedPhenotype, _seed: number): Plate[] {
  const q = res.quantized;
  const wide = 1 + q.elongation * 0.12;
  const tall = 1 + q.bulk * 0.1;
  const lean = (q.asymmetry - 0.5) * 0.1;
  const base: Array<[number, number, number, number]> = [
    [0.5 + lean * 0.3, 0.62, 0.34 * wide, 0.2 * tall],
    [0.32 + lean * 0.2, 0.5, 0.24 * wide, 0.17 * tall],
    [0.68 + lean * 0.2, 0.5, 0.24 * wide, 0.17 * tall],
    [0.5, 0.36, 0.27 * wide, 0.18 * tall],
    [0.38, 0.24, 0.18 * wide, 0.13 * tall],
    [0.62, 0.24, 0.18 * wide, 0.13 * tall],
  ];
  return base.map(([cx, cy, rx, ry], i) => ({ cx, cy, rx, ry, depth: i }));
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
const K_SEAM = 4;
const K_PEARL = 5;
const K_GLOW = 6;
const K_SPECK = 7;

/**
 * Render one Plated organism. res supplies family/structure/seed; m is raw
 * normalized metabolism (0.10..0.90); size is the LOD output (128/64/32/16).
 */
export function renderPlated(res: ResolvedPhenotype, m: number, size: number): PlatedPixels {
  if (res.family !== "plated") throw new Error(`plated renderer got family ${res.family}`);
  const a = activityOf(m);
  const seed = res.cosmeticSeed >>> 0;
  const kind = new Uint8Array(size * size);
  const rgb = new Uint8Array(size * size * 3);
  const plates = plateLayout(res, seed);

  const paint = (x: number, y: number, k: number, c: RGB): void => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = y * size + x;
    kind[i] = k;
    rgb[i * 3] = c.r;
    rgb[i * 3 + 1] = c.g;
    rgb[i * 3 + 2] = c.b;
  };

  // Mound silhouette + recesses first (dark), plates back-to-front over them.
  const mound = (x: number, y: number): boolean => {
    const nx = (x + 0.5) / size - 0.5;
    const ny = (y + 0.5) / size - 0.52;
    return (nx * nx) / 0.16 + (ny * ny) / 0.1 < 1;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (mound(x, y)) paint(x, y, K_RECESS, PLATED_PALETTE.recess);
    }
  }
  // Plates back-to-front; each plate: fill, cell texture, seam rim.
  plates.forEach((pl, pi) => {
    // Overlap shadow: a slightly larger dark-sapphire halo first, so each
    // plate reads as overlapping (not merged with) the plate behind it.
    // Kept narrow (1.5px at 128): wider reads as outline, not recess.
    const halo = 1.5 / size;
    const haloCol = { r: 14, g: 28, b: 64 };
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const nx = (x + 0.5) / size;
        const ny = (y + 0.5) / size;
        const ex = (nx - pl.cx) / (pl.rx + halo);
        const ey = (ny - pl.cy) / (pl.ry + halo);
        if (ex * ex + ey * ey > 1) continue;
        const i = y * size + x;
        if (kind[i] === K_BG) continue;
        paint(x, y, K_RECESS, haloCol);
      }
    }
    const shade = 0.72 + (pi / plates.length) * 0.38;
    const base: RGB = {
      r: Math.round(PLATED_PALETTE.plateDeep.r * shade + PLATED_PALETTE.plateMid.r * (1 - shade) * 0.4),
      g: Math.round(PLATED_PALETTE.plateDeep.g * shade + PLATED_PALETTE.plateMid.g * (1 - shade) * 0.4),
      b: Math.round(PLATED_PALETTE.plateDeep.b * shade + PLATED_PALETTE.plateMid.b * (1 - shade) * 0.4),
    };
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const nx = (x + 0.5) / size;
        const ny = (y + 0.5) / size;
        const ex = (nx - pl.cx) / pl.rx;
        const ey = (ny - pl.cy) / pl.ry;
        const d = ex * ex + ey * ey;
        if (d > 1) continue;
        // Plate fill with top-light gradient.
        const light = 0.82 + 0.36 * (1 - ny);
        paint(x, y, K_PLATE, {
          r: Math.min(255, Math.round(base.r * light)),
          g: Math.min(255, Math.round(base.g * light)),
          b: Math.min(255, Math.round(base.b * light)),
        });
        // Hex-ish cell texture: cell id from staggered grid; lit iff M passes
        // its seeded threshold (monotonic in M by construction).
        const gx = Math.floor(nx * size * 0.24 + (Math.floor(ny * size * 0.24) % 2) * 0.5);
        const gy = Math.floor(ny * size * 0.24);
        const t = hash01(seed, pi, gx, gy);
        const litAt = 0.92 - 0.78 * a;
        if (t > litAt && d < 0.86) {
          const glow = 0.5 + 0.5 * a;
          paint(x, y, K_CELL, {
            r: Math.round(PLATED_PALETTE.plateHi.r * glow),
            g: Math.round(PLATED_PALETTE.plateHi.g * glow),
            b: Math.round(PLATED_PALETTE.plateHi.b * glow),
          });
          if (t > litAt + 0.06 && a > 0.35) {
            paint(x, y, K_GLOW, PLATED_PALETTE.glow);
          }
        }
        // Seam rim: brightness + continuity grow with M.
        if (d > 0.8 && d <= 1) {
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
      }
    }
  });
  // Interstitial pearls: fixed candidate slots, count grows with M.
  const pearlSlots = 26;
  const pearlCount = Math.round(2 + 20 * a);
  let placed = 0;
  for (let s = 0; s < pearlSlots && placed < pearlCount; s++) {
    const px = hash01(seed, 777, s);
    const py = hash01(seed, 778, s);
    const order = hash01(seed, 779, s);
    if (order > 0.12 + 0.8 * a) continue;
    const cx = Math.floor(px * size);
    const cy = Math.floor((0.3 + py * 0.55) * size);
    const r = Math.max(1, Math.round(size / 64) + (s % 2));
    const amber = hash01(seed, 780, s) > 0.45;
    const col = amber ? PLATED_PALETTE.amber : PLATED_PALETTE.pearl;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const i = (cy + dy) * size + (cx + dx);
        if (cx + dx < 0 || cy + dy < 0 || cx + dx >= size || cy + dy >= size) continue;
        if (kind[i] === K_BG) continue;
        const hi = dx <= 0 && dy <= 0 ? 1.12 : 0.92;
        paint(cx + dx, cy + dy, K_PEARL, {
          r: Math.min(255, Math.round(col.r * hi)),
          g: Math.min(255, Math.round(col.g * hi)),
          b: Math.min(255, Math.round(col.b * hi)),
        });
      }
    }
    placed++;
  }
  // Sparse micro-speckle (seeded positions, mild M dependence).
  const speckN = Math.round(size * (0.06 + 0.1 * a));
  for (let s = 0; s < speckN; s++) {
    const x = Math.floor(hash01(seed, 999, s) * size);
    const y = Math.floor(hash01(seed, 998, s) * size);
    const i = y * size + x;
    if (kind[i] !== K_BG) paint(x, y, K_SPECK, PLATED_PALETTE.pearl);
  }
  return { size, kind, rgb };
}

/** Bright-activity pixel ratio: the monotonic readability metric (AC4). */
export function activityMetric(p: PlatedPixels): number {
  let n = 0;
  for (let i = 0; i < p.kind.length; i++) {
    const k = p.kind[i];
    if (k === K_CELL || k === K_SEAM || k === K_PEARL || k === K_GLOW || k === K_SPECK) n++;
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
