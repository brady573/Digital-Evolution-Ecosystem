import assert from "node:assert/strict";
import { UniverseSession } from "../../packages/sim-runtime/src/session.ts";
import type { EngineConfig } from "../../packages/contracts/src/index.ts";

type Regime="balanced"|"patchwork"|"harsh";
const seeds=[821947219,3543950664];

/**
 * Issue #30 A3: this gate previously stalled every run at its first pause
 * gate (~6k ticks) because advance() stops while a decision is pending, so
 * the "40k-tick survey" only ever saw early dynamics and the drought assay
 * compared two identical un-advanced snapshots. settle() resolves everything
 * keep-watching (a pure no-op choice) so the survey actually runs to target
 * and the assay actually disturbs. Resolving keep-watching changes no
 * biology; determinism is unaffected.
 */
function settle(session:UniverseSession,target:number){
  for(let i=0;i<1000&&session.snapshot().tick<target;i++){
    const snapshot=session.advance(1000);
    const pending=snapshot.pendingDecision;
    if(pending)session.resolveEventDecision(pending.opportunityId,"keep-watching");
  }
  assert.equal(session.snapshot().tick>=target,true,`survey must reach tick ${target}`);
}

function config(seed:number,regime:Regime):EngineConfig{
  const defs={
    balanced:{rich:.60,press:.45,patch:.60,b:.50},
    patchwork:{rich:.68,press:.52,patch:.92,b:.50},
    harsh:{rich:.38,press:.78,patch:.55,b:.40},
  }[regime];
  return{
    seed,start:.25+defs.rich*.55,prod:.08+defs.rich*1.15,cap:360,pop:30,div:.35,mr:.035,ms:.12,
    press:.75+defs.press*.75,patch:defs.patch,resource_b_fraction:defs.b,cat:"global",st:null,
    resource_model:"definition_driven_substances",resource_grid:60,enable_byproduct:true,enable_dormancy:true,study:true,
  };
}

const rows:any[]=[];
for(const regime of ["balanced","patchwork","harsh"] as Regime[]){
  for(const seed of seeds){
    const session=new UniverseSession();
    session.create(config(seed,regime));
    let maxDormant=0,maxCross=0,maxCEnergy=0,maxPopulation=0,minPopulation=Infinity;
    for(let block=0;block<40;block++){
      settle(session,(block+1)*1000);
      const snapshot=session.snapshot();
      const m=snapshot.metrics;
      maxDormant=Math.max(maxDormant,m.dormant_fraction||0);
      maxCross=Math.max(maxCross,m.metabolic_roles?.crossfeeder_fraction||0);
      maxCEnergy=Math.max(maxCEnergy,m.resource_energy?.c_share||0);
      maxPopulation=Math.max(maxPopulation,m.population);
      minPopulation=Math.min(minPopulation,m.population);
      const residual=m.nutrient_field.accounting.absolute_residual as number[];
      assert.ok(residual.every(v=>Number.isFinite(v)&&v<.1),`${regime}/${seed}: resource accounting residual`);
      assert.ok(Number.isFinite(m.population)&&m.population>=0,`${regime}/${seed}: valid population`);
      // Structural invariant: activity states partition the living population.
      assert.equal(
        m.active_population+m.dormant_population,m.population,
        `${regime}/${seed}: active + dormant must equal population`,
      );
      // Energy-bound invariants: realized energy can never exceed consumed
      // mass times the substance yield times the maximum possible access
      // (C access < 1, primary-nutrient access <= 1.25). Any violation means
      // an unbounded energy pathway was introduced.
      const use=m.resource_use,energy=m.resource_energy;
      assert.ok(energy.c<=use.c*9*(1+1e-9)+1e-9,`${regime}/${seed}: C energy bounded by C consumed`);
      assert.ok(energy.a<=use.a*15*1.25*(1+1e-9)+1e-9,`${regime}/${seed}: A energy bounded by A consumed`);
      assert.ok(energy.b<=use.b*15*1.25*(1+1e-9)+1e-9,`${regime}/${seed}: B energy bounded by B consumed`);
    }
    const final=session.snapshot();
    rows.push({
      regime,seed,tick:final.tick,finalPopulation:final.population,minPopulation,maxPopulation,
      extinct:final.metrics.extinct_tick!==null,peakPopulation:final.metrics.peak_population,
      outcome:final.metrics.ecological_outcome,maxDormantFraction:maxDormant,
      maxCrossfeederFraction:maxCross,maxCEnergyShare:maxCEnergy,
      metaboliteCProduced:final.metrics.metabolite_c.produced,
      metaboliteCConsumed:final.metrics.metabolite_c.consumed,
      analysisRecords:(final.analysis.records as any[]).length,
    });
  }
}

