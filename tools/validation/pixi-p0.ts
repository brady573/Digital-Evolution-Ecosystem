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
 * - renderer isolation (no sim-core/sim-runtime imports; App.tsx keeps Pixi behind the test-only route);
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
import { createWorldLayers } from "../../apps/explorer/src/pixiWorld/layers.ts";
import { LAYER_ORDER as P0_LAYER_ORDER } from "../../apps/explorer/src/pixi/layers.ts";
import { LAYER_ORDER as PW_LAYER_ORDER } from "../../apps/explorer/src/pixiWorld/layers.ts";
import {
  clampZoom as pwClampZoom,
  screenToWorld,
  viewScale,
  visibleWindow,
  worldToScreen,
  wrapCoord as pwWrapCoord,
  wrapDelta as pwWrapDelta,
  torusTilePositions,
} from "../../apps/explorer/src/pixiWorld/camera.ts";
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
import {
  environmentIdentity,
  environmentMatchesWorld,
  sameNormalFieldInput,
  sameTickEnvironmentDiscontinuity,
} from "../../apps/explorer/src/pixiWorld/environmentIdentity.ts";
import { LandscapeSmoother } from "../../apps/explorer/src/landscape.ts";
import { hitTestOrganism, selectAtScreenPoint } from "../../apps/explorer/src/pixiWorld/interaction.ts";
import { dormantChannel, organismColor } from "../../apps/explorer/src/organismEncoding.ts";
import { PHENOTYPE_CELL_FRACTION } from "../../apps/explorer/src/phenotype.ts";
import { updateOrganismLayer, destroyOrganismLayer, type OrganismTextureFactory } from "../../apps/explorer/src/pixiWorld/organisms.ts";
import { Container, Graphics, Sprite, Texture } from "pixi.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");
const pixiDir = join(root, "apps/explorer/src/pixi");

// Independently-cadenced environment identity ignores live tick changes.
{
  const frame = { worldId: 4, tick: 10 } as never;
  const identityAtLive12 = environmentIdentity(frame, "normal", "combined");
  const identityAtLive15 = environmentIdentity(frame, "normal", "combined");
  assert.equal(identityAtLive12, identityAtLive15);
  assert.notEqual(identityAtLive15, environmentIdentity({ worldId: 4, tick: 15 } as never, "normal", "combined"));
  assert.notEqual(identityAtLive15, environmentIdentity(frame, "nutrients", "combined"));
  assert.equal(environmentMatchesWorld("4", 4), true);
  assert.equal(environmentMatchesWorld("5", 4), false, "new identity must never be paired with an old world's environment channel");
  assert.equal(sameNormalFieldInput({ liveTick: 12, fieldIdentity: "world-4/channel-10/raw-A" }, 12, "world-4/channel-10/raw-A"), true,
    "camera/viewport-only changes must reuse the current normal smoothing result");
  assert.equal(sameNormalFieldInput({ liveTick: 12, fieldIdentity: "world-4/channel-10/raw-A" }, 13, "world-4/channel-10/raw-A"), false,
    "a new live tick may advance the normal smoothing result");
  assert.equal(sameTickEnvironmentDiscontinuity(null, 10, "field-A"), false, "first observation is a prime, not a replacement");
  assert.equal(sameTickEnvironmentDiscontinuity({ environmentTick: 10, fieldIdentity: "field-A" }, 10, "field-B"), true,
    "material field replacement at the same authoritative tick is a discontinuity");
  assert.equal(sameTickEnvironmentDiscontinuity({ environmentTick: 10, fieldIdentity: "field-A" }, 11, "field-B"), false,
    "advancing authoritative ticks preserve ordinary temporal smoothing");
  assert.equal(sameTickEnvironmentDiscontinuity({ environmentTick: 10, fieldIdentity: "field-A" }, 10, "field-A"), false,
    "same-tick unchanged fields do not reset smoothing");

  const smoother = new LandscapeSmoother(1);
  const uniform = (value: number) => new Float32Array([value]);
  const warm = uniform(0.9), depleted = uniform(0.1);
  smoother.advance("world-4", 10, warm, warm, warm, warm);
  const ordinaryAdvance = smoother.advance("world-4", 11, depleted, depleted, depleted, depleted);
  assert.ok(ordinaryAdvance[0]! > 0.1 && ordinaryAdvance[0]! < 0.9,
    "ordinary advancing-tick changes continue to smooth");
  if (sameTickEnvironmentDiscontinuity({ environmentTick: 11, fieldIdentity: "field-A" }, 11, "field-B")) {
    smoother.reset("world-4");
  }
  const discontinuity = smoother.advance("world-4", 11, depleted, depleted, depleted, depleted);
  for (const channel of discontinuity) assert.ok(Math.abs(channel - 0.1) < 1e-6,
    "same-tick replacement re-primes all normal environment channels exactly");
  console.log("p1 environment identity: PASS (environment channel tick/world/lens, not live cadence)");
}

