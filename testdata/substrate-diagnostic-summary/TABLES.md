# Substrate diagnostic — compact evidence tables

Engine `0.24.0`, commit `unset`.
Every value below is copied from the probe output, not recomputed. The raw JSONL
is a CI artifact with a retention window; this file plus the diagnostic scripts are
the authoritative record.

## Q-A1 reproductive concentration

| regime | seed | organisms | births | everReproduced | share | repeatBirthShare | top10%lineages | deaths | reproEligible | blockedBirths | dormancyEntries | wakes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| replete | 111111111 | 12826 | 12796 | 5492 | 0.4282 | 0.8113 | 0.8181 |  |  |  |  |  |
| replete | 222222222 | 12973 | 12943 | 5673 | 0.4373 | 0.7947 | 0.8234 |  |  |  |  |  |
| replete | 333333333 | 12503 | 12473 | 5404 | 0.4322 | 0.8053 | 0.8128 |  |  |  |  |  |
| replete | 444444444 | 10789 | 10759 | 4588 | 0.4252 | 0.8043 | 0.8176 |  |  |  |  |  |
| replete | 555555555 | 12646 | 12616 | 5488 | 0.434 | 0.7983 | 0.8253 |  |  |  |  |  |
| marginal | 111111111 | 6012 | 5982 | 2663 | 0.4429 | 0.8119 | 0.7616 |  |  |  |  |  |
| marginal | 222222222 | 5770 | 5740 | 2520 | 0.4367 | 0.8143 | 0.7641 |  |  |  |  |  |
| marginal | 333333333 | 6101 | 6071 | 2728 | 0.4471 | 0.8109 | 0.7559 |  |  |  |  |  |
| marginal | 444444444 | 5617 | 5587 | 2401 | 0.4275 | 0.8158 | 0.7802 |  |  |  |  |  |
| marginal | 555555555 | 5977 | 5947 | 2628 | 0.4397 | 0.8128 | 0.7469 |  |  |  |  |  |
| scarce | 111111111 | 1556 | 1526 | 701 | 0.4505 | 0.7942 | 0.7484 |  |  |  |  |  |
| scarce | 222222222 | 1449 | 1419 | 653 | 0.4507 | 0.7893 | 0.7216 |  |  |  |  |  |
| scarce | 333333333 | 1322 | 1292 | 604 | 0.4569 | 0.7941 | 0.6904 |  |  |  |  |  |
| scarce | 444444444 | 1838 | 1808 | 821 | 0.4467 | 0.8086 | 0.7528 |  |  |  |  |  |
| scarce | 555555555 | 1571 | 1541 | 720 | 0.4583 | 0.7865 | 0.7508 |  |  |  |  |  |

## Q-A2 matched parent vs newborn value

