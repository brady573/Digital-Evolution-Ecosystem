# A7 Runtime Boundary Closure Implementation Plan

> **Delivery status: plan written, not started.** No step below is checked. The
> handoff is an ACTIVE OWNER HANDOFF; this plan implements it and has not yet
> been reviewed.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three runtime trust boundaries in issue #54 items 3–5, so that a malformed worker command cannot mutate simulation state, every worker request settles exactly once, and a checkpoint load completes only through explicit request correlation rather than tick equality.

**Architecture:** A pure `validateRuntimeCommand` in `packages/sim-runtime` runs at the top of `UniverseSession.handle`, before the dispatch switch, turning an `unknown` payload into either a narrowed `RuntimeCommand` or a structured rejection. `LOAD_CHECKPOINT` gains a `requestId` and returns a distinct `CHECKPOINT_LOADED` response carrying that id, so the client correlates completion by identity. `WorkerRuntimeClient` gains an injectable worker transport, a bounded request lifetime, and one fatal path shared by `error`, `messageerror`, and `destroy`.

**Tech Stack:** TypeScript (strict), pnpm, tsx, Node `assert/strict`, manifest-routed validation.

**Spec:** Owner handoff "Digital Evolution — Tranche A Runtime Boundary Closure" (ACTIVE HANDOFF — PRE-M7 TRANCHE A), <https://docs.google.com/document/d/1o3AmX-c0FtirA2YhImCQXVde_TmF8h0RYawGJQBucV8/edit>. GitHub issue #54 items 3, 4, 5. The requirements this plan implements are reproduced verbatim in *Global Constraints* so an executor does not need the link.

**Baseline:** `main` @ `2535960`. Issue #54's own review basis is `26a712d`; the boundary code has not changed since, and every finding below was re-verified against `2535960`.

## Global Constraints

Verbatim from the accepted handoff. Every task's requirements implicitly include this section.

- Treat worker/runtime command payloads as untrusted at the boundary. Commands that accept numeric counts or limits must reject `NaN`, `Infinity`, negative values, fractional values where integers are required, malformed payloads, unsupported command tags, and values outside an explicitly supported bounded range.
- Invalid commands must produce deterministic structured failure and must not mutate simulation, decision, analysis, checkpoint, or request state. Validation must occur before any loop or simulation advance can begin.
- Every request must settle exactly once through one of the supported terminal outcomes: success, structured command failure, timeout/cancel, worker-fatal rejection, or explicit destruction/supersession where applicable.
- Worker `error` and `messageerror` must enter one fatal transport path that rejects and clears all pending requests and any pending checkpoint load. No promise/request may remain indefinitely pending after a terminal worker failure.
- A bounded request lifetime or equivalent explicit cancellation policy is required. The exact timeout values and implementation mechanism are implementation-owned unless they become product-visible.
- Destroy/teardown must settle or cancel outstanding requests deterministically and leave no retained pending-map entries.
- `LOAD_CHECKPOINT` must carry request identity and completion must be correlated to that request identity rather than inferred from snapshot tick equality.
- A same-tick unrelated snapshot, stale snapshot, normal live-frame update, or response belonging to a different load must not complete the active load request.
- Define explicit behavior for multiple load requests. Supersession/cancellation is acceptable if deterministic and tested; silently allowing one request to satisfy another is not.
- Successful restore must return enough restored metadata to prove which request completed without making presentation responsible for restore authority.
- No sim-core biological rule changes are authorized. No changes to mutation, movement, metabolism, reproduction, resource dynamics, dormancy, catalysts, event detection, ecological analysis meaning, or population behavior are part of this handoff.
- Checkpoint restoration must continue using the accepted canonical-restore path. Do not create a second restore path for worker convenience.
- Same engine version + resolved configuration + seed + command sequence preserves supported deterministic behavior.
- sim-core remains biological authority; sim-analysis remains read-only interpretation; sim-runtime remains session/worker authority.
- Checkpoint schema 0.4 and the accepted migration/canonical-validation ordering remain authoritative. A failed load does not partially replace the active world.
- No biological population target or cap may be introduced as a runtime-safety shortcut.
- Offline simulation, saves, history, experiments, inspection, and evidence export remain supported.
- Pixi/rendering code remains presentation-only and must not gain worker/simulation authority through this work.
- Do not implement issue #54 items 6–12. Do not begin the Tranche B bounded live-snapshot redesign. Do not bind production Pixi to worker snapshots. Do not remove the production Canvas2D World. Do not implement Aftermath Stage 2 or M7 Investigation Thread behavior. Do not reopen issue #33 or PR #21.
- Do not commit, push, or open a PR without separate Owner authorization.

## Review Focus

The five inputs the handoff implies but does not name, most likely to bite first. Each is pinned by a test in the task that owns the code.

- **An unsupported command tag.** Today `handle` falls out of its switch, returns `undefined`, and `worker.ts:10` throws `responses is not iterable` *outside* the try/catch — an uncaught worker error that leaves every pending promise pending forever. One malformed tag currently breaks §5, §6, AC1, AC3 and AC4 at once. Pinned in Task 1.
- **A rejected advance wedging the time controls.** `App.tsx:528` sets `advanceDebt` on post and clears it *only* inside `runtime.subscribe`. A rejected `ADVANCE_TICKS` that returns no `SNAPSHOT` freezes the simulation permanently. Pinned in Task 2.
- **A tick count large enough to hang the worker.** `advance(Infinity)` yields `count === Infinity` and enters a loop bounded only by whether biology happens to fire an event. Pinned in Task 2.
- **A worker that dies mid-request.** A crash today is a `console.error` at `client.ts:38`; four unbounded request types stay pending forever and the pending map is never cleared. Pinned in Task 5.
- **A restore that resolves from the wrong world.** Any live `SNAPSHOT` whose `tick` equals the checkpoint's `createdTick` resolves the load — including a decision-gated advance that emits a snapshot at the *unchanged* tick (`session.ts:402`). Pinned in Task 4.

## Decisions this plan makes (implementation freedom, §12)

Recorded here because they are choices, not derivations. Each is reversible at review.

