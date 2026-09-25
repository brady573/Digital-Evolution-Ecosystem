/**
 * @digital-evolution/phenotype — Lane 2 M4B Pixel Phenotype prototype.
 *
 * Phase 1 (safe parallel core): phenotype model, family resolver with
 * hysteresis, quantization, renderer primitives, and deterministic tests.
 * No simulation biology, no persistence contract changes, no App.tsx edits.
 */
export {
  AXIS_WEIGHTS,
  DORMANCY_STRONG_THRESHOLD,
  FAMILY_CENTERS,
  FAMILY_ORDER,
  HYSTERESIS_MIN_IMPROVEMENT,
  HYSTERESIS_RATIO,
  LOD_GRID_SIZE,
  PROTOTYPE_BASELINE,
  QUANT_LEVELS,
  SIGNED_NEUTRAL_EPS,
  SPECIALIZATION_WEIGHTS,
  TRAIT_RANGES,
} from "./constants";
export type { LodTier, PhenotypeFamily } from "./constants";
export {
  attractorDistance,
  clamp01,
  clampSigned,
  deriveAxes,
  deriveSpecialization,
  distancesToAll,
  gridSizeForTier,
  hashCosmeticSeed,
  lodTierForZoom,
  normalizeSignedTrait,
  normalizeTrait,
  phaseForTick,
  quantize01,
  quantizeGeometry,
  resolveDescendantFamily,
  resolveFounderFamily,
  resolvePhenotype,
  signedDirection,
} from "./model";
export type {
  PhenotypeAxes,
  QuantizedGeometry,
  ResolvedPhenotype,
  TraitSample,
} from "./model";
export {
  countFilled,
  drawGridToCanvas,
  gridDifference,
  gridToAscii,
  renderPhenotypeGrid,
} from "./renderer";
export type { ActivityState, FillSurface, PhenotypeGrid } from "./renderer";
