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
export type CheckpointSchemaVersion = "0.1" | "0.2" | "0.3" | "0.4";

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

/**
 * What a tolerated omission can affect, and therefore whether absence is a
 * safe default for it.
 *
 * - `inert` — written but never read for a decision. Any default is harmless.
 * - `load-bearing-display` — load-bearing for what the player is told, not for
 *   what the world does. A default must not assert something untrue.
 * - `load-bearing-dynamics` — the field gates whether the simulation may act.
 *   Absence is **not** a safe default here: it must either be refused, or
 *   defaulted to the value that preserves prior behaviour rather than the one
 *   that looks neutral.
 *
 * A classification is a snapshot of the code at one commit, not a durable
 * property. `lastDecisionTick` is the cautionary case: inert today because
 * nothing reads it, and dangerous the moment something does — which is why a
 * `load-bearing-dynamics` rule is a finding to re-derive, and why an inert one needs a
 * test that fails if a reader appears.
 */
export type MigrationHazard = "inert" | "load-bearing-display" | "load-bearing-dynamics";

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
  /**
   * What this rule explicitly does **not** tolerate, when it is only half a
   * rule. Decision 2's asymmetry: a field may be legitimately absent in an
   * older schema while a wrong-typed value for that same field is corrupt in
   * every schema. Recording the rejected case here is what stops the
   * absence-tolerance from being read as blanket tolerance — the rejection
   * itself is implemented by the validator, not by this table.
   */
  readonly rejects?: string;
  /**
   * Concrete evidence that a *supported build* could have written this shape:
   * the change that introduced the field, and the schema version in force at
   * that moment. Required on every rule.
   *
   * This is deliberately not "the restore code currently tolerates it". Code
   * that happens to cope is not a compatibility promise, and inferring one from
   * it is how a rule table starts describing the present instead of the past.
   * A rule that cannot name its basis does not belong here — that standard is
   * what removed `matched-control-absent-reads-as-null`, whose fields have been
   * written by every save since the initial import and so were never absent in
   * any supported build.
   */
  readonly historicalBasis: string;
  /** What a tolerated omission can affect. Required on every rule. */
  readonly hazard: MigrationHazard;
  /**
   * For a `load-bearing-dynamics` rule: why its default is safe anyway, because
   * absence here is meaningful rather than merely unhandled. Required on every
   * `load-bearing-dynamics` rule and forbidden on the other kinds, so the
   * justification cannot be quietly omitted.
   */
  readonly dynamicsJustification?: string;
}

/**
 * Every version except the current one. A 0.4 save is written by the build that
 * requires these fields, so it may not omit them — that is the whole point of
 * the split. A rule here describes what an *older* supported build could have
 * written, which is a claim about history and has to be evidenced, not a claim
 * about what the current build tolerates.
 */
const PRE_CURRENT_SCHEMAS: readonly CheckpointSchemaVersion[] = ["0.1", "0.2", "0.3"];

