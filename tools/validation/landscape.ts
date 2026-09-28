import assert from "node:assert/strict";
import {
  ASH_RGB, LandscapeSmoother, cellFractions, landscapeCell, landscapeTileLayout, microTexture,
  nutrientOverlayCell, wasteOverlayCell,
} from "../../apps/explorer/src/landscape.ts";
import {
  DORMANT_ALPHA, analyticalLens, dormantChannel, organismColor,
} from "../../apps/explorer/src/organismEncoding.ts";
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
  const clean = landscapeCell(0.28, 0.28, 0.1, 0, 0.5);
  const loaded = landscapeCell(0.28, 0.28, 0.1, 0.9, 0.5);
  // The module's own ash target, not a second copy of it: a hardcoded
  // duplicate desynchronises silently the moment the palette is retuned,
  // which is exactly how a stale expectation outlives its reason.
  const ASH = [...ASH_RGB];
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
  const fertile = landscapeCell(0.30, 0.30, 0.1, 0, 0.5);
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

function testWrappedSubstrateTiles() {
  // Regression: the substrate is one world period repeated across the canvas.
  // Deriving the destination rect from the wrapped world->screen mapping made
  // the rect zero-width for every camera except the exact world centre, so the
  // landscape vanished as soon as the world was panned. Sweep cameras and
  // zooms and require full, gapless coverage every time.
  //
  // The swept case count is reported from the code rather than quoted by hand,
  // so the evidence cannot drift from what actually runs.
  const EXTENT = 600;
  const CAM_STEP = 25;
  const CAM_POSITIONS = Math.ceil(EXTENT / CAM_STEP);
  const VIEWS = [{ w: 390, h: 844 }, { w: 320, h: 844 }, { w: 1280, h: 900 }];
  const ZOOMS = [1, 1.5, 2, 3];
  let worstCount = 0;
  let cases = 0;
  for (const view of VIEWS) {
    for (const zoom of ZOOMS) {
      const fit = view.h > view.w ? view.h / EXTENT : Math.min(view.w, view.h) / EXTENT;
      const s = fit * zoom;
      for (let cam = 0; cam < EXTENT; cam += CAM_STEP) {
        cases++;
        const t = landscapeTileLayout(cam, cam, s, view.w, view.h, EXTENT);
        // Tiles are contiguous, so the union spans
        // [baseX + iStart*periodX, baseX + (iEnd+1)*periodX].
        const left = t.baseX + t.iStart * t.periodX;
        const right = t.baseX + (t.iEnd + 1) * t.periodX;
        const top = t.baseY + t.jStart * t.periodY;
        const bottom = t.baseY + (t.jEnd + 1) * t.periodY;
        assert.ok(left <= 0.5 && right >= view.w - 0.5,
          `tiles cover the canvas horizontally at cam ${cam} zoom ${zoom} (${left.toFixed(1)}..${right.toFixed(1)} vs ${view.w})`);
        assert.ok(top <= 0.5 && bottom >= view.h - 0.5,
          `tiles cover the canvas vertically at cam ${cam} zoom ${zoom} (${top.toFixed(1)}..${bottom.toFixed(1)} vs ${view.h})`);
        // The drawn period must be the real world size on screen, never zero.
        assert.ok(Math.abs(t.periodX - EXTENT * s) < 1e-6 && t.periodX > 0,
          `period width is the true world size at cam ${cam} zoom ${zoom} (${t.periodX.toFixed(1)})`);
        assert.ok(t.iEnd >= t.iStart && t.jEnd >= t.jStart,
          `tile range is non-empty at cam ${cam} zoom ${zoom}`);
        worstCount = Math.max(worstCount, t.count);
      }
    }
  }
  // The sweep must actually be the full cross product, so the quoted coverage
  // in the evidence cannot silently overstate what ran.
  const expectedCases = VIEWS.length * ZOOMS.length * CAM_POSITIONS;
  assert.equal(cases, expectedCases,
    `swept the full camera/zoom/viewport cross product (${cases} cases)`);

  // Performance: repeating the period must stay a handful of draws and must
  // not grow with zoom. This is the whole budget at the supported maximum.
  assert.ok(worstCount <= 36,
    `worst-case tile count stays small (${worstCount} drawImage calls)`);

  // The specific failure, stated directly: the wrapped mapping collapses the
  // two endpoints everywhere except the world centre, which is exactly why it
  // looked correct in un-panned captures and failed on a device after a pan.
  const wrapDelta=(a:number,b:number)=>{let d=(a-b)%EXTENT;if(d>EXTENT/2)d-=EXTENT;else if(d<-EXTENT/2)d+=EXTENT;return d};
  for (const cam of [0, 100, 200, 400, 599]) {
    assert.equal(wrapDelta(0, cam), wrapDelta(EXTENT, cam),
      `wrapped endpoints coincide at cam ${cam} (this is why the rect collapsed)`);
  }
  assert.notEqual(wrapDelta(0, 300), wrapDelta(EXTENT, 300),
    "only the exact world centre produced a non-zero rect");
  console.log(`landscape wrapped substrate tiles: PASS (${VIEWS.length} viewports x ${ZOOMS.length} zooms x ${CAM_POSITIONS} camera positions = ${cases} cases, worst ${worstCount} draws)`);
}

