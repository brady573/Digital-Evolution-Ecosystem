import assert from "node:assert/strict";
import { EcologyObserver, type ObservationFrame } from "../../packages/sim-analysis/src/index.ts";
import { UniverseSession } from "../../packages/sim-runtime/src/session.ts";
import type { EngineConfig } from "../../packages/contracts/src/index.ts";
import { ENGINE_VERSION } from "../../packages/sim-core/src/index.ts";
import { CHECKPOINT_SCHEMA_VERSION } from "../../packages/sim-runtime/src/session.ts";

/**
 * Issue #30 Phase C1: C-dependency guild arcs. The guild is role-defined
 * (byproduct scavengers) and lineage-identified (top C-energy consumer):
 * lineage-level C commitment never exceeds ~15% energy share in surveyed
 * biology, so lineage-commitment thresholds would never fire. Thresholds
 * mirror the crossfeeding family and are flagged as Owner-visible constants.
 */

function frame(
  tick: number,
  o: {
    scav?: number; pop?: number; cShare?: number; intervalProd?: number;
    top?: { id: number; share: number } | null;
  } = {},
): ObservationFrame {
  const pop = o.pop ?? 400;
  const scav = o.scav ?? 0;
  const top = o.top ?? null;
  return {
    tick, population: pop, starting_population: 30,
    active_population: pop, dormant_population: 0, dormant_fraction: 0,
    c_energy_share: o.cShare ?? 0.08,
    crossfeeder_fraction: pop > 0 ? scav / pop : 0,
    partitioned: false, dominant_role: "mixed_primary",
    roles: { byproduct_scavenger: scav, mixed_primary: Math.max(0, pop - scav) },
    wake_events: 0, wake_clades: {}, dormant_clade_fraction: {}, clade_totals: {},
    flows: {
      tick,
      lineages: top ? [{
        lineageId: top.id, members: Math.max(1, scav),
        consumedA: 0, consumedB: 0, consumedC: 100,
        energyA: (1 - top.share) * 100, energyB: 0, energyC: top.share * 100,
        producedC: 50,
      }] : [],
      totals: {
        members: pop, consumedA: 0, consumedB: 0, consumedC: 100,
        energyA: 0, energyB: 0, energyC: 100, producedC: 50,
      },
    },
    interval: {
      producedC: o.intervalProd ?? 60,
      consumedA: 0, consumedB: 0, consumedC: 0,
      energyA: 0, energyB: 0, energyC: 0, births: 0, deaths: 0,
    },
  };
}

function depRecords(observer: EcologyObserver) {
  return observer.records.filter((r: any) => r.kind === "dependency");
}

function testFormAndEstablish() {
  const observer = new EcologyObserver();
  observer.observe(frame(40000, { scav: 20 })); // 5% + cShare .08: forming
  assert.equal((observer as any).dep.state, "forming", "guild enters forming");
  assert.equal(depRecords(observer).length, 0, "forming narrates nothing");
  observer.observe(frame(42500, { scav: 20 }));
  assert.equal((observer as any).dep.state, "forming", "persistence not yet met");
  // Established needs the stricter band (6%): still forming here.
  observer.observe(frame(45000, { scav: 28, top: { id: 9, share: 0.4 } })); // 7%
  assert.equal((observer as any).dep.state, "established", "guild establishes after persistence");
  const records = depRecords(observer);
  assert.equal(records.length, 1, "one establishment record");
  assert.equal(records[0].phase, "established", "established phase");
  assert.equal(records[0].tick, 45000, "record stamped at the establishing tick");
  assert.deepEqual(records[0].entity_refs, [9], "top consumer lineage referenced");
  assert.equal((observer as any).dep.baselineProduced, 60, "production baseline captured");
  assert.equal((observer as any).dep.estScav, 0.07, "established guild level captured");
  console.log("dependency form + establish: PASS");
}

function testFormAborted() {
  const observer = new EcologyObserver();
  observer.observe(frame(40000, { scav: 20 }));
  assert.equal((observer as any).dep.state, "forming", "guild enters forming");
  observer.observe(frame(41000, { scav: 2 })); // guild never materializes
  assert.equal((observer as any).dep.state, "absent", "forming aborts cleanly");
  assert.equal(depRecords(observer).length, 0, "aborted forming narrates nothing");
  console.log("dependency forming abort: PASS");
}

function testEstablishedRidesNoise() {
  const observer = new EcologyObserver();
  observer.observe(frame(40000, { scav: 28, top: { id: 9, share: 0.4 } }));
  observer.observe(frame(45000, { scav: 28, top: { id: 9, share: 0.4 } }));
  assert.equal((observer as any).dep.state, "established", "guild established");
  // Dip below the establishment band but above collapse: holds, no record.
  observer.observe(frame(47500, { scav: 16, top: { id: 9, share: 0.35 } })); // 4%
  observer.observe(frame(50000, { scav: 28, top: { id: 9, share: 0.4 } }));
  assert.equal((observer as any).dep.state, "established", "established rides out noise");
  assert.equal(depRecords(observer).length, 1, "noise narrates nothing");
  console.log("dependency noise tolerance: PASS");
}