export const CHECKPOINT_MIGRATION_RULES: readonly CheckpointMigrationRule[] = [
  // --- The three omissions Decision 2 names explicitly ---------------------
  {
    id: "organism-pc-reads-as-zero",
    path: "experiment.state.props.o[].pc",
    appliesToSchemas: PRE_CURRENT_SCHEMAS,
    effectiveDefault: "0",
    absorber: "live-step-guard",
    omission:
      "Cumulative produced-C per organism. Saves written before the counter existed leave it absent, and the per-step production and aggregation reads already treat an absent counter as zero rather than producing NaN.",
    hazard: "load-bearing-display",
    historicalBasis:
      "`Organism.pc` was added in f6bfbe7 on 2026-09-25 (Issue #30 Phase B1), which is after the 0.3 bump in b040b19 on 2026-09-24. A 0.3 save written between those two dates carries organisms with no `pc` at all.",
  },
  {
    id: "simulation-last-lineage-flows-reads-as-null",
    path: "experiment.state.props.lastLineageFlows",
    appliesToSchemas: PRE_CURRENT_SCHEMAS,
    effectiveDefault: "null",
    absorber: "nullable-field",
    omission:
      "Per-lineage interval flow facts. The field is declared `IntervalFlowFacts | null` and initialised to null, so an absent value is already a legal state of the field rather than a missing one. The next observation stride replaces it before anything reads it as evidence.",
    hazard: "load-bearing-display",
    historicalBasis:
      "`lastLineageFlows` was declared and first assigned in 4da996c on 2026-09-25 (Issue #30 Stage 2.2), after the 0.3 bump. A 0.3 save from before that has no `lastLineageFlows` key.",
  },
  {
    id: "organism-waste-tolerance-reads-as-zero",
    path: "experiment.state.props.o[].to",
    appliesToSchemas: PRE_CURRENT_SCHEMAS,
    effectiveDefault: "0",
    absorber: "live-step-guard",
    omission:
      "Inherited waste tolerance. Saves written before the waste economy existed carry no tolerance, and the biological step already reads an absent trait as 0. A founder from that era genuinely had no tolerance trait: the trait was not heritable yet, so 0 states the truth about that world rather than granting a cleanup capability it did not have.",
    hazard: "load-bearing-dynamics",
    dynamicsJustification:
      "The field is physiology the step acts on, so a default here is not a display convenience. Zero tolerance means full exposure burden and no tolerance saving, which is what a pre-waste-trait organism faced; it withholds the waste-economy advantage rather than granting it. The guard is inside the biological step and is left untouched by design.",
    historicalBasis:
      "`to` and `cu` were added in af9ad23 on 2026-09-26 (Issue #30 Slice 2), after the 0.3 bump in b040b19. The founder constructor at d86ddfe, b39fd46 and b040b19 writes no `to` at all, so a 0.3 save from before that change carries organisms with no tolerance.",
  },
  {
    id: "organism-waste-cleanup-reads-as-zero",
    path: "experiment.state.props.o[].cu",
    appliesToSchemas: PRE_CURRENT_SCHEMAS,
    effectiveDefault: "0",
    absorber: "live-step-guard",
    omission:
      "Inherited cleanup capability. Same introduction and same reading as the tolerance rule: the cleanup process derives its access from `cu`, and an absent trait reads as 0 — the organism cannot perform the cleanup it had no trait for. The two rules are separate because the fields arrived and are read independently; a save may legitimately carry one and not the other if a build wrote them unevenly.",
    hazard: "load-bearing-dynamics",
    dynamicsJustification:
      "Zero cleanup capability withholds a process the simulation could otherwise execute, so the default removes an available action rather than enabling one. The live-step guard `Q(o.cu||0,0,1.5)/1.5` is the named absorber and lives inside the biological step.",
    historicalBasis:
      "`cu` was added in af9ad23 on 2026-09-26 alongside `to`, after the 0.3 bump. The founder constructors at d86ddfe, b39fd46 and b040b19 write no `cu`.",
  },
  {
    id: "simulation-lineage-interval-reads-as-empty-map",
    path: "experiment.state.props.lineageInterval",
    appliesToSchemas: PRE_CURRENT_SCHEMAS,
    effectiveDefault: "an empty Map",
    absorber: "live-step-guard",
    omission:
      "Accumulated within-stride lineage deltas. Reading it for interval attribution already tolerates absence, and an empty map is the correct meaning: no delta accumulated yet, not a lost one.",
    hazard: "load-bearing-display",
    historicalBasis:
      "`lineageInterval` arrived in the same change, 4da996c on 2026-09-25. The build that introduced it initialises the map empty, so an earlier save simply lacks the key and empty is what the code already treats it as.",
  },
  // --- Decision-record backfills, found by enumerating the restore path ----
  {
    id: "last-decision-tick-reconstructed-from-newest-record",
    path: "decisions.lastDecisionTick",
    appliesToSchemas: ["0.2"],
    effectiveDefault: "the newest created/offer/decision tick present in the save's own pending decision or resolutions, or 0 when it holds none",
    absorber: "structural-branch",
    omission:
      "A 0.2 save does not carry this pacing field. Restore reconstructs it from the newest timestamp the save holds — the pending decision's `createdTick`, or any resolution's `tick` or `offerTick`. A 0.3 save does carry the field and must preserve its value, not reconstruct it.",
    hazard: "load-bearing-dynamics",
    dynamicsJustification:
      "The field gates decision pacing, so a default here is not a display convenience. For 0.2 it is reconstructed from the latest timestamp in that save's own decision records, and is 0 only when it records no decision at all. A 0.3 save instead carries the actual field value, which restore must preserve even if it differs from the derived estimate.",
    historicalBasis:
      "`lastDecisionTick` arrived with checkpoint 0.3 in b040b19 on 2026-09-24; its decision checkpoint explicitly writes the field and its restore preserved it. The 0.2 checkpoint at b39fd46 writes only `pending`, `resolutions` and `policyVersion`, so reconstruction is needed only for 0.2. A 0.1 save at d86ddfe predates the entire decision system and is described separately as non-historical running-build state, not as an omission of this field.",
  },
  {
    id: "major-catalyst-tick-predates-cooldown",
    path: "decisions.lastMajorCatalystTick",
    appliesToSchemas: ["0.2"],
    effectiveDefault: "null",
    absorber: "structural-branch",
    omission:
      "The major-catalyst cooldown did not exist in checkpoint 0.2, so its decisions object carries no value for this field. `null` is the truth about that world: no major catalyst had ever fired. The 0.1 save had no decisions object at all and is documented separately.",
    hazard: "load-bearing-dynamics",
    historicalBasis:
      "`lastMajorCatalystTick` was introduced with checkpoint 0.3 in b040b19 on 2026-09-24, alongside the cooldown. The 0.2 decision checkpoint at b39fd46 writes only `pending`, `resolutions` and `policyVersion`. Checkpoint 0.1 predates the entire decisions container; checkpoint 0.3 wrote this field and must preserve it.",
    dynamicsJustification:
      "This rule gates the world, so the default must preserve prior behaviour rather than merely look neutral. `null` means \"no major catalyst has ever fired\" and therefore reads as cooldown-clear, which is correct for a world from before the mechanic existed. The default is safe because it is historically true, not because absence is presumed harmless. A *present* value is validated, never defaulted, so a corrupt one is refused rather than cleared into a permission.",
  },
  {
    id: "pending-decision-source-backfilled-from-event",
    path: "decisions.pending.source",
    appliesToSchemas: ["0.2"],
    effectiveDefault: '"observed_event" when a string sourceEventId is present',
    absorber: "inline-backfill",
    omission:
      "Saves predating the catalyst source have no `source`, but a `sourceEventId` can only have come from an observed event, so the backfill is forced by the data rather than guessed from it.",
    hazard: "load-bearing-display",
    historicalBasis:
      "`source` was introduced together with checkpoint 0.3 in b040b19 on 2026-09-24. A 0.2 save holds a pending decision carrying `sourceEventId` and no `source`, which is the case this backfill exists for.",
  },
  {
    id: "decision-resolution-offer-tick-backfilled-from-tick",
    path: "decisions.resolutions[].offerTick",
    appliesToSchemas: ["0.2"],
    effectiveDefault: "the resolution's own tick",
    absorber: "inline-backfill",
    omission:
      "0.2 records predate the field. The resolution tick is the best available estimate of when the offer happened, and it is an estimate rather than an invention.",
    hazard: "load-bearing-display",
    historicalBasis:
      "`offerTick` was introduced with 0.3 in b040b19. A 0.2 resolution carries `tick` and no `offerTick`.",
  },
  {
    id: "decision-resolution-catalyst-id-reads-as-null",
    path: "decisions.resolutions[].catalystId",
    appliesToSchemas: ["0.2"],
    effectiveDefault: "null",
    absorber: "inline-backfill",
    omission:
      "No 0.2 resolution came from a catalyst window, because catalyst decisions did not exist then. Null states that fact rather than implying a catalyst was involved.",
    hazard: "load-bearing-display",
    historicalBasis:
      "`catalystId` was introduced with 0.3 in b040b19, alongside the catalyst source it names. Catalyst decisions did not exist before it, so no 0.2 resolution can carry one.",
  },
  {
    id: "pending-observation-not-recorded-in-02",
    path: "decisions.pending.contextSnapshot",
    appliesToSchemas: ["0.2"],
    effectiveDefault: "null (observation context not recorded)",
    absorber: "inline-backfill",
    omission: "The 0.2 pending opportunity kept its prompt, choices and source event but not the policy's bounded observation context. Null records the absence of evidence rather than inventing a population or ecological measure.",
    rejects: "A present non-object/non-null context is invalid even for a 0.2 save; historical absence does not authorize an invalid supplied context.",
    hazard: "load-bearing-display",
    historicalBasis: "The pending DecisionOpportunity in b39fd46 (0.2) lists no contextSnapshot; b040b19 (0.3) adds the bounded observation as a persisted required field.",
  },
  {
    id: "resolution-choice-title-not-recorded-in-02",
    path: "decisions.resolutions[].choiceTitle",
    appliesToSchemas: ["0.2"],
    effectiveDefault: "Not recorded in this save",
    absorber: "inline-backfill",
    omission: "The 0.2 resolution records the choice ID, not the offered title. The title cannot be recovered from a changed catalog; an explicit unrecorded label avoids asserting a choice wording the save never kept.",
    hazard: "load-bearing-display",
    historicalBasis: "b39fd46's 0.2 DecisionResolution and resolution writer omit choiceTitle; b040b19's 0.3 DecisionResolution and writer include it.",
  },
  {
    id: "resolution-direct-effect-not-recorded-in-02",
    path: "decisions.resolutions[].directEffectDescription",
    appliesToSchemas: ["0.2"],
    effectiveDefault: "Not recorded in this save",
    absorber: "inline-backfill",
    omission: "The 0.2 resolution kept the selected intervention but not the direct-effect wording shown when offered. A catalog lookup could substitute later wording, so the saved history says only that the wording was not recorded.",
    hazard: "load-bearing-display",
    historicalBasis: "b39fd46's 0.2 DecisionResolution and writer omit directEffectDescription; b040b19's 0.3 DecisionResolution and writer include it.",
  },
  {
    id: "analysis-cuse-guild-absent-reads-as-constructor-default",
    path: "analysis.dep",
    appliesToSchemas: PRE_CURRENT_SCHEMAS,
    effectiveDefault: "the observer's declared initial state",
    absorber: "inline-backfill",
    omission:
      "The C-use guild's dependency-arc sub-state. The canonical migration writes the observer's declared initial state for any detector key the payload omits, so an absent sub-state reads as that default rather than as whatever the constructor happened to hold. A detector that has not yet fired genuinely has no sub-state, which is different from one that fired and lost its record.",
    rejects:
      "A present non-object sub-state is not covered by this rule and is refused before `Object.assign` can write it into live observer state. This is a container check, not exhaustive validation of nested observer values.",
    hazard: "load-bearing-dynamics",
    dynamicsJustification:
      "Absence is meaningful: a detector that has not fired has no sub-state, which is the same world as one whose records were empty. Critically this default *removes* a capability rather than granting one — an observer with no dependency arcs raises no event, so the pause gate stays shut. The hazard is the opposite case and is why `rejects` exists.",
    historicalBasis:
      "`this.dep` was introduced in 3ddb287 on 2026-09-25 (Issue #30 Phase C1), after the 0.3 bump in b040b19 on 2026-09-24. The analysis checkpoint at b040b19 writes only `cross`, `seedbank`, `era`, `records` and `eras`, so a 0.3 save written before 3ddb287 carries no `dep` key at all.",
  },
  {
    id: "analysis-niche-construction-absent-reads-as-constructor-default",
    path: "analysis.niche",
    appliesToSchemas: PRE_CURRENT_SCHEMAS,
    effectiveDefault: "the observer's declared initial state",
    absorber: "inline-backfill",
    omission:
      "The niche-construction sub-state, arriving later than the C-use guild and therefore separately absent from different saves. Same absorber and same reasoning as the C-use rule: the canonical migration supplies the observer's declared initial state, and a detector that has not fired has no sub-state.",
    rejects:
      "A present non-object sub-state is refused before `Object.assign` for the same reason as the C-use guild. Nested observer values are not exhaustively validated here.",
    hazard: "load-bearing-dynamics",
    dynamicsJustification:
      "As with the C-use guild, the default withholds a capability rather than granting one: an observer with no niche sub-state raises no event, so the pause gate stays shut.",
    historicalBasis:
      "`this.niche` was introduced in af9ad23 on 2026-09-26 (Issue #30 Slice 2), the latest of the analysis sub-states. A 0.3 save written before that date carries neither `dep` nor `niche`, and one written between 3ddb287 and af9ad23 carries `dep` but not `niche`, so the two absences are genuinely independent and need separate rules.",
  },
  {
    id: "control-analysis-cuse-guild-absent",
    path: "controlAnalysis.dep",
    appliesToSchemas: PRE_CURRENT_SCHEMAS,
    effectiveDefault: "the matched observer's declared initial dep state",
    absorber: "inline-backfill",
    omission: "A fork's controlAnalysis is the analysis observer's own checkpoint, filled by the same canonical migration rather than by a separate construction. A fork made before the C-use detector existed could not write dep, just as the live observer could not.",
    rejects: "A present non-object dep in the matched observer is refused before Object.assign can write it, for the same reason as the live C-use guild.",
    hazard: "load-bearing-display",
    historicalBasis: "d86ddfe and b040b19 write controlAnalysis as the fork observer checkpoint, whose checkpoint did not write dep until 3ddb287 under schema 0.3.",
  },
  {
    id: "control-analysis-niche-construction-absent",
    path: "controlAnalysis.niche",
    appliesToSchemas: PRE_CURRENT_SCHEMAS,
    effectiveDefault: "the matched observer's declared initial niche state",
    absorber: "inline-backfill",
    omission: "A fork's controlAnalysis is the analysis observer's own checkpoint, filled by the same canonical migration rather than by a separate construction. A fork made before the niche detector existed could not write niche, independently of whether it already wrote dep.",
    rejects: "A present non-object niche in the matched observer is refused before Object.assign, for the same reason as the live niche rule.",
    hazard: "load-bearing-display",
    historicalBasis: "d86ddfe and b040b19 write controlAnalysis as the fork observer checkpoint, whose checkpoint did not write niche until af9ad23 under schema 0.3.",
  },
  // --- A3.2: the pre-A2 reference shape ------------------------------------
  {
    id: "entity-refs-bare-numbers-mean-unrecorded-kind",
    path: "analysis.records[].entity_refs[]",
    appliesToSchemas: PRE_CURRENT_SCHEMAS,
    effectiveDefault: "a ref with kind null",
    absorber: "inline-backfill",
    omission:
      "A2 made every entity reference carry what it denotes. A save written before that holds bare numbers, and a bare number is a real entity whose kind simply was not recorded — not an absent reference. Migrating to `kind: null` is what lets presentation omit the claim instead of guessing a namespace, which is the behaviour A2 specifies for an unrecorded kind. A wrong-typed or non-finite entry is not an omission and is not tolerated here; it is left untouched for the rejection conditions to fail on.",
    hazard: "load-bearing-display",
    historicalBasis:
      "A2 (afbccfc) changed the persisted reference list from bare numbers to tagged `EntityRef` objects without changing the schema version, so 0.3 names both shapes at once. This is the concrete case that forced 0.4.",
  },
];

export const MIGRATION_RULE_BY_ID: ReadonlyMap<string, CheckpointMigrationRule> = new Map(
  CHECKPOINT_MIGRATION_RULES.map((rule) => [rule.id, rule]),
);

/**
 * A3.2: migrate a pre-A2 entity reference list.
 *
 * A save written before references carried their kind holds bare numbers. Each
 * becomes `{ kind: null, id }` — a real entity of unrecorded kind, which
 * presentation omits rather than guessing a namespace for.
 *
 * **Deduplication is by value, on `(kind, id)`, never by object identity.**
 * This is the failure A2 hit: a `Set` over freshly-constructed ref objects
 * never dedups, so a lineage named by both the producer and remover lists came
 * out twice, breaking the "named once" rule while every type stayed valid and
 * only `test:niche` caught it. The key is built from the pair, so a rebuilt
 * object is recognised as the same reference.
 *
 * Entries that are neither a finite number nor a ref-shaped object are passed
 * through untouched rather than dropped. Dropping them here would silently
 * shorten a list, which is exactly the kind of quiet normalisation Decision 2
 * forbids; the rejection conditions decide what an unusable entry means.
 */
export const migrateEntityRefs = (refs: readonly unknown[]): readonly unknown[] => {
  const out: unknown[] = [];
  const seen = new Set<string>();
  for (const raw of refs) {
    if (typeof raw === "number") {
      if (!Number.isFinite(raw)) {
        out.push(raw);
        continue;
      }
      const key = JSON.stringify([null, raw]);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind: null, id: raw });
      continue;
    }
    if (raw !== null && typeof raw === "object") {
      const candidate = raw as Partial<EntityRef>;
      if (typeof candidate.id !== "number" || !Number.isFinite(candidate.id)) {
        out.push(raw);
        continue;
      }
      const kind = candidate.kind ?? null;
      const key = JSON.stringify([kind, candidate.id]);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind, id: candidate.id });
      continue;
    }
    out.push(raw);
  }
  return out;
};

/**
 * Apply {@link migrateEntityRefs} across a stored analysis payload.
 *
 * Typed `unknown` in and out on purpose: the checkpoint contract declares
 * `analysis` as unknown, and the observer's own restore is unvalidated, so this
 * boundary must narrow defensively rather than assert a shape it cannot
 * guarantee. A payload that is not the expected container shape is returned
 * unchanged, leaving the decision about it to validation rather than making it
 * here by accident.
 */
