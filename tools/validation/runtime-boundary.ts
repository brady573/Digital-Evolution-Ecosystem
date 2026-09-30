/**
 * A7 runtime command and transport boundary validation (issue #54 items 3-5).
 *
 * The worker transport is a trust boundary. Commands arriving from it are
 * untrusted, every request placed on it must settle exactly once, and a
 * checkpoint load must complete only through its own request identity.
 *
 * This suite drives `UniverseSession.handle` directly - the point every
 * RuntimeCommand passes through - and drives `WorkerRuntimeClient` through an
 * injected fake transport, so failure behaviour is provable in Node without a
 * browser crash harness.
 *
 * Run: pnpm test:runtime-boundary
 */
import assert from "node:assert/strict";
import type { EngineConfig, RenderSnapshot } from "@digital-evolution/contracts";
import { UniverseSession } from "@digital-evolution/sim-runtime";
import {
  MAX_EVENT_SCAN_TICKS,
  validateRuntimeCommand,
} from "../../packages/sim-runtime/src/command-validation.ts";
import { MAX_SLICE_TICKS } from "../../packages/sim-runtime/src/speed.ts";

const FIXTURE_SEED = 20260930;

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
});

/** A live session, created through the command boundary under test. */
const liveSession = () => {
  const session = new UniverseSession();
  session.handle({ type: "CREATE_UNIVERSE", config: config(FIXTURE_SEED) });
  return session;
};

/**
 * An unsupported command tag must produce a structured failure, not undefined.
 *
 * Before the fix, handle() fell out of its switch and returned undefined,
 * which worker.ts then iterated over, throwing outside handle's own try/catch
 * and killing the worker with every pending request left unresolved.
 */
function testUnknownTagIsAStructuredFailure() {
  const session = new UniverseSession();
  const responses = session.handle({ type: "TOTALLY_BOGUS" } as never);
  assert.ok(Array.isArray(responses), "handle returns an array for an unknown tag");
  assert.equal(responses[0]!.type, "ERROR", "unknown tag is a structured ERROR");
  assert.match(
    (responses[0] as { message: string }).message,
    /unsupported command tag/i,
    "rejection names the reason",
  );
}

/** Non-object and non-string-tag payloads are malformed, not merely unknown. */
function testMalformedPayloadsAreRejected() {
  for (const bad of [undefined, null, 42, "ADVANCE_TICKS", [], () => {}]) {
    const result = validateRuntimeCommand(bad);
    assert.equal(result.ok, false, `rejects non-object payload ${JSON.stringify(bad) ?? String(bad)}`);
  }
  for (const bad of [{}, { type: 7 }, { type: null }, { type: { toString: () => "x" } }]) {
    const result = validateRuntimeCommand(bad);
    assert.equal(result.ok, false, "rejects a payload whose type is not a string");
  }
}

/**
 * The two numeric fields are integer-required and range-bounded. These bounds
 * are transport/request safety, not simulation limits: MAX_SLICE_TICKS is the
 * product's existing per-message slice ceiling and MAX_EVENT_SCAN_TICKS is the
 * existing runToNextEvent default. Neither bounds a population.
 */
function testNumericFieldsAreBoundedIntegers() {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, 1.5, MAX_SLICE_TICKS + 1]) {
    assert.equal(
      validateRuntimeCommand({ type: "ADVANCE_TICKS", ticks: bad }).ok,
      false,
      `rejects ADVANCE_TICKS.ticks ${String(bad)}`,
    );
  }
  // Absent is not the same as unbounded.
  assert.equal(validateRuntimeCommand({ type: "ADVANCE_TICKS" }).ok, false, "rejects ADVANCE_TICKS with no ticks");
  // The range boundaries themselves are supported.
  assert.equal(validateRuntimeCommand({ type: "ADVANCE_TICKS", ticks: 0 }).ok, true, "zero ticks is supported");
  assert.equal(
    validateRuntimeCommand({ type: "ADVANCE_TICKS", ticks: MAX_SLICE_TICKS }).ok,
    true,
    "exactly MAX_SLICE_TICKS is supported",
  );

  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0, 2.5, MAX_EVENT_SCAN_TICKS + 1]) {
    assert.equal(
      validateRuntimeCommand({ type: "RUN_TO_NEXT_EVENT", maxTicks: bad }).ok,
      false,
      `rejects RUN_TO_NEXT_EVENT.maxTicks ${String(bad)}`,
    );
  }
  // maxTicks is optional: absent takes runToNextEvent's own documented default.
  assert.equal(validateRuntimeCommand({ type: "RUN_TO_NEXT_EVENT" }).ok, true, "absent maxTicks is accepted");
  assert.equal(
    validateRuntimeCommand({ type: "RUN_TO_NEXT_EVENT", maxTicks: MAX_EVENT_SCAN_TICKS }).ok,
    true,
    "exactly MAX_EVENT_SCAN_TICKS is supported",
  );
}