function testDisruption() {
  const observer = new EcologyObserver();
  observer.observe(frame(40000, { scav: 28, top: { id: 9, share: 0.4 } }));
  observer.observe(frame(45000, { scav: 28, top: { id: 9, share: 0.4 } }));
  // Upstream collapse + guild collapse, sustained.
  observer.observe(frame(47500, { scav: 4, intervalProd: 20, top: { id: 9, share: 0.2 } }));
  assert.equal((observer as any).dep.state, "established", "collapse persistence not yet met");
  observer.observe(frame(52500, { scav: 4, intervalProd: 20, top: { id: 9, share: 0.2 } }));
  assert.equal((observer as any).dep.state, "disrupted", "guild disrupts after persistence");
  const records = depRecords(observer);
  assert.equal(records.length, 2, "establishment + disruption records");
  assert.equal(records[1].phase, "disrupted", "disrupted phase");
  assert.equal(records[1].title, "The C-dependent guild collapsed", "collapse titled plainly");
  assert.ok(records[1].summary.includes("Scavenger share fell from 7%"), "guild loss quantified");
  assert.ok(records[1].summary.includes("per-stride C production stood at"), "production reported as measured context");
  assert.deepEqual(records[1].entity_refs, [9], "prior top consumer referenced");
  console.log("dependency disruption: PASS");
}

function testProductionIsContextNotTripwire() {
  const observer = new EcologyObserver();
  observer.observe(frame(40000, { scav: 28, top: { id: 9, share: 0.4 } }));
  observer.observe(frame(45000, { scav: 28, top: { id: 9, share: 0.4 } }));
  // Guild collapses while total C output holds (marginal specialists starve
  // first): the guild tripwire still fires, production is reported as read.
  observer.observe(frame(47500, { scav: 4, intervalProd: 60, top: { id: 9, share: 0.2 } }));
  observer.observe(frame(52500, { scav: 4, intervalProd: 60, top: { id: 9, share: 0.2 } }));
  assert.equal((observer as any).dep.state, "disrupted", "guild collapse alone disrupts");
  const records = depRecords(observer);
  assert.equal(records.length, 2, "establishment + disruption records");
  assert.ok(records[1].summary.includes("stood at 100%"), "held production reported honestly");
  assert.ok(!records[1].summary.includes("followed"), "no causal claim in a single-run record");
  console.log("dependency production as context: PASS");
}

function testRecoverySameLineage() {
  const observer = new EcologyObserver();
  observer.observe(frame(40000, { scav: 28, top: { id: 9, share: 0.4 } }));
  observer.observe(frame(45000, { scav: 28, top: { id: 9, share: 0.4 } }));
  observer.observe(frame(47500, { scav: 4, intervalProd: 20, top: { id: 9, share: 0.2 } }));
  observer.observe(frame(52500, { scav: 4, intervalProd: 20, top: { id: 9, share: 0.2 } }));
  assert.equal((observer as any).dep.state, "disrupted", "guild disrupted");
  observer.observe(frame(57500, { scav: 28, intervalProd: 60, top: { id: 9, share: 0.38 } }));
  assert.equal((observer as any).dep.state, "established", "guild recovers into established");
  const records = depRecords(observer);
  assert.equal(records.length, 3, "establishment + disruption + recovery records");
  assert.equal(records[2].phase, "recovered", "recovered phase");
  assert.ok(records[2].title.includes("recovered"), "same lineage worded as recovery");
  assert.deepEqual(records[2].entity_refs, [9], "returning lineage referenced");
  console.log("dependency recovery: PASS");
}

function testRecoveryReplacement() {
  const observer = new EcologyObserver();
  observer.observe(frame(40000, { scav: 28, top: { id: 9, share: 0.4 } }));
  observer.observe(frame(45000, { scav: 28, top: { id: 9, share: 0.4 } }));
  observer.observe(frame(47500, { scav: 4, intervalProd: 20, top: { id: 9, share: 0.2 } }));
  observer.observe(frame(52500, { scav: 4, intervalProd: 20, top: { id: 9, share: 0.2 } }));
  observer.observe(frame(57500, { scav: 28, intervalProd: 60, top: { id: 41, share: 0.35 } }));
  const records = depRecords(observer);
  assert.equal(records.length, 3, "establishment + disruption + replacement records");
  assert.ok(records[2].title.includes("took over"), "new lineage worded as replacement");
  assert.deepEqual(records[2].entity_refs, [41], "replacing lineage referenced");
  console.log("dependency replacement: PASS");
}

