# Agent Instructions

This file defines standard working practices for any coding agent (or human contributor) working in this repository. It is the single source of truth for how to build, verify, and submit changes here.

## What this repo is

Digital Evolution Ecosystem is an offline-first evolutionary simulation and investigation product. The **Living Evolution Explorer** lets users create worlds, watch autonomous evolution unfold, investigate ecological history and ancestry, intervene transparently, and compare matched evolutionary branches.

```text
apps/explorer          Living Evolution Explorer UI and platform adapters
packages/contracts     Cross-boundary configuration, snapshot, command, checkpoint, and export types
packages/sim-core      Deterministic biological simulation authority
packages/sim-analysis  Read-only ecological interpretation, clades, metrics, and history
packages/sim-runtime   Worker/session orchestration, speed control, matched forks, persistence handoff
packages/sim-decisions  Pure event-to-choice policy: ObservedEvent -> DecisionOpportunity (read-only)
legacy/prototype       Immutable prototype regression sources (do not edit)
tools/validation       Parity, ecology, and browser validation tooling
```

See `README.md` for product direction and `docs/architecture/MIGRATION.md` for module boundaries.

## Toolchain

- **Node** >= 24 (see `.nvmrc`), **pnpm** 12.5.1 via corepack (`packageManager` field pins it).
- No other runtimes are required. There is no build step outside the package scripts below.

## Commands

| Task | Command |
|---|---|
| Install dependencies | `pnpm install --frozen-lockfile` |
| Typecheck all packages | `pnpm typecheck` |
| Deterministic parity gates | `pnpm test:migration` |
| Ecological validation | `pnpm test:ecology` |
| Multi-seed survey (CI-scale) | `pnpm test:survey -- --ticks=250000` (manual; results artifact, not part of `verify`) |
| Production build | `pnpm build` |
| Sync web assets to Android | `pnpm --filter @digital-evolution/explorer cap:sync` (after `build`) |
| Full verification | `pnpm verify` (typecheck + migration + ecology + build) |
| Browser smoke (needs Playwright Chromium) | `pnpm test:browser` against a `vite preview` server (see `.github/workflows/product.yml`) |
| Dev server | `pnpm dev` |

**Before considering any change complete, run `pnpm verify`.** CI runs the same command plus the browser smoke (currently non-blocking, see issue #5).

## Architecture rules (enforced by review, not tooling)

Dependency direction:

```text
apps/explorer -> sim-runtime -> sim-core
apps/explorer -> sim-analysis
sim-runtime   -> sim-analysis, sim-decisions
sim-decisions -> contracts (pure policy; never sim-core)
all product packages -> contracts
```

- `sim-core` is the biological authority. It must not depend on React, DOM APIs, workers, storage, filesystem APIs, `requestAnimationFrame`, or wall-clock time.
- `sim-analysis` interprets immutable / read-only simulation observations. Analysis output may affect presentation and fast-forward stopping conditions, never biology.
- `sim-runtime` owns the live session and the module worker. The application never directly owns mutable simulation state.
- `sim-decisions` is pure read-only choice policy. It maps observed events to offered choices and may never mutate simulation state, advance time, create comparison worlds, or predict outcomes.
- A pending decision opportunity is a hard pause gate owned by `sim-runtime`: while one is pending, no further tick may execute through any command path.
- Same engine version + resolved config + seed + command sequence must remain deterministic.
- Population abundance, ecological structure, dormancy, and cross-feeding must remain emergent — never scripted.
- Matched-control forks clone exact state and RNG streams.
- Evidence exports and resumable checkpoints are separate contracts (`UniverseCheckpoint` vs export types in `packages/contracts`).

## Working conventions

1. **Inspect before abstracting.** Read the existing implementation (especially `packages/sim-core/src/engine.ts` and `packages/contracts/src/index.ts`) before introducing new abstractions.
2. **Do not edit `legacy/prototype/`.** Those files are frozen regression evidence; the parity harness compares against them.
3. **Keep simulation, UI, and analysis changes separate.** A single PR should not mix biology changes with presentation changes unless they are genuinely inseparable — say so in the PR description when they are.
4. **Tests over assertions.** Behavioral claims (determinism, parity, round-trips) must be backed by `tools/validation/*` or package checks, not comments.
5. **Small, reviewable diffs.** Prefer focused PRs; use the PR template in `.github/pull_request_template.md`.
6. **Offline-first.** Simulation, saves, history, experiments, and inspection must remain usable with no network.

## Working from a handoff

Design work arrives as files in `handoffs/`, not chat scrollback. The loop is claim → work → answer, and every step is a commit:

1. **Claim.** Take the lowest-numbered `inbox/` handoff with `status: proposed`. Set it to `claimed` and commit — that commit reserves the work.
2. **Work.** Implement what the handoff authorizes (nothing more). Run the handoff's `gate` command; `pnpm test:handoffs` keeps the queue itself well-formed and runs inside `pnpm verify`.
3. **Answer.** Write the result in `outbox/` under the same id (`author: agent:<your-name>`, `status: done`), set the inbox handoff to `done` (or `blocked`, with the reason), update the `INDEX.md` ledger row, and commit. A human carries the outbox file back to the design side — that step closes the loop.
4. **Format.** Every handoff obeys `handoffs/TEMPLATE.md`: id `HNN-0000`, direction/author agreement, per-directory id uniqueness, and `responds_to` linking each outbox to its inbox. When in doubt, the gate (`tools/validation/handoffs.ts`) is the specification.

## Prohibitions

- Never weaken or delete tests, validation gates, CI checks, or security controls merely to make a change pass.
- Never edit generated output (`dist/`, `node_modules/`) or commit them.
- Never commit the local toolchain workarounds in `node_modules/`; they are gitignored and machine-specific.
- Do not commit, push, open PRs, change remote settings, or request elevated credentials unless explicitly authorized.
- Do not add network calls, analytics, or external services to the product without explicit approval — offline-first is a core guarantee.

## When to stop and ask

Stop for human input if: a change would break a parity gate and you cannot preserve behavior; a security control would be weakened; `legacy/prototype` sources appear to need modification; the task requires elevated permissions; or the request conflicts with the architecture rules above.
