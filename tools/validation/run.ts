/**
 * Validation runner CLI.
 *
 * Everything that executes repository validation goes through here, so the local
 * completion command, the CI shards, the drift gate, and the telemetry all read
 * the same canonical definition in `manifest.ts`.
 *
 *   tsx tools/validation/run.ts verify            # the repository contract
 *   tsx tools/validation/run.ts group ci-sim-a    # one CI shard
 *   tsx tools/validation/run.ts check             # drift + invariant gate
 *   tsx tools/validation/run.ts plan [--json]     # derived plan
 *   tsx tools/validation/run.ts impact <paths>    # what a diff requires
 *
 * `verify` is intentionally one sequential pass. Local developers want a single
 * clear first failure and one readable log; parallelism belongs in the CI DAG,
 * where each shard is a separate runner. Splitting them would trade the local
 * experience for a speedup nobody local is waiting for.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { GROUPS, GROUP_BY_ID, UNITS, UNIT_BY_ID, groupBaselineSeconds, unitsOf } from "./manifest.ts";
import { REPO_ROOT, checkArchitecture } from "./architecture.ts";
import { planImpact } from "./impact.ts";
import { UNROUTED_CLASSES, decideShard, planBroad, planForChange, planForPaths } from "./routing.ts";

/**
 * Telemetry lives outside `testdata/`, which holds committed scientific evidence
 * that a run must never overwrite. A run byproduct is not evidence.
 */
const TELEMETRY_DIR = join(REPO_ROOT, "validation-telemetry");
const TELEMETRY_FILE = join(TELEMETRY_DIR, "summary.json");

// --- Telemetry ---------------------------------------------------------------

export interface UnitRecord {
  readonly id: string;
  readonly cls: string;
  readonly enforcement: string;
  readonly group: string;
  readonly executed: boolean;
  readonly status: "pass" | "fail" | "skipped";
  readonly durationMs: number;
  readonly baselineSeconds?: number;
  readonly skipReason?: string;
  /**
   * Why this unit did or did not run. `always` for an unrouted group, `impact`
   * when the classifier selected it, `skipped_impact` when the classifier
   * positively cleared it, `fallback_broad` when the change could not be
   * classified. This is the field that answers "did this shard run, was it
   * routed away, or did it fall back to broad execution".
   */
  readonly routing?: string;
}

export interface RunSummary {
  readonly schema: 1;
  readonly commit: string;
  readonly runner: string;
  readonly validation: readonly UnitRecord[];
}

const currentCommit = (): string => {
  const fromEnv = process.env.GITHUB_SHA;
  if (fromEnv) return fromEnv;
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "unknown";
};

/**
 * Merge this invocation's records into the run summary.
 *
 * Merge rather than overwrite: the summary is assembled from several runners,
 * one per shard, and a later shard must not erase what an earlier one proved.
 * Keyed by unit id and by commit, so a re-run replaces only its own record and
 * a stale summary from a different revision is discarded rather than trusted.
 */
