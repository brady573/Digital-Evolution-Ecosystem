---
name: tdd-workflow
description: RED-GREEN-REFACTOR discipline for features, bug fixes, and refactors. Write the failing test first, implement the minimum to pass, then refactor. Verify independently with the repo gates.
---

# TDD Workflow (DEE adaptation)

Source: https://github.com/YoelCieno/settings-opencode (`skills/tdd-workflow/SKILL.md`).
Adapted: repo verification gates replace generic `tsc`/`bun`/`cargo` calls;
`legacy/prototype/` is frozen; architecture rules in `AGENTS.md` govern.

## Core Rule

Always write the failing RED test before GREEN implementation.

## Routing

- No failing tests → write RED tests first.
- Tests exist → implement the minimum GREEN code.
- Bug fix → write the regression test first.
- Refactor → verify coverage/baseline first.

## Verification Gate (this repo)

- Source of truth: `tools/validation/manifest.ts`. Run the narrowest check
  first (`pnpm test:<unit>`, e.g. `pnpm test:ecology`), then `pnpm verify`
  before considering work complete.
- Never weaken or delete tests, gates, or security controls to make a change
  pass.
- Do not trust self-reports: re-run the gate yourself and quote results.
- Behavioral claims (determinism, parity, round-trips) need
  `tools/validation/*` or package checks, not comments.

## Repo Guardrails (non-negotiable)

- Do NOT edit `legacy/prototype/` — frozen regression evidence.
- Respect module boundaries (`apps/explorer → sim-runtime → sim-core`;
  `sim-analysis` read-only; `sim-decisions` pure policy). Keep simulation,
  UI, and analysis changes in separate diffs unless genuinely inseparable.
- Same engine version + resolved config + seed + command sequence must stay
  deterministic. Abundance, structure, dormancy, and cross-feeding stay
  emergent — never scripted.
- Offline-first: no network calls, analytics, or external services without
  explicit approval.

## Test Conventions

- Prefer static `import` in test files; use dynamic `await import()` only for
  lazy mocks, conditional loading, or circular-dependency escapes.
- Co-locate or follow the existing package layout; check how the nearest
  package already structures its tests before inventing a new pattern.

## Pitfalls

Skipping RED; trusting implementer self-reports; no independent verification;
editing frozen or generated output (`dist/`, `node_modules/`); mixing biology
and presentation changes in one diff without saying so.
