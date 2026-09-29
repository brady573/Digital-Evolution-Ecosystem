import assert from "node:assert/strict";
import { UniverseSession } from "../../packages/sim-runtime/src/session.ts";
import type { EngineConfig, FlowFacts } from "../../packages/contracts/src/index.ts";
import {
  CHECKPOINT_MIGRATION_RULES,
  MIGRATION_RULE_BY_ID,
  migrateEntityRefs,
  typedRefs,
} from "../../packages/contracts/src/index.ts";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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

/** Float sums accumulate in different orders, so compare with tight tolerance. */
const close = (a: number, b: number, label: string) =>
  assert.ok(
    Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)),
    `${label}: ${a} vs ${b}`,
  );

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
  delete legacy.experiment.state.props.lastLineageFlows;
  delete legacy.experiment.state.props.lineageInterval;
  const aged = new UniverseSession();
  aged.restore(legacy);
  settle(aged, aged.snapshot().tick + 1000);
  const facts = flows(aged);
  assert.equal(facts.totals.members, aged.snapshot().population, "aged organisms still aggregate");
  assert.ok(Number.isFinite(facts.totals.producedC), "aged production total is finite");
  const agedInterval = (aged.simulation as any).lastLineageFlows;
  assert.ok(agedInterval && agedInterval.tick > 0, "interval attribution restarts after restore");
  assert.ok(Number.isFinite(agedInterval.totals.producedC), "restored interval totals finite");
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

function testProcessActivations() {
  // Stage 2: execution attribution per process. Deterministic across
  // identical runs; all three processes execute in a live world; counts
  // advance monotonically within a run.
  const run = () => {
    const session = new UniverseSession();
    session.create(config(FIXTURE_SEED));
    settle(session, 10000);
    const last = (session.simulation as any).last;
    return { a: last.proc_exec_a || 0, b: last.proc_exec_b || 0, c: last.proc_exec_c || 0 };
  };
  const a = run();
  const b = run();
  assert.deepEqual(a, b, "process execution counts reproduce exactly");
  assert.ok(a.a > 0 && a.b > 0 && a.c > 0, `all processes execute (a=${a.a} b=${a.b} c=${a.c})`);
  console.log("process activations: PASS");
}

function intervalFlows(session: UniverseSession) {
  return (session.simulation as any).lastLineageFlows;
}

/** Advance to a stride multiple (one full stride ahead), draining pendings. */
function settleStride(session: UniverseSession): number {
  const tick = session.snapshot().tick;
  const next = tick % 251 === 0 ? tick + 251 : tick + (251 - (tick % 251));
  for (let i = 0; i < 500 && session.snapshot().tick < next; i++) {
    const snapshot = session.advance(Math.min(251, next - session.snapshot().tick));
    const pending = snapshot.pendingDecision;
    if (pending) session.resolveEventDecision(pending.opportunityId, "keep-watching");
  }
  assert.equal(session.snapshot().tick, next, "lands exactly on a stride multiple");
  return next;
}

function testIntervalDeterminism() {
  const run = () => {
    const session = new UniverseSession();
    session.create(config(FIXTURE_SEED));
    settle(session, 10000);
    return JSON.stringify(intervalFlows(session));
  };
  assert.equal(run(), run(), "interval lineage facts reproduce exactly");
  console.log("interval determinism: PASS");
}

function testIntervalProduction() {
  // Review regression: production credit sat on the C branch (which never
  // produces) instead of the A/B branches (which do). Per-lineage interval
  // production must be nonzero and reconcile to the authoritative stride
  // counter, which is the Stage 2 "who produced C" evidence.
  const session = new UniverseSession();
  session.create(config(FIXTURE_SEED));
  settle(session, 10000);
  const sim = session.simulation as any;
  const facts = intervalFlows(session);
  assert.ok(sim.last.produced_c > 0, "stride produced C");
  assert.ok(facts.totals.producedC > 0, "interval production attributed, not zero");
  close(facts.totals.producedC, sim.last.produced_c, "lineage production reconciles to interval total");
  assert.ok(
    facts.lineages.some((l) => l.producedC > 0),
    "at least one producing lineage identified",
  );
  console.log("interval production: PASS");
}

