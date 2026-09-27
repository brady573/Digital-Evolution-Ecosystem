export interface VersionInfo {
  readonly appVersion: string;
  readonly engineVersion: string;
  readonly exportFormatVersion: string;
  readonly checkpointSchemaVersion: string;
}

export interface WorldRecipe {
  readonly seed: number;
  readonly nutrientSupply: number;
  readonly nutrientZoneSeparation: number;
  readonly nutrientVariety: number;
  readonly foundingPopulation: number;
  readonly startingVariation: number;
  readonly mutationChance: number;
  readonly survivalPressure: number;
}

export interface EngineConfig {
  readonly seed: number;
  readonly start: number;
  readonly prod: number;
  readonly cap: number;
  readonly pop: number;
  readonly div: number;
  readonly mr: number;
  readonly ms: number;
  readonly press: number;
  readonly patch: number;
  readonly resource_b_fraction: number;
  readonly cat: "global" | "droughtA" | "droughtB";
  readonly st: number | null;
  readonly resource_model: "definition_driven_substances";
  readonly resource_grid: number;
  readonly enable_byproduct: boolean;
  readonly enable_dormancy: boolean;
  readonly study?: boolean;
}

export interface AnalysisState {
  readonly crossfeeding: unknown;
  readonly seed_bank: unknown;
  readonly eras: readonly unknown[];
  readonly records: readonly unknown[];
  readonly rules: Readonly<Record<string, number>>;
}

/**
 * M3 event decisions.
 *
 * sim-analysis observes; sim-decisions (pure policy) maps an ObservedEvent to
 * a DecisionOpportunity; sim-runtime owns pausing, validation, application and
 * persistence. Only a validated InterventionSpec may mutate the simulation, and
 * only through runtime.
 * ------------------------------------------------------------------ */

/** What analysis claims was observed. Presentation keys, never causes. */
export interface ObservedEvent {
  readonly schemaVersion: 1;
  /** Immutable within universe history. */
  readonly eventId: string;
  /** Persistent story/event family identity. */
  readonly arcId: string;
  readonly kind: string;
  readonly phase: string;
  readonly tick: number;
  readonly level: string;
  readonly title: string;
  readonly summary: string;
  readonly evidence: Readonly<Record<string, number | string | boolean>>;
  readonly entityRefs: readonly number[];
}

/**
 * Versioned, extensible mechanical intervention. Engine effects are unchanged:
 * this union only names the existing catalyst modes. Later variants may add
 * magnitude/duration/region/resource targets without changing this shape's
 * meaning.
 */
export type InterventionSpec =
  | {
      readonly schemaVersion: 1;
      readonly kind: "nutrient_disturbance";
      // c_washout is a SUPPORTED environmental intervention (recorded path,
      // removal events, response tracking), validation-internal by policy:
      // never offered in windows (asserted), no Experiments button. Additive
      // union member: old saves/loads are unaffected, no schema bump. Engine
      // version unchanged: sink paths are inert by default (parity-proven)
      // and active only under this explicit command, like droughts.
      readonly mode: "global_crash" | "drought_a" | "drought_b" | "c_washout";
    };

export interface DecisionChoice {
  readonly choiceId: string;
  readonly title: string;
  /** Direct mechanical effect only. Never an outcome promise. */
  readonly directEffectDescription: string;
  /** null is the leave-unchanged choice. */
  readonly intervention: InterventionSpec | null;
  /** The catalyst this choice applies, if offered from a catalyst window. */
  readonly catalystId?: CatalystId | null;
}

export interface DecisionOpportunity {
  readonly schemaVersion: 1;
  readonly opportunityId: string;
  /** So a restored opportunity stays interpretable after the catalog evolves. */
  readonly policyVersion: string;
  readonly source: "observed_event";
  readonly sourceEventId: string;
  readonly sourceArcId: string | null;
  readonly createdTick: number;
  readonly status: "pending" | "resolved";
  readonly prompt: string;
  readonly context: string;
  /** The exact bounded context the policy saw. Persisted so a restored or
   *  exported opportunity stays interpretable without re-derivation. */
  readonly contextSnapshot: DecisionContext;
  readonly choices: readonly DecisionChoice[];
}

