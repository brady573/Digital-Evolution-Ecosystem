import type { ResolvedPhenotype } from "../../model";
import type { ArtRegion, NormalizedPoint, StructuralArtRecipe } from "../types";

/**
 * Branching grammar v1 — a rooted, upward-growing colony.
 *
 * Structure is authored, not simulated: a fixed trunk/limb skeleton is placed
 * deterministically from the cosmetic seed, and resolved phenotype meaning
 * modulates only bounded presentation quantities. There is no growth search,
 * no iteration count derived from wall-clock or frame timing, and no new
 * biological field.
 *
 *   sensing (projection) — outward reach and limb spread
 *   specialization       — secondary offshoot count and controlled asymmetry
 *   mobility             — suppresses horizontal sprawl
 *
 * Dormancy is geometric here and only here: offshoots withdraw toward the
 * trunk and the colony compacts. Plated geometry stays activity-independent.
 */

interface BranchSite {
  readonly id: string;
  /** Where the segment attaches, as a fraction of its parent's length. */
  readonly parentAt: number;
  /** Outward heading relative to the parent's heading, in radians. */
  readonly branchAngle: number;
  /** Length as a fraction of the parent's length. */
  readonly lengthRatio: number;
  /** Width as a fraction of the parent's width. */
  readonly widthRatio: number;
  readonly depth: number;
  readonly detail: "structure" | "secondary";
}

/**
 * A rooted colony with an explicit hierarchy: one dominant trunk, limbs that
 * leave it at real angles, then terminal offshoots that thicken toward the
 * tips.
 *
 * Shape target is the accepted Branching family artwork: thick, fleshy, and
 * densely overlapping — closer to coral than to a bare winter tree. Width
 * therefore decays only gently along a chain and the terminal nodules are
 * substantial. The colony reads through overlap and mass, not through
 * separated strokes, so limb angles stay tight enough to keep the crown dense.
 */
// `branchAngle` is measured from the parent's own heading. The trunk already
// points up, so limbs only need a deflection from vertical — adding another
// -PI/2 here would invert them.
// Angles are large: the low limbs leave the trunk close to horizontal so the
// colony spreads sideways like the accepted artwork instead of forming a
// narrow upward V. Only the high limbs stay near vertical.
const LIMBS: readonly BranchSite[] = [
  { id: "trunk", parentAt: 0, branchAngle: 0, lengthRatio: 1, widthRatio: 1, depth: 0, detail: "structure" },
  { id: "limb-left-low", parentAt: 0.34, branchAngle: -0.86, lengthRatio: 0.6, widthRatio: 0.7, depth: 1, detail: "structure" },
  { id: "limb-right-low", parentAt: 0.4, branchAngle: 0.82, lengthRatio: 0.58, widthRatio: 0.68, depth: 1, detail: "structure" },
  { id: "limb-left-high", parentAt: 0.58, branchAngle: -0.6, lengthRatio: 0.78, widthRatio: 0.58, depth: 1, detail: "structure" },
  { id: "limb-right-high", parentAt: 0.68, branchAngle: 0.54, lengthRatio: 0.76, widthRatio: 0.56, depth: 1, detail: "structure" },
];

// Offshoots stay thick relative to their parent so the crown stays fleshy, and
// their deflection angles stay modest so branches overlap instead of splaying
// into an even fan.
const OFFSHOOTS: readonly BranchSite[] = [
  { id: "shoot-left-low-0", parentAt: 0.62, branchAngle: -0.5, lengthRatio: 0.72, widthRatio: 0.6, depth: 2, detail: "secondary" },
  { id: "shoot-left-low-1", parentAt: 0.84, branchAngle: -0.4, lengthRatio: 0.64, widthRatio: 0.56, depth: 2, detail: "secondary" },
  { id: "shoot-left-high-0", parentAt: 0.68, branchAngle: -0.44, lengthRatio: 0.68, widthRatio: 0.56, depth: 2, detail: "secondary" },
  { id: "shoot-right-low-0", parentAt: 0.6, branchAngle: 0.46, lengthRatio: 0.7, widthRatio: 0.58, depth: 2, detail: "secondary" },
  { id: "shoot-right-low-1", parentAt: 0.82, branchAngle: 0.38, lengthRatio: 0.62, widthRatio: 0.54, depth: 2, detail: "secondary" },
  { id: "shoot-right-high-0", parentAt: 0.7, branchAngle: 0.42, lengthRatio: 0.66, widthRatio: 0.54, depth: 2, detail: "secondary" },
  { id: "shoot-tip-left", parentAt: 0.9, branchAngle: -0.36, lengthRatio: 0.62, widthRatio: 0.52, depth: 3, detail: "secondary" },
  { id: "shoot-tip-right", parentAt: 0.88, branchAngle: 0.34, lengthRatio: 0.6, widthRatio: 0.5, depth: 3, detail: "secondary" },
];

