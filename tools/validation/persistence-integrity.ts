/**
 * F3a — Save/Load Failure Integrity & Atomic Restore.
 *
 * Repository-side tests for the application-owned save envelope: one coherent
 * slot read, in-memory legacy normalization, and a typed storage-failure
 * taxonomy that never surfaces raw DOM/IndexedDB text to a player.
 *
 * The IndexedDB here is a hand-built double, not a library. It models exactly
 * the semantics these tests depend on — and one of them is the reason it
 * exists at all: **a write inside an aborted transaction must not be visible
 * to a later read.** A double that quietly dropped rollback would make the
 * failed-overwrite proof meaningless, so rollback fidelity is asserted in the
 * double's own setup (see `assertDoubleRollbackFidelity`).
 *
 * What this double CANNOT prove: real IndexedDB transaction scheduling,
 * blocked upgrades, and platform storage pressure. Those belong to the browser
 * lane, where a real engine stores the bytes.
 *
 * Run: pnpm exec tsx tools/validation/persistence-integrity.ts
 */
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// The double, installed before persistence.ts is imported.
// ---------------------------------------------------------------------------

type FailPoint = "open" | "put" | "get" | "commit" | "abort" | "getAll" | null;

interface DoubleControl {
  failOn: FailPoint;
  /** Committed store contents. An aborted transaction never reaches this. */
  readonly committed: Map<string, unknown>;
  transactionCalls: number;
  getCalls: number;
  putCalls: number;
  getAllCalls: number;
  openCalls: number;
}

/** Records with no live transaction: what a read can ever observe. */
const committed = new Map<string, unknown>();
const control: DoubleControl = {
  failOn: null,
  committed,
  transactionCalls: 0,
  getCalls: 0,
  putCalls: 0,
  getAllCalls: 0,
  openCalls: 0,
};

const reset = () => {
  committed.clear();
  control.failOn = null;
  control.transactionCalls = 0;
  control.getCalls = 0;
  control.putCalls = 0;
  control.getAllCalls = 0;
  control.openCalls = 0;
};

/** Queues a callback the way IndexedDB queues request events. */
const later = (fn: () => void) => queueMicrotask(fn);

/**
 * A transaction owns a private staging map. It publishes to the store only on
 * `complete`. `abort` and `error` discard the staging map entirely, which is
 * the rollback property the failed-overwrite tests rest on.
 */
function makeTransaction() {
  const staged = new Map<string, unknown>();
  let settled = false;
  const tx: Record<string, unknown> = {
    error: new Error("injected transaction failure"),
    oncomplete: null,
    onerror: null,
    onabort: null,
    objectStore: () => ({
      put(value: { id: string }, _key?: unknown) {
        control.putCalls += 1;
        if (control.failOn === "put") {
          later(() => {
            if (settled) return;
            settled = true;
            (tx.onerror as (() => void) | null)?.();
          });
          return { onsuccess: null, onerror: null };
        }
        staged.set(value.id, value);
        const req: { onsuccess: (() => void) | null; onerror: (() => void) | null } = { onsuccess: null, onerror: null };
        later(() => req.onsuccess?.());
        return req;
      },
      get(key: string) {
        control.getCalls += 1;
        const req: { onsuccess: (() => void) | null; onerror: (() => void) | null; result?: unknown } = {
          onsuccess: null,
          onerror: null,
        };
        if (control.failOn === "get") {
          later(() => req.onerror?.());
        } else {
          req.result = committed.get(key);
          later(() => req.onsuccess?.());
        }
        return req;
      },
      getAll() {
        control.getAllCalls += 1;
        const req: { onsuccess: (() => void) | null; onerror: (() => void) | null; result?: unknown } = {
          onsuccess: null,
          onerror: null,
          result: [...committed.values()],
        };
        later(() => req.onsuccess?.());
        return req;
      },
    }),
    __publish: () => {
      for (const [key, value] of staged) committed.set(key, value);
    },
    __discard: () => staged.clear(),
  };

  // A real transaction commits once its requests drain, and the completion
  // event lands on the TRANSACTION, not on the open request. Model the timing
  // with a nested microtask so the publish happens after every queued request.
  // Handlers are optional: a read-only transaction installs none, and firing
  // into a null listener would be a double artefact rather than a real fault.
  later(() => later(() => {
    if (settled) return;
    settled = true;
    const handlers = tx as { oncomplete?: (() => void) | null; onerror?: (() => void) | null; onabort?: (() => void) | null };
    if (control.failOn === "abort") {
      tx.__discard();
      handlers.onabort?.();
      return;
    }
    if (control.failOn === "commit") {
      // The put request succeeded, the commit did not: nothing may become visible.
      tx.__discard();
      handlers.onerror?.();
      return;
    }
    tx.__publish();
    handlers.oncomplete?.();
  }));

  return tx;
}

