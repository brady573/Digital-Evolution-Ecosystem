/**
 * M3 event-decision validation.
 *
 * Proves the decision architecture end to end against the real engine: policy
 * purity, the runtime pause gate (including mid-chunk), choice resolution,
 * control-fork separation, checkpoint round-trip, legacy 0.1 migration,
 * evidence separation, and deterministic replay.
 *
 * Reaching the crossfeeding-established event takes tens of thousands of ticks,
 * so the suite builds ONE real fixture checkpoint and restores it per case
 * instead of re-deriving it. Restoring is also the heavily exercised path.
 *
 * Run: pnpm test:decisions
 */
import assert from "node:assert/strict";
import type {
  CatalystOpportunity,
  DecisionOpportunity,
  DecisionResolution,
  EngineConfig,
  InterventionSpec,
  SupportedUniverseCheckpoint,
  UniverseCheckpoint,
} from "../../packages/contracts/src/index.ts";
import { ENGINE_VERSION, EVENT_STRIDE } from "../../packages/sim-core/src/index.ts";
import { UniverseSession, CHECKPOINT_SCHEMA_VERSION } from "../../packages/sim-runtime/src/session.ts";
import {
  CATALYST_POLICY_VERSION,
  DECISION_POLICY_VERSION,
  buildDecisionOpportunity,
  engineCatalystModeFor,
  isDecisionEligible,
  isSupportedIntervention,
  mappedPolicyKeys,
} from "../../packages/sim-decisions/src/index.ts";

/**
 * Balanced keeps the population small enough for a CI-sized run while still
 * reaching mapped events. Seed 24681357 yields three natural decisions
 * (dormancy, then crossfeeding, then era formation); the config is a config
 * choice only, never an engine change.
 */
const FIXTURE_SEED = 24681357;
const config = (seed: number): EngineConfig => ({
  seed,
  start: 0.58,
  prod: 0.77,
  cap: 360,
  pop: 30,
  div: 0.35,
  mr: 0.03,
  ms: 0.12,
  press: 1.0875,
  patch: 0.6,
  resource_b_fraction: 0.5,
  cat: "global",
  st: null,
  resource_model: "definition_driven_substances",
  resource_grid: 60,
  enable_byproduct: true,
  enable_dormancy: true,
  study: true,
});

const NUTRIENT_SPECS: Record<string, InterventionSpec> = {
  global_crash: { schemaVersion: 1, kind: "nutrient_disturbance", mode: "global_crash" },
  drought_a: { schemaVersion: 1, kind: "nutrient_disturbance", mode: "drought_a" },
  drought_b: { schemaVersion: 1, kind: "nutrient_disturbance", mode: "drought_b" },
};

/** One long run, cached: a real universe paused on its decision. */
let fixtureCache: UniverseCheckpoint | null = null;
function fixture(): UniverseCheckpoint {
  if (fixtureCache) return JSON.parse(JSON.stringify(fixtureCache)) as UniverseCheckpoint;
  const session = new UniverseSession();
  session.create(config(FIXTURE_SEED));
  // A single oversized request: the gate must stop it at the trigger tick.
  const snapshot = session.advance(120_000);
  assert.ok(snapshot.pendingDecision, "fixture universe reached a decision opportunity");
  fixtureCache = session.checkpoint();
  return JSON.parse(JSON.stringify(fixtureCache)) as UniverseCheckpoint;
}

/** A fresh session restored from the fixture, paused on the same decision. */
function atDecision(): { session: UniverseSession; pending: DecisionOpportunity } {
  const session = new UniverseSession();
  const snapshot = session.restore(fixture());
  const pending = snapshot.pendingDecision as DecisionOpportunity;
  assert.ok(pending, "restored fixture has a pending decision");
  return { session, pending };
}

// --- A2/A3: policy layer is pure, versioned, extensible, unmapped-safe --------

