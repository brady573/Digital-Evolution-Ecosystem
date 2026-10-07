# Cell-Shape Structural Axis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a continuous inherited cell-shape trait (elongation) with reach-vs-drag tradeoffs, selectable at both ends in different regimes, on maintained main.

**Architecture:** One new float trait plumbed through the standard trait path (table, interface, child, founder init, metrics, export, checkpoint-by-codec), with exactly two behavior hooks: sensing probe distances scale up with elongation (reach) and movement cost scales up with elongation (drag). Phenotype package untouched; Lane 2 consumes the exported state.

**Tech Stack:** TypeScript sim-core, tsx validation scripts, GitHub Actions for long suites.

**Spec:** issue #97 comment #6029727256 (self-contained; no Drive needed). Branch `feat/cell-shape-axis` from `origin/main@7850f3b`.

## Global Constraints

- Engine version advances 0.24.0 → 0.25.0; version gate keeps refusing older saves; no backfill.
- Trait `elongation`, short field `el`, range [0, 1.5] (capability-trait convention); multiplicative mutation (to/cu convention, NOT the additive diet/habitat/bu/dr list).
- Founder init `Q(.05+.25*H01(seed,id,61),0,1.5)` — new hash salt, no RNG-stream disturbance.
- Initial coefficients (calibration inputs, adjustable in Task 5 only): `EL_REACH=0.5` (probe distances × (1+0.5×el/1.5)), `EL_DRAG=1.0` (movement cost × (1+1.0×el/1.5)). Locomotion drag only; no maintenance drag, no uptake/armor/reserve/repro bonuses (out of slice).
- No sessility, no family-frequency targets, no family-specific fitness, no multicellularity, no 2C reopening, no phenotype-family calibration changes, no PR #107 art changes.
- el=0 behaves EXACTLY as 0.24.0 (neutral baseline preserved).
- Owner-device rule: short targeted probes locally; long evolution assays on CI. No merge without return review.

## Review Focus

- el=0 removes all mechanism effects (single-cell contact, unit reach/drag
  factors — structurally pinned), but cross-version trajectory identity is
  neither expected nor required: each birth consumes one extra mutation-stream
  draw for the new trait, so post-first-birth mutation sequences shift by
  design (precedent: every trait addition; the version bump exists for this).
  Twin determinism within one engine is the pinned property.
- Founder init must not disturb existing RNG streams (H01 hash, new salt) — pinned by Task 2 init-distribution test.
- Elongation must not change sense() RNG draw count (scales distances only) — pinned by Task 3 draw-count test.
- Max-el must not collapse trivially everywhere (compact wins uniform; elongated must survive to be measured) — pinned by Task 5 extinction guard.
- Exhaustive consumers of the traits object must tolerate the new key — pinned by Task 2 audit test (explorer trait lens, phenotype TraitSample, analysis trait loops).

---
### Task 1: Engine version advance to 0.25.0

**Files:**
- Modify: `packages/sim-core/src/version.ts`
- Modify: `tools/validation/flows.ts` (add `testEngineVersionGate` after `testWasteCheckpoint`, call it in the runner list)

**Interfaces:**
- Consumes: strict gates in `restoreSimulationCheckpoint` (`engine.ts`) and session `restore` (camelCase `engineVersion`).
- Produces: `ENGINE_VERSION = "0.25.0"` for all later tasks.

- [ ] **Step 1: Write the failing test** — in `flows.ts`, add `testEngineVersionGate` asserting `ENGINE_VERSION === "0.25.0"`, plus a same-version checkpoint round-trip and a `"0.24.0"`-stamped restore throwing via `session.checkpoint()`/`restore` (note: session shape uses `engineVersion`, not `engine_version`).
- [ ] **Step 2: Run the gate logic only** — exact-logic standalone probe (never full `flows.ts` locally; it exceeds 10 min). Expected: FAIL on the version pin.
- [ ] **Step 3: Implement** — set `ENGINE_VERSION = "0.25.0"` in `version.ts`; update its comment (new persistent trait state, no backfill).
- [ ] **Step 4: Re-run the probe** — Expected: PASS. Then `pnpm validation:check`. Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(sim-core): engine 0.25.0 for cell-shape trait state"`.

