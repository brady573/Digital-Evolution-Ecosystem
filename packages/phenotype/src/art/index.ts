export { ART_LODS } from "./types";
export type {
  ArtMaterialAccent,
  ArtDetailLevel,
  ArtGeometry,
  ArtLod,
  ArtLodRecipe,
  ArtMaterialRole,
  ArtRegion,
  MaterialRecipe,
  NormalizedPoint,
  ProceduralPhenotypeMasks,
  ProceduralPhenotypeRaster,
  RGBColor,
  StructuralArtRecipe,
} from "./types";
export { PROCEDURAL_ART_VERSION } from "./version";
export { buildArtRecipe, resolveArtLod } from "./recipe";
export { buildBranchingRecipe, type BranchingActivity } from "./families/branching";
export { rasterizeStructuralArt, scaleRasterNearest } from "./raster";
export {
  applyMaterialRoles,
  BRANCHING_MATERIAL_PALETTE,
  deriveMaterialRoleView,
  materializeRaster,
  MATERIAL_ROLE_IDS,
  PLATED_MATERIAL_PALETTE,
} from "./material";
