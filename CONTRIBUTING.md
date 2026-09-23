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

Full APK assembly requires x86-64 Android build-tools and runs in CI. Debug APKs are attached to each `android` workflow run as the `digital-evolution-debug-apk` artifact.

## Workflow

1. Read `AGENTS.md` — it defines architecture rules, conventions, and prohibitions for this repo.
2. Make focused changes; keep simulation, UI, and analysis changes in separate PRs where possible.
3. Run `pnpm verify` locally before pushing.
4. Open a PR using the template. CI must pass.
5. Do not edit `legacy/prototype/` — those sources are frozen regression evidence.

## Reporting issues

Include the engine/app version (`packages/sim-core/src/version.ts`), steps to reproduce, expected vs actual behavior, and whether the issue reproduces offline.
