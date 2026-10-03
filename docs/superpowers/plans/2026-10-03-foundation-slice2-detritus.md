# Foundation Slice 2 (Detritus / Recycling) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn biological death into a local detritus → recycler-use-or-mineralization → renewed A/B opportunity pathway, with a distinct evolvable recycler capability, closed accounting, and assay proof for AC1–AC20.

**Architecture:** Mirror the Slice 2 waste-field precedent exactly: a new `DetritusField` spatial substance owned by `RS`, a new process behind the existing `BioProcess` contract (capability from one new inherited trait, opportunity from local field presence), death-hook deposition into a next-tick pending buffer, per-tick deterministic mineralization into A/B via the existing capped `deposit`, and white-box fork-only economy switches (never `EngineConfig`). No new RNG draws outside the trait-mutation stream; no sensing/behavior change.

**Tech Stack:** TypeScript, Node 24, pnpm 12.5.1, tsx validation harnesses, GitHub Actions (CI-only long runs).

**Spec:** Issue #97 comment #5962270034 (`https://github.com/brady573/Digital-Evolution-Ecosystem/issues/97#issuecomment-5962270034`; local copy at `/tmp/opencode/slice2-handoff.md`, untracked). The Drive design-authority doc was inaccessible (Drive MCP requires login); the GitHub handoff comment is the spec of record. Baseline: `main @ 21540c0`, engine 0.24.0.

## Global Constraints

- `sim-core` stays the biological authority: no React/DOM/workers/storage/`requestAnimationFrame`/wall-clock in `packages/sim-core`.
- `sim-analysis` stays read-only: new facts only, no new player-facing narrative record kinds.
- `sim-decisions` untouched: detritus creates no decision opportunity.
- Same engine version + resolved config + seed + command sequence stays exact (new version 0.25.0; trajectories WILL move — re-pin, never force).
- No `legacy/prototype` edits; no weakened gates; no committed `dist/`/`node_modules`.
- No new `EngineConfig` surface: economy switches are fork-only white-box overrides (enabledWaste precedent).
- Long validation/surveys run on CI only; device runs stay short and bounded (`verify:fast`, single suites).
- `gh pr edit --body` is broken repo-wide (Projects-classic sunset); use `gh pr comment`. The survey workflow needs BOTH `--ref <branch>` AND `-f ref=<branch> -f out=<path>` or it surveys a stale branch (Slice 1 lesson).

## Review Focus

- Extinct/empty worlds: detritus field with zero population must mineralize, close accounting, and never crash on empty loops — test in the assay that owns the code.
- Saturated cells: mass-death overflow must count surplus as discarded, never duplicate it into A/B — test in the assay that owns the code.
- Checkpoint with an unmerged pending buffer: pending must persist and merge exactly once next tick — test in the assay that owns the code.
- Economy-disabled forks: with deposition/consumption off, all detritus flows read exactly zero while identities still close — test in the assay that owns the code.
- Trait-mutation RNG shift: the new trait adds `rMut` draws per birth, so every historical trajectory moves; pins are re-established from evidence, never forced — enforced by the re-pin task's discipline rules.

---

## File Structure

- `packages/contracts/src/index.ts` — add detritus flow-fact/accounting fields (types only).
- `packages/sim-core/src/engine.ts` — `DetritusField` class; `RS.detritus` + clone/export/codec branches; `du` trait plumbing; death-hook deposition + pending merge; `DETRITUS_PROCESS` + `consume()` candidacy + tradeoff costs; mineralization; lineage/interval/lifetime facts; `detritivore` role; metrics/pack/export blocks; version bump.
- `packages/sim-core/src/version.ts` — `ENGINE_VERSION = "0.25.0"`.
- `packages/sim-analysis/src/index.ts` — frame facts only (`detritus_fraction`, detritus interval facts pass-through). No new record kinds.
- `tools/validation/detritus.ts` — assays A–K + survey-artifact gate (new file).
- `tools/validation/detritus-survey.ts` — assay L survey script (new file, manual).
- `.github/workflows/detritus-survey-025.yml` — survey workflow mirroring `niche-survey-023.yml` (correct `ref`/`out` inputs).
- `testdata/detritus-survey-0.25.json` — retained CI artifact (committed).
- `tools/validation/manifest.ts` — new `detritus` unit in `ci-sim-c`; baseline from CI telemetry.
- `package.json` — `test:detritus`, `test:detritus-survey` scripts.
- Existing suites (`decisions/dependency/niche/catalysts/flows/time-controls/…`) — re-pins only, Slice 1 discipline.

