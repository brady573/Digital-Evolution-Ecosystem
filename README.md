# Digital Evolution Ecosystem

Digital Evolution Ecosystem is an offline-first evolutionary simulation and investigation product. The current product direction is a **Living Evolution Explorer**: users create worlds, watch autonomous evolution unfold, investigate ecological history and ancestry, intervene transparently, and compare matched evolutionary branches.

## Current status

The repository-native web product migration is complete and this repository is the canonical implementation location for v0.29 / engine 0.19.0.

- **Historical validated baseline:** prototype v0.28.2 / engine 0.18.2
- **Canonical repository engine:** v0.29.0 / engine 0.19.0
- **Architecture:** TypeScript modular monolith, worker-owned simulation runtime, React/Vite explorer, exact resumable checkpoints
- **Next platform milestone:** Capacitor Android packaging and the first APK (in progress — `apps/explorer/android`, assembled in CI by `.github/workflows/android.yml`)
- **Known browser issue:** [#5](https://github.com/brady573/Digital-Evolution-Ecosystem/issues/5) tracks the Chromium save/reload/resume acknowledgement integration defect. Lower-level checkpoint round-trip and deterministic continuation are validated; the issue is isolated to browser integration.

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

## Migration evidence

The frozen prototypes remain under `legacy/prototype` as regression evidence. Repository validation protects deterministic engine behavior, analysis isolation, runtime parity, matched-control forks, resource accounting, checkpoint round-trip behavior, ecological validation, and production builds.

The browser smoke continues to run in CI but is temporarily non-blocking while issue #5 is open. A second PR will add Capacitor Android packaging and produce the first APK.

## Core trust rules

- Same engine version + resolved config + seed + command sequence must be deterministic.
- UI and analysis may explain simulation state but may not change biology.
- Population abundance, ecological structure, dormancy, and cross-feeding must remain emergent.
- Matched-control forks clone exact state and RNG streams.
- Simulation, saves, history, experiments, and inspection must remain usable offline.
- Evidence exports and resumable checkpoints are separate contracts.

## Repository setup

Requires Node >= 24 (see `.nvmrc`) and pnpm 12.5.1 via corepack:

```sh
corepack enable
corepack prepare pnpm@12.5.1 --activate
pnpm install --frozen-lockfile
pnpm verify
```

See `CONTRIBUTING.md` for the full workflow and `AGENTS.md` for agent working practices.
