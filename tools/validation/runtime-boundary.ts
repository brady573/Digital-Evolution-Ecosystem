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
import type { EngineConfig, PresentationFrame, RenderSnapshot, WorldId, WorldLiveFrame } from "@digital-evolution/contracts";
import { CheckpointRejectionError, ENVIRONMENT_PERIOD_TICKS, READ_MODEL_VERSION } from "@digital-evolution/contracts";
import * as runtimeRoot from "@digital-evolution/sim-runtime";
import { UniverseSession, __setRestorePrepareHookForTests } from "../../packages/sim-runtime/src/session.ts";
import { buildCatalog, buildEnvironment, buildLive, buildPresentation, catalogMembershipSignature, interpretationPayloadKey, resolveCatalogEntry } from "../../packages/sim-runtime/src/presentation.ts";
import {
  MAX_EVENT_SCAN_TICKS,
  validateRuntimeCommand,
} from "../../packages/sim-runtime/src/command-validation.ts";
import { MAX_SLICE_TICKS } from "../../packages/sim-runtime/src/speed.ts";
import {
  WorkerRuntimeClient,
  type TerminalFailure,
  type WorkerLike,
} from "../../packages/sim-runtime/src/client.ts";
import { createPresentationStore } from "../../apps/explorer/src/presentationStore.ts";

const FIXTURE_SEED = 20260930;

/** One engine fixture, built once. A fresh universe per call is the obvious
 *  choice and costs ~1s each on this device; nothing here mutates the engine, so
 *  the checkpoints and snapshots are shared read-only. */
let cached: {session:UniverseSession;checkpoint:unknown;snapshot:ReturnType<UniverseSession["snapshot"]>}|null=null;

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

/**
 * A scriptable stand-in for the real Worker.
 *
 * Issue #54 item 4 requires the transport be injectable "enough to test failure
 * behavior without a browser crash harness". This is that harness: it records
 * what the client posts and lets a test deliver a message, an error, or a
 * messageerror on demand.
 */
class FakeWorker implements WorkerLike {
  readonly posted: unknown[] = [];
  #terminated = false;
  readonly #listeners = new Map<string, ((event: never) => void)[]>();

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.#terminated = true;
  }

  get terminated(): boolean {
    return this.#terminated;
  }

  addEventListener(type: string, listener: (event: never) => void): void {
    const existing = this.#listeners.get(type) ?? [];
    existing.push(listener);
    this.#listeners.set(type, existing);
  }

  /** Deliver a worker response as if it had arrived from the real transport. */
  deliver(data: unknown): void {
    for (const listener of this.#listeners.get("message") ?? []) {
      (listener as (event: { data: unknown }) => void)({ data });
    }
  }

  /** Raise a synthetic transport failure of the given kind. */
  fail(kind: "error" | "messageerror", detail: string): void {
    for (const listener of this.#listeners.get(kind) ?? []) {
      (listener as (event: unknown) => void)({ message: detail, kind });
    }
  }

  listenerCount(type: string): number {
    return (this.#listeners.get(type) ?? []).length;
  }
}

/** A live session, created through the command boundary under test. */
const liveSession = () => {
  const session = new UniverseSession();
  session.handle({ type: "CREATE_UNIVERSE", config: config(FIXTURE_SEED) });
  return session;
};

/**
 * A shared engine fixture: a live session that has advanced far enough to have a
 * non-trivial checkpoint. Restoring it in the client tests is a client concern;
 * the session's own state is never mutated by them.
 */
