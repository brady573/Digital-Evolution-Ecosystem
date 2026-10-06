# Phenotype-Manifold Measurement Protocol (predeclared)

Handoff: issue #97 comment #6027296418. Engine baseline: maintained `main` (0.24.0, ten evolvable traits, no detritus). 2C code is historical comparison only.

## Representative set (fixed before measurement; no seed-shopping)

Six worlds — the three maintained calibration configs × two maintained seeds:

| world | config | seed |
|---|---|---|
| balanced-a | start .58, prod .77, patch .6 | 24681357 |
| balanced-b | start .58, prod .77, patch .6 | 821947219 |
| patchwork-a | start .62, prod .86, patch .9, pop 34, div .45 | 24681357 |
| patchwork-b | start .62, prod .86, patch .9, pop 34, div .45 | 333333333 |
| harsh-a | start .47, prod .52, patch .55 | 111111111 |
| harsh-b | start .47, prod .52, patch .55 | 222222222 |

Common: cap 360, pop 30, div .35, mr .03, ms .12, press 1.0875, patch .6 default, resource_b_fraction .5, cat global, st null, definition_driven_substances, grid 60, byproduct + dormancy on, study on. Horizon 50k ticks per world; samples every 10k.

## Per world, retain

- engine/config/seed/horizon; population + mean generation + generation max at each sample;
- absolute distributions (mean/p5/p95/max) for ALL TEN inherited traits (sp,se,me,rp,di,ha,bu,dr,to,cu), with to/cu reported separately as resolver-ignored capabilities;
- the four presentation axes distributions;
- founder-family distribution (absolute resolve, `resolveFounderFamily`, no lineage input);
- descendant-family distribution (prospective lineage-anchored map: at birth, `resolveDescendantFamily` from the living parent's current family; map carried forward across segments);
- transition ledger: count, tick, source→destination, full 10-trait state at each transition;
- established-clade same-family fraction (established = sim lineage peak≥8 and age≥1000 ticks, the maintained definition; per established lineage root group via `familyRoot`, fraction whose living members' majority descendant family equals the root's founder family);
- invisible-evolution fraction: established lineages with zero family transitions + to/cu divergence stats (mean/max |Δ| from founder values) — capability evolution with zero visual expression.

## Hysteresis decomposition (final sample, per organism)

- Blob under both resolutions;
- non-Blob as founder but retained Blob by hysteresis;
- never-approaches: Blob-founder AND (min over non-Blob attractors of distance − blob distance) > 0.1 at every sample (trait vector never comes within transition reach).

Hysteresis constants (0.8 / 0.1) are NOT changed during the study.

## Classification mapping (decided after measurement)

- PRESENTATION CALIBRATION: inherited differences reach non-Blob attractor regions (founder resolution shows them) but descendant outcomes stay Blob, OR to/cu diverge materially with zero visual expression path.
- MAINTAINED MANIFOLD CONSEQUENCE: trait vectors genuinely remain in Blob attractor region (never-approaches dominates) under 0.24.0 biology.
- HYSTERESIS EFFECT: biology crosses founder-family regions but lineage continuity retains Blob (second bucket dominates).
- MISSING DEGREE OF FREEDOM: product-expected morphology distinctions have no encoding in the 10-trait vector (e.g., requires to/cu or body-plan state the resolver cannot read).

## Out of scope (handoff stop conditions)

No attractor moves, no weight/hysteresis changes, no body-plan genes, no ecology/mutation retuning, no PR #107 art changes. Tool: `tools/phenotype-manifold.ts` (measurement only, survey-group evidence, never a gate).
