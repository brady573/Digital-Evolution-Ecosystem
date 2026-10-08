import {
  Simulation, maintainedConfig, REGIMES, SEEDS, drain, newAcc, emit, emitFresh,
  header, summarise, table,
} from "./common.ts";

/**
 * Question A — reproductive-value concentration.
 *
 * Two passes, both against maintained biology with no rule changes:
 *
 *  A1 decomposition. A per-tick ledger over every organism in matched worlds,
 *    split into exact maintained-counter energy accounting (aggregate) and
 *    per-organism reproductive outcomes (ledger). Outputs per-generation and
 *    per-lineage summaries, birth concentration, and the marginal relationship
 *    between retained energy and realised future births.
 *
 *  A2 matched value assay. Question A asks directly whether established-parent
 *    reproductive value is disproportionate relative to newborn value. That is
 *    measurable without any new trait: fork one world at a real birth and give
 *    the SAME energy surplus to the parent in one arm and to the newborn in the
 *    other. The surplus is a harness intervention on observed state, not a
 *    biology change, and both arms start from an identical clone.
 *
 * Inferred quantities carry the `Inferred` suffix. Exactly one is used
 * (blocked births), because the engine publishes blocked births only as a
 * run-level counter.
 */

interface Ledger {
  id: number;
  lineage: number;
  generation: number;
  born: number;
  rp: number;
  births: number;
  firstBirth: number | null;
  lastBirth: number | null;
  acquired: number;
  eligibleTicks: number;
  blockedInferred: number;
  dormantTicks: number;
  activeTicks: number;
  maxEnergy: number;
  deathTick: number | null;
}

const WINDOW = 2000; // ticks of "future births" observed after an energy sample

/** A1 — per-tick decomposition of one world. */
function decompose(configName: string, regime: any, seed: number, horizon: number) {
  const sim: any = new Simulation({ ...maintainedConfig(configName, seed), ...regime });
  const ledger = new Map<number, Ledger>();
  const acc = newAcc();
  const perTickBirths: { tick: number; parentId: number; energy: number; generation: number }[] = [];

  const seedLedger = (o: any) => {
    ledger.set(o.id, {
      id: o.id, lineage: o.l, generation: o.generation || 0, born: o.born, rp: o.rp,
      births: 0, firstBirth: null, lastBirth: null, acquired: 0, eligibleTicks: 0,
      blockedInferred: 0, dormantTicks: 0, activeTicks: 0, maxEnergy: o.en, deathTick: null,
    });
  };
  for (const o of sim.o) seedLedger(o);

  // Energy samples for the marginal-value curve: energy -> births in the next WINDOW.
  const samples: { tick: number; energy: number; id: number }[] = [];

  let prev = new Map<number, { en: number; realized: number }>();
  for (const o of sim.o) prev.set(o.id, { en: o.en, realized: (o.ga || 0) + (o.gb || 0) + (o.gc || 0) });

  const sampleAt = new Set<number>();
  for (let t = 1; t <= horizon; t += WINDOW) sampleAt.add(t);

  for (let t = 1; t <= horizon; t++) {
    if (sampleAt.has(t)) {
      for (const o of sim.o) samples.push({ tick: t, energy: o.en, id: o.id });
    }
    sim.step();
    drain(sim, acc);

    const before = prev;
    const next = new Map<number, { en: number; realized: number }>();
    for (const o of sim.o) next.set(o.id, { en: o.en, realized: (o.ga || 0) + (o.gb || 0) + (o.gc || 0) });

    // Births this tick: an id that was not present before and is not a founder.
    const newbornIds = new Set<number>();
    for (const o of sim.o) {
      if (!before.has(o.id)) newbornIds.add(o.id);
    }
    const newbornById = new Map<number, any>();
    for (const o of sim.o) if (newbornIds.has(o.id)) newbornById.set(o.id, o);
    for (const [id, baby] of newbornById) {
      if (baby.parent === null) continue;
      const parent = ledger.get(baby.parent);
      if (parent) {
        parent.births++;
        if (parent.firstBirth === null) parent.firstBirth = sim.t;
        parent.lastBirth = sim.t;
      }
      seedLedger(baby);
      perTickBirths.push({ tick: sim.t, parentId: baby.parent, energy: baby.en, generation: baby.generation || 0 });
    }
    const parentsWithBirth = new Set<number>();
    for (const b of newbornById.values()) if (b.parent !== null) parentsWithBirth.add(b.parent);

    for (const o of sim.o) {
      const row = ledger.get(o.id);
      if (!row) continue;
      const prior = before.get(o.id);
      if (prior) row.acquired += next.get(o.id)!.realized - prior.realized;
      if (o.en > row.maxEnergy) row.maxEnergy = o.en;
      if (o.activity === "dormant") row.dormantTicks++; else row.activeTicks++;
      const eligible = sim.t >= (o.matureAt || 0) && sim.t >= (o.readyAt || 0) && o.en >= o.rp;
      if (eligible) {
        row.eligibleTicks++;
        // INFERRED blocked birth: the engine queues a birth exactly when this
        // gate holds, so an eligible organism that produced no newborn this tick
        // is a placement-blocked attempt. Main publishes blocked births only as a
        // run-level counter, so this cannot be read per organism.
        if (!parentsWithBirth.has(o.id)) row.blockedInferred++;
      }
    }

    // Deaths: present before, absent now.
    for (const [id, row] of ledger) {
      if (row.deathTick === null && !next.has(id)) row.deathTick = sim.t;
    }
    prev = next;
  }

  return { sim, ledger, acc, perTickBirths, samples, horizon, configName, regimeName: regimeName(regime), seed };
}

