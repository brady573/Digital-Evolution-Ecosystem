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
  // Owner ruling, restated precisely: the C washout is a valid CANDIDATE for the
  // product but must NOT become a production catalyst in this PR. So the
  // default catalog is exactly the original three, and the washout appears only
  // behind an explicit opt-in. Both halves are asserted, because asserting only
  // the opt-in would not catch a leak into production.
  assert.deepEqual(catalystIds(), ["drought-a", "drought-b", "global-crash"],
    "the PRODUCTION catalog is unchanged: three abiotic-nutrient catalysts");
  assert.deepEqual(catalystIds({ includeTestCatalysts: true }),
    ["drought-a", "drought-b", "global-crash", "c-washout"],
    "the washout is appended only behind the explicit test opt-in, in deterministic order");
  // The CATALOG is unchanged: the same three production catalysts, and the
  // washout still only behind the explicit opt-in. ELIGIBILITY does change
  // (§21.1 removes the stock floor), so the policy version is bumped: a
  // restored pending window must remain interpretable under the policy that
  // produced it.
  assert.notEqual(CATALYST_POLICY_VERSION, "m3-catalysts-1.0.0",
    "production catalyst eligibility changed, so the policy version is bumped");
  assert.equal(CATALYST_POLICY_VERSION, "m3-catalysts-1.1.0",
    "the policy version is the agreed successor to m3-catalysts-1.0.0");
  assert.deepEqual(eligibleIds(healthyContext()), ["drought-a", "drought-b", "global-crash"], "healthy world offers all three");

  // Energy share boundary: exactly 15% is coherent, a hair below is not.
  assert.ok(eligibleIds(healthyContext({ energyShareA: 0.15 })).includes("drought-a"), "A at exactly 15% is eligible");
  assert.ok(!eligibleIds(healthyContext({ energyShareA: 0.1499 })).includes("drought-a"), "A below 15% is not eligible");
  assert.ok(eligibleIds(healthyContext({ energyShareB: 0.15 })).includes("drought-b"), "B at exactly 15% is eligible");
  assert.ok(!eligibleIds(healthyContext({ energyShareB: 0.1499 })).includes("drought-b"), "B below 15% is not eligible");
  // A failing A-side never affects the B-side (independent predicates).
  assert.ok(eligibleIds(healthyContext({ energyShareA: 0 })).includes("drought-b"), "B eligibility is independent of A");

  // §21.1: the universal stock-fraction floor is removed from the drought pair.
  // The retained measurement (testdata/provenance-0.22.0.json) spans roughly
  // 0.0010-0.2712 across the named configurations, so a single 8% floor sat
  // above the ENTIRE measured Abundant range. Drought eligibility now follows
  // realized energy share, which is what the intervention actually acts on.
  for (const [label, fraction] of [
    ["abundant p05", 0.0011],
    ["abundant p50", 0.0103],
    ["abundant max", 0.0156],
    ["balanced p50", 0.0583],
    ["harsh p50", 0.1079],
  ] as const) {
    assert.ok(
      eligibleIds(healthyContext({ stockFractionA: fraction })).includes("drought-a"),
      `drought-a eligible at ${label} stock fraction (${fraction})`,
    );
  }
  assert.ok(
    eligibleIds(healthyContext({ stockFractionA: 0 })).includes("drought-a"),
    "drought-a is no longer gated on A field stock at any value",
  );
  assert.ok(
    eligibleIds(healthyContext({ stockFractionB: 0 })).includes("drought-b"),
    "drought-b is no longer gated on B field stock at any value",
  );

  // Removing the stock gate must NOT weaken the gates that remain. Energy
  // share carries the product intent, and cooldown still gates majors.
  assert.ok(
    !eligibleIds(healthyContext({ energyShareA: 0, stockFractionA: 0 })).includes("drought-a"),
    "energy-share still blocks drought-a when A stock is also empty",
  );
  assert.ok(
    !eligibleIds(healthyContext({ energyShareA: 0.1499, stockFractionA: 0 })).includes("drought-a"),
    "the 15% energy-share boundary is unchanged with no stock floor in the way",
  );
  assert.deepEqual(
    eligibleIds(healthyContext({ stockFractionA: 0, stockFractionB: 0 }), false),
    [],
    "cooldown still blocks every major with no stock floor",
  );
  assert.ok(
    !eligibleIds(healthyContext({ stockFractionA: 0, energyShareA: 0, droughtActive: true })).includes("drought-a"),
    "noDroughtActive still blocks when stock is also empty",
  );

  // Same catalyst context + same policy state is deterministic.
  const measured = healthyContext({ stockFractionA: 0.0011, stockFractionB: 0.0014, energyShareA: 0.16, energyShareB: 0.16 });
  assert.deepEqual(
    diagnoseCatalysts(measured, true),
    diagnoseCatalysts(measured, true),
    "the same catalyst context yields a bit-identical diagnosis",
  );

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
  assert.ok(!window.catalystIds.includes("c-washout"), "a default window never offers the test-only washout");
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
  assert.equal(saved.checkpointSchemaVersion, CHECKPOINT_SCHEMA_VERSION, "new saves use the running build's current schema");
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
  // The intent is unchanged from when this read "0.3": a world restored from an
  // older schema is re-saved in the *running build's* current schema, so it
  // moves forward rather than staying pinned to a legacy version. A3.3 made
  // that current schema 0.4, so the expected value moved with it. Bound to the
  // constant so the next version bump cannot leave this a stale string.
  assert.equal(
    migrated.checkpoint().checkpointSchemaVersion,
    CHECKPOINT_SCHEMA_VERSION,
    "migrated save re-saves in the running build's current schema",
  );

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

