# pixiWorld — production semantic World renderer

`WorldPixi` is the maintained semantic World renderer mounted by `App.tsx`.
It consumes bounded Explorer presentation props and owns Pixi display/GPU
resources only. React remains authoritative for simulation-facing product
state, controls, camera/selection state, decisions, Aftermath, and persistence.
`?deeTest` enables test instrumentation/fixtures; it does not select a renderer.
Renderer initialization or unrecoverable context failure is shown in the World
slot and never falls back to a second semantic renderer. The subordinate
read-only World minimap may use Canvas2D.

## Modules

| Module | Role |
|---|---|
| `WorldPixi.tsx` | React-owned Pixi host lifecycle, bounded prop bridge, accessible renderer failure state. |
| `boot.ts` | WebGL renderer initialization/backend evidence, host-following resize, generation-safe teardown. |
| `renderer.ts` | Presentation reconciliation for environment, organisms, focus, camera, and bounded input callbacks. |
| `environment.ts`, `organisms.ts` | Derived display resources for exact field semantics and resolved phenotype presentation. |
| `camera.ts`, `interaction.ts` | Toroidal projection and CSS-pixel selection/pan behavior. |
| `textures.ts`, `layers.ts` | Pixi texture ownership and ordered display-layer assembly. |

No module in this directory may acquire simulation/runtime authority, advance
simulation, alter analysis, or persist GPU/cache state. The renderer receives
resolved read-model values and reports only bounded user-originated selection,
camera, and visible-window results.

## Validation

- `pnpm test:pixi-p0` covers pure camera, layer, organism, texture identity,
  movement isolation, and resource lifecycle contracts.
- `pnpm test:pixi-world` remains a **blocking** browser proof for the production
  Pixi modules' WebGL2 boot, resize, nearest-filtered texture creation and
  source retirement, organism reconciliation, world replacement, and teardown.
- `pnpm test:browser` and `pnpm test:mobile-ui` cover integrated production
  route behavior, presented-frame semantics, React overlays, and phone layout.
- These browser checks do not establish Android Pixi/WebGL2 runtime behavior;
  that evidence remains separately gated.
