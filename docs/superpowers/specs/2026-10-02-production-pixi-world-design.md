# Production PixiJS World Migration — Stage P1

**Status:** Design sections approved; awaiting written-spec review. No product implementation is authorized by this document until the Owner approves the written spec and selects an implementation plan/execution method.

**Issue:** [#102 — Lane 2: Production PixiJS World migration (M4B Stage P1)](https://github.com/brady573/Digital-Evolution-Ecosystem/issues/102)

**Baseline:** `main @ 21540c0a78831cc9e7bdba7268a0c6522ca73fed` (engine 0.24.0)

**Design approvals:** Section 1 approved in chat by selecting the recommended path; issue comments `5964476502` (Section 2), `5964516838` (Section 3), `5964543378` (Section 4), and `5964569693` (Section 5), plus the self-contained activation handoff `5962253311`.

## 1. Intent and success

Replace the maintained Canvas2D World in `apps/explorer/src/App.tsx` with a PixiJS v8 World rendered through WebGL2, preserving accepted world meaning, interactions, Pixel Phenotype semantics, analytical views, phone/desktop hierarchy, Aftermath and decision behavior, offline operation, and deterministic simulation.

React remains the application shell and product-state authority. Pixi owns only the World display tree and GPU presentation resources. The renderer consumes the existing bounded presentation/read-model data; it does not read mutable runtime/simulation state or acquire analysis, biology, decision, or persistence authority.

At accepted cutover, there is one maintained semantic production World renderer: Pixi. The minimap may remain Canvas2D as a subordinate overlay. A non-production debug/comparison renderer is acceptable only if clearly isolated. There is no silent production Canvas2D fallback.

Success requires semantic parity and verified resource/platform behavior, not merely a build that compiles or a renderer that boots. The full Stage P1 Android runtime criterion requires actual Pixi/WebGL2 runtime evidence on the tested Android platform; APK packaging alone is not sufficient.

## 2. Current repository facts at the accepted baseline

- `apps/explorer/src/App.tsx` contains the maintained `WorldCanvas`, which currently performs Canvas2D environment, organism, lens, selection, camera, torus, and hit-test work.
- The production `WorldCanvas` receives `worldId`, live tick, environment frame, joined organism rows, lens/resource/trait selections, selected identity, and camera state from Explorer presentation state.
- `apps/explorer/src/phenotype.ts` is the Explorer-side resolver/cache adapter; `packages/phenotype` owns family resolution, absolute trait normalization, lineage hysteresis, deterministic phenotype geometry, and LOD grids.
- `apps/explorer/src/pixi/` contains accepted P0 pure preparation: layer roles/order, exact phenotype texture descriptors, a bounded/ref-count-shaped cache, asset classes, and a read-only adapter. Some P0 notes describe earlier gates; implementation must reconcile those notes against the current authorized Stage P1 handoff rather than treating obsolete gating text as controlling.
- `apps/explorer/src/pixiWorld/` contains inactive P1 boot/layer/camera/texture scaffolding. Reuse and extend it rather than restarting without evidence that a prepared component is invalid.
- `tools/pixi-spike/` and `tools/pixi-world-proof/` plus `test:pixi-p0`, `test:pixi-spike`, and `test:pixi-world` provide reusable evidence and harnesses.
- `pixi.js` is already present at v8.21.0 in the Explorer package and root development dependencies; do not add or upgrade dependencies without demonstrated need.
- `WorldMinimap` is a separate Canvas2D element and may remain so for this cutover.

## 3. Accepted product and scientific boundaries

Protected authority:

- `sim-core`: sole biological authority.
- `sim-analysis`: read-only interpretation of immutable simulation observations.
- `sim-runtime`: live session/worker authority.
- Bounded Explorer presentation/read models: renderer input boundary.
- React: source of truth for lens, zoom, selected entity, pending decisions, Aftermath, playback intent, navigation, controls, and sheets.
- Pixi: display objects, renderer lifecycle, and GPU presentation artifacts only.

Rendering cadence must not change simulation cadence. Rendering must not consume simulation RNG, mutate analysis or runtime state, alter persistence/checkpoint semantics, cap population, or infer biological/ecological facts. GPU/source/cache state is never checkpointed. No runtime network asset loading is allowed.

No sim-core biology changes, ecology changes, new phenotype families, new mappings for engine traits, Aftermath redesign, Investigation Thread, prediction, Follow/bookmark, checkpoint branching, M7 redesign, general React UI migration, WebGPU requirement, speculative custom shaders/instancing, unrelated foundation hardening, or biology retuning are in scope.

## 4. Approved architecture

### 4.1 React host and bounded input

Implement/complete a React-owned Pixi host in the existing `world-wrap`. It creates one maintained Pixi application and updates that instance for ordinary props; ordinary frame/prop changes must not recreate the application. Inputs are the minimum already-resolved presentation data needed for the World: environment and joined organism rows, world identity, lens/resource/trait view, selected ID, camera/zoom, and bounded callbacks for camera, selection, and visible-world reporting.

Do not add contracts or bind Pixi directly to `sim-core`, worker internals, mutable runtime state, or detailed History/Aftermath records without proving the existing read model cannot support an accepted World behavior. Pixi does not own an alternate decision/Aftermath state machine.

React remains authoritative for all product state. Pixi reports bounded interaction results only. Programmatic prop synchronization must not re-emit itself as user interaction or form a callback feedback loop. Renderer lifecycle must never advance, pause, resume, or reset simulation playback.

### 4.2 Scene graph and semantic layers

Use independently controllable layers in this order (later layers above earlier layers):

1. environment/substrate;
2. analytical field;
3. waste/non-color cue;
4. organisms;
5. selection/focus;
6. transient effects.

Concrete Pixi Containers, sprites, graphics, atlases, render textures, pooling, and tint strategy are implementation freedom if semantic separation, exact texture identity, deterministic output, the required filtering per asset/lens (nearest for morphology, exact/unfiltered for analytical fields, accepted smooth presentation for normal environment), and correct retirement remain intact.

### 4.3 Environment and lenses

- Normal World uses the current truthful environment frame and retains the accepted smooth/atmospheric presentation only where it does not imply unsupported terrain, biome, elevation, water, or other structure.
- Procedural environment output remains simulation-derived; do not replace it with decorative static tiles.
- Nutrients, Waste, Clades, and Traits maintain their existing exact semantic encodings. Do not interpolate, blur, or otherwise create false intermediate analytical values.
- Waste retains an independently legible non-color cue. Hue alone must not carry dormancy, selection, or analytical meaning.
- Environment GPU artifacts can be cached as derived presentation data. Environment updates and organism updates remain independently cacheable; camera motion does not rebuild the environment unless its input changed.
- Lens changes can switch layer visibility/materials/textures but do not mutate simulation or analysis.

### 4.4 Pixel Phenotype and assets

`packages/phenotype` remains authority for the six families—Blob, Segmented, Radial, Plated, Branching, Paddled—absolute trait normalization, family resolution, lineage anchoring/hysteresis, deterministic cosmetic identity, active/dormant geometry, and LOD geometry. `apps/explorer/src/phenotype.ts` remains the Explorer-side resolver/continuity adapter over current presentation rows. Pixi consumes resolved output only.

Do not manufacture family diversity, map new engine traits, encode ecological-analysis/guild classifications into morphology, or let analysis/lens changes change phenotype family or geometry.

In-world textures are generated from resolved phenotype grids/masks, nearest-filtered, with initial exact identity `bitmap + LOD tier + activity`. Lens/analysis color, tint/material, dormancy visibility treatment, and selection stay at the display layer wherever that preserves current semantics; morphology texture identity does not include lens color or selection. Dormancy remains independently legible without hue alone. Static bundled family portraits are inspection art only, never live morphology authority.

Reuse a persistent display object per live organism where practical. Movement-only changes update transforms/positions, not morphology textures. Phenotype/activity/LOD identity changes may acquire/remap a texture. World identity is the per-world display ownership boundary: create/restore/world replacement retires old-world objects and references, and IDs from separate worlds are not globally identical biological entities. Globally reusable exact texture artifacts may remain only if their exact identity is valid and the cache remains bounded.

Bounded cache acquire/release/prune, pooling, atlases, tint, and CPU source-canvas lifetime are implementation freedom. When retiring resources, correctly destroy/release Pixi Texture and owned GPU/source state; do not retain unused CPU backing unnecessarily. GPU/cache state is never serialized.

### 4.5 Camera, torus, input, minimap

Preserve the 600×600 toroidal world, uniform zoom range 1.0×–3.0×, normalized wrapped camera center, current fit/scale behavior, equivalent viewport reporting in world units, repeated seam coverage without blank edges, and nearest toroidal image semantics. Device-pixel-ratio/backing-store changes must not change logical camera math or CSS-pixel hit behavior.

Preserve pointer capture, existing drag/click threshold, wrapped normalized pan, CSS-pixel input math, and the current effective 26 CSS-pixel toroidal hit radius. Selection uses the accepted organism identity/read model; seam copies are presentation-only and cannot introduce duplicate biological identity, selection, or effects. Offscreen culling is allowed only as a presentation optimization and cannot alter population, identity, hit behavior for visible entities, or analytical totals.

The minimap may remain a subordinate Canvas2D overlay for the first cutover and must preserve its resource/organism overview and visible-window meaning.

### 4.6 Phone, Aftermath, decisions, and lifecycle

Keep the World inside the existing `world-wrap`, materially visible beneath phone overlays/sheets. React retains lens/zoom controls, HUD, navigation, inspector, and sheets. Preserve the one-large-sheet rule, pending mandatory-decision priority, Aftermath stages and settlement, existing automatic playback/resume behavior, and pointer/overlay stacking. Pixi does not independently read decision/Aftermath details or render their UI. Bounded effects may only consume already-resolved presentation state and may not claim unsupported evidence.

`worldId`/displayed-universe identity scopes per-world display ownership. Camera and selection reset/reconciliation follow existing React behavior, not renderer-invented restore rules. Departed selections reconcile to current behavior, typically clear/invalid selection rather than retain a ghost object.

Renderer boot/teardown requirements:

- initialize a maintained Pixi application without recreating it on ordinary props;
- async boot is cancellation/generation safe; an obsolete boot cannot attach after unmount/replacement, and old cleanup cannot destroy a newer generation;
- cleanup is idempotent and safe after partial initialization;
- StrictMode-style mount → cleanup → remount is leak-free;
- detach observers/listeners/ticker work and release display/cache references, obsolete textures/sources, render targets, and canvases;
- no frame/ticker/subscription work targets a detached host;
- resize and DPR changes preserve logical geometry and do not regenerate textures except on a real LOD-identity change;
- renderer mount/unmount never controls simulation playback;
- no silent production Canvas2D fallback. If WebGL2 cannot meet supported platform behavior, stop for Owner/design decision. Renderer failure is not a biological event and must not mutate or reset simulation. A new visible recovery/fallback flow requires design return.

Pixi may use its presentation ticker, normal WebGL context-loss handling, internal state mirrors, and visibility throttling where they do not change simulation semantics or truthful returned state.

## 5. Staged rollout

Follow the issue’s bounded sequence and make each stage reviewable:

1. **P1.1 — production host/dependency:** Pixi is already installed; establish React-owned production host and read-model props.
2. **P1.2 — environment + camera/torus:** migrate substrate, exact analytical fields, waste cue, camera, wrap/repetition, viewport reporting.
3. **P1.3 — organisms + phenotype:** resolved phenotype masks, persistent displays, LOD/activity identities, movement-only reuse.
4. **P1.4 — selection/hit testing/lenses:** parity for identity, focus, analytical encodings, and toroidal hit behavior.
5. **P1.5 — product integration:** phone overlays, pending-decision/Aftermath coexistence, minimap, visibility, accessibility/pointer layering.
6. **P1.6 — production cutover:** maintained World uses Pixi; remove/deactivate the Canvas2D semantic World renderer. No indefinite dual production renderers.
7. **P1.7 — evidence:** full validation, browser, dense-scene/resource lifecycle, visual and Android runtime evidence.

A development-only switch is acceptable during migration. It must not become a steady-state production dual renderer or a silent fallback. Do not land an intermediate production state that changes accepted World semantics.

## 6. Validation and evidence contract

Use current repository scripts/manifest and do not weaken gates. Focused evidence includes:

- canonical `pnpm verify`;
- production Explorer build;
- existing `test:phenotype` (including phenotype-world), `test:pixi-p0`, `test:pixi-spike`, and `test:pixi-world` where applicable;
- browser World smoke and visual captures at representative zoom and phone dimensions;
- camera/torus, 1.0×–3.0× zoom, 26 CSS-pixel selection/hit radius, seam cases, viewport/minimap reporting;
- exact Nutrients/Waste/Clades/Traits semantics and normal environment/waste cue;
- six-family/lineage/LOD/active-dormant phenotype rendering;
- pending decision and all Aftermath states with overlays, playback, and sheet priority;
- mount/teardown/remount, async boot races, world create/restore/replacement, selection reconciliation, and resource cleanup;
- dense scenes at 50, 250, 1,000, and 3,000 organisms, including movement-only frames, LOD changes, and churn;
- cache/display metrics: creations, reuses, releases/prunes, live textures, display counts, source/resource release, plus update/frame timings;
- Android packaging evidence and, separately, actual Android Pixi/WebGL2 runtime evidence.

Do not invent FPS/frame-time thresholds unless current repository policy defines them. Unbounded resource growth, movement-triggered morphology texture churn, semantic regressions, or a failure on a claimed supported runtime platform are failures even without a numeric threshold. Browser, repository verification, Android packaging, Android runtime, and human-review evidence are separate evidence classes; one green command cannot prove another claim. Full Stage P1 acceptance cannot claim the Android runtime criterion without actual runtime evidence. If runtime testing is unavailable, report **EVIDENCE GAP**, not pass.

Prefer CI/remote execution for long gates and browser/platform evidence; no long-running validation on the Owner device. Keep statuses distinct: **implemented**, **validated**, **design accepted**, and **evidence gap** are not synonyms.

## 7. Stop and escalate

Return to Owner/Design Partner before a meaning-changing choice if:

- the bounded read model lacks information required for existing World behavior;
- Android WebGL2/Pixi requires a product-visible or meaning-changing fallback;
- camera/torus parity requires a product-visible behavior change;
- bounded cache needs merging visually meaningful phenotype states;
- replacing assets materially changes the accepted six-family visual language;
- a visual effect implies unsupported biology/ecology;
- rendering appears to require simulation cadence/population changes;
- current engine state requires new presentation semantics not already accepted.

If repository facts conflict with this contract, preserve design meaning and return **DESIGN TENSION** or **OWNER DECISION**, rather than redefining the design to match current code.

## 8. Required return package

On the implementation PR/issue return:

- PR URL; baseline main commit; exact final head;
- changed module/file map;
- Pixi version and active WebGL2 backend evidence;
- read-model consumption map and production World ownership before/after;
- Canvas2D production-path disposition;
- environment/layer design; phenotype texture generation and cache/display lifecycle;
- texture create/reuse/release/prune and display/resource metrics;
- semantic parity for camera/torus, hit testing/selection, all analytical lenses, Pixel Phenotype/dormancy, and Aftermath/decisions;
- representative browser captures and phone layout evidence;
- 50/250/1,000/3,000 organism evidence;
- Android packaging and distinct Android runtime/WebGL2 evidence (or explicit **EVIDENCE GAP**);
- `pnpm verify` and focused/browser/platform CI evidence;
- residual issues and deviations classified as implementation freedom, design-significant drift, evidence gap, or Owner decision.

## 9. Open design decisions

None within the approved handoff and clarifications. Renderer details expressly left to implementation freedom remain open to the Coding Agent as long as they preserve the contracts above. Any newly encountered meaning-changing issue returns to the Owner before implementation crosses that boundary.
