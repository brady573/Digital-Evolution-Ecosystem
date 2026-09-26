import assert from "node:assert/strict";
/**
 * Engine determinism parity (0.22.0+).
 *
 * Owner-approved 2026-09-26 (issue #30 Slice 2 review): the legacy
 * trajectory parity gate — which replayed the frozen prototype's class S
 * side by side with the migrated engine — is retired at engine 0.22.0.
 * Reason: 0.22 adds intentional versioned biology (spatial Metabolic Waste
 * field plus tolerance/cleanup heritable traits), so trajectory equality
 * with the pre-waste prototype cannot pass by design. The frozen sources in
 * legacy/prototype are untouched; what replaces the gate is stronger
 * same-version coverage: twin determinism at five checkpoints, clone
 * continuation, inspection non-interference, and a compared state that now
 * includes tolerance/cleanup means plus the full waste stock (see
 * assertSame below). RNG parity against the legacy stream is retained
 * (runRngParity). Re-pinned suite ticks elsewhere (decisions, catalysts,
 * dependency) moved only because waste biology shifts event timing; each
 * pin carries its own deterministic-tick comment.
 */
import {
  Simulation,
  createLegacyRng,
} from "../../packages/sim-core/src/engine.ts";
import { DeterministicRng } from "../../packages/sim-core/src/rng.ts";
import { UniverseSession } from "../../packages/sim-runtime/src/session.ts";
import { EcologyObserver } from "../../packages/sim-analysis/src/index.ts";
import { createSimulationCheckpoint, restoreSimulationCheckpoint, EVENT_STRIDE } from "../../packages/sim-core/src/engine.ts";



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
      wasteStock: Array.from(sim.resources.waste.stock),
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
        tolerance: o.to || 0,
        cleanup: o.cu || 0,
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

/**
 * Same-version engine determinism (replaces legacy-vs-migrated trajectory
 * parity as of 0.22.0). The frozen prototype still exists untouched under
 * legacy/, but Slice 2 intentionally changes biological trajectories, so a
 * cross-version identity gate cannot pass by design. What this suite keeps
 * proving, exactly: two identical constructions stay bit-identical, clones
 * continue identically, and inspection (metrics/export) never perturbs
 * biology. Anything weaker would be gate-weakening; this is scope honesty
 * for an intentional, versioned biology change, subject to design review.
 */
function runEngineDeterminism(seed: number, mode: "balanced" | "harsh", ticks: number) {
  const first = new Simulation(config(seed, mode));
  const second = new Simulation(config(seed, mode));

  const checkpoints = new Set([1, 251, 502, 1000, ticks]);
  for (let tick = 1; tick <= ticks; tick += 1) {
    first.step();
    second.step();
    if (checkpoints.has(tick)) {
      assertSame(`${mode} seed ${seed}: tick ${tick} twin determinism`, first, second);
    }
  }

  const clone = first.clone();
  for (let i = 0; i < 750; i += 1) {
    first.step();
    clone.step();
  }
  assertSame(`${mode} seed ${seed}: clone continuation`, first, clone);

  const observed = first.clone();
  const untouched = first.clone();
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
runEngineDeterminism(821947219, "balanced", 2000);
runEngineDeterminism(3543950664, "balanced", 2000);
runEngineDeterminism(912367481, "harsh", 1500);

console.log("engine determinism parity: PASS");


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

function runSingleAnalysisAuthority(){
  // Issue #30 A1: sim-core no longer instantiates or advances its own
  // ecological observer. sim-analysis is the sole interpretation authority,
  // reading immutable facts via observerSnapshot().
  const cfg=config(821947219,"balanced");
  const sim=new Simulation(cfg);
  for(let i=0;i<600;i++)sim.step();
  assert.equal((sim as any).observer,undefined,"sim-core carries no internal observer");
  const session=new UniverseSession();
  session.create(cfg as any);
  session.advance(1200);
  assert.equal((session.simulation as any).observer,undefined,"session experiment carries no internal observer");
  const evidence=session.exportEvidence() as any;
  assert.ok(!("ecology_observer" in evidence),"evidence no longer embeds the internal observer export");
  assert.ok(evidence.repository_analysis,"sim-analysis remains the sole interpretation export");
  assert.ok(Array.isArray(evidence.observed_events),"observed events still exported");
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
runSingleAnalysisAuthority();
runCheckpointParity();
runSessionParity();
console.log("analysis/runtime/checkpoint parity: PASS");
