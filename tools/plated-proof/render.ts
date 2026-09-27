/**
 * Plated metabolism proof — procedural material renderer (isolated prototype).
 *
 * Design review history: rev 2 was too graphic (rectangular cell grid,
 * stacked bands, placed pearls, opaque material); rev 3 restructured it
 * around parametric shell plates with Voronoi interiors, gap pearls, and
 * metabolism-as-emission. The §15 geometry gate then replaced the plate
 * LAYOUT: material now paints the accepted packed-cluster spine shells
 * (geometry.ts, GEOMETRY_SEED) — the renderer may never perturb the gated
 * silhouette (asserted in validation: rendered mask == gate raster).
 *
 * Material features (all on the accepted geometry):
 *
 * - Overlap shadow bands: each plate darkens the crevice it casts on the
 *   plate(s) behind it before painting itself (back-to-front paint order).
 * - Per-plate curvature lighting: outward normals from the spine distance
 *   field drive a broad pale DOME CAP on light-facing rim slopes (the
 *   reference's shell caps) plus the cyan seam line along the rim.
 * - Translucency (variant): front-over-rear color bleed where a plate sits
 *   on another plate or the bed — water behind stays opaque.
 * - Irregular cellular interiors: per-plate Voronoi diagrams from seeded
 *   points in plate-local (u along spine, v across) coordinates, anisotropic
 *   grid so cells read roundish in pixels. Pale walls where nearest and
 *   second-nearest seeds nearly tie; lit interiors shaded per Voronoi cell
 *   with a soft dome and per-cell tone.
 * - Gap-derived pearls: candidate slots are ACTUAL recess/rim pixels —
 *   exposed bed discs (the declared pearl beds) first, then overlap
 *   shadows, then plate rims — sorted toward the bed centers so beads
 *   cluster like the reference. Never background.
 * - Metabolism as interior emission: cell-interior brightness, seam
 *   continuity, subsurface lift, and warm tip glow (dark at M0, amber-
 *   white at M4). Plate base brightness is constant in M.
 * - Three material variants over one renderer: translucent / specular /
 *   dark-bio. Same inputs, same masks, same silhouette — material differs.
 *
 * Reads PR 29 phenotype meaning (ResolvedPhenotype) without duplicating it.
 * No sim-core / sim-runtime imports (asserted in validation). No sim RNG.
 */
import type { ResolvedPhenotype } from "../../packages/phenotype/src/index.ts";
import {
  BED,
  GEOMETRY_SEED,
  halfWidth,
  hash01,
  layoutPlates,
  bedHit,
  plateHit,
  spineSamples,
  type ShellPlate,
} from "./geometry.ts";

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
  wall: { r: 150, g: 196, b: 226 },
  /** Per-cell hues: the reference mixes pink/salmon and teal cells with blue. */
  cellPink: { r: 226, g: 132, b: 164 },
  cellTeal: { r: 76, g: 176, b: 178 },
  pearl: { r: 226, g: 208, b: 172 },
  amber: { r: 232, g: 168, b: 104 },
  seam: { r: 160, g: 220, b: 240 },
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
  /** Cell-wall strength (1 = full wall color). */
  wallStrength: number;
  /** Emission (interior brightness from M). */
  emission: number;
  /** Seam brightness multiplier. */
  seamBoost: number;
  /** Subsurface lift strength. */
  subsurface: number;
  /** Pearl brightness multiplier. */
  pearlBoost: number;
  /** Front-over-rear color bleed where a plate overlaps another plate. */
  translucency: number;
}

