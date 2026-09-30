import assert from "node:assert/strict";
import { CHECKPOINT_MIGRATION_RULES, CheckpointRejectionError } from "../../packages/contracts/src/index.ts";
import type { EngineConfig } from "../../packages/contracts/src/index.ts";
import {
  canonicalizeRestoreState,
  validateCanonicalRestoreState,
  validateDecisionRecords,
  validateEntityRefs,
  validateObserverCheckpoint,
} from "../../packages/contracts/src/index.ts";
import type { CanonicalizationContext, CanonicalRestoreCandidate } from "../../packages/contracts/src/index.ts";
import { CHECKPOINT_SCHEMA_VERSION, UniverseSession } from "../../packages/sim-runtime/src/session.ts";

const config: EngineConfig = {
  seed: 24681357, start: 0.58, prod: 0.77, cap: 360, pop: 30, div: 0.35,
  mr: 0.03, ms: 0.12, press: 1.0875, patch: 0.6, resource_b_fraction: 0.5,
  cat: "global", st: null, resource_model: "definition_driven_substances",
  resource_grid: 60, enable_byproduct: true, enable_dormancy: true, study: true,
};

/**
 * A context of the shape sim-runtime supplies. Written out literally here
 * rather than obtained from a running session, because the point of the test
 * is that canonicalisation is a pure function of (source, context) — building
 * the context must not touch RNG, simulation or observer state, and a literal
 * makes that structural rather than incidental.
 */
const canonicalContext = (): CanonicalizationContext => ({
  policyVersion: "events-0.1.0",
  catalystPolicyVersion: "catalysts-0.1.0",
  currentSchema: CHECKPOINT_SCHEMA_VERSION,
  detectorDefaults: {
    dep: {
      id: "eco-cuse-1", state: "absent", candidateSince: null, lowSince: null,
      establishedTick: null, estScav: 0, baselineProduced: 0, topConsumer: null,
      topConsumerShare: 0,
    },
    niche: {
      id: "eco-niche-1", state: "absent", candidateSince: null, shiftSince: null,
      lowSince: null, establishedTick: null, baseWaste: 0, baseTol: 0, baseCu: 0,
      baseExposed: 0, estWaste: 0, estExposed: 0, wasDisrupted: false,
    },
  },
});