function testZeroPopulationSafe() {
  const observer = new EcologyObserver();
  observer.observe(frame(40000, { scav: 0, pop: 0, cShare: 0 }));
  assert.equal((observer as any).dep.state, "absent", "extinction forms nothing");
  assert.equal(depRecords(observer).length, 0, "extinction narrates no dependency");
  console.log("dependency extinction safety: PASS");
}

testFormAndEstablish();
testFormAborted();
testEstablishedRidesNoise();
testDisruption();
testProductionIsContextNotTripwire();
testRecoverySameLineage();
testRecoveryReplacement();
testZeroPopulationSafe();

// --- Integration: full arc on one deterministic run --------------------------
// Balanced seed 24681357: guild establishes @45431, drought_b @~60k collapses
// it (16% -> 3% with production at 58%: the relative tripwire firing on real
// dynamics), and a new lineage takes over @91113. Recovery-with-
// reorganization, honestly worded, bit-for-bit reproducible.

const FIXTURE_SEED = 24681357;
function fixtureConfig(seed: number): EngineConfig {
  return {
    seed, start: 0.58, prod: 0.77, cap: 360, pop: 30, div: 0.35, mr: 0.03,
    ms: 0.12, press: 1.0875, patch: 0.6, resource_b_fraction: 0.5, cat: "global", st: null,
    resource_model: "definition_driven_substances", resource_grid: 60,
    enable_byproduct: true, enable_dormancy: true, study: true,
  };
}

function settle(session: UniverseSession, target: number): void {
  for (let i = 0; i < 2000 && session.snapshot().tick < target; i++) {
    const snapshot = session.advance(1000);
    const pending = snapshot.pendingDecision;
    if (pending) session.resolveEventDecision(pending.opportunityId, "keep-watching");
  }
  const leftover = session.snapshot().pendingDecision;
  if (leftover) session.resolveEventDecision(leftover.opportunityId, "keep-watching");
  assert.equal(session.snapshot().tick >= target, true, `must reach tick ${target}`);
}

function testFixtureArc() {
  const session = new UniverseSession();
  session.create(fixtureConfig(FIXTURE_SEED));
  settle(session, 60000);
  session.applyIntervention(
    { schemaVersion: 1, kind: "nutrient_disturbance", mode: "drought_b" },
    "dependency validation",
  );
  settle(session, 120000);
  const records = (session.analysis as any).records.filter((r: any) => r.kind === "dependency");
  assert.equal(records.length, 3, "establishment, disruption, and replacement all fire");
  assert.equal(records[0].phase, "established", "first record establishes");
  assert.equal(records[0].tick, 45431, "establishment is deterministic");
  assert.deepEqual(records[0].entity_refs, [1140], "founding top consumer identified");
  assert.equal(records[1].phase, "disrupted", "second record disrupts");
  assert.equal(records[1].tick, 81324, "disruption is deterministic");
  assert.deepEqual(records[1].entity_refs, [1140], "disruption names the fallen consumer");
  assert.equal(records[2].phase, "recovered", "third record recovers");
  assert.equal(records[2].tick, 91113, "recovery is deterministic");
  assert.ok(records[2].title.includes("took over"), "new lineage worded as replacement");
  assert.deepEqual(records[2].entity_refs, [1994], "replacing lineage identified");
  assert.ok(
    records[2].entity_refs[0] !== records[0].entity_refs[0],
    "recovery with reorganization, not return",
  );
  console.log("dependency fixture arc: PASS");
}

function testTradeoffHolds() {
  // Slice requirement: strong C-processing must cost enough that universal
  // maximal C use is not trivially optimal. Mechanism: BUC maintenance
  // (.010*bu^2 per active tick) against C yield 9 below primary yields.
  // Guards the cost term against accidental removal; threshold has ~35%
  // headroom over the highest surveyed maximum (0.73, abundant).
  const cases: Array<[string, EngineConfig]> = [
    ["balanced", fixtureConfig(FIXTURE_SEED)],
    ["abundant", { ...fixtureConfig(821947219), start: 2.01, prod: 3.76 }],
  ];
  for (const [label, cfg] of cases) {
    const session = new UniverseSession();
    session.create(cfg);
    settle(session, 60000);
    const bu = (session.snapshot().metrics as any).traits?.byproduct_use ?? {};
    assert.ok(bu.max < 1.0, `${label}: bu must not fixate at max (max=${bu.max})`);
    assert.ok(bu.max > bu.min, `${label}: bu diversity persists`);
  }
  console.log("tradeoff holds: PASS");
}

testFixtureArc();
testTradeoffHolds();
console.log(`dependency validation: PASS (engine ${ENGINE_VERSION})`);
