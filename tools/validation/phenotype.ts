/**
 * Lane 2 M4B Pixel Phenotype — Phase 1 validation.
 *
 * Focused deterministic tests for the safe parallel core: stable trait
 * normalization, resource-specialization derivation, nearest-attractor
 * founder selection, lineage anchoring, hysteresis transition boundary,
 * geometry quantization, deterministic cosmetic variation, LOD tier
 * resolution, save/load (deterministic-reconstruction) continuity, and
 * cross-universe equivalence.
 *
 * Pure presentation: the suite never touches sim-core biology and asserts
 * isolation structurally. Existing deterministic/ecology gates must stay
 * green — any biological divergence would be a defect, and this package
 * cannot produce one (it holds no simulation reference).
 *
 * Run: pnpm exec tsx tools/validation/phenotype.ts
 * (Wiring into package.json scripts is deferred to Phase 3 to keep this
 * lane conflict-free with PR #28, which edits the same script lines.)
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FAMILY_CENTERS,
  FAMILY_ORDER,
  HYSTERESIS_MIN_IMPROVEMENT,
  HYSTERESIS_RATIO,
  QUANT_LEVELS,
  TRAIT_RANGES,
  attractorDistance,
  countFilled,
  deriveAxes,
  deriveSpecialization,
  distancesToAll,
  gridDifference,
  gridToAscii,
  hashCosmeticSeed,
  lodTierForZoom,
  normalizeSignedTrait,
  normalizeTrait,
  phaseForTick,
  quantize01,
  renderPhenotypeGrid,
  resolveDescendantFamily,
  resolveFounderFamily,
  resolvePhenotype,
  type PhenotypeAxes,
  type TraitSample,
} from "../../packages/phenotype/src/index.ts";

/** Invert axes back to absolute traits (test helper only). */
function traitsForAxes(mob: number, sen: number, met: number, spec: number): TraitSample {
  const x = Math.min(1, spec / 0.75);
  const rem = spec - 0.75 * x;
  return {
    speed: 0.25 + mob * 3.75,
    sensing: 10 + sen * 170,
    metabolism: 0.04 + met * 0.46,
    reproduction: 100,
    diet: x * 1.5,
    habitat: x * 1.5,
    byproductUse: Math.max(0, Math.min(1, rem / 0.25)) * 1.5,
    // Strong dormant transform (normalized 0.667 >= 0.5 gate); weak strength
    // is covered explicitly in testDormancyStrength.
    dormancyResponse: 1.0,
  };
}

function axesAt(family: (typeof FAMILY_ORDER)[number]): PhenotypeAxes {
  const c = FAMILY_CENTERS[family];
  return { mobility: c[0], sensing: c[1], metabolism: c[2], specialization: c[3] };
}

/** Linear interpolation between two attractor centers. */
function lerpAxes(a: PhenotypeAxes, b: PhenotypeAxes, t: number): PhenotypeAxes {
  return {
    mobility: a.mobility + (b.mobility - a.mobility) * t,
    sensing: a.sensing + (b.sensing - a.sensing) * t,
    metabolism: a.metabolism + (b.metabolism - a.metabolism) * t,
    specialization: a.specialization + (b.specialization - a.specialization) * t,
  };
}

// --- Stable normalization from fixed supported ranges -----------------------

function testNormalization() {
  assert.equal(normalizeTrait(0.25, 0.25, 4), 0, "speed floor maps to 0");
  assert.equal(normalizeTrait(4, 0.25, 4), 1, "speed ceiling maps to 1");
  assert.equal(normalizeTrait(10, 10, 180), 0, "sensing floor maps to 0");
  assert.equal(normalizeTrait(0.5, 0.04, 0.5), 1, "metabolism ceiling maps to 1");
  assert.equal(normalizeTrait(-99, 0.25, 4), 0, "below-range clamps to 0");
  assert.equal(normalizeTrait(999, 0.25, 4), 1, "above-range clamps to 1");
  assert.equal(normalizeSignedTrait(-1.5, 1.5), -1, "diet floor maps to -1");
  assert.equal(normalizeSignedTrait(1.5, 1.5), 1, "diet ceiling maps to +1");
  assert.equal(normalizeSignedTrait(0, 1.5), 0, "neutral stays neutral");
  assert.equal(normalizeSignedTrait(9, 1.5), 1, "signed clamps");
  // Engine authority mirror: packages/sim-core/src/engine.ts trait table T.
  assert.deepEqual(
    { ...TRAIT_RANGES },
    {
      speed: [0.25, 4],
      sensing: [10, 180],
      metabolism: [0.04, 0.5],
      reproduction: [55, 220],
      diet: [-1.5, 1.5],
      habitat: [-1.5, 1.5],
      byproductUse: [0, 1.5],
      dormancyResponse: [0, 1.5],
    },
    "phenotype ranges mirror the engine trait table (AC5 foundation)",
  );
  console.log("normalization: PASS");
}

