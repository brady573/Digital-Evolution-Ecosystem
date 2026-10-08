# Foundation Slice 2C Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace immediate per-organism Waste cleanup with staged cell-local saturating detox flux, restoring Waste niche reachability while preserving the ALIGNED Detritus subsystem.

**Architecture:** Per-tick Waste path becomes snapshot → intents → budget → allocate → commit. Organism loop computes burden from a frozen pre-cleanup snapshot and records cleanup intents without mutating the field; a post-loop phase derives a bounded monotonic per-cell budget, allocates it proportionally and deterministically, and commits actual removals with actual-based cost/attribution. All staging buffers are tick-local (never checkpointed).

**Tech Stack:** TypeScript, existing sim-core `Simulation`/`WasteField`, tsx validation scripts, GitHub Actions for long suites.

**Spec:** issue #97 comment #5985271246 (self-contained; no Drive needed). Successor branch `feat/foundation-slice2c-waste-cleanup`; PR #103 at `2f11e57` stays immutable provenance.

## Global Constraints

- Engine version advances 0.25.0 → 0.26.0; version gate keeps refusing older saves; no compatibility backfill.
- No new persistent state: intents, budgets, allocation buffers are pure tick-local derived state, never checkpointed.
- Waste production stays primary-metabolism-driven; Waste stays non-food; `to`/`cu` stay independent inherited strategies.
- Detritus death-return, persistent field + pending/next-tick merge, mineralization, R1-threshold ordinary-first use, `du` tradeoff, H1/H2/H4/H5 semantics, accounting, specialization stay protected.
- A/B/C and C-scavenging semantics protected; abundance emergent; no population/density/Waste targets, no scripted niche state, no detector weakening.
- sim-core stays biological authority; no React/DOM/storage/wall-clock in sim-core; allocation uses zero RNG draws.
- Owner-device rule: short bounded probes locally; long suites/surveys/perf on CI. No commit/push/PR without explicit Owner authorization per task.

## Review Focus

- Snapshot cost at thousands-scale: a full 3600-float copy per tick must not regress K timing beyond its 4x bar — pinned by Task 6 perf re-verification.
- Float reconciliation: proportional allocation is exact in floats but the field commit must prove `Σ actual == field delta` by construction (single per-cell removal path), not by tolerance — pinned by Task 3 closure test.
- Same-tick production deposits land during the organism loop (consumption transform); the snapshot is taken post-environment pre-loop, so same-tick deposits are visible next tick, never mid-tick — pinned by Task 3 order-invariance test.
- `enabledWaste=false` forks (matched-clearing/cSink white-box instruments) must flow through the staged path as a no-op with zero active cost — pinned by Task 4 no-op fixture also run with the flag off.
- Newborns committed in the post-loop birth phase never submit intents same-tick (they were not active at snapshot); dormant organisms never submit — pinned by Task 3 eligibility test.

---

### Task 1: Engine version advance to 0.26.0

**Files:**
- Modify: `packages/sim-core/src/version.ts` (comment + `ENGINE_VERSION`)
- Modify: `tools/validation/checkpoint-boundary.ts` (add version pin if absent — inspect first)

**Interfaces:**
- Consumes: existing strict gate in `createSimulationCheckpoint`/`restore` (`engine.ts:920-924`).
- Produces: `ENGINE_VERSION = "0.26.0"` for all later tasks; 0.25.0 saves refused.

- [ ] **Step 1: Inspect version-gate tests** — read `tools/validation/checkpoint-boundary.ts` and `checkpoint-historical-boundary.ts`; note which tests assert the refusal behavior and whether any hardcode `"0.25.0"`.
- [ ] **Step 2: Write the failing test** — in `checkpoint-boundary.ts`, assert `ENGINE_VERSION === "0.26.0"` and that a checkpoint stamped `0.25.0` throws on restore.
- [ ] **Step 3: Run it to verify it fails** — Run: `pnpm exec tsx tools/validation/checkpoint-boundary.ts`. Expected: FAIL on the version assertion.
- [ ] **Step 4: Implement** — set `ENGINE_VERSION = "0.26.0"` in `packages/sim-core/src/version.ts`; update its comment block (2C reason: biological resolution semantics changed; transient staging state is never persisted so no backfill exists to write).
- [ ] **Step 5: Run to verify** — Run: `pnpm exec tsx tools/validation/checkpoint-boundary.ts` then `pnpm validation:check`. Expected: PASS, PASS (40 units).
- [ ] **Step 6: Commit** — `git commit -m "feat(sim-core): engine 0.26.0 for staged cleanup resolution semantics"`.

