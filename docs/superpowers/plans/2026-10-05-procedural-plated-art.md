# Procedural Multi-Scale Plated Art Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an isolated deterministic CPU procedural-art path that turns one resolved Plated phenotype into structural, material, and population/inspection rasters for staged Owner review.

**Architecture:** Add a family-independent art API under `packages/phenotype/src/art/`, with a Plated-only grammar, one resolution-independent structural recipe, an independent material-role pass, semantic LOD selection, and immutable CPU RGBA output. Keep the accepted monochrome renderer, production Explorer path/cache, simulation/runtime contracts, and all other family grammars unchanged; drive a standalone proof surface from the package API.

**Tech Stack:** Existing TypeScript/Node 24/pnpm workspace, phenotype package with no runtime dependencies, Node `assert` validation, existing Playwright/Vite tooling for review captures; no new runtime or package dependencies.

**Spec:** Owner handoff in issue #102 and this conversation; latest process correction is issue comment 6003389114. These accepted Owner inputs replace a separate design-spec artifact.

## Global Constraints

- Ecosystem remains the accepted 9×9 / 1.08 form; do not modify `LOD_GRID_SIZE` or ecosystem rendering.
- `ResolvedPhenotype` is the complete semantic input; do not alter resolution, ranges, persistence, simulation RNG, or biological semantics.
- Scope is Plated only; no production Explorer integration during the proof.
- Structural recipe is resolution-independent and shared by population and inspection renders.
- CPU RGBA raster is deterministic, immutable, and independent of DOM, Pixi, GPU backend, and frame timing.
- Reference images are calibration-only; do not use them as production assets, templates, or runtime inputs.
- Do not modify existing production Boolean-grid texture/cache authority or analytical lens behavior.
- Geometry checkpoint A must receive Owner visual review before material checkpoint B; B must be accepted before LOD checkpoint C; do not proceed to trait sweep D without that checkpoint sequence and approval.
- Do not add runtime dependencies, simulation imports, or checkpoint/evidence state.

## Review Focus

- Same `ResolvedPhenotype` and renderer version but different output size: structure/material decisions stay semantically equivalent while raster dimensions change. Test in Task 4.
- Different cosmetic seeds: variation remains bounded and does not change family grammar or major topology. Test in Task 2.
- Small supported continuous/quantized trait changes: parameter deformation is bounded and does not silently cross family/topology semantics. Test in Task 2; defer broad sweeps to checkpoint D.
- Minimum supported review raster and clipped/extreme primitive bounds: output has valid dimensions, no out-of-range writes, and deterministic masks/bytes. Test in Task 4.
- Non-Plated resolved phenotype: Plated entry point rejects it explicitly rather than selecting or rendering another family. Test in Task 2.

---

## File Map

**Create under `packages/phenotype/src/art/`:**

- `types.ts` — immutable primitive, recipe, LOD, material-role, and raster contracts.
- `version.ts` — explicit procedural-art renderer version constant.
- `families/plated.ts` — Plated-only recipe grammar and bounded trait deformation from `ResolvedPhenotype`.
- `recipe.ts` — family dispatch boundary for the currently supported Plated grammar; throw for unsupported families, with no placeholder grammars.
- `lod.ts` — semantic detail-budget selection over the shared recipe.
- `material.ts` — role assignments and a small semantic palette; no geometry mutation.
- `raster.ts` — pure rasterization into RGBA bytes and optional evidence masks.
- `identity.ts` — renderer-version/dimension/raster identity descriptor with exact-byte collision/equality guard; prototype only, not production cache integration.
- `index.ts` — narrow public API/types for the isolated proof consumer.

**Modify:**

- `packages/phenotype/package.json` — export the isolated `./art` entry point without adding dependencies.
- `package.json` — add `test:phenotype-art`.
- `tools/validation/manifest.ts` — register focused deterministic art validation as a presentation unit and CI presentation member.

**Create proof/evidence tooling:**

