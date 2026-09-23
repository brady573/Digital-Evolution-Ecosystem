import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  Simulation,
  createLegacyRng,
} from "../../packages/sim-core/src/engine.ts";
import { DeterministicRng } from "../../packages/sim-core/src/rng.ts";
import { UniverseSession } from "../../packages/sim-runtime/src/session.ts";
import { EcologyObserver } from "../../packages/sim-analysis/src/index.ts";
import { createSimulationCheckpoint, restoreSimulationCheckpoint, EVENT_STRIDE } from "../../packages/sim-core/src/engine.ts";

const here = dirname(fileURLToPath(import.meta.url));
const prototypePath = resolve(
  here,
  "../../legacy/prototype/digital_evolution_prototype_v0_29_recovered.html",
);

function closeBrace(source: string, start: number): number {
  let i = source.indexOf("{", start);
  let depth = 0;
  let mode: "code" | "line" | "block" | "str" | "template" = "code";
  let quote = "";
  let escaped = false;

  for (; i < source.length; i += 1) {
    const c = source[i]!;
    const n = source[i + 1];

    if (mode === "line") {
      if (c === "\n") mode = "code";
      continue;
    }
    if (mode === "block") {
      if (c === "*" && n === "/") {
        mode = "code";
        i += 1;
      }
      continue;
    }
    if (mode === "str") {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (c === "\\") {
        escaped = true;
        continue;
      }
      if (c === quote) {
        mode = "code";
        quote = "";
      }
      continue;
    }
    if (mode === "template") {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (c === "\\") {
        escaped = true;
        continue;
      }
      if (c === "`") mode = "code";
      continue;
    }

    if (c === "/" && n === "/") {
      mode = "line";
      i += 1;
      continue;
    }
    if (c === "/" && n === "*") {
      mode = "block";
      i += 1;
      continue;
    }
    if (c === "'" || c === '"') {
      mode = "str";
      quote = c;
      continue;
    }
    if (c === "`") {
      mode = "template";
      continue;
    }
    if (c === "{") depth += 1;
    if (c === "}") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }

  throw new Error("Could not find class closing brace");
}

function loadLegacySimulation(): any {
  const html = fs.readFileSync(prototypePath, "utf8");
  const start = html.indexOf("const Q=");
  const simStart = html.indexOf("class S{", start);
  assert.ok(start >= 0 && simStart >= 0, "legacy core markers must exist");
  const end = closeBrace(html, simStart);
  const source =
    html.slice(start, end) +
    "\n;globalThis.__migrationLegacy={S,RS,EcologyObserver,R};";

  const context: Record<string, unknown> = {
    structuredClone,
  };
  vm.createContext(context);
  vm.runInContext(source, context, {
    filename: "digital_evolution_prototype_v0_29_recovered.core.js",
  });
  return (context as any).__migrationLegacy.S;
}