export const migrateAnalysisEntityRefs = (analysis: unknown): unknown => {
  if (analysis === null || typeof analysis !== "object") return analysis;
  const source = analysis as { records?: unknown };
  if (!Array.isArray(source.records)) return analysis;
  let changed = false;
  const records = source.records.map((record: unknown) => {
    if (record === null || typeof record !== "object") return record;
    const refs = (record as { entity_refs?: unknown }).entity_refs;
    if (!Array.isArray(refs)) return record;
    const migrated = migrateEntityRefs(refs);
    if (migrated.length === refs.length && migrated.every((r, i) => r === refs[i])) return record;
    changed = true;
    return { ...record, entity_refs: migrated };
  });
  return changed ? { ...source, records } : analysis;
};


/**
 * Running-build values canonicalisation needs, supplied by the caller.
 *
 * contracts cannot import sim-decisions for the generator versions, nor
 * sim-analysis for what an empty detector looks like, and must not reverse
 * either package direction. Ownership stays where it belongs and the values
 * cross as data.
 *
 * Every field is supplied by trusted running code, never by the payload being
 * canonicalised. A save that could influence its own migration would make
 * migration a bypass, and a saved generator version must never win over the
 * running build's — applying a retired catalog to a current world is exactly
 * what Decision 2 forbids.
 */
export interface CanonicalizationContext {
  /** Running-build event-decision catalog version. */
  readonly policyVersion: string;
  /** Running-build catalyst catalog version. */
  readonly catalystPolicyVersion: string;
  /**
   * The running build's current checkpoint schema, used for canonical metadata
   * and assertions. It is NOT a validation-mode switch: the canonical layer is
   * validated against one current contract regardless of what this says.
   */
  readonly currentSchema: CheckpointSchemaVersion;
  /**
   * The observer's declared initial detector state, owned by sim-analysis and
   * passed as values. Read-only: canonicalisation copies rather than adopts.
   */
  readonly detectorDefaults: Readonly<Record<"dep" | "niche", unknown>>;
}

/**
 * What canonicalisation produced, and what it does NOT claim.
 *
 * The shape is materialised, but every nested value is runtime-untrusted: no
 * migration rule has been checked against the current contract yet. If this
 * were typed as the canonical state, the type system would assert the very
 * conclusion the validator exists to test.
 */
export interface CanonicalRestoreCandidate {
  readonly analysis: unknown;
  readonly controlAnalysis: unknown | null;
  readonly decisions: unknown;
}

/** The marker a pre-0.3 save gets where it never stored the wording itself. */
export const NOT_RECORDED = "Not recorded in this save";

/**
 * Canonicalise the non-simulation restore layer.
 *
 * Pure: the source is never written to, the context is never written to, and
 * every returned value is freshly constructed. Idempotent, because each
 * backfill is guarded on absence rather than recomputed — a value derived
 * from another field would re-derive on a second pass and quietly change.
 *
 * `experiment` and `control` are deliberately untouched: they stay under
 * sim-core's checkpoint contract, and these types do not claim otherwise.
 */
export const canonicalizeRestoreState = (
  source: SupportedUniverseCheckpoint,
  context: CanonicalizationContext,
): CanonicalRestoreCandidate => {
  const schema = (source as { readonly checkpointSchemaVersion: CheckpointSchemaVersion }).checkpointSchemaVersion;
  const canonicalObserver = (raw: unknown): unknown => {
    // `migrateAnalysisEntityRefs` returns a non-object unchanged, and spreading
    // `null` would silently yield `{}` — a null observer becoming an empty one
    // rather than being refused. The preflight makes that unreachable through
    // restore, but this is an exported function, so it is stated here.
    if (!isPlainObject(raw)) return raw;
    // `migrateAnalysisEntityRefs` returns the SAME reference when no record
    // changed — which is the common case for an already-migrated payload. So
    // this spread is not defensive tidiness, it is what keeps canonicalisation
    // pure: without it, writing the detectors below mutates the caller's
    // payload for every late-0.3 save (tagged refs, no detector sub-state).
    const migrated = { ...(migrateAnalysisEntityRefs(raw) as Record<string, unknown>) };
    // A detector that has not fired genuinely has no sub-state. Filling it from
    // the observer's declared initial state preserves that meaning, now
    // produced explicitly rather than left to a constructor that could not be
    // named as the compatibility mechanism.
    for (const key of ["dep", "niche"] as const) {
      if (migrated[key] === undefined) {
        migrated[key] = JSON.parse(JSON.stringify(context.detectorDefaults[key]));
      }
    }
    return migrated;
  };
  const control = (source as { readonly controlAnalysis: unknown }).controlAnalysis;
  return {
    analysis: canonicalObserver(source.analysis),
    controlAnalysis: control === null || control === undefined ? null : canonicalObserver(control),
    decisions: canonicalDecisions(schema, (source as { readonly decisions?: unknown }).decisions, context),
  };
};

const canonicalDecisions = (
  schema: CheckpointSchemaVersion,
  raw: unknown,
  context: CanonicalizationContext,
): DecisionCheckpoint => {
  const source = (isPlainObject(raw) ? raw : {}) as Record<string, unknown>;
  const historical = schema === "0.2";
  const pending = historical ? historicalPending(source.pending) : normalizePendingDecision(source.pending);
  const resolutions = Array.isArray(source.resolutions)
    ? (source.resolutions as unknown[]).map(historical ? historicalResolution : normalizeResolution)
    : [];
  // A 0.3 save carries its own pacing state and keeps it; a 0.2 save predates the
  // pacing fields and reconstructs the tick from its own records, with no
  // cooldown to reconstruct because the mechanic did not exist; 0.1 predates
  // the decision system and therefore has no history to read at all.
  //
  // `context.currentSchema` is deliberately NOT consulted for VALIDATION here.
  // It identifies the running contract for metadata and diagnostics; the
  // source-version differences were already consumed by the A3.3 preflight, and
  // branching on it to choose what to accept would be the validation-mode
  // switch the design forbids. The running schema is read from the single
  // derived declaration instead, so a version bump moves one place.
  const lastDecisionTick = isCurrentSchema(schema) || schema === "0.3"
    ? finiteOrZero(source.lastDecisionTick)
    : schema === "0.2"
      ? newestKnownDecisionTick(pending, resolutions)
      : 0;
  const lastMajorCatalystTick = isCurrentSchema(schema) || schema === "0.3"
    ? nullableTick(source.lastMajorCatalystTick)
    : null;
  return {
    pending,
    resolutions,
    // Always the running build's: a saved version identifies the generator that
    // produced that record, not the one that should offer future decisions.
    policyVersion: context.policyVersion,
    catalystPolicyVersion: context.catalystPolicyVersion,
    lastDecisionTick,
    lastMajorCatalystTick,
  };
};

const finiteOrZero = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const nullableTick = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/**
 * A canonical restore representation that has satisfied the CURRENT
 * non-simulation restore contract.
 *
 * Only {@link validateCanonicalRestoreState} can produce this type. It is
 * deliberately narrower than a checkpoint: the encoded simulation was not
 * canonicalised here and is not represented at all.
 */
export interface ValidatedCanonicalRestoreState {
  readonly analysis: unknown;
  readonly controlAnalysis: unknown | null;
  readonly decisions: DecisionCheckpoint;
}

/**
 * Narrowing boundary: returns the validated state, or throws.
 *
 * Returning rather than asserting matters. A caller cannot skip the check by
 * ignoring a return value, and `restore` cannot consume a
 * {@link CanonicalRestoreCandidate} where this type is required.
 *
 * `context` supplies the running schema so this package never names a version
 * literal, and it is used for that purpose ONLY. It selects no validation
 * shape: the canonical layer is checked against one current contract whatever
 * the source payload declared, because the A3.3 preflight already consumed
 * every source-version difference.
 */
export const validateCanonicalRestoreState = (
  candidate: CanonicalRestoreCandidate,
  context: CanonicalizationContext,
): ValidatedCanonicalRestoreState => {
  if (!isPlainObject(candidate)) {
    reject("(candidate)", "malformed-container", "expected a canonical restore candidate object");
  }
  const analysis = candidate.analysis;
  if (!isPlainObject(analysis)) {
    reject("analysis", "malformed-container", "canonical analysis must be an observer checkpoint object");
  }
  validateObserverCheckpoint(analysis, "analysis", { requireDetectors: true });
  validateEntityRefs(analysis as Record<string, unknown>, "analysis", false);
  const controlAnalysis = candidate.controlAnalysis;
  if (controlAnalysis === null) {
    // A null matched control needs no observer state; the pairing rule belongs
    // to the raw payload, where a half-present pair is a source contradiction.
  } else {
    if (!isPlainObject(controlAnalysis)) {
      reject("controlAnalysis", "malformed-container", "canonical control analysis must be an observer checkpoint or null");
    }
    validateObserverCheckpoint(controlAnalysis, "controlAnalysis", { requireDetectors: true });
    validateEntityRefs(controlAnalysis as Record<string, unknown>, "controlAnalysis", false);
  }
  const decisions = candidate.decisions;
  if (!isPlainObject(decisions)) {
    reject("decisions", "malformed-container", "canonical decisions must be a decision checkpoint object");
  }
  // Bare numbers were the pre-A2 shape, and canonicalisation has already
  // migrated them by this point — so one that survives means the migration
  // did not run, which is a defect here rather than a historical allowance.
  validateDecisionRecords(decisions as Record<string, unknown>, context.currentSchema);
  return {
    analysis,
    controlAnalysis,
    decisions: decisions as unknown as DecisionCheckpoint,
  };
};

/**
 * A persisted pending decision replays exactly as stored: never re-evaluated
 * against a newer catalog, which could silently substitute choices. A pre-0.3
 * pending carries no `source`, and a `sourceEventId` can only mean an
 * observed-event decision, so it is named rather than guessed.
 */
function normalizePendingDecision(raw: unknown): PendingDecision | null {
  if (!isPlainObject(raw)) return null;
  const copy = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
  if (copy.source === "world_catalyst" || copy.source === "observed_event") return copy as unknown as PendingDecision;
  if (typeof copy.sourceEventId === "string") {
    copy.source = "observed_event";
    return copy as unknown as PendingDecision;
  }
  return null;
}

function historicalPending(raw: unknown): PendingDecision | null {
  const pending = normalizePendingDecision(raw);
  if (!pending) return null;
  const copy = { ...(pending as unknown as Record<string, unknown>) };
  // The 0.2 writer kept the prompt and choices but not the bounded observation,
  // so null records the absence of evidence rather than inventing a measure.
  if (copy.contextSnapshot === undefined) copy.contextSnapshot = null;
  return copy as unknown as PendingDecision;
}

function normalizeResolution(raw: unknown): DecisionResolution {
  const copy = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
  if (copy.offerTick === undefined) copy.offerTick = copy.tick;
  if (copy.catalystId === undefined) copy.catalystId = null;
  return copy as unknown as DecisionResolution;
}

function historicalResolution(raw: unknown): DecisionResolution {
  const copy = normalizeResolution(raw) as unknown as Record<string, unknown>;
  return {
    ...copy,
    choiceTitle: copy.choiceTitle ?? NOT_RECORDED,
    directEffectDescription: copy.directEffectDescription ?? NOT_RECORDED,
  } as unknown as DecisionResolution;
}

