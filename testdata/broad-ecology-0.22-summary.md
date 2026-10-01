# Broad engine-0.22 ecology characterization — summary

Read-only aggregation over `testdata/broad-ecology-0.22.json` (engine 0.22.0, 32 baseline runs, 16 matched pairs). This file characterises; it proves nothing exact.

## Survey matrix

- Archetypes (4): balanced, patchwork, harsh, abundant.
- Seeds (8, niche-survey set): 24681357, 821947219, 3543950664, 111111111, 222222222, 333333333, 444444444, 555555555.
- Horizon: 250000 ticks; trajectory sampling every 5000 ticks (50 samples/run), scalars only.
- Configs: the ecology-survey PRESETS mapping + config() verbatim per archetype: balanced {"rich":0.6,"patch":0.6,"resdiv":1,"pop":30,"div":0.35,"mr":0.03,"press":0.45}; patchwork {"rich":0.68,"patch":0.9,"resdiv":1,"pop":34,"div":0.45,"mr":0.03,"press":0.42}; harsh {"rich":0.38,"patch":0.55,"resdiv":0.8,"pop":30,"div":0.35,"mr":0.04,"press":0.78}; abundant {"rich":3.2,"patch":0.6,"resdiv":1,"pop":30,"div":0.35,"mr":0.03,"press":0.45}.
- Disturbance: maintained droughtA via createControlFork() + intervene("droughtA"), fork at tick 60000, immediate pair at +1000 (tick 61000), late pair at +30000 (tick 90000); assay seeds 24681357, 821947219, 3543950664, 111111111.
- Horizon justification pointer: artifact field horizonJustification — Matches the ecology-survey standard horizon; exceeds the niche-survey 150k establishment window and the washout 60k-settle/120k-extended windows; covers the ~63k establishment timescale noted in landscape-capture with headroom for persistence/turnover/recovery.

## Observed

Per 5000-tick sample, observed scalars only (typeof-guarded; absent is null, never 0): population, dormant_fraction, dormant_population, wakes (read-only simulation.last.wakes, interval-scoped, null-fallback), crossfeeder_fraction, c_share (resource_energy.c_share else resource_use.c_share), c_energy_share (living-energy C share; null when no living energy), metabolite_c produced/consumed, waste fraction, nutrient A/B plus accounting absolute_residual max, effective_niches, lineages/clades/families active/effective, trait_diversity, traits tolerance/cleanup means, ecological_outcome, extinct_tick. Terminal adds record headers {kind, phase, tick, entityRefKinds} and trajectory labels. Every run retained, including extinct/empty.

Retained: 32 runs; terminal ticks 250000..250000; terminal populations 161..4907; 0 extinct (none). Outcomes: Persistent dual-niche partitioning x10; Discordant resource use x19; Transient dual-niche partitioning x1; Mixed eco-strategies x1; A-adapted dominance x1.

## Distributional characterization

- balanced: 8 runs, 0 extinct, terminal population 350..394.
- patchwork: 8 runs, 0 extinct, terminal population 417..514.
- harsh: 8 runs, 0 extinct, terminal population 161..193.
- abundant: 8 runs, 0 extinct, terminal population 4636..4907.
- resources/waste labels: depletion x19; transient-spike x2; flat/absent x11.
- dormancy labels: established-with-return x14; established-no-return-observed x18.
- cross-feeding labels: in-use x31; capability-only x1 (ecologically-relied is never emitted from single runs; reliance needs matched-assay support).
- niche labels: no-modification x30; established x1; exposure-without-shift x1 (no-response count 0; absence is a rule artifact, see notes).
- Last-sample waste fraction range: 0.0014035643062379997..0.02055367518036333; max dormant fraction range: 0.40796920987095314..0.7580645161290323.
- Clade ever-active-max range: 15..283; turnover verdicts replacements {"not-observed":26,"false":6}, collapse {"true":5,"false":27}, recovery {"true":11,"false":21}.
- Representative negative cases named: extinct [none]; no-dormancy [none]; no-crossfeeding [none]; no-niche [balanced/24681357, balanced/821947219, balanced/3543950664, balanced/111111111, balanced/222222222, balanced/333333333, balanced/444444444, balanced/555555555, patchwork/821947219, patchwork/3543950664, patchwork/111111111, patchwork/222222222, patchwork/333333333, patchwork/444444444, patchwork/555555555, harsh/24681357, harsh/821947219, harsh/3543950664, harsh/111111111, harsh/222222222, harsh/444444444, harsh/555555555, abundant/24681357, abundant/821947219, abundant/3543950664, abundant/111111111, abundant/222222222, abundant/333333333, abundant/444444444, abundant/555555555]; no-divergence [balanced/24681357, balanced/821947219, balanced/111111111, patchwork/24681357, patchwork/3543950664, patchwork/111111111, harsh/821947219, harsh/3543950664, harsh/111111111, abundant/821947219, abundant/3543950664, abundant/111111111].