const fakeIndexedDb = {
  open(_name: string, _version: number) {
    control.openCalls += 1;
    const request: Record<string, unknown> = {
      result: {
        objectStoreNames: { contains: () => true },
        createObjectStore: () => ({}),
        transaction(_store: string, _mode: string) {
          control.transactionCalls += 1;
          return makeTransaction();
        },
        close: () => {},
      },
      onupgradeneeded: null,
      onsuccess: null,
      onerror: null,
      error: new Error("injected open failure"),
    };
    if (control.failOn === "open") later(() => (request.onerror as (() => void) | null)?.());
    else later(() => (request.onsuccess as (() => void) | null)?.());
    return request;
  },
};

(globalThis as { indexedDB?: unknown }).indexedDB = fakeIndexedDb;

/**
 * Rollback fidelity is the property every failed-overwrite assertion rests on.
 * If a future edit to the double drops it, those assertions would pass against
 * a store that leaks uncommitted writes — worse than no test at all.
 */
function assertDoubleRollbackFidelity() {
  reset();
  const tx = makeTransaction() as Record<string, unknown>;
  const store = (tx.objectStore as () => Record<string, unknown>)();
  (store.put as (v: unknown) => unknown)({ id: "ghost", value: 1 });
  (tx.__discard as () => void)();
  (tx.__publish as () => void)();
  assert.equal(committed.has("ghost"), false, "double discards writes from an aborted transaction");
}

/** Seeds a record straight into the store, as an older build would have. */
const seedRaw = (record: unknown) => committed.set((record as { id: string }).id, record);

// ---------------------------------------------------------------------------

import {
  SAVE_ENVELOPE_VERSION,
  PersistenceFailure,
  createRepository,
} from "../../apps/explorer/src/persistence.ts";
import type { SaveEnvelope, SlotRead } from "../../apps/explorer/src/persistence.ts";
import type { UniverseCheckpoint } from "@digital-evolution/contracts";

const repository = createRepository();

/** A checkpoint-shaped value. These tests never simulate; they only move bytes. */
const fakeCheckpoint = (tick: number): UniverseCheckpoint =>
  ({
    checkpointSchemaVersion: "0.4",
    engineVersion: "0.23.0",
    appVersion: "0.31.0",
    createdTick: tick,
    experiment: { seed: 42, t: tick },
  }) as unknown as UniverseCheckpoint;

/**
 * An anchor `sanitizeAnchors` actually accepts: a known family plus the
 * quantized block it requires. A shape the sanitizer drops would make these
 * tests pass for the wrong reason.
 */
const anchor = (family: string) => ({ family, quantized: { q: 1 } }) as never;

const expectFailure = async (fn: () => Promise<unknown>, kind: string) => {
  try {
    await fn();
  } catch (error) {
    assert.ok(error instanceof PersistenceFailure, `expected PersistenceFailure, got ${String(error)}`);
    assert.equal(error.kind, kind, `expected kind ${kind}`);
    return error;
  }
  assert.fail("expected a PersistenceFailure");
};

// --- Task 1 -----------------------------------------------------------------

async function testSaveThenReadRoundTrips() {
  reset();
  const checkpoint = fakeCheckpoint(1200);
  const anchors = { 7: anchor("blob") };
  const summary = await repository.save("current", checkpoint, anchors);
  assert.equal(summary.id, "current");
  assert.equal(summary.tick, 1200, "summary reports the checkpoint's own tick");

  const read = (await repository.readSlot("current")) as SlotRead;
  assert.deepEqual(read.checkpoint, checkpoint, "checkpoint round-trips unchanged");
  assert.ok(read.phenotypeAnchors && 7 in read.phenotypeAnchors, "adjuncts travel with the same read");
}

async function testSlotReadUsesOneTransaction() {
  reset();
  await repository.save("current", fakeCheckpoint(5));
  const before = { ...control };
  await repository.readSlot("current");
  assert.equal(control.transactionCalls - before.transactionCalls, 1, "one transaction per slot read");
  assert.equal(control.getCalls - before.getCalls, 1, "one get per slot read — checkpoint and adjuncts are coherent");
}

async function testLegacyRecordNormalizesWithoutRewrite() {
  reset();
  seedRaw({ id: "legacy", savedAt: "2026-01-01T00:00:00.000Z", tick: 900, engineVersion: "0.22.0", checkpoint: fakeCheckpoint(900), phenotypeAnchors: { 3: anchor("radial") } });
  const read = (await repository.readSlot("legacy")) as SlotRead;
  assert.equal(read.checkpoint.createdTick, 900, "legacy checkpoint is readable");
  assert.ok(read.phenotypeAnchors && 3 in read.phenotypeAnchors, "legacy adjuncts normalize in memory");
  const stored = committed.get("legacy") as Record<string, unknown>;
  assert.equal("envelopeVersion" in stored, false, "loading a legacy save never rewrites it");
}

