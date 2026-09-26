import assert from "node:assert/strict";
import {
  LandscapeSmoother, cellFractions, landscapeCell, microTexture,
  nutrientOverlayCell, wasteOverlayCell,
} from "../../apps/explorer/src/landscape.ts";
import type { RenderResourceField, RenderWasteField } from "../../packages/contracts/src/index.ts";

/**
 * Issue #30 Slice 2 product integration: presentation-only landscape rules.
 *
 * These are the properties the design review required to be provable rather
 * than asserted: universe isolation, priming from real fields (never from a
 * fictitious zero world), and honest per-lens encodings. Everything here is
 * presentation; nothing in this file can reach biology.
 */

const N = 16;
const CELLS = N * N;

function field(value: (i: number) => number): Float32Array {
  const out = new Float32Array(CELLS);
  for (let i = 0; i < CELLS; i++) out[i] = value(i);
  return out;
}

function testPrimesFromRealFields() {
  // Blocker 2: a newly created or restored PAUSED world must show its real
  // environment on the first frame, not a 35% blend from zero.
  const a = field((i) => (i % N) / N);
  const b = field((i) => ((i * 7) % N) / N);
  const c = field((i) => ((i * 13) % N) / N);
  const w = field((i) => ((i * 3) % N) / N);
  const s = new LandscapeSmoother(CELLS);
  const first = s.advance("w1", 0, a, b, c, w, 0.35);
  assert.ok(s.primed, "first observation primes the buffer");
  for (let i = 0; i < CELLS; i++) {
    const j = i * 4;
    assert.equal(first[j]!, a[i]!, "prime copies nutrient A exactly");
    assert.equal(first[j + 1]!, b[i]!, "prime copies nutrient B exactly");
    assert.equal(first[j + 2]!, c[i]!, "prime copies Metabolite C exactly");
    assert.equal(first[j + 3]!, w[i]!, "prime copies waste exactly");
  }
  // A paused world (same tick again) still shows the true field, not a decay.
  const second = s.advance("w1", 0, a, b, c, w, 0.35);
  for (let i = 0; i < CELLS; i++) assert.equal(second[i * 4]!, a[i]!, "paused frame holds the real field");
  console.log("landscape primes from real fields: PASS");
}

function testUniverseIsolation() {
  // Blocker 1: two universes sharing seed AND config must not share inertia.
  const warm = field(() => 0.9);
  const cold = field(() => 0.05);
  const s = new LandscapeSmoother(CELLS);
  s.advance("w1", 500, warm, warm, warm, warm, 0.35);
  const other = s.advance("w2", 900, cold, cold, cold, cold, 0.35);
  for (let i = 0; i < CELLS; i++) {
    assert.ok(Math.abs(other[i * 4]! - 0.05) < 1e-6, "second universe primes from its own field, not the first's inertia");
  }
  // And the first universe is not corrupted by visiting the second.
  const back = s.advance("w1", 900, warm, warm, warm, warm, 0.35);
  for (let i = 0; i < CELLS; i++) {
    assert.ok(Math.abs(back[i * 4]! - 0.9) < 1e-6, "returning to a universe re-primes rather than decaying");
  }
  console.log("landscape universe isolation: PASS");
}

function testRewindReprimes() {
  // Scrubbing backwards must not interpolate a world through its future.
  const early = field(() => 0.2);
  const late = field(() => 0.8);
  const s = new LandscapeSmoother(CELLS);
  s.advance("w1", 900, late, late, late, late, 0.35);
  const back = s.advance("w1", 100, early, early, early, early, 0.35);
  for (let i = 0; i < CELLS; i++) assert.ok(Math.abs(back[i * 4]! - 0.2) < 1e-6, "rewind shows the state the world is actually in");
  console.log("landscape rewind re-primes: PASS");
}

function testBoundedAndMonotonic() {
  // Inertia may soften arrival; it may not overshoot or invent a field.
  const s = new LandscapeSmoother(CELLS);
  const from = field(() => 0);
  const to = field(() => 1);
  let prev = 0;
  s.advance("w1", 0, from, from, from, from, 0.35);
  for (let t = 1; t <= 20; t++) {
    const v = s.advance("w1", t, to, to, to, to, 0.35);
    const value = v[0]!;
    assert.ok(value >= prev - 1e-6, "approach is monotonic");
    assert.ok(value <= 1 + 1e-6, "approach never overshoots the true field");
    prev = value;
  }
  assert.ok(prev > 0.99, "sustained change still converges to the real field");
  console.log("landscape bounded and monotonic: PASS");
}

const luma = (c: readonly [number, number, number]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const chroma = (c: readonly [number, number, number]) => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);

