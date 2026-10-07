import type { ResolvedPhenotype } from "../model";
import { PROCEDURAL_ART_VERSION } from "./version";
import type {
  ArtLodRecipe,
  ArtMaterialAccent,
  ArtMaterialRole,
  MaterialRecipe,
  ProceduralPhenotypeRaster,
  RGBColor,
} from "./types";

export const PLATED_MATERIAL_PALETTE: Readonly<Record<ArtMaterialRole, RGBColor>> = {
  "deep-tissue": { r: 5, g: 12, b: 30 },
  shadow: { r: 13, g: 31, b: 70 },
  body: { r: 24, g: 71, b: 139 },
  light: { r: 48, g: 126, b: 190 },
  rim: { r: 93, g: 207, b: 231 },
  interstitial: { r: 7, g: 19, b: 39 },
  core: { r: 66, g: 133, b: 166 },
  accent: { r: 190, g: 235, b: 242 },
};

export const MATERIAL_ROLE_IDS: Readonly<Record<ArtMaterialRole, number>> = {
  "deep-tissue": 1,
  shadow: 2,
  body: 3,
  light: 4,
  rim: 5,
  interstitial: 6,
  core: 7,
  accent: 8,
};

const ROLE_BY_ID = Object.fromEntries(
  Object.entries(MATERIAL_ROLE_IDS).map(([role, id]) => [id, role]),
) as Readonly<Record<number, ArtMaterialRole>>;

function hash32(seed: number, value: string): number {
  let hash = (seed ^ 0x811c9dc5) >>> 0;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d) >>> 0;
  hash ^= hash >>> 15;
  return hash >>> 0;
}