export type BranchingActivity = "active" | "dormant";

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

interface Placement {
  readonly center: NormalizedPoint;
  readonly axisRadians: number;
  readonly length: number;
  readonly width: number;
  readonly taper: number;
}

/**
 * Dormant colonies keep their trunk and withdraw everything above it: offshoots
 * retract toward their attachment point and the whole crown compacts. Read as
 * monochrome, that reads as a closed, contracted colony rather than a bright
 * active one.
 */
function placeSite(
  site: BranchSite,
  parent: Placement | null,
  res: ResolvedPhenotype,
  activity: BranchingActivity,
  seedSlot: number,
  offshootIndex: number,
  offshootBudget: number,
): Placement | null {
  const seed = res.cosmeticSeed >>> 0;
  const dormant = activity === "dormant";

  // `offshootIndex` counts only secondary sites. A shared placement counter
  // would let the trunk and primary limbs consume the budget before any
  // offshoot was considered, so the expressed count would never match the
  // budget.
  if (site.detail === "secondary" && offshootIndex >= offshootBudget) return null;

  const specialization = res.quantized.asymmetry;
  const directional = res.dietSigned * 0.05 + res.habitatSigned * 0.02;
  // Sensing reaches the colony through the sensing axis and through the
  // quantized projection derived from it, so both carry the same bounded
  // outward term. Using only the quantized value made reach identical across a
  // whole sensing band.
  const reach = 1 + res.quantized.projection * 0.1 + res.axes.sensing * 0.08;
  // Mobility trades lateral spread for height rather than suppressing the body.
  const sprawlSuppression = 1 - res.axes.mobility * 0.22;
  const compaction = dormant ? 0.72 : 1;

  if (!parent) {
    // A short, thick trunk. The accepted family artwork is a fleshy mass
    // rather than a tall bare stem, so the trunk is wide and stubby and the
    // crown above it carries the height.
    const length = 0.72 * (0.94 + res.quantized.bulk * 0.08) * compaction;
    return {
      center: {
        x: clamp(0.5 + directional + jitter(seed, seedSlot, 0, 0.008), 0.28, 0.72),
        y: clamp(0.94 - length / 2, 0.2, 0.96),
      },
      axisRadians: -Math.PI / 2 + jitter(seed, seedSlot, 2, 0.05),
      length,
      width: 0.1 * (0.95 + res.quantized.density * 0.1) * compaction,
      taper: clamp(0.16 + specialization * 0.04, 0.08, 0.24),
    };
  }

  const parentDirection = parent.axisRadians;
  const direction = parentDirection + site.branchAngle * sprawlSuppression * (dormant ? 0.5 : 1);
  // `parentAt` is a 0..1 parameter along the parent measured from its base
  // (the -length/2 end), not a length that must be re-centred afterwards.
  const offset = (site.parentAt - 0.5) * parent.length;
  const attachX = parent.center.x + Math.cos(parentDirection) * offset;
  const attachY = parent.center.y + Math.sin(parentDirection) * offset;

  const length = parent.length * site.lengthRatio * (dormant ? 0.62 : 1) * reach;
  const rawX = attachX + Math.cos(direction) * length / 2;
  // Mobility damps horizontal displacement directly. Scaling only the branch
  // angle saturated at the frame clamp, so the fastest phenotypes were as wide
  // as the slowest and the trait had no visible effect.
  const center: NormalizedPoint = {
    x: clamp(0.5 + (rawX - 0.5) * sprawlSuppression, 0.04, 0.96),
    y: clamp(attachY + Math.sin(direction) * length / 2, 0.04, 0.96),
  };
  return {
    center,
    axisRadians: direction + jitter(seed, seedSlot, 2, 0.05),
    length,
    width: parent.width * site.widthRatio * (dormant ? 0.7 : 1),
    taper: clamp(parent.taper + 0.03 + specialization * 0.03, 0.12, 0.32),
  };
}

