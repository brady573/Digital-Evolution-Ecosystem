# Project Plan

> Derived from the raw requirements in `project.md`. The AI converts the user's
> free-form requirements into structured, ID'd requirements here, then plans and
> tracks the work. Reference these IDs in `projectTest.md` and in code comments
> (e.g. `// impl: REQ-CORE-001`) so everything stays traceable — run
> `vibecoding trace` to see coverage.

## Current Phase

Pre-M7 stabilization gate (Tranche A). Product features below are implemented
and running; the gate hardens contracts, identity, checkpoints, and evidence
before M7 may resume.

## Current Focus

Tranche A hardening: A1, A2, A3.1, A3.2, and A3.3 are merged; PR #70
established the strict runtime checkpoint schema 0.4. A6 typed EvidenceExport
provenance is open as PR #74 while the remaining Tranche A units continue under
the accepted dependency rules. M7 investigation work remains on hold until the
full pre-M7 gate closes with explicit activation.

## Structured Requirements

### REQ-WORLD-001

**Title:** World creation with explicit pending-vs-active settings

**Source:** project.md "What I Want to Build" + "Expected Solution / Behavior" (Create)

**Acceptance Criteria:**

- User can create a universe from a preset or full world/life/evolution/seed config
- Staged next-universe settings are visually distinct from the active universe config
- Random, manual, and config-reuse-with-new-seed flows all work

### REQ-WORLD-002

**Title:** World archetypes as richness ranges, never population targets

**Source:** project.md "What I Want to Build" (Balanced, Patchwork, Harsh, Abundant)

**Acceptance Criteria:**

- All four archetypes produce runnable universes
- Abundant supports thousands-scale populations without encoding a target abundance
- Population abundance remains emergent in every archetype

### REQ-SIM-001

**Title:** Deterministic simulation with versioned reproducibility contract

**Source:** project.md "Constraints" (determinism contract)

**Acceptance Criteria:**

- Same engine version + resolved config + seed + command sequence reproduces a run
- Checkpoint schema 0.4 is the strict current schema; only named historical
  omissions migrate, everything else fails explicitly before becoming live state
- Every universe records seed, full starting config, and engine version

### REQ-SIM-002

**Title:** Reference microbial world model

**Source:** project.md "What I Want to Build" (reference world paragraph)

**Acceptance Criteria:**

- Motile asexual microbes in 600×600 toroidal environment with 60×60 substance fields
- Abiotic nutrients plus biologically produced Metabolite C with evolvable cross-feeding
- Reversible dormancy plus all 8 evolvable traits functional

### REQ-SIM-003

**Title:** Authority boundaries (biology vs analysis vs presentation)

**Source:** project.md "Constraints" (authority boundaries)

**Acceptance Criteria:**

- sim-core owns biology; sim-analysis never mutates survival, reproduction, mutation, resources, or RNG
- Presentation may surface/rank events but never manufactures biological outcomes
- No hidden population targets or scripted milestones; display years never replace ticks

### REQ-UX-001

**Title:** World-first navigation (World, History, Tree, Experiments)

**Source:** project.md "Expected Solution / Behavior" (navigation paragraph)

**Acceptance Criteria:**

- Four surfaces exist with the stated responsibilities; phone uses bottom nav + bottom sheets
- Developer validation is hidden behind a dev-only entry point, never in Experiments
- World stays visible as the primary surface while moving through other surfaces

### REQ-UX-002

**Title:** Bounded time controls with post-choice auto-resume

**Source:** project.md "Expected Solution / Behavior" (Explore paragraph + owner run-control decisions)

**Acceptance Criteria:**

- Speed set is Pause/Play plus 1×/10×/100× only (no Max, no "next meaningful change")
- Resolving a choice auto-resumes the prior speed; an explicit pre-decision pause is preserved
- Pending decisions remain hard gates; resolution applies at zero extra ticks with recorded provenance

### REQ-EVENT-001