/** An action followed by later outcomes. Not a causal claim. */
export interface DecisionResolution {
  readonly schemaVersion: 1;
  readonly commandId: string;
  /** Tick at resolution/application. Resolution never advances the world. */
  readonly tick: number;
  /** Tick the opportunity was offered. Preserved so History and evidence can
   *  order offer before resolution without re-derivation. */
  readonly offerTick: number;
  readonly opportunityId: string;
  /** Null for world-catalyst decisions: never a fabricated event id. */
  readonly sourceEventId: string | null;
  readonly choiceId: string;
  /** Presentation copy as offered, recorded so History never needs its own
   *  choice catalog and cannot drift from what was actually applied. */
  readonly choiceTitle: string;
  readonly directEffectDescription: string;
  readonly intervention: InterventionSpec | null;
  readonly source: "event_decision" | "world_catalyst";
  /** The selected catalyst, if resolved from a catalyst window. */
  readonly catalystId?: CatalystId | null;
  readonly policyVersion: string;
}

/** Read-only context the policy layer is allowed to consult. */
export interface DecisionContext {
  readonly tick: number;
  readonly population: number;
  readonly dormantPopulation: number;
  readonly cEnergyShare: number;
  readonly crossfeederFraction: number;
}

/* ------------------------------------------------------------------ *
 * M3 aftermath: the impact of one resolved intervention.
 *
 * Aftermath state is EVIDENCE, not biology. It is a retained read model of
 * what the world looked like at the resolution tick, captured by sim-runtime
 * from the same authorities that feed analysis, so the comparison the player
 * sees cannot disagree with the simulation. Nothing here mutates or predicts
 * anything, and no field in it is ever written back.
 *
 * Resolution advances zero ticks, so the baseline tick IS the resolution
 * tick. There is no "before the intervention" instant that is not also "the
 * moment it was applied", and this contract must not imply one exists.
 * ------------------------------------------------------------------ */

/** Which retained view the player is comparing. */
export type AftermathComparison = "difference" | "now" | "before";

/**
 * The scalar measures an aftermath may compare, with the meaning the player
 * is entitled to read off them. Declared once, here, so the runtime cannot
 * retain a scalar the UI cannot label and the UI cannot label a scalar the
 * runtime never retained. Fractions are 0..1 and labelled as such; a
 * difference on a fraction is a change in proportion, never a population
 * change, and the UI says so.
 */
export interface AftermathComparableDescriptor {
  readonly key: string;
  readonly label: string;
  /** Suffix shown after the value. "" for a plain count. */
  readonly unit: string;
  /** True when the value is a 0..1 proportion, so relative change must not
   *  be phrased as a count. */
  readonly fraction: boolean;
}

export const AFTERMATH_COMPARABLES: readonly AftermathComparableDescriptor[] = [
  { key: "population", label: "Living population", unit: "", fraction: false },
  { key: "active_population", label: "Active", unit: "", fraction: false },
  { key: "dormant_population", label: "Dormant", unit: "", fraction: false },
  { key: "dormant_fraction", label: "Dormant share", unit: "%", fraction: true },
  { key: "c_energy_share", label: "C-energy share", unit: "%", fraction: true },
  { key: "crossfeeder_fraction", label: "Crossfeeders", unit: "%", fraction: true },
  { key: "waste_fraction", label: "Waste load", unit: "%", fraction: true },
  { key: "waste_exposed_share", label: "In burden-relevant cells", unit: "%", fraction: true },
  { key: "tolerance_mean", label: "Mean tolerance", unit: "", fraction: false },
  { key: "cleanup_mean", label: "Mean cleanup", unit: "", fraction: false },
] as const;

