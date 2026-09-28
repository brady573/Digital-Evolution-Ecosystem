/**
 * Architecture drift gate.
 *
 * Proves that the manifest, the local `verify` command, and the CI workflows
 * cannot drift apart. This is the check that makes the whole design hold: a new
 * blocking unit cannot be added to the manifest and quietly fail to run in CI,
 * and CI cannot quietly run something `verify` does not.
 *
 * It is pure and side-effect free so `tools/validation/validation-arch.ts` can
 * test it directly.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { GROUPS, GROUP_BY_ID, UNITS, UNIT_BY_ID } from "./manifest.ts";

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const WORKFLOWS_DIR = join(REPO_ROOT, ".github/workflows");

export interface CheckResult {
  readonly failures: readonly string[];
  readonly notes: readonly string[];
}

const packageScripts = (): Set<string> => {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  return new Set(Object.keys(pkg.scripts ?? {}));
};

const readWorkflows = (): Array<{ name: string; body: string }> =>
  readdirSync(WORKFLOWS_DIR)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .map((f) => ({ name: f, body: readFileSync(join(WORKFLOWS_DIR, f), "utf8") }));

/** Units a CI run must execute: everything that is not manual-only science. */
export const requiredCiUnits = (): string[] =>
  UNITS.filter((u) => u.enforcement !== "manual").map((u) => u.id);

/**
 * The local completion contract, derived from the non-shard groups.
 *
 * `android`, `survey`, `browser`, and `evidence` are excluded by construction:
 * each needs a different environment, so folding them into `verify` would be an
 * evidence-class substitution dressed up as convenience.
 */
export const verifyFromManifest = (): string[] => {
  const excluded = new Set(["android", "survey", "browser", "evidence"]);
  return GROUPS.filter((g) => !g.ci && !excluded.has(g.id)).flatMap((g) => [...g.unitIds]);
};