## Starting calibration (evidence-adjustable by assays, never to hit a frequency)

- Trait `detritus_use` (`du`), range `[0, 1.5]`, additive mutation, founder `Q(.04+.28*H01(seed,id,65),0,1.5)`, H01 salt 65 (next free after bu17/dr29/to41/cu53).
- Access `duAccess = Q(du,0,1.5)/1.5` (linear, mirrors cleanup); role `detritivore` iff `gd_share >= .15 && duAccess >= .35` where `gd_share = gd/(ga+gb+gc+gd)` (mirrors byproduct_scavenger).
- `DETRITUS_YIELD = 7` (below C's 9, well below primary 15); `DETRITUS_UPTAKE = .16` with `(.55+.45*conc)` scaling (mirrors nutrient uptake); `DU_STANDING = .0015`, `DU_ACTIVE = .6` (mirror cleanup costs); standing charged whenever `du > 0` (the tradeoff's teeth in poor conditions, AC10).
- Body proxy `min(30, 2 + .05*(ga+gb+gc))` (floor for newborns, age-weighted carcasses, hard bound).
- Field cap absolute per cell `DETRITUS_CELL_CAP=400` (holds a mass-mortality cluster; overflow stays pending and retries — a fractional share of nutrient capacity saturated on the first carcass and was rejected by assay B).
- Mineralization `.0002`/tick exponential per cell, allocation proportional to A/B room, remainder stays detritus. (Started at .001; assays C/D showed the public mineralization channel dwarfing private use, so the rate was cut 5×.)
- Fallback-food preference `DETRITUS_PREFERENCE=.5`: detritus scores below equal-mass A/B/C so capable organisms eat primaries first (fixed ranking, not behavior). Without it, abundant detritus outcompeted richer foods and recyclers subsidized free-riders.
- No detritus diffusion (death clusters stay local for AC13; cheaper). Revisit only on assay evidence.

---

### Task 1: Contracts detritus types

**Files:**
- Modify: `packages/contracts/src/index.ts` (flow-fact interfaces)
- Test: `pnpm exec tsx tools/validation/architecture.ts` (typecheck-level; full gate in Task 9)

**Interfaces:**
- Consumes: existing `IntervalRates`, `IntervalLineageFlow`, `IntervalFlowFacts`, `LineageFlow`, `FlowFacts` shapes.
- Produces: `detritusDeposited, detritusConsumed, energyDetritus, detritusMineralized, mineralizedA, mineralizedB, detritusExec` on interval totals + per-lineage flows; `consumedDetritus` (md counts), `energyDetritus` (gd) on lifetime flows. Names mirror the waste fields exactly.

- [ ] **Step 1: Add the fields** to `IntervalRates`, `IntervalLineageFlow`, `IntervalFlowFacts.totals`, `LineageFlow`, `FlowFacts.totals` as `readonly number`, each with a one-line doc comment stating units (mass vs event counts, mirroring the waste comments).
- [ ] **Step 2: Run typecheck** — Run: `pnpm exec tsc --noEmit -p packages/contracts` (or repo typecheck). Expected: PASS (new fields are additive; engine fills them in Task 5).
- [ ] **Step 3: Commit** — `git add packages/contracts/src/index.ts && git commit -m "feat(contracts): detritus flow-fact fields (Slice 2)"`

### Task 2: DetritusField + RS integration + checkpoint codec

**Files:**
- Modify: `packages/sim-core/src/engine.ts` (new `DetritusField` class after `WasteField`; `RS` constructor/`clone`/`export`; checkpoint encode/decode tags)
- Test: Task 6 assay F exercises it; this task's check is structural.

