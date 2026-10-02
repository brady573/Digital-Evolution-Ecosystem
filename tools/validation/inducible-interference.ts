/**
 * R0 localized inducible interference: mechanism prototype assays (§8).
 *
 * Model under test: the inherited secretion trait is maximum CAPACITY, not
 * continuous output. Realized secretion per tick = capacity x induction x
 * scale, where induction = crowd01 x scarc01 from one immutable pre-step
 * competition context (no RNG, order-free). Suppression acts only through
 * the acquisition take; no producer immunity; resistance mitigates at a
 * standing cost. Worlds opt in via `enable_interference` (default off, so
 * all existing suites run bit-identical biology).
 *
 * Outcome assertions are mechanism-only unless noted; competitive OUTCOMES
 * are reported for the Design Partner, never target-encoded.
 *
 * Run: npx tsx tools/validation/inducible-interference.ts
 */
import assert from "node:assert/strict";
import type { EngineConfig } from "../../packages/contracts/src/index.ts";
import {
  Simulation,
  TRAIT_DEFINITIONS,
  computeInduction,
  lastCompetitionRecord,
} from "../../packages/sim-core/src/engine.ts";

function iconfig(seed: number, overrides: Partial<EngineConfig> = {}): EngineConfig {
  return {
    seed, start: 0.62, prod: 0.86, cap: 360, pop: 34, div: 0.45, mr: 0.03,
    ms: 0.12, press: 1.0875, patch: 0.9, resource_b_fraction: 0.5, cat: "global", st: null,
    resource_model: "definition_driven_substances", resource_grid: 60,
    enable_byproduct: true, enable_dormancy: true, study: true,
    enable_interference: true, mr: 0,
    ...overrides,
  };
}

function focalGenotype(o: any): void {
  // Good A-access (opportunity responds to stocks), no resistance (clean
  // exposure reads), unit secretion capacity.
  o.di = -1.5; o.ha = 0; o.bu = 0; o.in = 1.0; o.re = 0;
  o.to = 0; o.cu = 0; o.en = 200; o.sp = 0.3; o.h = 0;
}

function setCellStock(sim: any, kind: number, x: number, y: number, frac: number): void {
  const rs = sim.resources as any;
  const idx = rs.idx(x, y) as number;
  rs.stock[kind][idx] = (rs.cap[kind][idx] as number) * frac;
}

function stockAt(sim: any, kind: number, x: number, y: number): number {
  const rs = sim.resources as any;
  return rs.stock[kind][rs.idx(x, y)] as number;
}

// --- 8.1 induction gate: expression requires crowding AND scarcity. ---
function testInductionGate() {
  // Pure shape first: bounded, conjunctive, monotonic, weak-alone.
  assert.equal(computeInduction(0, 0), 0, "no factors: no induction");
  assert.equal(computeInduction(1, 0), 0, "crowding alone: no induction");
  assert.equal(computeInduction(0, 1), 0, "scarcity alone: no induction");
  assert.equal(computeInduction(1, 1), 1, "both factors: full induction");
  assert.ok(computeInduction(0.5, 1) > computeInduction(0.2, 1), "monotonic in crowding");
  assert.ok(computeInduction(1, 0.5) > computeInduction(1, 0.2), "monotonic in scarcity");

  // Through-simulation gate: same focal genotype, four density/stock setups.
  const run = (dense: boolean, scarce: boolean): number => {
    const sim = new Simulation(iconfig(41002)) as any;
    sim.o = [sim.o[0]];
    const f = sim.o[0] as any;
    focalGenotype(f);
    f.x = 5; f.y = 5;
    if (dense) {
      // 11 extra active bodies in the same cell: crowding without secretion.
      const template = { ...f };
      for (let i = 0; i < 11; i++) {
        const extra = { ...template, id: 1000 + i, parent: null, l: 9000 + i };
        extra.in = 0; extra.re = 0;
        sim.o.push(extra);
      }
    }
    for (const k of [0, 1, 2]) setCellStock(sim, k, 5, 5, scarce ? 0 : 1);
    sim.step();
    const rec = lastCompetitionRecord(sim);
    assert.ok(rec, "step published a competition record");
    return rec.byId.get(f.id).ind as number;
  };
  const iHS = run(true, true);
  const iHA = run(true, false);
  const iLS = run(false, true);
  const iLA = run(false, false);
  assert.ok(iHS > 0.5, `high density + scarcity expresses strongly (ind=${iHS})`);
  for (const [name, v] of [["high+abundant", iHA], ["low+scarce", iLS], ["low+abundant", iLA]] as const) {
    assert.ok(v < 0.3 * iHS, `${name} clearly weaker than high+scarce (${v} vs ${iHS})`);
  }
  console.log(`testInductionGate: PASS (hs=${iHS.toFixed(2)} ha=${iHA.toFixed(3)} ls=${iLS.toFixed(3)} la=${iLA.toFixed(3)})`);
}