## Matched evidence

Matching basis: each droughtA pair settles a fresh session on the Task 1 config to tick 60000, forks before intervening (baseline 32 runs never forked), and reads live/control pairs at +1000 (mechanical) and +30000 (ecological). Comparability under AC1 is cited only through the per-pair join to baseline identity (engine + resolvedConfig via archetype/seed/commands).

- balanced/24681357: fork 60000 pop 432; immediate live 345 vs control 441; late live 424 vs control 424 (outcomes Discordant resource use / Discordant resource use); cited no-divergence; join: baseline found engine 0.22.0 configMatch true.
- balanced/821947219: fork 60000 pop 341; immediate live 264 vs control 345; late live 343 vs control 325 (outcomes Adapted generalist dominance / Discordant resource use); cited no-divergence; join: baseline found engine 0.22.0 configMatch true.
- balanced/3543950664: fork 60000 pop 421; immediate live 335 vs control 422; late live 427 vs control 414 (outcomes Discordant resource use / Discordant resource use); cited diverged; join: baseline found engine 0.22.0 configMatch true.
- balanced/111111111: fork 60000 pop 359; immediate live 280 vs control 345; late live 307 vs control 314 (outcomes Discordant resource use / Discordant resource use); cited no-divergence; join: baseline found engine 0.22.0 configMatch true.
- patchwork/24681357: fork 60000 pop 350; immediate live 289 vs control 343; late live 369 vs control 371 (outcomes Discordant resource use / Discordant resource use); cited no-divergence; join: baseline found engine 0.22.0 configMatch true.
- patchwork/821947219: fork 60000 pop 405; immediate live 326 vs control 408; late live 440 vs control 400 (outcomes Discordant resource use / Transient dual-niche partitioning); cited diverged; join: baseline found engine 0.22.0 configMatch true.
- patchwork/3543950664: fork 60000 pop 448; immediate live 358 vs control 459; late live 449 vs control 488 (outcomes Discordant resource use / Discordant resource use); cited no-divergence; join: baseline found engine 0.22.0 configMatch true.
- patchwork/111111111: fork 60000 pop 425; immediate live 379 vs control 449; late live 442 vs control 461 (outcomes Discordant resource use / Discordant resource use); cited no-divergence; join: baseline found engine 0.22.0 configMatch true.
- harsh/24681357: fork 60000 pop 202; immediate live 149 vs control 212; late live 214 vs control 219 (outcomes Adapted generalist dominance / Discordant resource use); cited diverged; join: baseline found engine 0.22.0 configMatch true.
- harsh/821947219: fork 60000 pop 169; immediate live 106 vs control 171; late live 177 vs control 170 (outcomes Discordant resource use / Discordant resource use); cited no-divergence; join: baseline found engine 0.22.0 configMatch true.
- harsh/3543950664: fork 60000 pop 198; immediate live 152 vs control 215; late live 182 vs control 179 (outcomes Discordant resource use / Discordant resource use); cited no-divergence; join: baseline found engine 0.22.0 configMatch true.
- harsh/111111111: fork 60000 pop 151; immediate live 92 vs control 158; late live 161 vs control 156 (outcomes Discordant resource use / Discordant resource use); cited no-divergence; join: baseline found engine 0.22.0 configMatch true.
- abundant/24681357: fork 60000 pop 4313; immediate live 3685 vs control 4350; late live 4543 vs control 4476 (outcomes Discordant resource use / Discordant resource use); cited diverged; join: baseline found engine 0.22.0 configMatch true.
- abundant/821947219: fork 60000 pop 4899; immediate live 4125 vs control 4860; late live 4797 vs control 4934 (outcomes Transient dual-niche partitioning / Discordant resource use); cited no-divergence; join: baseline found engine 0.22.0 configMatch true.
- abundant/3543950664: fork 60000 pop 4905; immediate live 4168 vs control 4905; late live 5071 vs control 4917 (outcomes Discordant resource use / Discordant resource use); cited no-divergence; join: baseline found engine 0.22.0 configMatch true.
- abundant/111111111: fork 60000 pop 4719; immediate live 4019 vs control 4673; late live 4863 vs control 4938 (outcomes Discordant resource use / Discordant resource use); cited no-divergence; join: baseline found engine 0.22.0 configMatch true.

