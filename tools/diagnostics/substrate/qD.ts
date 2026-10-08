import {
  Simulation, maintainedConfig, SEEDS, newSession, settleSession, protectedCapabilities,
  emit, emitFresh, header, summarise,
} from "./common.ts";

/**
 * Question D — protected-ecology sensitivity envelope.
 *
 * How close are the four protected capabilities to loss under small bounded,
 * symmetric perturbations that do NOT redefine biology?
 *
 * Perturbation policy, applied strictly:
 *
 *  RUN — world-setting scalars the product already exposes, moved symmetrically
 *  and by a bounded amount: mutation rate, mutation size, founder dispersion,
 *  environmental pressure, and field capacity. Each is a configuration input,
 *  not a rule. Moving them measures how brittle a capability is to ordinary
 *  variation; it does not propose a new value for anything.
 *
 *  NOT RUN — returned as OWNER DECISION rather than measured, because running
 *  them would itself be a biology change: REPRO_COOLDOWN, DORMANCY_CHECK,
 *  maturity spans, the rp range, the 0.52/0.92 birth split, WASTE_* constants,
 *  Metabolite-C yields, and every analysis/detector threshold. See REFUSED below.
 *
 * Detector semantics are the maintained ones, read through the session analysis
 * exactly as tools/validation/niche-survey.ts reads them: niche establishment
 * from an `established` record, dependency from `dep.state`, seed bank from
 * `seedbank.state`, and A/B partitioning from the maintained PART_* persistence
 * test in metrics. No threshold, seed set, or horizon is altered here; the
 * horizon is the maintained survey horizon.
 */

const HORIZON = 150000; // maintained niche-survey horizon; not a new bound

interface Perturbation {
  id: string;
  axis: string;
  factor: number; // symmetric multiplier applied to the maintained value
  rationale: string;
}

/**
 * Every axis below is asserted to actually change biology before its results are
 * trusted. `cap` was originally in this set and was REMOVED: it is declared on
 * EngineConfig but never read by sim-core, so cap*0.9 and cap*1.1 produced
 * bit-identical runs. Those rows would have reported "no capability lost" from a
 * run that had changed nothing — false evidence of robustness. The liveness
 * check below exists so a dead key cannot quietly reappear.
 */
const PERTURBATIONS: Perturbation[] = [
  { id: "mr-", axis: "mr", factor: 0.75, rationale: "mutation rate 25% down" },
  { id: "mr+", axis: "mr", factor: 1.25, rationale: "mutation rate 25% up" },
  { id: "ms-", axis: "ms", factor: 0.75, rationale: "mutation size 25% down" },
  { id: "ms+", axis: "ms", factor: 1.25, rationale: "mutation size 25% up" },
  { id: "div-", axis: "div", factor: 0.75, rationale: "founder dispersion 25% down" },
  { id: "div+", axis: "div", factor: 1.25, rationale: "founder dispersion 25% up" },
  { id: "press-", axis: "press", factor: 0.95, rationale: "environmental pressure 5% down" },
  { id: "press+", axis: "press", factor: 1.05, rationale: "environmental pressure 5% up" },
];

/**
 * A perturbation is only evidence if it perturbs something. Runs a short
 * baseline and a short perturbed simulation and requires a difference in
 * observed biology, so a dead config key fails loudly instead of silently
 * reporting "no capability lost".
 */
function axisIsLive(perturbation: Perturbation, configName: string, seed: number): { live: boolean; detail: string } {
  const base = maintainedConfig(configName, seed);
  const baseValue = (base as any)[perturbation.axis];
  if (typeof baseValue !== "number") {
    return { live: false, detail: `${perturbation.axis} is not a numeric key on the ${configName} config` };
  }
  const fingerprint = (over: Record<string, number>) => {
    const s: any = new Simulation({ ...base, ...over });
    for (let t = 1; t <= 2000; t++) s.step();
    const m = s.metrics();
    return JSON.stringify([m.population, m.dormant_fraction, m.trait_diversity, s.o.length]);
  };
  const control = fingerprint({});
  const perturbed = fingerprint({ [perturbation.axis]: baseValue * perturbation.factor });
  return {
    live: control !== perturbed,
    detail: control === perturbed
      ? `${perturbation.axis} x${perturbation.factor} produced a bit-identical run — the axis does not affect biology`
      : `${perturbation.axis} x${perturbation.factor} changes observed biology`,
  };
}

/** Perturbations deliberately NOT measured, with the reason each is a design change. */
const REFUSED = [
  { change: "REPRO_COOLDOWN (450)", why: "changes the reproduction timing boundary every lifecycle gate is measured against" },
  { change: "birth split 0.52 / 0.92", why: "changes accepted birth-energy accounting" },
  { change: "OFFSPRING_MATURITY_MIN / SPAN", why: "changes the maturation gate that Q-A/Q-B measure" },
  { change: "DORMANCY_CHECK cadence", why: "changes dormancy-entry and wake eligibility" },
  { change: "WASTE_* burden / tolerance constants", why: "changes the Waste economy the protected capability depends on" },
  { change: "C_BYPRODUCT_YIELD / C_ENERGY_YIELD", why: "changes cross-feeding dependency economics" },
  { change: "niche/dep/seedbank persistence thresholds", why: "these are the detectors; altering them would measure a different question" },
  { change: "PART_* partitioning thresholds", why: "same: the detector is the instrument" },
];

