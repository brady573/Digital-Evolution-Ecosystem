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

## Agent roles

Repository automation uses a two-tier topology defined in `.opencode/agents/`. Every agent in it opens by reading this file, so this section is what tells an agent where it sits.

```text
Owner  ->  project-manager  ->  five lane specialists   (read-only analysis)
              |
              +-- bounded handoff -->  digital-evolution  ->  source changes
```

| Agent | Mode | Responsibility |
|---|---|---|
| `project-manager` | primary, default | Coordinates lanes and writes bounded handoffs. Read-only: no source edits, and no shell beyond a read-only `git status`. |
| `digital-evolution` | primary | The Coding Agent. Implements an accepted handoff. Source changes happen here. |
| `lane/simulation-ecology` | subagent | L1 — what can evolve, and why the world behaves this way. |
| `lane/product-experience` | subagent | L2 — what the player does, notices, understands, and investigates. |
| `lane/visual-systems` | subagent | L3 — what evolution looks and feels like, while staying truthful to simulation state. |
| `lane/platform-delivery` | subagent | L4 — can the product reliably run, preserve, resume, and ship evolving worlds. |
| `lane/validation-quality` | subagent | L5 — what is actually known to work, and on what evidence. |

`.opencode/opencode.json` sets `default_agent`, so a new session starts as the coordinator. A session stores its selected agent separately, so changing that file does not retarget a session that already exists.

### Dispatching a lane

A lane starts with no conversation history: it sees only its own instructions and the prompt it was given, and it cannot ask a follow-up question. Every lane prompt therefore has to carry the objective, the **accepted design text verbatim**, the scope boundary, the specific question, and the shared return shape. A dispatch that omits the design text makes the lane correctly report the design as missing and return nothing else — that is a dispatch defect, not a lane defect, and retrying the same prompt fails the same way.

Lanes return a shared seven-field shape: lane fit, current implementation facts, accepted-design implications, cross-lane dependencies, risks or tensions, acceptance/evidence needs, and Owner decisions. `lane/validation-quality` returns a declared variant that separates supported from unsupported claims; that separation is the point of an evidence lane and must not be flattened to satisfy the common shape.

Two rules the coordinator is held to:

- An empty search result is never evidence that something is absent. Confirm a negative a second way before reporting it, and keep "this search did not find it" distinct from "it does not exist".
- Never resolve a material product or simulation design conflict by agent vote or majority. Surface it to the Owner.

### Coverage gap

No unit in `tools/validation/manifest.ts` reads `.opencode/`, so `pnpm verify` cannot exercise any of these agent definitions and a regression in them is invisible to every gate. This is deliberate for now — a gate that merely asserts these files parse would prove little — but it should be read as a known blind spot rather than as coverage. A documentation-only change routes to `validation-arch` alone; adding or editing an agent is not covered by any check.

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

Validation is defined in exactly one place: `tools/validation/manifest.ts`. Every command below is either a thin wrapper over that manifest or a deliberate single-unit escape hatch. The list in this file describes the interface; the manifest holds the meaning, and `pnpm validation:check` fails the build if the two disagree.

| Task | Command |
|---|---|
| Install dependencies | `pnpm install --frozen-lockfile` |
| **Blocking repository contract** | `pnpm verify` |
| Fast invariant gate only | `pnpm verify:fast` |
| Deterministic product behaviour only | `pnpm verify:simulation` |
| Presentation and build only | `pnpm verify:presentation` |
| Browser behaviour (needs a `vite preview` server) | `pnpm verify:browser` |
| Human-review evidence (needs a `vite preview` server) | `pnpm verify:evidence` |
| Scientific characterisation (manual, long) | `pnpm verify:survey` |
| Dev server | `pnpm dev` |
| Sync web assets to Android | `pnpm --filter @digital-evolution/explorer cap:sync` (after `pnpm build`) |

Single-unit escape hatches exist for iterating on one check (`pnpm test:ecology`, `pnpm test:browser`, `pnpm test:migration`, and the rest in `package.json`). They are not the completion contract: running one proves one claim, and `pnpm verify` proves the set.

**A handoff's validation list is a floor, not a substitute.** Bounded handoffs name the checks that are *focused* on the work unit — the ones a reviewer most needs to see run. They are not the repository's blocking contract, and they are usually shorter than it. Completion requires both: the handoff's named checks, **and** every blocking unit and CI shard the manifest routes for the actual diff. Learned the hard way in Tranche A: a handoff's list omitted `test:catalysts` and `test:aftermath`, treating that list as exhaustive skipped both locally, and CI's `sim-d` shard failed on a stale assertion in `catalysts.ts` that a local run had structurally could not reach. The manifest and the shards it defines remain authoritative; the handoff list narrows attention, it does not bound it.

To see what CI will run, and what each check costs, use `pnpm validation:plan`. To see what a diff requires, use `pnpm validation:check` for the architecture gate and `pnpm ci:group <shard> --dry-run` to list a shard.

### What `pnpm verify` does and does not include

`pnpm verify` is the blocking **repository** contract: every claim provable in Node at full strength. It is not the whole of CI, by design. The evidence classes are distinct and each needs its own environment:

| Class | Question | Runs in | Lane-blocking? | Merge gate? |
|---|---|---|---|---|
| A `invariant` | Is the repository structurally sound? | `pnpm verify:fast` | yes | yes |
| B `deterministic` | Is exact supported behaviour still exact? | `pnpm verify:simulation` | yes | yes |
| C `presentation` | Does the product build, and do presentation contracts hold? | `pnpm verify:presentation` | yes | yes |
| D `browser` | Does it work in a real browser? | `pnpm verify:browser`, CI | yes | yes for blocking units; visual captures no |
| E `platform` | Does the Android packaging integrate? | CI `android` workflow | yes | no |
| F `scientific` | What actually happens across seeds and horizons? | `pnpm verify:survey` | no — manual | no |
| G `evidence` | Can a human inspect it? | `pnpm verify:evidence`, CI | no — evidence only | no |

