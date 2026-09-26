import assert from "node:assert/strict";
import { EcologyObserver, type ObservationFrame } from "../../packages/sim-analysis/src/index.ts";
import { UniverseSession } from "../../packages/sim-runtime/src/session.ts";
import type { EngineConfig } from "../../packages/contracts/src/index.ts";
import { ENGINE_VERSION } from "../../packages/sim-core/src/index.ts";

/**
 * Issue #30 Slice 2 PR2: niche-construction arcs. Modification (waste) is
 * necessary but never sufficient: establishment also requires a durable
 * measured strategy SHIFT relative to the forming baseline (exposure,
 * tolerance, or cleanup moving by NC_STRAT_SHIFT) — a high exposure level
 * with no movement is occupancy, not construction. Records pair the two in
 * time without asserting causation. Thresholds are Owner-visible, calibrated
 * on 0.22 multi-config probes (patchwork establishes naturally;
 * balanced/harsh do not within 150k — possibility, never frequency; the
 * balanced negative is pinned below so retunes cannot silently make the arc
 * fire everywhere).
 *
 * Frame cadence note: the engine feeds the observer every EVENT_STRIDE (251
 * ticks), so production persistence windows resolve at 251-tick granularity.
 * Fixture gaps use 5500 ticks for a 5000-tick window — safely above the
 * threshold at any stride alignment, exactly as production observes it.
 */

function frame(
  tick: number,
  o: {
    pop?: number; waste?: number; exposed?: number; tol?: number; cu?: number;
    intervalProd?: number;
    producers?: Array<{ id: number; share: number }>;
    removers?: Array<{ id: number; share: number }>;
  } = {},
): ObservationFrame {
  const pop = o.pop ?? 400;
  const lineages: ObservationFrame["intervalFlows"]["lineages"] = [];
  for (const p of o.producers ?? []) {
    lineages.push({
      lineageId: p.id, netMembers: 0, consumedA: 0, consumedB: 0, consumedC: 0,
      energyA: 0, energyB: 0, energyC: 0, producedC: 0, births: 0, deaths: 0,
      wasteProduced: p.share * 100, wasteRemoved: 0, burdenEnergy: 0, cleanupEnergy: 0, cleanupExec: 0,
    });
  }
  for (const r of o.removers ?? []) {
    lineages.push({
      lineageId: r.id, netMembers: 0, consumedA: 0, consumedB: 0, consumedC: 0,
      energyA: 0, energyB: 0, energyC: 0, producedC: 0, births: 0, deaths: 0,
      wasteProduced: 0, wasteRemoved: r.share * 100, burdenEnergy: 0, cleanupEnergy: 0, cleanupExec: 0,
    });
  }
  return {
    tick, population: pop, starting_population: 30,
    active_population: pop, dormant_population: 0, dormant_fraction: 0,
    c_energy_share: 0.08, crossfeeder_fraction: 0.05,
    partitioned: false, dominant_role: "mixed_primary",
    roles: { mixed_primary: pop },
    wake_events: 0, wake_clades: {}, dormant_clade_fraction: {}, clade_totals: {},
    flows: {
      tick, lineages: [], totals: {
        members: pop, consumedA: 0, consumedB: 0, consumedC: 0,
        energyA: 0, energyB: 0, energyC: 0, producedC: 0,
      },
    },
    interval: {
      producedC: 0, consumedA: 0, consumedB: 0, consumedC: 0,
      energyA: 0, energyB: 0, energyC: 0, births: 0, deaths: 0,
      wasteProduced: o.intervalProd ?? 50, wasteRemoved: 0, wasteDecayed: 0,
      burdenEnergy: 0, cleanupEnergy: 0, cleanupExec: 0,
    },
    intervalFlows: {
      tick, strideTicks: 251, lineages,
      totals: {
        netMembers: 0, consumedA: 0, consumedB: 0, consumedC: 0,
        energyA: 0, energyB: 0, energyC: 0, producedC: 0, births: 0, deaths: 0,
        wasteProduced: o.intervalProd ?? 50, wasteRemoved: 0,
        burdenEnergy: 0, cleanupEnergy: 0, cleanupExec: 0,
      },
    },
    waste_fraction: o.waste ?? 0,
    waste_exposed_share: o.exposed ?? 0,
    tolerance_mean: o.tol ?? 0.2,
    cleanup_mean: o.cu ?? 0.06,
  };
}

