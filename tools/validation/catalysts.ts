/**
 * M3 world-catalyst validation.
 *
 * Proves the quiet-period catalyst system end to end: pure eligibility
 * boundaries, quiet/cooldown timing, same-tick event priority, the hard pause
 * gate, resolution semantics, control separation, checkpoint round-trip and
 * migration (0.2/0.1 -> 0.3), evidence separation, and deterministic replay
 * with no RNG consumption.
 *
 * Pure-policy boundary tests use synthetic contexts and run in milliseconds.
 * Integration cases share one fixture seed (balanced 24681357).
 *
 * Run: pnpm test:catalysts
 * Fast daily mode (unit only, seconds): pnpm test:catalysts:fast
 */

/** Fast mode runs the millisecond policy checks; full mode adds the live integration cases. */
const FAST = process.argv.includes("--fast");
import assert from "node:assert/strict";
import type {
  CatalystContext,
  CatalystOpportunity,
  EngineConfig,
  SupportedUniverseCheckpoint,
  UniverseCheckpoint,
} from "../../packages/contracts/src/index.ts";
import { ENGINE_VERSION } from "../../packages/sim-core/src/index.ts";
import { UniverseSession, CHECKPOINT_SCHEMA_VERSION } from "../../packages/sim-runtime/src/session.ts";
import {
  CATALYST_POLICY_VERSION,
  CATALYST_QUIET_TICKS,
  MAJOR_CATALYST_COOLDOWN_TICKS,
  catalystIds,
  diagnoseCatalysts,
  isMajorCooldownClear,
  selectCatalystWindow,
} from "../../packages/sim-decisions/src/index.ts";

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

/** Rich, calm world: everything eligible unless a specific gate blocks it. */
function healthyContext(overrides: Partial<CatalystContext> = {}): CatalystContext {
  return {
    tick: 20_000,
    population: 300,
    droughtActive: false,
    energyShareA: 0.4,
    energyShareB: 0.4,
    stockFractionA: 0.8,
    stockFractionB: 0.8,
    abioticStockFraction: 0.8,
    ...overrides,
  };
}

function eligibleIds(context: CatalystContext, cooldownClear = true): string[] {
  return diagnoseCatalysts(context, cooldownClear)
    .filter((d) => d.eligible)
    .map((d) => d.catalystId);
}

// --- C1/C4: pure policy, versioned catalog, honest boundaries -----------------

function testEligibilityBoundaries() {
  assert.deepEqual(catalystIds(), ["drought-a", "drought-b", "global-crash"], "v1 catalog in deterministic order");
  assert.deepEqual(eligibleIds(healthyContext()), ["drought-a", "drought-b", "global-crash"], "healthy world offers all three");

  // Energy share boundary: exactly 15% is coherent, a hair below is not.
  assert.ok(eligibleIds(healthyContext({ energyShareA: 0.15 })).includes("drought-a"), "A at exactly 15% is eligible");
  assert.ok(!eligibleIds(healthyContext({ energyShareA: 0.1499 })).includes("drought-a"), "A below 15% is not eligible");
  assert.ok(eligibleIds(healthyContext({ energyShareB: 0.15 })).includes("drought-b"), "B at exactly 15% is eligible");
  assert.ok(!eligibleIds(healthyContext({ energyShareB: 0.1499 })).includes("drought-b"), "B below 15% is not eligible");
  // A failing A-side never affects the B-side (independent predicates).
  assert.ok(eligibleIds(healthyContext({ energyShareA: 0 })).includes("drought-b"), "B eligibility is independent of A");

  // Stock boundary: exactly 8% coherent, below not.
  assert.ok(eligibleIds(healthyContext({ stockFractionA: 0.08 })).includes("drought-a"), "A stock at exactly 8% is eligible");
  assert.ok(!eligibleIds(healthyContext({ stockFractionA: 0.0799 })).includes("drought-a"), "A stock below 8% is not");

  // Abiotic + population boundaries for the global crash.
  assert.ok(eligibleIds(healthyContext({ abioticStockFraction: 0.1 })).includes("global-crash"), "abiotic at exactly 10% is eligible");
  assert.ok(!eligibleIds(healthyContext({ abioticStockFraction: 0.0999 })).includes("global-crash"), "abiotic below 10% is not");
  assert.ok(eligibleIds(healthyContext({ population: 20 })).includes("global-crash"), "population of exactly 20 is eligible");
  assert.ok(!eligibleIds(healthyContext({ population: 19 })).includes("global-crash"), "population below 20 is not");

  // An active drought blocks every catalyst (never pile disturbances).
  assert.deepEqual(eligibleIds(healthyContext({ droughtActive: true })), [], "active drought blocks the whole catalog");

  // Starved world: nothing coherent to offer.
  assert.deepEqual(
    eligibleIds(healthyContext({ energyShareA: 0, energyShareB: 0, stockFractionA: 0, stockFractionB: 0, abioticStockFraction: 0, population: 5 })),
    [],
    "depleted world offers nothing",
  );

  // Cooldown blocks majors without touching the diagnosis of state.
  const blocked = diagnoseCatalysts(healthyContext(), false);
  assert.ok(blocked.every((d) => !d.eligible), "unclear cooldown blocks all majors");
  assert.ok(
    blocked.every((d) => d.reasons.some((r) => r.includes("cooldown"))),
    "cooldown says why",
  );

  // Determinism: same input, byte-identical output, twice.
  assert.equal(
    JSON.stringify(diagnoseCatalysts(healthyContext(), true)),
    JSON.stringify(diagnoseCatalysts(healthyContext(), true)),
    "diagnosis is deterministic",
  );
  console.log("eligibility boundaries: PASS");
}

