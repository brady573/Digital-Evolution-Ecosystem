import type {
  DecisionCheckpoint,
  DecisionContext,
  DecisionOpportunity,
  DecisionResolution,
  EngineConfig,
  InterventionSpec,
  RenderSnapshot,
  RuntimeCommand,
  RuntimeResponse,
  SupportedUniverseCheckpoint,
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
import {
  DECISION_POLICY_VERSION,
  buildDecisionOpportunity,
  decisionCommandIdFor,
  engineCatalystModeFor,
  findChoice,
  isDecisionEligible,
  isSupportedIntervention,
} from "@digital-evolution/sim-decisions";

export const CHECKPOINT_SCHEMA_VERSION = "0.2" as const;

function analysisFrame(sim:any){
  return sim.observerSnapshot(sim.metrics(),sim.last);
}

function observeIfDue(sim:any,observer:EcologyObserver){
  if(sim.t>0&&sim.t%EVENT_STRIDE===0)observer.observe(analysisFrame(sim));
}

function renderSnapshot(sim:any,analysis:EcologyObserver,control:any|null,pendingDecision:DecisionOpportunity|null,resolvedDecisions:readonly DecisionResolution[]):RenderSnapshot{
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
    pendingDecision,
    resolvedDecisions,
    control:control?{tick:control.t,population:control.o.length,metrics:control.metrics()}:null,
  };
}

export class UniverseSession {
  #experiment:any|null=null;
  #analysis=new EcologyObserver();
  #control:any|null=null;
  #controlAnalysis:EcologyObserver|null=null;
  // M3 decision lifecycle state (runtime-owned, resumable).
  #pendingDecision:DecisionOpportunity|null=null;
  #decisionResolutions:DecisionResolution[]=[];
  #policyVersion=DECISION_POLICY_VERSION;
  /** Number of analysis records already evaluated for decisions. */
  #observedThrough=0;

