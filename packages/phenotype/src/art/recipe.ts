import type { ResolvedPhenotype } from "../model";
import type { ArtLod, ArtLodRecipe, StructuralArtRecipe } from "./types";
import { buildPlatedRecipe } from "./families/plated";

export function buildArtRecipe(resolved: ResolvedPhenotype): StructuralArtRecipe {
  switch (resolved.family) {
    case "plated":
      return buildPlatedRecipe(resolved);
    default:
      throw new Error(`Procedural art grammar is unsupported for ${resolved.family}; this tranche supports Plated only`);
  }
}

/** Resolve a rich presentation LOD from one already-authored immutable source recipe. */
export function resolveArtLod(source: StructuralArtRecipe, lod: ArtLod): ArtLodRecipe {
  const regions = lod === "inspection"
    ? source.regions
    : source.regions.filter((region) => region.detail === "structure");
  return { source, lod, regions };
}