/** A retained field snapshot at the resolution tick, at full grid resolution.
 *  Never downsampled: a coarser grid would be a resolution the evidence does
 *  not have, and a spatial claim needs the resolution it was measured at.
 *
 *  `stock` is KIND-MAJOR and FLAT, matching the engine's own layout: the outer
 *  index is the substance kind (0 = nutrient A, 1 = B, 2 = C) and each entry is
 *  a flat run of gridSize*gridSize cells in row-major order. It is NOT an array
 *  of grid rows - reading it that way compares the wrong cells. */
export interface AftermathFieldSnapshot {
  readonly gridSize: number;
  readonly stock: readonly (readonly number[])[];
}

/**
 * Everything retained to compare an outcome against the moment of the
 * intervention. `scalars` holds exactly the keys declared in
 * AFTERMATH_COMPARABLES; nothing else is retained, so the comparison surface
 * cannot quietly grow.
 */
export interface AftermathBaseline {
  readonly tick: number;
  readonly resources: AftermathFieldSnapshot;
  readonly waste: AftermathFieldSnapshot;
  readonly scalars: Readonly<Record<string, number>>;
}

/**
 * One resolved intervention under observation. `phase` names the presentation
 * state; the runtime owns the transition, the UI only renders it. Every phase
 * after "impact" is presentation over evidence the runtime already holds.
 */
export interface AftermathState {
  readonly schemaVersion: 1;
  readonly opportunityId: string;
  readonly commandId: string;
  /** The tick the intervention was applied at. Resolution advanced zero ticks
   *  to get here, and the impact state must not advance any. */
  readonly resolutionTick: number;
  readonly phase: AftermathPhase;
  /** Copy as offered and applied, so the aftermath never re-derives or
   *  re-words what was actually chosen. */
  readonly choiceTitle: string;
  /** The mechanical effect the command contract proves. This is the only
   *  causal claim the aftermath may ever make. */
  readonly directEffectDescription: string;
  readonly intervention: InterventionSpec | null;
  readonly source: "event_decision" | "world_catalyst";
  readonly baseline: AftermathBaseline;
}

/** Presentation states of an aftermath. "impact" is entered at resolution and
 *  is the only phase that requires the world to be paused. */
export type AftermathPhase = "impact" | "observation" | "development" | "settlement";

/**
 * The comparable scalars as they stand right now, built by the same function
 * that built the baseline so the two can never disagree. Carries only scalars:
 * the current fields are already on the snapshot, so retaining them twice would
 * be pure duplication. Emitted only while an aftermath is active, because
 * deriving these costs a pass over the population and the ordinary render path
 * must not pay for a comparison nobody is looking at.
 */
export interface AftermathScalars {
  readonly tick: number;
  readonly scalars: Readonly<Record<string, number>>;
}

/* ------------------------------------------------------------------ *
 * M3 world catalysts: quiet-period environmental intervention windows.
 *
 * A catalyst window is NOT an observed biological event and must never be
 * represented as one. It shares the pause gate, resolution validation, and
 * persistence machinery with event decisions, but carries explicit
 * world-catalyst provenance end to end.
 * ------------------------------------------------------------------ */

/** Stable catalyst identifiers, M3 v1 catalog. */
export type CatalystId = "drought-a" | "drought-b" | "global-crash";

/** Read-only world state a catalyst eligibility check may consult. */
export interface CatalystContext {
  readonly tick: number;
  readonly population: number;
  /** True while any drought effect is active. */
  readonly droughtActive: boolean;
  /** Share of realized cumulative resource energy from Nutrient A (0..1). */
  readonly energyShareA: number;
  /** Share of realized cumulative resource energy from Nutrient B (0..1). */
  readonly energyShareB: number;
  /** Nutrient A field stock as a share of modeled A capacity (0..1). */
  readonly stockFractionA: number;
  /** Nutrient B field stock as a share of modeled B capacity (0..1). */
  readonly stockFractionB: number;
  /** Total abiotic stock as a share of modeled abiotic capacity (0..1). */
  readonly abioticStockFraction: number;
}

/** Per-catalyst diagnostic: why it was or was not offered. */
export interface CatalystDiagnosis {
  readonly catalystId: CatalystId;
  readonly eligible: boolean;
  /** Human-readable reasons, in evaluation order. For validation, not biology. */
  readonly reasons: readonly string[];
}

