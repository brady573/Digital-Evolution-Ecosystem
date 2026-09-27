/**
 * Plated proof fixtures: one continuous Plated lineage across M0..M4.
 *
 * Metabolism raw trait = 0.04 + M*0.46 (M normalized over TRAIT_RANGES
 * [0.04, 0.5] — every sample stays inside the biological range; no range
 * changes). All other traits fixed at Plated-center baselines. Resolution is
 * sequentially lineage-anchored (each sample's parent is the previous
 * sample's family), same lineageId — one continuous lineage per §4.1.
 */
import {
  resolvePhenotype,
  type ResolvedPhenotype,
  type TraitSample,
} from "../../packages/phenotype/src/index.ts";
import { FLIP_LABELS, FLIP_M, SWEEP_M } from "./render.ts";

export const LINEAGE_ID = 4242;

function baseTraits(metabolismRaw: number): TraitSample {
  return {
    speed: 1.4,
    sensing: 70,
    metabolism: metabolismRaw,
    reproduction: 100,
    diet: 0.675,
    habitat: 0.675,
    byproductUse: 0.68,
    dormancyResponse: 1.0,
  };
}

export interface SweepSample {
  label: string;
  m: number;
  metabolismRaw: number;
  traits: TraitSample;
  res: ResolvedPhenotype;
  organismId: number;
}

export function platedSweep(): SweepSample[] {
  // Descending lineage M4->M0: M4 founds as plated, each child anchors to its
  // parent. Under hybrid calibration the whole chain holds Plated.
  const labels = ["M4", "M3", "M2", "M1", "M0"];
  const out: SweepSample[] = [];
  let parent: "plated" | null = null;
  SWEEP_M.forEach((m, i) => {
    const raw = 0.04 + m * 0.46;
    const traits = baseTraits(raw);
    const res = resolvePhenotype(traits, {
      parentFamily: parent,
      organismId: 7000,
      lineageId: LINEAGE_ID,
    });
    if (res.family !== "plated") {
      throw new Error(`sweep broke family at ${labels[i]} (m=${m}): got ${res.family}`);
    }
    parent = res.family;
    out.push({ label: labels[i]!, m, metabolismRaw: raw, traits, res, organismId: 7000 });
  });
  return out;
}

export interface FlipSample extends SweepSample {
  founderFamily: string;
  anchoredFamily: string;
}

/**
 * Retention-pair evidence: M0/M1 resolve blob as founders but retain plated
 * under lineage anchoring — hysteresis working as designed, and the reason
 * the full sweep holds along one lineage. Rendered as founder-vs-anchored.
 */
export function flipSamples(): FlipSample[] {
  return FLIP_M.map((m, i) => {
    const raw = 0.04 + m * 0.46;
    const traits = baseTraits(raw);
    const founder = resolvePhenotype(traits, { organismId: 7100 + i, lineageId: LINEAGE_ID });
    const anchored = resolvePhenotype(traits, { parentFamily: "plated", organismId: 7100 + i, lineageId: LINEAGE_ID });
    if (founder.family !== "blob" || anchored.family !== "plated") {
      throw new Error(`retention assumption broken at ${FLIP_LABELS[i]}: founder=${founder.family} anchored=${anchored.family}`);
    }
    return {
      label: FLIP_LABELS[i]!, m, metabolismRaw: raw, traits, res: anchored,
      organismId: 7100 + i, founderFamily: founder.family, anchoredFamily: anchored.family,
    };
  });
}

/** Parent→descendant continuity pair: M2 parent, small metabolism mutation. */
export function continuityPair(): { parent: SweepSample; child: SweepSample } {
  const samples = platedSweep();
  const parent = samples[2]!;
  const childTraits: TraitSample = { ...parent.traits, metabolism: parent.traits.metabolism * 1.06 };
  const childRes = resolvePhenotype(childTraits, {
    parentFamily: parent.res.family,
    organismId: 7999,
    lineageId: LINEAGE_ID,
  });
  return {
    parent,
    child: { label: "M2+child", m: NaN, metabolismRaw: childTraits.metabolism, traits: childTraits, res: childRes, organismId: 7999 },
  };
}
