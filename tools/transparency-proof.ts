/**
 * Ownership-driven transparency verification.
 *
 * Reports, per family and per rich LOD, how many pixels of the production RGBA
 * are transparent and how many owned pixels stayed visible. The failure this
 * guards against is specific: unowned pixels keeping the structural raster's
 * opaque backdrop, which uploads as a visible dark card over the world.
 *
 * This is a measurement, not a threshold. It deliberately does not fail the
 * process: what counts as an acceptable ink budget is a design judgement, and
 * a ratio chosen here would be an invented product guarantee. The hard
 * invariants (every unowned pixel transparent, every owned pixel opaque,
 * interstitial never erased) are asserted by tools/validation/phenotype-art.ts.
 */
import { resolvePhenotype } from "../packages/phenotype/src/index.ts";
import {
  applyMaterialRoles,
  buildArtRecipe,
  materializeRaster,
  rasterizeStructuralArt,
  resolveArtLod,
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

const SIZES = { population: 64, inspection: 128 } as const;
let hardFailures = 0;

console.log("family      lod          size   unowned  opaque  clear   owned  opaque  invisible  interstitial");
for (const family of Object.keys(FIXTURES) as Family[]) {
  const resolved = resolvePhenotype({ ...FIXTURES[family] }, { organismId: 9100, lineageId: 5150 });
  if (resolved.family !== family) throw new Error(`${family} fixture resolved to ${resolved.family}`);
  for (const lod of ["population", "inspection"] as const) {
    for (const activity of ["active", "dormant"] as const) {
      const size = SIZES[lod];
      const recipe = buildArtRecipe(resolved, activity);
      const view = resolveArtLod(recipe, lod);
      const neutral = rasterizeStructuralArt({ ...recipe, regions: view.regions }, { width: size, height: size });
      const rendered = materializeRaster(neutral, applyMaterialRoles(view, resolved));
      const total = size * size;

      let unownedOpaque = 0;
      let ownedOpaque = 0;
      let ownedTransparent = 0;
      let interstitialInvisible = 0;
      for (let pixel = 0; pixel < total; pixel++) {
        const owner = neutral.masks.ownership[pixel]!;
        const alpha = rendered.rgba[pixel * 4 + 3]!;
        if (owner < 0) {
          if (alpha !== 0) unownedOpaque++;
        } else if (alpha === 0) {
          ownedTransparent++;
          if (neutral.masks.materialRole[pixel] === 6) interstitialInvisible++;
        } else ownedOpaque++;
      }

      const unowned = unownedOpaque + 0;
      const unownedCount = total - (ownedOpaque + ownedTransparent);
      const unownedOpaquePct = (unownedOpaque / Math.max(1, unownedCount)) * 100;
      const ownedInvisiblePct = (ownedTransparent / Math.max(1, ownedOpaque + ownedTransparent)) * 100;
      const bad = unownedOpaque > 0 || ownedTransparent > 0;
      if (bad) hardFailures++;
      void unowned;

      console.log(
        `${family.padEnd(11)} ${(activity + "/" + lod).padEnd(12)} ${String(size).padStart(3)}`
        + `  ${String(unownedCount).padStart(7)}  ${String(unownedOpaque).padStart(6)}  ${(unownedOpaquePct.toFixed(1) + "%").padStart(6)}`
        + `  ${String(ownedOpaque + ownedTransparent).padStart(6)}  ${String(ownedOpaque).padStart(6)}`
        + `  ${(ownedInvisiblePct.toFixed(1) + "%").padStart(9)}  ${String(interstitialInvisible).padStart(13)}`
        + (bad ? "   <-- VIOLATION" : ""),
      );
    }
  }
}

console.log(hardFailures === 0
  ? "\ntransparency: every unowned pixel is alpha 0; every owned pixel is visible; no interstitial erased"
  : `\ntransparency: ${hardFailures} VIOLATION(S)`);
if (hardFailures > 0) process.exitCode = 1;