function writeTelemetry(records: readonly UnitRecord[]): void {
  let existing: RunSummary | undefined;
  if (existsSync(TELEMETRY_FILE)) {
    try {
      existing = JSON.parse(readFileSync(TELEMETRY_FILE, "utf8")) as RunSummary;
    } catch {
      existing = undefined;
    }
  }

  const commit = currentCommit();
  const merged = new Map<string, UnitRecord>();
  if (existing?.schema === 1 && existing.commit === commit) {
    for (const record of existing.validation) merged.set(record.id, record);
  }
  for (const record of records) merged.set(record.id, record);

  const summary: RunSummary = {
    schema: 1,
    commit,
    runner: process.env.GITHUB_RUN_ID ?? "local",
    validation: [...merged.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };

  mkdirSync(TELEMETRY_DIR, { recursive: true });
  writeFileSync(TELEMETRY_FILE, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
}

// --- Execution ---------------------------------------------------------------

const runCommand = (script: string): { ok: boolean; durationMs: number } => {
  const started = process.hrtime.bigint();
  const result = spawnSync("pnpm", [script], { cwd: REPO_ROOT, stdio: "inherit" });
  const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
  if (result.error) {
    console.error(`\n[${script}] could not start: ${result.error.message}`);
    return { ok: false, durationMs };
  }
  return { ok: result.status === 0, durationMs };
}

/**
 * Execute one group in order, stopping at the first failing blocking unit.
 *
 * Non-blocking evidence units never stop the group and never fail the command.
 * They exist so a human can look at something. Their failure is still recorded
 * in telemetry and still printed, so it is visible rather than silently dropped.
 */
export function runGroup(groupId: string, dryRun = false): number {
  const units = unitsOf(groupId);
  const records: UnitRecord[] = [];
  let failed = false;

  if (dryRun) {
    for (const unit of units) {
      console.log(`- ${unit.id.padEnd(23)} ${unit.cls.padEnd(14)} ${unit.script ?? "(CI step only)"}`);
    }
    console.log(`\ndry run: ${units.length} units in ${groupId}, nothing executed.`);
    return 0;
  }

  console.log(`\n=== validation group: ${groupId} (${units.length} units) ===`);

  for (const unit of units) {
    if (unit.script === null) {
      // Platform units need an Android environment, so there is nothing honest
      // to run here. Saying so beats exiting green on a check that never ran.
      records.push({
        id: unit.id,
        cls: unit.cls,
        enforcement: unit.enforcement,
        group: groupId,
        executed: false,
        status: "skipped",
        durationMs: 0,
        baselineSeconds: unit.baselineSeconds,
        skipReason: "platform unit: requires a configured Android environment",
      });
      console.log(`- ${unit.id}: skipped (${unit.cls} unit, needs the Android toolchain)`);
      continue;
    }

    console.log(`\n- ${unit.id}: ${unit.title}`);
    const { ok, durationMs } = runCommand(unit.script);
    records.push({
      id: unit.id,
      cls: unit.cls,
      enforcement: unit.enforcement,
      group: groupId,
      executed: true,
      status: ok ? "pass" : "fail",
      durationMs: Math.round(durationMs),
      baselineSeconds: unit.baselineSeconds,
    });
    const baseline = unit.baselineSeconds ? `, baseline ${unit.baselineSeconds}s` : "";
    console.log(`  ${ok ? "pass" : "FAIL"} in ${(durationMs / 1000).toFixed(1)}s${baseline}`);

    if (!ok) {
      if (unit.enforcement === "blocking") {
        failed = true;
        break;
      }
      console.log(`  note: ${unit.id} is non-blocking evidence; continuing.`);
    }
  }

  // Units this group did not reach, so "executed vs skipped" is answerable from
  // the summary alone without cross-referencing the workflow.
  for (const unit of UNITS) {
    if (records.some((r) => r.id === unit.id)) continue;
    records.push({
      id: unit.id,
      cls: unit.cls,
      enforcement: unit.enforcement,
      group: groupId,
      executed: false,
      status: "skipped",
      durationMs: 0,
      baselineSeconds: unit.baselineSeconds,
      skipReason:
        unit.enforcement === "manual"
          ? "manual scientific evidence: run on demand, never in a blocking pass"
          : `not part of group ${groupId}`,
    });
  }

  writeTelemetry(records);
  return failed ? 1 : 0;
}

// --- Cross-runner merge ------------------------------------------------------

/** Every `*.json` under a directory, one level of nesting deep. */
const jsonFilesUnder = (dir: string): string[] => {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      for (const nested of readdirSync(full)) {
        if (nested.endsWith(".json")) out.push(join(full, nested));
      }
    } else if (entry.endsWith(".json")) {
      out.push(full);
    }
  }
  return out;
};

/**
 * Combine every runner's summary into one file.
 *
 * The summaries are produced on separate runners, so the run's picture is only
 * complete once they are joined. Two invariants matter more than convenience
 * here: a summary from a different commit is discarded rather than merged, and a
 * unit that appears twice keeps the record from the run that actually executed
 * it. Otherwise a stale cached artifact could quietly stand in for evidence
 * about the current source.
 */
