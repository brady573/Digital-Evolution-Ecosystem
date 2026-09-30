import type {
  AftermathBaseline,
  AftermathState,
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
  UniverseCheckpointV03,
  WorldId,
} from "@digital-evolution/contracts";
// Aliased: `renderSnapshot` has a parameter named `worldId`, and the shadow
// would otherwise hide the constructor that assigns the presentation identity.
import {
  AFTERMATH_COMPARABLES,
  decisionCommandId,
  validateCheckpoint,
  canonicalizeRestoreState,
  validateCanonicalRestoreState,
  worldId as toWorldId,
} from "@digital-evolution/contracts";
import type { CanonicalizationContext } from "@digital-evolution/contracts";
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

export const CHECKPOINT_SCHEMA_VERSION = "0.4" as const;

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

/**
 * Retain the moment-of-intervention read model an aftermath compares against.
 *
 * Built from the same authorities that feed analysis: the resource/waste
 * fields straight off the simulation, and the scalars off the observation
 * frame, filtered to exactly the keys AFTERMATH_COMPARABLES declares. A
 * scalar with no declared descriptor is not retained, so the comparison
 * surface cannot grow past what the contract can label and explain.
 *
 * Called at the resolution tick BEFORE the intervention is applied, and
 * resolution advances zero ticks, so `tick` here is the resolution tick and
 * the instant the effect landed. It is a copy: nothing retained is ever
 * written back, and the simulation keeps sole authority over these fields.
 */
function aftermathBaselineFor(sim:any):AftermathBaseline{
  const scalars=aftermathScalarsFor(sim);
  return {
    tick:sim.t,
    resources:{
      gridSize:sim.resources.n,
      stock:sim.resources.stock.map((row:ArrayLike<number>)=>Array.from(row)),
    },
    waste:{
      gridSize:sim.resources.waste.n,
      stock:Array.from(sim.resources.waste.stock),
    },
    scalars:scalars.scalars,
  };
}

/**
 * Derive the comparable scalars off the observation frame. These values are
 * computed inside observerSnapshot (population roles, clade tallies, waste
 * exposure), so they are NOT present in the raw metrics payload - which is why
 * "now" has to come from here rather than from the snapshot's metrics, or the
 * comparison would silently be reading different quantities.
 */
function aftermathScalarsFor(sim:any):{readonly tick:number;readonly scalars:Record<string,number>}{
  const frame=analysisFrame(sim);
  const scalars:Record<string,number>={};
  for(const descriptor of AFTERMATH_COMPARABLES){
    const value=(frame as any)[descriptor.key];
    if(typeof value==="number"&&Number.isFinite(value))scalars[descriptor.key]=value;
  }
  return {tick:sim.t,scalars};
}

function observeIfDue(sim:any,observer:EcologyObserver){
  if(sim.t>0&&sim.t%EVENT_STRIDE===0)observer.observe(analysisFrame(sim));
}

function renderSnapshot(sim:any,analysis:EcologyObserver,control:any|null,pendingDecision:PendingDecision|null,resolvedDecisions:readonly DecisionResolution[],worldId:WorldId,aftermath:AftermathState|null):RenderSnapshot{
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
    aftermath,
    control:control?{tick:control.t,population:control.o.length,metrics:control.metrics()}:null,
  };
}

/**
 * The trusted, running-build values canonicalisation needs.
 *
 * Built from the owning modules rather than from any save, and read-only: the
 * observer is constructed fresh and only its declared initial detector state is
 * read out of it. No RNG is consumed and no session state is touched, so
 * obtaining this cannot perturb a replay.
 */
