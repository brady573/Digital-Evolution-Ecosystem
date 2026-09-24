import type {
  EngineConfig,
  RenderSnapshot,
  RuntimeCommand,
  RuntimeResponse,
  UniverseCheckpoint,
} from "@digital-evolution/contracts";
import {
  ENGINE_VERSION,
  EVENT_STRIDE,
  Simulation,
  createSimulationCheckpoint,
  restoreSimulationCheckpoint,
} from "@digital-evolution/sim-core";
import { EcologyObserver } from "@digital-evolution/sim-analysis";

function analysisFrame(sim:any){
  return sim.observerSnapshot(sim.metrics(),sim.last);
}

function observeIfDue(sim:any,observer:EcologyObserver){
  if(sim.t>0&&sim.t%EVENT_STRIDE===0)observer.observe(analysisFrame(sim));
}

function renderSnapshot(sim:any,analysis:EcologyObserver,control:any|null):RenderSnapshot{
  const metrics=sim.metrics();
  return{
    tick:sim.t,
    config:sim.c,
    seed:sim.c.seed,
    population:metrics.population,
    activePopulation:metrics.active_population,
    dormantPopulation:metrics.dormant_population,
    organisms:sim.o.map((o:any)=>({
      id:o.id,parent:o.parent??null,generation:o.generation||0,lineageId:o.l,
      x:o.x,y:o.y,energy:o.en,activity:o.activity||"active",
      cladeId:sim.cladeRoot(o.l),
      speed:o.sp,sensing:o.se,metabolism:o.me,reproduction:o.rp,diet:o.di,habitat:o.ha,
      byproductUse:o.bu||0,dormancyResponse:o.dr||0,
    })),
    resources:{
      gridSize:sim.resources.n,
      stock:sim.resources.stock.map((a:ArrayLike<number>)=>Array.from(a)),
      capacity:sim.resources.cap.map((a:ArrayLike<number>)=>Array.from(a)),
    },
    metrics,
    analysis:analysis.export(),
    events:sim.ev.map((e:any)=>({tick:e.tick,label:e.label})),
    control:control?{tick:control.t,population:control.o.length,metrics:control.metrics()}:null,
  };
}

export class UniverseSession {
  #experiment:any|null=null;
  #analysis=new EcologyObserver();
  #control:any|null=null;
  #controlAnalysis:EcologyObserver|null=null;

  get simulation(){return this.#experiment}
  get analysis(){return this.#analysis}
  get control(){return this.#control}

  create(config:EngineConfig){
    this.#experiment=new Simulation(config);
    this.#analysis=new EcologyObserver();
    this.#control=null;
    this.#controlAnalysis=null;
    return this.snapshot();
  }

  #stepOnce(){
    this.#experiment.step();
    observeIfDue(this.#experiment,this.#analysis);
    if(this.#control){
      this.#control.step();
      if(this.#controlAnalysis)observeIfDue(this.#control,this.#controlAnalysis);
    }
  }

  advance(ticks:number){
    if(!this.#experiment)throw new Error("Universe has not been created");
    const count=Math.max(0,Math.floor(ticks));
    for(let i=0;i<count;i++)this.#stepOnce();
    return this.snapshot();
  }

  runToNextEvent(maxTicks=100_000){
    if(!this.#experiment)throw new Error("Universe has not been created");
    const startRecords=this.#analysis.records.length;
    const startEvents=this.#experiment.ev.length;
    // Render only once at the end: per-tick snapshots made long scans hang.
    for(let i=0;i<Math.max(1,Math.floor(maxTicks));i++){
      this.#stepOnce();
      if(this.#analysis.records.length>startRecords||this.#experiment.ev.length>startEvents||this.#experiment.extinctTick!==null)break;
    }
    return this.snapshot();
  }

  createControlFork(){
    if(!this.#experiment)throw new Error("Universe has not been created");
    if(!this.#control){
      this.#control=this.#experiment.clone();
      this.#controlAnalysis=this.#analysis.clone();
    }
    return this.snapshot();
  }

  intervene(intervention:"global"|"droughtA"|"droughtB"){
    if(!this.#experiment)throw new Error("Universe has not been created");
    if(!this.#control)this.createControlFork();
    this.#experiment.catalyst(intervention,"manual intervention");
    return this.snapshot();
  }

  checkpoint():UniverseCheckpoint{
    if(!this.#experiment)throw new Error("Universe has not been created");
    return{
      checkpointSchemaVersion:"0.1",
      engineVersion:ENGINE_VERSION,
      createdTick:this.#experiment.t,
      experiment:createSimulationCheckpoint(this.#experiment),
      analysis:this.#analysis.checkpoint(),
      control:this.#control?createSimulationCheckpoint(this.#control):null,
      controlAnalysis:this.#controlAnalysis?this.#controlAnalysis.checkpoint():null,
    };
  }

  restore(checkpoint:UniverseCheckpoint){
    if(checkpoint.checkpointSchemaVersion!=="0.1")throw new Error("Unsupported runtime checkpoint schema");
    if(checkpoint.engineVersion!==ENGINE_VERSION)throw new Error(`Checkpoint engine ${checkpoint.engineVersion} does not match ${ENGINE_VERSION}`);
    this.#experiment=restoreSimulationCheckpoint(checkpoint.experiment as any);
    this.#analysis=EcologyObserver.restore(checkpoint.analysis);
    this.#control=checkpoint.control?restoreSimulationCheckpoint(checkpoint.control as any):null;
    this.#controlAnalysis=checkpoint.controlAnalysis?EcologyObserver.restore(checkpoint.controlAnalysis):null;
    return this.snapshot();
  }

  exportEvidence(){
    if(!this.#experiment)throw new Error("Universe has not been created");
    return{
      ...this.#experiment.out(),
      repository_analysis:this.#analysis.export(),
      matched_control:this.#control?{
        forked:true,
        current_metrics:this.#control.metrics(),
        ecology_observer:this.#controlAnalysis?.export()??null,
      }:null,
    };
  }

  snapshot():RenderSnapshot{
    if(!this.#experiment)throw new Error("Universe has not been created");
    return renderSnapshot(this.#experiment,this.#analysis,this.#control);
  }

  handle(command:RuntimeCommand):RuntimeResponse[]{
    try{
      switch(command.type){
        case "CREATE_UNIVERSE":return[{type:"SNAPSHOT",snapshot:this.create(command.config)}];
        case "ADVANCE_TICKS":return[{type:"SNAPSHOT",snapshot:this.advance(command.ticks)}];
        case "RUN_TO_NEXT_EVENT":return[{type:"SNAPSHOT",snapshot:this.runToNextEvent(command.maxTicks)}];
        case "CREATE_CONTROL_FORK":return[{type:"SNAPSHOT",snapshot:this.createControlFork()}];
        case "APPLY_INTERVENTION":return[{type:"SNAPSHOT",snapshot:this.intervene(command.intervention)}];
        case "LOAD_CHECKPOINT":return[{type:"SNAPSHOT",snapshot:this.restore(command.checkpoint)}];
        case "REQUEST_CHECKPOINT":return[{type:"CHECKPOINT",requestId:command.requestId,checkpoint:this.checkpoint()}];
        case "REQUEST_EXPORT":return[{type:"EXPORT",requestId:command.requestId,data:this.exportEvidence()}];
      }
    }catch(error){
      return[{type:"ERROR",message:error instanceof Error?error.message:String(error)}];
    }
  }
}