const mergeSummaries = (dir: string): number => {
  const files = jsonFilesUnder(resolve(dir));
  if (files.length === 0) {
    console.error(`no validation summaries found under ${dir}`);
    return 1;
  }

  const byCommit = new Map<string, Map<string, UnitRecord>>();
  for (const file of files) {
    let summary: RunSummary;
    try {
      summary = JSON.parse(readFileSync(file, "utf8")) as RunSummary;
    } catch {
      console.warn(`skipping unreadable summary: ${file}`);
      continue;
    }
    if (summary?.schema !== 1 || !Array.isArray(summary.validation)) continue;
    let bucket = byCommit.get(summary.commit);
    if (!bucket) {
      bucket = new Map();
      byCommit.set(summary.commit, bucket);
    }
    for (const record of summary.validation) {
      // Prefer a record that actually executed over a placeholder skip.
      const existing = bucket.get(record.id);
      if (!existing || (record.executed && !existing.executed)) bucket.set(record.id, record);
    }
  }

  // One commit per run in practice. If several are present, the one with the
  // most executed units is the live one; the rest are reported, not merged.
  const ranked = [...byCommit.entries()].sort(
    (a, b) => b[1].size - a[1].size || b[0].localeCompare(a[0]),
  );
  if (ranked.length === 0) {
    console.error(`no valid validation summaries found under ${dir}`);
    return 1;
  }
  const [commit, records] = ranked[0]!;
  for (const [otherCommit] of ranked.slice(1)) {
    console.warn(`ignoring summary for a different commit: ${otherCommit}`);
  }

  const validation = [...records.values()].sort((a, b) => a.id.localeCompare(b.id));
  const summary: RunSummary = { schema: 1, commit, runner: "merged", validation };
  mkdirSync(TELEMETRY_DIR, { recursive: true });
  writeFileSync(TELEMETRY_FILE, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  const executed = validation.filter((r) => r.executed);
  const totalMs = executed.reduce((sum, r) => sum + r.durationMs, 0);
  console.log(`merged ${files.length} summaries for ${commit.slice(0, 7)}`);
  console.log(`  executed: ${executed.length}/${validation.length} units, ${(totalMs / 1000).toFixed(1)}s of measured work\n`);
  console.log(`  ${"unit".padEnd(24)} ${"class".padEnd(14)} ${"status".padEnd(7)} ${"measured".padStart(9)} ${"baseline".padStart(9)}`);
  for (const record of validation) {
    const measured = record.executed ? `${(record.durationMs / 1000).toFixed(1)}s` : "-";
    const baseline = record.baselineSeconds !== undefined ? `${record.baselineSeconds}s` : "-";
    console.log(
      `  ${record.id.padEnd(24)} ${record.cls.padEnd(14)} ${record.status.padEnd(7)} ${measured.padStart(9)} ${baseline.padStart(9)}` +
        (record.skipReason ? `   (${record.skipReason})` : ""),
    );
  }
  return 0;
};


// --- Impact routing -----------------------------------------------------------

/**
 * The files this change touches, or `undefined` when that cannot be determined.
 *
 * Returning `undefined` is the safe direction: the caller widens to the full
 * validation set. An empty list would be catastrophic here, because "no domains
 * matched" reads as "nothing is required".
 */
const changedFiles = (): string[] | undefined => {
  const base = process.env.DEE_IMPACT_BASE;
  if (!base) return undefined;
  if (/^0+$/.test(base.trim())) return undefined; // first push on a branch
  const result = spawnSync("git", ["diff", "--name-only", `${base.trim()}...HEAD`], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) return undefined;
  const files = result.stdout.split("\n").map((f) => f.trim()).filter(Boolean);
  return files.length > 0 ? files : undefined;
};

/**
 * Execute one shard under impact routing.
 *
 * The shard always reports. If routing selects nothing, the job succeeds with
 * every unit recorded as `skipped_impact`, because branch protection requires
 * this check by name and a check that vanishes is worse than a check that says
 * "nothing to do".
 */
export const runShard = (groupId: string): number => {
  const files = changedFiles();
  const plan = files
    ? planForPaths(files)
    : planBroad("could not determine the changed files for this run");
  const decision = decideShard(groupId, plan);

  console.log(`\n=== validation shard: ${groupId} ===`);
  if (plan.unknown) {
    console.log(`impact routing: FALLBACK BROAD -- ${plan.reasons.join("; ")}`);
  } else {
    console.log(`impact routing: domains ${plan.domains.join(", ") || "(none)"}`);
  }
  if (decision.broadened) {
    console.log(`  every unit runs: the change could not be classified`);
  }
  for (const { unit, reason } of decision.skipped) {
    console.log(`  skip ${unit.id} (${reason})`);
  }
  if (decision.run.length === 0) {
    console.log(`  nothing to execute in this shard for this change`);
  }

  const records: UnitRecord[] = [];

  for (const { unit } of decision.skipped) {
    records.push({
      id: unit.id,
      cls: unit.cls,
      enforcement: unit.enforcement,
      group: groupId,
      executed: false,
      status: "skipped",
      durationMs: 0,
      baselineSeconds: unit.baselineSeconds,
      skipReason: "not affected by this change",
      routing: "skipped_impact",
    });
  }

  for (const unit of decision.run) {
    if (unit.script === null) {
      records.push({
        id: unit.id,
        cls: unit.cls,
        enforcement: unit.enforcement,
        group: groupId,
        executed: false,
        status: "skipped",
        durationMs: 0,
        baselineSeconds: unit.baselineSeconds,
        skipReason: "platform unit: requires a configured Android environment",
        routing: decision.broadened ? "fallback_broad" : UNROUTED_CLASSES.has(unit.cls) ? "always" : "impact",
      });
      continue;
    }
    console.log(`\n- ${unit.id}: ${unit.title}`);
    const { ok, durationMs } = runCommand(unit.script);
    records.push({
      id: unit.id,
      cls: unit.cls,
      enforcement: unit.enforcement,
      group: groupId,
      executed: true,
      status: ok ? "pass" : "fail",
      durationMs: Math.round(durationMs),
      baselineSeconds: unit.baselineSeconds,
      routing: decision.broadened ? "fallback_broad" : UNROUTED_CLASSES.has(unit.cls) ? "always" : "impact",
    });
    const baseline = unit.baselineSeconds ? `, baseline ${unit.baselineSeconds}s` : "";
    console.log(`  ${ok ? "pass" : "FAIL"} in ${(durationMs / 1000).toFixed(1)}s${baseline}`);
    if (!ok) {
      if (unit.enforcement === "blocking") {
        writeTelemetry(records);
        return 1;
      }
      console.log(`  note: ${unit.id} is non-blocking evidence; continuing.`);
    }
  }

  writeTelemetry(records);
  return 0;
};

// --- Reporting ---------------------------------------------------------------

const printPlan = (asJson: boolean): void => {
  if (asJson) {
    console.log(
      JSON.stringify(
        {
          schema: 1 as const,
          units: UNITS.map((u) => ({
            id: u.id,
            cls: u.cls,
            enforcement: u.enforcement,
            script: u.script,
            domains: u.domains,
            needs: u.needs,
            baselineSeconds: u.baselineSeconds ?? null,
            claim: u.claim,
          })),
          groups: GROUPS.map((g) => ({
            id: g.id,
            title: g.title,
            ci: g.ci,
            unitIds: g.unitIds,
            baselineSeconds: groupBaselineSeconds(g.id),
          })),
        },
        null,
        2,
      ),
    );
    return;
  }

  const byClass = new Map<string, typeof UNITS>();
  for (const unit of UNITS) byClass.set(unit.cls, [...(byClass.get(unit.cls) ?? []), unit]);
  console.log("Canonical validation manifest\n");
  for (const [cls, units] of byClass) {
    console.log(`${cls}:`);
    for (const unit of units) {
      const base = unit.baselineSeconds !== undefined ? `${unit.baselineSeconds}s` : "-";
      console.log(`  ${unit.id.padEnd(23)} ${unit.enforcement.padEnd(9)} ${base.padStart(6)}  ${unit.claim}`);
    }
    console.log("");
  }
  console.log("CI shards (measured baseline seconds):");
  for (const group of GROUPS) {
    if (!group.ci) continue;
    // A shard with unmeasured units must not read as a cheap shard. Showing the
    // count of unknowns is the difference between "this is fast" and "we have
    // not measured this yet".
    const unmeasured = group.unitIds.filter((id) => UNIT_BY_ID.get(id)?.baselineSeconds === undefined).length;
    const measured = `${groupBaselineSeconds(group.id)}s`;
    const pending = unmeasured > 0 ? ` +${unmeasured} unmeasured` : "";
    console.log(`  ${group.id.padEnd(16)} ${measured.padStart(9)}${pending}  ${group.unitIds.join(", ")}`);
  }
};

const usage = (): void => {
  console.error(
    [
      "usage:",
      "  run.ts verify              run the blocking repository contract",
      "  run.ts group <id> [...]    run one or more validation groups (--dry-run to list)",
      "  run.ts ci <shard>          run a CI shard under impact routing",
      "  run.ts plan <shard>        report whether a shard has work, for conditional inputs",
      "  run.ts check               drift and invariant gate",
      "  run.ts plan [--json]       print the derived validation plan",
      "  run.ts merge <dir>         combine per-runner summaries into one",
      "  run.ts impact <path> ...   print what a diff requires",
      "  run.ts graph <path> ...    show which shards a change class would run",
    ].join("\n"),
  );
};

const main = (): number => {
  const [command, ...rest] = process.argv.slice(2);
  const dryRun = rest.includes("--dry-run");
  const args = rest.filter((a) => a !== "--dry-run");

  switch (command) {
    case "verify": {
      // The canonical blocking repository contract, in class order so the
      // cheapest structural failures surface first.
      for (const groupId of ["fast", "simulation", "presentation"]) {
        if (runGroup(groupId, dryRun) !== 0) return 1;
      }
      return 0;
    }
    case "ci": {
      if (args.length === 0) {
        usage();
        return 2;
      }
      for (const groupId of args) {
        if (runShard(groupId) !== 0) return 1;
      }
      return 0;
    }
    case "group": {
      if (args.length === 0) {
        usage();
        return 2;
      }
      for (const groupId of args) {
        if (runGroup(groupId, dryRun) !== 0) return 1;
      }
      return 0;
    }
    case "check": {
      const { failures, notes } = checkArchitecture();
      for (const note of notes) console.log(`note: ${note}`);
      if (failures.length > 0) {
        console.error(`\nvalidation architecture check FAILED (${failures.length}):`);
        for (const failure of failures) console.error(`  - ${failure}`);
        return 1;
      }
      console.log(`\nvalidation architecture check: PASS (${UNITS.length} units, ${GROUPS.length} groups)`);
      return 0;
    }
    case "plan":
      printPlan(rest.includes("--json"));
      return 0;
    case "merge": {
      if (args.length === 0) {
        usage();
        return 2;
      }
      return mergeSummaries(args[0]!);
    }
    case "plan": {
      // Whether a shard has any work, as a step output, so a job whose inputs are
      // conditional (the browser and Android lanes both download the artifact the
      // build job produces) can skip those inputs when routing left it nothing to
      // do. The shard still runs and still resolves; only its optional
      // prerequisites are skipped.
      const files = changedFiles();
      const plan = files
        ? planForPaths(files)
        : planBroad("could not determine the changed files for this run");
      for (const groupId of args) {
        const decision = decideShard(groupId, plan);
        const hasWork = String(decision.run.length > 0);
        console.log(`${groupId}: ${hasWork === "true" ? "has work" : "nothing to execute"}${decision.broadened ? " (fallback broad)" : ""}`);
        if (process.env.GITHUB_OUTPUT) {
          const { appendFileSync } = require("node:fs") as typeof import("node:fs");
          appendFileSync(process.env.GITHUB_OUTPUT, `${groupId}_has_work=${hasWork}\n`);
        }
      }
      return 0;
    }
    case "graph": {
      // Which shards would run, and which would resolve empty, for a set of
      // changed paths. This is the reporting surface for impact routing: it
      // answers "what does this change class actually cost" without a CI run.
      const { plan, shards } = planForChange(args);
      console.log(`domains: ${plan.domains.join(", ") || "(none)"}   unknown: ${plan.unknown}`);
      for (const reason of plan.reasons) console.log(`  ${reason}`);
      console.log("");
      let executed = 0;
      let empty = 0;
      for (const shard of shards) {
        const ids = shard.run.map((u) => u.id);
        executed += ids.length;
        if (ids.length === 0) empty += 1;
        // A shard whose units are largely unmeasured must not read as cheap.
        const unmeasured = shard.run.filter((u) => u.baselineSeconds === undefined).length;
        const cost = shard.run.reduce((sum, u) => sum + (u.baselineSeconds ?? 0), 0);
        const costLabel = unmeasured > 0 ? `~${cost}s +${unmeasured}?` : `~${cost}s`;
        console.log(
          `  ${shard.groupId.padEnd(15)} ${String(ids.length).padStart(2)} unit(s)  ${costLabel.padStart(14)}  ` +
          (ids.length ? ids.join(", ") : "-- nothing to execute; the check still resolves --"),
        );
      }
      console.log(`\n  ${executed} unit(s) execute; ${empty} shard(s) resolve with no work.`);
      return 0;
    }
    case "impact": {
      const plan = planImpact({ units: UNITS, paths: args });
      for (const reason of plan.reasons) console.log(reason);
      console.log(`\ndomains: ${plan.domains.join(", ") || "(none)"}`);
      console.log(`unknown: ${plan.unknown}`);
      console.log(`units (${plan.unitIds.length}): ${plan.unitIds.join(", ")}`);
      return 0;
    }
    default:
      usage();
      return 2;
  }
};

process.exit(main());