// --- C5/C6: quiet interval and major cooldown ----------------------------------

function testQuietAndCooldown() {
  const context = healthyContext({ tick: 10_000 });
  // Exactly 10,000 ticks of quiet is enough; one fewer is not.
  assert.ok(
    selectCatalystWindow({ tick: 10_000, lastDecisionTick: 0, lastMajorCatalystTick: null, context }) !== null,
    "window opens at exactly CATALYST_QUIET_TICKS of quiet",
  );
  assert.equal(
    selectCatalystWindow({ tick: 9_999, lastDecisionTick: 0, lastMajorCatalystTick: null, context }),
    null,
    "one tick short of quiet opens nothing",
  );
  // Waiting longer never relaxes anything: an ineligible world stays quiet.
  assert.equal(
    selectCatalystWindow({ tick: 200_000, lastDecisionTick: 0, lastMajorCatalystTick: null, context: healthyContext({ tick: 200_000, droughtActive: true }) }),
    null,
    "long quiet never relaxes eligibility",
  );

  // Cooldown boundary: exactly 25,000 ticks after a major application.
  assert.equal(isMajorCooldownClear(25_000, 0), true, "cooldown clears at exactly 25,000 ticks");
  assert.equal(isMajorCooldownClear(24_999, 0), false, "one tick short of cooldown stays blocked");
  assert.equal(isMajorCooldownClear(10_000, null), true, "no prior application means clear");
  assert.equal(
    selectCatalystWindow({ tick: 20_000, lastDecisionTick: 0, lastMajorCatalystTick: 0, context }),
    null,
    "recent major application blocks the window even in a healthy world",
  );

  // Window shape: stable id, provenance, deterministic choice order.
  const window = selectCatalystWindow({ tick: 10_000, lastDecisionTick: 0, lastMajorCatalystTick: null, context })!;
  assert.equal(window.opportunityId, "wcat:10000", "stable deterministic window id");
  assert.equal(window.source, "world_catalyst", "explicit catalyst provenance");
  assert.equal(window.policyVersion, CATALYST_POLICY_VERSION, "stamped with the catalyst catalog");
  assert.deepEqual(window.catalystIds, ["drought-a", "drought-b", "global-crash"], "eligible set in catalog order");
  assert.deepEqual(
    window.choices.map((c) => c.choiceId),
    ["keep-watching", "drought-a", "drought-b", "global-crash"],
    "keep watching first, then catalog order",
  );
  assert.equal(window.choices[0]!.intervention, null, "leave-unchanged offered");
  assert.equal(window.prompt, "Change the environment?", "player-opportunity framing, never a natural event");
  assert.ok(!/drought is beginning|catastrophe|disaster/i.test(`${window.prompt} ${window.context}`), "no fake natural-event language");
  console.log("quiet interval + cooldown: PASS");
}

