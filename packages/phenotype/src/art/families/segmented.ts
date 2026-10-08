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
 * Segmented grammar — one coherent articulated directional chain.
 *
 * Reference direction: a coral/salmon chain of distinct rounded segments with
 * small ringed cilia, differentiated head and tail. Segments are laid along a
 * single spine so the body reads as one articulated animal: every segment
 * overlaps its neighbour, and the spine is continuous even when it curls.
 *
 * Speed drives aspect ratio and segment expression, sensing drives leading-end
 * emphasis and cilia, reproduction threshold adds segment mass only, and
 * dormancy curls and compresses the whole chain.
 */

const SEGMENT_COUNT = 7;

export function buildSegmentedRecipe(res: ResolvedPhenotype, activity: StemActivity = "active"): StructuralArtRecipe {
  assertFamily("segmented", res.family);
  const seed = res.cosmeticSeed >>> 0;
  const dormant = activity === "dormant";

  // The measured reference principal axis is 127.6 degrees in raster coordinates
  // (y grows downward), which is a math heading of about 0.92 radians. Diet
  // contributes only a bounded adjustment around that canonical pose.
  const heading = 0.6 + res.dietSigned * 0.15;
  const cosine = Math.cos(heading);
  const sine = Math.sin(heading);

  // Speed stretches the chain along its axis.
  const aspect = 1 + res.quantized.elongation * 0.5;
  // Reproduction threshold adds modest segment mass, nothing else.
  const mass = 1 + res.quantized.bulk * 0.12;
  // Dormancy compresses and curls.
  const compression = dormant ? 0.78 : 1;
  const curl = dormant ? 0.85 : 0;

  const regions: ArtRegion[] = [];
  const spine: Array<{ x: number; y: number }> = [];
  for (let index = 0; index < SEGMENT_COUNT; index++) {
    const t = index / (SEGMENT_COUNT - 1);
    // Dormant shortens the chain as well as bending it. Bending alone swung the
    // beads around the arc until they separated, which broke the "segments stay
    // connected" requirement; compression keeps them overlapping.
    // The chain must fit inside the frame. A span of 0.86 pushed the tail's center
    // into the edge clamp at cx 0.08, severing it into a second silhouette
    // component; the reference measures as one connected piece.
    // The measured reference is rounder than a straight rod (descriptor 0.45 on a
// 0 = line, 1 = circle scale), so the chain span stays short relative to the
  // bead size.
  const along = (t - 0.5) * (dormant ? 0.42 : 0.5 * aspect) * compression;
    const bend = dormant ? Math.sin(t * Math.PI) * 0.16 : 0;
    spine.push({
      x: clamp(0.5 + (along * cosine - bend * sine) + seededJitter(seed, index, 0, 0.008), 0.08, 0.92),
      y: clamp(0.5 + (along * sine + bend * cosine) + seededJitter(seed, index, 1, 0.008), 0.08, 0.92),
    });
  }

  spine.forEach((point, index) => {
    // The head is the leading segment: larger, and sensing gives it emphasis.
    const isHead = index === SEGMENT_COUNT - 1;
    const isTail = index === 0;
    // Slimmer beads: the measured reference fills 0.32 of its bounding box.
    const base = isHead ? 0.12 : isTail ? 0.08 : 0.095;
    const length = base * compression * (1 + res.quantized.secondary * 0.1)
      * (isHead ? 1 + res.quantized.projection * 0.18 : 1);
    regions.push(ellipseRegion({
      id: `segment-${index}`,
      centerX: point.x,
      centerY: point.y,
      axisRadians: heading,
       length: length * 1.7 * mass,
       // Slimmer beads. At half-width 0.9 the chain measured elongation 0.27
       // against the reference's 0.45 — the beads were so wide they fused into
       // one round mass, which also made the principal axis meaningless.
      // `length` is a full extent and `width` is a HALF extent; halving here is
      // what leaves a visible cleft between neighbouring beads.
       width: length * mass * 0.66,
      depth: index === SEGMENT_COUNT - 1 ? 2 : 1,
      paintOrder: index,
      detail: "structure",
      materialRole: index % 2 === 0 ? "body" : "light",
    }));
  });

  // Cilia ring each segment. Sensing controls how many and how long they are,
  // so the leading end reads as the sensing end.
  // Two or three cilia per segment. More, plus longer ones, buried the beads
  // under the filaments and read as a spiky caterpillar rather than the
  // reference's pearl chain with delicate fringe.
  const ciliaPerSegment = 2 + Math.round(res.quantized.projection * 1.5);
  if (!dormant) {
    spine.forEach((point, index) => {
      const leading = index / (SEGMENT_COUNT - 1);
      const count = ciliaPerSegment + (leading > 0.7 ? 1 : 0);
      for (let index2 = 0; index2 < count; index2++) {
        const side = index2 % 2 === 0 ? 1 : -1;
        const offset = (index2 / count - 0.5) * 1.2;
        const angle = heading + Math.PI / 2 * side + offset * 0.5;
        regions.push(teardropRegion({
          id: `cilia-${index}-${index2}`,
          centerX: clamp(point.x + Math.cos(heading + Math.PI / 2 * side) * 0.045, 0.02, 0.98),
          centerY: clamp(point.y + Math.sin(heading + Math.PI / 2 * side) * 0.045, 0.02, 0.98),
          axisRadians: angle,
          // Long, delicate filaments, rooted close to the segment surface.
          // Delicate filaments, shorter than the beads. Long cilia crossed over the
          // neighbouring segments and merged into one continuous spiky mass.
          length: (0.11 + res.quantized.projection * 0.04) * (0.7 + leading * 0.5),
          width: 0.012,
          taper: 0.24,
          depth: 3,
          paintOrder: 20 + index * 4 + index2,
          detail: "secondary",
          materialRole: "rim",
        }));
      }
    });
  }

  // A terminal nodule caps the leading end so the head reads at LOD distance.
  const head = spine[spine.length - 1]!;
  regions.push(ellipseRegion({
    id: "head-nodule",
    centerX: clamp(head.x + cosine * 0.04, 0.04, 0.96),
    centerY: clamp(head.y + sine * 0.04, 0.04, 0.96),
    axisRadians: 0,
    length: 0.06 * compression,
    width: 0.03 * compression,
    depth: 4,
    paintOrder: 60,
    detail: "structure",
    materialRole: "core",
  }));

  return {
    family: "segmented",
    cosmeticSeed: seed,
    structuralVersion: "segmented-grammar-v1",
    regions,
  };
}