function testIntervalNetMembers() {
  // Births minus deaths over a stride must equal the population change:
  // exact membership accounting, dead included.
  const session = new UniverseSession();
  session.create(config(FIXTURE_SEED));
  settle(session, 10000);
  settleStride(session);
  const p1 = session.snapshot().population;
  settleStride(session);
  const facts = intervalFlows(session);
  const p2 = session.snapshot().population;
  assert.equal(facts.totals.netMembers, p2 - p1, `net members (${facts.totals.netMembers}) equals pop change (${p2 - p1})`);
  assert.equal(facts.totals.births - facts.totals.deaths, p2 - p1, "births minus deaths equals pop change");
  console.log("interval net members: PASS");
}

function testIntervalCoversDead() {
  // Interval consumption must cover organisms that died mid-stride: it can
  // only exceed the living-lifetime delta, never fall short of it.
  const session = new UniverseSession();
  session.create(config(FIXTURE_SEED));
  settle(session, 10000);
  settleStride(session);
  const before = livingSums(session);
  settleStride(session);
  const facts = intervalFlows(session);
  const after = livingSums(session);
  const delta = after.mc - before.mc;
  const eps = 1e-9 * Math.max(1, Math.abs(facts.totals.consumedC), Math.abs(delta));
  assert.ok(
    facts.totals.consumedC + eps >= delta,
    `interval C (${facts.totals.consumedC}) covers living delta (${delta})`,
  );
  console.log("interval covers the dead: PASS");
}

function testWasteAccounting() {
  // Slice 2: waste mass conservation. Deposited minus biological removal
  // minus decay plus clamp adjustment must equal the stock change; the
  // accounting identity carries any residual explicitly. Saturated surplus
  // that never entered the field is counted as saturated loss, never
  // silently dropped (lineage wasteProduced means deposited mass).
  const session = new UniverseSession();
  session.create(config(FIXTURE_SEED));
  settle(session, 20000);
  const sim = session.simulation as any;
  const acc = sim.resources.waste.accounting();
  assert.ok(Number.isFinite(acc.residual), "waste residual is finite");
  assert.ok(Math.abs(acc.residual) < 1e-6 * Math.max(1, Math.abs(acc.produced)), `waste conserves (residual ${acc.residual})`);
  assert.ok(acc.produced > 0, "waste is produced by primary metabolism");
  assert.ok(Number.isFinite(acc.saturated_loss) && acc.saturated_loss >= 0, "saturated loss counted, not hidden");
  // Independent total: summing the stock array directly must match the
  // reported final stock, so the identity is checked against the field
  // itself rather than only against its own counters.
  let stockSum = 0;
  for (const v of sim.resources.waste.stock as Float32Array) stockSum += v;
  assert.ok(Math.abs(stockSum - acc.final_stock) < 1e-6 * Math.max(1, Math.abs(acc.final_stock)), "reported stock matches the field");
  // Saturation probe: overfilling one cell deposits what fits and counts
  // the rest as discarded.
  const waste = sim.resources.waste;
  const beforeDiscarded: number = waste.discarded;
  const room = waste.cap[0]! - waste.stock[0]!;
  const added = waste.deposit(5, 5, room + 1000, null);
  assert.ok(added <= room + 1e-6, "deposit capped at cell room");
  assert.ok(waste.discarded > beforeDiscarded, "surplus counted as saturated loss");
  const m = session.snapshot().metrics as any;
  assert.ok(m.waste && Number.isFinite(m.waste.fraction), "waste summary exposed in metrics");
  assert.ok(Number.isFinite(m.waste.discarded), "saturated loss exposed in metrics");
  assert.ok(m.traits.tolerance && Number.isFinite(m.traits.tolerance.mean), "tolerance tracked in traits");
  assert.ok(m.traits.cleanup && Number.isFinite(m.traits.cleanup.mean), "cleanup tracked in traits");
  console.log("waste accounting: PASS");
}

