import assert from "node:assert/strict";
import { VoxelWorld } from "./src/index.ts";
import type { VoxelConfig } from "./src/index.ts";

const base: Omit<VoxelConfig, "seed" | "regen" | "pressure"> = {
  width: 64,
  height: 96,
  population: 60,
  patchiness: 0.6,
  variety: 0.5,
  mutationChance: 0.05,
  mutationSize: 0.12,
};

// 1. Determinism: same seed must replay bit-identically (coarse hash).
for (const seed of [821947219, 123456789]) {
  const a = new VoxelWorld({ ...base, seed, regen: 0.02, pressure: 1.0 });
  const b = new VoxelWorld({ ...base, seed, regen: 0.02, pressure: 1.0 });
  for (let i = 0; i < 5000; i++) {
    a.step();
    b.step();
  }
  assert.equal(a.hash(), b.hash(), `seed ${seed} must replay identically`);
  assert.notEqual(
    new VoxelWorld({ ...base, seed: seed + 1, regen: 0.02, pressure: 1.0 }).hash(),
    a.hash(),
    "sanity: hash function must discriminate",
  );
}
console.log("determinism: PASS");

// 2. Emergence smoke: regimes must separate, C must be eaten somewhere,
// dormancy must appear somewhere, diets must diverge somewhere.
const regimes = [
  { name: "rich", regen: 0.03, pressure: 0.85 },
  { name: "balanced", regen: 0.025, pressure: 1.0 },
  { name: "harsh", regen: 0.012, pressure: 1.35 },
];
const finals: Record<string, number[]> = {};
let sawC = false;
let sawDormant = false;
let sawSpread = false;
for (const r of regimes) {
  finals[r.name] = [];
  for (const seed of [821947219, 2088626459]) {
    const w = new VoxelWorld({ ...base, seed, regen: r.regen, pressure: r.pressure });
    let dorm = 0;
    for (let i = 0; i < 20000; i++) {
      w.step();
      if (i % 2000 === 0) {
        const m = w.metrics();
        dorm = Math.max(dorm, m.dormant);
        if (m.cShare > 0.02) sawC = true;
        if (m.dietSpread > 0.5) sawSpread = true;
      }
    }
    const m = w.metrics();
    finals[r.name]!.push(m.population);
    if (dorm > 0) sawDormant = true;
    console.log(`${r.name}/${seed}: pop=${m.population} dormant=${m.dormant} cShare=${m.cShare.toFixed(3)} spread=${m.dietSpread.toFixed(2)}`);
  }
}
const means = Object.fromEntries(Object.entries(finals).map(([k, v]) => [k, v.reduce((a, b) => a + b, 0) / v.length]));
console.log("regime means:", means);
assert.ok(new Set(Object.values(means).map((v) => Math.round(v))).size > 1, "regimes must separate");
assert.ok(sawC, "C consumption must emerge somewhere");
assert.ok(sawDormant, "dormancy must appear somewhere");
assert.ok(sawSpread, "diet divergence must appear somewhere");
console.log("voxel spike: PASS");
