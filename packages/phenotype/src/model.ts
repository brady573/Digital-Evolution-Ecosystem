/**
 * Lane 2 M4B phenotype model: stable trait normalization, presentation axes,
 * attractor distances, family resolution with hysteresis, geometry
 * quantization, and deterministic cosmetic seeding.
 *
 * LOD-independent: resolvePhenotype() returns the full resolved description;
 * the renderer (renderer.ts) maps it to a zoom-tier grid. Presentation only:
 * nothing here reads or writes simulation state, consumes simulation RNG, or
 * depends on population context.
 *
 * Lineage continuity strategy (Phase 1): deterministic reconstruction. A
 * descendant inherits its parent's current visual family by default and only
 * transitions under hysteresis, so save/load and replay reproduce the same
 * family and quantized morphology as long as the same absolute traits and the
 * same parent family are supplied. No persistence contract changes in Phase 1;
 * Phase 3 integration looks up the parent family from the live snapshot
 * (falling back to founder resolution for orphans).
 */

import {
  AXIS_WEIGHTS,
  FAMILY_CENTERS,
  FAMILY_ORDER,
  HYSTERESIS_MIN_IMPROVEMENT,
  HYSTERESIS_RATIO,
  LOD_GRID_SIZE,
  QUANT_LEVELS,
  SIGNED_NEUTRAL_EPS,
  SPECIALIZATION_WEIGHTS,
  TRAIT_RANGES,
  type LodTier,
  type PhenotypeFamily,
} from "./constants";

export type { LodTier, PhenotypeFamily };

/** Absolute simulated traits consumed by the phenotype model. */
export interface TraitSample {
  readonly speed: number;
  readonly sensing: number;
  readonly metabolism: number;
  readonly reproduction: number;
  readonly diet: number;
  readonly habitat: number;
  readonly byproductUse: number;
  readonly dormancyResponse: number;
}

/** Four normalized presentation axes, each 0..1. */
export interface PhenotypeAxes {
  readonly mobility: number;
  readonly sensing: number;
  readonly metabolism: number;
  readonly specialization: number;
}

/** Quantized major geometry parameters. Each is one of QUANT_LEVELS states. */
export interface QuantizedGeometry {
  /** Speed-driven elongation / locomotor prominence. */
  readonly elongation: number;
  /** Sensing-driven projection reach / prominence. */
  readonly projection: number;
  /** Metabolism-driven visual density. */
  readonly density: number;
  /** Specialization-driven asymmetry strength. */
  readonly asymmetry: number;
  /** Byproduct-driven secondary structures / internal accents. */
  readonly secondary: number;
  /** Reproduction-threshold-driven bulk (modest mass influence only). */
  readonly bulk: number;
}

/**
 * LOD-independent resolved phenotype description. JSON-serializable; same
 * relevant state/history always produces the same description (AC11).
 */
