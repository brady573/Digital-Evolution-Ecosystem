import assert from "node:assert/strict";
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

testSnapshotProjectsNormalizedLocalFields();
testProjectionTracksChangedWasteOnlyAtChangedCells();
testQuietEnvironmentProjectsNoResourceOrWasteLoad();
console.log("world presentation projection: PASS");