Lane-blocking means failure fails that validation lane; merge gate means
successful completion is required for merge readiness (see `mergeGate` in
`tools/validation/manifest.ts`). Android packaging is blocking but not
merge-gating: a red APK fails the platform lane without holding up the
merge-ready result.

The classes are not interchangeable. A Node run cannot prove browser correctness, a single seed cannot prove emergence, and an APK assembling says nothing about behaviour. A check is only ever moved between classes when the claim it proves changes, and that is a design decision rather than a refactor.

Groups, unlike classes, are defined by *when* rather than *what*: `fast` is whatever a developer waits for before getting an answer, so it carries `decisions` (Class B) because 74 seconds of decision-policy checking is worth having early. `pnpm validation:check` asserts the CI fast shard runs exactly the same set, so "the fast gate" cannot mean two different things depending on which file someone edited.

**Before considering any change complete, run `pnpm verify`.** Browser, platform, and evidence classes are gated separately by CI; scientific characterisation is manual by design.

### Prefer GitHub Actions over the device for validation

The phone (Termux + proot) is the *authoring* environment, not the place to
wait for evidence. It is slower than CI, its proot layer is flaky, and long
runs get killed by device or session restarts — which has repeatedly
destroyed multi-minute `verify`, survey, and capture runs mid-flight.

**Default: run narrow checks locally, let CI carry everything slow.**

| Check | Where it should run |
|---|---|
| `pnpm verify:fast` | Local. ~1–2 min, and it answers most "is this structurally broken" questions. |
| A single validation suite (`test:migration`, `test:niche`, `test:landscape`, `test:flows`) | Local, while iterating. |
| Full `pnpm verify` | Either, but prefer **CI** once a change is more than a line or two. The CI `quick` shard runs the fast gate first, so a structural failure surfaces in about a minute. |
| `pnpm verify:browser`, `pnpm verify:evidence` | **CI.** Both need Playwright Chromium plus a preview server, and the visual capture only reaches a meaningful world depth on CI hardware. |
| `pnpm verify:survey` | **CI or a machine that will not be interrupted.** The surveys are resume-safe; if one dies, re-run and it continues from the retained artifact. |
| Android packaging | **CI only.** Gradle and the emulator are not viable on the device. |

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
  statistical canvas assertion had passed. The `validation-summary` artifact
  gives the per-unit cost and skip reason for a run.
- When a local run dies from a restart, resume the resume-safe runner rather
  than restarting it; the retained artifact is the expensive part.

### Adding or changing a check

Validation knowledge is machine-readable in `tools/validation/manifest.ts`, and
the CI workflows only choose which runner each shard lands on. To add a check:

1. Add a `package.json` script for it.
2. Add a unit to `UNITS` in the manifest: its `id`, `script`, evidence `cls`,
   `enforcement` (blocking / evidence / manual), the `domains` whose change
   forces it, and the `claim` it proves.
3. Put it in a group. Blocking units go in exactly one `ci-*` shard and in
   exactly one of `fast` / `simulation` / `presentation`, so `verify` and CI
   cannot diverge.
4. Run `pnpm validation:check`.

That last step is the point. It fails if the unit is in no shard, in two shards,
missing from `verify`, absent from `package.json`, or if a workflow has started
running validation outside the manifest. Do not add a check by editing a
workflow or by appending to a command chain — both are how the Android job came
to re-run the whole repository contract for 19 minutes.

Two conventions worth keeping:

- **Shard by measured cost.** `baselineSeconds` in the manifest comes from real
  CI runs, not estimates. A shard that is much longer than its siblings is the
  critical path, and the fix is to move or split units, not to add runners.
- **Splitting a suite must be provably lossless.** When `test:dependency` was
  split across three shards, `test:validation-arch` was extended to assert that
  the shards' `--only` lists union to exactly the suite's full test set. If you
  split a suite, add the equivalent assertion.

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
7. **Review outputs go to shared storage, repos stay on local disk.** On Termux/proot devices the repo must stay under the Linux home (`/root/...`): shared phone storage (`/sdcard`) is mounted `noexec` and may reject symlinks, so `node_modules` native binaries and `pnpm` linking break there. Copy *reviewable outputs only* — viewer HTML, `EVIDENCE.md`, exports, screenshots, handoff files — to `/sdcard/DEE/<topic>/` (e.g. `/sdcard/DEE/review/phenotype-art-review.html`) and open them from the phone. Never move the repo, `node_modules`, or OpenCode state (`~/.local/share/opencode`, SQLite db) to shared storage. This is a copy, not a move: the repo remains the source of truth.

## Prohibitions

- Never weaken or delete tests, validation gates, CI checks, or security controls merely to make a change pass.
- Never edit generated output (`dist/`, `node_modules/`) or commit them.
- Never commit the local toolchain workarounds in `node_modules/`; they are gitignored and machine-specific.
- Do not commit, push, open PRs, change remote settings, or request elevated credentials unless explicitly authorized.
- Do not add network calls, analytics, or external services to the product without explicit approval — offline-first is a core guarantee.

## When to stop and ask

Stop for human input if: a change would break a parity gate and you cannot preserve behavior; a security control would be weakened; `legacy/prototype` sources appear to need modification; the task requires elevated permissions; or the request conflicts with the architecture rules above.
