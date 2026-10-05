import {
  READ_MODEL_VERSION,
  cladeId,
  lineageId,
  organismId,
  worldId,
  type RenderOrganism,
  type WorldEnvironmentFrame,
} from "../../packages/contracts/src/index.ts";
import {
  FAMILY_ORDER,
  resolvePhenotype,
  type PhenotypeFamily,
  type ResolvedPhenotype,
} from "../../packages/phenotype/src/index.ts";

export interface FamilyFixture {
  readonly family: PhenotypeFamily;
  readonly organism: RenderOrganism;
  readonly phenotype: ResolvedPhenotype;
}

export interface OrganismSceneFixture {
  readonly organisms: readonly RenderOrganism[];
  readonly resolvedPhenotypes: ReadonlyMap<number, ResolvedPhenotype>;
}

export interface WorldVisualFixtures {
  readonly families: readonly FamilyFixture[];
  readonly activity: OrganismSceneFixture;
  readonly sparse: OrganismSceneFixture;
  readonly dense: OrganismSceneFixture;
  readonly rich: WorldEnvironmentFrame;
  readonly depleted: WorldEnvironmentFrame;
}

export const WORLD_VISUAL_CAPTURE_CASES = [
  { id: "phone-six-families-1x", scene: "families", environment: "rich", viewport: "phone", zoom: 1 },
  { id: "phone-active-dormant", scene: "activity", environment: "rich", viewport: "phone", zoom: 1 },
  { id: "phone-sparse", scene: "sparse", environment: "rich", viewport: "phone", zoom: 1 },
  { id: "phone-dense", scene: "dense", environment: "rich", viewport: "phone", zoom: 1 },
  { id: "phone-rich", scene: "sparse", environment: "rich", viewport: "phone", zoom: 1 },
  { id: "phone-depleted", scene: "sparse", environment: "depleted", viewport: "phone", zoom: 1 },
  { id: "desktop-sanity", scene: "families", environment: "rich", viewport: "desktop", zoom: 1 },
] as const;

export type WorldVisualCaptureCase = (typeof WORLD_VISUAL_CAPTURE_CASES)[number];
export type WorldVisualScene = "families" | "activity" | "sparse" | "dense";

export const WORLD_VISUAL_CHROME_CAPTURE_CASES = [
  { id: "19-lane2-phone-shell-collapsed", viewport: { width: 390, height: 844 }, lens: "collapsed" },
  { id: "20-lane2-phone-shell-expanded", viewport: { width: 390, height: 844 }, lens: "expanded" },
  { id: "21-lane2-desktop-shell", viewport: { width: 1280, height: 900 }, lens: "collapsed" },
] as const;

export const WORLD_VISUAL_NATURAL_CAPTURE_ID = "22-lane2-phone-natural-running-world" as const;

export const WORLD_VISUAL_BASELINE = {
  referenceSha: "fe90344464fd553d7cdef080da2cb53fdd620650",
  captureSha: "5ece8229f5a2980d62078cbb2c35ff74e3ff8f81",
  runId: 37250769500,
  artifact: "landscape-visual-evidence",
} as const;

const FAMILY_TRAITS: Record<PhenotypeFamily, readonly [number, number, number, number, number, number]> = {
  blob: [0.35, 0.45, 0.4, 0.3, 0.45, 0],
  segmented: [0.7, 0.45, 0.5, 0.3, 0.3, 0],
  radial: [0.3, 0.82, 0.45, 0.3, 0, 0],
  plated: [0.3, 0.35, 0.78, 0.3, 0.3, 0],
  branching: [0.2, 0.76, 0.45, 1.5, 1.5, 0.5625],
  paddled: [0.88, 0.62, 0.72, 0.3, 0, 0],
};

function organism(
  id: number,
  x: number,
  y: number,
  activity: "active" | "dormant" = "active",
  family: PhenotypeFamily = FAMILY_ORDER[(id - 1) % FAMILY_ORDER.length]!,
): RenderOrganism {
  const [mobility, sensingNorm, metabolismNorm, diet, habitat, byproductUse] = FAMILY_TRAITS[family];
  return {
    id: organismId(id),
    parent: null,
    generation: 0,
    lineageId: lineageId(id + 1),
    cladeId: cladeId((id % 5) + 1),
    x,
    y,
    energy: 80,
    activity,
    speed: 0.25 + mobility * 3.75,
    sensing: 10 + sensingNorm * 170,
    metabolism: 0.04 + metabolismNorm * 0.46,
    reproduction: 100,
    diet,
    habitat,
    byproductUse,
    dormancyResponse: 1.2,
    tolerance: 0.5,
    cleanup: 0.5,
  };
}

function resolveFor(row: RenderOrganism, family: PhenotypeFamily): ResolvedPhenotype {
  return resolvePhenotype(row, { parentFamily: family, organismId: Number(row.id), lineageId: Number(row.lineageId) });
}

function scene(count: number): OrganismSceneFixture {
  const organisms = Array.from({ length: count }, (_, index) => {
    const column = index % Math.ceil(Math.sqrt(count));
    const row = Math.floor(index / Math.ceil(Math.sqrt(count)));
    const stride = 600 / (Math.ceil(Math.sqrt(count)) + 1);
    return organism(index + 1, stride * (column + 1), stride * (row + 1), index % 4 === 0 ? "dormant" : "active");
  });
  const resolvedPhenotypes = new Map<number, ResolvedPhenotype>(organisms.map((row) => {
    const family = FAMILY_ORDER[(Number(row.id) - 1) % FAMILY_ORDER.length]!;
    return [Number(row.id), resolveFor(row, family)];
  }));
  return { organisms, resolvedPhenotypes };
}

function environment(resourceScale: number): WorldEnvironmentFrame {
  const size = 60;
  const cells = size * size;
  const capacity = Array.from({ length: 3 }, () => Array<number>(cells).fill(1));
  const stock = Array.from({ length: 3 }, (_, kind) => Array.from({ length: cells }, (_, index) => {
    const x = index % size;
    const y = Math.floor(index / size);
    const patch = ((x * 17 + y * 29 + kind * 11) % 101) / 100;
    return resourceScale * (0.12 + 0.16 * patch);
  }));
  const wasteCapacity = Array<number>(cells).fill(1);
  const wasteStock = Array<number>(cells).fill(0);
  return {
    readModelVersion: READ_MODEL_VERSION,
    worldId: worldId(1),
    tick: 100,
    resources: { gridSize: size, stock, capacity },
    waste: { gridSize: size, stock: wasteStock, capacity: wasteCapacity },
  };
}

/** Fixed presentation-only fixture set; it never advances or mutates a simulation. */
export function createWorldVisualFixtures(): WorldVisualFixtures {
  const families = FAMILY_ORDER.map((family, index) => {
    const row = organism(index + 1, 300 + (index - 2.5) * 18, 300, index % 2 ? "dormant" : "active", family);
    return { family, organism: row, phenotype: resolveFor(row, family) };
  });
  const active = organism(101, 290, 300, "active", "blob");
  const dormant = organism(102, 310, 300, "dormant", "blob");
  const activity = {
    organisms: [active, dormant],
    resolvedPhenotypes: new Map([
      [Number(active.id), resolveFor(active, "blob")],
      [Number(dormant.id), resolveFor(dormant, "blob")],
    ]),
  };
  return {
    families,
    activity,
    sparse: scene(24),
    dense: scene(900),
    rich: environment(1),
    depleted: environment(0),
  };
}
