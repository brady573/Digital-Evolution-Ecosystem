# F3a Save/Load Failure Integrity & Atomic Restore — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ordinary save and load failures transactional and truthful — a failed save preserves the last confirmed save, and a rejected restore never partially becomes the live runtime or the displayed world.

**Architecture:** Three boundaries change independently. (1) Explorer storage becomes a versioned save envelope read through one transaction, with a typed storage-failure taxonomy. (2) `UniverseSession.restore()` splits into prepare-then-commit so a candidate that fails any decode step cannot have mutated the live session. (3) Rejection typing survives the worker boundary so the UI can branch on reason instead of message text, and adjunct staging becomes transactional. F3b (durability/eviction), F3c (investigation persistence) and F3d (terminal recovery) stay out.

**Tech Stack:** TypeScript, Node 24, pnpm, `tsx` validation runners, a hand-built in-test IndexedDB double (no new dependency), the existing fake-transport seam in `runtime-boundary.ts` for worker-path tests, Playwright browser lane.

**Spec:** `docs/superpowers/specs/2026-10-02-f3a-save-load-integrity-handoff.md` (Owner handoff, verbatim from issue #96). The spec OVERRULES this plan wherever they conflict.

## Global Constraints

- Baseline `main @ 9c3e9c0`. Engine version, checkpoint schema and checkpoint meaning are unchanged by this handoff.
- Checkpoint semantics, simulation semantics, deterministic continuation, and evidence-export semantics are unchanged. Save/load failure handling must not advance ticks or consume simulation RNG.
- Exactly ONE checkpoint validation/canonicalization path. No second interpretation of checkpoint validity in Explorer, worker, or repository code.
- Pixel Phenotype anchors stay presentation-only and save-adjacent. Never move them into `UniverseCheckpoint`.
- `IndexedDbWorldRepository.save()` already waits for transaction `complete`. Preserve that semantic boundary; request-level success is not sufficient.
- Lane 3 `READ_MODEL_VERSION=1` frames and staggered cadence are unchanged. Terminal worker failure stays a truthful stopped state; no auto-reconstruction.
- Aftermath is not persisted. A restored world shows no aftermath.
- Offline-first. No network calls, no new runtime dependency, no cloud/backend.
- New validation unit is registered in `tools/validation/manifest.ts` + `package.json` per `AGENTS.md`, and `pnpm validation:check` must pass. Tests are never weakened to make a change pass.
- **OWNER DEVICE RULE:** short bounded authoring/diagnostic commands only. Full `pnpm verify`, browser suites, and survey-style runs go to CI.
- No push, PR, or remote change without explicit Owner authorization.

## File Structure

- Modify: `apps/explorer/src/persistence.ts` — save envelope, one-transaction slot read, legacy normalization, typed storage failures, test-only IDB factory injection.
- Modify: `packages/sim-runtime/src/session.ts` — `restore()` becomes prepare/commit; `ERROR` response carries a rejection reason.
- Modify: `packages/sim-runtime/src/client.ts` — rehydrate the typed rejection from the correlated `ERROR` instead of wrapping it in a bare `Error`.
- Modify: `packages/contracts/src/index.ts` — `ERROR` response gains an optional rejection discriminator; new exported reason union member(s) for runtime (non-checkpoint-shape) rejections.
- Modify: `apps/explorer/src/App.tsx` — truthful save/load status from typed classification; deferred adjunct staging; prior playback intent restored on ordinary rejection. No broader decomposition.
- Create: `tools/validation/persistence-integrity.ts` — Node unit: IDB double, envelope/coherence/legacy/overwrite tests.
- Modify: `tools/validation/runtime-boundary.ts` — restore atomicity tests and worker-path rejection typing tests (the unit already hosts fake-transport tests and already runs Node-importable Explorer modules' siblings).
- Modify: `tools/validation/browser-smoke.ts` — only the four new failure-path interactions.
- Modify: `tools/validation/manifest.ts`, `package.json` — register `persistence-integrity`.

---

## Verified Baseline Findings

These are facts about `main @ 9c3e9c0`, confirmed by reading the code. They are what the work must fix; do not re-derive them, but do not assume they are the only gaps.

1. **Coherence gap (AC3).** `persistence.ts:55` `load()` and `:63` `loadAnchors()` each open their own `readonly` transaction and `get(id)` separately. Two independently timed reads can observe different record generations.
2. **Restore partial-mutation gap (AC5/AC6/AC7).** `session.ts:644` assigns `this.#worldId = toWorldId(++worldIdCounter)` BEFORE `restoreSimulationCheckpoint` (`:645`) and `EcologyObserver.restore` (`:652`). A throw in either leaves a session reporting a brand-new `worldId` while still holding the old experiment — identity and biology desynced, which is what `knownWorldRef`, the presentation store's world gate, and the phenotype cache's world scoping all key on.
3. **Typed rejection is lost at the worker boundary (§7).** `session.ts:936` catches and returns `{type:"ERROR", message, requestId}`. `client.ts:328` re-wraps it as `new Error(response.message)`. So `App.tsx:673`'s `error instanceof CheckpointRejectionError` branch — the A3.3 player-message path — can never fire through the worker, and the player sees a raw developer message. Correlated rejection by `requestId` already works (`client.ts:334-337`); only the type is lost.
4. **Adjunct staging before restore (AC8).** `App.tsx:660` calls `phenotypeCache.stageAnchors(...)` BEFORE `runtime.loadCheckpoint(...)`. `phenotype.ts:101-103,138-146` stores into `this.staged` and adopts on the first differing `worldId`. A rejected load leaves the candidate's anchors staged, and combined with finding 2 the next world adopts them.
5. **Playback intent lost on rejection (AC9).** `App.tsx:655` `setRunning(false)` happens before the attempt with no restore on the catch path.

Not a gap, confirmed good: `handle()` wraps the switch in try/catch (`session.ts:936`) so the worker path DOES produce a correlated rejection rather than an uncaught throw; `validateCheckpoint` → engine-version guard → `canonicalizeRestoreState` → `validateCanonicalRestoreState` ordering is the single A3.3/A3.4 path and must stay exactly where it is.

---

## Review Focus

1. **A write fails partway** (quota, abort, blocked upgrade) — a reasonable person expects the world they saved ten minutes ago to still be there. Pinned by Task 2 Step 1 (`testFailedOverwritePreservesPriorSave`).
2. **A stored record is unusable** (truncated write, missing checkpoint, unknown envelope version) — a reasonable person expects a truthful "this save can't be read" message, not a crash and not a silent "no save exists". Pinned by Task 1 Step 5 (`testUnreadableRecordIsTypedNotSilent`).
3. **A checkpoint passes preflight but fails deep canonical validation** — a reasonable person expects their current world untouched and still playing, not a half-restored world and a silent pause. Pinned by Task 3 Step 4 and Task 4 Step 5.
4. **A failed load's anchors get consumed by the next world** — a reasonable person expects the restored world to look like *that* save, and an unrelated new world to look like nothing it has never seen. Pinned by Task 4 Step 4 (`testFailedCandidateAnchorsNeverAdopted`).
5. **Player clicks Load mid-playback and it is rejected** — a reasonable person expects playback to resume as it was, because a failed load is not a request to pause. Pinned by Task 4 Step 6.

---

### Task 1: Save envelope, one coherent slot read, typed storage failures

**Files:**
- Create: `tools/validation/persistence-integrity.ts`
- Modify: `apps/explorer/src/persistence.ts`
- Modify: `tools/validation/manifest.ts`, `package.json`

**Interfaces:**
- Consumes: existing `UniverseCheckpoint`, `ResolvedPhenotype`, `sanitizeAnchors`, `SavedUniverseSummary`, `WorldRepository`.
- Produces (later tasks depend on these exact names):
  - `export const SAVE_ENVELOPE_VERSION = 1`
  - `export interface SaveEnvelope { readonly envelopeVersion: 1; readonly id: string; readonly savedAt: string; readonly tick: number; readonly engineVersion: string; readonly checkpoint: UniverseCheckpoint; readonly phenotypeAnchors?: Record<number, ResolvedPhenotype> }`
  - `export interface SlotRead { readonly checkpoint: UniverseCheckpoint; readonly phenotypeAnchors: Record<number, ResolvedPhenotype> | null; readonly savedAt: string; readonly tick: number; readonly engineVersion: string }`
  - `export type PersistenceFailureKind = "no-save" | "storage-read-failed" | "storage-write-failed"`
  - `export class PersistenceFailure extends Error { readonly kind: PersistenceFailureKind }` with a `playerMessage` per kind (exact copy is implementer freedom; must not surface raw DOM/IndexedDB text)
  - `readSlot(id: string): Promise<SlotRead | null>` — one readonly transaction, one `get(id)`
  - `WorldRepository.loadAnchors` removed; `WorldRepository.load` remains for callers that only need the checkpoint and is implemented over `readSlot`
  - Test-only factory: `export function createRepository(options?: { readonly indexedDB?: IDBFactory }): WorldRepository` — `IndexedDbWorldRepository` stays the shipped default and delegates to it.

- [ ] **Step 1: Write the failing test file skeleton with the IndexedDB double**

Create `tools/validation/persistence-integrity.ts`. It must install a global `indexedDB` double before importing `persistence.ts`, modeling: `open` (with `onupgradeneeded`/`onsuccess`/`onerror`), `db.transaction(store, mode)`, `tx.objectStore(store).put/get/getAll`, and transaction completion via `oncomplete`/`onerror`/`onabort`. The double exposes a failure-injection control (`failOn: "open" | "put" | "get" | "commit" | "abort" | null`) so a test can abort or error a specific step. Writes inside an aborted transaction must NOT be visible to a later `get` — that rollback fidelity is the whole point of the double; assert it in the double's own setup so a future edit cannot quietly drop it.

- [ ] **Step 2: Run to verify the double is usable and the envelope tests fail**

Run: `pnpm exec tsx tools/validation/persistence-integrity.ts`
Expected: FAIL — `SAVE_ENVELOPE_VERSION` / `readSlot` do not exist yet. Confirm first that the double itself round-trips a put/get before relying on its failure assertions.

- [ ] **Step 3: Implement the envelope and coherent read in `persistence.ts`**

`save()` writes `SaveEnvelope` under the existing `universes` store (store key path stays `id`; the IndexedDB `VERSION` constant stays 1 because the record shape is versioned in-band, not by a DB upgrade). `readSlot()` opens ONE readonly transaction, issues ONE `get(id)`, and derives both checkpoint and anchors from that one result — deleting the second `get` that `loadAnchors` performs today. `savedAt` uses `new Date().toISOString()` exactly as today.

- [ ] **Step 4: Implement legacy normalization**

A stored record lacking `envelopeVersion` is a legacy/current-format record: normalize it IN MEMORY into a `SaveEnvelope` (checkpoint from `record.checkpoint`, anchors from `record.phenotypeAnchors` through `sanitizeAnchors`, `tick`/`engineVersion` from `record.tick`/`record.engineVersion`). Do not write the record back. A record WITH `envelopeVersion` greater than `SAVE_ENVELOPE_VERSION` is not readable by this build and must throw the typed unreadable-record failure from Task 4's taxonomy (define the local `PersistenceFailure` with kind `"storage-read-failed"` here; Task 4 adds the UI mapping, not a new kind).

- [ ] **Step 5: Add the boundary tests**

In `persistence-integrity.ts`:
- `testSaveThenReadRoundTrips` — save returns a summary; `readSlot` returns a checkpoint deep-equal to what was saved plus the anchors.
- `testSlotReadUsesOneTransaction` — count `transaction()` and `get()` calls in the double during one `readSlot`; assert exactly one of each.
- `testLegacyRecordNormalizesWithoutRewrite` — seed a legacy unversioned record directly into the double; `readSlot` returns a usable checkpoint + anchors, and the stored record still has no `envelopeVersion` afterwards.
- `testMissingSlotReturnsNoSave` — `readSlot` on an absent id returns `null` (distinct from a failure).
- `testOpenFailureIsTyped` — inject `failOn:"open"`; expect `PersistenceFailure` with kind `"storage-read-failed"`, not a raw `DOMException`.
- `testUnreadableRecordIsTypedNotSilent` (Review Focus 2) — three sub-cases in one test: record with no `checkpoint` field; record whose `checkpoint` is not an object; record with `envelopeVersion: SAVE_ENVELOPE_VERSION + 1`. Each must throw the typed failure, and must NOT be reported as `null`/no-save.

- [ ] **Step 6: Register the validation unit**

Per `AGENTS.md`: add `"test:persistence-integrity": "tsx tools/validation/persistence-integrity.ts"` to `package.json`; add manifest unit `id: "persistence-integrity"`, `cls: "deterministic"`, `enforcement: "blocking"`, `mergeGate: true`, `domains: withApparatus("contracts", "sim-runtime", "explorer")`, `parallelSafe: true`, one-line `claim`. Put it in the `simulation` group and in exactly one shard — default `ci-sim-c` beside `runtime-boundary`, moving only if measured cost demands. Run `pnpm validation:check`.

- [ ] **Step 7: Run to verify green**

Run: `pnpm test:persistence-integrity` then `pnpm validation:check`
Expected: PASS both. Also `pnpm exec tsc -p apps/explorer/tsconfig.json --noEmit`.

- [ ] **Step 8: Commit**

```bash
git add apps/explorer/src/persistence.ts tools/validation/persistence-integrity.ts tools/validation/manifest.ts package.json
git commit -m "feat(explorer): versioned save envelope with one coherent slot read"
```

---

### Task 2: Failed overwrite preserves the previously committed save

**Files:**
- Modify: `apps/explorer/src/persistence.ts`
- Modify: `tools/validation/persistence-integrity.ts` (append)

**Interfaces:**
- Consumes: Task 1's `PersistenceFailure`, `createRepository`, `SaveEnvelope`, double failure control.
- Produces: `save()` rejects with `PersistenceFailure` kind `"storage-write-failed"` on any write failure, and resolves ONLY after transaction completion (behavior preserved, now typed).

- [ ] **Step 1: Write the failing tests**

```ts
testFailedOverwritePreservesPriorSave() {
  // save() a good record for slot "current".
  // Inject failOn:"abort" (transaction aborts after the put request succeeded).
  // await expect(save(...)).rejects.toThrow(PersistenceFailure) with kind "storage-write-failed".
  // readSlot("current") still returns the FIRST checkpoint, deep-equal, with the first anchors.
}
testWriteSuccessIsNotReportedBeforeCommit() {
  // With failOn:"commit", save() must reject — a request-level success that
  // never reaches transaction complete is not a save.
}
testPriorSaveSurvivesAcrossFailedOverwrites() {
  // Two consecutive failed overwrites in a row still leave the original record readable.
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test:persistence-integrity`
Expected: FAIL — the write path does not classify its failure.

- [ ] **Step 3: Implement**

Wrap the `save()` body so any `onerror`/`onabort`/thrown request failure maps to `new PersistenceFailure("storage-write-failed", …)` with the underlying error kept on a `cause`-style field for logs/tests (player message never shows the raw IDB text). Do NOT change the existing rule that success resolves on `tx.oncomplete`. Keep `finally { db.close() }`.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm test:persistence-integrity`, then `pnpm validation:check`
Expected: PASS both.

- [ ] **Step 5: Commit**

```bash
git add apps/explorer/src/persistence.ts tools/validation/persistence-integrity.ts
git commit -m "fix(explorer): a failed overwrite keeps the previously committed save"
```

---

### Task 3: Prepare → commit atomicity in `UniverseSession.restore()`

**Files:**
- Modify: `packages/sim-runtime/src/session.ts` (the `restore()` method and its immediate helpers only)
- Modify: `tools/validation/runtime-boundary.ts` (append restore-atomicity tests)

**Interfaces:**
- Consumes: existing `validateCheckpoint`, engine-version guard, `canonicalizationContext`, `canonicalizeRestoreState`, `validateCanonicalRestoreState`, `restoreSimulationCheckpoint`, `EcologyObserver.restore`.
- Produces: a private `#prepareRestore(checkpoint): PreparedRestore` and a `#commitRestore(prepared)` inside `session.ts`; `restore()` keeps its exact signature and return value. For tests only, a module-scope, factory-shaped injection point (see the seam rule below) so a prepare step can be made to throw.

**Seam rule (learned in Tranche B and applied to Lane 3 review):** a test seam that must be unreachable from production must not be a public method on an exported class — a public method is reachable regardless of the interface it is omitted from. Make it a module-scope variable set by a test-only exported factory (`export function __setRestorePrepareHookForTests(hook?: (step: string) => void): void`), documented as test-only and never called by production code. Read-only diagnostic seams on the class remain acceptable.

- [ ] **Step 1: Write the failing test**

In `runtime-boundary.ts`, add `testRejectedRestoreLeavesSessionUntouched`. Build a session, create a world, advance it, record `worldId` + a checkpoint. Then attempt `restore()` of a payload that passes `validateCheckpoint` and the engine-version guard but fails later — the easiest reliable construction is a valid checkpoint whose canonical analysis state is invalid (mirror an existing rejection fixture in `aftermath-runtime.ts` / `checkpoint-boundary.ts` rather than inventing a new one). Assert: `worldId` unchanged; `checkpoint()` deep-equal before and after; the same checkpoint twice from the pre-state continues deterministically to the same result.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec tsx tools/validation/runtime-boundary.ts`
Expected: FAIL — `worldId` has advanced even though the restore threw (Verified Finding 2).

- [ ] **Step 3: Split restore into prepare and commit**

Move every `this.#… = …` assignment in `restore()` behind `#commitRestore`. `#prepareRestore` performs, in the current order and with no `this` mutation: source preflight, engine-version guard, canonicalization context, canonicalize, validate canonical, experiment restore, analysis restore, aftermath decision (always `null`), control restore, control-analysis restore, decision/pacing extraction, `observedThrough` computation, and the NEXT world identity (`toWorldId(worldIdCounter + 1)` — computed, NOT consumed). If any step throws, nothing has been written.

`#commitRestore(prepared)` then assigns all fields including `#worldId = prepared.worldId`. A restore that throws leaves `worldIdCounter` unadvanced, so the next successful restore does not skip an identity.

Comment the split with the reason: identity must not be minted before the candidate is fully constructed, because `worldId` is what presentation identity, the store's world gate, and phenotype anchor scoping key on.

- [ ] **Step 4: Add the per-step failure tests (Review Focus 3)**

Using the test hook, make each prepare step throw in turn — experiment decode, analysis restore, control restore, control-analysis restore, decision/pacing — and for each assert the full invariant set: `worldId` unchanged, `checkpoint()` deep-equal to the pre-restore checkpoint, no presentation frames delivered to a `subscribePresentation` listener, and a subsequent successful `restore()` of the SAME checkpoint still works and yields the expected restored world. Also add `testSuccessfulRestoreStillEmitsRestoredWorldFrames` — the normal `CHECKPOINT_LOADED` + frame sequence is unchanged (AC10).

- [ ] **Step 5: Run to verify they pass**

Run: `pnpm exec tsx tools/validation/runtime-boundary.ts`, then `pnpm test:persistence-integrity`, `pnpm validation:check`
Expected: PASS all.

- [ ] **Step 6: Commit**

```bash
git add packages/sim-runtime/src/session.ts tools/validation/runtime-boundary.ts
git commit -m "fix(sim-runtime): restore prepares fully before mutating the live session"
```

---

### Task 4: Typed rejection across the worker boundary, transactional adjunct staging, truthful load UX

**Files:**
- Modify: `packages/contracts/src/index.ts` (the `ERROR` response member + a rejection-reason union)
- Modify: `packages/sim-runtime/src/session.ts` (the `catch` in `handle()` populates the reason)
- Modify: `packages/sim-runtime/src/client.ts` (`#error` branch rehydrates a typed error)
- Modify: `apps/explorer/src/App.tsx` (`save`, `load`, status copy, staging order, playback intent)
- Modify: `tools/validation/runtime-boundary.ts` (append), `tools/validation/persistence-integrity.ts` (append)

**Interfaces:**
- Consumes: Task 1's `PersistenceFailure`/`PersistenceFailureKind`; Task 3's atomic restore; existing `CheckpointRejectionError` + `CheckpointRejectionReason` + `CHECKPOINT_PLAYER_MESSAGES`.
- Produces:
  - contracts: `export type RuntimeRejectionKind = "checkpoint-rejected" | "engine-mismatch" | "unsupported-command" | "internal"`; the `ERROR` response gains `readonly rejectionKind?: RuntimeRejectionKind` and `readonly rejectionReason?: CheckpointRejectionReason`.
  - `RuntimeClient.loadCheckpoint` rejects with an error whose `name` is `"CheckpointRejectionError"` and whose `reason`/`field`/`playerMessage` are populated when the worker said so, so `App.tsx`'s existing `instanceof`-style branch can work — implement the client-side rehydration so it reconstructs a `CheckpointRejectionError` instance from the correlated fields, and otherwise rejects a `RuntimeCommandRejection` carrying `kind`.
  - `App.tsx`: `load()` reads via `readSlot`, restores FIRST, stages anchors only on success; captures prior `running` and restores it on ordinary rejection.

- [ ] **Step 1: Write the failing worker-path tests**

In `runtime-boundary.ts`, using the existing fake transport: `testWorkerRejectionRehydratesTypedError` — deliver `{type:"ERROR", message, requestId, rejectionKind:"engine-mismatch"}` for a pending load; assert the rejection is typed and carries `kind === "engine-mismatch"`. `testWorkerRejectionWithoutKindIsStillTyped` — an `ERROR` with no discriminator rejects as `internal` rather than a bare `Error`. `testCheckpointRejectionKeepsPlayerMessage` — `rejectionKind:"checkpoint-rejected"` with a `rejectionReason` from `CheckpointRejectionReason` produces a rejection exposing that reason's player message (Verified Finding 3).

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm exec tsx tools/validation/runtime-boundary.ts`
Expected: FAIL — the reason is dropped at the worker boundary.

- [ ] **Step 3: Implement the typed rejection path**

Extend the `ERROR` contract member additively. In `session.ts`'s `catch`, classify: `CheckpointRejectionError` → `checkpoint-rejected` + its `reason`; the engine-version guard's throw → `engine-mismatch` (give that guard its own error class or a discriminant so it is not confused with an internal fault); unknown tag → `unsupported-command`; anything else → `internal`. In `client.ts`, reconstruct `new CheckpointRejectionError(field, reason, message)` when `rejectionKind === "checkpoint-rejected"` and `rejectionReason` is present, else reject with a `RuntimeCommandRejection` carrying `kind`. Message text stays in the error for logs; classification no longer depends on parsing it.

- [ ] **Step 4: Add the adjunct tests (Review Focus 4)**

In `persistence-integrity.ts` (it already imports the Explorer's presentation modules' sibling surface; if `phenotype.ts` does not import cleanly in Node, assert through `PhenotypeCache` directly with a minimal `{worldId, organisms}` input per its documented signature): `testFailedCandidateAnchorsNeverAdopted` — stage anchors from a candidate that then fails to restore; assert a subsequent fresh world resolves with NO anchored family and that `phenotypeCache` reports no staged entries left. `testSuccessfulRestoreAdoptsMatchingAnchors` — the success path still reconstructs identical families (AC11).

- [ ] **Step 5: Rework `load()` in App.tsx**

```ts
const wasRunning=running;
let read;
try{ read=await repository.readSlot("current"); }
catch(error){ setStatus(mapStorageFailure(error)); if(wasRunning)setRunning(true); return }
if(!read){ setStatus("No saved universe found"); if(wasRunning)setRunning(true); return }
setStatus("Restoring checkpoint…");
try{
  const restored=await runtime.loadCheckpoint(read.checkpoint);
  // adjuncts stage ONLY now: a rejected candidate can never leave anchors behind
  phenotypeCache.stageAnchors(read.phenotypeAnchors??{});
  setSnapshot(restored);
  ... settings/preset mapping as today ...
  setStatus("Checkpoint restored — active settings match the resumed universe");
}catch(error){
  setStatus(mapRestoreFailure(error));   // typed branch, never message parsing
  if(wasRunning)setRunning(true);        // AC9: an ordinary rejected load is not a pause request
}
```

Add two small mapping helpers in `App.tsx` (or a new `apps/explorer/src/persistenceMessages.ts` if that keeps App smaller) that turn `PersistenceFailure.kind` and the typed runtime rejection into the four required player outcomes: no save exists / save storage or read failed / save read but this build cannot restore it / save write failed. Copy is implementer freedom; no raw DOM/IndexedDB text.

Update `save()` to map a `PersistenceFailure` to "save write failed" and to leave the previous success text untouched on failure — it already only sets success after `save()` resolves.

- [ ] **Step 6: Add the playback-intent test (Review Focus 5)**

In `browser-smoke.ts` (real UI, so the test belongs there): load a valid save, start playback, corrupt the stored record via page-context IndexedDB, click Load, assert the truthful failure text appears, the world is still the pre-load world (tick continues from where it was), and playback is still running.

- [ ] **Step 7: Run to verify**

Run: `pnpm exec tsx tools/validation/runtime-boundary.ts`, `pnpm test:persistence-integrity`, `pnpm test:phenotype`, `pnpm test:aftermath`, `pnpm validation:check`, explorer typecheck, `pnpm build`
Expected: PASS all.

- [ ] **Step 8: Commit**

```bash
git add packages/contracts/src/index.ts packages/sim-runtime/src/session.ts packages/sim-runtime/src/client.ts apps/explorer/src/App.tsx tools/validation/runtime-boundary.ts tools/validation/persistence-integrity.ts
git commit -m "fix(explorer,sim-runtime): typed rejection, transactional adjunct staging, truthful save/load UX"
```

---

### Task 5: Browser failure-path evidence, full validation, return package

**Files:**
- Modify: `tools/validation/browser-smoke.ts` (three more interactions, appended to Task 4's one)
- Modify: `tools/validation/persistence-integrity.ts` only if a coverage gap surfaces

**Interfaces:**
- Consumes: Tasks 1–4.

- [ ] **Step 1: Add the remaining browser interactions**

- Save, then force a failed overwrite (page-context: make the store's next `put` throw by opening a version-mismatch upgrade, or the simplest reliable route the harness supports), click Save again, assert the failure text, then reload and assert the FIRST save still restores (AC2, end-to-end).
- Corrupted stored save (write a record whose `checkpoint` is garbage through page-context IndexedDB): click Load → truthful "cannot restore" text, and the current world remains usable and inspectable (AC11).
- Successful save → reload → resume still exact-tick (the existing assertion at `browser-smoke.ts:377-385` must keep passing unmodified; that is the AC10 parity proof).

- [ ] **Step 2: Run the device-cheap gates locally**

Run: `pnpm validation:check`, `pnpm test:persistence-integrity`, `pnpm exec tsx tools/validation/runtime-boundary.ts`, `pnpm typecheck`, `pnpm build`
Expected: PASS. Browser suite to CI per the Owner device rule.

- [ ] **Step 3: Push and read CI on the exact pushed head**

Record the run IDs and confirm every blocking unit green on that SHA. No reusing a prior head's green.

- [ ] **Step 4: Assemble the issue's return package on the PR**

Architecture summary · changed persistence/runtime/UI boundary map · final envelope schema + legacy compatibility rule · restore prepare/commit explanation · failure taxonomy exposed to Explorer · validation commands/results + CI links · explicit evidence that failed overwrite preserves the prior save · explicit evidence that failed restore preserves active runtime + presentation world · explicit evidence that failed candidate anchors cannot leak · successful checkpoint + deterministic continuation results · residual persistence risks deferred to F3b/F3c/F3d · any design-significant deviation or Owner decision request.

State plainly what F3a evidence does NOT support: storage-eviction protection, Android persistence durability, or terminal-worker recovery.

- [ ] **Step 5: Stop**

F3a completion does not close issue #96. F3b/F3c/F3d remain separately activated. Do not merge without authorization.

---

## Self-Review

**1. Spec coverage.** AC1 → T1/T2/T4. AC2 → T2. AC3 → T1. AC4 → T1. AC5 → T3. AC6 → T3. AC7 → T3/T4. AC8 → T4. AC9 → T4. AC10 → T3/T5. AC11 → T4/T5. AC12 → T1/T4 (envelope is storage; adjuncts stay presentation). AC13 → T3 (single path preserved, tested). AC14 → T3. AC15 → T3 (no wall-clock added to restore; `savedAt` lives in the repository, not the session). AC16 → T1 registration + T5. Required behavior §1–§8 and §3's transaction-completion rule map to T1/T2/T4. Validation expectations §1 → T1/T2, §2 → T3, §3 → T4, §4 → T4/T5, §5 → T5. Every non-goal is untouched by construction. All five return conditions are avoided by design; the one that could plausibly trigger is "existing restore APIs cannot be made prepare/commit atomic without changing simulation semantics" — T3's approach is purely a reordering inside `restore()`, so it should not, and the plan says to STOP and report if it does.

**2. Step scan.** Every code step names an exact exported name or field. Task 4's `load()` body is given because the ordering of read → restore → stage → restore-intent is the decision, not the syntax. No TBDs, no "appropriate validation".

**3. Type consistency.** `SAVE_ENVELOPE_VERSION`, `SaveEnvelope`, `SlotRead`, `PersistenceFailureKind`, `PersistenceFailure`, `readSlot`, `createRepository`, `RuntimeRejectionKind`, `RuntimeCommandRejection`, `rejectionKind`, `rejectionReason` are each introduced once and used with the same spelling in every later task. `WorldRepository.loadAnchors` is removed in T1 and no later task references it.

**4. Review Focus.** All five lines are pinned to named tests in the task that owns the code (T2, T1, T3+T4, T4, T4).

**5. Proportion.** The plan is roughly the length of the spec's behavioral half. Code appears only where the decision is the content (the `load()` rewrite and the envelope shape); everything else is a name, a field, or an assertion.