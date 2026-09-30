# Project Context

> A concise, always-current briefing for any AI agent working on this project.
> Keep it short — if this file grows huge, it recreates the context problem it
> is meant to solve. Summarize; link to code and the other project files instead
> of duplicating them.

## Project Summary

Offline-first ecosystem laboratory. The Living Evolution Explorer lets a user
create worlds, watch autonomous evolution unfold, investigate ecological
history and ancestry, intervene transparently, and compare matched
evolutionary branches — without writing code. Currently under a pre-M7
stabilization gate (Tranche A: typed cross-boundary contracts, checkpoint
migration/validation); M7 investigation work is on hold.

## Technology Stack

TypeScript modular monorepo (pnpm workspaces). React + Vite explorer app,
Canvas2D maintained World renderer with PixiJS v8/WebGL2 approved for production,
a validated spike/P0 preparation path, and an inactive unbound production-shaped
`apps/explorer/src/pixiWorld` scaffold on main. Capacitor Android packaging.
No backend, no database, no network at runtime.

## Architecture

`packages/contracts` (cross-boundary types) → `packages/sim-core`
(deterministic biological authority) → `packages/sim-runtime` (worker/session
orchestration, matched forks) → `apps/explorer` (React UI).
`packages/sim-analysis` reads immutable observations only (clades, records,
wording). `packages/sim-decisions` maps observed events to choices without
mutating state. See `docs/architecture/MIGRATION.md` for module boundaries.

## Application Structure

`apps/explorer` (UI: World, History, Tree, Experiments surfaces);
`packages/{contracts,sim-core,sim-analysis,sim-runtime,sim-decisions,phenotype}`;
`tools/validation` (gates, manifest-driven); `legacy/prototype` (frozen
regression evidence — never edit).

## Database

None. Persistence is resumable checkpoints and structured evidence exports
(JSON/JSONL), which are separate contracts.

## Authentication

None. Offline-first single-user product; no accounts, no network services.

## Important Decisions

- M7 is ON HOLD until the pre-M7 fix gate closes (Tranches A–E + reconciliation).
- PixiJS v8/WebGL2 approved as the production World renderer; production cutover
  remains gated by accepted pre-M7 Tranches A/B/C and reconciliation against the
  stabilized runtime/read-model boundary.
- `L-` is reserved for genealogical lineage; analytical clades use `C-`.
- Checkpoint compatibility is an allow-list: only named historical omissions
  migrate; everything else fails explicitly before becoming live state.
  Absence compatibility and value validity are independent axes.
- Declare the smallest truthful contract first; add enforcement second
  (narrowing heuristic).
- Parallel gate removals (Owner decision 2026-09-30): P1 rendering-only
  slices, A6 vs A3.4, and surveys/evidence-trail/doc fixes may run in
  parallel. P1 snapshot binding, worker-protocol changes, and Canvas2D
  removal stay gated on Tranche B + reconciliation. Detail in
  projectStatus.md "Parallel-Authorized".
- Full record: `/sdcard/DEE/review/tranche-a-decisions.md` (review copy; session
  and main are the source of truth).

## Current Implementation

All six product feature families exist and run: world lifecycle, deterministic
engine core, explorer shell + time controls, events/clades/population story,
experiments + evidence export, waste-field niche-construction slice. Tranche A
hardening has merged A1, A2, A3.1, A3.2, and A3.3; PR #70 established the strict
runtime checkpoint schema 0.4. M4B P0 (PR #71), validation workflow optimization
(PR #72), and an inactive/unbound production-shaped Pixi scaffold with browser
proof (PR #73) are merged. The maintained World is still Canvas2D.

## Current Focus

A6 typed EvidenceExport provenance merged as PR #74, and the canonical restore
ordering unit (A3.4, PR #76) merged after it. Remaining Tranche A work is the
downstream runtime-boundary units against current main. M7 remains on hold, and
the merged Pixi scaffold does not release the production World cutover gate.

## Important Constraints

- Offline-first: sim, saves, history, experiments, inspection, export work
  with no network.
- Determinism: same engine version + resolved config + seed + command sequence
  reproduces a run.
- Authority boundaries (sim-core biology, read-only analysis, non-manufacturing
  presentation) are required by design review.
- Never weaken or delete tests, gates, or CI checks to make a change pass.
- Do not edit `legacy/prototype/`.
- `pnpm verify` is the blocking repo contract, but a handoff's validation list
  is a floor, not a substitute: completion needs the handoff's named checks
  **and** every blocking unit/CI shard the manifest routes for the diff.
- No commits, pushes, PRs, or new network/analytics services without explicit
  approval.

## Known Issues

- Android emulator runtime smoke is paused (device acquisition unreliable);
  packaging gate only — tracked in issue #50.
- A2 visual evidence (screenshots) verified in-app but not yet filed into the
  `visual-capture` trail.
- `packages/phenotype` has no row in the `AGENTS.md` architecture table (fix
  before Tranche D).
- Uncommitted `.opencode/agents/project-manager.md` write grant (resolve
  before Tranche F).

## Things AI Should Know

- Read `project.md` before implementing requirements.
- Follow the existing project architecture.
- Do not introduce unnecessary technologies.
- Keep documentation files synchronized with project progress.
- Create/update test cases for implemented features.
- Update project status after completing meaningful work.
- The manifest (`tools/validation/manifest.ts`) is authoritative for what
  evidence exists; a handoff's check list narrows attention, it does not bound it.
- Check `/sdcard/DEE/review/` for the current handoff and decisions record
  before starting tranche work.

## Last Context Update

2026-09-30 — reconciled against current main after PRs #70–#76.
