import assert from "node:assert/strict";
import { UniverseSession } from "../../packages/sim-runtime/src/session.ts";
import type { EngineConfig } from "../../packages/contracts/src/index.ts";

type Regime="balanced"|"patchwork"|"harsh";
const seeds=[821947219,3543950664];

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
      const snapshot=session.advance(1000);
      const m=snapshot.metrics;
      maxDormant=Math.max(maxDormant,m.dormant_fraction||0);
      maxCross=Math.max(maxCross,m.metabolic_roles?.crossfeeder_fraction||0);
      maxCEnergy=Math.max(maxCEnergy,m.resource_energy?.c_share||0);
      maxPopulation=Math.max(maxPopulation,m.population);
      minPopulation=Math.min(minPopulation,m.population);
      const residual=m.nutrient_field.accounting.absolute_residual as number[];
      assert.ok(residual.every(v=>Number.isFinite(v)&&v<.1),`${regime}/${seed}: resource accounting residual`);
      assert.ok(Number.isFinite(m.population)&&m.population>=0,`${regime}/${seed}: valid population`);
    }
    const final=session.snapshot();
    rows.push({
      regime,seed,tick:final.tick,finalPopulation:final.population,minPopulation,maxPopulation,
      extinct:final.metrics.extinct_tick!==null,peakPopulation:final.metrics.peak_population,
      outcome:final.metrics.ecological_outcome,maxDormantFraction:maxDormant,
      maxCrossfeederFraction:maxCross,maxCEnergyShare:maxCEnergy,
      metaboliteCProduced:final.metrics.metabolite_c.produced,
      analysisRecords:(final.analysis.records as any[]).length,
    });
  }
}

assert.ok(rows.some(r=>r.metaboliteCProduced>0),"Metabolite C must be produced in the survey");
assert.ok(new Set(rows.map(r=>r.finalPopulation)).size>1,"Survey must not collapse to one fixed population outcome");

const assay=new UniverseSession();
assay.create(config(912367481,"harsh"));
assay.advance(12_000);
assay.createControlFork();
const fork=assay.snapshot();
assert.ok(fork.control&&fork.control.population===fork.population,"Matched control must be exact at fork");
assay.intervene("droughtA");
assay.advance(15_000);
const disturbed=assay.snapshot();
assert.ok(disturbed.control,"Matched control must persist after intervention");

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
  },
};

console.log("ecology validation: PASS");
console.log(JSON.stringify(summary,null,2));