function testLensEncodingsAreHonest() {
  // Waste moves the ground toward ash: a near-neutral, low-chroma, warm
  // mid-tone. It deliberately does NOT simply darken — dark degradation
  // reads as a hole in the world and hides the organisms standing in it —
  // and it does not simply brighten either, because it must not compete with
  // fertility for "bright means good". The analytical view is a separate
  // encoding (a brighter exact ramp) and the UI note describes each.
  const clean = landscapeCell(0.4, 0.4, 0.1, 0, 0.5);
  const loaded = landscapeCell(0.4, 0.4, 0.1, 0.9, 0.5);
  const ASH = [116, 107, 96];
  const dist = (c: readonly [number, number, number]) =>
    Math.abs(c[0] - ASH[0]!) + Math.abs(c[1] - ASH[1]!) + Math.abs(c[2] - ASH[2]!);
  assert.ok(dist(loaded) < dist(clean), "landscape: waste moves ground toward ash");
  // Desaturation is relative: ash keeps a warm tint but carries less colour
  // per unit brightness, so the character reads without relying on hue.
  assert.ok(chroma(loaded) / luma(loaded) < chroma(clean) / luma(clean),
    "landscape: waste desaturates relative to its brightness");
  assert.ok(loaded[0]! > loaded[1]! && loaded[1]! > loaded[2]!, "landscape: ash stays warm");
  assert.ok(luma(loaded) > 60, "landscape: loaded ground stays legible, never near-black");
  assert.notDeepEqual(loaded, clean, "waste changes the landscape character, not only a hue");
  assert.ok(
    luma(wasteOverlayCell(0.9)) > luma(wasteOverlayCell(0.05)),
    "waste overlay: more waste is brighter",
  );
  // Fertility must stay readable, and waste must be visibly distinct from
  // the ground it covers: loaded ground moves toward ash (far closer to ash
  // than unloaded fertile ground is) and loses the green cast, while still
  // sitting clearly above barren soil in brightness.
  const fertile = landscapeCell(0.95, 0.95, 0.1, 0, 0.5);
  const barren = landscapeCell(0, 0, 0, 0, 0.5);
  assert.ok(dist(loaded) < dist(fertile), "landscape: loaded ground moves toward ash");
  assert.ok(chroma(loaded) < chroma(fertile), "landscape: waste removes the fertility green cast");
  assert.ok(luma(loaded) > luma(barren) + 20, "landscape: loaded ground is clearly distinct from barren soil");
  assert.ok(chroma(fertile) > chroma(loaded) + 10, "landscape: fertility keeps its own colour identity");
  // The two nutrient sources must stay distinguishable without an overlay,
  // because the world's real patch geometry depends on them.
  const aRich = landscapeCell(0.9, 0.05, 0, 0, 0.5);
  const bRich = landscapeCell(0.05, 0.9, 0, 0, 0.5);
  const distance = Math.abs(aRich[0] - bRich[0]) + Math.abs(aRich[1] - bRich[1]) + Math.abs(aRich[2] - bRich[2]);
  assert.ok(distance > 24, `nutrient A and B zones are perceptibly different (Δ ${distance})`);
  // Nutrient overlay stays monotonic in its own field.
  for (const k of [0, 1, 2]) {
    assert.ok(luma(nutrientOverlayCell(k, 0.9)) > luma(nutrientOverlayCell(k, 0.05)),
      `nutrient overlay kind ${k} is monotonic`);
  }
  console.log("landscape lens encodings: PASS");
}

function testMicroTextureIsDeterministic() {
  // Cosmetic microvariation must be stable and must not consume simulation
  // RNG: it is a pure hash of the cell index, so it is identical on every
  // frame, tick, restore and universe.
  for (let i = 0; i < CELLS; i++) {
    assert.equal(microTexture(i), microTexture(i), "microtexture is a pure function of cell index");
    assert.ok(microTexture(i) >= 0 && microTexture(i) <= 1, "microtexture stays in range");
  }
  console.log("landscape microtexture determinism: PASS");
}

async function testCellInspection() {
  const n = 4;
  const resources: RenderResourceField = {
    gridSize: n,
    stock: [[1, 2, 3, 4], [0, 0, 0, 0], [1, 1, 1, 1]],
    capacity: [[2, 2, 2, 2], [2, 2, 2, 2], [1, 1, 1, 1]],
  };
  const waste: RenderWasteField = { gridSize: n, stock: [0.5, 0, 0, 0], capacity: [1, 1, 1, 1] };
  const cell = await cellFractions(resources, waste, 1, 2);
  assert.ok(cell, "in-range cell resolves");
  assert.equal(cell!.a, 0, "nutrient A fraction is exact");
  assert.equal(cell!.waste, 0, "waste fraction is exact");
  assert.equal(await cellFractions(resources, waste, 9, 0), null, "out-of-range cell reports absent");
  console.log("landscape cell inspection: PASS");
}

async function main(){
  testPrimesFromRealFields();
  testUniverseIsolation();
  testRewindReprimes();
  testBoundedAndMonotonic();
  testLensEncodingsAreHonest();
  testMicroTextureIsDeterministic();
  await testCellInspection();
  console.log("landscape validation: PASS");
}

main().catch(error=>{
  console.error(error);
  process.exitCode=1;
});
