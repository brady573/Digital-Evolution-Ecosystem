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
  /**
   * Waste economy switch (Slice 2). Optional, default true: omit for the
   * standard waste-accumulating world. Set false for a clean control world
   * (no deposition, no burden, no cleanup; tolerance/cleanup traits stay at
   * zero) so matched comparisons run through biology, not field surgery.
   */
  readonly enable_waste?: boolean;
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
}

export interface RenderResourceField {
  readonly gridSize: number;
  readonly stock: readonly (readonly number[])[];
  readonly capacity: readonly (readonly number[])[];
}

export interface RenderSnapshot {
  readonly tick: number;
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
  readonly metrics: any;
  readonly analysis: AnalysisState;
  readonly events: readonly { readonly tick: number; readonly label: string }[];
  /** Pending decision gate. While set, no further tick may execute. */
  readonly pendingDecision: PendingDecision | null;
  /** Immutable history of what the player actually chose (action, not cause). */
  readonly resolvedDecisions: readonly DecisionResolution[];
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
  | { readonly type: "LOAD_CHECKPOINT"; readonly checkpoint: SupportedUniverseCheckpoint }
  | { readonly type: "REQUEST_CHECKPOINT"; readonly requestId: string }
  | { readonly type: "REQUEST_EXPORT"; readonly requestId: string };

export type RuntimeResponse =
  | { readonly type: "SNAPSHOT"; readonly snapshot: RenderSnapshot }
  | { readonly type: "CHECKPOINT"; readonly requestId: string; readonly checkpoint: UniverseCheckpoint }
  | { readonly type: "EXPORT"; readonly requestId: string; readonly data: unknown }
  | { readonly type: "DECISION_RESOLVED"; readonly requestId: string; readonly snapshot: RenderSnapshot }
  | { readonly type: "ERROR"; readonly message: string; readonly requestId?: string };
