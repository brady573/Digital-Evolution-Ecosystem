# Division Allocation — failed-experiment provenance

**Status: CLOSED DESIGN TENSION. Not a candidate for merge. Not a successor base.**

Owner terminated this mechanism on issue #97 (comment `6060468655`) after four
consecutive Lane 1 mechanisms — Cell Shape, Bulk, Recovery Readiness, Division
Allocation — failed the same acceptance gate. This directory exists only so the
evidence that closed it stays reproducible after the working files are gone.

Nothing here is merge-gating. `tools/validation/division-allocation.ts` is
deliberately **not** registered in `tools/validation/manifest.ts` and must not be
registered; the mechanism is dead, so a blocking gate would only guard a branch
nobody should build on.

## What was attempted

Division Allocation (`da`) added one continuous inherited trait controlling how
a successful parent's post-division energy budget splits between the continuing
parent and the newborn. Lower = parent retention, higher = offspring
provisioning. The conserved budget was `D * Epre` with `D = 0.9984`
(`0.52 * (1 + 0.92)`), so the trait could only redistribute, never create or
destroy energy.

## Why it failed

The decisive finding is that **parent retention is universal**. Across five
worlds spanning every regime class the handoff allowed (resource-replete,
moderate, poor, very poor, and one-shot global-nutrient-crash disturbance), two
seeds each, the parent-retention strategy out-birthed the maintained split every
single time, by roughly +5k to +94k births per 12k-tick run. Offspring
provisioning never beat the maintained control. That makes DA-8 (opposing
heritable selection) and DA-9 (no universal optimum) unreachable without
changing the accepted birth-energy accounting — which the handoff explicitly
forbids.

Full tables: [RESULTS.md](RESULTS.md).

A second, independent failure: the **individual-level** claims the handoff asked
for (DA-6 shorter parent route to another birth, DA-7 better newborn
establishment) are **not demonstrable in this engine**. See
[RESULTS.md](RESULTS.md) §3. The maintained storage-cost curve
`SC(e) = 0.000035 * (e-100)^2` makes the energy-climb rate reserve-dependent, so
a parent holding more reserve reaches a proportionally higher threshold *sooner*.
Measuring "route to the next birth" against a threshold anchored to the
low-allocation parent therefore manufactures the answer, and against a
threshold proportional to each arm's own reserve the measured direction reverses
with the seed. Both assay shapes were tried; neither is sound, so
`tools/validation/division-allocation.ts` asserts only what is stable and records
the rest as a null result.

## Reproducing

All probes run against this branch (engine 0.25.0, the only place the `da` trait
exists). On maintained main there is no Division Allocation to measure, which is
precisely why this is provenance and not evidence about the product.

```
pnpm install --frozen-lockfile
pnpm exec tsx tools/provenance/lane1-division-allocation/strategy-fitness-probe.ts 12000
pnpm exec tsx tools/provenance/lane1-division-allocation/disturbance-probe.ts
pnpm exec tsx tools/provenance/lane1-division-allocation/realized-effect-sweeps.ts
pnpm exec tsx tools/validation/division-allocation.ts
```

The strategy and disturbance probes are multi-minute. Per the repository
Owner-device execution rule they were run once to produce the recorded tables and
should not be re-run on the Owner device.

## Known limitation carried forward

`tools/validation/division-allocation.ts` is not wired into
`tools/validation/manifest.ts` or `package.json`, so `pnpm validation:check`
does not know about it. That is intentional here. On maintained main the export
string `trait_diversity` describes the diversity computation while `STUDY_TRAITS`
still lists nine traits; the same class of wording mismatch already exists on
main and was deliberately not polished on a closed branch.
