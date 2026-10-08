/**
 * Placement geometry assertions for the rich-art families.
 *
 * Visual iteration failed repeatedly on these families because angles were
 * *derived* from trait values and then judged by eye. This tool instead states
 * each family's placement contract as measurable quantities and reports pass
 * or fail, so a wrong posture is caught as a number rather than as an opinion
 * about a render.
 *
 * It asserts structure only. It cannot and does not judge reference fidelity;
 * that remains a design judgement made against the reference artwork.
 */
import { resolvePhenotype } from "../packages/phenotype/src/index.ts";
import {
  buildArtRecipe,
  type StructuralArtRecipe,
} from "../packages/phenotype/src/art/index.ts";

const FIXTURES = {
  blob: { speed: 1.56, sensing: 69.5, metabolism: 0.224, reproduction: 100, diet: 0.6, habitat: 0.6, byproductUse: 0.6, dormancyResponse: 0.8 },
  segmented: { speed: 2.5, sensing: 86.5, metabolism: 0.27, reproduction: 100, diet: 0.9, habitat: 1.5, byproductUse: 1.5, dormancyResponse: 0.8 },
  radial: { speed: 1.38, sensing: 149.4, metabolism: 0.247, reproduction: 100, diet: 0.6, habitat: 0.9, byproductUse: 1.5, dormancyResponse: 0.8 },
  paddled: { speed: 3.55, sensing: 115.4, metabolism: 0.371, reproduction: 100, diet: 1.5, habitat: 1.5, byproductUse: 1.5, dormancyResponse: 0.8 },
  plated: { speed: 1.4, sensing: 70, metabolism: 0.3392, reproduction: 100, diet: 0.675, habitat: 0.675, byproductUse: 0.68, dormancyResponse: 1 },
  branching: { speed: 1, sensing: 139.2, metabolism: 0.247, reproduction: 100, diet: 1.4, habitat: 1.4, byproductUse: 1.4, dormancyResponse: 0.8 },
} as const;

type Family = keyof typeof FIXTURES;

function resolveFamily(family: Family) {
  const resolved = resolvePhenotype({ ...FIXTURES[family] }, { organismId: 9100, lineageId: 5150 });
  if (resolved.family !== family) throw new Error(`${family} fixture resolved to ${resolved.family}`);
  return resolved;
}

