/**
 * M3 aftermath impact-state validation.
 *
 * The impact state makes exactly one causal claim - the mechanical effect the
 * command contract proves - so the behaviour guarded here is narrow and
 * strict: resolution advances zero ticks, the retained baseline is the instant
 * the effect landed and not an invented earlier moment, nothing biological has
 * moved while the sheet is open, and no command path can move it underneath
 * the player.
 *
 * Runs against the real engine. Reaches a decision with one cached fixture
 * checkpoint, the same way the decision suite does, so restoring is the
 * heavily exercised path.
 *
 * Run: pnpm test:aftermath
 */
import assert from "node:assert/strict";
import type {
  AftermathState,
  EngineConfig,
  InterventionSpec,
  UniverseCheckpoint,
} from "../../packages/contracts/src/index.ts";
import { AFTERMATH_COMPARABLES } from "../../packages/contracts/src/index.ts";
import { UniverseSession } from "../../packages/sim-runtime/src/session.ts";
import { isDecisionEligible } from "../../packages/sim-decisions/src/index.ts";
import { fieldDelta } from "../../apps/explorer/src/aftermath.ts";

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

let fixtureCache: UniverseCheckpoint | null = null;
function fixture(): UniverseCheckpoint {
  if (fixtureCache) return JSON.parse(JSON.stringify(fixtureCache)) as UniverseCheckpoint;
  const session = new UniverseSession();
  session.create(config(FIXTURE_SEED));
  const snapshot = session.advance(120_000);
  assert.ok(snapshot.pendingDecision, "fixture universe reached a decision opportunity");
  fixtureCache = session.checkpoint();
  return JSON.parse(JSON.stringify(fixtureCache)) as UniverseCheckpoint;
}

interface Resolved {
  session: UniverseSession;
  aftermath: AftermathState;
  tickAtResolution: number;
  snapshotBefore: ReturnType<UniverseSession["snapshot"]>;
}

/** Restore, resolve with the first choice that actually intervenes, and hand
 *  back the aftermath plus the pre-resolution snapshot. */
function resolvedWithInterveningChoice(): Resolved {
  const session = new UniverseSession();
  const before = session.restore(fixture());
  const pending = before.pendingDecision!;
  const choice = pending.choices.find(c => !!c.intervention);
  assert.ok(choice, "the fixture opportunity offers a choice that intervenes");
  const after = session.resolveEventDecision(pending.opportunityId, choice.choiceId);
  const aftermath = after.aftermath;
  assert.ok(aftermath, "resolution produced an aftermath");
  return { session, aftermath, tickAtResolution: before.tick, snapshotBefore: before };
}

// --- AC2: zero-tick honesty ----------------------------------------------------

function testResolutionAdvancesZeroTicks() {
  const { aftermath, tickAtResolution } = resolvedWithInterveningChoice();
  assert.equal(aftermath.resolutionTick, tickAtResolution,
    "the aftermath reports the tick the world was already paused at");
  assert.equal(aftermath.baseline.tick, tickAtResolution,
    "the retained baseline is that same tick: resolution invented no earlier moment");
  assert.equal(aftermath.phase, "impact", "resolution enters the impact phase");
}

function testNothingBiologicalMovedAcrossTheEffect() {
  const { aftermath } = resolvedWithInterveningChoice();
  // The decisive AC2 check. BOTH sides of the comparison were retained at the
  // same tick, so every BIOLOGICAL measure must be identical across the
  // intervention. If any differed, the sheet would be presenting a response to
  // the intervention that has not had time to happen. Nutrient waste is excluded
  // deliberately: the intervention can change waste load at the instant it
  // lands, and that is a mechanical consequence, not a biological response.
  const mechanicalOnly = new Set(["waste_fraction", "waste_exposed_share"]);
  for (const descriptor of AFTERMATH_COMPARABLES) {
    if (mechanicalOnly.has(descriptor.key)) continue;
    assert.equal(aftermath.resolved.scalars[descriptor.key], aftermath.baseline.scalars[descriptor.key],
      `${descriptor.key} is identical across the intervention, so no response is being implied`);
  }
  assert.equal(aftermath.resolved.tick, aftermath.baseline.tick,
    "both retained states are the same tick, so Difference is exactly the mechanical effect");
}