export interface CatalystOpportunity {
  readonly schemaVersion: 1;
  readonly opportunityId: string;
  /** Catalyst catalog version that generated this window. */
  readonly policyVersion: string;
  readonly source: "world_catalyst";
  /** Eligible catalysts at offer, in deterministic catalog order. */
  readonly catalystIds: readonly CatalystId[];
  readonly createdTick: number;
  readonly status: "pending" | "resolved";
  readonly prompt: string;
  readonly context: string;
  /** The exact eligibility snapshot, so the offer stays interpretable. */
  readonly contextSnapshot: CatalystContext;
  readonly diagnoses: readonly CatalystDiagnosis[];
  readonly choices: readonly DecisionChoice[];
}

/** Either pending-decision source. Never a fake event. */
export type PendingDecision = DecisionOpportunity | CatalystOpportunity;

/** Deterministic per-stride biological interval rates (one stride of flows). */
export interface IntervalRates {
  readonly producedC: number;
  readonly consumedA: number;
  readonly consumedB: number;
  readonly consumedC: number;
  readonly energyA: number;
  readonly energyB: number;
  readonly energyC: number;
  readonly births: number;
  readonly deaths: number;
  readonly wasteProduced: number;
  readonly wasteRemoved: number;
  readonly wasteDecayed: number;
  readonly burdenEnergy: number;
  readonly cleanupEnergy: number;
  readonly cleanupExec: number;
}

/**
 * Per-lineage activity during one observation stride, including lineages
 * with no living members left (the dead are attributed, not dropped).
 * netMembers (births minus deaths) sums to the population change.
 */
export interface IntervalLineageFlow {
  readonly lineageId: number;
  readonly netMembers: number;
  readonly consumedA: number;
  readonly consumedB: number;
  readonly consumedC: number;
  readonly energyA: number;
  readonly energyB: number;
  readonly energyC: number;
  readonly producedC: number;
  readonly births: number;
  readonly deaths: number;
  /** Deposited waste mass (entered the field). Saturated surplus that never
   * entered the field is counted as saturated loss in the waste accounting,
   * not here. */
  readonly wasteProduced: number;
  readonly wasteRemoved: number;
  readonly burdenEnergy: number;
  readonly cleanupEnergy: number;
  readonly cleanupExec: number;
}

/** Deterministic per-lineage interval activity with window totals. */
export interface IntervalFlowFacts {
  readonly tick: number;
  readonly strideTicks: number;
  readonly lineages: readonly IntervalLineageFlow[];
  readonly totals: {
    readonly netMembers: number;
    readonly consumedA: number;
    readonly consumedB: number;
    readonly consumedC: number;
    readonly energyA: number;
    readonly energyB: number;
    readonly energyC: number;
    readonly producedC: number;
    readonly births: number;
    readonly deaths: number;
    readonly wasteProduced: number;
    readonly wasteRemoved: number;
    readonly burdenEnergy: number;
    readonly cleanupEnergy: number;
    readonly cleanupExec: number;
  };
}

/**
 * Deterministic biological flow facts for one lineage at one observation
 * tick, aggregated over living organisms only. Causal facts (who ate,
 * gained, and produced what), never semantic labels: analysis may classify
 * from these, biology never reads them back.
 */
export interface LineageFlow {
  readonly lineageId: number;
  readonly members: number;
  /**
   * Lifetime consumption-EVENT counts summed over living members, by
   * substance (frozen parity-protected counters, not mass: ma/mb/mc
   * increment per eating event). Interval deltas carry true mass.
   */
  readonly consumedA: number;
  readonly consumedB: number;
  readonly consumedC: number;
  /** Lifetime realized energy summed over living members, by source. */
  readonly energyA: number;
  readonly energyB: number;
  readonly energyC: number;
  /** Lifetime biologically produced Metabolite C summed over living members. */
  readonly producedC: number;
}

