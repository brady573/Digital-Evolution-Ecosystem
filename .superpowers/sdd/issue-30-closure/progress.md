# SDD ledger — plan: Issue #30 closure handoff doc §21.6 sequence (spec: Google Doc 1N0Ps4OigeIfLhjTa1adTKmmxcZ3u9BtoeodGoEJ6Wa8)

## Setup
- Baseline spec: Issue #30 closure handoff §20 (BioProcess contract) + §21 (post-verify rulings)
- Base commit: origin/main = 26a712d (local main 438435d is 1 behind; handoff names 438435d as audit baseline)
- Workspace branch: issue-30-closure-v2 (validation-architecture left untouched, other stream still active)
- Rescue refs: rescue/issue30-51-process (ed4ecbe), rescue/issue30-washout-horizon (98a2559)

## Pre-flight
- Ruling: a concurrent reset of validation-architecture dropped ed4ecbe (§5.1) and 98a2559 from HEAD
  and from the working tree. Commits survived as objects; secured on rescue/* branches.
  Consequence: the earlier "pnpm verify 21/21 green" was measured on a head that no longer
  exists and does NOT cover §5.1. Must re-verify on the submitted head (handoff §21.6 step 5).
  Cost if wrong: one re-verify cycle.
- Ruling: transplant closure-only diffs onto a fresh branch off origin/main rather than
  rebase onto the interleaved branch (handoff §21.5 explicitly prefers isolation over
  preserving messy topology).
  Cost if wrong: a later rebase if the other stream's manifest architecture must land first.

## Tasks
- Task 1: transplant closure commits -> IN PROGRESS
- Task 2: §21.1 remove universal CATALYST_MIN_STOCK_FRACTION gate + policy version bump + validation
- Task 3: §21.2 fix R1 lens semantics under dormancy
- Task 4: §21.3 fix R11 test-only catalyst spec lookup + regression
- Task 5: traceability note + pnpm verify on submitted head
- Task 6: final closure matrix (§6 closes SATISFIED WITH EVIDENCE LIMITATION)
- Task 2: complete (commit $(git rev-parse --short HEAD), tests: pnpm test:catalysts -> 12/12 PASS, pnpm typecheck -> clean)
  - §21.1: removed CATALYST_MIN_STOCK_FRACTION from drought-a/drought-b, removed the constant and
    minStockFraction(), bumped CATALYST_POLICY_VERSION 1.0.0 -> 1.1.0, rewrote the block comment to
    forbid silently reintroducing a universal capacity-fraction floor.
  - RED observed: policy-version assertion failed first; then stock-fraction eligibility assertions.
  - Not biology: sim-core drought mechanics, RNG, resource accounting and rates untouched.
  - global-crash eligibility deliberately unchanged (CATALYST_MIN_ABIOTIC_FRACTION kept).
  - Note: a TS2307 for @capacitor/share appeared once and vanished on re-run. Phantom, not a real
    missing module: declared in apps/explorer/package.json 8.0.2 and installed. Not chased.
