# P1.5 React/Pixi Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate Pixi inside the existing Explorer React shell through a test-only `?deeTest` renderer substitution while production remains Canvas2D.

**Architecture:** `App.tsx` selects exactly one semantic World renderer in the existing `.world-wrap`; both branches receive the same React-owned resolved inputs and bounded callbacks. Pixi owns only presentation lifecycle/resources; React/runtime/read-model flows remain authoritative for product behavior and evidence journeys.

**Tech Stack:** TypeScript, React, PixiJS 8.21.0, existing Playwright/Chromium browser and mobile validation scripts, central validation manifest.

**Spec:** `docs/superpowers/specs/2026-10-02-production-pixi-world-design.md` §10, approved for planning by issue #102 comment `5973042300`.

## Global Constraints

- `?deeTest` is only a test seam, not a product renderer selector, user feature, persistence setting, or fallback.
- Production without the test gate continues to use Canvas2D; never mount two semantic World renderers simultaneously.
- React remains authoritative for product state, playback, read-model composition, controls, overlays, decisions, Aftermath, and minimap semantics.
- Drive create/restore/world replacement, pending decision, Aftermath, and playback evidence through normal React/runtime/read-model hooks and observable journeys; do not create Pixi-specific fake product state.
- Pixi consumes bounded resolved presentation data and emits only user-originated camera, selection, and visible-world results. No runtime subscription or simulation/analysis authority.
- Preserve phone World visibility, one-large-sheet and pending-decision priority, retained Aftermath stages/settlement, overlay pointer boundaries, and subordinate read-only minimap behavior.
- CSS geometry and interaction remain CSS-pixel/logical-world based. DPR may affect backing resolution only.
- Lifecycle cleanup is idempotent, StrictMode-safe, stale-boot-safe, and does not control playback.
- `boot.ts` is conditional scope only when integrated evidence demonstrates a concrete host/resize/DPR/lifecycle defect.
- No P1.6 cutover, Canvas2D retirement, Android runtime claim, unrelated cleanup, or validation-gate weakening.
- The Owner approved this plan and authorized implementation after Task 0 reconciliation; no meaning-changing conflict was found. Do not exceed Tasks 1–4. Do not commit, push, or open a PR without separate authorization.

## Review Focus

1. **Normal product flow vs test-only fixtures:** create/restore, decisions, Aftermath, and playback must be observable through current React/runtime/read-model paths; cover in Tasks 3–4.
2. **Renderer exclusivity and default inertness:** `?deeTest` substitutes Pixi only in the existing slot; default remains Canvas2D; cover in Task 1.
3. **Overlay/pointer stacking on phone:** React controls/sheets and minimap must be clickable while exposed World remains interactive and visible; cover in Tasks 2 and 4.
4. **CSS size vs backing DPR and hit geometry:** resize/DPR cannot change logical viewport or CSS-pixel interaction; cover in Task 2, conditional DPR evidence limited to actual browser configuration.
5. **Async lifecycle/world replacement:** StrictMode remount or retired boot leaves one live canvas and no stale display/callback/observer work; cover in Task 3 and Task 4.

## File and Module Map

| Path | Responsibility |
|---|---|
| `apps/explorer/src/App.tsx` | Parse the existing `deeTest` seam and choose `WorldPixi` or `WorldCanvas` exclusively in `.world-wrap`; construct shared props from current React/read-model state. |
| `apps/explorer/src/styles.css` | Adjust only demonstrated host sizing, stacking, pointer/touch, and responsive issues. |
| `apps/explorer/src/pixiWorld/WorldPixi.tsx` | Fix only demonstrated host accessibility, bounded callback, resize, or cleanup defects. |
| `tools/validation/browser-smoke.ts` | Assert default/test renderer routes and desktop real-shell state/lifecycle journeys. |
| `tools/validation/mobile-ui.ts` | Assert real phone geometry, visibility, sheets, overlays, and interaction coexistence. |
| `tools/validation/pixi-p0.ts` | Update the existing production-cutover guard to assert test-only substitution and Canvas2D default remain enforced. |
| `apps/explorer/src/pixiWorld/boot.ts` | Conditional: edit only after evidence isolates a boot/resize/DPR defect not solvable at the React host boundary. |
| `tools/validation/manifest.ts`, `package.json` | Conditional: update only if existing routes do not expose required focused checks; preserve blocking behavior and run `pnpm validation:check`. |

## Interfaces

- `WorldPixi(props: PixiWorldProps): ReactElement` continues to receive the existing bounded, already-resolved renderer input.
- Build one shared `PixiWorldProps` value from the current `App` state/read model; the Pixi and Canvas branch use the same world/tick/environment/organism/lens/resource/trait/selection/camera/zoom and React callbacks where applicable. Do not add a second DTO or product-state store.
- `onCamera`, `onSelect`, and `onView` are the only renderer-to-React results in scope. Prop synchronization is not an input event and must not emit callbacks.
- Browser evidence uses normal app test hooks and user-visible journeys. `?deeTest` gates renderer substitution only; it does not synthesize product state.