function regionsFor(
  res: ResolvedPhenotype,
  activity: BranchingActivity,
  seed: number,
): { regions: ArtRegion[]; placements: Map<string, Placement> } {
  // Offshoots are ordered so that the *left* branch groups claim the earlier
  // slots. Slicing the budget from the front otherwise keeps only left-side
  // offshoots and deletes the right side of the colony, which produced a
  // visibly one-sided silhouette at low specialization.
  const offshootBudget = activity === "dormant"
    ? 4
    : Math.max(4, Math.min(OFFSHOOTS.length,
      4 + Math.round(res.quantized.secondary * 3) + Math.round(res.quantized.asymmetry * 2)));
  const regions: ArtRegion[] = [];
  const placements = new Map<string, Placement>();
  let seedSlot = 0;
  let offshootIndex = 0;

  const emit = (site: BranchSite, parent: Placement | null) => {
    const placement = placeSite(site, parent, res, activity, seedSlot, offshootIndex, offshootBudget);
    seedSlot++;
    if (site.detail === "secondary") offshootIndex++;
    if (!placement) return null;
    placements.set(site.id, placement);
    regions.push({
      id: site.id,
      geometry: {
        kind: "teardrop",
        center: placement.center,
        axisRadians: placement.axisRadians,
        length: placement.length,
        width: placement.width,
        taper: placement.taper,
      },
      depth: site.depth,
      // Paint back-to-front: root first, crown last.
      paintOrder: site.depth * 8 + LIMBS.findIndex((limb) => limb.id.startsWith(site.id.split("-")[0]!)),
      detail: site.detail,
      materialRole: site.depth === 0 ? "deep-tissue" : site.depth === 1 ? "body" : "light",
    });
    return placement;
  };

  const trunk = emit(LIMBS[0]!, null);
  const limbs = new Map<string, Placement | null>();
  for (const site of LIMBS.slice(1)) {
    limbs.set(site.id, emit(site, trunk));
  }
  // Interleave so a reduced budget keeps both sides of the colony.
  const left = OFFSHOOTS.filter((site) => site.id.includes("left"));
  const right = OFFSHOOTS.filter((site) => site.id.includes("right"));
  const interleaved: BranchSite[] = [];
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    if (left[index]) interleaved.push(left[index]!);
    if (right[index]) interleaved.push(right[index]!);
  }
  for (const site of interleaved) {
    const parentId = site.id.includes("left") ? "limb-left-low"
      : site.id.includes("right") ? "limb-right-low"
        : "trunk";
    emit(site, limbs.get(parentId) ?? trunk);
  }

  // Terminal nodules cap the outermost placed offshoot on each side. They are
  // structural detail, not material accents, so they survive LOD reduction.
  const dormantCompaction = activity === "dormant" ? 0.62 : 1;
  for (const [id, placement] of placements) {
    if (!id.startsWith("shoot-")) continue;
    const tipX = clamp(placement.center.x + Math.cos(placement.axisRadians) * placement.length / 2, 0.06, 0.94);
    const tipY = clamp(placement.center.y + Math.sin(placement.axisRadians) * placement.length / 2, 0.06, 0.94);
    regions.push({
      id: `${id}-nodule`,
      geometry: {
        kind: "ellipse",
        center: { x: tipX, y: tipY },
        axisRadians: 0,
        // Bulbous, unevenly sized caps: the terminal-node rhythm is the most
        // recognisable part of the accepted artwork.
        length: (0.062 + jitter(seed, regions.length, 4, 0.018))
          * (0.9 + res.quantized.density * 0.2) * (dormantCompaction),
        width: (0.056 + jitter(seed, regions.length, 5, 0.016))
          * (0.9 + res.quantized.density * 0.2) * (dormantCompaction),
        taper: 0,
      },
      depth: placement === undefined ? 3 : 4,
      paintOrder: 60 + regions.length,
      detail: "structure",
      materialRole: "core",
    });
  }

  void seed;
  return { regions, placements };
}

/** Build one immutable Branching structural recipe for an activity state. */
export function buildBranchingRecipe(
  res: ResolvedPhenotype,
  activity: BranchingActivity = "active",
): StructuralArtRecipe {
  if (res.family !== "branching") {
    throw new Error(`Branching grammar only supports branching phenotypes (got ${res.family})`);
  }
  const seed = res.cosmeticSeed >>> 0;
  const { regions } = regionsFor(res, activity, seed);
  return {
    family: "branching",
    cosmeticSeed: seed,
    structuralVersion: "branching-grammar-v1",
    regions,
  };
}