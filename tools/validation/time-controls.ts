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
import { createHash } from "node:crypto";
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
    records: s.analysis.records.length,
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
    // Slice 1 re-pin (delay pattern): the second record (dormancy-recovered)
    // now lands @28363 instead of inside 25k, so the drive extends to 30k.
    // Probe-verified both chunkings see [6777, 28363]; the claim —
    // record ticks are chunk-independent — is unchanged.
    while (guard++ < 1500) {
      const snap = session.advance(chunk);
      if (snap.pendingDecision) {
        session.resolveEventDecision(snap.pendingDecision.opportunityId, "keep-watching");
      }
      if (snap.tick > 30000 && !session.advance(0).pendingDecision) break;
    }
    const done = session.advance(0);
    return done.analysis.records.map((r) => r.tick);
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

// --- Exact checkpoint-digest equivalence (Workstream B) ----------------------
// The supported reproducibility contract promises identical deterministic
// results for same engine/config/seed/commands regardless of presentation
// chunking. Aggregates (tick/population/records) are too shallow to prove it:
// compare the full UniverseCheckpoint serialization digest, which covers
// organism state, positions, traits, energy, resource fields, Metabolic
// Waste, RNG continuation, analysis, and decisions. Then prove continuation:
// same digests after further ticks, and a restored checkpoint rejoins the
// identical trajectory.
function digest(session: UniverseSession): string {
  return createHash("sha256").update(JSON.stringify(session.checkpoint())).digest("hex");
}
function drive(session: UniverseSession, chunk: number, targetTick: number): void {
  // Cap the final chunk so both schedules land on exactly targetTick:
  // post-gate overshoot would otherwise differ by chunk size while the
  // biology stays identical. Gate resolutions advance zero ticks.
  let guard = 0;
  while (guard++ < 100000) {
    const t = session.advance(0).tick;
    if (t >= targetTick) break;
    const snap = session.advance(Math.min(chunk, targetTick - t));
    if (snap.pendingDecision) {
      session.resolveEventDecision(snap.pendingDecision.opportunityId, "keep-watching");
    }
  }
}
{
  const seed = 24681357;
  const T = 2000;
  const a = fresh(seed);
  drive(a, 25, T);
  const b = fresh(seed);
  drive(b, 125, T);
  const tickA = a.advance(0).tick;
  const tickB = b.advance(0).tick;
  assert.equal(tickA, tickB, "both schedules reach the same tick");
  assert.ok(tickA >= T, `reached common tick ${tickA}`);
  const dA = digest(a);
  const dB = digest(b);
  assert.equal(dB, dA, "full checkpoint digests match across chunkings (state, RNG, waste, analysis)");
  console.log(`checkpoint digest @tick ${tickA}: PASS (sha256 ${dA.slice(0, 12)}…, 25- vs 125-tick schedules)`);
  // Continuation: further ticks keep the trajectories identical.
  drive(a, 25, tickA + 500);
  drive(b, 125, tickB + 500);
  const tickA2 = a.advance(0).tick;
  assert.equal(tickA2, b.advance(0).tick, "continuation reaches the same tick");
  assert.equal(digest(b), digest(a), "digests match after continuation (future trajectory + RNG continuation)");
  console.log(`continuation equivalence: PASS (+500 ticks to ${tickA2}, digests still match)`);
  console.log("restore fidelity: PASS (restored checkpoint rejoins identical trajectory)");
  // Restore fidelity: a checkpoint restored into a fresh session rejoins the
  // identical trajectory (checkpoint round-trip preserves RNG + all state).
  const c = fresh(seed + 1);
  c.restore(a.checkpoint() as Parameters<UniverseSession["restore"]>[0]);
  drive(c, 125, tickA2);
  assert.equal(c.advance(0).tick, tickA2, "restored session reaches the same tick");
  assert.equal(digest(c), digest(a), "restored session matches live trajectory exactly");
}

console.log(`time-controls validation: PASS (engine ${ENGINE_VERSION})`);