function config(seed: number, mode: "balanced" | "harsh" = "balanced") {
  if (mode === "harsh") {
    const rich = 0.38;
    return {
      seed: seed >>> 0,
      start: 0.25 + rich * 0.55,
      prod: 0.08 + rich * 1.15,
      cap: 360,
      pop: 30,
      div: 0.35,
      mr: 0.04,
      ms: 0.12,
      press: 0.75 + 0.78 * 0.75,
      patch: 0.55,
      resource_b_fraction: 0.4,
      cat: "global",
      st: null,
      resource_model: "definition_driven_substances",
      resource_grid: 60,
      enable_byproduct: true,
      enable_dormancy: true,
      study: true,
    };
  }

  const rich = 0.6;
  return {
    seed: seed >>> 0,
    start: 0.25 + rich * 0.55,
    prod: 0.08 + rich * 1.15,
    cap: 360,
    pop: 30,
    div: 0.35,
    mr: 0.03,
    ms: 0.12,
    press: 0.75 + 0.45 * 0.75,
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

function parityState(sim: any) {
  return {
    tick: sim.t,
    nextOrganism: sim.nO,
    nextLineage: sim.nL,
    peak: sim.peakPopulation,
    peakTick: sim.peakPopulationTick,
    extinct: sim.extinctTick,
    rng: {
      init: sim.rInit.getState(),
      resource: sim.rFood.getState(),
      behavior: sim.rMove.getState(),
      mutation: sim.rMut.getState(),
      catalyst: sim.rCat.getState(),
    },
    resources: {
      stock: sim.resources.stock.map((a: ArrayLike<number>) => Array.from(a)),
      input: [...sim.resources.input],
      biologicalProduction: [...sim.resources.biologicalProduction],
      consumed: [...sim.resources.consumed],
      decayed: [...sim.resources.decayed],
    },
    organisms: sim.o
      .slice()
      .sort((a: any, b: any) => a.id - b.id)
      .map((o: any) => ({
        id: o.id,
        parent: o.parent,
        generation: o.generation,
        born: o.born,
        matureAt: o.matureAt,
        readyAt: o.readyAt,
        lineage: o.l,
        x: o.x,
        y: o.y,
        energy: o.en,
        speed: o.sp,
        sensing: o.se,
        metabolism: o.me,
        reproduction: o.rp,
        diet: o.di,
        habitat: o.ha,
        byproductUse: o.bu || 0,
        dormancyResponse: o.dr || 0,
        activity: o.activity || "active",
        dormantSince: o.dormantSince ?? null,
        wakeCount: o.wakeCount || 0,
        lastWakeTick: o.lastWakeTick ?? null,
        massA: o.ma,
        massB: o.mb,
        massC: o.mc || 0,
        gainA: o.ga,
        gainB: o.gb,
        gainC: o.gc || 0,
        reproductionA: o.ra,
        reproductionB: o.rb,
        reproductionC: o.rc || 0,
      })),
  };
}

function assertSame(label: string, a: any, b: any): void {
  assert.equal(
    JSON.stringify(parityState(a)),
    JSON.stringify(parityState(b)),
    label,
  );
}

function runLegacyParity(seed: number, mode: "balanced" | "harsh", ticks: number) {
  const LegacySimulation = loadLegacySimulation();
  const legacy = new LegacySimulation(config(seed, mode));
  const migrated = new Simulation(config(seed, mode));

  assertSame(`${mode} seed ${seed}: initial state`, legacy, migrated);

  const checkpoints = new Set([1, 251, 502, 1000, ticks]);
  for (let tick = 1; tick <= ticks; tick += 1) {
    legacy.step();
    migrated.step();
    if (checkpoints.has(tick)) {
      assertSame(`${mode} seed ${seed}: tick ${tick}`, legacy, migrated);
    }
  }

  const clone = migrated.clone();
  for (let i = 0; i < 750; i += 1) {
    migrated.step();
    clone.step();
  }
  assertSame(`${mode} seed ${seed}: clone continuation`, migrated, clone);

  const observed = migrated.clone();
  const untouched = migrated.clone();
  for (let i = 0; i < 600; i += 1) {
    observed.metrics();
    if (i % 17 === 0) observed.out();
    observed.step();
    untouched.step();
  }
  assertSame(
    `${mode} seed ${seed}: inspection must not change biology`,
    observed,
    untouched,
  );
}

function runRngParity() {
  const seed = 0x1234abcd;
  const legacy = createLegacyRng(seed);
  const migrated = new DeterministicRng(seed);
  for (let i = 0; i < 10_000; i += 1) {
    assert.equal(migrated.next(), legacy(), `RNG value ${i}`);
  }
  assert.equal(migrated.getState(), legacy.getState(), "RNG state");
}

runRngParity();
runLegacyParity(821947219, "balanced", 2000);
runLegacyParity(3543950664, "balanced", 2000);
runLegacyParity(912367481, "harsh", 1500);

console.log("migration parity: PASS");


function runExternalAnalysisIsolation(){
  const cfg=config(821947219,"balanced");
  const observed=new Simulation(cfg);
  const untouched=new Simulation(cfg);
  const observer=new EcologyObserver();
  for(let i=0;i<3000;i++){
    observed.step();
    if(observed.t%EVENT_STRIDE===0)observer.observe(observed.observerSnapshot(observed.metrics(),observed.last));
    untouched.step();
  }
  assertSame("external analysis must not change biology",observed,untouched);
}

function runCheckpointParity(){
  const cfg=config(3543950664,"balanced");
  const uninterrupted=new Simulation(cfg);
  for(let i=0;i<1600;i++)uninterrupted.step();
  const checkpoint=JSON.parse(JSON.stringify(createSimulationCheckpoint(uninterrupted)));
  const restored=restoreSimulationCheckpoint(checkpoint);
  assertSame("checkpoint immediate restore",uninterrupted,restored);
  for(let i=0;i<1200;i++){uninterrupted.step();restored.step()}
  assertSame("checkpoint resumed continuation",uninterrupted,restored);
}

function runSessionParity(){
  const cfg=config(912367481,"harsh");
  const direct=new Simulation(cfg);
  const session=new UniverseSession();
  session.create(cfg as any);
  for(let block=0;block<8;block++){
    const ticks=251;
    for(let i=0;i<ticks;i++)direct.step();
    session.advance(ticks);
    assertSame(`session parity block ${block}`,direct,session.simulation);
  }
  session.createControlFork();
  const before=session.control.clone();
  session.intervene("global");
  assertSame("matched control remains exact at fork",before,session.control);
  session.advance(500);
  const checkpoint=JSON.parse(JSON.stringify(session.checkpoint()));
  const restored=new UniverseSession();
  restored.restore(checkpoint);
  assertSame("runtime checkpoint experiment",session.simulation,restored.simulation);
  assertSame("runtime checkpoint control",session.control,restored.control);
}

runExternalAnalysisIsolation();
runCheckpointParity();
runSessionParity();
console.log("analysis/runtime/checkpoint parity: PASS");