  get simulation(){return this.#experiment}
  get analysis(){return this.#analysis}
  get control(){return this.#control}
  get pendingDecision(){return this.#pendingDecision}
  get decisionResolutions(){return this.#decisionResolutions}

  create(config:EngineConfig){
    this.#experiment=new Simulation(config);
    this.#analysis=new EcologyObserver();
    this.#control=null;
    this.#controlAnalysis=null;
    this.#pendingDecision=null;
    this.#decisionResolutions=[];
    this.#policyVersion=DECISION_POLICY_VERSION;
    this.#observedThrough=0;
    return this.snapshot();
  }

  /** Bounded, read-only context the decision policy may consult. */
  #decisionContext():DecisionContext{
    const metrics=this.#experiment.metrics();
    return{
      tick:this.#experiment.t,
      population:metrics.population,
      dormantPopulation:metrics.dormant_population,
      cEnergyShare:Number(metrics.c_energy_share||0),
      crossfeederFraction:Number(metrics.crossfeeder_fraction||0),
    };
  }

  /**
   * Evaluate only newly emitted observed events. Returns true when an
   * opportunity became pending, which is the signal to stop executing ticks.
   * Eligibility is pure policy; it cannot change whether the event occurred.
   */
  #evaluateNewEvents():boolean{
    if(this.#pendingDecision)return false;
    // Cheap guard first: most ticks emit no record, and this runs per step.
    const count=this.#analysis.records.length;
    if(count<=this.#observedThrough)return false;
    const events=this.#analysis.observedEvents();
    for(let i=this.#observedThrough;i<events.length;i++){
      const event=events[i];
      this.#observedThrough=i+1;
      if(!event||!isDecisionEligible(event))continue;
      const opportunity=buildDecisionOpportunity(event,this.#decisionContext(),this.#policyVersion);
      if(!opportunity)continue;
      this.#pendingDecision=opportunity;
      return true;
    }
    return false;
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
    // A pending decision is a hard gate: the UI frame loop cannot push ticks
    // through it, and an in-flight multi-tick request stops at the trigger tick.
    if(this.#pendingDecision)return this.snapshot();
    const count=Math.max(0,Math.floor(ticks));
    for(let i=0;i<count;i++){
      this.#stepOnce();
      if(this.#evaluateNewEvents())break;
    }
    return this.snapshot();
  }

  runToNextEvent(maxTicks=100_000){
    if(!this.#experiment)throw new Error("Universe has not been created");
    if(this.#pendingDecision)return this.snapshot();
    const startRecords=this.#analysis.records.length;
    const startEvents=this.#experiment.ev.length;
    // Render only once at the end: per-tick snapshots made long scans hang.
    for(let i=0;i<Math.max(1,Math.floor(maxTicks));i++){
      this.#stepOnce();
      // A decision-eligible observation stops the scan immediately, even if the
      // same tick also produced a non-decision record or raw engine event.
      if(this.#evaluateNewEvents())return this.snapshot();
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

  /**
   * Generalized intervention path: validate a spec and apply only the requested
   * engine effect. Comparison/branching is deliberately NOT part of this
   * method, so event decisions can never create a control fork implicitly.
   */
  applyIntervention(spec:InterventionSpec,provenance:string){
    if(!this.#experiment)throw new Error("Universe has not been created");
    if(!isSupportedIntervention(spec))throw new Error(`Unsupported intervention spec: ${JSON.stringify(spec)}`);
    this.#experiment.catalyst(engineCatalystModeFor(spec),provenance);
    return this.snapshot();
  }

  /**
   * Experiments compatibility adapter: preserves the current matched-control
   * semantics explicitly, then reuses the same spec-based application path.
   */
  intervene(intervention:"global"|"droughtA"|"droughtB"){
    if(!this.#experiment)throw new Error("Universe has not been created");
    if(!this.#control)this.createControlFork();
    const spec:InterventionSpec=intervention==="global"
      ?{schemaVersion:1,kind:"nutrient_disturbance",mode:"global_crash"}
      :intervention==="droughtA"
        ?{schemaVersion:1,kind:"nutrient_disturbance",mode:"drought_a"}
        :{schemaVersion:1,kind:"nutrient_disturbance",mode:"drought_b"};
    return this.applyIntervention(spec,"manual intervention");
  }

  /**
   * Resolve the pending opportunity. Records the command, applies at most one
   * intervention, clears the gate, and never advances a tick: the world stays
   * paused until the player explicitly resumes.
   */
  resolveEventDecision(opportunityId:string,choiceId:string){
    if(!this.#experiment)throw new Error("Universe has not been created");
    const pending=this.#pendingDecision;
    if(!pending)throw new Error("No decision opportunity is pending");
    if(pending.opportunityId!==opportunityId)throw new Error("Decision opportunity does not match the pending opportunity");
    if(pending.status!=="pending")throw new Error("Decision opportunity was already resolved");
    const choice=findChoice(pending,choiceId);
    if(!choice)throw new Error("Choice does not belong to this decision opportunity");
    if(!isSupportedIntervention(choice.intervention))throw new Error("Stored intervention is not supported by this engine version");
    const resolution:DecisionResolution={
      schemaVersion:1,
      commandId:decisionCommandIdFor(pending.opportunityId,choice.choiceId,pending.policyVersion),
      tick:this.#experiment.t,
      opportunityId:pending.opportunityId,
      sourceEventId:pending.sourceEventId,
      choiceId:choice.choiceId,
      intervention:choice.intervention,
      source:"event_decision",
      policyVersion:pending.policyVersion,
    };
    this.#decisionResolutions.push(resolution);
    if(choice.intervention)this.applyIntervention(choice.intervention,"event decision");
    this.#pendingDecision=null;
    return this.snapshot();
  }

  #decisionCheckpoint():DecisionCheckpoint{
    return{
      pending:this.#pendingDecision?JSON.parse(JSON.stringify(this.#pendingDecision)):null,
      resolutions:JSON.parse(JSON.stringify(this.#decisionResolutions)),
      policyVersion:this.#policyVersion,
    };
  }

  checkpoint():UniverseCheckpoint{
    if(!this.#experiment)throw new Error("Universe has not been created");
    return{
      checkpointSchemaVersion:CHECKPOINT_SCHEMA_VERSION,
      engineVersion:ENGINE_VERSION,
      createdTick:this.#experiment.t,
      experiment:createSimulationCheckpoint(this.#experiment),
      analysis:this.#analysis.checkpoint(),
      control:this.#control?createSimulationCheckpoint(this.#control):null,
      controlAnalysis:this.#controlAnalysis?this.#controlAnalysis.checkpoint():null,
      decisions:this.#decisionCheckpoint(),
    };
  }

  /**
   * Restore schema 0.2 exactly. Schema 0.1 is migrated forward: same simulation,
   * analysis and control state, with no pending opportunity and an empty
   * decision history.
   */
  restore(checkpoint:SupportedUniverseCheckpoint){
    const schema=(checkpoint as any)?.checkpointSchemaVersion;
    if(schema!=="0.1"&&schema!=="0.2")throw new Error(`Unsupported runtime checkpoint schema: ${String(schema)}`);
    if(checkpoint.engineVersion!==ENGINE_VERSION)throw new Error(`Checkpoint engine ${checkpoint.engineVersion} does not match ${ENGINE_VERSION}`);
    this.#experiment=restoreSimulationCheckpoint(checkpoint.experiment as any);
    this.#analysis=EcologyObserver.restore(checkpoint.analysis);
    this.#control=checkpoint.control?restoreSimulationCheckpoint(checkpoint.control as any):null;
    this.#controlAnalysis=checkpoint.controlAnalysis?EcologyObserver.restore(checkpoint.controlAnalysis):null;
    if(schema==="0.2"){
      const decisions=(checkpoint as UniverseCheckpoint).decisions;
      this.#pendingDecision=decisions?.pending?JSON.parse(JSON.stringify(decisions.pending)):null;
      this.#decisionResolutions=decisions?.resolutions?JSON.parse(JSON.stringify(decisions.resolutions)):[];
      this.#policyVersion=decisions?.policyVersion||DECISION_POLICY_VERSION;
    }else{
      this.#pendingDecision=null;
      this.#decisionResolutions=[];
      this.#policyVersion=DECISION_POLICY_VERSION;
    }
    // A restored pending opportunity is replayed as-is: never re-evaluated
    // against the current catalog, which could silently substitute choices.
    this.#observedThrough=this.#analysis.observedEvents().length;
    return this.snapshot();
  }

  exportEvidence(){
    if(!this.#experiment)throw new Error("Universe has not been created");
    return{
      ...this.#experiment.out(),
      repository_analysis:this.#analysis.export(),
      // Observed evidence and player action stay separate representations.
      observed_events:this.#analysis.observedEvents(),
      player_decisions:{
        schema_version:1,
        policy_version:this.#policyVersion,
        checkpoint_schema_version:CHECKPOINT_SCHEMA_VERSION,
        pending:this.#pendingDecision,
        resolutions:this.#decisionResolutions,
      },
      matched_control:this.#control?{
        forked:true,
        current_metrics:this.#control.metrics(),
        ecology_observer:this.#controlAnalysis?.export()??null,
      }:null,
    };
  }

  snapshot():RenderSnapshot{
    if(!this.#experiment)throw new Error("Universe has not been created");
    return renderSnapshot(this.#experiment,this.#analysis,this.#control,this.#pendingDecision,this.#decisionResolutions);
  }

  handle(command:RuntimeCommand):RuntimeResponse[]{
    try{
      switch(command.type){
        case "CREATE_UNIVERSE":return[{type:"SNAPSHOT",snapshot:this.create(command.config)}];
        case "ADVANCE_TICKS":return[{type:"SNAPSHOT",snapshot:this.advance(command.ticks)}];
        case "RUN_TO_NEXT_EVENT":return[{type:"SNAPSHOT",snapshot:this.runToNextEvent(command.maxTicks)}];
        case "CREATE_CONTROL_FORK":return[{type:"SNAPSHOT",snapshot:this.createControlFork()}];
        case "APPLY_INTERVENTION":return[{type:"SNAPSHOT",snapshot:this.intervene(command.intervention)}];
        case "RESOLVE_EVENT_DECISION":{
          const snapshot=this.resolveEventDecision(command.opportunityId,command.choiceId);
          return command.requestId
            ?[{type:"DECISION_RESOLVED",requestId:command.requestId,snapshot},{type:"SNAPSHOT",snapshot}]
            :[{type:"SNAPSHOT",snapshot}];
        }
        case "LOAD_CHECKPOINT":return[{type:"SNAPSHOT",snapshot:this.restore(command.checkpoint)}];
        case "REQUEST_CHECKPOINT":return[{type:"CHECKPOINT",requestId:command.requestId,checkpoint:this.checkpoint()}];
        case "REQUEST_EXPORT":return[{type:"EXPORT",requestId:command.requestId,data:this.exportEvidence()}];
      }
    }catch(error){
      // Attribute errors to the caller when the command carried a requestId.
      const requestId=(command as {readonly requestId?:string}).requestId;
      return[{type:"ERROR",message:error instanceof Error?error.message:String(error),...(requestId?{requestId}:{})}];
    }
  }
}
