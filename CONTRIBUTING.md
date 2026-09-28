# Contributing

## Setup

Requirements: **Node >= 24** (see `.nvmrc`) and **pnpm 12.5.1** (pinned via the `packageManager` field and activated with corepack).

```sh
corepack enable
corepack prepare pnpm@12.5.1 --activate
pnpm install --frozen-lockfile
```

## Verification

```sh
pnpm verify        # typecheck + migration parity + ecology + production build
```

CI (`.github/workflows/product.yml`) runs `pnpm verify` on every pull request and push to `main`, plus a blocking browser smoke test. A second workflow (`.github/workflows/android.yml`) assembles the debug APK and uploads it as an artifact.

The browser smoke needs a Playwright Chromium download (CI does this automatically):

```sh
pnpm exec playwright install --with-deps chromium
```

## Android

The explorer ships to Android via Capacitor (`apps/explorer`, app ID `com.digitalevolution.explorer`). The committed `apps/explorer/android/` platform project is the source of truth for native configuration; generated output (`app/build/`, synced web assets) is gitignored.

```sh
pnpm --filter @digital-evolution/explorer build
pnpm --filter @digital-evolution/explorer cap:sync
```

Full APK assembly requires x86-64 Android build-tools and runs in CI. Debug APKs are attached to each `android` workflow run as the `digital-evolution-debug-apk` artifact. `android.yml` is a reusable workflow with no manual trigger: to re-prove the platform on its own, dispatch `product.yml`, whose impact routing already skips the lanes an Android-only change cannot affect. Do not add a trigger that rebuilds the bundle — Android deliberately tests the *same* `explorer-dist` the browser lane validated, and a second entry point would test a different one while making the same claim.

### Reading an Android red

The emulator lane has two phases — infrastructure (is the device usable?) and application (does the app survive launch?) — and it emits exactly one classification annotation. Read that annotation first; it is the only attribution the lane stands behind.

Two rules make it trustworthy, and both are enforced by `pnpm validation:check`:

- **A failure is only attributed to the application once the device is confirmed alive.** A device that died during the phase is infrastructure, however the application phase failed. The reverse error is the dangerous one: labelling a dead device a product failure sends someone to debug working code.
- **Every terminal path writes both the phase marker and the phase record.** A failure that exits without recording leaves the run unexplainable from evidence.

Measure timings from the `android-phase-record` artifact, never from the log. `reactivecircus/android-emulator-runner` echoes every script line before running it and prints the whole script up front, so every marker appears at least twice and "this line ran" is timestamped at action start regardless of when it executed. Grepping that log has produced a wrong annotation count, a plausible wrong annotation count, and a *negative* boot duration in this repository. The annotations endpoint (`check-runs/{id}/annotations`) and the phase record are the only reliable sources.

## Workflow

1. Read `AGENTS.md` — it defines architecture rules, conventions, and prohibitions for this repo.
2. Make focused changes; keep simulation, UI, and analysis changes in separate PRs where possible.
3. Run `pnpm verify` locally before pushing.
4. Open a PR using the template. CI must pass.
5. Do not edit `legacy/prototype/` — those sources are frozen regression evidence.

## Reporting issues

Include the engine/app version (`packages/sim-core/src/version.ts`), steps to reproduce, expected vs actual behavior, and whether the issue reproduces offline.