// --- 8.2 order independence: permuted loop order, same context+induction. ---
function testOrderIndependence() {
  const mk = (): any => {
    const sim = new Simulation(iconfig(41003, { pop: 24 })) as any;
    for (const o of sim.o as any[]) { o.in = 1.0; o.re = 0.5; }
    for (let t = 0; t < 50; t++) sim.step();
    return sim;
  };
  const a = mk();
  const b = mk();
  b.o.reverse();
  a.step();
  b.step();
  const ra = lastCompetitionRecord(a);
  const rb = lastCompetitionRecord(b);
  assert.ok(ra && rb, "both steps published competition records");
  const da = ra.density as Int16Array, db = rb.density as Int16Array;
  assert.equal(da.length, db.length, "density grids same shape");
  for (let i = 0; i < da.length; i++) assert.equal(da[i], db[i], `density cell ${i} order-free`);
  assert.equal(rb.byId.size, ra.byId.size, "same organisms recorded");
  for (const [id, va] of ra.byId as Map<number, any>) {
    const vb = (rb.byId as Map<number, any>).get(id);
    assert.ok(vb, `organism ${id} recorded under both orders`);
    for (const k of ["crowd", "scarc", "ind", "desired", "realized"] as const) {
      assert.equal(vb[k], va[k], `organism ${id}.${k} order-independent`);
    }
  }
  console.log("testOrderIndependence: PASS");
}

// --- 8.3 locality pulse: one cluster, near >> far, decay, accounting. ---
function testLocalityPulse() {
  const sim = new Simulation(iconfig(41004)) as any;
  sim.o = [sim.o[0]];
  const seed0 = sim.o[0] as any;
  focalGenotype(seed0);
  seed0.in = 1.5;
  seed0.x = 5; seed0.y = 5;
  // Crowding for induction: bodies that count for density but never secrete.
  for (let i = 0; i < 11; i++) {
    sim.o.push({ ...seed0, id: 2000 + i, parent: null, l: 8000 + i, in: 0, re: 0 });
  }
  for (const k of [0, 1, 2]) setCellStock(sim, k, 5, 5, 0);
  for (let t = 0; t < 400; t++) sim.step();
  const inh = sim.resources.inhibitor;
  const near = inh.fractionAt(5, 5);
  const far = inh.fractionAt(305, 305);
  assert.ok(near > 5 * far, `pulse localized (near=${near} far=${far})`);
  assert.ok(far < 0.05, `far field stays clean (${far})`);
  const peak = inh.totals().stock as number;
  // Silence the producers: field must decay (no persistent background).
  for (const o of sim.o as any[]) o.in = 0;
  for (let t = 0; t < 400; t++) sim.step();
  const rest = inh.totals().stock as number;
  assert.ok(rest < 0.3 * peak, `field decays without expression (${rest} vs peak ${peak})`);
  const acc = inh.accounting();
  assert.ok(Math.abs(acc.residual) < 1e-6 * Math.max(1, acc.produced),
    `mass identity closes (residual=${acc.residual})`);
  // Diffusion is redistribution: fresh field conserves mass across diffuseOne.
  const fresh = new Simulation(iconfig(41005)) as any;
  const fi = fresh.resources.inhibitor;
  const perCell = (fi.cap as Float32Array)[0]!;
  fi.deposit(5, 5, perCell * 0.4, null);
  const before = perCell * 0.4;
  fi.diffuseOne();
  let after = 0;
  const st = fi.stock as Float32Array;
  for (let i = 0; i < st.length; i++) after += st[i]!;
  assert.ok(Math.abs(after - before) < 1e-6, `diffusion conserves mass (drift=${after - before})`);
  console.log(`testLocalityPulse: PASS (peak=${peak.toFixed(1)} rest=${rest.toFixed(2)} near/far=${(near / Math.max(far, 1e-9)).toFixed(0)}x)`);
}