function run(configName: string, seed: number, perturbation: Perturbation | null) {
  const base = maintainedConfig(configName, seed);
  const config = perturbation
    ? { ...base, [perturbation.axis]: (base as any)[perturbation.axis] * perturbation.factor }
    : base;
  const session = newSession(config);
  settleSession(session, HORIZON);
  const caps = protectedCapabilities(session);
  const metrics = session.snapshot().metrics as any;
  return {
    configName,
    seed,
    perturbation: perturbation ? perturbation.id : "none",
    axis: perturbation ? perturbation.axis : "-",
    factor: perturbation ? perturbation.factor : 1,
    ...caps,
    traitDiversity: metrics.trait_diversity ?? null,
    meanGeneration: metrics.mean_generation ?? null,
    dormantFraction: metrics.dormant_fraction ?? null,
  };
}

const smoke = process.argv.includes("--smoke");
const seeds = smoke ? [333333333] : SEEDS;
const configs = smoke ? ["balanced"] : ["patchwork", "balanced"];
const perturbations = smoke ? PERTURBATIONS.filter((p) => ["none", "mr-", "mr+"].includes(p.id) || p.id === "none") : PERTURBATIONS;
const rows: (Perturbation | null)[] = [null, ...perturbations];

emitFresh("qD-protected-envelope.jsonl", header({
  question: "D", horizon: HORIZON, seeds, configs,
  perturbations: rows.map((p) => (p ? p.id : "none")),
}));

const results: any[] = [];
const liveness: any[] = [];
for (const configName of configs) {
  for (const seed of seeds) {
    // Every perturbation must demonstrably change biology before its capability
    // reading is trusted. `cap` failed this check and was removed from the set.
    for (const p of perturbations) {
      const check = axisIsLive(p, configName, seed);
      liveness.push({ configName, seed, perturbation: p.id, axis: p.axis, factor: p.factor, ...check });
      if (!check.live) {
        console.error(`ABORT: ${configName}/${seed}/${p.id} is a no-op — ${check.detail}`);
        process.exitCode = 1;
      }
    }
    for (const p of rows) {
      const r = run(configName, seed, p);
      results.push(r);
      emit("qD-protected-envelope.jsonl", header(r));
    }
  }
}

summarise("Q-D perturbation liveness (a no-op axis would report false robustness)", [
  "config", "seed", "perturbation", "axis", "factor", "live", "detail",
], liveness.map((l) => [l.configName, l.seed, l.perturbation, l.axis, l.factor, l.live, l.detail]));

summarise("Q-D protected capability state under symmetric perturbations (maintained detectors, 150k horizon)", [
  "config", "seed", "perturbation", "wasteNiche", "dep", "seedBank", "partitioning", "returnedClades", "population",
], results.map((r) => [
  r.configName, r.seed, r.perturbation, r.wasteNiche, r.dependency, r.seedBank,
  r.partitioning, r.seedBankReturnedClades, r.population,
]));

/**
 * Capability loss relative to the unperturbed arm. The baseline is matched on
 * BOTH config and seed: comparing every seed's perturbed row against a single
 * shared baseline would fold seed-to-seed detector variation into the
 * perturbation's column and report it as an effect of the perturbation.
 */
summarise("Q-D capability loss envelope (perturbed vs same-seed unperturbed baseline)", [
  "config", "seed", "perturbation", "nicheEstablished", "depEstablished", "seedBankEstablished", "partitioned", "verdict",
], configs.flatMap((configName) => {
  return results
    .filter((r) => r.configName === configName && r.perturbation !== "none")
    .map((r) => {
      const base = results.find(
        (b) => b.configName === configName && b.seed === r.seed && b.perturbation === "none",
      );
      if (!base) return [configName, r.seed, r.perturbation, "n/a", "n/a", "n/a", "n/a", "no baseline row"];
      const lost: string[] = [];
      if (base.wasteNiche === "established" && r.wasteNiche !== "established") lost.push("niche");
      if (base.dependency === "established" && r.dependency !== "established") lost.push("dependency");
      if (base.seedBank === "established" && r.seedBank !== "established") lost.push("seedBank");
      if (base.partitioning === true && r.partitioning !== true) lost.push("partitioning");
      return [
        configName, r.seed, r.perturbation,
        `${base.wasteNiche}->${r.wasteNiche}`,
        `${base.dependency}->${r.dependency}`,
        `${base.seedBank}->${r.seedBank}`,
        `${base.partitioning}->${r.partitioning}`,
        lost.length ? `LOST: ${lost.join(", ")}` : "no capability lost",
      ];
    });
}));

console.log("\n### Q-D perturbations deliberately NOT measured (OWNER DECISION, not design changes)\n");
for (const r of REFUSED) console.log(`- ${r.change}: ${r.why}`);
console.log("\nwritten: testdata/substrate-diagnostic/qD-protected-envelope.jsonl");
