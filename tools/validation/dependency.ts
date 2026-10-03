import assert from "node:assert/strict";
import { EcologyObserver } from "../../packages/sim-analysis/src/index.ts";
import { UniverseSession } from "../../packages/sim-runtime/src/session.ts";
import type { EngineConfig, ObservationFrame } from "../../packages/contracts/src/index.ts";
import {
  catalystIds,
  engineCatalystModeFor,
  isSupportedIntervention,
} from "../../packages/sim-decisions/src/index.ts";
import { ENGINE_VERSION } from "../../packages/sim-core/src/index.ts";
import { CHECKPOINT_SCHEMA_VERSION } from "../../packages/sim-runtime/src/session.ts";

/** Fast mode runs the synthetic unit arcs; full mode adds live integration (fixture, multi-seed, tradeoff, washout). */
const FAST = process.argv.includes("--fast");

/**
 * The live-integration phase, as a name-to-function map.
 *
 * These five are the long deterministic runs: together they account for
 * essentially all of this suite's cost, and the CI shards that cover them
 * partition this map. They are grouped by name so `tools/validation/run.ts` can
 * run a subset on a different runner while still executing every one of them
 * across the DAG.
 *
 * `--list` prints the names, and `tools/validation/validation-arch.ts` asserts
 * that the union of the shards' `--only` lists equals exactly this key set. That
 * is what makes sharding this suite evidence-preserving rather than merely
 * convenient: a dropped or duplicated test name fails the architecture gate.
 */
const LONG_TESTS = {
  arc: testFixtureArc,
  checkpoint: testWashoutCheckpoint,
  possibility: testMultiSeedPossibility,
  tradeoff: testTradeoffHolds,
  washout: testWashoutReliance,
} as const;

type LongTestName = keyof typeof LONG_TESTS;

if (process.argv.includes("--list")) {
  for (const name of Object.keys(LONG_TESTS) as LongTestName[]) console.log(name);
  process.exit(0);
}

/** `--only=a,b` restricts the live phase; default is all of it. */
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const selected: LongTestName[] = onlyArg
  ? (onlyArg.slice("--only=".length).split(",") as LongTestName[])
  : (Object.keys(LONG_TESTS) as LongTestName[]);

/**
 * `--skip-policy` omits the fast phase, so a long-phase shard does not
 * re-execute policy invariants that another shard already proved. Every long
 * test is independent of the policy arcs, so the union of the shards is the
 * whole suite with nothing executed twice.
 */
const SKIP_POLICY = process.argv.includes("--skip-policy");

for (const name of selected) {
  if (!(name in LONG_TESTS)) {
    console.error(`unknown dependency long test: ${name} (known: ${Object.keys(LONG_TESTS).join(", ")})`);
    process.exit(2);
  }
}


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
    extraLineages?: Array<{ id: number; members: number; eA: number; eB: number; eC: number; prod?: number }>;
  } = {},
): ObservationFrame {
  const pop = o.pop ?? 400;
  const scav = o.scav ?? 0;
  const top = o.top ?? null;
  const lineages: ObservationFrame["flows"]["lineages"] = top ? [{
    lineageId: top.id, members: Math.max(1, scav),
    consumedA: 0, consumedB: 0, consumedC: 100,
    energyA: (1 - top.share) * 100, energyB: 0, energyC: top.share * 100,
    producedC: 50,
  }] : [];
  for (const extra of o.extraLineages ?? []) {
    lineages.push({
      lineageId: extra.id, members: extra.members,
      consumedA: 0, consumedB: 0, consumedC: 100,
      energyA: extra.eA, energyB: extra.eB, energyC: extra.eC,
      producedC: extra.prod ?? 0,
    });
  }
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
      lineages,
      totals: {
        members: pop, consumedA: 0, consumedB: 0, consumedC: 100,
        energyA: 0, energyB: 0, energyC: 100, producedC: 50,
      },
    },
    interval: {
      producedC: o.intervalProd ?? 60,
      consumedA: 0, consumedB: 0, consumedC: 0,
      energyA: 0, energyB: 0, energyC: 0, births: 0, deaths: 0,
      wasteProduced: 0, wasteRemoved: 0, wasteDecayed: 0,
      burdenEnergy: 0, cleanupEnergy: 0, cleanupExec: 0,
    },
    intervalFlows: {
      tick, strideTicks: 251, lineages: [],
      totals: {
        netMembers: 0, consumedA: 0, consumedB: 0, consumedC: 0,
        energyA: 0, energyB: 0, energyC: 0, producedC: o.intervalProd ?? 60,
        births: 0, deaths: 0,
      },
    },
  };
}