## Mechanistic support

Measured quantities cited: late-pair nutrient A stocks (liveA vs controlA) for divergence; C-share/crossfeeder series for in-use vs weak/transient; waste/nutrient series for accumulation/depletion/cycling; dormant fraction plus wake_clades evidence for established-with-return; tolerance/cleanup shifts for strategy-shift-without-establishment. replacementsObserved=false is never read as evidence against silent richness drift; the clades_active sample series is the drift evidence.

## Not established

- Exactness of engine behaviour: this is characterisation across seeds, not proof that any trajectory is exact.
- Representative-device performance: no attributable representative-device environment in this tranche; desktop/headless timings are harness costs, not device evidence.
- Causal attribution of late-pair divergence to the droughtA intervention beyond the matched comparison: the pairs are descriptive, never causal.
- Ecological reliance on cross-feeding from single-run labels alone: reliance needs matched-assay support; per-run labels top out at in-use.
- Absence of the niche no-response label as a biological finding: it is unreachable under the ported rule (rule artifact).
- Absence of silent richness drift from replacementsObserved=false: the sample series is the drift evidence, not the verdict flag.
- No-divergence readings from null-stock disturbance rows: diverged=false conflates no-divergence with stocks-unobserved.

## Device-performance gap

- no attributable representative-device environment in this tranche; desktop/headless timings are harness costs, not device evidence.

## Supported claims

- Retained 32 baseline runs (balanced/patchwork/harsh/abundant) with per-5000-tick scalar trajectories (up to 50 samples/run).
- Terminal populations range 161..4907 across 32 retained runs; 0 of 32 runs extinct.
- Label distributions are as tabulated (counts, never best-run-only); negative cases are named in the tables.
- 16 matched droughtA pairs retained (fork 60000, immediate +1000, late +30000): 4 diverged, 12 no-divergence, 0 stocks-not-observed; comparability is cited only through the baseline identity join (engine + resolvedConfig).
- Reproducibility spot check: 2/2 re-runs identical in tick, population, and scalar-sample hash under the current engine determinism contract.

## Not-supported claims

- Exactness of engine behaviour: this is characterisation across seeds, not proof that any trajectory is exact.
- Representative-device performance: no attributable representative-device environment in this tranche; desktop/headless timings are harness costs, not device evidence.
- Causal attribution of late-pair divergence to the droughtA intervention beyond the matched comparison: the pairs are descriptive, never causal.
- Ecological reliance on cross-feeding from single-run labels alone: reliance needs matched-assay support; per-run labels top out at in-use.
- Absence of the niche no-response label as a biological finding: it is unreachable under the ported rule (rule artifact).
- Absence of silent richness drift from replacementsObserved=false: the sample series is the drift evidence, not the verdict flag.
- No-divergence readings from null-stock disturbance rows: diverged=false conflates no-divergence with stocks-unobserved.

## Biology defects

- No biology defect observed in the retained artifact. None fixed: this generator is read-only.

## Reproducibility spot check

Re-ran 2 retained baseline runs (first + one extinct/edge if present, else last) with identical engine/config/seed/commands; asserted identical tick, population, and stable hash of the retained scalar samples.
- balanced/24681357: match=true (tick true, population true, hash true)
- abundant/555555555: match=true (tick true, population true, hash true)