assert.ok(rows.every(r=>r.tick>=40000),"every survey run must actually reach 40k ticks");
assert.ok(rows.some(r=>r.metaboliteCProduced>0),"Metabolite C must be produced in the survey");
assert.ok(rows.some(r=>r.metaboliteCConsumed>0),"produced Metabolite C must actually be eaten somewhere");
// Possibility, not frequency: dormancy and cross-feeding must each be
// realizable in at least one surveyed world. No run is required to show them.
assert.ok(rows.some(r=>r.maxDormantFraction>0),"dormancy must be realizable in the survey");
assert.ok(
  rows.some(r=>r.maxCrossfeederFraction>=.04||r.maxCEnergyShare>=.035),
  "cross-feeding must be realizable in the survey",
);
assert.ok(rows.some(r=>r.analysisRecords>0),"ecological interpretation must fire in the survey");
assert.ok(new Set(rows.map(r=>r.finalPopulation)).size>1,"Survey must not collapse to one fixed population outcome");

const assay=new UniverseSession();
assay.create(config(912367481,"harsh"));
settle(assay,12_000);
assay.createControlFork();
const fork=assay.snapshot();
assert.ok(fork.control&&fork.control.population===fork.population,"Matched control must be exact at fork");
assay.intervene("droughtA");
settle(assay,fork.tick+15_000);
const disturbed=assay.snapshot();
assert.ok(disturbed.control,"Matched control must persist after intervention");
assert.ok(disturbed.tick>=fork.tick+15_000,"assay must actually advance through the drought");
// The drought is a recorded environmental removal on the live branch only,
// and live A-stock must sit below the untouched control's.
const liveMetrics=disturbed.metrics;
const controlMetrics=disturbed.control!.metrics;
const liveRemovals=liveMetrics.nutrient_field.accounting.removal_events as any[];
const controlRemovals=controlMetrics.nutrient_field.accounting.removal_events as any[];
assert.ok(
  liveRemovals.some((e:any)=>typeof e.type==="string"&&e.type.toLowerCase().includes("drought")),
  "live branch must record the drought onset as a removal event",
);
assert.equal(controlRemovals.length,0,"matched control must record no removals");
assert.ok(
  liveMetrics.nutrient_field.a<controlMetrics.nutrient_field.a,
  "live A-stock must sit below the untouched control during drought suppression",
);

const summary={
  runs:rows,
  observations:{
    regimes:new Set(rows.map(r=>r.regime)).size,
    distinctFinalPopulations:new Set(rows.map(r=>r.finalPopulation)).size,
    dormancyObserved:rows.some(r=>r.maxDormantFraction>0),
    crossfeedingObserved:rows.some(r=>r.maxCrossfeederFraction>=.04||r.maxCEnergyShare>=.035),
    extinctionObserved:rows.some(r=>r.extinct),
    ecologyRecordsObserved:rows.some(r=>r.analysisRecords>0),
  },
  matchedDroughtAssay:{
    forkTick:fork.tick,
    forkPopulation:fork.population,
    livePopulation:disturbed.population,
    controlPopulation:disturbed.control?.population??null,
    liveOutcome:disturbed.metrics.ecological_outcome,
    controlOutcome:disturbed.control?.metrics.ecological_outcome??null,
    liveRemovals:liveRemovals.length,
    controlRemovals:controlRemovals.length,
  },
};

console.log("ecology validation: PASS");
console.log(JSON.stringify(summary,null,2));