function depRecords(observer: EcologyObserver) {
  return observer.records.filter((r: any) => r.kind === "cuse");
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
  assert.deepEqual(records[0].entity_refs, [{ kind: "lineage", id: 9 }], "top consumer lineage referenced");
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
  assert.equal(records[1].title, "The C-using guild collapsed", "collapse titled plainly");
  assert.ok(records[1].summary.includes("Scavenger share fell from 7%"), "guild loss quantified");
  assert.ok(records[1].summary.includes("per-stride C production stood at"), "production reported as measured context");
  assert.deepEqual(records[1].entity_refs, [{ kind: "lineage", id: 9 }], "prior top consumer referenced");
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
  assert.equal((observer as any).dep.state, "disrupted", "first return restarts the clock");
  assert.equal(depRecords(observer).length, 2, "first return narrates nothing");
  observer.observe(frame(62500, { scav: 28, intervalProd: 60, top: { id: 9, share: 0.38 } }));
  assert.equal((observer as any).dep.state, "established", "durable return recovers");
  const records = depRecords(observer);
  assert.equal(records.length, 3, "establishment + disruption + recovery records");
  assert.equal(records[2].tick, 62500, "recovery stamped at persistence");
  assert.equal(records[2].phase, "recovered", "recovered phase");
  assert.ok(records[2].title.includes("recovered"), "same lineage worded as recovery");
  // Decision 3 audit: this is a C-use guild recovery record, not the
  // dormant-return one. `depRecords` filters the guild detector, and the guild's
  // top consumer is a lineage (`flows.lineages[].lineageId`), so `L-` and
  // "lineage" are both correct here. The assertion now pins the kind as well as
  // the id, so a future change that reclassified this ref as a clade would fail
  // rather than pass on the bare id alone.
  assert.deepEqual(records[2].entity_refs, [{ kind: "lineage", id: 9 }], "returning lineage referenced");
  console.log("dependency recovery: PASS");
}

function testRecoveryReplacement() {
  const observer = new EcologyObserver();
  observer.observe(frame(40000, { scav: 28, top: { id: 9, share: 0.4 } }));
  observer.observe(frame(45000, { scav: 28, top: { id: 9, share: 0.4 } }));
  observer.observe(frame(47500, { scav: 4, intervalProd: 20, top: { id: 9, share: 0.2 } }));
  observer.observe(frame(52500, { scav: 4, intervalProd: 20, top: { id: 9, share: 0.2 } }));
  observer.observe(frame(57500, { scav: 28, intervalProd: 60, top: { id: 41, share: 0.35 } }));
  assert.equal(depRecords(observer).length, 2, "first return narrates nothing");
  observer.observe(frame(62500, { scav: 28, intervalProd: 60, top: { id: 41, share: 0.35 } }));
  const records = depRecords(observer);
  assert.equal(records.length, 3, "establishment + disruption + replacement records");
  assert.equal(records[2].title, "A new lineage became a major C consumer", "new lineage worded as major consumer");
  assert.ok(records[2].summary.includes("succeeding L-0009"), "replaced lineage named factually");
  assert.deepEqual(records[2].entity_refs, [{ kind: "lineage", id: 41 }], "replacing lineage referenced");
  console.log("dependency replacement: PASS");
}

