import { createWorkerTransport, type WorkerLike } from "./client";

/**
 * Test-only transport wrapper (?deeTest only; never instantiated in
 * production). Wraps a real worker transport, records the client's
 * error/messageerror listeners as they register, and replays a synthetic
 * failure through them — driving the same registered-listener path as a real
 * worker failure, with no kill seam on the production client class.
 *
 * Test-only: never part of the production contract.
 */
export class InstrumentedTransport implements WorkerLike{
  #inner:WorkerLike;
  #listeners=new Map<"message"|"error"|"messageerror",Array<(event:never)=>void>>();
  constructor(inner:WorkerLike){this.#inner=inner}
  postMessage(message:unknown):void{this.#inner.postMessage(message)}
  terminate():void{this.#inner.terminate()}
  addEventListener(type:"message"|"error"|"messageerror",listener:(event:never)=>void):void{
    const existing=this.#listeners.get(type)??[];
    existing.push(listener);
    this.#listeners.set(type,existing);
    this.#inner.addEventListener(type,listener);
  }
  /** Replay a synthetic transport failure through the recorded listeners. */
  fail(kind:"error"|"messageerror"):void{
    for(const listener of this.#listeners.get(kind)??[]){
      (listener as (event:unknown)=>void)({message:`simulated ${kind} failure for test`,kind});
    }
  }
}

/**
 * Test-only factory (?deeTest only). Owns real `Worker` construction through
 * the canonical client factory, so Explorer never names the worker
 * implementation path and the construction expression cannot drift apart.
 *
 * Test-only: never part of the production contract.
 */
export function createInstrumentedTransport():{transport:WorkerLike;fail:(kind:"error"|"messageerror")=>void}{
  const instrumented=new InstrumentedTransport(createWorkerTransport());
  return{transport:instrumented,fail:(kind)=>instrumented.fail(kind)};
}