async function testMissingSlotReturnsNoSave() {
  reset();
  assert.equal(await repository.readSlot("nothing-here"), null, "an absent slot is not a failure");
}

async function testOpenFailureIsTyped() {
  reset();
  control.failOn = "open";
  const error = await expectFailure(() => repository.readSlot("current"), "storage-read-failed");
  assert.ok(!(error.message.includes("injected")), "player-facing failure does not leak raw storage text");
  control.failOn = null;
}

async function testUnreadableRecordIsTypedNotSilent() {
  for (const [label, record] of [
    ["no checkpoint field", { id: "bad", savedAt: "x" }],
    ["checkpoint is not an object", { id: "bad", savedAt: "x", checkpoint: 42 }],
    ["envelope from a newer build", { id: "bad", savedAt: "x", envelopeVersion: SAVE_ENVELOPE_VERSION + 1, checkpoint: fakeCheckpoint(1) }],
  ] as const) {
    reset();
    seedRaw(record);
    await expectFailure(() => repository.readSlot("bad"), "storage-read-failed");
    void label;
  }
}

// --- Task 2 -----------------------------------------------------------------

async function testFailedOverwritePreservesPriorSave() {
  reset();
  const first = fakeCheckpoint(100);
  await repository.save("current", first, { 1: anchor("blob") });

  const second = fakeCheckpoint(9000);
  control.failOn = "abort";
  await expectFailure(() => repository.save("current", second, { 2: anchor("plated") }), "storage-write-failed");
  control.failOn = null;

  const read = (await repository.readSlot("current")) as SlotRead;
  assert.deepEqual(read.checkpoint, first, "the previously committed save is untouched");
  assert.ok(read.phenotypeAnchors && 1 in read.phenotypeAnchors, "its adjuncts are untouched too");
  assert.ok(!(read.phenotypeAnchors && 2 in read.phenotypeAnchors), "the failed write left nothing behind");
}

async function testWriteSuccessIsNotReportedBeforeCommit() {
  reset();
  control.failOn = "commit";
  await expectFailure(() => repository.save("current", fakeCheckpoint(3)), "storage-write-failed");
  control.failOn = null;
  assert.equal(await repository.readSlot("current"), null, "a request that never reached commit stored nothing");
}

async function testPriorSaveSurvivesRepeatedFailedOverwrites() {
  reset();
  const first = fakeCheckpoint(11);
  await repository.save("current", first);
  // Two different failure shapes in a row: the transaction aborting, then the
  // put request erroring. Neither may erode the committed record.
  for (const failPoint of ["abort", "put"] as const) {
    control.failOn = failPoint;
    await expectFailure(() => repository.save("current", fakeCheckpoint(500)), "storage-write-failed");
  }
  control.failOn = null;
  const read = (await repository.readSlot("current")) as SlotRead;
  assert.deepEqual(read.checkpoint, first, "repeated failures never erode the committed record");
}

// --- runner -----------------------------------------------------------------

const tests: readonly (readonly [string, () => Promise<void>])[] = [
  ["double rollback fidelity", async () => assertDoubleRollbackFidelity()],
  ["save then read round trips", testSaveThenReadRoundTrips],
  ["slot read uses one transaction", testSlotReadUsesOneTransaction],
  ["legacy record normalizes without rewrite", testLegacyRecordNormalizesWithoutRewrite],
  ["missing slot returns no-save", testMissingSlotReturnsNoSave],
  ["open failure is typed", testOpenFailureIsTyped],
  ["unreadable record is typed, not silent", testUnreadableRecordIsTypedNotSilent],
  ["failed overwrite preserves prior save", testFailedOverwritePreservesPriorSave],
  ["write success is not reported before commit", testWriteSuccessIsNotReportedBeforeCommit],
  ["prior save survives repeated failed overwrites", testPriorSaveSurvivesRepeatedFailedOverwrites],
];

async function main() {
  let failures = 0;
  for (const [name, run] of tests) {
    try {
      await run();
      console.log(`  ${name}: PASS`);
    } catch (error) {
      failures += 1;
      console.log(`  ${name}: FAIL`);
      console.log(String(error instanceof Error ? error.message : error));
    }
  }
  if (failures > 0) {
    console.error(`persistence integrity: ${failures} failing`);
    process.exitCode = 1;
    return;
  }
  console.log(`persistence integrity: PASS (${tests.length} checks)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});