/** Deterministic per-lineage flow snapshot with living-population totals. */
export interface FlowFacts {
  readonly tick: number;
  /** Lineage order follows first-seen living-member order: deterministic. */
  readonly lineages: readonly LineageFlow[];
  readonly totals: {
    readonly members: number;
    readonly consumedA: number;
    readonly consumedB: number;
    readonly consumedC: number;
    readonly energyA: number;
    readonly energyB: number;
    readonly energyC: number;
    readonly producedC: number;
  };
}


export interface RenderOrganism {
  readonly id: number;
  readonly parent: number | null;
  readonly generation: number;
  readonly lineageId: number;
  readonly cladeId: number;
  readonly x: number;
  readonly y: number;
  readonly energy: number;
  readonly activity: "active" | "dormant";
  readonly speed: number;
  readonly sensing: number;
  readonly metabolism: number;
  readonly reproduction: number;
  readonly diet: number;
  readonly habitat: number;
  readonly byproductUse: number;
  readonly dormancyResponse: number;
  /** Inherited waste-response traits (Slice 2). Presentation only: the
   *  landscape and history evidence read them, biology never does. */
  readonly tolerance: number;
  readonly cleanup: number;
}

export interface RenderResourceField {
  readonly gridSize: number;
  readonly stock: readonly (readonly number[])[];
  readonly capacity: readonly (readonly number[])[];
}

/** Spatial Metabolic Waste field (Slice 2), same grid and cell convention as
 *  `RenderResourceField`. Read-only rendering input for the landscape
 *  substrate and the analytical waste overlay. */
export interface RenderWasteField {
  readonly gridSize: number;
  readonly stock: readonly number[];
  readonly capacity: readonly number[];
}

export interface RenderSnapshot {
  readonly tick: number;
  /** Presentation-only identity of this displayed universe instance. Unique
   *  per create/restore, and NOT biological state: it is not stored in
   *  checkpoints and does not affect replay. The renderer uses it to scope
   *  presentation-only state, because two universes can share a seed and a
   *  resolved config. */
  readonly worldId: number;
  /** Exact resolved engine configuration of the running universe (0.20.0+).
   *  Presentation uses it to show the active recipe without ever restaging
   *  it as pending. Read-only: it never changes simulation behavior. */
  readonly config: EngineConfig;
  readonly seed: number;
  readonly population: number;
  readonly activePopulation: number;
  readonly dormantPopulation: number;
  readonly organisms: readonly RenderOrganism[];
  readonly resources: RenderResourceField;
  /** Metabolic Waste field. Read-only rendering input; independent of
   *  nutrients in storage and in meaning. */
  readonly waste: RenderWasteField;
  readonly metrics: any;
  readonly analysis: AnalysisState;
  readonly events: readonly { readonly tick: number; readonly label: string }[];
  /** Pending decision gate. While set, no further tick may execute. */
  readonly pendingDecision: PendingDecision | null;
  /** Immutable history of what the player actually chose (action, not cause). */
  readonly resolvedDecisions: readonly DecisionResolution[];
  /** Aftermath of the most recent resolution, while it is still being
   *  presented. Evidence, not biology: it carries a retained read model of the
   *  resolution tick and never mutates simulation state. Null when no aftermath
   *  is active. Presentation reads it from here rather than owning it, so the
   *  application never holds mutable aftermath state. */
  readonly aftermath: AftermathState | null;
  /** Comparable "now" values, present exactly when `aftermath` is. Null
   *  otherwise, so an absent comparison is visible as absence rather than
   *  rendered as zero. */
  readonly aftermathNow: AftermathScalars | null;
  readonly control: {
    readonly tick: number;
    readonly population: number;
    readonly metrics: any;
  } | null;
}

export interface DecisionCheckpoint {
  readonly pending: PendingDecision | null;
  readonly resolutions: readonly DecisionResolution[];
  /** Event-decision catalog version that will generate future opportunities. */
  readonly policyVersion: string;
  /** Catalyst catalog version that will generate future windows. */
  readonly catalystPolicyVersion: string;
  /** Tick of the most recent decision opportunity creation, either source.
   *  Drives the catalyst quiet interval; 0 means none yet (measure from 0). */
  readonly lastDecisionTick: number;
  /** Tick of the most recent non-null catalyst application, or null. */
  readonly lastMajorCatalystTick: number | null;
}