---

### Task 0: Reconcile with current main before P1.5 edits

**Files:**
- Reconcile: feature branch with `main @ 7850f3b8cf1ce4d4f9d26b41ae9a9253f6d3613f`
- Inspect: `apps/explorer/src/App.tsx`, `apps/explorer/src/persistence.ts`, `apps/explorer/src/persistenceMessages.ts`, `packages/sim-runtime/src/{client,index,session}.ts`, `tools/validation/browser-smoke.ts`, `tools/validation/manifest.ts`
- Preserve: all accepted P1.2–P1.4 files and existing uncommitted approved design/plan documents.

- [x] **Step 1: Reconcile history without discarding either side.** Feature-only Pixi files were additions after common base `9e89d23`, not deletions authored by main; merged main without textual conflicts.
- [x] **Step 2: Inspect App/read-model ownership, create/restore, browser journeys, and validation routing.** F3a atomic slot read, typed failures, post-acceptance phenotype-anchor staging, playback-intent restoration on ordinary rejection, normal React/runtime hooks, and blocking manifest routing remain intact.
- [x] **Step 3: Check for meaning-changing conflicts with the approved P1.5 design.** None found. Continue with Tasks 1–4; preserve F3a behavior and drive P1.5 evidence through its normal hooks.
- [x] **Step 4: Run focused reconciliation checks:** persistence-integrity, runtime-boundary, Explorer typecheck, validation check, and P1.2–P1.4 Pixi contracts. All passed.

### Task 1: Exclusive Test-Gated Renderer Substitution

**Files:**
- Modify: `apps/explorer/src/App.tsx`
- Test: `tools/validation/browser-smoke.ts`
- Modify: `tools/validation/pixi-p0.ts` (static route/default guard)

**Interfaces:**
- `App` derives a test-only boolean from the existing `deeTest` query parameter.
- In the existing `.world-wrap`, render exactly one of `WorldPixi` or `WorldCanvas`; all product overlays and minimap remain siblings in their current React-owned shell.

- [x] **Step 1: Add failing route assertions** that default URL has the maintained Canvas2D World and no Pixi host/canvas, while `?deeTest` has a Pixi host/canvas and no semantic Canvas2D World. Assert exactly one World renderer in each route; allow the subordinate minimap canvas.
- [ ] **Step 2: Run the focused browser smoke test** and confirm the renderer-route assertion fails for the Pixi test route before wiring the substitution. The local Vite attempt remained on its loading shell before the route assertion; exact-head CI is the first valid integrated execution.
- [x] **Step 3: Construct the common renderer inputs at the existing `WorldCanvas` callsite** from the same current React/read-model values, and render one branch according to the test gate. Keep the gate non-persistent and avoid adding a visible product selector.
- [x] **Step 4: Update and run the existing Pixi static boundary check** so it asserts the `deeTest`-gated mutually exclusive branch and Canvas2D production default rather than requiring no Pixi import at all.
- [ ] **Step 5: Run the focused route test and Explorer TypeScript check.** Explorer TypeScript passes; integrated route assertions await exact-head CI.

### Task 2: Host Geometry, Overlay Stack, Pointer, and Minimap

**Files:**
- Modify only if required: `apps/explorer/src/styles.css`, `apps/explorer/src/pixiWorld/WorldPixi.tsx`
- Test: `tools/validation/browser-smoke.ts`, `tools/validation/mobile-ui.ts`

**Interfaces:**
- Pixi host stays in `.world-wrap`; React decorative scene, minimap, controls, compact Aftermath, and sheet slot preserve their hierarchy.
- Visible viewport callback reports logical world units for the current CSS viewport/camera, independent of backing-store resolution.

- [x] **Step 1: Add failing geometry and stacking assertions** for accessible host label, host/canvas bounds matching `.world-wrap`, one active renderer, CSS bounds recorded separately from backing dimensions, and hit targets for minimap/zoom/sheets above Pixi.
- [x] **Step 2: Add failing desktop/phone interaction assertions**: visible World remains materially present; controls and minimap are usable when not suppressed by decision priority; overlay clicks do not pan/select; exposed World supports pan/select. Assert minimap viewport/camera meaning tracks the same React camera/view.
- [ ] **Step 3: Run focused browser/mobile checks** to record actual mismatches before styling changes. Integrated browser execution awaits exact-head CI.
- [x] **Step 4: Add the host sizing/stacking/touch/accessibility CSS needed for the inspected DOM boundary, plus controlled 2x DPR and resize assertions.** Report only the actual tested scale.
- [ ] **Step 5: Re-run focused checks at representative desktop and phone dimensions.** CI pending; `boot.ts` remains unchanged.

### Task 3: React-Owned Journeys and Pixi Host Lifecycle