testEligibilityBoundaries();
testQuietAndCooldown();

// --- Integration: first window, priority, gate, resolution -------------------
// Pinned deterministic chain, balanced seed 24681357 (keep watching):
// dormancy @7279 -> window @17319 [drought-a, drought-b, global-crash] ->
// windows @27359/@37399/@47439/@57981/@68523 -> era-2 @113954 ->
// crossfeeding @123994. Applied drought-a @17319 instead shifts the arc:
// era-2 @26857 -> window @42419 [drought-b, global-crash] (cooldown clears
// exactly at the stride) -> crossfeeding @48694.

/** Fresh session paused on the first catalyst window (dormancy resolved). */
function atFirstWindow(): { session: UniverseSession; window: CatalystOpportunity } {
  const session = new UniverseSession();
  session.create(config(FIXTURE_SEED));
  const first = session.advance(120_000).pendingDecision as any;
  assert.equal(first?.source, "observed_event", "dormancy event comes first (quiet blocks earlier windows)");
  session.resolveEventDecision(first.opportunityId, "keep-watching");
  const window = session.advance(120_000).pendingDecision as CatalystOpportunity;
  assert.ok(window && window.source === "world_catalyst", "a catalyst window follows the event");
  return { session, window };
}

function testFirstWindow() {
  const { session, window } = atFirstWindow();
  assert.equal(window.createdTick, 17_319, "first window opens at the first quiet stride");
  assert.equal(window.opportunityId, "wcat:17319", "stable window id");
  assert.equal(window.policyVersion, CATALYST_POLICY_VERSION, "stamped with the catalyst catalog");
  assert.deepEqual(window.catalystIds, ["drought-a", "drought-b", "global-crash"], "only eligible catalysts offered");
  assert.deepEqual(
    window.choices.map((c) => c.choiceId),
    ["keep-watching", "drought-a", "drought-b", "global-crash"],
    "keep watching first, then catalog order",
  );
  assert.equal(session.snapshot().tick, 17_319, "gate stopped exactly at the window tick");
  assert.equal(session.snapshot().pendingDecision, window as any, "window is pending");
  console.log("first catalyst window: PASS");
}

function testSameTickPriority() {
  // Arrange a genuine coincidence: quiet satisfied and catalysts eligible at
  // the same boundary where a mapped event is processed. The record below is
  // synthetic, but the ordering under test is the real session path: the event
  // must win and the catalyst must wait. Clearly labeled; detection of real
  // events is covered everywhere else.
  const session = new UniverseSession();
  session.create(config(FIXTURE_SEED));
  session.resolveEventDecision(session.advance(120_000).pendingDecision!.opportunityId, "keep-watching");
  session.advance(10_000);
  assert.equal(session.snapshot().tick, 17_279, "positioned just before the window tick");
  assert.equal(session.snapshot().pendingDecision, null, "nothing pending yet");
  (session.analysis as any).records.push({
    id: "eco-crossfeeding-9-established-17279",
    arc_id: "eco-crossfeeding-9",
    kind: "crossfeeding",
    phase: "established",
    tick: 17_279,
    level: "major",
    title: "Synthetic ordering-test event",
    summary: "Test-only record proving same-tick priority; not a biological claim.",
    evidence: { c_energy_share: 0.06, crossfeeder_fraction: 0.07 },
    entity_refs: [],
  });
  const pending = session.advance(100).pendingDecision as any;
  assert.ok(pending, "the boundary produced a decision");
  assert.equal(pending.source, "observed_event", "the event wins over the eligible catalyst");
  assert.equal(pending.opportunityId, "dop:eco-crossfeeding-9-established-17279", "the event is the synthetic one");
  // The catalyst was genuinely ready: quiet satisfied and eligible at this tick.
  const diagnosis = session.describeCatalystEligibility();
  assert.ok(
    diagnosis.diagnoses.some((d) => d.eligible),
    `catalyst eligible at the event tick (${diagnosis.diagnoses.filter((d) => d.eligible).map((d) => d.catalystId).join(",")})`,
  );
  // The event creation restarted quiet at its own creation tick, so the window
  // cadence shifts with it. The very next decision must therefore be the
  // catalyst window at the shifted cadence: the event waited its turn and the
  // catalyst waited its turn.
  session.resolveEventDecision(pending.opportunityId, "keep-watching");
  const later = session.advance(30_000).pendingDecision as any;
  assert.equal(later?.source, "world_catalyst", "catalyst follows once the event clears");
  assert.equal(later?.createdTick, 27_359, "window opens at the shifted quiet stride");
  console.log("same-tick event priority: PASS");
}

