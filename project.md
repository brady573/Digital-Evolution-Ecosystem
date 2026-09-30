# Project Requirements

> Paste your requirements here in your own words — a full description of what you
> want to build and, if you have it, the expected solution or behavior. Don't
> worry about structure, formatting, or IDs.
>
> Your AI agent will read this and turn it into structured requirements (with
> stable IDs like REQ-AUTH-001) in `projectPlan.md`. You own this file; the AI
> should not change your requirements here unless you ask.

## What I Want to Build

Digital Evolution Ecosystem — an offline-first ecosystem laboratory.
Product statement: Build a world. Seed life. Watch evolution happen.
Change the rules and see what emerges.

The Living Evolution Explorer lets a user create worlds, watch autonomous
evolution unfold, investigate ecological history and ancestry, intervene
transparently, and compare matched evolutionary branches — without writing code.
Core loop: configure → seed → run → notice → investigate → intervene →
compare → export.

Source of truth is the Living Design Document:
https://docs.google.com/document/d/16zic3rFlPyFQeLRy9RLUvdwCS4imJTmWM7kh0aBFN6o/edit
(Sections below track that doc; it remains the authoritative design text.
Older scope statements in it are historical snapshots, not hard limits.)

Current maintained state: app 0.31.0 / engine 0.22.0 (authoritative values
in `packages/sim-core/src/version.ts`; do not restate versions here without
checking that file), checkpoint schema 0.4 is the strict current schema
(`CHECKPOINT_SCHEMA_VERSION` in `packages/sim-runtime/src/session.ts`),
TypeScript modular monolith (contracts, sim-core,
sim-analysis, sim-runtime, React/Vite explorer, Capacitor Android packaging).
Reference world: motile asexual microbes in a 600×600 toroidal environment
with 60×60 substance fields; abiotic nutrients plus biologically produced
Metabolite C with evolvable cross-feeding; reversible dormancy; 8 evolvable
traits (movement speed, sensing, metabolism, reproduction threshold, nutrient
tendency, habitat preference, byproduct use, dormancy response). World
archetypes: Balanced, Patchwork, Harsh, Abundant (richness range only, never
a population target).

## Expected Solution / Behavior

Create: presets or full world/life/evolution/seed configuration through UI,
including random/manual/seed-reuse flows. World settings can stage a pending
next-universe recipe that stays explicitly distinct from the active universe.
Explore: live ecosystem canvas, pause/play plus 1×/10×/100× (no Max speed,
no "next meaningful change" control), inspect organisms/populations, follow
important events. Intervene: explicit recorded catalysts (food crash, nutrient
droughts, c_washout test/dev catalyst) that change only the environment;
biology stays emergent. Review: history, trends, mutations, extinctions.
Experiment: new seeds, cloned configs, checkpoint branching, matched-control
forks created lazily at intervention/comparison time. Analyze: structured
JSON/JSONL exports plus compact summaries sufficient for external review.

Navigation is World (live world, time controls, lenses, selection,
interventions), History (story arcs with before/after evidence), Tree
(ancestry/clade browser), Experiments (user interventions and comparisons;
developer validation stays behind a dev-only entry point). Phone uses a
full-bleed world-first layout with bottom navigation and bottom-sheet
inspection.

Events use stateful lifecycles (forming → established → disrupted →
recovered/resolved), grouped into story arcs, with compact world cards and one
clear Investigate action. Population dynamics (growth, overshoot, crash,
recovery) must emerge from births/deaths/resources/competition, never from a
forced curve. Clades are persistent user-facing groupings over raw mutation
lineages, with recognizable visual identity. Decision-eligible events pause as
a hard gate; resolving a choice applies only the direct mechanical effect at
zero extra ticks and auto-resumes prior playback speed (explicit user pause is
preserved). Consequence previews may describe direct mechanical change only,
never promise an evolutionary outcome.

M4 direction (accepted): immersive sim-game presentation — full-bleed living
world, dark primordial microscopic-habitat aesthetic (films, gradients,
substrate texture; no mountains/forests/rivers macro cues), compact
translucent HUD, bottom-sheet inspection, recognizable pixel-phenotype
organisms (6 body-plan attractor families with lineage-anchored continuity),
semantic environmental compositing with a read-only Metabolic Waste overlay.
Slice 2 direction (accepted): one biologically produced waste/toxin field that
modifies habitat quality, with independent tolerance and cleanup traits.

## Constraints

- Offline-first: simulation, saves, history, experiments, inspection, and
  evidence export must work with no network.
- Determinism contract: same engine version + resolved config + seed +
  command sequence reproduces the run. Engine 0.20.0 saves do not restore as
  0.21.0.
- Authority boundaries: sim-core owns biology; sim-analysis is read-only
  interpretation (clades, records, salience, language) and must never mutate
  survival/reproduction/mutation/resources/RNG; presentation may surface but
  never manufacture outcomes; no hidden population targets or scripted
  milestones; display years are presentation-only, ticks are authoritative.
- Do not edit `legacy/prototype/` (frozen regression evidence). Keep
  simulation, UI, and analysis changes in separate reviewable diffs.
- Graphics: TypeScript + PixiJS v8 with WebGL2 backend direction; phenotype /
  current-state / analysis visual layers stay separate; rendering never
  consumes simulation RNG; phenotype is presentation-only.
- Validation: `pnpm verify` is the blocking repo contract; browser/evidence
  classes run in CI; prefer CI over the phone for slow runs; never weaken
  tests or gates to make a change pass.
- No commits, pushes, PRs, or new network/analytics services without explicit
  approval.

## Notes

- Living document: add detail only when a decision becomes useful to
  implementation or UX; update priorities when evidence or owner observation
  changes them.
- Key references: Avida (Ofria & Wilke), Dolson & Ofria review, Lenski
  long-term evolution and historical contingency, Yedid et al. disturbance
  recovery, L'Ecuyer RNG streams, Hill numbers for diversity, PhET/Avida-ED
  for explorable simulation UX, Species/Sapling/Wobbledogs/WorldBox/RimWorld
  (presentation only)/Dwarf Fortress Legends/Rain World/Thrive for adjacent
  UX patterns. Details in doc sections 14, 18, 19.
- Product identity: simulation game first in experience, scientific
  foundation in mechanism. Curiosity over win conditions; milestones over
  noise; game systems must earn complexity via a real player decision, a new
  evolutionary possibility, a noticeable event, a stronger investigation
  question, or a memorable comparison.
