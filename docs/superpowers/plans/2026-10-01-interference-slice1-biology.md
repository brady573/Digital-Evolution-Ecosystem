# Environment-Mediated Interference Competition — Slice 1 Biology Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Slice 1 biological machinery — evolvable costly secretion, independently evolvable costly resistance, and a local inhibitor field that suppresses resource acquisition — inside sim-core, with accounting, persistence, validation, and ecological characterization, and nothing player-facing.

**Architecture:** Mirror the Slice 2 waste-economy precedent exactly: a spatial field class owned by the resource system, organism physiology in the `S.step` loop (capability vs opportunity split), per-lineage interval deltas plus field-level accounting identities, an engine-version bump with an outer checkpoint-schema bump, and a blocking mechanism test unit plus a manual survey. No new packages, no new abstractions for future mechanics.

**Tech Stack:** TypeScript, Node 24, pnpm 12.5.1, `tsx` validation runners, deterministic `Float32Array` field grids, GitHub Actions CI shards routed by `tools/validation/manifest.ts`.

**Spec:** Slice 1 Coding Agent Handoff (Google Doc: "Digital Evolution — Environment-Mediated Interference Competition — Slice 1 Biology Foundation — Coding Agent Handoff", status ACTIVE, Owner authority, checkpoint `main @ 5bd2851`, app 0.31.0 / engine 0.22.0 / checkpoint schema 0.4). Design authorities: Living Design Document, Product Roadmap, Recovered Game Design Backlog, Next Mechanic Design Handoff, DED-01, DED-03, DED-04. The plan argues from the handoff; executors read both.

## Global Constraints

- Slice 1 is biology only. No player-facing interference UI, History story detection, new catalyst choices, direct organism targeting, predation, parasitism, or generic combat framework.
- sim-core owns ALL interference semantics. sim-runtime may carry/checkpoint/restore/fork/expose the state but never compute interference biology. sim-analysis: compatibility fixes only if contract shapes force them; no arms-race detection or story language. sim-decisions: untouched. Explorer: compile-safe adaptation only if unavoidable. `legacy/prototype`: never edited.
- Engine version changes 0.22.0 → 0.23.0 (exact value fixed here). Outer checkpoint schema changes 0.4 → 0.5 (exact value fixed here). No migration of 0.22.0 worlds: old saves are refused by the engine-version gate, never defaulted into the new biology.
- Secretion and resistance are independent, both costly, no producer immunity. Inhibitor is not Waste, not food, not an energy source. Suppression acts only through reduced acquisition; no direct damage, death, mutation, or reproduction effects. Dormant organisms: no secretion, no acquisition, no resistance cost; field evolves normally.
- Population abundance, dominance, coexistence, extinction, secretion/resistance success stay emergent. No target frequencies, no drama scores, no desired winners in biology or tests.
- Same engine version + resolved config + seed + command sequence reproduces the same run. Diffusion is redistribution, never net creation/destruction. Saturation/clamp loss is explicitly accounted, never silent.
- `pnpm verify` plus the manifest-routed CI shards are the completion contract; the handoff's focused checks are a floor. Never weaken tests or gates to make a change pass.

## Review Focus

1. Two new traits add two `rMut` draws per birth, shifting every downstream random draw — a zero-interference world still replays differently from 0.22.0. Expectation: versioned re-pin (Slice 2 precedent), plus a test that a zero-trait world is internally deterministic across sessions. Pinned in Task 0 and Task 5.
2. A saturated cell silently eating deposited inhibitor would fake the mass identity. Expectation: every undeposited unit lands in an explicit `saturated_i`/`discarded` counter that the accounting identity names. Pinned in Task 2 and Task 5.
3. Scaling the gain after `consume()` removes stock would destroy resource while pretending to spare it. Expectation: suppression scales the take before removal, so suppressed mass never leaves the stock. Pinned in Task 3 and Task 5.
4. A 0.4/0.22.0 save restored on the new build must fail loudly, never boot a traitless world into interference biology. Expectation: engine-version refusal with the versions named; no defaulting rules for interference state. Pinned in Task 4 and Task 5.
5. Diffusion clamping that creates or destroys mass would hide in field totals. Expectation: clamp adjustment is accumulated and the accounting identity closes to ~0 residual against an independent stock sum. Pinned in Task 2 and Task 5.