### Task 2: Staging mechanics — snapshot, intents, shared burden

**Files:**
- Modify: `packages/sim-core/src/engine.ts` (organism-loop waste block ~`engine.ts:785-797`, `execCleanup` call site)
- Test: new `tools/validation/waste-cleanup.ts` (fixtures for AC2C-1/AC2C-2 only in this task)

**Interfaces:**
- Consumes: `WasteField.fractionAt/amountAt`, `WASTE_PROCESS` request curve (`rate CU_RATE × capability`, `engine.ts:244-268`).
- Produces: `snapshotWaste(): Float32Array` semantics (frozen post-environment stock copy), per-tick intent list `{orgId, cell, request}`, burden-from-snapshot. Later tasks consume the intent list and snapshot.

- [ ] **Step 1: Write failing fixture tests** in `tools/validation/waste-cleanup.ts`:
  - `sharedExposureInvariance`: two runs identical except organism array permutation return identical per-organism burden values (read from interval/lineage `burdenEnergy` attribution after one tick on a fixed Waste setup).
  - `noWasteNoOp`: zero-Waste world — no removal, no active cost, standing cost still charged (AC2C-2 + AC2C-7 standing half).
- [ ] **Step 2: Run to verify they fail** — Run: `pnpm exec tsx tools/validation/waste-cleanup.ts`. Expected: FAIL (permutation changes burden today; fixtures reference helpers not yet present).
- [ ] **Step 3: Implement** in `engine.ts` — at tick start (post-`resources.step`, pre-loop) copy waste stock to a tick-local snapshot; organism-loop waste block reads burden inputs (`wf`) from the snapshot, computes standing + defers active cost, appends `{orgId, cell, request = CU_RATE × capability}` for eligible active cleaners (capability>0, snapshot cell waste>0), and performs NO field mutation (remove the in-loop `execCleanup` call; keep `execCleanup` itself for now — Task 3 rewires it). Dormant skip (`continue`) unchanged.
- [ ] **Step 4: Run to verify** — same command. Expected: PASS (low-contention behavior arrives in Task 3; these two fixtures need only snapshot + no-op).
- [ ] **Step 5: Commit** — `git commit -m "feat(sim-core): staged cleanup intents with shared pre-cleanup exposure snapshot"`.

### Task 3: Saturating budget, deterministic allocation, actual-based commit

**Files:**
- Modify: `packages/sim-core/src/engine.ts` (`WasteField` budget method + post-loop commit phase + `WASTE_PROCESS.execute` rewiring or retirement)
- Test: extend `tools/validation/waste-cleanup.ts` (AC2C-3/4/5/6/7 fixtures)

**Interfaces:**
- Consumes: Task 2 intent list + snapshot.
- Produces: `cellBudget(wasteAmount): number` (bounded monotonic, ≤ available), per-organism `actual` allocations, field commit with exact reconciliation, `cleanup_exec`/lineage facts from actuals only.

