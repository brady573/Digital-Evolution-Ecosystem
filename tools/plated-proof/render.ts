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
 *   points in plate-local (u along spine, v across) coordinates, a coarse
 *   4x2 grid so compartments read as FEW, LARGE luminous cells (round 2:
 *   finer grids mottled like mineral crust). Pale walls where nearest and
 *   second-nearest seeds nearly tie — measured in PHYSICAL pixels so both
 *   the along-spine and across-spine dividers land on real pixels; compartments
 *   light WHOLE (one lit decision per Voronoi cell, not per pixel) with a soft
 *   dome and a narrow per-cell tone.
 * - Gap-derived pearls: candidate slots are ACTUAL recess/rim pixels —
 *   exposed bed discs (the declared pearl beds) first, then overlap
 *   shadows, then plate rims — sorted toward the bed centers so beads
 *   cluster like the reference, shaded as warm spheres with a dark outline
 *   so they read as a separate material family. Never background.
 * - Metabolism as interior emission: cell-compartment brightness, seam
 *   continuity, subsurface lift, and pearly warm-white tip caps (dark at
 *   M0, peach-white at M4). Plate base brightness is constant in M.
 * - Three bounded material variants over one renderer: specular (refined
 *   base) / pearlbed (same shells, emphasized beads) / clarity (calmest
 *   single-hue texture). Same inputs, same masks, same silhouette —
 *   material differs. Plate bodies stay in the cool blue/cyan family;
 *   warm tones live only in beads and tip caps.
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
  /** Overlap crease: darker than recess so shell volume reads clearly. */
  crease: { r: 5, g: 9, b: 20 },
  recessDeep: { r: 6, g: 10, b: 22 },
  plateDeep: { r: 20, g: 44, b: 104 },
  plateMid: { r: 34, g: 78, b: 156 },
  plateHi: { r: 76, g: 150, b: 236 },
  wall: { r: 150, g: 196, b: 226 },
  /**
   * Per-cell hues (round 2): plate bodies stay in the cool blue/cyan/
   * restrained-violet family — warm pink/teal greens were muddy color
   * contamination on the shell plates. Warmth lives in beads and tips.
   * All three saturated azure-grade so lit compartments glow instead of
   * tinting the shell gray.
   */
  cellCyan: { r: 74, g: 198, b: 242 },
  cellViolet: { r: 166, g: 142, b: 236 },
  pearl: { r: 234, g: 214, b: 184 },
  amber: { r: 236, g: 170, b: 108 },
  /** Warm peach bead hue (bead beds only). */
  pink: { r: 234, g: 164, b: 158 },
  seam: { r: 160, g: 220, b: 240 },
  ridge: { r: 200, g: 238, b: 250 },
  subsurface: { r: 52, g: 120, b: 200 },
  /** Tip-cap ramp (F): pearly peach-white → warm-white core. */
  tipPeach: { r: 252, g: 214, b: 188 },
  tipWhite: { r: 255, g: 250, b: 244 },
  /** Cool micro-dot (round 2: replaces warm speckle on plate bodies). */
  ice: { r: 198, g: 228, b: 246 },
};

export type MaterialVariant = "specular" | "pearlbed" | "clarity";

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
  /** Per-cell hue variety: 0 = single cool blue, 1 = blue/cyan/violet mix. */
  hueMix: number;
  /** Cool micro-dot density on plate bodies (0 = none). */
  speckle: number;
  /** Bead count multiplier (pearl-bed emphasis). */
  pearlCount: number;
  /** Bead radius multiplier. */
  pearlScale: number;
  /** Probability a bead is warm (amber/peach) vs cream. */
  beadWarm: number;
}

