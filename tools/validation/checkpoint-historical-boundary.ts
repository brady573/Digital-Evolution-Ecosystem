import assert from "node:assert/strict";
import { CHECKPOINT_MIGRATION_RULES, CheckpointRejectionError } from "../../packages/contracts/src/index.ts";
import type { EngineConfig } from "../../packages/contracts/src/index.ts";
import {
  validateDecisionRecords,
  validateEntityRefs,
  validateObserverCheckpoint,
} from "../../packages/contracts/src/index.ts";
import { UniverseSession } from "../../packages/sim-runtime/src/session.ts";

const config: EngineConfig = {
  seed: 24681357, start: 0.58, prod: 0.77, cap: 360, pop: 30, div: 0.35,
  mr: 0.03, ms: 0.12, press: 1.0875, patch: 0.6, resource_b_fraction: 0.5,
  cat: "global", st: null, resource_model: "definition_driven_substances",
  resource_grid: 60, enable_byproduct: true, enable_dormancy: true, study: true,
};

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