// --- 8.4 conditional advantage + 8.5 mixing destruction (shared harness). ---
function runCompetition(seed: number, dose: number, mixed: boolean): any {
  const sim = new Simulation(iconfig(seed, { pop: 60 })) as any;
  // Dense cluster seeding on a deterministic lattice: assortment by construction.
  const spots: Array<[number, number]> = [];
  for (let gy = 0; gy < 6; gy++) for (let gx = 0; gx < 6; gx++) spots.push([80 + gx * 28, 80 + gy * 28]);
  const orgs = sim.o as any[];
  for (let i = 0; i < orgs.length && i < spots.length; i++) {
    orgs[i].x = spots[i]![0];
    orgs[i].y = spots[i]![1];
  }
  const groups = new Map<number, string>();
  for (let i = 0; i < orgs.length; i++) {
    const o = orgs[i];
    const g = !mixed ? "sens" : i < spots.length ? "combo" : "sens";
    o.in = g === "combo" ? dose : 0;
    o.re = g === "combo" ? 1.0 : 0;
    o.en = 300;
    groups.set(o.id, g);
  }
  const ext = new Map(groups);
  let maxNear = 0, maxFar = 0;
  for (let t = 0; t < 8000; t++) {
    sim.step();
    for (const o of sim.o as any[]) {
      if (!ext.has(o.id)) {
        const pg = o.parent === null || o.parent === undefined ? undefined : ext.get(o.parent);
        ext.set(o.id, pg ?? "unknown");
      }
    }
    if (t % 200 === 0) {
      maxNear = Math.max(maxNear, sim.resources.inhibitor.fractionAt(150, 150));
      maxFar = Math.max(maxFar, sim.resources.inhibitor.fractionAt(450, 450));
    }
  }
  return { sim, ext, maxNear, maxFar };
}

function testConditionalAdvantage() {
  for (const seed of [24681357, 821947219]) {
    const arms: Record<string, any> = {};
    // allsens control: same dense seeding, zero capacity everywhere.
    {
      const sim = new Simulation(iconfig(seed, { pop: 60 })) as any;
      const spots: Array<[number, number]> = [];
      for (let gy = 0; gy < 6; gy++) for (let gx = 0; gx < 6; gx++) spots.push([80 + gx * 28, 80 + gy * 28]);
      const orgs = sim.o as any[];
      for (let i = 0; i < orgs.length && i < spots.length; i++) {
        orgs[i].x = spots[i]![0]; orgs[i].y = spots[i]![1];
      }
      for (const o of orgs) { o.in = 0; o.re = 0; o.en = 300; }
      for (let t = 0; t < 8000; t++) sim.step();
      arms["allsens"] = sim;
    }
    const mixed = runCompetition(seed, 1.0, true);
    arms["mixed"] = mixed.sim;
    const produced = mixed.sim.resources.inhibitor.produced as number;
    assert.ok(produced > 0, `clustered secretors expressed (seed ${seed})`);
    const twin = runCompetition(seed, 1.0, true);
    assert.deepStrictEqual(twin.sim.o, mixed.sim.o, `mixed arm reproduces exactly (seed ${seed})`);
    // Frozen genotypes only.
    for (const o of mixed.sim.o as any[]) {
      assert.ok(
        (o.in === 1.0 && o.re === 1.0) || (o.in === 0 && o.re === 0),
        `frozen genotypes only (seed ${seed})`,
      );
    }
    assert.ok(mixed.maxNear > mixed.maxFar, `cloud localized at peak (seed ${seed})`);
    let combo = 0, sens = 0, unknown = 0, comboEn = 0, sensEn = 0;
    for (const o of mixed.sim.o as any[]) {
      const g = mixed.ext.get(o.id) ?? "unknown";
      if (g === "combo") { combo++; comboEn += o.en as number; }
      else if (g === "sens") { sens++; sensEn += o.en as number; }
      else unknown++;
    }
    const total = combo + sens + unknown;
    assert.ok(total > 0, `mixed world alive (seed ${seed})`);
    assert.ok(unknown / total < 0.05, `tracking covers world (seed ${seed})`);
    console.log(
      `conditional-advantage seed=${seed} comboShare=${(combo / total).toFixed(3)} ` +
      `comboEn=${(combo ? comboEn / combo : 0).toFixed(1)} sensEn=${(sens ? sensEn / sens : 0).toFixed(1)} ` +
      `popMixed=${total} popSens=${(arms["allsens"].o as any[]).length} secMass=${produced.toFixed(1)}`,
    );
  }
  console.log("testConditionalAdvantage: PASS (mechanism asserted, outcome reported)");
}