export const MATERIALS: Record<MaterialVariant, MaterialParams> = {
  // Specular-Refined (carried-forward base): calm cool compartments,
  // strong dome lighting, bright pearly rims, larger fewer cells.
  specular: {
    base: 1.0, topLight: 0.46, specular: 1.5, wallStrength: 0.95, emission: 1.0,
    seamBoost: 1.2, subsurface: 0.8, pearlBoost: 1.15, translucency: 0.06,
    hueMix: 1, speckle: 0.5, pearlCount: 1, pearlScale: 1, beadWarm: 0.55,
  },
  // Pearl-Bed Emphasis: identical shell treatment, denser/rounder/warmer
  // bead clusters so the interstitial material reads as its own family.
  pearlbed: {
    base: 1.0, topLight: 0.46, specular: 1.5, wallStrength: 0.95, emission: 1.0,
    seamBoost: 1.2, subsurface: 0.8, pearlBoost: 1.3, translucency: 0.06,
    hueMix: 1, speckle: 0.5, pearlCount: 1.5, pearlScale: 1.3, beadWarm: 0.75,
  },
  // Shell-Clarity: strongest plate-form readability — single-hue
  // compartments, no micro-dots, calmest walls, most controlled palette.
  clarity: {
    base: 1.04, topLight: 0.5, specular: 1.6, wallStrength: 0.78, emission: 1.0,
    seamBoost: 1.1, subsurface: 0.7, pearlBoost: 1.0, translucency: 0.05,
    hueMix: 0, speckle: 0, pearlCount: 0.8, pearlScale: 0.9, beadWarm: 0.4,
  },
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
 *
 * Round 2: the grid is deliberately coarse (4x2 = 8 compartments per
 * plate, was 4x3 = 12). Finer cells read as noisy mineral/lichen crust;
 * the reference shows fewer, larger, more luminous compartments that stay
 * subordinate to each plate's dome.
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
      // Calm tone band (round 2, A): compartments vary subtly, they don't
      // flicker between dark and bright cells.
      tone.push(0.92 + 0.16 * hash01(seed, pi, 700 + i));
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
  variant: MaterialVariant = "specular",
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
  const vorSites = ordered.map((_, pi) => voronoiSites(seed, pi, 4, 2));
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
    // Shell volume (C): wider back-to-front shade range so front shells
    // lift off the darker shells behind them.
    const shade = 0.7 + (pi / ordered.length) * 0.42;
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
          // Round 2 (C): the crease is DARKER than the exposed bed recess —
          // overlap creases must read deeper than the pearl beds.
          if (h.d <= h.wEff + halo && kind[i] !== K_BG) {
            paint(x, y, K_RECESS, PLATED_PALETTE.crease);
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
          // Pixel-per-unit for both axes, in 128-normalized px: u spans the
          // spine (pl.len), v spans the local half-width (wEff). The raw
          // (u,v) space is strongly anisotropic — a wall band measured there
          // lands ~1px along the spine but sub-pixel across it, so the
          // honeycomb loses every cross-spine divider. The wall band is
          // therefore measured in physical px below, as a fraction of the
          // gap between the two competing sites (~12% ≈ 1.3–1.6px at 128).
          const pu = pl.len * 64;
          const pv = h.wEff * 128;
          let best = Infinity;
          let second = Infinity;
          let bestTone = 1;
          let bestIdx = 0;
          let secondIdx = 0;
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
              secondIdx = vi;
            }
          }
          const gu = (sites.px[bestIdx]! - sites.px[secondIdx]!) * pu;
          const gv = (sites.py[bestIdx]! - sites.py[secondIdx]!) * pv;
          const gap2 = gu * gu + gv * gv;
          const bU = (lx0 - sites.px[bestIdx]!) * pu;
          const bV = (ly0 - sites.py[bestIdx]!) * pv;
          const sU = (lx0 - sites.px[secondIdx]!) * pu;
          const sV = (ly0 - sites.py[secondIdx]!) * pv;
          const pGap = (sU * sU + sV * sV) - (bU * bU + bV * bV);
          if (pGap < 0.12 * gap2 && h.q < 0.92) {
            // Pale walls where two cells nearly tie (the reference's lit
            // cell outlines), measured in physical pixels (see above).
            const w = PLATED_PALETTE.wall;
            const ws = mat.wallStrength;
            paint(x, y, K_WALL, {
              r: Math.min(255, Math.round(w.r * ws)),
              g: Math.min(255, Math.round(w.g * ws)),
              b: Math.min(255, Math.round(w.b * ws)),
            });
          } else {
            // Cell interior (round 2): the lit/unlit decision is PER
            // COMPARTMENT (hashed by Voronoi cell index), not per distance
            // band — distance-band hashing mottled each cell like mineral
            // crust. Whole cells now light, subordinate to the plate dome.
            const t = hash01(seed, pi, 900 + bestIdx);
            const litAt = 0.9 - 0.75 * a;
            if (t > litAt && h.q < 0.86) {
              // Hue: cool family only (D) — blue dominant, cyan, restrained
              // violet (15% of cells). warmth stays in beads/tips.
              // hueMix 0 = single blue.
              const hu = hash01(seed, pi, 800 + bestIdx);
              const cellC = mat.hueMix <= 0 ? PLATED_PALETTE.plateHi
                : hu > 0.85 ? PLATED_PALETTE.cellViolet
                  : hu > 0.68 ? PLATED_PALETTE.cellCyan
                    : PLATED_PALETTE.plateHi;
              // Strong edge falloff so compartments read as distinct
              // luminous pebbles, not soft blotches (B).
              const dome = 1 - Math.min(0.5, Math.sqrt(best) * 1.5);
              // Luminous compartment (B): brighter floor than round 1 so
              // lit cells glow instead of tinting.
              const glow = (0.58 + 0.62 * a) * bestTone * dome * (0.75 + 0.25 * mat.emission);
              // Luminous core: cell centers catch a white-hot lift that
              // grows with M — the reference's sparkle. Color only (K_CELL).
              const core = Math.max(0, Math.min(0.5, (glow - 0.85) * 1.1 + (dome - 0.8) * 0.6));
              const cr = Math.min(255, Math.round(cellC.r * glow + (240 - cellC.r * glow) * core));
              const cg = Math.min(255, Math.round(cellC.g * glow + (246 - cellC.g * glow) * core));
              const cb = Math.min(255, Math.round(cellC.b * glow + (252 - cellC.b * glow) * core));
              paint(x, y, K_CELL, { r: cr, g: cg, b: cb });
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
            } else if (h.q < 0.9) {
              // Calm unlit compartment (B): darker than the shell base so
              // every compartment reads as clear structure, without
              // competing with the lit ones. Kind stays K_PLATE — color
              // only, zero metric effect.
              const k = 0.78;
              paint(x, y, K_PLATE, {
                r: Math.round(rgb[i * 3]! * k),
                g: Math.round(rgb[i * 3 + 1]! * k),
                b: Math.round(rgb[i * 3 + 2]! * k),
              });
            }
          }
        }
        // Dome cap light (round 2, C): a pale wash on light-facing rim
        // slopes — the reference's shell caps. Narrower and capped at 60%
        // blend so compartment texture survives under it: volume reads
        // first, texture stays visible. Lighting sits ON TOP of the
        // texture — blend from whatever the pixel currently holds.
        const facing = Math.max(0, -(h.nx * lx + h.ny * ly));
        if (h.q > 0.5 && facing > 0.3) {
          // Threshold on the M-free part so WHICH pixels the cap covers is
          // constant in M (it overwrites counted cell pixels — an M-dependent
          // set could eat metric at higher M); M only varies the blend.
          const capBase = ((h.q - 0.5) / 0.5) * facing * mat.specular * 0.85;
          if (capBase > 0.08) {
            const cp = Math.min(0.6, capBase * (0.78 + 0.22 * a));
            paint(x, y, K_RIDGE, {
              r: Math.round(rgb[i * 3]! * (1 - cp) + PLATED_PALETTE.ridge.r * cp),
              g: Math.round(rgb[i * 3 + 1]! * (1 - cp) + PLATED_PALETTE.ridge.g * cp),
              b: Math.round(rgb[i * 3 + 2]! * (1 - cp) + PLATED_PALETTE.ridge.b * cp),
            });
          }
        }
        // Rim whitening (C): a clean pale lip at the very edge of every
        // light-facing shell, independent of seam continuity.
        if (h.q > 0.93 && facing > 0.12) {
          const rw = Math.min(0.85, (h.q - 0.93) / 0.07) * (0.6 + 0.4 * mat.specular / 1.6);
          paint(x, y, K_RIDGE, {
            r: Math.round(rgb[i * 3]! * (1 - rw) + PLATED_PALETTE.ridge.r * rw),
            g: Math.round(rgb[i * 3 + 1]! * (1 - rw) + PLATED_PALETTE.ridge.g * rw),
            b: Math.round(rgb[i * 3 + 2]! * (1 - rw) + PLATED_PALETTE.ridge.b * rw),
          });
        }
        // Seam rim: continuity + brightness grow with M. Painted after the
        // cap so the cyan edge line survives at every LOD.
        if (budget.seams && h.q > 0.8) {
          const order = hash01(seed, pi, x, y);
          // Continuity grows strictly with M: 0.25 at M0 (dim rims) to 0.95
          // at M4 (near-complete lip). The slope matters for the 16px
          // ladder: a higher baseline saturates the tiny rim band before
          // M4 and leaves the top step with nothing to gain.
          if (order < 0.25 + 0.7 * a) {
            const sb = (0.35 + 0.65 * a) * mat.seamBoost;
            paint(x, y, K_SEAM, {
              r: Math.min(255, Math.round(PLATED_PALETTE.seam.r * sb)),
              g: Math.min(255, Math.round(PLATED_PALETTE.seam.g * sb)),
              b: Math.min(255, Math.round(PLATED_PALETTE.seam.b * sb)),
            });
          }
        }
        // Metabolism as emission (round 2, F): warm tip caps are PEACH-
        // WHITE with a luminous GRADIENT — the pixel blends from the plate
        // color up through peach into a warm-white core. Round 1 scaled the
        // color (mid-glow = brown); the first round-2 pass painted an
        // opaque floor (mid-glow = chalk block). Blend-from-plate keeps
        // falloff at the zone edge. Fully M-driven: no glow at M0, warm-
        // white core at M4. The ramp stays tight (last 10% of the spine)
        // over the accepted broad blunt tips.
        if (a > 0 && h.t > 0.9) {
          const tg = a * Math.min(1, (h.t - 0.9) / 0.1) * (0.5 + 0.5 * h.q) * 2;
          if (tg > 0.2) {
            const st = Math.min(1, tg * 1.1);
            const hot = Math.max(0, Math.min(1, (tg - 0.65) / 0.35));
            const peach = PLATED_PALETTE.tipPeach;
            const white = PLATED_PALETTE.tipWhite;
            const pr = rgb[i * 3]! * (1 - st) + peach.r * st;
            const pg = rgb[i * 3 + 1]! * (1 - st) + peach.g * st;
            const pb = rgb[i * 3 + 2]! * (1 - st) + peach.b * st;
            const hw = hot * 0.65;
            paint(x, y, K_SUB, {
              r: Math.min(255, Math.round(pr + (white.r - pr) * hw)),
              g: Math.min(255, Math.round(pg + (white.g - pg) * hw)),
              b: Math.min(255, Math.round(pb + (white.b - pb) * hw)),
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
  const wantPearls = Math.min(
    Math.round(budget.pearls * mat.pearlCount),
    Math.round((4 + 24 * a) * mat.pearlCount),
    slots.length,
  );
  // Claim radius tracks the variant's bead size so larger beads still read
  // as discrete (touching at most) rather than overlapping into a blob.
  const claimR = Math.max(2, Math.round((size / 40) * mat.pearlScale)) + 1;
  const used = new Uint8Array(size * size);
  const centers: Array<[number, number]> = [];
  for (const i of slots) {
    if (centers.length >= wantPearls) break;
    if (used[i] === 1) continue;
    const x = i % size;
    const y = (i / size) | 0;
    centers.push([x, y]);
    // Keep beads distinct-but-touching: claim a neighborhood per center.
    for (let dy = -claimR; dy <= claimR; dy++) {
      for (let dx = -claimR; dx <= claimR; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < size && ny < size) used[ny * size + nx] = 1;
      }
    }
  }
  // Spherical bead shading (round 2, E): normal-based diffuse from the
  // fixed top-left light + a tight specular glint + a dark outline ring,
  // so beads read as discrete ROUND warm spheres nested between shells —
  // clearly a different material family from the flat cool plate cells.
  // Footprint and count scale with the variant's pearl params; never
  // background, so the accepted silhouette holds.
  centers.forEach(([cx, cy], k) => {
    const r = Math.max(1, Math.round((size / 40) * mat.pearlScale) + (k % 2));
    const warmPick = hash01(seed, 780, k);
    const col = warmPick < mat.beadWarm * 0.55 ? PLATED_PALETTE.amber
      : warmPick < mat.beadWarm ? PLATED_PALETTE.pink
        : PLATED_PALETTE.pearl;
    const pb = mat.pearlBoost;
    const r2 = r * r;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        if (cx + dx < 0 || cy + dy < 0 || cx + dx >= size || cy + dy >= size) continue;
        const i = (cy + dy) * size + (cx + dx);
        if (kind[i] === K_BG) continue;
        const nd = Math.sqrt(d2 / r2); // 0 center .. 1 rim
        const nz = Math.sqrt(Math.max(0, 1 - nd * nd));
        // Diffuse from the fixed top-left environment light.
        const diff = Math.max(0, (-dx * 0.6 - dy * 0.6 + nz * r * 0.53) / r);
        const shade = 0.56 + 0.62 * diff;
        let cr = col.r * shade * pb;
        let cg = col.g * shade * pb;
        let cb = col.b * shade * pb;
        // Specular glint: tight top-left pearl luster.
        const glint = Math.max(0, diff - 0.64) / 0.36;
        if (glint > 0 && nd < 0.7) {
          cr += (250 - cr) * glint;
          cg += (246 - cg) * glint;
          cb += (234 - cb) * glint;
        }
        // Dark outline ring: discrete against the plate.
        if (nd > 0.86) {
          const ow = (nd - 0.86) / 0.14;
          cr *= 1 - 0.62 * ow;
          cg *= 1 - 0.66 * ow;
          cb *= 1 - 0.6 * ow;
        }
        paint(cx + dx, cy + dy, K_PEARL, {
          r: Math.min(255, Math.round(cr)),
          g: Math.min(255, Math.round(cg)),
          b: Math.min(255, Math.round(cb)),
        });
      }
    }
  });

  // Sparse embedded micro-dots (round 2, D: COOL ice, not warm cream —
  // warm speckle contaminated the plate bodies; density scales with the
  // variant, off entirely for the calmest variant).
  if (budget.speckle && mat.speckle > 0) {
    const speckN = Math.round(size * (0.05 + 0.08 * a) * mat.speckle);
    for (let s = 0; s < speckN; s++) {
      const x = Math.floor(hash01(seed, 999, s) * size);
      const y = Math.floor(hash01(seed, 998, s) * size);
      const i = y * size + x;
      if (kind[i] === K_PLATE) paint(x, y, K_PLATE, PLATED_PALETTE.ice);
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