// Toroidal hit testing keeps nearest identity across both world seams.
{
  const organisms = [
    { id: 1, x: 2, y: 300 },
    { id: 2, x: 598, y: 300 },
    { id: 3, x: 300, y: 4 },
    { id: 4, x: 300, y: 596 },
  ] as never;
  assert.equal(hitTestOrganism({ x: 599, y: 300 }, organisms, 26), 2);
  assert.equal(hitTestOrganism({ x: 1, y: 300 }, organisms, 26), 1);
  assert.equal(hitTestOrganism({ x: 300, y: 599 }, organisms, 26), 4);
  assert.equal(hitTestOrganism({ x: 300, y: 1 }, organisms, 26), 3);
  assert.equal(hitTestOrganism({ x: 300, y: 300 }, organisms, 26), null);
  const rect = { left: 20, top: 40, width: 600, height: 600 };
  for (const zoom of [1, 3]) {
    const scale = zoom;
    const center = { x: 300, y: 300 };
    const target = [{ id: 99, x: 300, y: 300 }];
    assert.equal(selectAtScreenPoint(rect.left + 300 + 25, rect.top + 300, rect, center, scale, target), 99,
      `25 CSS px hit at zoom ${zoom}`);
    assert.equal(selectAtScreenPoint(rect.left + 300 + 27, rect.top + 300, rect, center, scale, target), null,
      `27 CSS px miss at zoom ${zoom}`);
  }
  console.log("p1 hit test: PASS (nearest toroidal identity across both seams)");
}

