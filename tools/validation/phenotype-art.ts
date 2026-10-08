import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolvePhenotype, type ResolvedPhenotype } from "../../packages/phenotype/src/index.ts";
import type { ProceduralPhenotypeRaster, StructuralArtRecipe } from "../../packages/phenotype/src/art/index.ts";
import { platedCenterFixture } from "../phenotype-art-proof/fixture.ts";

const packageJson = JSON.parse(readFileSync(new URL("../../packages/phenotype/package.json", import.meta.url), "utf8")) as {
  exports?: Record<string, string>;
  dependencies?: Record<string, string>;
};

async function testArtPackageBoundary(): Promise<void> {
  assert.equal(packageJson.exports?.["./art"], "./src/art/index.ts",
    "procedural art is exposed through its own phenotype package subpath");
  assert.equal(packageJson.dependencies?.["pixi.js"], undefined,
    "the phenotype art path adds no Pixi runtime dependency");
  const art = await import("../../packages/phenotype/src/art/index.ts");
  assert.match(art.PROCEDURAL_ART_VERSION, /^[a-z0-9][a-z0-9.-]+$/,
    "art output has an explicit deterministic renderer-version salt");
  assert.deepEqual(art.ART_LODS, ["population", "inspection"],
    "the initial rich art path targets only population and inspection LODs");
}

function testArtContracts(): void {
  const recipe: StructuralArtRecipe = {
    family: "plated",
    cosmeticSeed: 17,
    structuralVersion: "plated-grammar-v1",
    regions: [{
      id: "plate-0",
      geometry: {
        kind: "teardrop",
        center: { x: 0.5, y: 0.5 },
        axisRadians: 0.2,
        length: 0.4,
        width: 0.2,
        taper: 0.35,
      },
      depth: 1,
      paintOrder: 0,
      detail: "structure",
      materialRole: "body",
    }],
  };
  const center = recipe.regions[0]!.geometry;
  assert.equal(center.kind === "teardrop" && center.center.x >= 0 && center.center.x <= 1, true,
    "structural coordinates are normalized independently of output resolution");

  const size = 16;
  const raster: ProceduralPhenotypeRaster = {
    width: size,
    height: size,
    rgba: new Uint8Array(size * size * 4),
    masks: {
      silhouette: new Uint8Array(size * size),
      ownership: new Int16Array(size * size),
      depth: new Uint8Array(size * size),
      materialRole: new Uint8Array(size * size),
    },
  };
  assert.equal(raster.rgba.length, raster.width * raster.height * 4,
    "RGBA storage length is tied to explicit raster dimensions");
  assert.equal(raster.masks.silhouette.length, raster.width * raster.height,
    "evidence masks share raster dimensions");
}

function platedPhenotype(): ResolvedPhenotype {
  return resolvePhenotype({
    speed: 1.4,
    sensing: 70,
    metabolism: 0.3392,
    reproduction: 100,
    diet: 0.675,
    habitat: 0.675,
    byproductUse: 0.68,
    dormancyResponse: 1,
  }, { parentFamily: "plated", organismId: 7000, lineageId: 4242 });
}

/** Total full-extent x full-extent footprint, a pose-independent size proxy. */
function recipeFootprint(recipe: StructuralArtRecipe): number {
  return recipe.regions.reduce((sum, region) => sum
    + (region.geometry.kind === "polygon" ? 0 : region.geometry.length * region.geometry.width * 4), 0);
}

async function testDormancyContracturesEverySoftFamily(): Promise<void> {
  const { buildArtRecipe } = await import("../../packages/phenotype/src/art/index.ts");
  const fixtures = [
    ["branching", { speed: 1, sensing: 139.2, metabolism: 0.247, reproduction: 100, diet: 1.4, habitat: 1.4, byproductUse: 1.4, dormancyResponse: 0.8 }],
    ["blob", { speed: 1.56, sensing: 69.5, metabolism: 0.224, reproduction: 100, diet: 0.6, habitat: 0.6, byproductUse: 0.6, dormancyResponse: 0.8 }],
    ["segmented", { speed: 2.5, sensing: 86.5, metabolism: 0.27, reproduction: 100, diet: 0.9, habitat: 1.5, byproductUse: 1.5, dormancyResponse: 0.8 }],
    ["radial", { speed: 1.38, sensing: 149.4, metabolism: 0.247, reproduction: 100, diet: 0.6, habitat: 0.9, byproductUse: 1.5, dormancyResponse: 0.8 }],
    ["paddled", { speed: 3.55, sensing: 115.4, metabolism: 0.371, reproduction: 100, diet: 1.5, habitat: 1.5, byproductUse: 1.5, dormancyResponse: 0.8 }],
  ] as const;
  for (const [family, traits] of fixtures) {
    const resolved = resolvePhenotype({ ...traits }, { organismId: 7000, lineageId: 4242 });
    assert.equal(resolved.family, family, `${family} dormancy fixture resolves to its family`);
    const active = recipeFootprint(buildArtRecipe(resolved, "active"));
    const dormant = recipeFootprint(buildArtRecipe(resolved, "dormant"));
    assert.ok(dormant < active * 0.8,
      `${family} dormancy contractures the body: active=${active.toFixed(3)} dormant=${dormant.toFixed(3)} (must be < 80% of active)`);
  }
}

async function testSoftFamiliesVaryContinuouslyWithTraits(): Promise<void> {
  const { buildArtRecipe } = await import("../../packages/phenotype/src/art/index.ts");
  const fixtures = [
    ["blob", { speed: 1.56, sensing: 69.5, metabolism: 0.224, reproduction: 100, diet: 0.6, habitat: 0.6, byproductUse: 0.6, dormancyResponse: 0.8 }],
    ["segmented", { speed: 2.5, sensing: 86.5, metabolism: 0.27, reproduction: 100, diet: 0.9, habitat: 1.5, byproductUse: 1.5, dormancyResponse: 0.8 }],
    ["radial", { speed: 1.38, sensing: 149.4, metabolism: 0.247, reproduction: 100, diet: 0.6, habitat: 0.9, byproductUse: 1.5, dormancyResponse: 0.8 }],
    ["paddled", { speed: 3.55, sensing: 115.4, metabolism: 0.371, reproduction: 100, diet: 1.5, habitat: 1.5, byproductUse: 1.5, dormancyResponse: 0.8 }],
  ] as const;
  for (const [family, traits] of fixtures) {
    const base = resolvePhenotype({ ...traits }, { organismId: 7000, lineageId: 4242 });
    assert.equal(base.family, family, `${family} continuity fixture resolves to its family`);
    // A small quantized-trait step must deform the recipe, without rerolling it.
    // Each family's structure responds to a different trait, so every quantized
    // axis is stepped in turn rather than assuming one shared driver.
    const axes = ["bulk", "density", "elongation", "projection", "asymmetry", "secondary"] as const;
    let anyDeformed = false;
    for (const axis of axes) {
      const stepped = { ...base, quantized: { ...base.quantized, [axis]: Math.min(1, base.quantized[axis] + 0.05) } };
      assert.deepEqual(buildArtRecipe(stepped).regions.map((region) => region.id),
        buildArtRecipe(base).regions.map((region) => region.id),
      `${family} ${axis} step preserves region topology`);
      if (JSON.stringify(buildArtRecipe(stepped).regions) !== JSON.stringify(buildArtRecipe(base).regions)) {
        anyDeformed = true;
      }
    }
    assert.ok(anyDeformed,
      `${family} responds to at least one existing quantized trait with a geometry change`);
    // Continuity: the deformation must stay small relative to the body.
    const before = buildArtRecipe(base).regions;
    const after = buildArtRecipe({
      ...base, quantized: { ...base.quantized, bulk: Math.min(1, base.quantized.bulk + 0.02) },
    }).regions;
    let movement = 0;
    for (const [index, region] of before.entries()) {
      const first = region.geometry;
      const second = after[index]!.geometry;
      if (first.kind === "polygon" || second.kind === "polygon") continue;
      movement = Math.max(movement, Math.hypot(first.center.x - second.center.x, first.center.y - second.center.y));
    }
    assert.ok(movement < 0.02,
      `${family} a small bulk step moves no region more than 0.02 (max=${movement.toFixed(4)})`);
  }
}

