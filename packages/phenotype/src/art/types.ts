import type { PhenotypeFamily } from "../constants";

export const ART_LODS = ["population", "inspection"] as const;
export type ArtLod = (typeof ART_LODS)[number];

export type ArtMaterialRole =
  | "deep-tissue"
  | "shadow"
  | "body"
  | "light"
  | "rim"
  | "interstitial"
  | "core"
  | "accent";

export type ArtDetailLevel = "silhouette" | "structure" | "secondary" | "micro";

export interface NormalizedPoint {
  readonly x: number;
  readonly y: number;
}

export type ArtGeometry =
  | {
      readonly kind: "ellipse" | "teardrop";
      readonly center: NormalizedPoint;
      readonly axisRadians: number;
      readonly length: number;
      readonly width: number;
      readonly taper: number;
    }
  | {
      readonly kind: "polygon";
      readonly points: readonly NormalizedPoint[];
    };

/** Family-independent structural region. Geometry/material renderers own separate passes. */
export interface ArtRegion {
  readonly id: string;
  readonly geometry: ArtGeometry;
  readonly depth: number;
  readonly paintOrder: number;
  readonly detail: ArtDetailLevel;
  readonly materialRole: ArtMaterialRole;
}

/** Normalized, resolution-independent presentation structure. */
export interface StructuralArtRecipe {
  readonly family: PhenotypeFamily;
  readonly cosmeticSeed: number;
  readonly structuralVersion: string;
  readonly regions: readonly ArtRegion[];
}

export interface ArtLodRecipe {
  readonly source: StructuralArtRecipe;
  readonly lod: ArtLod;
  readonly regions: readonly ArtRegion[];
}

export interface RGBColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface ArtMaterialAccent {
  readonly regionId: string;
  readonly x: number;
  readonly y: number;
  readonly role: "core" | "accent";
  readonly kind: "pearl" | "highlight";
}

/**
 * How internal region boundaries are treated during materialization.
 *
 * - "hard": stroke every ownership boundary. Correct for Plated's accepted
 *   shell-and-plate language.
 * - "soft": rim only the outer silhouette; shade internal boundaries by depth.
 *   Required for soft-bodied families whose lobes, beads, and paddles overlap
 *   and must read as one fleshy organism rather than assembled plates.
 */
export type ArtSeam = "hard" | "soft";

export interface MaterialRecipe extends ArtLodRecipe {
  readonly palette: Readonly<Record<ArtMaterialRole, RGBColor>>;
  readonly cosmeticSeed: number;
  readonly rendererVersion: string;
  readonly seam: ArtSeam;
  /** Color-only points constrained to already-owned structural pixels. */
  readonly accents: readonly ArtMaterialAccent[];
}

export interface ProceduralPhenotypeMasks {
  readonly silhouette: Uint8Array;
  readonly ownership: Int16Array;
  readonly depth: Uint8Array;
  readonly materialRole: Uint8Array;
}

/** Typed-array buffers are owned by this raster value and are never scratch-buffer aliases. */
export interface ProceduralPhenotypeRaster {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
  readonly masks: ProceduralPhenotypeMasks;
}