/**
 * Owner rule under test: "scarcity may be highly legible, but scarcity must not
 * visually imply damage. Damage requires separate simulation evidence."
 *
 * These are the guards on that rule. The positive claims (rich reads rich, poor
 * reads poor) are easy; the load-bearing one is the NEGATIVE claim, that a
 * depleted cell never acquires damage vocabulary.
 */
const BARE = landscapeCell(0, 0, 0, 0, 0.5);
const dist = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

function testScarcityReadsAsAbsenceNotDamage() {
  // Exhausted: every substance effectively gone.
  const spent = landscapeCell(0.02, 0.02, 0, 0, 0.5);
  assert.ok(dist(spent, BARE) < 26,
    `an exhausted cell sits close to bare substrate (${dist(spent, BARE).toFixed(1)}), so it reads as ground without material`);
  // THE negative guard. Damage vocabulary in practice means darkening, charring
  // or a wound hue. None of those may appear as stock falls.
  assert.ok(luma(spent) >= luma(BARE) - 1,
    `depletion never darkens the ground (${luma(spent).toFixed(1)} vs bare ${luma(BARE).toFixed(1)}), because darkening reads as damage`);
  assert.ok(chroma(spent) <= chroma(BARE) + 12,
    `depletion does not add a wound hue (chroma ${chroma(spent)} vs bare ${chroma(BARE)})`);
}

function testRichnessIsUnmistakable() {
  const rich = landscapeCell(0.30, 0.30, 0, 0, 0.5);
  const separation = dist(rich, BARE);
  // The design asks for this contrast to be pushed, because the field supports a
  // large real difference. A timid lift would force a lens to see it.
  assert.ok(separation > 70,
    `a rich cell is unmistakably different from bare substrate (${separation.toFixed(1)})`);
  // Polarity: material is DARKER and far more chromatic than bare ground, so
  // losing material LIGHTENS the world. This is the inverse of the earlier
  // brightening lift, which made a real depletion darken the ground by ~18 luma
  // and therefore read as damage. Asserted explicitly so the polarity cannot be
  // flipped back without this test failing.
  assert.ok(luma(rich) < luma(BARE),
    `resource material is darker than bare ground (${luma(rich).toFixed(1)} vs ${luma(BARE).toFixed(1)}), so depletion lightens rather than darkens`);
  assert.ok(chroma(rich) > chroma(BARE) * 2,
    `and far more chromatic (${chroma(rich)} vs ${chroma(BARE)}), so presence is carried by hue rather than by brightness`);
}

