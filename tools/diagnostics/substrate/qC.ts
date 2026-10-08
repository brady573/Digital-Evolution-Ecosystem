import {
  Simulation, maintainedConfig, REGIMES, SEEDS, emit, emitFresh, header, summarise,
} from "./common.ts";

/**
 * Question C — selection gradients of accepted traits.
 *
 * Existing maintained traits only. No new trait is introduced and no optimum is
 * searched for: the question is strictly whether selection on a trait REVERSES
 * between regimes, stays NEUTRAL, or points consistently one way.
 *
 * Design — causally clean mixed-lineage competition:
 *
 *  - Two founder groups are placed symmetrically around the maintained founder
 *    mean of the trait, at mean ± 0.5 standard deviations, clamped to the
 *    maintained trait range. The split is by founder id, so both groups start at
 *    exactly 50% of founders and differ in the trait and nothing else.
 *  - Mutation is switched OFF (mr = 0) for the duration of the assay. This is a
 *    measurement control, not a biology change: `mut()` still draws the same
 *    number of RNG values per birth, so the RNG streams advance identically, and
 *    with no effective mutation each lineage keeps its founder trait value. The
 *    trait therefore becomes a fixed genotype whose share change measures pure
 *    differential fitness rather than selection mixed with drift.
 *  - Both share-of-births (flow) and share-of-population (stock) are recorded.
 *    Flow is the gradient measure; stock is the cross-check.
 *
 * A gradient is called REVERSED only when its sign is consistent across every
 * predeclared seed in at least two regimes with opposite signs. Single-seed
 * signs are reported as noise, not as findings.
 */

const TRAITS = [
  { key: "speed", field: "sp", label: "movement speed" },
  { key: "reproduction", field: "rp", label: "reproduction threshold" },
  { key: "dormancy_response", field: "dr", label: "dormancy response" },
  { key: "tolerance", field: "to", label: "waste tolerance" },
  { key: "cleanup", field: "cu", label: "waste cleanup" },
] as const;

const RANGES: Record<string, [number, number]> = {
  sp: [0.25, 4], rp: [55, 220], dr: [0, 1.5], to: [0, 1.5], cu: [0, 1.5],
};

/** Symmetric founder split around the maintained founder distribution. */
function founderSplit(sim: any, field: string) {
  const values = sim.o.map((o: any) => o[field] as number);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
  const [lo, hi] = RANGES[field]!;
  // Shrink the offset until BOTH sides fit, so the achieved split stays
  // symmetric. Clamping each side independently would let one side saturate at a
  // range boundary while the other kept the full offset, quietly turning a
  // "symmetric" contrast into an asymmetric one.
  let offset = 0.5 * sd;
  for (let i = 0; i < 40; i++) {
    if (mean - offset >= lo && mean + offset <= hi) break;
    offset /= 2;
  }
  const low = Math.min(hi, Math.max(lo, mean - offset));
  const high = Math.min(hi, Math.max(lo, mean + offset));
  return {
    mean: +mean.toFixed(4),
    sd: +sd.toFixed(4),
    low: +low.toFixed(4),
    high: +high.toFixed(4),
    offset: +offset.toFixed(4),
    // A collapsed split (low === high) means the contrast is not a contrast at
    // all; such rows must not be read as a zero gradient.
    degenerate: low === high,
  };
}

function gradient(configName: string, regime: any, regimeName: string, seed: number, trait: typeof TRAITS[number], horizon: number, sampleEvery: number) {
  const sim: any = new Simulation({ ...maintainedConfig(configName, seed), ...regime, mr: 0 });
  const split = founderSplit(sim, trait.field);
  // Group membership must be inherited explicitly. A newborn carries a fresh id
  // that no longer exists in the founder map, so `isLow.get(baby.id)` is
  // undefined and every birth would be silently attributed to the high group.
  const isLow = new Map<number, boolean>();
  for (const o of sim.o) {
    const low = o.id % 2 === 0;
    isLow.set(o.id, low);
    o[trait.field] = low ? split.low : split.high;
  }
  const track: { tick: number; lowBirths: number; highBirths: number; lowPop: number; highPop: number }[] = [];
  let lowBirths = 0, highBirths = 0;

  for (let t = 1; t <= horizon; t++) {
    const before = new Set(sim.o.map((o: any) => o.id));
    sim.step();
    for (const o of sim.o) {
      if (before.has(o.id)) continue;
      if (o.parent === null) continue; // a founder re-observed, not a birth
      const parentLow = isLow.get(o.parent);
      if (parentLow === undefined) continue;
      isLow.set(o.id, parentLow); // inherit the founder's group
      if (parentLow) lowBirths++; else highBirths++;
    }
    if (t % sampleEvery === 0 || t === horizon) {
      let lowPop = 0, highPop = 0, unknownPop = 0;
      for (const o of sim.o) {
        const low = isLow.get(o.id);
        // An unassigned organism is counted as neither group. Falling through to
        // the high bucket would be exactly the silent misattribution this
        // harness already had to fix once for births.
        if (low === undefined) unknownPop++;
        else if (low) lowPop++;
        else highPop++;
      }
      track.push({ tick: t, lowBirths, highBirths, lowPop, highPop, unknownPop });
    }
  }
  const totalBirths = lowBirths + highBirths;
  const last = track[track.length - 1]!;
  return {
    configName, regimeName, seed, trait: trait.key, label: trait.label, horizon,
    split, totalBirths,
    lowBirthShare: totalBirths ? +(lowBirths / totalBirths).toFixed(4) : null,
    lowPopShare: last.lowPop + last.highPop > 0 ? +(last.lowPop / (last.lowPop + last.highPop)).toFixed(4) : null,
    // Positive gradient = selection favours the HIGH value of the trait.
    flowGradient: totalBirths ? +(((highBirths - lowBirths) / totalBirths)).toFixed(4) : null,
    stockGradient: last.lowPop + last.highPop > 0
      ? +(((last.highPop - last.lowPop) / (last.lowPop + last.highPop))).toFixed(4) : null,
    finalPopulation: last.lowPop + last.highPop,
    unknownPopAtEnd: last.unknownPop,
    degenerateSplit: split.degenerate,
    track,
  };
}

