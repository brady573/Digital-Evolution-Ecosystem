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
import { PhenotypeCache } from "../../apps/explorer/src/phenotype.ts";
import { restoreFailureMessage, storageFailureMessage } from "../../apps/explorer/src/persistenceMessages.ts";
import { RuntimeCommandRejection } from "../../packages/sim-runtime/src/client.ts";
import { CheckpointRejectionError } from "@digital-evolution/contracts";
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

  // The in-band version is the point of the envelope (spec §1). Asserted
  // POSITIVELY: if save() stopped writing it, every read would still succeed
  // through the legacy-normalization path and nothing else here would notice.
  const stored = committed.get("current") as Record<string, unknown>;
  assert.equal(stored["envelopeVersion"], SAVE_ENVELOPE_VERSION, "save writes the current envelope version");

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
  for (const record of [
    { id: "bad", savedAt: "x" },
    { id: "bad", savedAt: "x", checkpoint: 42 },
    { id: "bad", savedAt: "x", envelopeVersion: SAVE_ENVELOPE_VERSION + 1, checkpoint: fakeCheckpoint(1) },
  ]) {
    reset();
    seedRaw(record);
    await expectFailure(() => repository.readSlot("bad"), "storage-read-failed");
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

// --- F3a: adjunct staging is transactional ----------------------------------

/** An organism shaped enough for PhenotypeCache to resolve deterministically. */
const mkOrganism = (id: number) => ({
  parent: null, generation: 0, lineageId: 1, cladeId: 1, x: 300, y: 300, energy: 80,
  activity: "active", speed: 1.5625, sensing: 69.5, metabolism: 0.224, reproduction: 100,
  diet: 0.4, habitat: 0.4, byproductUse: 0, dormancyResponse: 1.0,
  tolerance: 0, cleanup: 0, id,
} as never);

/**
 * AC8: the primitives a transactional load depends on.
 *
 * `stageAnchors` is one-shot — consumed by the next world whose identity
 * differs — which is what stops a resume-then-create sequence leaking one
 * universe's families into another. The hazard F3a closes is the mirror image:
 * staging BEFORE the restore succeeds arms a candidate's anchors for whatever
 * world comes next, including one unrelated to the save that failed.
 *
 * What is provable here is the mechanism: staging is per-cache, adoption is
 * one-shot, and a cache that was never staged resolves purely from its own
 * traits. What is NOT provable here is App.load()'s ordering, because that
 * component is not importable in Node — the browser lane proves the end-to-end
 * behaviour with a real rejected load (Task 4 Step 6).
 */
/**
 * Renamed from a claim it could not support.
 *
 * This pins the MECHANISM AC8 depends on: a cache with nothing staged adopts
 * nothing. It does NOT pin F3a's change, because App's ordering is not importable
 * in Node — an earlier version of this test created two caches, never called
 * `stageAnchors`, and asserted natural resolution, which passes for every
 * implementation including the pre-F3a one that staged before restoring.
 *
 * AC8's real evidence is the browser lane's rejected-load interaction. This test
 * stays because the mechanism it pins is what makes that interaction meaningful.
 */
function testAnUnstagedCacheAdoptsNothing() {
  // The family these traits resolve to unaided. Asserting "not blob" would be
  // vacuous if blob IS the natural resolution, so pin the natural value first.
  const natural = new PhenotypeCache()
    .resolveSnapshot({ worldId: 40 as never, organisms: [mkOrganism(1)] })
    .get(1)?.family;
  assert.ok(natural, "the organism resolves from its own traits with no anchor staged");

  // A rejected load never calls stageAnchors, so a fresh cache has nothing armed.
  const afterRejectedLoad = new PhenotypeCache();
  const resolved = afterRejectedLoad.resolveSnapshot({ worldId: 41 as never, organisms: [mkOrganism(1)] });
  assert.equal(resolved.get(1)?.family, natural, "a world after a rejected load inherits no family from the failed candidate");

  // An unrelated NEW world created afterwards inherits nothing either — the
  // failure did not leave the cache holding anything.
  const laterWorld = afterRejectedLoad.resolveSnapshot({ worldId: 42 as never, organisms: [mkOrganism(1)] });
  assert.equal(laterWorld.get(1)?.family, natural, "nor does a later, unrelated world");
}

/** The success path still reconstructs the anchored family (AC11). */
function testSuccessfulRestoreAdoptsMatchingAnchors() {
  const cache = new PhenotypeCache();
  cache.stageAnchors({ 1: anchor("branching") });
  const first = cache.resolveSnapshot({ worldId: 50 as never, organisms: [mkOrganism(1)] });
  assert.equal(first.get(1)?.family, "branching", "the restored world reconstructs the saved family");
  // Consumed once: a later, different world must not inherit it.
  const second = cache.resolveSnapshot({ worldId: 51 as never, organisms: [mkOrganism(1)] });
  assert.notEqual(second.get(1)?.family, "branching", "the anchor is consumed by one world, not inherited by the next");
}

/**
 * Listing tolerates an unreadable record; reading one slot does not.
 *
 * Before F3a, `list()` destructured each record's metadata and never touched its
 * checkpoint, so a truncated save could not hide the others. Routing list()
 * through the strict normalizer made one bad record take the whole list down —
 * a silent behaviour change with no consumer to notice and no test either way.
 */
async function testListingToleratesOneUnreadableRecord() {
  reset();
  await repository.save("good", fakeCheckpoint(11));
  await repository.save("also-good", fakeCheckpoint(22));
  seedRaw({ id: "truncated", savedAt: "2026-02-02T00:00:00.000Z", tick: 33, engineVersion: "0.23.0" });

  const listed = await repository.list();
  const ids = listed.map((entry) => entry.id);
  assert.deepEqual(ids.sort(), ["also-good", "good", "truncated"], "one unreadable record does not hide the rest");
  const truncated = listed.find((entry) => entry.id === "truncated");
  assert.equal(truncated?.tick, 33, "the unreadable record is still listed with its own metadata");

  // Reading that slot is strict: it is a typed failure, never a silent null.
  await expectFailure(() => repository.readSlot("truncated"), "storage-read-failed");
}

// --- F3a: player-facing wording ---------------------------------------------

/**
 * Handoff §7 requires four outcomes a player can tell apart, and forbids raw
 * storage exceptions as the primary message. The messages themselves are
 * implementer freedom; the distinctions are not.
 */
async function testStorageFailuresAreDistinguishable() {
  const read = new PersistenceFailure("storage-read-failed", new Error("QuotaExceededError: raw browser text"));
  const write = new PersistenceFailure("storage-write-failed", new Error("QuotaExceededError: raw browser text"));
  const none = new PersistenceFailure("no-save");

  const readMessage = storageFailureMessage(read);
  const writeMessage = storageFailureMessage(write);
  const noneMessage = storageFailureMessage(none);
  assert.notEqual(readMessage, writeMessage, "a read failure and a write failure read differently");
  assert.notEqual(readMessage, noneMessage, "a failed read is not reported as no save at all");
  assert.ok(!/QuotaExceededError/.test(readMessage), "raw storage text never reaches the player");
  assert.ok(!/QuotaExceededError/.test(writeMessage), "raw storage text never reaches the player, write side either");
  assert.ok(/previous save is unchanged/.test(writeMessage), "a failed write says the confirmed save survives");
}

async function testRestoreRejectionsAreDistinguishable() {
  const fromAnotherEngine = new RuntimeCommandRejection("engine-mismatch", "Checkpoint engine 0.22.0 does not match 0.23.0", "This saved universe comes from a different version of the engine, so this build cannot restore it.");
  const invalid = new CheckpointRejectionError("analysis.dep", "invalid_value", "not a state");
  const internal = new RuntimeCommandRejection("internal", "boom", "Something went wrong.");

  const engineMessage = restoreFailureMessage(fromAnotherEngine);
  const invalidMessage = restoreFailureMessage(invalid);
  const internalMessage = restoreFailureMessage(internal);
  assert.notEqual(engineMessage, invalidMessage, "another engine's save reads differently from a corrupt one");
  assert.notEqual(engineMessage, internalMessage, "and both differ from an internal fault");
  assert.ok(!/does not match/.test(engineMessage), "the developer message is not the player message");
  assert.ok(!/not a state/.test(invalidMessage), "nor is the developer detail for a corrupt save");
  // The important one: an untyped failure must not leak whatever it happened to be.
  const untyped = restoreFailureMessage(new Error("TypeError: cannot read properties of undefined"));
  assert.ok(!/TypeError/.test(untyped), "an unclassified failure never shows raw text");
  assert.ok(/current world is unchanged/.test(untyped), "and says what is actually true");
  assert.ok(!/Checkpoint engine/.test(storageFailureMessage(fromAnotherEngine)), "a runtime rejection is not dressed up as a storage failure");
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
  ["listing tolerates one unreadable record", testListingToleratesOneUnreadableRecord],
  ["storage failures are distinguishable", testStorageFailuresAreDistinguishable],
  ["restore rejections are distinguishable", testRestoreRejectionsAreDistinguishable],
  ["an unstaged cache adopts nothing", testAnUnstagedCacheAdoptsNothing],
  ["successful restore adopts matching anchors", testSuccessfulRestoreAdoptsMatchingAnchors],
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