**Interfaces:**
- Consumes: `WasteField` pattern (deposit/removeAt/diffuseOne/stepWaste/totals/accounting/clone/export), `FIELD_N/CELL/CELLS`, `RS.idx`.
- Produces: `RS.detritus: DetritusField`; `enabledDetritus`-style fork switches (see below); `detritus-field` checkpoint tag; `DetritusField.accounting()` identity: `deposited - consumed - mineralized + clampAdj = final + residual`, plus `saturated_loss (discarded)` and receiving lines `mineralized_a/b`.

- [ ] **Step 1: Write `DetritusField`** mirroring `WasteField` (lines 406–469): `stock/cap: Float32Array`, `pending: Float32Array` (next-tick buffer, checkpointed like stock), counters `deposited/consumed/mineralized/mineralizedA/mineralizedB/discarded/clampAdj`, `deposit()` with cap-room + discard counting, `takeAt()` (consume read), `mineralizeInto(rs, interval)` (rate `.001`, proportional-to-A/B-room allocation via existing capped `rs.deposit(0/1)`, remainder stays), `stepDetritus(t, interval)` called from `RS.step`, `totals()`, `accounting()`, `clone()`, `export()`. No diffusion. `RS` gains `detritus` construction, `detritusDepositionEnabled = true` + `detritusConsumptionEnabled = true` fork-only switches (default true, never `EngineConfig`), `RS.clone()` `instanceof DetritusField` branch, checkpoint `detritus-field` encode/decode tags (mirror `waste-field`, engine.ts lines 754/771).
- [ ] **Step 2: Verify structure** — Run: `pnpm exec tsx -e "import('./packages/sim-core/src/engine.ts').then(m => console.log(typeof m))"`-style smoke or repo typecheck. Expected: imports clean, no type errors.
- [ ] **Step 3: Commit** — `git add packages/sim-core/src/engine.ts && git commit -m "feat(sim-core): DetritusField with pending buffer, mineralization, checkpoint codec (Slice 2)"`

### Task 3: du trait plumbing (no behavior yet)

**Files:**
- Modify: `packages/sim-core/src/engine.ts` (`T`, `STUDY_TRAITS`, `MUTATION_NAMES`, founder init line ~567, `child()` line ~573, `mut()` additive list line ~572, `out()` strings/trait blocks)
- Test: metrics exposes `traits.detritus_use`; existing suites unaffected in behavior (trait is inert until Task 4).

**Interfaces:**
- Consumes: `T` record shape `[short, lo, hi, label]`.
- Produces: organisms carry `du`; `child()` mutates/inherits it; `metrics().traits.detritus_use` populated.

- [ ] **Step 1: Add trait** — `detritus_use: ['du', 0, 1.5, 'Detritus use']` in `T`; append to `STUDY_TRAITS`; `MUTATION_NAMES.detritus_use = 'detritus-use'`; founder `du=Q(.04+.28*H01(c.seed,id,65),0,1.5)`; `child()` `q.du` via existing `for n in T` loop (verify it flows, no special-case needed); add `'detritus_use'` to the `mut()` additive list; `out()`: `ten evolvable traits` → `eleven`, stage string gains detritus, `living_creatures` traits add `detritus_use:o.du||0`, `feeding` adds `d_energy:o.gd||0`.
- [ ] **Step 2: Run fast gate** — Run: `pnpm verify:fast`. Expected: PASS (trait inert; trajectories shift only via added rMut draws — if pins move already, note them for the Task 10 re-pin wave, do NOT force).
- [ ] **Step 3: Commit** — `git add packages/sim-core/src/engine.ts && git commit -m "feat(sim-core): detritus_use trait plumbing, inert (Slice 2)"`

### Task 4: Death deposition + body proxy + next-tick merge (AC1/AC2/AC5; assays A/B)

**Files:**
- Modify: `packages/sim-core/src/engine.ts` (exported pure `detritusBodyProxy(o)`, three death-site hooks, pending merge in `RS.step`)
- Test: `tools/validation/detritus.ts` assays A ( causality + proxy determinism/bounds) and B (next-tick availability)

