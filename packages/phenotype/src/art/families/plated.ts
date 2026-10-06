import type { ResolvedPhenotype } from "../../model";
import type { ArtRegion, NormalizedPoint, StructuralArtRecipe } from "../types";

interface PlateSite {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly length: number;
  readonly aspect: number;
  readonly depth: number;
  readonly paintOrder: number;
  readonly materialRole: ArtRegion["materialRole"];
}

/** Directional packed shell mound: roots are scattered through an oblique mass, never a ring. */
const PLATE_SITES: readonly PlateSite[] = [
  { id: "rear-upper-0", x: 0.40, y: 0.33, angle: -0.47, length: 0.27, aspect: 1.48, depth: 0, paintOrder: 0, materialRole: "shadow" },
  { id: "rear-upper-1", x: 0.57, y: 0.36, angle: 0.14, length: 0.25, aspect: 1.55, depth: 0, paintOrder: 1, materialRole: "deep-tissue" },
  { id: "rear-lower-0", x: 0.36, y: 0.53, angle: 0.62, length: 0.26, aspect: 1.42, depth: 0, paintOrder: 2, materialRole: "shadow" },
  { id: "rear-right-0", x: 0.66, y: 0.49, angle: 1.02, length: 0.24, aspect: 1.48, depth: 0, paintOrder: 3, materialRole: "deep-tissue" },
  { id: "mid-left-0", x: 0.34, y: 0.43, angle: -0.26, length: 0.30, aspect: 1.44, depth: 1, paintOrder: 4, materialRole: "body" },
  { id: "mid-center-0", x: 0.46, y: 0.45, angle: 0.72, length: 0.29, aspect: 1.38, depth: 1, paintOrder: 5, materialRole: "light" },
  { id: "mid-right-0", x: 0.63, y: 0.42, angle: -0.74, length: 0.27, aspect: 1.52, depth: 1, paintOrder: 6, materialRole: "body" },
  { id: "mid-lower-0", x: 0.45, y: 0.59, angle: -0.20, length: 0.28, aspect: 1.48, depth: 1, paintOrder: 7, materialRole: "light" },
  { id: "mid-lower-1", x: 0.59, y: 0.58, angle: 0.73, length: 0.25, aspect: 1.40, depth: 1, paintOrder: 8, materialRole: "body" },
  { id: "front-left-0", x: 0.39, y: 0.47, angle: -0.88, length: 0.28, aspect: 1.42, depth: 2, paintOrder: 9, materialRole: "light" },
  { id: "front-center-0", x: 0.57, y: 0.50, angle: -0.56, length: 0.30, aspect: 1.35, depth: 2, paintOrder: 10, materialRole: "body" },
  { id: "front-lower-0", x: 0.48, y: 0.64, angle: -0.52, length: 0.23, aspect: 1.48, depth: 2, paintOrder: 11, materialRole: "light" },
];

function hash01(seed: number, slot: number, channel: number): number {
  let value = (seed ^ Math.imul(slot + 1, 0x9e3779b1) ^ Math.imul(channel + 1, 0x85ebca6b)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d) >>> 0;
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b) >>> 0;
  value ^= value >>> 16;
  return (value >>> 0) / 0x1_0000_0000;
}

function jitter(seed: number, slot: number, channel: number, amplitude: number): number {
  return (hash01(seed, slot, channel) * 2 - 1) * amplitude;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function plateRegion(site: PlateSite, res: ResolvedPhenotype, slot: number): ArtRegion {
  const seed = res.cosmeticSeed >>> 0;
  const mass = 0.92 + res.quantized.bulk * 0.12;
  const elongationScale = 0.96 + res.axes.mobility * 0.08;
  const packing = 1.03 - res.quantized.density * 0.07;
  const specialization = res.quantized.asymmetry;
  const directional = site.x > 0.5 ? 1 : -1;
  const center: NormalizedPoint = {
    x: clamp(0.5 + (site.x - 0.5) * mass * packing * (0.95 + res.axes.mobility * 0.1) + directional * res.dietSigned * specialization * 0.012 + jitter(seed, slot, 0, 0.009), 0.08, 0.92),
    y: clamp(0.5 + (site.y - 0.5) * mass * packing + res.habitatSigned * 0.009 + jitter(seed, slot, 1, 0.008), 0.08, 0.92),
  };
  const orientationBias = res.dietSigned * specialization * 0.09 + res.habitatSigned * 0.035;
  const reach = site.id.startsWith("mid-left") || site.id.startsWith("mid-right") ? 1 : 0;
  const length = site.length * (0.94 + res.quantized.projection * 0.1 * reach) * mass * elongationScale
    + jitter(seed, slot, 3, 0.006);
  return {
    id: site.id,
    geometry: {
      kind: "teardrop",
      center,
      axisRadians: site.angle + orientationBias * directional + jitter(seed, slot, 2, 0.035),
      length,
      width: (site.length / (2 * site.aspect)) * (0.95 + res.quantized.density * 0.08) * mass
        + jitter(seed, slot, 4, 0.003),
      taper: clamp(0.16 + site.depth * 0.025 + specialization * 0.025, 0.12, 0.23),
    },
    depth: site.depth,
    paintOrder: site.paintOrder,
    detail: "structure",
    materialRole: site.materialRole,
  };
}

const BED_SPACES: readonly (readonly NormalizedPoint[])[] = [
  [{ x: 0.45, y: 0.37 }, { x: 0.51, y: 0.35 }, { x: 0.56, y: 0.39 }, { x: 0.52, y: 0.43 }],
  [{ x: 0.35, y: 0.54 }, { x: 0.41, y: 0.51 }, { x: 0.45, y: 0.56 }, { x: 0.40, y: 0.60 }],
  [{ x: 0.58, y: 0.53 }, { x: 0.65, y: 0.50 }, { x: 0.66, y: 0.56 }, { x: 0.61, y: 0.59 }],
];

function interstitialRegions(res: ResolvedPhenotype): ArtRegion[] {
  const count = 1 + Math.round(res.quantized.density * 2);
  return BED_SPACES.slice(0, count).map((points, index) => ({
    id: `interstitial-bed-${index}`,
    geometry: { kind: "polygon" as const, points },
    depth: 0,
    paintOrder: -3 + index,
    detail: "structure" as const,
    materialRole: "interstitial" as const,
  }));
}

export function buildPlatedRecipe(res: ResolvedPhenotype): StructuralArtRecipe {
  if (res.family !== "plated") throw new Error(`Plated grammar only supports plated phenotypes (got ${res.family})`);
  const plates = PLATE_SITES.map((site, index) => plateRegion(site, res, index));
  const secondaryCount = Math.round(res.quantized.secondary * 3);
  const secondary = Array.from({ length: secondaryCount }, (_, index): ArtRegion => ({
    id: `secondary-${index}`,
    geometry: {
      kind: "ellipse",
      center: { x: 0.44 + index * 0.045, y: 0.49 + (index % 2) * 0.035 },
      axisRadians: 0,
      length: 0.035,
      width: 0.025,
      taper: 0,
    },
    depth: 2,
    paintOrder: 12 + index,
    detail: "secondary",
    materialRole: "core",
  }));
  return {
    family: "plated",
    cosmeticSeed: res.cosmeticSeed >>> 0,
    structuralVersion: "plated-grammar-v1",
    regions: [...interstitialRegions(res), ...plates, ...secondary],
  };
}