**Title:** Stateful events grouped into story arcs

**Source:** project.md "Expected Solution / Behavior" (Events paragraph)

**Acceptance Criteria:**

- Events follow forming → established → disrupted → recovered/resolved lifecycles
- Repeated states update an existing arc instead of spawning duplicate cards
- Every event links to involved creatures, clades, traits, resources, and interventions

### REQ-EVENT-002

**Title:** Decision-eligible events with mechanical-only previews

**Source:** project.md "Expected Solution / Behavior" (M3 event decisions)

**Acceptance Criteria:**

- Triggers originate from observed world state only, never from desired biological outcomes
- Consequence previews describe direct mechanical change, never promise evolution
- World-catalyst triggers (droughts, pulses, barriers) are allowed; biological-outcome triggers are not

### REQ-POP-001

**Title:** Emergent, legible population dynamics

**Source:** project.md "Expected Solution / Behavior" (M4 consequence paragraph on population)

**Acceptance Criteria:**

- Founder population starts meaningfully below resource-supported levels so expansion is visible
- Growth unfolds across observable generations (maturity/recovery mechanics, no startup burst)
- Arcs (growth, overshoot, crash, recovery) detected via persistence/hysteresis, explainable via births/deaths/resources

### REQ-CLADE-001

**Title:** Persistent clade layer with recognizable identity

**Source:** project.md "Expected Solution / Behavior" (clades paragraph)

**Acceptance Criteria:**

- User-facing clades persist across small mutations; raw lineages retained for analysis
- Creatures/clades have deterministic visual signatures and lifetime ledgers
- Clades are presented as analytical groupings, not taxonomic species claims

### REQ-EXP-001

**Title:** Transparent interventions with lazy matched forks

**Source:** project.md "Expected Solution / Behavior" (Intervene + Experiment)

**Acceptance Criteria:**

- Every intervention is explicit, recorded, and environment-only in effect
- Comparison twin is cloned lazily at intervention/comparison time with exact RNG state
- Matched histories are comparable side-by-side in Experiments

### REQ-EXPORT-001

**Title:** Structured evidence exports separate from checkpoints

**Source:** project.md "Expected Solution / Behavior" (Analyze) + Constraints

**Acceptance Criteria:**

- JSON/JSONL run exports plus compact summaries sufficient for external review
- Resumable checkpoints and evidence exports remain separate contracts

### REQ-GRAPH-001

**Title:** TypeScript + PixiJS v8 rendering with separated visual layers

**Source:** project.md "Constraints" (graphics); Owner adoption decision (PixiJS is production)

**Acceptance Criteria:**

- PixiJS v8/WebGL2 is the adopted production rendering backend (Owner decision)
- Phenotype / current-state / analysis layers stay separate through migration
- Rendering never consumes simulation RNG; phenotype stays presentation-only
- Microscopic-habitat metaphor (substrate-scale cues, no macro-landscape imagery)
- Status: validated spike/P0 preparation plus an inactive unbound production-shaped
  scaffold are merged; maintained World cutover has not occurred

### REQ-M4-001

**Title:** M4 immersive presentation with waste overlay

**Source:** project.md "Expected Solution / Behavior" (M4 direction)

**Acceptance Criteria:**

- Full-bleed world, compact translucent HUD, bottom-sheet inspection, in-world event emphasis
- Read-only Metabolic Waste overlay; no user-facing waste intervention in this slice

### REQ-SLICE-002

**Title:** Slice 2 waste/toxin niche-construction field

**Source:** project.md "Expected Solution / Behavior" (Slice 2 direction)

**Acceptance Criteria:**

- One biologically produced waste field altering habitat quality (deposit, diffuse, decay, cleanup)
- Independent tolerance and cleanup traits with separate energetic costs
- Niche-construction arc uses forming → established → disrupted → recovered/superseded vocabulary

## Planned Features

### Feature 1 — World lifecycle