export const MATERIALS: Record<MaterialVariant, MaterialParams> = {
  // Softer translucent plates: lighter base, gentler walls, strong
  // subsurface, and a real see-through bleed of the plate behind.
  translucent: { base: 1.12, topLight: 0.22, specular: 0.7, wallStrength: 0.7, emission: 0.9, seamBoost: 0.9, subsurface: 1.3, pearlBoost: 0.95, translucency: 0.24 },
  // Stronger pearlescent/specular plates: bright ridges, crisp walls,
  // nearly opaque (a hint of bleed under the front shells).
  specular: { base: 1.0, topLight: 0.34, specular: 1.4, wallStrength: 1.0, emission: 1.0, seamBoost: 1.1, subsurface: 0.8, pearlBoost: 1.15, translucency: 0.06 },
  // Darker biological plates with brighter interstitial glow (opaque).
  darkbio: { base: 0.8, topLight: 0.26, specular: 0.9, wallStrength: 1.1, emission: 1.2, seamBoost: 1.5, subsurface: 1.5, pearlBoost: 1.0, translucency: 0 },
};

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

/**
 * Seeded Voronoi sites in plate-local coords (u along spine, v across).
 * The grid is ANISOTROPIC (more divisions along the spine) because plate
 * space is ~2.5x longer than wide — a square grid makes cells read as
 * thin streaks instead of the reference's roundish shells.
 */
function voronoiSites(seed: number, pi: number, gridU: number, gridV: number): Voronoi {
  const px: number[] = [];
  const py: number[] = [];
  const tone: number[] = [];
  let i = 0;
  for (let gy = 0; gy < gridV; gy++) {
    for (let gx = 0; gx < gridU; gx++) {
      px.push((gx + 0.15 + 0.7 * hash01(seed, pi, 500 + i)) / gridU * 2 - 1);
      py.push((gy + 0.15 + 0.7 * hash01(seed, pi, 600 + i)) / gridV * 2 - 1);
      tone.push(0.85 + 0.3 * hash01(seed, pi, 700 + i));
      i++;
    }
  }
  return { px, py, tone };
}