- `tools/phenotype-art-proof/fixture.ts` — one deterministic Plated family-center input and explicit manifest inputs.
- `tools/phenotype-art-proof/page.ts` plus `index.html`/Vite config — standalone presentation of recipe, masks, candidate rasters, and optional reference/calibration image; label any reference as calibration-only.
- `tools/phenotype-art-proof/capture.ts` — use existing Playwright to emit native and nearest-neighbor review PNGs plus JSON manifest into an external evidence directory; no generated evidence committed.
- `tools/validation/phenotype-art.ts` — pure Node deterministic/structural validation; no browser or Pixi required.

**Preserve as historical/current isolated prototype unless later approved:** `tools/plated-proof/`, `packages/phenotype/evidence/`, and the production Explorer renderer/cache. The existing `tools/plated-proof/geometry.ts` uses fixed `GEOMETRY_SEED`; its `renderPlated()` uses that same fixed layout and therefore is not reusable unchanged as the new phenotype-derived recipe. Existing geometry/material code may be consulted as prior prototype evidence, not treated as an alternate semantic authority.

## Interfaces

- `buildArtRecipe(resolved: ResolvedPhenotype): StructuralArtRecipe` — dispatch only to the Plated grammar in this tranche; the proof builds this once and passes that exact immutable recipe to both LOD branches.
- `selectArtLod(recipe: StructuralArtRecipe, lod: "population" | "inspection"): ArtLodRecipe` — choose detail budget without rebuilding topology.
- `applyMaterialRoles(recipe: ArtLodRecipe): MaterialRecipe` — assign semantic roles carried by the recipe, preserving geometry/masks.
- `rasterizeArt(recipe: MaterialRecipe, options: { width: number; height: number; rendererVersion: string }): ProceduralPhenotypeRaster` — return `width`, `height`, `rgba: Uint8Array`, and evidence masks/role IDs.
- `describeArtRaster(raster, rendererVersion): ProceduralArtIdentity` — include explicit version and dimensions in key; retain/compare exact RGBA bytes so hash collisions cannot alias identity.
- Structural primitives use normalized coordinates and explicit stable IDs, local axes, bounded shape parameters, depth/z-order, overlap order, and material-role IDs. Do not encode source/output pixel resolution into the structural recipe.
- Recipe/raster outputs are immutable by contract; typed-array ownership transfers to the returned value and must not alias mutable scratch buffers.

## Task 1: Define Art Contracts and Version Boundary

**Files:** create `packages/phenotype/src/art/types.ts`, `version.ts`, and the initial `tools/validation/phenotype-art.ts`; modify package exports and root `src/index.ts` only if needed for package API compatibility.

**Interfaces:** define normalized primitives/recipe, material roles, `ArtLod`, raster masks, `ProceduralPhenotypeRaster`; set an explicit `PROCEDURAL_ART_VERSION` string. No Pixi, DOM, or simulation imports.

- [x] Write contract tests for dimensions, normalized-coordinate recipe data, allowed LOD values, and renderer-version presence.
- [x] Run `pnpm exec tsx tools/validation/phenotype-art.ts`; expected missing `./art` package export; observed assertion failure on missing export.
- [x] Implement the minimal types/version and `./art` package export.
- [x] Run focused test and `pnpm exec tsc -p packages/phenotype/tsconfig.json --noEmit --pretty false`; both pass.
- [x] Check package dependency list remains empty and `git diff --check` passes.

## Task 2: Build the Plated Structural Recipe (Checkpoint A Geometry)

**Files:** create `families/plated.ts`, `recipe.ts`; extend `tools/validation/phenotype-art.ts`; create the initial geometry-only `tools/phenotype-art-proof/` page/capture surface.

**Interfaces:** implement `buildArtRecipe(resolved)` and Plated family-center recipe generation. Recipe geometry must derive from the resolved Plated family and its existing axes/quantized/signed fields. Seed may add bounded angle/placement/size irregularity only; it must not select family or major topology. Use family-independent primitive types; keep plate-specific construction inside `families/plated.ts`.

