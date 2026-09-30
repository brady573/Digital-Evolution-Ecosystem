/**
 * P0 — production asset-class registry (pure data, offline-first).
 *
 * Maps the handoff's four production asset classes (5.2) to manifest ids and
 * runtime handling. Portraits (B) are inspection art; in-world morphology (A)
 * is generated phenotype geometry; environment (C) stays procedural from real
 * field state; interaction assets (D) are presentation-only. No runtime
 * network loading, ever.
 */

export type AssetClass = "A-phenotype-textures" | "B-portraits" | "C-environment" | "D-interaction";

export interface AssetClassRecord {
  readonly cls: AssetClass;
  readonly manifestIds: readonly string[];
  readonly filtering: string;
  readonly authority: string;
  readonly offline: string;
}

export const ASSET_REGISTRY: Record<AssetClass, AssetClassRecord> = {
  "A-phenotype-textures": {
    cls: "A-phenotype-textures",
    manifestIds: ["phenotype-textures"],
    filtering: "nearest-neighbor (organism pixel textures stay crisp; no blur/subpixel)",
    authority: "resolved Pixel Phenotype geometry (packages/phenotype); cache artifacts only, never stored",
    offline: "generated deterministically at runtime; no network",
  },
  "B-portraits": {
    cls: "B-portraits",
    manifestIds: ["family-portraits"],
    filtering: "inspection <img> default; explicit per-LOD file choice (16/32/64/128), never a runtime downscale",
    authority: "inspection-card illustration only; never in-world morphology (Owner acceptance pending, not final)",
    offline: "bundled by Vite from apps/explorer/src/family-art/*.png; no network at runtime",
  },
  "C-environment": {
    cls: "C-environment",
    manifestIds: ["substrate-field", "waste-stipple", "waste-overlay-ramp", "nutrient-overlay-palettes"],
    filtering: "normal lens: smooth-scaled (bilinear, required); analytical lenses: none/exact (never smoothed)",
    authority: "real simulation field state; procedural, no decorative tiles or invented biomes",
    offline: "generated at runtime from snapshot fields; no network",
  },
  "D-interaction": {
    cls: "D-interaction",
    manifestIds: ["selection-marker", "pixi-world-layers-p0"],
    filtering: "vector/Graphics presentation affordances (brightest, non-occluding)",
    authority: "read-only selection/focus; presentation-only, never simulation",
    offline: "drawn at runtime; no network",
  },
};

/** Every manifest id the registry claims, for cross-checking the manifest. */
export function registryManifestIds(): string[] {
  return Object.values(ASSET_REGISTRY).flatMap((r) => [...r.manifestIds]);
}