| regime | seed | surplus | ctrlBirths | parentBirths | newbornBirths | parentDelta | newbornDelta | ratio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| replete | 111111111 | 20 | 54 | 54 | 54 | 0 | 0 | n/a |
| replete | 111111111 | 50 | 54 | 54 | 54 | 0 | 0 | n/a |
| replete | 111111111 | 100 | 54 | 54 | 54 | 0 | 0 | n/a |
| replete | 222222222 | 20 | 33 | 33 | 33 | 0 | 0 | n/a |
| replete | 222222222 | 50 | 33 | 33 | 33 | 0 | 0 | n/a |
| replete | 222222222 | 100 | 33 | 33 | 33 | 0 | 0 | n/a |
| replete | 333333333 | 20 | 780 | 780 | 780 | 0 | 0 | n/a |
| replete | 333333333 | 50 | 780 | 780 | 780 | 0 | 0 | n/a |
| replete | 333333333 | 100 | 780 | 780 | 780 | 0 | 0 | n/a |
| replete | 444444444 | 20 | 37 | 37 | 37 | 0 | 0 | n/a |
| replete | 444444444 | 50 | 37 | 37 | 37 | 0 | 0 | n/a |
| replete | 444444444 | 100 | 37 | 37 | 37 | 0 | 0 | n/a |
| replete | 555555555 | 20 | 622 | 622 | 622 | 0 | 0 | n/a |
| replete | 555555555 | 50 | 622 | 622 | 622 | 0 | 0 | n/a |
| replete | 555555555 | 100 | 622 | 622 | 622 | 0 | 0 | n/a |
| marginal | 111111111 | 20 | 17 | 17 | 17 | 0 | 0 | n/a |
| marginal | 111111111 | 50 | 17 | 17 | 17 | 0 | 0 | n/a |
| marginal | 111111111 | 100 | 17 | 17 | 17 | 0 | 0 | n/a |
| marginal | 222222222 | 20 | 30 | 30 | 30 | 0 | 0 | n/a |
| marginal | 222222222 | 50 | 30 | 30 | 30 | 0 | 0 | n/a |
| marginal | 222222222 | 100 | 30 | 30 | 30 | 0 | 0 | n/a |
| marginal | 333333333 | 20 | 572 | 572 | 572 | 0 | 0 | n/a |
| marginal | 333333333 | 50 | 572 | 572 | 572 | 0 | 0 | n/a |
| marginal | 333333333 | 100 | 572 | 572 | 572 | 0 | 0 | n/a |
| marginal | 444444444 | 20 | 12 | 12 | 12 | 0 | 0 | n/a |
| marginal | 444444444 | 50 | 12 | 12 | 10 | 0 | -2 | 0 |
| marginal | 444444444 | 100 | 12 | 13 | 8 | 1 | -4 | -0.25 |
| marginal | 555555555 | 20 | 232 | 232 | 232 | 0 | 0 | n/a |
| marginal | 555555555 | 50 | 232 | 232 | 232 | 0 | 0 | n/a |
| marginal | 555555555 | 100 | 232 | 232 | 232 | 0 | 0 | n/a |
| scarce | 111111111 | 20 | 4 | 41 | 9 | 37 | 5 | 7.4 |
| scarce | 111111111 | 50 | 4 | 43 | 22 | 39 | 18 | 2.167 |
| scarce | 111111111 | 100 | 4 | 59 | 1 | 55 | -3 | -18.333 |
| scarce | 222222222 | 20 | 2 | 1 | 0 | -1 | -2 | 0.5 |
| scarce | 222222222 | 50 | 2 | 9 | 1 | 7 | -1 | -7 |
| scarce | 222222222 | 100 | 2 | 7 | 1 | 5 | -1 | -5 |
| scarce | 333333333 | 20 | 119 | 91 | 58 | -28 | -61 | 0.459 |
| scarce | 333333333 | 50 | 119 | 164 | 99 | 45 | -20 | -2.25 |
| scarce | 333333333 | 100 | 119 | 102 | 150 | -17 | 31 | -0.548 |
| scarce | 444444444 | 20 | 0 | 0 | 1 | 0 | 1 | 0 |
| scarce | 444444444 | 50 | 0 | 1 | 1 | 1 | 1 | 1 |
| scarce | 444444444 | 100 | 0 | 1 | 1 | 1 | 1 | 1 |
| scarce | 555555555 | 20 | 0 | 1 | 9 | 1 | 9 | 0.111 |
| scarce | 555555555 | 50 | 0 | 17 | 4 | 17 | 4 | 4.25 |
| scarce | 555555555 | 100 | 0 | 33 | 9 | 33 | 9 | 3.667 |

## Q-B population context