- [ ] **Step 1: Write failing fixture tests**:
  - `lowContentionParity`: one cleaner on fixed Waste removes exactly `CU_RATE × capability` (full request) — AC2C-3.
  - `saturationBound`: identical Waste, cleaner counts 2/4/8/16 (cloned placements) — aggregate removal strictly diminishing increments converging to a finite bound independent of headcount — AC2C-4.
  - `permutationInvariance`: same-cell cleaner multiset in shuffled organism order yields identical per-organism actuals — AC2C-5.
  - `closureReconciliation`: Σ per-lineage `wasteRemoved` == field `bioRemoved` delta and == Σ interval `removed_w`; active cost == `CU_ACTIVE` × actual per organism — AC2C-6/7.
  - `sameTickDepositOrder`: fixed world where consumption deposits Waste mid-loop — burden/budget identical regardless of which organism eats first (deposits join next tick's state) — Review Focus 3.
  - `dormantAndNewbornEligibility`: dormant cleaners submit nothing; birth-phase newborns submit nothing same-tick — Review Focus 5.
- [ ] **Step 2: Run to verify they fail** — Expected: FAIL (no budget/allocation exists).
- [ ] **Step 3: Implement** — `WasteField.cellBudget`: `B = min(stock, VMAX * w / (w + KM))` with new constants (initial: `VMAX` ~= 8× single-cleaner full request at reference Waste, `KM` ~= half-saturation near typical dirty-cell stock — document as Task-7-calibratable; zero-with-no-waste, monotonic, bounded, local-only, deterministic). Allocation per cell: `R = Σ requests`; `R <= B` → actual = request; else actual = `request × B / R` (pure float proportional, no RNG, no lineage/age input; organism iteration id-sorted as today). Commit post-loop per organism in id order via `removeAt(actual)` (always satisfiable: Σactual ≤ snapshot stock ≤ current stock); `cleanup_exec` + lineage `wasteRemoved`/`cleanupExec` credited only for actual > 0; active cost = `CU_ACTIVE × actual`. Rewire `execCleanup` to the staged path or retire it if no caller remains (check `flows.ts` usage first — testCleanupExecution §5.1 must keep passing, strengthened).
- [ ] **Step 4: Run to verify** — Run: `pnpm exec tsx tools/validation/waste-cleanup.ts` then `pnpm exec tsx tools/validation/flows.ts`. Expected: PASS, PASS (§5.1 closure holds on actuals).
- [ ] **Step 5: Commit** — `git commit -m "feat(sim-core): saturating cell-local cleanup budget with neutral deterministic allocation"`.

### Task 4: Register the waste-cleanup validation unit

**Files:**
- Modify: `package.json` (add `test:waste-cleanup` script)
- Modify: `tools/validation/manifest.ts` (new blocking unit + route into `ci-sim-c`)
- Test: `pnpm validation:check`

**Interfaces:**
- Consumes: Task 3 test file.
- Produces: CI-routed `waste-cleanup` unit for all later evidence.

- [ ] **Step 1: Register** — script `test:waste-cleanup: tsx tools/validation/waste-cleanup.ts`; manifest unit (blocking, sim-core domain, claim: staged cleanup mechanism); add to `ci-sim-c` unitIds ahead of `detritus` (mechanism before protected suites).
- [ ] **Step 2: Run `pnpm validation:check`** — Expected: PASS (41 units).
- [ ] **Step 3: Commit** — `git commit -m "test(validation): register waste-cleanup mechanism unit in ci-sim-c"`.

### Task 5: Strategy assays (cleanup viability, tolerance distinction, controls)

**Files:**
- Modify: `tools/validation/waste-cleanup.ts` (append strategy assays, AC2C-8 + no-opportunity controls)

**Interfaces:**
- Consumes: Task 3 engine behavior.
- Produces: evidence that cleanup is selectively useful somewhere real and tolerance stays distinct.

- [ ] **Step 1: Write failing assays** — `capableVsIncapable`: matched forks (cu>0 vs cu=0, same seed) in a justified Waste-rich regime — capable lineage shows net energy/fitness advantage with active cost paid; `toleranceDistinction`: to-high/cu-zero vs to-zero/cu-high forks behave differently (burden reduction vs field removal); `noOpportunityControl`: cu>0 with Waste disabled — no removal, no active cost, standing cost only.
- [ ] **Step 2: Run to verify they fail** — Expected: FAIL (assertions on advantage margins to be measured).
- [ ] **Step 3: Implement assay pins from measured values** — run locally once each (short bounded probes), pin margins with the measured numbers in comments (same-seed re-pins if they move, never forced).
- [ ] **Step 4: Run full file green locally** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "test(validation): cleanup strategy viability and tolerance-distinction assays"`.

### Task 6: Protected Detritus suite + 0.26 survey + performance

**Files:**
- Modify: `tools/validation/detritus.ts` (only if CI-measured capability-proven moves; H1/H2/H4/H5 semantics protected, never weakened)
- Create: `testdata/detritus-survey-0.26.json` via existing `test:detritus-survey` (update survey-gate engine pin from 0.25)
- Test: full `test:detritus` + survey gate + K bars unchanged

**Interfaces:**
- Consumes: Task 3 engine; existing `detritus-survey.ts` (add niche-sweep fields already present — confirm untouched detector semantics).
- Produces: 0.26 detritus evidence (invasion, specialization, accounting, checkpoint, K) for the return package.

- [ ] **Step 1: Run protected suite on CI** — push Task 1–5 head; read sim-c detritus verdicts (H1/H2/H4/H5/priority/accounting/checkpoint/hotspot/K/survey-gate). Expected: measure, do not assume.
- [ ] **Step 2: Re-pin only capability-proven moves** — same-seed, measured-values, causal comment per pin; any H-semantics threat returns DESIGN TENSION per stop conditions (do not weaken).
- [ ] **Step 3: Retain 0.26 survey artifact** — run survey (CI resume-safe path), commit artifact, confirm gate passes.
- [ ] **Step 4: K + changed-cost perf** — K bars unchanged (4x ratio, twin proxies); report wall time + deterministic proxies for the gather/resolve path (AC2C-16).
- [ ] **Step 5: Commit(s)** — scoped per re-pin area, e.g. `git commit -m "test(validation): 0.26 detritus re-pins (CI-measured, capability-proven)"`.

### Task 7: Protected ecology re-verification

**Files:**
- Modify: `tools/validation/ecology.ts`, `dependency.ts` (washout/arc), `decisions.ts` only for CI-measured trajectory moves.

- [ ] **Step 1: Run ecology/dependency/decisions on CI** (same run as Task 6 where possible). Expected: measure.
- [ ] **Step 2: Re-pin trajectory-only moves** with causal comments (same discipline as 2B: decisions audit, arc values, washout fork timing if establishment moved).
- [ ] **Step 3: Commit** — `git commit -m "test(validation): 0.26 ecology re-pins (CI-measured, trajectory-only)"`.

### Task 8: Waste niche reachability survey + historical characterization

**Files:**
- Modify: `tools/validation/niche-survey.ts` or `detritus-survey.ts` (bounded multi-seed/regime rows; detector untouched)
- Test: survey gate asserting ≥1 establishment AND ≥1 non-establishment (AC2C-11/12), causal-chain record on an establishment case (AC2C-13).

**Interfaces:**
- Consumes: Tasks 3, 6 calibration state.
- Produces: the reachability verdict input. Calibration decision rule: if the justified bounded sweep shows zero establishments, first check low-contention usefulness (Task 5 margins) — if isolated cleaners are ineffective, recalibrate VMAX/KM once with documented reasoning; if cleaners are useful but niches still absent, return DESIGN TENSION (never tune to the old tick/frequency, never weaken the detector).

- [ ] **Step 1: Run bounded sweep on CI** (manual dispatch pattern from 2B survey workflow if needed).
- [ ] **Step 2: Characterize the former historical case** (seed 333333333 trajectory under 0.26 — no exact-timing requirement).
- [ ] **Step 3: Pin the survey gate** from measured rows (establishment + non-establishment retained).
- [ ] **Step 4: Commit** — `git commit -m "test(validation): 0.26 waste-niche reachability survey (bounded, establishment + non-establishment)"`.

### Task 9: Exact-head completion and return package

**Files:**
- Modify: `tools/validation/manifest.ts` (baseline correction from stable head, as in 2B)
- PR comment on the successor PR (needs Owner authorization to open/post — request it here).

- [ ] **Step 1: Full CI green** on the exact head (`pnpm verify` equivalent per manifest routing); visual/browser evidence as routed.
- [ ] **Step 2: Retain all artifacts** (0.26 survey, niche sweep rows, perf numbers).
- [ ] **Step 3: Request Owner authorization** to open the successor PR and post the return package (base/head SHAs, architecture, fixture/allocation/Detritus/ecology/survey/checkpoint/perf evidence, exact re-pin list, limitations, verdict).
- [ ] **Step 4: Post package only after explicit approval.**

## Self-Review

1. **Spec coverage:** §2 stages → Tasks 2–3 (env/activity/movement preserved by construction, snapshot/intents/budget/allocate/commit new); §3 → Task 1 + Task 3 (no-checkpoint by construction) + Task 6/9 checkpoint evidence; §4 invariants → Tasks 5–7 protection tasks; §5 ACs → AC1–2 Task 2, AC3–7 Task 3, AC8 Task 5, AC9 Task 6, AC10 Task 7, AC11–13 Task 8, AC14–15 Task 3 tests + Task 9, AC16 Task 6, AC17 by construction (no targets in budget inputs — assert in Task 3: budget function takes only local waste state). §6 order → task order. §7 freedom → Task 3 constants + Task 8 decision rule. §8 stops → Tasks 6/8 tension returns, OWNER DECISION triggers noted (new field/genes/restaging → stop, none planned). §9 → Task 9.
2. **Step scan:** each step names one action + checkable result; fixed inline (no TBDs).
3. **Type consistency:** `cellBudget(wasteAmount: number): number`, intent `{orgId: number, cell: number, request: number}`, actuals in per-organism commit; assay names unique across files.
4. **Review Focus:** all five lines have owning-task tests (listed per line).
5. **Proportion:** plan is shorter than the handoff and carries decisions (budget equation, VMAX/KM seeding rule, file/task boundaries) an implementer could not make alone.