/** Newest decision tick a migrated checkpoint actually records, or 0 when none. */
function newestKnownDecisionTick(
  pending: PendingDecision | null,
  resolutions: readonly DecisionResolution[],
): number {
  let newest = 0;
  const created = (pending as unknown as { readonly createdTick?: unknown } | null)?.createdTick;
  if (typeof created === "number") newest = Math.max(newest, created);
  for (const record of resolutions) {
    const tick = (record as unknown as { readonly tick?: unknown } | null)?.tick;
    const offer = (record as unknown as { readonly offerTick?: unknown } | null)?.offerTick;
    if (typeof tick === "number") newest = Math.max(newest, tick);
    if (typeof offer === "number") newest = Math.max(newest, offer);
  }
  return newest;
}

/* ------------------------------------------------------------------ *
 * Checkpoint rejection.
 *
 * A source-schema preflight checks raw persisted shape before restore. Named
 * rules govern historical absence only; a present invalid value has no waiver.
 *
 * Two properties matter more than the individual checks.
 *
 * It runs **before** ref migration; a current-schema bare ref must be refused
 * rather than rewritten into an apparently valid current ref. Canonical
 * migration followed by canonical validation is the later A3.4 property.
 *
 * And it is **narrower than it looks**. Every check below corresponds to a key
 * the maintained save path actually writes. A field that is genuinely optional
 * gets no check, because inventing a requirement for it produces exactly the
 * over-broad rejection that shows up as a user's own world failing to open.
 * The current-save round trip is what proves the width; a hand-written fixture
 * cannot.
 * ------------------------------------------------------------------ */

export type CheckpointRejectionReason =
  | "wrong-type"
  | "malformed-container"
  | "non-finite-numeric"
  | "unsupported-version"
  | "unsupported-tag"
  | "structural-contradiction";

/**
 * Player-facing text per reason. **DRAFT — awaiting Owner wording.**
 *
 * A3.3 is the first unit that makes ordinary saves fail to load, and the
 * Explorer restore path surfaces `error.message` verbatim, so whatever is here
 * is what a player reads. The developer message below is a field name, a quoted
 * value and a reason code: precise for a log, useless to someone who wants to
 * know whether their world is still there.
 *
 * Branch on `reason` and read `playerMessage`, never the other way round. The
 * reason set is a contract; the wording is copy, and is expected to change
 * without touching the validator.
 */
export const CHECKPOINT_PLAYER_MESSAGES: Readonly<Record<CheckpointRejectionReason, string>> = {
  "wrong-type": "This save has a value in a place the app expects a different kind of value.",
  "malformed-container": "Part of this save doesn't have the shape the app expects.",
  "non-finite-numeric": "Part of this save contains a number that isn't valid.",
  "unsupported-version": "This save uses a format this version of the app doesn't support.",
  "unsupported-tag": "Part of this save is in a form this version of the app doesn't recognise.",
  "structural-contradiction":
    "Part of this save contains decision information that doesn't form a valid record.",
};

/**
 * The shared frame, appended to every reason's text.
 *
 * It says only that the world was not loaded — not partially loaded. It
 * deliberately does **not** promise the save was left unchanged: a refused
 * restore returns before making live state, but that is not the same as
 * proving the whole persistence and UI path never rewrites the stored save
 * during a failed load. That promise needs an end-to-end persistence assertion
 * first, and stays out until one exists.
 */
export const CHECKPOINT_PLAYER_NOTICE = "The world wasn't loaded.";
/** An explicit refusal, naming the field and the class of failure. */
export class CheckpointRejectionError extends Error {
  readonly field: string;
  readonly reason: CheckpointRejectionReason;
  /** Plain-language text for the player. See {@link CHECKPOINT_PLAYER_MESSAGES}. */
  readonly playerMessage: string;
  constructor(field: string, reason: CheckpointRejectionReason, detail: string) {
    super(`checkpoint rejected: ${field} — ${detail} (${reason})`);
    this.name = "CheckpointRejectionError";
    this.field = field;
    this.reason = reason;
    this.playerMessage = CHECKPOINT_PLAYER_MESSAGES[reason];
  }
}

