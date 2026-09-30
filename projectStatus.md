# Project Status

> A quick snapshot of where the project stands. Keep it short — this is a
> dashboard, not a diary. The AI should update it after completing meaningful work.

## Overall Status

In development — the pre-M7 stabilization/fix gate remains open; M7 is on hold.
Bounded independent preparation may proceed where the accepted handoffs allow it.

## Current Phase

Tranche A continues on current main after the A3.4 canonical restore merge
(PR #76). A6 typed EvidenceExport provenance merged as PR #74. The remaining
Tranche A units are the downstream runtime-boundary work, under the accepted
dependency and reconciliation rules.

## Completed

- A1 typed cross-boundary read models — merged `f5641c4`
- A2 typed entity identity + `L-`/`C-` namespace — merged `46ccfe9`
  (dormant-return prose verified in-app)
- A3.1 migration rule table — merged `b5c2a36`
- A3.2 pre-A2 `entity_refs` migration + table correction — merged `821dd9f`
- A3.3 checkpoint rejection + strict runtime schema 0.4 — PR #70 merged
- M4B P0 asset/provenance reconciliation + Pixi preparation — PR #71 merged
- Validation workflow critical-path optimization — PR #72 merged
- Inactive, unbound production-shaped Pixi scaffold + browser proof — PR #73 merged
- A6 typed EvidenceExport with revision/cleanliness provenance — PR #74 merged
- A3.4 canonical restore state — PR #76 merged (`91ec38b`). One canonical
  representation validated against the current non-simulation contract before
  any restored state becomes live, with the candidate/validated boundary
  enforced by the compiler and equivalence evidence in three tiers.

## In Progress

- Tranche A is complete. Issue #54 items 6-12 belong to Tranche B and are not
  remaining Tranche A work; they need a fresh bounded handoff after A7
  acceptance
- Issue #54 production-hardening chain remains open

## Blocked

- Production World Pixi cutover remains gated by accepted pre-M7 Tranches A/B/C
  and reconciliation against the stabilized read-model/runtime boundary. The
  maintained user-facing World is still Canvas2D.
- M7 investigation work waits on Tranches A–E, final Tranche F reconciliation,
  and explicit Design Partner / Project Owner activation.
- Android runtime emulator evidence remains paused/unreliable under issue #50;
  APK packaging evidence must not be described as runtime validation.

## Parallel-Authorized (Owner decision 2026-09-30)

Gate removals only — all other sequencing stands. Load-bearing gates
unchanged: P1 binding after Tranche B read-model stabilization (issue #54),
A4–A6 after A3's contracts. The A3.4-after-A3.3-spec-acceptance gate is
satisfied: A3.4 merged as PR #76.

- P1 rendering-only slices (camera/torus math, layer scaffolding, texture
  pipeline, perf instrumentation): may proceed in parallel, including in
  production location. Still forbidden: snapshot-shape binding, worker
  protocol/client changes, Canvas2D removal, any production cutover.
- A6 typed EvidenceExport: may proceed in parallel with A3.4 (export path
  is disjoint from checkpoint restore; A3.4 spec declares exports out
  of scope).
- Surveys, A2 evidence-trail filing, doc fixes: may proceed anytime
  (non-gating by evidence class).

## Recently Completed

- PR #76 merged the A3.4 canonical restore layer: source preflight, canonical
  migration, then validation against the current non-simulation contract before
  restore. Restored state cannot bypass the validator, and that boundary is
  compiler-enforced.
- PR #73 merged the inactive/unbound Pixi production scaffold and made its
  browser correctness proof blocking/merge-gating. This is preparation, not
  production World cutover.
- PR #70 merged the strict 0.4 checkpoint boundary.
- A7 closed the runtime trust boundary at the worker transport, and recorded
  what it establishes: a malformed command is refused before any simulation
  loop begins and mutates no tick, biology, decision, or analysis state; every
  worker request settles exactly once, through one fatal path shared by worker
  error, messageerror, and destroy, with no pending entry surviving; and a
  checkpoint load completes only through its own request identity, so a
  same-tick, stale, or unrelated live snapshot cannot satisfy it. Bounds are
  transport safety reused from existing constants (MAX_SLICE_TICKS 2000 and the
  100_000 event-scan default), not simulation or population limits.

## Next Recommended Task

Accept A7 (PR #84), then stop. Issue #54 items 6-12 are Tranche B work and
require a fresh bounded handoff against then-current main — do not roll forward
into them, and do not begin the Tranche B bounded live-snapshot redesign. Do not
treat repository slice labels for Pixi preparation as release of the production
cutover gate.

## Last Updated

2026-09-30
