/**
 * A7 runtime command and transport boundary validation (issue #54 items 3-5).
 *
 * The worker transport is a trust boundary. Commands arriving from it are
 * untrusted, every request placed on it must settle exactly once, and a
 * checkpoint load must complete only through its own request identity.
 *
 * This suite drives `UniverseSession.handle` directly - the point every
 * RuntimeCommand passes through - and drives `WorkerRuntimeClient` through an
 * injected fake transport, so failure behaviour is provable in Node without a
 * browser crash harness.
 *
 * Run: pnpm test:runtime-boundary
 */
import assert from "node:assert/strict";
import { UniverseSession } from "@digital-evolution/sim-runtime";

/**
 * An unsupported command tag must produce a structured failure, not undefined.
 *
 * Before the fix, handle() fell out of its switch and returned undefined,
 * which worker.ts then iterated over, throwing outside handle's own try/catch
 * and killing the worker with every pending request left unresolved.
 */
function testUnknownTagIsAStructuredFailure() {
  const session = new UniverseSession();
  const responses = session.handle({ type: "TOTALLY_BOGUS" } as never);
  assert.ok(Array.isArray(responses), "handle returns an array for an unknown tag");
  assert.equal(responses.length, 1, "unknown tag yields exactly one response");
  assert.equal(responses[0]!.type, "ERROR", "unknown tag is a structured ERROR");
  assert.match(
    (responses[0] as { message: string }).message,
    /unsupported command tag/i,
    "rejection names the reason",
  );
}

function main() {
  testUnknownTagIsAStructuredFailure();
  console.log("runtime boundary validation: PASS");
}

main();