| regime | seed | population | dormant% | mature% | eligible% | born | reproduced | establishmentRate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| replete | 111111111 | 934 | 55.9 | 64.53 | 0.09 | 12826 | 5492 | 0.4282 |
| replete | 222222222 | 1069 | 59.52 | 67.64 | 0.12 | 12973 | 5673 | 0.4373 |
| replete | 333333333 | 979 | 56.78 | 64.77 | 0.1 | 12503 | 5404 | 0.4322 |
| replete | 444444444 | 710 | 57.89 | 64.82 | 0.13 | 10789 | 4588 | 0.4252 |
| replete | 555555555 | 825 | 57.24 | 64.97 | 0.14 | 12646 | 5488 | 0.434 |
| marginal | 111111111 | 433 | 54.16 | 64.53 | 0.04 | 6012 | 2663 | 0.4429 |
| marginal | 222222222 | 412 | 56.65 | 64.09 | 0.04 | 5770 | 2520 | 0.4367 |
| marginal | 333333333 | 466 | 55.57 | 64.42 | 0.04 | 6101 | 2728 | 0.4471 |
| marginal | 444444444 | 335 | 58.23 | 64.2 | 0.05 | 5617 | 2401 | 0.4275 |
| marginal | 555555555 | 434 | 58.15 | 66.74 | 0.04 | 5977 | 2628 | 0.4397 |
| scarce | 111111111 | 129 | 63.81 | 72.08 | 0.03 | 1556 | 701 | 0.4505 |
| scarce | 222222222 | 139 | 61.96 | 69.8 | 0.03 | 1449 | 653 | 0.4507 |
| scarce | 333333333 | 107 | 62.68 | 71.81 | 0.03 | 1322 | 604 | 0.4569 |
| scarce | 444444444 | 164 | 61.32 | 66.31 | 0.04 | 1838 | 821 | 0.4467 |
| scarce | 555555555 | 126 | 64.65 | 71.71 | 0.03 | 1571 | 720 | 0.4583 |

## Q-C selection gradients (positive = favours HIGH trait value)