function regimeName(regime: any): string {
  for (const [name, r] of Object.entries(REGIMES)) if (r === regime) return name;
  return "unknown";
}

/** A1 outputs — per-generation, per-lineage, concentration, marginal value. */
function summariseRun(run: ReturnType<typeof decompose>) {
  const rows = [...run.ledger.values()];
  const totalBirths = rows.reduce((a, r) => a + r.births, 0);

  // Per generation.
  const byGen = new Map<number, Ledger[]>();
  for (const r of rows) {
    if (!byGen.has(r.generation)) byGen.set(r.generation, []);
    byGen.get(r.generation)!.push(r);
  }
  const genRows = [...byGen.entries()].sort((a, b) => a[0] - b[0]).map(([g, rs]) => {
    const reproduced = rs.filter((r) => r.births > 0).length;
    const diedBeforeAnyBirth = rs.filter((r) => r.deathTick !== null && r.births === 0).length;
    const dormant = rs.reduce((a, r) => a + r.dormantTicks, 0);
    const active = rs.reduce((a, r) => a + r.activeTicks, 0);
    const established = rs.filter((r) => r.firstBirth !== null);
    const meanFirstBirthAge = established.length
      ? established.reduce((a, r) => a + (r.firstBirth! - r.born), 0) / established.length
      : null;
    return [
      g, rs.length,
      +(reproduced / Math.max(1, rs.length)).toFixed(4),
      +(diedBeforeAnyBirth / Math.max(1, rs.length)).toFixed(4),
      meanFirstBirthAge === null ? "n/a" : +meanFirstBirthAge.toFixed(0),
      +(dormant / Math.max(1, dormant + active)).toFixed(4),
      +(rs.reduce((a, r) => a + r.acquired, 0) / Math.max(1, rs.length)).toFixed(1),
    ];
  });

  // Per lineage: birth concentration.
  const byLin = new Map<number, Ledger[]>();
  for (const r of rows) {
    if (!byLin.has(r.lineage)) byLin.set(r.lineage, []);
    byLin.get(r.lineage)!.push(r);
  }
  const lineageBirths = [...byLin.entries()]
    .map(([l, rs]) => [l, rs.reduce((a, r) => a + r.births, 0), rs.length] as [number, number, number])
    .sort((a, b) => b[1] - a[1]);
  const sortedBirths = lineageBirths.map(([, b]) => b).sort((a, b) => b - a);
  const top1 = sortedBirths.slice(0, Math.max(1, Math.ceil(sortedBirths.length * 0.01)))
    .reduce((a, b) => a + b, 0);
  const top10 = sortedBirths.slice(0, Math.max(1, Math.ceil(sortedBirths.length * 0.10)))
    .reduce((a, b) => a + b, 0);

  // Marginal value of retained energy: births per 1000 sampled organism-ticks in
  // the WINDOW after each sample, bucketed by the energy held at the sample.
  //
  // Each sample contributes only the births by that SAME organism id occurring
  // in (sampleTick, sampleTick + WINDOW]. Attributing an organism's whole
  // lifetime birth count to every sample would silently weight the curve by
  // lifespan instead of by retained energy.
  const EDGES = [0, 25, 50, 75, 100, 125, 150, 200, Infinity];
  const buckets = EDGES.slice(0, -1).map((lo, i) => ({ lo, hi: EDGES[i + 1]!, births: 0, samples: 0 }));
  // Birth ticks per parent id, for the windowed lookup.
  const birthTicksByParent = new Map<number, number[]>();
  for (const b of run.perTickBirths) {
    if (!birthTicksByParent.has(b.parentId)) birthTicksByParent.set(b.parentId, []);
    birthTicksByParent.get(b.parentId)!.push(b.tick);
  }
  for (const s of run.samples) {
    const ticks = birthTicksByParent.get(s.id);
    if (!ticks) continue;
    const inWindow = ticks.filter((t) => t > s.tick && t <= s.tick + WINDOW).length;
    if (inWindow === 0) continue;
    const idx = EDGES.findIndex((e, i) => i < EDGES.length - 1 && s.energy >= e && s.energy < EDGES[i + 1]!);
    if (idx < 0) continue;
    buckets[idx]!.samples++;
    buckets[idx]!.births += inWindow;
  }
  const marginal = buckets
    .filter((b) => b.samples > 0)
    .map((b) => [
      b.hi === Infinity ? `${b.lo}+` : `${b.lo}-${b.hi}`,
      b.samples,
      b.births,
      +((b.births / b.samples) * 1000).toFixed(1),
    ]);

  // Reproducing share: how concentrated is realised reproduction at all.
  const everReproduced = rows.filter((r) => r.births > 0).length;
  const repeatParents = rows.filter((r) => r.births > 1).length;
  const birthsFromRepeatParents = rows.filter((r) => r.births > 1).reduce((a, r) => a + r.births, 0);

  return {
    genRows, marginal, lineageBirths, sortedBirths,
    concentration: {
      organisms: rows.length,
      totalBirths,
      everReproduced,
      everReproducedShare: +(everReproduced / Math.max(1, rows.length)).toFixed(4),
      repeatParents,
      birthsFromRepeatParents,
      birthsFromRepeatParentsShare: +(birthsFromRepeatParents / Math.max(1, totalBirths)).toFixed(4),
      top1pctLineageBirthShare: +(top1 / Math.max(1, totalBirths)).toFixed(4),
      top10pctLineageBirthShare: +(top10 / Math.max(1, totalBirths)).toFixed(4),
      lineageCount: lineageBirths.length,
    },
  };
}

