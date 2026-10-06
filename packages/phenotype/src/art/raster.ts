import type { ArtGeometry, ArtMaterialRole, ProceduralPhenotypeRaster, StructuralArtRecipe } from "./types";
import { MATERIAL_ROLE_IDS } from "./material";

const NEUTRAL_VALUES: Readonly<Record<ArtMaterialRole, number>> = {
  "deep-tissue": 48,
  shadow: 76,
  body: 132,
  light: 184,
  rim: 210,
  interstitial: 30,
  core: 224,
  accent: 160,
};

function polygonContains(points: ArtGeometry & { readonly kind: "polygon" }, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = points.points.length - 1; i < points.points.length; j = i++) {
    const a = points.points[i]!;
    const b = points.points[j]!;
    const crosses = (a.y > y) !== (b.y > y)
      && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function contains(geometry: ArtGeometry, x: number, y: number): boolean {
  if (geometry.kind === "polygon") return polygonContains(geometry, x, y);
  const dx = x - geometry.center.x;
  const dy = y - geometry.center.y;
  const cosine = Math.cos(geometry.axisRadians);
  const sine = Math.sin(geometry.axisRadians);
  const along = (dx * cosine + dy * sine) / (geometry.length / 2);
  const across = (-dx * sine + dy * cosine) / geometry.width;
  if (Math.abs(along) > 1) return false;
  if (geometry.kind === "ellipse") return along * along + across * across <= 1;
  const taper = Math.max(0.08, Math.min(0.32, geometry.taper));
  const localWidth = Math.sqrt(Math.max(0, 1 - along * along)) * (1 - taper * along);
  return Math.abs(across) <= localWidth;
}

/** Rasterize structural geometry directly into owned RGBA and evidence-mask buffers. */
export function rasterizeStructuralArt(
  recipe: StructuralArtRecipe,
  options: { readonly width: number; readonly height: number },
): ProceduralPhenotypeRaster {
  const { width, height } = options;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new RangeError("Raster width and height must be positive safe integers");
  }
  const count = width * height;
  if (!Number.isSafeInteger(count) || count > 16_777_216) throw new RangeError("Raster dimensions exceed supported CPU proof bounds");
  const rgba = new Uint8Array(count * 4);
  for (let pixel = 0; pixel < count; pixel++) {
    const offset = pixel * 4;
    rgba[offset] = 16;
    rgba[offset + 1] = 20;
    rgba[offset + 2] = 26;
    rgba[offset + 3] = 255;
  }
  const silhouette = new Uint8Array(count);
  const ownership = new Int16Array(count);
  ownership.fill(-1);
  const depth = new Uint8Array(count);
  const materialRole = new Uint8Array(count);
  const paintRegions = [...recipe.regions].sort((a, b) => a.paintOrder - b.paintOrder);

  for (let y = 0; y < height; y++) {
    const ny = (y + 0.5) / height;
    for (let x = 0; x < width; x++) {
      const nx = (x + 0.5) / width;
      const pixel = y * width + x;
      for (let regionIndex = 0; regionIndex < paintRegions.length; regionIndex++) {
        const region = paintRegions[regionIndex]!;
        if (!contains(region.geometry, nx, ny)) continue;
        ownership[pixel] = regionIndex;
        depth[pixel] = Math.max(0, Math.min(255, region.depth));
        materialRole[pixel] = MATERIAL_ROLE_IDS[region.materialRole];
        silhouette[pixel] = region.materialRole === "interstitial" ? 0 : 1;
        const value = NEUTRAL_VALUES[region.materialRole];
        const offset = pixel * 4;
        rgba[offset] = value;
        rgba[offset + 1] = value;
        rgba[offset + 2] = value;
        rgba[offset + 3] = 255;
      }
    }
  }
  // Preserve a neutral one-pixel plate boundary so packed overlaps remain legible at native proof size.
  const boundaryPixels: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x;
      if (silhouette[pixel] === 0) continue;
      const owner = ownership[pixel]!;
      const neighbors = [x > 0 ? pixel - 1 : -1, x + 1 < width ? pixel + 1 : -1,
        y > 0 ? pixel - width : -1, y + 1 < height ? pixel + width : -1];
      if (neighbors.some((neighbor) => neighbor >= 0 && silhouette[neighbor] === 1 && ownership[neighbor] !== owner)) {
        boundaryPixels.push(pixel);
      }
    }
  }
  for (const pixel of boundaryPixels) {
    const value = 42;
    const offset = pixel * 4;
    rgba[offset] = value;
    rgba[offset + 1] = value;
    rgba[offset + 2] = value;
  }
  return { width, height, rgba, masks: { silhouette, ownership, depth, materialRole } };
}

/** Integer nearest-neighbor enlargement for review; this never changes native pixels. */
export function scaleRasterNearest(
  raster: ProceduralPhenotypeRaster,
  scale: number,
): ProceduralPhenotypeRaster {
  if (!Number.isSafeInteger(scale) || scale < 1 || scale > 8) throw new RangeError("Nearest scale must be an integer from 1 to 8");
  if (scale === 1) {
    return {
      width: raster.width,
      height: raster.height,
      rgba: raster.rgba.slice(),
      masks: {
        silhouette: raster.masks.silhouette.slice(),
        ownership: raster.masks.ownership.slice(),
        depth: raster.masks.depth.slice(),
        materialRole: raster.masks.materialRole.slice(),
      },
    };
  }
  const width = raster.width * scale;
  const height = raster.height * scale;
  const rgba = new Uint8Array(width * height * 4);
  const silhouette = new Uint8Array(width * height);
  const ownership = new Int16Array(width * height);
  const depth = new Uint8Array(width * height);
  const materialRole = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const sourceY = Math.floor(y / scale);
    for (let x = 0; x < width; x++) {
      const source = sourceY * raster.width + Math.floor(x / scale);
      const target = y * width + x;
      rgba.set(raster.rgba.subarray(source * 4, source * 4 + 4), target * 4);
      silhouette[target] = raster.masks.silhouette[source]!;
      ownership[target] = raster.masks.ownership[source]!;
      depth[target] = raster.masks.depth[source]!;
      materialRole[target] = raster.masks.materialRole[source]!;
    }
  }
  return { width, height, rgba, masks: { silhouette, ownership, depth, materialRole } };
}