function testComparisonSurvivesAutoResume() {
  // AC23: playback resumes automatically once the choice resolves (AC22), so a
  // comparison that read LIVE state would drift under the player. Both sides are
  // retained, so let the world run a long way and prove the evidence did not
  // move with it.
  const { session, aftermath } = resolvedWithInterveningChoice();
  const retainedResolved = JSON.parse(JSON.stringify(aftermath.resolved));
  const retainedBaseline = JSON.parse(JSON.stringify(aftermath.baseline));
  const settled = session.advance(4_000);
  assert.ok(settled.tick > aftermath.resolutionTick + 1_000, "the world genuinely moved on");
  assert.equal(settled.aftermath!.phase, "observation", "an explicit advance released the impact state");
  assert.deepEqual(settled.aftermath!.resolved, retainedResolved,
    "the retained post-effect state is untouched by later ticks, so the comparison stays the direct effect");
  assert.deepEqual(settled.aftermath!.baseline, retainedBaseline,
    "and so is the retained baseline");
  // Live biology HAS moved, which is exactly why it must not be the evidence.
  assert.notEqual(settled.population, aftermath.resolved.scalars.population,
    "live population differs from the retained state, proving the two are not conflated");
}

// --- AC3: the baseline is the moment of the intervention ------------------------

function testBaselineIsThePreEffectInstant() {
  const { aftermath } = resolvedWithInterveningChoice();
  const grid = aftermath.baseline.resources.gridSize;
  assert.equal(grid, aftermath.resolved.resources.gridSize, "both retained fields share one grid resolution");
  // The layout is kind-major and flat: 3 substances, each a row-major run of
  // gridSize*gridSize cells. Asserting the shape here is what stops a future
  // reader treating the outer index as a grid row and comparing wrong cells.
  assert.equal(aftermath.baseline.resources.stock.length, 3,
    "the retained resource field is indexed by substance, not by grid row");
  for (const kind of aftermath.baseline.resources.stock) {
    assert.equal(kind.length, grid * grid, "each substance retains every cell at full resolution");
  }
  assert.equal(aftermath.baseline.waste.stock.length, grid * grid,
    "the waste field is a single flat grid");
  assert.equal(aftermath.resolved.waste.stock.length, grid * grid,
    "and the post-effect retention has the same geometry");

  // Some nutrient must actually differ, or the comparison has nothing to show
  // and the intervention did not do what its description claims.
  const shaped = (flat: readonly number[]) => {
    const out: number[][] = [];
    for (let r = 0; r < grid; r++) out.push(Array.from(flat.slice(r * grid, (r + 1) * grid)));
    return out;
  };
  let movedKinds = 0;
  for (let kind = 0; kind < 3; kind++) {
    const before = aftermath.baseline.resources.stock[kind] ?? [];
    const after = aftermath.resolved.resources.stock[kind] ?? [];
    const delta = fieldDelta(shaped(before), shaped(after));
    if (delta && delta.magnitude > 0) movedKinds++;
  }
  assert.ok(movedKinds > 0, "the applied intervention visibly changed at least one nutrient field");
  // And the difference is a FALL in stock, which is what these modes do. This is
  // the direct effect, asserted as a direction rather than assumed.
  const totalBefore=aftermath.baseline.resources.stock.flat().reduce((a:number,b:number)=>a+b,0);
  const totalAfter=aftermath.resolved.resources.stock.flat().reduce((a:number,b:number)=>a+b,0);
  assert.ok(totalAfter<totalBefore, `the direct effect is a reduction in nutrient stock (${totalBefore.toFixed(1)} -> ${totalAfter.toFixed(1)})`);
}

function testBaselineIsACopyThatIsNeverWrittenBack() {
  const { session, aftermath } = resolvedWithInterveningChoice();
  const baseline = aftermath.baseline;
  const snapshotOfBaseline = JSON.stringify(baseline);
  // Mutating the simulation must not reach back into retained evidence.
  session.acknowledgeAftermath();
  session.advance(2_000);
  assert.equal(JSON.stringify(baseline), snapshotOfBaseline,
    "retained evidence is inert: later ticks cannot alter what was recorded at resolution");
}

// --- AC4: the impact state pauses the world until an explicit command ----------

