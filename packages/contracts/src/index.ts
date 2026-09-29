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

/* ------------------------------------------------------------------ *
 * Typed identity.
 *
 * Lineage and clade are different kinds of thing that look identical at
 * runtime — both are plain numbers — and the product's namespace split rests
 * entirely on never confusing them. A clade is the deepest established
 * mutation branch; a lineage is an ancestral chain. Neither is a subset of the
 * other, and `L-0007` and `C-0007` are unrelated organisms of the world.
 *
 * So the identities are branded rather than aliased. `type CladeId = number`
 * would document the distinction while permitting the exact conflation that
 * Decision 3 exists to prevent; a brand makes it a compile error instead.
 *
 * The brand itself is a compile-time fiction: it is erased at runtime, so no
 * stored value, checkpoint, or export changes shape because of it. What *does*
 * change shape is `EntityRef` below, because a reference must now persist what
 * it denotes. A checkpoint written before that carries bare numbers, which is
 * why `typedRefs` treats an unkind or primitive ref as "real but unnameable"
 * rather than guessing -- and why the named, versioned migration for those
 * legacy references belongs to the checkpoint unit, not here.
 * ------------------------------------------------------------------ */

declare const identityBrand: unique symbol;
type Identity<K extends string, B> = B & { readonly [identityBrand]: K };

/** A single organism instance. Not an ancestor and not a group. */
export type OrganismId = Identity<"organism", number>;
/** An ancestral chain. `L-` is reserved for this and nothing else. */
export type LineageId = Identity<"lineage", number>;
/** An analytical clade: the deepest established mutation branch. `C-` is
 *  reserved for this and nothing else. */
export type CladeId = Identity<"clade", number>;
/** A durable history record. */
export type HistoryRecordId = Identity<"history-record", string>;
/** One observed event. */
export type EventId = Identity<"event", string>;
/** A persistent story/event family that several events belong to. */
export type ArcId = Identity<"arc", string>;
/** A decision the runtime offered and the player answered. */
export type DecisionOpportunityId = Identity<"decision-opportunity", string>;
/** The applied record of a player's decision. */
export type DecisionCommandId = Identity<"decision-command", string>;
/** A displayed universe instance. Presentation identity, not biological state. */
export type WorldId = Identity<"world", number>;
/* A matched control twin is not given its own identity type: the model has no
 * comparison id field today — the twin is reached through `control`, and its
 * world identity is a `WorldId` like any other. If a comparison id is ever
 * introduced it should be branded then, rather than reserved here now. */

/**
 * The one place a raw number becomes a typed identity. Producers call these so
 * the widening is explicit and reviewable; consumers never call them, because a
 * consumer that has to invent an identity is a consumer reading the wrong
 * field. A `number` reaching these functions is a producer stating what it
 * means, which is exactly the claim that needs to be visible in review.
 */
export const organismId = (value: number): OrganismId => value as OrganismId;
export const lineageId = (value: number): LineageId => value as LineageId;
export const cladeId = (value: number): CladeId => value as CladeId;
export const worldId = (value: number): WorldId => value as WorldId;
export const historyRecordId = (value: string): HistoryRecordId => value as HistoryRecordId;
export const eventId = (value: string): EventId => value as EventId;
export const arcId = (value: string): ArcId => value as ArcId;
export const decisionOpportunityId = (value: string): DecisionOpportunityId =>
  value as DecisionOpportunityId;
export const decisionCommandId = (value: string): DecisionCommandId => value as DecisionCommandId;

/**
 * What an entity reference denotes.
 *
 * `kind` is `null` when the reference is real but its kind was not recorded —
 * a checkpoint written before refs carried their kind. That is not the same as
 * a reference being absent: the entity exists, we simply cannot say what it is.
 * A consumer must therefore omit the claim rather than guess a namespace,
 * because printing `L-0009` for an unnamed reference would assert something
 * unverified, and printing `C-0009` would be equally unverified.
 */
export type EntityRefKind = "organism" | "lineage" | "clade";

export interface EntityRef {
  readonly kind: EntityRefKind | null;
  readonly id: number;
}

