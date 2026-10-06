import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolvePhenotype, type ResolvedPhenotype } from "../../packages/phenotype/src/index.ts";
import type { ProceduralPhenotypeRaster, StructuralArtRecipe } from "../../packages/phenotype/src/art/index.ts";

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

async function testPlatedFamilyRequired(): Promise<void> {
  const { buildArtRecipe } = await import("../../packages/phenotype/src/art/index.ts");
  assert.equal(typeof buildArtRecipe, "function", "Plated recipe builder is exported");
  assert.throws(() => buildArtRecipe({ ...platedPhenotype(), family: "blob" }), /unsupported.*blob|plated.*only/i,
    "the Plated-only art path rejects non-Plated phenotypes");
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
  const view = { source: recipe, lod: "population" as const, regions: recipe.regions };
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
      [...neutral.rgba.slice(pixel * 4, pixel * 4 + 4)],
      "material pass never colors pixels outside accepted structural ownership",
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
  const nextSeedMaterial = art.applyMaterialRoles({ source: nextSeedRecipe, lod: "population", regions: nextSeedRecipe.regions }, nextSeedPhenotype);
  assert.notDeepEqual(materialRecipe.accents, nextSeedMaterial.accents,
    "accent placement changes deterministically with presentation identity seed");
}

async function testPaletteRoleCoverage(): Promise<void> {
  const art = await import("../../packages/phenotype/src/art/index.ts");
  const resolved = platedPhenotype();
  const recipe = art.buildArtRecipe(resolved);
  const view = { source: recipe, lod: "population" as const, regions: recipe.regions };
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

void testArtPackageBoundary().then(() => {
  testArtContracts();
  return testPlatedFamilyRequired();
}).then(() => testRecipeDeterminism()).then(() => testCosmeticSeedVariationIsBounded())
  .then(() => testRecipeUsesResolvedDeformationInputs())
  .then(() => testPackedDirectionalShellMound())
  .then(() => testCpuRasterAndNearestScale())
  .then(() => testMaterialPassPreservesStructuralMasks())
  .then(() => testPaletteRoleCoverage()).then(() => {
  console.log("phenotype art package and contracts: PASS");
});