function testPolicyLayer() {
  assert.deepEqual(
    mappedPolicyKeys(),
    ["crossfeeding:established", "dormancy:established", "era:established"],
    "durable formations are mapped; transitions stay ordinary history",
  );
  const event = {
    schemaVersion: 1 as const,
    eventId: "eco-crossfeeding-1-established-55000",
    arcId: "eco-crossfeeding-1",
    kind: "crossfeeding",
    phase: "established",
    tick: 55_000,
    level: "major",
    title: "Metabolic recycling became established",
    summary: "5% of recent living energy history comes from biologically produced Metabolite C.",
    evidence: { c_energy_share: 0.05, crossfeeder_fraction: 0.06 },
    entityRefs: [],
  };
  const context = {
    tick: 55_000,
    population: 4000,
    dormantPopulation: 1000,
    cEnergyShare: 0.05,
    crossfeederFraction: 0.06,
  };
  assert.equal(isDecisionEligible(event), true, "mapped event is decision-eligible");
  const opportunity = buildDecisionOpportunity(event, context)!;
  assert.ok(opportunity, "mapped event produces an opportunity");
  assert.equal(opportunity.opportunityId, "dop:eco-crossfeeding-1-established-55000", "deterministic opportunity id");
  assert.equal(opportunity.status, "pending", "opportunity starts pending");
  assert.equal(opportunity.choices.length, 4, "keep watching plus the three current interventions");
  assert.equal(opportunity.choices[0]!.intervention, null, "leave-unchanged is offered first");
  assert.deepEqual(
    opportunity.choices.map((c) => c.intervention?.mode ?? null),
    [null, "drought_a", "drought_b", "global_crash"],
    "choices map onto the existing three effects",
  );
  assert.equal(
    JSON.stringify(buildDecisionOpportunity(event, context)),
    JSON.stringify(opportunity),
    "policy output is deterministic",
  );
  assert.equal(isDecisionEligible({ ...event, phase: "disrupted" }), false, "unmapped transition is not decision-eligible");
  assert.equal(
    buildDecisionOpportunity({ ...event, phase: "disrupted" }, context),
    null,
    "unmapped transition yields no opportunity",
  );
  assert.equal(
    isDecisionEligible({ ...event, kind: "dormancy", phase: "established" }),
    true,
    "dormancy formation is decision-eligible",
  );
  assert.equal(
    isDecisionEligible({ ...event, kind: "era", phase: "established" }),
    true,
    "era formation is decision-eligible",
  );
  // Copy must not promise outcomes.
  for (const choice of opportunity.choices) {
    const text = `${choice.title} ${choice.directEffectDescription}`.toLowerCase();
    for (const forbidden of ["save", "help", "punish", "favor", "eliminate", "survive", "win", "guarantee"]) {
      assert.ok(!text.includes(forbidden), `choice copy avoids outcome language: "${text}"`);
    }
  }
  for (const [mode, spec] of Object.entries(NUTRIENT_SPECS)) {
    assert.equal(isSupportedIntervention(spec), true, `${mode} is supported`);
    assert.equal(
      engineCatalystModeFor(spec),
      mode === "global_crash" ? "global" : mode === "drought_a" ? "droughtA" : "droughtB",
      `${mode} maps to the existing engine mode`,
    );
  }
  assert.equal(isSupportedIntervention(null), true, "null intervention (leave unchanged) is valid");
  assert.equal(
    isSupportedIntervention({ schemaVersion: 2, kind: "nutrient_disturbance", mode: "drought_a" } as any),
    false,
    "unknown spec version is rejected",
  );
  console.log("policy layer: PASS");
}

// --- A4/A5/A6: vertical slice + pause gate -----------------------------------