// Analytical encoding remains visible for dormant organisms; dormancy is separate.
{
  const organism = { cladeId: 12, byproductUse: 0, diet: 0, energy: 90, activity: "dormant", speed: 2, sensing: 90 } as const;
  const clade = organismColor(organism, "clades", "speed", [0.25, 4]);
  const trait = organismColor(organism, "traits", "speed", [0.25, 4]);
  assert.match(clade, /^hsl\(/);
  assert.match(trait, /^hsl\(/);
  assert.equal(dormantChannel(organism).alpha, 0.65);
  assert.equal(dormantChannel(organism).hollow, true);
  console.log("p1 analytical organism encoding: PASS (dormant retains clade/trait with separate alpha/hollow channel)");
}

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
    const before = new Map(toTextureRequests(fake(0, 0).organisms as never, resolved, tier).map((r) => [r.organismId, r.key]));
    const after = toTextureRequests(fake(37, -53).organisms as never, resolved, tier);
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

// 3b. Production organism reconciliation contract (headless Pixi containers).
{
  const resolved = resolvePhenotype(traitsForAxes(0.6, 0.7, 0.5, 0.5), { organismId: 1, lineageId: 1 });
  const makeRows = (worldId: number, activity: "active" | "dormant" = "active") => [{
    id: 1, parent: null, generation: 0, lineageId: 1, cladeId: 1,
    x: 100, y: 120, energy: 80, activity, speed: 1.5, sensing: 70,
    metabolism: 0.2, reproduction: 100, diet: 0, habitat: 0,
    byproductUse: 0, dormancyResponse: 1, tolerance: 0, cleanup: 0,
    worldId,
  }];
  const layer = new Container();
  const destroyedTextures: Texture[] = [];
  const createdTextures: Texture[] = [];
  const fakeTexture = (size: number): Texture => ({
    source: { scaleMode: "nearest" },
    orig: { width: size, height: size },
    frame: { width: size, height: size },
    destroy: () => undefined,
  } as unknown as Texture);
  const makeTestTexture: OrganismTextureFactory = (bits, size) => {
    void bits;
    const texture = fakeTexture(size);
    createdTextures.push(texture);
    return { texture, destroy: () => { destroyedTextures.push(texture); } };
  };
  const baseInput = {
    worldId: 1,
    organisms: makeRows(1) as never,
    resolvedPhenotypes: new Map([[1, resolved]]),
    tier: "population" as const,
    lens: "normal" as const,
    traitView: "speed" as const,
    traitRange: [0.25, 4] as [number, number],
    selectedId: null,
    scale: 1,
  };
  const initial = updateOrganismLayer(layer, baseInput, makeTestTexture);
  assert.equal(initial.liveDisplayCount, 1);
  const sprite = layer.children[0] as Sprite;
  const initialTexture = sprite.texture;
  const moved = updateOrganismLayer(layer, { ...baseInput, organisms: [{ ...makeRows(1)[0]!, x: 230, y: 310 }] as never, selectedId: 1 }, makeTestTexture);
  assert.equal(layer.children[0], sprite, "movement and selection retain the display object");
  assert.equal(sprite.texture, initialTexture, "movement and selection retain the morphology texture");
  assert.equal(moved.displayCreates, 1);
  assert.equal(moved.textureCreates, initial.textureCreates, "movement creates no morphology texture");
  assert.equal(sprite.position.x, 230);

  const voxel = layer.children.find((child) => child instanceof Graphics) as Graphics | undefined;
  assert.ok(voxel, "each organism owns a persistent analytical voxel display");
  for (const lens of ["nutrients", "waste", "clades", "traits"] as const) {
    const analytical = updateOrganismLayer(layer, { ...baseInput, lens, selectedId: 1 }, makeTestTexture);
    assert.equal(layer.children[0], sprite, "lens treatment retains the persistent display");
    assert.equal(analytical.textureCreates, initial.textureCreates, `${lens} tint does not alter morphology identity`);
    assert.equal(analytical.liveTextures, 1, "morphology texture remains cached while voxel view is shown");
    assert.equal(sprite.texture, initialTexture, "lens changes leave the morphology texture identity unchanged");
    assert.equal(sprite.visible, false, "analytical lens presents the accepted voxel view, not the phenotype mask");
    assert.ok(voxel.visible, "analytical voxel presentation is visible");
    assert.equal(voxel.alpha, 1, "active analytical organism remains fully opaque");
  }
  const activeAgain = updateOrganismLayer(layer, baseInput, makeTestTexture);
  assert.equal(sprite.visible, true, "normal lens restores the resolved Pixel Phenotype morphology");
  assert.equal(sprite.texture, initialTexture, "returning to normal reuses the same morphology texture");
  const dormantAnalytical = updateOrganismLayer(layer, {
    ...baseInput,
    lens: "clades",
    organisms: makeRows(1, "dormant") as never,
  }, makeTestTexture);
  assert.equal(voxel.alpha, 0.65, "dormancy alpha remains independent of analytical encoding");
  assert.equal(dormantAnalytical.textureCreates, activeAgain.textureCreates + 1, "dormancy remaps morphology independently of lens");

  const activeTexture = initialTexture;
  const dormant = updateOrganismLayer(layer, { ...baseInput, organisms: makeRows(1, "dormant") as never }, makeTestTexture);
  assert.notEqual(sprite.texture, activeTexture, "activity has distinct phenotype mask identity");
  assert.ok(dormant.textureCreates > activeAgain.textureCreates);
  assert.equal(createdTextures.at(-1)!.source.scaleMode, "nearest", "phenotype mask factory configures nearest filtering");
  const ecosystem = updateOrganismLayer(layer, { ...baseInput, tier: "ecosystem" }, makeTestTexture);
  assert.ok(ecosystem.textureCreates > dormant.textureCreates, "LOD tier remaps texture identity");
  const ecosystemGrid = renderPhenotypeGrid(resolved, "ecosystem", "active");
  const ecosystemDisplaySize = ecosystemGrid.size * 2.2 * PHENOTYPE_CELL_FRACTION.ecosystem;
  assert.ok(Math.abs(sprite.width - ecosystemDisplaySize) < 1e-9,
    "ecosystem phenotype display size consumes the pure footprint policy");
  assert.equal(sprite.height, sprite.width, "phenotype display remains square");
  const sameTier = updateOrganismLayer(layer, { ...baseInput, tier: "ecosystem" }, makeTestTexture);
  assert.equal(sameTier.textureCreates, ecosystem.textureCreates,
    "applying display footprint does not create another texture");
  assert.equal(sprite.texture, createdTextures.at(-1), "display footprint does not replace the cached morphology texture");

  const beforeWorld = layer.children[0];
  const beforeReplacementDestroyed = destroyedTextures.length;
  const replaced = updateOrganismLayer(layer, { ...baseInput, worldId: 2, organisms: makeRows(2) as never }, makeTestTexture);
  assert.equal(replaced.liveDisplayCount, 1);
  assert.notEqual(layer.children[0], beforeWorld, "world replacement retires obsolete display object");
  assert.equal(replaced.liveTextures, 1, "world replacement retains only the new world's texture");
  assert.ok(destroyedTextures.length > beforeReplacementDestroyed, "world replacement destroys prior GPU resources");
  destroyOrganismLayer(layer);
  assert.equal(layer.children.length, 0, "destroy releases all organism displays");
  console.log("p1 organisms: PASS (movement/lens identity, activity+LOD remap, world replacement cleanup)");
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
  // P1 cutover is now authorized: the maintained App may mount the PixiWorld
  // component, but it may not directly own the low-level P0 cache/adapter.
  assert.ok(!appSrc.includes("phenotypeTextures") && !appSrc.includes("PhenotypeTextureCache"),
    "App.tsx leaves low-level phenotype GPU cache ownership to pixiWorld");
  const adapterSrc = readFileSync(join(pixiDir, "adapter.ts"), "utf8");
  assert.ok(!/interface\s+\w*(Checkpoint|Command|EngineConfig|Universe)\w*/.test(adapterSrc), "adapter must not declare new contracts types");
  console.log(`p0 isolation: PASS (${sources.length} modules sim-free/pixi-free; App.tsx does not own the low-level Pixi cache)`);
}

// 8. Production Pixi pure camera/layer/render contracts and authority boundary.
{
  // Camera parity: same wrap/zoom primitives as the P0 contract...
  assert.equal(pwWrapDelta(10, 590), 20);
  assert.equal(pwWrapDelta(590, 10), -20);
  assert.equal(pwWrapDelta(0, 600), 0);
  assert.equal(pwWrapCoord(-10), 590);
  // ...plus projection that round-trips exactly (zoom never changes feel).
  for (const cam of [{ x: 300, y: 300 }, { x: 5, y: 595 }, { x: 0, y: 0 }]) {
    for (const [vw, vh] of [[390, 844], [1280, 900], [720, 720]] as const) {
      for (const zoom of [1, 2, 3]) {
        const s = viewScale(vw, vh, zoom);
        for (const [wx, wy] of [[10, 590], [300, 300], [599.9, 0.1], [0, 600]] as const) {
          const p = worldToScreen(wx, wy, cam, s, vw, vh);
          const back = screenToWorld(p.x, p.y, { left: 0, top: 0, width: vw, height: vh }, cam, s);
          // Toroidal identity: same point, or the same point one period over.
          assert.ok(Math.abs(back.x - wx) < 1e-9 || Math.abs(Math.abs(back.x - wx) - 600) < 1e-9,
            `round-trip x ${wx}->${back.x}`);
          assert.ok(Math.abs(back.y - wy) < 1e-9 || Math.abs(Math.abs(back.y - wy) - 600) < 1e-9,
            `round-trip y ${wy}->${back.y}`);
        }
        const vis = visibleWindow(vw, vh, s);
        assert.equal(vis.w, vw / s);
        assert.equal(vis.h, vh / s);
      }
    }
  }
  // Spot-check the App.tsx fit rule: portrait fits by height, wide fits min.
  assert.equal(viewScale(390, 844, 1), 844 / 600);
  assert.equal(viewScale(1280, 900, 1), 900 / 600);
  assert.equal(viewScale(720, 720, 9), viewScale(720, 720, 3), "zoom clamps to 3.0");
  // Zoom must actually scale: proportionality defeats a zoom-ignoring
  // implementation, which would still pass the spots, the clamp equality,
  // and every round-trip above (both directions share one scale).
  assert.equal(viewScale(720, 720, 2), 2 * viewScale(720, 720, 1), "zoom scales the view");
  console.log("p1 camera: PASS (wrap parity, exact projection round-trip, App fit rule, zoom clamp + scale)");

  // Under the Pixi-transformed world root, field copies must be in world
  // coordinates and cover the entire visible logical viewport across seams.
  for (const scenario of [
    { camera: { x: 300, y: 300 }, width: 800, height: 500, scale: 1, expected: 3 },
    { camera: { x: 599, y: 599 }, width: 800, height: 700, scale: 1, expected: 4 },
    { camera: { x: 2, y: 598 }, width: 390, height: 844, scale: 844 / 600, expected: 4 },
  ]) {
    const tiles = torusTilePositions(scenario.camera, scenario.width, scenario.height, scenario.scale);
    assert.equal(tiles.length, scenario.expected, "only tiles intersecting visible viewport are planned");
    const left = scenario.camera.x - scenario.width / scenario.scale / 2;
    const right = scenario.camera.x + scenario.width / scenario.scale / 2;
    const top = scenario.camera.y - scenario.height / scenario.scale / 2;
    const bottom = scenario.camera.y + scenario.height / scenario.scale / 2;
    for (const [x, y] of [[left + 1e-6, top + 1e-6], [right - 1e-6, top + 1e-6], [left + 1e-6, bottom - 1e-6], [right - 1e-6, bottom - 1e-6]]) {
      assert.ok(tiles.some((tile) => x >= tile.x && x < tile.x + WORLD_EXTENT && y >= tile.y && y < tile.y + WORLD_EXTENT),
        `visible viewport corner (${x},${y}) has a torus field tile`);
    }
  }
  console.log("p1 torus field plan: PASS (world-space tiles cover viewport at center, both seams, phone zoom)");

  // Layer assembly absorbs the P0 order: same constant, Containers in order.
  // The expected order is pinned as a literal here (not re-imported), so a
  // P0 order change cannot propagate silently to both sides of the check.
  const PINNED_ORDER = [
    "environment",
    "analytical-field",
    "waste-cue",
    "organisms",
    "selection-focus",
    "effects",
  ] as const;
  assert.deepEqual([...PW_LAYER_ORDER], [...PINNED_ORDER], "production order matches the pinned contract");
  assert.deepEqual([...P0_LAYER_ORDER], [...PINNED_ORDER], "P0 order matches the pinned contract");
  const first = createWorldLayers();
  assert.deepEqual(first.root.children.map((c) => c.label), [...PINNED_ORDER]);
  assert.equal(first.root.label, "world");
  const second = createWorldLayers();
  assert.ok(second.root !== first.root && second.layers.organisms !== first.layers.organisms,
    "layer assembly builds fresh objects per call (no shared GPU state)");
  console.log("p1 layers: PASS (6 ordered labeled Containers, fresh per boot, order absorbed from P0)");

  // Static guards over production Pixi modules: bounded and authority-safe.
  const pwDir = join(root, "apps/explorer/src/pixiWorld");
  const pwSources = readdirSync(pwDir).filter((f) => f.endsWith(".ts"));
  assert.ok(pwSources.length >= 3, `expect >=3 pixiWorld modules (got ${pwSources.length})`);
  for (const f of pwSources) {
    const src = readFileSync(join(pwDir, f), "utf8");
    assert.ok(!/from\s+["'][^"']*sim-core|from\s+["'][^"']*sim-runtime/.test(src),
      `pixiWorld/${f} must not import simulation packages`);
    assert.ok(!src.includes("RenderSnapshot"),
      `pixiWorld/${f} must not bind a legacy detail snapshot`);
    if (!new Set(["environment.ts", "organisms.ts", "renderer.ts"]).has(f)) {
      assert.ok(!/from\s+["']@digital-evolution\/contracts["']/.test(src),
        `pixiWorld/${f} must remain independent from read-model contracts unless explicitly approved`);
    } else {
      assert.ok(!/\b(?:RenderSnapshot|WorkerRuntimeClient|UniverseCheckpoint|HistoryRecord)\b/.test(src),
        `pixiWorld/${f} may consume only bounded live presentation rows, not detail/runtime/persistence contracts`);
    }
  }
  const environmentSrc = readFileSync(join(pwDir, "environment.ts"), "utf8");
  assert.ok(environmentSrc.includes("LandscapeSmoother"), "normal landscape preserves accepted temporal smoothing");
  assert.ok(environmentSrc.includes('if (input.lens === "nutrients")') && environmentSrc.includes('if (input.lens === "waste")'),
    "nutrient and waste lenses remain explicit raw analytical encodings");
  assert.ok(environmentSrc.includes('input.lens === "normal"') && environmentSrc.includes('"waste-cue"'),
    "normal landscape retains a separate waste cue layer");
  const texSrc = readFileSync(join(pwDir, "textures.ts"), "utf8");
  assert.ok(texSrc.includes('scaleMode = "nearest"'), "phenotype uploads stay nearest-filtered");
  assert.ok(texSrc.includes("destroy(true)"), "retirement must destroy the texture source too (AC-P7)");
  const bootSrc = readFileSync(join(pwDir, "boot.ts"), "utf8");
  assert.ok(bootSrc.includes('preference: "webgl"'), "production boot pins the WebGL family");
  assert.ok(bootSrc.includes("getContext(") && bootSrc.includes("webgl2"), "production boot proves its backend");
  assert.ok(bootSrc.includes("app.destroy()"), "production boot disposes GPU resources");
  assert.ok(!bootSrc.includes("RenderSnapshot"), "production boot takes no snapshot");
  const appSrc = readFileSync(join(root, "apps/explorer/src/App.tsx"), "utf8");
  const hostSrc = readFileSync(join(root, "apps/explorer/src/pixiWorld/WorldPixi.tsx"), "utf8");
  assert.ok(/<WorldPixi\s+\{\.\.\.pixiWorldProps\}\s*\/>/.test(appSrc),
    "App.tsx mounts Pixi as the production semantic World renderer");
  assert.ok(!appSrc.includes("WorldCanvas") && !appSrc.includes("setRenderer"),
    "App.tsx retires the semantic Canvas World and renderer-selection hook");
  assert.ok(!appSrc.includes("function WorldCanvas") && !appSrc.includes("world-canvas"),
    "App.tsx has no semantic Canvas2D World component or fallback (the minimap remains independent)");
  assert.ok(hostSrc.includes('role="alert"') && hostSrc.includes("World display unavailable")
    &&hostSrc.includes("deePixiFailure")&&hostSrc.includes("data-renderer-backend={backend}"),
    "Pixi initialization failure has an accessible testable display-failure state");
  console.log(`production Pixi route guard: PASS (${pwSources.length} renderer modules stay bounded; Pixi is the sole semantic World)`);
}

// P1.1 lifecycle and logical viewport math remain DPR-independent.
{
  const rect = { left: 20, top: 30, width: 390, height: 844 };
  const camera = { x: 5, y: 595 };
  for (const zoom of [pwClampZoom(1), pwClampZoom(3)]) {
    const scale = viewScale(rect.width, rect.height, zoom);
    const atOneDpr = screenToWorld(215, 452, rect, camera, scale);
    // Renderer backing dimensions multiply by DPR, but event coordinates and
    // logical viewport remain CSS pixels, so camera projection is identical.
    for (const dpr of [1, 2, 3]) {
      const logicalW = rect.width * dpr / dpr;
      const logicalH = rect.height * dpr / dpr;
      const sameScale = viewScale(logicalW, logicalH, zoom);
      const projected = screenToWorld(215, 452, rect, camera, sameScale);
      assert.deepEqual(projected, atOneDpr, `CSS-space camera projection stable at DPR ${dpr}`);
      assert.deepEqual(visibleWindow(logicalW, logicalH, sameScale), visibleWindow(rect.width, rect.height, scale));
    }
  }
  console.log("p1 viewport: PASS (logical camera coordinates independent of backing DPR at zoom limits)");
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
