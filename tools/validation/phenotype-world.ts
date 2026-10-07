/**
 * Lane 2 M4B — Phase 3 world-integration validation.
 *
 * Covers the explorer phenotype adapter (apps/explorer/src/phenotype.ts):
 * descendant-chained resolution over live snapshots, orphan fallback,
 * cross-snapshot memoization and pruning, grid caching per tier/activity,
 * tier cell fractions. Renderer painting is proved through production Pixi
 * browser screenshots rather than a Canvas2D mock surface.
 *
 * Run: pnpm exec tsx tools/validation/phenotype-world.ts
 * (chained into pnpm test:phenotype)
 */
import assert from "node:assert/strict";
import type { RenderOrganism, RenderSnapshot } from "../../packages/contracts/src/index.ts";
import {
  PHENOTYPE_CELL_FRACTION,
  PhenotypeCache,
  sanitizeAnchors,
  tierForZoom,
} from "../../apps/explorer/src/phenotype.ts";
import { resolvePhenotype } from "../../packages/phenotype/src/index.ts";

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

function snapOf(organisms: RenderOrganism[], worldId?: number): RenderSnapshot {
  return { organisms, worldId } as RenderSnapshot;
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

function testPhenotypePresentationContract() {
  assert.deepEqual(
    PHENOTYPE_CELL_FRACTION,
    { ecosystem: 1.08, population: 0.5, inspection: 0.35 },
    "ecosystem tier gets the approved larger display footprint while other LOD tiers stay unchanged",
  );
  assert.equal(tierForZoom(1), "ecosystem", "zoom maps through the adapter");
  assert.equal(tierForZoom(3), "inspection", "zoom maps through the adapter");
  console.log("phenotype presentation contract: PASS");
}


function testWorldIsolation() {
  // Review blocker 1: ids recur across universes. Same ids, same seed/config
  // shape, different traits and world identity must never inherit priors.
  const cache = new PhenotypeCache();
  const mkA = (id: number) => mkOrg({ id });
  const map1 = cache.resolveSnapshot(snapOf([mkA(1), mkA(2), mkA(3)], 101));
  assert.equal(map1.get(1)?.family, "blob", "world 1 resolves from its own traits");
  const ref1 = map1.get(1)!;
  // Same world, second snapshot: memoization holds (identical object).
  const map1b = cache.resolveSnapshot(snapOf([mkA(1), mkA(2), mkA(3)], 101));
  assert.equal(map1b.get(1), ref1, "same world reuses cached resolution");
  // New universe, same ids, segmented-leaning traits: must recompute, not leak.
  const mkB = (id: number) => mkOrg({ id, speed: 3.0, sensing: 120 });
  const map2 = cache.resolveSnapshot(snapOf([mkB(1), mkB(2), mkB(3)], 202));
  assert.notEqual(map2.get(1), ref1, "new world identity drops prior entries");
  assert.equal(map2.get(1)?.family, "segmented", "world 2 resolves from its own traits");
  // Fresh cache agrees: proves world-2 result is recomputation, not residue.
  const fresh = new PhenotypeCache();
  const mapF = fresh.resolveSnapshot(snapOf([mkB(1)], 202));
  assert.deepEqual(map2.get(1), mapF.get(1), "world-2 family equals cold resolution");
  assert.equal(cache.size, 3, "only the current world's ids remain");
  console.log("world isolation: PASS");
}

function testSaveRestoreContinuity() {
  // Review blocker 2: a living descendant whose parent is dead/absent at
  // restore must keep its pre-save family via staged anchors.
  // Find deterministic traits where founder != lineage-anchored outcome.
  const base = { speed: 1.5625, sensing: 69.5, metabolism: 0.224, reproduction: 100, diet: 0.4, habitat: 0.4, byproductUse: 0, dormancyResponse: 1.0 };
  let childTraits: typeof base | null = null;
  for (let k = 1; k <= 30 && !childTraits; k++) {
    const t = { ...base, speed: base.speed + k * 0.2 };
    const founder = resolvePhenotype(t, { organismId: 2, lineageId: 1 }).family;
    const anchored = resolvePhenotype(t, { parentFamily: "blob", organismId: 2, lineageId: 1 }).family;
    if (founder !== "blob" && anchored === "blob") childTraits = t;
  }
  assert.ok(childTraits, "fixture needs founder/anchored divergence (hysteresis band)");
  // Pre-save world: parent alive, child lineage-anchored.
  const live = new PhenotypeCache();
  const parent = mkOrg({ id: 1, parent: null, generation: 0, ...base });
  const child = mkOrg({ id: 2, parent: 1, generation: 1, ...childTraits! });
  const pre = live.resolveSnapshot(snapOf([parent, child], 11));
  assert.equal(pre.get(2)?.family, "blob", "pre-save child anchored to blob");
  const anchors = live.snapshotAnchors();
  assert.ok(anchors[2], "save captures the child's resolution");
  // Cold reload WITHOUT anchors: founder fallback flips the family (proves
  // the test is non-vacuous and reproduces the reported defect shape).
  const cold = new PhenotypeCache();
  const orphanSnap = snapOf([mkOrg({ id: 2, parent: 1, generation: 1, ...childTraits! })], 22);
  const noAnchor = cold.resolveSnapshot(orphanSnap);
  assert.notEqual(noAnchor.get(2)?.family, "blob", "cold restore without anchors flips (defect reproduced)");
  // Cold reload WITH staged anchors: pre-save family restored exactly.
  const restored = new PhenotypeCache();
  restored.stageAnchors(anchors);
  const post = restored.resolveSnapshot(snapOf([mkOrg({ id: 2, parent: 1, generation: 1, ...childTraits! })], 22));
  assert.deepEqual(post.get(2), pre.get(2), "restored child matches pre-save resolution exactly");
  // Staging is single-use: resolving the same restored world again stays
  // stable (now memoized), while a further new world without fresh staging
  // falls back to founder resolution — proving no anchor leakage.
  const stable = restored.resolveSnapshot(snapOf([mkOrg({ id: 2, parent: 1, generation: 1, ...childTraits! })], 22));
  assert.deepEqual(stable.get(2), post.get(2), "restored world stays stable on re-resolve");
  const later = restored.resolveSnapshot(snapOf([mkOrg({ id: 2, parent: 1, generation: 1, ...childTraits! })], 33));
  assert.equal(later.get(2)?.family, noAnchor.get(2)?.family, "unstaged new world falls back identically (no leakage)");
  console.log("save/restore continuity: PASS");
}

function testAnchorHygiene() {
  assert.deepEqual(sanitizeAnchors(null), {}, "null sanitizes to empty");
  assert.deepEqual(sanitizeAnchors([]), {}, "arrays rejected");
  assert.deepEqual(sanitizeAnchors({ x: 1 }), {}, "non-object values dropped");
  assert.deepEqual(
    sanitizeAnchors({ 1: { family: "nope", quantized: {} }, 2: { family: "blob" }, 3: { family: "blob", quantized: {} } }),
    { 3: { family: "blob", quantized: {} } },
    "unknown families and shapeless entries dropped, valid kept",
  );
  // Staged anchors never leak across an unrelated universe creation.
  const cache = new PhenotypeCache();
  cache.stageAnchors({ 1: { family: "segmented", quantized: {} } as never });
  cache.clearStaged();
  const map = cache.resolveSnapshot(snapOf([mkOrg({ id: 1 })], 77));
  assert.equal(map.get(1)?.family, "blob", "cleared staging cannot contaminate a fresh world");
  console.log("anchor hygiene: PASS");
}

testChainingAndOrphans();
testCacheLifecycle();
testCap();
testPhenotypePresentationContract();
testWorldIsolation();
testSaveRestoreContinuity();
testAnchorHygiene();
console.log("phenotype world integration: PASS");