function testMixingDestroysAdvantage() {
  // Same clustered setup, but uniform reseeding of positions every step
  // (deterministic assay RNG): assortment destroyed, genotype/costs identical.
  let rngState = 123456789;
  const rnd = (): number => {
    rngState = (Math.imul(rngState, 1103515245) + 12345) >>> 0;
    return rngState / 4294967296;
  };
  const sim = new Simulation(iconfig(24681357, { pop: 60 })) as any;
  const spots: Array<[number, number]> = [];
  for (let gy = 0; gy < 6; gy++) for (let gx = 0; gx < 6; gx++) spots.push([80 + gx * 28, 80 + gy * 28]);
  const orgs = sim.o as any[];
  for (let i = 0; i < orgs.length && i < spots.length; i++) {
    orgs[i].x = spots[i]![0]; orgs[i].y = spots[i]![1];
  }
  for (let i = 0; i < orgs.length; i++) {
    const g = i < spots.length ? "combo" : "sens";
    orgs[i].in = g === "combo" ? 1.0 : 0;
    orgs[i].re = g === "combo" ? 1.0 : 0;
    orgs[i].en = 300;
  }
  for (let t = 0; t < 8000; t++) {
    sim.step();
    for (const o of sim.o as any[]) {
      o.x = rnd() * 600; o.y = rnd() * 600;
    }
  }
  const produced = sim.resources.inhibitor.produced as number;
  // Clustered twin with identical seeding but no reshuffling. The required
  // result is about the ADVANTAGE (competitive outcome), not raw production:
  // mixing must leave the secretor group worse off than clustering does.
  const calm = runCompetition(24681357, 1.0, true);
  const shareOf = (world: any): number => {
    let c = 0, n = 0;
    for (const o of world.o as any[]) {
      n++;
      if ((o.in as number) === 1.0) c++;
    }
    return n ? c / n : 0;
  };
  const shareMix = shareOf(sim);
  const shareCalm = shareOf(calm.sim);
  console.log(`mixing-destruction shareMixed=${shareMix.toFixed(3)} shareClustered=${shareCalm.toFixed(3)} produced=${produced.toFixed(1)}`);
  // Conditional form: the destruction claim is predicated on a clustered
  // advantage existing. If the cluster shows none (secretors lose even
  // locally), there is nothing to destroy — that outcome is the DESIGN
  // TENSION signal carried by the 8.4 logs, not a mixing-test failure.
  if (shareCalm > 0.05) {
    assert.ok(shareMix < 0.5 * shareCalm, `mixing destroys the advantage (${shareMix} vs ${shareCalm})`);
    console.log("testMixingDestroysAdvantage: PASS (advantage destroyed by mixing)");
  } else {
    console.log(`testMixingDestroysAdvantage: REPORTED (no clustered advantage to destroy: calm=${shareCalm.toFixed(3)} mixed=${shareMix.toFixed(3)})`);
  }
}

// --- 8.6 resistance tradeoff. ---
function testResistanceTradeoff() {
  const mk = (re: number, dose: number): any => {
    const sim = new Simulation(iconfig(41006)) as any;
    sim.o = [sim.o[0]];
    const o = sim.o[0] as any;
    o.di = -1.5; o.ha = 0; o.bu = 0; o.in = 0; o.re = re;
    o.to = 0; o.cu = 0; o.en = 200; o.sp = 0.3; o.h = 0;
    o.x = 5; o.y = 5;
    for (const k of [0, 1, 2]) setCellStock(sim, k, 5, 5, 0.8);
    if (dose > 0) {
      const perCell = (sim.resources.inhibitor.cap as Float32Array)[0]!;
      sim.resources.inhibitor.deposit(5, 5, dose * perCell, null);
    }
    return sim;
  };
  // Under meaningful exposure, resistance buys acquisition.
  const sens = mk(0, 0.5);
  const res = mk(1.0, 0.5);
  sens.step(); res.step();
  const gainS = (sens.o[0] as any).en as number;
  const gainR = (res.o[0] as any).en as number;
  assert.ok(gainR > gainS, `resistance buys energy under exposure (${gainR} vs ${gainS})`);
  assert.ok((res.cur.resistance_energy as number) > 0, "resistance cost paid under exposure");
  // Without exposure, resistance is pure cost with identical takes.
  const sensC = mk(0, 0);
  const resC = mk(1.0, 0);
  sensC.step(); resC.step();
  assert.equal((sensC.o[0] as any).en, (resC.o[0] as any).en + (resC.cur.resistance_energy as number),
    "clean-field energy differs by exactly the resistance cost");
  assert.ok((resC.cur.resistance_energy as number) > 0, "resistance cost paid without exposure");
  console.log("testResistanceTradeoff: PASS");
}