- Requirements: REQ-WORLD-001, REQ-WORLD-002
- Status: Implemented
- Description: Creation flows, archetypes, pending-vs-active clarity
- Dependencies: REQ-SIM-001
- Implementation Notes: Under Tranche A hardening (typed read models, A1)

### Feature 2 — Deterministic engine core

- Requirements: REQ-SIM-001, REQ-SIM-002, REQ-SIM-003
- Status: Implemented
- Description: Reference world model with authority boundaries intact
- Dependencies:
- Implementation Notes: Under Tranche A hardening (checkpoint migration/validation, A3)

### Feature 3 — Explorer shell and time

- Requirements: REQ-UX-001, REQ-UX-002, REQ-M4-001, REQ-GRAPH-001
- Status: Implemented
- Description: World-first layout, bounded speeds, immersive presentation
- Dependencies: Feature 2
- Implementation Notes: PixiJS v8/WebGL2 approved for production World migration (Tranche D). PRs #71 and #73 provide preparation/scaffold evidence; maintained Canvas2D World cutover still waits on accepted pre-M7 A/B/C and read-model/runtime stabilization

### Feature 4 — Events, clades, and population story

- Requirements: REQ-EVENT-001, REQ-EVENT-002, REQ-POP-001, REQ-CLADE-001
- Status: Implemented
- Description: Stateful events, decision gates, emergent population arcs, clade identity
- Dependencies: Feature 2
- Implementation Notes: Typed identity + `L-`/`C-` namespace landed (A2, verified in-app)

### Feature 5 — Experiments and evidence

- Requirements: REQ-EXP-001, REQ-EXPORT-001
- Status: Implemented
- Description: Interventions, lazy forks, structured exports
- Dependencies: Features 2, 4
- Implementation Notes: Typed `EvidenceExport` with revision/cleanliness provenance is Tranche A unit A6; implementation is open as PR #74 and is not treated as merged evidence until accepted

### Feature 6 — Niche-construction slice

- Requirements: REQ-SLICE-002
- Status: Implemented
- Description: Waste field with tolerance/cleanup traits and analysis arc
- Dependencies: Feature 2
- Implementation Notes: No user-facing waste controls (read-only overlay only)

## Development Tasks

- [x] Read raw requirements in project.md
- [x] Structure them as requirements with IDs (above)
- [x] Define architecture (`docs/architecture/MIGRATION.md` + plan Architecture section)
- [x] Implement core features (Features 1–6; now under Tranche A hardening)
- [x] Implement tests (`tools/validation/*`, manifest-driven; `pnpm verify` is the blocking contract)
- [ ] Review implementation (pre-M7 reconciliation gate still open; M7 on hold)

## Architecture

Repo is a TypeScript modular monolith: `packages/contracts` (cross-boundary
types) → `packages/sim-core` (deterministic biological authority) →
`packages/sim-runtime` (worker/session orchestration, matched forks) →
`apps/explorer` (React/Vite UI, Capacitor Android packaging).
`packages/sim-analysis` reads immutable observations only.
`packages/sim-decisions` maps observed events to choices without mutating state.
See `docs/architecture/MIGRATION.md` for module boundaries and
`tools/validation/manifest.ts` for the validation contract (`pnpm verify`).

## Technical Decisions

- Offline-first throughout; no network dependency in sim, saves, or export
- Reproducibility key is engine version + resolved config + seed + command sequence
- Analysis/presentation read-only with respect to biology (hard constraint)
- Graphics direction TypeScript + PixiJS v8 / WebGL2; Canvas 2D is the baseline
- Phenotype presentation uses six body-plan attractors with lineage anchoring
- M4A (configurable worlds) and M4B (immersive presentation) ship coupled

## Future Work

- Predator/prey roles, sexual reproduction, neural/program brains, social behavior
- Terrain, climate, seasons, disease/pathogens; formal speciation detection
- Branching timelines and checkpoint experiments beyond matched comparison
- Production-quality Android UI and real-device validation