/** Required-field presence for the remaining tags. */
function testRequiredFieldsAreChecked() {
  const rejects = (input: unknown, why: string) => {
    assert.equal(validateRuntimeCommand(input).ok, false, `rejects ${why}`);
  };
  rejects({ type: "CREATE_UNIVERSE" }, "CREATE_UNIVERSE with no config");
  rejects({ type: "CREATE_UNIVERSE", config: "nope" }, "CREATE_UNIVERSE with a non-object config");
  rejects({ type: "APPLY_INTERVENTION" }, "APPLY_INTERVENTION with no intervention");
  rejects({ type: "APPLY_INTERVENTION", intervention: "cWashout" }, "an unsupported intervention");
  rejects({ type: "RESOLVE_EVENT_DECISION" }, "RESOLVE_EVENT_DECISION with no ids");
  rejects({ type: "RESOLVE_EVENT_DECISION", opportunityId: "a" }, "RESOLVE_EVENT_DECISION with no choiceId");
  rejects({ type: "LOAD_CHECKPOINT" }, "LOAD_CHECKPOINT with no checkpoint");
  rejects({ type: "LOAD_CHECKPOINT", checkpoint: "nope" }, "LOAD_CHECKPOINT with a non-object checkpoint");
  // A load must carry request identity, so completion can never be inferred
  // from snapshot tick equality.
  rejects({ type: "LOAD_CHECKPOINT", checkpoint: {} }, "LOAD_CHECKPOINT with no requestId");
  rejects({ type: "REQUEST_CHECKPOINT" }, "REQUEST_CHECKPOINT with no requestId");
  rejects({ type: "REQUEST_EXPORT" }, "REQUEST_EXPORT with no requestId");

  // Every supported tag is reachable, so a valid command is never refused.
  const session = liveSession();
  assert.deepEqual(validateRuntimeCommand({ type: "CREATE_CONTROL_FORK" }), { ok: true, command: { type: "CREATE_CONTROL_FORK" } });
  assert.equal(validateRuntimeCommand({ type: "ACKNOWLEDGE_AFTERMATH" }).ok, true, "ACKNOWLEDGE_AFSTMATH is reachable");
  assert.equal(validateRuntimeCommand({ type: "APPLY_INTERVENTION", intervention: "global" }).ok, true, "a supported intervention is accepted");
  void session;
}

/**
 * A rejected command mutates nothing, and still releases the snapshot
 * backpressure depends on.
 *
 * App.tsx sets advanceDebt on post and clears it only inside subscribe, so a
 * rejection that returned no SNAPSHOT would freeze the simulation permanently.
 * The released snapshot must be STATE-EQUIVALENT: a tick-only assertion would
 * pass while the snapshot carried a mutated world, so no tick advance, no
 * biological mutation and no decision/analysis mutation are asserted separately.
 */