**Interfaces:**
- Consumes: `DetritusField.deposit` (Task 2), death sites at step-loop lines ~631/633/677, `RS.step` env position.
- Produces: `export function detritusBodyProxy(o: Organism): number` = `min(30, 2 + .05*((o.ga||0)+(o.gb||0)+(o.gc||0)))`; deaths deposit at resolved death location into `pending`; `RS.step` merges `pending → stock` first, before mineralization/consumption reads.

- [ ] **Step 1: Write failing assays A and B** in new `tools/validation/detritus.ts`:
```typescript
// A: unit purity + integration causality
assert.equal(detritusBodyProxy({ga:100,gb:100,gc:100} as any), 17, "proxy is deterministic body-mass math");
assert.ok(detritusBodyProxy({ga:1e9,gb:1e9,gc:1e9} as any) <= 30, "proxy bounded");
assert.ok(detritusBodyProxy({ga:0,gb:0,gc:0} as any) >= 2, "newborn carcass floor");
// integration: matched runs with/without deaths; only death branch deposits (shape; exact ticks from implementation run)
// B: death tick T deposits D mass; consumer gains nothing from detritus at T, stock == D; gains possible at T+1
```
- [ ] **Step 2: Run to verify they fail** — Run: `pnpm exec tsx tools/validation/detritus.ts`. Expected: FAIL (no export / no deposition).
- [ ] **Step 3: Implement** — export `detritusBodyProxy`; hook all three death sites (`deaths++` locations) with `if (rs.detritusDepositionEnabled) pending-deposit at (o.x, o.y)`; merge pending at top of `RS.step`; no RNG; AC2 falls out (no deaths → no deposits; assert quiet strides deposit zero).
- [ ] **Step 4: Run assays A and B** — Expected: PASS with exact pinned values recorded in comments.
- [ ] **Step 5: Commit** — `git add packages/sim-core/src/engine.ts tools/validation/detritus.ts && git commit -m "feat(sim-core): death deposition with next-tick pending buffer; assays A/B (Slice 2)"`

### Task 5: Detritus consumption process + tradeoff (AC6/AC7/AC8; assays C/D)

**Files:**
- Modify: `packages/sim-core/src/engine.ts` (`DETRITUS_PROCESS`, `RS.execDetritus` mirror of `execCleanup`, `consume()` 4th candidacy, standing+execution costs in organism loop, `o.md/o.gd` counters)
- Test: assays C (advantage with opportunity) and D (no advantage without opportunity) via matched 2×2 forks

**Interfaces:**
- Consumes: `WASTE_PROCESS`/`execCleanup` pattern, `consume()` best-score loop, `lineageCredit`.
- Produces: capable organisms gain `DETRITUS_YIELD=7` energy from bounded uptake; `md/gd` lifetime counters; `interval.detritus_consumed/energy_detritus/detritus_exec`; `DU_STANDING` charged when `du>0`.

- [ ] **Step 1: Write failing assays C and D** — matched forks from a detritus-bearing world: du-high vs du-zero lineages × detritus-on vs detritus-off. C asserts capable advantage with opportunity; D asserts no advantage (or reversal via standing cost) without it. Exact thresholds from implementation runs, recorded as evidence.
- [ ] **Step 2: Run to verify they fail** — Expected: FAIL (no consumption path).
- [ ] **Step 3: Implement** — `DETRITUS_PROCESS` (access `Q(du,0,1.5)/1.5`, uptake `min(stock, .16*(.55+.45*conc))`, gain `amount*7`); `RS.execDetritus` gated by `detritusConsumptionEnabled`; `consume()` considers detritus score `amt*access` as 4th candidate (leave `scoreIndex`/`sense()`/`opportunity()` untouched — no behavior-policy change); caller applies `o.en+=gain; o.md++; o.gd+=gain` + lineage credit + interval counters; standing cost `DU_STANDING*du` in the detritus block when `du>0`; execution cost `DU_ACTIVE*amount`.
- [ ] **Step 4: Run assays C and D** — Expected: PASS. If no advantage configuration is found across 3 bounded configs, STOP and return DESIGN TENSION (stop condition: unsustainable tradeoff).
- [ ] **Step 5: Commit** — `git commit -m "feat(sim-core): detritus consumption process with du tradeoff; assays C/D (Slice 2)"`

