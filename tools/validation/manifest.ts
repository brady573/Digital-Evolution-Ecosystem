/**
 * Canonical validation manifest.
 *
 * This file is the single machine-readable definition of what the repository
 * validates, which evidence class each check belongs to, and whether it blocks.
 * `package.json` scripts, the CI workflow shards, and the local `verify` command
 * all derive from here. Nothing downstream may maintain a second list.
 *
 * The rule this exists to enforce:
 *
 *   No validation should execute twice unless the second execution establishes
 *   a materially different claim.
 *
 * ## Evidence classes
 *
 * Each class answers a different question, so each needs a different environment
 * and a different standard of proof. A check may not be moved to a cheaper
 * class without the claim changing, and a claim may not be proven by a class
 * that cannot see it.
 *
 * | Class | Question it answers | Environment | Lane-blocking? | Merge gate? |
 * |---|---|---|---|---|
 * | `invariant`     | Is the repository structurally sound? | Node | yes | yes |
 * | `deterministic` | Is exact supported behaviour still exact? | Node | yes | yes |
 * | `presentation`  | Does the product build and do its presentation contracts hold? | Node | yes | yes |
 * | `browser`       | Does it behave correctly in an actual browser? | Chromium | yes | yes for blocking units; captures no |
 * | `platform`      | Does the Android packaging integrate? | Android SDK / emulator | yes | no |
 * | `scientific`    | What actually happens across seeds and horizons? | Node, long | manual | no |
 * | `evidence`      | Can a human inspect the result? | Chromium | no | no |
 *
 * Lane-blocking (the `enforcement` field) says whether failure fails the
 * lane; merge gate (the `mergeGate` field) says whether success is required
 * for merge readiness. Platform packaging is blocking but not merge-gating.
 *
 * The classes are not interchangeable. `deterministic` may not be used to claim
 * browser correctness, `scientific` may not be used to claim exactness, and
 * `platform` may not be used to claim that the simulation is correct.
 *
 * ## `domains`
 *
 * `domains` lists the repository areas whose change *forces* this unit to run.
 * `tools/validation/impact.ts` inverts that mapping to decide which units a diff
 * needs. The bias is deliberately one-directional: a unit may be reachable by
 * more paths than strictly necessary (wasted runner time), never fewer. An
 * unrecognised path resolves to "run everything".
 *
 * Two areas are universal by construction. `validation` (this directory and
 * `tools/`) and `ci` (`.github/`) appear in every unit's domain list, because a
 * change to the measuring apparatus must never be able to declare itself
 * unnecessary.
 *
 * `docs` appears only on the cheap invariant units, so a documentation-only pull
 * request cannot trigger a ten-minute simulation.
 *
 * ## `baselineSeconds`
 *
 * Measured on CI runner `ubuntu-latest`, not estimated, and used to balance
 * shards. Sources are runs 36580426436, 36516033777, and 36508723384
 * (medians; refreshed 2026-09-29 after flows/possibility/decisions drifted).
 * Slice 1 (engine 0.24.0) values are a SINGLE sample from run 37056021706
 * (2026-10-02, commit 890175b): decisions 58, catalysts 77, flows 200,
 * time-controls 16, niche 90, spatial-occupancy 257 (was a 300 provisional),
 * aftermath 34, dependency-arc 92, dependency-possibility 251,
 * dependency-tradeoff 405. Untouched units keep their old medians.
 * Possibility's jump (94 -> 251) is the 60k -> 150k horizon; tradeoff's
 * (275 -> 405) tracks higher sustained populations per tick. sim-b now
 * budgets ~451s; rebalancing shards is left to a follow-up.
 *
 * Two caveats worth knowing. A unit's cost varies run to run on a shared
 * runner -- `flows` measured 164s then 149s twice (median 149, was 81),
 * `dependency-possibility` 99s/93s/93s (median 94, was 58), `decisions`
 * 75s/79s/77s (median 77, was 50) -- so a single measurement is a sample,
 * not a constant. Cheap units were overestimated the other way (`typecheck`
 * 1.3s vs 10, `build` 0.6s vs 12, `phenotype` 0.7s vs 10) and are now medians
 * too. And the shared GitHub runner
 * is not the device: `dependency-tradeoff` measured 275s on CI against a
 * device-derived guess of 180s, while its sibling `dependency-possibility` went
 * the other way, 107s guessed, 58s measured. The two are therefore kept in
 * different shards, so a wrong split between them cannot compound into one
 * oversized job.
 *
 * The `validation-summary` artifact is the authority, not this field: when they
 * disagree, the artifact is a measurement and this is a copy of one.
 */

// --- Evidence classes --------------------------------------------------------

export type EvidenceClass =
  | "invariant"
  | "deterministic"
  | "presentation"
  | "browser"
  | "platform"
  | "scientific"
  | "evidence";

/** Blocking gates, non-blocking evidence, and manual/scheduled science. */
export type Enforcement = "blocking" | "evidence" | "manual";

/** Repository areas that force validation units to run when they change. */
export type Domain =
  | "contracts"
  | "sim-core"
  | "sim-analysis"
  | "sim-decisions"
  | "sim-runtime"
  | "phenotype"
  | "explorer"
  | "android"
  | "validation"
  | "ci"
  | "docs";

