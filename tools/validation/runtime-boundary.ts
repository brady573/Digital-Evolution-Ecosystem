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
import {
  WorkerRuntimeClient,
  type WorkerLike,
} from "../../packages/sim-runtime/src/client.ts";

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
 * A same-tick snapshot that is not the correlated reply must not complete a
 * load. This is the AC7 defect: any live frame at the checkpoint's tick used to
 * satisfy the restore, including a decision-gated advance that returns a
 * snapshot at the unchanged tick.
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

  // Also a stale snapshot from an earlier restore, same tick.
  fake.deliver({ type: "SNAPSHOT", snapshot: snap(Math.max(0, createdTick - 1)) });
  await tick();
  assert.equal(load.state.settled, false, "a stale snapshot does not complete the load");

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

/** Subscribers still receive every snapshot, correlated or not. */
function testSubscribersAreStillNotified() {
  const fake = new FakeWorker();
  const client = new WorkerRuntimeClient(() => fake);
  const seen: number[] = [];
  const unsubscribe = client.subscribe((s) => seen.push(s.tick));

  fake.deliver({ type: "SNAPSHOT", snapshot: snap(1) });
  fake.deliver({ type: "SNAPSHOT", snapshot: snap(2) });
  assert.deepEqual(seen, [1, 2], "subscribers see every live frame");

  unsubscribe();
  fake.deliver({ type: "SNAPSHOT", snapshot: snap(3) });
  assert.deepEqual(seen, [1, 2], "unsubscribe still stops notification");
}

/** A short bounded lifetime, so the timeout contract is provable without
 *  waiting the production value. */
const TEST_REQUEST_TIMEOUT_MS = 20;

/**
 * A snapshot-shaped stand-in for the payload replies carry. Only `tick` is
 * observed, but the real shape keeps a stray `.metrics` access honest.
 */
const replySnapshot = (tick: number) => snap(tick);

/**
 * Every request settles exactly once, and never later than its bounded
 * lifetime. Four request types had no timeout at all, so a worker that never
 * answered left their promises pending forever.
 */
async function testEveryRequestHasABoundedLifetime() {
  const cases: [string, (c: WorkerRuntimeClient) => Promise<unknown>][] = [
    ["requestCheckpoint", (c) => c.requestCheckpoint()],
    ["requestExport", (c) => c.requestExport()],
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

    fake.deliver({ type: "CHECKPOINT", requestId: "r-1", checkpoint: {} });
    fake.deliver({ type: "SNAPSHOT", snapshot: replySnapshot(1) });
    await tick();
    assert.equal(a.state.settled, true, `${kind} leaves no request able to settle twice`);
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
  fake.deliver({ type: "SNAPSHOT", snapshot: replySnapshot(9) });
  await tick();
  assert.equal(a.state.settled, true, "no request settles twice after destroy");
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
  assert.equal(failing.state.settled, true, "and does not re-settle a settled request");
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

async function main() {
  await testNormalSuccessStillSettles();
  await testStructuredFailureSettlesOnlyItsOwnRequest();
  await testEveryRequestHasABoundedLifetime();
  await testFatalWorkerFailureSettlesEverything();
  await testDestroySettlesAndRetainsNothing();
  await testSameTickSnapshotCannotCompleteALoad();
  await testStaleReplyCannotSatisfyALiveLoad();
  await testASecondLoadSupersedesTheFirst();
  testSubscribersAreStillNotified();
  testTransportIsInjectable();
  testLoadCompletionIsCorrelatedByRequestId();
  testUnknownTagIsAStructuredFailure();
  testMalformedPayloadsAreRejected();
  testNumericFieldsAreBoundedIntegers();
  testRequiredFieldsAreChecked();
  testRejectedCommandMutatesNothingButStillReleasesBackpressure();
  testRefusedCommandLeavesTheSessionWhereItWas();
  console.log("runtime boundary validation: PASS");
}

main().catch((error) => {
  // Without this an async main's rejection surfaces as an unhandled rejection,
  // which reports nothing about which assertion failed.
  console.error(error);
  process.exitCode = 1;
});
