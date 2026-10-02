# Aftermath Stage 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the live-session Aftermath flow from pinned impact through 25,000-tick observation to one identity-supported development or truthful quiet settlement, with real-record History navigation.

**Architecture:** Pure Explorer-side modules project eligible evidence and implement presentation lifecycle. `App.tsx` orchestrates the World, one-sheet priority, navigation, and Follow; runtime and analysis contracts remain authoritative and unchanged. Development surfaces only when a stable identity link proves association; otherwise the production experience stays quiet.

**Tech Stack:** TypeScript, React/Vite, existing contracts/runtime/analysis, Canvas2D, Node/tsx validation, Playwright browser captures.

**Spec:** `docs/superpowers/specs/2026-10-01-aftermath-stage-2-design.md`

## Global Constraints

- Observation horizon is exactly 25,000 simulation ticks from `aftermath.resolutionTick`, independent of wall-clock time and playback speed.
- Material developments do not reset, shorten, or extend the observation horizon.
- Only authoritative world extinction may currently settle before the horizon; metric stability never does.
- Do not infer Aftermath linkage from chronological proximity. Require a stable identity relationship for a downstream record; otherwise stay quiet.
- Do not fabricate production evidence, History records, matched-control links, analysis output, biological state, or `UniverseCheckpoint` fields.
- UI operations are zero-tick and do not control playback. Pending decisions retain priority over Aftermath presentation.
- Keep one foreground Aftermath and at most one expanded phone sheet; keep the World dominant.
- Preserve existing decision, direct-effect, World, phenotype, History, Tree, Experiments, camera, and persistence semantics.
- No Investigation Thread / `threadId`, new analysis detector, Pixi cutover, Foundation read-model redesign, or broad History redesign.

## Review Focus

- Tick boundary / overshoot: settlement must occur at the first observed snapshot whose tick reaches `resolutionTick + 25_000`; cover exact boundary and skipped-over horizon.
- Missing or unstable record linkage: later History records must not appear as development based on chronology or shared generic event provenance alone; cover unrelated record, valid stable link, and no-link quiet outcome.
- Supersession/preemption: a new decision hides Stage 2 without losing retained evidence, and a newer foreground Aftermath does not erase prior durable History; cover both transitions.
- Playback intent / UI operations: expanding, collapsing, Following, and History navigation must not advance ticks or issue pause/resume; preserve existing auto-resume/prior-paused regression coverage.
- Viewport constraints: compact observation and contextual development keep one sheet and World dominance at 320, 390, and 430 CSS px; include desktop regression.

---

## File Map

- Create `apps/explorer/src/experience/aftermath/model.ts` — Explorer presentation types and constants, including the 25,000-tick horizon.
- Create `apps/explorer/src/experience/aftermath/project.ts` — pure strongest-supported-evidence selection with stable identity linkage only.
- Create `apps/explorer/src/experience/aftermath/lifecycle.ts` — pure impact/observation/development/settlement/suspension/supersession transitions.
- Create bounded Aftermath observation/development/settlement UI component(s) under `apps/explorer/src/` — contextual World overlay and actions.
- Modify `apps/explorer/src/App.tsx` and existing styles — lifecycle orchestration, sheet priority, History destination, optional Follow/lens behavior, no simulation commands for presentation actions.
- Create `tools/validation/aftermath-stage2.ts` — deterministic pure projection/lifecycle and zero-tick behavior tests.
- Modify `tools/validation/browser-smoke.ts` or add a focused browser validator plus manifest/package wiring where needed — production flows only where authoritative supported evidence is available; fixture-only UI states remain clearly labeled test setup.
- Add/update capture logic in `tools/validation/landscape-capture.ts` only if existing hooks can capture the Stage 2 states deterministically without introducing production evidence.

## Task 1: Pure evidence projection and lifecycle

**Files:**
- Create `apps/explorer/src/experience/aftermath/model.ts`
- Create `apps/explorer/src/experience/aftermath/project.ts`
- Create `apps/explorer/src/experience/aftermath/lifecycle.ts`
- Create `tools/validation/aftermath-stage2.ts`
- Modify `package.json` and `tools/validation/manifest.ts` only if this validation is a distinct unit; otherwise extend the existing aftermath unit losslessly.

**Interfaces:**
- `projectAftermath(input: AftermathProjectionInput): AftermathProjection` consumes current Aftermath, current tick/extinction, available History records, and any already-existing comparison evidence; returns phase, one optional development, settlement wording/class, and only stably linked History IDs.
- `transitionAftermath(state: AftermathPresentationState, event: AftermathLifecycleEvent): AftermathPresentationState` handles impact acknowledgement, expand/collapse, tick observation, pending-decision suspension/resumption, supersession, Follow toggle/manual-lens override, and History navigation intent without issuing commands.
- Keep types presentation-side; do not change cross-boundary contracts for convenient linkage.

- [ ] **Step 1: Write tests that reject chronological-only linkage and pin horizon semantics**

Test named cases: `doesNotLinkLaterHistoryByChronology`, `acceptsOnlyExplicitStableIdentityLink`, `staysQuietWhenNoDevelopmentLinkExists`, `settlesAtResolutionTickPlus25000`, `doesNotSettleFromMetricStability`, `extinctionMaySettleEarly`, `developmentDoesNotResetHorizon`, and `strongestSupportedEvidenceWins`.

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `pnpm exec tsx tools/validation/aftermath-stage2.ts`
Expected: failing assertions for missing projection/lifecycle behavior.

- [ ] **Step 3: Implement model, projection, and pure transitions**