/** An `EntityRef` whose kind is actually known. */
export interface TypedEntityRef {
  readonly kind: EntityRefKind;
  readonly id: number;
}

export const lineageRef = (id: number): EntityRef => ({ kind: "lineage", id });
export const cladeRef = (id: number): EntityRef => ({ kind: "clade", id });
export const organismRef = (id: number): EntityRef => ({ kind: "organism", id });

const ENTITY_REF_KINDS: readonly EntityRefKind[] = ["organism", "lineage", "clade"];

/**
 * Keep only the references whose kind is actually recorded.
 *
 * This is also the boundary that legacy data crosses. A checkpoint written
 * before refs carried their kind holds bare numbers, and `restore` performs no
 * deep validation, so those entries arrive as primitives. `typeof ref === "object"`
 * is what keeps them from being read as objects whose `id` is `undefined`, and
 * it is why the filter is defensive rather than a plain `kind !== null` test.
 *
 * The kind is checked against the known set rather than merely for
 * non-nullness. A restore performs no validation, so an unrecognised kind is
 * exactly the kind of data that can arrive here, and forwarding it would push
 * a bogus namespace into the contract and into rendered output.
 */
export const typedRefs = (refs: readonly unknown[]): readonly TypedEntityRef[] => {
  const out: TypedEntityRef[] = [];
  for (const ref of refs) {
    if (ref === null || typeof ref !== "object") continue;
    const candidate = ref as Partial<EntityRef>;
    if (typeof candidate.id !== "number" || !Number.isFinite(candidate.id)) continue;
    if (candidate.kind === null || candidate.kind === undefined) continue;
    if (!ENTITY_REF_KINDS.includes(candidate.kind)) continue;
    out.push({ kind: candidate.kind, id: candidate.id });
  }
  return out;
};

/**
 * Namespace labels. `L-` is a lineage and only a lineage; `C-` is a clade and
 * only a clade. Both analysis prose and presentation format through these, so
 * the two cannot drift apart into two truths for the same identity.
 */
export const formatLineageId = (id: LineageId): string => `L-${String(id).padStart(4, "0")}`;
export const formatCladeId = (id: CladeId): string => `C-${String(id).padStart(4, "0")}`;

/* ------------------------------------------------------------------ *
 * Checkpoint migration rules.
 *
 * Decision 2: "a missing field is tolerated only when a supported historical
 * checkpoint/schema has an explicit migration/default rule for that omission."
 * That makes tolerance something to be *declared*, not something to be
 * discovered later by noticing that a save happened to load. This table is that
 * declaration.
 *
 * A rule is a promise: "a save of this schema may omit this field, and here is
 * what the absence reads as." Anything not in this table is not tolerated, and
 * must fail before the payload becomes live state. A rule that is added without
 * a stated reason, or whose absorber stops existing, is the table going stale,
 * which the validation unit asserts directly.
 *
 * The `absorber` field is the part that keeps this honest. Several of these
 * omissions are not "migrated" anywhere in particular — the restore path simply
 * assigns whatever the payload contains and the absence is absorbed later by
 * code that already handles it. Recording *what* absorbs each omission is what
 * distinguishes a named rule from a hope.
 * ------------------------------------------------------------------ */

/** Schema versions a universe checkpoint may declare. */
export type CheckpointSchemaVersion = "0.1" | "0.2" | "0.3";

/**
 * What actually absorbs a tolerated omission today.
 *
 * - `live-step-guard` — the restore path applies nothing; a `|| default` in
 *   code that already runs per step reads the absence as that value. These live
 *   inside the biological step and are not this tranche's to move.
 * - `nullable-field` — the field's own type admits the absence, so no runtime
 *   default is involved at all.
 * - `constructor-default` — a freshly constructed value keeps its own
 *   initializer because the stored payload never overwrites the key.
 * - `inline-backfill` — restore writes the missing field explicitly, for a
 *   named older schema.
 * - `structural-branch` — an older schema takes a branch that sets the defaults
 *   directly rather than reading them.
 */