**Files:**
- Modify if evidence requires: `apps/explorer/src/pixiWorld/WorldPixi.tsx`; `apps/explorer/src/pixiWorld/boot.ts` only after the Task 2 stop/report condition is satisfied.
- Test: `tools/validation/browser-smoke.ts`

**Interfaces:**
- Product transitions are triggered by existing React/runtime/read-model flows; renderer only observes resulting props and emits bounded input callbacks.
- Host cleanup removes only resources belonging to its own generation and never modifies playback intent.

- [x] **Step 1: Add failing normal-path browser journeys** for selection/inspector, lens/zoom, navigation away/back, create/restore/world replacement, and playback controls under `?deeTest`. Use existing `deeTest` runtime hooks/product journeys; do not inject Pixi-specific pending/Aftermath/playback state.
- [x] **Step 2: Add failing host lifecycle assertions** for StrictMode mount→cleanup→remount, stale async boot after unmount, one active canvas, world replacement retiring old displays, and renderer remount not changing observable playback intent/state.
- [ ] **Step 3: Run focused browser smoke** and classify each failure as App branch/prop parity, React host lifecycle, or boot/resize boundary using observable logs/DOM/resource evidence.
- [ ] **Step 4: Fix only the proven boundary defect.** Keep React as sole product-state authority; suppress callback emissions from prop synchronization; add no runtime subscription or renderer playback behavior. Include `boot.ts` only with a concrete reproduced defect and keep its change minimal.
- [ ] **Step 5: Re-run normal-path journeys and lifecycle tests.** Expected: product behavior/read-model updates remain normal; exactly one current canvas; no stale callback/display/observer effects; playback unchanged by renderer lifecycle.

### Task 4: Phone Decision/Aftermath Priority and Exact-Head Evidence

**Files:**
- Modify: `tools/validation/mobile-ui.ts`, `tools/validation/browser-smoke.ts`; `styles.css`/`App.tsx` only if Task 2/3 tests expose defects.
- Validation: existing manifest-routed browser/mobile units; `tools/validation/manifest.ts` only if a required check has no honest route.

**Interfaces:**
- Drive pending decision, Aftermath impact/observation/settlement, and playback through existing React/runtime/read-model test pathways and inspect normal user-visible state.
- Evidence claim is P1.5 test-gated React integration only, not production cutover or Android runtime.

- [x] **Step 1: Add failing phone journey assertions** that World remains visible under each relevant sheet; only one large sheet exists; a pending mandatory decision occupies the sheet slot ahead of retained Aftermath; resolving it returns to the existing Aftermath stage and settlement journey.
- [x] **Step 2: Add failing coexistence assertions** for compact Aftermath placement, minimap/zoom suppression while decision priority requires it, and restored control usability after the decision; confirm playback follows established React behavior, not renderer mount/unmount.
- [ ] **Step 3: Run the existing focused browser and mobile tests locally only if bounded/lightweight;** route sustained browser/mobile execution to GitHub CI. Run `pnpm validation:check` if manifest/package routing changed.
- [ ] **Step 4: Apply minimal fixes only for reproduced integration regressions.** Any need to change priority, playback, camera/hit meaning, phone hierarchy, runtime/read-model authority, or introduce a visible fallback is a stop for Owner/design input.
- [ ] **Step 5: Run focused browser/mobile suites in GitHub Actions on the exact pushed head.** Verify exact SHA in the run; record route, viewport, actual device scale, renderer/backend, and artifact/log links. Keep implementation commit/push separately authorized.
- [ ] **Step 6: Report residual gaps explicitly.** State that production default remains Canvas2D, the route is only a test seam, this does not establish P1.6 cutover or Android runtime, and list any unsupported browser/DPR/lifecycle assertion.

## Commit / Checkpoint Boundary

Keep P1.5 changes bounded to the files above and any evidence-justified conditional additions. Do not combine P1.6 production cutover, Canvas2D retirement, unrelated cleanup, or Android workflow changes. Commit/push and CI publication require separate Owner authorization; exact-head browser/mobile proof is required before claiming the P1.5 evidence groups.

## Plan Self-Review

- **Spec coverage:** renderer exclusivity/default inertness (Task 1); shared React props/state and callback ownership (Tasks 1 and 3); geometry, pointer/overlay stacking, minimap, DPR (Task 2); normal product journeys, create/restore/world replacement and playback (Task 3); StrictMode/stale boot/cleanup (Task 3); phone visibility, one-sheet priority, Aftermath coexistence (Task 4); exact-head CI and truthful evidence limits (Task 4).
- **Precision notes:** the query gate has no product-facing semantics; stateful journeys use existing React/runtime/read-model paths, never Pixi-specific fake product state.
- **Type consistency:** use existing `PixiWorldProps` and callback types from `worldViewTypes.ts`; no new integration DTO is specified.
- **Review focus coverage:** each of the five risk classes is assigned to tests in its owning task above.
- **Scope:** `boot.ts` and validation routing are conditional; implementation stays within Tasks 1–4. Commit/push still require separate authorization; no cutover or Android-runtime claim is authorized by this plan.