const smoke = process.argv.includes("--smoke");
const horizon = smoke ? 4000 : 30000;
const sampleEvery = smoke ? 1000 : 2000;
const seeds = smoke ? [333333333] : SEEDS;
emitFresh("qC-selection-gradients.jsonl", header({ question: "C", horizon, seeds, regimes: Object.keys(REGIMES), traits: TRAITS.map((t) => t.key) }));

const rows: any[] = [];
for (const trait of TRAITS) {
  for (const regimeName of Object.keys(REGIMES)) {
    for (const seed of seeds) {
      const r = gradient("balanced", REGIMES[regimeName], regimeName, seed, trait, horizon, sampleEvery);
      rows.push(r);
      emit("qC-selection-gradients.jsonl", header(r));
    }
  }
}

/** Sign classification across seeds, per trait and regime. */
function classify(rows: any[], trait: string, regimeName: string) {
  // A degenerate founder split (low === high) is not a contrast, so its gradient
  // is uninterpretable rather than zero. It is excluded from the verdict and
  // reported separately.
  const rs = rows.filter((r) => r.trait === trait && r.regimeName === regimeName && r.flowGradient !== null);
  const usable = rs.filter((r) => !r.degenerateSplit);
  const dropped = rs.length - usable.length;
  if (!usable.length) return { verdict: dropped ? "no usable rows (degenerate split)" : "no data", signs: "", consistency: "n/a" };
  const signs = usable.map((r) => (r.flowGradient > 0.02 ? "+" : r.flowGradient < -0.02 ? "-" : "0"));
  const plus = signs.filter((s) => s === "+").length;
  const minus = signs.filter((s) => s === "-").length;
  const zero = signs.filter((s) => s === "0").length;
  const verdict = plus === usable.length ? "consistently HIGH"
    : minus === usable.length ? "consistently LOW"
    : zero === usable.length ? "neutral"
    : "mixed (drift/noise)";
  return { verdict, signs: signs.join(""), consistency: `${plus}+/${minus}-/${zero}0 of ${usable.length}${dropped ? ` (${dropped} degenerate dropped)` : ""}` };
}

summarise("Q-C selection gradient per trait × regime (flow = share of births to the HIGH trait value)", [
  "trait", "regime", "seed", "founderMean", "low", "high", "births", "lowBirthShare",
  "flowGrad", "stockGrad", "verdict",
], rows.map((r) => {
  const c = classify(rows, r.trait, r.regimeName);
  return [
    r.trait, r.regimeName, r.seed, r.split.mean, r.split.low, r.split.high, r.totalBirths,
    r.lowBirthShare, r.flowGradient, r.stockGradient, c.verdict,
  ];
}));

const verdictRows: any[] = [];
for (const trait of TRAITS) {
  const perRegime: Record<string, string> = {};
  for (const regimeName of Object.keys(REGIMES)) perRegime[regimeName] = classify(rows, trait.key, regimeName).verdict;
  const values = Object.values(perRegime);
  const hasHigh = values.includes("consistently HIGH");
  const hasLow = values.includes("consistently LOW");
  const reversal = hasHigh && hasLow;
  verdictRows.push([trait.label, ...values, reversal ? "REVERSES across regimes" : hasHigh || hasLow ? "one-directional" : "no opposing signal"]);
}
summarise("Q-C regime reversal summary", ["trait", ...Object.keys(REGIMES), "verdict"], verdictRows);

console.log("\nwritten: testdata/substrate-diagnostic/qC-selection-gradients.jsonl");
