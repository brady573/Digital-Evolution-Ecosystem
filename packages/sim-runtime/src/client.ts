import type {
  EngineConfig,
  EvidenceExport,
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

export interface RuntimeClient {
  command(command: RuntimeCommand): void;
  subscribe(listener: (snapshot: RenderSnapshot) => void): () => void;
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

export class WorkerRuntimeClient implements RuntimeClient {
  #worker:Worker;
  #listeners=new Set<(snapshot:RenderSnapshot)=>void>();
  #pending=new Map<string,{resolve:(value:any)=>void,reject:(reason?:any)=>void}>();
  /** A load in flight. Keyed by the requestId the worker echoes in
   *  CHECKPOINT_LOADED, never by a tick: matching on tick let any live frame at
   *  the same tick satisfy a restore. `requestId` of the superseded load is
   *  remembered so its late reply is ignored rather than misattributed. */
  #pendingLoad:{requestId:string,resolve:(snapshot:RenderSnapshot)=>void,reject:(reason?:any)=>void,timer:ReturnType<typeof setTimeout>}|null=null;
  #seq=0;

  constructor(factory?:WorkerFactory){
    this.#worker=(factory?.()??new Worker(new URL("./worker.ts",import.meta.url),{type:"module",name:"digital-evolution-sim"}))as unknown as Worker;
    this.#register();
  }

  #register(){
    this.#worker.addEventListener("message",(event:MessageEvent<RuntimeResponse>)=>this.#receive(event.data));
    this.#worker.addEventListener("error",(event)=>console.error("Simulation worker error",event));
  }

  create(config:EngineConfig){this.command({type:"CREATE_UNIVERSE",config})}
  advance(ticks:number){this.command({type:"ADVANCE_TICKS",ticks})}
  intervene(intervention:"global"|"droughtA"|"droughtB"){this.command({type:"APPLY_INTERVENTION",intervention})}
  runToNextEvent(maxTicks=100_000){this.command({type:"RUN_TO_NEXT_EVENT",maxTicks})}
  createControlFork(){this.command({type:"CREATE_CONTROL_FORK"})}
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
      this.command({type:"LOAD_CHECKPOINT",requestId,checkpoint});
    });
  }

  command(command:RuntimeCommand){this.#worker.postMessage(command)}

  subscribe(listener:(snapshot:RenderSnapshot)=>void){
    this.#listeners.add(listener);
    return()=>this.#listeners.delete(listener);
  }

  requestCheckpoint(){
    return this.#request<UniverseCheckpoint>("REQUEST_CHECKPOINT");
  }

  requestExport(){
    return this.#request<EvidenceExport>("REQUEST_EXPORT");
  }

  destroy(){
    this.#worker.terminate();
    for(const pending of this.#pending.values())pending.reject(new Error("Runtime destroyed"));
    this.#pending.clear();
    this.#failPendingLoad(new Error("Runtime destroyed"));
    this.#listeners.clear();
  }

  #failPendingLoad(reason:Error){
    const pending=this.#pendingLoad;
    this.#pendingLoad=null;
    if(pending){clearTimeout(pending.timer);pending.reject(reason)}
  }

  #request<T>(type:"REQUEST_CHECKPOINT"|"REQUEST_EXPORT"|"RESOLVE_EVENT_DECISION"|"ACKNOWLEDGE_AFTERMATH",extra:Record<string,unknown>={}):Promise<T>{
    const requestId=`r-${++this.#seq}`;
    return new Promise<T>((resolve,reject)=>{
      this.#pending.set(requestId,{resolve,reject});
      this.command({type,requestId,...extra} as RuntimeCommand);
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
    if(response.type==="CHECKPOINT_LOADED"){
      const pendingLoad=this.#pendingLoad;
      // A reply for an already-settled or superseded load is normal, not an
      // error: ignore it rather than misattribute it to the live load.
      if(!pendingLoad||pendingLoad.requestId!==response.requestId)return;
      pendingLoad.resolve(response.snapshot);
      return;
    }
    if(response.type==="DECISION_RESOLVED"||response.type==="AFTERMATH_ACKNOWLEDGED"){
      const pending=this.#pending.get(response.requestId);
      if(!pending)return;
      this.#pending.delete(response.requestId);
      pending.resolve(response.snapshot);
      return;
    }
    if(response.type==="CHECKPOINT"||response.type==="EXPORT"){
      const pending=this.#pending.get(response.requestId);
      if(!pending)return;
      this.#pending.delete(response.requestId);
      pending.resolve(response.type==="CHECKPOINT"?response.checkpoint:response.data);
      return;
    }
    if(response.type==="ERROR"){
      // A fire-and-forget command (e.g. LOAD_CHECKPOINT) reports errors
      // without a requestId. Attribute such errors to a pending restore so
      // failures surface explicitly instead of falling back silently.
      if(!response.requestId)this.#failPendingLoad(new Error(response.message));
      if(response.requestId){
        const pending=this.#pending.get(response.requestId);
        if(pending){this.#pending.delete(response.requestId);pending.reject(new Error(response.message))}
      }else console.error(response.message);
    }
  }
}
