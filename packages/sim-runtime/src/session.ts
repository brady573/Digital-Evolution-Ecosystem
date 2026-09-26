import type {
  CatalystContext,
  CatalystDiagnosis,
  DecisionCheckpoint,
  DecisionContext,
  DecisionResolution,
  EngineConfig,
  InterventionSpec,
  PendingDecision,
  RenderSnapshot,
  RuntimeCommand,
  RuntimeResponse,
  SupportedUniverseCheckpoint,
  UniverseCheckpoint,
  UniverseCheckpointV02,
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
  CATALYST_POLICY_VERSION,
  CATALYST_QUIET_TICKS,
  MAJOR_CATALYST_COOLDOWN_TICKS,
  DECISION_POLICY_VERSION,
  buildDecisionOpportunity,
  decisionCommandIdFor,
  diagnoseCatalysts,
  engineCatalystModeFor,
  findChoice,
  isDecisionEligible,
  isMajorCooldownClear,
  isSupportedIntervention,
  selectCatalystWindow,
} from "@digital-evolution/sim-decisions";

export const CHECKPOINT_SCHEMA_VERSION = "0.3" as const;

/**
 * Process-unique universe counter. Presentation identity only: it is
 * deliberately NOT part of the simulation, the checkpoint, or any
 * reproducibility claim, and two runs of the same config still replay
 * identically without it.
 */
let worldIdCounter=0;

function analysisFrame(sim:any){
  return sim.observerSnapshot(sim.metrics(),sim.last);
}

function observeIfDue(sim:any,observer:EcologyObserver){
  if(sim.t>0&&sim.t%EVENT_STRIDE===0)observer.observe(analysisFrame(sim));
}

function renderSnapshot(sim:any,analysis:EcologyObserver,control:any|null,pendingDecision:PendingDecision|null,resolvedDecisions:readonly DecisionResolution[],worldId:number):RenderSnapshot{
  const metrics=sim.metrics();
  return{
    tick:sim.t,
    worldId,
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
      byproductUse:o.bu||0,dormancyResponse:o.dr||0,tolerance:o.to||0,cleanup:o.cu||0,
    })),
    resources:{
      gridSize:sim.resources.n,
      stock:sim.resources.stock.map((a:ArrayLike<number>)=>Array.from(a)),
      capacity:sim.resources.cap.map((a:ArrayLike<number>)=>Array.from(a)),
    },
    waste:{
      gridSize:sim.resources.waste.n,
      stock:Array.from(sim.resources.waste.stock),
      capacity:Array.from(sim.resources.waste.cap),
    },
    metrics,
    analysis:analysis.export(),
    events:sim.ev.map((e:any)=>({tick:e.tick,label:e.label})),
    pendingDecision,
    resolvedDecisions,
    control:control?{tick:control.t,population:control.o.length,metrics:control.metrics()}:null,
  };
}

/**
 * A persisted pending decision replays exactly as stored: never re-evaluated
 * against a newer catalog, which could silently substitute choices. Pre-source
 * 0.2 saves carry no `source` field; a `sourceEventId` can only mean an
 * observed-event decision, so normalize it explicitly rather than guessing.
 * Anything else unrecognized restores as no pending decision.
 */
function normalizePendingDecision(raw:unknown):PendingDecision|null{
  if(!raw||typeof raw!=="object")return null;
  const copy=JSON.parse(JSON.stringify(raw));
  if(copy.source==="world_catalyst"||copy.source==="observed_event")return copy as PendingDecision;
  if(typeof copy.sourceEventId==="string"){copy.source="observed_event";return copy as PendingDecision}
  return null;
}

function normalizeResolution(raw:any):DecisionResolution{
  const copy=JSON.parse(JSON.stringify(raw));
  // Backfill for 0.2 records, which predate these fields: the resolution tick
  // is the best available offer estimate, and no 0.2 record came from a
  // catalyst window (they did not exist).
  if(copy.offerTick===undefined)copy.offerTick=copy.tick;
  if(copy.catalystId===undefined)copy.catalystId=null;
  if(copy.source===undefined)copy.source="event_decision";
  return copy as DecisionResolution;
}

/** Newest decision tick known to a migrated checkpoint, or 0 when none. */
function newestKnownDecisionTick(pending:PendingDecision|null,resolutions:readonly DecisionResolution[]):number{
  let newest=0;
  if(pending&&typeof pending.createdTick==="number")newest=Math.max(newest,pending.createdTick);
  for(const r of resolutions){
    if(r&&typeof r.tick==="number")newest=Math.max(newest,r.tick);
    if(r&&typeof (r as any).offerTick==="number")newest=Math.max(newest,(r as any).offerTick);
  }
  return newest;
}