function testVerticalSliceAndGate() {
  // A5, on the one real run: the oversized request stopped at the trigger tick.
  const f = fixture();
  assert.equal(f.createdTick % EVENT_STRIDE, 0, "stopped exactly on the observation boundary");

  const { session, pending } = atDecision();
  const triggerTick = session.snapshot().tick;
  assert.equal(pending.createdTick, triggerTick, "opportunity created at the current tick");
  assert.equal(
    pending.sourceEventId,
    "eco-seedbank-1-established-7530",
    "first decision comes from the earliest durable formation (deterministic)",
  );
  // The policy saw the same context the evidence supports: contextSnapshot must
  // match the triggering observed event, not zeros from a wrong metrics path.
  const exported = session.exportEvidence() as any;
  const triggering = (exported.observed_events as any[]).find((e: any) => e.eventId === pending.sourceEventId);
  assert.ok(triggering, "triggering observed event is exported");
  assert.equal(
    pending.contextSnapshot.cEnergyShare,
    (triggering.evidence as any).c_energy_share,
    "context c_energy_share matches triggering evidence",
  );
  assert.equal(
    pending.contextSnapshot.crossfeederFraction,
    (triggering.evidence as any).crossfeeder_fraction,
    "context crossfeeder_fraction matches triggering evidence",
  );
  assert.ok(pending.contextSnapshot.cEnergyShare > 0, "context is real observed state, not a zero default");
  const stateAtTrigger = JSON.stringify(session.checkpoint().experiment);

  // A6: while pending, no advance or run-to-event may change anything.
  for (let i = 0; i < 5; i++) {
    assert.equal(session.advance(500).tick, triggerTick, "pending gate blocks ADVANCE_TICKS");
  }
  assert.equal(session.runToNextEvent(5_000).tick, triggerTick, "pending gate blocks RUN_TO_NEXT_EVENT");
  assert.equal(
    JSON.stringify(session.checkpoint().experiment),
    stateAtTrigger,
    "pending gate leaves state exactly unchanged",
  );
  assert.equal(session.snapshot().pendingDecision?.opportunityId, pending.opportunityId, "opportunity stays pending");

  // A7: Keep watching records the decision, applies nothing, advances nothing.
  const resolved = session.resolveEventDecision(pending.opportunityId, "keep-watching");
  assert.equal(resolved.tick, triggerTick, "resolution advances zero ticks");
  assert.equal(resolved.pendingDecision, null, "pending opportunity cleared");
  assert.equal(resolved.control, null, "keep watching creates no control fork");
  assert.equal(session.decisionResolutions.length, 1, "one command recorded");
  assert.equal(session.decisionResolutions[0]!.intervention, null, "no intervention applied");
  assert.equal(session.decisionResolutions[0]!.source, "event_decision", "recorded as an event decision");
  assert.equal(session.decisionResolutions[0]!.sourceEventId, pending.sourceEventId, "command links to the source event");
  // History renders from the recorded copy, so it cannot drift from the offer.
  assert.equal(session.decisionResolutions[0]!.choiceTitle, "Keep watching", "resolution records the offered title");
  assert.equal(
    session.decisionResolutions[0]!.directEffectDescription,
    "Change nothing. The world stays exactly as it is.",
    "resolution records the offered effect text",
  );

  // Validation: mismatched or unknown choices are refused.
  const other = atDecision();
  assert.throws(
    () => other.session.resolveEventDecision("dop:wrong", "keep-watching"),
    /does not match/,
    "wrong opportunity refused",
  );
  assert.throws(
    () => other.session.resolveEventDecision(other.pending.opportunityId, "nope"),
    /does not belong/,
    "unknown choice refused",
  );
  assert.equal(other.session.snapshot().pendingDecision?.opportunityId, other.pending.opportunityId, "refused resolution leaves it pending");
  assert.equal(other.session.snapshot().tick, triggerTick, "refused resolution advances nothing");
  console.log("vertical slice + pause gate: PASS");
}

// --- Forward compatibility: old checkpoints never mislabel new decisions ----

function testForwardCompatPolicyVersion() {
  // Age a real checkpoint as if saved under an older catalog version.
  const aged = fixture();
  aged.decisions.policyVersion = "m3-events-0.0-ancient";
  aged.decisions.pending = JSON.parse(
    JSON.stringify(aged.decisions.pending).replaceAll(DECISION_POLICY_VERSION, "m3-events-0.0-ancient"),
  );

  const session = new UniverseSession();
  const snap = session.restore(aged);
  const pending = snap.pendingDecision as DecisionOpportunity;
  // The persisted opportunity restores exactly as stored, old version included.
  assert.deepEqual(pending, aged.decisions.pending, "persisted pending restores unchanged");
  // But the session generator is the running code, never the stored version.
  assert.equal(
    session.checkpoint().decisions.policyVersion,
    DECISION_POLICY_VERSION,
    "generator version is current after restoring an old checkpoint",
  );

  // Resolving the old pending records under the catalog it was offered under.
  session.resolveEventDecision(pending.opportunityId, "keep-watching");
  assert.equal(
    session.decisionResolutions[0]!.policyVersion,
    "m3-events-0.0-ancient",
    "resolution inherits the opportunity's version, not the generator's",
  );

  // A catalyst window now intercedes (quiet satisfied, stocks eligible): it is
  // stamped with the current catalyst catalog, proving new generation is never
  // mislabeled by the aged restore.
  const window = session.advance(120_000).pendingDecision as CatalystOpportunity;
  assert.ok(window, "a catalyst window follows");
  assert.equal(window.source, "world_catalyst", "interceding decision is a catalyst window");
  assert.equal(window.createdTick, 17_570, "first window opens at the first quiet stride");
  assert.equal(window.policyVersion, CATALYST_POLICY_VERSION, "new window stamped current");
  session.resolveEventDecision(window.opportunityId, "keep-watching");
  assert.equal(
    session.decisionResolutions[1]!.policyVersion,
    CATALYST_POLICY_VERSION,
    "window resolution stamped current",
  );

  // The next natural event is stamped with the current policy version, and so
  // is its resolution: no stale labels leak into new decisions or evidence.
  const second = session.advance(120_000).pendingDecision as DecisionOpportunity;
  assert.ok(second, "a second natural decision follows");
  assert.equal(second.sourceEventId, "eco-crossfeeding-1-established-45431", "second decision is deterministic");
  assert.equal(second.policyVersion, DECISION_POLICY_VERSION, "new opportunity stamped current");
  assert.equal(
    second.contextSnapshot.cEnergyShare,
    ((session.exportEvidence() as any).observed_events as any[]).find((e: any) => e.eventId === second.sourceEventId)
      .evidence.c_energy_share,
    "second context matches its triggering evidence",
  );
  session.resolveEventDecision(second.opportunityId, "drought-a");
  assert.equal(
    session.decisionResolutions[2]!.policyVersion,
    DECISION_POLICY_VERSION,
    "new resolution stamped current",
  );
  console.log("forward-compat policy version: PASS");
}