export type MigrationAbsorber =
  | "live-step-guard"
  | "nullable-field"
  | "constructor-default"
  | "inline-backfill"
  | "structural-branch";

export interface CheckpointMigrationRule {
  /** Stable identifier. Tests reference this, so renaming one is a real change. */
  readonly id: string;
  /** Where the field actually lives in the payload, not its contract name. */
  readonly path: string;
  /** The schema versions whose saves may legitimately omit this field. */
  readonly appliesToSchemas: readonly CheckpointSchemaVersion[];
  /** What the absence reads as, stated so it can be checked. */
  readonly effectiveDefault: string;
  readonly absorber: MigrationAbsorber;
  /** Why tolerating this is correct, rather than merely convenient. */
  readonly omission: string;
}

const ALL_SCHEMAS: readonly CheckpointSchemaVersion[] = ["0.1", "0.2", "0.3"];

export const CHECKPOINT_MIGRATION_RULES: readonly CheckpointMigrationRule[] = [
  // --- The three omissions Decision 2 names explicitly ---------------------
  {
    id: "organism-pc-reads-as-zero",
    path: "experiment.state.props.o[].pc",
    appliesToSchemas: ALL_SCHEMAS,
    effectiveDefault: "0",
    absorber: "live-step-guard",
    omission:
      "Cumulative produced-C per organism. Saves written before the counter existed leave it absent, and the per-step production and aggregation reads already treat an absent counter as zero rather than producing NaN.",
  },
  {
    id: "simulation-last-lineage-flows-reads-as-null",
    path: "experiment.state.props.lastLineageFlows",
    appliesToSchemas: ALL_SCHEMAS,
    effectiveDefault: "null",
    absorber: "nullable-field",
    omission:
      "Per-lineage interval flow facts. The field is declared `IntervalFlowFacts | null` and initialised to null, so an absent value is already a legal state of the field rather than a missing one. The next observation stride replaces it before anything reads it as evidence.",
  },
  {
    id: "simulation-lineage-interval-reads-as-empty-map",
    path: "experiment.state.props.lineageInterval",
    appliesToSchemas: ALL_SCHEMAS,
    effectiveDefault: "an empty Map",
    absorber: "live-step-guard",
    omission:
      "Accumulated within-stride lineage deltas. Reading it for interval attribution already tolerates absence, and an empty map is the correct meaning: no delta accumulated yet, not a lost one.",
  },
  // --- Decision-record backfills, found by enumerating the restore path ----
  {
    id: "pending-decision-absent-reads-as-null",
    path: "decisions.pending",
    appliesToSchemas: ALL_SCHEMAS,
    effectiveDefault: "null",
    absorber: "inline-backfill",
    omission:
      "A save taken with no decision outstanding has no pending gate. Absent and explicitly-null are the same state, and a non-object value here cannot be a gate.",
  },
  {
    id: "pending-decision-source-backfilled-from-event",
    path: "decisions.pending.source",
    appliesToSchemas: ["0.1", "0.2"],
    effectiveDefault: '"observed_event" when a string sourceEventId is present',
    absorber: "inline-backfill",
    omission:
      "Saves predating the catalyst source have no `source`, but a `sourceEventId` can only have come from an observed event, so the backfill is forced by the data rather than guessed from it.",
  },
  {
    id: "decision-resolutions-absent-reads-as-empty",
    path: "decisions.resolutions",
    appliesToSchemas: ALL_SCHEMAS,
    effectiveDefault: "[]",
    absorber: "inline-backfill",
    omission:
      "No decisions were resolved before the save. A non-array value is not a resolution list, so an empty list is the only coherent reading.",
  },
  {
    id: "decision-resolution-offer-tick-backfilled-from-tick",
    path: "decisions.resolutions[].offerTick",
    appliesToSchemas: ["0.1", "0.2"],
    effectiveDefault: "the resolution's own tick",
    absorber: "inline-backfill",
    omission:
      "0.2 records predate the field. The resolution tick is the best available estimate of when the offer happened, and it is an estimate rather than an invention.",
  },
  {
    id: "decision-resolution-catalyst-id-reads-as-null",
    path: "decisions.resolutions[].catalystId",
    appliesToSchemas: ["0.1", "0.2"],
    effectiveDefault: "null",
    absorber: "inline-backfill",
    omission:
      "No 0.2 resolution came from a catalyst window, because catalyst decisions did not exist then. Null states that fact rather than implying a catalyst was involved.",
  },
  {
    id: "decision-resolution-source-reads-as-event-decision",
    path: "decisions.resolutions[].source",
    appliesToSchemas: ["0.1", "0.2"],
    effectiveDefault: '"event_decision"',
    absorber: "inline-backfill",
    omission:
      "Before the source field existed, every resolution was an event decision. Naming it is a restatement of the era, not a classification of the record.",
  },
  {
    id: "last-decision-tick-absent-reads-as-zero",
    path: "decisions.lastDecisionTick",
    appliesToSchemas: ALL_SCHEMAS,
    effectiveDefault: "0",
    absorber: "inline-backfill",
    omission:
      "A save with no recorded decision tick means no decision has been made, and tick 0 is before the world began.",
  },
  {
    id: "last-major-catalyst-tick-absent-reads-as-null",
    path: "decisions.lastMajorCatalystTick",
    appliesToSchemas: ALL_SCHEMAS,
    effectiveDefault: "null",
    absorber: "inline-backfill",
    omission:
      "Distinct from the rule above on purpose: 'never a major catalyst' and 'happened at tick 0' are different facts, and only null says the first.",
  },
  {
    id: "matched-control-absent-reads-as-null",
    path: "control / controlAnalysis",
    appliesToSchemas: ALL_SCHEMAS,
    effectiveDefault: "null",
    absorber: "inline-backfill",
    omission:
      "A matched twin is created by the first intervention. No twin existing is a normal state, not a missing one.",
  },
  {
    id: "analysis-substate-absent-reads-as-constructor-default",
    path: "analysis.{crossfeeding,seed_bank,era,cuse_guild,niche_construction,records,eras}",
    appliesToSchemas: ALL_SCHEMAS,
    effectiveDefault: "the freshly constructed observer's own initial state",
    absorber: "constructor-default",
    omission:
      "Restore constructs a fresh observer and then overwrites only the keys the payload carries, so an absent sub-state keeps its declared initial value instead of becoming undefined.",
  },
];

