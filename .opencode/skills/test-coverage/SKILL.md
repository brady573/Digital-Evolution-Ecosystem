---
name: test-coverage
description: Analyze test coverage and identify gaps. Use when asked to check coverage, find uncovered code, or before declaring a feature complete. Prioritizes critical code first.
---

# Test Coverage (DEE adaptation)

Source: https://github.com/YoelCieno/settings-opencode (`skills/test-coverage/SKILL.md`).
Adapted: pnpm toolchain, repo test layout, no framework-specific assumptions.

## When to Activate

User says "check coverage" / "test coverage" / "coverage report" / "find
uncovered code"; before declaring a feature complete; when CI coverage drops.

## Process

1. Find how the touched package measures coverage (read its `package.json`
   scripts first — do not assume vitest/jest flags or `*.spec.ts` layout).
2. Run the narrowest coverage check for the touched area.
3. Analyze results — identify low-coverage areas, prioritized by criticality
   (simulation correctness and determinism first, then persistence/checkpoint
   contracts, then UI).
4. Generate missing meaningful tests following existing project conventions.

## Report Shape

```text
Summary table (file | % stmts | % branch | % funcs | % lines)
Low-coverage files (below target, criticality-ordered)
Uncovered lines (specific lines needing tests)
Plan: Critical (now) / High (this change) / Medium (when touching the file)
```

## Notes

- Coverage is a metric, not a goal. Meaningful tests over number-chasing.
- Never weaken gates to hit a number.
- Keep simulation, UI, and analysis test changes in separate diffs where possible.
- `pnpm verify` remains the completion contract; a single coverage run proves
  a single claim.
