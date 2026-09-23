import type { UniverseCheckpoint } from "@digital-evolution/contracts";

export interface SavedUniverseSummary {
  readonly id:string;
  readonly savedAt:string;
  readonly tick:number;
  readonly engineVersion:string;
}

export interface WorldRepository {
  save(id:string,checkpoint:UniverseCheckpoint):Promise<SavedUniverseSummary>;
  load(id:string):Promise<UniverseCheckpoint|null>;
  list():Promise<readonly SavedUniverseSummary[]>;
}

const DB_NAME="digital-evolution-ecosystem";
const STORE="universes";
const VERSION=1;

function openDb():Promise<IDBDatabase>{
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,VERSION);
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE,{keyPath:"id"})};
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}

function requestResult<T>(request:IDBRequest<T>):Promise<T>{
  return new Promise((resolve,reject)=>{
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}

export class IndexedDbWorldRepository implements WorldRepository {
  async save(id:string,checkpoint:UniverseCheckpoint){
    const db=await openDb();
    try{
      const record={id,savedAt:new Date().toISOString(),tick:checkpoint.createdTick,engineVersion:checkpoint.engineVersion,checkpoint};
      const tx=db.transaction(STORE,"readwrite");
      tx.objectStore(STORE).put(record);
      await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)});
      return{id:record.id,savedAt:record.savedAt,tick:record.tick,engineVersion:record.engineVersion};
    }finally{db.close()}
  }

  async load(id:string){
    const db=await openDb();
    try{
      const record:any=await requestResult(db.transaction(STORE,"readonly").objectStore(STORE).get(id));
      return record?.checkpoint??null;
    }finally{db.close()}
  }

  async list(){
    const db=await openDb();
    try{
      const records:any[]=await requestResult(db.transaction(STORE,"readonly").objectStore(STORE).getAll());
      return records.map(({id,savedAt,tick,engineVersion})=>({id,savedAt,tick,engineVersion})).sort((a,b)=>b.savedAt.localeCompare(a.savedAt));
    }finally{db.close()}
  }
}
