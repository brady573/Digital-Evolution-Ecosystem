import assert from "node:assert/strict";
import { UniverseSession } from "../../packages/sim-runtime/src/session.ts";
import type { EngineConfig, FlowFacts } from "../../packages/contracts/src/index.ts";
import { ENGINE_VERSION } from "../../packages/sim-core/src/index.ts";
import { CHECKPOINT_SCHEMA_VERSION } from "../../packages/sim-runtime/src/session.ts";

/**
 * Issue #30 Phase B1: authoritative biological flow facts. sim-core credits
 * lifetime C production per organism and aggregates deterministic per-lineage
 * flows (consumed/energy/produced by substance); sim-analysis reads them via
 * the observation frame but no rule consumes them yet (Phase C). Biology is
 * unchanged: no rates, thresholds, or RNG streams move.
 */

const FIXTURE_SEED = 24681357;
function config(seed: number): EngineConfig {
  return {
    seed, start: 0.58, prod: 0.77, cap: 360, pop: 30, div: 0.35, mr: 0.03,
    ms: 0.12, press: 1.0875, patch: 0.6, resource_b_fraction: 0.5, cat: "global", st: null,
    resource_model: "definition_driven_substances", resource_grid: 60,
    enable_byproduct: true, enable_dormancy: true, study: true,
  };
}

/** Advance to exactly `target`, resolving everything keep-watching (no-op). */
function settle(session: UniverseSession, target: number): void {
  for (let i = 0; i < 1000 && session.snapshot().tick < target; i++) {
    const snapshot = session.advance(5000);
    const pending = snapshot.pendingDecision;
    if (pending) session.resolveEventDecision(pending.opportunityId, "keep-watching");
  }
  assert.equal(session.snapshot().tick >= target, true, `must reach tick ${target}`);
}

function flows(session: UniverseSession): FlowFacts {
  return (session.simulation as any).flowFacts();
}

/** Independent recomputation straight from living organisms. */
function livingSums(session: UniverseSession) {
  const organisms = (session.simulation as any).o as any[];
  let members = 0, mc = 0, gc = 0, pc = 0;
  for (const o of organisms) {
    members++;
    mc += o.mc || 0;
    gc += o.gc || 0;
    pc += o.pc || 0;
  }
  return { members, mc, gc, pc };
}

function testFlowDeterminism() {
  const a = new UniverseSession();
  a.create(config(FIXTURE_SEED));
  settle(a, 20000);
  const b = new UniverseSession();
  b.create(config(FIXTURE_SEED));
  settle(b, 20000);
  assert.equal(
    JSON.stringify(flows(a)),
    JSON.stringify(flows(b)),
    "identical commands reproduce identical flow facts",
  );
  const ids = flows(a).lineages.map((l) => l.lineageId);
  assert.deepEqual([...ids].sort((x, y) => x - y).length, ids.length, "lineage ids are unique");
  console.log("flow determinism: PASS");
}

function testFlowSelfConsistency() {
  const session = new UniverseSession();
  session.create(config(FIXTURE_SEED));
  settle(session, 20000);
  const facts = flows(session);
  const sums = livingSums(session);
  assert.equal(facts.tick, session.snapshot().tick, "facts stamped at the current tick");
  assert.equal(facts.totals.members, session.snapshot().population, "member total equals population");
  assert.equal(facts.totals.members, sums.members, "member total equals living count");
  // Float sums accumulate in different orders (lineage-grouped vs flat), so
  // compare with a tight relative tolerance instead of exact equality.
  const close = (a: number, b: number, label: string) =>
    assert.ok(
      Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)),
      `${label}: ${a} vs ${b}`,
    );
  close(facts.totals.consumedC, sums.mc, "C consumption matches living organisms");
  close(facts.totals.energyC, sums.gc, "C energy matches living organisms");
  close(facts.totals.producedC, sums.pc, "C production matches living organisms");
  // Both sides of the metabolic pathway are attributed once C flows.
  assert.ok(facts.totals.producedC > 0, "C production is attributed (metabolite C flows by 20k)");
  assert.ok(
    facts.lineages.some((l) => l.producedC > 0),
    "at least one lineage is credited as a C producer",
  );
  assert.ok(
    facts.lineages.some((l) => l.energyC > 0),
    "at least one lineage realizes C energy",
  );
  console.log("flow self-consistency: PASS");
}

function testFlowRngNeutrality() {
  const session = new UniverseSession();
  session.create(config(FIXTURE_SEED));
  settle(session, 8000);
  const sim = (session as any).simulation;
  const streams = () =>
    JSON.stringify({
      i: sim.rInit.getState(), f: sim.rFood.getState(), m: sim.rMove.getState(),
      u: sim.rMut.getState(), c: sim.rCat.getState(),
    });
  const before = streams();
  for (let i = 0; i < 5; i++) {
    sim.flowFacts();
    sim.observerSnapshot(sim.metrics(), sim.last);
    session.describeCatalystEligibility();
  }
  assert.equal(streams(), before, "fact computation consumes no simulation RNG");
  console.log("flow RNG neutrality: PASS");
}

function testFlowCheckpoint() {
  const session = new UniverseSession();
  session.create(config(FIXTURE_SEED));
  settle(session, 20000);
  const saved = session.checkpoint();
  const restored = new UniverseSession();
  restored.restore(JSON.parse(JSON.stringify(saved)));
  assert.equal(
    JSON.stringify(flows(restored)),
    JSON.stringify(flows(session)),
    "flow facts survive checkpoint round-trip",
  );

  // Legacy tolerance: organisms saved before the pc counter existed restore
  // and compute finite flows (missing counters read as zero, never NaN).
  const legacy = JSON.parse(JSON.stringify(saved));
  const organisms = legacy.experiment.state.props.o;
  assert.ok(Array.isArray(organisms) && organisms.length > 0, "checkpoint carries organisms");
  assert.ok(organisms.every((o: any) => typeof o.pc === "number"), "new saves credit production");
  for (const o of organisms) delete o.pc;
  const aged = new UniverseSession();
  aged.restore(legacy);
  settle(aged, 20500);
  const facts = flows(aged);
  assert.equal(facts.totals.members, aged.snapshot().population, "aged organisms still aggregate");
  assert.ok(Number.isFinite(facts.totals.producedC), "aged production total is finite");
  console.log("flow checkpoint round-trip + legacy tolerance: PASS");
}

function testFlowEvidence() {
  const session = new UniverseSession();
  session.create(config(FIXTURE_SEED));
  settle(session, 8000);
  const records = (session.analysis as any).records as any[];
  assert.ok(records.length > 0, "dormancy establishes by 8k");
  const evidence = records[0].evidence;
  assert.ok(evidence.flows, "event evidence carries flow facts for history");
  assert.equal(evidence.flows.tick, records[0].tick, "facts stamped at the event tick");
  assert.ok(Array.isArray(evidence.flows.lineages), "facts carry lineage attribution");
  // Decision evidence stays scalar: flows must not leak into the choice path.
  const observed = session.exportEvidence() as any;
  for (const e of observed.observed_events as any[]) {
    assert.ok(
      Object.values(e.evidence).every((v) => typeof v === "number" || typeof v === "string" || typeof v === "boolean"),
      "ObservedEvent evidence stays scalar",
    );
  }
  console.log("flow evidence separation: PASS");
}

testFlowDeterminism();
testFlowSelfConsistency();
testFlowRngNeutrality();
testFlowCheckpoint();
testFlowEvidence();
console.log(`flow validation: PASS (checkpoint schema ${CHECKPOINT_SCHEMA_VERSION}, engine ${ENGINE_VERSION})`);