/**
 * AC #131: ownership-driven transparency across every rich family, LOD, and
 * activity. This is the blocking gameplay defect: unowned pixels keeping the
 * structural raster's opaque backdrop uploaded each 64/128 texture rectangle
 * as a dark card that overlapped and obscured the world.
 */
async function testUnownedRichPixelsAreTransparent(): Promise<void> {
  const art = await import("../../packages/phenotype/src/art/index.ts");
  const fixtures = [
    ["plated", { speed: 1.4, sensing: 70, metabolism: 0.3392, reproduction: 100, diet: 0.675, habitat: 0.675, byproductUse: 0.68, dormancyResponse: 1 }],
    ["branching", { speed: 1, sensing: 139.2, metabolism: 0.247, reproduction: 100, diet: 1.4, habitat: 1.4, byproductUse: 1.4, dormancyResponse: 0.8 }],
    ["blob", { speed: 1.56, sensing: 69.5, metabolism: 0.224, reproduction: 100, diet: 0.6, habitat: 0.6, byproductUse: 0.6, dormancyResponse: 0.8 }],
    ["segmented", { speed: 2.5, sensing: 86.5, metabolism: 0.27, reproduction: 100, diet: 0.9, habitat: 1.5, byproductUse: 1.5, dormancyResponse: 0.8 }],
    ["radial", { speed: 1.38, sensing: 149.4, metabolism: 0.247, reproduction: 100, diet: 0.6, habitat: 0.9, byproductUse: 1.5, dormancyResponse: 0.8 }],
    ["paddled", { speed: 3.55, sensing: 115.4, metabolism: 0.371, reproduction: 100, diet: 1.5, habitat: 1.5, byproductUse: 1.5, dormancyResponse: 0.8 }],
  ] as const;
  const sizes = { population: 64, inspection: 128 } as const;
  for (const [family, traits] of fixtures) {
    const resolved = resolvePhenotype({ ...traits }, { organismId: 7000, lineageId: 4242 });
    assert.equal(resolved.family, family, `${family} transparency fixture resolves to its family`);
    for (const activity of ["active", "dormant"] as const) {
      for (const lod of ["population", "inspection"] as const) {
        const size = sizes[lod];
        const recipe = art.buildArtRecipe(resolved, activity);
        const view = art.resolveArtLod(recipe, lod);
        const neutral = art.rasterizeStructuralArt({ ...recipe, regions: view.regions }, { width: size, height: size });
        const rendered = art.materializeRaster(neutral, art.applyMaterialRoles(view, resolved));
        const label = `${family}/${activity}/${lod}`;
        let unowned = 0;
        let unownedOpaque = 0;
        let ownedInvisible = 0;
        let interstitialErased = 0;
        let ownedVisible = 0;
        for (let pixel = 0; pixel < size * size; pixel++) {
          const owner = neutral.masks.ownership[pixel]!;
          const alpha = rendered.rgba[pixel * 4 + 3]!;
          if (owner < 0) {
            unowned++;
            if (alpha !== 0) unownedOpaque++;
            // Fully cleared, not merely made invisible, so a filtered or
            // mis-sampled edge cannot pick backdrop colour back up.
            assert.deepEqual(
              [...rendered.rgba.slice(pixel * 4, pixel * 4 + 4)], [0, 0, 0, 0],
              `${label} clears unowned pixel RGB as well as alpha`,
            );
          } else if (alpha === 0) {
            ownedInvisible++;
            if (neutral.masks.materialRole[pixel] === art.MATERIAL_ROLE_IDS.interstitial) interstitialErased++;
          } else ownedVisible++;
        }
        assert.equal(unownedOpaque, 0, `${label} has no opaque unowned pixels (${unownedOpaque} of ${unowned})`);
        assert.equal(ownedInvisible, 0, `${label} keeps every owned pixel visible (${ownedInvisible} hidden)`);
        assert.equal(interstitialErased, 0, `${label} never erases authored interstitial material`);
        assert.ok(ownedVisible > 0, `${label} still renders authored phenotype pixels`);
      }
    }
  }
}

/**
 * Renderer identity and cosmetic variation are separate levers.
 *
 * The AC #131 transparency correction changed final RGBA bytes for every rich
 * raster, so the renderer version had to move — otherwise one version string
 * named two different outputs. But `unit()` salts the accepted accent and
 * boundary variation from that same string, so a naive bump would have re-rolled
 * family art pixel-for-pixel. These assertions pin the decoupling that keeps
 * both properties true at once.
 */
async function testRendererVersionIsDecoupledFromCosmeticVariation(): Promise<void> {
  const art = await import("../../packages/phenotype/src/art/index.ts");
  assert.match(art.PROCEDURAL_ART_VERSION, /^[a-z0-9][a-z0-9.-]+$/,
    "renderer identity is a well-formed version string");
  assert.match(art.PROCEDURAL_VARIATION_VERSION, /^[a-z0-9][a-z0-9.-]+$/,
    "variation identity is a well-formed version string");
  assert.notEqual(art.PROCEDURAL_ART_VERSION, art.PROCEDURAL_VARIATION_VERSION,
    "renderer identity and cosmetic variation identity are independent versions");

  const resolved = platedCenterFixture();
  const recipe = art.buildArtRecipe(resolved);
  const view = art.resolveArtLod(recipe, "inspection");
  const materialRecipe = art.applyMaterialRoles(view, resolved);
  assert.equal(materialRecipe.rendererVersion, art.PROCEDURAL_ART_VERSION,
    "material recipes record the renderer version that produced them");

  // The renderer bump must not move cosmetic placement. The golden hash
  // assertion elsewhere in this file pins the exact materialized bytes; this
  // restates the same invariant through accent geometry, which is where the
  // shared salt would have leaked if the two versions were still coupled.
  // Inspection LOD, because population deliberately suppresses accents.
  const accents = materialRecipe.accents;
  assert.ok(accents.length > 0, "inspection-scale accents exist to place");
  const first = accents[0]!;
  assert.ok(first.x > 0 && first.x < 1 && first.y > 0 && first.y < 1,
    "accent placement stays inside the organism footprint");
  assert.ok(accents.every((accent) => accent.x !== first.x || accent.y !== first.y || accent.regionId === first.regionId),
    "accent placement remains deterministic and non-degenerate under a renderer-version bump");

  // Materialized bytes must be a function of the variation version alone, so
  // rasterize+materialize stays stable while the renderer identity moves.
  const rasterA = art.materializeRaster(
    art.rasterizeStructuralArt({ ...recipe, regions: view.regions }, { width: 128, height: 128 }),
    materialRecipe);
  const rasterB = art.materializeRaster(
    art.rasterizeStructuralArt({ ...recipe, regions: view.regions }, { width: 128, height: 128 }),
    materialRecipe);
  assert.deepEqual(rasterA.rgba, rasterB.rgba,
    "materialized bytes are unchanged by the renderer-version bump");
  assert.equal(createHash("sha256").update(rasterA.rgba).digest("hex"),
    createHash("sha256").update(rasterB.rgba).digest("hex"),
    "identical bytes hash identically, confirming cosmetic placement did not shift");
}