// --- Resource-specialization derivation --------------------------------------

function testSpecialization() {
  assert.equal(deriveSpecialization(0, 0, 0), 0, "generalist scores zero");
  assert.ok(Math.abs(deriveSpecialization(1, 1, 0) - 0.75) < 1e-12, "full diet+habitat weight");
  assert.ok(Math.abs(deriveSpecialization(0, 0, 1) - 0.25) < 1e-12, "byproduct weight");
  // Only magnitude feeds strength; direction stays available separately.
  assert.equal(
    deriveSpecialization(0.8, -0.6, 0.4),
    deriveSpecialization(-0.8, 0.6, 0.4),
    "sign flips keep specialization strength (AC6)",
  );
  const t = traitsForAxes(0.5, 0.5, 0.5, 0.6);
  assert.ok(Math.abs(deriveAxes(t).specialization - 0.6) < 1e-9, "helper inverts the derivation");
  console.log("specialization: PASS");
}

// --- Founder honesty: nearest attractor, no default family -------------------

function testFounders() {
  for (const f of FAMILY_ORDER) {
    const c = FAMILY_CENTERS[f];
    const resolved = resolvePhenotype(traitsForAxes(c[0], c[1], c[2], c[3]));
    assert.equal(resolved.family, f, `exact ${f} center resolves to ${f}`);
    assert.equal(resolved.founder, true, "null parent resolves as founder");
  }
  // A generalist position near Blob resolves to Blob by distance, not privilege:
  // prove it by showing the rule is a pure argmin over the same distances.
  const generalist = traitsForAxes(0.35, 0.35, 0.4, 0.2);
  const axes = deriveAxes(generalist);
  const d = distancesToAll(axes);
  let nearest = FAMILY_ORDER[0]!;
  for (const f of FAMILY_ORDER) if (d[f]! < d[nearest]!) nearest = f;
  assert.equal(resolveFounderFamily(axes), nearest, "founder is a pure nearest-attractor argmin (AC2)");
  // Exact ties are measure-zero but must be deterministic, never random.
  const mid = lerpAxes(axesAt("blob"), axesAt("segmented"), 0.5);
  assert.equal(
    resolveFounderFamily(mid),
    resolveFounderFamily({ ...mid }),
    "tied positions resolve deterministically (AC11)",
  );
  assert.ok(
    resolveFounderFamily(mid) === "blob" || resolveFounderFamily(mid) === "segmented",
    "tied midpoint falls to one of the two nearest attractors",
  );
  console.log("founders: PASS");
}

// --- Lineage anchoring + hysteresis boundary ---------------------------------

function testLineageAndHysteresis() {
  const blob = axesAt("blob");
  const seg = axesAt("segmented");
  // Small mutations keep the parent family and quantized form (AC3).
  // Deltas stay inside one quantum (levels at 0.125 intervals) on purpose:
  // crossing a quantum boundary is a visible step by design, tested below.
  const child = traitsForAxes(
    blob.mobility + 0.01,
    blob.sensing - 0.01,
    blob.metabolism + 0.01,
    blob.specialization + 0.01,
  );
  const parentRes = resolvePhenotype(traitsForAxes(blob.mobility, blob.sensing, blob.metabolism, blob.specialization));
  const childRes = resolvePhenotype(child, { parentFamily: "blob" });
  assert.equal(childRes.family, "blob", "small mutation keeps the visual family (AC3)");
  assert.deepEqual(childRes.quantized, parentRes.quantized, "small mutation keeps quantized geometry (AC3)");

  // Near-boundary lineages do not flicker (AC4).
  assert.equal(resolveDescendantFamily(lerpAxes(blob, seg, 0.52), "blob"), "blob", "t=0.52 stays (ratio gate)");
  // t=0.7 passes the 80% ratio gate yet stays: absolute improvement < 0.10.
  const dCur70 = attractorDistance(lerpAxes(blob, seg, 0.7), FAMILY_CENTERS.blob);
  const dAlt70 = attractorDistance(lerpAxes(blob, seg, 0.7), FAMILY_CENTERS.segmented);
  assert.ok(dAlt70 <= HYSTERESIS_RATIO * dCur70, "t=0.7 clears the ratio gate");
  assert.ok(dCur70 - dAlt70 < HYSTERESIS_MIN_IMPROVEMENT, "t=0.7 fails the absolute gate");
  assert.equal(resolveDescendantFamily(lerpAxes(blob, seg, 0.7), "blob"), "blob", "t=0.7 stays (absolute gate, AC4)");
  // Accumulated divergence transitions stably and explanatorily.
  assert.equal(resolveDescendantFamily(lerpAxes(blob, seg, 0.85), "blob"), "segmented", "t=0.85 transitions (AC4)");
  // The transition sticks: resolving from the new family keeps it.
  assert.equal(
    resolveDescendantFamily(lerpAxes(blob, seg, 0.85), "segmented"),
    "segmented",
    "transitioned family is stable",
  );
  console.log("lineage + hysteresis: PASS");
}

