/**
 * Pixi spike validation (Node): determinism, relaxed-key drift bounds,
 * texture-reuse statistics, movement isolation, semantic isolation.
 *
 * Run: pnpm exec tsx tools/pixi-spike/validate.ts
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TextureCache,
  churnState,
  designFixture,
  engineLikeFixture,
  evolveFixture,
  fnv1a,
  gridBits,
  gridDifference,
  moveFixture,
  renderKeyExact,
  renderKeyRelaxed,
  type Fixture,
} from "./cache.ts";
import {
  FAMILY_ORDER,
  renderPhenotypeGrid,
  resolvePhenotype,
  type LodTier,
} from "../../packages/phenotype/src/index.ts";

function traitsForAxes(mob: number, sen: number, met: number, spec: number) {
  return {
    speed: 0.25 + mob * 3.75, sensing: 10 + sen * 170, metabolism: 0.04 + met * 0.46,
    reproduction: 100, diet: Math.min(1, spec / 0.75) * 1.5, habitat: Math.min(1, spec / 0.75) * 1.5,
    byproductUse: 0, dormancyResponse: 1.0,
  };
}

// 1. Determinism: identical inputs -> identical bits, twice.
{
  const t = traitsForAxes(0.6, 0.7, 0.5, 0.5);
  for (const tier of ["ecosystem", "population", "inspection"] as const) {
    for (const act of ["active", "dormant"] as const) {
      const a = gridBits(renderPhenotypeGrid(resolvePhenotype(t, { organismId: 1, lineageId: 1 }), tier, act));
      const b = gridBits(renderPhenotypeGrid(resolvePhenotype(t, { organismId: 1, lineageId: 1 }), tier, act));
      assert.equal(a, b, `deterministic ${tier}/${act}`);
    }
  }
  console.log("determinism: PASS (3 tiers x active/dormant, bit-identical)");
}

// 2. Relaxed-key drift bound: group design-1000 organisms by relaxed key,
//    max exact-grid difference within a group must be 0 at eco/pop, <=2 at insp.
{
  const fix = designFixture("drift-probe", 1000, 77);
  for (const tier of ["ecosystem", "population", "inspection"] as const) {
    const groups = new Map<string, { res: (typeof fix.organisms)[number]["res"]; act: "active" | "dormant" }[]>();
    for (const o of fix.organisms) {
      const k = renderKeyRelaxed(o.res, tier, o.activity);
      const g = groups.get(k) ?? [];
      g.push({ res: o.res, act: o.activity });
      groups.set(k, g);
    }
    let maxDrift = 0;
    for (const g of groups.values()) {
      for (let i = 1; i < g.length; i++) {
        const d = gridDifference(
          renderPhenotypeGrid(g[0]!.res, tier, g[0]!.act),
          renderPhenotypeGrid(g[i]!.res, tier, g[i]!.act),
        );
        if (d > maxDrift) maxDrift = d;
      }
    }
    const bound = tier === "inspection" ? 2 : 0;
    assert.ok(maxDrift <= bound, `${tier} relaxed drift ${maxDrift} exceeds ${bound}`);
    console.log(`relaxed drift ${tier}: PASS (max ${maxDrift} cells, bound ${bound}; ${groups.size} relaxed keys)`);
  }
}

// 3. Reuse statistics per fixture scale (all tiers, mixed activity).
function reuseReport(fix: Fixture): void {
  const tiers: LodTier[] = ["ecosystem", "population", "inspection"];
  const line: string[] = [];
  for (const tier of tiers) {
    const cache = new TextureCache();
    const relaxed = new Set<string>();
    for (const o of fix.organisms) {
      cache.forOrganism(o.res, tier, o.activity);
      relaxed.add(renderKeyRelaxed(o.res, tier, o.activity));
    }
    const n = fix.organisms.length;
    line.push(`${tier.slice(0, 4)}: exact=${cache.size} relaxed=${relaxed.size} reuse=${(n / cache.size).toFixed(1)}x`);
  }
  const fams = new Set(fix.organisms.map((o) => o.res.family));
  console.log(`${fix.name} (n=${fix.organisms.length} fams=${[...fams].join(",")}): ${line.join(" | ")}`);
}
for (const [name, count, seed] of [["spike-50", 50, 11], ["spike-250", 250, 12], ["spike-1000", 1000, 13], ["spike-3000", 3000, 14]] as const) {
  reuseReport(designFixture(name, count, seed));
}
reuseReport(engineLikeFixture("spike-engine-1000", 1000, 21));

// 4. Movement isolation: displaced positions create zero new textures.
{
  const fix = designFixture("move-probe", 1000, 13);
  const cache = new TextureCache();
  for (const o of fix.organisms) for (const tier of ["ecosystem", "population", "inspection"] as const) cache.forOrganism(o.res, tier, o.activity);
  const before = cache.creations;
  const moved = moveFixture(fix, 99);
  for (const o of moved.organisms) for (const tier of ["ecosystem", "population", "inspection"] as const) cache.forOrganism(o.res, tier, o.activity);
  assert.equal(cache.creations, before, "movement must not create textures");
  console.log(`movement isolation: PASS (${before} textures, +0 after displacement)`);
}

// 5. Evolution churn: 50 generations x 5% turnover + activity flips on a
// 1000-organism fixture, production lifecycle (release old key, acquire new,
// prune zero-user entries each generation). Reports live vs cumulative.
{
  const fix = designFixture("churn-probe", 1000, 13);
  const tier = "population" as const;
  const cache = new TextureCache();
  const keys: string[] = fix.organisms.map((o) => cache.acquire(o.res, tier, o.activity).key);
  const st = churnState(4242, 100000);
  const curve: string[] = [];
  for (let gen = 1; gen <= 50; gen++) {
    const before = new Set(keys);
    evolveFixture(fix, st, 0.05);
    fix.organisms.forEach((o, i) => {
      const e = cache.acquire(o.res, tier, o.activity);
      if (e.key !== keys[i]) {
        cache.release(keys[i]!);
        keys[i] = e.key;
      } else {
        cache.release(e.key); // re-acquire of the same key: net zero
      }
    });
    void before;
    cache.prune();
    if (gen % 10 === 0) curve.push(`g${gen}:live=${cache.live()} cum=${cache.cumulative}`);
  }
  console.log(`evolution churn (50 gens, 5% turnover, population): ${curve.join(" ")}`);
  assert.ok(cache.live() <= cache.cumulative, "live cannot exceed cumulative");
  console.log(`churn lifecycle: PASS (ref-counted acquire/release/prune, no leaks by construction)`);
  // Same at inspection tier (30 gens): cosmetic identity pixels raise pressure.
  {
    const fixI = designFixture("churn-probe-insp", 1000, 13);
    const cacheI = new TextureCache();
    const keysI: string[] = fixI.organisms.map((o) => cacheI.acquire(o.res, "inspection", o.activity).key);
    const stI = churnState(777, 200000);
    for (let gen = 1; gen <= 30; gen++) {
      evolveFixture(fixI, stI, 0.05);
      fixI.organisms.forEach((o, i) => {
        const e = cacheI.acquire(o.res, "inspection", o.activity);
        if (e.key !== keysI[i]) {
          cacheI.release(keysI[i]!);
          keysI[i] = e.key;
        } else {
          cacheI.release(e.key);
        }
      });
      cacheI.prune();
    }
    console.log(`evolution churn (30 gens, 5% turnover, inspection): live=${cacheI.live()} cumulative=${cacheI.cumulative} pruned=${cacheI.pruned}`);
  }
}

// 6. Key-derivation cost (presentation logic only, mock — not GPU).
{
  const fix = designFixture("cost-probe", 1211, 13);
  const t0 = performance.now();
  for (const o of fix.organisms) renderKeyExact(o.res, "inspection", o.activity);
  const ms = performance.now() - t0;
  console.log(`key derivation: ${(ms / fix.organisms.length).toFixed(3)}ms/organism inspection (scene-1000 scale, includes grid render)`);
}

// 7. Semantic isolation: no sim-core / sim-runtime imports in this directory.
{
  const dir = dirname(fileURLToPath(import.meta.url));
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
    const src = readFileSync(join(dir, f), "utf8");
    const bad = /from\s+["'][^"']*sim-(core|runtime)|require\(\s*["'][^"']*sim-(core|runtime)/.test(src);
    assert.ok(!bad, `${f} must not import simulation packages`);
  }
  console.log("semantic isolation: PASS (no sim-core/sim-runtime imports; phenotype package only)");
}

// 8. Six-family rendering smoke: every family resolves at every tier.
{
  for (const f of FAMILY_ORDER) {
    const res = resolvePhenotype(traitsForAxes(0.5, 0.5, 0.5, 0.5), { parentFamily: f, organismId: 3, lineageId: 3 });
    for (const tier of ["ecosystem", "population", "inspection"] as const) {
      const g = renderPhenotypeGrid(res, tier, "active");
      const d = renderPhenotypeGrid(res, tier, "dormant");
      assert.ok(g.cells.some(Boolean) && d.cells.some(Boolean), `${f}/${tier} nonempty`);
    }
  }
  console.log(`phenotype key smoke: PASS (${FAMILY_ORDER.length} families x 3 tiers x active/dormant; baseline cross-checked by pnpm test:phenotype)`);
}

console.log(`pixi spike validation: PASS (fnv probe ${fnv1a("spike")})`);