/** Every domain. Use for units that must always run. */
const ALL: Domain[] = [
  "contracts",
  "sim-core",
  "sim-analysis",
  "sim-decisions",
  "sim-runtime",
  "phenotype",
  "explorer",
  "android",
  "validation",
  "ci",
  "docs",
];

/** Every domain that can affect compiled or validated code. */
const CODE: Domain[] = ALL.filter((d) => d !== "docs");

/** The universal "apparatus changed" pair, plus a set of code domains. */
const withApparatus = (...domains: Domain[]): Domain[] => [
  ...new Set([...domains, "validation", "ci"]),
];

// --- Units -------------------------------------------------------------------

export interface ValidationUnit {
  /** Stable identifier. Referenced by CI step markers and by telemetry. */
  readonly id: string;
  /** Human label for CI output and plan listings. */
  readonly title: string;
  /**
   * `package.json` script that runs this unit, or `null` for platform units
   * that cannot execute outside a configured Android environment. Those are
   * invoked by their `id` as a CI step marker instead.
   */
  readonly script: string | null;
  readonly cls: EvidenceClass;
  readonly enforcement: Enforcement;
  /**
   * Whether successful completion is required for merge readiness.
   *
   * Distinct from `enforcement`: `enforcement` says whether failure fails
   * this unit/lane, `mergeGate` says whether success is required to merge.
   * Platform packaging is `blocking` (its lane fails on failure) but not
   * merge-gating; evidence captures are neither.
   */
  readonly mergeGate: boolean;
  /** Repository areas whose change forces this unit. See module notes. */
  readonly domains: Domain[];
  /** Unit ids that must pass before this one is meaningful. */
  readonly needs: readonly string[];
  /**
   * Safe to run concurrently with other units in the same process pool. Units
   * that write to shared paths, or that bind a fixed port, are not.
   */
  readonly parallelSafe: boolean;
  /** Directory of retained output, uploaded as a CI artifact. */
  readonly artifact?: string;
  /** Measured wall time on `ubuntu-latest`; see module notes. */
  readonly baselineSeconds?: number;
  /**
   * Paused units keep their definition and claim so re-entry is mechanical,
   * but are invisible to every runner set: `planImpact` and `planBroad` never
   * require them, `requiredCiUnits` never covers them, and no group lists them.
   * A pause is unconditional -- it is not routing, and no diff can revive the
   * unit. Re-entry is the exact reversal: drop this flag and re-add the id to
   * its group.
   */
  readonly paused?: boolean;
  /** One line: the claim this unit is the cheapest layer able to prove. */
  readonly claim: string;
}