// --- A8/A9: intervention application and control separation -------------------

function testInterventionAndControlSeparation() {
  const { session, pending } = atDecision();
  const beforeTick = session.snapshot().tick;
  const beforeEvents = session.snapshot().events.length;

  const resolved = session.resolveEventDecision(pending.opportunityId, "drought-a");
  assert.equal(resolved.tick, beforeTick, "intervention decision advances zero ticks");
  assert.equal(resolved.pendingDecision, null, "pending cleared");
  assert.equal(resolved.control, null, "event decision creates NO automatic control fork (A8)");
  assert.equal(resolved.events.length, beforeEvents + 1, "the existing engine effect was applied exactly once");
  const resolution = session.decisionResolutions[0] as DecisionResolution;
  assert.deepEqual(resolution.intervention, NUTRIENT_SPECS.drought_a, "exact InterventionSpec recorded");

  // A14: nothing moves on its own afterwards; explicit requests resume time.
  assert.equal(session.snapshot().tick, beforeTick, "no hidden tick after resolution");
  assert.equal(session.advance(1).tick, beforeTick + 1, "an explicit advance resumes time");

  // A9: Experiments keeps matched-control behavior through the same path.
  const experiments = new UniverseSession();
  experiments.create(config(FIXTURE_SEED));
  const viaExperiments = experiments.intervene("droughtA");
  assert.ok(viaExperiments.control, "Experiments intervention still creates its matched control");
  assert.equal(viaExperiments.control!.tick, viaExperiments.tick, "control forked at the same tick");
  assert.equal(viaExperiments.control!.population, viaExperiments.population, "control starts as an exact twin");
  console.log("intervention + control separation: PASS");
}

// --- A10/A11: checkpoint round-trip and legacy migration ---------------------