/** Resumable checkpoint, schema 0.3: adds catalyst windows and pacing state. */
export interface UniverseCheckpoint {
  readonly checkpointSchemaVersion: "0.3";
  readonly engineVersion: string;
  readonly createdTick: number;
  readonly experiment: unknown;
  readonly analysis: unknown;
  readonly control: unknown | null;
  readonly controlAnalysis: unknown | null;
  readonly decisions: DecisionCheckpoint;
}

/**
 * Schema 0.2, still loadable. Pending event decisions normalize forward
 * (absent `source` with a `sourceEventId` means observed_event); resolutions
 * backfill `offerTick` from their resolution tick and `catalystId` null.
 * Pacing state restarts honestly: last decision tick becomes the newest known
 * decision tick (or 0), cooldown becomes null. Never written by this version.
 */
export interface UniverseCheckpointV02 {
  readonly checkpointSchemaVersion: "0.2";
  readonly engineVersion: string;
  readonly createdTick: number;
  readonly experiment: unknown;
  readonly analysis: unknown;
  readonly control: unknown | null;
  readonly controlAnalysis: unknown | null;
  readonly decisions: {
    readonly pending: unknown;
    readonly resolutions: unknown;
    readonly policyVersion: unknown;
  };
}

/**
 * Schema 0.1, still loadable. Restores with no pending opportunity and an empty
 * decision history. Never written by this version.
 */
export interface LegacyUniverseCheckpoint {
  readonly checkpointSchemaVersion: "0.1";
  readonly engineVersion: string;
  readonly createdTick: number;
  readonly experiment: unknown;
  readonly analysis: unknown;
  readonly control: unknown | null;
  readonly controlAnalysis: unknown | null;
}

export type SupportedUniverseCheckpoint = UniverseCheckpoint | UniverseCheckpointV02 | LegacyUniverseCheckpoint;

export type RuntimeCommand =
  | { readonly type: "CREATE_UNIVERSE"; readonly config: EngineConfig }
  | { readonly type: "ADVANCE_TICKS"; readonly ticks: number }
  | { readonly type: "RUN_TO_NEXT_EVENT"; readonly maxTicks?: number }
  /** Compatibility adapter for Experiments. Runtime maps it to an InterventionSpec
   *  and keeps the matched-control behavior explicit. */
  | { readonly type: "APPLY_INTERVENTION"; readonly intervention: "global" | "droughtA" | "droughtB" }
  | { readonly type: "CREATE_CONTROL_FORK" }
  | {
      readonly type: "RESOLVE_EVENT_DECISION";
      readonly opportunityId: string;
      readonly choiceId: string;
      readonly requestId?: string;
    }
  | { readonly type: "RESUME_AFTERMATH"; readonly requestId?: string }
  | { readonly type: "LOAD_CHECKPOINT"; readonly checkpoint: SupportedUniverseCheckpoint }
  | { readonly type: "REQUEST_CHECKPOINT"; readonly requestId: string }
  | { readonly type: "REQUEST_EXPORT"; readonly requestId: string };

export type RuntimeResponse =
  | { readonly type: "SNAPSHOT"; readonly snapshot: RenderSnapshot }
  | { readonly type: "CHECKPOINT"; readonly requestId: string; readonly checkpoint: UniverseCheckpoint }
  | { readonly type: "EXPORT"; readonly requestId: string; readonly data: unknown }
  | { readonly type: "DECISION_RESOLVED"; readonly requestId: string; readonly snapshot: RenderSnapshot }
  /** Acknowledgement reply for RESUME_AFTERMATH. Distinct from a bare SNAPSHOT
   *  so the awaiting caller can settle: a snapshot alone only notifies
   *  subscribers and would leave the request pending forever. */
  | { readonly type: "AFTERMATH_RESUMED"; readonly requestId: string; readonly snapshot: RenderSnapshot }
  | { readonly type: "ERROR"; readonly message: string; readonly requestId?: string };
