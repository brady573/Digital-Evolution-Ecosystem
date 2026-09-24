# Voxel Engine Spike (PROTOTYPE — not canonical)

Ground-up rethink of the simulation: organisms are voxels living **in**
grid cells (sessile), not agents moving over a field. Same design goal as
the canonical engine (M2: mature microbial ecosystem), none of its code.

## Spike rules

- **Isolation:** zero imports from `sim-core`, `sim-analysis`, `sim-runtime`.
  Nothing here may break `pnpm verify`, parity gates, or `main`.
- **Not a product:** no UI, no checkpoints, no exports. Headless metrics only.
- **Promotion bar:** reproduce the four M2 demo behaviors at small scale
  (emergent abundance by regime, demographic range, cross-feeding emergence,
  persistent diet divergence) before any migration discussion.
- **Throwaway by default:** formats and constants here carry no compatibility
  promises. If promoted, it re-earns every gate from scratch.

## Model (minimal)

- Portrait toroidal lattice (default 64 x 96). Each cell holds substrate
  A/B (abiotic, regenerating toward a static patchy capacity) and C
  (biogenic only: excreted on uptake, decays, no regen).
- One voxel organism per cell at most. Genome: diet preference, efficiency,
  byproduct-use, dormancy-response, reproduction threshold.
- Fixed id-order updates. Sessile: reproduction into a random empty Moore
  neighbor with mutated genome; no movement, no diffusion (noted
  simplifications, not oversights).
- Dormancy is phenotypic state with hysteresis, mirroring the canonical
  entry/wake discipline. Three independent RNG streams (init, neighbor,
  mutation) from one master seed.