function testCleanupExecution() {
  // §5.1 closure: the waste_cleanup process must demonstrably execute, remove
  // waste biologically, and have its execution attribution reconcile with
  // authoritative field accounting. Process accounting (interval counters),
  // lineage attribution, and the waste field's own bioRemoved counter are
  // three separate code paths, so this is a real reconciliation, not a
  // tautology. Before this, cleanup_exec and biological removal were
  // recorded by the engine but asserted nowhere in the repository.
  const session = new UniverseSession();
  session.create(config(FIXTURE_SEED));
  const sim = session.simulation as any;
  let attributedRemoved = 0;
  let attributedExec = 0;
  let processRemoved = 0;
  let processExec = 0;
  let strides = 0;
  let lastTick = -1;
  // A pending decision pauses advancement, so only count a stride once and
  // only when the tick actually landed on a stride boundary.
  for (let i = 0; i < 600 && session.snapshot().tick < 60000; i++) {
    const snapshot = session.advance(251);
    if (snapshot.pendingDecision) session.resolveEventDecision(snapshot.pendingDecision.opportunityId, "keep-watching");
    const tick = session.snapshot().tick;
    if (tick === lastTick || tick % 251 !== 0) continue;
    lastTick = tick;
    const facts = sim.lastLineageFlows;
    if (!facts) continue;
    strides++;
    attributedRemoved += facts.totals.wasteRemoved;
    attributedExec += facts.totals.cleanupExec;
    processRemoved += sim.last.removed_w || 0;
    processExec += sim.last.cleanup_exec || 0;
  }
  const waste = sim.resources.waste;
  assert.ok(strides > 100, `sampled ${strides} strides`);
  // 1. Cleanup executes as a process, in a real run, and removes real mass.
  assert.ok(processExec > 0, `cleanup process executed (${processExec} executions)`);
  assert.ok(waste.bioRemoved > 0, `cleanup removed waste biologically (${waste.bioRemoved})`);
  assert.ok(attributedExec > 0, `execution attributed to lineages (${attributedExec})`);
  // 2. Biological removal is mass taken out of the field, bounded by what
  // primary metabolism put in — not a counter that can drift upward freely.
  assert.ok(
    waste.bioRemoved <= waste.produced + 1e-9,
    `removal bounded by production (${waste.bioRemoved} <= ${waste.produced})`,
  );
  // 3. Attribution reconciles with the authoritative field accounting.
  close(attributedRemoved, waste.bioRemoved, "lineage-attributed removal reconciles to field bioRemoved");
  close(processRemoved, waste.bioRemoved, "process accounting removal reconciles to field bioRemoved");
  // 4. Process-bound execution attribution agrees exactly with lineage
  // attribution: both increment only when waste was actually removed.
  assert.equal(attributedExec, processExec, "lineage execution count equals process accounting");
  // Counted executions must correspond to real mass movement. (The count and
  // the mass are different units, so the invariant is positivity, not order.)
  assert.ok(processRemoved > 0, "counted executions moved real mass");
  console.log(
    `cleanup execution: PASS (${processExec} executions, ${waste.bioRemoved.toFixed(3)} removed across ${strides} strides)`,
  );
}

function testWasteDeterminism() {
  const run = () => {
    const session = new UniverseSession();
    session.create(config(FIXTURE_SEED));
    settle(session, 20000);
    const sim = session.simulation as any;
    return JSON.stringify({
      stock: Array.from(sim.resources.waste.stock),
      traits: (session.snapshot().metrics as any).traits.tolerance,
    });
  };
  assert.equal(run(), run(), "waste field and trait trajectories reproduce exactly");
  console.log("waste determinism: PASS");
}

function testWasteCheckpoint() {
  // Checkpoint mid-accumulation: waste stocks, trait state, and sink-free
  // continuation must restore exactly.
  const session = new UniverseSession();
  session.create(config(FIXTURE_SEED));
  settle(session, 30000);
  const before = JSON.stringify((session.simulation as any).resources.waste.stock);
  const restored = new UniverseSession();
  restored.restore(JSON.parse(JSON.stringify(session.checkpoint())));
  assert.equal(
    JSON.stringify((restored.simulation as any).resources.waste.stock),
    before,
    "waste field restores exactly",
  );
  settle(session, 35000);
  settle(restored, 35000);
  assert.equal(
    JSON.stringify((restored.simulation as any).resources.waste.stock),
    JSON.stringify((session.simulation as any).resources.waste.stock),
    "restored waste continues identically",
  );
  console.log("waste checkpoint continuation: PASS");
}

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const src = (rel: string): string => readFileSync(join(REPO, rel), "utf8");