function testCatalystGateAndChoices() {
  const { session, window } = atFirstWindow();
  const windowTick = window.createdTick;
  const stateAtWindow = JSON.stringify(session.checkpoint().experiment);

  // C9: blocked advances and scans leave state byte-identical.
  for (let i = 0; i < 3; i++) {
    assert.equal(session.advance(500).tick, windowTick, "pending catalyst blocks ADVANCE_TICKS");
  }
  assert.equal(session.runToNextEvent(5_000).tick, windowTick, "pending catalyst blocks RUN_TO_NEXT_EVENT");
  assert.equal(JSON.stringify(session.checkpoint().experiment), stateAtWindow, "blocked window leaves state unchanged");

  // C10: keep watching is a pure no-op that still restarts quiet.
  session.resolveEventDecision(window.opportunityId, "keep-watching");
  assert.equal(session.snapshot().tick, windowTick, "keep watching advances zero ticks");
  assert.equal(session.snapshot().pendingDecision, null, "window cleared");
  assert.equal(JSON.stringify(session.checkpoint().experiment), stateAtWindow, "keep watching mutates nothing");
  const kept = session.decisionResolutions[1]!;
  assert.equal(kept.source, "world_catalyst", "resolution carries catalyst provenance");
  assert.equal(kept.sourceEventId, null, "no fabricated event id");
  assert.equal(kept.catalystId, null, "no catalyst applied");
  assert.equal(kept.offerTick, windowTick, "offer tick recorded");
  assert.equal(kept.choiceTitle, "Keep watching", "offered copy recorded");

  // C11: drought-a and drought-b each apply exactly once, with no control fork.
  for (const choiceId of ["drought-a", "drought-b"] as const) {
    const s = new UniverseSession();
    s.create(config(FIXTURE_SEED));
    s.resolveEventDecision(s.advance(120_000).pendingDecision!.opportunityId, "keep-watching");
    const w = s.advance(120_000).pendingDecision as CatalystOpportunity;
    const beforeEvents = s.snapshot().events.length;
    const resolved = s.resolveEventDecision(w.opportunityId, choiceId);
    assert.equal(resolved.tick, w.createdTick, `${choiceId} advances zero ticks`);
    assert.equal(resolved.control, null, `${choiceId} creates no control fork`);
    assert.equal(resolved.events.length, beforeEvents + 1, `${choiceId} applied exactly once`);
    const resolution = s.decisionResolutions[1]!;
    assert.equal(resolution.catalystId, choiceId, "exact catalyst recorded");
    assert.ok(resolution.intervention, "spec recorded");
    assert.equal(s.checkpoint().decisions.lastMajorCatalystTick, w.createdTick, "cooldown state recorded");
  }
  console.log("catalyst gate + choices: PASS");
}

