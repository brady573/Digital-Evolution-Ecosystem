/**
 * Issue #37 time-control validation.
 *
 * Proves the speed scheduler against the real engine without touching biology:
 * - policy unit behavior (distinct rates, Max cap, accumulator math);
 * - chunk-equivalence: one advance(1000) vs many small advances reach the
 *   identical deterministic state (tick, population, dormancy, records);
 * - pause/decision gating holds at high-speed chunk sizes (mid-chunk break);
 * - observation timing is tick-deterministic, not frame-dependent: two runs
 *   with different chunkings observe the same records at the same ticks.
 *
 * Run: pnpm test:time-controls
 */
import assert from "node:assert/strict";
import type { EngineConfig, RenderSnapshot } from "../../packages/contracts/src/index.ts";
import { ENGINE_VERSION } from "../../packages/sim-core/src/index.ts";
import { UniverseSession } from "../../packages/sim-runtime/src/session.ts";
import {
  MAX_SLICE_TICKS,
  TICKS_PER_SECOND,
  normalizeSpeedMode,
  sliceFor,
} from "../../packages/sim-runtime/src/speed.ts";

// --- Policy unit behavior (AC1-3) -------------------------------------------
assert.deepEqual(
  [TICKS_PER_SECOND[1], TICKS_PER_SECOND[10], TICKS_PER_SECOND[100], TICKS_PER_SECOND[500]],
  [60, 600, 6000, 60000],
  "1x/10x/100x/Max are distinct throughput targets",
);
assert.equal(normalizeSpeedMode(1), 1, "1x normalizes");
assert.equal(normalizeSpeedMode(500), 500, "Max normalizes");
assert.equal(normalizeSpeedMode(9999), 500, "overshoot clamps to Max");
{
  // One 60Hz frame at each mode: 1, 10, 100 ticks; Max capped per slice.
  const frame = 1000 / 60;
  assert.equal(sliceFor(1, frame, 0).ticks, 1, "1x yields ~1 tick/frame");
  assert.equal(sliceFor(10, frame, 0).ticks, 10, "10x yields ~10 ticks/frame");
  assert.equal(sliceFor(100, frame, 0).ticks, 100, "100x yields ~100 ticks/frame");
  assert.ok(sliceFor(500, frame, 0).ticks <= MAX_SLICE_TICKS, "Max slice capped");
  // Accumulator carries fractions across frames (no tick loss or duplication).
  let carry = 0;
  let total = 0;
  for (let i = 0; i < 600; i++) {
    const s = sliceFor(1, 16.5, carry);
    carry = s.carry;
    total += s.ticks;
  }
  assert.ok(Math.abs(total - 594) <= 2, `accumulator conserves ticks (got ${total}, want ~594)`);
}
console.log("speed policy: PASS (distinct rates, Max cap, accumulator conservation)");

// --- Session harness ---------------------------------------------------------
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

function stateOf(s: RenderSnapshot): string {
  return JSON.stringify({
    tick: s.tick,
    pop: s.population,
    dormant: s.dormantPopulation,
    records: (s.analysis.records as unknown[]).length,
    events: s.events.length,
  });
}

function fresh(seed: number): UniverseSession {
  const session = new UniverseSession();
  session.create(config(seed));
  return session;
}

// --- Chunk-equivalence determinism (AC6) --------------------------------------
{
  const seed = 24681357;
  const a = fresh(seed);
  a.advance(1000);
  const b = fresh(seed);
  for (let i = 0; i < 100; i++) b.advance(10);
  const c = fresh(seed);
  for (let i = 0; i < 1000; i++) c.advance(1);
  assert.equal(stateOf(b.advance(0)), stateOf(a.advance(0)), "10x10 chunking matches one chunk");
  assert.equal(stateOf(c.advance(0)), stateOf(a.advance(0)), "1x1000 chunking matches one chunk");
  console.log("chunk-equivalence: PASS (1x1000 == 100x10 == 1000x1 deterministic state)");
}

// --- High-speed gating (AC5): a pending decision stops a Max-sized chunk ----
{
  const session = fresh(24681357);
  let snap = session.advance(0);
  let guard = 0;
  while (!snap.pendingDecision && guard++ < 200) snap = session.advance(500);
  assert.ok(snap.pendingDecision, "a decision becomes pending within the scan");
  const tickAtGate = snap.tick;
  const after = session.advance(MAX_SLICE_TICKS);
  assert.equal(after.tick, tickAtGate, "Max-sized chunk cannot push through the gate");
  assert.ok(after.pendingDecision, "gate still held after Max-sized chunk");
  console.log(`high-speed gating: PASS (gate at tick ${tickAtGate} holds against ${MAX_SLICE_TICKS}-tick chunk)`);
}

// --- Observation tick-independence (AC7) ---------------------------------------
// Records carry their own simulation ticks; chunking only changes when the UI
// looks, never what it sees. Drive past gates with keep-watching (advances
// zero ticks per the decisions suite) so the comparison covers multiple
// records, then compare full record-tick sequences and final state.
{
  const seed = 24681357;
  const recordTicks = (chunk: number): number[] => {
    const session = fresh(seed);
    let guard = 0;
    while (guard++ < 1200) {
      const snap = session.advance(chunk);
      if (snap.pendingDecision) {
        session.resolveEventDecision(snap.pendingDecision.opportunityId, "keep-watching");
      }
      if (snap.tick > 25000 && !session.advance(0).pendingDecision) break;
    }
    const done = session.advance(0);
    return ((done.analysis.records as Array<{ tick: number }>).map((r) => r.tick));
  };
  const fine = recordTicks(25);
  const coarse = recordTicks(125);
  assert.ok(fine.length > 1, `need multiple records for a non-vacuous comparison (got ${fine.length})`);
  assert.deepEqual(coarse, fine, "record-tick sequences agree across chunkings");
  assert.deepEqual(coarse, fine, "record-tick sequences agree across chunkings");
  const a = fresh(seed);
  for (let i = 0; i < 40; i++) a.advance(25);
  const b = fresh(seed);
  for (let i = 0; i < 8; i++) b.advance(125);
  assert.equal(stateOf(b.advance(0)).split('"records"')[0], stateOf(a.advance(0)).split('"records"')[0], "final biological state agrees across chunkings");
  console.log(`observation timing: PASS (${fine.length} records, identical ticks across 25- vs 125-tick chunking)`);
}

console.log(`time-controls validation: PASS (engine ${ENGINE_VERSION})`);
