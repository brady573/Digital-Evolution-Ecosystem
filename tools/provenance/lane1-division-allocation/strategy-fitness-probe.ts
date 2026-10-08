import { Simulation } from "../../../packages/sim-core/src/engine.ts";

// Strategy-fitness probe: force one DA value on every organism every tick.
// da=0.75 is exactly neutral (shift == 0), so arm C is maintained biology.
// Comparing A/B against C answers whether DA has any population-level effect
// at all, which decides whether Phase B selection is reachable.
const base: any = {
  seed: 7, cap: 360, pop: 30, div: 0.35, mr: 0.1, ms: 0.12, press: 1.0875,
  patch: 0.6, resource_b_fraction: 0.5, cat: "global", st: null,
  resource_model: "definition_driven_substances", resource_grid: 60,
  enable_byproduct: true, enable_dormancy: true, study: true,
};
const regimes: Record<string, any> = {
  "replete 1.4/1.4": { start: 1.4, prod: 1.4 },
  "default 0.58/0.77": { start: 0.58, prod: 0.77 },
  "poor 0.22/0.22": { start: 0.22, prod: 0.22 },
};
const TICKS = Number(process.argv[2] || 12000);

function arm(over: any, da: number) {
  const sim: any = new Simulation({ ...base, ...over });
  let births = 0;
  for (const o of sim.o) o.da = da;
  for (let t = 1; t <= TICKS; t++) {
    for (const o of sim.o) o.da = da;
    sim.step();
    births += sim.cur.births || 0;
  }
  const m: any = sim.metrics();
  return { pop: sim.o.length, births, dorm: m.dormant_population, gen: m.mean_generation ?? null };
}

for (const [name, over] of Object.entries(regimes)) {
  for (const seed of [7, 4242]) {
    const a = arm({ ...over, seed }, 0);
    const c = arm({ ...over, seed }, 0.75);
    const b = arm({ ...over, seed }, 1.5);
    console.log(
      `${name} seed=${seed} | parent-retain(da0) pop=${a.pop} births=${a.births} | neutral pop=${c.pop} births=${c.births} | provision(da1.5) pop=${b.pop} births=${b.births}` +
      ` || Δpop retain=${a.pop - c.pop} provision=${b.pop - c.pop} Δbirths retain=${a.births - c.births} provision=${b.births - c.births}`,
    );
  }
}
