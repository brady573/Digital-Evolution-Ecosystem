import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { header, summarise, table } from "./common.ts";

/**
 * Compaction of the raw diagnostic rows into a durable, committed summary.
 *
 * The raw JSONL is a CI artifact with a retention window. It must not be the only
 * surviving record of any value the substrate decision cites, so this reduces the
 * artifact to compact tables that preserve EVERY cited number, and writes them
 * to a versioned location in the repository.
 *
 * Invariants:
 *  - No number is summarised away. Every row that the return package cites must
 *    appear here with its engine, commit, seed, config and horizon.
 *  - Nothing is recomputed. This reads what the probes emitted; it does not
 *    re-derive a statistic, so it cannot disagree with the raw run.
 *  - Missing inputs are reported, never silently skipped.
 */

const RAW = "testdata/substrate-diagnostic";
const OUT = "testdata/substrate-diagnostic-summary";

function readJsonl(name: string): any[] {
  const path = `${RAW}/${name}`;
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
}

/** Provenance carried onto every compacted row. */
function provenance(row: any) {
  return {
    engine: row.engine,
    commit: row.commit,
    seed: row.seed ?? null,
    config: row.config ?? row.configName ?? null,
    regime: row.regime ?? row.regimeName ?? null,
    horizon: row.horizon ?? null,
  };
}

mkdirSync(OUT, { recursive: true });

const qaDecomp = readJsonl("qA-decomposition.jsonl");
const qaGen = readJsonl("qA-generation-summary.jsonl");
const qaMarginal = readJsonl("qA-marginal-energy.jsonl");
const qaLineage = readJsonl("qA-lineage-births.jsonl");
const qaValue = readJsonl("qA-value-assay.jsonl");
const qB = readJsonl("qB-opportunity-map.jsonl");
const qC = readJsonl("qC-selection-gradients.jsonl");
const qD = readJsonl("qD-protected-envelope.jsonl");

const present = {
  "qA-decomposition": qaDecomp.length, "qA-generation-summary": qaGen.length,
  "qA-marginal-energy": qaMarginal.length, "qA-lineage-births": qaLineage.length,
  "qA-value-assay": qaValue.length, "qB-opportunity-map": qB.length,
  "qC-selection-gradients": qC.length, "qD-protected-envelope": qD.length,
};

// --- Q-A1 concentration + maintained counters -------------------------------
const qaConcentration = qaDecomp.map((r) => ({
  ...provenance(r),
  question: "A1",
  organisms: r.organisms, totalBirths: r.totalBirths,
  everReproduced: r.everReproduced, everReproducedShare: r.everReproducedShare,
  repeatParents: r.repeatParents, birthsFromRepeatParents: r.birthsFromRepeatParents,
  birthsFromRepeatParentsShare: r.birthsFromRepeatParentsShare,
  top1pctLineageBirthShare: r.top1pctLineageBirthShare,
  top10pctLineageBirthShare: r.top10pctLineageBirthShare,
  lineageCount: r.lineageCount,
  // Maintained counters, delta-accumulated (see drain()).
  births: r.births ?? null, deaths: r.deaths ?? null,
  repro_eligible: r.repro_eligible ?? null, blocked_births: r.blocked_births ?? null,
  dormancy_entries: r.dormancy_entries ?? null, wakes: r.wakes ?? null,
  energy_a: r.energy_a ?? null, energy_b: r.energy_b ?? null, energy_c: r.energy_c ?? null,
  burden_energy: r.burden_energy ?? null, cleanup_energy: r.cleanup_energy ?? null,
}));

// --- Q-A2 matched value assay ------------------------------------------------
const qaValueCompact = qaValue.map((r) => ({
  ...provenance(r),
  question: "A2",
  surplus: r.surplus,
  lineage: r.lineage ?? null,
  error: r.error ?? null,
  control: r.control ? {
    lineageBirths: r.control.lineageBirths, livingLineage: r.control.livingLineage,
    parentNextBirthAt: r.control.parentNextBirthAt, newbornFirstBirthAt: r.control.newbornFirstBirthAt,
    population: r.control.population,
  } : null,
  parentArm: r.parentArm ? {
    lineageBirths: r.parentArm.lineageBirths, livingLineage: r.parentArm.livingLineage,
    parentNextBirthAt: r.parentArm.parentNextBirthAt, newbornFirstBirthAt: r.parentArm.newbornFirstBirthAt,
    population: r.parentArm.population,
  } : null,
  newbornArm: r.newbornArm ? {
    lineageBirths: r.newbornArm.lineageBirths, livingLineage: r.newbornArm.livingLineage,
    parentNextBirthAt: r.newbornArm.parentNextBirthAt, newbornFirstBirthAt: r.newbornArm.newbornFirstBirthAt,
    population: r.newbornArm.population,
  } : null,
  parentValue: r.parentValue ?? null, newbornValue: r.newbornValue ?? null,
  parentStockDelta: r.parentStockDelta ?? null, newbornStockDelta: r.newbornStockDelta ?? null,
  parentNewbornRatio: r.parentNewbornRatio ?? null,
}));