### Task 6: Mineralization transfer + accounting closure (AC11/AC12; assays E/F)

**Files:**
- Modify: `packages/sim-core/src/engine.ts` (`mineralizeInto` wiring if not done in Task 2, `RS.biologicalProduction[0/1]` increments via reused capped `deposit`, interval counters)
- Test: assays E (isolated mineralization) and F (both accounting identities)

**Interfaces:**
- Consumes: `DetritusField` counters, `RS.accounting()`, `WasteField.accounting()` test pattern in `testWasteAccounting`.
- Produces: mineralized mass visible as `biological_production` in RS accounting; `interval.detritus_mineralized/mineralized_a/mineralized_b`.

- [ ] **Step 1: Write failing assays E and F** — E: fork with deposition+consumption disabled, pre-existing stock S0, N ticks: stock falls only by mineralization; `mineralized == A-received + B-received`; F: full-economy run of X ticks: detritus identity residual ~0 AND RS identity residual ~0 (mirror `testWasteAccounting` tolerances).
- [ ] **Step 2: Run to verify they fail** — Expected: FAIL.
- [ ] **Step 3: Implement** — wire `stepDetritus` (mineralize every tick; deposit via capped `rs.deposit` so overflow stays detritus); fill interval counters; if mineralization exceeds ~50% sustained share of A/B input or collapses A/B regimes, STOP and return DESIGN TENSION (runaway amplification).
- [ ] **Step 4: Run assays E and F** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(sim-core): detritus mineralization into A/B with closed accounting; assays E/F (Slice 2)"`

### Task 7: Facts, roles, metrics, export (required facts list; assay I/G support)

**Files:**
- Modify: `packages/sim-core/src/engine.ts` (`lineageCredit` detritus params, `readIntervalFlows`, `flowFacts` md/gd, `EMPTY_INTERVAL_FLOWS`, `observerSnapshot` interval block, `metabolicRole` detritivore, `metrics()` detritus block, `pack()`), `packages/sim-analysis/src/index.ts` (frame `detritus_fraction` only)
- Test: assay I (checkpoint/fork with nonzero detritus + evolved du); assay G hotspot reads field facts

**Interfaces:**
- Consumes: Tasks 2/5 counters; `metabolicRole` share math.
- Produces: per-lineage + totals detritus facts; `roles.detritivore` counts; `metrics().detritus{stock,capacity,fraction,produced,deposited?,consumed,mineralized,discarded}`; frame `detritus_fraction`.

- [ ] **Step 1: Implement facts** — extend `lineageCredit` signature + `readIntervalFlows` + `flowFacts` (md/gd) + `EMPTY_INTERVAL_FLOWS`; `metabolicRole`: `gd_share>=.15 && duAccess>=.35 → 'detritivore'` (note: `dominant_role` flows into era signatures — era pins may move; record for Task 10); `metrics().detritus` block; `pack()` detritus totals; analysis frame adds `detritus_fraction` (no new record kinds).
- [ ] **Step 2: Assay I** — checkpoint round-trip + matched-fork digest equality with nonzero detritus field, unmerged pending, and evolved `du` (mirror time-controls digest test). Expected: PASS.
- [ ] **Step 3: Commit** — `git commit -m "feat(sim-core): detritus facts, detritivore role, metrics/export; assay I (Slice 2)"`

### Task 8: Hotspot/succession + trait evolution (AC13/AC14; assays G/H)

**Files:**
- Modify: `tools/validation/detritus.ts` (assays G, H)
- Test: the assays themselves (read-only evidence over engine from Tasks 2–7)

**Interfaces:**
- Consumes: field stock reads, `detritusExec` facts, `traits.detritus_use` trajectories.
- Produces: G: hotspot (max cell > k× mean) + subsequent local response (executions + capable share); H: du response to persistent opportunity across bounded seeds.