- [ ] Add failing tests `testPlatedFamilyRequired`, `testRecipeDeterminism`, and `testCosmeticSeedVariationIsBounded`; assert same inputs deep-equal, seed changes leave family and plate grammar/topology class stable, and non-Plated input throws.
- [ ] Run the focused validator and confirm the intended missing API/assertion failures.
- [ ] Implement the Plated recipe as irregular overlapping shell/leaf/teardrop regions with varied orientation, several depth layers, buried roots, explicit interstitial regions, and asymmetric outer contour; geometry only, neutral values.
- [ ] Add `testRecipeUsesResolvedDeformationInputs` for bounded bulk/density/elongation/projection/asymmetry/secondary/directional response; do not add new phenotype semantics.
- [ ] Run focused validator and phenotype baseline `pnpm test:phenotype`; expect pass, with no changes to existing renderer results.
- [ ] Generate Checkpoint A recipe visualization, silhouette mask, plate ownership/depth overlay, and neutral flat-value candidate at review resolution from the initial proof surface.
- [ ] **Stop for Owner geometry review.** Do not implement the material pass until geometry is accepted.

## Task 3: Add the Separate Material-Role Pass (Checkpoint B)

**Files:** create `material.ts`; extend proof page/capture only.

**Interfaces:** `applyMaterialRoles(ArtLodRecipe, ResolvedPhenotype): MaterialRecipe`; palette is a finite map of semantic roles (deep tissue, plate shadow/body/light, rim, interstitial, pearl/core, restrained accent). Material stage may color/rank existing structural pixels but may not mutate silhouette, plate ownership, or overlap order.

- [x] Add failing tests `testMaterialPassPreservesStructuralMasks` and `testPaletteRoleCoverage`; assert identical geometry masks/IDs before and after material assignment and all output role IDs map to defined palette entries.
- [x] Run focused validator and confirm failure for missing pass/contracts; observed missing `applyMaterialRoles` export.
- [x] Implement finite palette-role assignment, bounded quantized shading, mask-derived recessed interstitial tint, and cosmetic-seed/renderer-version highlights; no unrestricted per-pixel randomness.
- [x] Run focused validator and phenotype typecheck; expect pass.
- [x] Capture same accepted recipe with geometry, material, palette-role, and depth evidence.
- [ ] **Stop for Owner material review.** Do not implement multi-LOD proof until material is accepted.

## Task 4: CPU RGBA Raster and Semantic LOD (Checkpoint C)

**Files:** create `lod.ts`, `raster.ts`, `identity.ts`; extend art tests.

**Interfaces:** `selectArtLod(recipe, lod)` filters detail in order: micro-detail, tiny highlights, small cells/pearls, seams/rims, then large structural features. `rasterizeArt()` maps normalized recipe coordinates to review dimensions and returns exact RGBA plus masks. Population and inspection consume the same recipe; no output resizing of one finished bitmap as the LOD method.

- [ ] Add failing tests `testRasterBytesDeterministic`, `testRasterDimensionsAndBounds`, `testLodSharesRecipeTopology`, `testInspectionAddsDetailOverPopulation`, `testRasterHasNoBrowserOrPixiDependency`, `testRendererVersionSeparatesIdentity`, and `testIdentityUsesNoPositionOrCamera`.
- [ ] Run focused validator and confirm failures before raster implementation.
- [ ] Implement pure CPU rasterization with stable integer coverage/order and deterministic byte output; no DOM, Canvas, Pixi, GPU, timers, or global randomness.
- [ ] Implement population/inspection budgets that preserve silhouette, plate topology, overlap, and large openings while inspection retains finer approved roles/details.
- [ ] Implement raster identity from renderer version, dimensions, and a deterministic payload hash, with exact byte comparison as the collision guard; do not change production cache code.
- [ ] Verify repeat render is byte-identical, minimum review size is safe, mask dimensions match RGBA dimensions, and population/inspection share the same structural recipe input.
- [ ] Run `pnpm test:phenotype-art`, `pnpm test:phenotype`, `pnpm typecheck`, and `pnpm validation:check`; expect pass.
- [ ] Produce Checkpoint C continuity sheet with population/inspection procedural renders and the unchanged accepted ecosystem Plated grid beside them.
- [ ] **Stop for Owner LOD continuity review.** The optional trait sweep is not included absent further approval.