---

## File Structure

- Modify `packages/sim-core/src/engine.ts` — traits `secretion`/`resistance`; `InhibitorField` class; `RS.inhibitor` integration; `S.step` physiology (secrete, resist, suppress); lineage/interval accounting; `metrics()`/`observerSnapshot()` means; `out()` export traits; checkpoint encode/decode tag.
- Modify `packages/sim-core/src/version.ts` — `ENGINE_VERSION = "0.23.0"`.
- Modify `packages/contracts/src/index.ts` — schema `"0.5"` (union, `SUPPORTED_SCHEMAS`, `UniverseCheckpoint`, new `UniverseCheckpointV04`, `PRE_CURRENT_SCHEMAS`), organism/inhibitor validation, `IntervalLineageFlow`/`IntervalFlowFacts` interference fields, `RenderOrganism` additive traits.
- Modify `packages/sim-runtime/src/session.ts` — snapshot organism mapping for the two new traits only if `RenderOrganism` gains them; verify clone/restore/fork need no other change.
- Create `tools/validation/interference.ts` — blocking mechanism/accounting/persistence tests. Create `tools/validation/interference-survey.ts` — manual multi-seed characterization + performance evidence.
- Modify `tools/validation/manifest.ts`, `package.json` — register both units per AGENTS.md (script + unit + group + `validation:check`).
- Supporting: `packages/sim-core/src/index.ts` exports only if tests need them; `tools/validation/flows.ts`-style helpers are reused, not duplicated.

**Fixed names (every task uses exactly these; renaming one renames all):** trait keys `secretion` (code `in`), `resistance` (code `re`); organism fields `o.in`, `o.re`; field class `InhibitorField`; `RS` member `rs.inhibitor`; checkpoint tag `"inhibitor-field"`; interval/lineage fields `secreted_i`, `decayed_i`, `saturated_i`, `secretion_energy`, `resistance_energy`, `exposure_i`, `suppressed_a/b/c` (mass), `suppressed_ea/eb/ec` (energy). Per-lineage decay is NOT attributed (decay acts on mixed field mass); decay lives in totals and field accounting only.

---

### Task 0: Parity mechanism and re-pin procedure (investigation)

**Files:** Read-only: `tools/validation/parity.ts`, `tools/validation/checkpoint-historical-boundary.ts`, Slice 2 commit `af9ad23`, `tools/validation/broad-ecology-022*.ts`.

**Interfaces:** Consumes: nothing. Produces: a findings note appended to this plan file (decisions later tasks depend on).

- [ ] **Step 1: Determine how `test:migration` compares against the frozen baselines** (exact comparison, pinned seeds/configs, tolerance), and how `af9ad23` re-pinned gates for engine 0.22.0 without violating the no-weakening rule.
- [ ] **Step 2: Determine the RNG-stream impact of adding two `T` traits** (two extra `rMut` draws per birth in `mut()`/`child()`), and whether a zero-trait world can replay 0.22.0 bit-identically or must be re-pinned as a new versioned baseline.
- [ ] **Step 3: Record the decision** — which baselines get re-pinned for 0.23.0, by what maintained procedure, and what proves the re-pin carries only the interference delta. Append under `## Task 0 findings` in this plan file. No code change in this task.

### Task 1: Two independent inheritable traits

