# P0 Pixi preparation — non-production boundary (read this first)

Stage P0 of the M4B handoff: safe parallel preparation. **The maintained
production World is still Canvas2D** (`apps/explorer/src/App.tsx`
`WorldCanvas` calls `canvas.getContext("2d")`). Nothing in this directory is
imported by production code, and nothing here may be wired into the World
until the pre-M7 Tranches A/B/C gate releases P1.

## What lives here

| Module | Role |
|---|---|
| `phenotypeTextures.ts` | Deterministic CPU-side texture descriptors from resolved phenotype geometry (exact grid identity + tier + activity). No GPU, no Pixi import — P1 adds `Texture.from` upload. |
| `textureCache.ts` | Production-shaped ref-counted texture-cache mirror (acquire/release/prune, collision guard). Extracted from `tools/pixi-spike/cache.ts` without duplicating phenotype semantics. |
| `layers.ts` | Scene-layer order + 600x600 toroidal camera contract (pure data + pure helpers, no Pixi import). |
| `assetRegistry.ts` | Asset-class registry (A in-world phenotype textures, B portraits, C environment/substrate, D interaction/effects) mapping manifest ids to runtime handling. |
| `adapter.ts` | Local read-only adapter from current presentation data (`RenderSnapshot` + resolved phenotypes) to texture requests. No new contracts types. |

## Rules

- No `sim-core` / `sim-runtime` imports anywhere in this directory (renderer is presentation-only).
- No phenotype selection/hysteresis reimplementation: consume `ResolvedPhenotype` from `packages/phenotype` / `apps/explorer/src/phenotype.ts`.
- Exact bitmap-equivalent texture identity only. A relaxed cache key needs current evidence it merges no meaningful visual states.
- Nearest-neighbor filtering for organism pixel textures; analytical field views stay exact/flat (never smoothed).
- Offline-first: no runtime network asset loading.
- Validation: `pnpm test:pixi-p0` (P0 harness) + existing `pnpm test:phenotype`, `pnpm test:pixi-spike`, `pnpm test:art-review`, `pnpm test:landscape`.

## P1 gate

P1 (production cutover: Pixi as Explorer dependency, maintained Pixi World,
Canvas2D retirement) starts only after pre-M7 Tranches A/B/C are accepted and
this handoff is reconciled against current main. Do not build a temporary
production Pixi API against a boundary issue #54 may replace.