1. **Validation lives at the top of `session.handle`, not in `worker.ts`.** `handle` is the real command boundary: it is what every `RuntimeCommand` passes through, and the only two existing `.handle()` call sites in the repository (`aftermath-runtime.ts:337,343`) call it *directly*, bypassing `worker.ts`. Validating in `worker.ts` would leave those tests exercising an unvalidated path and would leave `handle` itself unprotected for any future caller. The trade-off accepted: `handle` gains one import and one guard call.
2. **The validator lives in `packages/sim-runtime`, not `packages/contracts`.** The supported range for `ADVANCE_TICKS` is anchored on `MAX_SLICE_TICKS`, which `speed.ts:29` already owns. `contracts` may not import `sim-runtime`, so a contracts-owned validator could not reference the product's own slice ceiling. Sim-runtime placement also keeps the change out of the package every other product package depends on. `contracts` still changes in Task 3, but only to add a request id and a response variant.
3. **The supported range is anchored on constants that already exist**, not invented: `ticks ∈ [0, MAX_SLICE_TICKS]` (2000, `speed.ts:29`, documented as the per-message UI-responsiveness ceiling) and `maxTicks ∈ [1, 100_000]` (the default at `session.ts:418` and `client.ts:44`). Neither is a population or biological cap, so the "no runtime-safety shortcut" invariant holds without argument. A rejected out-of-range count is a *request* bound, not a simulation bound.
4. **A rejected command returns `ERROR` plus, when a universe exists, a `SNAPSHOT` of the unchanged world.** The snapshot mutates nothing — §5's prohibition is on mutating simulation, decision, analysis, checkpoint, or request state, and this reports that state unaltered — and it releases `advanceDebt` so a rejected command cannot freeze the product.

   **This is a new bounded settlement rule, not an existing precedent.** Today `RESOLVE_EVENT_DECISION` emits acknowledgement + snapshot on *success*; its *failure* path emits `ERROR` alone. There is no existing precedent for "error plus a snapshot", and the resemblance to the success shape is exactly why it must be justified rather than assumed: without it, a rejected fire-and-forget advance leaves Explorer's `advanceDebt` permanently set and the simulation frozen.

   **The emitted snapshot must be proven state-equivalent, not merely tick-equal.** The regression asserts all three of: no tick advance, no biological mutation (organism set, population, and metrics unchanged), and no decision/analysis mutation (`pendingDecision` and analysis record count unchanged). A tick-only assertion would pass while the snapshot carried a mutated world, which is the failure this rule exists to prevent.
5. **`CHECKPOINT_LOADED` carries `requestId` and `snapshot`, and no new metadata field.** `requestId` is what proves which request completed; the carried snapshot's `tick` already proves where the world landed. Reusing `worldId` as restore proof was considered and rejected: `session.ts:64-72` documents it as presentation identity explicitly outside every reproducibility claim, and giving it a second meaning would contradict that documentation.
6. **New unit is `runtime-boundary`, placed in `ci-sim-c`.** `ci-sim-a` is the critical path at 278s; `ci-sim-c` is the shortest simulation shard at 184s. Per `AGENTS.md` the fix for an over-long shard is to move units, not add runners, so the new unit goes where there is slack. The unit is `deterministic`, `blocking`, and `mergeGate: true`; AC3–AC8 are **not** downgraded to evidence class for CI latency. `baselineSeconds` is seeded with a placeholder and must be replaced with the measured value from the first representative run; if that run shows `ci-sim-c` materially exceeding the existing critical-path shard (`ci-sim-a`, 278s), rebalance the shards and re-run `pnpm validation:check` rather than letting the new shard become the new long pole.

## Implementation order constraint

The Owner accepted the task numbering but constrained the order in which work lands:

> Establish the injectable transport seam before, or in the same implementation unit as, the client-side checkpoint-correlation tests that depend on it. Do not land request-correlation behavior with an effectively untestable client boundary.

Therefore, although Task 4 is numbered before Task 5, **the seam is extracted and committed first**. The execution order is:

```
Task 1 -> Task 2 -> Task 3 -> Task 3a (seam) -> Task 4 -> Task 5 -> Task 6
```

The seam-only commit changes `client.ts`'s constructor to accept an optional `WorkerFactory` and adds the `WorkerLike` interface, with **no** settlement, timeout, or correlation behaviour change. It is independently green on its own and is provably behaviour-neutral: `App.tsx:477` constructs `WorkerRuntimeClient` with no argument and must compile and behave unchanged. Task 4 then has a real seam to test against, and Task 5 completes the settlement work on top of an already-proven seam.

---

### Task 1: Register the validation unit and close the unknown-tag hole

The motivating defect. An unsupported tag currently returns `undefined` from `handle`, which `worker.ts:10` iterates, throwing outside the try/catch and killing the worker. This task makes `handle` total and rejects unknown tags with a structured failure, and registers the unit that will carry every test in this plan.

**Files:**
- Create: `tools/validation/runtime-boundary.ts`
- Create: `packages/sim-runtime/src/command-validation.ts`
- Modify: `package.json` (add `test:runtime-boundary` script)
- Modify: `tools/validation/manifest.ts` (`UNITS` entry, `GROUPS.simulation`, `GROUPS["ci-sim-c"]`)
- Modify: `packages/sim-runtime/src/session.ts:719-748` (guard + `default:` case)

**Interfaces:**
- Consumes: nothing. This task is the root.
- Produces: `validateRuntimeCommand(input: unknown): CommandValidation` from `packages/sim-runtime/src/command-validation.ts`, where

  ```ts
  export type CommandValidation =
    | { readonly ok: true; readonly command: RuntimeCommand }
    | { readonly ok: false; readonly message: string };
  ```

  Also produced: the validation unit id `runtime-boundary`, used by every later task.

- [ ] **Step 1: Add the script to `package.json`**

  Add alongside the other `test:*` entries:

  ```json
  "test:runtime-boundary": "tsx tools/validation/runtime-boundary.ts"
  ```

- [ ] **Step 2: Write the failing test**

  Create `tools/validation/runtime-boundary.ts` with this first test. Note it calls `handle` **directly**, not through a worker, so it is a plain Node test.

  ```ts
  import assert from "node:assert/strict";
  import { UniverseSession } from "@digital-evolution/sim-runtime";

  // An unsupported tag must produce a structured failure, not undefined.
  // Before the fix, handle() falls out of its switch and returns undefined,
  // which worker.ts then iterates over, throwing outside the try/catch.
  const session = new UniverseSession();
  const responses = session.handle({ type: "TOTALLY_BOGUS" } as never);
  assert.ok(Array.isArray(responses), "handle returns an array for an unknown tag");
  assert.equal(responses.length, 1, "unknown tag yields exactly one response");
  assert.equal(responses[0]!.type, "ERROR", "unknown tag is a structured ERROR");
  assert.match(
    (responses[0] as { message: string }).message,
    /unsupported command tag/i,
    "rejection names the reason",
  );
  ```

