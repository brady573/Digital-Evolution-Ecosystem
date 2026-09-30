import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Durable gate for A6 build-time source injection.
 *
 * `apps/explorer/vite.config.ts` defines `__DEE_GIT_COMMIT__` /
 * `__DEE_GIT_DIRTY__` into the bundle. A broken or mismatched `define` still
 * builds cleanly and would leave every production export `unknown` while all
 * pure-logic provenance tests stay green — so this check exercises the built
 * output itself: the expected commit literal must be present in the bundle
 * and no raw injected identifier may remain. It runs as part of the `build`
 * unit (`package.json`), so every CI build proves injection, not just
 * compilation.
 *
 * Dirty-fact wiring is covered structurally (no raw `__DEE_GIT_DIRTY__`
 * remains, so the boolean reached the bundle) with the dirty→dirty semantic
 * row pinned by the tri-state unit tests; minified boolean literals are not
 * asserted literally because their spelling is a bundler detail.
 *
 * Where the commit is undeterminable (no git, no GITHUB_SHA), the correct
 * A6 label is `unknown` — and the build must still succeed. Unknown never
 * blocks; it only never passes as clean.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const DIST_ASSETS = join(REPO_ROOT, "apps/explorer/dist/assets");

const expectedCommit = (): string | null => {
  try {
    const head = execSync("git rev-parse HEAD", { cwd: REPO_ROOT, encoding: "utf8" }).trim();
    if (/^[0-9a-f]{40}$/.test(head)) return head;
  } catch {
    // No git available; fall through toCI-provided SHA, then to unknown.
  }
  const fromEnv = (process.env.GITHUB_SHA ?? "").trim();
  return /^[0-9a-f]{40}$/.test(fromEnv) ? fromEnv : null;
};

const commit = expectedCommit();
if (!existsSync(DIST_ASSETS)) {
  console.error(`provenance build check: ${DIST_ASSETS} missing; run the Explorer build first`);
  process.exit(1);
}
const chunks = readdirSync(DIST_ASSETS).filter((f) => f.endsWith(".js"));
assert.ok(chunks.length > 0, "provenance build check: no built chunks found");

for (const chunk of chunks) {
  const source = readFileSync(join(DIST_ASSETS, chunk), "utf8");
  assert.doesNotMatch(
    source,
    /__DEE_GIT_(COMMIT|DIRTY)__/,
    `provenance build check: raw injected identifier remains in ${chunk}; the vite define did not substitute`,
  );
}

if (commit === null) {
  console.log("provenance build check: no determinable revision (no git, no GITHUB_SHA) — build stands, exports label unknown");
  process.exit(0);
}
const carriers = chunks.filter((chunk) =>
  readFileSync(join(DIST_ASSETS, chunk), "utf8").includes(commit),
);
assert.ok(
  carriers.length > 0,
  `provenance build check: commit ${commit} not found in any built chunk; injection did not reach the bundle`,
);
console.log(`provenance build check: PASS (commit ${commit.slice(0, 12)} in ${carriers.join(", ")})`);