| trait | regime | seed | low | high | births | flowGrad | stockGrad | degenerate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| speed | replete | 111111111 | 1.0762 | 1.3211 | 9640 | 0.4091 | 0.4233 | no |
| speed | replete | 222222222 | 0.9783 | 1.2167 | 8847 | -0.2737 | -1 | no |
| speed | replete | 333333333 | 1.0392 | 1.2927 | 9114 | -0.3704 | -0.7589 | no |
| speed | replete | 444444444 | 1.1017 | 1.3277 | 9443 | -0.554 | -0.3408 | no |
| speed | replete | 555555555 | 1.1213 | 1.3084 | 9185 | -0.4282 | -0.998 | no |
| speed | marginal | 111111111 | 1.0762 | 1.3211 | 4571 | 0.8648 | 1 | no |
| speed | marginal | 222222222 | 0.9783 | 1.2167 | 4377 | 0.4183 | 0.9163 | no |
| speed | marginal | 333333333 | 1.0392 | 1.2927 | 4359 | -0.1452 | -0.467 | no |
| speed | marginal | 444444444 | 1.1017 | 1.3277 | 4862 | 0.8264 | 1 | no |
| speed | marginal | 555555555 | 1.1213 | 1.3084 | 4227 | -0.1162 | -0.1268 | no |
| speed | scarce | 111111111 | 1.0762 | 1.3211 | 1100 | 0.8164 | 1 | no |
| speed | scarce | 222222222 | 0.9783 | 1.2167 | 1176 | -0.102 | 0.0972 | no |
| speed | scarce | 333333333 | 1.0392 | 1.2927 | 1030 | -0.4447 | -0.75 | no |
| speed | scarce | 444444444 | 1.1017 | 1.3277 | 1423 | 0.4195 | 0.4876 | no |
| speed | scarce | 555555555 | 1.1213 | 1.3084 | 1064 | -0.4305 | 0.6 | no |
| reproduction | replete | 111111111 | 85.6992 | 106.0247 | 7718 | 0.2464 | 0.1625 | no |
| reproduction | replete | 222222222 | 83.6565 | 101.3895 | 8749 | -0.4356 | -1 | no |
| reproduction | replete | 333333333 | 83.0788 | 100.2753 | 8140 | -0.7553 | -1 | no |
| reproduction | replete | 444444444 | 84.5098 | 105.4648 | 8184 | -0.7742 | -1 | no |
| reproduction | replete | 555555555 | 83.086 | 101.8957 | 8325 | -0.3151 | -0.8812 | no |
| reproduction | marginal | 111111111 | 85.6992 | 106.0247 | 3751 | 0.1698 | 0.6835 | no |
| reproduction | marginal | 222222222 | 83.6565 | 101.3895 | 3628 | 0.5447 | 0.3643 | no |
| reproduction | marginal | 333333333 | 83.0788 | 100.2753 | 3821 | -0.6038 | -0.7861 | no |
| reproduction | marginal | 444444444 | 84.5098 | 105.4648 | 4236 | -0.8626 | -1 | no |
| reproduction | marginal | 555555555 | 83.086 | 101.8957 | 3891 | 0.2238 | 0.8928 | no |
| reproduction | scarce | 111111111 | 85.6992 | 106.0247 | 866 | 0.7506 | 1 | no |
| reproduction | scarce | 222222222 | 83.6565 | 101.3895 | 991 | 0.2775 | 0.8545 | no |
| reproduction | scarce | 333333333 | 83.0788 | 100.2753 | 935 | -0.8203 | -1 | no |
| reproduction | scarce | 444444444 | 84.5098 | 105.4648 | 1188 | -0.9125 | -1 | no |
| reproduction | scarce | 555555555 | 83.086 | 101.8957 | 978 | 0.1759 | 0.1905 | no |
| dormancy_response | replete | 111111111 | 0.4016 | 0.5672 | 9193 | 0.1981 | 0.1341 | no |
| dormancy_response | replete | 222222222 | 0.3923 | 0.5699 | 9409 | -0.6314 | -1 | no |
| dormancy_response | replete | 333333333 | 0.3795 | 0.557 | 8918 | -0.6546 | -1 | no |
| dormancy_response | replete | 444444444 | 0.4269 | 0.5895 | 9289 | -0.0488 | -0.4887 | no |
| dormancy_response | replete | 555555555 | 0.4165 | 0.5979 | 9536 | -0.6395 | -0.9382 | no |
| dormancy_response | marginal | 111111111 | 0.4016 | 0.5672 | 4364 | 0.6416 | 1 | no |
| dormancy_response | marginal | 222222222 | 0.3923 | 0.5699 | 4161 | 0.3107 | 0.8357 | no |
| dormancy_response | marginal | 333333333 | 0.3795 | 0.557 | 4185 | -0.4815 | -0.5389 | no |
| dormancy_response | marginal | 444444444 | 0.4269 | 0.5895 | 4465 | -0.8719 | -1 | no |
| dormancy_response | marginal | 555555555 | 0.4165 | 0.5979 | 4419 | -0.4736 | -0.884 | no |
| dormancy_response | scarce | 111111111 | 0.4016 | 0.5672 | 1146 | 0.9058 | 1 | no |
| dormancy_response | scarce | 222222222 | 0.3923 | 0.5699 | 1090 | 0.4459 | 0.646 | no |
| dormancy_response | scarce | 333333333 | 0.3795 | 0.557 | 967 | -0.4312 | -0.3665 | no |
| dormancy_response | scarce | 444444444 | 0.4269 | 0.5895 | 1282 | -0.8596 | -1 | no |
| dormancy_response | scarce | 555555555 | 0.4165 | 0.5979 | 1114 | -0.6122 | -0.4069 | no |
| tolerance | replete | 111111111 | 0.1268 | 0.2002 | 9135 | 0.6681 | 0.8859 | no |
| tolerance | replete | 222222222 | 0.1394 | 0.2236 | 9231 | -0.342 | -0.7146 | no |
| tolerance | replete | 333333333 | 0.1459 | 0.1998 | 8462 | -0.8353 | -1 | no |
| tolerance | replete | 444444444 | 0.1404 | 0.205 | 9219 | -0.0715 | -0.3756 | no |
| tolerance | replete | 555555555 | 0.1235 | 0.2019 | 8238 | 0.6502 | 0.3978 | no |
| tolerance | marginal | 111111111 | 0.1268 | 0.2002 | 4232 | 0.7155 | 1 | no |
| tolerance | marginal | 222222222 | 0.1394 | 0.2236 | 3933 | 0.8454 | 1 | no |
| tolerance | marginal | 333333333 | 0.1459 | 0.1998 | 4151 | -0.7962 | -1 | no |
| tolerance | marginal | 444444444 | 0.1404 | 0.205 | 4540 | -0.8502 | -1 | no |
| tolerance | marginal | 555555555 | 0.1235 | 0.2019 | 4213 | -0.3287 | -0.5396 | no |
| tolerance | scarce | 111111111 | 0.1268 | 0.2002 | 1116 | 0.9211 | 1 | no |
| tolerance | scarce | 222222222 | 0.1394 | 0.2236 | 1086 | 0.7385 | 1 | no |
| tolerance | scarce | 333333333 | 0.1459 | 0.1998 | 1037 | -0.595 | -0.3676 | no |
| tolerance | scarce | 444444444 | 0.1404 | 0.205 | 1296 | -0.8873 | -1 | no |
| tolerance | scarce | 555555555 | 0.1235 | 0.2019 | 1108 | -0.6372 | -0.7188 | no |
| cleanup | replete | 111111111 | 0.1067 | 0.1836 | 9428 | 0.5859 | 0.6556 | no |
| cleanup | replete | 222222222 | 0.1529 | 0.2307 | 9074 | -0.423 | -0.6512 | no |
| cleanup | replete | 333333333 | 0.1336 | 0.1873 | 9329 | -0.7181 | -1 | no |
| cleanup | replete | 444444444 | 0.1307 | 0.2023 | 8292 | -0.3186 | -0.9791 | no |
| cleanup | replete | 555555555 | 0.1115 | 0.1931 | 10540 | 0.7989 | 1 | no |
| cleanup | marginal | 111111111 | 0.1067 | 0.1836 | 4352 | 0.608 | 0.3415 | no |
| cleanup | marginal | 222222222 | 0.1529 | 0.2307 | 4070 | 0.8029 | 1 | no |
| cleanup | marginal | 333333333 | 0.1336 | 0.1873 | 4182 | -0.5543 | -0.5452 | no |
| cleanup | marginal | 444444444 | 0.1307 | 0.2023 | 4486 | -0.8301 | -1 | no |
| cleanup | marginal | 555555555 | 0.1115 | 0.1931 | 4810 | 0.4595 | 0.5136 | no |
| cleanup | scarce | 111111111 | 0.1067 | 0.1836 | 1156 | 0.9394 | 1 | no |
| cleanup | scarce | 222222222 | 0.1529 | 0.2307 | 1121 | 0.8733 | 1 | no |
| cleanup | scarce | 333333333 | 0.1336 | 0.1873 | 1155 | -0.645 | -0.3913 | no |
| cleanup | scarce | 444444444 | 0.1307 | 0.2023 | 1195 | -0.8778 | -1 | no |
| cleanup | scarce | 555555555 | 0.1115 | 0.1931 | 1321 | 0.7653 | 0.9205 | no |