export const UNITS: readonly ValidationUnit[] = [
  // --- Class A: fast invariant gate ----------------------------------------
  {
    id: "typecheck",
    title: "Typecheck (all packages)",
    script: "typecheck",
    cls: "invariant",
    enforcement: "blocking",
    mergeGate: true,
    domains: CODE,
    needs: [],
    parallelSafe: true,
    baselineSeconds: 1,
    claim: "Every package still typechecks against the shared contracts.",
  },
  {
    id: "migration",
    title: "Migration / prototype parity",
    script: "test:migration",
    cls: "invariant",
    enforcement: "blocking",
    mergeGate: true,
    domains: CODE,
    needs: [],
    parallelSafe: true,
    baselineSeconds: 15,
    claim:
      "sim-core still reproduces the frozen legacy/prototype baselines, so biology has not silently moved.",
  },

  {
    id: "validation-arch",
    title: "Validation architecture self-test",
    script: "test:validation-arch",
    cls: "invariant",
    enforcement: "blocking",
    mergeGate: true,
    // The apparatus, the shared vocabulary whose contract it proves, and the
    // documentation that describes it. It is cheap, and a change to any of those
    // is exactly when the claim "this repository's validation contract holds"
    // needs re-checking. Anything broader would be circular: the rest of the
    // repository is what this unit exists to check.
    domains: withApparatus("contracts", "sim-analysis", "sim-runtime", "explorer", "docs"),
    needs: [],
    parallelSafe: true,
    baselineSeconds: 2,
    claim:
      "The canonical definition is self-consistent, the impact classifier is conservative, the sharded dependency suites still cover the whole suite, the History and Tree read models stay typed and cast-free at every consumer, and the L-/C- identity namespaces stay distinct in contracts, analysis prose and rendered output.",
  },

  // --- Class B: deterministic product behaviour ----------------------------
  {
    id: "decisions",
    title: "Decision opportunity policy",
    script: "test:decisions",
    cls: "deterministic",
    enforcement: "blocking",
    mergeGate: true,
    domains: withApparatus("contracts", "sim-core", "sim-decisions", "sim-runtime", "explorer"),
    needs: [],
    parallelSafe: true,
    baselineSeconds: 58,
    claim:
      "Events still map to exactly the same offered choices as before, and an entity reference whose kind was never recorded yields no L- or C- claim rather than a guessed one.",
  },
  {
    id: "catalysts",
    title: "Catalyst catalog and effects",
    script: "test:catalysts",
    cls: "deterministic",
    enforcement: "blocking",
    mergeGate: true,
    domains: withApparatus("contracts", "sim-core", "sim-decisions", "sim-runtime", "explorer"),
    needs: [],
    parallelSafe: true,
    baselineSeconds: 77,
    claim: "The offered interventions produce their exact documented effects.",
  },
  {
    id: "flows",
    title: "Runtime session flows",
    script: "test:flows",
    cls: "deterministic",
    enforcement: "blocking",
    mergeGate: true,
    domains: withApparatus("contracts", "sim-core", "sim-analysis", "sim-decisions", "sim-runtime", "explorer"),
    needs: [],
    parallelSafe: true,
    baselineSeconds: 200,
    claim:
      "Session lifecycle, forking, and pause gating behave exactly as specified; every named checkpoint migration rule is well-formed, hazard-classified and still matches the code that absorbs it; a save written before entity references carried their kind restores with the same reference count and no guessed namespace, and the current schema refuses that same bare-reference shape; a checkpoint from the maintained save path is accepted; each of the six rejection conditions refuses with the field named; a suppressed major-catalyst cooldown stays suppressed across restore from both the current schema and a real 0.3 save, while a 0.2 save predating the field migrates to the historically correct value; a source-schema preflight on the raw payload accepts each evidenced historical omission for its own schema and refuses every field its writer was required to emit, so a 0.3 save preserves its persisted lastDecisionTick and cannot omit it and a 0.2 save reconstructs the historically absent tick; present wrong-typed, malformed, non-finite, or self-contradicting values are refused at every supported schema across the encoded simulation with its resource, waste, organism, interval and identity state, the observer's detectors, history records and eras, entity references, and decision records, so named historical absence cannot excuse an invalid checked value; a preflight refusal leaves an existing running session unchanged; a preflighted source is then canonicalised into ONE restore representation and that representation is held to the current non-simulation contract before any state becomes live, with the candidate/validated distinction enforced by the compiler rather than by a runtime call; and the Owner-facing supported-save boundary document is generated rather than transcribed, carrying the live current schema version, no supported-version literal in code that could go stale behind it, the two independent schema and engine-version gates named separately, and the canonical ordering the implementation actually performs. export carries a versioned provenance block; dirty build → dirty; undeterminable revision → unknown, never clean.",
  },
  {
    id: "persistence-integrity",
    title: "Save envelope and storage failure integrity",
    script: "test:persistence-integrity",
    cls: "deterministic",
    enforcement: "blocking",
    mergeGate: true,
    domains: withApparatus("contracts", "sim-runtime", "explorer"),
    needs: [],
    parallelSafe: true,
    // Measured on the dev worktree, not estimated. The suite's own work is
    // ~40ms; the rest is tsx startup plus resolving the Explorer's persistence
    // and phenotype modules. ci-sim-c was 184s, so this is far from the
    // critical path.
    baselineSeconds: 11,
    claim:
      "A slot read returns the checkpoint and its presentation adjuncts from one record read in one transaction, so they cannot describe different record generations; a legacy unversioned record still loads and is never rewritten by loading; an absent slot is distinct from an unreadable one, and a truncated, malformed, or newer-than-this-build record is a typed failure rather than a silent 'no save' or a raw storage exception; a save reports success only after its transaction commits; and a failed overwrite leaves the previously committed save and its adjuncts intact and readable.",
  },
  {
    id: "runtime-boundary",
    title: "Runtime command and transport boundary",
    script: "test:runtime-boundary",
    cls: "deterministic",
    enforcement: "blocking",
    mergeGate: true,
    domains: withApparatus("contracts", "sim-runtime"),
    needs: [],
    parallelSafe: true,
    // Measured on the dev worktree, not estimated. The suite's own work is
    // ~350ms; the rest is tsx startup plus module resolution for the engine,
    // which no test-side change removes. ci-sim-c was 184s, so this is ~0.2%
    // of the shard and nowhere near the 278s ci-sim-a critical path.
    baselineSeconds: 11,
    claim:
      "Malformed, unknown, non-finite, negative, fractional-when-integer, and out-of-range runtime commands are rejected as structured failures before any simulation loop begins; an unsupported command tag can never escape handle as undefined, which is what previously killed the worker with every pending request left unresolved; a rejected command mutates no tick, no biology, and no decision or analysis state, while still releasing the snapshot backpressure depends on; every worker request settles exactly once through a supported terminal outcome; a terminal worker failure or destroy clears every pending request and the pending checkpoint load; and a checkpoint load completes only through its own request identity, so a same-tick, stale, or unrelated live snapshot cannot satisfy it.",
  },
  {
    id: "time-controls",
    title: "Speed and time control",
    script: "test:time-controls",
    cls: "deterministic",
    enforcement: "blocking",
    mergeGate: true,
    domains: withApparatus("contracts", "sim-core", "sim-runtime", "explorer"),
    needs: [],
    parallelSafe: true,
    baselineSeconds: 16,
    claim: "Playback speed changes advance exactly the tick counts they claim.",
  },
  {
    id: "landscape",
    title: "Landscape rendering rules",
    script: "test:landscape",
    cls: "deterministic",
    enforcement: "blocking",
    mergeGate: true,
    domains: withApparatus("contracts", "sim-core", "explorer"),
    needs: [],
    parallelSafe: true,
    baselineSeconds: 2,
    claim: "Each cell's colour is a pure, traceable function of its state.",
  },
  {
    id: "ecology",
    title: "Ecological invariants",
    script: "test:ecology",
    cls: "deterministic",
    enforcement: "blocking",
    mergeGate: true,
    domains: withApparatus("contracts", "sim-core"),
    needs: [],
    parallelSafe: true,
    baselineSeconds: 91,
    claim: "Conservation and accountancy hold; population stays emergent.",
  },
  {
    id: "niche",
    title: "Niche behaviour gates",
    script: "test:niche",
    cls: "deterministic",
    enforcement: "blocking",
    mergeGate: true,
    domains: withApparatus("contracts", "sim-core", "sim-analysis", "sim-runtime"),
    needs: [],
    parallelSafe: true,
    baselineSeconds: 90,
    claim:
      "Niche differentiation is possible and typical where claimed, its limits still hold, and the lineages it names are asserted as lineages rather than as untyped numbers.",
  },
  {
    id: "spatial-occupancy",
    title: "Spatial opportunity and occupancy (Slice 1)",
    script: "test:spatial-occupancy",
    cls: "deterministic",
    enforcement: "blocking",
    mergeGate: true,
    domains: withApparatus("contracts", "sim-core", "sim-runtime"),
    needs: [],
    parallelSafe: true,
    baselineSeconds: 257,
    claim:
      "Local space is finite identity-free opportunity: settlement and birth placement resolve deterministically by seniority with deflection and atomic discard, vacancy recolonizes, lineage never steers, and throughput stays viable at thousands scale.",
  },
  {
    id: "bulk",
    title: "Bulk / body-mass allocation (reserve vs cost)",
    script: "test:bulk",
    cls: "deterministic",
    enforcement: "blocking",
    mergeGate: true,
    domains: withApparatus("contracts", "sim-core", "sim-runtime"),
    needs: [],
    parallelSafe: true,
    baselineSeconds: 30,
    claim:
      "Bulk is inherited, mutates additively, persists, and exports truthfully; larger bodies hold a greater bounded energy reserve while paying exact movement and reproductive-threshold costs with unchanged metabolism; small and large morphs each win in opposite regimes with no universal optimum; twin replay and checkpoint continuation are exact.",
  },
  {
    id: "aftermath",
    title: "Aftermath state and comparison",
    script: "test:aftermath",
    cls: "deterministic",
    enforcement: "blocking",
    mergeGate: true,
    domains: withApparatus("contracts", "sim-core", "sim-decisions", "sim-runtime", "explorer"),
    needs: [],
    parallelSafe: false,
    claim:
      "An impact pause retains both sides of the effect at one tick and auto-resume never loses them.",
    baselineSeconds: 34,
  },
  // --- Dependency shards ----------------------------------------------------
  // `pnpm test:dependency` was 647s on CI and, as a single shard, the entire
  // product critical path. The 647s was almost entirely the live-integration
  // phase: the policy arcs run in ~1s. So the suite is partitioned here, with
  // the policy phase as its own unit and the five live tests split three ways.
  //
  // These four units have no `baselineSeconds` yet, and the plan output says so
  // rather than implying they are free. Their real cost arrives with the first
  // CI run's `validation-summary` artifact, which is the point of recording
  // telemetry: the split should be re-balanced from measured shards rather than
  // from a guess made on a laptop.
  //
  // Provisional device figures (proot/aarch64, slower than CI, for reference
  // only -- not baselines): arc 44s, checkpoint 49s, possibility 107s.
  {
    id: "dependency-policy",
    title: "Dependency policy (fast invariants)",
    script: "test:dependency:fast",
    cls: "deterministic",
    enforcement: "blocking",
    mergeGate: true,
    domains: withApparatus("contracts", "sim-core", "sim-decisions", "sim-runtime"),
    needs: [],
    parallelSafe: true,
    baselineSeconds: 1,
    claim:
      "Formation, disruption, and recovery obey the dependency rules in isolation from long horizons.",
  },
  {
    id: "dependency-arc",
    title: "Dependency arc and checkpoint resume",
    script: "test:dependency:arc",
    cls: "deterministic",
    enforcement: "blocking",
    mergeGate: true,
    domains: withApparatus("contracts", "sim-core", "sim-decisions", "sim-runtime"),
    needs: [],
    parallelSafe: true,
    claim:
      "One deterministic run establishes and then loses a dependency, resume from a checkpoint reproduces it, and each named entity reference asserts the kind it denotes rather than a bare id.",
    baselineSeconds: 92,
  },
  {
    id: "dependency-possibility",
    title: "Cross-feeding possibility across seeds",
    script: "test:dependency:possibility",
    cls: "deterministic",
    enforcement: "blocking",
    mergeGate: true,
    domains: withApparatus("contracts", "sim-core", "sim-decisions", "sim-runtime"),
    needs: [],
    parallelSafe: true,
    baselineSeconds: 251,
    claim: "Cross-feeding is genuinely possible across seeds, not just in one lucky world.",
  },
  {
    id: "dependency-tradeoff",
    title: "Cross-feeding tradeoff",
    script: "test:dependency:tradeoff",
    cls: "deterministic",
    enforcement: "blocking",
    mergeGate: true,
    domains: withApparatus("contracts", "sim-core", "sim-decisions", "sim-runtime"),
    needs: [],
    parallelSafe: true,
    baselineSeconds: 405,
    claim: "Cross-feeding carries a real energetic cost rather than being free.",
  },
  {
    id: "dependency-washout",
    title: "Washout reliance and recovery",
    script: "test:dependency:washout",
    cls: "deterministic",
    enforcement: "blocking",
    mergeGate: true,
    domains: withApparatus("contracts", "sim-core", "sim-decisions", "sim-runtime"),
    needs: [],
    parallelSafe: true,
    claim: "A flushed nutrient column causes real reliance, and recovery is measurable.",
    baselineSeconds: 42,
  },

  // --- Class C: presentation and executable product ------------------------
  {
    id: "build",
    title: "Production Explorer build",
    script: "build",
    cls: "presentation",
    enforcement: "blocking",
    mergeGate: true,
    domains: CODE,
    needs: [],
    parallelSafe: false,
    artifact: "explorer-dist",
    baselineSeconds: 1,
    claim: "The product compiles, the resulting bundle is the one every browser lane tests, and the bundle carries the injected source revision facts (commit literal present, no raw injected identifiers).",
  },
  {
    id: "phenotype",
    title: "Phenotype rendering logic",
    script: "test:phenotype",
    cls: "presentation",
    enforcement: "blocking",
    mergeGate: true,
    domains: withApparatus("contracts", "phenotype", "explorer"),
    needs: [],
    parallelSafe: true,
    baselineSeconds: 1,
    claim: "A genotype maps to the same phenotype, in Node and in the world model alike.",
  },
  {
    id: "art-review",
    title: "Art review invariants",
    script: "test:art-review",
    cls: "presentation",
    enforcement: "blocking",
    mergeGate: true,
    domains: withApparatus("contracts", "phenotype", "explorer"),
    needs: [],
    parallelSafe: true,
    claim: "The portrait family still distinguishes the lineages it is meant to distinguish.",
  },
  {
    id: "plated",
    title: "Plated proof geometry and manifest",
    script: "test:plated",
    cls: "presentation",
    enforcement: "blocking",
    mergeGate: true,
    domains: withApparatus("contracts", "phenotype", "explorer"),
    needs: [],
    parallelSafe: true,
    baselineSeconds: 3,
    claim: "The plated organism geometry is internally consistent with its manifest.",
  },
  {
    id: "phenotype-art",
    title: "Procedural phenotype art contracts",
    script: "test:phenotype-art",
    cls: "presentation",
    enforcement: "blocking",
    mergeGate: true,
    domains: withApparatus("contracts", "phenotype"),
    needs: [],
    parallelSafe: true,
    baselineSeconds: 3,
    claim:
      "Procedural Plated art materialization is deterministic, preserves accepted geometry and every structural mask, and colors only pixels owned by accepted structural regions using the finite palette roles.",
  },
  {
    id: "pixi-spike",
    title: "Pixi spike validation",
    script: "test:pixi-spike",
    cls: "presentation",
    enforcement: "blocking",
    mergeGate: true,
    domains: withApparatus("contracts", "explorer"),
    needs: [],
    parallelSafe: true,
    baselineSeconds: 2,
    claim: "The Pixi spike still satisfies the manifest that would justify adopting it.",
  },
  {
    id: "pixi-p0",
    title: "Pixi P0 preparation harness",
    script: "test:pixi-p0",
    cls: "presentation",
    enforcement: "blocking",
    mergeGate: true,
    domains: withApparatus("contracts", "phenotype", "explorer"),
    needs: [],
    parallelSafe: true,
    baselineSeconds: 2,
    claim:
      "Pixi texture/cache/layer preparation is deterministic, movement-isolated, ref-count sound, aligned with the accepted camera contract, and covered by the asset manifest; production integration is validated by browser and mobile units.",
  },

  // --- Class D: browser / runtime ------------------------------------------
  {
    id: "browser-smoke",
    title: "Browser smoke",
    script: "test:browser",
    cls: "browser",
    enforcement: "blocking",
    mergeGate: true,
    domains: withApparatus("contracts", "sim-core", "sim-decisions", "sim-runtime", "phenotype", "explorer", "android"),
    needs: ["build"],
    parallelSafe: false,
    baselineSeconds: 41,
    claim:
      "The built product actually works in a browser: the Web Worker, canvas, control surface, and authorized Plated production raster path function.",
  },
  {
    id: "mobile-ui",
    title: "Mobile UI validation",
    script: "test:mobile-ui",
    cls: "browser",
    enforcement: "blocking",
    mergeGate: true,
    domains: withApparatus("contracts", "sim-core", "sim-decisions", "sim-runtime", "phenotype", "explorer", "android"),
    needs: ["build"],
    parallelSafe: false,
    baselineSeconds: 140,
    claim: "The phone, tablet, and desktop layouts are each usable at their real viewport.",
  },

  // --- Class E: platform ----------------------------------------------------
  {
    id: "android-sync",
    title: "Capacitor sync integrity",
    script: null,
    cls: "platform",
    enforcement: "blocking",
    mergeGate: false,
    // sim-core is here because a biology change alters the bundle this platform
    // packages. Android proves packaging and launch, but it is still packaging
    // *something*, and that something must be the validated product.
    domains: withApparatus("contracts", "sim-core", "phenotype", "explorer", "android"),
    needs: ["build"],
    parallelSafe: false,
    claim: "The checked-in android/ project matches the web assets it is supposed to wrap.",
  },
  {
    id: "android-assemble",
    title: "Assemble debug APK",
    script: null,
    cls: "platform",
    enforcement: "blocking",
    mergeGate: false,
    // sim-core is here because a biology change alters the bundle this platform
    // packages. Android proves packaging and launch, but it is still packaging
    // *something*, and that something must be the validated product.
    domains: withApparatus("contracts", "sim-core", "phenotype", "explorer", "android"),
    needs: ["android-sync"],
    parallelSafe: false,
    artifact: "digital-evolution-debug-apk",
    baselineSeconds: 43,
    claim: "A debug APK is produced. Assembly only; it says nothing about behaviour.",
  },
  {
    id: "android-lint",
    title: "Android lint (debug)",
    script: null,
    cls: "platform",
    enforcement: "blocking",
    mergeGate: false,
    // sim-core is here because a biology change alters the bundle this platform
    // packages. Android proves packaging and launch, but it is still packaging
    // *something*, and that something must be the validated product.
    domains: withApparatus("contracts", "sim-core", "phenotype", "explorer", "android"),
    needs: ["android-sync"],
    parallelSafe: false,
    baselineSeconds: 44,
    claim: "The native project passes Android's own static analysis.",
  },
  {
    id: "android-install-launch",
    title: "Emulator install and launch",
    script: null,
    cls: "platform",
    enforcement: "blocking",
    mergeGate: false,
    // PAUSED. The emulator lane cannot currently boot reliably: four samples
    // ran 487s, 789s, 828s (action gave up), and ~1150s of a 1200s budget with
    // the device unusable afterwards, and two of four runs failed. A lane that
    // reds on infrastructure this often teaches the repository to ignore reds.
    // The definition and claim stay intact so re-entry is the exact reversal
    // (drop `paused: true`, re-add the id to `android-runtime`). Re-entry
    // criteria live in `.github/workflows/android.yml`, next to the removed job.
    paused: true,
    // sim-core is here because a biology change alters the bundle this platform
    // packages. Android proves packaging and launch, but it is still packaging
    // *something*, and that something must be the validated product.
    domains: withApparatus("contracts", "sim-core", "phenotype", "explorer", "android"),
    needs: ["android-assemble"],
    parallelSafe: false,
    baselineSeconds: 536,
    claim:
      "The APK installs, MainActivity starts, the process stays alive, and no fatal exception occurs. Nothing beyond launch is claimed.",
  },

  // --- Class F: scientific / emergent --------------------------------------
  {
    id: "ecology-survey",
    title: "Multi-seed ecology survey",
    script: "test:survey",
    cls: "scientific",
    enforcement: "manual",
    mergeGate: false,
    domains: withApparatus("contracts", "sim-core"),
    needs: [],
    parallelSafe: true,
    artifact: "testdata",
    claim:
      "Population trajectories characterised across many seeds and horizons. Characterisation, not proof of exactness.",
  },
  {
    id: "niche-survey",
    title: "Niche survey",
    script: "test:niche-survey",
    cls: "scientific",
    enforcement: "manual",
    mergeGate: false,
    domains: withApparatus("contracts", "sim-core", "sim-analysis"),
    needs: [],
    parallelSafe: true,
    artifact: "testdata",
    claim: "High-richness characterisation, including cases where richness does not emerge.",
  },
  {
    id: "washout-reliance",
    title: "Washout reliance survey",
    script: "test:washout-reliance",
    cls: "scientific",
    enforcement: "manual",
    mergeGate: false,
    domains: withApparatus("contracts", "sim-core", "sim-decisions"),
    needs: [],
    parallelSafe: true,
    artifact: "testdata",
    claim: "Reliance on a flushed nutrient column measured across seeds and regimes.",
  },
  {
    id: "broad-ecology-022",
    title: "Broad engine-0.22 ecology characterization",
    script: "test:broad-ecology-022",
    cls: "scientific",
    enforcement: "manual",
    mergeGate: false,
    domains: withApparatus("contracts", "sim-core", "sim-analysis"),
    needs: [],
    parallelSafe: true,
    artifact: "testdata",
    claim:
      "Broad 0.22 characterization across four archetypes and recorded seeds, including trajectories, resources/waste, dormancy, cross-feeding, niche construction, clades, and matched disturbance. Characterisation, not proof of exactness.",
  },
  {
    id: "provenance",
    title: "Constant provenance measurements",
    script: "test:provenance",
    cls: "scientific",
    enforcement: "manual",
    mergeGate: false,
    domains: withApparatus("contracts", "sim-core"),
    needs: [],
    parallelSafe: true,
    artifact: "testdata",
    claim:
      "Retained current-engine distributions behind two cited constants: the nutrient stock-fraction band and the byproduct_use maximum. Measurement only; asserts nothing about whether either constant is correct.",
  },

  // --- Class G: human-review evidence generation ---------------------------
  {
    id: "visual-capture",
    title: "Landscape visual captures",
    script: "test:visual",
    cls: "evidence",
    enforcement: "evidence",
    mergeGate: false,
    domains: withApparatus("contracts", "sim-core", "phenotype", "explorer", "android"),
    needs: ["build"],
    parallelSafe: false,
    artifact: "landscape-visual-evidence",
    baselineSeconds: 55,
    claim:
      "Inspectable landscape images for human review. Non-gating: the capture run is timing dependent, so a slow run must not block verified code. It still uploads on failure, so a failure stays visible.",
  },
  {
    id: "pixi-capture",
    title: "Pixi spike browser captures",
    script: "spike:capture",
    cls: "evidence",
    enforcement: "evidence",
    mergeGate: false,
    domains: withApparatus("contracts", "explorer"),
    needs: [],
    parallelSafe: false,
    artifact: "pixi-spike-evidence",
    baselineSeconds: 41,
    claim:
      "GPU-dependent inspection images for the Pixi spike. Non-gating, because software-GL timing is not a property of the product.",
  },
  {
    id: "pixi-world-proof",
    title: "Production Pixi renderer lifecycle proof",
    script: "test:pixi-world",
    cls: "browser",
    enforcement: "blocking",
    mergeGate: true,
    domains: withApparatus("contracts", "explorer"),
    needs: [],
    parallelSafe: false,
    artifact: "pixi-world-proof-evidence",
    baselineSeconds: 5,
    claim:
      "Production Pixi modules boot WebGL2, follow resize, mint nearest-filtered textures, retire texture/source and organism resources across replacement, and tear down. The lifecycle proof must run in browser contexts with available WebGL; integrated App semantics are separately covered by browser-smoke and mobile-ui.",
  },
];

