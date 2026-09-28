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

/**
 * Remove whole-line and trailing comments.
 *
 * Configuration and prose share a file, and a check that cannot tell them apart
 * forces one of them to be sacrificed. The workflow headers here document which
 * failure modes were designed out; that documentation has to be allowed to
 * mention the thing it removed.
 */
const stripComments = (source: string): string =>
  source
    .split("\n")
    .map((line) => {
      // A `#` inside a quoted string is not a comment (e.g. a colour or a shell
      // fragment), so only treat it as one when it is unquoted.
      let inSingle = false;
      let inDouble = false;
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i]!;
        if (ch === "'" && !inDouble) inSingle = !inSingle;
        else if (ch === '"' && !inSingle) inDouble = !inDouble;
        else if (ch === "#" && !inSingle && !inDouble) return line.slice(0, i);
      }
      return line;
    })
    .join("\n");

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
  const excluded = new Set(["survey", "browser", "evidence"]);
  // Platform groups are excluded by prefix rather than by exact name. Android
  // now has several routing groups (`android`, `android-apk`, `android-runtime`)
  // and an exact-name list would silently start folding platform units back into
  // `verify` the next time one is added.
  return GROUPS.filter((g) => !g.ci && !excluded.has(g.id) && !g.id.startsWith("android"))
    .flatMap((g) => [...g.unitIds]);
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
  for (const match of workflowText.matchAll(/ci:(?:group|shard)\s+([a-z0-9-]+)/g)) {
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

  // --- GitHub expression references must be addressable ------------------
  // A hyphen cannot appear in a `steps.<id>.outputs.<key>` or `needs.<id>`
  // dot-notation path. GitHub rejects the workflow file for it, and the symptom
  // is the whole run failing with zero jobs and a bare "likely failed because of
  // a workflow file issue" -- which does not name the offending line. Two of
  // these shipped in one attempt before a run caught it, so the check exists to
  // make the failure local and legible.
  for (const workflow of workflows) {
    for (const match of workflow.body.matchAll(/\b(steps|needs)\.([A-Za-z0-9_-]+)(\.outputs\.[A-Za-z0-9_.-]+)?/g)) {
      const [, kind, segment, tail] = match;
      if (segment.includes("-")) {
        const line = workflow.body.slice(0, match.index).split("\n").length;
        failures.push(
          `${workflow.name}:${line} references ${kind}.${segment}, whose hyphen cannot be addressed in dot notation; rename the id or use bracket syntax`,
        );
      }
      if (tail?.includes("-")) {
        const line = workflow.body.slice(0, match.index).split("\n").length;
        failures.push(
          `${workflow.name}:${line} output key ${tail.slice(".outputs.".length)} contains a hyphen and cannot be read as ${tail}`,
        );
      }
    }
  }

  // --- Platform evidence is a called workflow, not a cross-run lookup -----
  // Android used to trigger independently and locate the product run for its own
  // commit before packaging. That needed SHA inference, an authenticated `gh`,
  // and a poll, and it failed three separate ways in review -- each of which
  // looked fine in review and only broke in CI. Being a reusable workflow called
  // with `needs:` removes the mechanism, so the mechanisms are now forbidden
  // rather than merely absent: a future edit that reintroduces one of them is
  // reintroducing a known failure mode.
  const androidWorkflow = workflows.find((w) => w.name === "android.yml");
  const productWorkflow = workflows.find((w) => w.name === "product.yml");

  if (!androidWorkflow) {
    failures.push("android.yml is missing; the platform evidence class has no definition");
  } else {
    if (!/on:\s*\n\s+workflow_call:/.test(androidWorkflow.body)) {
      failures.push("android.yml must be callable (on: workflow_call) so it inherits the caller's DAG and artifact");
    }
    // Comments are stripped first. This file's own header explains which
    // mechanisms were removed and why, and a guard that cannot tell prose from
    // configuration would have to delete the explanation to pass.
    const androidExecutable = stripComments(androidWorkflow.body);
    for (const [pattern, what] of [
      [/gh run list/, "cross-workflow run lookup"],
      [/gh api/, "cross-workflow API lookup"],
      [/\brun-id:/, "an explicit run id, which only cross-run artifact handoff needs"],
      [/github-token:/, "a token, which only cross-run artifact handoff needs"],
    ] as const) {
      if (pattern.test(androidExecutable)) {
        failures.push(
          `android.yml uses ${what} (${pattern.source}); as a called workflow it must consume this run's artifacts directly`,
        );
      }
    }
  }

  if (!productWorkflow) {
    failures.push("product.yml is missing");
  } else if (!/uses:\s*\.\/\.github\/workflows\/android\.yml/.test(productWorkflow.body)) {
    failures.push("product.yml must call android.yml with `uses:` so platform evidence is gated by `needs`");
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
      if (!/ci:(?:group|shard)\s+[a-z0-9-]+/.test(job)) continue;
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
