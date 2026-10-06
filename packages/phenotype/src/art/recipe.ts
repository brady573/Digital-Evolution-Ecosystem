import type { ResolvedPhenotype } from "../model";
import type { StructuralArtRecipe } from "./types";
import { buildPlatedRecipe } from "./families/plated";

export function buildArtRecipe(resolved: ResolvedPhenotype): StructuralArtRecipe {
  switch (resolved.family) {
    case "plated":
      return buildPlatedRecipe(resolved);
    default:
      throw new Error(`Procedural art grammar is unsupported for ${resolved.family}; this tranche supports Plated only`);
  }
}
