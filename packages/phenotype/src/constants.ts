/**
 * Lane 2 M4B Pixel Phenotype prototype constants.
 *
 * PROTOTYPE BASELINE: every numerical value below is a tuning input for the
 * evidence tranche, not a final durable design constant. Phase 2 evidence may
 * propose adjustments; nothing here is promoted to permanent design semantics
 * without owner acceptance.
 *
 * Source: "Digital Evolution — Lane 2 M4B Pixel Phenotype Prototype Coding
 * Agent Handoff", prototype numerical baseline section.
 */

export type PhenotypeFamily =
  | "blob"
  | "segmented"
  | "radial"
  | "plated"
  | "branching"
  | "paddled";

/** Deterministic iteration / tie-break order. Arbitrary, not a ranking. */
export const FAMILY_ORDER: readonly PhenotypeFamily[] = [
  "blob",
  "segmented",
  "radial",
  "plated",
  "branching",
  "paddled",
];

/**
 * Stable supported simulation trait ranges. These mirror the engine authority
 * (packages/sim-core/src/engine.ts trait table T) and the explorer trait lens
 * ranges (apps/explorer/src/App.tsx TRAIT_RANGES). They are copied here —
 * never derived from the current population — so identical absolute trait
 * vectors always resolve identically regardless of population context (AC5).
 */
export const TRAIT_RANGES = {
  speed: [0.25, 4] as const,
  sensing: [10, 180] as const,
  metabolism: [0.04, 0.5] as const,
  reproduction: [55, 220] as const,
  diet: [-1.5, 1.5] as const,
  habitat: [-1.5, 1.5] as const,
  byproductUse: [0, 1.5] as const,
  dormancyResponse: [0, 1.5] as const,
};

/** Presentation axes: [mobility, sensing, metabolism, specialization]. */
export const FAMILY_CENTERS: Record<PhenotypeFamily, readonly [number, number, number, number]> = {
  blob: [0.35, 0.35, 0.4, 0.2],
  segmented: [0.7, 0.45, 0.5, 0.35],
  radial: [0.3, 0.82, 0.45, 0.4],
  plated: [0.3, 0.35, 0.78, 0.45],
  branching: [0.2, 0.76, 0.45, 0.82],
  paddled: [0.88, 0.62, 0.72, 0.45],
};

/** Prototype weighted squared distance weights per axis. */
export const AXIS_WEIGHTS = {
  mobility: 1.15,
  sensing: 1.0,
  metabolism: 0.75,
  specialization: 1.0,
} as const;

/**
 * Prototype hysteresis: a descendant keeps its parent's visual family unless
 * another attractor is materially closer — alternative distance <= 80% of the
 * current-family distance AND the absolute improvement >= 0.10.
 */
export const HYSTERESIS_RATIO = 0.8;
export const HYSTERESIS_MIN_IMPROVEMENT = 0.1;

/** Major geometry parameters quantize into this many stable states. */
export const QUANT_LEVELS = 5;

/** resourceSpecialization derivation weights (diet |habitat| byproduct). */
export const SPECIALIZATION_WEIGHTS = {
  diet: 0.45,
  habitat: 0.3,
  byproduct: 0.25,
} as const;

/** Signed traits with magnitude below this read as neutral direction. */
export const SIGNED_NEUTRAL_EPS = 0.15;

/**
 * Dormant-transform strength gate on normalized dormancy response.
 * >= threshold: full family-specific dormant transformation.
 * < threshold: partial transformation (hollowed active silhouette, secondary
 * structures withdrawn). Tuning input, not a biological claim.
 */
export const DORMANCY_STRONG_THRESHOLD = 0.5;

export type LodTier = "ecosystem" | "population" | "inspection";

/**
 * Logical-pixel grid sizes per geometry tier. Zoom reveals more phenotype
 * information, never just a larger copy of one fixed sprite (AC8).
 */
export const LOD_GRID_SIZE: Record<LodTier, number> = {
  ecosystem: 5,
  population: 9,
  inspection: 13,
};

export const PROTOTYPE_BASELINE = "m4b-phenotype-prototype-v1" as const;
