import type { ResolvedPhenotype } from "../model";
import type { ArtLod, ArtLodRecipe, StructuralArtRecipe } from "./types";
import { buildBlobRecipe } from "./families/blob";
import { buildBranchingRecipe, type BranchingActivity } from "./families/branching";
import { buildPaddledRecipe } from "./families/paddled";
import { buildPlatedRecipe } from "./families/plated";
import { buildRadialRecipe } from "./families/radial";
import { buildSegmentedRecipe } from "./families/segmented";

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
    case "blob":
      return buildBlobRecipe(resolved, activity);
    case "segmented":
      return buildSegmentedRecipe(resolved, activity);
    case "radial":
      return buildRadialRecipe(resolved, activity);
    case "paddled":
      return buildPaddledRecipe(resolved, activity);
    default:
      throw new Error(`Procedural art grammar is unsupported for ${resolved.family}`);
  }
}

/** Resolve a rich presentation LOD from one already-authored immutable source recipe. */
export function resolveArtLod(source: StructuralArtRecipe, lod: ArtLod): ArtLodRecipe {
  const regions = lod === "inspection"
    ? source.regions
    : source.regions.filter((region) => region.detail === "structure");
  return { source, lod, regions };
}