export const MIGRATION_RULE_BY_ID: ReadonlyMap<string, CheckpointMigrationRule> = new Map(
  CHECKPOINT_MIGRATION_RULES.map((rule) => [rule.id, rule]),
);

/* ------------------------------------------------------------------ *
 * Cross-boundary read models.
 *
 * These declarations describe what sim-core and sim-analysis already
 * produce. They introduce no new data, no new measurement, and no new
 * meaning: they replace `unknown`/`any` at the surfaces presentation
 * reads, so the History and Tree read models can be read without a cast.
 *
 * Authority is unchanged by declaring them here. sim-core still produces
 * metrics and sim-analysis still produces records; neither is edited to
 * satisfy a type. What changes is that a consumer outside
 * `packages/contracts` no longer has to assert what the producer already
 * guarantees, and a producer that stops guaranteeing it becomes a
 * compile error instead of a silent `any`.
 * ------------------------------------------------------------------ */

/**
 * Lifecycle of a durable ecological detector (crossfeeding, dormancy, the
 * C-using guild, niche construction). These are the detector's own
 * vocabulary for what it has observed so far — not biological states of
 * any organism, and not a claim about cause.
 */
export type EcologicalArcState =
  | "absent"
  | "forming"
  | "established"
  | "disrupted"
  | "recovered"
  | "superseded";

export interface CrossfeedingState {
  readonly id: string;
  readonly state: EcologicalArcState;
  readonly candidateSince: number | null;
  readonly lowSince: number | null;
}

export interface SeedBankState {
  readonly id: string;
  readonly state: EcologicalArcState;
  readonly candidateSince: number | null;
  readonly lowSince: number | null;
  readonly establishedTick: number | null;
  readonly lastReturnTick: number | null;
  readonly priorDormantClades: Readonly<Record<string, number>>;
  readonly returnedClades: Readonly<Record<string, number>>;
}