const canonicalizationContext = (): CanonicalizationContext => {
  const observer = new EcologyObserver();
  return {
    policyVersion: DECISION_POLICY_VERSION,
    catalystPolicyVersion: CATALYST_POLICY_VERSION,
    currentSchema: CHECKPOINT_SCHEMA_VERSION,
    detectorDefaults: {
      dep: JSON.parse(JSON.stringify(observer.dep)),
      niche: JSON.parse(JSON.stringify(observer.niche)),
    },
  };
};

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
  /** Dev/test-only catalyst offers (e.g. the C washout) are OFF unless a test
   *  explicitly enables them. Product never sets this, so the production
   *  catalyst catalog is exactly the three abiotic-nutrient options. */
  #testCatalysts=false;
  /** Enables dev/test-only catalyst offers. Returns the snapshot so a caller
   *  can chain. Intended for validation and browser harnesses only. */
  enableTestCatalysts(){this.#testCatalysts=true;return this.snapshot()}
  get testCatalysts(){return this.#testCatalysts}

  /** M3 aftermath under observation, entered at decision resolution.
   *  Evidence/presentation state, not biology. NOT checkpointed: like
   *  phenotype anchors it is saved alongside the checkpoint, never inside it,
   *  so a universe restores identically with or without it. */
  #aftermath:AftermathState|null=null;

  get simulation(){return this.#experiment}
  get analysis(){return this.#analysis}
  get control(){return this.#control}
  get pendingDecision(){return this.#pendingDecision}
  get decisionResolutions(){return this.#decisionResolutions}
  get aftermath(){return this.#aftermath}

  /**
   * Presentation-level world identity: a monotonic, process-unique id handed
   * out once per universe instance. It exists ONLY so the renderer can tell
   * two displayed worlds apart; it is not biological state, is not stored in
   * checkpoints, and never reaches the simulation. Seed and config are not
   * sufficient: two universes (or a fork, or a same-seed restore) can
   * legitimately share both.
   */
  #worldId:WorldId=toWorldId(0);
  get worldId(){return this.#worldId}

  create(config:EngineConfig){
    this.#worldId=toWorldId(++worldIdCounter);
    this.#experiment=new Simulation(config);
    this.#analysis=new EcologyObserver();
    this.#control=null;
    this.#controlAnalysis=null;
    this.#pendingDecision=null;
    this.#decisionResolutions=[];
    this.#aftermath=null;
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
      // Same realized-energy denominator as A and B, so the three shares sum to 1.
      energyShareC:totalEnergy>0?ec/totalEnergy:0,
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
      includeTestCatalysts:this.#testCatalysts,
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

  /**
   * The hard tick gate for a PENDING DECISION. While one is pending no tick may
   * execute through any command path: the UI frame loop cannot push through it,
   * and an in-flight multi-tick request stops at the trigger tick. Play cannot
   * bypass it.
   *
   * An aftermath impact state is a weaker, different kind of pause, and the
   * distinction matters. Nothing advances on its own while an impact state is
   * open - there is no timer, no scheduler tick, no background path. But an
   * EXPLICIT command from the player is a legitimate release, which is what the
   * handoff specifies (AC4: paused until Resume *or another explicit supported
   * advance command*). So an explicit advance releases the pause and moves on.
   * Refusing it would be stricter than specified and would contradict the
   * long-standing A14 contract that an explicit advance resumes time.
   */
  #impactPaused(){
    return this.#pendingDecision!==null;
  }

  /**
   * Release an unacknowledged impact state. Transitions to "observation" rather
   * than discarding the aftermath: the record and its retained baseline survive,
   * so nothing is lost by moving on. A later slice presents "observation" as the
   * compact strip; until then the impact sheet simply stops being the active
   * state, which is what keeps it from ever showing a stale comparison.
   */
  #releaseImpact(){
    if(this.#aftermath?.phase!=="impact")return;
    this.#aftermath={...this.#aftermath,phase:"observation"};
  }

  advance(ticks:number){
    if(!this.#experiment)throw new Error("Universe has not been created");
    // A pending decision is a hard gate the UI frame loop cannot push through.
    if(this.#impactPaused())return this.snapshot();
    const count=Math.max(0,Math.floor(ticks));
    // An explicit advance releases an unacknowledged impact state. A zero-tick
    // request stays a pure query: advance(0) must not silently dismiss a sheet
    // the player is reading.
    if(count>0)this.#releaseImpact();
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
    if(this.#impactPaused())return this.snapshot();
    this.#releaseImpact();
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

  // impl: REQ-EXP-001 (lazy matched-control fork; interventions apply env-only effects)
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
    // An explicit world-changing command releases an unacknowledged impact
    // state, exactly as an explicit advance does. The uniform rule: nothing
    // automatic releases the pause, and any deliberate command from the player
    // does.
    this.#releaseImpact();
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
      commandId:decisionCommandId(decisionCommandIdFor(pending.opportunityId,choice.choiceId,pending.policyVersion)),
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
    // Retain BOTH sides of the direct effect synchronously, at the resolution
    // tick: one immediately before the effect lands, one immediately after.
    // Resolution advances zero ticks, so both are the same tick and the
    // difference between them IS the mechanical effect and nothing else.
    //
    // Retaining the after-state is what makes AC23 hold. Playback resumes
    // automatically once this gate clears (AC22), so a comparison reading live
    // state would drift under the player and stop describing the direct effect
    // at all. A new resolution supersedes any aftermath still under observation;
    // the prior one is already durable in #decisionResolutions, which is what
    // History reads.
    const baseline=aftermathBaselineFor(this.#experiment);
    if(choice.intervention){
      // The quiet interval already restarted at creation; only a non-null
      // catalyst application additionally starts the major cooldown.
      this.applyIntervention(choice.intervention,fromCatalyst?"world catalyst":"event decision");
      if(fromCatalyst)this.#lastMajorCatalystTick=this.#experiment.t;
    }
    this.#aftermath={
      schemaVersion:1,
      opportunityId:pending.opportunityId,
      commandId:resolution.commandId,
      resolutionTick:this.#experiment.t,
      phase:"impact",
      choiceTitle:choice.title,
      directEffectDescription:choice.directEffectDescription,
      intervention:choice.intervention,
      source:resolution.source,
      baseline,
      resolved:aftermathBaselineFor(this.#experiment),
    };
    this.#pendingDecision=null;
    return this.snapshot();
  }

  /**
   * Collapse the impact sheet: move the aftermath to "observation".
   *
   * Deliberately NOT a resume. Playback is the app's business and is usually
   * already running by the time this is called, because resolving a choice
   * restores the player's prior play intent (AC22). All this does is release the
   * presentation slot, and it advances zero ticks.
   *
   * Transitions rather than discards: the retained baseline, the retained
   * post-effect state and the intervention identity all survive, and a later
   * slice presents "observation" as the compact aftermath strip.
   */
  acknowledgeAftermath(){
    if(!this.#experiment)throw new Error("Universe has not been created");
    if(!this.#aftermath)throw new Error("No aftermath is awaiting acknowledgement");
    if(this.#aftermath.phase!=="impact")throw new Error("Aftermath is not awaiting acknowledgement");
    this.#releaseImpact();
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
   * Restore schema 0.4 exactly. Older schemas migrate forward explicitly:
   * - 0.2: same simulation/analysis/control state; pending normalizes (a
   *   sourceless pending with a sourceEventId is an event decision);
   *   resolutions backfill offerTick/catalystId; pacing state restarts from
   *   the newest known decision tick (or 0) with a clear cooldown.
   * - 0.1: as 0.2, with no pending opportunity and an empty command history.
   * Generator versions are always the running code's; persisted pendings and
   * resolutions keep their own embedded versions.
   */
  restore(checkpoint:SupportedUniverseCheckpoint){
    // Refusal happens before anything is applied, so a rejected payload never
    // becomes live state — and before any sim-core call, so the simulation is
    // never handed a value it would have to partially apply.
    //
    // Source-schema preflight examines the raw payload: only historically
    // evidenced absent fields and pre-A2 bare refs may reach reconstruction.
    // Canonical migrate-then-validate is the separate A3.4 contract.
    //
    // `migrateAnalysisEntityRefs` takes an analysis payload, not a checkpoint:
    // it was written and tested against one, and handing it a checkpoint makes
    // it look for `records` at the top level, find none, and no-op. The first
    // wiring attempt did exactly that, and the pre-A2 length test caught it.
    validateCheckpoint(checkpoint);
    if(checkpoint.engineVersion!==ENGINE_VERSION)throw new Error(`Checkpoint engine ${checkpoint.engineVersion} does not match ${ENGINE_VERSION}`);
    // A restore is a new displayed world, not the old one continued: hand out
    // a fresh presentation identity so rendering inertia cannot carry over.
    // One canonical restore representation for every supported schema, produced
    // by the same pure migration regardless of which writer wrote the save.
    // The per-schema branches that used to live here are gone: 0.2's
    // reconstruction and 0.3's preservation are now properties of the
    // migration, not of the restore call site.
    //
    // The ANALYSIS layer comes from the same canonical object rather than from a
    // separately migrated one. Migrating here as well would run the reference
    // migration twice and leave the canonical detector backfill with no effect
    // on any restored world, while the rules describing it stayed green.
    const context=canonicalizationContext();
    // The canonicalizer returns a runtime-untrusted CANDIDATE. Nothing may
    // consume it: the validator is a narrowing boundary, so the value restore
    // uses is only reachable by having passed the current non-simulation
    // contract. A rule whose canonical default the current contract rejects
    // therefore fails here instead of loading.
    const canonical=validateCanonicalRestoreState(canonicalizeRestoreState(checkpoint,context),context);
    this.#worldId=toWorldId(++worldIdCounter);
    this.#experiment=restoreSimulationCheckpoint(checkpoint.experiment as any);
    // The observer sees the canonical layer: references migrated, and detector
    // sub-states materialised where the writer could not have emitted them. A
    // save written before A2 holds bare numbers where a ref now carries its
    // kind, and each becomes `kind: null` — a real entity of unrecorded kind.
    // Presentation then omits the label rather than guessing a namespace,
    // which is A2's specified behaviour for a kind never recorded.
    this.#analysis=EcologyObserver.restore(canonical.analysis as any);
    // Aftermath is deliberately NOT restored. It is evidence held outside the
    // checkpoint, so a restore that carried it would be reconstructing an
    // observation from simulation state alone - exactly what must not happen.
    // A restored world therefore shows no aftermath, and the durable decision
    // record still reads from `decisions.resolutions`. Presenting the retained
    // baseline across a save is a later, separate contract.
    this.#aftermath=null;
    this.#control=checkpoint.control?restoreSimulationCheckpoint(checkpoint.control as any):null;
    this.#controlAnalysis=canonical.controlAnalysis
      ?EcologyObserver.restore(canonical.controlAnalysis as any)
      :null;
    const decisions=canonical.decisions as DecisionCheckpoint;
    this.#pendingDecision=decisions.pending;
    this.#decisionResolutions=[...decisions.resolutions] as DecisionResolution[];
    this.#policyVersion=decisions.policyVersion;
    this.#catalystPolicyVersion=decisions.catalystPolicyVersion;
    this.#lastDecisionTick=decisions.lastDecisionTick;
    this.#lastMajorCatalystTick=decisions.lastMajorCatalystTick;
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
    return renderSnapshot(this.#experiment,this.#analysis,this.#control,this.#pendingDecision,this.#decisionResolutions,this.#worldId,this.#aftermath);
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
        case "ACKNOWLEDGE_AFTERMATH":{
          const snapshot=this.acknowledgeAftermath();
          return command.requestId
            ?[{type:"AFTERMATH_ACKNOWLEDGED",requestId:command.requestId,snapshot},{type:"SNAPSHOT",snapshot}]
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
