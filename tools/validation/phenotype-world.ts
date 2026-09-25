/**
 * Lane 2 M4B — Phase 3 world-integration validation.
 *
 * Covers the explorer phenotype adapter (apps/explorer/src/phenotype.ts):
 * descendant-chained resolution over live snapshots, orphan fallback,
 * cross-snapshot memoization and pruning, grid caching per tier/activity,
 * tier cell fractions, and draw centering. The canvas draw path itself is
 * verified by counting rects on a mock surface; real paint is a browser
 * concern (see Phase 3 return notes on test:browser).
 *
 * Run: pnpm exec tsx tools/validation/phenotype-world.ts
 * (chained into pnpm test:phenotype)
 */
import assert from "node:assert/strict";
import type { RenderOrganism, RenderSnapshot } from "../../packages/contracts/src/index.ts";
import {
  PHENOTYPE_CELL_FRACTION,
  PhenotypeCache,
  drawPhenotypeOrganism,
  tierForZoom,
} from "../../apps/explorer/src/phenotype.ts";

function mkOrg(patch: Partial<RenderOrganism> & { id: number }): RenderOrganism {
  return {
    parent: null,
    generation: 0,
    lineageId: 1,
    cladeId: 1,
    x: 300,
    y: 300,
    energy: 80,
    activity: "active",
    speed: 1.5625,
    sensing: 69.5,
    metabolism: 0.224,
    reproduction: 100,
    diet: 0.4,
    habitat: 0.4,
    byproductUse: 0,
    dormancyResponse: 1.0,
    ...patch,
  };
}

function snapOf(organisms: RenderOrganism[]): RenderSnapshot {
  return { organisms } as RenderSnapshot;
}

function testChainingAndOrphans() {
  const cache = new PhenotypeCache();
  const founder = mkOrg({ id: 1, parent: null, generation: 0 });
  const child = mkOrg({ id: 2, parent: 1, generation: 1, speed: 1.6 });
  const grandchild = mkOrg({ id: 3, parent: 2, generation: 2, speed: 1.65 });
  const orphan = mkOrg({ id: 4, parent: 999, generation: 1 });
  const map = cache.resolveSnapshot(snapOf([grandchild, child, founder, orphan]));
  assert.equal(map.get(1)?.family, "blob", "founder resolves from position");
  assert.equal(map.get(2)?.family, "blob", "child inherits through the chain");
  assert.equal(map.get(3)?.family, "blob", "grandchild inherits through the chain");
  assert.ok(map.get(4), "orphan (missing parent) falls back instead of crashing");
  assert.equal(map.get(4)?.family, "blob", "orphan falls back to founder resolution");
  // Deterministic across repeated resolution.
  const again = cache.resolveSnapshot(snapOf([founder, child, grandchild, orphan]));
  for (const [id, res] of map) assert.deepEqual(again.get(id), res, `id ${id} stable`);
  console.log("chaining + orphans: PASS");
}

function testCacheLifecycle() {
  const cache = new PhenotypeCache();
  const a = mkOrg({ id: 1 });
  const b = mkOrg({ id: 2, parent: 1, generation: 1 });
  cache.resolveSnapshot(snapOf([a, b]));
  assert.equal(cache.size, 2, "two organisms cached");
  cache.resolveSnapshot(snapOf([a, b]));
  assert.equal(cache.size, 2, "second snapshot reuses (no growth)");
  cache.resolveSnapshot(snapOf([a]));
  assert.equal(cache.size, 1, "departed ids pruned");
  // Grid memoization: same object for same tier/activity, split otherwise.
  const res = cache.resolveSnapshot(snapOf([a])).get(1)!;
  const g1 = cache.grid(a, res, "inspection");
  const g2 = cache.grid(a, res, "inspection");
  assert.equal(g1, g2, "grid cached per tier/activity");
  assert.notEqual(g1, cache.grid(a, res, "population"), "tier split");
  assert.notEqual(
    g1,
    cache.grid({ ...a, activity: "dormant" }, res, "inspection"),
    "activity split",
  );
  console.log("cache lifecycle: PASS");
}

function testCap() {
  const cache = new PhenotypeCache();
  const orgs: RenderOrganism[] = [];
  for (let i = 1; i <= 20010; i++) orgs.push(mkOrg({ id: i, x: i % 600, y: (i * 7) % 600 }));
  cache.resolveSnapshot(snapOf(orgs));
  assert.ok(cache.size <= 20000, `cache capped (size ${cache.size})`);
  console.log("cache cap: PASS");
}

function testDrawMath() {
  const cache = new PhenotypeCache();
  const o = mkOrg({ id: 1 });
  const res = cache.resolveSnapshot(snapOf([o])).get(1)!;
  assert.deepEqual(
    PHENOTYPE_CELL_FRACTION,
    { ecosystem: 0.8, population: 0.5, inspection: 0.35 },
    "tier cell fractions hold footprints comparable to legacy voxels",
  );
  assert.equal(tierForZoom(1), "ecosystem", "zoom maps through the adapter");
  assert.equal(tierForZoom(3), "inspection", "zoom maps through the adapter");
  const calls: Array<[number, number, number, number]> = [];
  const grid = cache.grid(o, res, "ecosystem");
  drawPhenotypeOrganism({ fillRect: (x, y, w, h) => calls.push([x, y, w, h]) }, o, res, cache, "ecosystem", 100, 100, 10);
  const filled = grid.cells.filter(Boolean).length;
  assert.equal(calls.length, filled, "one rect per filled cell");
  const cu = 10 * 0.8;
  const ox = 100 - (grid.size * cu) / 2;
  for (const [x, y, w, h] of calls) {
    assert.ok(x >= ox - 1e-9 && y >= ox - 1e-9, "draw centered on the organism");
    assert.equal(w, cu, "uniform cell unit");
    assert.equal(h, cu, "uniform cell unit");
  }
  console.log("draw math: PASS");
}

testChainingAndOrphans();
testCacheLifecycle();
testCap();
testDrawMath();
console.log("phenotype world integration: PASS");
