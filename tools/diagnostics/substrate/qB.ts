import {
  Simulation, maintainedConfig, REGIMES, SEEDS, drain, newAcc, emit, emitFresh,
  header, summarise,
} from "./common.ts";

/**
 * Question B — opportunity-frequency map.
 *
 * For every supported channel: how often the event happens, what fraction of the
 * population is exposed to it, how long an exposure lasts, what recurrence class
 * it belongs to, how large the realised effect is, and how long the effect
 * compounds over.
 *
 * The point of the map is to make a rare one-shot benefit visibly comparable with
 * a recurring cost. A channel that fires once per 40k ticks cannot support an
 * evolvable tradeoff against a channel that fires every tick, however large its
 * single effect is.
 *
 * All counts come from maintained interval counters, drained every tick because
 * the engine replaces `sim.cur` every EVENT_STRIDE ticks. Per-organism state is
 * read, never written.
 */

/** Recurrence classes are assigned by observed rate, not by assumption. */
function recurrenceClass(events: number, horizon: number): string {
  const per1k = (events / horizon) * 1000;
  if (events === 0) return "never observed";
  if (per1k >= 100) return "per-tick";
  if (per1k >= 1) return "per-1000-ticks";
  if (per1k >= 0.01) return "per-generation";
  return `rare (~${Math.round(horizon / per1k / 1000)}k ticks/event)`;
}

const mean = (xs: number[]) => (xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : null);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

