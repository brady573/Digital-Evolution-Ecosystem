---
name: strategic-compact
description: Keep long multi-phase work resumable across compaction. Maintain a durable session checkpoint (goal, phase, decisions, evidence, next steps) at phase boundaries instead of relying on chat history.
---

# Strategic Compact (DEE adaptation)

Source: https://github.com/YoelCieno/settings-opencode
(`skills/strategic-compact/SKILL.md`). Adapted: durable state lives outside
the repo so checkpoints never pollute the diff.

## Purpose

Compaction can happen at any time. Never rely on chat history as the only
source of truth. Never ask the user to manage compaction timing — silently
maintain durable state and continue.

## Durable State Location

- Default: `/sdcard/DEE/<topic>/session-log.md` (review-output location per
  `AGENTS.md` working convention 7; the repo stays the source of truth).
- Fallback when shared storage is unavailable: `/tmp/opencode/session-log.md`.
- Do NOT write session logs under `./docs/` or other repo paths unless the
  Owner explicitly asks — that would pollute the diff and break the
  small-reviewable-diff discipline.

## Stability Conditions

Compaction is safe only when: no broken mid-refactor state (or the scope is
bounded and documented), the goal and plan are written down, key decisions
and assumptions are recorded, and a clear next-action checklist exists.
Otherwise stabilize first: finish the smallest coherent chunk, or save a WIP
plan + diff summary + immediate next steps.

## Checkpoint Schema (use exactly)

```text
## Goal
## Current phase (research / plan / implement / test / debug)
## Current state
## Decisions & constraints
## Evidence (files/commands/results — write "unknown" when missing)
## What worked
## What didn't work
## Not attempted / remaining
## Next steps (checklist, concrete and executable)
```

Be concise, prefer bullets, always include file paths.

## Phase Boundaries

Treat as likely compaction moments: research → plan, plan → implementation,
milestone → testing, debug resolved → feature work, failed approach →
alternate approach, or signs of context pressure (looping, lost thread,
repeated questions). At each boundary: update durable state, ensure a clean
resumable plan, make next steps explicit and minimal.

## Per Phase (autonomous rules)

- Research: keep raw exploration short-lived; promote tested hypotheses,
  discovered constraints, and the recommendation into durable state plus a
  brief Plan section before leaving.
- Planning: record target files/modules, sequencing, risks/unknowns, and how
  success is verified (narrowest check from `tools/validation/manifest.ts`).
- Implementation: work in coherent increments; if mid-change at a boundary,
  write a WIP checkpoint (changed so far / remaining / safe completion /
  verification).
- Testing/validation: record commands run and outcomes; on failure record the
  first failing signal, suspected cause, and next debug steps.
- Debugging: keep a tight symptom → cause → fix → verification log, then a
  short postmortem note in durable state.

## Triggers

Update durable state when: a milestone is reached, strategy changes, subtask
focus switches, the conversation grows long, or repetition/confusion appears.
If writing to disk is impossible, output the schema in-chat and continue.
Success = after compaction the work resumes immediately from durable state
with no lost plan or decision.
