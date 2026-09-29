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
    id: "major-catalyst-tick-predates-cooldown",
    path: "decisions.lastMajorCatalystTick",
    appliesToSchemas: ["0.1", "0.2"],
    effectiveDefault: "null",
    absorber: "structural-branch",
    omission:
      "The major-catalyst cooldown did not exist before checkpoint 0.3, so a 0.1 or 0.2 save carries no value for this field. `null` is the truth about such a world rather than a permissive substitute: the mechanic had not yet been introduced, so no major catalyst had ever fired.",
    hazard: "load-bearing-dynamics",
    historicalBasis:
      "`lastMajorCatalystTick` was introduced with checkpoint 0.3 in b040b19 on 2026-09-24, alongside the cooldown. The 0.2 decision checkpoint at b39fd46 writes only `pending`, `resolutions` and `policyVersion` — zero occurrences of this field — so the absence is a fact about what those builds wrote. 0.3 is deliberately NOT in scope: b040b19 does write this field, so preserving a 0.3 value is a restore correction rather than a historical absence, and is handled in `restore`.",
    dynamicsJustification:
      "This is the one retained rule that gates the world, so the default is the value that preserves the prior behaviour rather than the one that looks neutral. `null` means \"no major catalyst has ever fired\" and therefore reads as cooldown-clear, which is the correct reading for a world from before the mechanic existed. The default is therefore safe precisely because it is historically true, and never because absence is presumed harmless. A *present* value is a different case at every schema: it is validated, never defaulted, so a corrupt one is refused rather than cleared into a permission.",
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
    id: "decision-resolution-source-reads-as-event-decision",
    path: "decisions.resolutions[].source",
    appliesToSchemas: ["0.2"],
    effectiveDefault: '"event_decision"',
    absorber: "inline-backfill",
    omission:
      "Before the source field existed, every resolution was an event decision. Naming it is a restatement of the era, not a classification of the record.",
    hazard: "load-bearing-display",
    historicalBasis:
      "`source` on a resolution was introduced with 0.3 in b040b19. Every 0.2 resolution predates the field and was an event decision.",
  },
  {
    id: "analysis-substate-absent-reads-as-constructor-default",
    path: "analysis.{crossfeeding,seed_bank,era,cuse_guild,niche_construction,records,eras}",
    appliesToSchemas: PRE_CURRENT_SCHEMAS,
    effectiveDefault: "the freshly constructed observer's own initial state",
    absorber: "constructor-default",
    omission:
      "Restore constructs a fresh observer and then overwrites only the keys the payload carries, so an absent sub-state keeps its declared initial value instead of becoming undefined. A detector that has not yet fired genuinely has no sub-state, which is different from a detector that fired and lost its record.",
    rejects:
      "A present-but-wrong-typed sub-state is not covered by this rule. `Object.assign` writes whatever it is handed, so a corrupt value becomes live state rather than being defaulted — which is the opposite failure from normalisation, and is why the validator has to refuse it rather than rely on the constructor.",
    hazard: "load-bearing-dynamics",
    dynamicsJustification:
      "Absence is meaningful: a detector that has not fired has no sub-state, and that is the same world as one whose records were empty. Critically, this default *removes* a capability rather than granting one — an observer with no records raises no event, so the pause gate stays shut. The hazard is the opposite case and is why `rejects` exists: a wrong-typed sub-state is written into live state by `Object.assign` and can then raise a gate the analysis never earned.",
    historicalBasis:
      "The detector sub-states did not all arrive at once: `cuse_guild` came in 064d727 on 2026-09-25 and `niche_construction` in af9ad23 on 2026-09-26, both after the 0.3 bump of 2026-09-24. `seed_bank` predates every version, but one 0.3 save can predate either later detector, so a single rule covers the group.",
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


/* ------------------------------------------------------------------ *
 * Checkpoint rejection.
 *
 * The allow-list has an inverse, and this is it. The ten rules say what may be
 * absent; everything else that the current schema requires must be *present and
 * of the right type*, or the save is refused.
 *
 * Two properties matter more than the individual checks.
 *
 * It runs **after** migration. A save that migrates cleanly must not be caught
 * by a pre-migration check, or compatibility is broken by the very mechanism
 * meant to preserve it.
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

/**
 * Refuse a checkpoint the current schema cannot accept.
 *
 * **Strict requirements apply to the current schema (`0.4`) only.** Every
 * earlier version is checked for a known version and a usable container, and
 * nothing more — their omissions are the migration rules' business, and
 * holding them to today's requirements would refuse exactly the saves
 * Decision 2 exists to protect.
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
  if (!isPlainObject(checkpoint.experiment)) {
    reject("experiment", "malformed-container", "missing or not a simulation checkpoint object");
  }

  // An unrecognised tag would otherwise be decoded as a plain object, which is
  // the one rejection gap with no existing throw behind it.
  const seen = new Set<unknown>();
  const walk = (node: unknown, path: string): void => {
    if (!isPlainObject(node) || seen.has(node)) return;
    seen.add(node);
    const tag = (node as Record<string, unknown>)[CHECKPOINT_TAG_KEY];
    if (tag === undefined) {
      for (const [key, value] of Object.entries(node)) walk(value, `${path}.${key}`);
      return;
    }
    if (typeof tag !== "string" || !CHECKPOINT_TAGS.includes(tag)) {
      reject(path, "unsupported-tag", `unrecognised checkpoint tag ${JSON.stringify(tag)}`);
    }
  };
  walk(checkpoint.experiment, "experiment");

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
   * The two were previously conflated, because one early return guarded both.
   * A rule governing absence read as though it also governed validity, and a
   * 0.1-0.3 save carrying a malformed container or a contradictory decision
   * record reached `restore`. So: presence below is current-only, and validity
   * applies to whatever is present at any schema.
   */
  const decisions = checkpoint.decisions;
  if (decisions !== undefined && !isPlainObject(decisions)) {
    reject("decisions", "malformed-container", `expected a decisions object, got ${describe(decisions)}`);
  }
  if (decisions !== undefined) {
    validateDecisionRecords(decisions as Record<string, unknown>);
  }
  const analysis = checkpoint.analysis;
  if (analysis !== undefined && !isPlainObject(analysis)) {
    reject("analysis", "malformed-container", `expected an analysis object, got ${describe(analysis)}`);
  }
  if (analysis !== undefined && (analysis as Record<string, unknown>).records !== undefined) {
    if (!Array.isArray((analysis as Record<string, unknown>).records)) {
      reject("analysis.records", "malformed-container", `expected a records array, got ${describe((analysis as Record<string, unknown>).records)}`);
    }
  }
  if (checkpoint.control !== undefined && checkpoint.control !== null && !isPlainObject(checkpoint.control)) {
    reject("control", "wrong-type", `expected null or a control checkpoint object, got ${describe(checkpoint.control)}`);
  }
  if (schema !== "0.4") return;

  // Presence. Every field below is required of a current save and may be
  // absent in an older one, which is what the rules above record.
  if (!isPlainObject(decisions)) {
    reject("decisions", "malformed-container", "current schema requires a decisions object");
  }
  if (!Array.isArray((decisions as Record<string, unknown>).resolutions)) {
    reject("decisions.resolutions", "malformed-container", `expected an array, got ${describe((decisions as Record<string, unknown>).resolutions)}`);
  }
  if (!isPlainObject(analysis)) {
    reject("analysis", "malformed-container", "current schema requires an analysis object");
  }
  if (!Array.isArray((analysis as Record<string, unknown>).records)) {
    reject("analysis.records", "malformed-container", "current schema requires a records array");
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
function validateDecisionRecords(decisions: Record<string, unknown>): void {
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
