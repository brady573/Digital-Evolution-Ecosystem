# pixiWorld — P1 rendering-only production scaffold (INACTIVE)

P1 work area in production location, authorized by Owner decision 2026-09-30
(parallel gate removals: rendering-only slices). **Not activated**: nothing
here is imported by `App.tsx`, and the maintained production World is still
the Canvas2D `WorldCanvas`.

## What lives here

| Module | Role | Runtime needs |
|---|---|---|
| `camera.ts` | Toroidal camera contract: wrap math, uniform zoom, world↔screen projection, visible-window reporting. Pure — Node-tested for parity with `App.tsx`. | none |
| `layers.ts` | Scene-layer `Container` assembly in `LAYER_ORDER` (later = on top). Absorbs the P0 order — the single source stays `../pixi/layers`. | pixi.js `Container` only (headless-safe) |
| `textures.ts` | Phenotype bitmap → GPU `Texture` upload with nearest scale mode. Mirrors the spike's `textureFromBits`; caller owns color/alpha. | DOM canvas + WebGL (browser CI) |
| `boot.ts` | `Application` boot (WebGL preference, genuine backend probe), host-following resize, dispose. Takes no snapshot. | DOM + WebGL (browser CI) |

## Forbidden in this directory (still gated on Tranche B + reconciliation)

- Snapshot/read-model binding (`RenderSnapshot`, worker client, runtime imports).
- `sim-core` / `sim-runtime` imports of any kind.
- Selection, lenses, hit-testing against live data (math helpers are fine; live wiring is not).
- Importing this directory from `App.tsx` or any production surface (cutover is P1.6, after the gate).
- Storing GPU/render cache in checkpoints; network asset loading.

## Coverage

Pure parts (`camera`, layer assembly) are asserted by `pnpm test:pixi-p0`
(§8). DOM/WebGL parts (`textures`, `boot`) are covered by typecheck plus
browser capture evidence on CI — same policy as the spike.