export interface CuseGuildState {
  readonly id: string;
  readonly state: EcologicalArcState;
  readonly candidateSince: number | null;
  readonly lowSince: number | null;
  readonly establishedTick: number | null;
  /** Scavenger share at establishment: the collapse tripwire's reference. */
  readonly estScav: number;
  /** Interval C production at establishment: recorded context, never a tripwire. */
  readonly baselineProduced: number;
  readonly topConsumer: number | null;
  readonly topConsumerShare: number;
}

export interface NicheConstructionState {
  readonly id: string;
  readonly state: EcologicalArcState;
  readonly candidateSince: number | null;
  readonly shiftSince: number | null;
  readonly lowSince: number | null;
  readonly establishedTick: number | null;
  /** Measured baseline captured at first crossing; the strategy-shift reference. */
  readonly baseWaste: number;
  readonly baseTol: number;
  readonly baseCu: number;
  readonly baseExposed: number;
  readonly estWaste: number;
  readonly estExposed: number;
  readonly wasDisrupted: boolean;
}

/**
 * One observed ecological frame, retained verbatim by every durable record.
 *
 * Declared here rather than in sim-analysis because it crosses the
 * boundary inside record evidence: it is part of the read model that
 * presentation receives, not an implementation detail of the observer.
 * sim-analysis is its only producer.
 */
export interface ObservationFrame {
  readonly tick: number;
  readonly population: number;
  readonly starting_population: number;
  readonly active_population: number;
  readonly dormant_population: number;
  readonly dormant_fraction: number;
  readonly c_energy_share: number;
  readonly crossfeeder_fraction: number;
  readonly partitioned: boolean;
  readonly dominant_role: string;
  readonly roles: Readonly<Record<string, number>>;
  readonly wake_events: number;
  readonly wake_clades: Readonly<Record<string, number>>;
  readonly dormant_clade_fraction: Readonly<Record<string, number>>;
  readonly clade_totals: Readonly<Record<string, number>>;
  /** Deterministic per-lineage flow facts at this tick (analysis reads, never writes). */
  readonly flows: FlowFacts;
  /** Per-stride biological interval rates ending at this tick. */
  readonly interval: IntervalRates;
  /** Per-lineage interval activity, dead included. Read-only. */
  readonly intervalFlows: IntervalFlowFacts;
  /** Waste field share of capacity (0..1): persistent modification signal. */
  readonly waste_fraction: number;
  /** Share of living organisms in burden-relevant cells (fraction >= half-max). */
  readonly waste_exposed_share: number;
  /** Population mean inherited tolerance / cleanup (strategy bundle). */
  readonly tolerance_mean: number;
  readonly cleanup_mean: number;
}

/**
 * The measured baseline block a niche-construction record carries
 * alongside its observed frame, so a reader can see the before/after pair
 * the summary cites. Attached beside the frame, never merged into it.
 */
export interface NicheBaselineEvidence {
  readonly base_waste: number;
  readonly base_exposed_share: number;
  readonly base_tolerance_mean: number;
  readonly base_cleanup_mean: number;
  readonly established_waste: number;
  readonly established_exposed_share: number;
  readonly strategy_persistence_ticks: number;
}

/**
 * Evidence retained on a durable history record: the observed frame, plus
 * the niche baseline block where that record kind produces one. The block
 * is partial because it is optional per record kind, not because a value
 * may be absent within it.
 */
export type HistoryEvidence = ObservationFrame & Partial<NicheBaselineEvidence>;

/**
 * A durable ecological history record — the History read model.
 *
 * Field names are snake_case because they are the retained on-the-wire
 * shape the product and its history consumers already read; they are not
 * renamed here. `entity_refs` carries what each reference denotes, so a
 * consumer never has to infer a namespace from a bare number. A reference
 * whose `kind` is null is a real entity of unrecorded kind: omit it rather
 * than guess.
 */