function testRecoveryNeedsFreshPersistence() {
  // Review defect: candidateSince survived establishment and disruption, so
  // the first post-disruption return fired immediately. The recovery clock
  // must restart at disruption.
  const observer = new EcologyObserver();
  observer.observe(frame(40000, { scav: 28, top: { id: 9, share: 0.4 } }));
  observer.observe(frame(45000, { scav: 28, top: { id: 9, share: 0.4 } }));
  observer.observe(frame(47500, { scav: 4, intervalProd: 20, top: { id: 9, share: 0.2 } }));
  observer.observe(frame(52500, { scav: 4, intervalProd: 20, top: { id: 9, share: 0.2 } }));
  assert.equal((observer as any).dep.state, "disrupted", "guild disrupted");
  // Sub-persistence return: starts the clock but narrates nothing.
  observer.observe(frame(53000, { scav: 28, intervalProd: 60, top: { id: 9, share: 0.38 } }));
  assert.equal((observer as any).dep.state, "disrupted", "brief return does not recover");
  assert.equal(depRecords(observer).length, 2, "brief return narrates nothing");
  // Loss resets the clock; a fresh durable return records.
  observer.observe(frame(54000, { scav: 4, intervalProd: 20, top: { id: 9, share: 0.2 } }));
  assert.equal((observer as any).dep.state, "disrupted", "relapse stays disrupted");
  observer.observe(frame(55000, { scav: 28, intervalProd: 60, top: { id: 9, share: 0.38 } }));
  assert.equal((observer as any).dep.state, "disrupted", "restarted clock not yet met");
  observer.observe(frame(60000, { scav: 28, intervalProd: 60, top: { id: 9, share: 0.38 } }));
  assert.equal((observer as any).dep.state, "established", "durable return recovers");
  const records = depRecords(observer);
  assert.equal(records.length, 3, "only the durable return records");
  assert.equal(records[2].tick, 60000, "recovery stamped at persistence, not first sighting");
  console.log("dependency recovery persistence: PASS");
}

function testTopConsumerRanksAbsolute() {
  // Review defect: a singleton at 100% C outranked the guild's main supplier.
  // Rank by absolute C-energy contribution instead.
  const observer = new EcologyObserver();
  const tiny = { id: 7, members: 1, eA: 0, eB: 0, eC: 100 };
  const main = { id: 9, members: 100, eA: 6000, eB: 0, eC: 4000 };
  observer.observe(frame(40000, { scav: 28, top: null, extraLineages: [tiny, main] }));
  observer.observe(frame(45000, { scav: 28, top: null, extraLineages: [tiny, main] }));
  const records = depRecords(observer);
  assert.equal(records.length, 1, "one establishment record");
  assert.deepEqual(records[0].entity_refs, [{ kind: "lineage", id: 9 }], "main supplier named, not the 100% singleton");
  console.log("dependency absolute ranking: PASS");
}

function testDiffuseGuildNamesNobody() {
  // C use spread across many lineages with no meaningful consumer: the guild
  // still establishes, but no lineage is named.
  const diffuse = Array.from({ length: 12 }, (_, i) => ({ id: 100 + i, members: 5, eA: 920, eB: 0, eC: 80 }));
  const observer = new EcologyObserver();
  observer.observe(frame(40000, { scav: 28, extraLineages: diffuse }));
  observer.observe(frame(45000, { scav: 28, extraLineages: diffuse }));
  const records = depRecords(observer);
  assert.equal(records.length, 1, "diffuse guild still establishes");
  assert.deepEqual(records[0].entity_refs, [], "no lineage named without a meaningful consumer");
  // Review defect: disruption unconditionally emitted the stored consumer,
  // reintroducing attribution the establishment record had refused. A diffuse
  // establishment must disrupt anonymously too.
  observer.observe(frame(47500, { scav: 4, intervalProd: 20 }));
  observer.observe(frame(52500, { scav: 4, intervalProd: 20 }));
  assert.equal((observer as any).dep.state, "disrupted", "diffuse guild still disrupts");
  const after = depRecords(observer);
  assert.equal(after.length, 2, "establishment + disruption records");
  assert.deepEqual(after[1].entity_refs, [], "disruption names nobody when establishment named nobody");
  console.log("dependency diffuse guild: PASS");
}

