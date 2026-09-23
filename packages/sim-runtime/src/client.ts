import type {
  EngineConfig,
  RenderSnapshot,
  RuntimeCommand,
  RuntimeResponse,
  UniverseCheckpoint,
} from "@digital-evolution/contracts";

export interface RuntimeClient {
  command(command: RuntimeCommand): void;
  subscribe(listener: (snapshot: RenderSnapshot) => void): () => void;
  requestCheckpoint(): Promise<UniverseCheckpoint>;
  requestExport(): Promise<unknown>;
  destroy(): void;
}

export class WorkerRuntimeClient implements RuntimeClient {
  #worker:Worker;
  #listeners=new Set<(snapshot:RenderSnapshot)=>void>();
  #pending=new Map<string,{resolve:(value:any)=>void,reject:(reason?:any)=>void}>();
  #seq=0;

  constructor(){
    this.#worker=new Worker(new URL("./worker.ts",import.meta.url),{type:"module",name:"digital-evolution-sim"});
    this.#worker.addEventListener("message",(event:MessageEvent<RuntimeResponse>)=>this.#receive(event.data));
    this.#worker.addEventListener("error",(event)=>console.error("Simulation worker error",event));
  }

  create(config:EngineConfig){this.command({type:"CREATE_UNIVERSE",config})}
  advance(ticks:number){this.command({type:"ADVANCE_TICKS",ticks})}
  intervene(intervention:"global"|"droughtA"|"droughtB"){this.command({type:"APPLY_INTERVENTION",intervention})}
  createControlFork(){this.command({type:"CREATE_CONTROL_FORK"})}
  loadCheckpoint(checkpoint:UniverseCheckpoint){this.command({type:"LOAD_CHECKPOINT",checkpoint})}

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
    this.#listeners.clear();
  }

  #request<T>(type:"REQUEST_CHECKPOINT"|"REQUEST_EXPORT"):Promise<T>{
    const requestId=`r-${++this.#seq}`;
    return new Promise<T>((resolve,reject)=>{
      this.#pending.set(requestId,{resolve,reject});
      this.command({type,requestId} as RuntimeCommand);
    });
  }

  #receive(response:RuntimeResponse){
    if(response.type==="SNAPSHOT"){
      for(const listener of this.#listeners)listener(response.snapshot);
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
      if(response.requestId){
        const pending=this.#pending.get(response.requestId);
        if(pending){this.#pending.delete(response.requestId);pending.reject(new Error(response.message))}
      }else console.error(response.message);
    }
  }
}