// --- Q-B channels ------------------------------------------------------------
const qBCompact = qB.flatMap((r) => (r.channels ?? []).map((c: any) => ({
  ...provenance(r),
  question: "B",
  channel: c.channel, events: c.events, per1kTicks: c.per1kTicks,
  exposurePct: c.exposurePct ?? null, recurrence: c.recurrence,
  durationMean: c.durationMean ?? null, durationMedian: c.durationMedian ?? null,
  effect: c.effect, compoundingHorizon: c.compoundingHorizon, note: c.note,
})));

const qBContext = qB.map((r) => ({
  ...provenance(r),
  question: "B-context",
  population: r.population, dormantSharePct: r.dormantSharePct,
  activeSharePct: r.activeSharePct, matureSharePct: r.matureSharePct,
  eligibleSharePct: r.eligibleSharePct, organismTicks: r.organismTicks,
  bornTotal: r.bornTotal, reproducedTotal: r.reproducedTotal, establishmentRate: r.establishmentRate,
}));

// --- Q-C gradients -----------------------------------------------------------
const qCCompact = qC.map((r) => ({
  ...provenance(r),
  question: "C",
  trait: r.trait, label: r.label,
  founderMean: r.split?.mean ?? null, splitLow: r.split?.low ?? null, splitHigh: r.split?.high ?? null,
  splitOffset: r.split?.offset ?? null, degenerateSplit: r.split?.degenerate ?? null,
  totalBirths: r.totalBirths, lowBirthShare: r.lowBirthShare, lowPopShare: r.lowPopShare,
  flowGradient: r.flowGradient, stockGradient: r.stockGradient,
  finalPopulation: r.finalPopulation, unknownPopAtEnd: r.unknownPopAtEnd ?? null,
}));

// --- Q-D protected envelope --------------------------------------------------
const qDCompact = qD.map((r) => ({
  ...provenance(r),
  question: "D",
  perturbation: r.perturbation, axis: r.axis, factor: r.factor,
  wasteNiche: r.wasteNiche, wasteNicheEstablishedTick: r.wasteNicheEstablishedTick,
  dependency: r.dependency, dependencyEstablishedTick: r.dependencyEstablishedTick,
  seedBank: r.seedBank, seedBankReturnedClades: r.seedBankReturnedClades,
  partitioning: r.partitioning, partitioningNow: r.partitioningNow,
  population: r.population, dormantFraction: r.dormantFraction,
  traitDiversity: r.traitDiversity, meanGeneration: r.meanGeneration,
}));

const summary = {
  ...header({ compactedFrom: RAW, compaction: "tools/diagnostics/substrate/compact.ts" }),
  note:
    "Every value the return package cites is preserved here. The raw JSONL is a CI artifact with a " +
    "retention window and is NOT the authoritative record; this file and the diagnostic scripts are. " +
    "Nothing in this file is recomputed — it is copied from the probe output.",
  inputsPresent: present,
  qA_concentration: qaConcentration,
  qA_generation: qaGen.map((r) => ({ ...provenance(r), rows: r.rows })),
  qA_marginalEnergy: qaMarginal.map((r) => ({ ...provenance(r), rows: r.rows })),
  qA_topLineages: qaLineage.map((r) => ({ ...provenance(r), top: r.top })),
  qA_valueAssay: qaValueCompact,
  qB_channels: qBCompact,
  qB_context: qBContext,
  qC_gradients: qCCompact,
  qD_protectedEnvelope: qDCompact,
};

writeFileSync(`${OUT}/summary.json`, `${JSON.stringify(summary, null, 2)}\n`);

summarise("Compaction inputs found (raw rows per file)", ["file", "rows"],
  Object.entries(present).map(([k, v]) => [k, v]));

summarise("Q-A1 reproductive concentration", [
  "regime", "seed", "organisms", "births", "everReproduced", "share", "repeatBirthShare",
  "top10%lineages", "deaths", "reproEligible", "blockedBirths", "dormancyEntries", "wakes",
], qaConcentration.map((r) => [
  r.regime, r.seed, r.organisms, r.totalBirths, r.everReproduced, r.everReproducedShare,
  r.birthsFromRepeatParentsShare, r.top10pctLineageBirthShare, r.deaths, r.repro_eligible,
  r.blocked_births, r.dormancy_entries, r.wakes,
]));