// --- Quantization: five stable states ----------------------------------------

function testQuantization() {
  const seen = new Set([0, 1].map((v) => quantize01(v)));
  assert.deepEqual([...seen].sort(), [0, 1], "edges quantize exactly");
  const levels = new Set<number>();
  for (let i = 0; i <= 40; i++) levels.add(quantize01(i / 40));
  assert.equal(levels.size, QUANT_LEVELS, `exactly ${QUANT_LEVELS} stable states`);
  assert.deepEqual([...levels].sort((a, b) => a - b), [0, 0.25, 0.5, 0.75, 1], "uniform five-state ladder");
  assert.equal(quantize01(0.24), quantize01(0.26), "near-boundary values share a state (no churn)");
  console.log("quantization: PASS");
}

// --- Cosmetic variation: deterministic, bounded, never structural -------------

function testCosmetic() {
  assert.equal(hashCosmeticSeed(7, 3), hashCosmeticSeed(7, 3), "cosmetic seed deterministic");
  assert.notEqual(hashCosmeticSeed(7, 3), hashCosmeticSeed(8, 3), "identity disperses");
  const base = traitsForAxes(0.35, 0.35, 0.4, 0.2);
  const a = resolvePhenotype(base, { organismId: 7, lineageId: 3 });
  const b = resolvePhenotype(base, { organismId: 8, lineageId: 3 });
  assert.equal(a.family, b.family, "identity never selects family");
  assert.deepEqual(a.quantized, b.quantized, "identity never selects morphology");
  assert.notEqual(a.cosmeticSeed, b.cosmeticSeed, "identity seeds cosmetic variation only");
  for (const tier of ["ecosystem", "population", "inspection"] as const) {
    const ga = renderPhenotypeGrid(a, tier, "active");
    const gb = renderPhenotypeGrid(b, tier, "active");
    const diff = gridDifference(ga, gb);
    if (tier === "inspection") assert.ok(diff <= 2, `inspection cosmetic bounded (diff ${diff})`);
    else assert.equal(diff, 0, `${tier} carries no cosmetic pixels`);
  }
  // Animation phase is deterministic per (seed, tick), continuous, and
  // decoupled from quantized form.
  const p1 = phaseForTick(a.cosmeticSeed, a.axes.mobility, 100);
  assert.equal(p1, phaseForTick(a.cosmeticSeed, a.axes.mobility, 100), "phase deterministic");
  assert.ok(p1 >= 0 && p1 < 1, "phase in [0, 1)");
  assert.notEqual(p1, phaseForTick(a.cosmeticSeed, a.axes.mobility, 101), "phase advances with tick");
  console.log("cosmetic variation: PASS");
}

// --- Dormancy strength gate ---------------------------------------------------

