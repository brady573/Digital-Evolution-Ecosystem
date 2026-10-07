# Adopted settings (YoelCieno/settings-opencode → this project)

Source: https://github.com/YoelCieno/settings-opencode (cloned 2026-09-29,
depth 1, to `/tmp/opencode/settings-opencode` for inspection; not committed).

Mode: **project-local selective import**. Nothing global was touched
(`~/.config/opencode` keeps the global `architect` team). `install.sh` was
**not** run — it would symlink `~/.config/opencode` to the upstream repo and
replace the global agent team this project now relies on.

## Required local prerequisite: the global `architect` team

`.opencode/opencode.json` sets `default_agent` to `architect`, but **no agent
definition is committed to this repository**. The `architect`, `explore`,
`implement`, `review`, and `test` definitions live in
`~/.config/opencode/agents/`, so a clone without them does not get this topology.

The failure is silent. If the named default agent is not visible, OpenCode falls
back to a built-in primary rather than erroring, and the session then runs on a
different agent than the one intended — the launched agent's own self-report is
not reliable evidence of which one actually started.

To reproduce the fallback: point `default_agent` at a nonexistent name in a
scratch directory and start a session; it runs as `build`.

Verify the topology after cloning:

```sh
opencode debug config   # default_agent should read "architect"
opencode debug agents   # architect must be present as a primary
```

If `architect` is absent, populate `~/.config/opencode/agents/` before relying on
this repository's OpenCode configuration. The `legacy/prototype/**` edit deny in
`.opencode/opencode.json` is independent of this prerequisite and applies
regardless.

## Vendored (adapted, offline-safe)

| File | Upstream source | Adaptation |
|---|---|---|
| `.opencode/skills/socratic-design/SKILL.md` | `skills/socratic-design/` | `question` tool; Owner-gated web; Owner stop rules |
| `.opencode/skills/discuss/SKILL.md` | `skills/discuss/` | No Context7/Serena; Owner-gated web; `architect` implements |
| `.opencode/skills/strategic-compact/SKILL.md` | `skills/strategic-compact/` | Durable state → `/sdcard/DEE/<topic>/`, never `./docs/` |
| `.opencode/skills/tdd-workflow/SKILL.md` | `skills/tdd-workflow/` | Added missing frontmatter; `pnpm verify` gate; `legacy/prototype/` frozen |
| `.opencode/skills/test-coverage/SKILL.md` | `skills/test-coverage/` | pnpm; no vitest/`fe-*` assumptions |
| `.opencode/skills/security-review/SKILL.md` | `skills/security-review/` | Slim rewrite (upstream assumes Next.js/Supabase/Solana — N/A here) |
| `.opencode/commands/discuss.md` | `commands/discuss.md` | Runs in current session, loads `discuss` skill |

## Deliberately skipped (and why)

- `conductor` + 16 subagents (`opencode.jsonc:agent`) — conflicts with the
  global `architect` team this project now uses. `default_agent` is
  `architect`; specialists come from `~/.config/opencode/agents/`.
- `instructions/` (`subagent-routing`, `serena`, `verification-gate`) —
  upstream routing contradicts the architect/specialist split; Serena needs
  `uv`/network.
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
