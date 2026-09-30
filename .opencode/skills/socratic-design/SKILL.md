---
name: socratic-design
description: Evidence-first decision gating for planning and design. Use before planning or implementation when outcome, scope, constraints, or facts are unresolved — ask exactly one dependency-safe question at a time before proposing a plan.
---

# Socratic Design (DEE adaptation)

Source: https://github.com/YoelCieno/settings-opencode (`skills/socratic-design/SKILL.md`).
Adapted for this repo: offline-first, lane/Owner workflow, no network MCPs.

## When to Activate

Before any planning, design, architecture, or refactor work when critical
decisions are not yet closed. Resolve those decisions with evidence before
producing a plan or implementation. Complements the project-manager lane
dispatch: accepted design comes from the task text, never inferred from code.

## Non-Negotiables

- Exactly 1 question per turn (use the `question` tool; no prose-only "?" dumps).
- Each turn includes: Question, Recommended answer, Why, If-opposite path change.
- Inspect the repo first when the repo can answer (`read`/`grep`/`glob`).
- No plan or implementation before critical decisions are closed.
- Web research only with Owner approval (project-manager rule). Never automatic.

## Order (strict)

1. Outcome
2. Scope
3. Constraints
4. Facts
5. Invariants (determinism, offline-first, architecture rules in `AGENTS.md`)
6. Options
7. Tradeoffs
8. Decision
9. Validation (narrowest check from `tools/validation/manifest.ts`)
10. Exec gate (who implements: `digital-evolution` via bounded handoff)

## Question Gate

Each question must be atomic, consequential, falsifiable, and dependency-safe.
No child question while its parent is still open.

## Turn Shape

- Evidence: ...
- Question: ...
- Recommended: ...
- Why: ...
- If opposite: ...

## Internal Log

Track: `id | status(open/resolved/assumed) | deps | answer | confidence | evidence`.

## Stop

Stop asking only when outcome/scope/constraints are resolved, critical risks
are mitigated or accepted, validation is defined, and no critical open
dependencies remain. Then output: shared understanding, resolved decision
tree, open risks + owner, plan skeleton.

## Safety

- If stuck, offer 2–3 bounded options.
- Security, production, or irreversible steps get an explicit warning.
- Never resolve a material product/simulation conflict by vote — surface it to the Owner.
- Tone rigorous, non-hostile. Keep updates short.
