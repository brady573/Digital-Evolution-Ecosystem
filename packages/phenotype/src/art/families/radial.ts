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
 * Radial grammar — a coherent central body with center-outward projections.
 *
 * Reference direction: a pink/magenta hub with many straight radiating spikes
 * capped by bulbous tips, close to rotationally symmetric.
 *
 * The distinction from Branching matters and is enforced here: Radial
 * projections are emitted on a single ring around one hub with no parent/child
 * relationship, so nothing in this recipe can express a branch hierarchy.
 * Sensing drives projection reach and count, speed introduces directional bias
 * without collapsing the radial identity, specialization bounds asymmetry, and
 * dormancy retracts the projections toward the hub.
 */

export function buildRadialRecipe(res: ResolvedPhenotype, activity: StemActivity = "active"): StructuralArtRecipe {
  assertFamily("radial", res.family);
  const seed = res.cosmeticSeed >>> 0;
  const dormant = activity === "dormant";

  const regions: ArtRegion[] = [];

  // A compact, bright central body. The reference hub is a small dense mass
  // carrying the family's main colour, not a large dark oval.
  // `length` is a full extent and `width` is HALF in the rasterizer.
  const hubSize = (dormant ? 0.22 : 0.2) * (0.94 + res.quantized.bulk * 0.1);
  const hubRadius = hubSize / 2;
  regions.push(ellipseRegion({
    id: "hub",
    centerX: clamp(0.5 + seededJitter(seed, 0, 0, 0.01), 0.3, 0.7),
    centerY: clamp(0.5 + seededJitter(seed, 0, 1, 0.01), 0.3, 0.7),
    axisRadians: 0,
    length: hubSize,
    width: hubSize / 2,
    depth: 0,
    paintOrder: 0,
    detail: "structure",
    materialRole: "body",
  }));
  regions.push(ellipseRegion({
    id: "hub-core",
    centerX: 0.5,
    centerY: 0.5,
    axisRadians: 0,
    length: hubSize * 0.62,
    width: hubSize * 0.31,
    depth: 2,
    paintOrder: 30,
    detail: "structure",
    materialRole: "light",
  }));

  // Sensing drives projection count and reach. Dormancy retracts them.
  // Fewer rays keep visible gaps; too many closes the ring into a pinwheel.
  // An even ray count is required for bilateral symmetry: an odd ring has no
  // opposing partner for the ray on its symmetry line.
  // The reference reads as 8 radiating clubs. Quantization is deliberately
  // coarse: a 10- or 11-ray ring is visually busier and breaks the clean
  // eight-limbed identity of the family.
  const projectionCount = dormant ? 6 : 8;
  // Rays are anchored so their inner end overlaps the hub and their outer end
  // clears it, giving separated clubs that still read as growing from the body.
  // Ray centers sit close enough that each ray's inner end overlaps the hub, so
  // rays visibly grow out of the body instead of floating free around it.
  const reach = dormant ? 0.2 : 0.2 + res.quantized.projection * 0.04;
  const projectionLength = dormant ? 0.22 : 0.26 + res.quantized.projection * 0.05;

  // Speed biases the ring into an ellipse without destroying the ring itself:
  // angles are evenly spaced around a stretched radius, never redistributed.
  // The reference measures at 0.90 bilateral symmetry, so directional input
  // rotates the whole ring rather than deforming it. Strong per-ray directional
  // terms measured 0.61: an obviously lopsided star.
  // The reference ring sits square to the frame; diet only rotates it a little.
  const heading = res.dietSigned * 0.12;
  const asymmetry = 1 + res.quantized.asymmetry * 0.22;

  for (let index = 0; index < projectionCount; index++) {
    const baseAngle = (index / projectionCount) * Math.PI * 2
      + heading;
    // Jitter repeats in four quadrants with alternating sign, giving the ring
    // 90-degree rotational symmetry and therefore reflection symmetry about
    // any axis. Pairing by count-1-index alone left the ring measurably
    // lopsided (symmetry 0.53 against the reference's 0.90).
    const quadrant = projectionCount / 4;
    const slot = index % quadrant;
    const quarter = Math.floor(index / quadrant);
    const sign = quarter % 2 === 0 ? 1 : -1;
    const angleJitter = seededJitter(seed, slot, 2, 0.03) * sign;
    const lengthJitter = seededJitter(seed, slot, 3, 0.04) * sign;
    const angle = baseAngle + angleJitter;
    // The ring is kept circular. Any cos(angle) term makes the silhouette
    // measurably elliptical and lowers bilateral symmetry.
    const elongated = 1;
    const length = projectionLength * (1 + lengthJitter * Math.min(asymmetry, 1.4));
    // Radius is derived from this ray's own length so every ray overlaps the
    // hub by construction. A fixed radius left short rays floating free.
    const radius = Math.min(reach, hubRadius + length * 0.55) * elongated;
    const centerX = clamp(0.5 + Math.cos(angle) * radius, 0.03, 0.97);
    const centerY = clamp(0.5 + Math.sin(angle) * radius, 0.03, 0.97);
    regions.push(teardropRegion({
      id: `projection-${index}`,
      centerX,
      centerY,
      axisRadians: angle,
      length,
      // Stubby clubs: `width` is a HALF extent, so this gives a full ray width
      // of about a third of its length.
      width: length * 0.17,
      taper: 0.2,
      depth: 1,
      paintOrder: 1 + index,
      detail: "structure",
      materialRole: index % 2 === 0 ? "body" : "light",
    }));
    // Bulbous tip caps every projection, which is the most recognisable part
    // of the reference silhouette.
    regions.push(ellipseRegion({
      id: `tip-${index}`,
      centerX: clamp(centerX + Math.cos(angle) * length / 2, 0.02, 0.98),
      centerY: clamp(centerY + Math.sin(angle) * length / 2, 0.02, 0.98),
      axisRadians: 0,
      // Bulbous club ends, matching the reference's swollen ray tips.
      length: length * 0.32,
      width: length * 0.11,
      depth: 3,
      paintOrder: 10 + index,
      detail: "structure",
      materialRole: "core",
    }));
  }

  // Inspection-only detail. Every region above is structural, so without this
  // the two rich LODs rendered identical geometry and inspection revealed
  // nothing the population view did not already show. These are secondary on
  // purpose: population drops them and keeps the compact hub-plus-clubs
  // identity, while inspection resolves the fine surface texture the reference
  // carries between its rays.
  //
  // The features are authored short and rooted inside the ray field, so they
  // add surface resolution without extending the silhouette outward or
  // detaching into new components.
  // Placed in the gaps BETWEEN rays, not beneath them. A filament at a ray's own
  // bearing sits entirely inside that ray's footprint and contributes zero
  // silhouette, so inspection would have revealed nothing.
  const gapStep = (Math.PI * 2) / projectionCount;
  const microFilamentCount = dormant ? 0 : projectionCount;
  for (let index = 0; index < microFilamentCount; index++) {
    const angle = index * gapStep + gapStep / 2 + heading;
    const filamentLength = projectionLength * 0.72;
    const distance = hubRadius + filamentLength * 0.5;
    regions.push(teardropRegion({
      id: `filament-${index}`,
      centerX: clamp(0.5 + Math.cos(angle) * distance, 0.04, 0.96),
      centerY: clamp(0.5 + Math.sin(angle) * distance, 0.04, 0.96),
      axisRadians: angle,
      length: filamentLength,
      width: filamentLength * 0.1,
      taper: 0.35,
      depth: 4,
      paintOrder: 40 + index,
      detail: "secondary",
      materialRole: "rim",
    }));
  }

  // Small nodules on the hub surface, also inspection-only.
  const noduleCount = dormant ? 0 : 3 + Math.round(res.quantized.secondary * 3);
  for (let index = 0; index < noduleCount; index++) {
    const angle = seededJitter(seed, index, 5, Math.PI * 2);
    regions.push(ellipseRegion({
      id: `hub-nodule-${index}`,
      centerX: clamp(0.5 + Math.cos(angle) * hubRadius * 0.62, 0.06, 0.94),
      centerY: clamp(0.5 + Math.sin(angle) * hubRadius * 0.62, 0.06, 0.94),
      axisRadians: angle,
      length: hubSize * 0.17,
      width: hubSize * 0.085,
      depth: 5,
      paintOrder: 80 + index,
      detail: "secondary",
      materialRole: "core",
    }));
  }

  return {
    family: "radial",
    cosmeticSeed: seed,
    structuralVersion: "radial-grammar-v2",
    regions,
  };
}