# Division Allocation — raw result tables

Engine `0.25.0`, branch `feat/division-allocation`, base `01019c4`
(maintained main at handoff time). `da = 0.75` maps to exactly the maintained
split (`shift == 0`), so it is the **control** arm and is numerically
maintained-main biology. Config base: `pop 30, div 0.35, mr 0.1, ms 0.12,
press 1.0875, patch 0.6, byproduct + dormancy enabled, study on`.

## 1. Strategy-fitness probe — `strategy-fitness-probe.ts`, 12000 ticks

One `da` value pinned on every organism every tick. This is a fixed-genotype
comparison: it measures the fitness of the two *strategies* while holding
allocation non-heritable, so it cannot itself satisfy the handoff's DA-8. It
exists to answer the prior question — is there any population-level difference
at all?

| world | seed | retain(da0) births | control births | provision(da1.5) births | retain−ctrl | provision−ctrl |
| --- | --- | --- | --- | --- | --- | --- |
| replete 1.4/1.4 | 7 | 465660 | 390539 | 385168 | +75121 | −5371 |
| replete 1.4/1.4 | 4242 | 464076 | 373824 | 373483 | +90252 | −341 |
| moderate 0.58/0.77 | 7 | 263021 | 191648 | 189283 | +71373 | −2365 |
| moderate 0.58/0.77 | 4242 | 257502 | 186783 | 177502 | +70719 | −9281 |
| poor 0.22/0.22 | 7 | 73429 | 55412 | 53104 | +18017 | −2308 |
| poor 0.22/0.22 | 4242 | 55087 | 49958 | 43382 | +5129 | −6576 |

Final populations, same runs: retain/control/provision = 946/910/806,
893/793/801, 481/435/391, 444/396/402, 137/100/133, 152/118/127.

**Reading:** parent retention wins in 6/6. Provisioning never exceeds control.

## 2. Disturbance probe — `disturbance-probe.ts`, 12000 ticks

One-shot `global` catalyst (nutrient crash, −50% field stock) scheduled at tick
6000. `post-crash` counts births strictly after the crash.

| world | seed | retain births (post-crash) | control births (post-crash) | provision births (post-crash) | retain−ctrl | provision−ctrl |
| --- | --- | --- | --- | --- | --- | --- |
| crash@6000 moderate | 7 | 263552 (156191) | 183679 (94747) | 186513 (103339) | +79873 | +2834 |
| crash@6000 moderate | 4242 | 244888 (135744) | 182950 (97164) | 171127 (94420) | +61938 | −11823 |
| crash@6000 replete | 7 | 444036 (240703) | 385963 (216012) | 373618 (212476) | +58073 | −12345 |
| crash@6000 replete | 4242 | 456655 (257633) | 362182 (200771) | 360676 (198059) | +94473 | −1506 |

**Reading:** parent retention still wins 4/4 under disturbance. The one positive
provisioning cell (+2834) is also the only case where provisioning matched
control at all, and it does not survive the second seed in the same world.

## 3. Realized-effect sweeps — `realized-effect-sweeps.ts`

### 3a. DA-6 route-to-next-birth, competing world, 30000-tick horizon

Each arm is a matched focal reproducer (identical seed/config, only `da`
differs) parked at `rp = 220`, then measured against a post-birth threshold.

| world | seed | da=0 | da=0.75 | da=1.5 |
| --- | --- | --- | --- | --- |
| 0.58/0.77 | 7 | reached@103 | reached@43 | reached@22 |
| 0.58/0.77 | 4242 | reached@94 | reached@36 | reached@19 |
| 0.58/0.77 | 99 | reached@441 | reached@69 | reached@23 |
| 0.22/0.22 | 7 | no-route@30000 | reached@147 | reached@72 |
| 0.22/0.22 | 4242 | no-route@30000 | reached@73 | reached@30 |
| 0.22/0.22 | 99 | no-route@30000 | reached@93 | reached@66 |

With a threshold proportional to each arm's own reserve, the **highest**
allocation reaches the threshold **fastest** in every cell. The mechanism is the
maintained storage-cost curve: the climb rate is reserve-dependent, so a larger
reserve covers a larger absolute gap sooner. A threshold anchored instead to the
low-allocation parent's post-birth reserve reverses this — low allocation
"wins" by construction of the threshold. Neither shape measures the handoff's
claim; both are artifacts of the measurement.

### 3b. DA-7 newborn establishment, isolated newborn, 40000-tick horizon

Ticks from birth to the newborn's own first birth.

| world | seed | da=0 | 0.375 | 0.75 | 1.125 | 1.5 |
| --- | --- | --- | --- | --- | --- | --- |
| 0.16/0.16 | 7 | never | never | never | never | never |
| 0.16/0.16 | 4242 | never | never | never | never | never |
| 0.16/0.16 | 99 | never | 3928 | 3928 | 3928 | 3928 |
| 0.58/0.77 | 7 | never | never | never | never | never |
| 0.58/0.77 | 4242 | never | never | never | never | never |
| 0.58/0.77 | 99 | never | never | never | never | never |

**Null result.** 10 of 12 arms never establish inside the horizon; the two that
do take an identical 3928 ticks regardless of allocation. An earlier single-seed
run appeared to show provisioning establishing sooner (940 vs 1104 ticks); it
did not reproduce across seeds and is withdrawn.

## 4. Standing Phase A assay

`pnpm exec tsx tools/validation/division-allocation.ts` — DA-1..DA-5 and DA-11
pass and are deterministic. DA-6 asserts only the population-level
parent-retention direction that survived review; DA-7 asserts only the exact
reserve split and records the establishment outcome as a null result. DA-8/DA-9
are unreachable and are not asserted.