export interface HistoryRecord {
  /** Durable record identity: `<arc id>-<phase>-<tick>`. */
  readonly id: HistoryRecordId;
  /** Persistent story/event family identity this record belongs to. */
  readonly arc_id: ArcId;
  readonly kind: string;
  readonly tick: number;
  readonly phase: string;
  readonly title: string;
  readonly summary: string;
  readonly level: string;
  readonly evidence: HistoryEvidence;
  readonly entity_refs: readonly EntityRef[];
}

/** A durable ecological era boundary — the era read model. */
export interface Era {
  readonly id: string;
  readonly kind: string;
  readonly start_tick: number;
  /** Durable community-state signature this era begins. */
  readonly signature: string;
  /** Signature in force before this era, or null at the first recorded era. */
  readonly previous_signature: string | null;
  readonly evidence: ObservationFrame;
}

export interface AnalysisState {
  readonly crossfeeding: CrossfeedingState;
  readonly seed_bank: SeedBankState;
  readonly cuse_guild: CuseGuildState;
  readonly niche_construction: NicheConstructionState;
  readonly eras: readonly Era[];
  readonly records: readonly HistoryRecord[];
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
  readonly eventId: EventId;
  /** Persistent story/event family identity. */
  readonly arcId: ArcId;
  readonly kind: string;
  readonly phase: string;
  readonly tick: number;
  readonly level: string;
  readonly title: string;
  readonly summary: string;
  readonly evidence: Readonly<Record<string, number | string | boolean>>;
  /** Entities this event is about, each tagged with what it denotes. A ref
   *  whose kind is null must not be rendered into either namespace. */
  readonly entityRefs: readonly EntityRef[];
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
  readonly opportunityId: DecisionOpportunityId;
  /** So a restored opportunity stays interpretable after the catalog evolves. */
  readonly policyVersion: string;
  readonly source: "observed_event";
  readonly sourceEventId: EventId;
  readonly sourceArcId: ArcId | null;
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
  readonly commandId: DecisionCommandId;
  /** Tick at resolution/application. Resolution never advances the world. */
  readonly tick: number;
  /** Tick the opportunity was offered. Preserved so History and evidence can
   *  order offer before resolution without re-derivation. */
  readonly offerTick: number;
  readonly opportunityId: DecisionOpportunityId;
  /** Null for world-catalyst decisions: never a fabricated event id. */
  readonly sourceEventId: EventId | null;
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
  readonly opportunityId: DecisionOpportunityId;
  readonly commandId: DecisionCommandId;
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
  /** Retained state from immediately BEFORE the effect was applied. */
  readonly baseline: AftermathBaseline;
  /** Retained state from immediately AFTER the effect was applied, same tick.
   *  Both sides are retained rather than one side being read live, because
   *  playback resumes automatically after resolution (AC22) and a live "Now"
   *  would move while the player reads the comparison (AC23). Difference is
   *  therefore exactly the mechanical effect, measured across one tick. */
  readonly resolved: AftermathBaseline;
}

/** Presentation states of an aftermath. "impact" is entered at resolution and
 *  is the only phase that requires the world to be paused. */
export type AftermathPhase = "impact" | "observation" | "development" | "settlement";

/* ------------------------------------------------------------------ *
 * M3 world catalysts: quiet-period environmental intervention windows.
 *
 * A catalyst window is NOT an observed biological event and must never be
 * represented as one. It shares the pause gate, resolution validation, and
 * persistence machinery with event decisions, but carries explicit
 * world-catalyst provenance end to end.
 * ------------------------------------------------------------------ */

/** Stable catalyst identifiers, M3 v1 catalog. */
export type CatalystId = "drought-a" | "drought-b" | "global-crash" | "c-washout";

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
  /** Share of realized cumulative resource energy from Metabolite C (0..1).
   *  Exposed so a C-targeting catalyst can be judged by the same kind of
   *  read-only context the A and B catalysts use, rather than by a rule invented
   *  for it. Derived from the same realized energy totals as energyShareA/B. */
  readonly energyShareC: number;
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
  readonly opportunityId: DecisionOpportunityId;
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
  readonly id: OrganismId;
  readonly parent: OrganismId | null;
  readonly generation: number;
  readonly lineageId: LineageId;
  readonly cladeId: CladeId;
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