function unit(seed: number, label: string, channel: number): number {
  return hash32(seed ^ Math.imul(channel + 1, 0x9e3779b1), `${PROCEDURAL_ART_VERSION}:${label}`) / 0x1_0000_0000;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function scaleColor(color: RGBColor, amount: number): RGBColor {
  return { r: clampByte(color.r * amount), g: clampByte(color.g * amount), b: clampByte(color.b * amount) };
}

function mixColor(a: RGBColor, b: RGBColor, amount: number): RGBColor {
  const t = Math.max(0, Math.min(1, amount));
  return {
    r: clampByte(a.r + (b.r - a.r) * t),
    g: clampByte(a.g + (b.g - a.g) * t),
    b: clampByte(a.b + (b.b - a.b) * t),
  };
}

function pearlColor(material: MaterialRecipe, regionId: string): RGBColor {
  const core = material.palette.core;
  const shadow = material.palette.shadow;
  const body = material.palette.body;
  return unit(material.cosmeticSeed, regionId, 77) > 0.5
    ? mixColor(core, shadow, 0.22)
    : mixColor(core, body, 0.14);
}

function localPoint(region: ArtLodRecipe["regions"][number], along: number, across: number): { x: number; y: number } | null {
  const geometry = region.geometry;
  if (geometry.kind === "polygon") return null;
  const cosine = Math.cos(geometry.axisRadians);
  const sine = Math.sin(geometry.axisRadians);
  return {
    x: geometry.center.x + cosine * (along - 0.5) * geometry.length - sine * across * geometry.width,
    y: geometry.center.y + sine * (along - 0.5) * geometry.length + cosine * across * geometry.width,
  };
}

function buildAccents(recipe: ArtLodRecipe, seed: number): ArtMaterialAccent[] {
  const sorted = [...recipe.regions].sort((a, b) => a.paintOrder - b.paintOrder);
  const accents: ArtMaterialAccent[] = [];
  for (const [index, region] of sorted.entries()) {
    if (region.materialRole === "core") {
      const point = recipe.lod === "inspection" && region.geometry.kind !== "polygon" ? region.geometry.center : null;
      if (point) accents.push({ regionId: region.id, x: point.x, y: point.y, role: "core", kind: "pearl" });
      continue;
    }
    if (recipe.lod !== "inspection" || region.detail !== "structure" || region.materialRole === "interstitial") continue;
    const along = 0.22 + unit(seed, region.id, index * 2) * 0.32;
    const across = (unit(seed, region.id, index * 2 + 1) - 0.5) * 0.65;
    const point = localPoint(region, along, across);
    if (point && point.x > 0 && point.x < 1 && point.y > 0 && point.y < 1) {
      accents.push({ regionId: region.id, x: point.x, y: point.y, role: "accent", kind: "highlight" });
    }
  }
  return accents;
}

/** Assign finite material roles and seed/version-bound color-only accent positions. */
export function applyMaterialRoles(recipe: ArtLodRecipe, resolved: ResolvedPhenotype): MaterialRecipe {
  if (recipe.source.family !== "plated" || resolved.family !== "plated") {
    throw new Error("Plated material pass only supports Plated recipes and phenotypes");
  }
  if (recipe.source.cosmeticSeed !== (resolved.cosmeticSeed >>> 0)) {
    throw new Error("Material input seed must match the resolved structural recipe seed");
  }
  return {
    ...recipe,
    palette: PLATED_MATERIAL_PALETTE,
    cosmeticSeed: resolved.cosmeticSeed >>> 0,
    rendererVersion: PROCEDURAL_ART_VERSION,
    accents: buildAccents(recipe, resolved.cosmeticSeed >>> 0),
  };
}

/** Derived diagnostic role view. It never changes structural masks or materialized pixels. */
export function deriveMaterialRoleView(raster: ProceduralPhenotypeRaster): Uint8Array {
  const width = raster.width;
  const height = raster.height;
  const displayRoles = raster.masks.materialRole.slice();
  return displayRoles;
}

function pixelColor(
  raster: ProceduralPhenotypeRaster,
  material: MaterialRecipe,
  region: ArtLodRecipe["regions"][number],
  pixel: number,
  x: number,
  y: number,
): RGBColor {
  const roleId = raster.masks.materialRole[pixel]!;
  const role = ROLE_BY_ID[roleId];
  if (!role) return { r: 16, g: 20, b: 26 };
  const base = material.palette[role];
  if (role === "interstitial") return base;
  if (role === "core") return pearlColor(material, region.id);
  if (region.geometry.kind === "polygon") return base;
  const nx = (x + 0.5) / raster.width;
  const ny = (y + 0.5) / raster.height;
  const dx = nx - region.geometry.center.x;
  const dy = ny - region.geometry.center.y;
  const cosine = Math.cos(region.geometry.axisRadians);
  const sine = Math.sin(region.geometry.axisRadians);
  const along = (dx * cosine + dy * sine) / region.geometry.length + 0.5;
  const across = Math.abs((-dx * sine + dy * cosine) / region.geometry.width);
  const quantizedLift = Math.floor((0.68 + Math.max(0, 1 - across) * 0.36 + Math.max(0, 0.58 - along) * 0.12) * 4) / 4;
  const depthLift = raster.masks.depth[pixel] === 0 ? 0.82 : raster.masks.depth[pixel] === 1 ? 0.94 : 1;
  return scaleColor(base, quantizedLift * depthLift);
}

function setPixel(rgba: Uint8Array, offset: number, color: RGBColor): void {
  rgba[offset] = color.r;
  rgba[offset + 1] = color.g;
  rgba[offset + 2] = color.b;
  rgba[offset + 3] = 255;
}

/** Materialize colors over frozen raster masks; all geometry evidence buffers stay identical. */
export function materializeRaster(
  raster: ProceduralPhenotypeRaster,
  material: MaterialRecipe,
): ProceduralPhenotypeRaster {
  const pixels = raster.width * raster.height;
  if (raster.rgba.length !== pixels * 4 || raster.masks.ownership.length !== pixels
    || raster.masks.silhouette.length !== pixels || raster.masks.depth.length !== pixels
    || raster.masks.materialRole.length !== pixels) {
    throw new Error("Material input raster and masks have inconsistent dimensions");
  }
  const sorted = [...material.regions].sort((a, b) => a.paintOrder - b.paintOrder);
  if (!material.regions.every((region) => material.source.regions.includes(region))) {
    throw new Error("Material recipe contains a region outside its source geometry");
  }
  const rgba = raster.rgba.slice();
  for (let pixel = 0; pixel < pixels; pixel++) {
    const owner = raster.masks.ownership[pixel]!;
    if (owner < 0) continue;
    const region = sorted[owner];
    if (!region) throw new Error("Raster ownership references an unknown recipe region");
    const x = pixel % raster.width;
    const y = Math.floor(pixel / raster.width);
    setPixel(rgba, pixel * 4, pixelColor(raster, material, region, pixel, x, y));
  }

  // Cyan seams/rims are color-only classification of existing ownership boundaries.
  for (let y = 0; y < raster.height; y++) {
    for (let x = 0; x < raster.width; x++) {
      const pixel = y * raster.width + x;
      if (raster.masks.silhouette[pixel] === 0 || raster.masks.ownership[pixel]! < 0) continue;
      const owner = raster.masks.ownership[pixel]!;
      const neighbors = [x > 0 ? pixel - 1 : -1, x + 1 < raster.width ? pixel + 1 : -1,
        y > 0 ? pixel - raster.width : -1, y + 1 < raster.height ? pixel + raster.width : -1];
      const boundary = neighbors.some((neighbor) => neighbor >= 0
        && (raster.masks.silhouette[neighbor] === 0 || raster.masks.ownership[neighbor] !== owner));
      if (!boundary) continue;
      const region = sorted[owner]!;
      const isOuterRim = neighbors.some((neighbor) => neighbor >= 0 && raster.masks.silhouette[neighbor] === 0);
      const variation = unit(material.cosmeticSeed, region.id, pixel % 17);
      const color = variation > 0.965
        ? mixColor(material.palette.rim, material.palette.accent, 0.28)
        : isOuterRim
          ? material.palette.rim
          : scaleColor(material.palette.rim, raster.masks.depth[pixel] === 0 ? 0.48 : 0.72);
      setPixel(rgba, pixel * 4, color);
    }
  }

  // Place one or two pixel glints only where the existing owner mask exposes the plate.
  for (const accent of material.accents) {
    const owner = sorted.findIndex((region) => region.id === accent.regionId);
    if (owner < 0) continue;
    const x = Math.floor(accent.x * raster.width);
    const y = Math.floor(accent.y * raster.height);
    const pixel = y * raster.width + x;
    if (x < 0 || y < 0 || x >= raster.width || y >= raster.height || raster.masks.ownership[pixel] !== owner) continue;
    const color = accent.role === "core" ? pearlColor(material, accent.regionId) : material.palette.accent;
    setPixel(rgba, pixel * 4, accent.role === "core" ? scaleColor(color, 0.93) : color);
    const neighbor = x + 1 < raster.width ? pixel + 1 : pixel - 1;
    if (raster.masks.ownership[neighbor] === owner && accent.role === "accent") {
      setPixel(rgba, neighbor * 4, scaleColor(color, 0.86));
    }
  }

  return { ...raster, rgba, masks: raster.masks };
}
