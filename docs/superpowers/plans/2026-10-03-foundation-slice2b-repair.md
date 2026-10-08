# Foundation Slice 2B (Conditional Detritivory / Rare-Invasion Repair) Plan Addendum

> **For agentic workers:** same REQUIRED SUB-SKILL as the base plan (native inline execution, Owner standing choice). Steps use checkbox syntax.

**Goal:** Repair the private-benefit seam so a rare naturally-arising du mutation can invade where detritus is rich and ordinary resources are limiting, while detritus can never displace a realized A/B/C uptake.

**Base plan:** `docs/superpowers/plans/2026-10-03-foundation-slice2-detritus.md` (Tasks 1–13, all engine/assay work preserved). This addendum OVERRIDES only: consumption selection (R1-strict), tradeoff shape (execution + small constitutive, no substitution), assays C/D/H (reworked), plus ADDS: H1–H5 invasion series, §9 reachability-before-repins, and the 2B return package. Everything else (field, death, pending, mineralization, accounting, staging, checkpointing, metrics, roles, survey L framework) stands.

**Spec:** issue #97 comment #5968055080 (self-contained; no Drive needed). Vehicle: same branch `feat/foundation-slice2-detritus`, PR #103 stays do-not-merge. Engine stays 0.25.0 (no state-shape change expected).

## Global Constraints (additive to base plan)

- R1-strict: ordinary `consume()` resolves EXACTLY as today; detritus is attempted only if ordinary returned null. No lookahead, no optimizer, no behavior genes, no sensing change.
- No generalized metabolic-capacity budget (OWNER DECISION trigger); a du-specific small constitutive cost is allowed.
- Mineralization stays as-is unless new evidence independently breaks it (no lossy rescue, no yield hike to rescue invasion).
- Re-pins only AFTER capability reachability is proven (§9); trajectory movement ≠ capability loss.
- CI failures from run 37112313296 are inputs: quick 6777→7530, sim-d arc 276100→194023, sim-b possibility point moved, sim-c niche reachability 0-by-60k, smoke ±1 known.

## Review Focus (additive)

- Ordinary-rich twins differing only in du must stay bit-identical (H3 digest equality) — any divergence is a displacement bug, test in the assay that owns the code.
- Starvation-fallback double meals: detritus must never ADD a second meal on top of a realized ordinary uptake — test in the assay that owns the code.
- Invasion evidence must be lineage-resolved (parent chains), never whole-population contrasts that hitchhike — test in the assay that owns the code.
- Seeded persistence must never be presented as reachability — H5 is labeled regression-only in code.
- Niche reachability under detritus wealth is the highest-risk §9 item (waste→0.01 observed) — bounded search, then TENSION if absent.

---

### Task R1: R1-threshold conditional consumption + tradeoff reshape

R1-null (detritus iff ordinary returned null) was built first and REJECTED
by probe: cells are never literally barren (regen/diffusion), so fallback
fired ~never (exec≈0) and the capability stayed dead. R1-threshold
replaces it: ordinary `consume()` is byte-identical to 0.24.0; S.step
appends ONE detritus top-up meal iff ordinary gain < DETRITUS_SHORTFALL
(0.5 energy ≈ 20% of a full primary meal). Preferred priority is
structural (ordinary never reduced); DETRITUS_PREFERENCE deleted.
Whole-pop free-rider gap persists by design (public mineralization) —
marginal invasion (H1), not whole-pop contrasts, is the evolvability test.

**Files:**
- Modify: `packages/sim-core/src/engine.ts` (`consume()`, remove `DETRITUS_PREFERENCE` competition, `DU_CONST` constitutive cost, keep graded uptake/yield/exec cost), `tools/validation/detritus.ts` (H3 twin-digest assay + C/D rework)
- Test: H3 (new), C, D (reworked), A, B (rerun unchanged)

**Interfaces:**
- Consumes: Task 5 engine code.
- Produces: `consume()` returns nutrient execution whenever ordinary succeeds (detritus never evaluated); `DetritusExecution` only on ordinary-null; `DU_CONST` starting value recorded below.

- [ ] **Step 1: Write failing H3** — rich-world twins du=1.5 vs du=0, 5k ticks: assert checkpoint-digest equality (trajectories bit-identical → no displacement possible). Fails now (score competition diverges twins).
```typescript
const a = freshWithDu(1.5), b = freshWithDu(0.0);
drive(a, 5000); drive(b, 5000);
assert.equal(digest(b), digest(a), "du invisible when primaries suffice");
```
- [ ] **Step 2: Run to verify it fails** — Expected: FAIL (digests differ).
- [ ] **Step 3: Implement R1-strict** — `consume()`: run ordinary loop first; if `best>0` return nutrient execution immediately (delete dScore competition + `DETRITUS_PREFERENCE`); else try `execDetritus`. Replace standing-cost block with `DU_CONST=0.0005` constitutive charge when `du>0` (small: neutrality-acceptable in rich worlds per §6; records starting value). Keep graded uptake, yield 7, exec cost.
- [ ] **Step 4: H3 passes; rework C/D** — C: scarcity-world factorial (capable advantage where ordinary fails); D: rich-world equality bands + exec==0 both forks. Exact pins from runs.
- [ ] **Step 5: Rerun A, B** (death path untouched — must stay green as-is).
- [ ] **Step 6: Commit** — engine + assays.