### Task 2: Trait plumbing (behaviorally neutral)

**Files:**
- Modify: `packages/sim-core/src/engine.ts` (T table, `Organism` interface, `child()`, founder init, `MUTATION_NAMES`, `STUDY_TRAITS`, metrics traits, export `living_creatures` traits + `trait_diversity` wording ten→eleven)

**Interfaces:**
- Consumes: Task 1 version.
- Produces: inherited, mutating, persisted, exported `el` with zero behavior hooks (el=0 identical to 0.24.0; el>0 inert until Task 3).

- [ ] **Step 1: Write failing tests** — new `tools/validation/cell-shape.ts`: `testTraitExists` (T entry `elongation:['el',0,1.5]`, founder `el` in range, child inherits+mutates `el`, `MUTATION_NAMES` labels it); `testInitUndisturbed` (all OTHER founder traits identical with/without the addition — same seed, compare pre/post? pin: non-el founder means match historic bands); `testTraitsAudit` (every exhaustive consumer of organism traits handles `el`: list explorer lens, phenotype sample, analysis loops — structural assertions per consumer).
- [ ] **Step 2: Run to verify they fail** — Run: `pnpm exec tsx tools/validation/cell-shape.ts` (seconds). Expected: FAIL (no `el` anywhere).
- [ ] **Step 3: Implement** — T entry, interface field, `el:q.el!` in `child()` (mutation automatic via `for(n in T)`), founder `el=Q(.05+.25*H01(seed,id,61),0,1.5)`, names/study/metrics/export/diversity-text updates. No behavior reads `el` yet.
- [ ] **Step 4: Run to verify** — same command. Expected: PASS. Exact-logic replay check: el=0-forced world matches 0.24.0 trajectory (add as `testNeutralBaseline` if cheap, else defer to Task 6 twin replay).
- [ ] **Step 5: Commit** — `git commit -m "feat(sim-core): inherited elongation trait plumbing (neutral)"`.

### Task 3: Reach and drag mechanics

**Files:**
- Modify: `packages/sim-core/src/engine.ts` (`sense()` probe distances, movement-cost application in the organism loop)
- Modify: `tools/validation/cell-shape.ts` (isolation assays)

**Interfaces:**
- Consumes: Task 2 `el`.
- Produces: `EL_REACH`/`EL_DRAG` semantics with isolated, exactly-measurable effects.

