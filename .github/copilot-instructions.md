# Copilot Instructions

Follow `AGENTS.md` for all work in this repository.

Key points:

- TypeScript monorepo (pnpm workspaces): `apps/explorer`, `packages/*`, `tools/validation`.
- Verify with `pnpm verify` before considering a change complete.
- Respect the dependency direction: UI -> runtime -> sim-core; analysis is read-only and never changes biology.
- Never edit `legacy/prototype/`; never weaken tests, validation gates, or CI to make a change pass.