// --- Groups ------------------------------------------------------------------

/**
 * A named set of units executed together, in order, in one process.
 *
 * `verify` groups are the local completion contract. `ci-*` groups are the CI
 * shards: each runs on its own runner, so a group is a unit of parallelism, and
 * a group must be internally cheap enough not to become the critical-path tail.
 */
export interface ValidationGroup {
  readonly id: string;
  readonly title: string;
  readonly unitIds: readonly string[];
  /** Groups a CI job is derived from. Local aliases never run in CI directly. */
  readonly ci: boolean;
}

export const GROUPS: readonly ValidationGroup[] = [
  // Class groupings: these are the user-facing entry points.
  {
    id: "fast",
    title: "Fast gate",
    // Latency-defined, not class-defined: this is what a developer waits for
    // before they get an answer. `decisions` is Class B, but at ~74s it is the
    // highest-signal behavioural check there is, and leaving it out of CI's fast
    // gate while including it in `verify:fast` (or the reverse) is precisely the
    // local-versus-CI drift this manifest exists to prevent. `ci-fast` is
    // asserted to hold exactly this set.
    // `persistence-integrity` is here for the same reason `decisions` is: it is
    // Class B, but it is a sub-11s contract check whose failures are otherwise
    // only visible hours later in the simulation shards. CI's fast gate is
    // asserted to hold exactly this set, so both lists move together.
    unitIds: ["typecheck", "migration", "validation-arch", "decisions", "persistence-integrity"],
    ci: false,
  },
  {
    id: "simulation",
    title: "Deterministic product behaviour",
    // `decisions` is deliberately absent: the fast gate owns it. A unit may
    // appear in exactly one group, so that `verify` executes it once.
    unitIds: [
      "catalysts",
      "flows",
      "runtime-boundary",
      "time-controls",
      "landscape",
      "ecology",
      "niche",
      "aftermath",
      "dependency-policy",
      "dependency-arc",
      "dependency-possibility",
      "dependency-tradeoff",
      "dependency-washout",
      "spatial-occupancy",
    ],
    ci: false,
  },
  {
    id: "presentation",
    title: "Presentation and executable product",
    unitIds: ["build", "phenotype", "art-review", "plated", "phenotype-art", "pixi-spike", "pixi-p0"],
    ci: false,
  },
  {
    id: "browser",
    title: "Browser and runtime behaviour",
    unitIds: ["browser-smoke", "mobile-ui", "pixi-world-proof"],
    ci: false,
  },
  // Platform units are addressed as two routing groups rather than one, because
  // the two halves are gated separately: packaging is cheap enough to run
  // whenever the application could change, while the emulator smoke is the most
  // expensive step in CI and is gated on the same routing decision. Grouping
  // them together would force one policy onto both.
  //
  // There is deliberately no single `android` group: it would duplicate these
  // units, and the exactly-once gate is right to reject that.
  {
    id: "android-apk",
    title: "Android packaging (sync, drift, assemble, lint)",
    unitIds: ["android-sync", "android-assemble", "android-lint"],
    ci: false,
  },
  {
    id: "android-runtime",
    title: "Android runtime smoke (install and launch)",
    // Empty while `android-install-launch` is paused. The group stays so
    // re-entry is one line; `decideShard` on an empty group yields no work on
    // every diff, including app-touching ones, which is exactly the pause.
    unitIds: [],
    ci: false,
  },
  {
    id: "evidence",
    title: "Human-review evidence generation",
    unitIds: ["visual-capture", "pixi-capture"],
    ci: false,
  },
  {
    id: "survey",
    title: "Scientific characterisation (manual, long)",
    unitIds: ["ecology-survey", "niche-survey", "washout-reliance", "provenance", "broad-ecology-022"],
    ci: false,
  },

  // CI shards. Balanced against `baselineSeconds`; see AGENTS.md.
  {
    id: "ci-fast",
    title: "Fast gate",
    unitIds: ["typecheck", "validation-arch", "migration", "decisions", "persistence-integrity"],
    ci: true,
  },
  // Balanced from measured per-unit costs, not from intuition. The previous
  // partition left one shard at 408s while the next was 90s, so the longest job
  // was four and a half times the shortest and defined the whole critical path.
  // The two heaviest long tests are kept in separate shards on purpose: the
  // device-derived split between them is an estimate, and keeping them apart
  // means the estimate being wrong cannot compound into one oversized shard.
  {
    id: "ci-sim-a",
    title: "Deterministic suites A (cross-feeding tradeoff)",
    unitIds: ["dependency-tradeoff", "landscape", "dependency-policy"],
    ci: true,
  },
  {
    id: "ci-sim-b",
    title: "Deterministic suites B (possibility, flows)",
    unitIds: ["dependency-possibility", "flows"],
    ci: true,
  },
  {
    id: "ci-sim-c",
    title: "Deterministic suites C (niche, ecology, runtime boundary)",
    unitIds: ["niche", "ecology", "runtime-boundary", "spatial-occupancy", "bulk"],
    ci: true,
  },
  {
    id: "ci-sim-d",
    title: "Deterministic suites D (arc, catalysts, washout)",
    unitIds: ["dependency-arc", "catalysts", "time-controls", "dependency-washout", "aftermath"],
    ci: true,
  },
  {
    id: "ci-presentation",
    title: "Presentation contracts",
    unitIds: ["phenotype", "art-review", "plated", "phenotype-art", "pixi-spike", "pixi-p0"],
    ci: true,
  },
  {
    id: "ci-build",
    title: "Production build",
    unitIds: ["build"],
    ci: true,
  },
  {
    id: "ci-browser",
    title: "Browser and mobile UI (blocking)",
    unitIds: ["browser-smoke", "mobile-ui", "pixi-world-proof"],
    ci: true,
  },
  {
    id: "ci-visual",
    title: "Landscape visual evidence (non-gating)",
    unitIds: ["visual-capture"],
    ci: true,
  },
  {
    id: "ci-pixi",
    title: "Pixi spike browser evidence",
    unitIds: ["pixi-capture"],
    ci: true,
  },
];