export function checkArchitecture(): CheckResult {
  const failures: string[] = [];
  const notes: string[] = [];
  const scripts = packageScripts();

  // --- Unit integrity ------------------------------------------------------
  const seen = new Set<string>();
  for (const unit of UNITS) {
    if (seen.has(unit.id)) failures.push(`duplicate unit id: ${unit.id}`);
    seen.add(unit.id);
    if (unit.script !== null && !scripts.has(unit.script)) {
      failures.push(`unit ${unit.id} names script "${unit.script}", which is absent from package.json`);
    }
    if (unit.enforcement === "blocking" && unit.script === null && unit.cls !== "platform") {
      failures.push(`unit ${unit.id} is blocking but has no runnable script and is not a platform unit`);
    }
    if (unit.enforcement !== "blocking" && unit.cls === "invariant") {
      failures.push(`invariant unit ${unit.id} must block; a non-gating structural check is not a gate`);
    }
  }

  // --- Group integrity -----------------------------------------------------
  const groupIds = new Set<string>();
  for (const group of GROUPS) {
    if (groupIds.has(group.id)) failures.push(`duplicate group id: ${group.id}`);
    groupIds.add(group.id);
    for (const id of group.unitIds) {
      if (!UNIT_BY_ID.has(id)) failures.push(`group ${group.id} references unknown unit: ${id}`);
    }
  }

  const workflows = readWorkflows();
  const workflowText = workflows.map((w) => `${w.name}\n${w.body}`).join("\n");

  // A workflow running `pnpm verify` or a bare unit script is exactly the
  // duplication this architecture exists to remove. The Android job used to do
  // the former; this makes it impossible to reintroduce silently.
  for (const w of workflows) {
    if (/run:[^\n]*\bpnpm verify\b/.test(w.body)) {
      failures.push(`${w.name} runs \`pnpm verify\` directly; invoke \`pnpm ci:group <shard>\` so the shard list comes from the manifest`);
    }
    if (/run:[^\n]*\bpnpm (test:[a-z-]+|typecheck|build)\s*$/.test(w.body)) {
      failures.push(`${w.name} invokes a validation script directly instead of through \`pnpm ci:group\``);
    }
  }

  // --- What CI actually executes ------------------------------------------
  const referencedShards = new Map<string, number>();
  for (const match of workflowText.matchAll(/ci:group\s+([a-z0-9-]+)/g)) {
    const id = match[1]!;
    referencedShards.set(id, (referencedShards.get(id) ?? 0) + 1);
  }

  const covered = new Set<string>();
  for (const [shardId] of referencedShards) {
    const shard = GROUP_BY_ID.get(shardId);
    if (!shard) {
      failures.push(`a workflow invokes unknown shard: ${shardId}`);
      continue;
    }
    if (!shard.ci) {
      failures.push(`shard ${shardId} is not a CI shard; workflows must reference ci-* shards`);
    }
    for (const id of shard.unitIds) covered.add(id);
  }

  // Platform units are invoked by CI step marker rather than by shard. The
  // marker is a comment form so it cannot collide with a script invocation such
  // as `pnpm validation:merge`.
  for (const match of workflowText.matchAll(/#\s*validation-unit:\s*([a-z0-9-]+)/g)) {
    const id = match[1]!;
    if (!UNIT_BY_ID.has(id)) {
      failures.push(`a workflow step is marked validation:${id}, which is not a manifest unit`);
      continue;
    }
    covered.add(id);
  }

  for (const id of requiredCiUnits()) {
    if (!covered.has(id)) failures.push(`CI does not execute required unit: ${id}`);
  }

  // Exactly-once: a unit in two shards is the second execution that proves
  // nothing new. This is the mechanical form of the design's core rule. It
  // applies to the groups `verify` composes as well as to the CI shards, because
  // `verify` runs its groups in sequence on one machine and a unit listed twice
  // would be executed twice for the same claim.
  const nonShardGroups = GROUPS.filter((g) => !g.ci);
  for (const [label, groups] of [
    ["CI shard", GROUPS.filter((g) => g.ci)],
    ["group", nonShardGroups],
  ] as const) {
    const seen = new Map<string, string[]>();
    for (const group of groups) {
      for (const id of group.unitIds) {
        seen.set(id, [...(seen.get(id) ?? []), group.id]);
      }
    }
    for (const [id, owners] of seen) {
      if (owners.length > 1) {
        failures.push(`unit ${id} is in multiple ${label}s (${owners.join(", ")}); it would execute more than once`);
      }
    }
  }

  for (const group of GROUPS) {
    if (group.ci && !referencedShards.has(group.id)) {
      failures.push(`CI shard ${group.id} is never referenced by a workflow (dead shard)`);
    }
  }
  for (const [shardId, count] of referencedShards) {
    if (count > 1) failures.push(`shard ${shardId} is invoked by ${count} workflow steps; a shard runs once`);
  }

  // --- verify derives from the manifest ------------------------------------
  const verifySet = new Set(verifyFromManifest());
  const contract = new Set(
    UNITS.filter(
      (u) =>
        u.enforcement === "blocking" &&
        u.script !== null &&
        (u.cls === "invariant" || u.cls === "deterministic" || u.cls === "presentation"),
    ).map((u) => u.id),
  );
  for (const id of contract) {
    if (!verifySet.has(id)) failures.push(`verify omits blocking repository unit: ${id} (add it to a non-shard group)`);
  }
  for (const id of verifySet) {
    if (!contract.has(id)) failures.push(`verify runs ${id}, which is not part of the blocking repository contract`);
  }
  for (const id of verifySet) {
    const unit = UNIT_BY_ID.get(id);
    if (unit && unit.cls !== "invariant" && unit.cls !== "deterministic" && unit.cls !== "presentation") {
      failures.push(`verify includes a ${unit.cls} unit (${id}); that evidence class needs a different environment`);
    }
  }

  // --- The fast gate means the same thing locally and in CI ----------------
  // `verify:fast` and the CI `quick` job are the same promise to two audiences:
  // "you will know quickly whether this is broken". If the CI shard quietly
  // carried a check the local gate did not, one of the two would be lying, and
  // which one would depend on which file someone edited.
  const localFast = GROUPS.find((g) => g.id === "fast");
  const ciFast = GROUPS.find((g) => g.id === "ci-fast");
  if (!localFast || !ciFast) {
    failures.push("the manifest must define both a `fast` group and a `ci-fast` shard");
  } else {
    const local = new Set(localFast.unitIds);
    for (const id of ciFast.unitIds) {
      if (!local.has(id)) failures.push(`CI fast shard runs ${id}, which \`verify:fast\` does not`);
    }
    for (const id of local) {
      if (!ciFast.unitIds.includes(id)) failures.push(`\`verify:fast\` runs ${id}, which the CI fast shard does not`);
    }
  }

  // --- Every shard lane must report its cost ------------------------------
  // A job that runs a shard but never uploads a summary is invisible in the
  // merged telemetry: its units show as skipped and its cost as zero. The build
  // lane was missing this and nothing failed, because nothing was checking. The
  // cost data is the input to rebalancing, so a lane that does not report it is
  // a defect, not a cosmetic gap.
  for (const workflow of workflows) {
    const jobs = workflow.body.split(/\n {2}(?=[a-z0-9-]+:\s*\n)/);
    for (const job of jobs) {
      if (!/ci:group\s+[a-z0-9-]+/.test(job)) continue;
      const name = job.split("\n")[0]!.replace(/:\s*$/, "").trim();
      if (!/validation-summary-/.test(job)) {
        failures.push(`${workflow.name} job "${name}" runs a shard but uploads no validation-summary, so its cost is invisible`);
      }
    }
  }

  // --- Declared needs must name real units --------------------------------
  for (const unit of UNITS) {
    for (const need of unit.needs) {
      if (!UNIT_BY_ID.has(need)) failures.push(`unit ${unit.id} needs unknown unit: ${need}`);
    }
  }

  return { failures, notes };
}