## Q-C regime reversal verdicts

| trait | replete | marginal | scarce | verdict |
| --- | --- | --- | --- | --- |
| movement speed | mixed (drift/noise) | mixed (drift/noise) | mixed (drift/noise) | no opposing signal |
| reproduction threshold | mixed (drift/noise) | mixed (drift/noise) | mixed (drift/noise) | no opposing signal |
| dormancy response | mixed (drift/noise) | mixed (drift/noise) | mixed (drift/noise) | no opposing signal |
| waste tolerance | mixed (drift/noise) | mixed (drift/noise) | mixed (drift/noise) | no opposing signal |
| waste cleanup | mixed (drift/noise) | mixed (drift/noise) | mixed (drift/noise) | no opposing signal |

## Q-D perturbation liveness gate

| config | seed | perturbation | axis | factor | live |
| --- | --- | --- | --- | --- | --- |
| patchwork | 111111111 | mr- | mr | 0.75 | true |
| patchwork | 111111111 | mr+ | mr | 1.25 | true |
| patchwork | 111111111 | ms- | ms | 0.75 | true |
| patchwork | 111111111 | ms+ | ms | 1.25 | true |
| patchwork | 111111111 | div- | div | 0.75 | true |
| patchwork | 111111111 | div+ | div | 1.25 | true |
| patchwork | 111111111 | press- | press | 0.95 | true |
| patchwork | 111111111 | press+ | press | 1.05 | true |
| patchwork | 222222222 | mr- | mr | 0.75 | true |
| patchwork | 222222222 | mr+ | mr | 1.25 | true |
| patchwork | 222222222 | ms- | ms | 0.75 | true |
| patchwork | 222222222 | ms+ | ms | 1.25 | true |
| patchwork | 222222222 | div- | div | 0.75 | true |
| patchwork | 222222222 | div+ | div | 1.25 | true |
| patchwork | 222222222 | press- | press | 0.95 | true |
| patchwork | 222222222 | press+ | press | 1.05 | true |
| patchwork | 333333333 | mr- | mr | 0.75 | true |
| patchwork | 333333333 | mr+ | mr | 1.25 | true |
| patchwork | 333333333 | ms- | ms | 0.75 | true |
| patchwork | 333333333 | ms+ | ms | 1.25 | true |
| patchwork | 333333333 | div- | div | 0.75 | true |
| patchwork | 333333333 | div+ | div | 1.25 | true |
| patchwork | 333333333 | press- | press | 0.95 | true |
| patchwork | 333333333 | press+ | press | 1.05 | true |
| patchwork | 444444444 | mr- | mr | 0.75 | true |
| patchwork | 444444444 | mr+ | mr | 1.25 | true |
| patchwork | 444444444 | ms- | ms | 0.75 | true |
| patchwork | 444444444 | ms+ | ms | 1.25 | true |
| patchwork | 444444444 | div- | div | 0.75 | true |
| patchwork | 444444444 | div+ | div | 1.25 | true |
| patchwork | 444444444 | press- | press | 0.95 | true |
| patchwork | 444444444 | press+ | press | 1.05 | true |
| patchwork | 555555555 | mr- | mr | 0.75 | true |
| patchwork | 555555555 | mr+ | mr | 1.25 | true |
| patchwork | 555555555 | ms- | ms | 0.75 | true |
| patchwork | 555555555 | ms+ | ms | 1.25 | true |
| patchwork | 555555555 | div- | div | 0.75 | true |
| patchwork | 555555555 | div+ | div | 1.25 | true |
| patchwork | 555555555 | press- | press | 0.95 | true |
| patchwork | 555555555 | press+ | press | 1.05 | true |
| balanced | 111111111 | mr- | mr | 0.75 | true |
| balanced | 111111111 | mr+ | mr | 1.25 | true |
| balanced | 111111111 | ms- | ms | 0.75 | true |
| balanced | 111111111 | ms+ | ms | 1.25 | true |
| balanced | 111111111 | div- | div | 0.75 | true |
| balanced | 111111111 | div+ | div | 1.25 | true |
| balanced | 111111111 | press- | press | 0.95 | true |
| balanced | 111111111 | press+ | press | 1.05 | true |
| balanced | 222222222 | mr- | mr | 0.75 | true |
| balanced | 222222222 | mr+ | mr | 1.25 | true |
| balanced | 222222222 | ms- | ms | 0.75 | true |
| balanced | 222222222 | ms+ | ms | 1.25 | true |
| balanced | 222222222 | div- | div | 0.75 | true |
| balanced | 222222222 | div+ | div | 1.25 | true |
| balanced | 222222222 | press- | press | 0.95 | true |
| balanced | 222222222 | press+ | press | 1.05 | true |
| balanced | 333333333 | mr- | mr | 0.75 | true |
| balanced | 333333333 | mr+ | mr | 1.25 | true |
| balanced | 333333333 | ms- | ms | 0.75 | true |
| balanced | 333333333 | ms+ | ms | 1.25 | true |
| balanced | 333333333 | div- | div | 0.75 | true |
| balanced | 333333333 | div+ | div | 1.25 | true |
| balanced | 333333333 | press- | press | 0.95 | true |
| balanced | 333333333 | press+ | press | 1.05 | true |
| balanced | 444444444 | mr- | mr | 0.75 | true |
| balanced | 444444444 | mr+ | mr | 1.25 | true |
| balanced | 444444444 | ms- | ms | 0.75 | true |
| balanced | 444444444 | ms+ | ms | 1.25 | true |
| balanced | 444444444 | div- | div | 0.75 | true |
| balanced | 444444444 | div+ | div | 1.25 | true |
| balanced | 444444444 | press- | press | 0.95 | true |
| balanced | 444444444 | press+ | press | 1.05 | true |
| balanced | 555555555 | mr- | mr | 0.75 | true |
| balanced | 555555555 | mr+ | mr | 1.25 | true |
| balanced | 555555555 | ms- | ms | 0.75 | true |
| balanced | 555555555 | ms+ | ms | 1.25 | true |
| balanced | 555555555 | div- | div | 0.75 | true |
| balanced | 555555555 | div+ | div | 1.25 | true |
| balanced | 555555555 | press- | press | 0.95 | true |
| balanced | 555555555 | press+ | press | 1.05 | true |