// --- Derived views -----------------------------------------------------------

export const UNIT_BY_ID: ReadonlyMap<string, ValidationUnit> = new Map(
  UNITS.map((u) => [u.id, u]),
);

export const GROUP_BY_ID: ReadonlyMap<string, ValidationGroup> = new Map(
  GROUPS.map((g) => [g.id, g]),
);

/**
 * The canonical blocking repository contract.
 *
 * This is what `pnpm verify` means: every claim that can be proven in Node at
 * full strength. Browser (`browser`), platform (`platform`), scientific
 * (`scientific`), and evidence (`evidence`) classes are deliberately absent,
 * because each needs a different execution environment, and pretending a Node
 * run covers them is exactly the substitution this repository forbids. They are
 * gated separately: `pnpm verify:browser`, `pnpm verify:android`, and
 * `pnpm verify:evidence`.
 *
 * `tools/validation/run.ts check` asserts that `verify` executes exactly this
 * set, so the local command and the required CI product gates cannot drift apart.
 */
export const BLOCKING_REPOSITORY_UNITS: readonly string[] = UNITS.filter(
  (u) =>
    u.enforcement === "blocking" &&
    u.script !== null &&
    (u.cls === "invariant" || u.cls === "deterministic" || u.cls === "presentation"),
).map((u) => u.id);

/**
 * Blocking units a CI product run must execute: everything blocking that is not
 * Class E. Android is a separate workflow and is associated with the same
 * revision by branch name plus the required-gate dependency, not by inclusion
 * here.
 */
export const BLOCKING_PRODUCT_UNITS: readonly string[] = UNITS.filter(
  (u) => u.enforcement === "blocking" && u.cls !== "platform",
).map((u) => u.id);

export const unitsOf = (groupId: string): ValidationUnit[] => {
  const group = GROUP_BY_ID.get(groupId);
  if (!group) throw new Error(`unknown validation group: ${groupId}`);
  return group.unitIds.map((id) => {
    const unit = UNIT_BY_ID.get(id);
    if (!unit) throw new Error(`group ${groupId} references unknown unit: ${id}`);
    return unit;
  });
};

/** Approximate sequential cost of a group, from measured baselines. */
export const groupBaselineSeconds = (groupId: string): number =>
  unitsOf(groupId).reduce((sum, u) => sum + (u.baselineSeconds ?? 0), 0);