function nicheRecords(observer: EcologyObserver) {
  return observer.records.filter((r: any) => r.kind === "niche");
}

function testFormAndEstablish() {
  const observer = new EcologyObserver();
  observer.observe(frame(60000, { waste: 0.1, exposed: 0.02 }));
  assert.equal((observer as any).niche.state, "forming", "modification enters forming");
  assert.equal(nicheRecords(observer).length, 0, "forming narrates nothing");
  observer.observe(frame(63000, { waste: 0.1, exposed: 0.02 }));
  assert.equal((observer as any).niche.state, "forming", "strategy shift still missing");
  // Exposure moves 0.02 -> 0.20: a genuine shift, not a level.
  observer.observe(frame(65500, { waste: 0.12, exposed: 0.2 }));
  assert.equal((observer as any).niche.state, "established", "paired shift establishes");
  const records = nicheRecords(observer);
  assert.equal(records.length, 1, "one establishment record");
  assert.equal(records[0].phase, "established", "established phase");
  assert.ok(records[0].summary.includes("not proof of cause"), "pairing hedged explicitly");
  assert.ok(records[0].summary.includes("up from"), "baseline quoted in evidence");
  console.log("niche form + establish: PASS");
}

function testNoEstablishOnExposureLevel() {
  // Regression: a high exposure LEVEL with no movement must not establish.
  // (Pre-fix shape: exposed 0.2 constant, only waste moving — established.)
  const observer = new EcologyObserver();
  observer.observe(frame(60000, { waste: 0.1, exposed: 0.2 }));
  assert.equal((observer as any).niche.state, "forming", "modification enters forming");
  observer.observe(frame(65500, { waste: 0.12, exposed: 0.2 }));
  assert.equal((observer as any).niche.state, "forming", "level without shift stays forming");
  assert.equal(nicheRecords(observer).length, 0, "occupancy alone narrates nothing");
  console.log("niche no-establish on level: PASS");
}

function testEstablishViaTraitShift() {
  const observer = new EcologyObserver();
  observer.observe(frame(60000, { waste: 0.1, exposed: 0.02, tol: 0.2 }));
  observer.observe(frame(65500, { waste: 0.1, exposed: 0.02, tol: 0.27 }));
  assert.equal((observer as any).niche.state, "established", "tolerance shift establishes without exposure");
  console.log("niche trait-shift path: PASS");
}

function testFormAborted() {
  const observer = new EcologyObserver();
  observer.observe(frame(60000, { waste: 0.1, exposed: 0.02 }));
  observer.observe(frame(61000, { waste: 0.02, exposed: 0 }));
  assert.equal((observer as any).niche.state, "absent", "lost modification aborts forming");
  assert.equal(nicheRecords(observer).length, 0, "aborted forming narrates nothing");
  console.log("niche forming abort: PASS");
}

function testDisruption() {
  const observer = new EcologyObserver();
  observer.observe(frame(60000, { waste: 0.1, exposed: 0.02 }));
  observer.observe(frame(65500, { waste: 0.12, exposed: 0.2 }));
  assert.equal((observer as any).niche.state, "established", "guild established");
  observer.observe(frame(70500, { waste: 0.02, exposed: 0 }));
  assert.equal((observer as any).niche.state, "established", "collapse persistence not yet met");
  observer.observe(frame(76000, { waste: 0.02, exposed: 0 }));
  assert.equal((observer as any).niche.state, "disrupted", "modification loss disrupts");
  const records = nicheRecords(observer);
  assert.equal(records.length, 2, "establishment + disruption records");
  assert.equal(records[1].phase, "disrupted", "disrupted phase");
  console.log("niche disruption: PASS");
}