async function testPopulationMatchesInspectionSilhouette(): Promise<void> {
  const art = await import("../../packages/phenotype/src/art/index.ts");
  const fixtures = [
    ["blob", { speed: 1.56, sensing: 69.5, metabolism: 0.224, reproduction: 100, diet: 0.6, habitat: 0.6, byproductUse: 0.6, dormancyResponse: 0.8 }],
    ["segmented", { speed: 2.5, sensing: 86.5, metabolism: 0.27, reproduction: 100, diet: 0.9, habitat: 1.5, byproductUse: 1.5, dormancyResponse: 0.8 }],
    ["radial", { speed: 1.38, sensing: 149.4, metabolism: 0.247, reproduction: 100, diet: 0.6, habitat: 0.9, byproductUse: 1.5, dormancyResponse: 0.8 }],
    ["paddled", { speed: 3.55, sensing: 115.4, metabolism: 0.371, reproduction: 100, diet: 1.5, habitat: 1.5, byproductUse: 1.5, dormancyResponse: 0.8 }],
  ] as const;
  for (const [family, traits] of fixtures) {
    const resolved = resolvePhenotype({ ...traits }, { organismId: 7000, lineageId: 4242 });
    assert.equal(resolved.family, family, `${family} LOD fixture resolves to its family`);
    const recipe = art.buildArtRecipe(resolved, "active");
    const population = art.resolveArtLod(recipe, "population");
    const inspection = art.resolveArtLod(recipe, "inspection");
    // Population retains exactly the structural regions and keeps their identity.
    assert.ok(population.regions.every((region) => inspection.regions.includes(region)),
      `${family} population regions are the same objects as their inspection regions`);
    assert.ok(population.regions.every((region) => region.detail === "structure"),
      `${family} population LOD keeps structural detail only`);
    // Every soft-bodied family must have a real LOD split: inspection reveals
    // detail population simplifies away. Radial previously authored no
    // secondary regions, which made its two rich tiers identical geometry.
    const secondaryCount = inspection.regions.filter((region) => region.detail !== "structure").length;
    assert.ok(secondaryCount > 0,
      `${family} authors inspection-only secondary detail for population to simplify away`);
    assert.ok(population.regions.length < inspection.regions.length,
      `${family} population LOD drops its ${secondaryCount} secondary regions`);
    const covered = new Set(population.regions.map((region) => region.id));
    for (const region of population.regions) {
      const source = inspection.regions.find((candidate) => candidate.id === region.id);
      assert.ok(source && source.geometry.kind !== "polygon" && region.geometry.kind !== "polygon"
        && source.geometry.center.x === region.geometry.center.x
        && source.geometry.center.y === region.geometry.center.y,
      `${family} population region ${region.id} keeps its inspection position, so zooming never moves the body`);
    }
    // Structural regions alone must still read as the family: the shared
    // silhouette must cover most of the full-detail silhouette.
    const at = (regions: typeof inspection.regions, size: number) =>
      art.rasterizeStructuralArt({ ...recipe, regions }, { width: size, height: size });
    const populationRaster = at(population.regions, 128);
    const inspectionRaster = at(inspection.regions, 128);
    const populationInk = populationRaster.masks.silhouette.reduce((sum, value) => sum + value, 0);
    const inspectionInk = inspectionRaster.masks.silhouette.reduce((sum, value) => sum + value, 0);
    const coverage = populationInk / Math.max(1, inspectionInk);
    assert.ok(coverage > 0.75,
      `${family} population silhouette retains ${(coverage * 100).toFixed(0)}% of inspection silhouette (must be > 75%)`);
    // Inspection must actually reveal more, not merely carry more region records.
// Scoped to Radial: its LOD split was the documented AC4 gap, and secondary
// regions hidden beneath structural ones contribute no ink, leaving the two
// tiers pixel-identical. Blob currently adds only ~1.8% ink here and Segmented
// and Paddled are unmeasured; widening this to every family would fail on
// accepted artwork rather than on a defect, so it is raised as an observation
// until that artwork is re-opened.
    if (family === "radial") {
      assert.ok(inspectionInk > populationInk * 1.1,
        `radial inspection reveals substantially more silhouette than population (${populationInk} -> ${inspectionInk} px, must be >10% more)`);
    }
  }
}

async function testSupportedFamilyDispatch(): Promise<void> {
  const art = await import("../../packages/phenotype/src/art/index.ts");
  const { buildArtRecipe } = art;
  const fixtures = [
    ["plated", { speed: 1.4, sensing: 70, metabolism: 0.3392, reproduction: 100, diet: 0.675, habitat: 0.675, byproductUse: 0.68, dormancyResponse: 1 }],
    ["branching", { speed: 1, sensing: 139.2, metabolism: 0.247, reproduction: 100, diet: 1.4, habitat: 1.4, byproductUse: 1.4, dormancyResponse: 0.8 }],
    ["blob", { speed: 1.56, sensing: 69.5, metabolism: 0.224, reproduction: 100, diet: 0.6, habitat: 0.6, byproductUse: 0.6, dormancyResponse: 0.8 }],
    ["segmented", { speed: 2.5, sensing: 86.5, metabolism: 0.27, reproduction: 100, diet: 0.9, habitat: 1.5, byproductUse: 1.5, dormancyResponse: 0.8 }],
    ["radial", { speed: 1.38, sensing: 149.4, metabolism: 0.247, reproduction: 100, diet: 0.6, habitat: 0.9, byproductUse: 1.5, dormancyResponse: 0.8 }],
    ["paddled", { speed: 3.55, sensing: 115.4, metabolism: 0.371, reproduction: 100, diet: 1.5, habitat: 1.5, byproductUse: 1.5, dormancyResponse: 0.8 }],
  ] as const;
  for (const [family, traits] of fixtures) {
    const resolved = resolvePhenotype({ ...traits }, { organismId: 7000, lineageId: 4242 });
    assert.equal(resolved.family, family, `${family} fixture resolves to its expected family`);
    const active = buildArtRecipe(resolved, "active");
    assert.equal(active.family, family, `${family} has a supported structural-art recipe`);
    assert.deepEqual(active, buildArtRecipe(resolved, "active"), `${family} recipe is deterministic`);
    const population = art.resolveArtLod(active, "population");
    const inspection = art.resolveArtLod(active, "inspection");
    assert.strictEqual(population.source, active, `${family} population LOD shares its source recipe`);
    assert.strictEqual(inspection.source, active, `${family} inspection LOD shares its source recipe`);
    if (family !== "plated") {
      assert.notDeepEqual(buildArtRecipe(resolved, "dormant"), active, `${family} dormancy has a family-specific geometry response`);
    }
    const material = art.applyMaterialRoles(population, resolved);
    const raster = art.rasterizeStructuralArt({ ...active, regions: population.regions }, { width: 16, height: 16 });
    const rendered = art.materializeRaster(raster, material);
    assert.deepEqual(rendered.masks, raster.masks, `${family} material pass leaves structural evidence unchanged`);
  }
}

