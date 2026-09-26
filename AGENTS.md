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

### Local toolchain note: proot / hardlinked native binaries

Applies to local proot-distro (Termux) environments only. CI and normal Linux/macOS installs are unaffected, and nothing here belongs in the repo.

pnpm hardlinks packages out of its content-addressable store by default. TypeScript 7 is a Go binary that locates its bundled `lib.*.d.ts` via `os.Executable()`, and **proot cannot resolve `/proc/self/exe` for a hardlinked file**. The binary therefore computes a bogus directory and dies at startup:

```text
panic: bundled: /.l2s/lib.d.ts does not exist; this executable may be misplaced
```

This is misleading — the lib files are present and readable. Two tells: the panic happens before any source is read, and `stat -c %h` on the `tsc` binary reports `2` instead of `1`. To confirm, copy the binary to any plain directory and run it; if it works there, the hardlink is the cause.

Fix, in order of preference:

1. `pnpm config set package-import-method copy --global` (writes outside the repo), then reinstall. Prevents recurrence.
2. To repair an already-broken install, `rm` the binary **before** copying a replacement. Copying over a hardlink writes through the shared inode and corrupts the pnpm store for every other project on the machine.

While proot is flaky, a `pnpm install` can leave `tsc` reporting **phantom** `TS2307 Cannot find module` errors that change between runs and vanish on re-run. Re-run before investigating a missing module after an install; do not edit `package.json` or the lockfile to chase one.

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
| Landscape visual captures (needs Playwright Chromium + preview) | `pnpm test:visual` (manual; also runs in CI as non-gating evidence, PNGs uploaded as the `landscape-visual-evidence` artifact) |

**Before considering any change complete, run `pnpm verify`.** CI runs the same command plus the browser smoke (currently non-blocking, see issue #5).

### Prefer GitHub Actions over the device for validation

The phone (Termux + proot) is the *authoring* environment, not the place to
wait for evidence. It is slower than CI, its proot layer is flaky, and long
runs get killed by device or session restarts — which has repeatedly
destroyed multi-minute `verify`, survey, and capture runs mid-flight.

**Default: run narrow checks locally, let CI carry everything slow.**

| Check | Where it should run |
|---|---|
| `pnpm typecheck` | Local. Fast enough (~1 min) to be worth the immediate answer. |
| A single validation suite (`test:migration`, `test:niche`, `test:landscape`, `test:flows`) | Local, while iterating. |
| Full `pnpm verify` | Either, but prefer **CI** once a change is more than a line or two. `quick` alone is ~1–2 min and gives most of the signal. |
| `pnpm test:browser`, `pnpm test:visual` | **CI.** Both need Playwright Chromium plus a preview server, and the visual capture only reaches a meaningful world depth on CI hardware. |
| `pnpm test:survey`, `test:niche-survey` | **CI or a machine that will not be interrupted.** Both are resume-safe; if one dies, re-run and it continues from the retained artifact. |
| Android `apk` | **CI only.** ~22 minutes locally is not viable. |

Practical consequences:

- A green CI run on the pushed head is the completion signal. Do not
  re-run `pnpm verify` on the device to "confirm" something CI has already
  proved — that only burns the device and risks another restart.
- Push to a **branch** and read results with `gh pr checks <n>`. Do not
  push to `main`: `gh pr edit --body` is broken (Projects-classic sunset)
  and the same breakage cancels in-flight main runs.
- Retrieve CI evidence artifacts instead of regenerating locally:
  `gh run download <run-id> -n landscape-visual-evidence -D <dir>`. Reading
  the captured PNGs caught two real rendering defects that every
  statistical canvas assertion had passed.
- When a local run dies from a restart, resume the resume-safe runner rather
  than restarting it; the retained artifact is the expensive part.

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

## Prohibitions

- Never weaken or delete tests, validation gates, CI checks, or security controls merely to make a change pass.
- Never edit generated output (`dist/`, `node_modules/`) or commit them.
- Never commit the local toolchain workarounds in `node_modules/`; they are gitignored and machine-specific.
- Do not commit, push, open PRs, change remote settings, or request elevated credentials unless explicitly authorized.
- Do not add network calls, analytics, or external services to the product without explicit approval — offline-first is a core guarantee.

## When to stop and ask

Stop for human input if: a change would break a parity gate and you cannot preserve behavior; a security control would be weakened; `legacy/prototype` sources appear to need modification; the task requires elevated permissions; or the request conflicts with the architecture rules above.