function testSuperseded() {
  const observer = new EcologyObserver();
  observer.observe(frame(60000, { waste: 0.1, exposed: 0.02 }));
  observer.observe(frame(65500, { waste: 0.12, exposed: 0.25 }));
  assert.equal((observer as any).niche.state, "established", "guild established");
  // Waste persists but occupancy reorganizes away from modified cells.
  observer.observe(frame(70500, { waste: 0.11, exposed: 0.02 }));
  observer.observe(frame(76000, { waste: 0.11, exposed: 0.02 }));
  assert.equal((observer as any).niche.state, "superseded", "reorganization supersedes");
  const records = nicheRecords(observer);
  assert.equal(records.length, 2, "establishment + supersession records");
  assert.equal(records[1].phase, "superseded", "superseded phase");
  assert.ok(records[1].title.includes("superseded"), "supersession titled plainly");
  console.log("niche supersession: PASS");
}

function testSupersededExits() {
  // Supersession is not absorbing: once the modification itself is gone,
  // the arc returns to absent and can fire again on a new regime.
  const observer = new EcologyObserver();
  observer.observe(frame(60000, { waste: 0.1, exposed: 0.02 }));
  observer.observe(frame(65500, { waste: 0.12, exposed: 0.25 }));
  observer.observe(frame(70500, { waste: 0.11, exposed: 0.02 }));
  observer.observe(frame(76000, { waste: 0.11, exposed: 0.02 }));
  assert.equal((observer as any).niche.state, "superseded", "regime superseded");
  observer.observe(frame(81000, { waste: 0.01, exposed: 0 }));
  assert.equal((observer as any).niche.state, "absent", "lost modification clears supersession");
  observer.observe(frame(86000, { waste: 0.1, exposed: 0.02 }));
  assert.equal((observer as any).niche.state, "forming", "new regime re-forms");
  observer.observe(frame(91500, { waste: 0.12, exposed: 0.2 }));
  const records = nicheRecords(observer);
  assert.equal((observer as any).niche.state, "established", "new regime establishes");
  assert.equal(records.length, 3, "establishment + supersession + new establishment");
  assert.equal(records[2].phase, "established", "return from supersession is new, not recovered");
  console.log("niche supersession exit: PASS");
}

function testRecovery() {
  const observer = new EcologyObserver();
  observer.observe(frame(60000, { waste: 0.1, exposed: 0.02 }));
  observer.observe(frame(65500, { waste: 0.12, exposed: 0.2 }));
  observer.observe(frame(70500, { waste: 0.02, exposed: 0 }));
  observer.observe(frame(76000, { waste: 0.02, exposed: 0 }));
  assert.equal((observer as any).niche.state, "disrupted", "guild disrupted");
  observer.observe(frame(81500, { waste: 0.1, exposed: 0.02 }));
  assert.equal((observer as any).niche.state, "forming", "return re-forms");
  assert.equal(nicheRecords(observer).length, 2, "return narrates nothing yet");
  observer.observe(frame(87000, { waste: 0.12, exposed: 0.2 }));
  assert.equal((observer as any).niche.state, "established", "durable return recovers");
  const records = nicheRecords(observer);
  assert.equal(records.length, 3, "establishment + disruption + recovery records");
  assert.equal(records[2].phase, "recovered", "recovered phase");
  console.log("niche recovery: PASS");
}