- [ ] **Step 1: Write assay G** — patchy config run: assert a persistent detritus hotspot forms AND local consumption/recycler response follows. If no hotspot+response across 3 bounded configs, STOP and return DESIGN TENSION (AC13).
- [ ] **Step 2: Write assay H** — 3 seeds × detritus-on/off matched forks: `max(du_with − du_without) > 0.05` (existence, not frequency).
- [ ] **Step 3: Run assays G and H** — Expected: PASS with pinned values + comments.
- [ ] **Step 4: Commit** — `git commit -m "test(validation): detritus hotspot/succession and trait-evolution assays G/H (Slice 2)"`

### Task 9: Manifest unit, scripts, version bump, fast gate

**Files:**
- Modify: `tools/validation/manifest.ts` (unit `detritus`, group `ci-sim-c`), `package.json` (`test:detritus`, `test:detritus-survey`), `packages/sim-core/src/version.ts` (`0.25.0`)
- Test: `pnpm validation:check` + `pnpm verify:fast`

**Interfaces:**
- Consumes: manifest unit schema (id/script/cls/enforcement/domains/claim), Slice 1 baseline conventions.
- Produces: `detritus` blocking deterministic unit in exactly one ci shard + one of fast/simulation/presentation; old saves refused by existing engine gate (verify + document).

- [ ] **Step 1: Register unit + scripts + version bump** — claim covers AC1–AC18 mechanics; survey (AC19/L) stays manual like niche-survey. Verify an old (0.24.0) save is refused by the session engine gate (existing behavior, no backfill — document in return package).
- [ ] **Step 2: Run `pnpm validation:check` and `pnpm verify:fast`** — Expected: both PASS.
- [ ] **Step 3: Commit** — `git commit -m "test(validation): detritus manifest unit, scripts, engine 0.25.0 (Slice 2)"`

### Task 10: Regression re-pin wave (AC15/AC20; assay J)

**Files:**
- Modify: existing suites with moved pins (`decisions/dependency/niche/catalysts/flows/time-controls/…` as CI dictates)
- Test: full exact-head CI per shard

**Interfaces:**
- Consumes: Slice 1 re-pin discipline (same seed, causal comment per moved pin, counts/structure preserved, reachability tests added where capabilities move, never forced).
- Produces: all existing suites green on 0.25.0 with documented trajectory changes.

- [ ] **Step 1: Run one full local fast gate + targeted suites** to enumerate moved pins (expect MANY: detritus adds energy everywhere).
- [ ] **Step 2: Re-pin same-seed with causal comments**; where a capability moves (cross-feeding/niche/dormancy/occupancy), add/retain reachability tests per the Slice 1 niche precedent. If any of the four becomes unreachable across a bounded justified survey, STOP and return DESIGN TENSION.
- [ ] **Step 3: Push branch, open PR, run exact-head CI** — Expected: green apart from known pre-existing flakes (smoke tick-bound/pixel), which are follow-ups, not blockers.
- [ ] **Step 4: Commit(s)** — one commit per suite re-pinned, Slice 1 message style.

### Task 11: Scale/performance (AC18; assay K)

**Files:**
- Modify: `tools/validation/detritus.ts` (assay K)
- Test: deterministic cost proxies + wall-time informational vs no-detritus fork

**Interfaces:**
- Consumes: 1k/5k workload loop pattern in `spatial-occupancy.ts` (~lines 371–443).
- Produces: before/after tick throughput + field/process cost; completion guaranteed, proxies exact, wall time within a loose shared-runner-safe bound vs the disabled fork.

- [ ] **Step 1: Write assay K** — fixed config at 1k and 5k populations, detritus on/off forks: assert completion, exact deterministic proxies (executions, mineralized mass), and wall-time ratio bound. Return the numbers for the package.
- [ ] **Step 2: Run assay K locally** (short horizons only; full characterization on CI if needed) — Expected: PASS.
- [ ] **Step 3: Commit** — `git commit -m "test(validation): detritus scale/performance assay K (Slice 2)"`

### Task 12: Regime survey L + AC19 verdict (CI-only)

