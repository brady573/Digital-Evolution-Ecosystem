import type {
  EngineConfig,
  EvidenceExport,
  PresentationFrame,
  RenderSnapshot,
  RuntimeCommand,
  RuntimeResponse,
  SupportedUniverseCheckpoint,
  UniverseCheckpoint,
} from "@digital-evolution/contracts";

/**
 * The slice of Worker this client actually uses.
 *
 * Issue #54 item 4 requires the transport be injectable enough to prove
 * failure behaviour without a browser crash harness. Node has no Worker global,
 * so without this the entire settlement contract would be untestable there.
 */
export interface WorkerLike {
  postMessage(message:unknown):void;
  terminate():void;
  addEventListener(type:"message"|"error"|"messageerror",listener:(event:never)=>void):void;
}

export type WorkerFactory=()=>WorkerLike;

export interface WorkerRuntimeOptions{
  /** Bounded lifetime for ordinary requests. A worker that never answers must
   *  not leave a promise pending forever. Not product-visible: every caller
   *  already awaits inside a handler that catches and reports. */
  readonly requestTimeoutMs?:number;
}

/** Typed terminal state for a dead worker transport.
 *
 *  A worker error/messageerror ends the WorkerRuntimeClient instance: no later
 *  snapshot can arrive, so the product needs an explicit "runtime stopped"
 *  signal rather than a silently frozen UI. The detail is a plain string, never
 *  a raw browser event object.
 */
export interface TerminalFailure {
  readonly kind: "worker-error";
  readonly detail: string;
}

export interface RuntimeClient {
  onTerminal(listener: (failure: TerminalFailure) => void): () => void;
  subscribe(listener: (snapshot: RenderSnapshot) => void): () => void;
  /**
   * Lane 3 F2a publisher: read-model frame delivery beside the legacy
   * transport. PRESENTATION traffic routes here; the legacy subscribe path is
   * byte-identical and neither direction leaks into the other.
   */
  subscribePresentation(listener: (frame: PresentationFrame) => void): () => void;
  loadCheckpoint(checkpoint: SupportedUniverseCheckpoint): Promise<RenderSnapshot>;
  requestCheckpoint(): Promise<UniverseCheckpoint>;
  requestExport(): Promise<EvidenceExport>;
  /** Resolves the pending opportunity; rejects on validation failure. */
  resolveEventDecision(opportunityId: string, choiceId: string): Promise<RenderSnapshot>;
  /** Acknowledges the aftermath impact state, moving it to observation so the
   *  sheet can collapse. Not a resume: playback is the app's business and may
   *  already be running. Never advances a tick. */
  acknowledgeAftermath(): Promise<RenderSnapshot>;
  destroy(): void;
}

const LOAD_TIMEOUT_MS = 10_000;
/** Bounded lifetime for an ordinary request. Chosen far above any observed
 *  worker turnaround: a stalled worker should fail visibly, not linger. */
const REQUEST_TIMEOUT_MS = 30_000;

/** Best-effort description of a transport failure event, for the log line. */
const describe=(event:unknown):string=>{
  const message=(event as {message?:unknown})?.message;
  return typeof message==="string"&&message.length>0?message:"no detail";
};

/**
 * Canonical production worker construction. The client's default transport.
 * The constructor takes an injected factory instead so failure behaviour is
 * provable through a fake transport; the default here is what ships.
 */
export function createWorkerTransport():WorkerLike{
  return new Worker(new URL("./worker.ts",import.meta.url),{type:"module",name:"digital-evolution-sim"}) as unknown as WorkerLike;
}