// A function declaration, not a const arrow: TypeScript only narrows control
// flow past a `never` call when the callee is a declared function, and every
// check below relies on that narrowing to reach the next field.
function reject(field: string, reason: CheckpointRejectionReason, detail: string): never {
  throw new CheckpointRejectionError(field, reason, detail);
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const describe = (v: unknown): string => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

/**
 * Exported so the boundary generator can derive "a version this build does not
 * support" without re-declaring the list. A second copy of this array would be
 * a second thing to forget to update on a version bump, and it is the exact
 * shape of rot this generator exists to prevent.
 */
export const SUPPORTED_SCHEMAS: readonly CheckpointSchemaVersion[] = ["0.1", "0.2", "0.3", "0.4"];

/**
 * The newest supported schema, which is the one the running build writes.
 *
 * Derived rather than written as a literal. `0.4` written inline is correct
 * today and silently wrong at the next version bump — the rot the standing
 * decisions forbid — and a schema bump should move exactly one place. The list
 * is ordered oldest to newest, so its last entry is the current one.
 */
export const CURRENT_SCHEMA: CheckpointSchemaVersion = SUPPORTED_SCHEMAS[
  SUPPORTED_SCHEMAS.length - 1
] as CheckpointSchemaVersion;

/** Whether a declared schema is the running build's. */
export const isCurrentSchema = (schema: string): boolean => schema === CURRENT_SCHEMA;

const CHECKPOINT_TAGS: readonly string[] = [
  "simulation",
  "resource-system",
  "waste-field",
  "legacy-observer",
  "map",
  "undefined",
  "number",
  "rng",
  "typed-array",
];

/**
 * A tagged node of the encoded simulation tree, as `encodeCheckpointValue`
 * writes it. The key is sim-core's `CHECKPOINT_TAG`; a mismatch would make the
 * unsupported-tag condition vacuous, because the walk would find no tags and
 * therefore reject nothing while appearing to run.
 */
const CHECKPOINT_TAG_KEY = "__digital_evolution_type";
const CHECKPOINT_TYPED_ARRAYS = new Set([
  "Float32Array", "Float64Array", "Int32Array", "Uint32Array", "Uint16Array", "Uint8Array", "Int16Array", "Int8Array",
]);

function validateEncodedSimulation(value: unknown, path: string, source: CheckpointSchemaVersion): void {
  if (!isPlainObject(value)) reject(path, "malformed-container", "expected a simulation checkpoint");
  const cp = value as Record<string, unknown>;
  if (cp[CHECKPOINT_TAG_KEY] !== undefined) reject(path, "unsupported-tag", `checkpoint envelope cannot carry tag ${JSON.stringify(cp[CHECKPOINT_TAG_KEY])}`);
  if (cp.checkpoint_schema_version !== "0.1") reject(`${path}.checkpoint_schema_version`, "unsupported-version", "unsupported simulation checkpoint schema");
  if (typeof cp.engine_version !== "string" || !cp.engine_version) reject(`${path}.engine_version`, "wrong-type", "expected an engine version string");
  for (const key of ["tick", "seed"] as const) {
    if (!isFiniteNumber(cp[key])) reject(`${path}.${key}`, typeof cp[key] === "number" ? "non-finite-numeric" : "wrong-type", "expected a finite number");
  }
  if (!isPlainObject(cp.state) || cp.state[CHECKPOINT_TAG_KEY] !== "simulation") {
    reject(`${path}.state`, "malformed-container", "expected a tagged simulation state");
  }
  const seen = new Set<unknown>();
  const walk = (node: unknown, at: string): void => {
    if (node === null || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${at}[${index}]`));
      return;
    }
    if (!isPlainObject(node)) reject(at, "malformed-container", "expected an encoded object");
    const tag = node[CHECKPOINT_TAG_KEY];
    if (tag !== undefined) {
      if (typeof tag !== "string" || !CHECKPOINT_TAGS.includes(tag)) {
        reject(at, "unsupported-tag", `unrecognised checkpoint tag ${JSON.stringify(tag)}`);
      }
      if (["simulation", "resource-system", "waste-field", "legacy-observer"].includes(tag)) {
        if (!isPlainObject(node.props)) reject(`${at}.props`, "malformed-container", "tagged state needs object props");
        for (const [key, item] of Object.entries(node.props)) walk(item, `${at}.props.${key}`);
      } else if (tag === "map") {
        if (!Array.isArray(node.entries)) reject(`${at}.entries`, "malformed-container", "map entries must be an array");
        node.entries.forEach((entry, index) => {
          if (!Array.isArray(entry) || entry.length !== 2) reject(`${at}.entries[${index}]`, "malformed-container", "expected a key/value pair");
          walk(entry[0], `${at}.entries[${index}][0]`);
          walk(entry[1], `${at}.entries[${index}][1]`);
        });
      } else if (tag === "rng") {
        if (!isFiniteNumber(node.state)) reject(at, "wrong-type", "rng state must be finite");
      } else if (tag === "typed-array") {
        if (typeof node.ctor !== "string" || !CHECKPOINT_TYPED_ARRAYS.has(node.ctor) || !Array.isArray(node.values)) reject(at, "malformed-container", "invalid typed-array encoding");
        node.values.forEach((item, index) => { if (!isFiniteNumber(item)) reject(`${at}.values[${index}]`, "wrong-type", "expected a finite element"); });
      } else if (tag === "number") {
        if (!["NaN", "Infinity", "-Infinity"].includes(node.value as string)) reject(`${at}.value`, "wrong-type", "invalid encoded number");
      }
      return;
    }
    for (const [key, item] of Object.entries(node)) walk(item, `${at}.${key}`);
  };
  walk(cp.state, `${path}.state`);
  const props = cp.state.props as Record<string, unknown>;
  /**
   * Every field the constructor has emitted since d86ddfe, checked by presence
   * and by the kind that field is read as. This is the closed inventory of the
   * simulation's own state: a field added later is added here too, which is
   * what stops "the writer gained a field" from being an invisible contract
   * change. Fields that arrived *under* a supported schema and are genuinely
   * absent from older saves are not in this list — they carry a named rule
   * instead, and the per-field checks below scope them.
   */
  const commonFields = [
    "c", "study", "rInit", "rFood", "rMove", "rMut", "rCat", "t", "o", "ev", "sn", "long", "longStride", "eventSn",
    "L", "FAM", "nL", "nO", "peakPopulation", "peakPopulationTick", "tb", "last", "cur", "totalUse",
    "totalEnergy", "totalReproSupport", "resources", "drought", "response", "extinctTick", "extinctionContext", "nh",
  ] as const;
  for (const field of commonFields) {
    if (props[field] === undefined) reject(`${path}.state.props.${field}`, "malformed-container", "every simulation writer emitted this field");
  }
  if (typeof props.study !== "boolean") reject(`${path}.state.props.study`, "wrong-type", "expected a study flag");
  for (const field of ["rInit", "rFood", "rMove", "rMut", "rCat"] as const) {
    if (!isPlainObject(props[field]) || props[field][CHECKPOINT_TAG_KEY] !== "rng") reject(`${path}.state.props.${field}`, "wrong-type", "expected a tagged RNG stream");
  }
  for (const field of ["L", "FAM"] as const) {
    if (!isPlainObject(props[field]) || props[field][CHECKPOINT_TAG_KEY] !== "map") reject(`${path}.state.props.${field}`, "wrong-type", "expected an encoded map");
  }
  for (const field of ["t", "longStride", "nL", "nO", "peakPopulation", "peakPopulationTick"] as const) {
    if (!isFiniteNumber(props[field])) reject(`${path}.state.props.${field}`, "wrong-type", "expected a finite number");
  }
  for (const field of ["c", "tb", "last", "cur"] as const) {
    if (!isPlainObject(props[field]) || props[field][CHECKPOINT_TAG_KEY] !== undefined) reject(`${path}.state.props.${field}`, "wrong-type", "expected an untagged state object");
  }
  for (const field of ["o", "ev", "sn", "long", "eventSn", "totalUse", "totalEnergy", "totalReproSupport", "nh"] as const) {
    if (!Array.isArray(props[field])) reject(`${path}.state.props.${field}`, "malformed-container", "expected a saved list");
  }
  if (!isPlainObject(props.resources) || props.resources[CHECKPOINT_TAG_KEY] !== "resource-system") {
    reject(`${path}.state.props.resources`, "malformed-container", "expected tagged resource-system state");
  }
  if (!Array.isArray(props.o)) reject(`${path}.state.props.o`, "malformed-container", "simulation writes organisms as an array");
  props.o.forEach((organism, index) => {
    const at = `${path}.state.props.o[${index}]`;
    if (!isPlainObject(organism)) reject(at, "malformed-container", "expected an organism");
    const pc = organism.pc;
    if (pc === undefined && source === "0.4") reject(`${at}.pc`, "wrong-type", "current organisms write pc");
    if (pc !== undefined && !isFiniteNumber(pc)) reject(`${at}.pc`, "wrong-type", "production count must be finite");
  });
  const interval = props.lineageInterval;
  if (interval === undefined && source === "0.4") reject(`${path}.state.props.lineageInterval`, "malformed-container", "current simulation writes lineageInterval");
  if (interval !== undefined && (!isPlainObject(interval) || interval[CHECKPOINT_TAG_KEY] !== "map")) reject(`${path}.state.props.lineageInterval`, "malformed-container", "expected encoded map");
  if (props.lastLineageFlows === undefined && source === "0.4") reject(`${path}.state.props.lastLineageFlows`, "malformed-container", "current simulation writes lastLineageFlows");
  if (props.lastLineageFlows !== undefined && props.lastLineageFlows !== null && !isPlainObject(props.lastLineageFlows)) reject(`${path}.state.props.lastLineageFlows`, "wrong-type", "expected null or flow facts");
  validateResourceSystem(props.resources, `${path}.state.props.resources`);
  if (props.drought !== null && !isPlainObject(props.drought)) reject(`${path}.state.props.drought`, "wrong-type", "expected null or an active drought");
  if (props.drought !== null && props.drought !== undefined) {
    for (const field of ["kind", "end", "suppression"] as const) {
      if (!isFiniteNumber(props.drought[field])) reject(`${path}.state.props.drought.${field}`, "wrong-type", "expected a finite drought parameter");
    }
  }
  if (props.extinctTick !== null && props.extinctTick !== undefined && !isFiniteNumber(props.extinctTick)) {
    reject(`${path}.state.props.extinctTick`, "wrong-type", "expected null or a finite tick");
  }
  /**
   * The remaining lists are read as records by History and the intervention
   * read models, so a malformed entry becomes a wrong claim rather than a
   * crash. `ev` and `sn`/`long`/`eventSn` carry whole simulation snapshots and
   * are deliberately not walked field by field: they are derived presentation
   * history, re-derived by the next observation stride, and a malformed one
   * cannot alter the restored simulation's own state. `nh` and `response` DO
   * gate live behaviour, so they are checked here.
   */
  for (const field of ["ev", "sn", "long", "eventSn"] as const) {
    if (!Array.isArray(props[field])) reject(`${path}.state.props.${field}`, "malformed-container", "expected a saved snapshot list");
  }
  for (const [index, entry] of (props.ev as unknown[]).entries()) {
    if (!isPlainObject(entry) || !isFiniteNumber(entry.tick) || typeof entry.label !== "string") {
      reject(`${path}.state.props.ev[${index}]`, "malformed-container", "expected a tick and label");
    }
  }
  if (Array.isArray(props.nh)) {
    props.nh.forEach((point, index) => {
      const at = `${path}.state.props.nh[${index}]`;
      if (!isPlainObject(point)) reject(at, "malformed-container", "expected a niche history point");
      for (const field of ["tick", "effective_niches", "coverage"] as const) {
        if (!isFiniteNumber(point[field])) reject(`${at}.${field}`, "wrong-type", "expected a finite number");
      }
      if (typeof point.partitioned !== "boolean") reject(`${at}.partitioned`, "wrong-type", "expected a boolean");
      if (point.alignment !== null && !isFiniteNumber(point.alignment)) reject(`${at}.alignment`, "wrong-type", "expected null or a finite alignment");
    });
  }
  if (props.response !== null && props.response !== undefined) {
    const at = `${path}.state.props.response`;
    if (!isPlainObject(props.response)) reject(at, "malformed-container", "expected null or a disturbance response");
    for (const field of ["tick", "pre_population", "deepest_population", "deepest_tick", "nutrient_removed_total"] as const) {
      if (!isFiniteNumber(props.response[field])) reject(`${at}.${field}`, "wrong-type", "expected a finite response counter");
    }
    validateNumberList(props.response.nutrient_removed_by_type, `${at}.nutrient_removed_by_type`);
  }
  if (props.extinctionContext !== null && props.extinctionContext !== undefined && !isPlainObject(props.extinctionContext)) {
    reject(`${path}.state.props.extinctionContext`, "wrong-type", "expected null or an extinction context");
  }
  // `last` and `cur` are the interval counters the analysis read models and the
  // next stride both read, so every persisted counter must be a finite number.
  for (const field of ["last", "cur"] as const) {
    const at = `${path}.state.props.${field}`;
    if (!isPlainObject(props[field]) || props[field][CHECKPOINT_TAG_KEY] !== undefined) {
      reject(at, "malformed-container", "expected an interval counter object");
    }
    for (const [key, value] of Object.entries(props[field] as Record<string, unknown>)) {
      if (key === "wake_clades") {
        if (!isPlainObject(value)) reject(`${at}.wake_clades`, "malformed-container", "expected a clade wake count map");
        for (const [clade, count] of Object.entries(value)) {
          if (!isFiniteNumber(count)) reject(`${at}.wake_clades.${clade}`, "wrong-type", "expected a finite count");
        }
      } else if (!isFiniteNumber(value)) {
        reject(`${at}.${key}`, "wrong-type", "expected a finite interval counter");
      }
    }
  }
  // Lineage and family identity is provenance: a malformed map entry would make
  // History and the Tree read models name something the save does not support.
  for (const [field, shape] of [
    ["L", ["id", "parent", "born", "peak", "last"]],
    ["FAM", ["id", "root_lineage", "born", "peak", "last"]],
  ] as const) {
    const map = props[field] as Record<string, unknown>;
    if (!isPlainObject(map) || map[CHECKPOINT_TAG_KEY] !== "map") {
      reject(`${path}.state.props.${field}`, "malformed-container", "expected an encoded identity map");
    }
    for (const [index, entry] of (map.entries as unknown[]).entries()) {
      const at = `${path}.state.props.${field}.entries[${index}]`;
      if (!Array.isArray(entry) || entry.length !== 2) reject(at, "malformed-container", "expected an identity key/value pair");
      if (!isFiniteNumber(entry[0])) reject(`${at}[0]`, "wrong-type", "expected a finite identity key");
      const record = entry[1];
      if (!isPlainObject(record)) reject(`${at}[1]`, "malformed-container", "expected an identity record");
      for (const key of shape) if (!isFiniteNumber(record[key])) reject(`${at}[1].${key}`, "wrong-type", "expected a finite identity field");
      if (typeof record.established !== "boolean") reject(`${at}[1].established`, "wrong-type", "expected a boolean");
      if (field === "L" && !Array.isArray(record.mutations)) reject(`${at}[1].mutations`, "malformed-container", "expected a mutation list");
      if (field === "L") {
        for (const [m, mutation] of (record.mutations as unknown[]).entries()) {
          if (typeof mutation !== "string") reject(`${at}[1].mutations[${m}]`, "wrong-type", "expected a mutation name");
        }
      }
    }
  }
  props.o.forEach((organism: unknown, index: number) => validateOrganism(organism, `${path}.state.props.o[${index}]`, source));
}

/**
 * The resource system's own persisted state.
 *
 * Every array here is indexed by substance kind in the biological step, and the
 * typed arrays are the live field. A wrong-typed or wrongly-sized array does not
 * fail later — it produces NaN stock totals that quietly change the world's
 * resource economy, so the check is here rather than left to the consumer.
 */
function validateResourceSystem(value: unknown, at: string): void {
  if (!isPlainObject(value) || value[CHECKPOINT_TAG_KEY] !== "resource-system") {
    reject(at, "malformed-container", "expected tagged resource-system state");
  }
  const rs = value as Record<string, unknown>;
  const props = rs.props as Record<string, unknown>;
  if (!isPlainObject(props)) reject(`${at}.props`, "malformed-container", "resource system needs object props");
  const scalars = ["n", "cell", "size", "updateStride", "uptake", "regenRate", "totalCapTarget", "initialFraction", "minFraction", "maxFraction"] as const;
  for (const field of scalars) if (!isFiniteNumber(props[field])) reject(`${at}.props.${field}`, "wrong-type", "expected a finite number");
  for (const field of ["enabledByproduct", "enabledWaste"] as const) {
    if (typeof props[field] !== "boolean") reject(`${at}.props.${field}`, "wrong-type", "expected a boolean switch");
  }
  if (!Array.isArray(props.defs) || props.defs.length === 0) reject(`${at}.props.defs`, "malformed-container", "expected substance definitions");
  for (const [index, def] of (props.defs as unknown[]).entries()) {
    if (!isPlainObject(def) || typeof def.id !== "string") reject(`${at}.props.defs[${index}]`, "malformed-container", "expected a substance definition");
    for (const field of ["energy_yield", "regeneration_rate"] as const) {
      const v = (def as Record<string, unknown>)[field];
      if (v !== null && !isFiniteNumber(v)) reject(`${at}.props.defs[${index}].${field}`, "wrong-type", "expected null or a finite rate");
    }
  }
  // Index-by-kind arrays: every entry is read as a number, and the loop is over
  // NUTRIENT_SUBSTANCES, so a short or non-numeric array is a live-state defect.
  for (const field of ["input", "biologicalProduction", "consumed", "decayed", "externalRemoved", "diffusionAdjustment", "lastInput", "diffusionRate", "totalStock", "totalCapacity", "initialStock"] as const) {
    validateNumberList(props[field], `${at}.props.${field}`);
  }
  if (props.removalEvents !== undefined) {
    if (!Array.isArray(props.removalEvents)) reject(`${at}.props.removalEvents`, "malformed-container", "expected removal events");
    (props.removalEvents as unknown[]).forEach((event, index) => {
      const eventAt = `${at}.props.removalEvents[${index}]`;
      if (!isPlainObject(event)) reject(eventAt, "malformed-container", "expected a removal event");
      validateNumberList(event.amounts, `${eventAt}.amounts`);
      if (!isFiniteNumber(event.total)) reject(`${eventAt}.total`, "wrong-type", "expected a finite total");
      if (typeof event.reason !== "string") reject(`${eventAt}.reason`, "wrong-type", "expected a removal reason");
    });
  }
  for (const field of ["stock", "cap", "source", "delta", "sourceBoost", "minCapRight", "minCapDown"] as const) {
    if (!Array.isArray(props[field])) reject(`${at}.props.${field}`, "malformed-container", "expected per-substance field arrays");
    (props[field] as unknown[]).forEach((grid, index) => validateTypedArray(grid, `${at}.props.${field}[${index}]`));
  }
  for (const field of ["right", "down", "regenLast"] as const) validateTypedArray(props[field], `${at}.props.${field}`);
  if (props.regenBuckets !== undefined && !Array.isArray(props.regenBuckets)) reject(`${at}.props.regenBuckets`, "malformed-container", "expected regeneration buckets");
  if (props.cSink !== undefined && props.cSink !== null) {
    if (!isPlainObject(props.cSink) || !isFiniteNumber(props.cSink.end) || !isFiniteNumber(props.cSink.factor)) {
      reject(`${at}.props.cSink`, "wrong-type", "expected null or a finite sink");
    }
  }
  validateWasteField(props.waste, `${at}.props.waste`);
}

/** The waste field is read cell-by-cell in the biological step. */
function validateWasteField(value: unknown, at: string): void {
  if (!isPlainObject(value) || value[CHECKPOINT_TAG_KEY] !== "waste-field") {
    reject(at, "malformed-container", "expected tagged waste-field state");
  }
  const props = (value as Record<string, unknown>).props as Record<string, unknown>;
  if (!isPlainObject(props)) reject(`${at}.props`, "malformed-container", "waste field needs object props");
  for (const field of ["n", "cell", "size", "produced", "bioRemoved", "decayed", "clampAdj", "discarded", "diffusionRate", "decayRate", "updateStride"] as const) {
    if (!isFiniteNumber(props[field])) reject(`${at}.props.${field}`, "wrong-type", "expected a finite number");
  }
  for (const field of ["stock", "cap", "right", "down", "delta", "decayLast"] as const) validateTypedArray(props[field], `${at}.props.${field}`);
  if (props.decayBuckets !== undefined && !Array.isArray(props.decayBuckets)) reject(`${at}.props.decayBuckets`, "malformed-container", "expected decay buckets");
}

/**
 * One organism's persisted state.
 *
 * Every trait here is read by the biological step, so a wrong type or a
 * non-finite value changes physiology rather than presentation. `to` and `cu`
 * arrived under 0.3 and carry named omission rules; the remainder existed in
 * every supported writer.
 */
function validateOrganism(value: unknown, at: string, source: CheckpointSchemaVersion): void {
  if (!isPlainObject(value)) reject(at, "malformed-container", "expected an organism");
  const organism = value as Record<string, unknown>;
  const finite = [
    "id", "generation", "born", "matureAt", "readyAt", "x", "y", "en", "h",
    "sp", "se", "me", "rp", "di", "ha", "bu", "dr", "wakeCount", "l",
  ] as const;
  for (const field of finite) {
    if (!isFiniteNumber(organism[field])) reject(`${at}.${field}`, "wrong-type", "expected a finite number");
  }
  for (const field of ["ma", "mb", "mc", "ga", "gb", "gc", "ra", "rb", "rc"] as const) {
    if (!isFiniteNumber(organism[field])) reject(`${at}.${field}`, "wrong-type", "expected a finite accounting counter");
  }
  if (organism.parent !== null && !isFiniteNumber(organism.parent)) reject(`${at}.parent`, "wrong-type", "expected null or a parent id");
  for (const field of ["dormantSince", "lastWakeTick"] as const) {
    if (organism[field] !== null && !isFiniteNumber(organism[field])) reject(`${at}.${field}`, "wrong-type", "expected null or a finite tick");
  }
  if (organism.activity !== "active" && organism.activity !== "dormant") {
    reject(`${at}.activity`, "unsupported-tag", "unknown organism activity");
  }
  for (const [field, introduced] of [["pc", "0.4"], ["to", "0.3"], ["cu", "0.3"]] as const) {
    const value = organism[field];
    if (value === undefined) {
      // Older schemas may genuinely lack it; the current schema may not, and
      // the omission rules cover the historical case explicitly.
      if (introduced === "0.4" && source === "0.4") reject(`${at}.${field}`, "malformed-container", "current organisms write this field");
      continue;
    }
    if (!isFiniteNumber(value)) reject(`${at}.${field}`, "wrong-type", "expected a finite trait value");
  }
}

function validateNumberList(value: unknown, at: string): void {
  if (!Array.isArray(value)) {
    reject(at, "malformed-container", "expected a saved numeric list");
  }
  (value as unknown[]).forEach((entry, index) => {
    if (!isFiniteNumber(entry)) reject(`${at}[${index}]`, "wrong-type", "expected a finite number");
  });
}

function validateTypedArray(value: unknown, at: string): void {
  if (!isPlainObject(value) || value[CHECKPOINT_TAG_KEY] !== "typed-array" || !Array.isArray(value.values)) {
    reject(at, "malformed-container", "expected an encoded typed array");
  }
  if (typeof value.ctor !== "string" || !CHECKPOINT_TYPED_ARRAYS.has(value.ctor)) {
    reject(at, "unsupported-tag", "unknown typed-array constructor");
  }
  (value.values as unknown[]).forEach((entry, index) => {
    if (!isFiniteNumber(entry)) reject(`${at}.values[${index}]`, "non-finite-numeric", "expected a finite element");
  });
}

/**
 * Entity references inside a history record.
 *
 * A bare finite number is the pre-A2 shape and is historical absence of a
 * `kind`, not an absent reference; `allowBareNumbers` is true only for a
 * source-schema preflight on a historical payload. Canonical validation
 * passes false, because by that point every reference has been migrated to a
 * typed ref and a bare number means the migration did not run.
 */
export function validateEntityRefs(
  observer: Record<string, unknown>,
  at: string,
  allowBareNumbers: boolean,
): void {
  if (!Array.isArray(observer.records)) return;
  observer.records.forEach((raw, i) => {
    const recordAt = `${at}.records[${i}]`;
    if (!isPlainObject(raw)) reject(recordAt, "malformed-container", "expected a history record object");
    if (!Array.isArray(raw.entity_refs)) reject(`${recordAt}.entity_refs`, "malformed-container", "expected an entity reference list");
    raw.entity_refs.forEach((ref, j) => {
      const refAt = `${recordAt}.entity_refs[${j}]`;
      if (typeof ref === "number" && allowBareNumbers) {
        if (!Number.isFinite(ref)) reject(refAt, "non-finite-numeric", "expected a finite historical entity ID");
        return;
      }
      if (!isPlainObject(ref)) reject(refAt, "malformed-container", "expected a typed reference");
      if (!isFiniteNumber(ref.id)) reject(`${refAt}.id`, "wrong-type", "expected a finite entity ID");
      if (ref.kind !== null && ref.kind !== "organism" && ref.kind !== "lineage" && ref.kind !== "clade") {
        reject(`${refAt}.kind`, "wrong-type", "unknown entity kind");
      }
    });
  });
}

/**
 * A3.4 shares this with canonical validation, so it is parameterised by what
 * the CALLER requires rather than by the payload's declared schema.
 *
 * `requireDetectors: false` tolerates `dep`/`niche` absence, and only a
 * source-schema preflight may ask for that: the historical basis for it is
 * A3.3's rule table. Canonical validation always passes `true`, because the
 * canonical layer must carry every key the current contract requires.
 */
export function validateObserverCheckpoint(
  value: unknown,
  path: string,
  opts: { readonly requireDetectors: boolean },
): void {
  if (!isPlainObject(value)) reject(path, "malformed-container", "expected an observer checkpoint");
  const observer = value as Record<string, unknown>;
  const states: Readonly<Record<string, { nullable?: readonly string[]; numbers?: readonly string[]; booleans?: readonly string[]; maps?: readonly string[] }>> = {
    cross: { nullable: ["candidateSince", "lowSince"] },
    seedbank: { nullable: ["candidateSince", "lowSince", "establishedTick", "lastReturnTick"], maps: ["priorDormantClades", "returnedClades"] },
    dep: { nullable: ["candidateSince", "lowSince", "establishedTick", "topConsumer"], numbers: ["estScav", "baselineProduced", "topConsumerShare"] },
    niche: { nullable: ["candidateSince", "shiftSince", "lowSince", "establishedTick"], numbers: ["baseWaste", "baseTol", "baseCu", "baseExposed", "estWaste", "estExposed"], booleans: ["wasDisrupted"] },
  };
  for (const [name, shape] of Object.entries(states)) {
    const state = observer[name];
    if (state === undefined && (name === "dep" || name === "niche") && !opts.requireDetectors) continue;
    if (!isPlainObject(state)) reject(`${path}.${name}`, "malformed-container", "expected a detector state");
    if (typeof state.id !== "string" || !state.id) reject(`${path}.${name}.id`, "wrong-type", "expected detector identity");
    if (!["absent", "forming", "established", "disrupted", "recovered", "superseded"].includes(state.state as string)) {
      reject(`${path}.${name}.state`, "unsupported-tag", "unrecognized ecological lifecycle state");
    }
    for (const key of shape.nullable ?? []) if (state[key] !== null && !isFiniteNumber(state[key])) reject(`${path}.${name}.${key}`, "wrong-type", "expected null or a finite tick");
    for (const key of shape.numbers ?? []) if (!isFiniteNumber(state[key])) reject(`${path}.${name}.${key}`, "wrong-type", "expected a finite number");
    for (const key of shape.booleans ?? []) if (typeof state[key] !== "boolean") reject(`${path}.${name}.${key}`, "wrong-type", "expected a boolean");
    for (const key of shape.maps ?? []) {
      if (!isPlainObject(state[key])) reject(`${path}.${name}.${key}`, "malformed-container", "expected a clade-count map");
      for (const [id, count] of Object.entries(state[key])) if (!isFiniteNumber(count)) reject(`${path}.${name}.${key}.${id}`, "wrong-type", "expected a finite count");
    }
  }
  if (!isPlainObject(observer.era)) reject(`${path}.era`, "malformed-container", "expected an era state");
  const era = observer.era;
  for (const key of ["current", "candidate"] as const) if (era[key] !== null && typeof era[key] !== "string") reject(`${path}.era.${key}`, "wrong-type", "expected null or an era identity");
  if (era.candidateSince !== null && !isFiniteNumber(era.candidateSince)) reject(`${path}.era.candidateSince`, "wrong-type", "expected null or a finite tick");
  if (!isFiniteNumber(era.index)) reject(`${path}.era.index`, "wrong-type", "expected a finite era index");
  for (const key of ["records", "eras"] as const) if (!Array.isArray(observer[key])) reject(`${path}.${key}`, "malformed-container", "expected an observer history list");
  /**
   * History records are the product's read model: what a record *says* is the
   * evidence the player investigates. A malformed record is therefore not a
   * cosmetic problem, so identity, phase and evidence shape are checked here.
   * The evidence frame's individual measures are deliberately not walked: they
   * are produced verbatim from the simulation frame, consumed read-only, and
   * cannot alter restored biology. That is a named scope limit, not an omission.
   */
  (observer.records as unknown[]).forEach((raw, index) => {
    const at = `${path}.records[${index}]`;
    if (!isPlainObject(raw)) reject(at, "malformed-container", "expected a history record");
    for (const field of ["id", "arc_id", "kind", "phase", "title", "summary", "level"] as const) {
      if (typeof raw[field] !== "string" || raw[field] === "") reject(`${at}.${field}`, "wrong-type", "expected a nonempty record string");
    }
    if (!isFiniteNumber(raw.tick)) reject(`${at}.tick`, "wrong-type", "expected a finite record tick");
    if (raw.evidence !== undefined && !isPlainObject(raw.evidence)) reject(`${at}.evidence`, "malformed-container", "expected an observation frame");
  });
  (observer.eras as unknown[]).forEach((raw, index) => {
    const at = `${path}.eras[${index}]`;
    if (!isPlainObject(raw)) reject(at, "malformed-container", "expected an era record");
    for (const field of ["id", "kind", "signature"] as const) {
      if (typeof raw[field] !== "string" || raw[field] === "") reject(`${at}.${field}`, "wrong-type", "expected a nonempty era string");
    }
    if (!isFiniteNumber(raw.start_tick)) reject(`${at}.start_tick`, "wrong-type", "expected a finite era start tick");
    if (raw.previous_signature !== null && typeof raw.previous_signature !== "string") {
      reject(`${at}.previous_signature`, "wrong-type", "expected null or an era signature");
    }
  });
}

/**
 * Check the raw source payload against its writer's version before restore.
 * Present fields are validated under every supported schema. Required-presence
 * varies only where an evidenced historical writer transition permits absence.
 *
 * That split is the reason `0.4` exists. `0.3` was already two shapes before
 * this unit: `Organism.pc`, `Simulation.lastLineageFlows` and
 * `Simulation.lineageInterval` all arrived while the schema was already `0.3`,
 * as did the C-use and niche sub-states and then A2's tagged entity references.
 * So "a 0.3 save may omit `pc`" and "a current save missing `pc` is refused"
 * were both true and could not be told apart by version. Making the hardened
 * shape its own version is what lets both hold.
 */
export const validateCheckpoint = (checkpoint: unknown): void => {
  if (!isPlainObject(checkpoint)) {
    reject("(root)", "malformed-container", `expected a checkpoint object, got ${checkpoint === null ? "null" : typeof checkpoint}`);
  }
  const schema = checkpoint.checkpointSchemaVersion;
  if (typeof schema !== "string" || !SUPPORTED_SCHEMAS.includes(schema as CheckpointSchemaVersion)) {
    reject("checkpointSchemaVersion", "unsupported-version", `unsupported schema ${JSON.stringify(schema)}`);
  }
  if (typeof checkpoint.engineVersion !== "string" || checkpoint.engineVersion.length === 0) {
    reject("engineVersion", "wrong-type", "every runtime checkpoint wrote an engine version string");
  }
  if (!isFiniteNumber(checkpoint.createdTick)) {
    reject("createdTick", typeof checkpoint.createdTick === "number" ? "non-finite-numeric" : "wrong-type", "every runtime checkpoint wrote a finite tick");
  }
  if (!isPlainObject(checkpoint.experiment)) {
    reject("experiment", "malformed-container", "missing or not a simulation checkpoint object");
  }

  // An unrecognised tag would otherwise be decoded as a plain object, which is
  // the one rejection gap with no existing throw behind it.
  validateEncodedSimulation(checkpoint.experiment, "experiment", schema as CheckpointSchemaVersion);
  if ((checkpoint.experiment as Record<string, unknown>).engine_version !== checkpoint.engineVersion) {
    reject("experiment.engine_version", "structural-contradiction", "simulation and runtime engine versions disagree");
  }

  /**
   * Whether a field may be *absent* is version-scoped: a build that wrote the
   * save may not have had the field, and the migration table names the shape it
   * wrote. That is the one job the version split has.
   *
   * Whether a value that is *present* is valid is not version-scoped. A field
   * holding a value of the wrong kind, a malformed container, a non-finite
   * required number, or a record that contradicts itself is invalid in every
   * schema — an older build writing a corrupt value did not make it correct.
   *
    * A rule governing absence must not be read as governing validity. Presence
    * is checked against each writer, and validity applies at every schema.
   */
  const decisions = checkpoint.decisions;
  if (decisions !== undefined && !isPlainObject(decisions)) {
    reject("decisions", "malformed-container", `expected a decisions object, got ${describe(decisions)}`);
  }
  if (decisions !== undefined) {
    validateDecisionRecords(decisions as Record<string, unknown>, schema as CheckpointSchemaVersion);
  }
  // Checkpoint 0.2 introduced the decisions container, with `pending` and
  // `resolutions` present even when null or empty. No supported build since
  // then omitted either field; only 0.1 predates the entire subsystem.
  if (schema !== "0.1") {
    if (!isPlainObject(decisions)) {
      reject("decisions", "malformed-container", "this schema wrote a decisions object");
    }
    if (decisions.pending === undefined) {
      reject("decisions.pending", "wrong-type", "this schema wrote a pending decision or null");
    }
    if (!Array.isArray(decisions.resolutions)) {
      reject("decisions.resolutions", "malformed-container", "this schema wrote a resolutions array");
    }
    for (const field of schema === "0.2" ? ["policyVersion"] : ["policyVersion", "catalystPolicyVersion"]) {
      if (typeof decisions[field] !== "string" || decisions[field] === "") {
        reject(`decisions.${field}`, "wrong-type", "saved generator version must be a nonempty string");
      }
    }
  }
  // 0.3 introduced both pacing fields, and the current schema still writes
  // them even when the cooldown value is null. Only 0.2 can reconstruct the
  // decision tick or read the pre-cooldown absence as null.
  if (schema === "0.3" || isCurrentSchema(schema as string)) {
    const pacing = decisions as Record<string, unknown>;
    for (const field of ["lastDecisionTick", "lastMajorCatalystTick"] as const) {
      if (pacing[field] === undefined) {
        reject(`decisions.${field}`, "malformed-container", `${schema} wrote ${field}`);
      }
    }
  }
  const analysis = checkpoint.analysis;
  if (analysis !== undefined && !isPlainObject(analysis)) {
    reject("analysis", "malformed-container", `expected an analysis object, got ${describe(analysis)}`);
  }
  if (!isPlainObject(analysis)) {
    reject("analysis", "malformed-container", "every runtime checkpoint wrote an analysis object");
  }
  validateObserverCheckpoint(analysis, "analysis", { requireDetectors: isCurrentSchema(schema as string) });
  if (analysis !== undefined && (analysis as Record<string, unknown>).records !== undefined) {
    if (!Array.isArray((analysis as Record<string, unknown>).records)) {
      reject("analysis.records", "malformed-container", `expected a records array, got ${describe((analysis as Record<string, unknown>).records)}`);
    }
  }
  if (isPlainObject(analysis)) {
    for (const field of ["dep", "niche"] as const) {
      const value = (analysis as Record<string, unknown>)[field];
      if (value !== undefined && !isPlainObject(value)) {
        reject(`analysis.${field}`, "malformed-container", `expected an observer state object, got ${describe(value)}`);
      }
    }
  }
  if (isPlainObject(analysis)) validateEntityRefs(analysis, "analysis", !isCurrentSchema(schema as string));
  if (checkpoint.control === undefined || (checkpoint.control !== null && !isPlainObject(checkpoint.control))) {
    reject("control", "wrong-type", `expected null or a control checkpoint object, got ${describe(checkpoint.control)}`);
  }
  if (checkpoint.controlAnalysis === undefined ||
      (checkpoint.controlAnalysis !== null && !isPlainObject(checkpoint.controlAnalysis))) {
    reject("controlAnalysis", "wrong-type", `expected null or an observer checkpoint object, got ${describe(checkpoint.controlAnalysis)}`);
  }
  if ((checkpoint.control === null) !== (checkpoint.controlAnalysis === null)) {
    reject("controlAnalysis", "structural-contradiction", "control and its observer must either both exist or both be null");
  }
  if (checkpoint.control !== null) validateEncodedSimulation(checkpoint.control, "control", schema as CheckpointSchemaVersion);
  if (isPlainObject(checkpoint.control) && checkpoint.control.engine_version !== checkpoint.engineVersion) {
    reject("control.engine_version", "structural-contradiction", "control and runtime engine versions disagree");
  }
  if (checkpoint.controlAnalysis !== null) validateObserverCheckpoint(checkpoint.controlAnalysis, "controlAnalysis", { requireDetectors: isCurrentSchema(schema as string) });
  if (isPlainObject(checkpoint.controlAnalysis)) validateEntityRefs(checkpoint.controlAnalysis, "controlAnalysis", !isCurrentSchema(schema as string));
  /**
   * Presence, decided per field by when that field was introduced.
   *
   * This is the only axis the version split governs, and it is narrower than
   * "the current schema requires it". `cross`, `seedbank`, `era`, `records` and
   * `eras` are written by every analysis checkpoint since d86ddfe on
   * 2026-09-23, so a save omitting one of them is malformed at *every* schema
   * and no migration rule may tolerate its absence. `dep` and `niche` arrived
   * after the 0.3 bump and are genuinely absent from older saves, which is what
   * the two analysis rules record.
   *
   * Treating the whole analysis object as version-scoped is what let a 0.3 save
   * omit `analysis.records` — an absence no supported build ever produced. The
   * boundary has to be drawn where the history actually puts it, or the
   * document describes a wider boundary than the code has.
   */
  if (isPlainObject(analysis)) {
    const sub = analysis as Record<string, unknown>;
    for (const key of ["records", "eras", "cross", "seedbank", "era"] as const) {
      if (sub[key] === undefined) {
        reject(
          `analysis.${key}`,
          "malformed-container",
          `every analysis checkpoint since 0.1 wrote ${key}, so its absence is not a historical shape`,
        );
      }
    }
  }
  if (schema !== "0.4") return;

  // Presence, current schema only. `dep` and `niche` are the analysis
  // sub-states older saves may genuinely lack; the five checked above are not.
  if (!isPlainObject(decisions)) {
    reject("decisions", "malformed-container", "current schema requires a decisions object");
  }
  if (!Array.isArray((decisions as Record<string, unknown>).resolutions)) {
    reject("decisions.resolutions", "malformed-container", `expected an array, got ${describe((decisions as Record<string, unknown>).resolutions)}`);
  }
  if (!isPlainObject(analysis)) {
    reject("analysis", "malformed-container", "current schema requires an analysis object");
  }
  if (isPlainObject(analysis)) {
    const sub = analysis as Record<string, unknown>;
    for (const key of ["dep", "niche"] as const) {
      if (sub[key] === undefined) {
        reject(
          `analysis.${key}`,
          "malformed-container",
          `current schema requires ${key}, and no rule may tolerate its absence here`,
        );
      }
    }
  }
};

/**
 * Validity of a present `decisions` payload, at every supported schema.
 *
 * These are the checks that used to sit behind the version guard, which meant
 * they applied only to the current schema. A resolution is a record of a
 * decision that actually happened, so its parts have to agree with each other
 * at any schema: a source the schema does not know, or a tick that is not a
 * tick, is not an unknown kind of resolution but a record that contradicts
 * itself, and would otherwise pass a shape check while describing a decision
 * that never occurred.
 */
/**
 * A3.4 shares this with canonical validation, which passes the current schema
 * so the same field checks decide validity for a migrated payload.
 */
export function validateDecisionRecords(decisions: Record<string, unknown>, sourceSchema: CheckpointSchemaVersion): void {
  // `lastDecisionTick` gates quiet time and `lastMajorCatalystTick` gates the
  // major cooldown, where null reads as "clear". Neither may be coerced: a
  // value substituted for a corrupt one would grant a capability the real
  // cooldown would have withheld, and the player could not tell.
  if (typeof decisions.lastDecisionTick === "number" && !Number.isFinite(decisions.lastDecisionTick)) {
    reject("decisions.lastDecisionTick", "non-finite-numeric", `expected a finite number, got ${String(decisions.lastDecisionTick)}`);
  }
  if (decisions.lastDecisionTick !== undefined && !isFiniteNumber(decisions.lastDecisionTick)) {
    reject("decisions.lastDecisionTick", "wrong-type", `expected a finite number, got ${describe(decisions.lastDecisionTick)}`);
  }
  const major = decisions.lastMajorCatalystTick;
  if (typeof major === "number" && !Number.isFinite(major)) {
    reject("decisions.lastMajorCatalystTick", "non-finite-numeric", `expected null or a finite number, got ${String(major)}`);
  }
  if (major !== undefined && major !== null && !isFiniteNumber(major)) {
    reject("decisions.lastMajorCatalystTick", "wrong-type", `expected null or a finite number, got ${describe(major)}`);
  }
  if (decisions.pending !== undefined && decisions.pending !== null && !isPlainObject(decisions.pending)) {
    reject("decisions.pending", "wrong-type", `expected null or a decision object, got ${describe(decisions.pending)}`);
  }
  if (isPlainObject(decisions.pending)) {
    const pending = decisions.pending;
    if (pending.source === undefined && sourceSchema !== "0.2") {
      reject("decisions.pending.source", "structural-contradiction", "this schema wrote the pending source");
    }
    if (pending.source === undefined && typeof pending.sourceEventId !== "string") {
      reject("decisions.pending.sourceEventId", "structural-contradiction", "0.2 event-source reconstruction requires its saved event ID");
    }
    if (pending.source !== undefined && pending.source !== "observed_event" && pending.source !== "world_catalyst") {
      reject("decisions.pending.source", "structural-contradiction", "unknown pending decision source");
    }
    if (sourceSchema === "0.2" && pending.source === "world_catalyst") {
      reject("decisions.pending.source", "structural-contradiction", "0.2 predates catalyst windows");
    }
    if (pending.contextSnapshot === undefined && sourceSchema !== "0.2") {
      reject("decisions.pending.contextSnapshot", "malformed-container", "this schema wrote the observation context");
    }
    if (pending.contextSnapshot === null && sourceSchema !== "0.4") {
      reject("decisions.pending.contextSnapshot", "wrong-type", "only a current re-save may mark legacy context unrecorded");
    }
    if (pending.contextSnapshot !== undefined && pending.contextSnapshot !== null && !isPlainObject(pending.contextSnapshot)) {
      reject("decisions.pending.contextSnapshot", "malformed-container", "expected an observation context object");
    }
  }
  if (decisions.resolutions === undefined) return;
  if (!Array.isArray(decisions.resolutions)) {
    reject("decisions.resolutions", "malformed-container", `expected an array, got ${describe(decisions.resolutions)}`);
  }
  (decisions.resolutions as unknown[]).forEach((raw: unknown, index: number) => {
    const at = `decisions.resolutions[${index}]`;
    if (!isPlainObject(raw)) {
      reject(at, "malformed-container", `expected a resolution object, got ${describe(raw)}`);
    }
    const record = raw as Record<string, unknown>;
    for (const key of ["opportunityId", "commandId"] as const) {
      if (typeof record[key] !== "string" || record[key] === "") {
        reject(`${at}.${key}`, "structural-contradiction", `a resolved decision must name its ${key}, got ${describe(record[key])}`);
      }
    }
    if (!isFiniteNumber(record.tick)) {
      reject(`${at}.tick`, "structural-contradiction", `a resolution must be stamped with a finite tick, got ${describe(record.tick)}`);
    }
    if (record.source !== "event_decision" && record.source !== "world_catalyst") {
      reject(`${at}.source`, "structural-contradiction", `unknown decision source ${JSON.stringify(record.source)}`);
    }
    if (sourceSchema === "0.2" && record.source === "world_catalyst") {
      reject(`${at}.source`, "structural-contradiction", "0.2 predates catalyst resolutions");
    }
    if (record.schemaVersion !== 1) reject(`${at}.schemaVersion`, "unsupported-version", "expected decision record version 1");
    for (const field of ["choiceId", "policyVersion"] as const) {
      if (typeof record[field] !== "string" || record[field] === "") reject(`${at}.${field}`, "wrong-type", "expected a nonempty persisted string");
    }
    if (record.source === "event_decision" && (typeof record.sourceEventId !== "string" || record.sourceEventId === "")) {
      reject(`${at}.sourceEventId`, "structural-contradiction", "an event decision needs its event ID");
    }
    if (record.source === "world_catalyst" && record.sourceEventId !== null) {
      reject(`${at}.sourceEventId`, "structural-contradiction", "a catalyst resolution cannot claim an event ID");
    }
    if (record.offerTick !== undefined && !isFiniteNumber(record.offerTick)) reject(`${at}.offerTick`, "wrong-type", "expected a finite offer tick");
    if (record.offerTick === undefined && sourceSchema !== "0.2") reject(`${at}.offerTick`, "wrong-type", "this schema wrote the offer tick");
    if (record.catalystId === undefined && sourceSchema !== "0.2") {
      reject(`${at}.catalystId`, "malformed-container", "this schema wrote the catalyst ID or null");
    }
    if (record.intervention !== null && (!isPlainObject(record.intervention) || record.intervention.schemaVersion !== 1 ||
      record.intervention.kind !== "nutrient_disturbance" || !["global_crash", "drought_a", "drought_b", "c_washout"].includes(record.intervention.mode as string))) {
      reject(`${at}.intervention`, "unsupported-tag", "unknown persisted intervention");
    }
    for (const field of ["choiceTitle", "directEffectDescription"] as const) {
      if (record[field] === undefined && sourceSchema === "0.2") continue;
      if (typeof record[field] !== "string" || record[field] === "") {
        reject(`${at}.${field}`, "wrong-type", "expected saved wording or the explicit unrecorded marker");
      }
    }
    // A catalyst resolution may or may not name a catalyst: a catalyst window
    // also offers the leave-unchanged choice, whose `catalystId` is null. An
    // event resolution can never name one, and a named catalyst must exist in
    // the persisted catalog. Both directions are contradictions, refused on
    // every schema rather than defaulted either way.
    if (record.source === "event_decision" && record.catalystId !== undefined && record.catalystId !== null) {
      reject(`${at}.catalystId`, "structural-contradiction", "an event decision cannot name a catalyst");
    }
    if (record.catalystId !== undefined && record.catalystId !== null &&
      !["drought-a", "drought-b", "global-crash", "c-washout"].includes(record.catalystId as string)) {
      reject(`${at}.catalystId`, "structural-contradiction", "unknown catalyst identity");
    }
  });
}


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
  /** The exact bounded context the policy saw. Null only for a re-saved
   * pre-0.3 pending opportunity, whose context was not persisted; never
   * re-derived from the current world. */
  readonly contextSnapshot: DecisionContext | null;
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

// impl: REQ-EXPORT-001 (resumable checkpoints are a separate contract from evidence exports)
/**
 * The current resumable checkpoint. Schema 0.4.
 *
 * Carries catalyst windows and pacing state as 0.3 did, and additionally
 * guarantees the fields that arrived *during* 0.3 — `Organism.pc`,
 * `Simulation.lastLineageFlows` and `Simulation.lineageInterval`, the C-use and
 * niche sub-states, and tagged entity references. Those are the fields 0.3
 * could not promise, which is the whole reason for this version.
 */
export interface UniverseCheckpoint {
  readonly checkpointSchemaVersion: "0.4";
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

/**
 * Schema 0.3 as first written. **Not one shape.** Several fields the current
 * build requires arrived while the schema was already 0.3 — `Organism.pc`,
 * `Simulation.lastLineageFlows` and `Simulation.lineageInterval` on 2026-09-25,
 * the C-use and niche sub-states the same week, and tagged entity references
 * with A2 — so a 0.3 save from the start of that version and a 0.3 save from the
 * end of it differ in fields the current contract requires. That is why 0.4
 * exists: a strict current contract cannot be expressed by reinterpreting a
 * version that already named two shapes.
 */
export interface UniverseCheckpointV03 {
  readonly checkpointSchemaVersion: "0.3";
  readonly engineVersion: string;
  readonly createdTick: number;
  readonly experiment: unknown;
  readonly analysis: unknown;
  readonly control: unknown;
  readonly controlAnalysis: unknown;
  /** Same decision shape as the current contract: 0.3 predates the strict
   *  *checkpoint* contract, not the decision record. */
  readonly decisions: DecisionCheckpoint;
}

export type SupportedUniverseCheckpoint =
  | UniverseCheckpoint
  | UniverseCheckpointV03
  | UniverseCheckpointV02
  | LegacyUniverseCheckpoint;

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
