/**
 * P0 — deterministic phenotype texture descriptors (CPU side, no GPU).
 *
 * Consumes phenotype semantics WITHOUT duplicating them:
 *   ResolvedPhenotype -> renderPhenotypeGrid() -> grid bits -> exact key.
 * The Pixi spike (tools/pixi-spike/cache.ts) proves this shape; P1 adds the
 * GPU upload (`Texture.from(canvas)` with nearest scale mode). Nothing here
 * imports Pixi, sim-core, or sim-runtime, so this module is safe to unit-test
 * in Node and safe to keep out of the production bundle until P1.
 *
 * Pixel-art handling (handoff 5.3): nearest-neighbor filtering, coherent pixel
 * density across families, authored LOD reductions (ecosystem 5x5, population
 * 9x9, inspection 13x13), no smooth downscaling, dormancy/selection legible
 * without hue alone (geometry + lens color stay caller-owned, as today).
 */

import {
  renderPhenotypeGrid,
  type LodTier,
  type PhenotypeGrid,
  type ResolvedPhenotype,
} from "@digital-evolution/phenotype";
import { applyMaterialRoles, buildArtRecipe, materializeRaster, rasterizeStructuralArt, resolveArtLod } from "@digital-evolution/phenotype/art";

export type ActivityState = "active" | "dormant";

/** CPU-side texture descriptor: everything P1 needs to upload exactly once. */
export interface PhenotypeTextureDescriptor {
  readonly key: string;
  readonly tier: LodTier;
  readonly activity: ActivityState;
  readonly size: number;
  readonly bits: string;
  readonly rgba?: Uint8Array;
}

export interface RichArtTextureDescriptor {
  readonly key: string;
  readonly tier: "population" | "inspection";
  readonly size: number;
  readonly rgba: Uint8Array;
  readonly bits: string;
}

const richRasterCache = new Map<string, RichArtTextureDescriptor>();
const RICH_RASTER_CACHE_LIMIT = 256;

export function richTextureKey(
  rgba: Uint8Array,
  size: number,
  tier: "population" | "inspection",
  rendererVersion: string,
  structuralVersion: string,
  seed: number,
): string {
  if (rgba.length !== size * size * 4) throw new Error("Rich phenotype raster dimensions do not match its RGBA bytes");
  let hash = 2166136261;
  for (const byte of rgba) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
  return `plated/${rendererVersion}/${structuralVersion}/${tier}/${size}/${(seed >>> 0).toString(16)}/${hash.toString(16).padStart(8, "0")}`;
}

/** Rich Plated-only RGB texture; identity includes the exact authored RGBA bytes. */
export function richArtTexture(res: ResolvedPhenotype, tier: "population" | "inspection"): RichArtTextureDescriptor {
  if (res.family !== "plated") throw new Error("Rich procedural art is currently supported only for Plated");
  const inputKey = `${tier}/${JSON.stringify(res)}`;
  const inputHit = richRasterCache.get(inputKey);
  if (inputHit) {
    richRasterCache.delete(inputKey);
    richRasterCache.set(inputKey, inputHit);
    return inputHit;
  }
  const source = buildArtRecipe(res);
  const view = resolveArtLod(source, tier);
  const size = tier === "population" ? 64 : 128;
  const neutral = rasterizeStructuralArt({ ...source, regions: view.regions }, { width: size, height: size });
  const material = applyMaterialRoles(view, res);
  const rendered = materializeRaster(neutral, material);
  const rgba = rendered.rgba;
  const key = richTextureKey(rgba, size, tier, material.rendererVersion, source.structuralVersion, material.cosmeticSeed);
  const descriptor = { key, tier, size, rgba, bits: richRasterToBits(rgba, size) };
  richRasterCache.set(inputKey, descriptor);
  if (richRasterCache.size > RICH_RASTER_CACHE_LIMIT) {
    const oldest = richRasterCache.keys().next().value;
    if (oldest !== undefined) richRasterCache.delete(oldest);
  }
  return descriptor;
}

export function richRasterToBits(rgba: Uint8Array, size: number): string {
  if (rgba.length !== size * size * 4) throw new Error("Rich phenotype raster dimensions do not match its RGBA bytes");
  let bits = "";
  for (let pixel = 0; pixel < size * size; pixel++) bits += rgba[pixel * 4 + 3] === 0 ? "0" : "1";
  return bits;
}

export function describeRenderableTexture(
  res: ResolvedPhenotype,
  tier: LodTier,
  activity: ActivityState,
): PhenotypeTextureDescriptor {
  if (res.family === "plated" && tier !== "ecosystem") {
    const rich = richArtTexture(res, tier);
    return { key: rich.key, tier, activity, size: rich.size, bits: rich.bits, rgba: rich.rgba };
  }
  return describeTexture(res, tier, activity);
}

export function fnv1a(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function gridBits(g: PhenotypeGrid): string {
  return g.cells.map((b) => (b ? "1" : "0")).join("");
}

/**
 * Exact texture identity: phenotype grid bitmap + tier + activity.
 * Movement never touches this (positions are not key inputs); only
 * phenotype/activity/LOD changes re-map. Relaxed keys are measurement-only
 * until current evidence proves they merge no meaningful visual states.
 */
export function exactTextureKey(
  res: ResolvedPhenotype,
  tier: LodTier,
  activity: ActivityState,
): string {
  const g = renderPhenotypeGrid(res, tier, activity);
  return `${tier}/${activity}/${g.size}/${fnv1a(gridBits(g))}`;
}

/** Full descriptor for one (phenotype, tier, activity) triple. */
export function describeTexture(
  res: ResolvedPhenotype,
  tier: LodTier,
  activity: ActivityState,
): PhenotypeTextureDescriptor {
  const g = renderPhenotypeGrid(res, tier, activity);
  const bits = gridBits(g);
  return { key: `${tier}/${activity}/${g.size}/${fnv1a(bits)}`, tier, activity, size: g.size, bits };
}

/** Minimal Canvas2D surface; the caller owns fillStyle and alpha. */
export interface TexturePaintSurface {
  fillRect(x: number, y: number, w: number, h: number): void;
}

/**
 * Paint a descriptor's bitmap onto any Canvas2D-like surface at an origin.
 * Caller owns color/alpha (lens + dormancy channels stay outside, as in the
 * Canvas2D World). P1 uploads the same bitmap via an offscreen canvas with
 * nearest scale mode instead of painting it directly.
 */
export function paintDescriptor(
  ctx: TexturePaintSurface,
  desc: PhenotypeTextureDescriptor,
  originX: number,
  originY: number,
  unit: number,
): void {
  for (let y = 0; y < desc.size; y++) {
    for (let x = 0; x < desc.size; x++) {
      if (desc.bits[y * desc.size + x] === "1") ctx.fillRect(originX + x * unit, originY + y * unit, unit, unit);
    }
  }
}