function testCrashAndCooldown() {
  // Reproduce the pinned chain: drought-a first, so the second window offers
  // the global crash once the cooldown clears exactly.
  const session = new UniverseSession();
  session.create(config(FIXTURE_SEED));
  session.resolveEventDecision(session.advance(120_000).pendingDecision!.opportunityId, "keep-watching");
  const w1 = session.advance(120_000).pendingDecision as CatalystOpportunity;
  assert.equal(w1.createdTick, 17_319, "first window opens on its deterministic tick");
  session.resolveEventDecision(w1.opportunityId, "drought-a");
  const appliedTick = w1.createdTick;

  // An unrelated era establishes mid-cooldown: events are unaffected by it.
  const mid = session.advance(200_000).pendingDecision as any;
  assert.equal(mid?.source, "observed_event", "events still fire during the catalyst cooldown");
  assert.equal(mid?.sourceEventId, "eco-era-2-established-26857", "drought shifts the era deterministically");
  session.resolveEventDecision(mid.opportunityId, "keep-watching");

  const w2 = session.advance(200_000).pendingDecision as CatalystOpportunity;
  assert.equal(w2.source, "world_catalyst", "second window opens after cooldown");
  assert.equal(w2.createdTick, 42_419, "cooldown clears exactly at the stride");
  assert.ok(
    w2.createdTick >= appliedTick + MAJOR_CATALYST_COOLDOWN_TICKS,
    `cooldown respected (applied ${appliedTick}, window ${w2.createdTick})`,
  );
  assert.ok(w2.catalystIds.includes("global-crash"), `crash offered (offered: ${w2.catalystIds.join(",")})`);
  const beforeEvents = session.snapshot().events.length;
  const resolved = session.resolveEventDecision(w2.opportunityId, "global-crash");
  assert.equal(resolved.tick, w2.createdTick, "crash advances zero ticks");
  assert.equal(resolved.control, null, "crash creates no control fork");
  assert.equal(resolved.events.length, beforeEvents + 1, "crash applied exactly once");
  assert.deepEqual(
    session.decisionResolutions[session.decisionResolutions.length - 1]!.intervention,
    { schemaVersion: 1, kind: "nutrient_disturbance", mode: "global_crash" },
    "exact crash spec recorded",
  );
  console.log("global crash + cooldown: PASS");
}

// --- C13: round-trip and migration ----------------------------------------------

function testCatalystCheckpoint() {
  const { session, window } = atFirstWindow();
  const saved = session.checkpoint();
  assert.equal(saved.checkpointSchemaVersion, CHECKPOINT_SCHEMA_VERSION, "new saves use schema 0.3");
  assert.equal(saved.decisions.pending?.opportunityId, window.opportunityId, "pending catalyst persisted");
  assert.equal(saved.decisions.catalystPolicyVersion, CATALYST_POLICY_VERSION, "catalyst catalog version persisted");
  assert.equal(typeof saved.decisions.lastDecisionTick, "number", "quiet state persisted");

  const restored = new UniverseSession();
  assert.deepEqual(restored.restore(saved).pendingDecision, window, "pending catalyst restores exactly");
  assert.equal(restored.advance(1_000).tick, window.createdTick, "gate survives restore");
  restored.resolveEventDecision(window.opportunityId, "drought-b");
  assert.equal(restored.checkpoint().decisions.lastMajorCatalystTick, window.createdTick, "cooldown survives resolve");

  // 0.2 migration: event state intact, pacing restarts honestly, nothing invented.
  const legacy02: SupportedUniverseCheckpoint = {
    checkpointSchemaVersion: "0.2",
    engineVersion: saved.engineVersion,
    createdTick: saved.createdTick,
    experiment: saved.experiment,
    analysis: saved.analysis,
    control: saved.control,
    controlAnalysis: saved.controlAnalysis,
    decisions: {
      pending: { ...JSON.parse(JSON.stringify(window)), source: undefined, sourceEventId: "eco-x", sourceArcId: "eco-x" },
      resolutions: [],
      policyVersion: "m3-events-0.1.0",
    },
  };
  const migrated = new UniverseSession();
  assert.equal(migrated.restore(legacy02).pendingDecision?.source, "observed_event", "0.2 pending normalizes to event provenance");
  assert.equal(migrated.checkpoint().checkpointSchemaVersion, "0.3", "migrated save re-saves as 0.3");

  // 0.1 migration still works through the new chain.
  const legacy01: SupportedUniverseCheckpoint = {
    checkpointSchemaVersion: "0.1",
    engineVersion: saved.engineVersion,
    createdTick: saved.createdTick,
    experiment: saved.experiment,
    analysis: saved.analysis,
    control: saved.control,
    controlAnalysis: saved.controlAnalysis,
  };
  const migrated01 = new UniverseSession();
  assert.equal(migrated01.restore(legacy01).pendingDecision, null, "0.1 migrates with no pending decision");
  assert.equal(migrated01.advance(5).tick, saved.createdTick + 5, "0.1 migrated checkpoint is usable");
  console.log("catalyst checkpoint round-trip + migration: PASS");
}

// --- C14/C15: separation, replay, RNG-neutral evaluation -------------------------