**Files:**
- Create: `tools/validation/detritus-survey.ts`, `.github/workflows/detritus-survey-025.yml`, `testdata/detritus-survey-0.25.json`
- Modify: `tools/validation/detritus.ts` (artifact gate: engine match, coverage, ≥1 new-regime row), `package.json` (`test:detritus-survey`)
- Test: survey workflow dispatch with BOTH `--ref` and `-f ref=`/`-f out=`; gate passes locally once artifact is committed

**Interfaces:**
- Consumes: `niche-survey.ts` row loop + resume-safe retain pattern; `niche-survey-023.yml` workflow shape.
- Produces: 3 configs × 6 seeds at 100k horizon recording detMax/detFinal, detritivore share, du trajectory, hotspot flag (field CV), response class (specialization / succession / recovery / bloom / abundance-only).

- [ ] **Step 1: Write survey + workflow + gate** mirroring the niche precedent (OUT constant matches workflow `out` default).
- [ ] **Step 2: Dispatch on CI, download artifact, commit it** — if NO row shows a new regime (only abundance lift), STOP and return DESIGN TENSION (AC19/stop condition).
- [ ] **Step 3: Gate passes locally; commit** — `git commit -m "test(validation): detritus regime survey L + 0.25 artifact (Slice 2)"`

### Task 13: Return package + PR link-back

**Files:** PR comment + issue #97 link (no source changes except `docs/superpowers/plans` log if kept in repo)

- [ ] **Step 1: Post the §20-style return package** to the implementation PR (PR URL, base/head SHAs, files, version decisions, field semantics, proxy rule, trait+tradeoff, equations, accounting evidence, stage order, facts/contracts, AC1–AC20 map, CI URLs, survey observations, perf, limitations, TENSION/DECISION items) and link it on issue #97.
- [ ] **Step 2: Report DESIGN TENSION / OWNER DECISION items**, if any, with evidence; otherwise request review.

## Self-Review

1. **Spec coverage:** AC1→Task 4; AC2→Task 4; AC3→Tasks 2+7(I); AC4→Task 9; AC5→Task 4 assay B; AC6→Task 5; AC7→Task 5 assay C/D + Task 8H; AC8→Task 5; AC9→Task 5 assay C; AC10→Task 5 assay D; AC11→Task 6; AC12→Task 6 assay F; AC13→Task 8 assay G; AC14→Tasks 4+8; AC15→Task 10; AC16→Task 7 assay I; AC17→Tasks 5 (no sense change) + 7 (no new records) + review; AC18→Task 11; AC19→Task 12; AC20→Task 10 review. Assays A–L each owned: A/B→4, C/D→5, E/F→6, G/H→8, I→7, J→10, K→11, L→12. Versioning/persistence→Task 9. Stop conditions→concrete triggers in Tasks 5/6/8/10/12. No gaps.
2. **Step scan:** each step names one action + checkable result; constants carry starting values with assay-adjustment rules, not open choices.
3. **Type consistency:** field names (`detritusDeposited/detritusConsumed/energyDetritus/detritusMineralized/mineralizedA/mineralizedB/detritusExec`, `md/gd`, `du`) fixed in Task 1 and reused verbatim in Tasks 5–7.
4. **Review Focus:** all five lines have owning assays (extinction→F/E robustness asserts; saturation→F/G discard asserts; pending checkpoint→I; disabled forks→D/E; RNG shift→Task 10 discipline).
5. **Proportion:** decisions without transcribing bodies; implementer writes process bodies from the WasteField/WASTE_PROCESS mirrors cited by line.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-10-03-foundation-slice2-detritus.md`. Please review the plan. Which execution approach would you prefer?

- **Subagent-driven** — a fresh subagent implements each task and a fresh reviewer checks it before the next one starts, then a whole-branch review at the end. Most thorough; costs a fresh context per task and per review.
- **Native** — I implement every task myself in this session, the way this harness runs work, then one fresh reviewer on the most capable model checks the whole branch. Cheapest and fastest; no independent review until the end.

For this plan I recommend **Native**, because the tasks share one dense engine file where cross-task interface drift is the main risk and a single implementer holding the whole file in context avoids it; the exact-head CI plus assay pins provide the independent check at the end. Does the plan capture what you want, and which approach should we use?
