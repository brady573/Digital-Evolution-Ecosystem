# @digital-evolution/phenotype — Lane 2 M4B Pixel Phenotype prototype

Phase 1 safe parallel core. Presentation only: no simulation biology, no
persistence contract changes, no `App.tsx` edits.

## Modules

- `src/constants.ts` — prototype numerical baseline (family centers, axis
  weights, hysteresis gates, quantization levels, LOD grid sizes). Tuning
  inputs, not final constants (`PROTOTYPE_BASELINE`).
- `src/model.ts` — stable trait normalization from fixed supported ranges,
  four presentation axes, attractor distances, founder/descendant family
  resolution with hysteresis, geometry quantization, deterministic cosmetic
  seeding, LOD tier mapping, tick-driven animation phase.
- `src/renderer.ts` — pure monochrome geometry. `renderPhenotypeGrid()`
  needs no DOM; `drawGridToCanvas()` adapts a grid to any Canvas2D-like
  surface for live use. The caller (WorldCanvas, Phase 3) owns lens color,
  selection markers, position, and opacity. Dormancy renders in two
  strengths gated by normalized dormancy response (`DORMANCY_STRONG_THRESHOLD`):
  strong applies the full family-specific transform, weak hollows the active
  silhouette and withdraws secondaries.

## Key decisions (implementation freedom used)

- **Deterministic reconstruction** for lineage continuity: descendants
  inherit the parent's current visual family with hysteresis. Phase 3 looks
  the parent family up from the live snapshot (orphans fall back to founder
  resolution). No checkpoint schema change in Phase 1.
- **Signed normalization** is `value / halfRange` (diet/habitat range is
  symmetric ±1.5, so this equals the 0..1-rescaled signed form).
- **Exact-tie founder rule** is fixed family order — deterministic,
  reachable only on exact ties, documented in validation.
- **Cosmetic identity use** is one inspection-tier marking pixel (any two
  identities differ by at most two cells) plus animation phase.
  Ecosystem/population tiers carry none.
- **Dormancy** is always a geometric transform (contract / curl / retract /
  consolidate / withdraw / fold), never just opacity.

## Evidence (Phase 2)

`pnpm exec tsx tools/phenotype-evidence.ts` writes
`packages/phenotype/evidence/{EVIDENCE.md, evidence.json, viewer.html}`:
silhouette matrix, trait strips, lineage strips, boundary comparisons,
continuity cases, equivalence, dormancy pairs, dense scenes from real engine
runs, mock-canvas performance, and tuning observations. `viewer.html` is
self-contained and offline. Key finding: evolved trait manifolds sit deep
inside the generalist basin (all scene populations resolve blob) — whether
to accept, recalibrate, or keep potential-space attractors is an owner
decision; no constant is changed here.

## Validation

`pnpm exec tsx tools/validation/phenotype.ts` — normalization,
specialization, founders, lineage anchoring, hysteresis boundary (ratio gate
at t≈0.52, absolute gate at t=0.7, transition at t≈0.85 on the
blob→segmented axis), quantization, cosmetic bounds, LOD tiers, six-family
legibility, dormancy readability, continuity, equivalence, isolation.

## Live integration (Phase 3, on merged main with M3 catalysts)

`apps/explorer/src/phenotype.ts` adapts the engine to WorldCanvas:
descendant-chained resolution in generation order (orphans fall back to
founder resolution), per-organism memoization across snapshots (traits and
ancestry are fixed at birth; departed ids pruned; hard cap 20000), tier
mapping, and per-tier cell fractions (eco 0.8 / pop 0.5 / insp 0.35 of the
legacy voxel unit). `App.tsx` delegates **normal-lens** morphology to it;
every other lens keeps the legacy voxel path byte-for-byte, so analytical
meaning outranks decoration. Colors, dormancy dimming, selection markers,
camera, minimap, hit testing, decision sheets, and catalyst UI are
unchanged. `tools/validation/phenotype-world.ts` (chained into
`pnpm test:phenotype`) covers chaining, orphans, cache lifecycle and cap,
and draw math; `tools/validation/browser-smoke.ts` asserts both morphology
paths paint in-browser, differ, and survive 3.0× inspection zoom.

`package.json` wires `test:phenotype` (model + world suites) and the
phenotype tsconfig into `typecheck` and `verify`.