/**
 * An analytical clade — the deepest established mutation branch meeting the
 * clade definition, or founder ancestry as the documented fallback.
 *
 * This is a clade identity, not a lineage one: `root_lineage` names the
 * lineage the clade roots at, but the clade is the unit analysis groups and
 * presentation labels. A clade and its root lineage are deliberately
 * separate properties so neither can be substituted for the other.
 */
export interface Clade {
  readonly id: CladeId;
  readonly root_lineage: LineageId;
  readonly founder_family: number;
  readonly born: number;
  readonly mutations: readonly string[];
  readonly established: boolean;
  readonly peak: number;
  readonly count: number;
  readonly share: number;
  readonly age: number;
}

/** Clade census for the current tick — the Tree read model. */
export interface CladeMetrics {
  readonly active: number;
  readonly effective: number;
  /** Clades ranked by living count, most numerous first. */
  readonly top: readonly Clade[];
  readonly dominant: Clade | null;
  /** The definition in force, so a reader can see what qualifies as a clade. */
  readonly definition: string;
}

/**
 * The engine metrics the cross-boundary read model exposes.
 *
 * This is deliberately the subset presentation reads, not the engine's
 * whole metrics object: the read model is a contract, and a contract that
 * silently mirrored every internal metric would carry no information.
 * Reading a field outside this list is a contract change, which is the
 * point — an unlisted field should fail to compile rather than resolve to
 * `any` at runtime. Engine metrics remain fully available inside
 * sim-core and to evidence exports, which are a separate contract.
 */
export interface RenderMetrics {
  readonly population: number;
  readonly peak_population: number;
  readonly effective_niches: number;
  readonly ecological_outcome: string;
  readonly clades: CladeMetrics;
  readonly metabolite_c: { readonly fraction: number };
  readonly metabolic_roles: { readonly crossfeeder_fraction: number };
  /** Absolute nutrient accountancy residual, per nutrient. */
  readonly nutrient_field: {
    readonly accounting: { readonly absolute_residual: readonly number[] };
  };
}

export interface RenderSnapshot {
  readonly tick: number;
  /** Presentation-only identity of this displayed universe instance. Unique
   *  per create/restore, and NOT biological state: it is not stored in
   *  checkpoints and does not affect replay. The renderer uses it to scope
   *  presentation-only state, because two universes can share a seed and a
   *  resolved config. */
  readonly worldId: WorldId;
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
  readonly metrics: RenderMetrics;
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
  readonly control: {
    readonly tick: number;
    readonly population: number;
    readonly metrics: RenderMetrics;
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
      readonly opportunityId: DecisionOpportunityId;
      readonly choiceId: string;
      readonly requestId?: string;
    }
  | { readonly type: "ACKNOWLEDGE_AFTERMATH"; readonly requestId?: string }
  | { readonly type: "LOAD_CHECKPOINT"; readonly checkpoint: SupportedUniverseCheckpoint }
  | { readonly type: "REQUEST_CHECKPOINT"; readonly requestId: string }
  | { readonly type: "REQUEST_EXPORT"; readonly requestId: string };

export type RuntimeResponse =
  | { readonly type: "SNAPSHOT"; readonly snapshot: RenderSnapshot }
  | { readonly type: "CHECKPOINT"; readonly requestId: string; readonly checkpoint: UniverseCheckpoint }
  | { readonly type: "EXPORT"; readonly requestId: string; readonly data: unknown }
  | { readonly type: "DECISION_RESOLVED"; readonly requestId: string; readonly snapshot: RenderSnapshot }
  /** Acknowledgement reply for ACKNOWLEDGE_AFTERMATH. Distinct from a bare
   *  SNAPSHOT so the awaiting caller can settle: a snapshot alone only notifies
   *  subscribers and would leave the request pending forever. */
  | { readonly type: "AFTERMATH_ACKNOWLEDGED"; readonly requestId: string; readonly snapshot: RenderSnapshot }
  | { readonly type: "ERROR"; readonly message: string; readonly requestId?: string };