function testZeroPopulationSafe() {
  const observer = new EcologyObserver();
  observer.observe(frame(40000, { scav: 0, pop: 0, cShare: 0 }));
  assert.equal((observer as any).dep.state, "absent", "extinction forms nothing");
  assert.equal(depRecords(observer).length, 0, "extinction narrates no dependency");
  console.log("dependency extinction safety: PASS");
}

if (!SKIP_POLICY) {
  testFormAndEstablish();
  testFormAborted();
  testEstablishedRidesNoise();
  testDisruption();
  testProductionIsContextNotTripwire();
  testRecoverySameLineage();
  testRecoveryReplacement();
  testRecoveryNeedsFreshPersistence();
  testTopConsumerRanksAbsolute();
  testDiffuseGuildNamesNobody();
  testZeroPopulationSafe();
}

// --- Integration: full arc on one deterministic run --------------------------
// Balanced seed 24681357 on current biology: drought_b @~60k delays the
// guild, which then establishes @276100 with a diffuse consumer base.
// Disruption/recovery do NOT occur here: established guilds ride out shocks
// on 0.24 as under drought_a on 0.21. The full arc machinery stays
// unit-covered (and 0.21-pinned historically); integration proves what the
// current biology actually does. (0.24.0 re-pin: was @91615; occupancy
// friction slows post-shock buildup ~3x.)

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

/**
 * Advance to EXACTLY `target`, never past it, resolving no-op pending decisions
 * on the way. `settle` above deliberately only guarantees `>= target`, because
 * the fixtures that pin establishment ticks were recorded with that overshoot.
 *
 * A matched assay needs a fixed AGE, not a fixed absolute tick. If the
 * intervention lands mid-segment — a catalyst decision window opening earlier
 * shifts where the fork falls — then sampling at an absolute tick measures a
 * different assay length each time, and a duration-sensitive ratio moves for
 * reasons that have nothing to do with the biology under test.
 */
function settleExactly(session: UniverseSession, target: number): void {
  for (let i = 0; i < 5000 && session.snapshot().tick < target; i++) {
    const remaining = target - session.snapshot().tick;
    const snapshot = session.advance(Math.max(1, Math.min(1000, remaining)));
    const pending = snapshot.pendingDecision;
    if (pending) session.resolveEventDecision(pending.opportunityId, "keep-watching");
  }
  const leftover = session.snapshot().pendingDecision;
  if (leftover) session.resolveEventDecision(leftover.opportunityId, "keep-watching");
  assert.equal(session.snapshot().tick, target, `must land exactly on tick ${target}`);
}

function testFixtureArc() {
  const session = new UniverseSession();
  session.create(fixtureConfig(FIXTURE_SEED));
  settle(session, 60000);
  session.applyIntervention(
    { schemaVersion: 1, kind: "nutrient_disturbance", mode: "drought_b" },
    "dependency validation",
  );
  // Slice 1 re-pin (af9ad23 precedent): drought-shocked guild buildup is
  // markedly slower under occupancy friction, so establishment lands
  // @276100 rather than @91615 (probe-verified to 400k; same single diffuse
  // record, still no disruption). Horizon follows the trajectory 120k ->
  // 300k; structure unchanged.
  settle(session, 300000);
  const records = (session.analysis as any).records.filter((r: any) => r.kind === "cuse");
  // TEMPORARY CI mapping (revert before merge): detritus-engine arc values.
  console.log("MAP-ARC:" + JSON.stringify(records.map((r: any) => ({ phase: r.phase, tick: r.tick, refs: r.entity_refs }))));
  assert.equal(records.length, 1, "one establishment record (no disruption on this run)");
  assert.equal(records[0].phase, "established", "record establishes");
  assert.equal(records[0].tick, 276100, "establishment is deterministic under the current catalyst policy");
  assert.deepEqual(records[0].entity_refs, [], "diffuse founding names nobody");
  console.log("dependency fixture arc: PASS");
}