## Task 5: Standalone Proof and Evidence Manifest

**Files:** complete `tools/phenotype-art-proof/{fixture.ts,page.ts,index.html,vite.config.mjs,capture.ts}` created initially for Checkpoint A; extend the deterministic validator for manifest construction.

**Interfaces:** proof consumes only `@digital-evolution/phenotype/art` and one fixture. Manifest records git SHA, renderer version, serialized resolved phenotype inputs/quantized fields, cosmetic seed, LOD, output dimensions, and SHA-256 of exact RGBA bytes. Reference input is an optional external calibration-only file, never bundled into package or runtime.

- [ ] Add failing tests `testManifestRecordsExactInputsAndRasterHash`, `testReferenceIsLabeledCalibrationOnly`, and `testProofImportsNoProductionExplorerOrSimulationModules`.
- [ ] Implement a standalone page that builds one recipe per fixture, then displays its population and inspection branches, silhouette, depth/ownership overlay, material-role view, native raster, 3×/4× nearest-neighbor review raster, and stage-labeled reference slot.
- [ ] Implement capture using existing Playwright to save review PNGs and manifest to `/tmp/opencode/phenotype-art-proof-<sha>/`; do not commit generated artifacts.
- [ ] Verify no new package/runtime dependency and no import from Explorer, Pixi, sim-core, sim-runtime, or analysis.
- [ ] Run `pnpm test:phenotype-art` and proof capture; inspect manifest and image dimensions.

## Task 6: Register Validation and Close the Proof Checkpoint

**Files:** modify root `package.json` and `tools/validation/manifest.ts`; update only proof documentation if necessary.

- [ ] Add `test:phenotype-art` script and register a `procedural-art` presentation validation unit with its claim, domains, evidence class, and blocking route; include it exactly once in the presentation/CI presentation group.
- [ ] Run `pnpm validation:check`, `pnpm test:phenotype-art`, `pnpm test:plated`, `pnpm test:art-review`, `pnpm typecheck`, and `pnpm build`; expect pass. Do not weaken existing historical proof gates.
- [ ] Run the manifest-routed validation on the actual diff; use remote CI for sustained visual evidence/capture per repository owner-device rule.
- [ ] Package Checkpoint-specific artifacts and manifest; report geometry/material/LOD as separate Owner acceptance decisions.
- [ ] Commit decomposition: (A) package contracts + Plated recipe + neutral geometry validation; (B) material roles + material validation after A acceptance; (C) CPU raster + semantic LOD after B acceptance; (D) isolated proof tooling + manifest validation; (E) validation routing. Keep generated evidence and unrelated workspace document edits out of commits.

## Feasibility Notes / Stop Conditions

- Existing `tools/plated-proof/geometry.ts` and `render.ts` are isolated prior prototypes, but geometry uses a fixed `GEOMETRY_SEED` and does not produce a shared phenotype-derived structural recipe. Reusing that pipeline unchanged would conflict with the accepted semantic-input/trait-deformation/IR requirements; preserve it and implement the package path separately unless code inspection identifies a safe, contract-preserving extraction.
- Existing `packages/phenotype` has no runtime dependencies and includes only `constants.ts`, `model.ts`, and the coarse `renderer.ts`; the proposed pure TypeScript CPU path is feasible without dependency or production integration.
- The required accepted Plated reference/crop is not present in this checkout. The Drive connector currently requires login, so side-by-side reference evidence cannot be completed until the Owner supplies an accessible file/path or Drive access. Candidate generation and all deterministic testing can proceed, but pause reference comparison/visual acceptance rather than substitute another image.
- The detailed handoff requires “same recipe” at all LODs and also bounded trait deformation. Resolve this at implementation by generating one full recipe per resolved phenotype, then making LOD a deterministic view/filter of that recipe; do not recompute geometry per LOD.
- No other design conflict found from repository inspection. If applying a trait channel would require new biological interpretation, or if the current Plated source values cannot support a required deformation without changing phenotype semantics, stop and return to Owner.