/** A2 — matched parent-vs-newborn energy value assay. */
function valueAssay(configName: string, regime: any, seed: number, surplus: number, horizon: number) {
  // mr = 0 keeps every lineage id stable, so a lineage's living size is a clean
  // founder-value measure. It is a measurement control, not a biology change:
  // the engine still draws the same number of RNG values per birth.
  const sim: any = new Simulation({ ...maintainedConfig(configName, seed), ...regime, mr: 0 });
  let parentId: number | null = null, babyId: number | null = null, bornTick = 0;
  for (let t = 0; t < 40000 && babyId === null; t++) {
    const before = new Set(sim.o.map((o: any) => o.id));
    sim.step();
    const baby = sim.o.find((o: any) => !before.has(o.id));
    if (baby && baby.parent !== null) { parentId = baby.parent; babyId = baby.id; bornTick = sim.t; }
  }
  if (babyId === null) return { configName, regimeName: regimeName(regime), seed, surplus, error: "no birth found" };

  const lineage = sim.o.find((o: any) => o.id === babyId)!.l;
  const arm = (where: "control" | "parent" | "newborn") => {
    const s: any = sim.clone();
    const p = s.o.find((o: any) => o.id === parentId)!;
    const b = s.o.find((o: any) => o.id === babyId)!;
    if (where === "parent") p.en += surplus;
    if (where === "newborn") b.en += surplus;
    const startEnergy = { parent: p.en, newborn: b.en };

    // Two outcome measures, because standing stock alone is too coarse: in a
    // replete world the focal lineage is already at the carrying capacity and
    // extra energy is absorbed by the storage-cost curve, which reads as "no
    // effect" even when the reproductive ROUTE changed. `lineageBirths` is the
    // flow measure, `parentNextBirthAt` and `newbornFirstBirthAt` are the
    // latency measures.
    let lineageBirths = 0;
    let parentNextBirthAt: number | null = null;
    let newbornFirstBirthAt: number | null = null;
    const born = new Set<number>(s.o.map((o: any) => o.id));
    for (let t = 1; t <= horizon; t++) {
      s.step();
      for (const o of s.o) {
        if (o.l !== lineage || born.has(o.id)) continue;
        lineageBirths++;
        born.add(o.id);
        if (o.parent === parentId && parentNextBirthAt === null) parentNextBirthAt = t;
        if (o.id !== babyId && o.parent === babyId && newbornFirstBirthAt === null) newbornFirstBirthAt = t;
      }
    }
    const livingLineage = s.o.filter((o: any) => o.l === lineage).length;
    const newbornAlive = s.o.some((o: any) => o.id === babyId);
    const metrics = s.metrics();
    return {
      where, startEnergy, lineageBirths, parentNextBirthAt, newbornFirstBirthAt,
      livingLineage, newbornAlive, population: metrics.population,
    };
  };

  const control = arm("control");
  const parentArm = arm("parent");
  const newbornArm = arm("newborn");
  const flowDelta = (a: typeof control) => a.lineageBirths - control.lineageBirths;
  return {
    configName, regimeName: regimeName(regime), seed, surplus, horizon,
    bornTick, lineage,
    control, parentArm, newbornArm,
    // Flow measure: additional focal-lineage births caused by the surplus.
    parentValue: flowDelta(parentArm),
    newbornValue: flowDelta(newbornArm),
    // Standing-stock measure, kept because it is the coarser cross-check.
    parentStockDelta: parentArm.livingLineage - control.livingLineage,
    newbornStockDelta: newbornArm.livingLineage - control.livingLineage,
    parentNewbornRatio: flowDelta(newbornArm) !== 0
      ? +(flowDelta(parentArm) / flowDelta(newbornArm)).toFixed(3)
      : null,
    parentNextBirth: { control: control.parentNextBirthAt, parent: parentArm.parentNextBirthAt },
    newbornFirstBirth: { control: control.newbornFirstBirthAt, newborn: newbornArm.newbornFirstBirthAt },
  };
}

