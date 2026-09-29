---
name: discuss
description: Evidence-first collaborative decision-making. Use when weighing options or tradeoffs together ("should we X or Y", "let's discuss", "compare options"). Probes context first, cites sources, waits for "go ahead" before producing output.
---

# Discuss (DEE adaptation)

Source: https://github.com/YoelCieno/settings-opencode (`skills/discuss/SKILL.md`).
Adapted for this repo: offline-first, no Context7/Serena, Owner-gated web use.

## When This Skill Activates

- User invokes `/discuss`, or says "what do you think about X vs Y",
  "should we do X or Y", "let's discuss", "compare options", "decision needed".
- Multiple valid approaches exist and need structured comparison.

## 1. Probe Context Before Analysis (mandatory)

Do NOT compare options until you understand the situation. Ask 1–3 questions
max (use the `question` tool), covering: experience/preference, team context,
constraints (offline-first, determinism, architecture rules), scale/scope, and
what was already tried. Skip probing only when the message demonstrably
contains all needed context. If you catch yourself guessing mid-comparison,
stop and ask.

## 2. Evidence First, Opinions Second

- Read relevant files — cite exact `path:line`.
- Check git history — `git log --oneline -20`, `git show <hash>`.
- Check project docs — `AGENTS.md`, `CONTRIBUTING.md`, `docs/architecture/`.
- Web research only with Owner approval; never automatic. Cite full URLs.
- Never present an empty search as proof of absence; confirm a negative
  a second way before claiming something does not exist.

Source format: `file:path:line`, `git:hash`, `docs:path#section`, `web:url`.

## 3. Compare Options with Tradeoffs

2–4 options max, each tied to the user's context:

```text
## Option A: [name] — What / Pros / Cons / Sources
## Option B: [name] — What / Pros / Cons / Sources
## Recommendation: [A, B, hybrid, or "it depends"] — rationale + tradeoffs accepted
```

Describe objective characteristics, never label people ("for juniors",
"simple for non-experts"). "It depends" is valid when the deciding factor
is still unknown — then ask the deciding question.

## 4. No Fluff

No "Great question!", no overlong intros, no hedging, no repeating the user
back. State facts, cite evidence, present tradeoffs.

## 5. Collaborative Conclusion Flow

1. Summarize the agreed path in 2–3 sentences.
2. Wait — do NOT auto-implement or auto-plan.
3. Say: "Ready when you are. Say 'go ahead' and I'll [produce plan | write handoff | implement]."
4. On "go ahead": implementation goes through the repo workflow
   (project-manager handoff → `digital-evolution`), not a direct edit from
   a discussion. Always end with a `Source/s:` section.

## What NOT To Do

Do NOT compare before probing; do NOT auto-implement before "go ahead";
do NOT assume sufficient context; do NOT hallucinate sources; do NOT output
a decision record before a decision is reached.