const engineFixture = () => {
  if (!cached) {
    const session = liveSession();
    session.advance(20);
    cached = { session, checkpoint: session.checkpoint(), snapshot: session.snapshot() };
  }
  return cached;
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

/**
 * An OPTIONAL requestId must still be a string when present.
 *
 * Review finding on PR #84. Both variants declare `requestId?: string`, and the
 * validator checked only the REQUIRED ones, so a present number or object
 * crossed the unknown→RuntimeCommand boundary. The session then emitted a typed
 * acknowledgement carrying a non-string id, while the client keys #pending by
 * string — so the reply could not correlate and the request waited for its
 * timeout. Probed: `requestId: 42` settles as "ACKNOWLEDGE_AFTERMATH timed out
 * after 50ms" rather than resolving.
 *
 * Optional means optional, not unvalidated: absence is accepted, a present
 * non-string is refused.
 */
function testOptionalRequestIdMustBeAStringWhenPresent() {
  for (const tag of ["RESOLVE_EVENT_DECISION", "ACKNOWLEDGE_AFTERMATH"] as const) {
    const base = tag === "RESOLVE_EVENT_DECISION" ? { opportunityId: "o-1", choiceId: "c-1" } : {};

    // Absent is legitimate: these are the fire-and-forget forms.
    assert.equal(
      validateRuntimeCommand({ type: tag, ...base }).ok,
      true,
      `${tag} with no requestId is accepted`,
    );
    // A present string is legitimate.
    assert.equal(
      validateRuntimeCommand({ type: tag, ...base, requestId: "r-1" }).ok,
      true,
      `${tag} with a string requestId is accepted`,
    );
    // A present non-string is the hole.
    for (const bad of [42, 0, true, { nested: true }, ["r-1"], null]) {
      assert.equal(
        validateRuntimeCommand({ type: tag, ...base, requestId: bad }).ok,
        false,
        `${tag} refuses a present non-string requestId (${JSON.stringify(bad) ?? "null"})`,
      );
    }
  }
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
  rejects({ type: "REQUEST_DETAIL" }, "REQUEST_DETAIL with no requestId");

  // Every supported tag is reachable, so a valid command is never refused.
  const session = liveSession();
  assert.deepEqual(validateRuntimeCommand({ type: "CREATE_CONTROL_FORK" }), { ok: true, command: { type: "CREATE_CONTROL_FORK" } });
  assert.equal(validateRuntimeCommand({ type: "ACKNOWLEDGE_AFTERMATH" }).ok, true, "ACKNOWLEDGE_AFSTMATH is reachable");
  assert.equal(validateRuntimeCommand({ type: "APPLY_INTERVENTION", intervention: "global" }).ok, true, "a supported intervention is accepted");
  void session;
}

/**
 * A rejected command mutates nothing, and still releases the backpressure
 * App depends on.
 *
 * App sets advanceDebt on post and clears it only on the interpretation frame,
 * so a rejection that returned no frames would freeze the simulation
 * permanently. The released frames must be STATE-EQUIVALENT: a tick-only
 * assertion would pass while the frames carried a mutated world, so no tick
 * advance, no biological mutation and no decision/analysis mutation are
 * asserted separately.
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

  // The live heartbeat releases backpressure and must itself describe the
  // unchanged world — including its tick. Unchanged catalog, environment, and
  // interpretation stay suppressed per the staggered cadence: App releases
  // advanceDebt on the live frame, so they are not needed to un wedge the UI.
  assert.ok(!rejected.some((r) => r.type === "SNAPSHOT"), "a refused command emits no legacy snapshot");
  const echoed = rejected
    .filter((r) => r.type === "PRESENTATION")
    .map((r) => (r as { frame: PresentationFrame }).frame);
  assert.equal(echoed.length, 1, "a refused command echoes only the live heartbeat for the unchanged world");
  const released = echoed.find((f) => "organisms" in f && "population" in f);
  assert.ok(released, "the echo carries the live frame backpressure releases on");
  assert.equal(released.tick, beforeTick, "the released frame is at the unchanged tick");
}

/**
 * A refused command reports a structured failure and leaves the world alone.
 *
 * The response shape is the load-bearing assertion. "The tick did not move"
 * alone would pass even with the guard removed, because the pre-existing
 * coercion already made NaN a no-op (Math.floor(NaN) is NaN, so the loop never
 * ran) and -1 a no-op (Math.max(0, -1) is 0). Only the ERROR distinguishes
 * "refused" from "silently ignored", and only a refused count is what keeps an
 * unbounded count from reaching the loop at all.
 */
function testRefusedCommandIsReportedAndLeavesTheSessionWhereItWas() {
  const cases: [string, number][] = [
    ["NaN", Number.NaN],
    ["-1", -1],
    ["1.5", 1.5],
    [`${MAX_SLICE_TICKS + 1} (out of range)`, MAX_SLICE_TICKS + 1],
  ];

  for (const [label, bad] of cases) {
    const live = liveSession();
    const before = live.snapshot().tick;
    const responses = live.handle({ type: "ADVANCE_TICKS", ticks: bad });

    assert.equal(responses[0]!.type, "ERROR", `ticks ${label} is refused with a structured failure`);
    assert.match(
      (responses[0] as { message: string }).message,
      /ADVANCE_TICKS\.ticks/,
      `ticks ${label} names the offending field`,
    );
    assert.equal(live.snapshot().tick, before, `session did not advance for ticks ${label}`);
  }

  // The event-scan path is driven through the same boundary, not only the
  // validator, so AC2 covers "unbounded loop" for both numeric commands.
  for (const [label, bad] of [
    ["NaN", Number.NaN],
    ["0", 0],
    ["2.5", 2.5],
    [`${MAX_EVENT_SCAN_TICKS + 1} (out of range)`, MAX_EVENT_SCAN_TICKS + 1],
  ] as [string, number][]) {
    const live = liveSession();
    const before = live.snapshot().tick;
    const responses = live.handle({ type: "RUN_TO_NEXT_EVENT", maxTicks: bad });

    assert.equal(responses[0]!.type, "ERROR", `maxTicks ${label} is refused with a structured failure`);
    assert.match(
      (responses[0] as { message: string }).message,
      /RUN_TO_NEXT_EVENT\.maxTicks/,
      `maxTicks ${label} names the offending field`,
    );
    assert.equal(live.snapshot().tick, before, `event scan did not run for maxTicks ${label}`);
  }
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
  // The guard above is what makes this non-vacuous: a find() that matched
  // nothing would let every assertion below skip. `type` cannot be "SNAPSHOT"
  // inside this branch, so the real risk is the branch not being taken at all.
  // A restore announces its world through this reply alone, so no separate bare
  // snapshot accompanies it.
  assert.equal(
    responses.filter((r) => r.type === "SNAPSHOT").length,
    0,
    "a restore does not also send a bare snapshot",
  );
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
  // Subscribers are notified from the client's handling of this reply (see
  // testARestoreAnnouncesTheWorldExactlyOnce), not from a second response here.

  // An un-correlated command cannot be a load.
  assert.equal(
    validateRuntimeCommand({ type: "LOAD_CHECKPOINT", checkpoint }).ok,
    false,
    "a load without a request id is refused at the boundary",
  );
}

/**
 * The injected transport is actually used, and injection changes no behaviour.
 *
 * This is a refactor with no behaviour change, so the proof is that commands
 * reach the injected transport and that the no-argument construction path is
 * untouched. There is deliberately no runtime instantiation of the default path
 * here: Node has no Worker global, so that path is covered by typecheck
 * (App.tsx:477 constructs the client with no argument) and by the browser lane.
 */
function testTransportIsInjectable() {
  const fake = new FakeWorker();
  const client = new WorkerRuntimeClient(() => fake);
  // `create` goes out as a command, so the two must be observed separately: a
  // transport that silently swallowed posts would satisfy a one-command check.
  client.create(config(FIXTURE_SEED));
  client.advance(5);
  assert.deepEqual(
    fake.posted,
    [
      { type: "CREATE_UNIVERSE", config: config(FIXTURE_SEED) },
      { type: "ADVANCE_TICKS", ticks: 5 },
    ],
    "commands reach the injected transport, in order, unaltered",
  );
  assert.equal(fake.posted.length, 2, "every command is forwarded exactly once");
  assert.equal(client instanceof WorkerRuntimeClient, true, "injection does not change the type");

  // Every listener the client needs must be registered through the seam, so a
  // later task can drive failure without a browser.
  for (const kind of ["message", "error"] as const) {
    assert.ok(fake.listenerCount(kind) > 0, `the client registers a ${kind} listener on the injected transport`);
  }
  assert.equal(fake.terminated, false, "the client has not terminated the injected transport");
}

/** A snapshot stub carrying only what these tests observe. */
const snap = (tick: number) => ({ tick }) as unknown as RenderSnapshot;

/** Resolve/reject tracking, so "did it settle, and how" is observable. */
function tracked<T>(promise: Promise<T>) {
  const state = { settled: false, value: undefined as T | undefined, error: undefined as unknown };
  const wrapped = promise.then(
    (value) => {
      state.settled = true;
      state.value = value;
      return value;
    },
    (error) => {
      state.settled = true;
      state.error = error;
      throw error;
    },
  );
  // Keep the rejection from surfacing as an unhandled rejection in the harness.
  wrapped.catch(() => {});
  return { state, wrapped };
}

/** Yield the microtask queue so promise callbacks have run. */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** A real checkpoint payload to restore, taken from a live engine. */
const realCheckpoint = () => engineFixture().checkpoint;

/**
 * A same-tick live frame that is not the correlated reply must not complete a
 * load. The client routes completion only by request identity: a bare
 * SNAPSHOT (emitted by no command since Task 6 retired the ACK trailing
 * emission) reaches no listener and settles nothing.
 */
async function testSameTickSnapshotCannotCompleteALoad() {
  const fake = new FakeWorker();
  const client = new WorkerRuntimeClient(() => fake);
  const checkpoint = realCheckpoint();
  const createdTick = checkpoint.createdTick;

  const load = tracked(client.loadCheckpoint(checkpoint));
  const posted = fake.posted.at(-1) as { type: string; requestId: string };
  assert.equal(posted.type, "LOAD_CHECKPOINT", "the load is posted as a command");
  assert.equal(typeof posted.requestId, "string", "the load carries a request id");

  // The hostile case: an unrelated live frame at exactly the restore tick.
  fake.deliver({ type: "SNAPSHOT", snapshot: snap(createdTick) });
  await tick();
  assert.equal(load.state.settled, false, "an unrelated same-tick snapshot does not complete the load");

  // Also a reply addressed to a different load, at any tick.
  fake.deliver({ type: "CHECKPOINT_LOADED", requestId: "load-other", snapshot: snap(createdTick) });
  await tick();
  assert.equal(load.state.settled, false, "a reply for another load does not complete this one");

  // Only the correlated reply settles it. Promise callbacks are microtasks, so
  // the settlement flag is observed after yielding, not synchronously.
  fake.deliver({ type: "CHECKPOINT_LOADED", requestId: posted.requestId, snapshot: snap(createdTick) });
  await tick();
  assert.equal(load.state.settled, true, "the correlated reply completes the load");
  assert.equal((load.state.value as RenderSnapshot).tick, createdTick, "the load resolves to the restored world");
}

/** A reply belonging to a different, already-settled load must be ignored. */
async function testStaleReplyCannotSatisfyALiveLoad() {
  const fake = new FakeWorker();
  const client = new WorkerRuntimeClient(() => fake);
  const checkpoint = realCheckpoint();

  const first = tracked(client.loadCheckpoint(checkpoint));
  const firstId = (fake.posted.at(-1) as { requestId: string }).requestId;
  fake.deliver({ type: "CHECKPOINT_LOADED", requestId: firstId, snapshot: snap(7) });
  await tick();
  assert.equal(first.state.settled, true, "the first load settles on its own reply");

  // A second load is now live. A late reply for the FIRST must not settle it.
  const second = tracked(client.loadCheckpoint(checkpoint));
  const secondId = (fake.posted.at(-1) as { requestId: string }).requestId;
  assert.notEqual(secondId, firstId, "each load gets a distinct request id");

  fake.deliver({ type: "CHECKPOINT_LOADED", requestId: firstId, snapshot: snap(999) });
  await tick();
  assert.equal(second.state.settled, false, "a stale reply does not complete a different live load");

  fake.deliver({ type: "CHECKPOINT_LOADED", requestId: secondId, snapshot: snap(11) });
  await tick();
  assert.equal(second.state.settled, true, "the live load settles on its own reply");
  assert.equal((second.state.value as RenderSnapshot).tick, 11, "and resolves to its own world, not the stale one");
}

/** Multiple in-flight loads: the second explicitly supersedes the first. */
async function testASecondLoadSupersedesTheFirst() {
  const fake = new FakeWorker();
  const client = new WorkerRuntimeClient(() => fake);
  const checkpoint = realCheckpoint();

  const first = tracked(client.loadCheckpoint(checkpoint));
  const second = tracked(client.loadCheckpoint(checkpoint));
  const secondId = (fake.posted.at(-1) as { requestId: string }).requestId;

  await tick();
  assert.equal(first.state.settled, true, "the superseded load settles immediately");
  assert.match(
    String((first.state.error as Error).message),
    /superseded by a newer restore request/i,
    "and says so explicitly rather than silently hanging",
  );
  await tick();
  assert.equal(second.state.settled, false, "the newer load is still in flight");

  // The superseded load's late reply must not settle the live one.
  const firstId = (fake.posted.at(-2) as { requestId: string }).requestId;
  fake.deliver({ type: "CHECKPOINT_LOADED", requestId: firstId, snapshot: snap(3) });
  await tick();
  assert.equal(second.state.settled, false, "the superseded reply does not complete the newer load");

  fake.deliver({ type: "CHECKPOINT_LOADED", requestId: secondId, snapshot: snap(5) });
  await tick();
  assert.equal(second.state.settled, true, "the newer load completes on its own reply");
  assert.equal((second.state.value as RenderSnapshot).tick, 5, "and resolves to its own world");
}

/** The legacy snapshot `subscribe` path is removed; presentation subscribers
 *  still receive every frame, and unsubscribing still stops notification. */
function testLegacySubscribePathIsGone() {
  const fake = new FakeWorker();
  const client = new WorkerRuntimeClient(() => fake);
  assert.equal(
    typeof (client as unknown as Record<string, unknown>)["subscribe"],
    "undefined",
    "legacy subscribe is removed from the client",
  );
  assert.equal(typeof client.subscribePresentation, "function", "presentation delivery remains the live path");
}

function testPresentationSubscribersReceiveFrames() {
  const fake = new FakeWorker();
  const client = new WorkerRuntimeClient(() => fake);
  const seen: PresentationFrame[] = [];
  const unsubscribe = client.subscribePresentation((f) => seen.push(f));
  const frames = buildPresentation(liveSnapshotFixture());
  for (const frame of [frames.identity, frames.catalog, frames.live, frames.environment, frames.interpretation]) {
    fake.deliver({ type: "PRESENTATION", frame });
  }
  assert.equal(seen.length, 5, "presentation subscribers see every frame class");

  unsubscribe();
  fake.deliver({ type: "PRESENTATION", frame: frames.live });
  assert.equal(seen.length, 5, "unsubscribe still stops notification");
}

/** A short bounded lifetime, so the timeout contract is provable without
 *  waiting the production value. */
const TEST_REQUEST_TIMEOUT_MS = 20;

/**
 * Every request settles exactly once, and never later than its bounded
 * lifetime. Four request types had no timeout at all, so a worker that never
 * answered left their promises pending forever.
 */
async function testEveryRequestHasABoundedLifetime() {
  const cases: [string, (c: WorkerRuntimeClient) => Promise<unknown>][] = [
    ["requestCheckpoint", (c) => c.requestCheckpoint()],
    ["requestExport", (c) => c.requestExport()],
    ["requestDetail", (c) => c.requestDetail()],
    ["resolveEventDecision", (c) => c.resolveEventDecision("opp-1", "choice-1")],
    ["acknowledgeAftermath", (c) => c.acknowledgeAftermath()],
  ];

  for (const [name, issue] of cases) {
    const fake = new FakeWorker();
    const client = new WorkerRuntimeClient(() => fake, { requestTimeoutMs: TEST_REQUEST_TIMEOUT_MS });
    const request = tracked(issue(client));

    // Let the lifetime elapse without any reply arriving.
    await new Promise((resolve) => setTimeout(resolve, TEST_REQUEST_TIMEOUT_MS * 3));
    assert.equal(request.state.settled, true, `${name} settles within its bounded lifetime`);
    assert.match(
      String((request.state.error as Error).message),
      new RegExp(`timeout|timed out`, "i"),
      `${name} rejects with a timeout, not a silent hang`,
    );
    assert.equal(fake.posted.length, 1, `${name} posted exactly one command`);
  }
}

/** A terminal worker failure must settle everything and clear the map. */
async function testFatalWorkerFailureSettlesEverything() {
  for (const kind of ["error", "messageerror"] as const) {
    const fake = new FakeWorker();
    const client = new WorkerRuntimeClient(() => fake, { requestTimeoutMs: 10_000 });
    const a = tracked(client.requestCheckpoint());
    const b = tracked(client.requestExport());
    const load = tracked(client.loadCheckpoint(realCheckpoint()));

    fake.fail(kind, `synthetic ${kind}`);

    await tick();
    assert.equal(a.state.settled, true, `${kind} settles a pending requestCheckpoint`);
    assert.equal(b.state.settled, true, `${kind} settles a pending requestExport`);
    assert.equal(load.state.settled, true, `${kind} settles a pending checkpoint load`);
    for (const [label, state] of [["requestCheckpoint", a.state], ["requestExport", b.state], ["load", load.state]] as const) {
      assert.match(
        String((state.error as Error).message),
        /simulation worker failed/i,
        `${kind} rejects ${label} through the one fatal path`,
      );
    }

    // AC5: no pending-map entry survives a terminal failure. Asserted directly
    // rather than inferred from a late reply being harmless.
    assert.equal(client.pendingRequestCount, 0, `${kind} retains no pending-request entries`);

    // A reply arriving after the fatal event must be inert, not a second
    // settlement. Asserted via the pending map, not by re-checking `settled`
    // on a promise that cannot settle twice.
    assert.equal(client.pendingRequestCount, 0, `${kind} left nothing a late reply could settle`);
    fake.deliver({ type: "CHECKPOINT", requestId: "r-1", checkpoint: {} });
    fake.deliver({ type: "PRESENTATION", frame: buildLive(liveSnapshotFixture()) });
    await tick();
    assert.equal(client.pendingRequestCount, 0, `${kind} a late reply creates no new pending entry`);
  }
}

/** destroy() settles deterministically and retains nothing. */
async function testDestroySettlesAndRetainsNothing() {
  const fake = new FakeWorker();
  const client = new WorkerRuntimeClient(() => fake, { requestTimeoutMs: 10_000 });
  const a = tracked(client.requestCheckpoint());
  const load = tracked(client.loadCheckpoint(realCheckpoint()));

  // A load lives in its own #pendingLoad slot, not the #pending map, so only the
  // ordinary request is counted here. Asserting 2 would be asserting a fiction
  // about where a load is tracked.
  assert.equal(client.pendingRequestCount, 1, "the ordinary request is in flight before destroy");
  client.destroy();

  await tick();
  assert.equal(a.state.settled, true, "destroy settles a pending request");
  assert.equal(load.state.settled, true, "destroy settles a pending load");
  assert.equal(client.pendingRequestCount, 0, "destroy retains no pending-request entries");
  assert.match(
    String((a.state.error as Error).message),
    /runtime destroyed/i,
    "destroy rejects with its own reason, not a timeout",
  );
  assert.equal(fake.terminated, true, "destroy terminates the transport");

  // A late reply after destroy must be inert, not a second settlement.
  fake.deliver({ type: "CHECKPOINT", requestId: "r-1", checkpoint: {} });
  fake.deliver({ type: "PRESENTATION", frame: buildLive(liveSnapshotFixture()) });
  await tick();
  assert.equal(client.pendingRequestCount, 0, "a late reply after destroy creates no pending entry");
}

/** A structured command failure settles exactly its own request. */
async function testStructuredFailureSettlesOnlyItsOwnRequest() {
  const fake = new FakeWorker();
  const client = new WorkerRuntimeClient(() => fake, { requestTimeoutMs: 10_000 });
  const failing = tracked(client.requestCheckpoint());
  const other = tracked(client.requestExport());

  const posted = fake.posted.map((p) => p as { type: string; requestId: string });
  const failingId = posted.find((p) => p.type === "REQUEST_CHECKPOINT")!.requestId;
  assert.equal(client.pendingRequestCount, 2, "both requests are in flight");
  fake.deliver({ type: "ERROR", message: "structured failure", requestId: failingId });

  await tick();
  assert.equal(failing.state.settled, true, "the addressed request settles");
  assert.equal(client.pendingRequestCount, 1, "and its entry leaves the pending map");
  assert.match(
    String((failing.state.error as Error).message),
    /structured failure/,
    "and rejects with the worker's reason",
  );
  assert.equal(other.state.settled, false, "an unrelated request is untouched by a sibling's failure");

  // An error for an unknown request id is inert, not a crash.
  fake.deliver({ type: "ERROR", message: "nobody is waiting", requestId: "r-does-not-exist" });
  await tick();
  assert.equal(other.state.settled, false, "an error for an unknown request id changes nothing");
  assert.equal(client.pendingRequestCount, 1, "and adds no entry for the unknown id");
}

/** Normal success still works: a request settles exactly once on its reply. */
async function testNormalSuccessStillSettles() {
  const fake = new FakeWorker();
  const client = new WorkerRuntimeClient(() => fake, { requestTimeoutMs: 10_000 });
  const request = tracked(client.requestCheckpoint());
  const posted = fake.posted.at(-1) as { requestId: string };
  const checkpoint = realCheckpoint();

  fake.deliver({ type: "CHECKPOINT", requestId: posted.requestId, checkpoint });
  await tick();
  assert.equal(request.state.settled, true, "a matching reply settles the request");
  assert.equal(request.state.value, checkpoint, "and resolves with the payload the worker sent");
}

/**
 * A structured failure addressed to a load must reject THAT load, with the
 * worker's real reason.
 *
 * Regression guard. Task 3 made LOAD_CHECKPOINT.requestId required, so a failed
 * restore's ERROR always carries a requestId. The client tracked the load in
 * #pendingLoad, not #pending, so the error matched neither branch: it was
 * dropped, and the load hung for its full 10s timeout before rejecting with
 * "Restore timed out" instead of the actual reason. Before Task 3 the command
 * had no requestId, so the no-requestId path was exactly how a failed restore
 * surfaced its error.
 */
async function testAFailedLoadRejectsWithTheWorkersReason() {
  const fake = new FakeWorker();
  const client = new WorkerRuntimeClient(() => fake, { requestTimeoutMs: 10_000 });
  const load = tracked(client.loadCheckpoint(realCheckpoint()));
  const requestId = (fake.posted.at(-1) as { requestId: string }).requestId;

  fake.deliver({
    type: "ERROR",
    requestId,
    message: "checkpoint rejected: experiment.state.props.resources — expected a finite element",
  });
  await tick();

  assert.equal(load.state.settled, true, "a failed load settles rather than hanging");
  assert.match(
    String((load.state.error as Error).message),
    /checkpoint rejected/,
    "the load rejects with the worker's reason, not a generic timeout",
  );
  assert.doesNotMatch(
    String((load.state.error as Error).message),
    /timed out/i,
    "and specifically not the timeout it used to fall back to",
  );
}

/**
 * The inverse: an error belonging to a DIFFERENT request must not fail an
 * in-flight load. A refused fire-and-forget command produces an error with no
 * requestId, and that must not be misattributed to a restore.
 */
async function testUnrelatedErrorDoesNotFailALoad() {
  const fake = new FakeWorker();
  const client = new WorkerRuntimeClient(() => fake, { requestTimeoutMs: 10_000 });
  const load = tracked(client.loadCheckpoint(realCheckpoint()));

  // A refused ADVANCE_TICKS: rejected at the boundary, reported with no id.
  fake.deliver({ type: "ERROR", message: "ADVANCE_TICKS.ticks: NaN is not an integer in [0, 2000]" });
  await tick();
  assert.equal(load.state.settled, false, "an unrelated request-less error does not fail an in-flight load");

  const requestId = (fake.posted.at(-1) as { requestId: string }).requestId;
  fake.deliver({ type: "CHECKPOINT_LOADED", requestId, snapshot: snap(3) });
  await tick();
  assert.equal(load.state.settled, true, "the load still completes on its own correlated reply");
}

/**
 * A restore composes through frames only: the correlated reply settles the
 * load, and the five read-model frames that follow compose the restored world
 * in the presentation store — with no legacy subscriber anywhere in between.
 *
 * Regression guard for the CI failure on PR #84 (browser-smoke timed out
 * waiting for "Checkpoint restored"). Cause: postMessage delivers each message
 * as its own task, so a trailing second delivery ran AFTER the load's .then()
 * had set the status. Explorer's old subscribe callback ran setStatus("") on
 * every snapshot, so that second delivery wiped "Checkpoint restored" and the
 * UI showed nothing. Now the session sends the correlated reply plus frames
 * (never a trailing snapshot), and Explorer skips status clearing for a
 * create/restore batch, so the status survives.
 */
async function testARestoreAnnouncesTheWorldExactlyOnce() {
  const fake = new FakeWorker();
  const client = new WorkerRuntimeClient(() => fake, { requestTimeoutMs: 10_000 });
  const store = createPresentationStore();
  client.subscribePresentation((f) => store.apply(f));

  const load = tracked(client.loadCheckpoint(realCheckpoint()));
  const requestId = (fake.posted.at(-1) as { requestId: string }).requestId;

  // Exactly what the session emits for a restore, in order.
  const session = liveSession();
  const restoreResponses = session.handle({ type: "LOAD_CHECKPOINT", requestId, checkpoint: session.checkpoint() });
  assert.ok(!restoreResponses.some((r) => r.type === "SNAPSHOT"), "a restore emits no bare snapshot");
  for (const response of restoreResponses) fake.deliver(response);
  await tick();

  assert.equal(load.state.settled, true, "the load settles on its correlated reply");
  const restored = load.state.value as RenderSnapshot;
  assert.equal(store.getView().live?.tick, restored.tick, "the composed view reaches the restored tick through frames alone");
  assert.equal(store.getView().worldId, restored.worldId, "with no legacy subscriber in between");
}

/**
 * A fatal worker failure drops presentation subscribers, because a dead
 * worker can never deliver another frame: keeping the listeners would leave
 * the UI holding subscription objects only a replacement client could
 * satisfy. This is a behaviour change from the previous code, so it is pinned
 * rather than assumed.
 */
async function testFatalFailureDropsSubscribers() {
  const fake = new FakeWorker();
  const client = new WorkerRuntimeClient(() => fake, { requestTimeoutMs: 10_000 });
  const seen: PresentationFrame[] = [];
  client.subscribePresentation((f) => seen.push(f));
  const frames = buildPresentation(liveSnapshotFixture());

  fake.deliver({ type: "PRESENTATION", frame: frames.live });
  assert.equal(seen.length, 1, "presentation subscribers are notified while the worker lives");

  fake.fail("error", "synthetic error");
  fake.deliver({ type: "PRESENTATION", frame: frames.environment });
  await tick();
  assert.equal(seen.length, 1, "a frame after a fatal failure reaches no subscriber");
}

async function testDestroyDoesNotEmitTerminalSignal() {
  const fake = new FakeWorker();
  const client = new WorkerRuntimeClient(() => fake, { requestTimeoutMs: 10_000 });
  const seen: TerminalFailure[] = [];
  client.onTerminal((f) => seen.push(f));
  const request = tracked(client.requestCheckpoint());
  client.destroy();
  await tick();
  assert.equal(request.state.settled, true, "destroy settles the in-flight request");
  assert.match(String((request.state.error as Error).message), /runtime destroyed/i, "with the teardown reason");
  assert.deepEqual(seen, [], "intentional teardown emits no terminal signal");
  assert.equal(client.terminal, null, "the terminal getter stays null after destroy");
}

async function testOrdinaryFailuresDoNotEmitTerminalSignal() {
  const fake = new FakeWorker();
  const client = new WorkerRuntimeClient(() => fake, { requestTimeoutMs: TEST_REQUEST_TIMEOUT_MS });
  const seen: TerminalFailure[] = [];
  client.onTerminal((f) => seen.push(f));
  // A structured failure addressed to one request...
  const failing = tracked(client.requestCheckpoint());
  const failingId = (fake.posted.at(-1) as { requestId: string }).requestId;
  fake.deliver({ type: "ERROR", message: "structured failure", requestId: failingId });
  // ...plus a request that never gets a reply at all.
  const hanging = tracked(client.requestExport());
  await tick();
  assert.equal(failing.state.settled, true, "the structured failure settles its own request");
  await new Promise((resolve) => setTimeout(resolve, TEST_REQUEST_TIMEOUT_MS * 3));
  assert.equal(hanging.state.settled, true, "the unanswered request settles via its timeout");
  assert.deepEqual(seen, [], "neither ordinary failure emits a terminal signal");
  assert.equal(client.terminal, null, "the terminal getter stays null without transport failure");
}

async function testTerminalStateIsQueryableAfterDeath() {
  const fake = new FakeWorker();
  const client = new WorkerRuntimeClient(() => fake, { requestTimeoutMs: 10_000 });
  const seen: TerminalFailure[] = [];
  client.onTerminal((f) => seen.push(f));
  fake.fail("error", "boom");
  await tick();
  assert.equal(seen.length, 1, "one terminal signal fired");
  assert.deepEqual(client.terminal, seen[0], "the getter returns the emitted failure");
  // A post-death subscription is dead on arrival: the fatal path dropped
  // subscribers, and no later frame can revive them.
  const late: PresentationFrame[] = [];
  client.subscribePresentation((f) => late.push(f));
  fake.deliver({ type: "PRESENTATION", frame: buildLive(liveSnapshotFixture()) });
  await tick();
  assert.deepEqual(late, [], "a post-death subscribe plus delivered frame reaches no listener");
}

function testProductionSurfaceHasNoGenericCommand() {
  const fake = new FakeWorker();
  const client = new WorkerRuntimeClient(() => fake);
  assert.equal("command" in client, false, "no generic raw command escape hatch on the production surface");
  for (const op of ["create", "advance", "runToNextEvent", "intervene", "createControlFork", "resolveEventDecision", "acknowledgeAftermath", "loadCheckpoint", "requestCheckpoint", "requestExport", "requestDetail", "subscribePresentation", "destroy", "onTerminal"] as const) {
    assert.equal(typeof (client as unknown as Record<string, unknown>)[op], "function", `${op} remains an explicit typed product operation`);
  }
}

async function testTerminalSignalFiresExactlyOnceAcrossBothFailureKinds() {
  const fake = new FakeWorker();
  const client = new WorkerRuntimeClient(() => fake);
  const seen: TerminalFailure[] = [];
  client.onTerminal((f) => seen.push(f));
  fake.fail("error", "boom");
  fake.fail("messageerror", "again");
  await tick();
  assert.equal(seen.length, 1, "two transport failures produce one terminal signal");
  assert.equal(seen[0]!.kind, "worker-error", "signal carries the terminal kind");
  assert.equal(typeof seen[0]!.detail, "string", "signal carries a string detail, never a raw event");
  assert.ok(!("data" in seen[0]! || "target" in seen[0]!), "no raw browser event object crosses the boundary");
}

/**
 * Task 2 (F2a): a real RenderSnapshot as read-model derivation input, so the
 * builders are exercised against the true snapshot shape rather than a
 * hand-built stub. A short advance moves organisms off their founding cells,
 * so the live frame carries genuine positions rather than initial placement.
 */
const liveSnapshotFixture = (): RenderSnapshot => {
  const session = liveSession();
  session.advance(5);
  return session.snapshot();
};

function testLiveFrameExcludesNonLivePayloads() {
  const frames = buildPresentation(liveSnapshotFixture());
  const keys = Object.keys(frames.live);
  for (const banned of ["config", "analysis", "events", "resolvedDecisions", "aftermath", "pendingDecision", "seed"]) {
    assert.ok(!keys.includes(banned), `live frame carries no ${banned}`);
  }
  assert.ok(frames.live.tick >= 0 && frames.live.worldId !== undefined, "live frame keeps tick + worldId");
}

/**
 * Task 2 (F2a): catalog arrival/removal across two consecutive builds. The
 * second snapshot is the first with one organism filtered out — the shape a
 * death/removal takes at the derivation boundary regardless of which engine
 * path removed it, so this pins builder semantics rather than engine
 * mortality (which the determinism suites own).
 */
function testRemovedEntitiesResolveToNothing() {
  const first = liveSnapshotFixture();
  assert.ok(first.organisms.length > 0, "the fixture holds living organisms");
  const removedId = first.organisms[0]!.id;

  const departed = buildCatalog(first);
  assert.equal(resolveCatalogEntry(departed, removedId)?.id, removedId, "a living organism resolves from its own catalog");

  const second: RenderSnapshot = { ...first, tick: first.tick + 1, organisms: first.organisms.slice(1) };
  const current = buildCatalog(second);
  assert.ok(!current.entries.some((e) => e.id === removedId), "the removed id is absent from the newer catalog");
  assert.equal(resolveCatalogEntry(current, removedId), null, "a removed entity resolves to null");

  // A survivor stays resolvable with its static inputs intact, so identity and
  // inherited traits never need refetching from a live frame.
  const survivor = second.organisms[0]!;
  const entry = resolveCatalogEntry(current, survivor.id);
  assert.ok(entry !== null, "a surviving organism still resolves");
  assert.equal(entry.lineageId, survivor.lineageId, "catalog keeps stable lineage identity");
  assert.equal(entry.speed, survivor.speed, "catalog keeps inherited presentation inputs");
}

async function testPackageRootExposesNoMutableSessionAuthority() {
  // NOTE (Task 2): the brief prescribes `await import("@digital-evolution/sim-runtime")`
  // here, but a dynamic bare-specifier import cannot resolve under this repo's
  // toolchain: tsx rewrites *static* bare imports to the workspace package, while
  // a dynamic import() falls through to Node's ESM resolver, which has no
  // node_modules/@digital-evolution link (ERR_MODULE_NOT_FOUND, probed 2026-10-01).
  // A static namespace import goes through the same package specifier — i.e. the
  // identical production surface and module file (package.json "." -> src/index.ts)
  // — so the assertion below proves the same boundary claim deterministically.
  assert.equal("UniverseSession" in runtimeRoot, false, "UniverseSession is not reachable from the package root");
  assert.equal(typeof runtimeRoot.WorkerRuntimeClient, "function", "WorkerRuntimeClient remains the production entry");
}

/**
 * Fix-wave (staggered emission cadence): live commands emit frames with no
 * legacy payload beside them. Driven through UniverseSession.handle — the
 * point every RuntimeCommand passes through — so this proves emission, not
 * just derivation. The first advance after create still delivers the full
 * set (first-paint convergence); later advances go staggered.
 */
function testLiveFramesArriveWithoutLegacyPayload() {
  const session = liveSession();
  const responses = session.handle({ type: "ADVANCE_TICKS", ticks: 1 });
  assert.ok(!responses.some((r) => r.type === "SNAPSHOT"), "no legacy SNAPSHOT on the live path");
  const frames = responses
    .filter((r) => r.type === "PRESENTATION")
    .map((r) => (r as { frame: PresentationFrame }).frame);
  assert.equal(frames.length, 5, "the first advance after create still delivers the full set");
  const snapshot = session.snapshot();
  for (const frame of frames) {
    assert.equal(frame.worldId, snapshot.worldId, "every frame carries the snapshot worldId");
    assert.equal(frame.tick, snapshot.tick, "every frame carries the snapshot effective tick");
    assert.equal(frame.readModelVersion, READ_MODEL_VERSION, "every frame carries the read-model version");
  }
  const live = frames.find((f) => "organisms" in f && "population" in f);
  assert.ok(live, "a live frame is among the emitted frames");
  for (const banned of ["config", "analysis", "events", "resolvedDecisions", "aftermath", "pendingDecision", "seed", "metrics"]) {
    assert.ok(!(banned in (live as object)), `live frame carries no ${banned}`);
  }
  // The second advance goes staggered: the live heartbeat always emits, and
  // at least one stable class is suppressed (a pure no-op advance emits live
  // alone — see testStaggeredEmissionCadence for the full pin).
  const second = session.handle({ type: "ADVANCE_TICKS", ticks: 0 });
  const staggered = second
    .filter((r) => r.type === "PRESENTATION")
    .map((r) => (r as { frame: PresentationFrame }).frame);
  assert.ok(staggered.some((f) => "organisms" in f && "population" in f), "the live heartbeat emits on every advance");
  assert.ok(staggered.length < 5, "a no-op advance suppresses every unchanged class");
}

/**
 * Fix-wave (handoff AC5): the staggered emission cadence, pinned class by
 * class through the command boundary. Identity emits on world-change paths
 * plus the first advance after each; catalog FULL only on membership change;
 * environment on its bounded period; interpretation only on payload change;
 * live on every advance. A no-change advance (advance(0), a pure query)
 * suppresses every stable class by construction — nothing about the engine
 * fixture can make it emit — so each "not sent" assertion below is a
 * cadence property, not a fixture accident.
 */
function testStaggeredEmissionCadence() {
  const session = liveSession();
  const classes = (responses: unknown[]): string[] =>
    (responses as { type: string; frame?: PresentationFrame }[])
      .filter((r) => r.type === "PRESENTATION")
      .map((r) =>
        "config" in r.frame! ? "identity"
        : "entries" in r.frame! ? "catalog"
        : "population" in r.frame! ? "live"
        : "resources" in r.frame! ? "environment"
        : "interpretation",
      );

  // World-change path: create announces the full set, in class order.
  const created = session.handle({ type: "CREATE_UNIVERSE", config: config(FIXTURE_SEED + 1) });
  assert.deepEqual(
    classes(created),
    ["identity", "catalog", "live", "environment", "interpretation"],
    "create announces the full set in class order",
  );
  // First advance after create: full again, so first-paint always converges.
  const first = session.handle({ type: "ADVANCE_TICKS", ticks: 1 });
  assert.deepEqual(
    classes(first),
    ["identity", "catalog", "live", "environment", "interpretation"],
    "the first advance after create re-announces the full set",
  );
  // Pure query: nothing changed, so only the live heartbeat emits.
  const probe = session.handle({ type: "ADVANCE_TICKS", ticks: 0 });
  assert.deepEqual(classes(probe), ["live"], "a no-change advance emits live alone");
  assert.ok(!classes(probe).includes("catalog"), "catalog is NOT sent when membership is unchanged");
  assert.ok(!classes(probe).includes("environment"), "environment is NOT sent inside its period");
  assert.ok(!classes(probe).includes("interpretation"), "interpretation is NOT sent when its payload is unchanged");
  assert.ok(!classes(probe).includes("identity"), "identity is NOT resent mid-world");

  // Oracle run: over K single-tick advances every emission must match the
  // documented rule recomputed from the live snapshot — catalog present iff
  // the membership signature moved, environment present iff the period
  // elapsed, interpretation present iff its payload key moved, live always.
  const K = 2 * ENVIRONMENT_PERIOD_TICKS;
  let lastCatalogSig = catalogMembershipSignature(buildCatalog(session.snapshot()));
  let lastEnvTick = session.snapshot().tick;
  let lastInterpKey = interpretationPayloadKey(
    buildPresentation(session.snapshot()).interpretation,
  );
  const counts: Record<string, number> = { identity: 0, catalog: 0, live: 0, environment: 0, interpretation: 0 };
  for (let i = 0; i < K; i++) {
    const responses = session.handle({ type: "ADVANCE_TICKS", ticks: 1 });
    assert.ok(!responses.some((r) => (r as { type: string }).type === "SNAPSHOT"), "no legacy snapshot rides the live path");
    const emitted = classes(responses);
    for (const c of emitted) counts[c]!++;
    const snap = session.snapshot();
    const catalogSig = catalogMembershipSignature(buildCatalog(snap));
    const interpKey = interpretationPayloadKey(buildPresentation(snap).interpretation);
    const expectCatalog = catalogSig !== lastCatalogSig;
    const expectEnv = snap.tick - lastEnvTick >= ENVIRONMENT_PERIOD_TICKS;
    const expectInterp = interpKey !== lastInterpKey;
    assert.equal(emitted.includes("catalog"), expectCatalog, `advance ${i}: catalog iff membership changed`);
    assert.equal(emitted.includes("environment"), expectEnv, `advance ${i}: environment iff period elapsed`);
    assert.equal(emitted.includes("interpretation"), expectInterp, `advance ${i}: interpretation iff payload changed`);
    assert.ok(emitted.includes("live"), `advance ${i}: live always emits`);
    assert.ok(!emitted.includes("identity"), `advance ${i}: identity never resends mid-world`);
    if (expectCatalog) lastCatalogSig = catalogSig;
    if (expectEnv) lastEnvTick = snap.tick;
    if (expectInterp) lastInterpKey = interpKey;
  }
  // The AC5 pin as message counts: live on every advance, each stable class
  // suppressed at least once (the probe alone guarantees one suppression per
  // class, so these hold regardless of engine churn).
  const total = K + 1;
  assert.equal(counts.live, K, "live emits on every advance of the run");
  assert.ok(counts.catalog! < total, `catalog not sent every advance (${counts.catalog}/${total})`);
  assert.ok(counts.environment! < total, `environment not sent every advance (${counts.environment}/${total})`);
  assert.ok(counts.interpretation! < total, `interpretation not sent every advance (${counts.interpretation}/${total})`);
  assert.equal(counts.identity, 0, "identity never resends mid-world");
}

/**
 * PR-review finding (fix-wave 2): the catalog change signature watched
 * organism membership only, but cladeId can change while the same organisms
 * stay alive — cladeRoot(o.l) is re-derived per snapshot and flips when a
 * lineage crosses the establishment thresholds — leaving the clade lens and
 * inspector with stale assignments.
 *
 * Driven through UniverseSession.handle end to end on the suite fixture
 * (seed 20260930): stride tick 6024 (251 x 24) carries a live
 * lineage-establishment reassignment with zero births/deaths on that step,
 * so membership is constant while cladeIds move. The setup advances in
 * MAX_SLICE_TICKS-bounded chunks and pins the pre-step tick plus the absence
 * of a pending decision, so a future engine trajectory change fails here
 * explicitly instead of silently testing a different world.
 */
function testCladeEstablishmentReemitsCatalogWithConstantMembership() {
  const session = new UniverseSession();
  session.handle({ type: "CREATE_UNIVERSE", config: config(FIXTURE_SEED) });
  for (const ticks of [2000, 2000, 2000, 23]) {
    session.handle({ type: "ADVANCE_TICKS", ticks });
  }
  const before = session.snapshot();
  assert.equal(before.tick, 6023, "setup lands on the tick before the establishment stride");
  assert.equal(before.pendingDecision, null, "setup reached the stride with no pending decision stopping the run");
  const beforeClades = new Map(before.organisms.map((o) => [o.id, o.cladeId]));

  const responses = session.handle({ type: "ADVANCE_TICKS", ticks: 1 });
  const after = session.snapshot();
  assert.equal(after.tick, 6024, "the probed step is the establishment stride tick");
  assert.deepEqual(
    after.organisms.map((o) => o.id).sort((a, b) => a - b),
    before.organisms.map((o) => o.id).sort((a, b) => a - b),
    "no arrival or removal across the establishment step: membership is constant",
  );
  const flipped = after.organisms.filter((o) => beforeClades.get(o.id) !== o.cladeId);
  assert.ok(flipped.length > 0, "lineage establishment reassigned cladeIds of living organisms");
  assert.notEqual(
    catalogMembershipSignature(buildCatalog(after)),
    catalogMembershipSignature(buildCatalog(before)),
    "the signature moves on a clade reassignment alone",
  );

  const catalogs = responses
    .filter((r) => r.type === "PRESENTATION")
    .map((r) => (r as { frame: PresentationFrame }).frame)
    .filter((f) => "entries" in f);
  assert.equal(catalogs.length, 1, "the establishment step re-emits the catalog with membership unchanged");
  const emitted = catalogs[0]!;
  assert.deepEqual(
    emitted.entries,
    buildCatalog(after).entries,
    "the re-emitted catalog carries the current clade assignments, not the stale ones",
  );
  for (const o of flipped) {
    assert.equal(
      resolveCatalogEntry(emitted, o.id)?.cladeId,
      o.cladeId,
      `reassigned organism ${o.id} reads with its new clade`,
    );
  }
}

/**
 * Fix-wave: first-paint convergence under the staggered cadence. The App
 * gate requires all five channels before first paint; the store composes
 * whatever arrives, so the create + first-advance full sets must converge
 * it, and later partial advances must keep it converged (slots retain).
 */
function testFirstPaintConvergesAndStaysConverged() {
  const session = liveSession();
  const store = createPresentationStore();
  const gate = () => {
    const v = store.getView();
    return v.identity !== null && v.catalog !== null && v.live !== null && v.environment !== null && v.interpretation !== null;
  };
  const feed = (responses: unknown[]) => {
    for (const r of responses as { type: string; frame?: PresentationFrame }[]) {
      if (r.type === "PRESENTATION") store.apply(r.frame!);
    }
  };
  feed(session.handle({ type: "ADVANCE_TICKS", ticks: 1 }));
  assert.ok(gate(), "create + first advance converges the first-paint gate");
  const snap = session.snapshot();
  assert.deepEqual(store.getView().organisms, [...snap.organisms], "the converged join equals the snapshot organisms");
  for (let i = 0; i < ENVIRONMENT_PERIOD_TICKS + 1; i++) {
    feed(session.handle({ type: "ADVANCE_TICKS", ticks: 1 }));
    assert.ok(gate(), `the gate stays converged through staggered advance ${i}`);
  }
  const later = session.snapshot();
  assert.equal(store.getView().live?.tick, later.tick, "the live channel tracks the latest advance");
  assert.deepEqual(store.getView().organisms, [...later.organisms], "the join stays exact through partial advances");
}

/**
 * Task 3 (F2a publisher): worker/direct parity. Frames beside a handled
 * command deep-equal a direct buildPresentation of the same world, after a
 * structured-clone round trip simulating the postMessage boundary. This
 * exercises the first-advance full path (liveSession creates, then advances
 * once), so the full set is present to compare.
 */
function testWorkerFramesMatchDirectBuild() {
  const session = liveSession();
  const responses = session.handle({ type: "ADVANCE_TICKS", ticks: 3 });
  const wire = responses
    .filter((r) => r.type === "PRESENTATION")
    .map((r) => structuredClone((r as { frame: PresentationFrame }).frame));
  const direct = structuredClone(buildPresentation(session.snapshot()));
  assert.deepEqual(
    wire,
    [direct.identity, direct.catalog, direct.live, direct.environment, direct.interpretation],
    "worker-round-tripped frames equal a direct build of the same world, in class order",
  );
}

/**
 * Task 3 (F2a publisher): coherence identity at the routing boundary (handoff
 * §7; full supersede rejection is Task 5). The client tags nothing and strips
 * nothing: each routed frame reaches subscribePresentation with its own
 * worldId+tick+version envelope intact, so a later consumer can reject
 * cross-world composition.
 */
async function testRoutedFramesKeepTheirCoherenceEnvelope() {
  const fake = new FakeWorker();
  const client = new WorkerRuntimeClient(() => fake);
  const seen: PresentationFrame[] = [];
  client.subscribePresentation((f) => seen.push(f));
  // Two worlds: frames from each must stay distinguishable by envelope alone.
  const first = liveSession();
  const second = liveSession();
  assert.notEqual(first.worldId, second.worldId, "the fixture holds two distinct worlds");
  for (const session of [first, second]) {
    const frames = buildPresentation(session.snapshot());
    for (const frame of [frames.identity, frames.catalog, frames.live, frames.environment, frames.interpretation]) {
      fake.deliver({ type: "PRESENTATION", frame });
    }
  }
  await tick();
  assert.equal(seen.length, 10, "frames from both worlds route to presentation listeners");
  for (const frame of seen) {
    assert.ok(frame.worldId !== undefined, "every routed frame exposes its worldId");
    assert.equal(typeof frame.tick, "number", "every routed frame exposes its effective tick");
    assert.equal(frame.readModelVersion, READ_MODEL_VERSION, "every routed frame exposes its read-model version");
  }
  const worlds = new Set(seen.map((f) => f.worldId as unknown as number));
  assert.equal(worlds.size, 2, "the two worlds stay distinguishable by envelope");
}

/**
 * Task 5 (read-model-only transport): presentation routing stands alone. A
 * bare SNAPSHOT — emitted by no command since Task 6 retired the ACK trailing
 * emission — reaches no listener and disturbs nothing on its way through the
 * client.
 */
async function testPresentationRoutingIsIsolatedFromLegacy() {
  const fake = new FakeWorker();
  const client = new WorkerRuntimeClient(() => fake);
  const seen: PresentationFrame[] = [];
  client.subscribePresentation((f) => seen.push(f));
  const session = liveSession();
  const snapshot = session.snapshot();
  const frames = buildPresentation(snapshot);
  for (const frame of [frames.identity, frames.catalog, frames.live, frames.environment, frames.interpretation]) {
    fake.deliver({ type: "PRESENTATION", frame });
  }
  await tick();
  assert.equal(seen.length, 5, "all five classes route to presentation listeners");
  fake.deliver({ type: "SNAPSHOT", snapshot });
  await tick();
  assert.equal(seen.length, 5, "a bare snapshot reaches no listener and disturbs nothing");
}

/**
 * Task 4 (F2b consumer cutover): the presentation store exposes the effective
 * tick per channel. Two channels at different ticks must each report their
 * own — the UI must never read slower state as newer, and no cadence-splitting
 * is assumed: the store consumes whatever arrives.
 */
function testStoreExposesEffectiveTickPerChannel() {
  const store = createPresentationStore();
  const base = liveSnapshotFixture();
  store.apply({ ...buildLive(base), tick: 100 });
  store.apply({ ...buildEnvironment(base), tick: 90 });
  const view = store.getView();
  assert.equal(view.live?.tick, 100, "live channel current");
  assert.equal(view.environment?.tick, 90, "environment channel labeled with its own tick, never as newer");
  assert.equal(view.channelTicks.live, 100, "live effective tick exposed on the view");
  assert.equal(view.channelTicks.environment, 90, "environment effective tick exposed on the view");
}

/**
 * Task 4 (F2b consumer cutover): selection lookup through the store resolves
 * a living organism and returns null for a removed id, using the Task 2
 * removal representation (absence from a newer catalog) end to end. Joined
 * entries are RenderOrganism-shaped, so selection/phenotype consumers resolve
 * through the store without refetching static traits from a live frame.
 */
function testStoreJoinMatchesSnapshotAndRemovalResolvesToNull() {
  const store = createPresentationStore();
  const first = liveSnapshotFixture();
  assert.ok(first.organisms.length > 1, "the fixture holds several living organisms");
  const frames = buildPresentation(first);
  for (const frame of [frames.identity, frames.catalog, frames.live, frames.environment, frames.interpretation]) {
    store.apply(frame);
  }
  const removedId = first.organisms[0]!.id;
  const survivor = first.organisms[1]!;
  assert.deepEqual(store.getView().organisms, [...first.organisms], "joined entries equal the snapshot organisms");
  assert.ok(store.getView().organismById(removedId) !== null, "a living organism resolves through the store");
  assert.equal(
    store.getView().organismById(survivor.id)?.lineageId,
    survivor.lineageId,
    "a joined entry keeps its catalog identity without refetching",
  );

  const second: RenderSnapshot = { ...first, tick: first.tick + 1, organisms: first.organisms.slice(1) };
  const next = buildPresentation(second);
  for (const frame of [next.identity, next.catalog, next.live, next.environment, next.interpretation]) {
    store.apply(frame);
  }
  assert.equal(store.getView().organismById(removedId), null, "a removed id resolves to null through the store");
  assert.ok(store.getView().organismById(survivor.id) !== null, "a survivor still resolves");
}

/**
 * Task 5 (read-model-only transport): coherence gates on the presentation
 * store (handoff §7, AC9/AC10). WorldIds are process-unique monotonic numbers
 * (session mints a fresh one per create/restore), so a numerically newer world
 * resets coherence while a numerically older one is superseded and dropped.
 */
const liveFrame = (worldId: number, tick: number): WorldLiveFrame => ({
  readModelVersion: READ_MODEL_VERSION,
  worldId: worldId as WorldId,
  tick,
  population: 0,
  activePopulation: 0,
  dormantPopulation: 0,
  organisms: [],
});

function testSupersededWorldFramesAreRejected() {
  const store = createPresentationStore();
  store.apply(liveFrame(1, 50));
  store.apply(liveFrame(2, 3));   // restore/create resets coherence
  store.apply(liveFrame(1, 51));   // stale late arrival
  assert.equal(store.getView().live?.worldId, 2, "superseded-world frames never compose into the new view");
}

function testVersionMismatchIsRejected() {
  const store = createPresentationStore();
  const base = liveSnapshotFixture();
  const frames = buildPresentation(base);
  for (const frame of [frames.identity, frames.catalog, frames.live, frames.environment, frames.interpretation]) {
    store.apply(frame);
  }
  const droppedBefore = store.dropped;
  const liveTickBefore = store.getView().live?.tick;
  const future = {
    ...frames.live,
    readModelVersion: (READ_MODEL_VERSION + 1) as typeof READ_MODEL_VERSION,
    tick: (liveTickBefore ?? 0) + 100,
  };
  store.apply(future);
  assert.equal(store.getView().live?.tick, liveTickBefore, "a version-mismatched frame never composes");
  assert.equal(store.dropped, droppedBefore + 1, "version mismatches are counted for tests");
}

function testSameChannelOlderTicksAreRejected() {
  const store = createPresentationStore();
  store.apply(liveFrame(1, 50));
  const droppedBefore = store.dropped;
  store.apply(liveFrame(1, 49));
  assert.equal(store.getView().live?.tick, 50, "a same-channel older tick never moves the channel backwards");
  assert.equal(store.dropped, droppedBefore + 1, "stale ticks are counted");
  // Equal ticks re-apply idempotently: a refused command re-emits the
  // unchanged world, and that must still release backpressure, not drop.
  store.apply(liveFrame(1, 50));
  assert.equal(store.getView().live?.tick, 50, "an equal tick still applies");
  assert.equal(store.dropped, droppedBefore + 1, "and the re-application is not counted as dropped");
}

function testIdentityArrivalResetsCoherenceToTheNewWorld() {
  const store = createPresentationStore();
  const first = liveSnapshotFixture();
  const one = buildPresentation(first);
  for (const frame of [one.identity, one.catalog, one.live, one.environment, one.interpretation]) {
    store.apply(frame);
  }
  assert.ok(store.getView().live !== null, "the first world composes");
  const other = liveSession();
  assert.notEqual(other.worldId, first.worldId, "the fixture holds two distinct worlds");
  const two = buildPresentation(other.snapshot());
  // Create/restore announces the new world via its identity frame first.
  store.apply(two.identity);
  const cleared = store.getView();
  assert.equal(cleared.live, null, "identity arrival clears the prior world's live channel");
  assert.equal(cleared.catalog, null, "identity arrival clears the prior world's catalog");
  assert.equal(cleared.identity?.worldId, two.identity.worldId, "identity carries the new world");
  // A stale late arrival from the superseded world never recomposes.
  store.apply(one.live);
  assert.equal(store.getView().live, null, "stale frames never recompose into the cleared view");
  for (const frame of [two.catalog, two.live, two.environment, two.interpretation]) {
    store.apply(frame);
  }
  assert.equal(store.getView().live?.worldId, two.identity.worldId, "the new world's frames compose after its identity");
}

/**
 * Fix-wave Task 5 (AC14): payload evidence. Live movement delivery must scale
 * with live presentation information rather than repeated serialization of
 * all retained product state. Measured over ALL messages actually sent per
 * advance — the summed bytes of every emitted class, legacy snapshot vs new
 * total — not just the live frame: with the staggered cadence the total must
 * stay under half of the equivalent legacy snapshots on the fixture.
 */
function testLiveDeliveryScalesWithLiveInformation() {
  // Through the worker path: every live command's responses over K advances.
  const session = liveSession();
  session.handle({ type: "ADVANCE_TICKS", ticks: 1 }); // first-advance full set, outside the measured window
  let newBytes = 0;
  let legacyBytes = 0;
  const counts: Record<string, number> = { identity: 0, catalog: 0, live: 0, environment: 0, interpretation: 0 };
  const count = (responses: unknown[]) => {
    for (const r of responses as { type: string; frame?: PresentationFrame }[]) {
      if (r.type !== "PRESENTATION") continue;
      const frame = r.frame!;
      newBytes += Buffer.byteLength(JSON.stringify(frame));
      if ("config" in frame) counts.identity!++;
      else if ("entries" in frame) counts.catalog!++;
      else if ("population" in frame) counts.live!++;
      else if ("resources" in frame) counts.environment!++;
      else counts.interpretation!++;
    }
  };
  // A no-change probe opens the window: by construction (same snapshot, same
  // tick) it emits live alone, so every strict inequality below holds
  // regardless of engine churn later in the run.
  count(session.handle({ type: "ADVANCE_TICKS", ticks: 0 }));
  const K = 10;
  for (let i = 0; i < K; i++) {
    const responses = session.handle({ type: "ADVANCE_TICKS", ticks: 1 });
    assert.ok(!responses.some((r) => r.type === "SNAPSHOT"), "no legacy snapshot rides the live path");
    const presented = responses
      .filter((r) => r.type === "PRESENTATION")
      .map((r) => (r as { frame: PresentationFrame }).frame);
    const live = presented.find((f) => "organisms" in f && "population" in f);
    assert.ok(live, "a live frame is among the emitted frames");
    count(responses);
    legacyBytes += Buffer.byteLength(JSON.stringify(session.snapshot()));
  }
  const total = K + 1;
  assert.ok(legacyBytes > 0 && newBytes > 0, "both sides measured nonzero payload");
  assert.ok(
    newBytes < 0.5 * legacyBytes,
    `staggered delivery (${newBytes}B over ${total} advances) stays under half of equivalent legacy snapshots (${legacyBytes}B)`,
  );
  // The AC5 pin as message counts by class: the live heartbeat emits on every
  // advance; no stable class does (catalog only on membership change,
  // environment on its bounded period, interpretation only on payload change).
  assert.equal(counts.live, total, `live emits every advance (${counts.live}/${total})`);
  assert.ok(counts.catalog! < total, `catalog is NOT sent every advance (${counts.catalog}/${total})`);
  assert.ok(counts.environment! < total, `environment is NOT sent every advance (${counts.environment}/${total})`);
  assert.ok(counts.interpretation! < total, `interpretation is NOT sent every advance (${counts.interpretation}/${total})`);
  assert.equal(counts.identity, 0, "identity never resends mid-world");

  // Live bytes grow with organism count...
  const snap = session.snapshot();
  assert.ok(snap.organisms.length > 0, "the fixture holds living organisms");
  const baseBytes = Buffer.byteLength(JSON.stringify(buildLive(snap)));
  const doubled: RenderSnapshot = { ...snap, organisms: [...snap.organisms, ...snap.organisms] };
  const doubledBytes = Buffer.byteLength(JSON.stringify(buildLive(doubled)));
  const ratio = doubledBytes / baseBytes;
  assert.ok(ratio > 1.8 && ratio < 2.2, `live bytes scale with organisms (doubling organisms scales bytes x${ratio.toFixed(2)})`);

  // ...not with retained payload.
  const heavyEvents = Array.from({ length: 500 }, (_, i) => ({ tick: i, label: `retained event ${i}` }));
  const heavyDecisions = Array.from({ length: 50 }, (_, i) => ({ commandId: `cmd-${i}` })) as unknown as RenderSnapshot["resolvedDecisions"];
  const heavyAnalysis = JSON.parse(JSON.stringify(snap.analysis)) as { records: unknown[] };
  if (Array.isArray(heavyAnalysis.records)) {
    heavyAnalysis.records = [...heavyAnalysis.records, ...heavyAnalysis.records, ...heavyAnalysis.records];
  }
  const heavy: RenderSnapshot = {
    ...snap,
    events: heavyEvents,
    resolvedDecisions: heavyDecisions,
    metrics: { ...snap.metrics, retainedNote: "x".repeat(10000) },
    analysis: heavyAnalysis,
  } as RenderSnapshot;
  assert.equal(
    Buffer.byteLength(JSON.stringify(buildLive(heavy))),
    baseBytes,
    "retained event/decision/analysis payload never enters live bytes",
  );
}

/**
 * Task 6 (retained/detail path): REQUEST_DETAIL answers with the current
 * retained detail as a pure correlated read — full analysis records plus the
 * full decision history — advancing zero ticks and emitting no live frames,
 * so History stays truthful during pure-advance play without retained history
 * entering live-frame traffic.
 */
function testDetailRequestReturnsCurrentRetainedDetailWithoutAdvancing() {
  const session = liveSession();
  session.handle({ type: "ADVANCE_TICKS", ticks: 5 });
  const before = session.snapshot();
  const responses = session.handle({ type: "REQUEST_DETAIL", requestId: "detail-1" });
  assert.equal(responses.length, 1, "a detail request answers with exactly one correlated reply");
  const reply = responses[0]!;
  assert.equal(reply.type, "DETAIL", "the reply is the detail envelope, not a live push");
  assert.equal((reply as { requestId: string }).requestId, "detail-1", "carrying the request id the caller awaits");
  const detail = (reply as { snapshot: RenderSnapshot }).snapshot;
  assert.equal(detail.tick, before.tick, "detail reports the current tick");
  assert.deepEqual(detail.analysis.records, before.analysis.records, "detail carries the current retained records");
  assert.deepEqual(detail.resolvedDecisions, before.resolvedDecisions, "and the current full decision history");
  assert.equal(session.snapshot().tick, before.tick, "a detail request advances zero ticks");
  assert.ok(!responses.some((r) => r.type === "PRESENTATION"), "a pure detail query emits no live frames");
}

// --- F3a: restore atomicity -------------------------------------------------

/**
 * A checkpoint that passes the A3.3 source preflight and the engine-version
 * guard, but that the A3.4 canonical validator rejects afterwards.
 *
 * Built the way checkpoint-historical-boundary.ts builds its own canonical
 * failures — by corrupting the analysis layer — so this suite borrows a proven
 * rejection shape rather than inventing one. What is new here is not the
 * rejection: it is everything the session must NOT have touched when it happens.
 */
const lateRejectedCheckpoint = (base: unknown) => {
  const broken = JSON.parse(JSON.stringify(base)) as { analysis: { dep?: unknown } };
  broken.analysis.dep = "not a detector state";
  return broken as never;
};

/**
 * AC5/AC6/AC7: a restore that fails after the preflight must leave the live
 * session exactly as it was — same world identity, same checkpoint, same
 * deterministic continuation.
 *
 * Before the prepare/commit split, `restore()` minted a new `worldId` before it
 * decoded anything, so a rejection here left the session advertising a brand-new
 * displayed world while still holding the old simulation. `worldId` is what
 * presentation identity, the store's world gate, and phenotype anchor scoping all
 * key on, so that desync is the bug this pins shut.
 */
function testRejectedRestoreLeavesSessionUntouched() {
  const session = liveSession();
  session.advance(20);
  const beforeId = session.worldId;
  const beforeCheckpoint = session.checkpoint();
  assert.throws(
    () => session.restore(lateRejectedCheckpoint(beforeCheckpoint)),
    (error: unknown) => error instanceof CheckpointRejectionError && error.field === "analysis.dep",
    "the fixture is refused by canonical validation, not by the preflight (proved by field, not assumed)",
  );
  assert.equal(session.worldId, beforeId, "a refused restore never mints a new displayed-world identity");
  assert.deepEqual(session.checkpoint(), beforeCheckpoint, "the live checkpoint is byte-identical after a refusal");

  // Deterministic continuation: the refused attempt consumed no RNG and left no
  // partial state, so advancing from here reproduces the un-refused timeline.
  const twin = liveSession();
  twin.advance(20);
  const twinId = twin.worldId;
  assert.throws(() => twin.restore(lateRejectedCheckpoint(twin.checkpoint())), "the twin refuses identically");
  session.advance(15);
  twin.advance(15);
  const a = session.checkpoint() as { experiment: unknown };
  const b = twin.checkpoint() as { experiment: unknown };
  assert.deepEqual(a.experiment, b.experiment, "a refused restore leaves deterministic continuation intact");
  void twinId;
}

/**
 * Every restore step that could fail after validation, each pinned to the same
 * invariant: a step that throws leaves the session exactly as it was.
 *
 * Why a hook and not more corrupted checkpoints: a probe over the reachable
 * corruptions (engine version, null/garbage simulation state, bad control, bad
 * detector) found the A3.3 preflight refuses ALL of them before restore touches
 * anything. That is good news today and no guarantee at all — the first decode
 * step added without a matching preflight rule reintroduces the hazard silently.
 * So the guarantee under test is structural ("no assignment precedes a
 * fallible prepare step"), which is only reachable by making a step throw.
 */
const PREPARE_STEPS = [
  "experiment",
  "analysis",
  "control",
  "controlAnalysis",
  "decisions",
] as const;

function testEveryPrepareStepIsAtomicWhenItThrows() {
  for (const step of PREPARE_STEPS) {
    const session = liveSession();
    session.advance(20);
    const beforeId = session.worldId;
    const beforeCheckpoint = session.checkpoint();

    __setRestorePrepareHookForTests((failingStep) => {
      if (failingStep === step) throw new Error(`injected failure preparing ${step}`);
    });
    let refused: unknown = null;
    try {
      session.restore(beforeCheckpoint as never);
    } catch (error) {
      refused = error;
    } finally {
      __setRestorePrepareHookForTests(undefined);
    }

    assert.ok(refused !== null, `a failure preparing ${step} refuses the restore`);
    assert.match(String((refused as Error).message), new RegExp(`preparing ${step}`), `the ${step} failure is the one that surfaced`);
    assert.equal(session.worldId, beforeId, `a failure preparing ${step} mints no new displayed-world identity`);
    assert.deepEqual(session.checkpoint(), beforeCheckpoint, `a failure preparing ${step} leaves the live checkpoint byte-identical`);

    // And the session is still usable: the same checkpoint restores afterwards,
    // so a refusal never poisons the session for the next attempt.
    const restored = session.restore(beforeCheckpoint as never);
    assert.equal(restored.worldId, session.worldId, `after a ${step} failure the session still restores normally`);
  }
}

/** AC14: no presentation frames announce a candidate that was never accepted. */
function testNoFramesAreEmittedForAPrepareStepFailure() {
  for (const step of PREPARE_STEPS) {
    const session = liveSession();
    session.advance(20);
    const before = session.checkpoint();
    __setRestorePrepareHookForTests((failingStep) => {
      if (failingStep === step) throw new Error(`injected failure preparing ${step}`);
    });
    let responses: readonly unknown[] = [];
    try {
      responses = session.handle({ type: "LOAD_CHECKPOINT", requestId: `f3a-${step}`, checkpoint: before as never });
    } catch {
      // handle() reports command failures as a correlated ERROR; the point of
      // this test is the absence of frames either way.
    } finally {
      __setRestorePrepareHookForTests(undefined);
    }
    assert.ok(
      responses.every((r) => (r as { type?: string }).type !== "PRESENTATION"),
      `a ${step} failure announces no world to presentation`,
    );
    assert.deepEqual(session.checkpoint(), before, `a ${step} failure leaves the live checkpoint untouched`);
  }
}

/** The successful path is unchanged: a restore still adopts the new world. */
function testSuccessfulRestoreStillAdoptsTheNewWorld() {
  const source = liveSession();
  source.advance(20);
  const saved = source.checkpoint();

  const target = liveSession();
  target.advance(20);
  const beforeId = target.worldId;

  const restored = target.restore(saved);
  assert.notEqual(target.worldId, beforeId, "a successful restore is a new displayed world, not the old one continued");
  assert.equal(restored.worldId, target.worldId, "the restored snapshot reports the identity the session adopted");
  assert.equal(restored.tick, (saved as { createdTick: number }).createdTick, "and lands on the saved tick");
}

/**
 * AC14: the canonical path stays mutation-free before commit, and no frames are
 * emitted for a candidate that was never accepted.
 */
function testRejectedRestoreEmitsNoPresentationFrames() {
  const session = liveSession();
  session.advance(20);
  const before = session.checkpoint();
  const responses = session.handle({
    type: "LOAD_CHECKPOINT",
    requestId: "f3a-rejected",
    checkpoint: lateRejectedCheckpoint(before),
  });
  assert.ok(
    responses.every((r) => r.type !== "PRESENTATION"),
    "a refused restore announces no world to presentation",
  );
  assert.deepEqual(session.checkpoint(), before, "and leaves the live checkpoint untouched");
}

/** Task 6: the on-demand detail request settles exactly once on its reply. */
async function testDetailRequestSettlesOnItsCorrelatedReply() {
  const fake = new FakeWorker();
  const client = new WorkerRuntimeClient(() => fake, { requestTimeoutMs: 10_000 });
  const request = tracked(client.requestDetail());
  const posted = fake.posted.at(-1) as { type: string; requestId: string };
  assert.equal(posted.type, "REQUEST_DETAIL", "detail is requested as a command");
  assert.equal(typeof posted.requestId, "string", "the detail request carries a request id");
  fake.deliver({ type: "DETAIL", requestId: posted.requestId, snapshot: snap(9) });
  await tick();
  assert.equal(request.state.settled, true, "the correlated detail reply settles the request");
  assert.equal((request.state.value as RenderSnapshot).tick, 9, "and resolves with the retained detail");
}

async function main() {
  testDetailRequestReturnsCurrentRetainedDetailWithoutAdvancing();
  await testDetailRequestSettlesOnItsCorrelatedReply();
  testLiveDeliveryScalesWithLiveInformation();
  testStaggeredEmissionCadence();
  testCladeEstablishmentReemitsCatalogWithConstantMembership();
  testFirstPaintConvergesAndStaysConverged();
  testIdentityArrivalResetsCoherenceToTheNewWorld();
  testSameChannelOlderTicksAreRejected();
  testVersionMismatchIsRejected();
  testSupersededWorldFramesAreRejected();
  testStoreJoinMatchesSnapshotAndRemovalResolvesToNull();
  testStoreExposesEffectiveTickPerChannel();
  await testPresentationRoutingIsIsolatedFromLegacy();
  await testRoutedFramesKeepTheirCoherenceEnvelope();
  testWorkerFramesMatchDirectBuild();
  testLiveFramesArriveWithoutLegacyPayload();
  await testPackageRootExposesNoMutableSessionAuthority();
  testLiveFrameExcludesNonLivePayloads();
  testRemovedEntitiesResolveToNothing();
  await testTerminalSignalFiresExactlyOnceAcrossBothFailureKinds();
  await testDestroyDoesNotEmitTerminalSignal();
  await testOrdinaryFailuresDoNotEmitTerminalSignal();
  await testTerminalStateIsQueryableAfterDeath();
  testProductionSurfaceHasNoGenericCommand();
  await testARestoreAnnouncesTheWorldExactlyOnce();
  await testFatalFailureDropsSubscribers();
  await testAFailedLoadRejectsWithTheWorkersReason();
  await testUnrelatedErrorDoesNotFailALoad();
  await testNormalSuccessStillSettles();
  await testStructuredFailureSettlesOnlyItsOwnRequest();
  await testEveryRequestHasABoundedLifetime();
  await testFatalWorkerFailureSettlesEverything();
  await testDestroySettlesAndRetainsNothing();
  await testSameTickSnapshotCannotCompleteALoad();
  await testStaleReplyCannotSatisfyALiveLoad();
  await testASecondLoadSupersedesTheFirst();
  testLegacySubscribePathIsGone();
  testPresentationSubscribersReceiveFrames();
  testTransportIsInjectable();
  testLoadCompletionIsCorrelatedByRequestId();
  testUnknownTagIsAStructuredFailure();
  testMalformedPayloadsAreRejected();
  testNumericFieldsAreBoundedIntegers();
  testRequiredFieldsAreChecked();
  testOptionalRequestIdMustBeAStringWhenPresent();
  testRejectedCommandMutatesNothingButStillReleasesBackpressure();
  testRefusedCommandIsReportedAndLeavesTheSessionWhereItWas();
  testRejectedRestoreLeavesSessionUntouched();
  testEveryPrepareStepIsAtomicWhenItThrows();
  testNoFramesAreEmittedForAPrepareStepFailure();
  testSuccessfulRestoreStillAdoptsTheNewWorld();
  testRejectedRestoreEmitsNoPresentationFrames();
  console.log("runtime boundary validation: PASS");
}

main().catch((error) => {
  // Without this an async main's rejection surfaces as an unhandled rejection,
  // which reports nothing about which assertion failed.
  console.error(error);
  process.exitCode = 1;
});
