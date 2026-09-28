import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { UNITS, UNIT_BY_ID, GROUPS } from "./manifest.ts";
import { REPO_ROOT, checkArchitecture, verifyFromManifest } from "./architecture.ts";
import { classifyPath, planImpact } from "./impact.ts";

/**
 * Validation architecture self-test.
 *
 * This is the unit that makes the routing trustworthy. A change-impact
 * classifier that lives only in workflow syntax cannot be tested, and a manifest
 * that nothing checks will drift the first time someone adds a check in a hurry.
 * So both are asserted here, in repository-owned code, on every run of the fast
 * gate.
 *
 * The tests are deliberately two-sided. It is easy to write a classifier that
 * looks conservative because it runs everything; the value is in proving that
 * narrow changes stay narrow *and* that anything unrecognised still runs
 * everything.
 */

const scripts = (): Record<string, string> => {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  return pkg.scripts;
};

const runDependency = (args: string[]): string => {
  const result = spawnSync("pnpm", ["exec", "tsx", "tools/validation/dependency.ts", "--", ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `dependency.ts ${args.join(" ")} exited ${result.status}\n${result.stderr}`);
  return result.stdout;
};

// --- 1. The manifest is self-consistent, and CI cannot drift from it ---------

const testArchitectureHasNoDrift = (): void => {
  const { failures } = checkArchitecture();
  assert.deepEqual(failures, [], `validation architecture drift:\n  ${failures.join("\n  ")}`);
};

// --- 2. Path classification -------------------------------------------------

const testPathClassification = (): void => {
  const domain = (p: string): string | undefined => {
    const verdict = classifyPath(p);
    return verdict.kind === "domain" ? verdict.domain : undefined;
  };

  assert.equal(domain("packages/contracts/src/index.ts"), "contracts");
  assert.equal(domain("packages/sim-core/src/engine.ts"), "sim-core");
  assert.equal(domain("packages/sim-analysis/src/index.ts"), "sim-analysis");
  assert.equal(domain("packages/sim-decisions/src/index.ts"), "sim-decisions");
  assert.equal(domain("packages/sim-runtime/src/session.ts"), "sim-runtime");
  assert.equal(domain("packages/phenotype/src/index.ts"), "phenotype");
  assert.equal(domain("apps/explorer/src/App.tsx"), "explorer");
  assert.equal(domain("apps/explorer/android/app/build.gradle"), "android");
  assert.equal(domain("tools/validation/impact.ts"), "validation");
  assert.equal(domain("package.json"), "validation");
  assert.equal(domain("pnpm-lock.yaml"), "validation");
  assert.equal(domain(".github/workflows/product.yml"), "ci");
  assert.equal(domain("AGENTS.md"), "docs");
  assert.equal(domain("docs/architecture/MIGRATION.md"), "docs");
  assert.equal(domain("legacy/prototype/engine.ts"), "validation");

  // Generated output must never be mistaken for a source change.
  assert.equal(classifyPath("apps/explorer/dist/index.js").kind, "generated");
  assert.equal(classifyPath("node_modules/tsx/dist/index.js").kind, "generated");
  assert.equal(classifyPath("testdata/visual/01-landscape-desktop.png").kind, "generated");
  assert.equal(classifyPath("apps/explorer/android/app/build/outputs/apk/debug/app.apk").kind, "generated");
  assert.equal(
    classifyPath("apps/explorer/android/app/src/main/assets/public/index.html").kind,
    "generated",
  );
  // ...but native source under android/ is not generated.
  assert.equal(domain("apps/explorer/android/app/src/main/java/MainActivity.java"), "android");

  // Anything unrecognised must fall through to "unknown", never to a guess.
  assert.equal(classifyPath("some/unmapped/place.ts").kind, "unknown");
  assert.equal(classifyPath("").kind, "unknown");
  assert.equal(classifyPath("scripts/deploy.sh").kind, "unknown");
};

// --- 3. Impact routing, in the direction that matters ------------------------

const impactUnits = (paths: string[]): { ids: Set<string>; unknown: boolean } => {
  const plan = planImpact({ units: UNITS, paths });
  return { ids: new Set(plan.unitIds), unknown: plan.unknown };
};

/** Biological authority must reach the biological evidence. */
const testBiologicalAuthorityReachesEcologicalEvidence = (): void => {
  const { ids } = impactUnits(["packages/sim-core/src/engine.ts"]);
  for (const required of ["migration", "ecology", "niche", "dependency-arc", "aftermath", "build", "browser-smoke", "android-assemble"]) {
    assert.ok(ids.has(required), `sim-core change must require ${required}`);
  }
};

/** Contracts reach everything: they are the shared vocabulary. */
const testContractsAreBroadest = (): void => {
  const contracts = impactUnits(["packages/contracts/src/index.ts"]).ids;
  for (const unit of UNITS) {
    if (unit.enforcement === "manual") continue;
    assert.ok(contracts.has(unit.id), `a contracts change must require ${unit.id}`);
  }

  // And strictly broader than any single package's own scope.
  for (const pkg of ["packages/sim-core/src/engine.ts", "apps/explorer/src/App.tsx", "packages/phenotype/src/index.ts"]) {
    const narrower = impactUnits([pkg]).ids;
    for (const id of narrower) {
      assert.ok(contracts.has(id), `contracts scope must be a superset of ${pkg} (missing ${id})`);
    }
  }
};

/** Explorer-only changes must not drag in the long biological surveys. */
const testExplorerChangeStaysNarrow = (): void => {
  const { ids } = impactUnits(["apps/explorer/src/AftermathPanel.tsx"]);
  for (const required of ["typecheck", "build", "browser-smoke", "mobile-ui", "android-assemble", "phenotype"]) {
    assert.ok(ids.has(required), `an Explorer change must require ${required}`);
  }
  // Analysis may read Explorer-adjacent contracts, but a presentation-only change
  // must not re-run the multi-seed surveys or the long dependency horizons.
  for (const forbidden of ["ecology-survey", "niche-survey", "washout-reliance", "dependency-crossfeeding"]) {
    assert.ok(!ids.has(forbidden), `an Explorer change must not require ${forbidden}`);
  }
  assert.ok(!ids.has("niche"), "an Explorer change must not require the niche gate");
};

/** Analysis changes must not imply biology changed. */
const testAnalysisDoesNotImplyBiology = (): void => {
  const { ids } = impactUnits(["packages/sim-analysis/src/index.ts"]);
  assert.ok(ids.has("niche"), "an analysis change must re-validate niche interpretation");
  for (const forbidden of ["ecology", "dependency-arc", "dependency-crossfeeding", "dependency-washout"]) {
    assert.ok(!ids.has(forbidden), `an analysis change must not require ${forbidden}`);
  }
};

/** A change to the measuring apparatus must not be able to validate itself away. */
const testValidationInfrastructureIsConservative = (): void => {
  for (const path of [
    "tools/validation/impact.ts",
    "tools/validation/manifest.ts",
    "tools/validation/run.ts",
    "package.json",
    "pnpm-lock.yaml",
    ".github/workflows/product.yml",
    "legacy/prototype/engine.ts",
  ]) {
    const { ids } = impactUnits([path]);
    for (const unit of UNITS) {
      if (unit.enforcement === "manual") continue;
      assert.ok(ids.has(unit.id), `${path} must require ${unit.id}`);
    }
  }
};

/**
 * Documentation-only changes must not run an expensive simulation.
 *
 * "Expensive" is taken from the manifest's own measured baselines rather than a
 * hand-listed set of unit ids, so the test keeps meaning something as costs
 * change: any unit that currently costs 20s or more is off limits, and any new
 * expensive unit is automatically covered the day it is added.
 */
const testDocsChangeAvoidsExpensiveWork = (): void => {
  const EXPENSIVE_SECONDS = 20;
  const { ids } = impactUnits(["AGENTS.md"]);

  // The architecture check is cheap, and it is the one thing a change to the
  // documentation of the validation system should re-verify.
  assert.ok(ids.has("validation-arch"), "a docs change must still re-check the validation architecture");

  for (const unit of UNITS) {
    const cost = unit.baselineSeconds ?? 0;
    if (cost < EXPENSIVE_SECONDS) continue;
    assert.ok(!ids.has(unit.id), `a docs change must not require ${unit.id} (${cost}s baseline)`);
  }

  // And nothing from the expensive evidence classes at all.
  for (const unit of UNITS) {
    if (unit.cls === "browser" || unit.cls === "platform" || unit.cls === "scientific") {
      assert.ok(!ids.has(unit.id), `a docs change must not require ${unit.cls} unit ${unit.id}`);
    }
  }
};

/** Generated output alone requires nothing. */
const testGeneratedOutputRequiresNothing = (): void => {
  const { ids, unknown } = impactUnits(["testdata/visual/01-landscape-desktop.png", "apps/explorer/dist/index.js"]);
  assert.equal(unknown, false, "generated output must not be treated as unknown");
  assert.equal(ids.size, 0, "generated output alone must require no validation");
};

/** The safety rule: unknown means more validation, never less. */
const testUnknownPathsRunEverything = (): void => {
  for (const path of ["mystery/file.ts", "scripts/deploy.sh", "some/other/place.rs"]) {
    const { ids, unknown } = impactUnits([path]);
    assert.ok(unknown, `${path} must be unclassified`);
    for (const unit of UNITS) assert.ok(ids.has(unit.id), `${path} must force ${unit.id}`);
  }

  // A recognised path mixed with an unrecognised one still runs everything.
  const mixed = impactUnits(["apps/explorer/src/App.tsx", "mystery/file.ts"]);
  assert.ok(mixed.unknown);
  assert.equal(mixed.ids.size, UNITS.length);
};

/** Monotonicity: adding a path can only add validation, never remove it. */
const testImpactIsMonotonic = (): void => {
  const base = impactUnits(["apps/explorer/src/App.tsx"]).ids;
  const extended = impactUnits(["apps/explorer/src/App.tsx", "packages/contracts/src/index.ts"]).ids;
  for (const id of base) {
    assert.ok(extended.has(id), `widening a change must keep ${id}`);
  }
  assert.ok(extended.size > base.size, "adding contracts must strictly widen the required set");
};

// --- 4. The dependency shards still cover the whole suite --------------------

/**
 * The sharpest evidence-integrity check in the repository.
 *
 * `tools/validation/dependency.ts` used to be one 647-second command, which made
 * it the product workflow's entire critical path. It is now partitioned across
 * three shards. This asserts the partition is exact: the shards' `--only` lists
 * union to the full set of live-integration tests, and are mutually disjoint. If
 * someone adds a long test and forgets to put it in a shard, this fails. If
 * someone copies one into two shards, this fails.
 */
const testDependencyShardsPartitionTheSuite = (): void => {
  const all = runDependency(["--list"])
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  assert.ok(all.length >= 5, `expected the live-integration phase to be non-trivial, got ${all.length}`);

  const pkg = scripts();
  const longUnits = UNITS.filter((u) => u.id.startsWith("dependency-") && u.id !== "dependency-policy");
  assert.equal(longUnits.length, 3, "expected three long-phase shards");

  const seen = new Set<string>();
  for (const unit of longUnits) {
    const script = pkg[unit.script!];
    assert.ok(script, `missing script for ${unit.id}`);
    assert.ok(script.includes("--skip-policy"), `${unit.id} must skip the policy phase; another shard already proved it`);
    const match = script.match(/--only=([a-z,]+)/);
    assert.ok(match, `${unit.id} must restrict itself with --only`);
    for (const name of match![1]!.split(",")) {
      assert.ok(!seen.has(name), `long test "${name}" is claimed by two shards, so it would run twice`);
      assert.ok(all.includes(name), `shard ${unit.id} names unknown long test "${name}"`);
      seen.add(name);
    }
  }

  for (const name of all) {
    assert.ok(seen.has(name), `long test "${name}" is in no shard; sharding would silently drop it`);
  }

  // The policy phase is its own unit, and no long shard re-runs it.
  const policy = UNIT_BY_ID.get("dependency-policy")!;
  assert.ok(pkg[policy.script!].includes("--fast"), "the policy unit must be the fast phase");
  for (const unit of longUnits) {
    assert.ok(!pkg[unit.script!].includes("--fast"), `${unit.id} must not also run the policy phase`);
  }
};

// --- 5. verify is exactly the blocking repository contract -------------------

const testVerifyMatchesTheContract = (): void => {
  const expected = UNITS.filter(
    (u) =>
      u.enforcement === "blocking" &&
      u.script !== null &&
      (u.cls === "invariant" || u.cls === "deterministic" || u.cls === "presentation"),
  ).map((u) => u.id);

  const actual = verifyFromManifest();
  assert.deepEqual([...actual].sort(), [...expected].sort(), "verify must equal the blocking repository contract");

  // No evidence class may leak into verify.
  for (const id of actual) {
    const unit = UNIT_BY_ID.get(id)!;
    assert.ok(
      unit.cls === "invariant" || unit.cls === "deterministic" || unit.cls === "presentation",
      `verify must not include a ${unit.cls} unit`,
    );
  }
};

// --- 6. Every unit executes, and executes once ------------------------------

const testEveryUnitIsClassifiedAndReachable = (): void => {
  for (const unit of UNITS) {
    assert.ok(unit.claim.length > 20, `${unit.id} must state the claim it proves`);
    assert.ok(unit.domains.length > 0, `${unit.id} must declare its forcing domains`);
    assert.ok(["blocking", "evidence", "manual"].includes(unit.enforcement));
    assert.ok(["invariant", "deterministic", "presentation", "browser", "platform", "scientific", "evidence"].includes(unit.cls));
  }
  for (const group of GROUPS) {
    assert.ok(group.unitIds.length > 0, `group ${group.id} is empty`);
  }
};

const tests: Array<[string, () => void]> = [
  ["architecture has no drift", testArchitectureHasNoDrift],
  ["path classification", testPathClassification],
  ["biological authority reaches ecological evidence", testBiologicalAuthorityReachesEcologicalEvidence],
  ["contracts are the broadest scope", testContractsAreBroadest],
  ["explorer change stays narrow", testExplorerChangeStaysNarrow],
  ["analysis does not imply biology", testAnalysisDoesNotImplyBiology],
  ["validation infrastructure is conservative", testValidationInfrastructureIsConservative],
  ["docs change avoids expensive work", testDocsChangeAvoidsExpensiveWork],
  ["generated output requires nothing", testGeneratedOutputRequiresNothing],
  ["unknown paths run everything", testUnknownPathsRunEverything],
  ["impact is monotonic", testImpactIsMonotonic],
  ["dependency shards partition the suite", testDependencyShardsPartitionTheSuite],
  ["verify matches the contract", testVerifyMatchesTheContract],
  ["every unit is classified and reachable", testEveryUnitIsClassifiedAndReachable],
];

let failed = 0;
for (const [name, test] of tests) {
  try {
    test();
    console.log(`validation architecture: ${name}: PASS`);
  } catch (error) {
    failed += 1;
    console.error(`validation architecture: ${name}: FAIL`);
    console.error(`  ${error instanceof Error ? error.message.split("\n").join("\n  ") : String(error)}`);
  }
}

if (failed > 0) {
  console.error(`\nvalidation architecture: FAIL (${failed}/${tests.length})`);
  process.exit(1);
}
console.log(`\nvalidation architecture: PASS (${tests.length} checks)`);