function testLineageRefs() {
  // Meaningful interval producer/remover named; diffuse flows name nobody;
  // one lineage topping both lists is named once.
  const observer = new EcologyObserver();
  observer.observe(frame(60000, {
    waste: 0.1, exposed: 0.02,
    producers: [{ id: 5, share: 0.6 }, { id: 6, share: 0.1 }],
    removers: [{ id: 9, share: 0.5 }],
  }));
  observer.observe(frame(65500, {
    waste: 0.12, exposed: 0.2,
    producers: [{ id: 5, share: 0.6 }, { id: 6, share: 0.1 }],
    removers: [{ id: 9, share: 0.5 }],
  }));
  const records = nicheRecords(observer);
  assert.equal(records.length, 1, "one establishment record");
  assert.deepEqual(records[0].entity_refs, [5, 9], "meaningful producer and remover named");

  const diffuse = new EcologyObserver();
  const many = Array.from({ length: 12 }, (_, i) => ({ id: 100 + i, share: 0.05 }));
  diffuse.observe(frame(60000, { waste: 0.1, exposed: 0.02, producers: many, removers: many }));
  diffuse.observe(frame(65500, { waste: 0.1, exposed: 0.2, producers: many, removers: many }));
  const diffuseRecords = nicheRecords(diffuse);
  assert.equal(diffuseRecords.length, 1, "diffuse flows still establish");
  assert.deepEqual(diffuseRecords[0].entity_refs, [], "diffuse flows name nobody");

  const both = new EcologyObserver();
  both.observe(frame(60000, {
    waste: 0.1, exposed: 0.02,
    producers: [{ id: 7, share: 0.8 }],
    removers: [{ id: 7, share: 0.8 }],
  }));
  both.observe(frame(65500, {
    waste: 0.12, exposed: 0.2,
    producers: [{ id: 7, share: 0.8 }],
    removers: [{ id: 7, share: 0.8 }],
  }));
  const bothRecords = nicheRecords(both);
  assert.equal(bothRecords.length, 1, "dual-role establishment records once");
  assert.deepEqual(bothRecords[0].entity_refs, [7], "dual top lineage named once");
  console.log("niche lineage refs: PASS");
}

function testZeroPopulationSafe() {
  const observer = new EcologyObserver();
  observer.observe(frame(60000, { pop: 0, waste: 0.5, exposed: 0 }));
  assert.equal((observer as any).niche.state, "forming", "modification without life still forms");
  assert.equal(nicheRecords(observer).length, 0, "lifeless forming narrates nothing");
  console.log("niche extinction safety: PASS");
}

const PATCHWORK_SEED = 24681357;
function patchworkConfig(seed: number): EngineConfig {
  return {
    seed, start: 0.62, prod: 0.86, cap: 360, pop: 34, div: 0.45, mr: 0.03,
    ms: 0.12, press: 1.0875, patch: 0.9, resource_b_fraction: 0.5, cat: "global", st: null,
    resource_model: "definition_driven_substances", resource_grid: 60,
    enable_byproduct: true, enable_dormancy: true, study: true,
  };
}

/** Advance to target, resolving everything keep-watching (no-op). */
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

function testNicheIntegration() {
  // Patchwork seed 24681357: waste accumulates and the arc establishes
  // @30622 on a genuine exposure shift (0.000 -> 0.164 at establishment;
  // tolerance actually declines 0.201 -> 0.114, so the exposure-shift
  // disjunct is doing the work). Balanced shows no arc by 150k (pinned
  // below at 70k as a retune guard): possibility, never frequency.
  const session = new UniverseSession();
  session.create(patchworkConfig(PATCHWORK_SEED));
  settle(session, 70000);
  const records = (session.analysis as any).records.filter((r: any) => r.kind === "niche");
  assert.equal(records.length, 1, "one establishment record");
  assert.equal(records[0].phase, "established", "record establishes");
  assert.equal(records[0].tick, 30622, "establishment is deterministic");
  assert.deepEqual(records[0].entity_refs, [368], "dominant interval producer named");
  console.log("niche fixture arc: PASS");
}