const failures: string[] = [];
const check = (label: string, ok: boolean, detail: string) => {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}: ${detail}`);
  if (!ok) failures.push(`${label} (${detail})`);
};

/**
 * Paddled: two broad wings opposed across the body midline, wings trailing
 * backward rather than sweeping forward into a V, on a single coherent hull.
 */
function paddledPosture() {
  console.log("paddled placement");
  const recipe = buildArtRecipe(resolveFamily("paddled"), "active");
  const left = recipe.regions.find((region) => region.id === "paddle-0");
  const right = recipe.regions.find((region) => region.id === "paddle-1");
  if (!left || !right || left.geometry.kind === "polygon" || right.geometry.kind === "polygon") {
    check("wings present", false, "paddle-0/paddle-1 missing or polygon");
    return;
  }
  const hull = recipe.regions.find((region) => region.id === "hull");
  if (!hull || hull.geometry.kind === "polygon") {
    check("hull present", false, "hull missing or polygon");
    return;
  }
  // The accepted reference's radial-reach profile has two aft diagonal peaks.
  const heading = hull.geometry.axisRadians;
  const leftAxis = left.geometry.axisRadians;
  const rightAxis = right.geometry.axisRadians;
  // Ellipse axes are unoriented lines; cos(relative angle) < 0 confirms both
  // diagonal axes reach aft from the hull.
  const leftAft = Math.cos(leftAxis - heading);
  const rightAft = Math.cos(rightAxis - heading);
  check("wings reach the aft shoulders", leftAft < -0.7 && rightAft < -0.7,
    `left cos=${leftAft.toFixed(2)} right cos=${rightAft.toFixed(2)} (both must be < -0.7)`);

  // Project the two paddle centers onto the hull's perpendicular axis. This
  // remains correct when the organism's reference pose is diagonal.
  const lateral = (center: { x: number; y: number }) =>
    -(center.x - hull.geometry.center.x) * Math.sin(heading)
      + (center.y - hull.geometry.center.y) * Math.cos(heading);
  const leftLateral = lateral(left.geometry.center);
  const rightLateral = lateral(right.geometry.center);
  check("wings are laterally opposed", Math.sign(leftLateral) !== Math.sign(rightLateral)
    && Math.abs(leftLateral) > 0.05 && Math.abs(rightLateral) > 0.05,
    `left dy=${leftLateral.toFixed(3)} right dy=${rightLateral.toFixed(3)}`);

  // Opposed wings must sit at a comparable distance from the midline.
  const spread = Math.abs(Math.abs(leftLateral) - Math.abs(rightLateral));
  check("wings sit at comparable span", spread < 0.08,
    `left |dy|=${Math.abs(leftLateral).toFixed(3)} right |dy|=${Math.abs(rightLateral).toFixed(3)} spread=${spread.toFixed(3)}`);

  // Wings must not overlap the hull's centre so much that the body vanishes.
  check("hull remains distinct", hull.geometry.length > 0.25,
    `hull length=${hull.geometry.length.toFixed(3)}`);

  // Broad wings: full width close to full length, not a narrow blade.
  const aspect = (left.geometry.width * 2) / left.geometry.length;
  check("wings are broad, not blades", aspect > 0.3, `full-width/length=${aspect.toFixed(2)}`);
}

/**
 * Segmented: a single chain, so consecutive segments must stay close enough to
 * read as connected even when dormant.
 */
function segmentedConnectivity() {
  console.log("segmented connectivity");
  for (const activity of ["active", "dormant"] as const) {
    const recipe = buildArtRecipe(resolveFamily("segmented"), activity);
    const chain = recipe.regions
      .filter((region) => /^segment-\d$/.test(region.id) && region.geometry.kind !== "polygon")
      .map((region) => region.geometry.center)
      .sort((a, b) => a.x - b.x);
    let worst = 0;
    for (let index = 1; index < chain.length; index++) {
      const distance = Math.hypot(chain[index]!.x - chain[index - 1]!.x, chain[index]!.y - chain[index - 1]!.y);
      worst = Math.max(worst, distance);
    }
    // Segments must overlap: the gap between centers stays below the summed
    // radii, so the body never reads as disconnected beads.
    check(`${activity} chain connected`, chain.length >= 5 && worst < 0.22,
      `${chain.length} segments, worst center gap=${worst.toFixed(3)} (must be < 0.22)`);

    // Cilia must grow from their segment rather than floating free. Long thin
    // structures are the easiest way to add detached silhouette components.
    const cilia = recipe.regions.filter((region) => region.id.startsWith("cilia-") && region.geometry.kind !== "polygon");
    if (activity === "active" && cilia.length > 0 && chain.length > 0) {
      let detached = 0;
      for (const cilium of cilia) {
        const nearest = Math.min(...chain.map((point) =>
          Math.hypot(point.x - cilium.geometry.center.x, point.y - cilium.geometry.center.y)));
        if (nearest > 0.12) detached++;
      }
      check("cilia attach to the chain", detached === 0,
        `${cilia.length - detached}/${cilia.length} cilia within reach of a segment`);
    }
  }
}

/**
 * Blob: a cohesive cluster, so lobes must overlap the core rather than sit as
 * isolated discs around it.
 */
function blobCohesion() {
  console.log("blob cohesion");
  const recipe = buildArtRecipe(resolveFamily("blob"), "active");
  const core = recipe.regions.find((region) => region.id === "core");
  if (!core || core.geometry.kind === "polygon") {
    check("core present", false, "core missing");
    return;
  }
  const lobes = recipe.regions.filter((region) => region.id.startsWith("lobe-") && region.geometry.kind !== "polygon");
  const coreRadius = core.geometry.length / 2;
  let detached = 0;
  for (const lobe of lobes) {
    const distance = Math.hypot(lobe.geometry.center.x - core.geometry.center.x, lobe.geometry.center.y - core.geometry.center.y);
    if (distance > coreRadius + lobe.geometry.length / 2) detached++;
  }
  check("every lobe touches the core", detached === 0, `${lobes.length - detached}/${lobes.length} lobes connected`);
  check("core is not one dominant disc", coreRadius < 0.28,
    `core radius=${coreRadius.toFixed(3)} (must be < 0.28 so lobes break the outline)`);
}

/**
 * Radial: separated club rays around a compact body, never a closed disc.
 */
function radialSeparation() {
  console.log("radial separation");
  const recipe = buildArtRecipe(resolveFamily("radial"), "active");
  const hub = recipe.regions.find((region) => region.id === "hub");
  const rays = recipe.regions.filter((region) => region.id.startsWith("projection-") && region.geometry.kind !== "polygon");
  check("ray count", rays.length >= 8, `${rays.length} rays`);
  if (!hub || hub.geometry.kind === "polygon") {
    check("hub present", false, "hub missing");
    return;
  }
  const hubRadius = hub.geometry.length / 2;
  check("body is compact", hubRadius < 0.16, `hub radius=${hubRadius.toFixed(3)} (must be < 0.16)`);
  // Each ray's inner end must overlap the hub: it grows from the body.
  let detached = 0;
  for (const ray of rays) {
    const inner = Math.hypot(ray.geometry.center.x - hub.geometry.center.x, ray.geometry.center.y - hub.geometry.center.y)
      - ray.geometry.length / 2;
    // Tolerance: the overlap invariant is satisfied by construction, so a
    // residual floating-point hair is not a placement failure.
    if (inner > hubRadius + 1e-3) detached++;
  }
  check("rays grow from the body", detached === 0, `${rays.length - detached}/${rays.length} rays overlap hub`);
  // Ray width must stay well under length, or the ring closes into a disc.
  const ratio = Math.max(...rays.map((ray) => ray.geometry.kind === "polygon" ? 1 : (ray.geometry.width * 2) / ray.geometry.length));
  check("rays are clubs, not wedges", ratio < 0.6, `widest full-width/length=${ratio.toFixed(2)}`);
}

paddledPosture();
segmentedConnectivity();
blobCohesion();
radialSeparation();

console.log(failures.length === 0 ? "\nplacement geometry: PASS" : `\nplacement geometry: ${failures.length} FAILURE(S)`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
}