Define `AFTERMATH_OBSERVATION_TICKS = 25_000`. Treat a tick `>= resolutionTick + 25_000` as horizon reached, including skipped-over snapshots. Use extinction only as the early terminal condition. Development candidates must carry a pre-existing stable link to the foreground Aftermath; chronological position, generic shared provenance, and originating event lineage alone do not establish linkage to a later record. On no qualifying candidate, return the exact quiet settlement meaning from the spec. Keep at most one strongest candidate and deterministic tie ordering.

- [ ] **Step 4: Run the focused test and confirm it passes**

Run: `pnpm exec tsx tools/validation/aftermath-stage2.ts`
Expected: all projection and transition cases pass.

- [ ] **Step 5: Run existing aftermath and validation architecture checks**

Run: `pnpm test:aftermath && pnpm validation:check`
Expected: existing retained-impact/runtime behavior and manifest architecture remain green.

## Task 2: Stage 2 UI and App orchestration

**Files:**
- Create Stage 2 observation/development/settlement component(s) in `apps/explorer/src/`
- Modify `apps/explorer/src/App.tsx`
- Modify Explorer stylesheet(s) identified by existing aftermath/sheet selectors
- Extend `tools/validation/aftermath-stage2.ts` only for pure state behavior; browser behavior belongs in Task 3.

**Interfaces:**
- UI receives projected Aftermath state and callbacks for presentation intent only.
- App owns sheet slot order, surface navigation, pending-decision priority, retained foreground lifecycle state, and Follow/lens coordination.
- No presentation callback calls runtime advance, pause, resume, resolve, or mutation commands.

- [ ] **Step 1: Add pure orchestration tests for presentation actions and preemption**

Test cases: impact remains continuous into observation; collapse/expand do not alter playback intent or tick; pending decision suspends/hides Aftermath while retaining state; foreground supersession changes only the foreground; manual lens override prevents later automatic lens switching for that Follow session; History intent carries only a real linked `HistoryRecordId`.

- [ ] **Step 2: Run focused tests and confirm they fail**

Run: `pnpm exec tsx tools/validation/aftermath-stage2.ts`
Expected: new orchestration assertions fail before App integration.

- [ ] **Step 3: Integrate Stage 2 as a compact World overlay with priority-safe expansion**

Show impact in the existing decision sheet slot. After impact, default to compact non-modal observation. Allow one development to expand contextually without pausing. At horizon or extinction show settlement. Apply priority: pending decision, expanded Aftermath, expanded inspection, compact Aftermath, ordinary controls. Preserve previous lens/camera only as current viewport state; do not restore hidden state after manual lens changes.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `pnpm exec tsx tools/validation/aftermath-stage2.ts && pnpm typecheck`
Expected: lifecycle/orchestration tests and TypeScript checks pass.

## Task 3: Browser flows, responsive evidence, and History navigation

**Files:**
- Modify `tools/validation/browser-smoke.ts` or add `tools/validation/aftermath-stage2-browser.ts`
- Update `package.json` and `tools/validation/manifest.ts` if adding a distinct browser unit
- Update `tools/validation/landscape-capture.ts` if exact supported production states can be captured via existing deterministic hooks
- Modify UI/styles only for defects exposed by these checks.

**Interfaces:**
- Browser validator exercises normal product commands and real snapshot/History data.
- Pure fixture tests may exercise development-card rendering, but must be isolated as test fixtures and cannot be presented as production evidence.
- Review in History appears only when a real linked durable record exists and selects that exact `HistoryRecordId`.

- [ ] **Step 1: Add browser tests for impact→observation, quiet settlement, decision preemption, and valid/absent History link**

Assert no blank intermediate sheet, compact observation after Continue watching, exact settled copy at the horizon, no quiet-state fake record/link, preemption retaining aftermath, and History navigation only for an existing linked record. Add material-development browser flow only if current production contracts provide a stable identity-linked record; otherwise use a clearly marked isolated UI fixture and record the production evidence-link gap.

- [ ] **Step 2: Run the focused browser test on the approved preview setup**

Run: repository-standard focused browser command against one preview server.
Expected: supported flows pass; unavailable production-linked development is documented, not simulated as real evidence.

- [ ] **Step 3: Capture 320/390/430 phone and desktop states**

Capture impact, compact observation, development/settlement (fixture-only where needed and labeled), and pending-decision preemption. Verify no more than one expanded sheet; compact strip is approximately 64 CSS px or less; at 390×844 persistent chrome plus compact Aftermath leaves about 70% World visible; expanded contextual card is approximately one-third viewport height.

- [ ] **Step 4: Verify zero-tick operations and broader targeted gates**

Run: `pnpm test:aftermath && pnpm test:decisions && pnpm test:landscape && pnpm test:phenotype && pnpm test:mobile-ui && pnpm test:browser && pnpm typecheck && pnpm build`
Expected: all targeted checks pass; browser/phone evidence is retained for exact candidate head.

## Task 4: Repository contract and handoff evidence

**Files:**
- Update validation wiring/tests only if the implementation adds a new unit; preserve manifest/shard union guarantees.
- Update this spec/design only for as-built deviations approved within implementation freedom.

- [ ] **Step 1: Inspect `pnpm validation:plan` and diff-routed CI units**

Expected: all blocking manifest units required by changed domains are identified; no ad-hoc workflow command is added.

- [ ] **Step 2: Run local fast/narrow gates and full repository gate where appropriate**

Run: `pnpm verify:fast`, followed by `pnpm verify` when device/runtime limits permit; otherwise rely on exact-head CI covering the equivalent blocking manifest units.
Expected: record exact command, revision, and results; do not overstate aggregate-command status.

- [ ] **Step 3: Produce the required return package**

Report exact source-to-presentation traceability and causal strength for each development/settlement message, 25,000-tick behavior, real History linkage evidence, all local/CI validations, phone/desktop evidence, and the exact production evidence-link and persistence limitations. Confirm no out-of-scope subsystem was activated.