const smoke = process.argv.includes("--smoke");
const SMOKE_HORIZON = 6000;
const FULL_HORIZON = 40000;

if (process.argv.includes("--value")) {
  const rows: any[] = [];
  const surpluses = smoke ? [50] : [20, 50, 100];
  for (const regimeName_ of Object.keys(REGIMES)) {
    for (const seed of (smoke ? [333333333] : SEEDS)) {
      for (const surplus of surpluses) {
        const r = valueAssay("balanced", REGIMES[regimeName_], seed, surplus, smoke ? 4000 : 20000);
        rows.push(r);
        emit("qA-value-assay.jsonl", header({ question: "A2", ...r }));
      }
    }
  }
  const good = rows.filter((r) => !r.error);
  summarise("Q-A2 matched parent vs newborn energy value — FLOW (extra focal-lineage births from surplus)", [
    "regime", "seed", "surplus", "ctrlBirths", "parent", "newborn", "parentΔ", "newbornΔ", "ratio",
  ], good.map((r) => [
    r.regimeName, r.seed, r.surplus, r.control.lineageBirths,
    r.parentArm.lineageBirths, r.newbornArm.lineageBirths,
    r.parentValue, r.newbornValue, r.parentNewbornRatio ?? "n/a",
  ]));
  summarise("Q-A2 matched parent vs newborn energy value — LATENCY (ticks to next own birth; lower = faster)", [
    "regime", "seed", "surplus", "parentNext ctrl/arm", "newbornFirstBirth ctrl/arm",
  ], good.map((r) => [
    r.regimeName, r.seed, r.surplus,
    `${r.parentNextBirth.control ?? "never"}/${r.parentNextBirth.parent ?? "never"}`,
    `${r.newbornFirstBirth.control ?? "never"}/${r.newbornFirstBirth.newborn ?? "never"}`,
  ]));
  summarise("Q-A2 standing stock cross-check (living focal lineage at horizon)", [
    "regime", "seed", "surplus", "control", "parent", "newborn", "parentΔ", "newbornΔ",
  ], good.map((r) => [
    r.regimeName, r.seed, r.surplus, r.control.livingLineage,
    r.parentArm.livingLineage, r.newbornArm.livingLineage,
    r.parentStockDelta, r.newbornStockDelta,
  ]));
  console.log(`\nrows: ${rows.length}, errors: ${rows.length - good.length}`);
  console.log(`written: testdata/substrate-diagnostic/qA-value-assay.jsonl`);
} else {
  const horizon = smoke ? SMOKE_HORIZON : FULL_HORIZON;
  const seeds = smoke ? [333333333] : SEEDS;
  emitFresh("qA-decomposition.jsonl", header({ question: "A1", horizon, seeds, regimes: Object.keys(REGIMES) }));
  const conc: any[] = [];
  const genAll: any[] = [];
  const margAll: any[] = [];
  for (const regimeKey of Object.keys(REGIMES)) {
    for (const seed of seeds) {
      const run = decompose("balanced", REGIMES[regimeKey], seed, horizon);
      const s = summariseRun(run);
      conc.push({ regime: regimeKey, seed, horizon, ...s.concentration, ...run.acc });
      genAll.push({ regime: regimeKey, seed, generationRows: s.genRows });
      margAll.push({ regime: regimeKey, seed, marginal: s.marginal });
      emit("qA-decomposition.jsonl", header({ question: "A1", regime: regimeKey, seed, concentration: s.concentration }));
      emit("qA-generation-summary.jsonl", header({ question: "A1-generation", regime: regimeKey, seed, rows: s.genRows }));
      emit("qA-marginal-energy.jsonl", header({ question: "A1-marginal", regime: regimeKey, seed, rows: s.marginal }));
      emit("qA-lineage-births.jsonl", header({ question: "A1-lineage", regime: regimeKey, seed, top: s.lineageBirths.slice(0, 25) }));
    }
  }
  summarise("Q-A1 reproductive concentration", [
    "regime", "seed", "organisms", "births", "everReproduced", "share", "repeatParents", "repeatBirthShare",
    "top1%lineages", "top10%lineages", "lineages", "blocked", "reproEligible",
  ], conc.map((c) => [
    c.regime, c.seed, c.organisms, c.totalBirths, c.everReproduced, c.everReproducedShare,
    c.repeatParents, c.birthsFromRepeatParentsShare, c.top1pctLineageBirthShare,
    c.top10pctLineageBirthShare, c.lineageCount, c.blocked_births ?? 0, c.repro_eligible ?? 0,
  ]));
  summarise("Q-A1 marginal value of retained energy (births per 1000 sampled organism-windows)", [
    "regime", "seed", "energy band", "samples", "births", "births/1000",
  ], margAll.flatMap((m) => m.marginal.map((r) => [m.regime, m.seed, ...r])));
  console.log("\nwritten: testdata/substrate-diagnostic/qA-*.jsonl");
}
