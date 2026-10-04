# Project Test Plan

> This file tracks test scenarios for implemented features. The AI should add and
> update test cases as features are built, and keep their status current.

## Testing Strategy

Authoritative contract: `tools/validation/manifest.ts`, run via `pnpm verify`
(blocking repo contract). A handoff's validation list is a floor, not a
substitute — completion needs the handoff's named checks **and** every blocking
unit/CI shard the manifest routes for the diff.

- Unit Tests: `pnpm test:*` Node suites (deterministic behaviour, parity,
  contracts) — e.g. `test:migration`, `test:flows`, `test:decisions`,
  `test:niche`, `test:catalysts`, `test:aftermath`, `test:validation-arch`
- Integration Tests: session lifecycle/forking/pause gating (`test:flows`),
  checkpoint round-trips, worker settlement
- API Tests: typed contract boundaries (`typecheck`, `test:validation-arch`);
  no network API exists (offline-first)
- UI Tests: browser class — `test:browser` (production Pixi smoke), `test:mobile-ui`
  (phone/tablet/desktop viewports), and `test:pixi-world` (blocking production
  Pixi module lifecycle/resource proof)
- End-to-End Tests: CI shards (`quick`, `sim-*`, `build`, `presentation`,
  `smoke`, `android/*`); `pixi-world-proof` is blocking browser evidence,
  while human-review captures such as `visual-capture` and `pixi-capture`
  remain non-gating evidence

## Feature Test Cases

<!--
Reference the requirement ID being tested in the Test Case column (e.g.
REQ-CORE-001) so `vibecoding trace` can link tests back to requirements.
"Covered by" names the existing suite that owns the claim; the manifest is
authoritative for what is actually evidenced.
-->

### Feature: Deterministic engine core

| ID | Test Case | Expected Result | Status |
|---|---|---|---|
| TC-SIM-001 | Determinism + parity (REQ-SIM-001) | Identical commands reproduce identical state; checkpoint parity holds | Covered by `test:migration`, `test:flows` |
| TC-SIM-002 | Authority boundaries (REQ-SIM-003) | sim-core carries no internal observer; analysis never mutates biology | Covered by `test:migration` (single-analysis-authority) |
| TC-SIM-003 | Checkpoint migration + rejection (REQ-SIM-001) | Named historical omissions migrate; invalid payloads fail explicitly pre-live-state | Covered by `test:flows`; A3.3 merged in PR #70 |

### Feature: Events, clades, decisions

| ID | Test Case | Expected Result | Status |
|---|---|---|---|
| TC-EVT-001 | Event→choice mapping stable (REQ-EVENT-002) | Same observed events offer the same choices | Covered by `test:decisions` |
| TC-EVT-002 | Typed identity, no mislabel (REQ-CLADE-001) | `L-` only for lineage, `C-` only for clade; unknown kinds unlabeled | Covered by `test:validation-arch` + in-app verification |
| TC-EVT-003 | Catalyst effects exact (REQ-EXP-001) | Offered interventions produce documented effects | Covered by `test:catalysts` |

### Feature: Explorer shell

| ID | Test Case | Expected Result | Status |
|---|---|---|---|
| TC-UX-001 | Browser smoke (REQ-UX-001) | Worker, canvas, control surface function in a real browser | Covered by `test:browser` |
| TC-UX-002 | Mobile layouts (REQ-UX-001) | Phone/tablet/desktop viewports usable | Covered by `test:mobile-ui` |
| TC-GRAPH-001 | Production Pixi lifecycle/resources (REQ-GRAPH-001) | Pixi WebGL2 modules boot and resize, upload nearest textures, retire texture/source and world resources, and tear down; integrated World semantics are covered separately | Covered by blocking `test:pixi-world` / `pixi-world-proof`, `test:browser`, and `test:mobile-ui` |

## Bugs / Failed Tests

None tracked here — failures are tracked in the active PR/CI run, not in this file.

## Testing Notes

`test:provenance` is `scientific`/`manual` and concerns engine distribution
constants, not evidence-export provenance — do not cite it for export claims.
`visual-capture`/`pixi-capture` are non-gating evidence; PNG human review has
caught defects that canvas assertions passed.