function testPresenceIsMonotonicAndContinuous() {
  // Non-decreasing everywhere, and STRICTLY increasing above the scarcity floor.
  // Below the floor presence is legitimately zero - that is the whole point of a
  // presence language - so demanding a strict rise there would be asserting the
  // absence of the feature under test.
  let previous = dist(landscapeCell(0, 0, 0, 0, 0.5), BARE);
  for (const level of [0.02, 0.05, 0.08, 0.11, 0.15, 0.19, 0.22, 0.26, 0.30]) {
    const current = dist(landscapeCell(level, level, 0, 0, 0.5), BARE);
    assert.ok(current >= previous - 0.001,
      `material presence never decreases as stock rises (${level}: ${current.toFixed(1)} >= ${previous.toFixed(1)})`);
    if (level > 0.05) {
      assert.ok(current > previous,
        `above the scarcity floor material presence strictly increases with stock (${level}: ${current.toFixed(1)} > ${previous.toFixed(1)})`);
    }
    previous = current;
  }
  // Below the floor there is no material at all, which is what lets a patch read
  // as emptied rather than merely dimmed.
  for (const level of [0, 0.02, 0.04, 0.05]) {
    const cell = landscapeCell(level, level, 0, 0, 0.5);
    assert.ok(dist(cell, BARE) < 3,
      `stock at or below the scarcity floor shows no resource material (${level} -> ${dist(cell, BARE).toFixed(1)})`);
  }
  // No seam at the scarcity floor: presence must ease out, not switch on.
  const justBelow = dist(landscapeCell(0.048, 0.048, 0, 0, 0.5), BARE);
  const justAbove = dist(landscapeCell(0.052, 0.052, 0, 0, 0.5), BARE);
  assert.ok(justAbove - justBelow < 12,
    `material fades across the scarcity floor rather than switching on (${justBelow.toFixed(1)} -> ${justAbove.toFixed(1)})`);
}

function testPartialDepletionLeavesRefugiaVisible() {
  // The acceptance case: an affected area empties while unaffected material
  // remains readable, so the survivors read as refugia.
  const bothRich = landscapeCell(0.27, 0.27, 0, 0, 0.5);
  const aDepleted = landscapeCell(0.03, 0.27, 0, 0, 0.5);
  const bDepleted = landscapeCell(0.27, 0.03, 0, 0, 0.5);
  // Whichever substance survives, material is still plainly present. Asserted
  // RELATIVE to full presence rather than against an absolute number, so the
  // claim is "most of the material is still there", which is what makes a
  // remaining pocket read as a refugium - and so the check cannot be satisfied
  // or broken by an unrelated palette change.
  const full = dist(bothRich, BARE);
  // With ONE of two substances depleted, roughly half the combined lift remains -
  // that is the honest number, not a flattering one. The claim that matters is
  // that this is plainly above bare (so the pocket reads as a refugium) and far
  // above a fully exhausted cell (so the difference is legible, not marginal).
  const exhausted = dist(landscapeCell(0.03, 0.03, 0, 0, 0.5), BARE);
  for (const [label, cell] of [["B survives", aDepleted], ["A survives", bDepleted]] as const) {
    const share = dist(cell, BARE) / full;
    assert.ok(share > 0.4,
      `${label}: ${(share * 100).toFixed(0)}% of full presence remains, which is plainly visible`);
    assert.ok(dist(cell, BARE) > Math.max(40, exhausted * 3),
      `${label}: remaining material is far above an exhausted cell (${dist(cell, BARE).toFixed(1)} vs ${exhausted.toFixed(1)}), so the refugium reads as material rather than as tint`);
  }
  // And the two depleted states are distinguishable from each other, so a
  // half-depleted patch does not read as a uniform grey.
  assert.ok(dist(aDepleted, bDepleted) > 25,
    `a half-depleted patch still distinguishes its two substances (${dist(aDepleted, bDepleted).toFixed(1)})`);
  assert.ok(dist(bothRich, BARE) > dist(aDepleted, BARE),
    "full presence exceeds partial presence, so depletion is a visible loss");
}

function testWasteStillReadsAsResidueNotInjury() {
  // Waste is real simulated fouling, so it keeps its own material - but it
  // stays neutral and never darkens, which is what keeps it on the "spent
  // ground" side of the line rather than the "damaged" side.
  const fouled = landscapeCell(0.28, 0.28, 0, 0.9, 0.5);
  const clean = landscapeCell(0.28, 0.28, 0, 0, 0.5);
  assert.ok(dist(fouled, clean) > 20, `waste visibly alters the local ground (${dist(fouled, clean).toFixed(1)})`);
  assert.ok(luma(fouled) >= luma(clean) - 1,
    `waste pales rather than darkens (${luma(fouled).toFixed(1)} vs ${luma(clean).toFixed(1)})`);
  assert.ok(luma(fouled) > 40, "and a fouled cell still shows organisms standing in it");
}

/**
 * §21.2 / R1: an analytical lens must encode the quantity it claims even for
 * dormant organisms. Dormancy previously won the colour chain outright, so the
 * lens labelled "Clades" did not encode clades for the dormant subpopulation and
 * "Traits" did not encode the selected trait. Dormancy now rides a separate,
 * non-conflicting channel instead of replacing the lens encoding.
 */