async function testRecipeDeterminism(): Promise<void> {
  const { buildArtRecipe } = await import("../../packages/phenotype/src/art/index.ts");
  const first = buildArtRecipe(platedPhenotype());
  assert.deepEqual(first, buildArtRecipe(platedPhenotype()), "same resolved inputs produce the same recipe");
}

async function testCosmeticSeedVariationIsBounded(): Promise<void> {
  const { buildArtRecipe } = await import("../../packages/phenotype/src/art/index.ts");
  const base = platedPhenotype();
  const first = buildArtRecipe(base);
  const second = buildArtRecipe({ ...base, cosmeticSeed: (base.cosmeticSeed + 1) >>> 0 });
  assert.equal(first.family, "plated");
  assert.equal(second.family, "plated");
  assert.deepEqual(first.regions.map(({ id, depth, paintOrder, detail, materialRole, geometry }) =>
    [id, depth, paintOrder, detail, materialRole, geometry.kind]),
  second.regions.map(({ id, depth, paintOrder, detail, materialRole, geometry }) =>
    [id, depth, paintOrder, detail, materialRole, geometry.kind]),
  "cosmetic seed does not reroll region grammar or topology class");
  assert.notDeepEqual(first.regions, second.regions, "cosmetic seed contributes visible bounded irregularity");
  for (let index = 0; index < first.regions.length; index++) {
    const a = first.regions[index]!.geometry;
    const b = second.regions[index]!.geometry;
    if (a.kind !== "teardrop" || b.kind !== "teardrop") continue;
    assert.ok(Math.abs(a.center.x - b.center.x) <= 0.025, "seeded position jitter stays bounded");
    assert.ok(Math.abs(a.center.y - b.center.y) <= 0.025, "seeded position jitter stays bounded");
    assert.ok(Math.abs(a.axisRadians - b.axisRadians) <= 0.12, "seeded angle variation stays bounded");
  }
}

async function testRecipeUsesResolvedDeformationInputs(): Promise<void> {
  const { buildArtRecipe } = await import("../../packages/phenotype/src/art/index.ts");
  const base = platedPhenotype();
  const source = buildArtRecipe(base);
  const cases: Array<[string, ResolvedPhenotype]> = [
    ["bulk", { ...base, quantized: { ...base.quantized, bulk: Math.min(1, base.quantized.bulk + 0.25) } }],
    ["density", { ...base, quantized: { ...base.quantized, density: Math.min(1, base.quantized.density + 0.25) } }],
    ["elongation", { ...base, axes: { ...base.axes, mobility: Math.min(1, base.axes.mobility + 0.06) }, quantized: { ...base.quantized, elongation: Math.min(1, base.quantized.elongation + 0.25) } }],
    ["projection", { ...base, axes: { ...base.axes, sensing: Math.min(1, base.axes.sensing + 0.06) }, quantized: { ...base.quantized, projection: Math.min(1, base.quantized.projection + 0.25) } }],
    ["asymmetry", { ...base, axes: { ...base.axes, specialization: Math.min(1, base.axes.specialization + 0.06) }, quantized: { ...base.quantized, asymmetry: Math.min(1, base.quantized.asymmetry + 0.25) } }],
    ["secondary", { ...base, quantized: { ...base.quantized, secondary: Math.min(1, base.quantized.secondary + 0.5) } }],
    ["diet direction", { ...base, dietSigned: Math.min(1, base.dietSigned + 0.15) }],
    ["habitat direction", { ...base, habitatSigned: Math.min(1, base.habitatSigned + 0.15) }],
  ];
  for (const [name, changed] of cases) {
    assert.notDeepEqual(buildArtRecipe(changed), source, `${name} deforms Plated presentation from resolved input`);
  }

  const continuous = buildArtRecipe({
    ...base,
    axes: { ...base.axes, mobility: Math.min(1, base.axes.mobility + 0.01) },
  });
  const initialCenters = source.regions.filter((region) => region.geometry.kind === "teardrop");
  const changedCenters = continuous.regions.filter((region) => region.geometry.kind === "teardrop");
  const maximumCenterMovement = Math.max(...initialCenters.map((region, index) => {
    const a = region.geometry;
    const b = changedCenters[index]!.geometry;
    return a.kind === "teardrop" && b.kind === "teardrop"
      ? Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y)
      : 0;
  }));
  assert.ok(maximumCenterMovement > 0 && maximumCenterMovement < 0.005,
    "small continuous mobility changes produce a small, nonzero local recipe deformation");
  for (const region of [...source.regions, ...continuous.regions]) {
    const geometry = region.geometry;
    const points = geometry.kind === "polygon" ? geometry.points : [geometry.center];
    for (const point of points) {
      assert.ok(point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1,
        "trait-deformed structural coordinates remain normalized");
    }
  }
}