- [ ] **Step 3: Run it to verify it fails**

  Run: `pnpm test:runtime-boundary`
  Expected: FAIL — `handle` returns `undefined`, so `Array.isArray(responses)` is false. (If it throws instead, that is the same defect seen from the other side and is an acceptable RED.)

- [ ] **Step 4: Create `command-validation.ts`**

  Create `packages/sim-runtime/src/command-validation.ts`. One exported function plus its result type; export nothing else.

  ```ts
  import type { RuntimeCommand } from "@digital-evolution/contracts";
  import { MAX_SLICE_TICKS } from "./speed";

  /** Upper bound for RUN_TO_NEXT_EVENT. The existing default at session.ts:418
   *  and client.ts:44; not a biological cap. */
  export const MAX_EVENT_SCAN_TICKS = 100_000;

  export type CommandValidation =
    | { readonly ok: true; readonly command: RuntimeCommand }
    | { readonly ok: false; readonly message: string };
  ```

  The body must implement, in this order:

  1. Reject non-object input: `if (typeof input !== "object" || input === null) return reject("malformed command payload")`.
  2. Read `type` off the object as `unknown`. If it is not a string, reject with `"malformed command payload"`.
  3. Switch on `type`. For each of the eight supported tags, check the fields that tag requires and return `{ok: true, command: input as RuntimeCommand}`. For anything else, return `{ok: false, message: \`unsupported command tag: ${JSON.stringify(type)}\`}`.
  4. Numeric rule for `ADVANCE_TICKS.ticks` — must satisfy `Number.isSafeInteger(ticks) && ticks >= 0 && ticks <= MAX_SLICE_TICKS`. On failure reject with a message naming the field, the received value, the reason, and the supported range, e.g. `` `ADVANCE_TICKS.ticks: ${String(ticks)} is not an integer in [0, ${MAX_SLICE_TICKS}]` ``.
  5. Numeric rule for `RUN_TO_NEXT_EVENT.maxTicks` — **optional**. Absent means the session's own `100_000` default applies and is already well-defined, so absence is accepted. Present means `Number.isSafeInteger(maxTicks) && maxTicks >= 1 && maxTicks <= MAX_EVENT_SCAN_TICKS`.
  6. Presence rule for the remaining tags: `CREATE_UNIVERSE` requires an object `config`; `APPLY_INTERVENTION` requires `intervention` to be one of `"global" | "droughtA" | "droughtB"`; `RESOLVE_EVENT_DECISION` requires string `opportunityId` and `choiceId`; `LOAD_CHECKPOINT` requires an object `checkpoint` (its *contents* are A3.3's `validateCheckpoint` concern — do not duplicate it); `REQUEST_CHECKPOINT` and `REQUEST_EXPORT` require a string `requestId`; `CREATE_CONTROL_FORK` and `ACKNOWLEDGE_AFTERMATH` require nothing.

  Do not validate `LOAD_CHECKPOINT.checkpoint` beyond "is an object". Deep checkpoint validation already exists at `session.ts:623` and duplicating it would create a second restore path, which §8 forbids.

- [ ] **Step 5: Wire the guard into `handle` and make the switch total**

  In `packages/sim-runtime/src/session.ts`, at the top of `handle`, inside the existing `try`, before the `switch`:

  ```ts
  const validation = validateRuntimeCommand(command);
  if (!validation.ok) {
    return [{ type: "ERROR", message: validation.message }];
  }
  command = validation.command;
  ```

  (`handle`'s parameter must become reassignable — widen it to `unknown` if the signature does not already permit it, and narrow from `validation.command` immediately.)

  Then add a `default:` arm to the switch so the function can never return `undefined` again even if the validator is later weakened:

  ```ts
  default:
    return [{ type: "ERROR", message: `unsupported command tag: ${JSON.stringify((command as { type: unknown }).type)}` }];
  ```

- [ ] **Step 6: Run it to verify it passes**

  Run: `pnpm test:runtime-boundary`
  Expected: PASS.

- [ ] **Step 7: Register the unit in the manifest**

  In `tools/validation/manifest.ts`, add to the `UNITS` array an entry shaped like its neighbours (`manifest.ts:182-193` is the reference), with `id: "runtime-boundary"`, `title: "Runtime command and transport boundary"`, `script: "test:runtime-boundary"`, `cls: "deterministic"`, `enforcement: "blocking"`, `mergeGate: true`, `domains: ["contracts", "sim-runtime"]`, `needs: []`, `parallelSafe: true`, `baselineSeconds: 2`, and a `claim` that states exactly what it proves, in the same voice as its neighbours:

  > Malformed, unknown, non-finite, negative, fractional-when-integer, and out-of-range runtime commands are rejected as structured failures before any simulation loop begins, no rejected command mutates simulation state, every worker request settles exactly once through a supported terminal outcome, and a checkpoint load completes only through its own request identity.

  `GROUPS` is a flat `readonly ValidationGroup[]` (`manifest.ts:726`), **not** an object keyed by group name. Append the string `"runtime-boundary"` to the `unitIds` array of the group whose `id` is `"simulation"` and to the `unitIds` array of the group whose `id` is `"ci-sim-c"` (currently `["niche", "ecology"]`, `manifest.ts:835-838`). It must appear in **exactly one** `ci-*` shard and **exactly one** of `fast` / `simulation` / `presentation`.

- [ ] **Step 8: Verify the architecture gate accepts the registration**

  Run: `pnpm validation:check`
  Expected: PASS. A failure naming `CI does not execute required unit: runtime-boundary` means the shard entry is missing; a failure naming the group means it is in zero or two groups.

- [ ] **Step 9: Commit**

  ```bash
  git add tools/validation/runtime-boundary.ts packages/sim-runtime/src/command-validation.ts \
          packages/sim-runtime/src/session.ts package.json tools/validation/manifest.ts
  git commit -m "feat(runtime): reject unknown command tags with a structured failure"
  ```

---

### Task 2: Numeric range policy, proved before any loop

Replaces silent coercion with deterministic rejection. `advance` currently computes `Math.max(0, Math.floor(ticks))` at `session.ts:403`, which turns `NaN` into `NaN` and `Infinity` into `Infinity`; the loop at `session.ts:408` then either never runs or runs unboundedly.

**Files:**
- Modify: `tools/validation/runtime-boundary.ts`
- Modify: `packages/sim-runtime/src/command-validation.ts` (already carries the rules from Task 1; this task proves them)

**Interfaces:**
- Consumes: `validateRuntimeCommand` and unit `runtime-boundary` from Task 1.
- Produces: nothing new. This task completes the numeric half of the validator's contract.

- [ ] **Step 1: Write the failing tests**

  Append to `tools/validation/runtime-boundary.ts`. These assert the *command* boundary, which is where the handoff places validation. They deliberately do not assert anything about a direct `session.advance(n)` call — that is a different boundary and is out of scope.

  ```ts
  // A helper for the numeric table, so each row is one case.
  const rejects = (input: unknown, why: string) => {
    const result = validateRuntimeCommand(input);
    assert.equal(result.ok, false, `must reject: ${why}`);
  };

  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    rejects({ type: "ADVANCE_TICKS", ticks: bad }, `ticks ${String(bad)}`);
  }
  rejects({ type: "ADVANCE_TICKS", ticks: -1 }, "negative ticks");
  rejects({ type: "ADVANCE_TICKS", ticks: 1.5 }, "fractional ticks");
  rejects({ type: "ADVANCE_TICKS", ticks: MAX_SLICE_TICKS + 1 }, "ticks above the supported range");
  rejects({ type: "ADVANCE_TICKS" }, "absent ticks");

  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0, 2.5, MAX_EVENT_SCAN_TICKS + 1]) {
    rejects({ type: "RUN_TO_NEXT_EVENT", maxTicks: bad }, `maxTicks ${String(bad)}`);
  }
  // maxTicks is optional: absent takes the session's documented default.
  assert.equal(validateRuntimeCommand({ type: "RUN_TO_NEXT_EVENT" }).ok, true, "absent maxTicks is accepted");
  ```

  Then the mutation-sensitivity pair, which is the part that makes this task's evidence real rather than decorative:

  ```ts
  // A rejected command must not mutate anything, and must not wedge the
  // product's time controls. App.tsx clears advanceDebt only inside subscribe,
  // so a rejection that returns no SNAPSHOT would freeze the simulation.
  //
  // The emitted snapshot must be STATE-EQUIVALENT, not merely tick-equal: a
  // tick-only assertion would pass while the snapshot carried a mutated world.
  // Three dimensions are asserted separately, because each is a distinct way
  // this rule could be broken while the others still hold.
  const live = new UniverseSession();
  live.handle({ type: "CREATE_UNIVERSE", config: testConfig() });

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

  const beforeTick = live.snapshot().tick;
  const beforeBiology = biological(live.snapshot());
  const beforeInterpretation = interpretive(live.snapshot());

  const rejected = live.handle({ type: "ADVANCE_TICKS", ticks: Number.POSITIVE_INFINITY });
  assert.equal(rejected[0]!.type, "ERROR", "Infinity advance is refused");
  assert.equal(live.snapshot().tick, beforeTick, "a refused advance does not advance the tick");
  assert.equal(biological(live.snapshot()), beforeBiology, "a refused advance mutates no biology");
  assert.equal(interpretive(live.snapshot()), beforeInterpretation, "a refused advance mutates no decision or analysis state");

  // The snapshot that releases backpressure must itself be the unchanged world.
  const echoed = rejected.find((r) => r.type === "SNAPSHOT");
  assert.ok(echoed, "a refused command still emits a snapshot so backpressure releases");
  assert.equal((echoed as { snapshot: ReturnType<UniverseSession["snapshot"]> }).snapshot.tick, beforeTick,
    "the released snapshot is at the unchanged tick");
  assert.equal(biological((echoed as { snapshot: ReturnType<UniverseSession["snapshot"]> }).snapshot), beforeBiology,
    "the released snapshot carries unmutated biology");
  ```

  Import `MAX_SLICE_TICKS` from `@digital-evolution/sim-runtime` and `MAX_EVENT_SCAN_TICKS` from the validator module. Reuse an existing `testConfig()` helper if the repository already has one for `CREATE_UNIVERSE`; otherwise build a minimal valid `EngineConfig` and keep it in this file.

- [ ] **Step 2: Run it to verify it fails**

  Run: `pnpm test:runtime-boundary`
  Expected: FAIL on the `Infinity` case — with no numeric rule, `advance(Infinity)` enters the loop and either runs until an event fires or the assertion on `tick` fails. If the run appears to hang, that is the unbounded loop reproducing live; interrupt it, and treat the hang as the RED.

- [ ] **Step 3: Implement the rejection response shape**

  In `session.ts`, the guard added in Task 1 must return the `ERROR` **and** a snapshot of the unchanged world when a universe exists. Implement a private helper on `UniverseSession`:

  ```ts
  /** Current world, or null when no universe exists. Used to answer a rejected
   *  command without mutating anything. */
  #currentOrNull(): RenderSnapshot | null {
    try { return this.snapshot(); } catch { return null; }
  }
  ```

  and have the rejection branch return:

  ```ts
  if (!validation.ok) {
    const current = this.#currentOrNull();
    return current
      ? [{ type: "ERROR", message: validation.message }, { type: "SNAPSHOT", snapshot: current }]
      : [{ type: "ERROR", message: validation.message }];
  }
  ```

- [ ] **Step 4: Run it to verify it passes**

  Run: `pnpm test:runtime-boundary`
  Expected: PASS.

- [ ] **Step 5: Prove the assertions bite**

  Temporarily widen the numeric rule in `command-validation.ts` to accept any finite number (`Number.isFinite(ticks)` instead of the integer-and-range rule), run `pnpm test:runtime-boundary`, and confirm the `NaN`, `Infinity`, negative, fractional, and out-of-range cases each fail. Then restore the rule and confirm the suite is green again. Record which assertion caught which widening; that mapping is the evidence for AC1 and AC2.

  Do not commit the widened rule. If the restore is uncertain, `git checkout -- packages/sim-runtime/src/command-validation.ts` and re-run.

- [ ] **Step 6: Confirm no existing suite regressed**

  Run: `pnpm test:time-controls && pnpm test:aftermath && pnpm test:flows`
  Expected: all PASS.

  These are the suites that call `session.advance(...)` and `session.handle(...)` directly with large counts (`120_000`, `200_000`, `30_000`) and must be unaffected, because validation sits at the command boundary and those calls never cross it. **If any of them fails, stop** — that means the guard has been placed somewhere it does not belong.

- [ ] **Step 7: Commit**

  ```bash
  git add tools/validation/runtime-boundary.ts packages/sim-runtime/src/command-validation.ts \
          packages/sim-runtime/src/session.ts
  git commit -m "feat(runtime): reject non-finite, negative, fractional and out-of-range tick counts"
  ```

---

### Task 3: Give `LOAD_CHECKPOINT` a request identity

The contract change. `RuntimeCommand`'s `LOAD_CHECKPOINT` variant has no `requestId` field at all (`contracts/src/index.ts:2637`), so there is currently nothing to correlate on. Issue #54 item 5 names the mechanism: a request id plus a distinct response carrying it.

**Files:**
- Modify: `packages/contracts/src/index.ts:2637` (`LOAD_CHECKPOINT` gains `requestId`) and the `RuntimeResponse` union (add `CHECKPOINT_LOADED`)
- Modify: `packages/sim-runtime/src/session.ts:739` (the `LOAD_CHECKPOINT` case)
- Modify: `tools/validation/runtime-boundary.ts`

**Interfaces:**
- Consumes: `validateRuntimeCommand` (Task 1) — note Step 4 of Task 1 listed `LOAD_CHECKPOINT` as requiring only an object `checkpoint`; that rule must be tightened here to also require a string `requestId`.
- Produces: response variant `{ type: "CHECKPOINT_LOADED"; requestId: string; snapshot: RenderSnapshot }`. Task 4 consumes it.

- [ ] **Step 1: Write the failing test**

  ```ts
  const s = new UniverseSession();
  s.handle({ type: "CREATE_UNIVERSE", config: testConfig() });
  const live = s.snapshot().tick;
  const checkpoint = s.checkpoint();
  const loaded = s.handle({ type: "LOAD_CHECKPOINT", checkpoint, requestId: "load-7" });
  const correlated = loaded.find((r) => r.type === "CHECKPOINT_LOADED");
  assert.ok(correlated, "load returns a correlated response");
  assert.equal((correlated as { requestId: string }).requestId, "load-7", "response carries the request id");
  assert.ok(live >= 0, "sanity");
  ```

  Also assert a load with no `requestId` is rejected by the validator, and that the restore still went through the canonical path:

  ```ts
  assert.equal(validateRuntimeCommand({ type: "LOAD_CHECKPOINT", checkpoint }).ok, false,
    "a load without a request id is refused at the boundary");
  ```

- [ ] **Step 2: Run it to verify it fails**

  Run: `pnpm test:runtime-boundary`
  Expected: FAIL — no `CHECKPOINT_LOADED` variant exists, and `load-7` is currently a type error.

- [ ] **Step 3: Change the contract**

  In `packages/contracts/src/index.ts`, give the command a required id:

  ```ts
  | { readonly type: "LOAD_CHECKPOINT"; readonly requestId: string; readonly checkpoint: SupportedUniverseCheckpoint }
  ```

  and add to the `RuntimeResponse` union:

  ```ts
  | { readonly type: "CHECKPOINT_LOADED"; readonly requestId: string; readonly snapshot: RenderSnapshot }
  ```

- [ ] **Step 4: Emit the correlated response from the session**

  In `session.ts`, replace the `LOAD_CHECKPOINT` case body. Keep the trailing `SNAPSHOT` so the render stream and `advanceDebt` behave exactly as they do today:

  ```ts
  case "LOAD_CHECKPOINT": {
    const snapshot = this.restore(command.checkpoint);
    return [
      { type: "CHECKPOINT_LOADED", requestId: command.requestId, snapshot },
      { type: "SNAPSHOT", snapshot },
    ];
  }
  ```

  `restore` is unchanged. A3.3's preflight and the A3.4 canonical validation still run inside it, in the same order, for the same reason: §8 forbids a second restore path.

- [ ] **Step 5: Tighten the validator's `LOAD_CHECKPOINT` rule**

  In `command-validation.ts`, `LOAD_CHECKPOINT` now requires an object `checkpoint` **and** a string `requestId`.

- [ ] **Step 6: Run it to verify it passes**

  Run: `pnpm test:runtime-boundary`
  Expected: PASS.

- [ ] **Step 7: Confirm the restore path is still canonical**

  Run: `pnpm test:migration && pnpm test:flows`
  Expected: PASS. These carry the migration rule table and the canonical ordering assertions; if `restore` had been bypassed or reordered, they fail.

- [ ] **Step 8: Commit**

  ```bash
  git add packages/contracts/src/index.ts packages/sim-runtime/src/session.ts \
          packages/sim-runtime/src/command-validation.ts tools/validation/runtime-boundary.ts
  git commit -m "feat(contracts): correlate checkpoint load with a request id"
  ```

---

### Task 3a: Extract the transport seam (behaviour-neutral)

Ordered here by the *Implementation order constraint*, not by the original numbering. This is a prerequisite of Task 4's evidence and carries **no** settlement, timeout, or correlation change. Its only job is to make `client.ts` drivable from Node.

**Files:**
- Modify: `packages/sim-runtime/src/client.ts:28-39` (constructor)

**Interfaces:**
- Consumes: nothing.
- Produces:

  ```ts
  /** The slice of Worker the client actually uses. Lets a test drive the
   *  transport without a browser crash harness (issue #54 item 4). */
  export interface WorkerLike {
    postMessage(message: unknown): void;
    terminate(): void;
    addEventListener(type: "message" | "error" | "messageerror", listener: (event: never) => void): void;
  }

  export type WorkerFactory = () => WorkerLike;
  ```

- [ ] **Step 1: Write the seam test**

  In `tools/validation/runtime-boundary.ts`, add a `FakeWorker` implementing `WorkerLike` — it records posted messages and lets a test push a synthetic `message`, `error`, or `messageerror` — and assert the seam is wired and behaviour-neutral:

  ```ts
  // The injected transport is actually used, and the default path is unchanged.
  const fake = new FakeWorker();
  const client = new WorkerRuntimeClient(() => fake);
  client.advance(5);
  assert.deepEqual(fake.posted, [{ type: "ADVANCE_TICKS", ticks: 5 }], "commands reach the injected transport");
  assert.equal(client instanceof WorkerRuntimeClient, true, "injection does not change the type");
  // No-argument construction must still compile and default to a real Worker.
  // Exercised by typecheck (App.tsx:477 constructs it with no argument) and by
  // the browser lane; there is deliberately no runtime instantiation here,
  // because Node has no Worker global.
  ```

- [ ] **Step 2: Run it to verify it fails**

  Run: `pnpm test:runtime-boundary`
  Expected: FAIL — `WorkerRuntimeClient`'s constructor takes no argument, so the factory is ignored and `new Worker` throws in Node.

- [ ] **Step 3: Add the seam**

  Add `WorkerLike` and `WorkerFactory` to `client.ts`, and change the constructor to accept an optional factory, defaulting to today's inline construction:

  ```ts
  constructor(factory?: WorkerFactory) {
    this.#worker = factory?.() ?? new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "digital-evolution-sim" });
    this.#register();
  }
  ```

  `#register()` attaches the existing `message` and `error` listeners only — `messageerror` arrives in Task 5, so that this commit's diff is confined to the seam.

- [ ] **Step 4: Run it to verify it passes, and that the world is unchanged**

  Run: `pnpm test:runtime-boundary`
  Expected: PASS.

  Run: `pnpm typecheck`
  Expected: PASS. This is the proof that the seam is behaviour-neutral at the call site: `App.tsx:477` constructs `new WorkerRuntimeClient()` with no argument and still compiles.

- [ ] **Step 5: Confirm the only diff is the seam**

  Run: `git diff --stat`
  Expected: `client.ts` and `runtime-boundary.ts` only. If any settlement, timeout, correlation, or listener line changed, this commit has leaked Task 5's work into it — stop and split it.

- [ ] **Step 6: Commit**

  ```bash
  git add packages/sim-runtime/src/client.ts tools/validation/runtime-boundary.ts
  git commit -m "refactor(runtime): make the worker transport injectable"
  ```

---

### Task 4: Correlate the load by identity, and delete tick equality

`client.ts:118` currently resolves a load on `response.snapshot.tick === pendingLoad.expectedTick`, where `expectedTick` is the checkpoint's `createdTick`. Any live snapshot at that tick completes it — including a decision-gated advance, which `session.ts:402` returns at the *unchanged* tick. This task removes that inference entirely.

**Files:**
- Modify: `packages/sim-runtime/src/client.ts:52-76` (load request), `:115-121` (receive)
- Modify: `tools/validation/runtime-boundary.ts`

**Interfaces:**
- Consumes: `CHECKPOINT_LOADED` from Task 3.
- Produces: `WorkerRuntimeClient` with no tick-based completion logic.

- [ ] **Step 1: Write the failing test**

  `client.ts` has **no test seam and no test at all** today, so this test is unwritable until the seam exists. Per *Implementation order constraint* above, the seam was already extracted and committed as a standalone behaviour-neutral commit before this task began. It is present; this task proceeds against it.

  The test, once a seam exists:

  ```ts
  // A same-tick snapshot that is not the correlated response must not complete a load.
  const fake = new FakeWorker();
  const client = new WorkerRuntimeClient(() => fake);
  fake.respond({ type: "SNAPSHOT", snapshot: { ...worldAtTick, tick: checkpointCreatedTick } });
  // no settlement yet
  assert.equal(settled, false, "an unrelated same-tick snapshot does not complete the load");
  fake.respond({ type: "CHECKPOINT_LOADED", requestId: theLoadId, snapshot: restoredSnapshot });
  assert.equal(settled, true, "the correlated response completes the load");
  ```

  Plus a stale-snapshot case (a `CHECKPOINT_LOADED` whose `requestId` belongs to an earlier, already-settled load) and a superseded case (a second `loadCheckpoint` rejects the first with the existing `"Superseded by a newer restore request"` message).

- [ ] **Step 2: Run it to verify it fails**

  Run: `pnpm test:runtime-boundary`
  Expected: FAIL — with tick equality in place, the unrelated same-tick snapshot completes the load immediately.

- [ ] **Step 3: Route the load through the request map**

  In `client.ts`, delete `#pendingLoad` and its `expectedTick`. `loadCheckpoint` becomes an ordinary correlated request:

  ```ts
  loadCheckpoint(checkpoint: SupportedUniverseCheckpoint): Promise<RenderSnapshot> {
    if (this.#pendingLoadId !== null) this.#rejectPendingLoad(new Error("Superseded by a newer restore request"));
    return this.#request<RenderSnapshot>("LOAD_CHECKPOINT", { checkpoint });
  }
  ```

  Keep the supersession message byte-for-byte. It is existing behaviour at `client.ts:58` and is already deterministic; this task preserves and guards it rather than redesigning it.

  The load still needs its own bounded lifetime and its own rejection path distinct from ordinary requests, because `App.tsx:667-673` branches on the rejection *type*. `#request` must therefore accept a caller-supplied timeout and a way to mark the entry as a load. Give the pending entry an optional `kind: "load"` and set the load's timeout to the existing `LOAD_TIMEOUT_MS` (10s, `client.ts:26`) rather than the new general request timeout.

- [ ] **Step 4: Resolve only on the correlated response**

  In `#receive`, add a branch and **delete the tick comparison entirely**:

  ```ts
  if (response.type === "CHECKPOINT_LOADED") {
    const pending = this.#pending.get(response.requestId);
    if (!pending) return;           // stale or already-settled: not an error
    this.#pending.delete(response.requestId);
    pending.resolve(response.snapshot);
    return;
  }
  ```

  The `SNAPSHOT` branch must no longer reference any pending load. It goes back to notifying listeners only.

  Returning silently on an unknown `requestId` is deliberate: a `CHECKPOINT_LOADED` for an already-settled request is normal after supersession, not a failure.

- [ ] **Step 5: Run it to verify it passes**

  Run: `pnpm test:runtime-boundary`
  Expected: PASS.

- [ ] **Step 6: Prove the correlation assertions bite**

  Re-introduce tick equality — set `expectedTick` handling back so any `SNAPSHOT` at `checkpoint.createdTick` resolves — and confirm the same-tick and stale-snapshot tests fail while the success test still passes. Restore and re-run. This mapping is the evidence for AC6 and AC7.

- [ ] **Step 7: Commit**

  ```bash
  git add packages/sim-runtime/src/client.ts tools/validation/runtime-boundary.ts
  git commit -m "feat(runtime): complete checkpoint loads by request identity, not tick equality"
  ```

---

### Task 5: Injectable transport, bounded request lifetime, one fatal path

Prerequisite for Task 4's evidence, and the fix for issue #54 item 4. Today the four `#request` types have no timeout, `error` only logs (`client.ts:38`), and there is no `messageerror` listener at all — so a worker crash leaves every promise pending forever and never clears `#pending`.

**Files:**
- Modify: `packages/sim-runtime/src/client.ts:38` (`error` handler), `:107-113` (`#request`), `:93-105` (`destroy`, fatal path)
- Modify: `tools/validation/runtime-boundary.ts`

**Interfaces:**
- Consumes: `WorkerLike` and `WorkerFactory` from Task 3a (already merged), and unit `runtime-boundary` (Task 1).
- Produces: `REQUEST_TIMEOUT_MS` and one `#failAll(reason: Error)` private path shared by `error`, `messageerror`, and `destroy`.

- [ ] **Step 1: Write the failing tests**

  With a `FakeWorker` in the test file implementing `WorkerLike` and a queue of scripted responses, assert each of these separately, so a failure names the exact clause:

  - each of `requestCheckpoint`, `requestExport`, `resolveEventDecision`, `acknowledgeAftermath` **rejects** when the fake worker never answers, within the bounded lifetime (use a short injected timeout in the test rather than waiting the production value);
  - a synthetic `error` event rejects every outstanding request **and** leaves `#pending.size === 0`;
  - a synthetic `messageerror` event takes **the same** path as `error` — assert both produce an identical rejection reason prefix;
  - `destroy()` leaves `#pending.size === 0` and rejects everything outstanding;
  - after any of those, a later `postMessage` for an unknown `requestId` is ignored rather than throwing;
  - no promise is left unsettled after a fatal event — track settlement with a counter and assert it equals the number created.

- [ ] **Step 2: Run it to verify it fails**

  Run: `pnpm test:runtime-boundary`
  Expected: FAIL — there is no constructor parameter, no `messageerror` listener, and no per-request timer, so the timeout cases hang and the fatal cases leave the map populated. **Run with a timeout** (`timeout 120 pnpm test:runtime-boundary`) so a genuine hang is visible as a hang.

- [ ] **Step 3: Register the fatal listeners in one place**

  By this task the `WorkerLike` seam and its `WorkerFactory` constructor parameter are **already merged** (extracted as a standalone commit per *Implementation order constraint*); confirm they are present and do not re-add them. Add the `messageerror` listener and a private `#register()` that attaches `message`, `error`, and `messageerror` together, so the fatal path is registered in one place and cannot drift.

- [ ] **Step 4: Give every request a bounded lifetime**

  Add `const REQUEST_TIMEOUT_MS = 30_000;` beside the existing `LOAD_TIMEOUT_MS`, and give each `#pending` entry a `timer`. On expiry, delete the entry and reject with a message naming the request type. The load keeps `LOAD_TIMEOUT_MS`.

  30s is chosen to sit far above any observed worker turnaround while still being bounded. It is **implementation-owned** per §6 and is **not product-visible**: the four request types are awaited inside `App.tsx` handlers that already catch and set a status string, so a timeout surfaces as a failed save/export rather than a silent hang. Record the value and this reasoning in the PR body; if the Owner wants a different value or a visible message, that is a one-line change plus a wording decision.

- [ ] **Step 5: Build one fatal path**

  ```ts
  #failAll(reason: Error) {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(reason);
    }
    this.#pending.clear();
    this.#listeners.clear();
  }
  ```

  Wire `error` and `messageerror` to `#failAll(new Error("Simulation worker failed: " + reason))`, and rewrite `destroy()` to terminate the worker then call `#failAll(new Error("Runtime destroyed"))`.

  Clearing `#listeners` on a fatal worker is a behaviour change worth stating: a dead worker can never deliver another snapshot, so retaining listeners would leave the UI holding a subscription that can only ever be satisfied by a new client. The `App.tsx` effect re-creates the client if the runtime is replaced.

  Keep the distinct reason strings for `error` versus `messageerror` in the *log*, but route both through `#failAll` so the settlement path is provably one.

- [ ] **Step 6: Run it to verify it passes**

  Run: `timeout 180 pnpm test:runtime-boundary`
  Expected: PASS.

- [ ] **Step 7: Prove the settlement assertions bite**

  Remove the `messageerror` listener, run, and confirm the `messageerror` test fails while the `error` test still passes. Then remove the per-request timer and confirm the timeout tests fail. Restore both and confirm green. This mapping is the evidence for AC3, AC4, and AC5 — in particular it shows the `messageerror` assertion is not passing merely because `error` is also handled.

- [ ] **Step 8: Commit**

  ```bash
  git add packages/sim-runtime/src/client.ts tools/validation/runtime-boundary.ts
  git commit -m "feat(runtime): bounded request lifetime and one fatal worker path"
  ```

---

### Task 6: Full verification and the evidence package

**Files:**
- Modify: `projectStatus.md`, `projectContext.md` (status reconciliation, in the style of commit `0d117a0`)

**Interfaces:**
- Consumes: everything above.
- Produces: the handoff's §15 return package.

- [ ] **Step 1: Run the focused unit**

  Run: `pnpm test:runtime-boundary`
  Expected: PASS. Record the assertion count and the number of conditions it covers.

- [ ] **Step 2: Run the architecture gate**

  Run: `pnpm validation:check`
  Expected: PASS.

- [ ] **Step 3: Run the full repository contract**

  Run: `pnpm verify`
  Expected: PASS. This is the blocking contract and it is **not** a substitute for the handoff's named list, nor is the handoff's list a substitute for this. Run both.

  Per `AGENTS.md`, prefer CI for this: push the branch, open a PR, and read `gh pr checks`. A green CI run on the pushed head is the completion signal. A `client.ts`/`session.ts`/`contracts` diff routes on the `sim-runtime` and `contracts` domains, so expect `decisions`, `catalysts`, `flows`, `time-controls`, `niche`, `aftermath`, all five `dependency-*`, `browser-smoke`, and `mobile-ui` to be in scope. Do not treat that list as exhaustive — the manifest is authoritative.

- [ ] **Step 4: Run the browser evidence on CI**

  `pnpm verify:browser` needs a preview server and is best left to CI. Note for the record that `browser-smoke`'s existing restore assertion reads a tick off the DOM (`browser-smoke.ts:375-385`), so it **cannot** distinguish a correct load resolution from a wrong one landing the right tick. It is evidence for AC9 and explicitly **not** evidence for AC6, AC7, or AC8. Those rest on `runtime-boundary` alone. State this in the PR body rather than letting the browser pass imply more than it does.

- [ ] **Step 5: Assemble the mutation matrix**

  From the sensitivity runs in Tasks 2, 4, and 5, produce one table: mutation → which assertion caught it → which acceptance criterion it evidences. Every new assertion must appear in this table. An assertion that no mutation breaks is not evidence and must be deleted or rewritten.

- [ ] **Step 6: Write the return package**

  Per handoff §15: PR URL and exact baseline/final commit range; changed contract/module map; the final command-validation boundary and supported numeric/range policy; request lifecycle and exact-once settlement behaviour; fatal-worker and teardown behaviour; checkpoint request correlation and multiple-load semantics; focused tests and the full `pnpm verify` result; determinism/save-resume evidence actually exercised; residual gaps relevant to issue #54; and every deviation classified as implementation freedom, design-significant drift, evidence gap, or Owner decision.

  Confirm in the package that issue #33 remains closed/not planned and PR #21 remains closed/unmerged.

- [ ] **Step 7: Reconcile the status files**

  Update `projectStatus.md` and `projectContext.md` to record A7 as merged with what it establishes, matching the style of `0d117a0`. Do not restate the Owner's parallel-work authorization, and do not reinterpret it.

- [ ] **Step 8: Stop**

  Per §14, stop and return for Design Partner acceptance. Do not continue into Tranche B or issue #54 item 6.

---

## Provenance of the findings this plan rests on

Every load-bearing claim below was re-verified first-hand against `2535960` rather than taken on report. An executor should be able to re-run any of them cheaply.

| Claim | Verified at | How |
|---|---|---|
| `handle` has no `default:` arm, so an unknown tag returns `undefined` | `session.ts:719-748` | `grep -c 'default:'` over the file returns `0`; a replica switch returns `undefined` for an unmatched tag |
| `worker.ts` then throws outside the try/catch | `worker.ts:9-10` | `for (const x of undefined)` throws `is not iterable`; the throw is in `worker.ts`, not inside `handle`'s `catch` |
| `advance` silently coerces rather than rejecting | `session.ts:403` | `Math.max(0, Math.floor(NaN))` is `NaN`; `Math.max(0, Math.floor(Infinity))` is `Infinity`; `-5 → 0`; `1.5 → 1` |
| A decision-gated advance emits a snapshot at the **unchanged** tick | `session.ts:402` | `if (this.#impactPaused()) return this.snapshot();` — this is the wrong-completion vector for load correlation |
| `LOAD_CHECKPOINT` has no `requestId` field at all | `contracts/src/index.ts:2637` | `\| { readonly type: "LOAD_CHECKPOINT"; readonly checkpoint: SupportedUniverseCheckpoint }` |
| Tick-equality correlation, and the load command carries no id | `client.ts:63, 74, 118` | `expectedTick: checkpoint.createdTick`; `this.command({type:"LOAD_CHECKPOINT", checkpoint})`; `response.snapshot.tick === pendingLoad.expectedTick` |
| Four request types have no timeout; only the load does | `client.ts:26, 72, 107-113` | the sole `setTimeout` guards `#pendingLoad`; `#pending` entries carry no timer |
| `error` only logs, and there is no `messageerror` listener | `client.ts:38` | handler body is `console.error(...)`; repo-wide `messageerror` appears only in frozen `legacy/prototype/*.html` |
| `client.ts` has no test and no seam | repo-wide | `WorkerRuntimeClient` is imported only by `index.ts` and `App.tsx:6,477`; zero matches under `tools/` |
| The only direct `handle()` call sites bypass `worker.ts` | `aftermath-runtime.ts:337, 343` | the only two `.handle(` calls outside `worker.ts:9` |
| `sliceFor` cannot emit a non-integer for finite input | `speed.ts:45-46` | `Math.floor` → `Math.min(2000, ·)` → `Math.max(0, ·)`; 160 probed cases, 0 violations except `NaN` `elapsedMs`, which `App.tsx:567`'s `>0` guard drops |
| Direct `session.advance(n)` calls with large counts exist and must not break | ~30 sites in `tools/validation/` | `advance(120_000)`, `advance(200_000)`, `runToNextEvent(5_000)`; none crosses the command boundary, so command-level validation cannot affect them |
| A new blocking unit needs manifest registration **and** a shard | `architecture.ts:102-105, 302-304` | `requiredCiUnits()` filters on `enforcement !== "manual"`, and every id must appear in a shard a workflow references |
| `ci-sim-a` is the critical path, `ci-sim-c` has the slack | `pnpm validation:plan` | 278s vs 184s |

---

## Self-review

**Spec coverage.** §5 command validation → Task 1 (tags, malformed payloads) and Task 2 (numeric rules, ranges, no mutation, validation before the loop). Transport seam required by issue #54 item 4's "injectable enough to test failure behavior without a browser crash harness" → Task 3a. §6 exact-once settlement → Task 5. §6 fatal path → Task 5. §6 bounded lifetime → Task 5. §6 teardown → Task 5. §7 request identity → Task 3. §7 removal of tick equality → Task 4. §7 multiple-load semantics → Task 4 (supersession preserved and guarded). §7 restored metadata → Decision 5, carried in Task 3. §8 no biology change → Global Constraints; enforced by touching no file under `packages/sim-core`. §9 invariants → Global Constraints. AC1–AC2 → Tasks 1–2. AC3–AC5 → Task 5 (seam in Task 3a). AC6–AC8 → Tasks 3–4. AC9 → Task 3 Step 7 and Task 6 Step 4. AC10 → Task 2 Step 1 and Task 4. AC11 → Global Constraints; no renderer or presentation file is modified. AC12 → Task 6 Step 2. Validation expectations → Tasks 1, 2, 3a, 4, 5, 6. §15 return package → Task 6 Step 6. §14 stop → Task 6 Step 8. §13 non-goals → Global Constraints.

**Step scan.** Every step names a file, a signature, a command, or an expected output. No step says "add appropriate validation."

**Ordering defect found and corrected during self-review.** The plan originally ordered Task 4 (client correlation) before Task 5 (transport seam). Task 4's evidence requires driving `client.ts` without a real `Worker`, and no seam existed — so Task 4's tests were unwritable as ordered. The seam is now its own unit, Task 3a, landing before Task 4, and Task 5 assumes it is already present. The Owner independently imposed the same constraint, so the correction and the instruction agree.

**Type consistency.** `validateRuntimeCommand` / `CommandValidation` / `MAX_EVENT_SCAN_TICKS` are defined once in Task 1 and consumed by name in Tasks 2, 3, and 6. `CHECKPOINT_LOADED` is introduced in Task 3 and consumed in Task 4. `WorkerLike` / `WorkerFactory` are introduced in Task 5 and consumed by Task 4's `FakeWorker`. `runtime-boundary` is the unit id everywhere.

**Review Focus coverage.** All five lines have an owning task and a named assertion: unknown tag → Task 1 Step 2; wedged time controls → Task 2 Step 1; unbounded loop → Task 2 Step 2; worker death mid-request → Task 5 Step 1; wrong-world restore → Task 4 Step 1.

**Proportion.** The handoff is a 16-section spec. This plan is five implementation tasks plus verification, with bodies given only for the validator's rule set, the fatal path, and the correlated response — the three places where the signature and the tests leave a genuine choice. Everything else is a signature, a test name, or a command.

**Known gap in this plan.** The `restart`-uniqueness of request ids is not addressed: `#seq` makes ids unique within a client instance (`client.ts:108`), but not across a client restart. The handoff does not require it and no in-flight request can outlive its client, so it is recorded as a residual gap in Task 6 rather than solved here.