function testNothingAdvancesOnItsOwnDuringImpact() {
  const { session, tickAtResolution } = resolvedWithInterveningChoice();
  // No timer, no scheduler, no background path: simply existing must not move
  // the world. Snapshots are the only thing that can happen here.
  for (let i = 0; i < 5; i++) session.snapshot();
  assert.equal(session.snapshot().tick, tickAtResolution,
    "taking snapshots does not advance the world while the impact state is open");
  // A zero-tick request is a query, not a release: it must not silently dismiss
  // a sheet the player is reading.
  assert.equal(session.advance(0).tick, tickAtResolution, "a zero-tick advance is a pure query");
  assert.equal(session.snapshot().aftermath!.phase, "impact",
    "and it leaves the impact state on screen rather than dismissing it");
}

function testAnExplicitAdvanceIsALegitimateRelease() {
  // AC4 permits Resume OR another explicit supported advance command. Refusing
  // the latter would be stricter than specified and would contradict the
  // long-standing A14 contract that an explicit advance resumes time.
  const { session, aftermath } = resolvedWithInterveningChoice();
  const moved = session.advance(7);
  assert.equal(moved.tick, aftermath.resolutionTick + 7, "an explicit advance resumes time");
  assert.equal(moved.aftermath!.phase, "observation",
    "and it releases the impact state rather than discarding the aftermath");
  assert.equal(moved.aftermath!.baseline.tick, aftermath.baseline.tick,
    "the retained baseline survives the release, so nothing is lost by moving on");
}

function testReleasePreservesTheRecord() {
  const { session, aftermath } = resolvedWithInterveningChoice();
  session.acknowledgeAftermath();
  const after = session.snapshot();
  assert.equal(after.aftermath!.phase, "observation", "acknowledging moves the aftermath to observation");
  assert.equal(after.aftermath!.commandId, aftermath.commandId, "the aftermath identity is preserved");
  assert.deepEqual(after.aftermath!.baseline.scalars, aftermath.baseline.scalars,
    "the retained baseline is preserved across the release");
  assert.ok(after.resolvedDecisions.some(r => r.commandId === aftermath.commandId),
    "and the durable decision record is untouched");
}

function testPendingDecisionStillOutranksEverything() {
  // The two pauses are different and must not be conflated: a pending decision
  // is a hard gate that NO explicit advance may pass, which is stronger than the
  // impact state's "any explicit command releases it".
  const session = new UniverseSession();
  const first = session.restore(fixture());
  const pending = first.pendingDecision!;
  assert.equal(session.advance(1).tick, first.tick,
    "a pending decision cannot be passed by an explicit advance, unlike an impact state");
  session.resolveEventDecision(pending.opportunityId, "keep-watching");
  assert.equal(session.snapshot().aftermath!.phase, "impact", "resolving opened the impact state");
  // With the decision resolved, the only remaining pause is the impact state.
  session.acknowledgeAftermath();
  assert.ok(session.advance(3).tick > first.tick, "time moves once nothing is pending");
}

function testResumeIsIdempotentlyRefused() {
  const { session, aftermath } = resolvedWithInterveningChoice();
  session.acknowledgeAftermath();
  // Acknowledging twice is an explicit error rather than a silent success.
  assert.throws(() => session.acknowledgeAftermath(), /not awaiting acknowledgement|No aftermath/,
    "acknowledging twice is refused rather than silently tolerated");
  assert.equal(session.snapshot().aftermath!.phase, "observation", "and the aftermath stays released");
}

function testResumeItselfAdvancesNothing() {
  const { session, aftermath } = resolvedWithInterveningChoice();
  const before = session.snapshot().tick;
  const after = session.acknowledgeAftermath();
  assert.equal(after.tick, before, "acknowledging the impact advances zero ticks");
  assert.equal(aftermath.resolutionTick, before, "the resolution tick is the tick it was paused at");
}

// --- Handoff A3: omission rather than invention ---------------------------------

function testNoBaselineMeansNoComparisonIsOffered() {
  const session = new UniverseSession();
  session.create(config(FIXTURE_SEED));
  // A fresh universe has no aftermath at all.
  const snapshot = session.snapshot();
  assert.equal(snapshot.aftermath, null, "a world with no resolution has no aftermath");
}