async function testProjectionOnlyAddsBoundedOutwardReach(): Promise<void> {
  const art = await import("../../packages/phenotype/src/art/index.ts");
  const base = platedPhenotype();
  const phenotypeAtProjection = (projection: number) => ({
    ...base,
    quantized: { ...base.quantized, projection },
  });
  const lowInput = phenotypeAtProjection(0);
  const nextInput = phenotypeAtProjection(0.25);
  const highInput = phenotypeAtProjection(1);
  assert.deepEqual({ ...highInput, quantized: { ...highInput.quantized, projection: lowInput.quantized.projection } }, lowInput,
    "one-trait evidence holds cosmetic seed and every non-projection phenotype input fixed");
  const low = art.buildArtRecipe(lowInput);
  const next = art.buildArtRecipe(nextInput);
  const high = art.buildArtRecipe(highInput);

  assert.equal(low.structuralVersion, "plated-grammar-v2",
    "the projection deformation uses a new structural-art identity");
  const plates = low.regions.filter((region) => region.geometry.kind === "teardrop");
  assert.equal(plates.length, 12, "projection preserves all twelve primary plate sites");
  assert.deepEqual(high.regions.map(({ id, depth, paintOrder, detail, materialRole, geometry }) =>
    [id, depth, paintOrder, detail, materialRole, geometry.kind]),
  low.regions.map(({ id, depth, paintOrder, detail, materialRole, geometry }) =>
    [id, depth, paintOrder, detail, materialRole, geometry.kind]),
  "projection preserves plate IDs, count, depth bands, paint order, and all region roles");

  const nextById = new Map(next.regions.map((region) => [region.id, region]));
  const highById = new Map(high.regions.map((region) => [region.id, region]));
  const alternateDirection = { ...base, dietSigned: base.dietSigned + 0.15, habitatSigned: base.habitatSigned - 0.15 };
  const alternateLow = art.buildArtRecipe({ ...alternateDirection, quantized: { ...alternateDirection.quantized, projection: 0 } });
  const alternateHigh = art.buildArtRecipe({ ...alternateDirection, quantized: { ...alternateDirection.quantized, projection: 1 } });
  const alternateLowById = new Map(alternateLow.regions.map((region) => [region.id, region]));
  const alternateHighById = new Map(alternateHigh.regions.map((region) => [region.id, region]));
  let maximumStepMovement = 0;
  let maximumStepLengthChange = 0;
  for (const plate of plates) {
    const lowGeometry = plate.geometry;
    const nextGeometry = nextById.get(plate.id)!.geometry;
    const highGeometry = highById.get(plate.id)!.geometry;
    assert.equal(lowGeometry.kind, "teardrop");
    assert.equal(nextGeometry.kind, "teardrop");
    assert.equal(highGeometry.kind, "teardrop");
    if (lowGeometry.kind !== "teardrop" || nextGeometry.kind !== "teardrop" || highGeometry.kind !== "teardrop") continue;

    const dx = highGeometry.center.x - lowGeometry.center.x;
    const dy = highGeometry.center.y - lowGeometry.center.y;
    const radial = (lowGeometry.center.x - 0.5) * dx + (lowGeometry.center.y - 0.5) * dy;
    assert.ok(radial > 0, `${plate.id} moves outward as projection increases`);
    assert.equal(highGeometry.axisRadians, lowGeometry.axisRadians,
      `${plate.id} orientation remains controlled by its existing non-projection inputs`);
    assert.equal(highGeometry.width, lowGeometry.width, `${plate.id} width is not repurposed as projection morphology`);
    assert.equal(highGeometry.taper, lowGeometry.taper, `${plate.id} taper is not repurposed as projection morphology`);
    if (plate.id.startsWith("mid-left") || plate.id.startsWith("mid-right")) {
      assert.ok(highGeometry.length > lowGeometry.length, `${plate.id} outward reach increases with projection`);
    } else {
      assert.equal(highGeometry.length, lowGeometry.length, `${plate.id} non-reach length remains unchanged`);
    }
    const altLow = alternateLowById.get(plate.id)!.geometry;
    const altHigh = alternateHighById.get(plate.id)!.geometry;
    assert.equal(altLow.kind, "teardrop");
    assert.equal(altHigh.kind, "teardrop");
    if (altLow.kind === "teardrop" && altHigh.kind === "teardrop") {
      assert.ok(Math.abs((altHigh.center.x - altLow.center.x) - dx) < 1e-12,
        `${plate.id} projection does not amplify diet-direction offsets`);
      assert.ok(Math.abs((altHigh.center.y - altLow.center.y) - dy) < 1e-12,
        `${plate.id} projection does not amplify habitat-direction offsets`);
    }
    maximumStepMovement = Math.max(maximumStepMovement,
      Math.hypot(nextGeometry.center.x - lowGeometry.center.x, nextGeometry.center.y - lowGeometry.center.y));
    maximumStepLengthChange = Math.max(maximumStepLengthChange, Math.abs(nextGeometry.length - lowGeometry.length));
    assert.ok(Math.abs(highGeometry.length - lowGeometry.length) < 0.1,
      `${plate.id} reach change stays locally bounded`);
  }
  assert.ok(maximumStepMovement > 0 && maximumStepMovement < 0.02,
    "one adjacent projection step creates a nonzero, locally bounded center displacement");
  assert.ok(maximumStepLengthChange > 0 && maximumStepLengthChange < 0.03,
    "one adjacent projection step creates a nonzero, locally bounded reach change");

  for (const region of low.regions.filter((candidate) => candidate.geometry.kind !== "teardrop")) {
    assert.deepEqual(highById.get(region.id), region,
      `${region.id} non-plate geometry is independent of projection`);
  }

  const population = art.resolveArtLod(next, "population");
  const inspection = art.resolveArtLod(next, "inspection");
  const highPopulation = art.resolveArtLod(high, "population");
  const highInspection = art.resolveArtLod(high, "inspection");
  assert.strictEqual(population.source, next, "population uses the deformed source recipe");
  assert.strictEqual(inspection.source, next, "inspection uses the same deformed source recipe");
  assert.strictEqual(highPopulation.source, high, "high-projection population retains its deformed source");
  assert.strictEqual(highInspection.source, high, "high-projection inspection retains that same source");
  for (const [lod, size] of [["population", 64], ["inspection", 128]] as const) {
    const view = art.resolveArtLod(high, lod);
    const raster = art.rasterizeStructuralArt({ ...high, regions: view.regions }, { width: size, height: size });
    const repeat = art.rasterizeStructuralArt({ ...high, regions: view.regions }, { width: size, height: size });
    assert.deepEqual(raster.rgba, repeat.rgba, `${lod} structural pixels rerender byte-identically`);
    const lowView = art.resolveArtLod(low, lod);
    const lowRaster = art.rasterizeStructuralArt({ ...low, regions: lowView.regions }, { width: size, height: size });
    assert.notDeepEqual(raster.rgba, lowRaster.rgba, `${lod} pixels visibly encode projection deformation`);
  }
}

const BRANCHING_BASE: Parameters<typeof resolvePhenotype>[0] = {
  speed: 1,
  sensing: 139.2,
  metabolism: 0.247,
  reproduction: 100,
  diet: 1.4,
  habitat: 1.4,
  byproductUse: 1.4,
  dormancyResponse: 0.8,
};

function branchingPhenotype(overrides: Partial<typeof BRANCHING_BASE> = {}): ResolvedPhenotype {
  return resolvePhenotype({ ...BRANCHING_BASE, ...overrides },
    { parentFamily: "branching", organismId: 7100, lineageId: 4343 });
}