export class UniverseSession {
  #experiment:any|null=null;
  #analysis=new EcologyObserver();
  #control:any|null=null;
  #controlAnalysis:EcologyObserver|null=null;
  // M3 decision lifecycle state (runtime-owned, resumable).
  // pendingDecision covers both sources: observed events and catalyst windows.
  #pendingDecision:PendingDecision|null=null;
  #decisionResolutions:DecisionResolution[]=[];
  #policyVersion=DECISION_POLICY_VERSION;
  #catalystPolicyVersion=CATALYST_POLICY_VERSION;
  /** Tick of the most recent opportunity creation, either source. Starts at 0:
   *  at universe start the quiet interval is measured from tick 0. */
  #lastDecisionTick=0;
  /** Tick of the most recent applied non-null catalyst, or null if none. */
  #lastMajorCatalystTick:number|null=null;
  /** Number of analysis records already evaluated for decisions. */
  #observedThrough=0;

  get simulation(){return this.#experiment}
  get analysis(){return this.#analysis}
  get control(){return this.#control}
  get pendingDecision(){return this.#pendingDecision}
  get decisionResolutions(){return this.#decisionResolutions}

  /**
   * Presentation-level world identity: a monotonic, process-unique id handed
   * out once per universe instance. It exists ONLY so the renderer can tell
   * two displayed worlds apart; it is not biological state, is not stored in
   * checkpoints, and never reaches the simulation. Seed and config are not
   * sufficient: two universes (or a fork, or a same-seed restore) can
   * legitimately share both.
   */
  #worldId=0;
  get worldId(){return this.#worldId}

  create(config:EngineConfig){
    this.#worldId=++worldIdCounter;
    this.#experiment=new Simulation(config);
    this.#analysis=new EcologyObserver();
    this.#control=null;
    this.#controlAnalysis=null;
    this.#pendingDecision=null;
    this.#decisionResolutions=[];
    this.#policyVersion=DECISION_POLICY_VERSION;
    this.#catalystPolicyVersion=CATALYST_POLICY_VERSION;
    this.#lastDecisionTick=0;
    this.#lastMajorCatalystTick=null;
    this.#observedThrough=0;
    return this.snapshot();
  }

  /** Bounded, read-only context the decision policy may consult. */
  #decisionContext():DecisionContext{
    // The authoritative frame analysis observes. metrics() has no top-level
    // c_energy_share/crossfeeder_fraction in engine 0.20; reading them there
    // silently yields 0 and would poison any future policy that consults
    // context. analysisFrame is a pure read with no biological side effects.
    const frame=analysisFrame(this.#experiment);
    return{
      tick:this.#experiment.t,
      population:frame.population,
      dormantPopulation:frame.dormant_population,
      cEnergyShare:frame.c_energy_share,
      crossfeederFraction:frame.crossfeeder_fraction,
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
      // Either source restarts the catalyst quiet interval at creation.
      this.#lastDecisionTick=opportunity.createdTick;
      return true;
    }
    return false;
  }

  /**
   * Read-only catalyst world state. Every read is a present-state property or
   * an already-computed metrics object: no RNG, no mutation, no new analysis.
   * sim.drought is the engine's own active-disturbance record (or null).
   */
  #catalystContext():CatalystContext{
    const sim=this.#experiment;
    const metrics=sim.metrics();
    const energy=metrics.resource_energy??{a:0,b:0,c:0};
    const ea=Number(energy.a||0),eb=Number(energy.b||0),ec=Number(energy.c||0);
    const totalEnergy=ea+eb+ec;
    const field=metrics.nutrient_field??{};
    const stockA=Number(field.a||0),capA=Number(field.a_capacity||0);
    const stockB=Number(field.b||0),capB=Number(field.b_capacity||0);
    return{
      tick:sim.t,
      population:Number(metrics.population||0),
      droughtActive:sim.drought!=null,
      energyShareA:totalEnergy>0?ea/totalEnergy:0,
      energyShareB:totalEnergy>0?eb/totalEnergy:0,
      stockFractionA:capA>0?stockA/capA:0,
      stockFractionB:capB>0?stockB/capB:0,
      abioticStockFraction:(capA+capB)>0?(stockA+stockB)/(capA+capB):0,
    };
  }

  /**
   * Evaluate a catalyst window. Called only at stride boundaries (the same
   * deterministic cadence as the event gate), never every tick: metrics() is
   * too costly to rebuild per step at phone populations.
   */
  #evaluateCatalystWindow():boolean{
    if(this.#pendingDecision)return false;
    const context=this.#catalystContext();
    const opportunity=selectCatalystWindow({
      tick:context.tick,
      lastDecisionTick:this.#lastDecisionTick,
      lastMajorCatalystTick:this.#lastMajorCatalystTick,
      context,
      policyVersion:this.#catalystPolicyVersion,
    });
    if(!opportunity)return false;
    this.#pendingDecision=opportunity;
    this.#lastDecisionTick=opportunity.createdTick;
    return true;
  }

  /**
   * Read-only catalyst diagnostics for validation and UI: the current context
   * plus per-catalyst eligibility. Pure read; safe to call any time.
   */
  describeCatalystEligibility():{context:CatalystContext;diagnoses:readonly CatalystDiagnosis[]}{
    if(!this.#experiment)throw new Error("Universe has not been created");
    const context=this.#catalystContext();
    return{
      context,
      diagnoses:diagnoseCatalysts(context,isMajorCooldownClear(context.tick,this.#lastMajorCatalystTick)),
    };
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
      // Observed events have priority: evaluate them first at every step, and
      // only consider a catalyst window at stride boundaries when none fired.
      if(this.#evaluateNewEvents())break;
      if(this.#experiment.t%EVENT_STRIDE===0&&this.#evaluateCatalystWindow())break;
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
      // A catalyst window is equally scan-worthy: quiet stretches are exactly
      // when the player reaches for time compression.
      if(this.#experiment.t%EVENT_STRIDE===0&&this.#evaluateCatalystWindow())return this.snapshot();
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
    // The pause gate covers experiments too: applying a disturbance under a
    // pending choice would stale its offered context and stack an unevaluated
    // second hit. Internal resolution uses applyIntervention directly and is
    // unaffected (it clears the gate itself).
    if(this.#pendingDecision)throw new Error("A decision is pending: resolve it before experimenting");
    if(!this.#control)this.createControlFork();
    const spec:InterventionSpec=intervention==="global"
      ?{schemaVersion:1,kind:"nutrient_disturbance",mode:"global_crash"}
      :intervention==="droughtA"
        ?{schemaVersion:1,kind:"nutrient_disturbance",mode:"drought_a"}
        :{schemaVersion:1,kind:"nutrient_disturbance",mode:"drought_b"};
    return this.applyIntervention(spec,"manual intervention");
  }

  /**
   * Resolve the pending opportunity, either source. Records the command,
   * applies at most one intervention, clears the gate, and never advances a
   * tick: the world stays paused until the player explicitly resumes.
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
    const fromCatalyst=pending.source==="world_catalyst";
    const resolution:DecisionResolution={
      schemaVersion:1,
      commandId:decisionCommandIdFor(pending.opportunityId,choice.choiceId,pending.policyVersion),
      tick:this.#experiment.t,
      offerTick:pending.createdTick,
      opportunityId:pending.opportunityId,
      // Never a fabricated event id: catalyst resolutions carry null.
      sourceEventId:fromCatalyst?null:pending.sourceEventId,
      choiceId:choice.choiceId,
      choiceTitle:choice.title,
      directEffectDescription:choice.directEffectDescription,
      intervention:choice.intervention,
      source:fromCatalyst?"world_catalyst":"event_decision",
      catalystId:choice.catalystId??null,
      // The opportunity's version, not the generator's: a restored pending
      // keeps the catalog it was offered under, so the record stays
      // interpretable even after the catalog evolves.
      policyVersion:pending.policyVersion,
    };
    this.#decisionResolutions.push(resolution);
    if(choice.intervention){
      // The quiet interval already restarted at creation; only a non-null
      // catalyst application additionally starts the major cooldown.
      this.applyIntervention(choice.intervention,fromCatalyst?"world catalyst":"event decision");
      if(fromCatalyst)this.#lastMajorCatalystTick=this.#experiment.t;
    }
    this.#pendingDecision=null;
    return this.snapshot();
  }

  #decisionCheckpoint():DecisionCheckpoint{
    return{
      pending:this.#pendingDecision?JSON.parse(JSON.stringify(this.#pendingDecision)):null,
      resolutions:JSON.parse(JSON.stringify(this.#decisionResolutions)),
      policyVersion:this.#policyVersion,
      catalystPolicyVersion:this.#catalystPolicyVersion,
      lastDecisionTick:this.#lastDecisionTick,
      lastMajorCatalystTick:this.#lastMajorCatalystTick,
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
   * Restore schema 0.3 exactly. Older schemas migrate forward explicitly:
   * - 0.2: same simulation/analysis/control state; pending normalizes (a
   *   sourceless pending with a sourceEventId is an event decision);
   *   resolutions backfill offerTick/catalystId; pacing state restarts from
   *   the newest known decision tick (or 0) with a clear cooldown.
   * - 0.1: as 0.2, with no pending opportunity and an empty command history.
   * Generator versions are always the running code's; persisted pendings and
   * resolutions keep their own embedded versions.
   */
  restore(checkpoint:SupportedUniverseCheckpoint){
    const schema=(checkpoint as any)?.checkpointSchemaVersion;
    if(schema!=="0.1"&&schema!=="0.2"&&schema!=="0.3")throw new Error(`Unsupported runtime checkpoint schema: ${String(schema)}`);
    if(checkpoint.engineVersion!==ENGINE_VERSION)throw new Error(`Checkpoint engine ${checkpoint.engineVersion} does not match ${ENGINE_VERSION}`);
    // A restore is a new displayed world, not the old one continued: hand out
    // a fresh presentation identity so rendering inertia cannot carry over.
    this.#worldId=++worldIdCounter;
    this.#experiment=restoreSimulationCheckpoint(checkpoint.experiment as any);
    this.#analysis=EcologyObserver.restore(checkpoint.analysis);
    this.#control=checkpoint.control?restoreSimulationCheckpoint(checkpoint.control as any):null;
    this.#controlAnalysis=checkpoint.controlAnalysis?EcologyObserver.restore(checkpoint.controlAnalysis):null;
    if(schema==="0.3"){
      const decisions=(checkpoint as UniverseCheckpoint).decisions;
      this.#pendingDecision=normalizePendingDecision(decisions?.pending);
      this.#decisionResolutions=Array.isArray(decisions?.resolutions)
        ?decisions.resolutions.map(normalizeResolution)
        :[];
      this.#policyVersion=DECISION_POLICY_VERSION;
      this.#catalystPolicyVersion=CATALYST_POLICY_VERSION;
      this.#lastDecisionTick=typeof decisions?.lastDecisionTick==="number"?decisions.lastDecisionTick:0;
      this.#lastMajorCatalystTick=typeof decisions?.lastMajorCatalystTick==="number"?decisions.lastMajorCatalystTick:null;
    }else if(schema==="0.2"){
      const decisions=(checkpoint as UniverseCheckpointV02).decisions;
      const pending=normalizePendingDecision(decisions?.pending);
      const resolutions=Array.isArray(decisions?.resolutions)
        ?(decisions.resolutions as any[]).map(normalizeResolution)
        :[];
      this.#pendingDecision=pending;
      this.#decisionResolutions=resolutions;
      // Generator versions are always the running code's, for both catalogs.
      this.#policyVersion=DECISION_POLICY_VERSION;
      this.#catalystPolicyVersion=CATALYST_POLICY_VERSION;
      this.#lastDecisionTick=newestKnownDecisionTick(pending,resolutions);
      this.#lastMajorCatalystTick=null;
    }else{
      this.#pendingDecision=null;
      this.#decisionResolutions=[];
      this.#policyVersion=DECISION_POLICY_VERSION;
      this.#catalystPolicyVersion=CATALYST_POLICY_VERSION;
      this.#lastDecisionTick=0;
      this.#lastMajorCatalystTick=null;
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
      // Catalyst provenance stays explicit: pending/resolutions carry their
      // source, and pacing state is exported so evidence stays interpretable.
      observed_events:this.#analysis.observedEvents(),
      player_decisions:{
        schema_version:1,
        policy_version:this.#policyVersion,
        catalyst_policy_version:this.#catalystPolicyVersion,
        checkpoint_schema_version:CHECKPOINT_SCHEMA_VERSION,
        pending:this.#pendingDecision,
        resolutions:this.#decisionResolutions,
        catalyst_state:{
          last_decision_tick:this.#lastDecisionTick,
          last_major_catalyst_tick:this.#lastMajorCatalystTick,
          quiet_ticks:CATALYST_QUIET_TICKS,
          major_cooldown_ticks:MAJOR_CATALYST_COOLDOWN_TICKS,
        },
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
    return renderSnapshot(this.#experiment,this.#analysis,this.#control,this.#pendingDecision,this.#decisionResolutions,this.#worldId);
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