function testAftermathSupersedesWithoutLosingHistory() {
  const session = new UniverseSession();
  const first = session.restore(fixture());
  const pending = first.pendingDecision!;
  // Resolve WITHOUT intervening on purpose. A global crash ends the run for
  // this seed, so there would be no second opportunity to supersede; leaving the
  // intervention out keeps the world alive so the supersede path is actually
  // exercised rather than skipped.
  const quietChoice = pending.choices.find(c => !c.intervention) ?? pending.choices[0];
  const firstAfter = session.resolveEventDecision(pending.opportunityId, quietChoice.choiceId);
  const firstAftermath = firstAfter.aftermath!;
  // An aftermath is recorded even when the player changed nothing: the
  // observation of "nothing happened" is itself an aftermath.
  assert.equal(firstAftermath.intervention, null,
    "leaving an intervention out still records an aftermath, with no intervention attached");
  session.acknowledgeAftermath();

  let guard = 0;
  let secondPending = session.snapshot().pendingDecision;
  while (!secondPending && guard++ < 60) {
    secondPending = session.advance(20_000).pendingDecision;
  }
  assert.ok(secondPending, "a later decision opportunity is reachable once the first is resolved");
  const secondChoice = secondPending.choices.find(c => !!c.intervention) ?? secondPending.choices[0];
  const secondAfter = session.resolveEventDecision(secondPending.opportunityId, secondChoice.choiceId);
  assert.notEqual(secondAfter.aftermath!.commandId, firstAftermath.commandId,
    "a new resolution becomes the active aftermath");
  assert.equal(secondAfter.aftermath!.phase, "impact", "the superseding aftermath opens in its impact phase");
  const resolutions = secondAfter.resolvedDecisions;
  assert.ok(resolutions.some(r => r.commandId === firstAftermath.commandId),
    "the superseded aftermath survives in the decision record that History reads");
  assert.equal(secondAfter.aftermath!.baseline.tick, secondAfter.tick,
    "the new baseline belongs to the new intervention's tick, not the superseded one");
  assert.ok(secondAfter.aftermath!.baseline.tick > firstAftermath.baseline.tick,
    "and it is strictly later, so the two baselines cannot be confused");
}

// --- Determinism: the same command sequence must replay identically -------------

function testAftermathIsDeterministicAcrossReplay() {
  const run = () => {
    const session = new UniverseSession();
    session.restore(fixture());
    const pending = session.snapshot().pendingDecision!;
    const choice = pending.choices.find(c => !!c.intervention)!;
    const snapshot = session.resolveEventDecision(pending.opportunityId, choice.choiceId);
    const aftermath = snapshot.aftermath!;
    return {
      commandId: aftermath.commandId,
      resolutionTick: aftermath.resolutionTick,
      effect: aftermath.directEffectDescription,
      scalars: aftermath.baseline.scalars,
      resources: aftermath.baseline.resources.stock,
      waste: aftermath.baseline.waste.stock,
    };
  };
  assert.deepEqual(run(), run(),
    "the same engine version, config, seed and command sequence retain the same aftermath");
}

function sessionAfterEventResolution(): { session: UniverseSession; aftermath: AftermathState } {
  const session = new UniverseSession();
  const first = session.restore(fixture());
  const eventOpportunity = first.pendingDecision!;
  const keepWatching = eventOpportunity.choices.find(choice => !choice.intervention)!;
  const resolved = session.resolveEventDecision(eventOpportunity.opportunityId, keepWatching.choiceId);
  session.acknowledgeAftermath();
  return { session, aftermath: resolved.aftermath! };
}

function sessionAfterCatalystResolution(): { session: UniverseSession; aftermath: AftermathState } {
  const { session, aftermath: firstAftermath } = sessionAfterEventResolution();
  const firstHorizon = firstAftermath.resolutionTick + 25_000;
  const protectedRun = session.advance(24_999);
  assert.equal(protectedRun.tick, firstHorizon - 1,
    "the first Aftermath completes its protected interval before another catalyst is created");
  assert.equal(protectedRun.pendingDecision, null,
    "no catalyst can interrupt the first Aftermath");
  session.advance(1);
  const catalystSnapshot = session.advance(251);
  assert.equal(catalystSnapshot.pendingDecision?.source, "world_catalyst",
    "the deterministic fixture reaches its existing eligible catalyst window");
  const catalyst = catalystSnapshot.pendingDecision!;
  const applyCatalyst = catalyst.choices.find(choice => !!choice.intervention)!;
  const resolved = session.resolveEventDecision(catalyst.opportunityId, applyCatalyst.choiceId);
  assert.equal(resolved.aftermath?.source, "world_catalyst",
    "resolving the real catalyst starts the aftermath used by this regression");
  session.acknowledgeAftermath();
  return { session, aftermath: resolved.aftermath! };
}