const isPlainObjectForTest = (v: unknown): boolean =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** A 0.3 build wrote this tick; restoring it must not derive another one. */
export function testHistoricalCheckpointBoundary(): void {
  // The preflight and A3.4's canonical validation must share one definition of
  // a valid value. Two definitions would let the boundary lie in two places, so
  // the shared entry points are named here rather than trusted.
  assert.equal(typeof validateObserverCheckpoint, "function", "the observer validator is shared, not duplicated");
  assert.equal(typeof validateDecisionRecords, "function", "the decision validator is shared, not duplicated");
  assert.equal(typeof validateEntityRefs, "function", "the entity-ref validator is shared, not duplicated");

  const reconstructionRule = CHECKPOINT_MIGRATION_RULES.find(
    (rule) => rule.id === "last-decision-tick-reconstructed-from-newest-record",
  );
  assert.deepEqual(reconstructionRule?.appliesToSchemas, ["0.2"],
    "the declared historical omission must not claim 0.1's absent subsystem or 0.3's persisted field");
  assert.deepEqual(
    CHECKPOINT_MIGRATION_RULES.find((rule) => rule.id === "major-catalyst-tick-predates-cooldown")?.appliesToSchemas,
    ["0.2"],
    "0.1 has no decisions container, so its missing cooldown is not a field-level omission",
  );

  const session = new UniverseSession();
  session.create(config);
  for (const field of ["dep", "niche"] as const) {
    assert.ok(
      CHECKPOINT_MIGRATION_RULES.some((rule) => rule.path === `controlAnalysis.${field}` && rule.appliesToSchemas.includes("0.3")),
      `a pre-detector matched-control observer needs its own named ${field} omission rule`,
    );
  }
  session.advance(20);
  assert.ok(session.snapshot().tick >= 17, "the saved decision tick must not be in the future");
  const original: any = JSON.parse(JSON.stringify(session.checkpoint()));
  original.checkpointSchemaVersion = "0.3";
  original.decisions.lastDecisionTick = 17;
  original.decisions.pending = null;
  original.decisions.resolutions = [];

  const restored = new UniverseSession();
  restored.restore(original);
  assert.equal(
    restored.checkpoint().decisions.lastDecisionTick,
    17,
    "a 0.3 checkpoint's persisted decision tick must survive restore, not be recomputed from empty records",
  );

  const missing = JSON.parse(JSON.stringify(original));
  delete missing.decisions.lastDecisionTick;
  assert.throws(
    () => new UniverseSession().restore(missing),
    (e: unknown) => e instanceof CheckpointRejectionError && e.field === "decisions.lastDecisionTick",
    "0.3 wrote the field; omission is not historical",
  );
  for (const schema of ["0.3", "0.4"] as const) {
    const withoutCooldown = JSON.parse(JSON.stringify(original));
    withoutCooldown.checkpointSchemaVersion = schema;
    delete withoutCooldown.decisions.lastMajorCatalystTick;
    assert.throws(
      () => new UniverseSession().restore(withoutCooldown),
      (e: unknown) => e instanceof CheckpointRejectionError && e.field === "decisions.lastMajorCatalystTick",
      `${schema} wrote the cooldown field, even when its value was null`,
    );
  }
  const currentMissingTick = JSON.parse(JSON.stringify(session.checkpoint()));
  delete currentMissingTick.decisions.lastDecisionTick;
  assert.throws(
    () => new UniverseSession().restore(currentMissingTick),
    (e: unknown) => e instanceof CheckpointRejectionError && e.field === "decisions.lastDecisionTick",
    "the current schema wrote the pacing tick too",
  );
  const noDecisions = JSON.parse(JSON.stringify(original));
  delete noDecisions.decisions;
  assert.throws(
    () => new UniverseSession().restore(noDecisions),
    (e: unknown) => e instanceof CheckpointRejectionError && e.field === "decisions",
    "0.3 wrote the decisions container; missing it cannot bypass the field check",
  );
  const invalidCurrentHistorical = JSON.parse(JSON.stringify(original));
  invalidCurrentHistorical.decisions.lastDecisionTick = "bad tick";
  assert.throws(
    () => new UniverseSession().restore(invalidCurrentHistorical),
    (e: unknown) => e instanceof CheckpointRejectionError && e.field === "decisions.lastDecisionTick",
    "a present invalid 0.3 pacing tick is refused, not reconstructed",
  );

  const older = JSON.parse(JSON.stringify(original));
  older.checkpointSchemaVersion = "0.2";
  delete older.decisions.lastDecisionTick;
  delete older.decisions.lastMajorCatalystTick;
  delete older.decisions.catalystPolicyVersion;
  const missingOlderDecisions = JSON.parse(JSON.stringify(older));
  delete missingOlderDecisions.decisions;
  assert.throws(
    () => new UniverseSession().restore(missingOlderDecisions),
    (e: unknown) => e instanceof CheckpointRejectionError && e.field === "decisions",
    "0.2 wrote the decisions container; only 0.1 predates it",
  );
  const olderRestored = new UniverseSession();
  olderRestored.restore(older);
  assert.equal(olderRestored.checkpoint().decisions.lastDecisionTick, 0,
    "0.2 did not write the tick; empty decision history reconstructs zero");

  const withHistory = JSON.parse(JSON.stringify(older));
  withHistory.decisions.resolutions = [{
    schemaVersion: 1, opportunityId: "offered", commandId: "chosen", tick: 9,
    source: "event_decision", sourceEventId: "observed", choiceId: "choice",
    intervention: null, policyVersion: "legacy-policy",
  }];
  const historyRestored = new UniverseSession();
  historyRestored.restore(withHistory);
  assert.equal(historyRestored.checkpoint().decisions.lastDecisionTick, 9,
    "0.2 reconstructs the pacing tick from its persisted decision history, not always zero");

  const missingSource = JSON.parse(JSON.stringify(withHistory));
  delete missingSource.decisions.resolutions[0].source;
  assert.throws(
    () => new UniverseSession().restore(missingSource),
    (e: unknown) => e instanceof CheckpointRejectionError &&
      e.field === "decisions.resolutions[0].source",
    "0.2 wrote resolution.source; its absence was never historical",
  );

  const invalidSource = JSON.parse(JSON.stringify(withHistory));
  invalidSource.decisions.resolutions[0].source = "unknown-source";
  assert.throws(
    () => new UniverseSession().restore(invalidSource),
    (e: unknown) => e instanceof CheckpointRejectionError &&
      e.field === "decisions.resolutions[0].source",
    "a present invalid source is refused even in 0.2",
  );

  const invalid = JSON.parse(JSON.stringify(older));
  invalid.decisions.lastDecisionTick = "bad tick";
  assert.throws(
    () => new UniverseSession().restore(invalid),
    (e: unknown) => e instanceof CheckpointRejectionError && e.field === "decisions.lastDecisionTick",
    "a present invalid value is refused even where the field may be absent",
  );

  const oldest = JSON.parse(JSON.stringify(older));
  oldest.checkpointSchemaVersion = "0.1";
  delete oldest.decisions;
  const oldestRestored = new UniverseSession();
  oldestRestored.restore(oldest);
  assert.equal(oldestRestored.checkpoint().decisions.lastDecisionTick, 0,
    "a pre-decision-system world starts with no pacing history");

  // Each build since 0.2 wrote both keys even when no decision was pending or
  // resolved. Missing is not the same as the persisted null / empty array.
  for (const [schema, payload] of [
    ["0.2", older], ["0.3", original], ["0.4", session.checkpoint()],
  ] as const) {
    for (const field of ["pending", "resolutions"] as const) {
      const missingField: any = JSON.parse(JSON.stringify(payload));
      delete missingField.decisions[field];
      assert.throws(
        () => new UniverseSession().restore(missingField),
        (e: unknown) => e instanceof CheckpointRejectionError && e.field === `decisions.${field}`,
        `schema ${schema} wrote decisions.${field}; absence has no historical rule`,
      );
    }
  }

  // Every runtime writer from d86ddfe onward emits these outer keys, even
  // when the control pair is null. No historical absence rule covers them.
  for (const [schema, payload] of [
    ["0.1", oldest], ["0.2", older], ["0.3", original], ["0.4", session.checkpoint()],
  ] as const) {
    for (const field of ["engineVersion", "createdTick", "experiment", "analysis", "control", "controlAnalysis"] as const) {
      const missingField: any = JSON.parse(JSON.stringify(payload));
      delete missingField[field];
      assert.throws(
        () => new UniverseSession().restore(missingField),
        (e: unknown) => e instanceof CheckpointRejectionError && e.field === field,
        `${schema} wrote ${field} even if its value was null`,
      );
    }
  }

  // These two named absence rules must not allow a present malformed value
  // through Object.assign into live observer state on any supported schema.
  for (const schema of ["0.1", "0.2", "0.3", "0.4"] as const) {
    for (const field of ["dep", "niche"] as const) {
      const malformed: any = JSON.parse(JSON.stringify(original));
      malformed.checkpointSchemaVersion = schema;
      if (schema === "0.1") delete malformed.decisions;
      malformed.analysis[field] = "not an observer state";
      assert.throws(
        () => new UniverseSession().restore(malformed),
        (e: unknown) => e instanceof CheckpointRejectionError && e.field === `analysis.${field}`,
        `a present wrong-typed ${field} is invalid even where historical absence is allowed (${schema})`,
      );
    }
  }

  const current: any = JSON.parse(JSON.stringify(session.checkpoint()));
  for (const [path, corrupt] of [
    ["experiment.state.props", (v: any) => { v.experiment.state.props = null; }],
    ["experiment.state.props.o", (v: any) => { v.experiment.state.props.o = "organisms"; }],
    ["experiment.state.props.o[0].pc", (v: any) => { v.experiment.state.props.o[0].pc = "bad"; }],
    ["experiment.state.props.lineageInterval.entries", (v: any) => { v.experiment.state.props.lineageInterval.entries = {}; }],
    ["experiment.state.props.o[0].rogue", (v: any) => { v.experiment.state.props.o[0].rogue = {__digital_evolution_type: "rogue"}; }],
    ["experiment.state.props.resources.props", (v: any) => { v.experiment.state.props.resources = {__digital_evolution_type: "resource-system"}; }],
    ["experiment.state.props.r", (v: any) => { v.experiment.state.props.r = {__digital_evolution_type: "rng", state: "bad"}; }],
  ] as const) {
    const invalid: any = JSON.parse(JSON.stringify(current));
    corrupt(invalid);
    assert.throws(
      () => new UniverseSession().restore(invalid),
      (e: unknown) => e instanceof CheckpointRejectionError && e.field === path,
      `encoded world must reject malformed ${path} before sim-core`,
    );
  }
  // A record's identity and evidence are read models the player investigates,
  // so a malformed one is refused rather than presented.
  const records = current.analysis.records.length;
  const withRecord = (extra: Record<string, unknown>): any => {
    const payload = JSON.parse(JSON.stringify(current));
    payload.analysis.records.push({ entity_refs: [], ...extra });
    return payload;
  };
  for (const [field, value] of [
    ["id", ""], ["arc_id", 4], ["kind", null], ["tick", "later"], ["phase", ""],
    ["level", 2], ["evidence", "frame"], ["summary", null],
  ] as const) {
    const record = { id: "r", arc_id: "a", kind: "k", tick: 1, phase: "p", title: "t", summary: "s", level: "minor", evidence: {}, ...{} };
    (record as Record<string, unknown>)[field] = value;
    const invalid = withRecord(record);
    assert.throws(
      () => new UniverseSession().restore(invalid),
      (e: unknown) => e instanceof CheckpointRejectionError && e.field === `analysis.records[${records}].${field}`,
      `a present invalid record ${field} must be refused`,
    );
  }
  const badEra = JSON.parse(JSON.stringify(current));
  badEra.analysis.eras.push({ id: "e", kind: "era", start_tick: "then", signature: "s", previous_signature: null });
  assert.throws(
    () => new UniverseSession().restore(badEra),
    (e: unknown) => e instanceof CheckpointRejectionError && e.field === `analysis.eras[${current.analysis.eras.length}].start_tick`,
    "a malformed era record must be refused",
  );
  const badRef = withRecord({ id: "bad-ref", arc_id: "a", kind: "k", tick: 1, phase: "p", title: "t", summary: "s", level: "minor", evidence: {}, entity_refs: [{id: 9, kind: "not-a-kind"}] });
  assert.throws(
    () => new UniverseSession().restore(badRef),
    (e: unknown) => e instanceof CheckpointRejectionError &&
      e.field === `analysis.records[${records}].entity_refs[0].kind`,
    "a present invalid ref is not transformed into a supported kind",
  );
  const currentBare = withRecord({ id: "bare-ref", arc_id: "a", kind: "k", tick: 1, phase: "p", title: "t", summary: "s", level: "minor", evidence: {}, entity_refs: [9] });
  assert.throws(
    () => new UniverseSession().restore(currentBare),
    (e: unknown) => e instanceof CheckpointRejectionError &&
      e.field === `analysis.records[${records}].entity_refs[0]`,
    "current bare IDs must not become valid by running migration before preflight",
  );
  const mismatchedControl = JSON.parse(JSON.stringify(current));
  mismatchedControl.control = JSON.parse(JSON.stringify(current.experiment));
  assert.throws(
    () => new UniverseSession().restore(mismatchedControl),
    (e: unknown) => e instanceof CheckpointRejectionError && e.field === "controlAnalysis",
    "the fork writer always emits a matching observer with a control simulation",
  );
  for (const [schema, payload] of [
    ["0.2", older], ["0.3", original], ["0.4", current],
  ] as const) {
    for (const field of schema === "0.2" ? ["policyVersion"] : ["policyVersion", "catalystPolicyVersion"]) {
      const invalid = JSON.parse(JSON.stringify(payload));
      delete invalid.decisions[field];
      assert.throws(
        () => new UniverseSession().restore(invalid),
        (e: unknown) => e instanceof CheckpointRejectionError && e.field === `decisions.${field}`,
        `${schema} wrote ${field} even though restore selects the running generator`,
      );
    }
  }
  const corruptPending = JSON.parse(JSON.stringify(original));
  corruptPending.decisions.pending = {source: "unrecognized", sourceEventId: "event"};
  assert.throws(
    () => new UniverseSession().restore(corruptPending),
    (e: unknown) => e instanceof CheckpointRejectionError && e.field === "decisions.pending.source",
    "an unknown present pending source must not be converted to observed_event",
  );
  const before = session.checkpoint();
  assert.throws(() => session.restore(corruptPending), CheckpointRejectionError);
  assert.deepEqual(session.checkpoint(), before, "a preflight rejection leaves the existing live world unchanged");
  const wrongInnerEngine = JSON.parse(JSON.stringify(current));
  wrongInnerEngine.experiment.engine_version = "different-engine";
  assert.throws(
    () => session.restore(wrongInnerEngine),
    (e: unknown) => e instanceof CheckpointRejectionError && e.field === "experiment.engine_version",
    "an inner engine mismatch is refused before #worldId or the simulation is replaced",
  );
  assert.deepEqual(session.checkpoint(), before, "an inner engine mismatch cannot partially replace a live world");
  for (const schema of ["0.1", "0.2", "0.3", "0.4"] as const) {
    const missingResources = JSON.parse(JSON.stringify(current));
    missingResources.checkpointSchemaVersion = schema;
    if (schema === "0.1") delete missingResources.decisions;
    if (schema === "0.2") {
      delete missingResources.decisions.catalystPolicyVersion;
      delete missingResources.decisions.lastDecisionTick;
      delete missingResources.decisions.lastMajorCatalystTick;
    }
    delete missingResources.experiment.state.props.resources;
    assert.throws(
      () => new UniverseSession().restore(missingResources),
      (e: unknown) => e instanceof CheckpointRejectionError && e.field === "experiment.state.props.resources",
      `the simulation writer has always emitted resources (${schema})`,
    );
  }
  for (const [field, value] of [
    ["study", "yes"], ["rInit", {__digital_evolution_type: "undefined"}],
    ["L", []], ["t", "now"], ["c", null], ["o", {__digital_evolution_type: "undefined"}],
  ] as const) {
    const invalid = JSON.parse(JSON.stringify(current));
    invalid.experiment.state.props[field] = value;
    assert.throws(
      () => new UniverseSession().restore(invalid),
      (e: unknown) => e instanceof CheckpointRejectionError && e.field === `experiment.state.props.${field}`,
      `a present invalid simulation ${field} must not reach sim-core`,
    );
  }

  // Nested simulation state is live state: a wrong-typed or non-finite value
  // there changes physiology or resource accounting rather than presentation,
  // so each class is named explicitly instead of relying on a consumer to fail.
  const resources = (payload: any): any => payload.experiment.state.props.resources.props;
  for (const [field, value] of [
    ["n", "sixty"], ["enabledWaste", 1], ["defs", {}], ["regenBuckets", "none"],
    ["cSink", {end: "soon", factor: 50}], ["cSink", 7],
  ] as const) {
    const invalid = JSON.parse(JSON.stringify(current));
    resources(invalid)[field] = value;
    assert.throws(
      () => new UniverseSession().restore(invalid),
      (e: unknown) => e instanceof CheckpointRejectionError && e.field.startsWith("experiment.state.props.resources"),
      `a present invalid resource ${field} must be refused`,
    );
  }
  for (const field of ["stock", "cap", "input", "totalStock", "diffusionRate", "right"] as const) {
    const invalid = JSON.parse(JSON.stringify(current));
    resources(invalid)[field] = "not a field";
    assert.throws(
      () => new UniverseSession().restore(invalid),
      (e: unknown) => e instanceof CheckpointRejectionError && e.field.startsWith("experiment.state.props.resources"),
      `a present invalid resource field ${field} must be refused`,
    );
  }
  const nonFiniteStock = JSON.parse(JSON.stringify(current));
  resources(nonFiniteStock).stock[0].values[0] = { __digital_evolution_type: "number", value: "NaN" };
  assert.throws(
    () => new UniverseSession().restore(nonFiniteStock),
    (e: unknown) => e instanceof CheckpointRejectionError &&
      e.field === "experiment.state.props.resources.props.stock[0].values[0]",
    "a non-finite resource cell must be refused rather than decoded into live stock",
  );
  const waste = (payload: any): any => resources(payload).waste;
  for (const [field, value] of [["n", null], ["produced", "lots"], ["stock", []], ["decayBuckets", 3]] as const) {
    const invalid = JSON.parse(JSON.stringify(current));
    waste(invalid).props[field] = value;
    assert.throws(
      () => new UniverseSession().restore(invalid),
      (e: unknown) => e instanceof CheckpointRejectionError && e.field.includes(".waste"),
      `a present invalid waste field ${field} must be refused`,
    );
  }
  const organism = (payload: any, field: string, value: unknown): void => {
    const invalid = JSON.parse(JSON.stringify(current));
    invalid.experiment.state.props.o[0][field] = value;
    assert.throws(
      () => new UniverseSession().restore(invalid),
      (e: unknown) => e instanceof CheckpointRejectionError && e.field === `experiment.state.props.o[0].${field}`,
      `a present invalid organism ${field} must be refused`,
    );
  };
  for (const [field, value] of [
    ["en", "hungry"], ["sp", Infinity], ["activity", "sleeping"], ["parent", "one"],
    ["dormantSince", "later"], ["l", null], ["generation", null], ["pc", "lots"],
    ["to", null], ["cu", NaN], ["wakeCount", "many"], ["di", null],
  ] as const) {
    organism(current, field, value);
  }
  for (const schema of ["0.1", "0.2", "0.3"] as const) {
    const historical = JSON.parse(JSON.stringify(current));
    historical.checkpointSchemaVersion = schema;
    if (schema === "0.1") delete historical.decisions;
    if (schema === "0.2") {
      delete historical.decisions.catalystPolicyVersion;
      delete historical.decisions.lastDecisionTick;
      delete historical.decisions.lastMajorCatalystTick;
    }
    for (const field of ["to", "cu"] as const) {
      delete historical.experiment.state.props.o[0][field];
      assert.doesNotThrow(
        () => new UniverseSession().restore(historical),
        `${schema} predates organism ${field}, and that absence is a named historical rule`,
      );
    }
    delete historical.experiment.state.props.o[0].pc;
    assert.doesNotThrow(
      () => new UniverseSession().restore(historical),
      `${schema} predates organism pc, which is a named historical rule`,
    );
  }
  const drought = JSON.parse(JSON.stringify(current));
  drought.experiment.state.props.drought = {kind: 1, end: "later", suppression: 0.85};
  assert.throws(
    () => new UniverseSession().restore(drought),
    (e: unknown) => e instanceof CheckpointRejectionError && e.field === "experiment.state.props.drought.end",
    "a malformed active drought must not resume as a silent suppression",
  );
  const simulate = (payload: any, field: string, value: unknown): void => {
    const invalid = JSON.parse(JSON.stringify(current));
    invalid.experiment.state.props[field] = value;
    assert.throws(
      () => new UniverseSession().restore(invalid),
      (e: unknown) => e instanceof CheckpointRejectionError && e.field.startsWith(`experiment.state.props.${field}`),
      `a present invalid simulation ${field} must be refused`,
    );
  };
  simulate(current, "ev", "none");
  simulate(current, "nh", [{ tick: 1, partitioned: "yes", effective_niches: 2, coverage: 0.5, alignment: null }]);
  simulate(current, "response", { type: "x", tick: "later" });
  simulate(current, "extinctTick", "never");
  simulate(current, "extinctionContext", "gone");
  for (const [interval, field, value] of [
    ["last", "births", "many"], ["cur", "wake_clades", []], ["last", "deaths", null],
  ] as const) {
    const invalid = JSON.parse(JSON.stringify(current));
    invalid.experiment.state.props[interval][field] = value;
    assert.throws(
      () => new UniverseSession().restore(invalid),
      (e: unknown) => e instanceof CheckpointRejectionError &&
        e.field.startsWith(`experiment.state.props.${interval}`),
      `a present invalid ${interval} counter ${field} must be refused`,
    );
  }
  for (const [map, mutate] of [
    ["L", (payload: any) => { payload.experiment.state.props.L.entries[0][1].established = "yes"; }],
    ["L", (payload: any) => { payload.experiment.state.props.L.entries[0][1].mutations = "sp"; }],
    ["L", (payload: any) => { payload.experiment.state.props.L.entries[0][1].parent = "root"; }],
    ["FAM", (payload: any) => { payload.experiment.state.props.FAM.entries[0][1].root_lineage = null; }],
  ] as const) {
    const invalid = JSON.parse(JSON.stringify(current));
    mutate(invalid);
    assert.throws(
      () => new UniverseSession().restore(invalid),
      (e: unknown) => e instanceof CheckpointRejectionError && e.field.startsWith(`experiment.state.props.${map}`),
      `malformed identity provenance in ${map} must be refused`,
    );
  }
  const badTopLevelTag = JSON.parse(JSON.stringify(current));
  badTopLevelTag.experiment.__digital_evolution_type = "not-a-real-tag";
  assert.throws(
    () => new UniverseSession().restore(badTopLevelTag),
    (e: unknown) => e instanceof CheckpointRejectionError && e.reason === "unsupported-tag" && e.field === "experiment",
    "an unrecognised tag on the simulation checkpoint envelope must not be ignored",
  );
  for (const schema of ["0.2", "0.3", "0.4"] as const) {
    const invalid = JSON.parse(JSON.stringify(original));
    invalid.checkpointSchemaVersion = schema;
    invalid.decisions.pending = {
      schemaVersion: 1, opportunityId: "offer", policyVersion: "v1",
      sourceEventId: "event", sourceArcId: null, createdTick: 9,
      status: "pending", prompt: "Prompt", context: "Context", choices: [],
    };
    if (schema !== "0.2") invalid.decisions.pending.source = "observed_event";
    if (schema === "0.2") {
      delete invalid.decisions.lastDecisionTick;
      delete invalid.decisions.lastMajorCatalystTick;
      delete invalid.decisions.catalystPolicyVersion;
    }
    const absent = JSON.parse(JSON.stringify(invalid));
    delete absent.decisions.pending.source;
    if (schema === "0.2") {
      assert.doesNotThrow(() => new UniverseSession().restore(absent), "the 0.2 pending-source rule permits historical absence");
    } else {
      assert.throws(
        () => new UniverseSession().restore(absent),
        (e: unknown) => e instanceof CheckpointRejectionError && e.field === "decisions.pending.source",
        `${schema} wrote pending.source`,
      );
    }
  }
  for (const [path, change] of [
    ["analysis.cross.state", (v: any) => { v.analysis.cross.state = "made-up"; }],
    ["analysis.dep.state", (v: any) => { delete v.analysis.dep.state; }],
    ["analysis.niche.estWaste", (v: any) => { v.analysis.niche.estWaste = Infinity; }],
    ["analysis.seedbank.priorDormantClades", (v: any) => { v.analysis.seedbank.priorDormantClades = []; }],
    ["analysis.era.index", (v: any) => { v.analysis.era.index = "one"; }],
  ] as const) {
    const invalid = JSON.parse(JSON.stringify(current));
    change(invalid);
    assert.throws(
      () => new UniverseSession().restore(invalid),
      (e: unknown) => e instanceof CheckpointRejectionError && e.field === path,
      `present malformed observer state ${path} must not enter Object.assign`,
    );
  }
  const historical02: any = JSON.parse(JSON.stringify(older));
  historical02.decisions.pending = {
    schemaVersion: 1, opportunityId: "historic-offer", policyVersion: "old-catalog",
    sourceEventId: "historic-event", sourceArcId: null, createdTick: 9,
    status: "pending", prompt: "Old prompt", context: "Old context", choices: [],
  };
  historical02.decisions.resolutions = [{
    schemaVersion: 1, opportunityId: "historic-resolved", commandId: "historic-command",
    sourceEventId: "historic-event", choiceId: "historic-choice", tick: 8,
    intervention: null, source: "event_decision", policyVersion: "old-catalog",
  }];
  const oldWorld = new UniverseSession();
  oldWorld.restore(historical02);
  const canonical = oldWorld.checkpoint();
  for (const schema of ["0.3", "0.4"] as const) {
    const invalid = JSON.parse(JSON.stringify(canonical));
    invalid.checkpointSchemaVersion = schema;
    invalid.decisions.pending = null;
    delete invalid.decisions.resolutions[0].catalystId;
    assert.throws(
      () => new UniverseSession().restore(invalid),
      (e: unknown) => e instanceof CheckpointRejectionError && e.field === "decisions.resolutions[0].catalystId",
      `${schema} wrote catalystId even for event decisions as null`,
    );
  }
  assert.equal(canonical.decisions.pending?.contextSnapshot, null,
    "0.2's unsaved context must be marked unrecorded, not fabricated");
  assert.equal(canonical.decisions.resolutions[0]?.choiceTitle, "Not recorded in this save",
    "0.2's unsaved choice wording must never be guessed");
  assert.equal(canonical.decisions.resolutions[0]?.directEffectDescription, "Not recorded in this save");
  assert.doesNotThrow(() => new UniverseSession().restore(JSON.parse(JSON.stringify(canonical))),
    "a historical world re-saved by the current writer must remain loadable");
  const fork = new UniverseSession();
  fork.create(config);
  fork.createControlFork();
  for (const field of ["dep", "niche"] as const) {
    const forkSaved: any = JSON.parse(JSON.stringify(fork.checkpoint()));
    delete forkSaved.controlAnalysis[field];
    assert.throws(
      () => new UniverseSession().restore(forkSaved),
      (e: unknown) => e instanceof CheckpointRejectionError && e.field === `controlAnalysis.${field}`,
      `the current matched observer must write ${field}`,
    );
    forkSaved.checkpointSchemaVersion = "0.3";
    assert.doesNotThrow(() => new UniverseSession().restore(forkSaved),
      `a 0.3 fork predating ${field} retains an empty detector without inventing history`);
    forkSaved.controlAnalysis[field] = "corrupt";
    assert.throws(
      () => new UniverseSession().restore(forkSaved),
      (e: unknown) => e instanceof CheckpointRejectionError && e.field === `controlAnalysis.${field}`,
      `present invalid ${field} is rejected even on a historically optional control observer`,
    );
  }
  // --- A3.4: canonicalisation ------------------------------------------------
  //
  // Canonicalisation is a pure function of (source, context). Every assertion
  // below is about that function alone; no session is involved, because a
  // restore would hide exactly the property being tested here.
  const candidate = canonicalizeRestoreState(historical02 as any, canonicalContext());
  const decisions = candidate.decisions as any;
  assert.equal(decisions.lastDecisionTick, 9, "0.2 pacing reconstructs from the newest tick its own records carry, not the oldest");
  assert.equal(decisions.lastMajorCatalystTick, null, "0.2 predates the cooldown entirely");
  assert.equal(decisions.policyVersion, "events-0.1.0", "generator versions come from the running build, never the save");
  assert.equal(decisions.catalystPolicyVersion, "catalysts-0.1.0", "both catalogs, not just the event one");
  assert.equal(decisions.resolutions[0].choiceTitle, "Not recorded in this save", "0.2 wording is marked unrecorded, not invented");
  assert.equal(decisions.resolutions[0].directEffectDescription, "Not recorded in this save");
  assert.equal(decisions.resolutions[0].offerTick, 8, "0.2 offer tick derives from the resolution's own tick");
  assert.equal(decisions.resolutions[0].catalystId, null, "0.2 predates catalyst decisions");
  assert.ok(isPlainObjectForTest(decisions.pending), "a 0.2 pending survives canonicalisation");
  assert.equal(decisions.pending.source, "observed_event", "a sourceless 0.2 pending normalises to event provenance");
  assert.equal(decisions.pending.contextSnapshot, null, "0.2's unsaved context is marked unrecorded, not fabricated");
  assert.ok(isPlainObjectForTest((candidate.analysis as any).dep), "dep is materialised by canonical migration");
  assert.ok(isPlainObjectForTest((candidate.analysis as any).niche), "niche is materialised by canonical migration");

  // A saved generator version must not win over the running build's.
  const staleGenerator = JSON.parse(JSON.stringify(historical02)) as any;
  staleGenerator.decisions.policyVersion = "retired-catalog";
  staleGenerator.decisions.catalystPolicyVersion = "retired-catalysts";
  assert.equal(
    (canonicalizeRestoreState(staleGenerator, canonicalContext()).decisions as any).policyVersion,
    "events-0.1.0",
    "a retired saved catalog version must not generate future opportunities",
  );

  // Purity: neither the source payload nor the supplied context is written to.
  // Purity is asserted over the WHOLE source payload, not one convenient field.
  // A single-field check would pass even if the decisions object were aliased
  // and rewritten elsewhere.
  //
  // It runs on a PRISTINE copy. Re-using the shared fixture here compares a
  // payload after N canonicalisations against the same payload after N
  // canonicalisations, and a first-pass mutation would already be present on
  // both sides — the check could never fail. Verified: an in-place
  // `normalizeResolution` slipped past this until the source was made fresh.
  const pristine = JSON.parse(JSON.stringify(historical02));
  const beforeWholeSource = JSON.stringify(pristine);
  canonicalizeRestoreState(pristine as any, canonicalContext());
  assert.equal(
    JSON.stringify(pristine),
    beforeWholeSource,
    "canonicalisation must leave an untouched source payload byte-identical",
  );
  assert.equal((pristine.decisions as any).lastDecisionTick, undefined, "and specifically must not write the pacing tick into it");
  assert.equal(
    (pristine.decisions as any).resolutions[0].offerTick,
    undefined,
    "nor backfill an offer tick into the caller's own resolution record",
  );
  const savedVersion = historical02.decisions.policyVersion;
  assert.ok(typeof savedVersion === "string" && savedVersion.length > 0, "the source fixture did carry a saved generator version");
  assert.notEqual(savedVersion, "events-0.1.0", "otherwise this purity check would prove nothing");

  // Purity must hold for the shape that actually took the fast path: entity
  // refs already tagged, so `migrateAnalysisEntityRefs` returns the SAME object
  // reference rather than a copy. Writing the detectors into that reference
  // mutates the caller's payload, which is a real defect and not a theoretical
  // one — it is the late-0.3 shape (tagged refs, no detector sub-state).
  const taggedRefsNoDetectors: any = JSON.parse(JSON.stringify(current));
  taggedRefsNoDetectors.checkpointSchemaVersion = "0.3";
  delete taggedRefsNoDetectors.analysis.dep;
  delete taggedRefsNoDetectors.analysis.niche;
  assert.ok(
    taggedRefsNoDetectors.analysis.records.every((r: any) =>
      (r.entity_refs as unknown[]).every((ref) => ref !== null && typeof ref === "object")),
    "this fixture must have ALREADY-TAGGED refs, or it would not exercise the aliasing path",
  );
  const beforeAnalysis = JSON.stringify(taggedRefsNoDetectors.analysis);
  canonicalizeRestoreState(taggedRefsNoDetectors, canonicalContext());
  assert.equal(
    JSON.stringify(taggedRefsNoDetectors.analysis),
    beforeAnalysis,
    "canonicalisation must not write into the caller's analysis object when refs are already migrated",
  );
  assert.equal(
    (taggedRefsNoDetectors.analysis as any).dep,
    undefined,
    "the source payload must still be missing its detector sub-state after canonicalisation",
  );

  const frozenContext = canonicalContext();
  const beforeContext = JSON.stringify(frozenContext);
  canonicalizeRestoreState(historical02 as any, frozenContext);
  assert.equal(JSON.stringify(frozenContext), beforeContext, "canonicalisation must not mutate the supplied context or its defaults");

  // Idempotence, at the SAME schema. A second pass that relabels the payload to
  // the current schema would flip the historical branch off and never re-run the
  // backfills under test, which is exactly where a recompute-on-second-pass bug
  // would hide. So the schema is held at 0.2 and the canonical output is fed
  // back as a 0.2 source.
  const again02 = canonicalizeRestoreState(
    {
      ...historical02,
      checkpointSchemaVersion: "0.2",
      analysis: candidate.analysis,
      decisions: candidate.decisions,
    } as any,
    canonicalContext(),
  );
  assert.deepEqual(again02.decisions, candidate.decisions,
    "a second 0.2 canonicalisation must not change any backfilled value");
  assert.deepEqual(again02.analysis, candidate.analysis,
    "a second 0.2 canonicalisation must not change the analysis layer");
  // The offered tick is derived from another field, so this is the case where a
  // recompute-on-second-pass bug would actually show up.
  assert.equal(
    (again02.decisions as any).resolutions[0].offerTick,
    decisions.resolutions[0].offerTick,
    "a derived backfill must not re-derive to a different value",
  );
  // And a third pass, to catch a two-cycle that converges only on the second.
  const third02 = canonicalizeRestoreState(
    { ...historical02, checkpointSchemaVersion: "0.2", analysis: again02.analysis, decisions: again02.decisions } as any,
    canonicalContext(),
  );
  assert.deepEqual(third02.decisions, again02.decisions, "a third pass must be stable too, not alternating");

  // Separately: a current-schema source must also be a fixed point, because a
  // world re-saved by the running build and restored again is the common case.
  const currentFixedPoint = canonicalizeRestoreState(current, canonicalContext());
  const secondCurrent = canonicalizeRestoreState(
    { ...current, analysis: currentFixedPoint.analysis, decisions: currentFixedPoint.decisions } as any,
    canonicalContext(),
  );
  assert.deepEqual(secondCurrent.decisions, currentFixedPoint.decisions,
    "canonicalising an already-canonical current payload must be a no-op");

  // 0.1 predates the decision system; the canonical form starts empty.
  const oldestCandidate = canonicalizeRestoreState(oldest as any, canonicalContext());
  const oldestDecisions = oldestCandidate.decisions as any;
  assert.deepEqual(oldestDecisions.resolutions, [], "0.1 starts with no decision history");
  assert.equal(oldestDecisions.pending, null, "0.1 has no pending opportunity");
  assert.equal(oldestDecisions.lastDecisionTick, 0, "0.1 pacing starts at 0");
  assert.equal(oldestDecisions.lastMajorCatalystTick, null, "0.1 has never fired a catalyst");

  // A 0.3 payload keeps its own pacing rather than having it re-derived.
  const preserved03 = canonicalizeRestoreState(original as any, canonicalContext());
  assert.equal(
    (preserved03.decisions as any).lastDecisionTick,
    17,
    "a 0.3 save's own pacing tick must survive canonicalisation, not be re-derived",
  );

  // The detector backfill must reach the restored world. This asserts the
  // OUTCOME, not the path: `EcologyObserver.restore` Object.assigns over a
  // fresh observer, so an absent sub-state would take the constructor default
  // even if the canonical layer were ignored — and the constructor default is
  // the same value the context supplies. No behavioural test can separate the
  // two.
  //
  // The wiring is therefore guaranteed structurally, not by this assertion:
  // sim-runtime no longer imports `migrateAnalysisEntityRefs` at all, so the
  // bypass path cannot be written without adding an import back. This test
  // pins the consequence a player would see — a pre-detector save still opens
  // with a well-formed detector rather than an undefined one.
  const noDetectors: any = JSON.parse(JSON.stringify(current));
  noDetectors.checkpointSchemaVersion = "0.3";
  delete noDetectors.analysis.dep;
  delete noDetectors.analysis.niche;
  const liveRestored = new UniverseSession();
  liveRestored.restore(noDetectors);
  const liveDep = (liveRestored.analysis as any).dep;
  assert.ok(isPlainObjectForTest(liveDep), "a pre-detector save restores with a materialised C-use sub-state");
  assert.equal(liveDep.id, "eco-cuse-1", "the materialised sub-state is the observer's declared initial state");
  assert.equal(liveDep.state, "absent", "a detector that never fired is absent, not established");
  assert.equal(liveDep.estScav, 0, "and carries the declared initial counters");
  assert.equal((liveRestored.analysis as any).niche.id, "eco-niche-1", "the niche sub-state is materialised too");

  // controlAnalysis is null for a world with no fork, and is canonicalised in
  // its own right when one exists.
  assert.equal(candidate.controlAnalysis, null, "a world with no matched control has no control analysis to canonicalise");
  // --- A3.4 Task 3: canonical validation as a narrowing boundary ------------
  //
  // The whole reason the candidate is a separate type: a rule whose canonical
  // default the current contract rejects must be CAUGHT here, not loaded. If
  // canonicalization returned a trusted type, the compiler would be asserting
  // the conclusion this validator exists to test.
  const goodCandidate = candidate as CanonicalRestoreCandidate;
  const badPacing: CanonicalRestoreCandidate = {
    ...goodCandidate,
    decisions: { ...decisions, lastDecisionTick: "not a tick" },
  };
  assert.throws(
    () => validateCanonicalRestoreState(badPacing, canonicalContext()),
    (e: unknown) => e instanceof CheckpointRejectionError && e.field === "decisions.lastDecisionTick",
    "a canonical pacing value the current contract rejects is refused, not defaulted",
  );
  const badWording: CanonicalRestoreCandidate = {
    ...goodCandidate,
    decisions: { ...decisions, resolutions: [{ ...decisions.resolutions[0], choiceTitle: 42 }] },
  };
  assert.throws(
    () => validateCanonicalRestoreState(badWording, canonicalContext()),
    (e: unknown) => e instanceof CheckpointRejectionError && e.field === "decisions.resolutions[0].choiceTitle",
    "a canonical resolution with invalid wording is refused even though the field may be absent historically",
  );
  const missingDetector: CanonicalRestoreCandidate = {
    ...goodCandidate,
    analysis: (() => { const a = JSON.parse(JSON.stringify(candidate.analysis)); delete a.dep; return a; })(),
  };
  assert.throws(
    () => validateCanonicalRestoreState(missingDetector, canonicalContext()),
    (e: unknown) => e instanceof CheckpointRejectionError && e.field === "analysis.dep",
    "the current contract requires a detector the canonical layer is missing",
  );
  const badDetector: CanonicalRestoreCandidate = {
    ...goodCandidate,
    analysis: { ...(JSON.parse(JSON.stringify(candidate.analysis))), dep: "not a state" },
  };
  assert.throws(
    () => validateCanonicalRestoreState(badDetector, canonicalContext()),
    (e: unknown) => e instanceof CheckpointRejectionError && e.field === "analysis.dep",
    "a present but non-object detector is refused in the canonical layer too",
  );

  // The validator is a NARROWING boundary: it returns the validated type, so a
  // caller cannot skip the check by ignoring a return value.
  const validated = validateCanonicalRestoreState(goodCandidate, canonicalContext());
  assert.equal(validated.decisions.lastDecisionTick, 9, "a good candidate narrows to the validated state");
  assert.equal(typeof validated.decisions.resolutions, "object", "and exposes real decision records, not `unknown`");

  // Canonical validation must NOT weaken itself for an older source schema.
  // `currentSchema` identifies the running contract; it is not a mode switch.
  const oldSchemaCandidate: CanonicalRestoreCandidate = {
    ...goodCandidate,
    decisions: { ...decisions, catalystPolicyVersion: "retired-catalog" },
  };
  const stillValidated = validateCanonicalRestoreState(oldSchemaCandidate, canonicalContext());
  assert.equal(
    stillValidated.decisions.catalystPolicyVersion,
    "retired-catalog",
    "canonical validation accepts a persisted generator string whatever its value; it is not a mode switch",
  );

  // A non-object observer must be refused, not spread into an empty one.
  for (const key of ["analysis", "controlAnalysis"] as const) {
    const degenerate: any = JSON.parse(JSON.stringify(historical02));
    degenerate[key] = null;
    const result = canonicalizeRestoreState(degenerate, canonicalContext());
    assert.equal(result[key], null, `a null ${key} must stay null, not become an empty object`);
  }
  const forked = new UniverseSession();
  forked.create(config);
  forked.createControlFork();
  const forkCandidate = canonicalizeRestoreState(forked.checkpoint() as any, canonicalContext());
  assert.ok(isPlainObjectForTest(forkCandidate.controlAnalysis), "a forked world's control analysis is canonicalised too");
  assert.ok(isPlainObjectForTest((forkCandidate.controlAnalysis as any).dep), "the matched observer's dep is materialised as well");

  // The same aliasing check for the matched-control observer.
  const forkPurity: any = JSON.parse(JSON.stringify(forked.checkpoint()));
  delete forkPurity.controlAnalysis.dep;
  delete forkPurity.controlAnalysis.niche;
  const beforeControl = JSON.stringify(forkPurity.controlAnalysis);
  canonicalizeRestoreState(forkPurity, canonicalContext());
  assert.equal(
    JSON.stringify(forkPurity.controlAnalysis),
    beforeControl,
    "the matched observer must not be written into either",
  );

  const invalidContext = JSON.parse(JSON.stringify(historical02));
  invalidContext.decisions.pending.contextSnapshot = "corrupt";
  assert.throws(
    () => new UniverseSession().restore(invalidContext),
    (e: unknown) => e instanceof CheckpointRejectionError && e.field === "decisions.pending.contextSnapshot",
    "a present invalid 0.2 context cannot be excused by its absence rule",
  );
  const inventedCatalyst = JSON.parse(JSON.stringify(historical02));
  inventedCatalyst.decisions.pending.source = "world_catalyst";
  assert.throws(
    () => new UniverseSession().restore(inventedCatalyst),
    (e: unknown) => e instanceof CheckpointRejectionError && e.field === "decisions.pending.source",
    "the 0.2 writer could not have emitted a catalyst pending decision",
  );
  const inventedResolution = JSON.parse(JSON.stringify(historical02));
  inventedResolution.decisions.resolutions[0].source = "world_catalyst";
  assert.throws(
    () => new UniverseSession().restore(inventedResolution),
    (e: unknown) => e instanceof CheckpointRejectionError && e.field === "decisions.resolutions[0].source",
    "the 0.2 writer could not have recorded a catalyst resolution",
  );
  const catalystKeepsWatching = JSON.parse(JSON.stringify(canonical));
  catalystKeepsWatching.decisions.pending = null;
  catalystKeepsWatching.decisions.resolutions = [{
    schemaVersion: 1, opportunityId: "wcat:1", commandId: "wcat-cmd", tick: 3,
    offerTick: 1, sourceEventId: null, choiceId: "keep-watching",
    choiceTitle: "Keep watching", directEffectDescription: "Change nothing.",
    intervention: null, source: "world_catalyst", catalystId: null,
    policyVersion: "catalyst-policy",
  }];
  assert.doesNotThrow(
    () => new UniverseSession().restore(catalystKeepsWatching),
    "a catalyst resolution may legitimately decline to name a catalyst",
  );
  const catalystNamed = JSON.parse(JSON.stringify(catalystKeepsWatching));
  catalystNamed.decisions.resolutions[0].catalystId = "drought-a";
  catalystNamed.decisions.resolutions[0].intervention =
    { schemaVersion: 1, kind: "nutrient_disturbance", mode: "drought_a" };
  assert.doesNotThrow(
    () => new UniverseSession().restore(catalystNamed),
    "a catalyst resolution that applied a catalyst names it",
  );
  const eventNamedCatalyst = JSON.parse(JSON.stringify(historical02));
  eventNamedCatalyst.decisions.resolutions[0].catalystId = "drought-a";
  assert.throws(
    () => new UniverseSession().restore(eventNamedCatalyst),
    (e: unknown) => e instanceof CheckpointRejectionError && e.field === "decisions.resolutions[0].catalystId",
    "an event resolution naming a catalyst is a self-contradicting record",
  );
  for (const [field, value] of [
    ["schemaVersion", 2], ["choiceId", undefined], ["sourceEventId", null],
    ["policyVersion", 42], ["intervention", "yes"], ["offerTick", "later"],
    ["catalystId", "invented-catalyst"],
  ] as const) {
    const invalid = JSON.parse(JSON.stringify(historical02));
    if (value === undefined) delete invalid.decisions.resolutions[0][field];
    else invalid.decisions.resolutions[0][field] = value;
    assert.throws(
      () => new UniverseSession().restore(invalid),
      (e: unknown) => e instanceof CheckpointRejectionError && e.field === `decisions.resolutions[0].${field}`,
      `a present invalid ${field} or a required missing ${field} cannot be defaulted`,
    );
  }
  for (const field of ["choiceTitle", "directEffectDescription"] as const) {
    const invalid = JSON.parse(JSON.stringify(historical02));
    invalid.decisions.resolutions[0][field] = 42;
    assert.throws(
      () => new UniverseSession().restore(invalid),
      (e: unknown) => e instanceof CheckpointRejectionError && e.field === `decisions.resolutions[0].${field}`,
      `even 0.2 cannot save a present invalid ${field}`,
    );
  }
}

if (process.argv[1]?.endsWith("checkpoint-historical-boundary.ts")) {
  testHistoricalCheckpointBoundary();
  console.log("historical checkpoint boundary: PASS");
}
