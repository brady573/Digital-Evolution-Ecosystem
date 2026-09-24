import { writeFileSync } from "node:fs";
import { UniverseSession } from "../../packages/sim-runtime/src/session.ts";
import type { EngineConfig } from "../../packages/contracts/src/index.ts";

// Phone performance ceiling probe (Phase 1a): measures sustainable
// ticks/sec against living population on the actual target device.
// Config-only sweep over the prod knob (balanced base); no engine changes.
//
// Usage: pnpm bench:ceiling [-- --out=phone-ceiling.json]
// Each level: warm up, then time a measured window. Results show where
// tick rate falls off as population grows.
function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const OUT = arg("out", "phone-ceiling.json");
const PRODS = [0.6, 0.9, 1.23, 1.6, 2.2];
const WARMUP = 8000;
const MEASURED = 4000;
const CHUNK = 1000;

function config(prod: number): EngineConfig {
  return {
    seed: 821947219,
    start: 0.58,
    prod,
    cap: 360,
    pop: 30,
    div: 0.35,
    mr: 0.03,
    ms: 0.12,
    press: 1.0875,
    patch: 0.6,
    resource_b_fraction: 0.5,
    cat: "global",
    st: null,
    resource_model: "definition_driven_substances",
    resource_grid: 60,
    enable_byproduct: true,
    enable_dormancy: true,
    study: true,
  };
}

const levels: any[] = [];
for (const prod of PRODS) {
  const session = new UniverseSession();
  session.create(config(prod));
  session.advance(WARMUP);
  const t0 = performance.now();
  session.advance(MEASURED);
  const dt = (performance.now() - t0) / 1000;
  const snap: any = session.snapshot();
  const rate = MEASURED / dt;
  const row = {
    prod, tick: snap.tick, population: snap.population,
    dormant: snap.dormantPopulation, peak: snap.metrics.peak_population,
    ticksPerSecond: Math.round(rate),
    msPerTick: Number((dt / MEASURED * 1000).toFixed(3)),
  };
  levels.push(row);
  console.log(`prod=${prod}: pop=${row.population} peak=${row.peak} rate=${row.ticksPerSecond} t/s`);
}

const result = { device: "android-arm64 (target)", warmup: WARMUP, measured: MEASURED, levels };
writeFileSync(OUT, JSON.stringify(result, null, 2));
console.log(`phone ceiling: DONE -> ${OUT}`);
