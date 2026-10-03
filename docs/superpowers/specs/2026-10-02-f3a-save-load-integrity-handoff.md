# Lane 3 F3a — Save/Load Failure Integrity & Atomic Restore — Coding Agent Handoff

Verbatim copy of GitHub issue #96 ("Lane 3 F3: Persistence Integrity & Recovery"), Coding Agent Handoff 1.

Status: ACTIVE FOUNDATION & TRUST ISSUE — F3 PERSISTENCE & RECOVERY
Baseline: `main @ 9c3e9c04835091faf94c0eb67f6a4bac1fe07d05`

## Governing rule

> A save or restore operation either completes as one coherent operation or leaves the previously valid world/save state intact and truthfully reports what failed.

F3 splits into F3a (this handoff), F3b (storage durability), F3c (presentation/investigation persistence), F3d (terminal runtime recovery — explicitly unauthorized until the Owner chooses authoritative recovery semantics after worker death).

## Required behavior (F3a)

1. **Versioned save envelope** — one versioned record containing envelope version, slot id, saved-at, display/index metadata (tick, engine version), the authoritative `UniverseCheckpoint`, and presentation adjuncts (Pixel Phenotype anchors). Metadata never overrides checkpoint truth.
2. **One coherent repository read** — checkpoint and adjuncts come from one stored record/read transaction, never independently timed reads. Legacy/unversioned records normalize in memory; never rewrite a legacy save merely because it was loaded.
3. **Failed save preserves prior confirmed save** — report success only after the transaction completes; individual request success is insufficient.
4. **Prepare → validate/decode → commit runtime restore** — all candidate state constructed before mutating the live session. One checkpoint validation/canonicalization path only.
5. **Failed load preserves active world** — runtime world, presentation world, world identity, settings, selection, phenotype cache all stay pre-load. Prior playback intent restored on ordinary rejection; terminal failure stays stopped.
6. **Transactional presentation adjunct staging** — defer staging until restore success, or stage with explicit rollback. Never move anchors into `UniverseCheckpoint`.
7. **Truthful failure UX** — typed classification, not message-text parsing. Distinguish: no save exists / storage read failed / read but unrestorable by this build / write failed.
8. **No new authority** — the envelope is not a second checkpoint, simulation state machine, evidence export, read-model authority, or worker-recovery journal.

## Acceptance criteria

AC1 save commit truthfulness · AC2 failed overwrite preservation · AC3 coherent record read · AC4 legacy record compatibility · AC5 restore prepare/commit boundary · AC6 rejected load leaves runtime unchanged · AC7 no presentation world switch on failure · AC8 presentation adjunct rollback · AC9 playback intent recovery · AC10 successful restore parity · AC11 existing product behavior preserved · AC12 no authority expansion · AC13 canonical validation remains singular · AC14 canonical validation path stays mutation-free before commit · AC15 canonical validation path stays deterministic · AC16 wired into repository validation conventions, `pnpm verify` green.

## Protected invariants

A3.3 source-schema preflight authoritative · engine-version guard authoritative · A3.4 canonicalization/validation ordering authoritative · checkpoint schema/meaning unchanged unless a blocker is returned to the Owner · evidence export separate from checkpoints · Pixel Phenotype anchors presentation-only · Aftermath save semantics unchanged (no retained Aftermath in checkpoint or adjunct persistence) · Lane 3 `READ_MODEL_VERSION=1` boundary and staggered cadence unchanged · terminal worker failure stays a truthful stopped state, no auto-reconstruction · successful restore yields a fresh displayed-world identity with no presentation leak · offline-first.

## Non-goals

Automatic worker reconstruction · recovery from last presentation frame · autosave/version history/multiple slots · cloud/network persistence · SQLite migration · broad Capacitor native-storage migration · persistent-storage permission UX · storage quota dashboard · Investigation session continuity · new checkpoint fields for UI convenience · retained Aftermath persistence · evidence-export redesign · broad `App.tsx` decomposition · compiler/required-CI policy changes · production Pixi work · biological or decision-semantics changes.

## Owner return conditions

Return to the Owner before proceeding if: failure atomicity appears to require a checkpoint-schema or reproducibility-contract change; runtime recovery design requires choosing authoritative state after worker death; adjunct persistence needs to become part of resumable checkpoint meaning; existing restore APIs cannot be made prepare/commit atomic without changing simulation semantics; platform-specific persistence requires a player-visible fallback that materially changes supported offline/save guarantees.

Do not escalate ordinary choices of envelope name, helper location, transaction wrapper, test seam, or error-class naming.

## Owner device execution rule (non-negotiable)

Long-running jobs on the Owner's device are strictly prohibited. Short bounded authoring or diagnostic commands only. Long validation, exhaustive suites, builds, browser suites, performance characterization, surveys, and sustained workloads run in CI or another approved non-Owner environment.