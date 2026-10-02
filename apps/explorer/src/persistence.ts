import type { UniverseCheckpoint } from "@digital-evolution/contracts";
import type { ResolvedPhenotype } from "@digital-evolution/phenotype";

export interface SavedUniverseSummary {
  readonly id:string;
  readonly savedAt:string;
  readonly tick:number;
  readonly engineVersion:string;
}

/**
 * F3a — the application-owned save envelope.
 *
 * One versioned record per slot. The enclosed `checkpoint` is the resumable
 * simulation/runtime authority; everything else in the envelope is descriptive
 * (for listing and display) or presentation-only adjunct state. Nothing here
 * ever overrides checkpoint truth — `tick` and `engineVersion` are indexing
 * conveniences copied out of the checkpoint at write time.
 *
 * The envelope is not a second checkpoint, an evidence export, a read-model
 * authority, or a recovery journal (handoff §8).
 */
export const SAVE_ENVELOPE_VERSION = 1;

export interface SaveEnvelope {
  readonly envelopeVersion: typeof SAVE_ENVELOPE_VERSION;
  readonly id:string;
  readonly savedAt:string;
  readonly tick:number;
  readonly engineVersion:string;
  readonly checkpoint:UniverseCheckpoint;
  /** Presentation-side family anchors. Never biological, never in the checkpoint. */
  readonly phenotypeAnchors?:Record<number,ResolvedPhenotype>|undefined;
}

/**
 * What one slot read yields. Both halves come from the SAME record read in the
 * SAME transaction, so they can never describe different record generations
 * (handoff §2, AC3).
 */
export interface SlotRead {
  readonly checkpoint:UniverseCheckpoint;
  readonly phenotypeAnchors:Record<number,ResolvedPhenotype>|null;
  readonly savedAt:string;
  readonly tick:number;
  readonly engineVersion:string;
}

export type PersistenceFailureKind = "no-save" | "storage-read-failed" | "storage-write-failed";

const PERSISTENCE_PLAYER_MESSAGES:Readonly<Record<PersistenceFailureKind,string>>={
  "no-save":"No saved universe found.",
  "storage-read-failed":"Your saved universe could not be read. It may still be there — try again.",
  "storage-write-failed":"That save could not be written. Your previous save is unchanged.",
};

/**
 * Typed storage failure (handoff §7). Explorer branches on `kind`, never on the
 * message text. `message` is the player-facing sentence; the underlying storage
 * error is kept on `cause` for logs and tests so raw DOM/IndexedDB text never
 * reaches the player as the primary explanation.
 */
export class PersistenceFailure extends Error {
  readonly kind:PersistenceFailureKind;
  readonly playerMessage:string;
  override readonly cause:unknown;
  constructor(kind:PersistenceFailureKind, cause?:unknown){
    super(PERSISTENCE_PLAYER_MESSAGES[kind]);
    this.name="PersistenceFailure";
    this.kind=kind;
    this.playerMessage=PERSISTENCE_PLAYER_MESSAGES[kind];
    this.cause=cause;
  }
}

export interface WorldRepository {
  save(id:string,checkpoint:UniverseCheckpoint,anchors?:Record<number,ResolvedPhenotype>):Promise<SavedUniverseSummary>;
  load(id:string):Promise<UniverseCheckpoint|null>;
  /** Checkpoint and adjuncts from one coherent read; null when the slot is empty. */
  readSlot(id:string):Promise<SlotRead|null>;
  list():Promise<readonly SavedUniverseSummary[]>;
}

import { sanitizeAnchors } from "./phenotype";

const DB_NAME="digital-evolution-ecosystem";
const STORE="universes";
const VERSION=1;

/** Classifies anything thrown by the storage layer as a typed failure. */
const asFailure=(kind:PersistenceFailureKind,error:unknown):PersistenceFailure=>
  error instanceof PersistenceFailure?error:new PersistenceFailure(kind,error);

const isRecord=(value:unknown):value is Record<string,unknown>=>
  typeof value==="object"&&value!==null&&!Array.isArray(value);

/**
 * In-memory normalization of anything this build can read (handoff §2, AC4).
 *
 * A record without `envelopeVersion` is a legacy/current-format record: the
 * same fields, written before the envelope existed. It is normalized HERE and
 * never written back — loading a legacy save must not rewrite it. The next
 * successful save naturally writes the current envelope.
 */
