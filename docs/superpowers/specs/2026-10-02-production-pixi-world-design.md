# Production PixiJS World Migration — Stage P1

**Status:** Core Stage P1 and detailed P1.5 design approved. P1.5 implementation is authorized only within the Task 0 reconciliation condition and Tasks 1–4; production cutover remains separately gated.

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

## 10. P1.5 React/Pixi integration design

**Status:** P1.5 detailed design approved. Implementation remains limited to the separately approved plan and successful Task 0 reconciliation; this section does not authorize production cutover.

**P1.4 evidence boundary:** P1.4 is implemented and focused-browser validated on exact head `6252b4598bf0a4e4bd7bd5b15aadd232c526a612`, run [37139103105](https://github.com/brady573/Digital-Evolution-Ecosystem/actions/runs/37139103105). Its synthetic renderer evidence does not establish React-shell integration. P1.5 must add that evidence separately. Owner accepted this P1.5 design direction in issue comment `5972048516` and recorded it in the M4B handoff.

### 10.1 Goal and non-goals

Exercise the existing Pixi host inside the real Explorer React shell behind the existing `?deeTest` test/development gate. The integrated journey should expose actual `world-wrap` geometry, phone visibility, DOM/Pixi stacking, minimap coexistence, decision/Aftermath priority, and React state/playback ownership before any production cutover is considered.

This is one renderer at a time: for a `?deeTest` session, React mounts `WorldPixi` instead of `WorldCanvas`; without the gate, React continues to mount `WorldCanvas`. Never render both semantic World renderers simultaneously. `WorldMinimap` remains its existing subordinate Canvas2D overlay. The gate is test-only, not user-facing configuration, a permanent renderer selector, or a production fallback.

P1.5 does not switch the production default, retire Canvas2D, claim P1.6 readiness, or establish Android runtime behavior. It does not add a second shell, change simulation/runtime/analysis authority, redesign overlays, or change product behavior to accommodate the test renderer. If integration reveals a required meaning-changing behavior or a host limitation that forces such a change, stop and return to the Owner.

### 10.2 Component and state ownership

- `App.tsx` remains the only owner of product state: world/read-model selection, playback intent, lens/resource/trait choices, camera/zoom, selected organism, navigation, pending decision, Aftermath projection/stages, and React controls/sheets.
- Both renderer branches receive equivalent current, already-resolved props from that same React render. Pixi receives no runtime subscription, worker handle, mutable simulation state, or decision/Aftermath record. The existing phenotype resolver/cache boundary supplies resolved phenotype data where required; renderer choice must not create a second state/cache authority.
- `WorldPixi` owns only its host/application/renderer resources and forwards bounded user-originated camera, selection, and visible-world results through existing callbacks. Programmatic prop synchronization must not echo as a user callback. Mount, unmount, resize, remount, and renderer failure must not start, pause, resume, reset, or otherwise alter playback.
- Renderer changes under `?deeTest` may remount presentation resources but must preserve the React-owned state and read-model identity. World identity changes must replace old-world displays according to the existing renderer contract; no ghost selection or cross-world display retention.

### 10.3 Shell geometry, overlays, and interaction priority

- Mount the selected renderer inside the existing `.world-wrap` alongside the existing decorative scene and existing React overlays. Keep the actual Explorer shell, responsive layout, navigation, controls, selected-organism presentation, and accessibility labels under test; do not approximate them in a separate page.
- Preserve the current single large sheet slot and priority rules: pending mandatory decisions outrank passive inspection and Aftermath; Aftermath state remains retained beneath a decision and resumes its existing presentation after resolution. Stage 2 observation/settlement behavior and automatic playback semantics remain React-owned and unchanged.
- The World stays materially visible as context beneath phone controls and sheets. Preserve the established phone World dominance/visibility rules and existing compact Aftermath placement. DOM controls/sheets remain operable above the Pixi canvas; pointer input reaches the World only where the current interaction design allows it. Minimap and zoom controls coexist at their current overlay positions and priority (including their existing suppression under a pending decision).
- Establish explicit, tested stacking and pointer-event behavior for the Pixi canvas, decorative scene, minimap, controls, compact Aftermath panel, and sheet slot. Pixi must not intercept taps intended for React overlays; overlays must not accidentally make otherwise interactive World regions inert. Preserve touch-action and pointer-capture behavior required for pan/select.
- Keep current logical camera, selection, and minimap viewport meanings. Resize or device-pixel-ratio changes may alter backing resolution only; they must not alter CSS-pixel hit behavior, camera math, or React state. Do not add `boot.ts` to scope preemptively: include it only if focused integrated evidence demonstrates that the current boot/resize lifecycle cannot satisfy these requirements, and report the evidence and bounded defect before changing it.

### 10.4 Lifecycle and bounded callback contract

The integrated renderer must survive React StrictMode mount → cleanup → remount with exactly one live canvas for the active generation and no leaked observer/listener/ticker work. Async boot completion after unmount must not attach a stale canvas; cleanup must be idempotent and generation-safe. ResizeObserver and any DPR observation/listeners must be detached on cleanup, and no work may target a detached host. These are host properties; this test-only route must not introduce runtime subscriptions or a renderer-owned playback loop.

Callbacks remain bounded to existing renderer outputs (camera, selected identity/null, visible viewport). They must be tied to actual input rather than ordinary prop synchronization, avoid React feedback loops, and remain harmless when a host generation is retired. Minimap viewport reporting must correspond to the active renderer's logical viewport and camera, not backing-store pixels.

### 10.5 Scope and acceptance evidence

Expected implementation/test files, subject to narrow evidence-driven additions:

- `apps/explorer/src/App.tsx`: test-gated, mutually exclusive renderer selection using the existing shell and same props/state.
- `apps/explorer/src/styles.css`: only host sizing, stacking, pointer/touch, and responsive adjustments demonstrated necessary by integrated evidence.
- `apps/explorer/src/pixiWorld/WorldPixi.tsx`: only integration/accessibility/callback/lifecycle defects demonstrated by tests.
- `tools/validation/browser-smoke.ts` and `tools/validation/mobile-ui.ts`: real-shell desktop/phone evidence; add focused test helpers only where needed.
- `boot.ts` or validation routing/configuration: only when evidence establishes necessity; validation gates may not be weakened or bypassed.

Focused browser evidence on the exact pushed head must demonstrate:

1. With no `deeTest` gate, the production branch still mounts Canvas2D and does not mount Pixi; with `?deeTest`, Pixi is mounted and the semantic Canvas2D World is absent. In either case exactly one World renderer is active, while the subordinate minimap may remain Canvas2D.
2. Pixi host/canvas is accessible, fills the same measured `.world-wrap` geometry as the maintained World, and responds correctly to representative desktop and phone resizing. Record CSS dimensions separately from backing dimensions; exercise DPR/resize if the browser environment supports controlled DPR.
3. React lens, zoom, navigation, selection/inspector, create/restore/world replacement, and playback controls continue to use React-owned state. Renderer remount or test-route entry/exit does not change playback intent or create duplicate state. Confirm with observable UI/read-model behavior rather than internal assumptions alone.
4. Phone-sized journeys establish World visibility/dominance under controls and each relevant sheet state. Pending decision takes the one sheet slot ahead of Aftermath; Aftermath is retained and returns through its existing stages/settlement behavior. No duplicate large sheet appears.
5. Minimap and zoom overlay coexist with Pixi, remain correctly stacked and usable when not suppressed by decision priority, and represent the same camera/visible-world window. Pointer interactions over React overlays activate those controls; World pan/select works in the exposed World area without overlay interception.
6. StrictMode mount/cleanup/remount and world identity replacement leave one active canvas and no stale display/observer/callback effects. Boot cancellation, host resize, and cleanup checks must be tied to actual observable evidence available in the browser harness.
7. `App.tsx` production default remains Canvas2D. The evidence report labels results **P1.5 test-gated React integration evidence only** and explicitly excludes production parity/cutover and Android runtime claims.

Run focused browser/mobile suites in GitHub CI on the exact head. Run local lightweight typecheck/diff checks as appropriate. Apply manifest-routed blocking validations for the actual diff; do not run sustained browser/mobile capture workloads on the Owner device. Any new validation unit must follow the central manifest contract. Report exact SHA, CI URLs, test dimensions/device scale, observed renderer/backend, and failures/gaps. Passing integrated browser evidence does not prove Android runtime behavior.

### 10.6 Stop conditions and transition

Stop for Owner/design input if the real shell requires changing decision/Aftermath priority, playback semantics, camera/hit meaning, product visibility hierarchy, or runtime/read-model authority to accommodate Pixi; if both renderers are needed simultaneously to pass; if a visible fallback is required; or if a supported phone/browser behavior cannot be preserved without a product decision. Ordinary CSS stacking, host sizing, and listener cleanup remain implementation details when they preserve the accepted observable contract.

P1.5 completion means only that the test-gated Pixi host has passed the stated integrated browser/mobile claims while the production World remains Canvas2D. It is a prerequisite input to a separately reviewed and authorized P1.6 cutover design/implementation, not permission to perform that cutover.