function testAnalyticalLensesOutrankDormancy() {
  const base = { cladeId: 7, byproductUse: 0, diet: 0, energy: 90, activity: "active" } as const;
  const dormant = { ...base, activity: "dormant" } as const;
  const range: [number, number] = [0, 1];

  // Dormancy does not replace clade identity.
  assert.equal(
    organismColor({ ...base } as never, "clades", "speed", range),
    organismColor({ ...dormant } as never, "clades", "speed", range),
    "a dormant organism keeps its clade encoding in the Clades lens",
  );
  // Dormancy does not replace trait value.
  for (const view of ["speed", "habitat", "byproduct_use"] as const) {
    assert.equal(
      organismColor({ ...base, [view]: 0.8 } as never, "traits", view, range),
      organismColor({ ...dormant, [view]: 0.8 } as never, "traits", view, range),
      `a dormant organism keeps its ${view} encoding in the Traits lens`,
    );
  }
  // The encoding still discriminates. Otherwise the equalities above would be
  // satisfied by a lens that encodes nothing at all.
  assert.notEqual(
    organismColor({ ...base, cladeId: 7 } as never, "clades", "speed", range),
    organismColor({ ...base, cladeId: 8 } as never, "clades", "speed", range),
    "the Clades lens still distinguishes clades",
  );
  assert.notEqual(
    organismColor({ ...base, speed: 0.1 } as never, "traits", "speed", range),
    organismColor({ ...base, speed: 0.9 } as never, "traits", "speed", range),
    "the Traits lens still distinguishes trait values",
  );

  // Dormancy stays independently legible, on a channel that is not the colour.
  assert.equal(dormantChannel({ ...dormant } as never).dormant, true, "dormancy is signalled on its own channel");
  assert.equal(dormantChannel({ ...base } as never).dormant, false, "an active organism is not dimmed");
  assert.equal(dormantChannel({ ...dormant } as never).alpha, DORMANT_ALPHA, "dormancy dims via alpha");
  assert.equal(dormantChannel({ ...dormant } as never).hollow, true, "dormancy is drawn hollow, not solid");
  assert.ok(DORMANT_ALPHA < 1, "the dormancy alpha actually reduces opacity");
  assert.notEqual(
    dormantChannel({ ...dormant } as never).hollow,
    dormantChannel({ ...base } as never).hollow,
    "the dormancy channel differs between the two states, so it carries signal",
  );

  // The Normal world keeps its own dormancy treatment: this fix is analytical
  // lenses only and must not restyle the default view.
  assert.equal(
    organismColor({ ...dormant } as never, "normal", "speed", range),
    organismColor({ ...base, activity: "dormant" } as never, "normal", "speed", range),
    "Normal-world dormancy colouring is unchanged for the dormant state",
  );
  assert.notEqual(
    organismColor({ ...dormant } as never, "normal", "speed", range),
    organismColor({ ...base } as never, "normal", "speed", range),
    "the Normal world still shows dormancy in its own colour",
  );

  assert.equal(analyticalLens("clades"), true, "Clades is an analytical lens");
  assert.equal(analyticalLens("traits"), true, "Traits is an analytical lens");
  assert.equal(analyticalLens("normal"), false, "Normal is not analytical");
  console.log("analytical lenses outrank dormancy (§21.2): PASS");
}

async function main(){
  testPrimesFromRealFields();
  testUniverseIsolation();
  testRewindReprimes();
  testBoundedAndMonotonic();
  testLensEncodingsAreHonest();
  testMicroTextureIsDeterministic();
  testWrappedSubstrateTiles();
  testScarcityReadsAsAbsenceNotDamage();
  testRichnessIsUnmistakable();
  testPresenceIsMonotonicAndContinuous();
  testPartialDepletionLeavesRefugiaVisible();
  testWasteStillReadsAsResidueNotInjury();
  testAnalyticalLensesOutrankDormancy();
  // Logged so a silent skip is distinguishable from a pass.
  console.log("landscape resource presence (scarcity != damage): PASS");
  await testCellInspection();
  console.log("landscape validation: PASS");
}

main().catch(error=>{
  console.error(error);
  process.exitCode=1;
});
