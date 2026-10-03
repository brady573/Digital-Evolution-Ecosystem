# Production PixiJS World Migration — Stage P1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the maintained Canvas2D semantic World with a PixiJS 8.21.0 / WebGL2 renderer without changing its accepted read-model meaning, interactions, phenotype semantics, or product hierarchy.

**Architecture:** Build the existing inactive `pixiWorld/` scaffold into a React-owned renderer with separated environment, analytical, organism, focus, and effects layers. React and the bounded Explorer presentation store remain authoritative; Pixi reconciles read-only inputs into persistent display objects and bounded GPU resources. Exercise the production modules in isolated browser evidence while developing, then perform one final App cutover and retire the Canvas2D semantic World path.

**Tech Stack:** TypeScript, React 19.3, PixiJS 8.21.0, existing `@digital-evolution/contracts` and `@digital-evolution/phenotype`, Playwright/Chromium browser evidence, canonical repository validation manifest.

**Spec:** `docs/superpowers/specs/2026-10-02-production-pixi-world-design.md` (reviewed/approved on issue #102; analytical exactness means no false semantic interpolation, not one mandated GPU sampling primitive).

## Global Constraints

- Baseline is `main @ 21540c0a78831cc9e7bdba7268a0c6522ca73fed`, engine 0.24.0.
- The maintained renderer must use PixiJS v8 / WebGL2; existing PixiJS 8.21.0 dependency is sufficient; do not upgrade or add dependencies without demonstrated need.
- Preserve the logical 600×600 toroidal world, uniform zoom 1.0×–3.0×, and 26 CSS-pixel effective toroidal hit radius.
- React is source of truth for lens, zoom, selection, pending decisions, Aftermath, playback intent, sheets, and navigation; Pixi consumes only bounded presentation/read-model data and reports bounded interaction results.
- `packages/phenotype` / `apps/explorer/src/phenotype.ts` retain all phenotype family, normalization, lineage/hysteresis, deterministic geometry, dormancy, and LOD authority; preserve exactly six accepted families.
- Texture identity begins as exact bitmap + LOD tier + activity. Lens/analysis tint and selection remain outside morphology identity. Movement alone must cause zero morphology texture creations/rebuilds.
- Analytical lenses must not communicate invented/interpolated measurements; implementation may use any Pixi/WebGL sampling primitive that preserves exact observable cell semantics.
- No silent Canvas2D production fallback; minimap may remain subordinate Canvas2D. No biology, simulation RNG, population/cadence, checkpoint, analysis, or Aftermath semantic changes.
- Teardown is idempotent, worldId-scoped, race-safe, StrictMode-remount-safe, and cannot own simulation playback. No GPU/cache state enters checkpoints.
- No invented FPS/frame-time threshold unless current repository policy defines one. Unbounded resource growth, movement-triggered morphology churn, semantic regression, or failure on a claimed supported platform are failures without a numeric threshold.
- Repository verification, browser, Android packaging, Android runtime, and human-review evidence are distinct. Full Stage P1 cannot claim Android runtime acceptance without actual Android Pixi/WebGL2 runtime evidence.
- Long-running verification/browser/platform work is routed through CI/remote execution, not the Owner device. The existing Android emulator install/launch unit is paused; do not silently unpause it or equate APK packaging with runtime proof.
- Do not commit, push, or open a PR unless separately authorized by the Owner; no production implementation begins until this plan and its execution method are approved.

## Review Focus

1. **Mixed channel cadence / world replacement:** a newer identity with older environment or live rows must not render a cross-world hybrid or retain departed objects. Pin channel-tick identity in Task 2 and world replacement in Task 5.
2. **Async boot, unmount, and repeated cleanup:** late init must not attach to a detached host or destroy a newer renderer; pin in Task 1 with stale-generation, partial-boot, and double-destroy probes, then prove StrictMode-style remount in Task 5.
3. **Torus seam, DPR, and pointer coordinates:** CSS/backing-store mismatch or repeated copies must not change camera or select duplicate identity. Pin in Task 2 and Task 4 with seam, resized/DPR, 1.0×/3.0×, and constant 26 CSS-pixel tests.
4. **Movement, lens color, dormancy, and LOD texture churn:** presentation-only changes must not rebuild morphology unless exact bitmap/tier/activity changes. Pin in Task 3 and Task 4 using creation/reuse/prune counters.
5. **Phone hierarchy and dense-scene lifecycle:** 3,000 organisms must not hide React overlays or grow retained renderer resources after churn/world switch. Pin in Task 5 and Task 7 with phone browser journeys and 50/250/1,000/3,000 production-renderer evidence.

## File and Module Map

| Path | Responsibility in this plan |
|---|---|
| `apps/explorer/src/App.tsx` | Keep React product state and read-model composition; resolve phenotype output outside Pixi; integrate Pixi host at the final cutover and remove `WorldCanvas` semantic rendering. High-conflict integration file: avoid unrelated UI edits. |
| `apps/explorer/src/worldViewTypes.ts` (new) | Shared `Lens`, `ResourceView`, `TraitView`, `WorldCamera`, and `PixiWorldProps` types without an App↔renderer import cycle. |
| `apps/explorer/src/pixi/adapter.ts` | Replace the obsolete `RenderSnapshot`-based texture request input with joined `RenderOrganism[]` plus already-resolved phenotype output; keep it pure/read-only. |
| `apps/explorer/src/pixi/phenotypeTextures.ts`, `textureCache.ts` | Preserve exact deterministic mask identity and CPU cache accounting; add/reuse lifecycle counters only where production GPU reconciliation needs them. |
| `apps/explorer/src/pixiWorld/boot.ts`, `layers.ts`, `camera.ts`, `textures.ts` | Extend existing WebGL2 boot, semantic Containers, toroidal projection, and nearest-filtered texture mint/retirement. Add the React host and renderer/layer modules here rather than restarting the subsystem. |
| `apps/explorer/src/pixiWorld/WorldPixi.tsx` (new) | React-owned host lifecycle and bounded input/callback bridge; no product state machine or runtime access. |
| `apps/explorer/src/pixiWorld/renderer.ts`, `environment.ts`, `organisms.ts`, `interaction.ts` (new) | Renderer reconciliation, field layers, persistent organism displays, and pointer/camera interaction; each consumes explicit typed inputs and remains presentation-only. |
| `apps/explorer/src/organismEncoding.ts`, `landscape.ts`, `phenotype.ts`, `presentationStore.ts` | Existing read-only semantic encoders, environment calculations, phenotype continuity, and read-model composition; reuse rather than duplicate. |
| `apps/explorer/src/styles.css` | Preserve world canvas sizing, touch-action, overlay stacking, and phone geometry for the Pixi canvas. |
| `tools/validation/pixi-p0.ts` | Extend pure contracts for the real production renderer adapters, cache identity, movement isolation, and camera parity. |
| `tools/pixi-world-proof/*` | Extend the browser harness to boot and exercise actual production Pixi modules, lifecycle races, resize/DPR, and resource retirement. |
| `tools/validation/browser-smoke.ts` | Validate integrated Explorer interactions, lenses, toroidal selection, decisions/Aftermath, and phone overlays once Pixi is the maintained surface. |
| `tools/validation/manifest.ts`, `package.json` | Prefer existing routed units. Add one non-blocking evidence unit only if required for production dense-scene metrics; if added, route it through the manifest and verify routing with `pnpm validation:check`. |
| `.github/workflows/android.yml` | No runtime job change planned: emulator install/launch is paused for reliability. Use existing APK packaging evidence separately and record actual runtime evidence or EVIDENCE GAP. |

### Interfaces agreed for implementation

`worldViewTypes.ts` exports `PixiWorldProps` containing:

- `worldId: WorldId`;
- `tick: number` from the live channel, `environment: WorldEnvironmentFrame` (retaining its own effective tick), and `organisms: readonly RenderOrganism[]`;
- `resolvedPhenotypes: ReadonlyMap<number, ResolvedPhenotype>` produced by the existing Explorer phenotype adapter;
- `lens`, `resourceView`, `traitView`, `selectedId`, `camera`, and `zoom`;
- callbacks `onSelect(id: OrganismId | null)`, `onCamera(camera: WorldCamera)`, and `onView(view: { w: number; h: number })`.

`WorldPixi(props: PixiWorldProps): ReactElement` (with `ReactElement` imported as a React type) owns a single host lifecycle. A `WorldRenderer` returned by `createWorldRenderer(handle: PixiWorldHandle)` exposes `update(props: PixiWorldProps): void` and idempotent `destroy(): void`. It reconciles the semantic layers and caches; it never advances simulation or owns React product state. The live tick drives accepted normal-world smoothing and waste-cue presentation; the environment frame retains its own channel tick for raw analytical cache identity. Never present one channel as if it were another channel's newer state. Exact internal representations remain implementation freedom.

`WorldPoint` is `{ readonly x: number; readonly y: number }`; reuse the existing `ViewRect` from `pixiWorld/camera.ts`.

---

### Task 1: Production Host Boot and Lifecycle Safety (P1.1)

**Files:**
- Modify: `apps/explorer/src/pixiWorld/boot.ts`
- Create: `apps/explorer/src/pixiWorld/WorldPixi.tsx`
- Create: `apps/explorer/src/worldViewTypes.ts`
- Test: `tools/pixi-world-proof/capture.ts` and proof page files

**Interfaces:**
- `bootPixiWorld(host: HTMLElement, isCurrent?: () => boolean): Promise<PixiWorldHandle | null>` checks the generation after async initialization and before host attachment; stale generations destroy only their own partially initialized application and return `null`.
- `PixiWorldHandle.destroy(): void` is idempotent and removes its canvas, observer, ticker/listeners, and renderer resources safely after partial init.
- `WorldPixi(props: PixiWorldProps): JSX.Element` keeps a stable app instance across prop updates and mirrors current props for the renderer after boot.

- [x] **Step 1: Add failing lifecycle probe** `obsoleteBootProbe` in `tools/pixi-world-proof/probe.ts` and assertion in `capture.ts`.
- [x] **Step 2: Run the focused browser proof**; observed expected RED because obsolete boot returned a live handle.
- [x] **Step 3: Implement generation-safe `bootPixiWorld` and React host**. Stale initialization cleans its own app before attach; destruction is idempotent and catches partial-init failures. React cleanup invalidates pending init before destroying its own resolved handle.
- [x] **Step 4: Re-run `pnpm test:pixi-world`**; WebGL2 backend, CSS resize/backing-resolution relationship, texture retirement, obsolete boot, and double destroy passed. React host got typechecked; integrated browser lifecycle coverage remains in Task 5 because isolated proof module routing was not reliable.
- [ ] **Step 5: Add React host/browser lifecycle coverage via integrated Explorer browser smoke, then review the exact diff.** Commit only if separately authorized; otherwise leave the worktree uncommitted.

### Task 2: Environment Layers and Camera/Torus Parity (P1.2)

**Files:**
- Modify: `apps/explorer/src/pixiWorld/camera.ts`, `layers.ts`
- Create: `apps/explorer/src/pixiWorld/renderer.ts`, `environment.ts`
- Reuse: `apps/explorer/src/landscape.ts`, `apps/explorer/src/pixi/layers.ts`
- Test: `tools/validation/pixi-p0.ts`, `tools/pixi-world-proof/capture.ts`

**Interfaces:**
- `WorldRenderer.update(props: PixiWorldProps): void` updates camera and world input while preserving renderer ownership.
- `updateEnvironmentLayer(layer: Container, input: EnvironmentInput): EnvironmentMetrics` updates/reuses normal environment and analytical field display resources independently from camera transforms.
- `EnvironmentInput` contains `worldId`, the live `tick`, the environment frame (with its own effective channel tick), active `lens`, and selected nutrient resource. It does not contain analysis classifications or detail snapshots.

- [x] **Step 1: Add camera/DPR parity assertion** in `tools/validation/pixi-p0.ts` at zoom limits.
- [x] **Step 2: Run `pnpm test:pixi-p0`**; camera projection and visible-window results remained invariant across simulated backing DPR 1/2/3.
- [x] **Step 3: Implement environment and camera layers** by reusing `landscape.ts` color/fraction/tile helpers and the P0 layer order. The camera root transforms world-space torus copies; CSS viewport and camera updates reconcile tile positions without texture churn. Mismatched displayed-world/environment channels are hidden rather than composited.
- [ ] **Step 4: Run `pnpm test:pixi-p0` locally and `pnpm test:pixi-world` on GitHub CI**; browser proof asserts panning across both torus seams, camera/resize-only texture reuse, and resized host viewport reporting.
- [ ] **Step 5: Review the layer update metrics** and commit only if separately authorized.

### Task 3: Persistent Organisms, Pixel Phenotype Textures, and Cache Lifecycle (P1.3)

**Files:**
- Modify: `apps/explorer/src/pixi/adapter.ts`, `phenotypeTextures.ts`, `textureCache.ts`, `apps/explorer/src/pixiWorld/textures.ts`, `renderer.ts`
- Create: `apps/explorer/src/pixiWorld/organisms.ts`
- Reuse: `apps/explorer/src/phenotype.ts`, `packages/phenotype/src/renderer.ts`
- Test: `tools/validation/pixi-p0.ts`, `tools/pixi-world-proof/capture.ts`

**Interfaces:**
- `toTextureRequests(organisms: readonly RenderOrganism[], resolved: ReadonlyMap<number, ResolvedPhenotype>, tier: LodTier): OrganismTextureRequest[]`; no `RenderSnapshot` input.
- `updateOrganismLayer(layer: Container, input: OrganismInput): OrganismMetrics` reconciles organism ID→display object, updates transforms, and acquires/releases exact mask textures when bitmap/tier/activity identity changes.
- `OrganismMetrics` reports live display count, texture creates/reuses/releases/prunes, and texture/source counts for evidence; it is not a gameplay signal.

- [x] **Step 1: Add failing tests** for movement display reuse/zero texture churn, lens + selection morphology neutrality, activity/LOD remapping, and world replacement resource cleanup. Use an injected headless resource factory only for Node contract tests.
- [x] **Step 2: Run `pnpm test:pixi-p0`**; initial production reconciler test failed because the real path requires browser `document` canvas. Add narrow resource factory seam and assert the production reconciliation logic with Pixi-shaped test textures.
- [x] **Step 3: Implement organism reconciliation** retaining Explorer phenotype authority and exact semantic bitmap + tier + activity keys; nearest-filtered production masks, persistent sprites, lens tint/dormancy as display treatment, and zero-user/world-replacement cleanup. No family mapping or portrait changes.
- [ ] **Step 4: Run `pnpm test:pixi-p0` and `pnpm test:phenotype` locally; run `pnpm test:pixi-world` on GitHub CI**. Browser proof is limited to organism display/cache claims: movement no new morphology textures/displays, tier/activity remapping, and old-world resource pruning.
- [ ] **Step 5: Review metrics for movement, LOD, activity, and churn** and commit only if separately authorized.

### Task 4: Analytical Lenses, Selection, and Toroidal Interaction (P1.4)

**Files:**
- Modify: `apps/explorer/src/pixiWorld/camera.ts`, `renderer.ts`
- Create: `apps/explorer/src/pixiWorld/interaction.ts`
- Reuse: `apps/explorer/src/organismEncoding.ts`, `landscape.ts`
- Test: `tools/validation/pixi-p0.ts`, `tools/validation/browser-smoke.ts`

**Interfaces:**
- `screenToWorld(clientX: number, clientY: number, rect: ViewRect, camera: WorldCamera, scale: number): WorldPoint` uses CSS pixels and wraps coordinates.
- `hitTestOrganism(point: WorldPoint, organisms: readonly RenderOrganism[], radiusWorld: number): OrganismId | null` uses shortest toroidal distance; caller computes radius as `26 / scale`.
- Analytical presentation uses existing `organismColor`, `dormantChannel`, `nutrientOverlayCell`, and `wasteOverlayCell` semantics; filter choice remains implementation freedom if values are not falsely interpolated.

- [x] **Step 1: Add toroidal hit tests** in `tools/validation/pixi-p0.ts` across both seams and confirm outside-radius misses.
- [ ] **Step 2: Run `pnpm test:pixi-p0`** and confirm the new hit tests fail before/after implementation as appropriate; add constant-CSS-radius tests at zoom limits. Analytical browser assertions run with Task 5 integration.
- [ ] **Step 3: Implement Pixi pointer routing and lens layers**. Pointer capture, the current drag/click threshold, normalized pan, closest toroidal selection, and screen-space focus remain aligned with Canvas2D; seam copies never create selectable duplicate IDs. Deduplicate camera/view callbacks so React prop synchronization cannot form a feedback loop or masquerade as user input.
- [ ] **Step 4: Run `pnpm test:pixi-p0` and browser World checks**; verify exact data-to-encoding output and screenshot evidence for Nutrients, Waste, Clades, Traits, and normal World.
- [ ] **Step 5: Review lens changes for morphology-cache neutrality** and commit only if separately authorized.

### Task 5: React Integration and Phone/Aftermath Coexistence (P1.5)

**Files:**
- Modify: `apps/explorer/src/App.tsx`, `styles.css`
- Modify: `apps/explorer/src/pixiWorld/WorldPixi.tsx` only for host integration defects
- Test: `tools/validation/browser-smoke.ts`, `tools/validation/mobile-ui.ts`

**Interfaces:**
- App constructs `resolvedPhenotypes` via existing `phenotypeCache.resolveSnapshot({ worldId, organisms })` and supplies the complete `PixiWorldProps`; it does not subscribe to runtime directly from Pixi.
- A temporary development/test-only Pixi route may be gated by `deeTest` while exercising the Pixi host before production cutover. It is not a user-facing setting or permanent production renderer switch.

- [ ] **Step 1: Add browser assertions** `testPixiHostAccessibleAndWorldSized`, `testReactControlsOverlayPixiCanvas`, `testPhoneWorldDominanceWithReactSheets`, `testRendererRemountDoesNotChangePlayback`, `testStrictModeMountCleanupRemountLeavesSingleCanvasAndNoLeakedObserver`, and `testWorldIdentityChangeDoesNotRetainOldOrganismDisplays`. Use integrated browser smoke; the isolated proof Vite server does not serve a separately imported React source entry.
- [ ] **Step 2: Run focused browser/mobile checks** and confirm the tests expose integration requirements without changing the current production Canvas2D path yet.
- [ ] **Step 3: Integrate the host behind test-only activation** while keeping all controls, selected card, navigation, pending decision, Aftermath sheets, and playback intent in React. Ensure pending mandatory decisions still outrank passive presentation and the World remains visible beneath overlays.
- [ ] **Step 4: Run `pnpm test:browser` and `pnpm test:mobile-ui` in CI/browser environment**; prove create/restore/world identity updates and the Section 4 async lifecycle properties.
- [ ] **Step 5: Review App integration diff for unrelated UI churn** and commit only if separately authorized.

### Task 6: Single Production Cutover and Canvas2D World Retirement (P1.6)

**Files:**
- Modify: `apps/explorer/src/App.tsx`, `styles.css`
- Modify: `tools/validation/browser-smoke.ts`, `tools/validation/pixi-p0.ts`
- Keep: `WorldMinimap` Canvas2D overlay and non-production Pixi spike/proof harnesses

**Interfaces:**
- The World surface mounts `WorldPixi` as the sole maintained semantic renderer; the Pixi canvas retains the equivalent accessible World label and touch behavior.
- `WorldMinimap` remains independently rendered and retains the same read-model/camera/view props.

- [ ] **Step 1: Add failing production-path assertions** `testDefaultWorldUsesPixiWebgl2`, `testWorldSurfaceHasNoCanvas2dRendererButMinimapRemains`, and `testPixiCutoverPreservesCameraSelectionAndOverlayContracts`.
- [ ] **Step 2: Run browser smoke on the test-only Pixi route** to establish Pixi journey behavior before switching the default.
- [ ] **Step 3: Switch the default World to Pixi and remove/deactivate the maintained Canvas2D World drawing/input path**. Keep Canvas2D only for the approved minimap or clearly non-production proof/debug use; do not add a silent fallback.
- [ ] **Step 4: Run the integrated browser smoke journey** including create, restore, phone size, zoom, pan, seam selection, decision→impact→observation→settlement, history/experiments overlays, and renderer cleanup.
- [ ] **Step 5: Review the production-path diff and ensure there is no second maintained semantic World renderer**; commit only if separately authorized.

### Task 7: Full Validation, Dense-Scene Evidence, and Platform Disposition (P1.7)

**Files:**
- Modify as needed: `tools/pixi-world-proof/capture.ts` and proof page
- Potentially create: `tools/pixi-world-proof/production-capture.ts`
- Potentially modify: `package.json`, `tools/validation/manifest.ts`, `tools/validation/validation-arch.ts` only if a new evidence unit is required
- Evidence: exact-head GitHub Actions artifacts and separately sourced Android runtime report

**Interfaces:**
- Production renderer evidence records exact Pixi version/backend, current scenario inputs, renderer metrics, cleanup counts, and capture metadata; no metric is represented as simulation or analysis state.
- If a new performance artifact unit is needed, register one non-blocking Class G evidence unit, route it through the canonical manifest/evidence group, and validate routing. Prefer reusing existing units where claims remain honest.

- [ ] **Step 1: Add production dense-scene evidence cases** for 50, 250, 1,000, and 3,000 organisms, movement-only updates, LOD/activity changes, world replacement, and churn; capture counts for objects, texture creations/reuses/releases/prunes/live resources, update/frame timing, and backend.
- [ ] **Step 2: Run the evidence harness in CI** and confirm exact WebGL2 evidence, zero movement-only texture creation, bounded resources after churn/world replacement, and no semantic regression. Do not invent FPS thresholds.
- [ ] **Step 3: Run `pnpm validation:check`, focused phenotype/Pixi tests, Explorer build, browser/mobile suites, and canonical `pnpm verify` through routed exact-head CI.** Read the manifest/shard routing for the actual diff; a handoff check list is a floor, not a substitute.
- [ ] **Step 4: Collect Android packaging evidence separately.** Check the existing manifest/workflow: `android-install-launch` is paused and `android-runtime` group is empty. Do not claim runtime proof from packaging. If actual Android WebGL2 runtime evidence is unavailable, report **EVIDENCE GAP**, and leave full Stage P1 acceptance explicitly incomplete until a real runtime test is supplied.
- [ ] **Step 5: Assemble the issue/PR return package** with the metrics, captures, exact SHA/CI URLs, known gaps, and deviations classified as implementation freedom, design-significant drift, evidence gap, or Owner decision. Commit/push/open PR only when explicitly authorized.

## Intended Commit / PR Decomposition

One implementation PR against the accepted main baseline, with focused commits aligned to Tasks 1–6 (host lifecycle; environment/camera; organism/cache; interaction/lenses; React integration; production cutover). Task 7 is evidence/test routing only if needed and should not be mixed with product semantics. Keep intermediate renderer wiring test-only until the final cutover; do not merge or ship a partial production dual renderer. Git commits, push, and PR creation remain Owner-authorized operations.

## Plan Self-Review

- **Spec coverage:** host and read-model authority (Task 1); environment/camera (Task 2); phenotype and resources (Task 3); selection/lenses (Task 4); React/phone/Aftermath (Task 5); single-renderer cutover (Task 6); dense/browser/repository/Android evidence (Task 7); stop conditions and status taxonomy are preserved in Global Constraints and Task 7.
- **Step clarity:** every task specifies paths, input/output interfaces, red test, narrow expected failing behavior, minimal implementation scope, verification command, and explicit authorization boundary for commits.
- **Type consistency:** `PixiWorldProps` uses the contracts’ `WorldId`, `WorldEnvironmentFrame`, `RenderOrganism`, and `OrganismId`, phenotype package `ResolvedPhenotype`, shared `WorldCamera`, and React-owned callbacks; all downstream tasks use that same boundary.
- **Review focus coverage:** each of the five high-risk input/failure classes has a pinned task-level regression as listed above.
- **Evidence classes:** repository, browser, Android packaging, Android runtime, and human review remain separate; Android runtime is currently a known external evidence dependency because the CI install/launch unit is paused.
