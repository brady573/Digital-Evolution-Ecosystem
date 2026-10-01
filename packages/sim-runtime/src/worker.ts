/// <reference lib="webworker" />
import type { RuntimeCommand, RuntimeResponse } from "@digital-evolution/contracts";
import { UniverseSession } from "./session";

const session=new UniverseSession();
const scope=self as DedicatedWorkerGlobalScope;

scope.onmessage=(event:MessageEvent<RuntimeCommand>)=>{
  const responses=session.handle(event.data);
  // Read-model-only forwarding: one loop posts every response with no
  // per-type branch, so a new frame class needs no transport change here.
  for(const response of responses)scope.postMessage(response satisfies RuntimeResponse);
};
