# Evolutionary Substrate Diagnostic — return package

Issue #97 comment `6060686372`. Diagnostic-only; no production biology change,
no mechanism #5, no merge target.

- Branch: `analysis/evolutionary-substrate-diagnostic`
- Base: `origin/main @ c247dd9` ("docs(agents): restore the worktree-location rule (#128)")
- Engine: `0.24.0` (maintained main; the diagnostic introduces no engine change)
- Harness: `tools/diagnostics/substrate/{common,qA,qB,qC,qD}.ts`
- CI: `.github/workflows/substrate-diagnostic.yml` (push-scoped to the
  diagnostic branch, no `pull_request` trigger, outside `product.yml`)

## Exact commands

```
pnpm install --frozen-lockfile
pnpm exec tsx tools/diagnostics/substrate/qA.ts
pnpm exec tsx tools/diagnostics/substrate/qA.ts --value
pnpm exec tsx tools/diagnostics/substrate/qB.ts
pnpm exec tsx tools/diagnostics/substrate/qC.ts
pnpm exec tsx tools/diagnostics/substrate/qD.ts
```

`--smoke` runs 1 seed at short horizons for harness verification only. Raw rows
are JSONL under `testdata/substrate-diagnostic/`, returned as a CI artifact and
deliberately not versioned.

## Seed / config / horizon matrix

- Seeds (predeclared): 111111111, 222222222, 333333333, 444444444, 555555555
- Configs: `balanced` (Q-A/B/C), `patchwork` + `balanced` (Q-D)
- Regime ladder (Q-A/B/C): replete (1.4/1.4), marginal (0.58/0.77 = maintained
  balanced), scarce (0.22/0.22). `start`/`prod` are nutrient field stock and
  regrowth — world settings, not rules.
- Horizons: Q-A/B 40k, Q-A2 assay 20k, Q-C 30k, Q-D 150k (the maintained
  niche-survey horizon; not a new bound)

## Measurement-vs-inference notes

An independent review pass was run over the harness with the biology
deliberately withheld, scoped to measurement correctness only. It found one
critical fault and several narrower ones. All were fixed and the critical one was
verified against ground truth before re-running. This matters for reading the
earlier smoke numbers: **any output produced before commit `0b1097a` is void**,
because every counter-derived figure in it was inflated roughly 100×.

Critical, verified:

- `drain()` summed `sim.cur` every tick, but `sim.cur` is cumulative within a
  stride (replaced only every EVENT_STRIDE = 251 ticks), so per-tick summing
  adds prefixes of one running total. Measured on seed 333333333 over 1000
  ticks: **3027 births reported where observation counted 30**. Q-B's scarce
  births read 26375 against a true 207. Fixed by sampling every tick and
  differencing, with a value drop treated as the stride reset — the same
  stride-safe accumulator `tools/validation/spatial-occupancy.ts` already uses.

Also fixed and, where checkable, verified rather than assumed:

- Q-A's marginal-energy table dropped every zero-birth window. That conditions
  the denominator on the outcome being measured and inflates the rate most in
  the low-energy bands, flattening or inverting the gradient the table exists to
  show. Every sample now counts.
- Q-A's ledger `eligibleTicks`/`blockedInferred` recomputed the reproduction gate
  after the birth commit, which spends the parent's reserve and so hides every
  successful birth, and they ignored dormancy. Renamed `*Approx`, documented, and
  never emitted as measurements.
- Q-B kept only the last wake per organism while its event count included every
  wake. Now one observation per wake; post-first-birth wakes are counted and
  disclosed rather than dropped.
- Q-D's `cap` axis is a declared-but-unread config key: `cap*0.9` and `cap*1.1`
  produced **bit-identical** runs (verified by fingerprint, with `press` and `mr`
  correctly differing). Those rows would have reported "no capability lost" from
  runs that changed nothing — false evidence of robustness. Removed, and every
  axis is now asserted live before its reading is trusted.
- Q-D compared every seed's perturbed row against the first seed's baseline,
  folding seed-to-seed detector variation into the perturbation column. Now
  matched on config **and** seed.
- Q-C clamped the two founder groups independently, which could saturate one side
  at a range bound and quietly make a "symmetric" split asymmetric. The offset
  now shrinks until both sides fit, a degenerate collapse is flagged and excluded
  from the verdict, and unassigned organisms count as neither group rather than
  falling through to the high bucket.

Three traps were caught while writing the harness, before the review:

1. The reproduction gate is evaluated **before** the birth commit spends the
   parent's reserve. Recomputing eligibility from post-step state reports ~0
   eligible organism-ticks in runs that made tens of thousands of births. Q-B
   reads the maintained `repro_eligible` counter instead.
2. Newborns carry fresh ids, so a founder-keyed group lookup returns `undefined`
   and silently attributes every birth to one group. Q-C inherits group
   membership through the parent link.
3. Attributing an organism's lifetime birth count to every energy sample weights
   the marginal-value curve by lifespan instead of retained energy. Q-A counts
   only births inside each sample's forward window.

Blocked births are the one genuinely inferred quantity: main publishes them only
as a run-level counter, so no per-organism attribution or streak length is
reported.

### Caveat carried into every Q-C verdict

`classify` labels a regime "consistently HIGH"/"consistently LOW" from sign
counts against a fixed ±0.02 threshold, with no drift-variance calibration.
Births are lineage-amplified rather than independent, so a binomial standard
error would understate the noise, and low-birth regimes can cross the threshold
on drift alone. Verdicts are therefore reported as directional summaries
alongside the raw `births` count, never as significance claims.

## Findings

Populated from the CI artifact; see the A–D sections below.

## Substrate map

Populated from the CI artifact.

## Causal interpretation and uncertainty

Populated from the CI artifact. Measurement and inference are kept separate, and
a single world is never treated as establishing general evolvability.

## Recommended smallest substrate decision(s)

Populated from the CI artifact. No substrate change is implemented here.
