import { Simulation } from "../../../packages/sim-core/src/engine.ts";

// Robustness sweep for the two realized-effect assays, across seeds, in the
// realistic (competing) world rather than an isolated one.
const cfg: any = {
  seed: 7, cap: 360, pop: 30, div: 0.35, mr: 0, ms: 0, press: 1.0875,
  patch: 0.6, resource_b_fraction: 0.5, cat: "global", st: null,
  resource_model: "definition_driven_substances", resource_grid: 60,
  enable_byproduct: true, enable_dormancy: true, study: true,
  start: 0.58, prod: 0.77,
};

function split(over: any, da: number) {
  const sim: any = new Simulation({ ...cfg, pop: 10, ...over });
  const p = sim.o[0];
  for (const o of sim.o) if (o !== p) o.rp = 1e9;
  p.rp = 220; p.matureAt = 0; p.readyAt = 0; p.en = 1.2 * p.rp; p.activity = "active";
  for (const o of sim.o) o.da = da;
  const ids = new Set(sim.o.map((o: any) => o.id));
  for (let t = 0; t < 30; t++) {
    sim.step();
    const baby = sim.o.find((o: any) => !ids.has(o.id) && o.parent === p.id);
    if (baby) return { sim, pid: p.id, post: sim.o.find((o: any) => o.id === p.id)!.en, baby, born: baby.born, bid: baby.id };
  }
  throw new Error("no birth");
}

const HORIZON = 30000;
console.log("DA-6 competition-world route to a shared post-birth threshold");
for (const over of [{ start: 0.58, prod: 0.77 }, { start: 0.22, prod: 0.22 }]) {
  for (const seed of [7, 4242, 99]) {
    const res: string[] = [];
    for (const da of [0, 0.75, 1.5]) {
      const arm = split({ ...over, seed }, da);
      const p = arm.sim.o.find((o: any) => o.id === arm.pid)!;
      const PROBE = arm.post * 1.25;
      p.rp = PROBE;
      let outcome = `no-route@${HORIZON}`;
      for (let t = 1; t <= HORIZON; t++) {
        arm.sim.step();
        const live = arm.sim.o.find((o: any) => o.id === arm.pid);
        if (!live) { outcome = `died@${t}`; break; }
        if (live.en >= PROBE) { outcome = `reached@${t}`; break; }
      }
      res.push(`da=${da} post=${arm.post.toFixed(1)} ${outcome}`);
    }
    console.log(`  ${JSON.stringify(over)} seed=${seed} :: ${res.join(" | ")}`);
  }
}

console.log("DA-7 isolated-newborn establishment (ticks to own first birth)");
for (const over of [{ start: 0.16, prod: 0.16 }, { start: 0.58, prod: 0.77 }]) {
  for (const seed of [7, 4242, 99]) {
    const res: string[] = [];
    for (const da of [0, 0.375, 0.75, 1.125, 1.5]) {
      const arm = split({ ...over, seed }, da);
      const sim = arm.sim;
      sim.o = sim.o.filter((o: any) => o.id === arm.bid);
      let ticks = "never";
      for (let t = 1; t <= 40000; t++) {
        sim.step();
        if (!sim.o.some((o: any) => o.id === arm.bid)) break;
        if (sim.o.some((o: any) => o.id !== arm.bid && o.parent === arm.bid)) { ticks = String(t - arm.born); break; }
      }
      res.push(`${da}:${ticks}`);
    }
    console.log(`  ${JSON.stringify(over)} seed=${seed} :: ${res.join(" ")}`);
  }
}