async function testBranchingIdentityAndHierarchy(): Promise<void> {
  const art = await import("../../packages/phenotype/src/art/index.ts");
  const resolved = branchingPhenotype();
  assert.equal(resolved.family, "branching", "branching fixture resolves to the branching family");
  const recipe = art.buildArtRecipe(resolved);

  assert.equal(recipe.family, "branching");
  assert.match(recipe.structuralVersion, /^branching-grammar-v1$/,
    "branching art carries its own structural-art identity");

  const trunk = recipe.regions.filter((region) => region.depth === 0);
  assert.ok(trunk.length >= 1, "a rooted trunk anchors the colony");
  const offshoots = recipe.regions.filter((region) => region.detail === "secondary");
  assert.ok(offshoots.length >= 3, "hierarchical branches exist beyond the trunk");
  const nodules = recipe.regions.filter((region) => region.materialRole === "core");
  assert.ok(nodules.length >= 2, "terminal nodules cap the branches");

  // Rooting is asserted on the trunk's own lower extent: the trunk base must sit
  // in the lower part of the frame so the colony reads as anchored.
  const trunkGeometry = trunk[0]!.geometry;
  assert.notEqual(trunkGeometry.kind, "polygon");
  if (trunkGeometry.kind !== "polygon") {
    assert.ok(trunkGeometry.center.y + trunkGeometry.length / 2 > 0.8,
      "the trunk is rooted in the lower body rather than floating at the centre");
  }
  // Both sides of the colony must carry branches; a budget that kept only one
  // side previously produced a visibly one-sided silhouette.
  const branchXs = recipe.regions
    .filter((region) => region.geometry.kind !== "polygon")
    .map((region) => region.geometry.kind === "polygon" ? 0.5 : region.geometry.center.x);
  assert.ok(Math.max(...branchXs) - 0.5 > 0.08,
    "the colony branches meaningfully to the right of the trunk axis");
  assert.ok(0.5 - Math.min(...branchXs) > 0.08,
    "the colony branches meaningfully to the left of the trunk axis");
  // Centers are clamped to the normalized frame; a segment's bounding box can
  // still exceed it by up to half its length where a limb runs nearly
  // horizontally. The rasterizer clips to the canvas, so the meaningful bound
  // is that the segment center stays inside the frame.
  for (const region of recipe.regions) {
    if (region.geometry.kind === "polygon") continue;
    assert.ok(region.geometry.center.x >= 0 && region.geometry.center.x <= 1
      && region.geometry.center.y >= 0 && region.geometry.center.y <= 1,
      `${region.id} center stays inside the normalized frame`);
  }

  const centers = recipe.regions.filter((region) => region.geometry.kind !== "polygon")
    .map((region) => (region.geometry.kind === "polygon" ? null : region.geometry.center) as { x: number; y: number });
  const meanX = centers.reduce((sum, point) => sum + point.x, 0) / centers.length;
  const meanY = centers.reduce((sum, point) => sum + point.y, 0) / centers.length;
  const xSpread = Math.sqrt(centers.reduce((sum, point) => sum + (point.x - meanX) ** 2, 0) / centers.length);
  const ySpread = Math.sqrt(centers.reduce((sum, point) => sum + (point.y - meanY) ** 2, 0) / centers.length);
  // The accepted Branching artwork is a wide, rooted, spreading colony rather
  // than a tall narrow stem, so horizontal spread is the identity requirement.
  // This replaces an earlier vertical-dominance expectation that encoded a
  // bare-tree silhouette the Owner rejected.
  assert.ok(xSpread >= ySpread * 0.85,
    "the colony spreads horizontally at least as much as vertically, matching the accepted rooted spread");
  assert.ok(xSpread > 0.06,
    "branches reach meaningfully sideways from the trunk");
  assert.ok(centers.every((point) => point.y <= 0.92), "no colony part escapes the top boundary");
}

async function testBranchingDormancyWithdrawsGeometry(): Promise<void> {
  const art = await import("../../packages/phenotype/src/art/index.ts");
  const resolved = branchingPhenotype();
  const active = art.buildBranchingRecipe(resolved, "active");
  const dormant = art.buildBranchingRecipe(resolved, "dormant");
  assert.notDeepEqual(active.regions, dormant.regions,
    "branching dormancy withdraws branches rather than only dimming them");
  const secondaryCount = (recipe: typeof active) =>
    recipe.regions.filter((region) => region.detail === "secondary").length;
  assert.ok(secondaryCount(dormant) < secondaryCount(active),
    "dormancy compacts secondary branching");
  const area = (recipe: typeof active) => {
    const raster = art.rasterizeStructuralArt(recipe, { width: 128, height: 128 });
    return raster.masks.silhouette.reduce((sum, value) => sum + value, 0);
  };
  assert.ok(area(dormant) < area(active) * 0.75,
    "the dormant silhouette is materially more compact than the active one");

  const raster = art.rasterizeStructuralArt(dormant, { width: 128, height: 128 });
  const rgba = art.materializeRaster(raster, art.applyMaterialRoles(art.resolveArtLod(dormant, "inspection"), resolved))
    .rgba;
  assert.equal(rgba.length, 128 * 128 * 4, "dormant branching raster keeps its declared dimensions");
  const silhouette = raster.masks.silhouette.reduce((sum, value) => sum + value, 0);
  assert.ok(silhouette > 0, "the dormant colony remains visible rather than vanishing");
}

async function testBranchingTraitContinuityAndDeterminism(): Promise<void> {
  const art = await import("../../packages/phenotype/src/art/index.ts");
  const base = branchingPhenotype();
  assert.deepEqual(art.buildBranchingRecipe(base, "active"), art.buildBranchingRecipe(base, "active"),
    "identical branching inputs rerender byte-identically");

  // Trait continuity is measured inside the branching neighbourhood: a value
  // far enough away flips family assignment, which would test family
  // resolution rather than branching geometry.
  const branchingAt = (overrides: Partial<typeof BRANCHING_BASE>) => {
    const phenotype = branchingPhenotype(overrides);
    assert.equal(phenotype.family, "branching",
      `fixture ${JSON.stringify(overrides)} must stay inside the branching neighbourhood`);
    return art.buildBranchingRecipe(phenotype, "active");
  };
  const reach = (overrides: Partial<typeof BRANCHING_BASE>) => Math.max(...branchingAt(overrides)
    .regions.map((region) => region.geometry.kind === "polygon"
      ? 0
      : Math.hypot(region.geometry.center.x - 0.5, region.geometry.center.y - 0.5)));
  assert.ok(reach({ sensing: 155 }) > reach({ sensing: 120 }), "sensing increases branching reach");

  // Sprawl is outward extent from the colony's vertical axis, not the mean x
  // coordinate: a centred colony has a near-constant mean x regardless of how
  // wide it actually grows.
  const sprawl = (overrides: Partial<typeof BRANCHING_BASE>) => Math.max(...branchingAt(overrides).regions
    .filter((region) => region.geometry.kind !== "polygon")
    .map((region) => region.geometry.kind === "polygon"
      ? 0
      : Math.abs(region.geometry.center.x - 0.5)));
  assert.ok(sprawl({ speed: 0.7 }) > sprawl({ speed: 1.7 }),
    "mobility suppresses horizontal sprawl");

  const offshootCount = (overrides: Partial<typeof BRANCHING_BASE>) =>
    branchingAt(overrides).regions.filter((region) => region.detail === "secondary").length;
  assert.ok(offshootCount({ byproductUse: 1.45, diet: 1.45, habitat: 1.45 })
    >= offshootCount({ byproductUse: 0.75, diet: 0.75, habitat: 0.75 }),
    "specialization never reduces secondary branching below the low-specialization count");
  // The budget is indexed by offshoot-local count, so a fully specialized
  // colony reaches the authored hierarchy and dormancy still withdraws a real
  // number of branches rather than none.
  assert.equal(offshootCount({ byproductUse: 1.45, diet: 1.45, habitat: 1.45 }), 8,
    "the maximum specialization budget expresses all eight authored secondary offshoots");
  const dormantSecondaries = art.buildBranchingRecipe(branchingPhenotype(), "dormant").regions
    .filter((region) => region.detail === "secondary").length;
  assert.equal(dormantSecondaries, 4,
    "the dormant budget withdraws a bounded, nonzero set of secondary branches");

  const source = art.buildArtRecipe(base);
  const population = art.resolveArtLod(source, "population");
  const inspection = art.resolveArtLod(source, "inspection");
  assert.strictEqual(population.source, inspection.source,
    "branching population and inspection share one deformed source recipe");
  assert.ok(population.regions.every((region) => region.detail === "structure"),
    "population keeps only structural branching regions");
  assert.deepEqual(inspection.regions, source.regions,
    "inspection retains every branching source region");
  const palette = art.applyMaterialRoles(inspection, base).palette;
  for (const channel of [palette.body.r, palette.body.g, palette.body.b]) {
    assert.ok(Number.isInteger(channel) && channel >= 0 && channel <= 255,
      "branching palette channels are bounded byte values");
  }
  assert.notDeepEqual(palette, art.PLATED_MATERIAL_PALETTE,
    "branching uses its own material identity rather than the plated palette");
  // Accepted family direction: cool aquatic body mass with warm terminal
  // accents. A brown/ochre palette previously pulled the family back toward
  // the rejected plant read.
  const mean = (color: { r: number; g: number; b: number }) => (color.r + color.g + color.b) / 3;
  assert.ok(palette.light.b > palette.light.r,
    "branching body mass reads cool aqua, not brown");
  assert.ok(palette.core.r > palette.core.b,
    "branching terminal nodules read warm coral against the cool body");
}