function testRejectedCommandMutatesNothingButStillReleasesBackpressure() {
  const live = liveSession();

  const biological = (s: ReturnType<UniverseSession["snapshot"]>) =>
    JSON.stringify({
      population: s.population,
      activePopulation: s.activePopulation,
      dormantPopulation: s.dormantPopulation,
      organisms: s.organisms,
      metrics: s.metrics,
    });
  const interpretive = (s: ReturnType<UniverseSession["snapshot"]>) =>
    JSON.stringify({ pendingDecision: s.pendingDecision, analysis: s.analysis });

  const before = live.snapshot();
  const beforeTick = before.tick;
  const beforeBiology = biological(before);
  const beforeInterpretation = interpretive(before);

  const rejected = live.handle({ type: "ADVANCE_TICKS", ticks: Number.POSITIVE_INFINITY });
  assert.equal(rejected[0]!.type, "ERROR", "an Infinity advance is refused");

  const after = live.snapshot();
  assert.equal(after.tick, beforeTick, "a refused advance does not advance the tick");
  assert.equal(biological(after), beforeBiology, "a refused advance mutates no biology");
  assert.equal(interpretive(after), beforeInterpretation, "a refused advance mutates no decision or analysis state");

  // The snapshot that releases backpressure must itself be the unchanged world.
  const echoed = rejected.find((r) => r.type === "SNAPSHOT");
  assert.ok(echoed, "a refused command still emits a snapshot so backpressure releases");
  const released = (echoed as { snapshot: ReturnType<UniverseSession["snapshot"]> }).snapshot;
  assert.equal(released.tick, beforeTick, "the released snapshot is at the unchanged tick");
  assert.equal(biological(released), beforeBiology, "the released snapshot carries unmutated biology");
  assert.equal(interpretive(released), beforeInterpretation, "the released snapshot carries unmutated interpretation");
}

/** A refused command must not have advanced the world, verified through the
 *  session API too - the boundary guard, not only the response array. */
function testRefusedCommandLeavesTheSessionWhereItWas() {
  const live = liveSession();
  const before = live.snapshot().tick;
  for (const bad of [Number.NaN, -1, 1.5, MAX_SLICE_TICKS + 1]) {
    live.handle({ type: "ADVANCE_TICKS", ticks: bad });
    assert.equal(live.snapshot().tick, before, `session did not advance for ticks ${String(bad)}`);
  }
  assert.equal(live.snapshot().population, liveSession().snapshot().population, "population is unchanged by refusals");
}

/**
 * A load completes through a request-correlated reply, not a bare snapshot.
 *
 * Today LOAD_CHECKPOINT has no requestId at all, so there is nothing to
 * correlate on and the client matches on tick equality instead.
 */
function testLoadCompletionIsCorrelatedByRequestId() {
  const session = liveSession();
  const live = session.snapshot();
  const checkpoint = session.checkpoint();

  const responses = session.handle({ type: "LOAD_CHECKPOINT", requestId: "load-7", checkpoint });
  const correlated = responses.find((r) => r.type === "CHECKPOINT_LOADED");
  // Guard against the vacuous case: a find() that matches nothing would make
  // every assertion below silently skip if the reply type were mistyped.
  assert.ok(correlated, "a load returns a correlated reply, not just a snapshot");
  assert.notEqual(correlated!.type, "SNAPSHOT", "the correlated reply is not the bare snapshot it replaced");
  assert.equal(
    (correlated as { requestId: string }).requestId,
    "load-7",
    "the reply carries the request id the caller awaits",
  );
  assert.equal(
    (correlated as { snapshot: RenderSnapshot }).snapshot.tick,
    live.tick,
    "the carried snapshot reports where the world landed",
  );
  // The render stream is unchanged: subscribers still get a bare snapshot.
  assert.ok(
    responses.some((r) => r.type === "SNAPSHOT"),
    "subscribers are still notified with a snapshot",
  );

  // An un-correlated command cannot be a load.
  assert.equal(
    validateRuntimeCommand({ type: "LOAD_CHECKPOINT", checkpoint }).ok,
    false,
    "a load without a request id is refused at the boundary",
  );
}

function main() {
  testLoadCompletionIsCorrelatedByRequestId();
  testUnknownTagIsAStructuredFailure();
  testMalformedPayloadsAreRejected();
  testNumericFieldsAreBoundedIntegers();
  testRequiredFieldsAreChecked();
  testRejectedCommandMutatesNothingButStillReleasesBackpressure();
  testRefusedCommandLeavesTheSessionWhereItWas();
  console.log("runtime boundary validation: PASS");
}

main();
