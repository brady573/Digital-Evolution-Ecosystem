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
 * | Class | Question it answers | Environment | Blocking? |
 * |---|---|---|---|
 * | `invariant`     | Is the repository structurally sound? | Node | yes |
 * | `deterministic` | Is exact supported behaviour still exact? | Node | yes |
 * | `presentation`  | Does the product build and do its presentation contracts hold? | Node | yes |
 * | `browser`       | Does it behave correctly in an actual browser? | Chromium | yes |
 * | `platform`      | Does the Android packaging integrate? | Android SDK / emulator | yes |
 * | `scientific`    | What actually happens across seeds and horizons? | Node, long | manual |
 * | `evidence`      | Can a human inspect the result? | Chromium | no |
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
 * shards. Sources are runs 36363857021, 36371082202, and 36372216402.
 *
 * Two caveats worth knowing. A unit's cost varies run to run on a shared
 * runner -- `flows` measured 123s then 81s, `decisions` 73s then 50s -- so a
 * single measurement is a sample, not a constant. And the shared GitHub runner
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
    domains: CODE,
    needs: [],
    parallelSafe: true,
    baselineSeconds: 10,
    claim: "Every package still typechecks against the shared contracts.",
  },
  {
    id: "migration",
    title: "Migration / prototype parity",
    script: "test:migration",
    cls: "invariant",
    enforcement: "blocking",
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
    domains: withApparatus("contracts", "sim-core", "sim-decisions", "sim-runtime", "explorer"),
    needs: [],
    parallelSafe: true,
    baselineSeconds: 50,
    claim:
      "Events still map to exactly the same offered choices as before, and an entity reference whose kind was never recorded yields no L- or C- claim rather than a guessed one.",
  },
  {
    id: "catalysts",
    title: "Catalyst catalog and effects",
    script: "test:catalysts",
    cls: "deterministic",
    enforcement: "blocking",
    domains: withApparatus("contracts", "sim-core", "sim-decisions", "sim-runtime", "explorer"),
    needs: [],
    parallelSafe: true,
    baselineSeconds: 75,
    claim: "The offered interventions produce their exact documented effects.",
  },
  {
    id: "flows",
    title: "Runtime session flows",
    script: "test:flows",
    cls: "deterministic",
    enforcement: "blocking",
    domains: withApparatus("contracts", "sim-core", "sim-analysis", "sim-decisions", "sim-runtime", "explorer"),
    needs: [],
    parallelSafe: true,
    baselineSeconds: 81,
    claim:
      "Session lifecycle, forking, and pause gating behave exactly as specified, every named checkpoint migration rule is well-formed and still matches the code that absorbs it, and a save written before entity references carried their kind restores with the same reference count, no guessed namespace, and value-based deduplication.",
  },
  {
    id: "time-controls",
    title: "Speed and time control",
    script: "test:time-controls",
    cls: "deterministic",
    enforcement: "blocking",
    domains: withApparatus("contracts", "sim-core", "sim-runtime", "explorer"),
    needs: [],
    parallelSafe: true,
    baselineSeconds: 20,
    claim: "Playback speed changes advance exactly the tick counts they claim.",
  },
  {
    id: "landscape",
    title: "Landscape rendering rules",
    script: "test:landscape",
    cls: "deterministic",
    enforcement: "blocking",
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
    domains: withApparatus("contracts", "sim-core", "sim-analysis", "sim-runtime"),
    needs: [],
    parallelSafe: true,
    baselineSeconds: 93,
    claim:
      "Niche differentiation is possible and typical where claimed, its limits still hold, and the lineages it names are asserted as lineages rather than as untyped numbers.",
  },
  {
    id: "aftermath",
    title: "Aftermath state and comparison",
    script: "test:aftermath",
    cls: "deterministic",
    enforcement: "blocking",
    domains: withApparatus("contracts", "sim-core", "sim-decisions", "sim-runtime", "explorer"),
    needs: [],
    parallelSafe: false,
    claim:
      "An impact pause retains both sides of the effect at one tick and auto-resume never loses them.",
    baselineSeconds: 11,
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
    domains: withApparatus("contracts", "sim-core", "sim-decisions", "sim-runtime"),
    needs: [],
    parallelSafe: true,
    claim:
      "One deterministic run establishes and then loses a dependency, resume from a checkpoint reproduces it, and each named entity reference asserts the kind it denotes rather than a bare id.",
    baselineSeconds: 90,
  },
  {
    id: "dependency-possibility",
    title: "Cross-feeding possibility across seeds",
    script: "test:dependency:possibility",
    cls: "deterministic",
    enforcement: "blocking",
    domains: withApparatus("contracts", "sim-core", "sim-decisions", "sim-runtime"),
    needs: [],
    parallelSafe: true,
    baselineSeconds: 58,
    claim: "Cross-feeding is genuinely possible across seeds, not just in one lucky world.",
  },
  {
    id: "dependency-tradeoff",
    title: "Cross-feeding tradeoff",
    script: "test:dependency:tradeoff",
    cls: "deterministic",
    enforcement: "blocking",
    domains: withApparatus("contracts", "sim-core", "sim-decisions", "sim-runtime"),
    needs: [],
    parallelSafe: true,
    baselineSeconds: 275,
    claim: "Cross-feeding carries a real energetic cost rather than being free.",
  },
  {
    id: "dependency-washout",
    title: "Washout reliance and recovery",
    script: "test:dependency:washout",
    cls: "deterministic",
    enforcement: "blocking",
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
    domains: CODE,
    needs: [],
    parallelSafe: false,
    artifact: "explorer-dist",
    baselineSeconds: 12,
    claim: "The product compiles, and the resulting bundle is the one every browser lane tests.",
  },
  {
    id: "phenotype",
    title: "Phenotype rendering logic",
    script: "test:phenotype",
    cls: "presentation",
    enforcement: "blocking",
    domains: withApparatus("contracts", "phenotype", "explorer"),
    needs: [],
    parallelSafe: true,
    baselineSeconds: 10,
    claim: "A genotype maps to the same phenotype, in Node and in the world model alike.",
  },
  {
    id: "art-review",
    title: "Art review invariants",
    script: "test:art-review",
    cls: "presentation",
    enforcement: "blocking",
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
    domains: withApparatus("contracts", "phenotype", "explorer"),
    needs: [],
    parallelSafe: true,
    baselineSeconds: 3,
    claim: "The plated organism geometry is internally consistent with its manifest.",
  },
  {
    id: "pixi-spike",
    title: "Pixi spike validation",
    script: "test:pixi-spike",
    cls: "presentation",
    enforcement: "blocking",
    domains: withApparatus("contracts", "explorer"),
    needs: [],
    parallelSafe: true,
    baselineSeconds: 2,
    claim: "The Pixi spike still satisfies the manifest that would justify adopting it.",
  },

  // --- Class D: browser / runtime ------------------------------------------
  {
    id: "browser-smoke",
    title: "Browser smoke",
    script: "test:browser",
    cls: "browser",
    enforcement: "blocking",
    domains: withApparatus("contracts", "sim-core", "sim-decisions", "sim-runtime", "phenotype", "explorer", "android"),
    needs: ["build"],
    parallelSafe: false,
    baselineSeconds: 41,
    claim:
      "The built product actually works in a browser: the Web Worker, canvas, and control surface all function.",
  },
  {
    id: "mobile-ui",
    title: "Mobile UI validation",
    script: "test:mobile-ui",
    cls: "browser",
    enforcement: "blocking",
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
    domains: withApparatus("contracts", "sim-core", "sim-decisions"),
    needs: [],
    parallelSafe: true,
    artifact: "testdata",
    claim: "Reliance on a flushed nutrient column measured across seeds and regimes.",
  },
  {
    id: "provenance",
    title: "Constant provenance measurements",
    script: "test:provenance",
    cls: "scientific",
    enforcement: "manual",
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
    domains: withApparatus("contracts", "explorer"),
    needs: [],
    parallelSafe: false,
    artifact: "pixi-spike-evidence",
    baselineSeconds: 41,
    claim:
      "GPU-dependent inspection images for the Pixi spike. Non-gating, because software-GL timing is not a property of the product.",
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
    unitIds: ["typecheck", "migration", "validation-arch", "decisions"],
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
    ],
    ci: false,
  },
  {
    id: "presentation",
    title: "Presentation and executable product",
    unitIds: ["build", "phenotype", "art-review", "plated", "pixi-spike"],
    ci: false,
  },
  {
    id: "browser",
    title: "Browser and runtime behaviour",
    unitIds: ["browser-smoke", "mobile-ui"],
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
    unitIds: ["ecology-survey", "niche-survey", "washout-reliance", "provenance"],
    ci: false,
  },

  // CI shards. Balanced against `baselineSeconds`; see AGENTS.md.
  {
    id: "ci-fast",
    title: "Fast gate",
    unitIds: ["typecheck", "validation-arch", "migration", "decisions"],
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
    title: "Deterministic suites C (niche, ecology)",
    unitIds: ["niche", "ecology"],
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
    unitIds: ["phenotype", "art-review", "plated", "pixi-spike"],
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
    title: "Browser, mobile UI, and landscape captures",
    unitIds: ["browser-smoke", "mobile-ui", "visual-capture"],
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