### Task R2: H1/H2/H4 rare-invasion series (CI-scale, probe locally for conditions first)

**Files:**
- Modify: `tools/validation/detritus.ts` (H1 single-mutant invasion, H2 no-opportunity control, H4 two-frequency, H5 seeded regression keep)
- Test: the assays (lineage-resolved via parent chains; horizons 60–100k+ → long local runs PROHIBITED: calibrate horizons in short probes, pin exact-tick evidence on CI? No — assays must pass on CI in-gate; design horizons CI-fittable, verify locally once at cost)

**Interfaces:**
- Consumes: R1 engine; regime choice from short local probes (which config shows ordinary-failure + detritus).
- Produces: lineage invasion evidence (mutant share rises from rarity, persists, detritivore state reached without seeding).

- [ ] **Step 1: Probe regimes locally (short)** — harsh/low-prod/high-density candidates, 20–30k ticks each: measure ordinary-failure rate (ticks with null consume? proxy via starvation deaths) + detritus stock. Pick the regime with real scarcity + detritus.
- [ ] **Step 2: Write H1** — single-organism du=0.8 marking at tick T in chosen regime; track marked-lineage share at T+H (H from probe, 60–100k); assert share grows ×K and persists + reaches detritivore classification. Run once locally (expensive but one-time), pin exact.
- [ ] **Step 3: Write H2** — same marking, detritus disabled: assert no invasion (neutrality band).
- [ ] **Step 4: Write H4** — repeat H1 at 5% cohort frequency: assert invasion (not just whole-pop equilibrium).
- [ ] **Step 5: Keep H5** — existing seeded-maintenance asserts, relabeled regression-only.
- [ ] **Step 6: Commit** — assays only.

### Task R3: Re-verify preserved assays + §9 reachability (no re-pins yet)

**Files:**
- Modify: `tools/validation/detritus.ts` (pin updates ONLY where R1 legitimately moved values, with causal comments)
- Test: E, F, G, I, K rerun; reachability probes for cross-feeding / dormancy / occupancy / niche

**Interfaces:**
- Consumes: R1/R2 engine (frozen after R1 except bounded calibration).
- Produces: green preserved assays; four capability verdicts (reachable + where, or TENSION trigger for niche).

- [ ] **Step 1: Rerun E, F, G, I, K** — update moved pins with causal comments (mineralization/consumption values shift under R1). No weakening.
- [ ] **Step 2: Reachability probes (short, local)** — cross-feeding establishment seed, seedbank/dormancy events, occupancy assertions, niche two-layer (characterize 24681357 + bounded search for a reachable regime; survey-scale search goes to CI if local fails).
- [ ] **Step 3: Verdict per capability** — reachable (record where) or TENSION (niche only per stop conditions; others must reach — investigate as bugs if absent).
- [ ] **Step 4: Commit** — assays + reachability notes.

### Task R4: Re-pin wave, survey L, baselines, return package

**Files:**
- Modify: existing suites (re-pins with causal comments), `testdata/detritus-survey-0.25.json` (CI artifact), `tools/validation/manifest.ts` (baselines), PR #103 + issue #97 (package)
- Test: exact-head full CI

- [ ] **Step 1: Re-pin moved trajectories** (Slice 1 discipline) ONLY for capabilities proven in R3.
- [ ] **Step 2: Dispatch detritus survey L on CI**, commit artifact, enable survey gate.
- [ ] **Step 3: Correct manifest baselines** from final-head telemetry.
- [ ] **Step 4: Post 2B return package** on PR #103 + link on issue #97 (head SHA, R1 rule, displacement proof, tradeoff, H1–H5, AC2B-1–16 map, reuse-vs-rerun table, reachability evidence, re-pins, survey, CI URL, perf, limitations, TENSION/DECISION items).

## Self-Review

1. **Spec coverage:** §5.1→R1+H3; §5.2→R1 eligibility + assays; §5.3→no-behavior (R1 uses fixed order, H3 proves invisibility); §6→R1 tradeoff + C/D; §7→R3 (mineralization untouched); H1–H5→R2; §9→R3 then R4; AC2B-1→R3 reruns; AC2B-2→R1+H3; AC2B-3→R1; AC2B-4→R1; AC2B-5→R1 + C/D; AC2B-6/7/8→R2 (H1/H2/H4+H3); AC2B-9→R2 H5; AC2B-10→R3; AC2B-11→R3; AC2B-12/13→R3 (I rerun); AC2B-14→R4 survey; AC2B-15→review; AC2B-16→R3 K rerun. Calibration discipline §11 followed (substitution removal first). No gaps.
2. **Step scan:** each step one action + checkable result; R2 horizon choice explicitly probe-driven.
3. **Type consistency:** names from base plan reused (`detritusExec`, `energyDetritus`, `md/gd`, `du`); new: `DU_CONST`, H1–H5 assay names.
4. **Review Focus:** all five lines have owning assays.
5. **Proportion:** deltas only; base plan carries the engine detail.
