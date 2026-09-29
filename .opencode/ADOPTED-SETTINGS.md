# Adopted settings (YoelCieno/settings-opencode → this project)

Source: https://github.com/YoelCieno/settings-opencode (cloned 2026-09-29,
depth 1, to `/tmp/opencode/settings-opencode` for inspection; not committed).

Mode: **project-local selective import**. Nothing global was touched
(`~/.config/opencode` keeps superpowers + custom agents). `install.sh` was
**not** run — it would symlink `~/.config/opencode` to the upstream repo and
clobber this project's `project-manager` + lane topology.

## Vendored (adapted, offline-safe)

| File | Upstream source | Adaptation |
|---|---|---|
| `.opencode/skills/socratic-design/SKILL.md` | `skills/socratic-design/` | `question` tool; Owner-gated web; lane/Owner stop rules |
| `.opencode/skills/discuss/SKILL.md` | `skills/discuss/` | No Context7/Serena; Owner-gated web; handoff via `digital-evolution` |
| `.opencode/skills/strategic-compact/SKILL.md` | `skills/strategic-compact/` | Durable state → `/sdcard/DEE/<topic>/`, never `./docs/` |
| `.opencode/skills/tdd-workflow/SKILL.md` | `skills/tdd-workflow/` | Added missing frontmatter; `pnpm verify` gate; `legacy/prototype/` frozen |
| `.opencode/skills/test-coverage/SKILL.md` | `skills/test-coverage/` | pnpm; no vitest/`fe-*` assumptions |
| `.opencode/skills/security-review/SKILL.md` | `skills/security-review/` | Slim rewrite (upstream assumes Next.js/Supabase/Solana — N/A here) |
| `.opencode/commands/discuss.md` | `commands/discuss.md` | Runs in current session, loads `discuss` skill |

## Deliberately skipped (and why)

- `conductor` + 16 subagents (`opencode.jsonc:agent`) — conflicts with the
  `project-manager` → lanes → `digital-evolution` topology. `default_agent`
  stays `project-manager`.
- `instructions/` (`subagent-routing`, `serena`, `verification-gate`) —
  upstream routing contradicts lane dispatch; Serena needs `uv`/network.
- `mcp.servers` (serena, context7, Figma), `plugins/` (auto-compact,
  notification, bootstrap, memory), `provider`/`model` env block
  (`OPENCODE_MODEL_*`) — network/paid/macOS-specific; violate offline-first
  and the no-paid-providers rule.
- `skills`: `nodejs-clean-architecture` (Fastify/Prisma/Zod — wrong stack),
  `frontend-hexagonal`, `use-ai-sdk`, `openspec-*`, `memory-status`,
  `skill-from-history`, `caveman*`, `ask` (Serena/Context7-bound),
  `coding-standards` (references missing `instructions/development-patterns`),
  `git-workflow` (enforces conventional commits + `type/scope-desc` branches;
  this repo's history uses `A3.2: …`, `feat/tranche-…`, PR-template Areas).
- `commands/` beyond `discuss` — all others bind to upstream agents
  (`ask`, `planner`, `reviewer`, …) that do not exist here; copying them
  verbatim would create broken `/commands`.
- `profiles/`, `openspec/`, `tools/`, `scripts/`, `skills-store/`,
  `cli.json`/`tui.json`/`service.json` — personal-machine or upstream-stack
  concerns; global `cli.json` untouched.

## Refreshing

To re-sync: re-clone upstream to `/tmp`, diff `skills/<name>/SKILL.md`
against the adapted copies above, and re-apply the adaptation column —
never copy verbatim. Keep this file updated when adding or dropping skills.
