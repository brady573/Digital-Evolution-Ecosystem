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
import * as runtimeRoot from "@digital-evolution/sim-runtime";
import { UniverseSession } from "../../packages/sim-runtime/src/session.ts";
import { buildCatalog, buildPresentation, resolveCatalogEntry } from "../../packages/sim-runtime/src/presentation.ts";
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

    // A reply arriving after the fatal event must be inert, not a second
    // settlement. Asserted via the pending map, not by re-checking `settled`
    // on a promise that cannot settle twice.
    assert.equal(client.pendingRequestCount, 0, `${kind} left nothing a late reply could settle`);
    fake.deliver({ type: "CHECKPOINT", requestId: "r-1", checkpoint: {} });
    fake.deliver({ type: "SNAPSHOT", snapshot: replySnapshot(1) });
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
  fake.deliver({ type: "SNAPSHOT", snapshot: replySnapshot(9) });
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
 * A restore delivers the restored world to subscribers exactly once.
 *
 * Regression guard for the CI failure on PR #84 (browser-smoke timed out waiting
 * for "Checkpoint restored"). Cause: postMessage delivers each message as its
 * own task, so the trailing bare SNAPSHOT ran AFTER the load's .then() had set
 * the status. Explorer's subscribe callback runs setStatus("") on every snapshot,
 * so that second delivery wiped "Checkpoint restored" and the UI showed nothing.
 *
 * The trailing SNAPSHOT was also redundant: the correlated reply already carries
 * the same snapshot, and the client resolved the load from it. Now the session
 * sends only CHECKPOINT_LOADED and the client notifies subscribers from that one
 * message, so the restore announces the world once and the status survives.
 */
async function testARestoreAnnouncesTheWorldExactlyOnce() {
  const fake = new FakeWorker();
  const client = new WorkerRuntimeClient(() => fake, { requestTimeoutMs: 10_000 });
  const seen: number[] = [];
  client.subscribe((s) => seen.push(s.tick));

  const load = tracked(client.loadCheckpoint(realCheckpoint()));
  const requestId = (fake.posted.at(-1) as { requestId: string }).requestId;

  // Exactly the single message the worker now posts for a successful restore.
  fake.deliver({ type: "CHECKPOINT_LOADED", requestId, snapshot: snap(4242) });
  await tick();

  assert.equal(load.state.settled, true, "the load settles on its correlated reply");
  assert.equal((load.state.value as RenderSnapshot).tick, 4242, "and resolves to the restored world");
  assert.deepEqual(seen, [4242], "the restore notifies subscribers exactly once");
}

/**
 * A fatal worker failure drops subscribers, because a dead worker can never
 * deliver another snapshot: keeping the listeners would leave the UI holding
 * subscription objects only a replacement client could satisfy. This is a
 * behaviour change from the previous code, so it is pinned rather than assumed.
 */
async function testFatalFailureDropsSubscribers() {
  const fake = new FakeWorker();
  const client = new WorkerRuntimeClient(() => fake, { requestTimeoutMs: 10_000 });
  const seen: number[] = [];
  client.subscribe((s) => seen.push(s.tick));

  fake.deliver({ type: "SNAPSHOT", snapshot: snap(1) });
  assert.deepEqual(seen, [1], "subscribers are notified while the worker lives");

  fake.fail("error", "synthetic error");
  fake.deliver({ type: "SNAPSHOT", snapshot: snap(2) });
  await tick();
  assert.deepEqual(seen, [1], "a snapshot after a fatal failure reaches no subscriber");
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
  // subscribers, and no later snapshot can revive them.
  const late: number[] = [];
  client.subscribe((s) => late.push(s.tick));
  fake.deliver({ type: "SNAPSHOT", snapshot: snap(99) });
  await tick();
  assert.deepEqual(late, [], "a post-death subscribe plus delivered snapshot reaches no listener");
}

function testProductionSurfaceHasNoGenericCommand() {
  const fake = new FakeWorker();
  const client = new WorkerRuntimeClient(() => fake);
  assert.equal("command" in client, false, "no generic raw command escape hatch on the production surface");
  for (const op of ["create", "advance", "runToNextEvent", "intervene", "createControlFork", "resolveEventDecision", "acknowledgeAftermath", "loadCheckpoint", "requestCheckpoint", "requestExport", "subscribe", "destroy", "onTerminal"] as const) {
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

async function main() {
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
  testSubscribersAreStillNotified();
  testTransportIsInjectable();
  testLoadCompletionIsCorrelatedByRequestId();
  testUnknownTagIsAStructuredFailure();
  testMalformedPayloadsAreRejected();
  testNumericFieldsAreBoundedIntegers();
  testRequiredFieldsAreChecked();
  testOptionalRequestIdMustBeAStringWhenPresent();
  testRejectedCommandMutatesNothingButStillReleasesBackpressure();
  testRefusedCommandIsReportedAndLeavesTheSessionWhereItWas();
  console.log("runtime boundary validation: PASS");
}

main().catch((error) => {
  // Without this an async main's rejection surfaces as an unhandled rejection,
  // which reports nothing about which assertion failed.
  console.error(error);
  process.exitCode = 1;
});