export class WorkerRuntimeClient implements RuntimeClient {
  #worker:Worker;
  #listeners=new Set<(snapshot:RenderSnapshot)=>void>();
  /** Lane 3 F2a: presentation-frame subscribers. Apart from snapshot
   *  subscribers so the fatal path can drop both: a dead worker can never
   *  deliver another frame either. */
  #presentationListeners=new Set<(frame:PresentationFrame)=>void>();
  /** Test/diagnostic seam: how many request ids the pending map still holds.
   *  AC5 is a claim about retained state, so it must be observable rather than
   *  inferred from "nothing crashed". */
  get pendingRequestCount(){return this.#pending.size}
  #pending=new Map<string,{resolve:(value:any)=>void,reject:(reason?:any)=>void,timer:ReturnType<typeof setTimeout>}>();
  /** A load in flight. Keyed by the requestId the worker echoes in
   *  CHECKPOINT_LOADED, never by a tick: matching on tick let any live frame at
   *  the same tick satisfy a restore. `requestId` of the superseded load is
   *  remembered so its late reply is ignored rather than misattributed. */
  #pendingLoad:{requestId:string,resolve:(snapshot:RenderSnapshot)=>void,reject:(reason?:any)=>void,timer:ReturnType<typeof setTimeout>}|null=null;
  #seq=0;
  readonly #requestTimeoutMs:number;
  #terminal:TerminalFailure|null=null;
  #terminalFired=false;
  /** Terminal listeners live apart from snapshot subscribers so the fatal
   *  path's #listeners.clear() cannot drop them: a dead worker's one signal
   *  must still reach the product. */
  #terminalListeners=new Set<(failure:TerminalFailure)=>void>();

  constructor(factory?:WorkerFactory,options:WorkerRuntimeOptions={}){
    this.#worker=(factory?.()??createWorkerTransport())as unknown as Worker;
    this.#requestTimeoutMs=options.requestTimeoutMs??REQUEST_TIMEOUT_MS;
    this.#register();
  }

  /**
   * One place the transport's failure surface is attached, so error and
   * messageerror cannot drift apart: both must enter the same fatal path.
   */
  #register(){
    this.#worker.addEventListener("message",(event:MessageEvent<RuntimeResponse>)=>this.#receive(event.data));
    this.#worker.addEventListener("error",(event)=>this.#onTransportFailure(event));
    this.#worker.addEventListener("messageerror",(event)=>this.#onTransportFailure(event));
  }

