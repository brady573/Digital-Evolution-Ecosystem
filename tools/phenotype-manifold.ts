import { writeFileSync } from "node:fs";
import { Simulation } from "../packages/sim-core/src/engine.ts";
import { ENGINE_VERSION } from "../packages/sim-core/src/index.ts";
import {
  deriveAxes,
  resolveFounderFamily,
  resolveDescendantFamily,
  distancesToAll,
} from "../packages/phenotype/src/model.ts";
import {
  FAMILY_ORDER,
  type PhenotypeFamily,
} from "../packages/phenotype/src/constants.ts";

/**
 * Phenotype-manifold measurement (review only, never a gate).
 * Prospective lineage-anchored family tracking across the predeclared
 * six-world set (docs/phenotype-manifold-measurement.md).
 *
 * Run: pnpm exec tsx tools/phenotype-manifold.ts [--quick]
 *   --quick runs one world to 10k for tooling validation.
 * Retains testdata/phenotype-manifold-0.24.json (resume-safe per world).
 */

const OUT = "testdata/phenotype-manifold-0.24.json";
const HORIZON = 50000;
const SAMPLE_EVERY = 10000;

const WORLDS = [
  { config: "balanced", seed: 24681357 },
  { config: "balanced", seed: 821947219 },
  { config: "patchwork", seed: 24681357 },
  { config: "patchwork", seed: 333333333 },
  { config: "harsh", seed: 111111111 },
  { config: "harsh", seed: 222222222 },
];

function config(name: string, seed: number): any {
  const base = {
    seed, cap: 360, pop: 30, div: 0.35, mr: 0.03,
    ms: 0.12, press: 1.0875, patch: 0.6, resource_b_fraction: 0.5, cat: "global", st: null,
    resource_model: "definition_driven_substances", resource_grid: 60,
    enable_byproduct: true, enable_dormancy: true, study: true,
  } as const;
  if (name === "patchwork") return { ...base, start: 0.62, prod: 0.86, patch: 0.9, pop: 34, div: 0.45 };
  if (name === "harsh") return { ...base, start: 0.47, prod: 0.52, patch: 0.55 };
  return { ...base, start: 0.58, prod: 0.77 };
}

const TRAITS = ["sp", "se", "me", "rp", "di", "ha", "bu", "dr", "to", "cu"] as const;

function traitSample(o: any): Record<string, number> {
  return {
    sp: o.sp, se: o.se, me: o.me, rp: o.rp, di: o.di, ha: o.ha,
    bu: o.bu || 0, dr: o.dr || 0, to: o.to || 0, cu: o.cu || 0,
  };
}

function toAxes(t: Record<string, number>): any {
  return {
    speed: t.sp, sensing: t.se, metabolism: t.me, reproduction: t.rp,
    diet: t.di, habitat: t.ha, byproductUse: t.bu, dormancyResponse: t.dr,
  };
}

function dist(vals: number[]): { mean: number; p5: number; p95: number; max: number } {
  if (!vals.length) return { mean: 0, p5: 0, p95: 0, max: 0 };
  const s = [...vals].sort((a, b) => a - b);
  const q = (p: number): number => s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
  return {
    mean: vals.reduce((a, b) => a + b, 0) / vals.length,
    p5: q(0.05), p95: q(0.95), max: s[s.length - 1]!,
  };
}

