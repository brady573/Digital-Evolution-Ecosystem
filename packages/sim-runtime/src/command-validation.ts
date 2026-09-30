import type { RuntimeCommand } from "@digital-evolution/contracts";
import { MAX_SLICE_TICKS } from "./speed";

/**
 * Upper bound for RUN_TO_NEXT_EVENT, in ticks.
 *
 * This is the maintained existing default (session.runToNextEvent and
 * WorkerRuntimeClient.runToNextEvent both default to it), not an invented
 * limit and not a biological cap: it bounds one request, never the
 * simulation, and never a population.
 */
export const MAX_EVENT_SCAN_TICKS = 100_000;

export type CommandValidation =
  | { readonly ok: true; readonly command: RuntimeCommand }
  | { readonly ok: false; readonly message: string };

const reject = (message: string): CommandValidation => ({ ok: false, message });

/**
 * The cast below is earned, not a shortcut: every field this function checks
 * is the only way a value reaches the cast, and the switch is exhaustive over
 * the ten supported tags. A widening `any` here would defeat the purpose.
 */
const accept = (command: RuntimeCommand): CommandValidation => ({ ok: true, command });

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isIntegerIn = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;

const INTERVENTIONS = ["global", "droughtA", "droughtB"] as const;

/**
 * Validate an untrusted worker/runtime command payload.
 *
 * The worker boundary is a trust boundary: a payload arriving from it is
 * `unknown` in reality even though the transport type says otherwise. This
 * turns that reality into either a narrowed RuntimeCommand or a deterministic
 * structured rejection, so a malformed command cannot reach a simulation loop.
 *
 * It deliberately does NOT validate the interior of LOAD_CHECKPOINT.checkpoint.
 * That is A3.3's validateCheckpoint concern and runs inside restore(); a second
 * restore path would be a different, and forbidden, thing.
 */
export function validateRuntimeCommand(input: unknown): CommandValidation {
  if (!isObject(input)) return reject(`malformed command payload: expected an object, got ${JSON.stringify(input) ?? "undefined"}`);

  const type = input["type"];
  if (typeof type !== "string") {
    return reject(`malformed command payload: type must be a string, got ${JSON.stringify(type)}`);
  }

  switch (type) {
    case "CREATE_UNIVERSE": {
      if (!isObject(input["config"])) return reject("CREATE_UNIVERSE.config: expected an object");
      return accept(input as unknown as RuntimeCommand);
    }

    case "ADVANCE_TICKS": {
      const ticks = input["ticks"];
      if (!isIntegerIn(ticks, 0, MAX_SLICE_TICKS)) {
        return reject(`ADVANCE_TICKS.ticks: ${String(ticks)} is not an integer in [0, ${MAX_SLICE_TICKS}]`);
      }
      return accept(input as unknown as RuntimeCommand);
    }

    case "RUN_TO_NEXT_EVENT": {
      const maxTicks = input["maxTicks"];
      // Absent is accepted: runToNextEvent's own default already applies, and
      // that default is well-defined and in range.
      if (maxTicks !== undefined && !isIntegerIn(maxTicks, 1, MAX_EVENT_SCAN_TICKS)) {
        return reject(`RUN_TO_NEXT_EVENT.maxTicks: ${String(maxTicks)} is not an integer in [1, ${MAX_EVENT_SCAN_TICKS}]`);
      }
      return accept(input as unknown as RuntimeCommand);
    }

    case "APPLY_INTERVENTION": {
      const intervention = input["intervention"];
      if (!INTERVENTIONS.includes(intervention as (typeof INTERVENTIONS)[number])) {
        return reject(
          `APPLY_INTERVENTION.intervention: ${JSON.stringify(intervention)} is not one of ${JSON.stringify(INTERVENTIONS)}`,
        );
      }
      return accept(input as unknown as RuntimeCommand);
    }

    case "CREATE_CONTROL_FORK":
      return accept(input as unknown as RuntimeCommand);

    case "RESOLVE_EVENT_DECISION": {
      if (typeof input["opportunityId"] !== "string") {
        return reject("RESOLVE_EVENT_DECISION.opportunityId: expected a string");
      }
      if (typeof input["choiceId"] !== "string") {
        return reject("RESOLVE_EVENT_DECISION.choiceId: expected a string");
      }
      return accept(input as unknown as RuntimeCommand);
    }

    case "ACKNOWLEDGE_AFTERMATH":
      return accept(input as unknown as RuntimeCommand);

    case "LOAD_CHECKPOINT": {
      if (!isObject(input["checkpoint"])) return reject("LOAD_CHECKPOINT.checkpoint: expected an object");
      return accept(input as unknown as RuntimeCommand);
    }

    case "REQUEST_CHECKPOINT":
    case "REQUEST_EXPORT": {
      if (typeof input["requestId"] !== "string") {
        return reject(`${type}.requestId: expected a string`);
      }
      return accept(input as unknown as RuntimeCommand);
    }

    default:
      return reject(`unsupported command tag: ${JSON.stringify(type)}`);
  }
}