/**
 * Render one Plated organism on the accepted packed-cluster geometry.
 * res supplies family/structure/seed; m is raw normalized metabolism
 * (0.10..0.90); size is the LOD output; variant selects the material
 * parameter set (same inputs, same masks, same silhouette).
 *
 * Geometry comes from layoutPlates(GEOMETRY_SEED) — the §15-gated layout —
 * rasterized with the same plateHit predicate as the gate, so the rendered
 * silhouette is bit-identical to geometrySilhouette(rasterizeGeometry(...))
 * at every LOD and for every variant.
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
  const seed = res.cosmeticSeed >>> 0; // material texture seed (per organism)
  const budget = lodBudget(size);
  const kind = new Uint8Array(size * size);
  const rgb = new Uint8Array(size * size * 3);
  const plates = layoutPlates(GEOMETRY_SEED);
  // Paint order matches rasterizeGeometry: layer, then table index.
  const ordered: ShellPlate[] = [...plates].sort((p, q) => p.layer - q.layer || p.index - q.index);
  const samples = ordered.map((pl) => spineSamples(pl));
  const vorSites = ordered.map((_, pi) => voronoiSites(seed, pi, 4, 3));
  // Plate-rim pixels, collected during painting: pearl slots where beads
  // may spill over shell edges.
  const rimPx: number[] = [];

  const paint = (x: number, y: number, k: number, c: RGB): void => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = y * size + x;
    kind[i] = k;
    rgb[i * 3] = c.r;
    rgb[i * 3 + 1] = c.g;
    rgb[i * 3 + 2] = c.b;
  };

  // Pearl-bed discs first: plates paint over them, exposed recess stays
  // (same bed raster as the geometry gate).
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x + 0.5) / size;
      const ny = (y + 0.5) / size;
      if (bedHit(nx, ny, BED)) paint(x, y, K_RECESS, PLATED_PALETTE.recessDeep);
    }
  }

  // Plates back-to-front (strong overlap occlusion by paint order).
  ordered.forEach((pl, pi) => {
    const shade = 0.78 + (pi / ordered.length) * 0.3;
    // Environment light direction (fixed per plate, NOT organism-seeded —
    // light is not a property of the creature). Travels down-left-ish, so
    // up/right-facing slopes highlight.
    const lightAng = Math.PI * 0.75 + (hash01(1, 4, pi) - 0.5) * 0.7;
    const lx = Math.cos(lightAng);
    const ly = Math.sin(lightAng);
    const sites = vorSites[pi]!;
    // Overlap shadow band: dark-sapphire crevice so each shell reads as
    // overlapping the shell behind it. Widest at full LOD (the reference's
    // crevices are deep), narrows at small LODs so back plate rims (and
    // their seams) survive.
    const halo = (size >= 128 ? 2 : size >= 64 ? 1.5 : 0.75) / size;

    // Bounding box of this plate (+asym shoulder +halo +1px), so the field
    // test runs only over pixels the plate can touch.
    const sm = samples[pi]!;
    let bx0 = 1, by0 = 1, bx1 = 0, by1 = 0, maxW = 0;
    for (const s of sm) {
      const w = halfWidth(pl, s.t);
      if (w > maxW) maxW = w;
      if (s.x - w < bx0) bx0 = s.x - w;
      if (s.x + w > bx1) bx1 = s.x + w;
      if (s.y - w < by0) by0 = s.y - w;
      if (s.y + w > by1) by1 = s.y + w;
    }
    const pad = maxW * 0.18 + halo + 1.5 / size;
    const x0 = Math.max(0, Math.floor((bx0 - pad) * size));
    const x1 = Math.min(size - 1, Math.ceil((bx1 + pad) * size));
    const y0 = Math.max(0, Math.floor((by0 - pad) * size));
    const y1 = Math.min(size - 1, Math.ceil((by1 + pad) * size));

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const nx = (x + 0.5) / size;
        const ny = (y + 0.5) / size;
        const h = plateHit(nx, ny, pl, sm);
        const i = y * size + x;
        if (!h.inside) {
          // Overlap shadow: cast on whatever already sits behind this plate.
          // Background is skipped, so the accepted silhouette never grows.
          if (h.d <= h.wEff + halo && kind[i] !== K_BG) {
            paint(x, y, K_RECESS, PLATED_PALETTE.recess);
          }
          continue;
        }
        // Base plate: top-light gradient, CONSTANT in M (metabolism reads as
        // interior activity, never recolor).
        const light = (0.84 + mat.topLight * (1 - ny)) * mat.base;
        let br = Math.min(255, Math.round(PLATED_PALETTE.plateDeep.r * shade * light + 8));
        let bg = Math.min(255, Math.round(PLATED_PALETTE.plateDeep.g * shade * light + 10));
        let bb = Math.min(255, Math.round(PLATED_PALETTE.plateDeep.b * shade * light + 14));
        if (mat.translucency > 0 && kind[i] !== K_BG) {
          // Translucency: the plate behind shows through this one. (Only
          // over painted pixels — water behind the silhouette stays opaque.)
          const tr = mat.translucency;
          br = Math.round(br * (1 - tr) + rgb[i * 3]! * tr);
          bg = Math.round(bg * (1 - tr) + rgb[i * 3 + 1]! * tr);
          bb = Math.round(bb * (1 - tr) + rgb[i * 3 + 2]! * tr);
        }
        paint(x, y, K_PLATE, { r: br, g: bg, b: bb });
        // Rim slots feed the pearl pass (beads spill over shell edges).
        if (h.q > 0.9) rimPx.push(i);
        if (budget.cells) {
          // Voronoi interior: nearest/second-nearest sites in plate-local
          // coordinates (u along the spine, v across it).
          const lx0 = h.t * 2 - 1;
          const ly0 = h.v;
          let best = Infinity;
          let second = Infinity;
          let bestTone = 1;
          let bestIdx = 0;
          for (let vi = 0; vi < sites.px.length; vi++) {
            const ddx = lx0 - sites.px[vi]!;
            const ddy = ly0 - sites.py[vi]!;
            const dd = ddx * ddx + ddy * ddy;
            if (dd < best) {
              second = best;
              best = dd;
              bestTone = sites.tone[vi]!;
              bestIdx = vi;
            } else if (dd < second) {
              second = dd;
            }
          }
          if (second - best < 0.024 && h.q < 0.92) {
            // Pale walls where two cells nearly tie (the reference's lit
            // cell outlines).
            const w = PLATED_PALETTE.wall;
            const ws = mat.wallStrength;
            paint(x, y, K_WALL, {
              r: Math.min(255, Math.round(w.r * ws)),
              g: Math.min(255, Math.round(w.g * ws)),
              b: Math.min(255, Math.round(w.b * ws)),
            });
          } else {
            // Cell interior: per-cell HUE (the reference's pink/teal/blue
            // cell mix — seeded, fixed per Voronoi cell), a soft dome across
            // each cell, and metabolism emission.
            const t = hash01(seed, pi, Math.floor(best * 997));
            const litAt = 0.9 - 0.75 * a;
            if (t > litAt && h.q < 0.86) {
              const hu = hash01(seed, pi, 800 + bestIdx);
              const cellC = hu > 0.78 ? PLATED_PALETTE.cellPink
                : hu > 0.52 ? PLATED_PALETTE.cellTeal
                  : PLATED_PALETTE.plateHi;
              const dome = 1 - Math.min(0.45, Math.sqrt(best) * 1.2);
              const glow = (0.5 + 0.5 * a) * bestTone * dome * (0.7 + 0.3 * mat.emission);
              paint(x, y, K_CELL, {
                r: Math.min(255, Math.round(cellC.r * glow)),
                g: Math.min(255, Math.round(cellC.g * glow)),
                b: Math.min(255, Math.round(cellC.b * glow)),
              });
              if (t > litAt + 0.05 && a > 0.3) {
                const jx = x + (hash01(seed, pi, x, y) > 0.5 ? 1 : -1);
                const jy = y + (hash01(seed, pi, y, x) > 0.5 ? 1 : -1);
                if (jx >= 0 && jy >= 0 && jx < size && jy < size) {
                  const j = jy * size + jx;
                  if (kind[j] === K_PLATE) {
                    const smc = PLATED_PALETTE.subsurface;
                    const ss = mat.subsurface;
                    paint(jx, jy, K_SUB, {
                      r: Math.min(255, Math.round(smc.r * ss)),
                      g: Math.min(255, Math.round(smc.g * ss)),
                      b: Math.min(255, Math.round(smc.b * ss)),
                    });
                  }
                }
              }
            }
          }
        }
        // Dome cap light: broad pale wash on light-facing rim slopes (the
        // reference's shell caps). Lighting sits ON TOP of the texture —
        // blend from whatever the pixel currently holds.
        const facing = Math.max(0, -(h.nx * lx + h.ny * ly));
        if (h.q > 0.5 && facing > 0.3) {
          const cap = ((h.q - 0.5) / 0.5) * facing * mat.specular * 0.7 * (0.55 + 0.45 * a);
          if (cap > 0.08) {
            const cp = Math.min(1, cap);
            paint(x, y, K_RIDGE, {
              r: Math.round(rgb[i * 3]! * (1 - cp) + PLATED_PALETTE.ridge.r * cp),
              g: Math.round(rgb[i * 3 + 1]! * (1 - cp) + PLATED_PALETTE.ridge.g * cp),
              b: Math.round(rgb[i * 3 + 2]! * (1 - cp) + PLATED_PALETTE.ridge.b * cp),
            });
          }
        }
        // Seam rim: continuity + brightness grow with M. Painted after the
        // cap so the cyan edge line survives at every LOD.
        if (budget.seams && h.q > 0.8) {
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
        // Metabolism as emission: warm glow through the exposed tips —
        // entirely M-driven (dark at M0, amber-white at M4). The accepted
        // plates have broad blunt tips, so the ramp stays tight (last 10%
        // of the spine) with a floor on brightness: falloff never lingers
        // as brown mud over half a plate.
        if (a > 0 && h.t > 0.9) {
          const tg = a * Math.min(1, (h.t - 0.9) / 0.1) * (0.5 + 0.5 * h.q) * 2;
          if (tg > 0.25) {
            const tw = Math.min(1, tg * 1.25);
            const hot = Math.max(0, tg - 0.7) / 0.3;
            paint(x, y, K_SUB, {
              r: Math.min(255, Math.round(232 * tw + 18 * hot)),
              g: Math.min(255, Math.round(176 * tw + 62 * hot)),
              b: Math.min(255, Math.round(120 * tw + 110 * hot)),
            });
          }
        }
      }
    }
  });

  // Gap-derived pearl clusters: slots are ACTUAL non-background pixels in
  // crevice priority — exposed bed discs (the declared pearl beds) first,
  // then overlap shadows, then plate rims (beads spill over shell edges) —
  // and sorted toward the two bed centers so beads cluster like the
  // reference instead of scattering. Never background, so the accepted
  // silhouette holds.
  const slotTier = new Uint8Array(size * size).fill(9);
  for (let i = 0; i < kind.length; i++) {
    if (kind[i] !== K_RECESS) continue;
    const x = i % size;
    const y = (i / size) | 0;
    slotTier[i] = bedHit((x + 0.5) / size, (y + 0.5) / size, BED) ? 0 : 1;
  }
  for (const i of rimPx) if (slotTier[i] === 9 && kind[i] !== K_BG) slotTier[i] = 2;
  const bedCenters = BED.discs.map((d) => [d.cx * size, d.cy * size] as const);
  const slotDist = (i: number): number => {
    const x = i % size;
    const y = (i / size) | 0;
    let m = Infinity;
    for (const [bx, by] of bedCenters) {
      const dd = (x - bx) * (x - bx) + (y - by) * (y - by);
      if (dd < m) m = dd;
    }
    return m;
  };
  const slots: number[] = [];
  for (let i = 0; i < slotTier.length; i++) if (slotTier[i]! < 9) slots.push(i);
  slots.sort((p, q) =>
    slotTier[p]! - slotTier[q]! ||
    slotDist(p) - slotDist(q) ||
    hash01(seed, p % size, (p / size) | 0) - hash01(seed, q % size, (q / size) | 0));
  const wantPearls = Math.min(budget.pearls, Math.round(4 + 24 * a), slots.length);
  const used = new Uint8Array(size * size);
  const centers: Array<[number, number]> = [];
  for (const i of slots) {
    if (centers.length >= wantPearls) break;
    if (used[i] === 1) continue;
    const x = i % size;
    const y = (i / size) | 0;
    centers.push([x, y]);
    // Keep beads distinct-but-touching: claim a small neighborhood per center.
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < size && ny < size) used[ny * size + nx] = 1;
      }
    }
  }
  centers.forEach(([cx, cy], k) => {
    const r = Math.max(1, Math.round(size / 40) + (k % 2));
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
        // Small top-left highlight spot (a whole bright quadrant makes the
        // bead read white instead of beige).
        const hi = dx <= 0 && dy <= 0 && !edge && dx * dx + dy * dy <= (r - 1) * (r - 1);
        const cc = hi
          ? { r: 244, g: 238, b: 222 }
          : edge
            ? { r: Math.round(col.r * 0.55), g: Math.round(col.g * 0.55), b: Math.round(col.b * 0.6) }
            : { r: Math.min(255, Math.round(col.r * pb)), g: Math.min(255, Math.round(col.g * pb)), b: Math.min(255, Math.round(col.b * pb)) };
        paint(cx + dx, cy + dy, K_PEARL, cc);
      }
    }
  });

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