function runWorld(world: { config: string; seed: number }, horizon: number): any {
  const sim = new Simulation(config(world.config, world.seed)) as any;
  // Prospective descendant map: id -> current visual family. Founders
  // resolve founder-style; every birth resolves from the living parent's
  // mapped family (parents are always alive at birth). Never deleted, so
  // dead intermediates never break chains.
  const fam = new Map<number, PhenotypeFamily>();
  for (const o of sim.o) fam.set(o.id, resolveFounderFamily(deriveAxes(toAxes(traitSample(o)))));
  let lastSeenId = Math.max(...sim.o.map((o: any) => o.id));
  const transitions: any[] = [];
  const samples: any[] = [];
  const founderMeans: Record<string, number> = {};
  for (const t of TRAITS) {
    founderMeans[t] = sim.o.reduce((s: number, o: any) => s + (traitSample(o) as any)[t], 0) / sim.o.length;
  }
  const absorbNewborns = (): void => {
    for (const o of sim.o) {
      if (o.id <= lastSeenId || fam.has(o.id)) continue;
      const parentFam = fam.get(o.parent);
      const axes = deriveAxes(toAxes(traitSample(o)));
      const f = parentFam === undefined ? resolveFounderFamily(axes) : resolveDescendantFamily(axes, parentFam);
      fam.set(o.id, f);
      if (parentFam !== undefined && f !== parentFam) {
        transitions.push({ tick: o.born, from: parentFam, to: f, traits: traitSample(o) });
      }
    }
    lastSeenId = Math.max(lastSeenId, ...sim.o.map((o: any) => o.id));
  };
  const sample = (tick: number): any => {
    const fams: Record<string, number> = {};
    const descs: Record<string, number> = {};
    for (const f of FAMILY_ORDER) { fams[f] = 0; descs[f] = 0; }
    const traitVals: Record<string, number[]> = {};
    const axisVals: Record<string, number[]> = { mobility: [], sensing: [], metabolism: [], specialization: [] };
    for (const t of TRAITS) traitVals[t] = [];
    let genSum = 0, genMax = 0, estSame = 0, estTotal = 0;
    let toDivSum = 0, toDivMax = 0, cuDivSum = 0, cuDivMax = 0;
    for (const o of sim.o) {
      const t = traitSample(o);
      const axes = deriveAxes(toAxes(t));
      const ff = resolveFounderFamily(axes);
      fams[ff]!++;
      const df = fam.get(o.id) ?? ff;
      descs[df]!++;
      for (const k of TRAITS) traitVals[k]!.push((t as any)[k]);
      axisVals.mobility!.push(axes.mobility); axisVals.sensing!.push(axes.sensing);
      axisVals.metabolism!.push(axes.metabolism); axisVals.specialization!.push(axes.specialization);
      genSum += o.generation || 0;
      genMax = Math.max(genMax, o.generation || 0);
      const lest = (sim.L as Map<number, any>).get(o.l)?.established === true;
      if (lest) {
        estTotal++;
        if (df === ff) estSame++;
        const dt = Math.abs(t.to - (founderMeans.to ?? 0)), dc = Math.abs(t.cu - (founderMeans.cu ?? 0));
        toDivSum += dt; toDivMax = Math.max(toDivMax, dt);
        cuDivSum += dc; cuDivMax = Math.max(cuDivMax, dc);
      }
    }
    const traits: Record<string, any> = {};
    for (const k of TRAITS) traits[k] = dist(traitVals[k]!);
    const axes: Record<string, any> = {};
    for (const k of Object.keys(axisVals)) axes[k] = dist(axisVals[k]!);
    return {
      tick, population: sim.o.length,
      meanGeneration: sim.o.length ? genSum / sim.o.length : 0, maxGeneration: genMax,
      traits, axes, founderFamilies: fams, descendantFamilies: descs,
      establishedSameFamilyFraction: estTotal ? estSame / estTotal : null,
      establishedCount: estTotal,
      ignoredCapabilityDivergence: {
        toMeanAbs: estTotal ? toDivSum / estTotal : 0, toMaxAbs: toDivMax,
        cuMeanAbs: estTotal ? cuDivSum / estTotal : 0, cuMaxAbs: cuDivMax,
      },
    };
  };
  while (sim.t < horizon) {
    sim.step();
    if (sim.t % 1000 === 0) absorbNewborns();
    if (sim.t % SAMPLE_EVERY === 0) samples.push(sample(sim.t));
  }
  absorbNewborns();
  // Final-sample hysteresis decomposition per living organism.
  let both = 0, retained = 0, never = 0, nonBlobFounder = 0, departed = 0;
  for (const o of sim.o) {
    const axes = deriveAxes(toAxes(traitSample(o)));
    const ff = resolveFounderFamily(axes);
    const df = fam.get(o.id) ?? ff;
    if (ff === "blob" && df === "blob") {
      const d = distancesToAll(axes);
      const minNon = Math.min(d.segmented!, d.radial!, d.plated!, d.branching!, d.paddled!);
      if (minNon - d.blob! > 0.1) never++;
      else both++;
    } else if (ff !== "blob" && df === "blob") retained++;
    else if (ff !== "blob" && df !== "blob") nonBlobFounder++;
    else departed++;
  }
  return {
    world, engine: ENGINE_VERSION, horizon: sim.t,
    samples, transitions,
    transitionCount: transitions.length,
    hysteresis: { blobBoth: both, retainedByHysteresis: retained, neverApproaches: never, nonBlobFounder, departedBlob: departed },
  };
}

const quick = process.argv.includes("--quick");
const worlds = quick ? [WORLDS[0]!] : WORLDS;
const horizon = quick ? 10000 : HORIZON;
const rows = worlds.map((w) => {
  console.log(`manifold: ${w.config}/${w.seed} -> ${horizon}`);
  return runWorld(w, horizon);
});
const artifact = { engine: ENGINE_VERSION, protocol: "docs/phenotype-manifold-measurement.md", rows };
if (!quick) {
  writeFileSync(OUT, JSON.stringify(artifact, null, 2) + "\n");
  console.log(`retained ${rows.length} worlds -> ${OUT}`);
}
for (const r of rows) {
  const last = r.samples[r.samples.length - 1];
  console.log(`${r.world.config}/${r.world.seed} pop=${last.population} gen=${last.meanGeneration.toFixed(1)}/${last.maxGeneration} founder=${JSON.stringify(last.founderFamilies)} desc=${JSON.stringify(last.descendantFamilies)} transitions=${r.transitionCount} hyst=${JSON.stringify(r.hysteresis)}`);
}