function testNoArcOnBalanced() {
  // Negative guard: the balanced world never accumulates enough waste to
  // form, so no niche record may exist by 70k (surveyed to 150k with the
  // same result). If a retune makes the arc fire everywhere, this fails.
  const session = new UniverseSession();
  session.create({
    seed: PATCHWORK_SEED, start: 0.58, prod: 0.77, cap: 360, pop: 30, div: 0.35, mr: 0.03,
    ms: 0.12, press: 1.0875, patch: 0.6, resource_b_fraction: 0.5, cat: "global", st: null,
    resource_model: "definition_driven_substances", resource_grid: 60,
    enable_byproduct: true, enable_dormancy: true, study: true,
  });
  settle(session, 70000);
  const records = (session.analysis as any).records.filter((r: any) => r.kind === "niche");
  assert.equal(records.length, 0, "balanced world shows no niche arc by 70k");
  assert.equal((session.analysis as any).niche.state, "absent", "arc never leaves absent");
  console.log("niche balanced negative: PASS");
}

function testMatchedClearing() {
  // Counterfactual through biology, not surgery: fork an established regime
  // and run the cleared branch with the waste economy switched off
  // (enable_waste:false). A one-time stock clear initializes the
  // "always clean" counterfactual; after that both branches run unmodified
  // biology. The cleanup strategy persists iff waste persists (material
  // reliance shown by controlled comparison, not temporal order).
  const session = new UniverseSession();
  session.create(patchworkConfig(PATCHWORK_SEED));
  settle(session, 70000);
  const sim = session.simulation as any;
  const forkProduced: number = sim.resources.waste.produced;
  const cleared = sim.clone();
  // Two gates read the flag (S-step burden block via sim config, deposition
  // via the resource system's own copy): switch both, exactly as a
  // waste-free construction would set them.
  cleared.c.enable_waste = false;
  cleared.resources.enabledWaste = false;
  cleared.resources.waste.stock.fill(0);
  // Fork-path honesty: a checkpoint round-trip must continue identically to
  // clone(), so the assay exercises the real fork path (fork determinism
  // itself is pinned in flows.ts waste-checkpoint coverage).
  const revivedSession = new UniverseSession();
  revivedSession.restore(JSON.parse(JSON.stringify(session.checkpoint())));
  const revived = revivedSession.simulation as any;
  revived.c.enable_waste = false;
  revived.resources.enabledWaste = false;
  revived.resources.waste.stock.fill(0);
  for (let i = 0; i < 500; i++) {
    cleared.step();
    revived.step();
  }
  assert.equal(
    JSON.stringify(Array.from(revived.resources.waste.stock)),
    JSON.stringify(Array.from(cleared.resources.waste.stock)),
    "checkpoint round-trip continues identically to clone",
  );
  for (let i = 0; i < 19500; i++) {
    sim.step();
    cleared.step();
  }
  const kept = sim.metrics();
  const clean = cleared.metrics();
  assert.ok(kept.waste.fraction > 0.1, `kept branch stays dirty (${kept.waste.fraction})`);
  assert.ok(clean.waste.fraction < 0.01, `cleared branch stays clean (${clean.waste.fraction})`);
  assert.equal(cleared.resources.waste.produced, forkProduced, "switched-off branch deposits no new waste");
  assert.ok(
    kept.traits.cleanup.mean > 0.1,
    `cleanup strategy present where waste persists (${kept.traits.cleanup.mean})`,
  );
  assert.ok(
    clean.traits.cleanup.mean < kept.traits.cleanup.mean,
    `cleanup declines without waste (${clean.traits.cleanup.mean} vs ${kept.traits.cleanup.mean})`,
  );
  assert.ok(
    Math.abs(clean.population - kept.population) / kept.population < 0.2,
    "no wipeout confound: populations comparable",
  );
  console.log("niche matched clearing: PASS");
}

testFormAndEstablish();
testNoEstablishOnExposureLevel();
testEstablishViaTraitShift();
testFormAborted();
testDisruption();
testSuperseded();
testSupersededExits();
testRecovery();
testLineageRefs();
testZeroPopulationSafe();
testNicheIntegration();
testNoArcOnBalanced();
testMatchedClearing();
console.log(`niche validation: PASS (engine ${ENGINE_VERSION})`);
