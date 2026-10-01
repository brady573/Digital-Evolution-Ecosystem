/// <reference lib="webworker" />
import type { RuntimeCommand, RuntimeResponse } from "@digital-evolution/contracts";
import { UniverseSession } from "./session";

const session=new UniverseSession();
const scope=self as DedicatedWorkerGlobalScope;

scope.onmessage=(event:MessageEvent<RuntimeCommand>)=>{
  const responses=session.handle(event.data);
  // Lane 3 migration: compat — one loop forwards legacy and PRESENTATION
  // responses alike, with no per-type branch, so a new frame class needs no
  // transport change here. Legacy SNAPSHOT flow is untouched.
  for(const response of responses)scope.postMessage(response satisfies RuntimeResponse);
};