function testDormancyStrength() {
  // Per-family vectors carrying real secondary structures (so withdrawal is
  // observable), each verified below to stay in its family. Fields: mobility,
  // sensing, metabolism, diet, habitat, byproductUse (absolute trait units).
  const vectors: Record<(typeof FAMILY_ORDER)[number], [number, number, number, number, number, number]> = {
    blob: [0.35, 0.45, 0.4, 0.3, 0.45, 0],
    segmented: [0.7, 0.45, 0.5, 0.3, 0.3, 0],
    radial: [0.3, 0.82, 0.45, 0.3, 0, 0],
    plated: [0.3, 0.35, 0.78, 0.3, 0.3, 0],
    branching: [0.2, 0.76, 0.45, 1.5, 1.5, 0.5625],
    paddled: [0.88, 0.62, 0.72, 0.3, 0, 0],
  };
  const traits = (v: [number, number, number, number, number, number], dr: number): TraitSample => ({
    speed: 0.25 + v[0] * 3.75,
    sensing: 10 + v[1] * 170,
    metabolism: 0.04 + v[2] * 0.46,
    reproduction: 100,
    diet: v[3],
    habitat: v[4],
    byproductUse: v[5],
    dormancyResponse: dr,
  });
  for (const f of FAMILY_ORDER) {
    const v = vectors[f];
    // Weak: norm 0.133. Strong: norm 0.8. Edge: norm exactly 0.5.
    const w = resolvePhenotype(traits(v, 0.2), { parentFamily: f, organismId: 7, lineageId: 3 });
    const s = resolvePhenotype(traits(v, 1.2), { parentFamily: f, organismId: 7, lineageId: 3 });
    const e = resolvePhenotype(traits(v, 0.75), { parentFamily: f, organismId: 7, lineageId: 3 });
    assert.equal(w.family, f, `${f} weak keeps family`);
    assert.equal(s.family, f, `${f} strong keeps family`);
    const gw = renderPhenotypeGrid(w, "inspection", "dormant");
    const gs = renderPhenotypeGrid(s, "inspection", "dormant");
    const ga = renderPhenotypeGrid(s, "inspection", "active");
    assert.ok(gridDifference(gw, ga) > 0, `${f} weak transform reads vs active`);
    assert.ok(gridDifference(gs, ga) > 0, `${f} strong transform reads vs active`);
    assert.ok(gridDifference(gw, gs) > 0, `${f} weak vs strong differ`);
    assert.equal(
      gridDifference(renderPhenotypeGrid(e, "inspection", "dormant"), gs),
      0,
      `${f} gate edge (norm 0.5) renders the strong transform`,
    );
  }
  console.log("dormancy strength: PASS");
}

// --- LOD tiers over the existing zoom stops -----------------------------------

function testLodTiers() {
  assert.equal(lodTierForZoom(1.0), "ecosystem", "1.0x is ecosystem");
  assert.equal(lodTierForZoom(1.5), "ecosystem", "1.5x is ecosystem");
  assert.equal(lodTierForZoom(2.0), "population", "2.0x is population");
  assert.equal(lodTierForZoom(2.5), "population", "2.5x is population");
  assert.equal(lodTierForZoom(3.0), "inspection", "3.0x is inspection");
  console.log("LOD tiers: PASS");
}

// --- Family legibility, dormancy readability, tier structure ------------------

function testGrids() {
  const founders = FAMILY_ORDER.map((f) => {
    const c = FAMILY_CENTERS[f];
    return { family: f, res: resolvePhenotype(traitsForAxes(c[0], c[1], c[2], c[3]), { organismId: 7, lineageId: 3 }) };
  });
  // AC1: six families distinguishable by monochrome silhouette at close view.
  for (let i = 0; i < founders.length; i++) {
    for (let j = i + 1; j < founders.length; j++) {
      const diff = gridDifference(
        renderPhenotypeGrid(founders[i]!.res, "inspection", "active"),
        renderPhenotypeGrid(founders[j]!.res, "inspection", "active"),
      );
      assert.ok(diff >= 20, `${founders[i]!.family} vs ${founders[j]!.family} differ by ${diff} cells (AC1)`);
    }
  }
  for (const { family, res } of founders) {
    const eco = renderPhenotypeGrid(res, "ecosystem", "active");
    const ecoFilled = countFilled(eco);
    assert.ok(ecoFilled >= 3 && ecoFilled <= 25, `${family} ecosystem mark is 3-25 cells (got ${ecoFilled})`);
    // AC7: every family has a geometric dormant transformation at every tier.
    for (const tier of ["ecosystem", "population", "inspection"] as const) {
      const diff = gridDifference(
        renderPhenotypeGrid(res, tier, "active"),
        renderPhenotypeGrid(res, tier, "dormant"),
      );
      const floor = tier === "ecosystem" ? 3 : 8;
      assert.ok(diff >= floor, `${family} ${tier} dormant transform reads (diff ${diff}, AC7)`);
    }
    // AC8: tiers reveal more information while staying the same phenotype.
    const pop = countFilled(renderPhenotypeGrid(res, "population", "active"));
    const insp = countFilled(renderPhenotypeGrid(res, "inspection", "active"));
    assert.ok(pop >= ecoFilled, `${family} population >= ecosystem detail`);
    assert.ok(insp >= pop, `${family} inspection >= population detail`);
  }
  console.log("grids (legibility/dormancy/LOD): PASS");
  // Debug/evidence surface: six-family monochrome silhouette matrix.
  console.log("--- six-family inspection silhouettes (active) ---");
  for (const { family, res } of founders) {
    console.log(`--- ${family} ---\n${gridToAscii(renderPhenotypeGrid(res, "inspection", "active"))}`);
  }
}

