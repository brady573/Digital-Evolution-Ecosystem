import { Simulation } from "../../../packages/sim-core/src/engine.ts";

// Disturbance probe: the remaining DA-8 regime class. A one-shot global
// nutrient crash is a supported catalyst; da=0.75 is exactly maintained
// biology, da=0 / da=1.5 are the two fixed strategies.
const base: any = {
  seed: 7, cap: 360, pop: 30, div: 0.35, mr: 0.1, ms: 0.12, press: 1.0875,
  patch: 0.6, resource_b_fraction: 0.5, cat: "global", st: 6000,
  resource_model: "definition_driven_substances", resource_grid: 60,
  enable_byproduct: true, enable_dormancy: true, study: true,
};
const scenarios: Record<string, any> = {
  "crash@6000 default": { start: 0.58, prod: 0.77 },
  "crash@6000 replete": { start: 1.4, prod: 1.4 },
};
const TICKS = 12000;

function arm(over: any, da: number) {
  const sim: any = new Simulation({ ...base, ...over });
  let births = 0, postCrashBirths = 0;
  for (const o of sim.o) o.da = da;
  for (let t = 1; t <= TICKS; t++) {
    for (const o of sim.o) o.da = da;
    sim.step();
    births += sim.cur.births || 0;
    if (t > 6000) postCrashBirths += sim.cur.births || 0;
  }
  return { pop: sim.o.length, births, postCrashBirths };
}

for (const [name, over] of Object.entries(scenarios)) {
  for (const seed of [7, 4242]) {
    const a = arm({ ...over, seed }, 0);
    const c = arm({ ...over, seed }, 0.75);
    const b = arm({ ...over, seed }, 1.5);
    console.log(
      `${name} seed=${seed} | retain births=${a.births} (post-crash ${a.postCrashBirths}) pop=${a.pop} | neutral births=${c.births} (${c.postCrashBirths}) pop=${c.pop} | provision births=${b.births} (${b.postCrashBirths}) pop=${b.pop}` +
      ` || vs neutral: retain ${a.births - c.births}, provision ${b.births - c.births}`,
    );
  }
}