## Q-D protected capability state

| config | seed | perturbation | niche | dep | seedBank | partitioning | returnedClades | population |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| patchwork | 111111111 | none | absent | established | established | false | 9 | 436 |
| patchwork | 111111111 | mr- | absent | established | established | false | 5 | 497 |
| patchwork | 111111111 | mr+ | absent | established | established | false | 3 | 448 |
| patchwork | 111111111 | ms- | absent | established | established | false | 6 | 525 |
| patchwork | 111111111 | ms+ | absent | established | established | false | 6 | 501 |
| patchwork | 111111111 | div- | absent | established | established | false | 7 | 457 |
| patchwork | 111111111 | div+ | absent | established | established | false | 7 | 508 |
| patchwork | 111111111 | press- | absent | absent | established | false | 7 | 518 |
| patchwork | 111111111 | press+ | absent | disrupted | established | false | 5 | 476 |
| patchwork | 222222222 | none | absent | absent | established | false | 9 | 418 |
| patchwork | 222222222 | mr- | absent | established | established | false | 9 | 612 |
| patchwork | 222222222 | mr+ | absent | established | established | false | 11 | 568 |
| patchwork | 222222222 | ms- | absent | absent | established | false | 10 | 556 |
| patchwork | 222222222 | ms+ | absent | disrupted | established | false | 13 | 561 |
| patchwork | 222222222 | div- | absent | established | established | false | 9 | 475 |
| patchwork | 222222222 | div+ | absent | absent | established | false | 7 | 454 |
| patchwork | 222222222 | press- | absent | absent | established | false | 8 | 599 |
| patchwork | 222222222 | press+ | absent | absent | established | false | 6 | 481 |
| patchwork | 333333333 | none | forming | established | established | false | 2 | 196 |
| patchwork | 333333333 | mr- | absent | disrupted | established | true | 9 | 452 |
| patchwork | 333333333 | mr+ | absent | established | established | false | 2 | 265 |
| patchwork | 333333333 | ms- | forming | established | established | false | 2 | 289 |
| patchwork | 333333333 | ms+ | absent | established | established | false | 3 | 398 |
| patchwork | 333333333 | div- | absent | established | established | false | 8 | 372 |
| patchwork | 333333333 | div+ | absent | established | established | false | 7 | 402 |
| patchwork | 333333333 | press- | absent | established | established | false | 9 | 561 |
| patchwork | 333333333 | press+ | absent | established | established | false | 10 | 466 |
| patchwork | 444444444 | none | absent | established | established | false | 7 | 436 |
| patchwork | 444444444 | mr- | absent | established | established | false | 8 | 407 |
| patchwork | 444444444 | mr+ | absent | established | established | false | 6 | 528 |
| patchwork | 444444444 | ms- | absent | absent | established | false | 9 | 465 |
| patchwork | 444444444 | ms+ | absent | established | established | false | 10 | 429 |
| patchwork | 444444444 | div- | absent | established | established | false | 8 | 420 |
| patchwork | 444444444 | div+ | absent | forming | established | false | 11 | 490 |
| patchwork | 444444444 | press- | absent | established | established | false | 9 | 494 |
| patchwork | 444444444 | press+ | absent | disrupted | established | false | 12 | 381 |
| patchwork | 555555555 | none | absent | established | established | false | 6 | 492 |
| patchwork | 555555555 | mr- | absent | established | established | false | 7 | 530 |
| patchwork | 555555555 | mr+ | forming | established | established | false | 3 | 270 |
| patchwork | 555555555 | ms- | forming | established | established | false | 9 | 163 |
| patchwork | 555555555 | ms+ | absent | established | established | false | 4 | 423 |
| patchwork | 555555555 | div- | absent | disrupted | established | false | 9 | 457 |
| patchwork | 555555555 | div+ | absent | established | established | false | 10 | 504 |
| patchwork | 555555555 | press- | absent | established | established | false | 3 | 499 |
| patchwork | 555555555 | press+ | absent | established | established | false | 5 | 445 |
| balanced | 111111111 | none | absent | established | established | false | 4 | 397 |
| balanced | 111111111 | mr- | absent | disrupted | established | false | 2 | 383 |
| balanced | 111111111 | mr+ | absent | established | established | false | 6 | 395 |
| balanced | 111111111 | ms- | absent | absent | established | false | 8 | 434 |
| balanced | 111111111 | ms+ | absent | established | established | false | 3 | 380 |
| balanced | 111111111 | div- | absent | established | established | true | 7 | 394 |
| balanced | 111111111 | div+ | absent | established | established | false | 5 | 388 |
| balanced | 111111111 | press- | absent | established | established | false | 6 | 437 |
| balanced | 111111111 | press+ | absent | established | established | false | 3 | 319 |
| balanced | 222222222 | none | absent | established | established | false | 5 | 399 |
| balanced | 222222222 | mr- | absent | established | established | false | 5 | 422 |
| balanced | 222222222 | mr+ | absent | absent | established | false | 8 | 384 |
| balanced | 222222222 | ms- | absent | absent | established | false | 6 | 368 |
| balanced | 222222222 | ms+ | absent | established | established | false | 6 | 403 |
| balanced | 222222222 | div- | absent | absent | established | false | 3 | 401 |
| balanced | 222222222 | div+ | absent | forming | established | false | 5 | 428 |
| balanced | 222222222 | press- | absent | established | established | false | 4 | 555 |
| balanced | 222222222 | press+ | absent | established | established | false | 5 | 351 |
| balanced | 333333333 | none | absent | established | established | true | 9 | 443 |
| balanced | 333333333 | mr- | absent | established | established | false | 4 | 383 |
| balanced | 333333333 | mr+ | absent | disrupted | established | false | 5 | 364 |
| balanced | 333333333 | ms- | absent | established | established | false | 5 | 447 |
| balanced | 333333333 | ms+ | forming | disrupted | established | false | 5 | 122 |
| balanced | 333333333 | div- | absent | established | established | false | 5 | 404 |
| balanced | 333333333 | div+ | absent | established | established | false | 0 | 337 |
| balanced | 333333333 | press- | absent | established | established | false | 7 | 434 |
| balanced | 333333333 | press+ | forming | established | established | false | 7 | 133 |
| balanced | 444444444 | none | absent | absent | established | false | 6 | 377 |
| balanced | 444444444 | mr- | absent | established | established | false | 6 | 424 |
| balanced | 444444444 | mr+ | absent | established | established | false | 6 | 401 |
| balanced | 444444444 | ms- | absent | absent | established | false | 4 | 300 |
| balanced | 444444444 | ms+ | absent | established | established | false | 3 | 448 |
| balanced | 444444444 | div- | absent | established | established | false | 9 | 432 |
| balanced | 444444444 | div+ | absent | established | established | false | 9 | 466 |
| balanced | 444444444 | press- | absent | forming | established | false | 10 | 442 |
| balanced | 444444444 | press+ | absent | established | established | false | 7 | 405 |
| balanced | 555555555 | none | absent | established | established | false | 9 | 490 |
| balanced | 555555555 | mr- | absent | established | established | false | 4 | 454 |
| balanced | 555555555 | mr+ | absent | established | established | false | 2 | 384 |
| balanced | 555555555 | ms- | absent | absent | established | false | 2 | 441 |
| balanced | 555555555 | ms+ | absent | established | established | false | 2 | 430 |
| balanced | 555555555 | div- | absent | absent | established | false | 4 | 346 |
| balanced | 555555555 | div+ | absent | established | established | false | 0 | 385 |
| balanced | 555555555 | press- | absent | disrupted | established | false | 4 | 451 |
| balanced | 555555555 | press+ | absent | established | established | false | 1 | 301 |