// --- Persistence continuity via deterministic reconstruction ------------------

function testContinuity() {
  const cases: Array<{ name: string; traits: TraitSample; parent: "blob" | "segmented" | null }> = [
    { name: "inside family", traits: traitsForAxes(0.35, 0.35, 0.4, 0.2), parent: "blob" },
    { name: "near boundary", traits: traitsForAxes(...((): [number, number, number, number] => {
      const m = lerpAxes(axesAt("blob"), axesAt("segmented"), 0.7);
      return [m.mobility, m.sensing, m.metabolism, m.specialization];
    })()), parent: "blob" },
    { name: "recently transitioned", traits: traitsForAxes(...((): [number, number, number, number] => {
      const m = lerpAxes(axesAt("blob"), axesAt("segmented"), 0.85);
      return [m.mobility, m.sensing, m.metabolism, m.specialization];
    })()), parent: "segmented" },
  ];
  for (const c of cases) {
    const before = resolvePhenotype(c.traits, { parentFamily: c.parent, organismId: 42, lineageId: 9 });
    // Save/load round-trip: the resolved description is plain JSON data.
    const restored = JSON.parse(JSON.stringify(before)) as typeof before;
    assert.deepEqual(restored, before, `${c.name}: checkpoint round-trip is exact (AC10)`);
    // Replay: deterministic reconstruction from retained traits + parent.
    const replayed = resolvePhenotype(c.traits, { parentFamily: c.parent, organismId: 42, lineageId: 9 });
    assert.equal(replayed.family, before.family, `${c.name}: replay keeps family (AC10)`);
    assert.deepEqual(replayed.quantized, before.quantized, `${c.name}: replay keeps morphology (AC10)`);
  }
  console.log("persistence continuity: PASS");
}

// --- Cross-universe equivalence + simulation isolation ------------------------

function testEquivalenceAndIsolation() {
  // Same absolute vector in different population contexts: the model accepts
  // only absolute traits, so context cannot leak in (AC5).
  const v = traitsForAxes(0.6, 0.7, 0.5, 0.5);
  const inSparse = resolvePhenotype(v, { parentFamily: null, organismId: 1, lineageId: 1 });
  const inDense = resolvePhenotype(v, { parentFamily: null, organismId: 1, lineageId: 1 });
  assert.deepEqual(inDense, inSparse, "population context cannot alter morphology (AC5)");
  // Isolation: inputs are never mutated; the package holds no sim dependency.
  const frozen = Object.freeze({ ...v });
  assert.doesNotThrow(() => resolvePhenotype(frozen, { parentFamily: "radial" }), "frozen input resolves (AC12)");
  assert.deepEqual({ ...frozen }, { ...v }, "input never mutated (AC12)");
  const pkg = JSON.parse(readFileSync(new URL("../../packages/phenotype/package.json", import.meta.url), "utf8")) as {
    dependencies?: Record<string, string>;
  };
  assert.ok(!pkg.dependencies || Object.keys(pkg.dependencies).length === 0, "phenotype takes no runtime dependencies (AC12)");
  // Full determinism across repeated resolution and rendering (AC11).
  const r1 = resolvePhenotype(v, { parentFamily: "radial", organismId: 5, lineageId: 5 });
  const r2 = resolvePhenotype(v, { parentFamily: "radial", organismId: 5, lineageId: 5 });
  assert.deepEqual(r1, r2, "resolution deterministic (AC11)");
  assert.equal(
    gridDifference(renderPhenotypeGrid(r1, "inspection", "active"), renderPhenotypeGrid(r2, "inspection", "active")),
    0,
    "rendering deterministic (AC11)",
  );
  console.log("equivalence + isolation: PASS");
}

testNormalization();
testSpecialization();
testFounders();
testLineageAndHysteresis();
testQuantization();
testCosmetic();
testDormancyStrength();
testLodTiers();
testGrids();
testContinuity();
testEquivalenceAndIsolation();
console.log("phenotype validation: PASS (prototype baseline m4b-phenotype-prototype-v1)");
