# Digital Evolution Ecosystem

Digital Evolution Ecosystem is an offline-first evolutionary simulation and investigation product. The current product direction is a **Living Evolution Explorer**: users create worlds, watch autonomous evolution unfold, investigate ecological history and ancestry, intervene transparently, and compare matched evolutionary branches.

## Migration status

The product is moving from a self-contained HTML prototype into this repository.

- **Validated regression baseline:** prototype v0.28.2 / engine 0.18.2
- **Latest implementation source:** recovered prototype v0.29.0 / engine 0.19.0
- **Migration branch:** `migration/canonical-product`
- **Target architecture:** TypeScript modular monolith, worker-owned simulation runtime, React/Vite explorer, exact resumable checkpoints, then Capacitor Android packaging.

The v0.29 artifact contains newer cross-feeding, dormancy, Metabolite C, and ecological-succession work, but v0.28.2 remains the protected validated baseline until the repository implementation revalidates v0.29 behavior.

## Product architecture

```text
apps/explorer          Living Evolution Explorer UI and platform adapters
packages/contracts     Cross-boundary configuration, snapshot, command, checkpoint, and export types
packages/sim-core      Deterministic biological simulation authority
packages/sim-analysis  Read-only ecological interpretation, clades, metrics, and history
packages/sim-runtime   Worker/session orchestration, speed control, matched forks, persistence handoff
legacy/prototype       Immutable prototype regression sources
tools/validation       Migration and long-run validation tooling
```

The existing repository-management foundation (repo-ai, policies, schemas, workflows, agent instructions, and Go tooling) remains in place and is not part of the product migration.

## Migration rule

Migration uses **one canonical web-product migration PR** with many internal validation gates. Intermediate architecture states stay on the migration branch rather than being merged to `main`.

The protected prototypes remain the oracle throughout extraction:

1. preserve exact source artifacts;
2. generate deterministic fixtures;
3. extract `sim-core`;
4. extract `sim-analysis`;
5. replace source-string workers with a real module-worker runtime;
6. port the explorer UI;
7. add exact checkpoint persistence;
8. revalidate before promotion.

A second PR will add Capacitor Android packaging and produce the first APK.

## Core trust rules

- Same engine version + resolved config + seed + command sequence must be deterministic.
- UI and analysis may explain simulation state but may not change biology.
- Population abundance, ecological structure, dormancy, and cross-feeding must remain emergent.
- Matched-control forks clone exact state and RNG streams.
- Simulation, saves, history, experiments, and inspection must remain usable offline.
- Evidence exports and resumable checkpoints are separate contracts.

## Repository setup

This migration branch introduces the product workspace beside the existing repository-management foundation. Product commands will be added behind root scripts while current Go/repo-ai commands remain unchanged.
