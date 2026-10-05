import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { RenderSnapshot } from "../../packages/contracts/src/index.ts";
import { projectWorldPresentation } from "../../apps/explorer/src/experience/worldProjection.ts";

const snapshot = {
  tick: 10,
  worldId: 1,
  resources: {
    gridSize: 2,
    stock: [[0.5, 0.25, 0, 1], [1, 1, 0, 0], [0, 0.5, 0, 1]],
    capacity: [[1, 1, 0, 1], [1, 1, 0, 0], [1, 1, 1, 1]],
  },
  waste: {
    gridSize: 2,
    stock: [0.8, 0, 0, 0.4],
    capacity: [1, 1, 1, 1],
  },
  organisms: [
    { id: 1, activity: "active", cladeId: 1, byproductUse: 0, diet: 0, energy: 70 },
    { id: 2, activity: "dormant", cladeId: 1, byproductUse: 0, diet: 0, energy: 70 },
  ],
} as unknown as RenderSnapshot;

function testSnapshotProjectsNormalizedLocalFields() {
  const projection = projectWorldPresentation(snapshot);

  assert.equal(projection.gridSize, 2);
  assert.deepEqual([...projection.nutrients.a], [0.5, 0.25, 0, 1]);
  assert.deepEqual([...projection.nutrients.b], [1, 1, 0, 0]);
  assert.deepEqual([...projection.nutrients.c], [0, 0.5, 0, 1]);
  assert.deepEqual([...projection.waste], [...Float32Array.from([0.8, 0, 0, 0.4])]);
}

function testProjectionTracksChangedWasteOnlyAtChangedCells() {
  const before = projectWorldPresentation(snapshot);
  const cleared = {
    ...snapshot,
    waste: { ...snapshot.waste, stock: [0.2, 0, 0, 0.4] },
  } as RenderSnapshot;
  const after = projectWorldPresentation(cleared);

  assert.ok(Math.abs(before.waste[0]! - 0.8) < 1e-6);
  assert.ok(Math.abs(after.waste[0]! - 0.2) < 1e-6,
    "waste reduction follows authoritative stock/capacity");
  assert.equal(after.waste[1], before.waste[1], "unaffected cells remain unchanged");
  assert.equal(after.waste[3], before.waste[3], "other local deposits remain unchanged");
}

function testQuietEnvironmentProjectsNoResourceOrWasteLoad() {
  const quiet = {
    ...snapshot,
    resources: {
      ...snapshot.resources,
      stock: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
    },
    waste: { ...snapshot.waste, stock: [0, 0, 0, 0] },
  } as RenderSnapshot;
  const projection = projectWorldPresentation(quiet);
  assert.deepEqual([...projection.nutrients.a], [0, 0, 0, 0]);
  assert.deepEqual([...projection.waste], [0, 0, 0, 0]);
}

async function testDeterministicWorldVisualFixtures() {
  const fixturePath = new URL("./world-visual-fixtures.ts", import.meta.url);
  assert.ok(existsSync(fileURLToPath(fixturePath)), "deterministic World visual fixture builder exists");
  const {
    createWorldVisualFixtures,
    WORLD_VISUAL_CAPTURE_CASES,
    WORLD_VISUAL_CHROME_CAPTURE_CASES,
    WORLD_VISUAL_NATURAL_CAPTURE_ID,
    WORLD_VISUAL_BASELINE,
  } = await import("./world-visual-fixtures.ts");
  const first = createWorldVisualFixtures();
  const second = createWorldVisualFixtures();
  assert.deepEqual(first, second, "fixture input is deterministic across calls");
  assert.deepEqual([...new Set(first.families.map((fixture) => fixture.phenotype.family))].sort(),
    ["blob", "branching", "paddled", "plated", "radial", "segmented"], "fixture set includes all six resolved families");
  assert.ok(first.families.every((fixture) => fixture.family === fixture.phenotype.family),
    "each named family fixture carries a resolved phenotype from that family");
  assert.ok(first.familiesActive.every((fixture) => fixture.organism.activity === "active"),
    "a dedicated six-family silhouette frame keeps all family morphologies active");
  assert.deepEqual(first.familiesActive.map((fixture) => fixture.family),
    ["blob", "segmented", "radial", "plated", "branching", "paddled"],
    "the all-active silhouette frame includes every family in stable order");
  assert.ok(first.activity.organisms.some((organism) => organism.activity === "active"));
  assert.ok(first.activity.organisms.some((organism) => organism.activity === "dormant"));
  assert.deepEqual(first.activity.organisms.map((organism) => first.activity.resolvedPhenotypes.get(Number(organism.id))?.family),
    ["blob", "blob"], "active/dormant pair holds phenotype family constant");
  assert.ok(first.sparse.organisms.length < first.dense.organisms.length, "sparse and dense scenes differ in count");
  assert.equal(first.sparse.organisms.length, 24, "sparse fixture is a small colony");
  assert.equal(first.dense.organisms.length, 900, "dense fixture is crowded enough to review overlap without a population cap");
  assert.ok(first.rich.resources.stock[0]![0]! > first.depleted.resources.stock[0]![0]!,
    "rich and depleted fields differ in authoritative-shaped stock");
  assert.ok(Array.isArray(WORLD_VISUAL_CAPTURE_CASES), "deterministic capture case manifest is exported");
  assert.deepEqual(WORLD_VISUAL_CAPTURE_CASES.map((item) => item.id), [
    "phone-six-families-1x", "phone-six-families-active-1x", "phone-active-dormant", "phone-sparse", "phone-dense",
    "phone-rich", "phone-depleted", "desktop-sanity",
  ], "capture manifest has every required deterministic renderer fixture");
  assert.deepEqual(WORLD_VISUAL_CHROME_CAPTURE_CASES.map((item) => item.id), [
    "19-lane2-phone-shell-collapsed", "20-lane2-phone-shell-expanded", "21-lane2-desktop-shell",
  ], "paired App shell captures retain collapsed/expanded lens, minimap/zoom, and desktop composition");
  assert.ok(WORLD_VISUAL_CHROME_CAPTURE_CASES.every((item) =>
    item.viewport.width === (item.id.includes("desktop") ? 1280 : 390) && item.viewport.height === (item.id.includes("desktop") ? 900 : 844)),
    "App chrome captures retain the approved phone and desktop viewport dimensions");
  assert.equal(WORLD_VISUAL_NATURAL_CAPTURE_ID, "22-lane2-phone-natural-running-world",
    "capture set includes a separate natural running-world phone frame");
  assert.deepEqual(WORLD_VISUAL_BASELINE, {
    referenceSha: "fe90344464fd553d7cdef080da2cb53fdd620650",
    captureSha: "5ece8229f5a2980d62078cbb2c35ff74e3ff8f81",
    runId: 37250769500,
    artifact: "landscape-visual-evidence",
  }, "after-capture manifest explicitly identifies the exact approved baseline artifact");
  console.log("deterministic World visual fixtures: PASS");
}

async function main() {
  testSnapshotProjectsNormalizedLocalFields();
  testProjectionTracksChangedWasteOnlyAtChangedCells();
  testQuietEnvironmentProjectsNoResourceOrWasteLoad();
  await testDeterministicWorldVisualFixtures();
  console.log("world presentation projection: PASS");
}

void main();
