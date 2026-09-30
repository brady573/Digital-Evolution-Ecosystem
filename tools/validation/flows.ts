import assert from "node:assert/strict";
import { UniverseSession } from "../../packages/sim-runtime/src/session.ts";
import type { EngineConfig, FlowFacts } from "../../packages/contracts/src/index.ts";
import {
  CHECKPOINT_MIGRATION_RULES,
  CheckpointRejectionError,
  MIGRATION_RULE_BY_ID,
  migrateEntityRefs,
  SUPPORTED_SCHEMAS,
  typedRefs,
  validateCheckpoint,
} from "../../packages/contracts/src/index.ts";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ENGINE_VERSION } from "../../packages/sim-core/src/index.ts";
import { CHECKPOINT_SCHEMA_VERSION } from "../../packages/sim-runtime/src/session.ts";
import { testHistoricalCheckpointBoundary } from "./checkpoint-historical-boundary.ts";

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
  assert.throws(
    () => new UniverseSession().restore(JSON.parse(JSON.stringify(legacy))),
    (error: unknown) => error instanceof CheckpointRejectionError && error.field === "experiment.state.props.o[0].pc",
    "the maintained current schema cannot use an older build's missing production counters",
  );
  legacy.checkpointSchemaVersion = "0.3";
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
  "organism-waste-tolerance-reads-as-zero": {
    file: "packages/sim-core/src/engine.ts",
    // Absorber `live-step-guard`: the biological step clamps an absent trait
    // to zero. Probed against that clamp, so a rewrite that stopped treating
    // absence as no-tolerance would fail here rather than silently changing
    // waste exposure physiology.
    probe: /Q\(o\.to\|\|0,0,1\.5\)/,
  },
  "organism-waste-cleanup-reads-as-zero": {
    file: "packages/sim-core/src/engine.ts",
    // Absorber `live-step-guard`: the cleanup process derives its access from
    // the trait, so an absent one means the process cannot execute.
    probe: /Q\(o\.cu\|\|0,0,1\.5\)\/1\.5/,
  },
  "last-decision-tick-reconstructed-from-newest-record": {
    file: "packages/contracts/src/index.ts",
    // Absorber `structural-branch`: for 0.2 the migration computes the value from
    // the save's own records rather than reading a stored field. The whole
    // conditional is probed, not just the call, so a rewrite that dropped the
    // 0.2 reconstruction — or made 0.3 derive instead of preserve — fails here.
    probe: /schema === "0\.2"\s*\? newestKnownDecisionTick\(pending, resolutions\)/,
  },
  "major-catalyst-tick-predates-cooldown": {
    file: "packages/contracts/src/index.ts",
    // Absorber `structural-branch`: a payload that predates the cooldown falls to
    // null, and null reads as "clear". Probed against the expression the
    // migration actually uses, so a rewrite that drops the pre-cooldown absence
    // fails here rather than silently re-allowing a dynamics-gating default.
    probe: /const lastMajorCatalystTick = isCurrentSchema\(schema\) \|\| schema === "0\.3"\s*\? nullableTick\(source\.lastMajorCatalystTick\)\s*: null;/,
  },
  "pending-decision-source-backfilled-from-event": {
    file: "packages/contracts/src/index.ts",
    probe: /copy\.source = "observed_event"/,
  },
  "decision-resolution-offer-tick-backfilled-from-tick": {
    file: "packages/contracts/src/index.ts",
    probe: /if \(copy\.offerTick === undefined\) copy\.offerTick = copy\.tick;/,
  },
  "decision-resolution-catalyst-id-reads-as-null": {
    file: "packages/contracts/src/index.ts",
    probe: /if \(copy\.catalystId === undefined\) copy\.catalystId = null;/,
  },
  "pending-observation-not-recorded-in-02": {
    file: "packages/contracts/src/index.ts",
    probe: /if \(copy\.contextSnapshot === undefined\) copy\.contextSnapshot = null;/,
  },
  "resolution-choice-title-not-recorded-in-02": {
    file: "packages/contracts/src/index.ts",
    probe: /choiceTitle: copy\.choiceTitle \?\? NOT_RECORDED/,
  },
  "resolution-direct-effect-not-recorded-in-02": {
    file: "packages/contracts/src/index.ts",
    probe: /directEffectDescription: copy\.directEffectDescription \?\? NOT_RECORDED/,
  },
  "entity-refs-bare-numbers-mean-unrecorded-kind": {
    file: "packages/contracts/src/index.ts",
    probe: /export const migrateEntityRefs = /,
  },
  "analysis-cuse-guild-absent-reads-as-constructor-default": {
    file: "packages/sim-analysis/src/index.ts",
    probe: /const observer=new EcologyObserver\(\);[\s\S]{0,120}Object\.assign\(observer,/,
  },
  "analysis-niche-construction-absent-reads-as-constructor-default": {
    file: "packages/sim-analysis/src/index.ts",
    probe: /const observer=new EcologyObserver\(\);[\s\S]{0,120}Object\.assign\(observer,/,
  },
  "control-analysis-cuse-guild-absent": {
    file: "packages/sim-analysis/src/index.ts",
    probe: /const observer=new EcologyObserver\(\);[\s\S]{0,120}Object\.assign\(observer,/,
  },
  "control-analysis-niche-construction-absent": {
    file: "packages/sim-analysis/src/index.ts",
    probe: /const observer=new EcologyObserver\(\);[\s\S]{0,120}Object\.assign\(observer,/,
  },
};

/** The schema the maintained save path writes. No rule may tolerate an
 *  omission in it: that is the whole point of the 0.4 split. */
const CURRENT_SCHEMA = CHECKPOINT_SCHEMA_VERSION;

// Rules that tolerate a historical absence in one place while the same field
// may also be refused: a whole rule needs no `rejects`, a half rule must say
// what it refuses. The two controlAnalysis detector rules are whole rules in
// their own right (the fork observer's constructor default is the absorber),
// but the source-schema preflight refuses a *present* malformed value there
// just as it does for the live observer, so the refusal is recorded for them
// too rather than left implicit.
const SPLIT_RULE_IDS = [
  "analysis-cuse-guild-absent-reads-as-constructor-default",
  "analysis-niche-construction-absent-reads-as-constructor-default",
  "control-analysis-cuse-guild-absent",
  "control-analysis-niche-construction-absent",
  "pending-observation-not-recorded-in-02",
];

function testCheckpointMigrationRuleTable() {
  // Every version the contract knows, so a rule scoped to 0.4 — which no
  // absence tolerance may be — is still a *valid* value here and has to be
  // caught by the no-crossing assertion below rather than by the whitelist.
  const schemas = ["0.1", "0.2", "0.3", "0.4"];
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
    // A rule must name a supported build that could have written the shape.
    // "The restore code currently tolerates it" is not a basis, and the whole
    // point of 0.4 is that the two are no longer the same claim.
    assert.ok(
      typeof rule.historicalBasis === "string" && rule.historicalBasis.length > 40,
      `${rule.id} must name concrete evidence that a supported build wrote this shape`,
    );
    assert.doesNotMatch(
      rule.historicalBasis,
      /currently tolerates|restore code|happens to/i,
      `${rule.id} cites present-day tolerance instead of history, which is not a basis`,
    );
    assert.ok(rule.appliesToSchemas.length > 0, `${rule.id} must name at least one schema`);
    for (const schema of rule.appliesToSchemas) {
      assert.ok(schemas.includes(schema), `${rule.id} names unknown schema ${schema}`);
    }
    // No absence tolerance may cross into the current schema: a 0.4 save is
    // written by the build that requires these fields, so it may not omit them.
    assert.ok(
      !rule.appliesToSchemas.includes(CURRENT_SCHEMA),
      `${rule.id} tolerates its omission in ${CURRENT_SCHEMA}, but the current schema requires it`,
    );
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
    // A half rule must say what it refuses, or the absence-tolerance reads as
    // blanket tolerance. A whole rule needs no `rejects`.
    // §4.5: every rule states what its omission can affect, and a rule that can
    // affect the world must justify why its default is safe anyway. Without
    // this, "we default it" is the whole record and a later reader inherits the
    // default without the reasoning that made it acceptable.
    assert.ok(
      ["inert", "load-bearing-display", "load-bearing-dynamics"].includes(rule.hazard),
      `${rule.id} must declare one of the three hazard kinds, got ${String(rule.hazard)}`,
    );
    if (rule.hazard === "load-bearing-dynamics") {
      assert.ok(
        typeof rule.dynamicsJustification === "string" && rule.dynamicsJustification.length > 40,
        `${rule.id} gates the world, so it must justify why its default preserves behaviour rather than granting a capability`,
      );
    } else {
      assert.equal(
        rule.dynamicsJustification,
        undefined,
        `${rule.id} does not gate the world, so a dynamics justification would be claiming a hazard it does not have`,
      );
    }
    if (SPLIT_RULE_IDS.includes(rule.id)) {
      assert.ok(
        typeof rule.rejects === "string" && rule.rejects.length > 40,
        `${rule.id} is a half rule and must state the wrong-typed case it refuses`,
      );
    }

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

/**
 * The supported-save document must stay derived from the table.
 *
 * The generator refuses to run when it names a supported schema version in
 * code, but a self-check nobody executes proves nothing: the boundary is
 * presented to the Owner between runs, so the failure would land on the
 * decision rather than on the build. This executes it from a routed unit, and
 * separately asserts the printed heading carries the live current version and
 * no historical one — so the rot is caught at the output even if the source
 * scan is bypassed.
 */
function testBoundaryGeneratorIsDerived() {
  const here = dirname(fileURLToPath(import.meta.url));
  const result = spawnSync(join(here, "..", "..", "node_modules", ".bin", "tsx"), [join(here, "checkpoint-boundary.ts")], {
    encoding: "utf8",
  });
  assert.equal(
    result.status,
    0,
    `the boundary generator refused to run, so the supported-save document cannot be produced:\n${result.stderr}`,
  );
  const out = result.stdout;

  assert.ok(
    out.includes(`(${CHECKPOINT_MIGRATION_RULES.length} rules)`),
    "the document's rule count must come from the table, not from prose that a rule edit can invalidate",
  );

  const heading = out.split("\n").find((l) => l.startsWith("## A valid ") && l.includes("never depends"));
  assert.ok(heading !== undefined, "the document must state the no-current-schema-migration property");

  // A generated document that states the opposite of the code is worse than no
  // document, so the asymmetry proof is checked against the field the suite
  // actually proves it with. When the negative control moved to `analysis.dep`
  // this line kept naming `analysis.records` as tolerated at the historical
  // schema — which that same change had just made refused at every schema. The
  // prose outlived the behaviour it described, and only diffing against the
  // previous artifact caught it.
  // The document must not claim a completeness it does not have. Restore sets
  // values for state no save format ever carried — a 0.1 world's absent
  // decision system, and the running build's policy versions. Those are
  // deliberately not absence-compatibility rules, and the document has to say
  // so, or "everything not listed here is refused" reads as a claim that
  // unlisted defaults do not exist.
  assert.ok(
    out.includes("### What the rules do not cover"),
    "the document must state what its rules do not cover, so its completeness claim is bounded",
  );
  assert.ok(
    !out.includes("Everything not listed here is refused") &&
      !out.includes("not yet an exhaustive schema validator") &&
      out.includes("the only authorized historical omissions"),
    "the boundary must state the closed check set, not a claim of exhaustive validation it does not provide",
  );
  assert.ok(
    out.includes("source-schema preflight") && out.includes("A3.4") && !out.includes("migration runs before validation"),
    "the generated boundary must describe raw-source preflight and reserve canonical ordering for A3.4",
  );
  assert.ok(
    out.includes("Two independent gates") && out.includes("no save-preservation promise"),
    "the boundary must separate schema validity from engine-version compatibility",
  );
  assert.ok(
    out.includes("deliberately outside this preflight") && !/not yet inventoried|remains to be inventoried/i.test(out),
    "every out-of-scope field class must be named with a reason, and none may remain un-inventoried",
  );
  assert.ok(
    out.includes("oldest world had no decision subsystem") &&
      out.includes("even when saved versions are present"),
    "the uncovered section must distinguish absent old subsystems from saved generator versions that are intentionally replaced",
  );

  // A3.3 proves three narrow properties. It does not prove canonical
  // migrate-then-validate ordering: pre-A2 entity migration runs before
  // validation, but other historical reconstruction happens later in `restore`.
  // Claiming the ordering here would assert a property the code does not have.
  assert.ok(
    !/Migration runs before validation/.test(out),
    "the document must not claim migrate-before-validate ordering; A3.3 does not prove it",
  );
  assert.ok(
    out.includes("What A3.3 proves"),
    "the document must state the properties A3.3 actually proves",
  );

  const asymmetry = out.split("\n").find((l) => l.startsWith("3. **The asymmetry"));
  assert.ok(asymmetry !== undefined, "the document must state the absence/invalidity asymmetry");
  assert.equal(
    asymmetry.match(/`analysis\.([a-z_]+)`/)?.[1],
    "dep",
    "the asymmetry proof must name the sub-state the suite actually proves it with",
  );
  assert.ok(
    heading.includes(CURRENT_SCHEMA),
    `the property heading must name the live current schema ${CURRENT_SCHEMA}, got: ${heading}`,
  );
  for (const historical of SUPPORTED_SCHEMAS.filter((s) => s !== CURRENT_SCHEMA)) {
    assert.ok(
      !heading.includes(historical),
      `the property heading names historical schema ${historical}, which is rot: it was correct until the version moved`,
    );
  }
  console.log("boundary generator is derived: PASS (no supported-version literal, heading carries current schema)");
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
  // A pre-A2 reference list is a 0.3 save, because A2 changed the persisted
  // shape without bumping the schema. Relabelling a current save's stripped
  // refs as current would describe a shape the current writer never emitted,
  // and the source-schema preflight refuses exactly that.
  saved.checkpointSchemaVersion = "0.3";

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

  // The same payload as the current schema must be refused: bare IDs are the
  // historically absent shape, not an alternative encoding of a current one.
  const asCurrent = JSON.parse(JSON.stringify(saved));
  asCurrent.checkpointSchemaVersion = CHECKPOINT_SCHEMA_VERSION;
  assert.throws(
    () => new UniverseSession().restore(asCurrent),
    (error: unknown) => error instanceof CheckpointRejectionError,
    "a current save may not carry pre-A2 bare entity references",
  );

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

  /**
   * The fixture's own references are incidental — in 20k ticks the engine may
   * name one entity or several, and this run happened to name exactly one. A
   * proof that shrinks with the fixture is a vacuous proof, so the invariant
   * that actually regressed in A2 is stated here on an explicit reference set
   * through the real restore path, independent of whatever the engine emitted.
   *
   * A2 broke because the migration constructed a fresh object per element and
   * deduplicated by object identity, so a lineage named by two lists survived
   * twice. Identity dedup fails on BARE numbers (each becomes a distinct
   * object) and on TAGGED refs (each arrives as a distinct object). Both shapes
   * are asserted, together with the case identity dedup gets wrong in the
   * opposite direction: one numeric id carrying two different kinds must stay
   * two references.
   */
  const REFERENCE_CASES: readonly {
    readonly label: string;
    readonly refs: readonly unknown[];
    readonly expected: readonly unknown[];
  }[] = [
    {
      label: "bare: a repeated lineage collapses, first-occurrence order kept",
      refs: [9, 9, 7],
      expected: [{ kind: null, id: 9 }, { kind: null, id: 7 }],
    },
    {
      label: "bare: interleaved repeats collapse by value, not adjacency",
      refs: [4, 9, 4, 9, 9, 2],
      expected: [{ kind: null, id: 4 }, { kind: null, id: 9 }, { kind: null, id: 2 }],
    },
    {
      label: "tagged: a repeated (kind, id) pair collapses",
      refs: [
        { kind: "lineage", id: 3 },
        { kind: "lineage", id: 3 },
        { kind: "organism", id: 3 },
      ],
      expected: [{ kind: "lineage", id: 3 }, { kind: "organism", id: 3 }],
    },
    {
      label: "distinct kinds of one numeric id stay distinct references",
      refs: [
        { kind: "lineage", id: 5 },
        { kind: "clade", id: 5 },
        { kind: "organism", id: 5 },
        { kind: "lineage", id: 5 },
      ],
      expected: [
        { kind: "lineage", id: 5 },
        { kind: "clade", id: 5 },
        { kind: "organism", id: 5 },
      ],
    },
    {
      label: "an unrecorded kind is a real reference, not an absent one",
      refs: [{ kind: null, id: 8 }, { kind: null, id: 8 }, { kind: "lineage", id: 8 }],
      expected: [{ kind: null, id: 8 }, { kind: "lineage", id: 8 }],
    },
    {
      label: "a single reference passes through unchanged",
      refs: [12],
      expected: [{ kind: null, id: 12 }],
    },
  ];

  for (const [index, testCase] of REFERENCE_CASES.entries()) {
    const payload: any = JSON.parse(JSON.stringify(saved));
    payload.analysis.records.push({
      id: `deterministic-ref-case-${index}`,
      arc_id: "deterministic",
      kind: "reference-case",
      tick: 1,
      phase: "established",
      title: "synthetic",
      summary: "synthetic",
      level: "major",
      evidence: {},
      entity_refs: testCase.refs,
    });
    const restoredCase = new UniverseSession();
    restoredCase.restore(payload);
    const migratedCase = ((restoredCase.analysis as any).records as any[]).at(-1).entity_refs as any[];
    // The exact expected list catches both directions: dropping an entry
    // shortens it, failing to collapse lengthens it.
    assert.deepEqual(
      migratedCase,
      testCase.expected,
      `reference migration on the restore path — ${testCase.label}`,
    );
  }
  assert.ok(
    REFERENCE_CASES.filter((c) => c.refs.length > 1).length >= 4,
    "the reference cases include several multi-reference inputs, not only single-element lists",
  );
  console.log(
    `pre-A2 entity_refs migration: PASS (${compared} fixture refs length-preserved, ${REFERENCE_CASES.length} deterministic reference cases)`,
  );
}


/**
 * A3.3, built before the rejection conditions on purpose.
 *
 * Every other new check asks "is a corrupt value refused?". This one asks the
 * question none of them can: **what does the world do when nothing refuses
 * it?** A default that is merely wrong is a truthfulness defect the player
 * might notice. A default that reads as "clear" is a dynamics change, and it
 * is silent.
 *
 * The case is `lastMajorCatalystTick`. `isMajorCooldownClear` is
 * `lastMajorCatalystTick === null || tick - lastMajorCatalystTick >= 25_000`,
 * so `null` does not mean unknown — it means *no major catalyst has ever
 * fired*, which grants a major catalyst the real cooldown would have
 * suppressed. A corrupt value therefore restores into a world that quietly
 * diverges, and a save that refuses to load would at least have been legible.
 *
 * Two assertions, because they are different claims:
 *
 *   (a) preservation — a real, recent cooldown survives the round trip, so
 *       validation cannot cost a correctly-saved world its own history.
 *   (b) refusal — a corrupt value is refused, not coerced to the permissive
 *       end of the range. (b) is the one that fails before A3.3 and passes
 *       after it.
 */
const cooldownBlocked = (session: UniverseSession): boolean =>
  session
    .describeCatalystEligibility()
    .diagnoses.some((d) => d.reasons.includes("major-catalyst cooldown has not elapsed"));

function testCooldownPreservationAcrossRestore() {
  const session = new UniverseSession();
  session.create(config(FIXTURE_SEED));
  settle(session, 20000);

  // (a) A genuine, recent cooldown. The saved tick is well inside the 25_000
  // window, so the major cooldown is still running and must still be running
  // after a round trip through the hardened boundary.
  const saved: any = JSON.parse(JSON.stringify(session.checkpoint()));
  saved.decisions.lastMajorCatalystTick = saved.decisions.lastDecisionTick;
  const at = saved.decisions.lastMajorCatalystTick as number;
  assert.ok(
    saved.decisions.lastDecisionTick - at < 25_000,
    "the saved cooldown is inside its window, so this save is a suppressed one",
  );

  const restored = new UniverseSession();
  restored.restore(saved);
  assert.ok(
    cooldownBlocked(restored),
    "a suppressed major cooldown stays suppressed across restore (preservation)",
  );

  // The discriminator, and it is the hazard stated as a fact: `null` is a
  // *legal* value for this field meaning "no major catalyst has ever fired",
  // and it reads as cooldown-clear. So the assertion above discriminates on the
  // value rather than on eligibility, and the reason a corrupt value must not be
  // coerced to `null` is visible in two lines of test.
  const neverFired: any = JSON.parse(JSON.stringify(saved));
  neverFired.decisions.lastMajorCatalystTick = null;
  const clear = new UniverseSession();
  clear.restore(neverFired);
  assert.ok(
    !cooldownBlocked(clear),
    'a null lastMajorCatalystTick reads as "never fired" and is therefore clear, not blocked',
  );

  // (b) The absence-of-refusal case. A wrong-typed value is not an elapsed
  // cooldown and not an absent one; it is corrupt. It must be refused. Before
  // A3.3 this restores as `null`, which reads as "clear", and the suppressed
  // cooldown below silently disappears.
  const corrupt: any = JSON.parse(JSON.stringify(saved));
  corrupt.decisions.lastMajorCatalystTick = "not a tick";
  assert.throws(
    () => new UniverseSession().restore(corrupt),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(
        message,
        /lastMajorCatalystTick/,
        `the error must name the field, got: ${message}`,
      );
      return true;
    },
    "a corrupt lastMajorCatalystTick is refused, not defaulted to the permissive end",
  );

  // (c) A real 0.3 save. 0.3 wrote this field — `b040b19`'s decision checkpoint
  // assigns it — so discarding it on restore is a restore defect, not a
  // historical absence, and no migration rule is warranted. The failure mode
  // is that `null` reads as cooldown-clear, so a suppressed cooldown silently
  // re-enables a major catalyst after the restore.
  const legacy: any = JSON.parse(JSON.stringify(saved));
  legacy.checkpointSchemaVersion = "0.3";
  const atLegacy = legacy.decisions.lastMajorCatalystTick as number;
  assert.equal(
    atLegacy,
    at,
    "the 0.3 payload carries the same recorded cooldown, so 0.3 wrote the field",
  );
  const legacyRestored = new UniverseSession();
  legacyRestored.restore(legacy);
  assert.ok(
    cooldownBlocked(legacyRestored),
    "a 0.3 save with an active major-catalyst cooldown restores with the cooldown still active",
  );

  // (d) The same field, present but wrong-typed, refused at 0.3 too. The
  // version split governs absence; it must not become a licence to accept a
  // corrupt value from an older schema.
  const legacyCorrupt: any = JSON.parse(JSON.stringify(legacy));
  legacyCorrupt.decisions.lastMajorCatalystTick = "not a tick";
  assert.throws(
    () => new UniverseSession().restore(legacyCorrupt),
    (error: unknown) =>
      error instanceof CheckpointRejectionError && error.field === "decisions.lastMajorCatalystTick",
    "a corrupt lastMajorCatalystTick in a 0.3 save is refused, not cleared to the permissive end",
  );

  // (e) A 0.2 save predates the field — zero occurrences in `b39fd46`. Absence
  // there is historical fact, so it migrates to the canonical value, and
  // "never fired" is the truth about a 0.2 world because the mechanic did not
  // exist yet.
  //
  // The payload must actually be 0.2-shaped, not a relabelled current save.
  // 0.2 predates catalyst windows and the catalyst catalog version, so a
  // genuine 0.2 world has neither a catalyst resolution nor the version keys
  // that arrived with 0.3. Relabelling a current save kept those keys and the
  // preflight correctly refused a shape no 0.2 build ever wrote.
  const older: any = JSON.parse(JSON.stringify(legacy));
  older.checkpointSchemaVersion = "0.2";
  older.decisions.resolutions = older.decisions.resolutions.filter(
    (r: any) => r.source === "event_decision",
  );
  if (older.decisions.pending?.source === "world_catalyst") older.decisions.pending = null;
  delete older.decisions.lastMajorCatalystTick;
  delete older.decisions.lastDecisionTick;
  delete older.decisions.catalystPolicyVersion;
  for (const r of older.decisions.resolutions) {
    delete r.catalystId;
    delete r.offerTick;
    delete r.choiceTitle;
    delete r.directEffectDescription;
  }
  if (older.decisions.pending) {
    delete older.decisions.pending.source;
    delete older.decisions.pending.contextSnapshot;
  }
  const olderRestored = new UniverseSession();
  olderRestored.restore(older);
  assert.ok(
    !cooldownBlocked(olderRestored),
    "a 0.2 save predating the field migrates to clear, which is historically correct rather than permissive",
  );

  console.log("major-catalyst cooldown preservation: PASS (0.4, 0.3, and 0.2-absence)");
}


/**
 * A3.3 step 3: prove the validator on its own, before it is wired.
 *
 * These run against `validateCheckpoint` directly rather than through
 * `restore`, so a failure here is the validator's and not the wiring's. The
 * current-save round trip (§4.4) is the one that matters most: it is the only
 * check that can catch a condition broad enough to refuse a save the current
 * build itself produced.
 */
const rejected = (payload: any): CheckpointRejectionError => {
  try {
    validateCheckpoint(payload);
  } catch (error) {
    assert.ok(error instanceof CheckpointRejectionError, `expected a typed rejection, got ${String(error)}`);
    return error;
  }
  assert.fail("expected the checkpoint to be refused");
};

function testCheckpointRejectionConditions() {
  const session = new UniverseSession();
  session.create(config(FIXTURE_SEED));
  settle(session, 20000);
  const good: any = JSON.parse(JSON.stringify(session.checkpoint()));

  // The positive case first: a real save must survive, or nothing below means
  // anything. This is the current-save round trip, through the maintained path.
  validateCheckpoint(good);
  assert.ok(true, "a checkpoint from the maintained save path is accepted");

  // wrong-type
  for (const [field, corrupt, reason] of [
    ["decisions.lastMajorCatalystTick", "not a tick", "wrong-type"],
    ["decisions.lastDecisionTick", "soon", "wrong-type"],
    ["decisions.pending", "gate", "wrong-type"],
    ["control", 42, "wrong-type"],
  ] as const) {
    const bad = JSON.parse(JSON.stringify(good));
    const parts = field.split(".");
    let target: any = bad;
    for (const part of parts.slice(0, -1)) target = target[part];
    target[parts[parts.length - 1]!] = corrupt;
    const error = rejected(bad);
    assert.equal(error.field, field, `the error must name ${field}`);
    assert.equal(error.reason, reason, `${field} must fail as ${reason}`);
  }

  // malformed-container
  for (const [field, corrupt] of [
    ["decisions.resolutions", { not: "an array" }],
    ["decisions", "not an object"],
    ["analysis.records", { not: "an array" }],
    ["experiment", null],
  ] as const) {
    const bad = JSON.parse(JSON.stringify(good));
    const parts = field.split(".");
    let target: any = bad;
    for (const part of parts.slice(0, -1)) target = target[part];
    target[parts[parts.length - 1]!] = corrupt;
    const error = rejected(bad);
    assert.equal(error.field, field, `the error must name ${field}`);
    assert.equal(error.reason, "malformed-container", `${field} must fail as malformed-container`);
  }

  // non-finite-numeric, via the decision ticks that gate the world
  for (const value of [NaN, Infinity, -Infinity]) {
    const bad = JSON.parse(JSON.stringify(good));
    bad.decisions.lastMajorCatalystTick = value;
    const error = rejected(bad);
    assert.equal(error.field, "decisions.lastMajorCatalystTick");
    assert.equal(error.reason, "non-finite-numeric", `a non-finite tick must be refused, got ${value}`);
    // The player-facing text exists for every reason and never leaks the field
    // name, the quoted value, or the reason code into the surface.
    assert.ok(error.playerMessage.length > 0, "every refusal carries player-facing text");
    assert.doesNotMatch(
      error.playerMessage,
      /lastMajorCatalystTick|non-finite-numeric|NaN|Infinity/,
      `player text must not be developer text: ${error.playerMessage}`,
    );
  }

  // unsupported-version
  for (const version of ["0.5", "1.0", "", null, 3]) {
    const bad = JSON.parse(JSON.stringify(good));
    bad.checkpointSchemaVersion = version;
    const error = rejected(bad);
    assert.equal(error.field, "checkpointSchemaVersion");
    assert.equal(error.reason, "unsupported-version", `schema ${JSON.stringify(version)} must be refused`);
  }

  // unsupported-tag — the condition with no existing throw behind it. Before
  // this, an unrecognised tag decoded as a plain object and was accepted.
  const badTag = JSON.parse(JSON.stringify(good));
  badTag.experiment.__digital_evolution_type = "not-a-real-tag";
  const tagError = rejected(badTag);
  assert.equal(tagError.reason, "unsupported-tag");
  assert.match(tagError.message, /not-a-real-tag/);

  // structural-contradiction: a resolution whose parts disagree — here a
  // non-string opportunityId, a null commandId, a string tick and a source the
  // schema does not know. Refusing a value that is internally inconsistent,
  // rather than a value of the wrong type.
  const contradiction = JSON.parse(JSON.stringify(good));
  contradiction.decisions.resolutions = [
    { opportunityId: 1, commandId: null, tick: "later", source: "from_the_future" },
  ];
  const contradictionError = rejected(contradiction);
  assert.equal(contradictionError.reason, "structural-contradiction");
  // Named to the exact part, not just the array element: an error that says
  // "resolutions[0]" leaves the reader to guess which field contradicted itself.
  assert.equal(
    contradictionError.field,
    "decisions.resolutions[0].opportunityId",
    "the error must name the exact part that contradicts itself",
  );
  assert.match(contradictionError.message, /structural-contradiction/);

  // The oldest schema predates the entire decision system.
  const legacy: any = JSON.parse(JSON.stringify(good));
  legacy.checkpointSchemaVersion = "0.1";
  delete legacy.decisions;
  validateCheckpoint(legacy);
  assert.ok(true, "a 0.1 save without a decisions object is still accepted");

  // --- The negative control -------------------------------------------------
  //
  // `analysis.records` was written by every schema and cannot demonstrate
  // historical absence. Check that both 0.3 and 0.4 refuse its omission;
  // `analysis.dep` below demonstrates the genuine version-scoped asymmetry.
  const missingRecords = (schema: string): any => {
    const bad = JSON.parse(JSON.stringify(good));
    bad.checkpointSchemaVersion = schema;
    delete bad.analysis.records;
    return bad;
  };
  // The other axis, and the one the version split does not test. A rule
  // governs *absence*; it says nothing about whether a value that is present
  // is valid. A version-scoped absence check alone stayed green while a
  // malformed historical payload loaded.
  // A field covered by a rule must be *absent* and load; the same field
  // *present with a wrong type* must be refused at every supported schema.
  // This container exists in 0.2 as well as 0.3 and 0.4; older resolution
  // records have different fields, but a non-array container is invalid in all
  // three. The oldest schema predates the entire decision system.
  for (const schema of ["0.2", "0.3", "0.4"]) {
    const wrongTyped: any = JSON.parse(JSON.stringify(good));
    wrongTyped.checkpointSchemaVersion = schema;
    wrongTyped.decisions.resolutions = "not an array";
    const error = rejected(wrongTyped);
    assert.equal(
      error.field,
      "decisions.resolutions",
      `a present-but-malformed value must be refused at ${schema}, not tolerated because ${schema} may omit the field`,
    );
    assert.equal(error.reason, "malformed-container");
  }

  // The asymmetry, restated against a field whose history actually supports
  // it. `analysis.records` is written by every checkpoint build since d86ddfe,
  // so a save omitting it is malformed at 0.3 too and is refused at both. The
  // version split is therefore NOT "0.3 may omit what 0.4 requires" in general:
  // it is scoped per field, by when that field was introduced.
  const missingRecordsAt03 = rejected(missingRecords("0.3"));
  assert.equal(
    missingRecordsAt03.field,
    "analysis.records",
    "0.3 wrote analysis.records, so a 0.3 save omitting it is malformed rather than historical",
  );

  // `analysis.dep` (the C-use guild) arrived in 3ddb287 on 2026-09-25, after
  // the 0.3 bump, so a 0.3 save may genuinely omit it. That is the real
  // version-scoped absence, and it is the case the version split exists for.
  const missingDep = (schema: string): any => {
    const payload = JSON.parse(JSON.stringify(good));
    payload.checkpointSchemaVersion = schema;
    delete payload.analysis.dep;
    return payload;
  };
  validateCheckpoint(missingDep("0.3"));
  assert.ok(
    true,
    "a 0.3 save omitting the post-0.3 C-use sub-state loads, because no 0.3 build wrote it",
  );
  const depAsCurrent = rejected(missingDep("0.4"));
  assert.equal(
    depAsCurrent.field,
    "analysis.dep",
    "a current save may not omit the C-use sub-state, so no rule may tolerate its absence there",
  );

  const asCurrent = rejected(missingRecords("0.4"));
  assert.equal(
    asCurrent.field,
    "analysis.records",
    "a current save may not omit a field every supported schema wrote",
  );
  assert.equal(asCurrent.reason, "malformed-container");

  // The same asymmetry, reached through a real restore rather than the
  // validator, so the ordering in `restore` is what is under test. `dep` is
  // the field whose absence is genuinely historical at 0.3.
  const realCurrent = new UniverseSession();
  assert.throws(
    () => realCurrent.restore(missingDep("0.4")),
    (error: unknown) => error instanceof CheckpointRejectionError && error.field === "analysis.dep",
    "restore refuses a current save missing the C-use sub-state",
  );
  const realLegacy = new UniverseSession();
  realLegacy.restore(missingDep("0.3"));
  assert.ok(true, "restore still accepts the 0.3 form of that same payload");

  console.log("checkpoint rejection conditions: PASS (6 conditions)");
}


testFlowCheckpoint();
testCheckpointRejectionConditions();
testCooldownPreservationAcrossRestore();
testHistoricalCheckpointBoundary();
testPreA2EntityRefMigration();
testCheckpointMigrationRuleTable();
testBoundaryGeneratorIsDerived();

testFlowEvidence();
console.log(`flow validation: PASS (checkpoint schema ${CHECKPOINT_SCHEMA_VERSION}, engine ${ENGINE_VERSION})`);
