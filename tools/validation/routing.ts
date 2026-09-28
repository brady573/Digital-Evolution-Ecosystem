/**
 * Impact-based CI routing.
 *
 * Decides which validation units a change actually requires, so a routine edit
 * does not pay for the whole validation graph. The decision is repository-owned
 * and unit tested rather than expressed as GitHub `paths:` filters, because a
 * path filter cannot express "unknown means more validation" and cannot be
 * tested without running a workflow.
 *
 * Two rules govern everything here:
 *
 *   1. A shard always exists and always resolves. Branch protection requires
 *      `sim-a`..`sim-d` and `telemetry` by name, so a change that affects
 *      nothing in a shard must still report that shard. It reports success with
 *      its units recorded as skipped, rather than disappearing.
 *
 *   2. The bias is one-directional. Skipping is only ever permitted when the
 *      classifier positively recognised the change and positively determined the
 *      unit unaffected. Anything unrecognised, missing, or unresolvable expands
 *      to the full set.
 */

import { GROUP_BY_ID, UNITS, UNIT_BY_ID, type ValidationUnit } from "./manifest.ts";
import { planImpact, type ImpactPlan } from "./impact.ts";

/** Why a unit ran, or did not. Recorded verbatim in telemetry. */
export type RoutingReason =
  /** The group is exempt from routing and always runs in full. */
  | "always"
  /** The classifier recognised the change and this unit is affected. */
  | "impact"
  /** The classifier recognised the change and this unit is unaffected. */
  | "skipped_impact"
  /** The change could not be classified, so everything runs. */
  | "fallback_broad"
  /** Included because a required unit depends on it. */
  | "dependency";

/**
 * Evidence classes that always run, whatever the change.
 *
 * Structural invariants are exempt rather than the whole fast shard. They answer
 * "is this repository coherent at all", which a change not worth any simulation
 * still needs. Exempting only the invariant units rather than the whole shard
 * also means a documentation-only pull request is not charged for `decisions`,
 * which is a behavioural check that happens to be scheduled early.
 */
export const UNROUTED_CLASSES: ReadonlySet<string> = new Set(["invariant"]);

export type ShardDecision = {
  readonly groupId: string;
  /** Units that will execute, in manifest order. */
  readonly run: readonly ValidationUnit[];
  /** Units deliberately not executed, with the reason each was skipped. */
  readonly skipped: ReadonlyArray<{ readonly unit: ValidationUnit; readonly reason: RoutingReason }>;
  /** True when the classifier could not classify the change. */
  readonly broadened: boolean;
};

/**
 * Close `required` over the manifest's `needs` edges.
 *
 * This is what stops a skipped `ci-build` from breaking a downstream lane: if
 * `browser-smoke` is required then `build` is required, because the browser lane
 * downloads the artifact the build job produces. Without this, impact routing
 * could select a browser run whose artifact does not exist.
 */
export const expandNeeds = (required: ReadonlySet<string>): Set<string> => {
  const out = new Set(required);
  let grew = true;
  while (grew) {
    grew = false;
    for (const id of [...out]) {
      for (const need of UNIT_BY_ID.get(id)?.needs ?? []) {
        if (!out.has(need)) {
          out.add(need);
          grew = true;
        }
      }
    }
  }
  return out;
};

/**
 * Decide what one shard executes.
 *
 * A unit that is in the shard and in the required set runs. A unit that is
 * neither required nor a dependency of something that is, does not. There is no
 * third case: a unit is never skipped for a reason other than the classifier
 * having positively cleared it.
 */
export const decideShard = (groupId: string, plan: ImpactPlan): ShardDecision => {
  const group = GROUP_BY_ID.get(groupId);
  if (!group) throw new Error(`unknown validation group: ${groupId}`);
  const units = group.unitIds.map((id) => UNIT_BY_ID.get(id)).filter((u): u is ValidationUnit => !!u);

  // A shard that cannot be classified runs in full. This is the conservative
  // branch and it is deliberately checked before anything can narrow it.
  if (plan.unknown) {
    return { groupId, run: units, skipped: [], broadened: true };
  }

  const required = expandNeeds(new Set(plan.unitIds));
  const run: ValidationUnit[] = [];
  const skipped: Array<{ unit: ValidationUnit; reason: RoutingReason }> = [];

  for (const unit of units) {
    if (UNROUTED_CLASSES.has(unit.cls)) {
      run.push(unit);
    } else if (required.has(unit.id)) {
      run.push(unit);
    } else {
      skipped.push({ unit, reason: "skipped_impact" });
    }
  }

  return { groupId, run, skipped, broadened: false };
};

/** Build the plan for a set of changed paths. */
export const planForPaths = (paths: readonly string[]): ImpactPlan =>
  planImpact({ units: UNITS, paths });

/**
 * The plan used when the change could not be determined at all.
 *
 * A missing or unresolvable base revision must never degrade to "no domains
 * matched, therefore nothing is required", which would skip everything. It has
 * to be explicitly unknown, which means everything runs.
 */
export const planBroad = (reason: string): ImpactPlan => ({
  domains: [],
  unknown: true,
  // Paused units are excluded here too: a missing base must run everything
  // that is runnable, and a paused lane is not runnable by policy.
  unitIds: UNITS.filter((u) => !u.paused).map((u) => u.id),
  reasons: [`${reason} -> running the full validation set`],
});

/**
 * The whole DAG's decision for one change, for reporting and for the self-tests.
 * Used by `pnpm validation:plan --impact` to show which shards a change class
 * actually costs, and by the tests that assert the routing table's behaviour.
 */
export const planForChange = (paths: readonly string[]): {
  plan: ImpactPlan;
  shards: ShardDecision[];
} => {
  const plan = planForPaths(paths);
  const shards = [...GROUP_BY_ID.values()].filter((g) => g.ci).map((g) => decideShard(g.id, plan));
  return { plan, shards };
};

/** Units that the plan runs across every shard, for telemetry and reporting. */
export const plannedUnitIds = (paths: readonly string[]): string[] => {
  const { shards } = planForChange(paths);
  return shards.flatMap((s) => s.run.map((u) => u.id));
};
