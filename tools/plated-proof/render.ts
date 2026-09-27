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
 *   3x2 grid so compartments read as FEW, LARGE luminous cells (round 5:
 *   §16 calibration shows ~4-7 broad compartments per dominant plate). Pale walls where nearest and
 *   second-nearest seeds nearly tie — measured in PHYSICAL pixels so both
 *   the along-spine and across-spine dividers land on real pixels; compartments
 *   light WHOLE (one lit decision per Voronoi cell, not per pixel) with a soft
 *   dome and a narrow per-cell tone.
 * - Gap-derived pearls: candidate slots are ACTUAL recess pixels —
 *   exposed bed discs (the declared pearl beds) first, then overlap
 *   shadows all around the cluster in hash-scatter order — painted in
 *   two layers (deep beads pre-plates for real occlusion, shallow beads
 *   post-plates nested between shells), shaded as warm spheres with a
 *   dark outline so they read as a separate material family. Never
 *   background.
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
  plateDeep: { r: 16, g: 40, b: 112 },
  plateMid: { r: 34, g: 78, b: 156 },
  plateHi: { r: 76, g: 150, b: 236 },
  wall: { r: 150, g: 196, b: 226 },
  /**
   * Wall endpoints (round 4): boundaries read dark cyan when inactive and
   * brighten toward pearl-white with M. Color only (K_WALL) — the SET is
   * M-independent, so metabolism brightens the network without moving it.
   */
  wallDark: { r: 38, g: 115, b: 190 },
  wallBright: { r: 170, g: 255, b: 255 },
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
  /**
   * Cool bead family (round 4): the interstitial core is 60–75% cool —
   * dark sapphire, cobalt, cyan, violet — with warm peach/cream as
   * accents. Pick share derives from the variant's beadWarm so warmer
   * variants stay warmer.
   */
  beadSapphire: { r: 36, g: 70, b: 156 },
  beadCobalt: { r: 46, g: 112, b: 216 },
  beadCyan: { r: 98, g: 208, b: 244 },
  beadViolet: { r: 148, g: 128, b: 228 },
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
  // Specular-Refined (carried-forward base; round 6: smaller beads,
  // brighter top light for luminous cobalt masses).
  specular: {
    base: 1.0, topLight: 0.5, specular: 1.5, wallStrength: 0.95, emission: 1.0,
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
 * Round 5 (§16): the grid is 3x2 = 6 broad compartments per plate —
 * fewer, larger pixel clusters and clearer plate-cell structure at
 * gameplay scale.
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
  const vorSites = ordered.map((_, pi) => voronoiSites(seed, pi, 3, 2));
  // Bead claim radius tracks the variant's bead size so beads read as
  // discrete (touching at most) rather than overlapping into a blob.
  // M-independent (variant params only).
  const claimR = Math.max(2, Math.round((size / 40) * mat.pearlScale)) + 1;

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

  // Shared spherical bead painter (round 2 shading, round 3 layering):
  // normal-based diffuse from the fixed top-left light + a tight specular
  // glint + a dark outline ring, so beads read as discrete ROUND warm
  // spheres nested between shells. Never background, so the accepted
  // silhouette holds. Fully deterministic in (seed, cx, cy, k).
  const paintBead = (cx: number, cy: number, k: number): void => {
    // Three bead sizes (round 4: 2–4px radius at 128) instead of two.
    const r = Math.max(1, Math.round((size / 40) * mat.pearlScale) + (k % 3) - 1);
    // Cool-majority core (round 5, §16: ~70% cool for specular —
    // sapphire, cobalt, cyan, violet — warm peach/cream as visible
    // accents). Separate hash per decision.
    const coolFrac = 1 - mat.beadWarm * 0.55;
    const coolPick = hash01(seed, 781, k);
    let col: RGB;
    if (coolPick < coolFrac) {
      // Round 6: violet secondary even among cool beads (12%).
      const sub = hash01(seed, 782, k);
      col = sub < 0.32 ? PLATED_PALETTE.beadSapphire
        : sub < 0.62 ? PLATED_PALETTE.beadCobalt
          : sub < 0.88 ? PLATED_PALETTE.beadCyan
            : PLATED_PALETTE.beadViolet;
    } else {
      const warmPick = hash01(seed, 780, k);
      col = warmPick < mat.beadWarm * 0.55 ? PLATED_PALETTE.amber
        : warmPick < mat.beadWarm ? PLATED_PALETTE.pink
          : PLATED_PALETTE.pearl;
    }
    if (k % 3 === 0 && coolPick >= coolFrac) {
      // Smallest beads read as dark depth (round 6): cobalt/violet,
      // never bright warm.
      col = hash01(seed, 783, k) < 0.5 ? PLATED_PALETTE.beadCobalt : PLATED_PALETTE.beadViolet;
    }
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
  };

  // Deep bead layer (round 3; round 4 raises the share to ~40%): part of
  // the M-gated bead count is placed on the bed-disc pixels BEFORE the
  // partially occlude them — beads packed INTO the volume at different
  // depths instead of a front necklace laid over it. Bed-disc pixels are
  // already non-background, so the silhouette mask cannot change. The
  // pool order is a seeded hash (M-independent); M gates only the count.
  const discPool: number[] = [];
  for (let i = 0; i < size * size; i++) if (kind[i] === K_RECESS) discPool.push(i);
  discPool.sort((p, q) =>
    hash01(seed, 6000 + p, 8000 + ((p / size) | 0)) - hash01(seed, 6000 + q, 8000 + ((q / size) | 0)));
  const deepWant = Math.min(discPool.length, Math.round((4 + 24 * a) * mat.pearlCount * 0.5));
  const deepUsed = new Uint8Array(size * size);
  let deepPlaced = 0;
  for (const idx of discPool) {
    if (deepPlaced >= deepWant) break;
    if (deepUsed[idx] === 1) continue;
    paintBead(idx % size, (idx / size) | 0, deepPlaced);
    deepPlaced++;
    const ex = idx % size;
    const ey = (idx / size) | 0;
    for (let dy = -claimR; dy <= claimR; dy++) {
      for (let dx = -claimR; dx <= claimR; dx++) {
        const nx = ex + dx;
        const ny = ey + dy;
        if (nx >= 0 && ny >= 0 && nx < size && ny < size) deepUsed[ny * size + nx] = 1;
      }
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
        // Base plate (round 3: shell-curvature gradient): dark-to-cobalt-
        // to-cyan across the plate radius q — deep rim curve, saturated
        // cobalt mid, cyan rise toward the dome — CONSTANT in M
        // (metabolism reads as interior activity, never recolor).
        const light = (0.84 + mat.topLight * (1 - ny)) * mat.base;
        const qDark = 1 - 0.38 * Math.min(1, Math.max(0, (h.q - 0.55) / 0.45));
        const qMid = 1 + 0.22 * Math.sin(Math.min(1, Math.max(0, h.q / 0.9)) * Math.PI);
        const qCyan = 0.95 + 0.25 * (1 - qDark);
        let br = Math.min(255, Math.round(PLATED_PALETTE.plateDeep.r * shade * light * qDark * qMid));
        let bg = Math.min(255, Math.round(PLATED_PALETTE.plateDeep.g * shade * light * qDark * (0.9 + 0.1 * qMid)));
        let bb = Math.min(255, Math.round(PLATED_PALETTE.plateDeep.b * shade * light * qCyan));
        if (mat.translucency > 0 && kind[i] !== K_BG) {
          // Translucency: the plate behind shows through this one. (Only
          // over painted pixels — water behind the silhouette stays opaque.)
          const tr = mat.translucency;
          br = Math.round(br * (1 - tr) + rgb[i * 3]! * tr);
          bg = Math.round(bg * (1 - tr) + rgb[i * 3 + 1]! * tr);
          bb = Math.round(bb * (1 - tr) + rgb[i * 3 + 2]! * tr);
        }
        paint(x, y, K_PLATE, { r: br, g: bg, b: bb });
        if (budget.cells) {
          // Voronoi interior: nearest/second-nearest sites in plate-local
          // coordinates (u along the spine, v across it).
          const lx0 = h.t * 2 - 1;
          const ly0 = h.v;
          // Cell ownership uses the original plate-local Voronoi metric.
          // Convert distance to its bisector to output pixels below; mixing
          // a physical-distance wall with these plate-local winners can
          // produce negative gaps and flood the wrong compartment.
          const pu = pl.len * size / 2;
          const pv = h.wEff * size;
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
          const du = sites.px[bestIdx]! - sites.px[secondIdx]!;
          const dv = sites.py[bestIdx]! - sites.py[secondIdx]!;
          // The gradient of (second-best) in screen pixels has length
          // 2*hypot(du/pu,dv/pv). This converts the plate-local bisector's
          // signed distance to a stable output-pixel width at every LOD.
          const gradient = 2 * Math.hypot(du / pu, dv / pv);
          const distancePx = gradient > 0 ? (second - best) / gradient : Infinity;
          const wallPx = size >= 128 ? 0.55 : size >= 64 ? 0.45 : 0.4;
          if (distancePx < wallPx && h.q < 0.97) {
            // Cell walls (round 6): the polygonal network is PERSISTENT
            // material structure — the set never depends on M — while
            // metabolism drives its intensity. At M2 walls read cyan /
            // icy-blue, never near-white; pearl-white arrives only at
            // high M. The wall occupies a fixed physical-pixel band.
            const wb = 0.25 + 0.5 * a;
            const ws = mat.wallStrength;
            paint(x, y, K_WALL, {
              r: Math.min(255, Math.round((PLATED_PALETTE.wallDark.r + (PLATED_PALETTE.wallBright.r - PLATED_PALETTE.wallDark.r) * wb) * ws)),
              g: Math.min(255, Math.round((PLATED_PALETTE.wallDark.g + (PLATED_PALETTE.wallBright.g - PLATED_PALETTE.wallDark.g) * wb) * ws)),
              b: Math.min(255, Math.round((PLATED_PALETTE.wallDark.b + (PLATED_PALETTE.wallBright.b - PLATED_PALETTE.wallDark.b) * wb) * ws)),
            });
          } else {
            // Cell interior (round 2): the lit/unlit decision is PER
            // COMPARTMENT (hashed by Voronoi cell index), not per distance
            // band — distance-band hashing mottled each cell like mineral
            // crust. Whole cells now light, subordinate to the plate dome.
            const t = hash01(seed, pi, 900 + bestIdx);
            // Round 3: lower threshold so compartments occupy substantial
            // plate area at the M2 center state (~70% of cells lit at
            // a=0.5) while the lit SET still grows strictly with M.
            const litAt = 0.82 - 0.62 * a;
            if (t > litAt && h.q < 0.86) {
              // Hue: cool family only (D) — blue dominant, cyan, restrained
              // violet (15% of cells). warmth stays in beads/tips.
              // hueMix 0 = single blue.
              const hu = hash01(seed, pi, 800 + bestIdx);
              // Round 6: violet is secondary — ~1% of lit cells everywhere
              // (a rear-plate cell still slipped a loud violet mass into
              // the bright center). Violet survives in beads and unlit
              // shadow tint; foreground stays cobalt/navy.
              const violetCut = 0.99;
              const cellC = mat.hueMix <= 0 ? PLATED_PALETTE.plateHi
                : hu > violetCut ? PLATED_PALETTE.cellViolet
                  : hu > 0.68 ? PLATED_PALETTE.cellCyan
                    : PLATED_PALETTE.plateHi;
              // Quantized dome (round 6): deep / mid / highlight bands —
              // crisp pixel clusters, never a soft radial bloom. The deep
              // band doubles as a dark moat that keeps walls authoritative.
              let dome = 1 - Math.min(0.55, Math.sqrt(best) * 1.7);
              dome = dome > 0.85 ? 1 : dome > 0.62 ? 0.8 : 0.55;
              // Luminous compartment: brighter floor so lit cells hold
              // against the deeper shell (§16: luminous cobalt masses).
              const glow = (0.72 + 0.68 * a) * bestTone * dome * (0.8 + 0.2 * mat.emission);
              // Tiny specular (round 6): binary hot point at bright cell
              // centers instead of a soft white wash. Color only (K_CELL).
              const core = glow > 0.95 && dome >= 0.8 ? 0.35 : 0;
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
            } else if (h.q < 0.92) {
              // Unlit compartment (round 4): persistent honeycomb structure
              // even at M0 — deeper dome modeling than round 3 plus a
              // violet shadow shift (violet lives in transitional areas).
              // Kind stays K_PLATE — color only, zero metric effect.
              let ud = 1 - Math.min(0.55, Math.sqrt(best) * 1.7);
              ud = ud > 0.85 ? 1 : ud > 0.62 ? 0.8 : 0.55;
              const k = 0.58 + 0.22 * ud;
              paint(x, y, K_PLATE, {
                r: Math.round(rgb[i * 3]! * k * 0.94),
                g: Math.round(rgb[i * 3 + 1]! * k * 0.9),
                b: Math.round(rgb[i * 3 + 2]! * k),
              });
            }
          }
        }
        // Dome cap light (round 2, C; round 3 narrows it, round 4 tightens
        // again): pale wash only on strongly light-facing rim slopes.
        // Capped at 35% blend so broad milky caps never return; compartment
        // texture dominates the plate. Lighting sits ON TOP of the
        // texture — blend from whatever the pixel currently holds.
        const facing = Math.max(0, -(h.nx * lx + h.ny * ly));
        if (h.q > 0.55 && facing > 0.45) {
          // Threshold on the M-free part so WHICH pixels the cap covers is
          // constant in M (it overwrites counted cell pixels — an M-dependent
          // set could eat metric at higher M); M only varies the blend.
          const capBase = ((h.q - 0.55) / 0.45) * facing * mat.specular * 0.6;
          // Round 6: never wash over wall pixels — the cell network must
          // stay continuous loops. Skipped set is M-independent (wall set
          // is), so the cap set stays M-independent.
          if (capBase > 0.08 && kind[i] !== K_WALL) {
            const cp = Math.min(0.35, capBase * (0.78 + 0.22 * a));
            paint(x, y, K_RIDGE, {
              r: Math.round(rgb[i * 3]! * (1 - cp) + PLATED_PALETTE.ridge.r * cp),
              g: Math.round(rgb[i * 3 + 1]! * (1 - cp) + PLATED_PALETTE.ridge.g * cp),
              b: Math.round(rgb[i * 3 + 2]! * (1 - cp) + PLATED_PALETTE.ridge.b * cp),
            });
          }
        }
        // Wet specular hits (round 3; round 4: sparser and brighter —
        // very bright points, never broad milk). Tight zone thresholded
        // on the M-free part so the SET is constant in M; M only varies
        // the blend. Sparse by hash. K_RIDGE, color only.
        if (h.q > 0.55 && h.q < 0.8 && facing > 0.6) {
          const wetGate = hash01(seed, pi, x * 3 + 1, y * 3 + 2);
          const wetBase = ((0.8 - h.q) / 0.25) * ((h.q - 0.55) / 0.25) * ((facing - 0.6) / 0.4) * mat.specular * 0.9;
          if (wetBase > 0.3 && wetGate > 0.82 && kind[i] !== K_WALL) {
            const wp = Math.min(1, wetBase * (0.8 + 0.2 * a));
            paint(x, y, K_RIDGE, {
              r: Math.round(rgb[i * 3]! * (1 - wp) + 250 * wp),
              g: Math.round(rgb[i * 3 + 1]! * (1 - wp) + 252 * wp),
              b: Math.round(rgb[i * 3 + 2]! * (1 - wp) + 255 * wp),
            });
          }
        }
        // Rim (round 4): a narrow cool icy lip at the very shell edge —
        // pearl-white but thin, never a broad milky cap.
        if (h.q > 0.95 && facing > 0.12 && kind[i] !== K_WALL) {
          const rw = Math.min(0.7, (h.q - 0.95) / 0.05) * (0.6 + 0.4 * mat.specular / 1.6);
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
          if (order < 0.25 + 0.7 * a && kind[i] !== K_WALL) {
            const sb = (0.35 + 0.65 * a) * mat.seamBoost;
            paint(x, y, K_SEAM, {
              r: Math.min(255, Math.round(PLATED_PALETTE.seam.r * sb)),
              g: Math.min(255, Math.round(PLATED_PALETTE.seam.g * sb)),
              b: Math.min(255, Math.round(PLATED_PALETTE.seam.b * sb)),
            });
          }
        }
        // Metabolism as emission (round 6, §16): peach-white reserved
        // for the last few distal pixels only (~6% of the spine —
        // roughly half the round-5 area). Most rims read cool cyan /
        // icy blue. Intensifies with M.
        if (a > 0 && h.t > 0.94 && kind[i] !== K_WALL) {
          const tg = a * Math.min(1, (h.t - 0.94) / 0.06) * (0.5 + 0.5 * h.q) * 2;
          if (tg > 0.22) {
            const st = Math.min(1, tg * 1.1) * 0.8;
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

  // Shallow bead layer (round 3): the rest of the M-gated bead count goes
  // onto the residual recess pixels (bed remnants + overlap creases all
  // around the cluster) AFTER the plates — nested between shells. Round 3
  // drops the rim spill (it drew the front necklace along shell edges)
  // and the pull toward the two bed discs (they sit low/front); order is
  // bed-tier first, then a spatial-hash scatter so beads spread through
  // EVERY crevice — center, sides, rear, lower recesses. Never
  // background, so the accepted silhouette holds. Slot ORDER is
  // M-independent; M gates only the count (minus the deep-placed share,
  // keeping the round-2 total envelope).
  const slotTier = new Uint8Array(size * size).fill(9);
  for (let i = 0; i < kind.length; i++) {
    if (kind[i] !== K_RECESS) continue;
    const x = i % size;
    const y = (i / size) | 0;
    slotTier[i] = bedHit((x + 0.5) / size, (y + 0.5) / size, BED) ? 0 : 1;
  }
  const slots: number[] = [];
  // Round 4: enclosed-gap bias — reject slot pixels within bgMargin of
  // the outer silhouette (≈5px at 128, scaled with LOD), so beads pack
  // inside cavities instead of sitting on outer contours. M-independent
  // filter; M gates only the count.
  const bgMargin = Math.max(1, Math.round((size * 5) / 128));
  const enclosed = (p: number): boolean => {
    const px = p % size;
    const py = (p / size) | 0;
    // Round 6: stronger margin along the top outer silhouette — beads
    // must not sit visibly on upper edges.
    const R = py < size * 0.45 ? bgMargin + 3 : bgMargin;
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const nx = px + dx;
        const ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) return false;
        if (kind[ny * size + nx] === K_BG) return false;
      }
    }
    return true;
  };
  for (let i = 0; i < slotTier.length; i++) {
    if (slotTier[i]! < 9 && enclosed(i)) slots.push(i);
  }
  const pearlOrder = (p: number): number =>
    slotTier[p]! * 0.13 + hash01(seed, 5000 + p, 7000 + ((p / size) | 0));
  slots.sort((p, q) => pearlOrder(p) - pearlOrder(q));
  const shallowWant = Math.min(
    Math.round(budget.pearls * mat.pearlCount) - deepPlaced,
    Math.max(0, Math.round((4 + 24 * a) * mat.pearlCount) - deepPlaced),
    slots.length,
  );
  const used = new Uint8Array(size * size);
  let shallowPlaced = 0;
  for (const i of slots) {
    if (shallowPlaced >= shallowWant) break;
    if (used[i] === 1) continue;
    const kk = deepPlaced + shallowPlaced;
    // Round 6: large beads belong in major cavities (bed tier) — reject
    // most large placements elsewhere so the core reads packed, not jeweled.
    if (kk % 3 === 2 && slotTier[i] !== 0 && hash01(seed, 940, kk) < 0.7) continue;
    const x = i % size;
    const y = (i / size) | 0;
    paintBead(x, y, kk);
    shallowPlaced++;
    // Keep beads distinct-but-touching: claim a neighborhood per center.
    for (let dy = -claimR; dy <= claimR; dy++) {
      for (let dx = -claimR; dx <= claimR; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < size && ny < size) used[ny * size + nx] = 1;
      }
    }
  }
  // (Bead pixels are painted by paintBead above — deep layer pre-plates,
  // shallow layer in the slot loop just above.)

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
