import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { UNITS, UNIT_BY_ID, GROUPS } from "./manifest.ts";
import { REPO_ROOT, checkArchitecture, duplicateScriptKeys, verifyFromManifest } from "./architecture.ts";
import { classifyPath, planImpact } from "./impact.ts";
import { decideShard, expandNeeds, planBroad, planForChange } from "./routing.ts";
import { GROUP_BY_ID } from "./manifest.ts";
import type { Domain } from "./manifest.ts";

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

// --- 1b. Duplicate package.json script keys cannot collapse silently ------

const testDuplicateScriptKeysAreRejected = (): void => {
  const raw = readFileSync(join(REPO_ROOT, "package.json"), "utf8");
  assert.deepEqual(duplicateScriptKeys(raw), [], "package.json must not contain duplicate script keys");
  const synthetic = `{"scripts": {"a": "1", "b": "2", "a": "3"}}`;
  assert.deepEqual(duplicateScriptKeys(synthetic), ["a"], "synthetic duplicate script key must be reported");
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
    if (unit.enforcement === "manual" || unit.paused) continue;
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
  for (const forbidden of ["ecology-survey", "niche-survey", "washout-reliance", "dependency-possibility", "dependency-tradeoff"]) {
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
      if (unit.enforcement === "manual" || unit.paused) continue;
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

/** The safety rule: unknown means more validation, never less. Paused units stay paused. */
const testUnknownPathsRunEverything = (): void => {
  const runnable = UNITS.filter((u) => !u.paused);
  for (const path of ["mystery/file.ts", "scripts/deploy.sh", "some/other/place.rs"]) {
    const { ids, unknown } = impactUnits([path]);
    assert.ok(unknown, `${path} must be unclassified`);
    for (const unit of runnable) assert.ok(ids.has(unit.id), `${path} must force ${unit.id}`);
  }

  // A recognised path mixed with an unrecognised one still runs everything runnable.
  const mixed = impactUnits(["apps/explorer/src/App.tsx", "mystery/file.ts"]);
  assert.ok(mixed.unknown);
  assert.equal(mixed.ids.size, runnable.length);
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
  assert.equal(longUnits.length, 4, "expected four long-phase shards");

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
    if (group.id === "android-runtime") continue; // exempted below: empty by pause, not by omission
    assert.ok(group.unitIds.length > 0, `group ${group.id} is empty`);
  }
  // The one empty group is the pause, and the exemption is itself asserted:
  // an empty group without a paused unit behind it is still a defect.
  const runtime = GROUP_BY_ID.get("android-runtime");
  assert.ok(runtime && runtime.unitIds.length === 0, "android-runtime must be empty while paused");
  const paused = UNITS.filter((u) => u.paused);
  assert.ok(paused.some((u) => u.id === "android-install-launch"), "the pause must name android-install-launch, or the empty group is unexplained");
};

// --- 7. Cross-boundary read models stay readable without a cast -------------

/**
 * The History and Tree read models are a contract, and a contract that
 * consumers bypass with `as any[]` proves nothing at all: the compile-time
 * guarantee is gone the moment one caller opts out, and `typecheck` stays
 * green while the read model silently degrades back to `unknown`.
 *
 * So this asserts both halves. The types must be declared, and they must not be
 * `any`/`unknown` placeholders. And no consumer outside `packages/contracts`
 * may reach past them to read History or Tree.
 *
 * Scoped deliberately: it names the read-model expressions rather than banning
 * `any` repository-wide, so it cannot fail on unrelated legitimate casts.
 */
const testCrossBoundaryReadModelsStayCastFree = (): void => {
  const contracts = readFileSync(join(REPO_ROOT, "packages/contracts/src/index.ts"), "utf8");

  for (const declared of [
    "export interface ObservationFrame",
    "export interface HistoryRecord",
    "export interface Era",
    "export interface Clade",
    "export interface CladeMetrics",
    "export interface RenderMetrics",
  ]) {
    assert.ok(contracts.includes(declared), `contracts must declare \`${declared}\``);
  }

  // The read models must be real types, not the placeholders they replaced.
  assert.doesNotMatch(
    contracts,
    /readonly (records|eras): readonly unknown\[\]/,
    "AnalysisState.records/eras must be typed read models, not unknown[]",
  );
  assert.doesNotMatch(
    contracts,
    /readonly metrics: any/,
    "RenderSnapshot.metrics must be a typed read model, not any",
  );

  // Consumers may not reach past those types on the read-model expressions.
  const consumers = [
    "apps/explorer/src/App.tsx",
    "packages/sim-runtime/src/session.ts",
    "packages/sim-analysis/src/index.ts",
    "tools/validation/ecology.ts",
    "tools/validation/ecology-survey.ts",
    "tools/validation/time-controls.ts",
  ];
  const bypasses = [
    /analysis\.(records|eras)[^;\n]*\bas\s+(any|unknown)\b/,
    /\((?:r|c):any\)/,
  ];
  for (const rel of consumers) {
    const source = readFileSync(join(REPO_ROOT, rel), "utf8");
    for (const bypass of bypasses) {
      const hit = source.match(bypass);
      assert.equal(
        hit,
        null,
        `${rel} reaches past the typed History/Tree read models: ${hit?.[0] ?? ""}`,
      );
    }
  }
};

// --- 8. Identity namespaces and typed refs ----------------------------------

/**
 * Decision 3 splits the identity namespaces: `L-` is a lineage and only a
 * lineage, `C-` is a clade and only a clade. Both are four-digit numbers at
 * runtime, so nothing about the *value* distinguishes them — only the code that
 * chooses the prefix, and the kind tag on a reference.
 *
 * That makes this easy to break silently, so it is asserted from both ends:
 * the product source must never emit a bare `L-`/`C-` template (a formatter in
 * contracts is the only thing allowed to name a namespace), and no consumer may
 * reach past a ref's `kind` to render an identity.
 *
 * The frozen legacy decoder in sim-core is the one deliberate exception, and it
 * is named explicitly rather than pattern-matched around, so the exemption
 * cannot quietly widen.
 */
const testIdentityNamespacesStayTyped = (): void => {
  const contracts = readFileSync(join(REPO_ROOT, "packages/contracts/src/index.ts"), "utf8");

  // The formatters exist and are the only place a namespace prefix is spelled.
  assert.ok(
    /export const formatLineageId = .*`L-\$\{/.test(contracts),
    "contracts must own the lineage label formatter",
  );
  assert.ok(
    /export const formatCladeId = .*`C-\$\{/.test(contracts),
    "contracts must own the clade label formatter",
  );

  // EntityRef must be able to express "real entity, kind not recorded", or the
  // no-guessing rule is unrepresentable and consumers will guess anyway.
  assert.ok(
    /readonly kind: EntityRefKind \| null/.test(contracts),
    "EntityRef.kind must admit null so an unrecorded kind is expressible",
  );

  // Only sim-core's frozen decoder may keep the old bare template.
  const FROZEN = "packages/sim-core/src/engine.ts";
  const bare = /`L-\$\{String\(|`C-\$\{String\(/;
  const sources = [
    "apps/explorer/src/App.tsx",
    "packages/sim-analysis/src/index.ts",
    FROZEN,
  ];
  for (const rel of sources) {
    const source = readFileSync(join(REPO_ROOT, rel), "utf8");
    const hit = source.match(bare);
    if (rel === FROZEN) {
      // Frozen by decision, and it must stay marked as frozen.
      assert.ok(
        hit !== null,
        "the legacy sim-core decoder is expected to keep its pre-Decision-3 template",
      );
      assert.ok(
        /FROZEN LEGACY CHECKPOINT DECODER/.test(source),
        `${rel} keeps a divergent identity template, so its frozen-decoder marking must stay present`,
      );
      continue;
    }
    assert.equal(
      hit,
      null,
      `${rel} spells an identity namespace directly instead of using the contract formatter: ${hit?.[0] ?? ""}`,
    );
  }

  // A consumer must not render a ref without reading its kind. Both of these
  // patterns previously reinterpreted a bare number into `L-`.
  const explorer = readFileSync(join(REPO_ROOT, "apps/explorer/src/App.tsx"), "utf8");
  assert.doesNotMatch(
    explorer,
    /entity_refs\s*\.map\(\s*\(?\s*n\s*:\s*number/,
    "History must not map entity_refs as bare numbers; read ref.kind instead",
  );
  assert.ok(
    /typedRefs\(story\.entity_refs\)/.test(explorer),
    "History must render History refs through typedRefs so an unrecorded kind is omitted",
  );

  // The live dormant-return path must describe a clade as a clade.
  const analysis = readFileSync(join(REPO_ROOT, "packages/sim-analysis/src/index.ts"), "utf8");
  assert.doesNotMatch(
    analysis,
    /A dormant lineage returned/,
    "the live dormant-return path must not describe a clade as a lineage",
  );
  assert.ok(
    /A dormant clade returned/.test(analysis),
    "the live dormant-return path must describe a clade as a clade",
  );
  assert.ok(
    /cladeRef\(Number\(clade\)\)/.test(analysis),
    "the dormant-return record must tag its reference as a clade",
  );
};

const tests: Array<[string, () => void]> = [
  ["architecture has no drift", testArchitectureHasNoDrift],
  ["duplicate script keys are rejected", testDuplicateScriptKeysAreRejected],
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
  ["cross-boundary read models stay cast-free", testCrossBoundaryReadModelsStayCastFree],
  ["identity namespaces stay typed", testIdentityNamespacesStayTyped],
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



// --- Impact routing ---------------------------------------------------------

/** Every unit's impact mapping is well formed, and names real domains. */
const testEveryUnitHasValidImpactMapping = (): void => {
  const valid = new Set<Domain>([
    "contracts", "sim-core", "sim-analysis", "sim-decisions", "sim-runtime",
    "phenotype", "explorer", "android", "validation", "ci", "docs",
  ]);
  for (const unit of UNITS) {
    assert.ok(unit.domains.length > 0, `${unit.id} must declare the domains that force it`);
    for (const domain of unit.domains) {
      assert.ok(valid.has(domain), `${unit.id} names unknown impact domain "${domain}"`);
    }
  }
  // Every domain must force something, or it is a dead routing input.
  const forced = new Set(UNITS.flatMap((u) => u.domains));
  for (const domain of valid) {
    assert.ok(forced.has(domain), `impact domain "${domain}" forces no unit and can never be used`);
  }
};

/** An unknown path must widen to every unit, in every shard. */
const testUnknownRunsEverything = (): void => {
  for (const path of ["mystery/file.ts", "scripts/deploy.sh", "some/other/place.rs"]) {
    const { plan, shards } = planForChange([path]);
    assert.ok(plan.unknown, `${path} must be unclassified`);
    for (const shard of shards) {
      assert.equal(shard.skipped.length, 0, `${path}: shard ${shard.groupId} skipped a unit despite unknown impact`);
    }
  }
  // Missing changed files must behave the same way, not as "nothing required".
  const broadened = planBroad("no base available");
  assert.ok(broadened.unknown, "a missing base must be unknown");
  const runnable = UNITS.filter((u) => !u.paused).length;
  assert.equal(broadened.unitIds.length, runnable, "a missing base must run every runnable unit");
  for (const shard of [...GROUP_BY_ID.values()].filter((g) => g.ci)) {
    assert.equal(decideShard(shard.id, broadened).skipped.length, 0, `missing base skipped units in ${shard.id}`);
  }
};

/** Contracts reach the widest downstream scope. */
const testContractsTriggerBroadValidation = (): void => {
  const { plan } = planForChange(["packages/contracts/src/index.ts"]);
  assert.ok(!plan.unknown);
  for (const unit of UNITS) {
    if (unit.enforcement === "manual" || unit.paused) continue;
    assert.ok(plan.unitIds.includes(unit.id), `a contracts change must require ${unit.id}`);
  }
};

/** Biological authority keeps all relevant simulation, runtime, and product coverage. */
const testSimulationCoreTriggersRelevantCoverage = (): void => {
  const { plan, shards } = planForChange(["packages/sim-core/src/engine.ts"]);
  for (const required of ["migration", "ecology", "niche", "dependency-arc", "aftermath", "build", "browser-smoke", "android-assemble"]) {
    assert.ok(plan.unitIds.includes(required), `a sim-core change must require ${required}`);
  }
  // Every deterministic shard must have real work for a biology change.
  for (const shard of shards.filter((s) => s.groupId.startsWith("ci-sim"))) {
    assert.ok(shard.run.length > 0, `a sim-core change must leave ${shard.groupId} with work`);
  }
};

/** Validation apparatus and CI configuration cannot validate themselves away. */
const testValidationInfrastructureCannotValidateItselfAway = (): void => {
  for (const path of [
    "tools/validation/manifest.ts",
    "tools/validation/impact.ts",
    "tools/validation/routing.ts",
    "tools/validation/run.ts",
    "package.json",
    "pnpm-lock.yaml",
    ".github/workflows/product.yml",
    ".github/actions/setup-project/action.yml",
    "legacy/prototype/engine.ts",
  ]) {
    const { plan, shards } = planForChange([path]);
    for (const shard of shards) {
      assert.equal(
        shard.skipped.length, 0,
        `${path} is validation infrastructure and must not skip anything in ${shard.groupId}`,
      );
    }
    assert.equal(plan.unitIds.length, UNITS.filter((u) => !u.paused).length, `${path} must route to the full runnable unit set`);
  }
};

/** Explorer-only work skips the unrelated expensive biological suites. */
const testExplorerSkipsUnrelatedBiologicalWork = (): void => {
  const { plan, shards } = planForChange(["apps/explorer/src/AftermathPanel.tsx"]);
  for (const required of ["typecheck", "build", "browser-smoke", "mobile-ui", "android-assemble", "phenotype"]) {
    assert.ok(plan.unitIds.includes(required), `an Explorer change must require ${required}`);
  }
  for (const forbidden of ["ecology-survey", "niche-survey", "washout-reliance", "dependency-possibility", "niche"]) {
    assert.ok(!plan.unitIds.includes(forbidden), `an Explorer change must not require ${forbidden}`);
  }
  // The expensive unrelated biology must go quiet. An Explorer change still runs
  // the interaction points it drives -- catalysts, time controls, aftermath -- so
  // "sim-d is empty" would be the wrong assertion; what has to be skipped are the
  // long horizons and the ecological gates, which an Explorer change cannot reach.
  for (const expensive of [
    "dependency-arc", "dependency-possibility", "dependency-crossfeeding",
    "dependency-washout", "ecology", "niche",
  ]) {
    assert.ok(!plan.unitIds.includes(expensive), `an Explorer change must not require ${expensive}`);
  }
  const simC = shards.find((s) => s.groupId === "ci-sim-c");
  assert.ok(simC && simC.run.length === 0, "an Explorer change must leave ci-sim-c (niche, ecology) empty");
  // And the interaction points it does drive must survive routing.
  for (const kept of ["catalysts", "time-controls", "aftermath"]) {
    assert.ok(plan.unitIds.includes(kept), `an Explorer change must still require ${kept}`);
  }
};

/** Documentation takes the minimum safe path: invariants, and nothing expensive. */
const testDocsTakesMinimumSafePath = (): void => {
  const { plan, shards } = planForChange(["AGENTS.md"]);
  // A markdown file cannot break the type system, so typecheck is not forced by
  // the docs domain -- running it would be waste, not safety. The invariant
  // units still run for every shard that holds them.
  assert.ok(plan.unitIds.includes("validation-arch"), "a docs change must re-check the validation architecture");
  assert.ok(!plan.unitIds.includes("typecheck"), "a docs change must not force typecheck; it cannot affect types");
  for (const unit of UNITS) {
    if ((unit.baselineSeconds ?? 0) < 20) continue;
    assert.ok(!plan.unitIds.includes(unit.id), `a docs change must not require ${unit.id} (${unit.baselineSeconds}s)`);
  }
  for (const unit of UNITS) {
    if (unit.cls === "browser" || unit.cls === "platform" || unit.cls === "scientific") {
      assert.ok(!plan.unitIds.includes(unit.id), `a docs change must not require ${unit.cls} unit ${unit.id}`);
    }
  }
  // The browser and Android lanes must resolve with nothing to do.
  for (const shard of shards) {
    if (shard.groupId === "ci-fast") continue;
    assert.equal(shard.run.length, 0, `a docs change must leave ${shard.groupId} with nothing to do`);
  }
};

/** Android-relevant changes still reach the Android lane -- packaging only, while the runtime is paused. */
const testAndroidChangesTriggerTheAndroidLane = (): void => {
  for (const path of [
    "apps/explorer/android/app/build.gradle",
    "apps/explorer/capacitor.config.ts",
    "packages/phenotype/src/index.ts",
    "packages/contracts/src/index.ts",
  ]) {
    const { plan, shards } = planForChange([path]);
    for (const required of ["android-sync", "android-assemble", "android-lint"]) {
      assert.ok(plan.unitIds.includes(required), `${path} must require ${required}`);
    }
    // The pause is unconditional: even a change that reaches the packaged
    // application must not require the runtime smoke.
    assert.ok(!plan.unitIds.includes("android-install-launch"), `${path} must not require the paused android-install-launch`);
    const build = shards.find((s) => s.groupId === "ci-build");
    assert.ok(build && build.run.some((u) => u.id === "build"), `${path} must build, or the Android lane has no artifact`);
  }
};

/**
 * The property that keeps merge-blocking evidence from disappearing: a shard may
 * only skip a unit the classifier positively cleared, and a unit that routing
 * selected must never be dropped on the way to execution.
 */
const testSkippedShardCannotDropRequiredWork = (): void => {
  const classes: Array<[string, string[]]> = [
    ["docs-only", ["AGENTS.md"]],
    ["explorer-only", ["apps/explorer/src/App.tsx"]],
    ["phenotype-only", ["packages/phenotype/src/index.ts"]],
    ["sim-core", ["packages/sim-core/src/engine.ts"]],
    ["sim-decisions", ["packages/sim-decisions/src/index.ts"]],
    ["unknown", ["mystery/thing.rs"]],
  ];
  for (const [label, paths] of classes) {
    const { plan, shards } = planForChange(paths);
    const routed = expandNeeds(new Set(plan.unitIds));
    for (const shard of shards) {
      const group = GROUP_BY_ID.get(shard.groupId)!;
      // Partitions the shard exactly: every unit is either run or explicitly
      // skipped, never both and never neither.
      const runIds = new Set(shard.run.map((u) => u.id));
      for (const id of group.unitIds) {
        assert.ok(
          runIds.has(id) || shard.skipped.some((s) => s.unit.id === id),
          `${label}/${shard.groupId}: ${id} is neither run nor explicitly skipped`,
        );
      }
      assert.equal(
        runIds.size + shard.skipped.length, group.unitIds.length,
        `${label}/${shard.groupId}: units are duplicated or lost`,
      );
      // Anything the plan required in this shard must be running.
      for (const id of group.unitIds) {
        if (routed.has(id) || UNIT_BY_ID.get(id)?.cls === "invariant") {
          assert.ok(runIds.has(id), `${label}/${shard.groupId}: required unit ${id} was skipped`);
        }
      }
    }
  }
};

const routingTests: Array<[string, () => void]> = [
  ["every unit has a valid impact mapping", testEveryUnitHasValidImpactMapping],
  ["unknown paths widen to full validation", testUnknownRunsEverything],
  ["contracts trigger broad validation", testContractsTriggerBroadValidation],
  ["sim-core keeps relevant coverage", testSimulationCoreTriggersRelevantCoverage],
  ["validation infrastructure cannot validate itself away", testValidationInfrastructureCannotValidateItselfAway],
  ["explorer changes skip unrelated biological work", testExplorerSkipsUnrelatedBiologicalWork],
  ["docs takes the minimum safe path", testDocsTakesMinimumSafePath],
  ["android changes trigger the android lane", testAndroidChangesTriggerTheAndroidLane],
  ["a skipped shard cannot drop required work", testSkippedShardCannotDropRequiredWork],
];

for (const [name, test] of routingTests) {
  try {
    test();
    console.log(`impact routing: ${name}: PASS`);
  } catch (error) {
    failed += 1;
    console.error(`impact routing: ${name}: FAIL`);
    console.error(`  ${error instanceof Error ? error.message.split("\n").join("\n  ") : String(error)}`);
  }
}

if (failed > 0) {
  console.error(`\nvalidation architecture: FAIL (${failed}/${tests.length + routingTests.length})`);
  process.exit(1);
}
console.log(`\nvalidation architecture: PASS (${tests.length + routingTests.length} checks)`);