function opportunityMap(configName: string, regime: any, regimeName: string, seed: number, horizon: number) {
  const sim: any = new Simulation({ ...maintainedConfig(configName, seed), ...regime });
  const acc = newAcc();

  // Cumulative realized energy per organism, so per-tick gain is exact.
  const lastRealized = new Map<number, number>();
  for (const o of sim.o) lastRealized.set(o.id, (o.ga || 0) + (o.gb || 0) + (o.gc || 0));

  const bornTick = new Map<number, number>();
  for (const o of sim.o) bornTick.set(o.id, o.born);
  const firstBirthTick = new Map<number, number>();
  const newbornEnergy: number[] = [];
  const wakeTick = new Map<number, number>();

  // Open episodes, keyed by organism. Only dormancy episodes are tracked here:
  // main does not publish blocked births per organism, so blocked-birth duration
  // cannot be measured without inventing attribution (see the channel note).
  const openDormancy = new Map<number, number>();
  const dormancyLengths: number[] = [];

  let organismTicks = 0, activeTicks = 0, dormantTicks = 0;
  let fedTicks = 0, realizedEnergy = 0;
  let matureTicks = 0;

  for (let t = 1; t <= horizon; t++) {
    const before = new Set(sim.o.map((o: any) => o.id));
    sim.step();
    drain(sim, acc);

    const parentsWithBirth = new Set<number>();
    for (const o of sim.o) {
      if (before.has(o.id)) continue;
      bornTick.set(o.id, sim.t);
      newbornEnergy.push(o.en);
      if (o.parent !== null) parentsWithBirth.add(o.parent);
    }

    const living = new Set<number>();
    for (const o of sim.o) {
      living.add(o.id);
      organismTicks++;
      const realized = (o.ga || 0) + (o.gb || 0) + (o.gc || 0);
      const prior = lastRealized.get(o.id) ?? realized;
      const gain = realized - prior;
      lastRealized.set(o.id, realized);

      if (o.activity === "dormant") {
        dormantTicks++;
        if (!openDormancy.has(o.id)) openDormancy.set(o.id, t);
      } else {
        activeTicks++;
        if (gain > 0) { fedTicks++; realizedEnergy += gain; }
      }
      if (o.lastWakeTick === t) wakeTick.set(o.id, t);
      if (sim.t >= (o.matureAt || 0)) matureTicks++;
    }

    for (const pid of parentsWithBirth) if (!firstBirthTick.has(pid)) firstBirthTick.set(pid, t);

    // Close episodes for organisms that died or woke.
    for (const [id, start] of openDormancy) {
      if (!living.has(id) || sim.o.find((o: any) => o.id === id)?.activity !== "dormant") {
        dormancyLengths.push(t - start);
        openDormancy.delete(id);
      }
    }
  }
  for (const [, start] of openDormancy) dormancyLengths.push(horizon + 1 - start);

  // Latencies.
  const birthToFirstBirth: number[] = [];
  for (const [id, t] of firstBirthTick) {
    const b = bornTick.get(id);
    if (b !== undefined && t > b) birthToFirstBirth.push(t - b);
  }
  const wakeToBirth: number[] = [];
  for (const [id, w] of wakeTick) {
    const f = firstBirthTick.get(id);
    if (f !== undefined && f > w) wakeToBirth.push(f - w);
  }

  const pct = (n: number) => +(((n / Math.max(1, organismTicks)) * 100).toFixed(2));
  const channel = (c: {
    channel: string; events: number; exposurePct: number; durationMean: number | null;
    durationMedian: number | null; effect: string; compounding: string; note: string;
  }) => ({
    channel: c.channel,
    events: c.events,
    per1kTicks: +((c.events / horizon) * 1000).toFixed(2),
    exposurePct: c.exposurePct,
    recurrence: recurrenceClass(c.events, horizon),
    durationMean: c.durationMean,
    durationMedian: c.durationMedian,
    effect: c.effect,
    compoundingHorizon: c.compounding,
    note: c.note,
  });

  const channels = [
    channel({
      channel: "feeding / energy gain", events: fedTicks, exposurePct: pct(fedTicks),
      durationMean: null, durationMedian: null,
      effect: `mean +${(realizedEnergy / Math.max(1, fedTicks)).toFixed(3)} energy/feeding tick`,
      compounding: "continuous", note: "organism-ticks with a positive realized-energy gain",
    }),
    channel({
      channel: "movement / settlement contention", events: acc.movement_intents ?? 0,
      exposurePct: pct(acc.movement_intents ?? 0), durationMean: null, durationMedian: null,
      effect: `${acc.movement_blocked ?? 0} blocked intents (${acc.movement_redirected ?? 0} redirected)`,
      compounding: "per-tick", note: "cross-cell movement intents; blocked = settlement contention",
    }),
    channel({
      channel: "Waste exposure", events: acc.burden_energy ?? 0, exposurePct: null,
      durationMean: null, durationMedian: null,
      effect: `${(acc.burden_energy ?? 0).toFixed(1)} burden energy`, compounding: "continuous",
      note: "burden is an energy quantity, not an event count; no exposure share is published",
    }),
    channel({
      channel: "Waste cleanup", events: acc.cleanup_exec ?? 0, exposurePct: pct(acc.cleanup_exec ?? 0),
      durationMean: null, durationMedian: null,
      effect: `${(acc.removed_w ?? 0).toFixed(2)} removed, ${(acc.cleanup_energy ?? 0).toFixed(1)} energy`,
      compounding: "continuous", note: "cleanup process executions",
    }),
    channel({
      channel: "dormancy entry", events: acc.dormancy_entries ?? 0, exposurePct: pct(dormancyLengths.reduce((a, b) => a + b, 0)),
      durationMean: mean(dormancyLengths), durationMedian: median(dormancyLengths),
      effect: `${dormancyLengths.length} episodes`, compounding: "multi-generation",
      note: "mean/median dormant episode length in ticks",
    }),
    channel({
      channel: "wake", events: acc.wakes ?? 0, exposurePct: pct(acc.wakes ?? 0),
      durationMean: mean(wakeToBirth), durationMedian: median(wakeToBirth),
      effect: `${wakeToBirth.length} wakes led to a later birth`, compounding: "multi-generation",
      note: "mean/median ticks from wake to that organism's next birth",
    }),
    channel({
      // Maintained counter, not a recomputed gate. The engine evaluates the
      // mature/ready/rp gate BEFORE the birth commit spends the parent's
      // reserve, so an organism that reproduces reads as ineligible once the
      // tick's post-step state is observed. Recomputing the gate after the step
      // therefore reports ~0 eligible organism-ticks in a run that made tens of
      // thousands of births. The maintained `repro_eligible` counter is the
      // exact quantity and is what the substrate map must use.
      channel: "reproduction eligibility", events: acc.repro_eligible ?? 0,
      exposurePct: pct(acc.repro_eligible ?? 0),
      durationMean: null, durationMedian: null, effect: "gate satisfied", compounding: "per-tick",
      note: "maintained repro_eligible counter (organism-ticks satisfying the mature + ready + rp gate)",
    }),
    channel({
      channel: "successful birth", events: acc.births ?? 0, exposurePct: pct(acc.births ?? 0),
      durationMean: null, durationMedian: null,
      effect: `mean newborn energy ${mean(newbornEnergy)}`, compounding: "per-generation",
      note: "maintained birth commit",
    }),
    channel({
      channel: "blocked birth", events: acc.blocked_births ?? 0, exposurePct: null,
      durationMean: null, durationMedian: null,
      effect: `${(acc.blocked_births ?? 0) > 0 ? "placement contention observed" : "no contention"}`,
      compounding: "per-tick while saturated",
      note: "maintained run-level counter; main does not publish blocked births per organism, so no exposure share or streak length is reported",
    }),
    channel({
      channel: "newborn establishment to first birth", events: firstBirthTick.size,
      exposurePct: pct(firstBirthTick.size), durationMean: mean(birthToFirstBirth),
      durationMedian: median(birthToFirstBirth),
      effect: `${firstBirthTick.size}/${bornTick.size} born organisms reproduced`,
      compounding: "per-generation", note: "mean/median ticks from birth to own first birth",
    }),
    channel({
      channel: "catalyst / disturbance exposure", events: 0, exposurePct: null,
      durationMean: null, durationMedian: null, effect: "none", compounding: "one-shot unless scheduled",
      note: "this regime set runs cat=global with st=null: no disturbance fires",
    }),
  ];

  const metrics = sim.metrics();
  return {
    configName, regimeName, seed, horizon,
    population: metrics.population,
    dormantSharePct: pct(dormantTicks),
    activeSharePct: pct(activeTicks),
    matureSharePct: pct(matureTicks),
    eligibleSharePct: pct(acc.repro_eligible ?? 0),
    organismTicks,
    bornTotal: bornTick.size,
    reproducedTotal: firstBirthTick.size,
    establishmentRate: +(firstBirthTick.size / Math.max(1, bornTick.size)).toFixed(4),
    channels,
  };
}

