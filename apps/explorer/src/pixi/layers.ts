/**
 * P0 — Pixi scene-layer order + toroidal camera contract (pure, no Pixi import).
 *
 * Semantic layers stay separable so analytical meaning always outranks
 * decoration. P1 creates one Container per layer in this order (later = on
 * top) and must preserve the camera/torus/hit-testing behavior below.
 *
 * Camera/torus parity with the Canvas2D World (apps/explorer/src/App.tsx):
 * same 600x600 extent, uniform zoom only (1.0-3.0), wrapped pan with a
 * normalized camera center, read-only selection with a constant on-screen hit
 * radius. These helpers mirror that contract so P0 tests can assert parity;
 * P1 must keep them behaviorally aligned, not merely similarly named.
 */

export const WORLD_EXTENT = 600;
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 3;

/** Scene layers in draw order (later = on top). */
export const LAYER_ORDER = [
  "environment",
  "analytical-field",
  "waste-cue",
  "organisms",
  "selection-focus",
  "effects",
] as const;

export type PixiWorldLayer = (typeof LAYER_ORDER)[number];

/** What each layer owns. Analytical layers suppress cosmetic detail. */
export const LAYER_ROLES: Record<PixiWorldLayer, string> = {
  environment: "normal-lens substrate from real field state (smooth-scaled, procedural)",
  "analytical-field": "exact per-cell nutrient/waste/clade/trait encoding (flat, untextured, never smoothed)",
  "waste-cue": "deterministic stipple density channel on waste-loaded ground (cosmetic, non-color)",
  organisms: "deterministic cached Pixel Phenotype textures (nearest-filtered)",
  "selection-focus": "read-only selection halo/rings/ticks (brightest element, non-occluding)",
  effects: "transient presentation-only effects (no ecological meaning)",
};

/** Shortest toroidal delta from a to b over the 600x600 world. */
export const wrapDelta = (a: number, b: number): number => {
  let d = (a - b) % WORLD_EXTENT;
  if (d > WORLD_EXTENT / 2) d -= WORLD_EXTENT;
  else if (d < -WORLD_EXTENT / 2) d += WORLD_EXTENT;
  return d === 0 ? 0 : d; // normalize -0 (strict-equal clean; arithmetic-identical to App.tsx)
};

export const wrapCoord = (v: number): number => ((v % WORLD_EXTENT) + WORLD_EXTENT) % WORLD_EXTENT;

/** Clamp a zoom request to the uniform supported range. */
export function clampZoom(zoom: number): number {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
}
