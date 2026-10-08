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
 * Paddled grammar — a streamlined coherent body with broad lateral paddles.
 *
 * Reference direction: a crimson/orange mottled streamlined body with broad
 * wing-like lateral paddles and visible internal detail. The paddles are
 * clearly not anatomy from any Earth animal; they read as propulsion surfaces
 * on a coherent body, which is what this grammar expresses.
 *
 * Speed drives streamlining and paddle prominence, sensing adds bounded leading
 * sensory structures, metabolism affects activity/material emphasis only, and
 * dormancy folds the paddles inward toward the body.
 */

export function buildPaddledRecipe(res: ResolvedPhenotype, activity: StemActivity = "active"): StructuralArtRecipe {
  assertFamily("paddled", res.family);
  const seed = res.cosmeticSeed >>> 0;
  const dormant = activity === "dormant";

  // Heavily damped: a strong signed diet made the whole organism rotate into a
  // diagonal V instead of the reference's broadside posture.
  // The reference hull is diagonally posed (about -30 degrees), while diet
  // contributes only a small bounded variation around that canonical pose.
  // The measured reference principal axis is 117.6 degrees in raster coordinates
  // (y grows downward), a math heading of about 1.09 radians.
  const heading = 0.35 + res.dietSigned * 0.12;
  const cosine = Math.cos(heading);
  const sine = Math.sin(heading);

  // Speed streamlines: a longer, narrower hull.
  const streamline = 1 + res.quantized.elongation * 0.5;
  // Metabolism is activity/material emphasis only; it may not change geometry
  // beyond this bounded mottling scale, so it is deliberately not a shape term.
  const metabolicScale = 1 + res.quantized.density * 0.1;

  // Dormancy folds paddles inward: less lateral extent, rotated toward the hull.
  // The reference body lies broadside with wings spread roughly along the body
  // axis. A fixture-driven heading swung the whole animal to a steep diagonal,
  // so the posture uses a much damped heading.
  // A modest rearward sweep only: larger values rotate the wings forward into a V.
  const fold = dormant ? 0.34 : 1;
  const paddleAngle = dormant ? 0.6 : 0.42;
  // Calibrated against the measured rasterizer mapping: `length` is a full
  // extent and `width` is a HALF extent, so every width below is authored as
  // half the intended full width.
  const bodyLength = (dormant ? 0.44 : 0.46) * streamline;
  const bodyWidth = (dormant ? 0.085 : 0.08) * metabolicScale;

  const regions: ArtRegion[] = [];

  regions.push(ellipseRegion({
    id: "hull",
    centerX: clamp(0.5 + seededJitter(seed, 0, 0, 0.01), 0.25, 0.75),
    centerY: clamp(0.5 + seededJitter(seed, 0, 1, 0.01), 0.25, 0.75),
    axisRadians: heading,
    length: bodyLength,
    width: bodyWidth,
    depth: 1,
    paintOrder: 1,
    detail: "structure",
    materialRole: "body",
  }));

  // The reference has a broad asymmetric fan: both paddles sit aft of the
  // hull, one above and one below it. A symmetric cross made the wrong radial
  // reach profile (extra vertical extrema, missing the two aft shoulders).
  for (const side of [-1, 1] as const) {
    const sideIndex = side < 0 ? 0 : 1;
    // The reference reaches farthest at both aft diagonals. Each ellipse is
    // angled toward one of those measured shoulders. The two are deliberately
    // unequal so the fan is asymmetric, as the reference's 0.63 symmetry
    // (well below bilateral) requires.
    const wingAxis = heading + (side < 0 ? -1 : 1) * Math.PI * (5 / 6);
    // Two paddles that are unequal in span, matching the reference's asymmetric
  // fan rather than a symmetric cross.
    const aft = 0.12 * fold;
    const lateral = 0.07 * fold;
    const centerX = clamp(0.5 - cosine * aft - sine * side * lateral, 0.02, 0.98);
    const centerY = clamp(0.5 - sine * aft + cosine * side * lateral, 0.02, 0.98);
    regions.push(ellipseRegion({
      id: `paddle-${sideIndex}`,
      centerX,
      centerY,
      axisRadians: wingAxis,
      // Broad leaf-like wings: full width close to full length.
      length: 0.6 * fold * (1 + res.axes.mobility * 0.1),
      // Intended full paddle width ~0.26; halved for the rasterizer.
      width: 0.17 * fold * metabolicScale,
      depth: 2,
      paintOrder: 2 + sideIndex,
      detail: "structure",
      materialRole: side < 0 ? "light" : "body",
    }));
    // A rib along each paddle keeps the surface from reading as a flat blob.
    regions.push(teardropRegion({
      id: `paddle-rib-${sideIndex}`,
      centerX,
      centerY,
      axisRadians: wingAxis,
      length: 0.38 * fold,
      width: 0.018 * fold,
      taper: 0.2,
      depth: 3,
      paintOrder: 4 + sideIndex,
      detail: "secondary",
      materialRole: "rim",
    }));
  }

  // A trailing tail behind the hull. The measured reference reads as three
  // separated extremities along its axis; without this the body measures as a
  // single lobe (limbs 1 against the reference's 3).
  //
  // Offset by a fraction of the hull's length. Offsetting by the hull's full
  // half-length plus a fixed margin pushed the tail's center to x=0.10, where
  // it read as a stray needle crossing the frame rather than a tail.
  const tailDistance = bodyLength * 0.42 + 0.06 * fold;
  regions.push(teardropRegion({
    id: "tail",
    centerX: clamp(0.5 - cosine * tailDistance, 0.02, 0.98),
    centerY: clamp(0.5 - sine * tailDistance, 0.02, 0.98),
    axisRadians: heading,
    // Stubby and blunt. A long thin taper renders as a needle that crosses the
    // whole frame rather than as a rear extension of the body.
    length: 0.26 * fold,
    width: 0.075 * fold,
    taper: 0.3,
    depth: 2,
    paintOrder: 3,
    detail: "structure",
    materialRole: "body",
  }));

  // Bounded leading sensory structures: sensing controls their reach. They are
  // placed symmetrically about the body axis ahead of the head, so they read as
  // a paired sensory fringe rather than a cluster on one side.
  const sensoryCount = dormant ? 2 : 2 + Math.round(res.quantized.projection * 2);
  for (let index = 0; index < sensoryCount; index++) {
    const mirrored = index % 2 === 0 ? -1 : 1;
    const rank = Math.floor(index / 2);
    const spread = mirrored * (0.3 + rank * 0.34);
    const angle = heading + spread;
    const length = (0.13 + res.quantized.projection * 0.1) * (dormant ? 0.55 : 1);
    regions.push(teardropRegion({
      id: `sensory-${index}`,
      centerX: clamp(0.5 + cosine * (bodyLength / 2 + length / 2 * 0.9) - sine * spread * 0.1, 0.02, 0.98),
      centerY: clamp(0.5 + sine * (bodyLength / 2 + length / 2 * 0.9) + cosine * spread * 0.1, 0.02, 0.98),
      axisRadians: angle,
      length,
      width: length * 0.18,
      taper: 0.26,
      depth: 4,
      paintOrder: 8 + index,
      detail: "secondary",
      materialRole: "rim",
    }));
  }

  // Internal mottling detail: the reference's most recognisable surface trait.
  const mottleCount = 3 + Math.round(res.quantized.density * 4);
  for (let index = 0; index < mottleCount; index++) {
    const along = seededJitter(seed, index, 3, 0.4);
    const across = seededJitter(seed, index, 4, 0.5);
    regions.push(ellipseRegion({
      id: `mottle-${index}`,
      centerX: clamp(0.5 + cosine * along * bodyLength * 0.4 - sine * across * bodyWidth * 0.4, 0.06, 0.94),
      centerY: clamp(0.5 + sine * along * bodyLength * 0.4 + cosine * across * bodyWidth * 0.4, 0.06, 0.94),
      axisRadians: 0,
      length: 0.06 * metabolicScale,
      width: 0.026 * metabolicScale,
      depth: 5,
      paintOrder: 20 + index,
      detail: "secondary",
      materialRole: "core",
    }));
  }

  return {
    family: "paddled",
    cosmeticSeed: seed,
    structuralVersion: "paddled-grammar-v1",
    regions,
  };
}