function testCatalystEvidenceAndReplay() {
  const run = (choice: string) => {
    const session = new UniverseSession();
    session.create(config(FIXTURE_SEED));
    session.resolveEventDecision(session.advance(120_000).pendingDecision!.opportunityId, "keep-watching");
    const window = session.advance(120_000).pendingDecision as CatalystOpportunity;
    session.resolveEventDecision(window.opportunityId, choice);
    session.advance(250);
    return session.exportEvidence() as any;
  };
  const a = run("drought-a");
  const b = run("drought-a");
  assert.equal(a.tick, b.tick, "same choices reproduce the same tick");
  assert.equal(a.current_metrics.population, b.current_metrics.population, "same choices reproduce the same population");
  assert.equal(JSON.stringify(a.player_decisions.resolutions), JSON.stringify(b.player_decisions.resolutions), "identical command records");
  const res = a.player_decisions.resolutions.find((r: any) => r.source === "world_catalyst");
  assert.ok(res, "catalyst resolution exported with provenance");
  assert.deepEqual(res.intervention, { schemaVersion: 1, kind: "nutrient_disturbance", mode: "drought_a" }, "exact spec exported");
  assert.equal(typeof res.offerTick, "number", "offer tick exported");
  assert.equal(res.catalystId, "drought-a", "catalyst id exported");
  assert.ok(a.player_decisions.catalyst_state, "cooldown/quiet state exported");
  assert.equal(a.player_decisions.catalyst_policy_version, CATALYST_POLICY_VERSION, "catalyst catalog version exported");
  assert.ok(
    (a.player_decisions.resolutions as any[]).every((r: any) => r.source === "event_decision" || r.source === "world_catalyst"),
    "every command carries explicit provenance",
  );

  // Evaluation consumes no RNG and changes no state: the metrics/describe path
  // leaves every RNG stream untouched.
  const session = new UniverseSession();
  session.create(config(FIXTURE_SEED));
  session.advance(5_000);
  const sim = (session as any).simulation;
  const streams = () =>
    JSON.stringify({ i: sim.rInit.getState(), f: sim.rFood.getState(), m: sim.rMove.getState(), u: sim.rMut.getState(), c: sim.rCat.getState() });
  const before = streams();
  for (let i = 0; i < 5; i++) session.describeCatalystEligibility();
  assert.equal(streams(), before, "eligibility evaluation consumes no simulation RNG");
  console.log("catalyst evidence + replay: PASS");
}

function testInterveneBlockedWhilePending() {
  // Review finding on main (#27/#28): the Experiments path once mutated
  // straight through the pause gate, staling the offered context and stacking
  // an unevaluated second hit. Both sources must refuse.
  const { session, window } = atFirstWindow();
  const stateAtWindow = JSON.stringify(session.checkpoint().experiment);
  assert.throws(() => session.intervene("droughtA"), /pending/, "experiments refuse during a catalyst window");
  assert.equal(JSON.stringify(session.checkpoint().experiment), stateAtWindow, "refused intervention changes nothing");
  assert.equal(session.snapshot().pendingDecision, window as any, "window still pending");
  session.resolveEventDecision(window.opportunityId, "keep-watching");

  const events = new UniverseSession();
  events.create(config(FIXTURE_SEED));
  const first = events.advance(120_000).pendingDecision as any;
  assert.equal(first?.source, "observed_event", "dormancy event pending");
  const stateAtEvent = JSON.stringify(events.checkpoint().experiment);
  assert.throws(() => events.intervene("global"), /pending/, "experiments refuse during an event decision");
  assert.equal(JSON.stringify(events.checkpoint().experiment), stateAtEvent, "refused intervention changes nothing");
  console.log("experiments blocked while pending: PASS");
}

testEligibilityBoundaries();
testQuietAndCooldown();
if (!FAST) {
  testFirstWindow();
  testSameTickPriority();
  testCatalystGateAndChoices();
  testInterveneBlockedWhilePending();
  testCrashAndCooldown();
  testCatalystCheckpoint();
  testCatalystEvidenceAndReplay();
  console.log(`catalyst validation: PASS (checkpoint schema ${CHECKPOINT_SCHEMA_VERSION}, engine ${ENGINE_VERSION})`);
} else {
  console.log(`catalyst validation (fast): PASS (engine ${ENGINE_VERSION})`);
}