- [ ] **Step 1: Write failing tests** — `testReachIsolation` (matched clones differing only in `el`: elongated probe distances longer by exactly the reach factor — measure via first-discovery tick of a fixed distant stock, or via `sense()` range arithmetic on fixed inputs); `testDragIsolation` (matched clones: per-tick movement energy ratio equals exactly `(1+EL_DRAG×el/1.5)`); `testDrawCountStable` (sense RNG draw count identical across `el` values — distances scale, draws don't).
- [ ] **Step 2: Run to verify they fail** — Expected: FAIL (no hooks).
- [ ] **Step 3: Implement** — `sense()`: `ds` entries scaled by `(1+EL_REACH×Q(o.el||0,0,1.5)/1.5)`; organism loop movement cost `MC(o.sp)` scaled by `(1+EL_DRAG×Q(o.el||0,0,1.5)/1.5)`. Constants beside `CU_RATE` with calibration comments.
- [ ] **Step 4: Run to verify** — Expected: PASS (seconds-scale fixtures).
- [ ] **Step 5: Commit** — `git commit -m "feat(sim-core): elongation reach-vs-drag mechanics"`.

### Task 4: Register the cell-shape validation unit

**Files:**
- Modify: `package.json` (`test:cell-shape` script)
- Modify: `tools/validation/manifest.ts` (blocking deterministic unit + route into `ci-sim-c` and the `simulation` group)

**Interfaces:**
- Consumes: Task 3 test file.
- Produces: CI-routed `cell-shape` unit.

- [ ] **Step 1: Register** — script, manifest unit (claim: reach/drag isolation, both-ends selection, replay/checkpoint/version), `ci-sim-c` unitIds, `simulation` group unitIds (verify-completeness rule: blocking units must sit in a non-shard group).
- [ ] **Step 2: Run `pnpm validation:check`** — Expected: PASS (40 units).
- [ ] **Step 3: Commit** — `git commit -m "test(validation): register cell-shape unit in ci-sim-c"`.

### Task 5: Both-ends regime selection (CI-measured)

**Files:**
- Modify: `tools/validation/cell-shape.ts` (evolution assays; calibration constants in `engine.ts` ONLY if evidence demands)

**Interfaces:**
- Consumes: Tasks 3–4.
- Produces: proof that compact wins somewhere AND elongated wins somewhere (no universal optimum).

- [ ] **Step 1: Write assays** — `testCompactRegime` (uniform rich world, N generations: population-mean `el` declines / low-el lineages outreproduce — predeclare direction, pin margins from CI measurement); `testElongatedRegime` (patchy/sparse world: mean `el` rises / high-el lineages win); `testNoUniversalOptimum` (the two results jointly — neither morph wins everywhere); `testNoTrivialCollapse` (extinction guard: max-el founders survive to be measured in both regimes).
- [ ] **Step 2: Measure on CI** — push Tasks 1–4 head; read sim-c values. Expected: measure, never assume.
- [ ] **Step 3: Pin margins from measured values** — same-seed, structural bars with daylight; causal comment per pin. Adjust `EL_REACH`/`EL_DRAG` ONLY if one end shows no selection (document reasoning; never tune to a desired frequency).
- [ ] **Step 4: Commit** — `git commit -m "test(validation): cell-shape regime selection (CI-measured, both ends)"`.

### Task 6: Determinism, checkpoint, version evidence

**Files:**
- Modify: `tools/validation/cell-shape.ts` (replay/checkpoint tests; flows.ts gate already covers refusal)

**Interfaces:**
- Consumes: Tasks 2–3.
- Produces: AC-replay evidence for the new inherited state.

- [ ] **Step 1: Write tests** — `testNeutralReplay` (el=0-forced world replays 0.24.0 trajectory exactly — twin JSON equality); `testElCheckpoint` (mid-run checkpoint with el≠0 restores exactly and continues identically); `testElDeterminism` (two same-seed runs identical including `el` trajectories).
- [ ] **Step 2: Run short forms locally, full forms on CI** — Expected: PASS.
- [ ] **Step 3: Commit** — `git commit -m "test(validation): elongation replay, checkpoint, determinism"`.

### Task 7: Mapping contract and return evidence

**Files:**
- Modify: `tools/validation/cell-shape.ts` (export-carries-shape assertion)
- Create/append: return-package notes (in-chat return; no PR actions)

**Interfaces:**
- Consumes: Tasks 2–6.
- Produces: Lane 1→Lane 2 interface contract + complete evidence bundle.

- [ ] **Step 1: Assert export truthfulness** — `testExportCarriesShape` (export `living_creatures[].traits.elongation` equals organism `el`; norm proposal `el/1.5` documented as Lane 2 input, not Lane 1 mapping). Phenotype package stays untouched.
- [ ] **Step 2: Full CI green on exact head** — all manifest-routed blocking units for the diff.
- [ ] **Step 3: Return package** — base/head SHAs + engine version; reach/drag isolation values; both-ends regime evidence; no-optimum argument; replay/checkpoint/version evidence; mapping contract (`elongation` field, proposed norm); exact re-pin list (expected: none beyond calibration); limitations; verdict. No merge, no family-calibration changes.

## Self-Review

1. **Spec coverage:** narrow slice (reach advantage ✓ T3/T5, drag ✓ T3, compact-favored regime ✓ T5, elongated-favored regime ✓ T5, no universal optimum ✓ T5, replay/checkpoint/version ✓ T1/T6, truthful mapping ✓ T7, no analysis-label feedback ✓ by construction — resolver untouched); ownership split ✓ (Lane 2 rewire explicitly out, contract in T7); keep-out list ✓ (no sessility/bonuses/targets/multicellularity/2C tasks exist); calibration ✓ (T5 only, meaning-change triggers review).
2. **Step scan:** each step names one action + checkable result; fixed inline.
3. **Type consistency:** `el` short field everywhere; `EL_REACH`/`EL_DRAG` coefficient names used consistently; assay names unique.
4. **Review Focus:** all five lines have owning-task tests.
5. **Proportion:** plan shorter than the code it will produce; bodies only where signatures don't determine them.
