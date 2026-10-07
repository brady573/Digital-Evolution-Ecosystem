import type { ResolvedPhenotype } from "../model";
import type { ArtLod, ArtLodRecipe, StructuralArtRecipe } from "./types";
import { buildBranchingRecipe, type BranchingActivity } from "./families/branching";
import { buildPlatedRecipe } from "./families/plated";

/**
 * Activity reaches the grammar because Branching withdraws geometry when
 * dormant. Plated geometry is activity-independent, so passing an activity
 * state does not change Plated output.
 */
export function buildArtRecipe(
  resolved: ResolvedPhenotype,
  activity: BranchingActivity = "active",
): StructuralArtRecipe {
  switch (resolved.family) {
    case "plated":
      return buildPlatedRecipe(resolved);
    case "branching":
      return buildBranchingRecipe(resolved, activity);
    default:
      throw new Error(`Procedural art grammar is unsupported for ${resolved.family}; this tranche supports Plated and Branching only`);
  }
}

/** Resolve a rich presentation LOD from one already-authored immutable source recipe. */
export function resolveArtLod(source: StructuralArtRecipe, lod: ArtLod): ArtLodRecipe {
  const regions = lod === "inspection"
    ? source.regions
    : source.regions.filter((region) => region.detail === "structure");
  return { source, lod, regions };
}