function testAutomaticCatalystSuppressedUntilHorizon() {
  const { session, aftermath } = sessionAfterEventResolution();
  const horizon = aftermath.resolutionTick + 25_000;
  const initialRecords = session.analysis.records.length;

  const protectedSnapshot = session.advance(24_999);
  assert.equal(protectedSnapshot.tick, horizon - 1,
    "the normally eligible 10,000-tick catalyst window cannot interrupt Aftermath");
  assert.equal(protectedSnapshot.pendingDecision, null,
    "no automatic catalyst opportunity is pending before the observation horizon");
  assert.ok(session.analysis.records.length > initialRecords,
    "the catalyst gate does not pause ongoing analysis/history records");

  const atBoundary = session.advance(1);
  assert.equal(atBoundary.tick, horizon, "Aftermath reaches its exact 25,000-tick boundary");
  const resumed = session.advance(251);
  assert.equal(resumed.pendingDecision?.source, "world_catalyst",
    "the existing eligible catalyst window resumes at the first stride after protection");
  assert.ok(resumed.pendingDecision!.createdTick >= horizon,
    "the catalyst is created only after the protected interval ends");
}

function testExplicitExperimentRemainsAvailableDuringProtection() {
  const { session, aftermath } = sessionAfterEventResolution();
  assert.ok(aftermath.commandId, "the session begins with a foreground decision Aftermath");
  const beforeTick = session.snapshot().tick;
  const afterExperiment = session.intervene("droughtA");
  assert.equal(afterExperiment.tick, beforeTick,
    "a deliberate experiment remains a zero-tick action during Aftermath protection");
  assert.equal(afterExperiment.pendingDecision, null,
    "an explicit experiment is not mistaken for an automatic decision opportunity");
  assert.equal(afterExperiment.aftermath, null,
    "a deliberate manual experiment supersedes the foreground Aftermath");
}

function testProtectedDecisionEventsAreConsumedWithoutReplay() {
  const { session, aftermath } = sessionAfterCatalystResolution();
  const horizon = aftermath.resolutionTick + 25_000;
  const initialRecords = session.analysis.records.length;

  const protectedSnapshot = session.advance(24_999);
  assert.equal(protectedSnapshot.tick, horizon - 1,
    "ordinary advancement reaches the last protected tick without an automatic interruption");
  assert.equal(protectedSnapshot.pendingDecision, null,
    "event-derived and catalyst-derived opportunities stay suppressed inside protection");
  assert.ok(session.analysis.records.length > initialRecords,
    "analysis records continue to accumulate while automatic opportunities are suppressed");

  const protectedEligibleEvents = session.analysis.observedEvents().filter(event =>
    event.tick > aftermath.resolutionTick && event.tick < horizon && isDecisionEligible(event));
  assert.ok(protectedEligibleEvents.length > 0,
    "the deterministic world records decision-eligible events during the protected interval");

  let afterBoundary = session.advance(1);
  assert.equal(afterBoundary.tick, horizon,
    "the boundary tick is reached exactly after the last protected tick");
  let attempts = 0;
  while (!afterBoundary.pendingDecision && attempts++ < 20) {
    afterBoundary = session.runToNextEvent();
    if (session.simulation.extinctTick !== null) break;
  }
  assert.ok(afterBoundary.pendingDecision,
    "automatic opportunity creation resumes for a newly generated post-boundary opportunity");
  const resumed = afterBoundary.pendingDecision!;
  assert.ok(resumed.createdTick >= horizon,
    "the resumed opportunity is created at or after the observation horizon");
  if (resumed.source === "observed_event") {
    const source = session.analysis.observedEvents().find(event => event.eventId === resumed.sourceEventId);
    assert.ok(source && source.tick >= horizon,
      "a protected-period event is consumed rather than replayed as a stale prompt");
  }
  const pendingTick = session.snapshot().tick;
  assert.equal(session.advance(1).tick, pendingTick,
    "once the post-boundary opportunity is legitimately pending, the hard tick gate is unchanged");
  const nextChoice = resumed.choices.find(choice => !!choice.intervention) ?? resumed.choices[0]!;
  const superseding = session.resolveEventDecision(resumed.opportunityId, nextChoice.choiceId);
  assert.notEqual(superseding.aftermath?.commandId, aftermath.commandId,
    "a deliberate post-boundary decision resolution replaces the foreground Aftermath");
  assert.equal(superseding.aftermath?.resolutionTick, pendingTick,
    "the new Aftermath starts at the later decision's own resolution tick");
}