function testTradeoffHolds() {
  // Slice requirement: strong C-processing must cost enough that universal
  // maximal C use is not trivially optimal. Mechanism: BUC maintenance
  // (.010*bu^2 per active tick) against C yield 9 below primary yields.
  // Guards the cost term against accidental removal; threshold has 30%
  // headroom over the highest surveyed maximum (0.7683, abundant). Measured
  // on the current engine across 4 seeds x 4 regimes in
  // testdata/provenance-0.22.0.json, which supersedes an earlier survey that
  // put it at 0.73 with ~35% headroom: the threshold still holds, but the
  // margin is thinner than that figure claimed, so the number is corrected
  // rather than the assertion.
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

function testMultiSeedPossibility() {
  // Possibility, not frequency: the guild must be realizable without being
  // required everywhere. Non-establishment on other seeds is retained
  // evidence, not failure. Pinned deterministically on fixed seeds.
  const established: string[] = [];
  // Slice 1 re-pin (af9ad23 precedent): guild establishment is delayed
  // (~2-5x later across all four seeds: 74k/105k/71k/126k at 150k horizon)
  // by occupancy friction slowing guild buildup, so the horizon extends
  // 60k -> 150k and the pinned seed moves 55973 -> 70531. Same seed (no
  // seed-shopping); possibility structure unchanged (realizable somewhere,
  // required nowhere).
  // Slice 2B re-pin: detritus wealth shifts guild timing again (probe:
  // pinned seed establishes @141062, still inside the 150k horizon with
  // thinning margin — flagged, not widened further without evidence).
  // Same seed, same structure.
  for (const seed of [821947219, 2088626459, 3543950664, 2121676508]) {
    const session = new UniverseSession();
    session.create(fixtureConfig(seed));
    settle(session, 150000);
    const records = (session.analysis as any).records.filter(
      (r: any) => r.kind === "cuse" && r.phase === "established",
    );
    if (records.length > 0) established.push(`${seed}@${records[0].tick}`);
  }
  assert.ok(established.length >= 1, "dependency establishment must be realizable");
  assert.ok(
    established.some((s) => s === "3543950664@141062"),
    "pinned establishment reproduces exactly",
  );
  console.log(`dependency multi-seed possibility [${established.join(", ")}]: PASS`);
}

function testWashoutReliance() {
  // The washout is a dev/test-only offer. It is a valid CANDIDATE for the
  // product, but promoting it is explicitly not part of this PR, so the property
  // guarded here is ISOLATION: absent from the default catalog, reachable only
  // through the opt-in, and still applying through the ordinary recorded
  // deterministic path rather than a special one.
  assert.equal(
    engineCatalystModeFor({ schemaVersion: 1, kind: "nutrient_disturbance", mode: "c_washout" }),
    "cWashout",
    "washout maps to the engine sink mode",
  );
  assert.ok(
    isSupportedIntervention({ schemaVersion: 1, kind: "nutrient_disturbance", mode: "c_washout" }),
    "washout applies through the recorded path",
  );
  assert.ok(!catalystIds().some((id) => String(id) === "c-washout"),
    "the washout is absent from the production catalog");
  assert.equal(catalystIds().length, 3, "the production catalog is unchanged in size");
  assert.ok(catalystIds({ includeTestCatalysts: true }).includes("c-washout"),
    "the washout is reachable through the explicit test opt-in");
  assert.equal(catalystIds({ includeTestCatalysts: true }).filter((id) => String(id) === "c-washout").length, 1,
    "and appears exactly once, with no duplicate offer");
  // Stage 2 Level-3: matched C-availability perturbation. An established
  // guild (20% scavengers) faces a recorded environmental C sink on the live
  // branch while the exact control twin runs untouched. The guild collapses
  // to 4-6% against 20-27% control while population holds: material reliance
  // on continued C availability, demonstrated by controlled comparison
  // rather than temporal order. Deterministic on the fixture seed.
  const session = new UniverseSession();
  session.create(fixtureConfig(FIXTURE_SEED));
  settle(session, 60000);
  session.createControlFork();
  session.applyIntervention(
    { schemaVersion: 1, kind: "nutrient_disturbance", mode: "c_washout" },
    "reliance assay",
  );
  // The assay has a fixed AGE, not a fixed absolute sample tick. The sink
  // starts at whatever tick the fork actually landed on, so measuring at an
  // absolute tick would compare different-length assays whenever pre-assay
  // decision timing shifts. C is a fast-cycling pool, so its residual is
  // sensitive to exactly that.
  const washTick = session.snapshot().tick;
  settleExactly(session, washTick + 15000);
  const snap = session.snapshot();
  const live = snap.metrics as any;
  const control = snap.control!.metrics as any;
  const liveShare = (live.metabolic_roles?.counts?.byproduct_scavenger || 0) / live.population;
  const controlShare = (control.metabolic_roles?.counts?.byproduct_scavenger || 0) / control.population;
  assert.ok(liveShare < 0.02, `washed guild collapses (live ${liveShare.toFixed(3)})`);
  assert.ok(controlShare > 0.03, `control guild exists (control ${controlShare.toFixed(3)})`);
  assert.ok(liveShare < controlShare, "washed guild underperforms its own twin");
  assert.ok(liveShare < controlShare / 2, "guild effect is large, not marginal");
  assert.ok(
    live.population > control.population * 0.8,
    `no wipeout: live ${live.population} vs control ${control.population}`,
  );
  assert.ok(
    live.metabolite_c.stock < control.metabolite_c.stock / 2,
    "sink suppresses C re-accumulation",
  );
  const liveRemovals = live.nutrient_field.accounting.removal_events as any[];
  const controlRemovals = control.nutrient_field.accounting.removal_events as any[];
  assert.ok(liveRemovals.some((e: any) => e.type === "cWashout"), "washout recorded on live");
  assert.ok(
    liveRemovals.every((e: any) => e.type === "cWashout"),
    "washout touches C only: no A/B removal on live",
  );
  assert.equal(controlRemovals.length, 0, "control records no removals");
  console.log(
    `washout reliance (live ${(liveShare * 100).toFixed(1)}% vs control ${(controlShare * 100).toFixed(1)}%): PASS`,
  );
}

function testWashoutCheckpoint() {
  // Review 3: a timed sink is future-biology state. Prove a checkpoint taken
  // mid-sink restores the remaining duration/strength exactly and both
  // branches continue identically through expiry.
  const session = new UniverseSession();
  session.create(fixtureConfig(FIXTURE_SEED));
  settle(session, 60000);
  session.applyIntervention(
    { schemaVersion: 1, kind: "nutrient_disturbance", mode: "c_washout" },
    "checkpoint assay",
  );
  const washTick = session.snapshot().tick;
  settle(session, washTick + 5000);
  const liveSink = (session.simulation as any).resources.cSink;
  assert.deepEqual(liveSink, { end: washTick + 15000, factor: 50 }, "sink state exact mid-window");
  const restored = new UniverseSession();
  restored.restore(JSON.parse(JSON.stringify(session.checkpoint())));
  assert.deepEqual(
    (restored.simulation as any).resources.cSink,
    { end: washTick + 15000, factor: 50 },
    "restored sink keeps remaining duration and strength",
  );
  settle(session, washTick + 25000);
  settle(restored, washTick + 25000);
  const state = (s: UniverseSession) => {
    const m = s.snapshot().metrics as any;
    return {
      tick: s.snapshot().tick,
      pop: m.population,
      scav: m.metabolic_roles?.counts?.byproduct_scavenger || 0,
      cStock: Math.round(m.metabolite_c.stock * 1000),
      sink: (s.simulation as any).resources.cSink,
    };
  };
  assert.deepEqual(state(restored), state(session), "branches continue identically through expiry");
  assert.equal(state(session).sink, null, "sink expired on both branches");
  console.log("washout checkpoint continuation: PASS");
}

if (!FAST) {
  for (const name of selected) {
    LONG_TESTS[name]();
  }
  const scope = selected.length === Object.keys(LONG_TESTS).length
    ? ""
    : ` [long: ${selected.join(", ")}]`;
  console.log(`dependency validation: PASS${scope} (engine ${ENGINE_VERSION})`);
} else if (!SKIP_POLICY) {
  console.log(`dependency validation (fast): PASS (engine ${ENGINE_VERSION})`);
}
