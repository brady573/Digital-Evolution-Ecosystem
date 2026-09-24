/**
 * M3 decision policy: a pure, read-only layer.
 *
 * It maps an ObservedEvent (what analysis already observed) to a
 * DecisionOpportunity (what the player may choose about). It never detects
 * events, never mutates simulation state, never advances time, never creates a
 * comparison world, never predicts outcomes, and never manufactures a choice for
 * an unmapped event. Unmapped events simply stay ordinary history.
 *
 * All identifiers are derived from the source event, so the same event under
 * the same policy always produces byte-identical output (deterministic replay).
 */
import type {
  DecisionChoice,
  DecisionContext,
  DecisionOpportunity,
  InterventionSpec,
  ObservedEvent,
} from "@digital-evolution/contracts";

/** Bump when the event->choice registry or its copy changes. */
export const DECISION_POLICY_VERSION = "m3-events-0.1.0";

const nutrientDisturbance = (
  mode: "global_crash" | "drought_a" | "drought_b",
): InterventionSpec => ({ schemaVersion: 1, kind: "nutrient_disturbance", mode });

/** Leave-unchanged is always offered and is always first. */
const keepWatching: DecisionChoice = {
  choiceId: "keep-watching",
  title: "Keep watching",
  directEffectDescription: "Change nothing. The world stays exactly as it is.",
  intervention: null,
};

type ChoiceFactory = (event: ObservedEvent, context: DecisionContext) => readonly DecisionChoice[];

interface EventPolicy {
  readonly buildChoices: ChoiceFactory;
  readonly prompt: (event: ObservedEvent) => string;
}

/**
 * Shared response palette: keep watching plus the three current nutrient
 * interventions, framed mechanically. Reused by every mapped formation event
 * so the catalog grows by registering event keys, not by duplicating choices.
 */
function nutrientResponseChoices(): readonly DecisionChoice[] {
  return [
    keepWatching,
    {
      choiceId: "drought-a",
      title: "Nutrient A drought",
      directEffectDescription: "Reduce Nutrient A availability using the existing drought intervention.",
      intervention: nutrientDisturbance("drought_a"),
    },
    {
      choiceId: "drought-b",
      title: "Nutrient B drought",
      directEffectDescription: "Reduce Nutrient B availability using the existing drought intervention.",
      intervention: nutrientDisturbance("drought_b"),
    },
    {
      choiceId: "global-crash",
      title: "Global nutrient crash",
      directEffectDescription: "Reduce all nutrient availability using the existing global intervention.",
      intervention: nutrientDisturbance("global_crash"),
    },
  ];
}

/**
 * Mapped events: durable formations the observer persists (persistence-gated
 * records), each a genuine moment of ecological change worth a decision.
 * Disrupted/recovered transitions stay ordinary history for now: mapping every
 * transition would nag the player on each swing, and that is catalog design,
 * not architecture.
 */
const REGISTRY: Readonly<Record<string, EventPolicy>> = {
  "crossfeeding:established": {
    prompt: (event) => `${event.title}. How do you want to respond?`,
    buildChoices: () => nutrientResponseChoices(),
  },
  "dormancy:established": {
    prompt: (event) => `${event.title}. How do you want to respond?`,
    buildChoices: () => nutrientResponseChoices(),
  },
  "era:established": {
    prompt: (event) => `${event.title}. How do you want to respond?`,
    buildChoices: () => nutrientResponseChoices(),
  },
};

/** Stable registry key for an observed event. */
export const policyKeyFor = (event: ObservedEvent): string => `${event.kind}:${event.phase}`;

/** Is this event decision-eligible under the current policy? */
export function isDecisionEligible(event: ObservedEvent): boolean {
  return Object.prototype.hasOwnProperty.call(REGISTRY, policyKeyFor(event));
}

/**
 * Build the opportunity for an eligible event, or null when the event is not
 * mapped. Deterministic: ids derive from the event and policy version only.
 */
export function buildDecisionOpportunity(
  event: ObservedEvent,
  context: DecisionContext,
  policyVersion: string = DECISION_POLICY_VERSION,
): DecisionOpportunity | null {
  const policy = REGISTRY[policyKeyFor(event)];
  if (!policy) return null;
  const choices = policy.buildChoices(event, context);
  if (choices.length === 0) return null;
  return {
    schemaVersion: 1,
    opportunityId: `dop:${event.eventId}`,
    policyVersion,
    sourceEventId: event.eventId,
    sourceArcId: event.arcId,
    createdTick: event.tick,
    status: "pending",
    prompt: policy.prompt(event),
    context: event.summary,
    contextSnapshot: { ...context },
    choices,
  };
}

/** Engine modes this runtime can actually apply today. */
export const SUPPORTED_INTERVENTION_MODES: ReadonlySet<string> = new Set([
  "global_crash",
  "drought_a",
  "drought_b",
]);

/** Validate a persisted spec against what the current engine/runtime supports. */
export function isSupportedIntervention(spec: InterventionSpec | null): boolean {
  if (spec === null) return true;
  if (spec.schemaVersion !== 1) return false;
  if (spec.kind !== "nutrient_disturbance") return false;
  return SUPPORTED_INTERVENTION_MODES.has(spec.mode);
}

/** Map the versioned spec onto the existing engine catalyst mode (no behavior change). */
export function engineCatalystModeFor(
  spec: InterventionSpec,
): "global" | "droughtA" | "droughtB" {
  switch (spec.mode) {
    case "global_crash":
      return "global";
    case "drought_a":
      return "droughtA";
    case "drought_b":
      return "droughtB";
  }
}

/** Deterministic command id: same event + same choice + same policy => same id. */
export const decisionCommandIdFor = (
  opportunityId: string,
  choiceId: string,
  policyVersion: string,
): string => `dcmd:${opportunityId}:${choiceId}:${policyVersion}`;

/** Find a choice on an offered opportunity, or null when absent. */
export function findChoice(
  opportunity: DecisionOpportunity,
  choiceId: string,
): DecisionChoice | null {
  return opportunity.choices.find((choice) => choice.choiceId === choiceId) ?? null;
}

/** Test/inspection helper: the mapped policy keys in this version. */
export const mappedPolicyKeys = (): readonly string[] => Object.keys(REGISTRY).sort();