function normalizeStoredRecord(raw:unknown):SlotRead&{readonly id:string}{
  if(!isRecord(raw))throw new PersistenceFailure("storage-read-failed",new Error("stored record is not an object"));
  const version=raw["envelopeVersion"];
  if(typeof version==="number"&&version>SAVE_ENVELOPE_VERSION){
    // A newer build wrote this. It is unreadable here, which is a truthful
    // failure — never a silent "no save" and never a best-effort guess.
    throw new PersistenceFailure("storage-read-failed",new Error(`save envelope version ${version} is newer than ${SAVE_ENVELOPE_VERSION}`));
  }
  const checkpoint=raw["checkpoint"];
  if(!isRecord(checkpoint))throw new PersistenceFailure("storage-read-failed",new Error("stored record carries no usable checkpoint"));
  const anchors=isRecord(raw["phenotypeAnchors"])?sanitizeAnchors(raw["phenotypeAnchors"] as Record<number,ResolvedPhenotype>):null;
  return{
    id:typeof raw["id"]==="string"?raw["id"]:"",
    checkpoint:checkpoint as unknown as UniverseCheckpoint,
    phenotypeAnchors:anchors&&Object.keys(anchors).length>0?anchors:null,
    savedAt:typeof raw["savedAt"]==="string"?raw["savedAt"]:"",
    tick:typeof raw["tick"]==="number"?raw["tick"]:(checkpoint as {createdTick?:unknown}).createdTick as number,
    engineVersion:typeof raw["engineVersion"]==="string"?raw["engineVersion"]:(checkpoint as {engineVersion?:unknown}).engineVersion as string,
  };
}

/**
 * Builds a repository over a chosen IndexedDB implementation. The optional
 * factory exists so failure paths are provable in Node; production passes
 * nothing and gets the platform's `indexedDB`.
 */
export function createRepository(options?:{readonly indexedDB?:IDBFactory}):WorldRepository{
  const factory=options?.indexedDB??(globalThis as {indexedDB?:IDBFactory}).indexedDB;
  if(!factory)throw new Error("No IndexedDB implementation available");

  const openDb=():Promise<IDBDatabase>=>new Promise((resolve,reject)=>{
    const request=factory.open(DB_NAME,VERSION);
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE,{keyPath:"id"})};
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });

  const requestResult=<T,>(request:IDBRequest<T>):Promise<T>=>new Promise((resolve,reject)=>{
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });

  /** Resolves when the transaction is durably committed — not on request success. */
  const commit=(tx:IDBTransaction):Promise<void>=>new Promise((resolve,reject)=>{
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
    tx.onabort=()=>reject(tx.error??new Error("transaction aborted"));
  });

  return {
    async save(id:string,checkpoint:UniverseCheckpoint,anchors?:Record<number,ResolvedPhenotype>){
      const db=await openDb().catch((error)=>{throw asFailure("storage-write-failed",error)});
      try{
        const envelope:SaveEnvelope={
          envelopeVersion:SAVE_ENVELOPE_VERSION,
          id,
          savedAt:new Date().toISOString(),
          tick:checkpoint.createdTick,
          engineVersion:checkpoint.engineVersion,
          checkpoint,
          // phenotypeAnchors travels WITH the save record, never inside the
          // biological checkpoint: biology restores identically with or without it.
          phenotypeAnchors:anchors?sanitizeAnchors(anchors):undefined,
        };
        const tx=db.transaction(STORE,"readwrite");
        try{
          tx.objectStore(STORE).put(envelope);
          await commit(tx);
        }catch(error){
          // A failed overwrite leaves the PREVIOUS record committed and readable.
          // That is IndexedDB's own atomicity, preserved rather than reinvented.
          throw asFailure("storage-write-failed",error);
        }
        return{id:envelope.id,savedAt:envelope.savedAt,tick:envelope.tick,engineVersion:envelope.engineVersion};
      }finally{db.close()}
    },

    async readSlot(id:string){
      const db=await openDb().catch((error)=>{throw asFailure("storage-read-failed",error)});
      try{
        // ONE transaction, ONE get: the checkpoint and its adjuncts are the same
        // record generation by construction, not by timing luck.
        const raw=await requestResult(db.transaction(STORE,"readonly").objectStore(STORE).get(id))
          .catch((error)=>{throw asFailure("storage-read-failed",error)});
        if(raw===undefined||raw===null)return null;
        const {id:_id,...slot}=normalizeStoredRecord(raw);
        return slot;
      }finally{db.close()}
    },

    async load(id:string){
      const read=await this.readSlot(id);
      return read?read.checkpoint:null;
    },

    async list(){
      const db=await openDb().catch((error)=>{throw asFailure("storage-read-failed",error)});
      try{
        const records=await requestResult(db.transaction(STORE,"readonly").objectStore(STORE).getAll())
          .catch((error)=>{throw asFailure("storage-read-failed",error)});
        return records
          .map((raw)=>normalizeStoredRecord(raw))
          .map(({id:savedId,savedAt,tick,engineVersion})=>({id:savedId,savedAt,tick,engineVersion}))
          .sort((a,b)=>b.savedAt.localeCompare(a.savedAt));
      }finally{db.close()}
    },
  };
}

/** The shipped repository: the platform's IndexedDB, no injection. */
export class IndexedDbWorldRepository implements WorldRepository {
  readonly #inner:WorldRepository;
  constructor(options?:{readonly indexedDB?:IDBFactory}){
    this.#inner=createRepository(options);
  }
  save(id:string,checkpoint:UniverseCheckpoint,anchors?:Record<number,ResolvedPhenotype>){return this.#inner.save(id,checkpoint,anchors)}
  load(id:string){return this.#inner.load(id)}
  readSlot(id:string){return this.#inner.readSlot(id)}
  list(){return this.#inner.list()}
}