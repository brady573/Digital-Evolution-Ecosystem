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

### Versioned locally, still not in this repository

As of 2026-10-07 the five definitions are tracked in a git repository at
`~/.config/opencode/agents/` (initial commit `6c79162`). That gives them
history and reviewable diffs, but the repository is **local-only with no
remote**, so the prerequisite above is unchanged: a clone, a fresh device, or
a `proot-distro clear-cache` does not restore the topology. Only `agents/*.md`
is tracked — `cli.json`, `service.json`, and `opencode.jsonc` stay untracked in
the parent directory because they may carry credentials.

### Permissions override, they do not merge

An agent's `permissions:` block **replaces** the effective shell allowlist
rather than adding to the global one in `~/.config/opencode/opencode.jsonc`.
`opencode debug agents` shows the global entries listed under an agent, which
reads like a merge and is not: each specialist's `shell: "*"` deny shadows
every inherited global allow, and only the specialist's own patterns take
effect.

Verified 2026-10-07 against `explore`: `node --version` is allowed globally
and blocked for that agent, while `git log --oneline -1` is allowed because the
agent grants `git log*` itself. Both appear in the agent's allow list; only one
runs.

Two consequences worth knowing before editing these files:

- **`architect` has no `permissions:` block on purpose.** It inherits the
  global list, including `git add`, `git commit`, `git push`, `git fetch`,
  `gh`, `node`, `npm`, `bun`, and `npx`. Adding an explicit block would
  replace that list, and architect is the single writer — it would lose the
  ability to commit.
- **The device-execution rule lives in `experimental.policies`, not the
  allowlist, and it names subcommands rather than tools.** `pnpm` is not on
  the global allow list, so it hits the single shell `ask` rule — but that rule
  grants execution rather than prompting, so plain commands like
  `pnpm --version` and `pnpm test:migration` run freely. What is actually
  refused is the specific sustained workload named in `experimental.policies`.
  The 22 `deny` rules there cover:

| Denied pattern | Stands for |
|---|---|
| `pnpm verify *`, `pnpm verify:simulation *`, `pnpm verify:browser *`, `pnpm verify:evidence *`, `pnpm verify:survey *` | the full repository contract and its classes |
| `pnpm test:survey *`, `pnpm test:browser *`, `pnpm test:mobile-ui *` | long-horizon survey and browser/mobile suites |
| `*pnpm build*`, `*pnpm dev*`, `*npm run build*`, `*npm run dev*`, `*bun dev*` | production builds and dev servers |
| `*vite dev*`, `*vite build*`, `*vite preview*`, `*vite --host*` | the same, via Vite directly |
| `*gradlew*`, `*gradle *` | Android packaging |
| `*playwright install*` | browser binary download |
| `git push *main*`, `git push *master*` | direct pushes to a protected branch |

Narrow `test:*` units are **not** denied and do run on the device — verified
  2026-10-07 with `pnpm test:validation-arch` (`PASS (30 checks)`). Verified
  blocked the same day: `pnpm verify` and `pnpm build`, each refused with
  `Blocked by configuration policy`.

  Six `allow` rules in that block exist only for `watch`-style commands
  (`*gh pr checks --watch*`, `*gh run watch*`, `*tail -f *`, and two sleep-loop
  patterns), so an explicitly long wait can be requested without tripping the
  sustained-workload rule.

  Two distinct refusal messages are expected and both mean "denied":
  `Permission denied: shell` comes from the `permissions` layer, and
  `Blocked by configuration policy` comes from `experimental.policies`.
- **No specialist can run Node or pnpm.** All four (`explore`, `implement`,
  `review`, `test`) carry `shell: "*"` deny and can only read files and use
  git/`grep`/`rg`. Verified for both `explore` and `test` on 2026-10-07:
  `node --version` is blocked for each despite being globally allowed. Any task
  that must execute code belongs to the primary. Note this makes the `test`
  role a coverage *analyst* by necessity — it plans and assesses validation but
  cannot run a single check itself.

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

## Global config edits (device-local, outside this repository)

These live in `~/.config/opencode/` and are not versioned with the project:

| File | Change | Why |
|---|---|---|
| `opencode.jsonc` | Added six read-only allows: `git show`, `git grep`, `git ls-files`, `grep`, `rg`, `wc` | `architect` has no `permissions:` block, so it inherits this list. The read-only commands granted to the specialists were missing here, leaving architect unable to run what its own subagents could. |
| `opencode.jsonc` | Installed `ripgrep` 15.1.0 | The `rg *` allow was inert without the binary. |

Neither edit touched a `deny` rule. The `permissions` layer still has exactly
its original four (`git push *main*`, `git push *master*`, `rm -rf *`, `sudo *`),
and `experimental.policies` still has its original 22.

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

To re-sync the agent topology after a device loss: `~/.config/opencode/agents/`
is a local git repository with no remote, so it cannot be pulled, and
`~/.config/opencode/agents.disabled/` does **not** hold these five — it holds a
different, older set (`planner`, `reviewer`, `scout`, `validator-agent`,
`lattice-steward`, and others) that this project deliberately does not use.
After a restore, `git log` inside `~/.config/opencode/agents/` will recover the
history if the directory survived; otherwise reconstruct the five definitions
from this repository's descriptions of them and verify with
`opencode debug agents`.

The `permissions override, they do not merge` section above is the part most
worth re-reading after a restore, because getting it wrong silently strips an
agent's capabilities rather than erroring.
