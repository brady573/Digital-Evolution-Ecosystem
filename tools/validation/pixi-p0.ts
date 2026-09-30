/**
 * P0 Pixi preparation harness (Node, deterministic, no browser needed).
 *
 * Proves the Stage P0 return claims without touching the production World:
 * - deterministic exact texture identity (3 tiers x active/dormant);
 * - movement isolation (positions are not key inputs);
 * - ref-counted cache lifecycle (acquire/release/prune, remap-neutral, churn retires);
 * - collision guard (hash hit with different bitmap throws);
 * - layer order + toroidal camera parity with the Canvas2D World contract;
 * - asset registry completeness against assets/asset-manifest.json;
 * - renderer isolation (no sim-core/sim-runtime imports; App.tsx has no pixi/ import);
 * - no new contracts types in the P0 adapter;
 * - 50/250/1000/3000 organism cache measurements (spike fixtures, exact keys).
 *
 * Run: pnpm test:pixi-p0
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LOD_GRID_SIZE,
  renderPhenotypeGrid,
  resolvePhenotype,
  type LodTier,
} from "../../packages/phenotype/src/index.ts";
import { lodTierForZoom } from "../../packages/phenotype/src/model.ts";
import { churnState, designFixture, engineLikeFixture, evolveFixture } from "../pixi-spike/cache.ts";
import { describeTexture, exactTextureKey, gridBits } from "../../apps/explorer/src/pixi/phenotypeTextures.ts";
import { PhenotypeTextureCache } from "../../apps/explorer/src/pixi/textureCache.ts";
import {
  LAYER_ORDER,
  WORLD_EXTENT,
  ZOOM_MAX,
  ZOOM_MIN,
  clampZoom,
  wrapCoord,
  wrapDelta,
} from "../../apps/explorer/src/pixi/layers.ts";
import { ASSET_REGISTRY, registryManifestIds } from "../../apps/explorer/src/pixi/assetRegistry.ts";
import { toTextureRequests } from "../../apps/explorer/src/pixi/adapter.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");
const pixiDir = join(root, "apps/explorer/src/pixi");

function traitsForAxes(mob: number, sen: number, met: number, spec: number) {
  return {
    speed: 0.25 + mob * 3.75,
    sensing: 10 + sen * 170,
    metabolism: 0.04 + met * 0.46,
    reproduction: 100,
    diet: Math.min(1, spec / 0.75) * 1.5,
    habitat: Math.min(1, spec / 0.75) * 1.5,
    byproductUse: 0,
    dormancyResponse: 1.0,
  };
}

// 1. Determinism: identical inputs -> identical key/bits, twice.
{
  const t = traitsForAxes(0.6, 0.7, 0.5, 0.5);
  for (const tier of ["ecosystem", "population", "inspection"] as const) {
    for (const act of ["active", "dormant"] as const) {
      const res = resolvePhenotype(t, { organismId: 1, lineageId: 1 });
      const a = describeTexture(res, tier, act);
      const b = describeTexture(res, tier, act);
      assert.equal(a.key, b.key, `deterministic key ${tier}/${act}`);
      assert.equal(a.bits, b.bits, `deterministic bits ${tier}/${act}`);
      assert.equal(a.size, LOD_GRID_SIZE[tier], `LOD size ${tier}`);
      const g = renderPhenotypeGrid(res, tier, act);
      assert.equal(gridBits(g), a.bits, `bits match renderer ${tier}/${act}`);
    }
  }
  console.log("p0 determinism: PASS (3 tiers x active/dormant, key+bits identical, LOD sizes 5/9/13)");
}

// 1b. Collision guard.
{
  const res = resolvePhenotype(traitsForAxes(0.6, 0.7, 0.5, 0.5), { organismId: 1, lineageId: 1 });
  const cache = new PhenotypeTextureCache();
  cache.acquire(res, "population", "active");
  const inner = cache as unknown as { entries: Map<string, { bits: string }> };
  const key = exactTextureKey(res, "population", "active");
  inner.entries.get(key)!.bits = "corrupted";
  assert.throws(() => cache.acquire(res, "population", "active"), /render-key collision/);
  console.log("p0 collision guard: PASS (mismatched bitmap on hash hit throws)");
}

// 2. Movement isolation: same resolutions at moved positions -> same keys.
{
  const fix = designFixture("p0-move", 250, 12);
  const resolved = new Map(fix.organisms.map((o) => [o.id, o.res]));
  const fake = (dx: number, dy: number) => ({
    organisms: fix.organisms.map((o) => ({
      id: o.id, x: (o.x + dx + 600) % 600, y: (o.y + dy + 600) % 600,
      activity: o.activity as "active" | "dormant",
    })),
  });
  for (const tier of ["ecosystem", "population", "inspection"] as const) {
    const before = new Map(toTextureRequests(fake(0, 0) as never, resolved, tier).map((r) => [r.organismId, r.key]));
    const after = toTextureRequests(fake(37, -53) as never, resolved, tier);
    for (const r of after) assert.equal(r.key, before.get(r.organismId), `movement-stable ${tier}#${r.organismId}`);
  }
  console.log("p0 movement isolation: PASS (250 organisms x 3 tiers, displaced positions change zero keys)");
}

// 3. Cache lifecycle: remap-neutral + churn retires obsolete entries.
{
  const fix = designFixture("p0-lifecycle", 500, 13);
  const cache = new PhenotypeTextureCache();
  const keys: string[] = fix.organisms.map((o) => cache.acquire(o.res, "population", o.activity).key);
  const users = (): number => cache.entriesList().reduce((n, e) => n + e.users, 0);
  const u0 = users();
  // Repeated remap of unchanged keys must be net-zero (acquire + release).
  fix.organisms.forEach((o, i) => {
    const e = cache.acquire(o.res, "population", o.activity);
    assert.equal(e.key, keys[i]);
    cache.release(e.key);
  });
  assert.equal(users(), u0, "remap must be user-count neutral");
  // Turnover via the spike's presentation-side evolution model (perturbed
  // traits, lineage-anchored resolution, fresh identity — never biology).
  const st = churnState(4242, 100000);
  const { replaced } = evolveFixture(fix, st, 0.1);
  fix.organisms.forEach((o, i) => {
    const e = cache.acquire(o.res, "population", o.activity);
    if (e.key !== keys[i]) {
      cache.release(keys[i]!);
      keys[i] = e.key;
    } else cache.release(e.key);
  });
  const dead = cache.prune();
  assert.ok(replaced > 0, "turnover fixture must replace at least one organism");
  // Ref-count integrity: every organism holds exactly one live key.
  assert.equal(users(), fix.organisms.length, "users must equal organism count after remap");
  // Prune retires only zero-user entries: after prune, size == live().
  assert.equal(cache.size, cache.live(), "prune must drop all zero-user entries");
  assert.ok(cache.live() <= cache.cumulative, "live cannot exceed cumulative");
  console.log(`p0 lifecycle: PASS (remap-neutral users=${u0}; churn replaced=${replaced} pruned=${dead.length} live=${cache.live()} cum=${cache.cumulative})`);
}

// 4. Layer order + camera parity.
{
  assert.deepEqual([...LAYER_ORDER], ["environment", "analytical-field", "waste-cue", "organisms", "selection-focus", "effects"]);
  assert.equal(WORLD_EXTENT, 600, "toroidal extent stays 600");
  assert.equal(ZOOM_MIN, 1);
  assert.equal(ZOOM_MAX, 3);
  assert.equal(wrapCoord(-10), 590);
  assert.equal(wrapCoord(610), 10);
  assert.equal(wrapDelta(10, 590), 20);
  assert.equal(wrapDelta(590, 10), -20);
  assert.equal(wrapDelta(0, 600), 0);
  assert.equal(clampZoom(0.2), 1);
  assert.equal(clampZoom(9), 3);
  assert.equal(lodTierForZoom(1.0), "ecosystem");
  assert.equal(lodTierForZoom(1.5), "ecosystem");
  assert.equal(lodTierForZoom(2.0), "population");
  assert.equal(lodTierForZoom(2.5), "population");
  assert.equal(lodTierForZoom(3.0), "inspection");
  console.log("p0 layers/camera: PASS (order, 600-torus, zoom 1-3, zoom->tier map)");
}

// 5. Asset registry completeness.
{
  const manifest = JSON.parse(readFileSync(join(root, "assets/asset-manifest.json"), "utf8")) as {
    note: string;
    assets: Array<{ id: string }>;
  };
  assert.ok(!manifest.note.includes("ships no binary image assets"), "manifest must not claim zero binary assets");
  const ids = new Set(manifest.assets.map((a) => a.id));
  for (const id of registryManifestIds()) assert.ok(ids.has(id), `registry id missing from manifest: ${id}`);
  assert.ok(ids.has("family-portraits"), "manifest must list family portraits");
  assert.ok(ids.has("phenotype-textures"), "manifest must list phenotype textures");
  // 24 portrait files on disk: six families x 16/32/64/128.
  const artFiles = readdirSync(join(root, "apps/explorer/src/family-art")).filter((f) => f.endsWith(".png")).sort();
  assert.equal(artFiles.length, 24, `expect 24 portrait PNGs (got ${artFiles.length})`);
  for (const f of ["blob", "segmented", "radial", "plated", "branching", "paddled"]) {
    for (const px of ["16", "32", "64", "128"]) {
      const name = px === "128" ? `${f}.png` : `${f}-${px}.png`;
      assert.ok(artFiles.includes(name), `portrait missing: ${name}`);
    }
  }
  assert.equal(Object.keys(ASSET_REGISTRY).length, 4, "registry must define classes A/B/C/D");
  console.log(`p0 registry: PASS (${artFiles.length} portraits on disk; ${registryManifestIds().length} manifest ids cross-checked)`);
}

// 6. Renderer isolation + non-production boundary + no new contracts types.
{
  const sources = readdirSync(pixiDir).filter((f) => f.endsWith(".ts"));
  assert.ok(sources.length >= 4, `expect >=4 P0 modules (got ${sources.length})`);
  for (const f of sources) {
    const src = readFileSync(join(pixiDir, f), "utf8");
    assert.ok(!/from\s+["'][^"']*sim-core|from\s+["'][^"']*sim-runtime/.test(src), `${f} must not import simulation packages`);
    assert.ok(!/from\s+["']pixi\.js["']/.test(src), `${f} must not import pixi.js in P0 (P1 adds the production dependency)`);
  }
  const appSrc = readFileSync(join(root, "apps/explorer/src/App.tsx"), "utf8");
  assert.ok(!appSrc.includes("src/pixi") && !appSrc.includes("./pixi") && !appSrc.includes("phenotypeTextures") && !appSrc.includes("PhenotypeTextureCache"),
    "production WorldCanvas must not import the P0 pixi/ boundary (cutover is P1-gated)");
  assert.ok(appSrc.includes('canvas.getContext("2d")'), "production World must still be Canvas2D in P0");
  const adapterSrc = readFileSync(join(pixiDir, "adapter.ts"), "utf8");
  assert.ok(!/interface\s+\w*(Checkpoint|Command|EngineConfig|Universe)\w*/.test(adapterSrc), "adapter must not declare new contracts types");
  console.log(`p0 isolation: PASS (${sources.length} modules sim-free/pixi-free; App.tsx has no pixi/ import and stays Canvas2D)`);
}

// 7. Scale measurements: exact-key cache over 50/250/1000/3000 (+ engine-like 1000).
function scaleReport(name: string, count: number, seed: number, engineLike = false): void {
  const fix = engineLike ? engineLikeFixture(name, count, seed) : designFixture(name, count, seed);
  const line: string[] = [];
  for (const tier of ["ecosystem", "population", "inspection"] as LodTier[]) {
    const cache = new PhenotypeTextureCache();
    for (const o of fix.organisms) cache.acquire(o.res, tier, o.activity);
    line.push(`${tier.slice(0, 4)}: exact=${cache.size} reuse=${(fix.organisms.length / cache.size).toFixed(1)}x`);
  }
  console.log(`p0 scale ${name} (n=${fix.organisms.length}): ${line.join(" | ")}`);
}
scaleReport("p0-50", 50, 11);
scaleReport("p0-250", 250, 12);
scaleReport("p0-1000", 1000, 13);
scaleReport("p0-3000", 3000, 14);
scaleReport("p0-engine-1000", 1000, 21, true);

console.log("pixi P0 harness: PASS");