export interface ResolvedPhenotype {
  readonly family: PhenotypeFamily;
  readonly founder: boolean;
  readonly axes: PhenotypeAxes;
  /** Signed diet in [-1, 1]: direction/asymmetry/patterning only. */
  readonly dietSigned: number;
  /** Signed habitat in [-1, 1]: distribution/asymmetry/patterning only. */
  readonly habitatSigned: number;
  /** Normalized reproduction threshold 0..1 (modest proportion use). */
  readonly reproductionNorm: number;
  /** Normalized dormancy response 0..1 (dormant transform strength). */
  readonly dormancyNorm: number;
  readonly quantized: QuantizedGeometry;
  /**
   * Deterministic cosmetic seed (uint32). Identity may contribute ONLY bounded
   * cosmetic variation (markings, phase, secondary pixel placement) — never
   * family or major morphology.
   */
  readonly cosmeticSeed: number;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function clampSigned(v: number): number {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

/** Normalize an unsigned trait from its stable supported range to 0..1. */
export function normalizeTrait(value: number, lo: number, hi: number): number {
  return clamp01((value - lo) / (hi - lo));
}

/**
 * Normalize a signed trait (diet/habitat, range [-halfRange, halfRange]) to
 * [-1, 1]. Only specialization strength uses the magnitude; direction stays
 * available for within-family asymmetry and patterning.
 */
export function normalizeSignedTrait(value: number, halfRange: number): number {
  return clampSigned(value / halfRange);
}

/**
 * Prototype resource-specialization baseline:
 * 0.45 * |signed diet| + 0.30 * |signed habitat| + 0.25 * normalized byproduct.
 */
export function deriveSpecialization(dietSigned: number, habitatSigned: number, byproductNorm: number): number {
  return clamp01(
    SPECIALIZATION_WEIGHTS.diet * Math.abs(dietSigned) +
      SPECIALIZATION_WEIGHTS.habitat * Math.abs(habitatSigned) +
      SPECIALIZATION_WEIGHTS.byproduct * byproductNorm,
  );
}

/** Map absolute traits onto the four normalized presentation axes. */
export function deriveAxes(t: TraitSample): PhenotypeAxes {
  const dietSigned = normalizeSignedTrait(t.diet, 1.5);
  const habitatSigned = normalizeSignedTrait(t.habitat, 1.5);
  const byproductNorm = normalizeTrait(t.byproductUse, TRAIT_RANGES.byproductUse[0], TRAIT_RANGES.byproductUse[1]);
  return {
    mobility: normalizeTrait(t.speed, TRAIT_RANGES.speed[0], TRAIT_RANGES.speed[1]),
    sensing: normalizeTrait(t.sensing, TRAIT_RANGES.sensing[0], TRAIT_RANGES.sensing[1]),
    metabolism: normalizeTrait(t.metabolism, TRAIT_RANGES.metabolism[0], TRAIT_RANGES.metabolism[1]),
    specialization: deriveSpecialization(dietSigned, habitatSigned, byproductNorm),
  };
}

/** Prototype weighted squared distance from axes to a family attractor. */
export function attractorDistance(
  axes: PhenotypeAxes,
  center: readonly [number, number, number, number],
): number {
  const dm = axes.mobility - center[0];
  const ds = axes.sensing - center[1];
  const db = axes.metabolism - center[2];
  const dp = axes.specialization - center[3];
  return (
    AXIS_WEIGHTS.mobility * dm * dm +
    AXIS_WEIGHTS.sensing * ds * ds +
    AXIS_WEIGHTS.metabolism * db * db +
    AXIS_WEIGHTS.specialization * dp * dp
  );
}

export function distancesToAll(axes: PhenotypeAxes): Record<PhenotypeFamily, number> {
  return {
    blob: attractorDistance(axes, FAMILY_CENTERS.blob),
    segmented: attractorDistance(axes, FAMILY_CENTERS.segmented),
    radial: attractorDistance(axes, FAMILY_CENTERS.radial),
    plated: attractorDistance(axes, FAMILY_CENTERS.plated),
    branching: attractorDistance(axes, FAMILY_CENTERS.branching),
    paddled: attractorDistance(axes, FAMILY_CENTERS.paddled),
  };
}

/**
 * Founder resolution: nearest attractor in phenotype space. No privileged
 * default family — Blob is one generalist attractor among six. Exact ties
 * (measure-zero) break by fixed family order so output stays deterministic.
 */
export function resolveFounderFamily(axes: PhenotypeAxes): PhenotypeFamily {
  const d = distancesToAll(axes);
  let best: PhenotypeFamily = FAMILY_ORDER[0]!;
  let bestD = d[best]!;
  for (const f of FAMILY_ORDER) {
    if (d[f]! < bestD) {
      best = f;
      bestD = d[f]!;
    }
  }
  return best;
}

/**
 * Descendant resolution: inherit the parent's current visual family unless
 * another attractor is materially closer beyond deterministic hysteresis
 * (ratio gate AND absolute-improvement gate). Small mutations normally
 * produce no family change; accumulated divergence may transition stably.
 */
export function resolveDescendantFamily(
  axes: PhenotypeAxes,
  parentFamily: PhenotypeFamily,
): PhenotypeFamily {
  const d = distancesToAll(axes);
  const current = d[parentFamily]!;
  let best: PhenotypeFamily | null = null;
  let bestD = Infinity;
  for (const f of FAMILY_ORDER) {
    if (f === parentFamily) continue;
    const alt = d[f]!;
    if (alt <= HYSTERESIS_RATIO * current && current - alt >= HYSTERESIS_MIN_IMPROVEMENT) {
      if (alt < bestD) {
        best = f;
        bestD = alt;
      }
    }
  }
  return best ?? parentFamily;
}

/** Quantize a 0..1 parameter into QUANT_LEVELS stable states. */
export function quantize01(v: number, levels: number = QUANT_LEVELS): number {
  const q = Math.round(clamp01(v) * (levels - 1)) / (levels - 1);
  return clamp01(q);
}

/** Quantized geometry: pure function of axes + signed traits. */
export function quantizeGeometry(
  axes: PhenotypeAxes,
  dietSigned: number,
  habitatSigned: number,
  reproductionNorm: number,
  byproductNorm: number,
): QuantizedGeometry {
  void dietSigned;
  void habitatSigned;
  return {
    elongation: quantize01(axes.mobility),
    projection: quantize01(axes.sensing),
    density: quantize01(axes.metabolism),
    asymmetry: quantize01(axes.specialization),
    secondary: quantize01(byproductNorm),
    bulk: quantize01(reproductionNorm),
  };
}

/**
 * Deterministic 32-bit hash for cosmetic seeding. Integer math only, no
 * Math.random, no simulation RNG streams. Identity-scoped: distinct
 * (id, lineageId) pairs disperse; output feeds cosmetic variation exclusively.
 */
export function hashCosmeticSeed(id: number, lineageId: number, salt = 0): number {
  let x = (Math.imul(id | 0, 0x9e3779b1) ^ Math.imul((lineageId | 0) + salt, 0x85ebca6b)) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}

/** Resolve the full LOD-independent phenotype for one organism observation. */
export function resolvePhenotype(
  traits: TraitSample,
  opts?: {
    /** Parent's current visual family; omit/null for founder resolution. */
    readonly parentFamily?: PhenotypeFamily | null;
    readonly organismId?: number;
    readonly lineageId?: number;
  },
): ResolvedPhenotype {
  const axes = deriveAxes(traits);
  const parentFamily = opts?.parentFamily ?? null;
  const family =
    parentFamily === null ? resolveFounderFamily(axes) : resolveDescendantFamily(axes, parentFamily);
  const dietSigned = normalizeSignedTrait(traits.diet, 1.5);
  const habitatSigned = normalizeSignedTrait(traits.habitat, 1.5);
  const byproductNorm = normalizeTrait(
    traits.byproductUse,
    TRAIT_RANGES.byproductUse[0],
    TRAIT_RANGES.byproductUse[1],
  );
  const reproductionNorm = normalizeTrait(
    traits.reproduction,
    TRAIT_RANGES.reproduction[0],
    TRAIT_RANGES.reproduction[1],
  );
  const dormancyNorm = normalizeTrait(
    traits.dormancyResponse,
    TRAIT_RANGES.dormancyResponse[0],
    TRAIT_RANGES.dormancyResponse[1],
  );
  return {
    family,
    founder: parentFamily === null,
    axes,
    dietSigned,
    habitatSigned,
    reproductionNorm,
    dormancyNorm,
    quantized: quantizeGeometry(axes, dietSigned, habitatSigned, reproductionNorm, byproductNorm),
    cosmeticSeed: hashCosmeticSeed(opts?.organismId ?? 0, opts?.lineageId ?? 0),
  };
}

/** Signed direction bucket: -1 | 0 | +1 (neutral band around zero). */
export function signedDirection(v: number): -1 | 0 | 1 {
  if (v > SIGNED_NEUTRAL_EPS) return 1;
  if (v < -SIGNED_NEUTRAL_EPS) return -1;
  return 0;
}

/**
 * Zoom-aware LOD tier over the existing zoom stops (1.0x–3.0x in 0.5x steps).
 * No new zoom stops are introduced.
 */
export function lodTierForZoom(zoom: number): LodTier {
  if (zoom <= 1.5) return "ecosystem";
  if (zoom <= 2.5) return "population";
  return "inspection";
}

export function gridSizeForTier(tier: LodTier): number {
  return LOD_GRID_SIZE[tier];
}

/**
 * Deterministic animation phase in [0, 1) from cosmetic seed, mobility-driven
 * cadence, and an integer tick. Major geometry never depends on it —
 * animation may vary continuously while quantized form stays stable.
 */
export function phaseForTick(cosmeticSeed: number, mobility: number, tick: number): number {
  const seed01 = (cosmeticSeed >>> 0) / 4294967296;
  const cadence = 0.01 + 0.05 * clamp01(mobility);
  const p = seed01 + tick * cadence;
  return p - Math.floor(p);
}
