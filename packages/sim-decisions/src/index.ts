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
  CatalystContext,
  CatalystDiagnosis,
  CatalystId,
  CatalystOpportunity,
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
    source: "observed_event",
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

/** Engine modes this runtime can actually apply today. c_washout is
 * validation-internal (never offered, no button); support here only lets
 * assays apply it through the same recorded path. */
export const SUPPORTED_INTERVENTION_MODES: ReadonlySet<string> = new Set([
  "global_crash",
  "drought_a",
  "drought_b",
  "c_washout",
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
): "global" | "droughtA" | "droughtB" | "cWashout" {
  switch (spec.mode) {
    case "global_crash":
      return "global";
    case "drought_a":
      return "droughtA";
    case "drought_b":
      return "droughtB";
    case "c_washout":
      return "cWashout";
  }
}

/** Deterministic command id: same event + same choice + same policy => same id. */
export const decisionCommandIdFor = (
  opportunityId: string,
  choiceId: string,
  policyVersion: string,
): string => `dcmd:${opportunityId}:${choiceId}:${policyVersion}`;

/** Find a choice on an offered opportunity of either source, or null. */
export function findChoice(
  opportunity: { readonly choices: readonly DecisionChoice[] },
  choiceId: string,
): DecisionChoice | null {
  return opportunity.choices.find((choice) => choice.choiceId === choiceId) ?? null;
}

/** Test/inspection helper: the mapped policy keys in this version. */
export const mappedPolicyKeys = (): readonly string[] => Object.keys(REGISTRY).sort();

/* ------------------------------------------------------------------ *
 * M3 world catalysts: quiet-period environmental intervention windows.
 *
 * Same purity contract as the event policy: read-only evaluation of present
 * and historical world state. No RNG, no simulated futures, no lineage
 * inspection, no outcome prediction. A catalyst window is never an observed
 * biological event; it carries world_catalyst provenance end to end.
 * ------------------------------------------------------------------ */

/** Catalyst catalog version. Evolves independently of the event policy. */
export const CATALYST_POLICY_VERSION = "m3-catalysts-1.0.0";

/**
 * Game-policy constants (not biological rules). Centralized and versioned
 * here; report evidence before changing them, never silently retune.
 *
 * Stock floors face lived reality: surveyed universes graze field stocks to a
 * 1-15% equilibrium within a few thousand ticks in every config (balanced,
 * patchwork, harsh, abundant), so higher floors make catalysts effectively
 * unavailable. A drought's bite is regen suppression, which matters most
 * exactly when stocks are tight. Set with Owner approval from that evidence.
 */
export const CATALYST_QUIET_TICKS = 10_000;
export const MAJOR_CATALYST_COOLDOWN_TICKS = 25_000;
/** Order of the existing drought duration; cooldowns match it, not vice versa. */
export const CATALYST_MIN_ENERGY_SHARE = 0.15;
export const CATALYST_MIN_STOCK_FRACTION = 0.08;
export const CATALYST_MIN_ABIOTIC_FRACTION = 0.1;
export const CATALYST_MIN_POPULATION = 20;

interface CatalystSpec {
  readonly id: CatalystId;
  readonly title: string;
  readonly effect: string;
  readonly choiceId: string;
  readonly intervention: InterventionSpec;
}

/**
 * M3 v1 catalog, in deterministic offer order. Compound requirements are
 * explicit predicate conjunctions so later triggers can extend them without
 * changing the window architecture (no rules engine).
 */
const CATALYST_SPECS: readonly CatalystSpec[] = [
  {
    id: "drought-a",
    title: "Nutrient A drought",
    effect: "Reduce Nutrient A availability using the existing drought intervention.",
    choiceId: "drought-a",
    intervention: { schemaVersion: 1, kind: "nutrient_disturbance", mode: "drought_a" },
  },
  {
    id: "drought-b",
    title: "Nutrient B drought",
    effect: "Reduce Nutrient B availability using the existing drought intervention.",
    intervention: { schemaVersion: 1, kind: "nutrient_disturbance", mode: "drought_b" },
    choiceId: "drought-b",
  },
  {
    id: "global-crash",
    title: "Global nutrient crash",
    effect: "Reduce all nutrient availability using the existing global intervention.",
    intervention: { schemaVersion: 1, kind: "nutrient_disturbance", mode: "global_crash" },
    choiceId: "global-crash",
  },
];

/** Test/inspection helper: the v1 catalyst ids in offer order. */
export const catalystIds = (): readonly CatalystId[] => CATALYST_SPECS.map((s) => s.id);

type CatalystRequirement = (context: CatalystContext) => string | null;

const noDroughtActive: CatalystRequirement = (c) =>
  c.droughtActive ? "a drought is currently active" : null;

function minEnergyShare(which: "A" | "B"): CatalystRequirement {
  return (c) => {
    const share = which === "A" ? c.energyShareA : c.energyShareB;
    return share >= CATALYST_MIN_ENERGY_SHARE
      ? null
      : `Nutrient ${which} contributes ${(share * 100).toFixed(1)}% of realized energy (needs ${(CATALYST_MIN_ENERGY_SHARE * 100).toFixed(0)}%)`;
  };
}

function minStockFraction(which: "A" | "B"): CatalystRequirement {
  return (c) => {
    const fraction = which === "A" ? c.stockFractionA : c.stockFractionB;
    return fraction >= CATALYST_MIN_STOCK_FRACTION
      ? null
      : `Nutrient ${which} field stock is ${(fraction * 100).toFixed(1)}% of capacity (needs ${(CATALYST_MIN_STOCK_FRACTION * 100).toFixed(0)}%)`;
  };
}

const CATALYST_REQUIREMENTS: Readonly<Record<CatalystId, readonly CatalystRequirement[]>> = {
  "drought-a": [noDroughtActive, minEnergyShare("A"), minStockFraction("A")],
  "drought-b": [noDroughtActive, minEnergyShare("B"), minStockFraction("B")],
  "global-crash": [
    noDroughtActive,
    (c) =>
      c.abioticStockFraction >= CATALYST_MIN_ABIOTIC_FRACTION
        ? null
        : `abiotic stock is ${(c.abioticStockFraction * 100).toFixed(1)}% of capacity (needs ${(CATALYST_MIN_ABIOTIC_FRACTION * 100).toFixed(0)}%)`,
    (c) =>
      c.population >= CATALYST_MIN_POPULATION
        ? null
        : `living population is ${c.population} (needs ${CATALYST_MIN_POPULATION})`,
  ],
};

/**
 * Evaluate every catalyst against read-only world state. Pure and
 * deterministic: same context + same cooldown state => same diagnoses.
 * Consumes no RNG and touches no simulation state.
 */
export function diagnoseCatalysts(
  context: CatalystContext,
  majorCooldownClear: boolean,
): readonly CatalystDiagnosis[] {
  return CATALYST_SPECS.map((spec) => {
    const reasons: string[] = [];
    for (const requirement of CATALYST_REQUIREMENTS[spec.id]) {
      const failure = requirement(context);
      if (failure) reasons.push(failure);
    }
    if (!majorCooldownClear) reasons.push("major-catalyst cooldown has not elapsed");
    return { catalystId: spec.id, eligible: reasons.length === 0, reasons };
  });
}

export interface CatalystWindowInput {
  readonly tick: number;
  readonly lastDecisionTick: number;
  readonly lastMajorCatalystTick: number | null;
  readonly context: CatalystContext;
  readonly policyVersion?: string;
}

/**
 * Decide whether a catalyst window opens now. Returns null when quiet time
 * has not elapsed, the major cooldown blocks every otherwise-eligible
 * catalyst, or nothing is eligible (in which case the world simply continues;
 * requirements are never relaxed for waiting longer). No RNG.
 */
export function selectCatalystWindow(input: CatalystWindowInput): CatalystOpportunity | null {
  const policyVersion = input.policyVersion ?? CATALYST_POLICY_VERSION;
  if (input.tick - input.lastDecisionTick < CATALYST_QUIET_TICKS) return null;
  const cooldownClear = isMajorCooldownClear(input.tick, input.lastMajorCatalystTick);
  const diagnoses = diagnoseCatalysts(input.context, cooldownClear);
  const eligible = diagnoses.filter((d) => d.eligible).map((d) => d.catalystId);
  if (eligible.length === 0) return null;
  const choices: DecisionChoice[] = [
    {
      choiceId: "keep-watching",
      title: "Keep watching",
      directEffectDescription: "Change nothing. The world stays exactly as it is.",
      intervention: null,
      catalystId: null,
    },
  ];
  for (const id of eligible) {
    const spec = CATALYST_SPECS.find((s) => s.id === id)!;
    choices.push({
      choiceId: spec.choiceId,
      title: spec.title,
      directEffectDescription: spec.effect,
      intervention: spec.intervention,
      catalystId: spec.id,
    });
  }
  return {
    schemaVersion: 1,
    opportunityId: `wcat:${input.tick}`,
    policyVersion,
    source: "world_catalyst",
    catalystIds: eligible,
    createdTick: input.tick,
    status: "pending",
    prompt: "Change the environment?",
    context:
      "The world has been stable long enough for an intervention. " +
      "Current conditions make these options meaningful. Nothing natural is beginning; this is your move, not nature's.",
    contextSnapshot: { ...input.context },
    diagnoses,
    choices,
  };
}

/**
 * Whether a major catalyst may be offered at this tick. Exported so runtime
 * and validation share the rule instead of duplicating the constant logic.
 */
export function isMajorCooldownClear(tick: number, lastMajorCatalystTick: number | null): boolean {
  return lastMajorCatalystTick === null || tick - lastMajorCatalystTick >= MAJOR_CATALYST_COOLDOWN_TICKS;
}