**Files:** Modify `packages/sim-core/src/engine.ts` (`T`, `MUTATION_NAMES`, `STUDY_TRAITS`, founder init, `child()`, `Organism` interface). Test: extend the new `tools/validation/interference.ts` (created here with just this task's tests; later tasks append).

**Interfaces:** Consumes: Task 0 findings (founder-value precedent). Produces: `o.in`, `o.re` on every organism; mutation through the maintained `mut()` path; `TRAIT_DEFINITIONS` entries `{secretion: ['in', 0, 1.5, ...], resistance: ['re', 0, 1.5, ...]}`.

- [ ] **Step 1: Write the failing tests** in `tools/validation/interference.ts`: `testTwoIndependentTraitsExist` (both traits in `TRAIT_DEFINITIONS` with range `[0, 1.5]`, present on founders and newborns, mutate independently — high `in` does not imply high `re` across a sampled population), `testTraitsParticipateInMutationSystem` (a birth cohort shows both traits varying without coupling).
- [ ] **Step 2: Run to verify they fail.** Run: `npx tsx tools/validation/interference.ts`. Expected: FAIL (no such traits).
- [ ] **Step 3: Implement.** Add both traits to `T` with codes `in`/`re`, range `[0, 1.5]`, labels; names in `MUTATION_NAMES`; keys in `STUDY_TRAITS`; founder init following the `to`/`cu` precedent (`Q(.05+.25*H01(...),0,1.5)` with fresh salts); `child()` inheritance through the generic `mut()` loop (no special-casing); `Organism` interface fields `in: number; re: number`.
- [ ] **Step 4: Run to verify they pass.** Run: `npx tsx tools/validation/interference.ts`. Expected: PASS. Also run: `pnpm typecheck`. Expected: 0 errors.
- [ ] **Step 5: Commit.** `git add packages/sim-core/src/engine.ts tools/validation/interference.ts && git commit -m "feat(sim-core): independent secretion and resistance traits"`

### Task 2: Inhibitor spatial field with closed accounting

**Files:** Modify `packages/sim-core/src/engine.ts` (`InhibitorField`, `RS` construction/step/clone/export, checkpoint encode/decode). Test: append to `tools/validation/interference.ts`.

**Interfaces:** Consumes: Task 1 (nothing directly; field is organism-independent). Produces: `rs.inhibitor` with `deposit/fractionAt/amountAt/stepInhibitor/totals/accounting/clone/export`; checkpoint tag `"inhibitor-field"`.

- [ ] **Step 1: Write the failing tests**: `testFieldDepositionDiffusionDecay` (deposit N at a cell; after decay-only ticks stock falls by the decay identity; a neighbor cell gains mass only via diffusion; total produced − decayed − saturated-loss − final stock residual ≈ 0 against an independent stock sum), `testSaturationLossIsExplicit` (overfill one cell; undeposited mass appears in `saturated_i`/`discarded`, never vanishes), `testDiffusionConservesMass` (diffuse a spike; total stock change equals clamp adjustment only).
- [ ] **Step 2: Run to verify they fail.** Run: `npx tsx tools/validation/interference.ts`. Expected: FAIL (`rs.inhibitor` undefined).
- [ ] **Step 3: Implement `InhibitorField` in `packages/sim-core/src/engine.ts`.** Model on `WasteField`: `Float32Array` stock/cap on the 60×60 toroidal grid, per-cell cap from `totalCapTarget * INHIBITOR_CAP_FRACTION / size`; `deposit` returns added mass and counts surplus in `discarded` (+ interval `saturated_i`); bucketed exponential decay on the `updateStride` cadence writing interval `decayed_i`; `diffuseOne` every 100 ticks with clamp adjustment accumulated; `accounting()` with an identity string naming produced/deposited/decayed/clamp/saturated-loss/final/residual. Wire into `RS`: construct in the constructor, step it in `RS.step`, include in `RS.export()` under `inhibitor`, handle in `RS.clone()` with an explicit `instanceof InhibitorField` branch (the current clone only special-cases `WasteField` — missing this silently shares field state across forks). Checkpoint codec: add `"inhibitor-field"` to encode/decode alongside `"waste-field"`. Diffusion/decay constants are evidence-led tuning; anchor initial values to the `WASTE_*` scales and document them in the code comment.
- [ ] **Step 4: Run to verify they pass.** Run: `npx tsx tools/validation/interference.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add packages/sim-core/src/engine.ts tools/validation/interference.ts && git commit -m "feat(sim-core): local inhibitor field with closed mass accounting"`

### Task 3: Secretion cost, resistance cost, exposure, and acquisition suppression

**Files:** Modify `packages/sim-core/src/engine.ts` (`S.step` physiology, `consume` suppression parameter, `lineageCredit`, `LineageDelta`, `readIntervalFlows`, `metrics()`, `observerSnapshot()`). Test: append to `tools/validation/interference.ts`.

**Interfaces:** Consumes: Tasks 1–2 (`o.in`/`o.re`, `rs.inhibitor`). Produces: per-tick physiology with exact accounting in interval + lineage flows and snapshot means.

- [ ] **Step 1: Write the failing tests**: `testSecretionCostsAndDeposits` (an organism with `in > 0` loses energy exactly equal to the recorded `secretion_energy` and the field gains exactly the recorded `secreted_i`; zero-energy organisms deposit nothing — no free production), `testNoProducerImmunity` (a secretor at its own cell is exposed under the same rule as a non-secretor placed there), `testSuppressionAppliesToABC` (with fixed exposure, realized A, B, and C takes fall under one coherent rule; suppressed mass stays in stock — stock + consumed reconciles), `testSuppressionMonotonicBounded` (greater effective exposure never improves acquisition; factor stays in `(0, 1]`, equals 1 at zero exposure), `testResistanceMitigatesButCosts` (higher `re` lowers effective exposure at same field concentration; `resistance_energy > 0` even in a clean field while active), `testDormancyInteraction` (dormant organisms secrete nothing, acquire nothing, pay no resistance cost; field keeps evolving; exposure resumes on wake).
- [ ] **Step 2: Run to verify they fail.** Run: `npx tsx tools/validation/interference.ts`. Expected: FAIL.
- [ ] **Step 3: Implement physiology in `S.step`, placed with the waste-economy block (active organisms only; dormant `continue` above already excludes them).** Order per organism per tick: (a) resistance standing cost `RES_STANDING * Q(o.re,0,1.5)` subtracted with pressure scaling, credited to `resistance_energy`; (b) secretion: desired rate from `Q(o.in,0,1.5)`, realized = min(desired, affordable-for), energy cost strictly increasing in realized, deposit realized via `rs.inhibitor.deposit`, credit `secreted_i` + `secretion_energy`; an organism that cannot pay deposits nothing; (c) exposure: `rs.inhibitor.fractionAt(o.x,o.y)`, effective exposure after resistance with efficacy strictly below 1 (resistance mitigates, never immunizes; secretion grants no exemption — same code path for every organism); (d) suppression factor `f ∈ (0,1]`, monotonic non-increasing in effective exposure, `f = 1` at zero exposure — thread it into acquisition as `consume(o, interval, f)` (default `1`, so the call shape without interference is untouched) scaling the take BEFORE stock removal; record `suppressed_a/b/c` mass and `suppressed_ea/eb/ec` energy as full-take minus actual-take, owned entirely by the biological layer. Downstream byproduct/waste from a suppressed take scale naturally with the actual take. Credit per-lineage `secreted_i/secretion_energy/resistance_energy/exposure_i/suppressed_*` via `lineageCredit`; extend `LineageDelta` and `readIntervalFlows` (lineages + totals) with exactly the fixed names; decayed/saturated-loss live in totals + field accounting only. Add snapshot means (`secretion_mean`, `resistance_mean`, inhibitor fraction/exposed share) to `metrics()`/`observerSnapshot()` following the `tolerance_mean` pattern; no detector or story changes. Add `secretion`/`resistance` to `out()` living-creature traits.
- [ ] **Step 4: Run to verify they pass.** Run: `npx tsx tools/validation/interference.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add packages/sim-core/src/engine.ts tools/validation/interference.ts && git commit -m "feat(sim-core): costly secretion, costly resistance, and acquisition suppression"`

### Task 4: Versioning, checkpoint schema 0.5, and persistence contract

**Files:** Modify `packages/sim-core/src/version.ts`, `packages/contracts/src/index.ts`, `packages/sim-runtime/src/session.ts` (snapshot mapping only). Test: append to `tools/validation/interference.ts`.

**Interfaces:** Consumes: Tasks 1–3 (state shape to persist). Produces: engine `0.23.0`, outer schema `0.5`, exact-refusal of older saves, round-trip/fork equivalence.

- [ ] **Step 1: Write the failing tests**: `testCheckpointRoundTripWithInterference` (a world with nonzero `in`/`re` and nonzero field stock restores field, traits, and accounting exactly), `testRestoredContinuationMatchesUninterrupted` (restore at tick T, advance N; identical to uninterrupted T+N in organisms, field stock, and interval flows), `testMatchedForkExactAtFork` (fork before branch-specific action is byte/behavior equivalent — this also covers the `RS.clone` inhibitor branch from Task 3), `testOldSavesRefusedExplicitly` (a 0.4/0.22.0 payload refuses with both versions named; no interference defaulting rules exist in `CHECKPOINT_MIGRATION_RULES`).
- [ ] **Step 2: Run to verify they fail.** Run: `npx tsx tools/validation/interference.ts`. Expected: FAIL (version/schema mismatch).
- [ ] **Step 3: Implement.** `ENGINE_VERSION = "0.23.0"`. Contracts: add `"0.5"` to `CheckpointSchemaVersion` and `SUPPORTED_SCHEMAS` (CURRENT_SCHEMA derives; `CHECKPOINT_SCHEMA_VERSION` in session derives); `UniverseCheckpoint.checkpointSchemaVersion` becomes `"0.5"`; add `UniverseCheckpointV04` documenting the 0.4 shape and include it in `SupportedUniverseCheckpoint`; extend `PRE_CURRENT_SCHEMAS` to `["0.1","0.2","0.3","0.4"]`. Validation: `validateOrganism` requires finite `in`/`re` when `source === "0.5"` (same pattern as `pc` at 0.4; older schemas keep their exact historical rejections); add `validateInhibitorField` (mirroring `validateWasteField`) required at `props.resources.props.inhibitor` when `source === "0.5"`; add `"inhibitor-field"` to `CHECKPOINT_TAGS`. Record NO migration rules for interference state: 0.4 saves carry engine 0.22.0 and the engine-version gate refuses them before any field default could apply — inventing trait/field defaults would change those worlds' biology, which the handoff sends back to the Owner. `IntervalLineageFlow`/`IntervalFlowFacts` gain the Task 3 fields (both lineages and totals; totals additionally `inhibitorDecayed`, `inhibitorSaturatedLoss`). `RenderOrganism` gains required `secretion`/`resistance`; `session.ts` maps them from `o.in`/`o.re` (compile-safe additive change; explorer reads nothing new). Verify `clone()`/`checkpoint()`/`restore()` need no other change (generic paths). Check `tools/validation/provenance.ts` and export-shape assertions: add `out()` trait fields to the export only if no pinned shape forbids it; bump `EXPORT_FORMAT_VERSION` only if a check requires it.
- [ ] **Step 4: Run to verify they pass.** Run: `npx tsx tools/validation/interference.ts`. Expected: PASS. Also run: `pnpm typecheck`. Expected: 0 errors.
- [ ] **Step 5: Commit.** `git add packages/sim-core/src/version.ts packages/contracts/src/index.ts packages/sim-runtime/src/session.ts tools/validation/interference.ts && git commit -m "feat(checkpoint): engine 0.23.0 with schema 0.5 interference persistence"`

### Task 5: Validation registration and accounting cross-checks

**Files:** Modify `tools/validation/interference.ts` (cross-check tests), `tools/validation/manifest.ts`, `package.json`. Test: the tests themselves.

**Interfaces:** Consumes: Tasks 1–4 (behavior to prove). Produces: registered blocking unit `interference` + placement in `simulation` and one `ci-*` shard, all asserted by `validation:check`.

- [ ] **Step 1: Write the failing cross-check tests** (append): `testZeroInterferenceBaseline` (Task 0 decision implemented: zero-trait worlds behave as specified — deterministic across sessions and, per the Task 0 ruling, either bit-identical to 0.22.0 or re-pinned with the delta proven), `testMassIdentityCloses` (produced − decayed − saturated-loss − final stock ≈ 0 against an independent stock sum, per Review Focus 2/5), `testReportedSuppressionMatchesBiology` (reported `suppressed_*` equals full-take minus actual-take recomputed from stock deltas; any untracked clamp fails the test), `testDiffusionIsRedistribution` (diffusion-only evolution changes no total except clamp adjustment).
- [ ] **Step 2: Run to verify they fail.** Run: `npx tsx tools/validation/interference.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the tests; fix only genuine biology bugs they expose** (no test-weakening; an accounting gap is a Task 2/3 defect, fix it there and note it). Register per AGENTS.md: `package.json` script `test:interference`; manifest unit `id: "interference"`, `cls: "deterministic"`, `enforcement: "blocking"`, `mergeGate: true`, domains `withApparatus("contracts", "sim-core", "sim-runtime")`, one-line claim; add to `simulation` group and exactly one `ci-*` shard (default `ci-sim-c` beside niche/ecology; move only on measured cost); run `pnpm validation:check`. Expected: PASS (36→37 units or as counted).
- [ ] **Step 4: Run the focused set.** Run: `npx tsx tools/validation/interference.ts`, `pnpm typecheck`, `pnpm validation:check`, `pnpm test:migration`, `pnpm test:ecology`. Expected: all PASS (migration under the Task 0 re-pin procedure).
- [ ] **Step 5: Commit.** `git add tools/validation/interference.ts tools/validation/manifest.ts package.json && git commit -m "test(validation): interference blocking unit with accounting cross-checks"`

### Task 6: Bounded ecological characterization and performance evidence

**Files:** Create `tools/validation/interference-survey.ts`; modify `tools/validation/manifest.ts`, `package.json` (manual survey unit). Output: retained artifact + reported numbers (not committed data).

**Interfaces:** Consumes: Tasks 1–5 (mechanism proven; horizons characterized here). Produces: AC13/AC14 evidence with seed/config/horizon identity and reported failures.

- [ ] **Step 1: Write the survey** reusing `ecology.ts` regimes/seeds/horizons where practical: multiple seeds × more than one environment/configuration; per run record secretion prevalence trajectory, resistance prevalence trajectory, exposure levels, acquisition suppression, and outcome (spread / fail-or-recede / coexistence / extinction); include the `settle()` keep-watching pattern so runs reach horizon; assert nothing about frequency — the survey reports, including runs where interference never establishes. Include a performance probe: wall-time per tick with interference active vs the same workload without, at maintained simulation workloads.
- [ ] **Step 2: Run it to verify it executes and reports.** Run: `npx tsx tools/validation/interference-survey.ts`. Expected: completes with a per-run table showing identity (engine/config/seed/horizon) and at least one run each where secretion is advantageous, secretion fails/recedes on cost, and resistance counter-advantages under exposure — or, if any cannot be demonstrated after reasonable evidence-led tuning, STOP and return EVIDENCE NEEDED/DESIGN TENSION instead of forcing the story (handoff §10).
- [ ] **Step 3: Tune constants only on evidence** (document every value and its rationale; no target prevalence), then register the manual unit (`cls: "scientific"`, `enforcement: "manual"`, `mergeGate: false`, artifact retained) in the `survey` group per AGENTS.md and re-run `pnpm validation:check`. Expected: PASS.
- [ ] **Step 4: Run to verify registration holds.** Run: `pnpm validation:check && pnpm verify:fast`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add tools/validation/interference-survey.ts tools/validation/manifest.ts package.json && git commit -m "test(survey): bounded interference characterization with success and failure cases"`

### Task 7: Full gates, PR, and return package

**Files:** None (verification + PR body). Test: the repository contract.

**Interfaces:** Consumes: Tasks 0–6. Produces: green CI on the pushed head, one PR, the handoff §14 return package.

- [ ] **Step 1: Run the narrow local gates.** Run: `pnpm verify:fast`, `pnpm test:flows`, `pnpm test:niche`, `pnpm test:aftermath`, `pnpm test:catalysts`, `pnpm test:decisions`. Expected: all PASS. (Full `pnpm verify` and browser/evidence/survey go to CI per AGENTS.md — the device is the authoring environment, not the evidence environment.)
- [ ] **Step 2: Push the branch and open the PR** (`feat/interference-s1-biology`, base `main`) using `.github/pull_request_template.md`. Expected: PR URL.
- [ ] **Step 3: Read CI on the exact pushed head** (`gh pr checks`). Expected: every blocking unit green on that SHA; no reusing a prior head's green as evidence.
- [ ] **Step 4: Assemble the §14 return package in the PR body/summary**: implemented semantics; changed file inventory; engine 0.23.0 + schema 0.5 decisions (including the no-migration ruling); tuning constants + rationale; focused + routed CI status; multi-seed characterization with identities and failure cases; performance evidence; limitations/tensions/unsupported claims; deviations (implementation freedom vs design-significant — expect none of the latter); smallest-next-Slice-2 recommendation (read-only interpretation + legibility).
- [ ] **Step 5: Stop.** Coding completion is not design acceptance; await the Design Partner classification (ALIGNED / TENSION / EVIDENCE NEEDED / OWNER DECISION). No merge without authorization.

---

## Self-Review

1. **Spec coverage:** §4.1 Task 3 (secretion cost/deposit, distinct from Waste, dormancy); §4.2 Tasks 1+3 (independent resistance, standing cost, no immunity); §4.3 Task 2 (distinct local diffusing decaying field, accountable loss); §4.4 Task 3 (universal exposure, A/B/C suppression through the energy economy, monotonic bounded, no kill threshold); §4.5 Task 3 (dormancy); §5 Tasks 3+5 (lineage/total accounting, diffusion redistribution, biology-owned counterfactual); §6 Task 4 (persistence, determinism, versioning, no 0.22 migration); §7 architecture + task boundaries; §8 invariants as test negatives (no immunity test, no-damage via energy-economy-only assertion, Waste-distinctness via separate field/accounting); §9 AC1–AC14 (AC12: no catalyst/analysis/UI — enforced by file scope; AC13/AC14 Task 6); §10 mechanism list all named in Tasks 1–5; §12 return-triggers avoided by construction (each has a task or an explicit refusal with rationale).
2. **Step scan:** each step names one artifact (test names, exact commands, exact version literals, exact field names) — no TBDs, no "appropriate validation".
3. **Type consistency:** `o.in`/`o.re`, `rs.inhibitor`, `"inhibitor-field"`, interval names, and the 0.23.0/0.5 literals are identical across tasks.
4. **Review Focus:** all five lines carry owning-task tests.
5. **Proportion:** plan decides names, placement, versions, and test lists; bodies (curves, constants, numerics) stay with the implementer under stated constraints.

## Task 0 findings

Test:migration (`tsx tools/validation/parity.ts`; manifest unit `migration`,
invariant/blocking/merge-gate) proves EXACT same-version determinism: string
equality of the full serialized state (counters, all five RNG states, resource
stocks plus waste stock, every organism incl. tolerance/cleanup) — zero
tolerance — on pinned seeds 821947219 / 3543950664 (balanced, 2000 ticks) and
912367481 (harsh, 1500), checkpoints {1,251,502,1000,end}, plus RNG parity
(0x1234abcd x 10k), clone-continuation, inspection-isolation, checkpoint and
session parity. Decision: af9ad23 retired the legacy-vs-migrated trajectory
gate with Owner approval (2026-09-26) because 0.22 waste biology intentionally
breaks cross-version identity, replacing it with widened same-version coverage
and per-pin re-pins with causal comments — no weakening. Two unconditional
T-traits cost >= 2 extra rMut draws per child() (one mr-gate draw each, last in
iteration order; rMove is a separate stream; founders use H01 hash, no
stream), so rMut shifts from the second birth on and 0.22.0 replay is
impossible by design: 0.23.0 MUST re-pin as a new versioned baseline (bump
ENGINE_VERSION, widen parityState with the new traits + field stock, keep
seeds/ticks, re-pin moved ticks with causal comments, add a survey artifact,
leave legacy/ untouched). Proof the re-pin carries only the interference
delta: migration green at full string-exactness on the widened state, a diff
limited to expected-tick literals + new-field coverage with per-pin causes,
and survey characterization with no retunes; run named checks PLUS pnpm
verify. Note: manifest:199-200 still words migration as legacy-baseline
reproduction — stale since af9ad23, update with the re-pin.
