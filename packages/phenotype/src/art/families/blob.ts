import type { ResolvedPhenotype } from "../../model";
import type { ArtRegion, StructuralArtRecipe } from "../types";
import {
  assertFamily,
  clamp,
  ellipseRegion,
  seededJitter,
  teardropRegion,
  type StemActivity,
} from "./shared";

/**
 * Blob grammar — a compact, irregular, cohesive soft mass.
 *
 * Reference direction: fused bulbous lobes with a mottled, vacuolated surface.
 * The body stays ONE connected mass: lobes overlap the core heavily so the
 * silhouette never separates into detached bubbles. Speed stretches and biases
 * the lobe field, sensing adds small surface projections, specialization
 * bounds the edge asymmetry, and dormancy contracts everything to a tight core.
 */

interface Lobe {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly depth: number;
  readonly materialRole: ArtRegion["materialRole"];
}

/**
 * Lobe field authored in a normalized disc. Sizes are FULL diameters; the
 * rasterizer treats `width` as a half extent, so each is halved below.
 *
 * The core is deliberately smaller than the lobe spread: a core that swallows
 * the lobes renders as one smooth egg, which loses the lobed identity and the
 * broken outline that keeps Blob distinct from every other family in
 * monochrome.
 */
const LOBES: readonly Lobe[] = [
  { id: "core", x: 0.5, y: 0.5, size: 0.32, depth: 0, materialRole: "body" },
  { id: "lobe-upper", x: 0.46, y: 0.35, size: 0.28, depth: 1, materialRole: "body" },
  { id: "lobe-left", x: 0.31, y: 0.43, size: 0.26, depth: 1, materialRole: "body" },
  { id: "lobe-right", x: 0.69, y: 0.52, size: 0.25, depth: 1, materialRole: "light" },
  { id: "lobe-lower", x: 0.55, y: 0.66, size: 0.24, depth: 1, materialRole: "body" },
  { id: "lobe-upper-left", x: 0.37, y: 0.33, size: 0.2, depth: 2, materialRole: "light" },
  { id: "lobe-upper-right", x: 0.66, y: 0.34, size: 0.19, depth: 2, materialRole: "light" },
  { id: "lobe-lower-left", x: 0.31, y: 0.62, size: 0.18, depth: 2, materialRole: "light" },
  { id: "lobe-lower-right", x: 0.65, y: 0.69, size: 0.17, depth: 2, materialRole: "light" },
  { id: "lobe-side", x: 0.29, y: 0.54, size: 0.2, depth: 2, materialRole: "light" },
  { id: "lobe-crown", x: 0.53, y: 0.27, size: 0.18, depth: 2, materialRole: "light" },
  { id: "lobe-basal", x: 0.48, y: 0.72, size: 0.19, depth: 2, materialRole: "light" },
];

export function buildBlobRecipe(res: ResolvedPhenotype, activity: StemActivity = "active"): StructuralArtRecipe {
  assertFamily("blob", res.family);
  const seed = res.cosmeticSeed >>> 0;
  const dormant = activity === "dormant";

  // Speed stretches the mass along a stable heading and biases lobe placement
  // in that direction rather than scaling the whole body uniformly.
  const stretch = 1 + res.quantized.elongation * 0.34;
  // The accepted reference occupies substantially more of its frame than the
  // first recipe. Uniformly scaling the lobe field preserves its measured fill
  // ratio while bringing frame coverage toward the reference target.
  const referenceScale = 1.18;
  const heading = res.dietSigned * 0.5;
  const cosine = Math.cos(heading);
  const sine = Math.sin(heading);

  // Sensing adds small surface projections; dormancy removes them entirely.
  const projectionCount = dormant ? 0 : 2 + Math.round(res.quantized.projection * 2);
  // Dormancy contracts to a tight core.
  const contraction = dormant ? 0.68 : 1;
  // Sensing projections must stay short enough to remain attached to the
  // lobe field. Long free-floating spikes break the single-mass silhouette the
  // measured reference shows (components = 1).
  const projectionLength = 0.14 + res.quantized.projection * 0.04;

  const regions: ArtRegion[] = [];
  LOBES.forEach((lobe, index) => {
    const dx = (lobe.x - 0.5) * stretch * referenceScale;
    const dy = (lobe.y - 0.5) * referenceScale;
    const offsetX = 0.5 + (dx * cosine - dy * sine) * contraction;
    const offsetY = 0.5 + (dx * sine + dy * cosine) * contraction;
    const size = lobe.size * referenceScale * contraction * (0.94 + res.quantized.bulk * 0.1);
    regions.push(ellipseRegion({
      id: lobe.id,
      centerX: clamp(offsetX + seededJitter(seed, index, 0, 0.012), 0.1, 0.9),
      centerY: clamp(offsetY + seededJitter(seed, index, 1, 0.012), 0.1, 0.9),
      // Non-uniform axes: a stretched lobe is wider along the heading.
      axisRadians: heading,
      length: size * (1 + res.quantized.elongation * 0.18),
      // `size` is a full diameter; the rasterizer's width is a half extent.
      width: size / 2,
      depth: lobe.depth,
      paintOrder: index,
      detail: "structure",
      materialRole: lobe.materialRole,
    }));
  });

  for (let index = 0; index < projectionCount; index++) {
    const angle = (index / projectionCount) * Math.PI * 2 + res.habitatSigned * 0.6 + seededJitter(seed, index, 2, 0.2);
    const reach = (0.2 + res.quantized.projection * 0.06) * referenceScale;
    regions.push(teardropRegion({
      id: `projection-${index}`,
      centerX: clamp(0.5 + Math.cos(angle) * reach, 0.04, 0.96),
      centerY: clamp(0.5 + Math.sin(angle) * reach, 0.04, 0.96),
      axisRadians: angle,
      length: projectionLength * referenceScale,
      width: projectionLength * 0.28,
      taper: 0.3,
      depth: 3,
      paintOrder: 20 + index,
      detail: "secondary",
      materialRole: "rim",
    }));
  }

  // Specialization bounds edge asymmetry through the vacuole accents, never by
  // moving structural regions.
  const accentCount = 6 + Math.round(res.quantized.secondary * 8);
  for (let index = 0; index < accentCount; index++) {
    const angle = seededJitter(seed, index, 3, Math.PI) + index * 1.7;
    const radius = (0.1 + seededJitter(seed, index, 4, 0.09)) * contraction;
    regions.push(ellipseRegion({
      id: `vacuole-${index}`,
      centerX: clamp(0.5 + Math.cos(angle) * radius, 0.06, 0.94),
      centerY: clamp(0.5 + Math.sin(angle) * radius, 0.06, 0.94),
      axisRadians: 0,
      length: 0.04 * contraction,
      width: 0.02 * contraction,
      depth: 2,
      paintOrder: 40 + index,
      detail: "secondary",
      materialRole: "core",
    }));
  }

  return {
    family: "blob",
    cosmeticSeed: seed,
    structuralVersion: "blob-grammar-v1",
    regions,
  };
}