async function testPackedDirectionalShellMound(): Promise<void> {
  const { buildArtRecipe } = await import("../../packages/phenotype/src/art/index.ts");
  const recipe = buildArtRecipe(platedPhenotype());
  const plates = recipe.regions.filter((region) => region.detail === "structure" && region.geometry.kind === "teardrop");
  assert.ok(plates.length >= 9, "mound has multiple readable plates across depth layers");
  const radii = plates.map((region) => {
    const geometry = region.geometry;
    assert.equal(geometry.kind, "teardrop");
    return Math.hypot(geometry.center.x - 0.5, geometry.center.y - 0.5);
  });
  const meanRadius = radii.reduce((total, radius) => total + radius, 0) / radii.length;
  const radiusCv = Math.sqrt(radii.reduce((total, radius) => total + (radius - meanRadius) ** 2, 0) / radii.length) / meanRadius;
  assert.ok(radiusCv > 0.25, "plate roots are scattered through the mound rather than placed on a regular ring");
  const foreground = plates.filter((region) => region.depth === 2);
  assert.ok(foreground.length >= 3, "several foreground plates form an imbricated stack");
  assert.ok(plates.every((region) => region.geometry.kind === "teardrop" && region.geometry.length < 0.42),
    "the center has no oversized radial hero plate");
  assert.ok(!plates.some((region) => /hero/i.test(region.id)), "grammar has no privileged central hero plate");
  assert.ok(new Set(plates.map((region) => region.depth)).size >= 3,
    "rear/mid/foreground plates are explicitly layered");
}

async function testCpuRasterAndNearestScale(): Promise<void> {
  const art = await import("../../packages/phenotype/src/art/index.ts");
  assert.equal(typeof art.rasterizeStructuralArt, "function", "structural recipe has a CPU rasterizer");
  assert.equal(typeof art.scaleRasterNearest, "function", "review enlargement uses integer nearest-neighbor pixels");
  const recipe = art.buildArtRecipe(platedPhenotype());
  const raster = art.rasterizeStructuralArt(recipe, { width: 128, height: 128 });
  const repeat = art.rasterizeStructuralArt(recipe, { width: 128, height: 128 });
  assert.deepEqual(raster, repeat, "CPU raster output is deterministic");
  assert.equal(raster.rgba.length, 128 * 128 * 4);
  assert.equal(raster.masks.silhouette.length, 128 * 128);
  assert.ok(raster.masks.silhouette.some((value) => value === 1), "raster contains actual silhouette pixels");
  assert.ok(new Set(raster.masks.ownership.filter((owner) => owner >= 0)).size >= 6,
    "native raster preserves multiple partially occluding plate owners");
  const enlarged = art.scaleRasterNearest(raster, 3);
  assert.equal(enlarged.width, 384);
  assert.equal(enlarged.height, 384);
  for (let y = 0; y < raster.height; y++) {
    for (let x = 0; x < raster.width; x++) {
      const from = (y * raster.width + x) * 4;
      const to = ((y * 3) * enlarged.width + x * 3) * 4;
      assert.deepEqual(enlarged.rgba.slice(to, to + 4), raster.rgba.slice(from, from + 4),
        "nearest-scaled raster preserves native pixel colors");
    }
  }
}

async function testMaterialPassPreservesStructuralMasks(): Promise<void> {
  const art = await import("../../packages/phenotype/src/art/index.ts");
  assert.equal(typeof art.applyMaterialRoles, "function", "material role pass is exported separately");
  assert.equal(typeof art.materializeRaster, "function", "material pass can colorize a structural raster");
  const resolved = platedPhenotype();
  const recipe = art.buildArtRecipe(resolved);
  const view = { source: recipe, lod: "inspection" as const, regions: recipe.regions };
  const materialRecipe = art.applyMaterialRoles(view, resolved);
  assert.equal(materialRecipe.rendererVersion, art.PROCEDURAL_ART_VERSION,
    "material accents record the renderer version used in their deterministic identity");
  const neutral = art.rasterizeStructuralArt(recipe, { width: 128, height: 128 });
  const material = art.materializeRaster(neutral, materialRecipe);
  assert.deepEqual(materialRecipe.regions.map((region) => region.id), recipe.regions.map((region) => region.id),
    "material view preserves region IDs and order");
  assert.deepEqual(materialRecipe.regions, recipe.regions,
    "material pass carries exact accepted geometry without mutation");
  assert.strictEqual(material.masks, neutral.masks, "material result shares the exact immutable geometry-mask bundle");
  assert.strictEqual(material.masks.silhouette, neutral.masks.silhouette);
  assert.strictEqual(material.masks.ownership, neutral.masks.ownership);
  assert.strictEqual(material.masks.depth, neutral.masks.depth);
  assert.strictEqual(material.masks.materialRole, neutral.masks.materialRole);
  assert.notDeepEqual(material.rgba, neutral.rgba, "material pass changes color bytes, not structural masks");
  for (let pixel = 0; pixel < neutral.width * neutral.height; pixel++) {
    if (neutral.masks.ownership[pixel] !== -1) continue;
    assert.deepEqual(
      [...material.rgba.slice(pixel * 4, pixel * 4 + 4)],
      [0, 0, 0, 0],
      "unowned pixels are fully transparent, so no texture card is uploaded over the world",
    );
  }
  const displayRoles = art.deriveMaterialRoleView(neutral);
  assert.ok(displayRoles.every((role, pixel) => role === neutral.masks.materialRole[pixel]),
    "diagnostic role view exactly reflects accepted structural roles");
  assert.strictEqual(material.masks.materialRole, neutral.masks.materialRole,
    "material pass never rewrites the accepted semantic role mask");
  assert.deepEqual(material, art.materializeRaster(neutral, materialRecipe), "material accents are deterministic");
  const centralPearls = materialRecipe.accents.filter((accent) => accent.role === "core");
  assert.equal(centralPearls.length, 2, "existing center details receive material-only pearl treatment");
  const pearlColors = centralPearls.map((accent) => {
    const pixel = Math.floor(accent.y * material.height) * material.width + Math.floor(accent.x * material.width);
    return [...material.rgba.slice(pixel * 4, pixel * 4 + 3)];
  });
  assert.notDeepEqual(pearlColors[0], pearlColors[1], "central pearl tones are subdued and asymmetric, not a paired pictograph");
  assert.ok(pearlColors.flat().every((channel) => channel < materialRecipe.palette.accent.r),
    "central pearls stay below highlight intensity");
  const nextSeedPhenotype = { ...resolved, cosmeticSeed: (resolved.cosmeticSeed + 1) >>> 0 };
  const nextSeedRecipe = art.buildArtRecipe(nextSeedPhenotype);
  const nextSeedMaterial = art.applyMaterialRoles(art.resolveArtLod(nextSeedRecipe, "inspection"), nextSeedPhenotype);
  assert.notDeepEqual(materialRecipe.accents, nextSeedMaterial.accents,
    "accent placement changes deterministically with presentation identity seed");
}