  /**
   * Shared transport-failure entry: error and messageerror must enter the same
   * fatal path. Tests drive it through an injected fake transport's
   * fail(kind, detail), which invokes the registered listeners exactly as a
   * real worker failure would.
   */
  #onTransportFailure(event:unknown){
    this.#failAll(new Error(`Simulation worker failed: ${describe(event)}`),true);
  }

  /**
   * The single terminal-failure path. Rejects every pending request, fails any
   * pending checkpoint load, clears the pending map so no entry survives, and
   * drops subscribers - a dead worker can never deliver another snapshot, so
   * retaining listeners would leave the UI holding a subscription only a new
   * client could satisfy.
   *
   * When signal is true (worker error/messageerror, never destroy), the
   * terminal state is recorded and terminal listeners fire exactly once per
   * client lifetime. destroy() passes false: intentional teardown is not a
   * terminal failure the product must surface.
   */
  #failAll(reason:Error,signal:boolean){
    for(const pending of this.#pending.values()){
      clearTimeout(pending.timer);
      pending.reject(reason);
    }
    this.#pending.clear();
    this.#failPendingLoad(reason);
    this.#listeners.clear();
    this.#presentationListeners.clear();
    if(signal&&!this.#terminalFired){
      this.#terminalFired=true;
      this.#terminal={kind:"worker-error",detail:reason.message};
      for(const listener of [...this.#terminalListeners])listener(this.#terminal);
    }
  }

  create(config:EngineConfig){this.#post({type:"CREATE_UNIVERSE",config})}
  advance(ticks:number){this.#post({type:"ADVANCE_TICKS",ticks})}
  intervene(intervention:"global"|"droughtA"|"droughtB"){this.#post({type:"APPLY_INTERVENTION",intervention})}
  runToNextEvent(maxTicks=100_000){this.#post({type:"RUN_TO_NEXT_EVENT",maxTicks})}
  createControlFork(){this.#post({type:"CREATE_CONTROL_FORK"})}
  resolveEventDecision(opportunityId:string,choiceId:string){
    return this.#request<RenderSnapshot>("RESOLVE_EVENT_DECISION",{opportunityId,choiceId});
  }
  acknowledgeAftermath(){
    return this.#request<RenderSnapshot>("ACKNOWLEDGE_AFTERMATH",{});
  }
  loadCheckpoint(checkpoint:SupportedUniverseCheckpoint){
    // Acknowledged restore: resolves only after the worker has restored the
    // checkpoint and emitted the corresponding snapshot. Rejects on worker
    // error or timeout instead of silently falling back.
    // Supersession is explicit and deterministic: a second load rejects the
    // first rather than letting one request quietly satisfy another. The
    // message is byte-for-byte the previous behaviour.
    if(this.#pendingLoad){
      clearTimeout(this.#pendingLoad.timer);
      this.#pendingLoad.reject(new Error("Superseded by a newer restore request"));
      this.#pendingLoad=null;
    }
    return new Promise<RenderSnapshot>((resolve,reject)=>{
      // Completion is correlated by request identity, never by tick equality:
      // the worker echoes this requestId in CHECKPOINT_LOADED and nothing else
      // can settle the promise.
      const requestId=`load-${++this.#seq}`;
      this.#pendingLoad={
        requestId,
        resolve:(snapshot)=>{
          if(this.#pendingLoad){clearTimeout(this.#pendingLoad.timer);this.#pendingLoad=null}
          resolve(snapshot);
        },
        reject:(reason)=>{
          if(this.#pendingLoad){clearTimeout(this.#pendingLoad.timer);this.#pendingLoad=null}
          reject(reason);
        },
        timer:setTimeout(()=>this.#failPendingLoad(new Error(`Restore timed out waiting for tick ${checkpoint.createdTick}`)),LOAD_TIMEOUT_MS),
      };
      this.#post({type:"LOAD_CHECKPOINT",requestId,checkpoint});
    });
  }

  /** Raw dispatch is private: production consumers use the typed product
   *  operations above, never a generic command escape hatch. */
  #post(command:RuntimeCommand){this.#worker.postMessage(command)}

  onTerminal(listener:(failure:TerminalFailure)=>void){
    this.#terminalListeners.add(listener);
    return()=>{this.#terminalListeners.delete(listener)};
  }

  /** The recorded terminal state, or null while the transport lives.
   *  Class-only, like pendingRequestCount: lets late subscribers query what
   *  happened without widening the production RuntimeClient interface. */
  get terminal(){return this.#terminal}

  subscribe(listener:(snapshot:RenderSnapshot)=>void){
    // A dead client accepts no new subscribers: no later snapshot can arrive,
    // so retaining the listener would only leak it and mislead the caller
    // into holding a subscription only a new client could satisfy.
    if(this.#terminalFired)return()=>{};
    this.#listeners.add(listener);
    return()=>this.#listeners.delete(listener);
  }

  subscribePresentation(listener:(frame:PresentationFrame)=>void){
    // Same dead-client rule as subscribe: no later frame can arrive after a
    // terminal failure, so a post-death subscription is dead on arrival.
    if(this.#terminalFired)return()=>{};
    this.#presentationListeners.add(listener);
    return()=>this.#presentationListeners.delete(listener);
  }

  requestCheckpoint(){
    return this.#request<UniverseCheckpoint>("REQUEST_CHECKPOINT");
  }

  requestExport(){
    return this.#request<EvidenceExport>("REQUEST_EXPORT");
  }

  destroy(){
    this.#worker.terminate();
    this.#failAll(new Error("Runtime destroyed"),false);
  }

  #failPendingLoad(reason:Error){
    const pending=this.#pendingLoad;
    this.#pendingLoad=null;
    if(pending){clearTimeout(pending.timer);pending.reject(reason)}
  }

  #request<T>(type:"REQUEST_CHECKPOINT"|"REQUEST_EXPORT"|"RESOLVE_EVENT_DECISION"|"ACKNOWLEDGE_AFTERMATH",extra:Record<string,unknown>={}):Promise<T>{
    const requestId=`r-${++this.#seq}`;
    return new Promise<T>((resolve,reject)=>{
      const timer=setTimeout(()=>{
        // Delete before rejecting: a late reply must not settle a settled request.
        this.#pending.delete(requestId);
        reject(new Error(`${type} timed out after ${this.#requestTimeoutMs}ms`));
      },this.#requestTimeoutMs);
      this.#pending.set(requestId,{resolve,reject,timer});
      this.#post({type,requestId,...extra} as RuntimeCommand);
    });
  }

  #receive(response:RuntimeResponse){
    if(response.type==="SNAPSHOT"){
      // A bare snapshot only notifies subscribers. It can never complete a
      // load: settling on tick equality is what let an unrelated live frame at
      // the same tick satisfy a restore.
      for(const listener of this.#listeners)listener(response.snapshot);
      return;
    }
    if(response.type==="PRESENTATION"){
      // Lane 3 F2a: read-model traffic routes only to presentation listeners.
      // The legacy subscribe path is untouched, in both directions.
      for(const listener of this.#presentationListeners)listener(response.frame);
      return;
    }
    if(response.type==="CHECKPOINT_LOADED"){
      const pendingLoad=this.#pendingLoad;
      // A reply that does not match the live load belongs to a settled or
      // superseded restore, and is dropped rather than misattributed. Its
      // world is deliberately NOT announced: a restore that was superseded or
      // failed must not silently swap what the player is looking at.
      if(!pendingLoad||pendingLoad.requestId!==response.requestId)return;
      pendingLoad.resolve(response.snapshot);
      // This reply IS the announcement. The session does not also send a bare
      // SNAPSHOT for a restore, because postMessage delivers each message as
      // its own task: a second delivery would reach subscribers after the load's
      // .then() had run, and Explorer clears its status string on every snapshot,
      // wiping "Checkpoint restored".
      for(const listener of this.#listeners)listener(response.snapshot);
      return;
    }
    if(response.type==="DECISION_RESOLVED"||response.type==="AFTERMATH_ACKNOWLEDGED"){
      const pending=this.#pending.get(response.requestId);
      if(!pending)return;
      this.#pending.delete(response.requestId);
      clearTimeout(pending.timer);
      pending.resolve(response.snapshot);
      return;
    }
    if(response.type==="CHECKPOINT"||response.type==="EXPORT"){
      const pending=this.#pending.get(response.requestId);
      if(!pending)return;
      this.#pending.delete(response.requestId);
      clearTimeout(pending.timer);
      pending.resolve(response.type==="CHECKPOINT"?response.checkpoint:response.data);
      return;
    }
    if(response.type==="ERROR"){
      const failure=new Error(response.message);
      // Attribute by identity first. A load is tracked in #pendingLoad, not
      // #pending, and a failed restore's error always carries the load's own
      // requestId now that the field is required. Looking only in #pending would
      // drop it, and the load would hang until its timeout reported a generic
      // "restore timed out" instead of the real reason.
      if(response.requestId){
        const pendingLoad=this.#pendingLoad;
        if(pendingLoad&&pendingLoad.requestId===response.requestId){
          this.#failPendingLoad(failure);
          return;
        }
        const pending=this.#pending.get(response.requestId);
        if(pending){
          this.#pending.delete(response.requestId);
          clearTimeout(pending.timer);
          pending.reject(failure);
          return;
        }
        // Addressed to a request that has already settled or been superseded.
        return;
      }
      // No requestId: a fire-and-forget command failed. It belongs to no
      // request, so it must not be misattributed to an in-flight load; report
      // it and leave every pending request alone.
      console.error(response.message);
    }
  }
}