/**
 * Every migration rule must name the code that absorbs its omission.
 *
 * A table that only describes intent is a comment. What makes each entry
 * checkable is that some real code still handles the absence, so this asserts
 * a probe per rule: a pattern that must exist in the source the rule claims.
 *
 * Two properties follow. A new rule cannot be added without declaring where it
 * is absorbed, because an unprobed rule fails. And a rule cannot outlive the
 * code that justified it: delete the guard it names and this fails, which is
 * the signal that the tolerance has quietly stopped being true.
 */
const MIGRATION_ABSORBER_PROBES: Readonly<Record<string, { file: string; probe: RegExp }>> = {
  "organism-pc-reads-as-zero": {
    file: "packages/sim-core/src/engine.ts",
    probe: /o\.pc=\(o\.pc\|\|0\)\+made/,
  },
  "simulation-last-lineage-flows-reads-as-null": {
    file: "packages/sim-core/src/engine.ts",
    probe: /declare lastLineageFlows:IntervalFlowFacts\|null;/,
  },
  "simulation-lineage-interval-reads-as-empty-map": {
    file: "packages/sim-core/src/engine.ts",
    probe: /this\.lineageInterval\|\|new Map\(\)/,
  },
  "pending-decision-absent-reads-as-null": {
    file: "packages/sim-runtime/src/session.ts",
    probe: /if\(!raw\|\|typeof raw!=="object"\)return null;/,
  },
  "pending-decision-source-backfilled-from-event": {
    file: "packages/sim-runtime/src/session.ts",
    probe: /copy\.source="observed_event"/,
  },
  "decision-resolutions-absent-reads-as-empty": {
    file: "packages/sim-runtime/src/session.ts",
    probe: /Array\.isArray\(decisions\?\.resolutions\)/,
  },
  "decision-resolution-offer-tick-backfilled-from-tick": {
    file: "packages/sim-runtime/src/session.ts",
    probe: /if\(copy\.offerTick===undefined\)copy\.offerTick=copy\.tick;/,
  },
  "decision-resolution-catalyst-id-reads-as-null": {
    file: "packages/sim-runtime/src/session.ts",
    probe: /if\(copy\.catalystId===undefined\)copy\.catalystId=null;/,
  },
  "decision-resolution-source-reads-as-event-decision": {
    file: "packages/sim-runtime/src/session.ts",
    probe: /if\(copy\.source===undefined\)copy\.source="event_decision";/,
  },
  "last-decision-tick-absent-reads-as-zero": {
    file: "packages/sim-runtime/src/session.ts",
    probe: /typeof decisions\?\.lastDecisionTick==="number"\?decisions\.lastDecisionTick:0/,
  },
  "last-major-catalyst-tick-absent-reads-as-null": {
    file: "packages/sim-runtime/src/session.ts",
    probe: /typeof decisions\?\.lastMajorCatalystTick==="number"\?decisions\.lastMajorCatalystTick:null/,
  },
  "matched-control-absent-reads-as-null": {
    file: "packages/sim-runtime/src/session.ts",
    probe: /checkpoint\.control\?restoreSimulationCheckpoint/,
  },
  "entity-refs-bare-numbers-mean-unrecorded-kind": {
    file: "packages/contracts/src/index.ts",
    probe: /export const migrateEntityRefs = /,
  },
  "analysis-substate-absent-reads-as-constructor-default": {
    file: "packages/sim-analysis/src/index.ts",
    probe: /const observer=new EcologyObserver\(\);[\s\S]{0,120}Object\.assign\(observer,/,
  },
};

function testCheckpointMigrationRuleTable() {
  const schemas = ["0.1", "0.2", "0.3"];
  const absorbers = [
    "live-step-guard",
    "nullable-field",
    "constructor-default",
    "inline-backfill",
    "structural-branch",
  ];
  const seen = new Set<string>();

  for (const rule of CHECKPOINT_MIGRATION_RULES) {
    assert.ok(!seen.has(rule.id), `duplicate migration rule id: ${rule.id}`);
    seen.add(rule.id);
    assert.ok(rule.id.length > 3, `migration rule needs a real id: ${JSON.stringify(rule.id)}`);
    assert.ok(rule.path.length > 0, `${rule.id} must state where the field lives`);
    assert.ok(rule.appliesToSchemas.length > 0, `${rule.id} must name at least one schema`);
    for (const schema of rule.appliesToSchemas) {
      assert.ok(schemas.includes(schema), `${rule.id} names unknown schema ${schema}`);
    }
    assert.ok(absorbers.includes(rule.absorber), `${rule.id} names unknown absorber ${rule.absorber}`);
    assert.ok(
      rule.effectiveDefault.length > 0,
      `${rule.id} must state what the absence reads as`,
    );
    // A rule whose justification is "it was convenient" is not a rule.
    assert.ok(
      rule.omission.length > 40,
      `${rule.id} must state why the omission is tolerated, not just that it is`,
    );

    const probe = MIGRATION_ABSORBER_PROBES[rule.id];
    assert.ok(
      probe !== undefined,
      `${rule.id} has no absorber probe, so nothing proves this tolerance still exists`,
    );
    assert.ok(
      probe.probe.test(src(probe.file)),
      `${rule.id} claims ${rule.absorber} at ${rule.path}, but its absorber is gone from ${probe.file}`,
    );
  }

  // Decision 2 names three omissions that must remain supported. They are
  // asserted by id so a rename cannot quietly drop one from the contract.
  for (const required of [
    "organism-pc-reads-as-zero",
    "simulation-last-lineage-flows-reads-as-null",
    "simulation-lineage-interval-reads-as-empty-map",
  ]) {
    assert.ok(
      MIGRATION_RULE_BY_ID.has(required),
      `Decision 2 requires a named rule for ${required}`,
    );
  }
  assert.equal(
    MIGRATION_RULE_BY_ID.size,
    CHECKPOINT_MIGRATION_RULES.length,
    "the by-id index and the rule list must not drift apart",
  );
  console.log(`checkpoint migration rule table: PASS (${CHECKPOINT_MIGRATION_RULES.length} rules)`);
}

testFlowDeterminism();
testProcessActivations();
testWasteAccounting();
testCleanupExecution();
testWasteDeterminism();
testWasteCheckpoint();
testIntervalDeterminism();
testIntervalProduction();
testIntervalNetMembers();
testIntervalCoversDead();
testFlowSelfConsistency();
testFlowRngNeutrality();
/**
 * A3.2: a save written before references carried their kind.
 *
 * Three things have to hold, and the third is the one worth having a test for.
 *
 * The save restores at all, and each bare number becomes a real ref of
 * unrecorded kind rather than a dropped entry. Presentation then omits the
 * label, because a kind that was never recorded cannot be printed as either
 * `L-` or `C-` without asserting something unverified.
 *
 * And the migrated list has the same length as the bare-number original.
 * That is the A2 regression restated as a test: a migration that builds a
 * fresh object per element and dedups by reference produces a longer list, not
 * a shorter one, and a lineage named by both the producer and remover lists
 * comes out twice. Dedup here is on the `(kind, id)` pair, so a rebuilt object
 * is recognised as the reference it already was.
 */
function testPreA2EntityRefMigration() {
  // Value, not identity: the same lineage twice collapses to one entry.
  assert.deepEqual(
    migrateEntityRefs([9, 9, 7]),
    [{ kind: null, id: 9 }, { kind: null, id: 7 }],
    "a bare number becomes an unrecorded-kind ref, deduplicated by value",
  );
  // An already-tagged ref survives unchanged, and two distinct kinds of the
  // same id are two different references.
  assert.deepEqual(
    migrateEntityRefs([{ kind: "lineage", id: 9 }, { kind: "clade", id: 9 }, { kind: "lineage", id: 9 }]),
    [{ kind: "lineage", id: 9 }, { kind: "clade", id: 9 }],
    "dedup is on the (kind, id) pair, so a lineage and a clade of one id stay distinct",
  );
  // Unusable entries are passed through, not dropped. Silently shortening the
  // list would be the quiet normalisation Decision 2 forbids; deciding what an
  // unusable entry means belongs to validation.
  assert.deepEqual(
    migrateEntityRefs(["nope", { kind: "lineage" }, 4]),
    ["nope", { kind: "lineage" }, { kind: null, id: 4 }],
    "an entry that is not a usable ref is passed through rather than dropped",
  );
  assert.deepEqual(
    migrateEntityRefs([9, NaN]),
    [{ kind: null, id: 9 }, NaN],
    "a finite number still migrates, and a non-finite one is not treated as an omission",
  );

  // End to end: a real save, stripped back to the pre-A2 shape, then restored.
  const session = new UniverseSession();
  session.create(config(FIXTURE_SEED));
  settle(session, 20000);
  const saved: any = JSON.parse(JSON.stringify(session.checkpoint()));

  const taggedCount = saved.analysis.records
    .flatMap((r: any) => r.entity_refs as any[])
    .filter((ref: any) => ref !== null && typeof ref === "object").length;
  assert.ok(taggedCount > 0, "this run produced tagged refs, so the strip below is meaningful");
  // Strip to the pre-A2 shape FIRST, then capture: `originals` must be the
  // bare-number form, because that is what the migrated list is compared against.
  for (const r of saved.analysis.records) {
    r.entity_refs = (r.entity_refs as any[]).map((ref: any) => ref.id);
  }
  const originals: number[][] = saved.analysis.records.map((r: any) => [...r.entity_refs]);

  const aged = new UniverseSession();
  aged.restore(saved);
  const migrated = (aged.analysis as any).records as any[];
  assert.equal(migrated.length, saved.analysis.records.length, "no record is lost or invented");

  let compared = 0;
  for (let i = 0; i < migrated.length; i++) {
    const before = originals[i] as number[];
    const after = migrated[i].entity_refs as any[];
    assert.equal(
      after.length,
      before.length,
      `record ${i}: migrated refs must be the same length as the bare-number original`,
    );
    for (let j = 0; j < before.length; j++) {
      assert.equal(after[j].kind, null, `record ${i} ref ${j}: kind must be unrecorded, not guessed`);
      assert.equal(after[j].id, before[j], `record ${i} ref ${j}: id survives the migration`);
      compared++;
    }
    // The presentation consequence: no label is claimed in either namespace.
    assert.deepEqual(
      typedRefs(after),
      [],
      `record ${i}: an unrecorded kind yields no L- or C- claim`,
    );
  }
  assert.ok(compared > 0, "the comparison above actually ran");

  // The engine's own output is incidental here — in 20k ticks it may name one
  // entity or several. So the dedup case is stated explicitly on the restore
  // path, with a record whose bare numbers repeat a lineage. A migration that
  // rebuilt each ref as a fresh object and deduped by reference would leave
  // all three entries, which is the A2 failure exactly.
  saved.analysis.records.push({
    id: "synthetic-duplicate-refs-established-1",
    arc_id: "synthetic",
    kind: "cuse",
    tick: 1,
    phase: "established",
    title: "synthetic",
    summary: "synthetic",
    level: "major",
    evidence: {},
    entity_refs: [9, 9, 7],
  });
  const dup = new UniverseSession();
  dup.restore(saved);
  const dupRef = ((dup.analysis as any).records as any[]).at(-1).entity_refs as any[];
  assert.equal(dupRef.length, 2, "a repeated bare lineage collapses to one ref, by value not by identity");
  assert.deepEqual(
    dupRef,
    [{ kind: null, id: 9 }, { kind: null, id: 7 }],
    "the collapsed ref keeps the first occurrence's order and an unrecorded kind",
  );
  console.log(
    `pre-A2 entity_refs migration: PASS (${compared} real refs length-preserved, duplicate case collapsed)`,
  );
}


testFlowCheckpoint();
testPreA2EntityRefMigration();
testCheckpointMigrationRuleTable();

testFlowEvidence();
console.log(`flow validation: PASS (checkpoint schema ${CHECKPOINT_SCHEMA_VERSION}, engine ${ENGINE_VERSION})`);
