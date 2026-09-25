import type {
  EngineConfig,
  RenderSnapshot,
  RuntimeCommand,
  RuntimeResponse,
  SupportedUniverseCheckpoint,
  UniverseCheckpoint,
} from "@digital-evolution/contracts";

export interface RuntimeClient {
  command(command: RuntimeCommand): void;
  subscribe(listener: (snapshot: RenderSnapshot) => void): () => void;
  loadCheckpoint(checkpoint: SupportedUniverseCheckpoint): Promise<RenderSnapshot>;
  requestCheckpoint(): Promise<UniverseCheckpoint>;
  requestExport(): Promise<unknown>;
  /** Resolves the pending opportunity; rejects on validation failure. */
  resolveEventDecision(opportunityId: string, choiceId: string): Promise<RenderSnapshot>;
  destroy(): void;
}

const LOAD_TIMEOUT_MS = 10_000;

export class WorkerRuntimeClient implements RuntimeClient {
  #worker:Worker;
  #listeners=new Set<(snapshot:RenderSnapshot)=>void>();
  #pending=new Map<string,{resolve:(value:any)=>void,reject:(reason?:any)=>void}>();
  #pendingLoad:{expectedTick:number,resolve:(snapshot:RenderSnapshot)=>void,reject:(reason?:any)=>void,timer:ReturnType<typeof setTimeout>}|null=null;
  #seq=0;

  constructor(){
    this.#worker=new Worker(new URL("./worker.ts",import.meta.url),{type:"module",name:"digital-evolution-sim"});
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
  loadCheckpoint(checkpoint:SupportedUniverseCheckpoint){
    // Acknowledged restore: resolves only after the worker has restored the
    // checkpoint and emitted the corresponding snapshot. Rejects on worker
    // error or timeout instead of silently falling back.
    if(this.#pendingLoad){
      clearTimeout(this.#pendingLoad.timer);
      this.#pendingLoad.reject(new Error("Superseded by a newer restore request"));
      this.#pendingLoad=null;
    }
    return new Promise<RenderSnapshot>((resolve,reject)=>{
      this.#pendingLoad={
        expectedTick:checkpoint.createdTick,
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
      this.command({type:"LOAD_CHECKPOINT",checkpoint});
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
    return this.#request<unknown>("REQUEST_EXPORT");
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

  #request<T>(type:"REQUEST_CHECKPOINT"|"REQUEST_EXPORT"|"RESOLVE_EVENT_DECISION",extra:Record<string,unknown>={}):Promise<T>{
    const requestId=`r-${++this.#seq}`;
    return new Promise<T>((resolve,reject)=>{
      this.#pending.set(requestId,{resolve,reject});
      this.command({type,requestId,...extra} as RuntimeCommand);
    });
  }

  #receive(response:RuntimeResponse){
    if(response.type==="SNAPSHOT"){
      const pendingLoad=this.#pendingLoad;
      if(pendingLoad&&response.snapshot.tick===pendingLoad.expectedTick)pendingLoad.resolve(response.snapshot);
      for(const listener of this.#listeners)listener(response.snapshot);
      return;
    }
    if(response.type==="DECISION_RESOLVED"){
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