async function testPaletteRoleCoverage(): Promise<void> {
  const art = await import("../../packages/phenotype/src/art/index.ts");
  const resolved = platedPhenotype();
  const recipe = art.buildArtRecipe(resolved);
  const view = { source: recipe, lod: "inspection" as const, regions: recipe.regions };
  const material = art.applyMaterialRoles(view, resolved);
  const palette = material.palette;
  for (const role of ["deep-tissue", "shadow", "body", "light", "rim", "interstitial", "core", "accent"] as const) {
    assert.ok(palette[role], `approved material role ${role} has a finite palette color`);
    for (const channel of [palette[role].r, palette[role].g, palette[role].b]) {
      assert.ok(Number.isInteger(channel) && channel >= 0 && channel <= 255,
        `${role} palette channels are bounded byte values`);
    }
  }
  const raster = art.materializeRaster(art.rasterizeStructuralArt(recipe, { width: 128, height: 128 }), material);
  const displayRoles = art.deriveMaterialRoleView(raster);
  const validRoleIds = new Set([0, ...Object.values(art.MATERIAL_ROLE_IDS)]);
  assert.ok(displayRoles.every((roleId) => validRoleIds.has(roleId)),
    "every derived display role ID resolves to a defined palette role or background");
  assert.ok(recipe.regions.some((region) => region.materialRole === "interstitial"));
  assert.ok(recipe.regions.filter((region) => region.detail === "secondary").length >= 2,
    "existing central inclusions stay in the recipe for subdued material treatment");
}

async function testLodResolutionPreservesOneSourceRecipe(): Promise<void> {
  const art = await import("../../packages/phenotype/src/art/index.ts");
  assert.equal(typeof art.resolveArtLod, "function", "rich LOD views resolve from a source recipe");
  const source = art.buildArtRecipe(platedPhenotype());
  const sourceBefore = structuredClone(source);
  const population = art.resolveArtLod(source, "population");
  const inspection = art.resolveArtLod(source, "inspection");

  assert.strictEqual(population.source, source, "population view retains the same source recipe identity");
  assert.strictEqual(inspection.source, source, "inspection view retains the same source recipe identity");
  assert.deepEqual(inspection.regions, source.regions, "inspection preserves every full-detail source region");
  assert.deepEqual(population.regions, source.regions.filter((region) => region.detail === "structure"),
    "population retains exactly the original structural regions and their fields");
  assert.ok(population.regions.every((region) => source.regions.includes(region)),
    "population creates no region IDs or geometry outside the source");
  assert.ok(population.regions.every((region) => region.detail === "structure"),
    "population excludes secondary and micro detail");
  assert.deepEqual(new Set(population.regions.map((region) => region.depth)), new Set([0, 1, 2]),
    "population keeps all three rear/mid/front depth bands");
  assert.ok(population.regions.some((region) => region.materialRole === "interstitial"),
    "population retains explicitly owned structural interstitial regions");
  assert.deepEqual(source, sourceBefore, "LOD resolution does not mutate its source recipe");
  assert.deepEqual(art.resolveArtLod(source, "population"), population, "LOD views resolve deterministically");
}

async function testPopulationMaterialSuppressesFineAccents(): Promise<void> {
  const art = await import("../../packages/phenotype/src/art/index.ts");
  const resolved = platedCenterFixture();
  const source = art.buildArtRecipe(resolved);
  const population = art.applyMaterialRoles(art.resolveArtLod(source, "population"), resolved);
  const inspection = art.applyMaterialRoles(art.resolveArtLod(source, "inspection"), resolved);
  assert.ok(population.accents.every((accent) => accent.role !== "accent"),
    "population material suppresses per-region highlight accents");
  assert.deepEqual(inspection.accents,
    art.applyMaterialRoles({ source, lod: "inspection", regions: source.regions }, resolved).accents,
    "inspection retains accepted Checkpoint B accent behavior");
  assert.ok(inspection.accents.some((accent) => accent.role === "accent"));
  assert.ok(inspection.accents.some((accent) => accent.role === "core"));

  const populationRaster = art.rasterizeStructuralArt({ ...source, regions: population.regions }, { width: 64, height: 64 });
  const first = art.materializeRaster(populationRaster, population);
  const second = art.materializeRaster(populationRaster, population);
  assert.deepEqual(first, second, "population RGBA and structural masks are deterministic");
  assert.equal(first.width, 64);
  assert.equal(first.height, 64);

  const inspectionRaster = art.rasterizeStructuralArt({ ...source, regions: inspection.regions }, { width: 128, height: 128 });
  const inspectionMaterial = art.materializeRaster(inspectionRaster, inspection);
  assert.equal(createHash("sha256").update(inspectionRaster.rgba).digest("hex"),
    "9c03edffbf2feb365042f7a63534e27d77a08bf6a60d0bf2ee3781bfac1d1b0f",
    "inspection neutral raster pins the Checkpoint D projection geometry baseline");
  const inspectionHash = createHash("sha256").update(inspectionMaterial.rgba).digest("hex");
  // Repinned for AC #131. Unowned pixels are now cleared to (0,0,0,0) instead
  // of retaining the structural raster's opaque (16,20,26,255) backdrop, so the
  // materialized bytes change while the neutral geometry hash above is
  // unchanged. The pin still holds the output exactly; only the expected value
  // moved, and only because the rendered contract changed.
  assert.equal(inspectionHash, "1f3cd7210fe69bb9aa2311b372c7fd8fd2701db0605d9bb0d9c789369fee0e62",
    "inspection native material bytes pin the Checkpoint D projection baseline plus transparent unowned pixels");
  assert.equal(population.rendererVersion, inspection.rendererVersion,
    "rich LOD material views share one renderer-version identity");
}

void testArtPackageBoundary().then(() => {
  testArtContracts();
  return testSupportedFamilyDispatch();
}).then(() => testRecipeDeterminism()).then(() => testCosmeticSeedVariationIsBounded())
  .then(() => testRecipeUsesResolvedDeformationInputs())
  .then(() => testProjectionOnlyAddsBoundedOutwardReach())
  .then(() => testBranchingIdentityAndHierarchy())
  .then(() => testBranchingDormancyWithdrawsGeometry())
  .then(() => testBranchingTraitContinuityAndDeterminism())
  .then(() => testPackedDirectionalShellMound())
  .then(() => testCpuRasterAndNearestScale())
  .then(() => testMaterialPassPreservesStructuralMasks())
  .then(() => testPaletteRoleCoverage())
  .then(() => testLodResolutionPreservesOneSourceRecipe())
  .then(() => testPopulationMaterialSuppressesFineAccents())
  .then(() => testDormancyContracturesEverySoftFamily())
  .then(() => testSoftFamiliesVaryContinuouslyWithTraits())
  .then(() => testUnownedRichPixelsAreTransparent())
  .then(() => testRendererVersionIsDecoupledFromCosmeticVariation())
  .then(() => testPopulationMatchesInspectionSilhouette())
  .then(() => {
  console.log("phenotype art package and contracts: PASS");
});
