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

CI (`.github/workflows/product.yml`) runs `pnpm verify` on every pull request and push to `main`, plus a browser smoke test (`pnpm test:browser`, currently non-blocking — see issue #5). The browser test needs a Playwright Chromium download:

```sh
pnpm exec playwright install --with-deps chromium
```

## Workflow

1. Read `AGENTS.md` — it defines architecture rules, conventions, and prohibitions for this repo.
2. Make focused changes; keep simulation, UI, and analysis changes in separate PRs where possible.
3. Run `pnpm verify` locally before pushing.
4. Open a PR using the template. CI must pass (except the known non-blocking browser smoke).
5. Do not edit `legacy/prototype/` — those sources are frozen regression evidence.

## Reporting issues

Include the engine/app version (`packages/sim-core/src/version.ts`), steps to reproduce, expected vs actual behavior, and whether the issue reproduces offline.
