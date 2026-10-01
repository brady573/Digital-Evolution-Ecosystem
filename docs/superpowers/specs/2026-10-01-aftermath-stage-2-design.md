# Aftermath Stage 2 — Explorer Lifecycle and Evidence Design

**Status:** Design draft based on the active Lane 2 handoff and Owner-approved 25,000-tick settlement rule. Implementation has not started.

## Objective

Complete the live-session Aftermath flow from pinned direct effect through bounded observation to either one strongest supported development or a truthful quiet settlement, while keeping the living World primary and directing players only to real durable History evidence.

## Accepted constraints

- `sim-core` remains the sole biological authority; `sim-analysis` remains read-only interpretation authority; `sim-runtime` owns decision resolution, direct-effect evidence, current snapshot, pending-decision gating, and playback.
- Explorer Experience owns Stage 2 presentation lifecycle, development selection, sheet orchestration, temporary Follow behavior, and History navigation.
- Canvas rendering owns no Aftermath lifecycle, causality, materiality, persistence, or navigation.
- Observation ends at `aftermath.resolutionTick + 25_000` simulation ticks. It does not depend on wall-clock time or playback speed. Earlier material developments do not reset, shorten, or extend the window.
- At the horizon, settle automatically using the strongest supported evidence observed in the window. If none qualifies, use “little/no major measured response within the observation window.” Early settlement is allowed only for an authoritative terminal condition that makes further observation meaningless; currently this is world extinction. Metric stability is not a terminal condition.
- Collapse, expand, Follow, stop Follow, dismiss, settle, and History navigation are presentation operations: zero ticks, no biological mutation, no hidden playback command.
- Existing impact comparison remains pinned same-tick evidence. Resolving a decision preserves prior play intent and transitions continuously into impact. Pending decisions preempt the large sheet without deleting retained evidence.
- At most one expanded phone sheet; priority is pending decision, expanded Aftermath, expanded inspection, compact Aftermath, ordinary controls. Compact observation is approximately 64 CSS px or less; at 390×844 it should leave about 70% of the viewport unobscured by persistent chrome and compact Aftermath. Expanded development/settlement remains contextual, around one-third of viewport height.
- History remains the durable record authority. Never manufacture an ecological record. Do not add Investigation Thread identity, new analysis detectors, checkpoint fields, a generic effects/event system, or production Pixi.
- Active Aftermath save/resume continuity is deferred if the existing presentation-side persistence boundary cannot support it without widening `UniverseCheckpoint`; report the exact missing dependency.

## Architecture

Use the existing authority flow: simulation and analysis truth → runtime-retained evidence/current snapshot/History → pure Explorer-side Aftermath projection and lifecycle → UI and navigation. Add a focused `apps/explorer/src/experience/aftermath/` area for presentation types, pure evidence projection, and pure lifecycle transitions. `App.tsx` remains responsible for the single expanded-sheet slot, pending-decision priority, surface navigation, and Follow/lens coordination. Existing `AftermathPanel` continues to present direct impact; Stage 2 observation/development/settlement UI is contextual and subordinate to the normal World.

The lifecycle is `impact → observation → development (optional) → settlement`, with presentation-only suspension on pending-decision preemption and foreground supersession when a later intervention becomes current. Retained runtime evidence is not deleted by suspension or collapse. Only one foreground Stage 2 experience is presented; older durable evidence remains reachable through History.

## Evidence and language

Select at most one strongest supported development; replace weaker generic wording when stronger evidence describes the same development. Evidence precedence is: matched comparison evidence already available in contracts, durable sim-analysis/History record, explicitly declared Aftermath-comparable measured response, then absence of qualifying evidence at the horizon. Do not call arbitrary metric movement an ecological development. Later observation is descriptive, not causal. Causal language remains restricted to the intervention’s guaranteed direct mechanical effect and its retained before/after evidence. Quiet settlement claims only that little/no major measured response qualified within the observation window.

History review is offered only when a real durable `HistoryRecordId` is associated with the Aftermath/development. Existing decision-history records remain valid durable evidence; no synthetic ecological record is created to fill a gap. Identity namespaces remain distinct. Chronological proximity is never a linkage rule: a History record after `resolutionTick` is not thereby an Aftermath development. The originating event/History relationship may be shown as provenance, but cannot prove that a later ecological record belongs to this Aftermath. If no existing stable identity relationship proves that association, remain in observation and settle quietly at the horizon. Tests may use explicit fixtures to exercise development UI/projection, but must not manufacture production evidence.

Follow is optional. It may select a relevant analytical lens or focus only on a spatial target explicitly identified by retained evidence. No local impact zone or camera movement is invented. A manual lens change disables later automatic lens switching for that Follow session; it does not end Aftermath or restore hidden camera state.

## Open implementation evidence constraint

Current contracts expose retained immediate-impact evidence and current analysis/history, but no retained per-Aftermath history-link field, no durable window of observations, and no matched-control result per later development. Implementation must use only supportable existing records/fields, maintain strongest evidence observed during the active live session without introducing biological state, and clearly report any development class or History association that cannot be supported from current sources. Do not expand cross-boundary contracts to fabricate evidence. If a required linkage cannot be established by stable existing IDs, omit the History affordance for that case.

## Acceptance and validation

Cover impact continuity, auto-resume/prior pause, stable direct-effect evidence, compact observation, strongest-evidence precedence, development, quiet progression/settlement, exact 25,000-tick horizon, early extinction-only settlement, pending-decision suspension, supersession, foreground singularity, zero-tick UI actions, Follow manual override, valid History navigation, and phone-sheet priority. Existing decision/runtime, World projection, phenotype, History, Tree, Experiments, camera, pan/zoom, minimap, toroidal rendering, desktop, and phone behavior must not regress.

Validation requires focused pure projection/lifecycle tests; browser flows for impact→observation, material development→settlement, quiet settlement, and decision preemption; zero-tick assertions; real-record History navigation tests; phone captures at 320/390/430 widths and desktop evidence. Reuse current Android evidence unless the implementation materially depends on Android/WebView behavior. Run the relevant aftermath, decision, landscape/world-presentation, phenotype, mobile UI, browser smoke, build, typecheck, and repository validation gates. AC20 is satisfied by `pnpm verify` or equivalent repository-native CI evidence covering every blocking manifest unit on the exact implementation revision.

## Explicitly out of scope

Investigation Thread Phase 1 or `threadId`; prediction; branching/multi-investigation quest management; full investigation-session persistence; broad History/Tree redesign; new biology; new analysis detectors solely for UI; production Pixi; Foundation live-frame/read-model redesign; generic effects/event systems; threshold changes; or changed reproducibility semantics.