summarise("Q-A2 matched parent vs newborn value (extra focal-lineage births from surplus)", [
  "regime", "seed", "surplus", "ctrlBirths", "parentBirths", "newbornBirths", "parentΔ", "newbornΔ", "ratio",
], qaValueCompact.map((r) => [
  r.regime, r.seed, r.surplus,
  r.control?.lineageBirths, r.parentArm?.lineageBirths, r.newbornArm?.lineageBirths,
  r.parentValue, r.newbornValue, r.parentNewbornRatio ?? "n/a",
]));

summarise("Q-B population context", [
  "regime", "seed", "population", "dormant%", "mature%", "eligible%", "born", "reproduced", "establishmentRate",
], qBContext.map((r) => [
  r.regime, r.seed, r.population, r.dormantSharePct, r.matureSharePct, r.eligibleSharePct,
  r.bornTotal, r.reproducedTotal, r.establishmentRate,
]));

summarise("Q-C selection gradients (positive = favours the HIGH trait value)", [
  "trait", "regime", "seed", "low", "high", "births", "flowGrad", "stockGrad", "degenerate",
], qCCompact.map((r) => [
  r.trait, r.regime, r.seed, r.splitLow, r.splitHigh, r.totalBirths, r.flowGradient, r.stockGradient,
  r.degenerateSplit ? "YES" : "no",
]));

summarise("Q-D protected capability state", [
  "config", "seed", "perturbation", "niche", "dep", "seedBank", "partitioning", "returnedClades", "population",
], qDCompact.map((r) => [
  r.config, r.seed, r.perturbation, r.wasteNiche, r.dependency, r.seedBank, r.partitioning,
  r.seedBankReturnedClades, r.population,
]));

// Markdown rendering of the same numbers, for the return package and Drive.
const md: string[] = [
  "# Substrate diagnostic — compact evidence tables",
  "",
  `Engine \`${summary.engine}\`, commit \`${summary.commit}\`.`,
  "Every value below is copied from the probe output, not recomputed. The raw JSONL",
  "is a CI artifact with a retention window; this file plus the diagnostic scripts are",
  "the authoritative record.",
  "",
  "## Q-A1 reproductive concentration",
  "",
  table(["regime", "seed", "organisms", "births", "everReproduced", "share", "repeatBirthShare", "top10%lineages", "deaths", "reproEligible", "blockedBirths", "dormancyEntries", "wakes"],
    qaConcentration.map((r) => [r.regime, r.seed, r.organisms, r.totalBirths, r.everReproduced, r.everReproducedShare, r.birthsFromRepeatParentsShare, r.top10pctLineageBirthShare, r.deaths, r.repro_eligible, r.blocked_births, r.dormancy_entries, r.wakes])),
  "",
  "## Q-A2 matched parent vs newborn value",
  "",
  table(["regime", "seed", "surplus", "ctrlBirths", "parentBirths", "newbornBirths", "parentDelta", "newbornDelta", "ratio"],
    qaValueCompact.map((r) => [r.regime, r.seed, r.surplus, r.control?.lineageBirths, r.parentArm?.lineageBirths, r.newbornArm?.lineageBirths, r.parentValue, r.newbornValue, r.parentNewbornRatio ?? "n/a"])),
  "",
  "## Q-B population context",
  "",
  table(["regime", "seed", "population", "dormant%", "mature%", "eligible%", "born", "reproduced", "establishmentRate"],
    qBContext.map((r) => [r.regime, r.seed, r.population, r.dormantSharePct, r.matureSharePct, r.eligibleSharePct, r.bornTotal, r.reproducedTotal, r.establishmentRate])),
  "",
  "## Q-C selection gradients (positive = favours HIGH trait value)",
  "",
  table(["trait", "regime", "seed", "low", "high", "births", "flowGrad", "stockGrad", "degenerate"],
    qCCompact.map((r) => [r.trait, r.regime, r.seed, r.splitLow, r.splitHigh, r.totalBirths, r.flowGradient, r.stockGradient, r.degenerateSplit ? "YES" : "no"])),
  "",
  "## Q-D protected capability state",
  "",
  table(["config", "seed", "perturbation", "niche", "dep", "seedBank", "partitioning", "returnedClades", "population"],
    qDCompact.map((r) => [r.config, r.seed, r.perturbation, r.wasteNiche, r.dependency, r.seedBank, r.partitioning, r.seedBankReturnedClades, r.population])),
  "",
];

writeFileSync(`${OUT}/TABLES.md`, md.join("\n"));
console.log(`\nwritten: ${OUT}/summary.json and ${OUT}/TABLES.md`);