// --- The awaiting caller must actually settle -----------------------------------

function testResumeReplySettlesTheAwaitingCaller() {
  const { session, aftermath } = resolvedWithInterveningChoice();
  // Regression guard for a real defect: RESUME_AFTERMATH originally replied
  // with a bare SNAPSHOT, which only notifies subscribers. The awaiting caller
  // never settled, so the Resume button stayed disabled forever and the impact
  // state could not be left. A reply carrying the requestId is what makes that
  // promise resolve, so assert the wiring rather than trusting the button.
  const requestId="aftermath-req-1";
  // The fixture above drives the session directly (no emissions yet), so the
  // first handle() call re-announces the full set for the new world. A pure
  // no-op advance through the boundary establishes the emission watermarks
  // without disturbing the open impact state (advance(0) releases nothing),
  // so the acknowledgement below exercises the steady-state staggered path.
  session.handle({type:"ADVANCE_TICKS",ticks:0});
  const responses=session.handle({type:"ACKNOWLEDGE_AFTERMATH",requestId});
  const reply=responses.find(r=>r.type==="AFTERMATH_ACKNOWLEDGED");
  assert.ok(reply,"acknowledgement produces a request-correlated reply, not just frames");
  assert.equal((reply as any).requestId,requestId,"the reply carries the requestId the caller awaits");
  // PR #84 exactly-once lesson, Lane 3 Task 6: the announcement subscribers
  // read is the correlated reply plus the interpretation frame — never a
  // trailing bare snapshot. Fix-wave: under the staggered cadence the
  // acknowledgement announces exactly the live heartbeat plus the changed
  // interpretation (same tick, so catalog/environment stay suppressed); both
  // carry the same release, so assert the pair.
  assert.ok(!responses.some(r=>r.type==="SNAPSHOT"),"no trailing bare snapshot rides beside the acknowledgement");
  const frames=responses.filter(r=>r.type==="PRESENTATION").map(r=>(r as any).frame);
  assert.equal(frames.length,2,"the acknowledgement announces the live heartbeat plus the changed interpretation");
  const live=frames.find((f:any)=>"organisms" in f&&"population" in f);
  assert.ok(live,"the live heartbeat rides the acknowledgement");
  const interp=frames.find((f:any)=>"metrics" in f);
  assert.ok(interp,"subscribers are notified through the interpretation frame");
  assert.equal(interp.aftermath?.phase,"observation","the frame announces the released aftermath");
  assert.equal(interp.aftermath?.commandId,(reply as any).snapshot.aftermath?.commandId,
    "the frame carries the same aftermath the reply settles with");
  assert.equal(interp.aftermath?.commandId,aftermath.commandId,"and it is the aftermath that was acknowledged");
  // A fire-and-forget command must not invent a reply nobody is waiting for.
  const plain=session.handle({type:"CREATE_UNIVERSE",config:config(FIXTURE_SEED)});
  assert.ok(!plain.some(r=>r.type==="AFTERMATH_ACKNOWLEDGED"),"an unrelated command never emits an aftermath reply");
}

function main() {
  testResolutionAdvancesZeroTicks();
  testNothingBiologicalMovedAcrossTheEffect();
  testComparisonSurvivesAutoResume();
  testBaselineIsThePreEffectInstant();
  testBaselineIsACopyThatIsNeverWrittenBack();
  testNothingAdvancesOnItsOwnDuringImpact();
  testAnExplicitAdvanceIsALegitimateRelease();
  testReleasePreservesTheRecord();
  testPendingDecisionStillOutranksEverything();
  testResumeIsIdempotentlyRefused();
  testResumeItselfAdvancesNothing();
  testNoBaselineMeansNoComparisonIsOffered();
  testAftermathSupersedesWithoutLosingHistory();
  testAftermathIsDeterministicAcrossReplay();
  testAutomaticCatalystSuppressedUntilHorizon();
  testProtectedDecisionEventsAreConsumedWithoutReplay();
  testExplicitExperimentRemainsAvailableDuringProtection();
  testResumeReplySettlesTheAwaitingCaller();
  console.log("aftermath runtime validation: PASS");
}

main();