const smoke = process.argv.includes("--smoke");
const horizon = smoke ? 6000 : 40000;
const seeds = smoke ? [333333333] : SEEDS;
emitFresh("qB-opportunity-map.jsonl", header({ question: "B", horizon, seeds, regimes: Object.keys(REGIMES) }));

const rows: any[] = [];
for (const regimeName of Object.keys(REGIMES)) {
  for (const seed of seeds) {
    const r = opportunityMap("balanced", REGIMES[regimeName], regimeName, seed, horizon);
    rows.push(r);
    emit("qB-opportunity-map.jsonl", header(r));
  }
}

summarise("Q-B opportunity-frequency map", [
  "regime", "seed", "channel", "events", "per1k", "exposure%", "recurrence",
  "dur mean", "dur med", "effect",
], rows.flatMap((r) => r.channels.map((c: any) => [
  r.regimeName, r.seed, c.channel, c.events, c.per1kTicks, c.exposurePct ?? "n/a",
  c.recurrence, c.durationMean ?? "n/a", c.durationMedian ?? "n/a", c.effect,
])));

summarise("Q-B population context", [
  "regime", "seed", "population", "dormant%", "mature%", "eligible%", "born", "reproduced", "establishmentRate",
], rows.map((r) => [
  r.regimeName, r.seed, r.population, r.dormantSharePct, r.matureSharePct,
  r.eligibleSharePct, r.bornTotal, r.reproducedTotal, r.establishmentRate,
]));

console.log("\nwritten: testdata/substrate-diagnostic/qB-opportunity-map.jsonl");