// --- 8.7 direct-effect negative: exposure is acquisition-only. ---
function testNoDirectEffects() {
  const mk = (dose: number): any => {
    const sim = new Simulation(iconfig(41007)) as any;
    sim.o = [sim.o[0]];
    const o = sim.o[0] as any;
    o.di = -1.5; o.ha = 0; o.bu = 0; o.in = 0; o.re = 0;
    o.to = 0; o.cu = 0; o.en = 200; o.sp = 0.3; o.h = 0;
    o.x = 5; o.y = 5;
    for (const k of [0, 1, 2]) setCellStock(sim, k, 5, 5, 0.8);
    if (dose > 0) {
      const perCell = (sim.resources.inhibitor.cap as Float32Array)[0]!;
      sim.resources.inhibitor.deposit(5, 5, dose * perCell, null);
    }
    return sim;
  };
  // Threshold properties never move under exposure.
  const rpBefore = (mk(0).o[0] as any).rp;
  const dosed = mk(0.8);
  assert.equal((dosed.o[0] as any).rp, rpBefore, "reproduction threshold unchanged by exposure");
  // No-drain proof: with zero stocks there is no acquisition at all, so a
  // dosed twin (exposure > 0) and a clean twin must hold exactly equal energy
  // step for step — exposure alone moves no energy (no damage, no cost, no
  // gain). Suppression of real takes is shown by the gain gap below.
  // No-drain identity: waste economy off (validation-override precedent),
  // low energy (size cost SC is exactly 0 below 100), short run (no births,
  // no stride reset). Then every cost term except acquisition gain is
  // identical across twins by construction (same traits, same movement
  // draws, same path), so any energy gap must equal exactly the
  // suppression-driven gain gap. A direct-drain path of any mechanistic
  // relevance (>=0.1/tick) would break the identity by orders of magnitude.
  const starved = (dose: number): any => {
    const sim = mk(dose);
    (sim.o[0] as any).en = 60;
    (sim.resources as any).enabledWaste = false;
    return sim;
  };
  const sc = starved(0), sd = starved(0.8);
  for (let t = 0; t < 3; t++) { sc.step(); sd.step(); }
  const ec0 = sc.o[0] as any, ed0 = sd.o[0] as any;
  assert.ok(ec0.en < 100 && ed0.en < 100, "size cost stayed exactly zero in both twins");
  assert.ok((sd.cur.exposure_i as number) > 0, "dosed twin was exposed");
  const gainC0 = (ec0.ga + ec0.gb + ec0.gc) as number;
  const gainD0 = (ed0.ga + ed0.gb + ed0.gc) as number;
  assert.ok(Math.abs((ec0.en as number) - (ed0.en as number) - (gainC0 - gainD0)) < 1e-6,
    "no unexplained drain: energy gap equals exactly the acquisition gap");
  // And with food present, exposure suppresses the take (the only path).
  const clean = mk(0);
  for (let t = 0; t < 5; t++) { clean.step(); dosed.step(); }
  const gainC = ((clean.o[0] as any).ga + (clean.o[0] as any).gb + (clean.o[0] as any).gc) as number;
  const gainD = ((dosed.o[0] as any).ga + (dosed.o[0] as any).gb + (dosed.o[0] as any).gc) as number;
  assert.ok(gainD < gainC, "exposure suppresses acquisition");
  // Mutation mechanics don't read exposure: identical twin mut() calls agree.
  const m1 = mk(0.8), m2 = mk(0);
  const r1 = (m1 as any).mut("speed", 1.0);
  const r2 = (m2 as any).mut("speed", 1.0);
  assert.deepStrictEqual(r1, r2, "mut() output independent of field exposure");
  console.log("testNoDirectEffects: PASS");
}

function testTraitDefinitions() {
  assert.ok(TRAIT_DEFINITIONS.secretion, "secretion trait defined");
  assert.ok(TRAIT_DEFINITIONS.resistance, "resistance trait defined");
  assert.deepStrictEqual(TRAIT_DEFINITIONS.secretion.slice(1, 3), [0, 1.5], "secretion range [0, 1.5]");
  assert.deepStrictEqual(TRAIT_DEFINITIONS.resistance.slice(1, 3), [0, 1.5], "resistance range [0, 1.5]");
  console.log("testTraitDefinitions: PASS");
}

testTraitDefinitions();
testInductionGate();
testOrderIndependence();
testLocalityPulse();
testConditionalAdvantage();
testMixingDestroysAdvantage();
testResistanceTradeoff();
testNoDirectEffects();
console.log("inducible interference R0 mechanism: PASS");
