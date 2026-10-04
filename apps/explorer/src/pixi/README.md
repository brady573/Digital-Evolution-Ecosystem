# Pixi preparation helpers

This directory contains pure preparation helpers and cache contracts reused by
the production renderer in `../pixiWorld/`. The maintained semantic World is
`WorldPixi`, mounted by `App.tsx`; this directory is not a second renderer and
does not own WebGL resources directly.

## Modules

| Module | Role |
|---|---|
| `phenotypeTextures.ts` | Deterministic CPU-side texture descriptors from resolved phenotype geometry (grid identity + tier + activity). |
| `textureCache.ts` | Ref-counted texture-cache contract (acquire/release/prune, collision guard). |
| `layers.ts` | Scene-layer order and pure 600×600 toroidal helpers. |
| `assetRegistry.ts` | Asset-class registry for in-world textures, portraits, environment, and effects. |
| `adapter.ts` | Read-only adapter from bounded presentation inputs and resolved phenotypes to texture requests. |

## Rules and coverage

- No `sim-core` or `sim-runtime` imports; rendering remains presentation-only.
- Phenotype selection, normalization, hysteresis, and geometry remain owned by
  the phenotype package and Explorer adapter.
- Exact morphology texture identity includes bitmap, LOD tier, and activity;
  lens color and selection are presentation treatments, not morphology identity.
- Organism textures use nearest filtering; analytical fields retain exact
  encodings. Runtime asset loading remains offline.
- `pnpm test:pixi-p0` covers preparation/cache contracts; production integration
  and lifecycle are covered by `pixi-world-proof`, browser smoke, and mobile UI.