/**
 * §21.3 / R11: the test-only c-washout offer must actually be RESOLVABLE through
 * the explicit opt-in. It previously fell through: eligibility was computed from
 * the ACTIVE catalog (which includes the test spec), but the choice was then
 * looked up in the PRODUCTION catalog alone, so the spec was undefined and the
 * window threw instead of offering the choice. Asserted in both directions: the
 * opt-in path works, and the production path still cannot offer it.
 */
function testTestOnlyCatalystIsResolvable() {
  // C needs a real energy share to be eligible; c-washout has no stock floor.
  const context = healthyContext({ energyShareC: 0.4 });

  const withTest = selectCatalystWindow({
    tick: 20_000, lastDecisionTick: 0, lastMajorCatalystTick: null, context, includeTestCatalysts: true,
  }) as { choices: readonly { catalystId: string | null; intervention: unknown; directEffectDescription: string }[] } | null;
  assert.ok(withTest, "a catalyst window opens with the explicit test opt-in");
  const offered = withTest!.choices.map((c) => c.catalystId);
  assert.ok(offered.includes("c-washout"),
    `the opted-in washout is actually offered, not merely diagnosed (offered: ${offered.join(",")})`);

  const production = selectCatalystWindow({
    tick: 20_000, lastDecisionTick: 0, lastMajorCatalystTick: null, context,
  }) as { choices: readonly { catalystId: string | null }[] } | null;
  assert.ok(production, "a catalyst window opens in production mode too");
  const prodOffered = production!.choices.map((c) => c.catalystId);
  assert.ok(!prodOffered.includes("c-washout"),
    "the washout is never offered in normal production catalog mode");
  assert.deepEqual([...catalystIds()], ["drought-a", "drought-b", "global-crash"],
    "the production catalog is still exactly the three abiotic catalysts");

  // Resolving against the active catalog must not change production behaviour:
  // enabling the opt-in adds exactly one offer and disturbs no other eligibility.
  assert.deepEqual(offered.filter((id) => id !== "c-washout"), prodOffered,
    "enabling the test opt-in adds exactly one offer and changes no other eligibility");

  // The choice carries a real, resolvable intervention rather than a stub.
  const washout = withTest!.choices.find((c) => c.catalystId === "c-washout");
  assert.ok(washout, "the washout choice is present");
  assert.ok(washout!.intervention, "the washout choice carries its intervention");
  assert.ok(washout!.directEffectDescription.length > 0, "the washout choice describes its effect");
  console.log("test-only catalyst resolves through explicit opt-in (§21.3): PASS");
}

testEligibilityBoundaries();
testQuietAndCooldown();
if (!FAST) {
  testTestOnlyCatalystIsResolvable();
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