function testCheckpointRoundTripAndMigration() {
  const live = atDecision();
  const savedPending = live.session.checkpoint();
  assert.equal(savedPending.checkpointSchemaVersion, CHECKPOINT_SCHEMA_VERSION, "new checkpoints use the successor schema");
  assert.equal(savedPending.decisions.pending?.opportunityId, live.pending.opportunityId, "pending opportunity persisted");

  const restored = new UniverseSession();
  const restoredSnapshot = restored.restore(savedPending);
  assert.deepEqual(
    restoredSnapshot.pendingDecision,
    live.pending,
    "restored pending decision is identical (same choices, no re-evaluation)",
  );
  assert.equal(restoredSnapshot.tick, live.pending.createdTick, "restored at the same tick");
  assert.equal(restored.advance(1_000).tick, live.pending.createdTick, "gate survives restore");

  // Resolved history survives.
  live.session.resolveEventDecision(live.pending.opportunityId, "keep-watching");
  const savedResolved = live.session.checkpoint();
  const restoredResolved = new UniverseSession();
  restoredResolved.restore(savedResolved);
  assert.equal(restoredResolved.decisionResolutions.length, 1, "resolution history restored");
  assert.equal(restoredResolved.decisionResolutions[0]!.choiceId, "keep-watching", "resolved choice restored");
  assert.equal(restoredResolved.pendingDecision, null, "no pending decision after a resolved save");

  // A11: legacy 0.1 checkpoints still load, migrated forward.
  const legacyCheckpoint: SupportedUniverseCheckpoint = {
    checkpointSchemaVersion: "0.1",
    engineVersion: savedPending.engineVersion,
    createdTick: savedPending.createdTick,
    experiment: savedPending.experiment,
    analysis: savedPending.analysis,
    control: savedPending.control,
    controlAnalysis: savedPending.controlAnalysis,
  };
  const migrated = new UniverseSession();
  const migratedSnapshot = migrated.restore(legacyCheckpoint);
  assert.equal(migratedSnapshot.tick, savedPending.createdTick, "legacy checkpoint restores its exact tick");
  assert.equal(migratedSnapshot.pendingDecision, null, "migrated restore has no pending opportunity");
  assert.deepEqual(migrated.decisionResolutions, [], "migrated restore has an empty command history");
  assert.equal(migrated.advance(5).tick, savedPending.createdTick + 5, "migrated checkpoint is fully usable");
  assert.throws(
    () => migrated.restore({ ...legacyCheckpoint, checkpointSchemaVersion: "9.9" } as any),
    /Unsupported runtime checkpoint schema/,
    "unknown schema refused rather than guessed",
  );
  console.log("checkpoint round-trip + migration: PASS");
}

// --- A12: evidence keeps observation and action separate ---------------------

function testEvidenceSeparation() {
  const { session, pending } = atDecision();
  session.resolveEventDecision(pending.opportunityId, "drought-b");
  const evidence = session.exportEvidence() as any;
  assert.equal(Array.isArray(evidence.observed_events), true, "export includes observed events");
  assert.ok(
    evidence.observed_events.some((e: any) => e.eventId === pending.sourceEventId),
    "the triggering observed event is exported",
  );
  assert.equal(evidence.player_decisions.resolutions.length, 1, "export includes the player command");
  assert.deepEqual(evidence.player_decisions.resolutions[0].intervention, NUTRIENT_SPECS.drought_b, "exact intervention spec exported");
  assert.equal(evidence.player_decisions.resolutions[0].tick, pending.createdTick, "resolution tick exported");
  assert.equal(evidence.player_decisions.policy_version, DECISION_POLICY_VERSION, "policy version exported");
  assert.ok(evidence.player_decisions.checkpoint_schema_version, "checkpoint schema version exported");
  assert.equal(evidence.matched_control, null, "no control fork is claimed for an event decision");
  console.log("evidence separation: PASS");
}

// --- Determinism: same seed/config + same command sequence => same result -----

function testDeterministicReplay() {
  const derive = () => {
    const session = new UniverseSession();
    session.create(config(FIXTURE_SEED));
    const snapshot = session.advance(120_000);
    const pending = snapshot.pendingDecision as DecisionOpportunity;
    assert.ok(pending, "replay run reached the same decision");
    session.resolveEventDecision(pending.opportunityId, "drought-a");
    session.advance(250);
    return { session, pending, evidence: session.exportEvidence() as any };
  };
  const a = derive();
  const b = derive();
  assert.equal(a.evidence.tick, b.evidence.tick, "replay reaches the same tick");
  assert.equal(a.evidence.current_metrics.population, b.evidence.current_metrics.population, "replay population identical");
  assert.equal(
    JSON.stringify(a.evidence.player_decisions.resolutions),
    JSON.stringify(b.evidence.player_decisions.resolutions),
    "same command sequence yields an identical command record",
  );
  assert.equal(
    JSON.stringify(a.evidence.observed_events.map((e: any) => e.eventId)),
    JSON.stringify(b.evidence.observed_events.map((e: any) => e.eventId)),
    "same observed events in the same order",
  );
  // The replayed trigger must match the fixture-derived decision exactly.
  assert.equal(a.pending.opportunityId, b.pending.opportunityId, "the decision itself is reproducible");
  console.log("deterministic replay: PASS");
}

testPolicyLayer();
testVerticalSliceAndGate();
testForwardCompatPolicyVersion();
testInterventionAndControlSeparation();
testCheckpointRoundTripAndMigration();
testEvidenceSeparation();
testDeterministicReplay();
console.log(`decisions validation: PASS (checkpoint schema ${CHECKPOINT_SCHEMA_VERSION}, engine ${ENGINE_VERSION})`);
