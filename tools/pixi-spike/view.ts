/**
 * Pixi spike browser view: texture-backed organism rendering.
 *
 * Pipeline (nothing here invents phenotype meaning):
 *   FixtureOrg.res (from cache.ts fixtures, PR 29 semantics)
 *     -> TextureCache.acquire (exact render key, ref-counted)
 *     -> grid bits -> offscreen canvas -> Pixi Texture (nearest)
 *     -> one PERSISTENT Sprite per organism slot.
 *
 * Production-shaped behavior (review correction): sprites are created once
 * per slot and never rebuilt. Movement updates positions only. Phenotype
 * change (LOD switch, evolution, activity flip) re-maps sprite -> texture
 * with release/acquire; prune() destroys GPU textures with zero users.
 *
 * The comparison pane is a GENUINE browser Canvas2D canvas rendering the same
 * grids through drawGridToCanvas (the real current-renderer path), not Pixi
 * Graphics. Toggle switches visibility; both stay rendered for screenshots.
 */
import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { drawGridToCanvas, renderPhenotypeGrid, type FillSurface, type LodTier } from '../../packages/phenotype/src/index.ts';
import {
  TextureCache,
  churnState,
  designFixture,
  engineLikeFixture,
  evolveFixture,
  moveFixture,
  type Fixture,
} from './cache.ts';

const WORLD = 600;
const CELL_PX: Record<LodTier, number> = { ecosystem: 8, population: 5, inspection: 4 };

function textureFromBits(bits: string, size: number): Texture {
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#e6f2ea';
  for (let i = 0; i < bits.length; i++) {
    if (bits[i]! === '1') ctx.fillRect(i % size, Math.floor(i / size), 1, 1);
  }
  const tex = Texture.from(cv);
  tex.source.scaleMode = 'nearest';
  return tex;
}

export interface SpikeStats {
  fixture: string;
  organisms: number;
  sprites: number;
  liveTextures: number;
  gpuTextures: number;
  reuse: number;
  cumulative: number;
  pruned: number;
  tier: LodTier;
  mode: 'pixi' | 'canvas2d';
  generation: number;
  /** Renderer backend evidence, e.g. "WebGLRenderer/webgl2:yes". */
  backend: string;
}

export interface SpikeHandle {
  app: Application;
  stats(): SpikeStats;
  setTier(t: LodTier): void;
  setMode(m: 'pixi' | 'canvas2d'): void;
  /** Movement: positions only. No sprite is created or destroyed. */
  step(): { spritesReused: number; newTextures: number };
  /** Evolution: phenotype turnover with ref-counted texture lifecycle. */
  evolve(turnover?: number): { replaced: number; live: number; cumulative: number; pruned: number };
  selectAt(wx: number, wy: number): number;
  /**
   * Browser-facing ref-count audit (review correction): repeated same-tier
   * remaps must not inflate user counts, and evolution + prune must retire
   * obsolete textures. Returns a human-readable verdict.
   */
  audit(): string;
}

const FIXTURES: Array<() => Fixture> = [
  () => designFixture('spike-50', 50, 11),
  () => designFixture('spike-250', 250, 12),
  () => designFixture('spike-1000', 1000, 13),
  () => designFixture('spike-3000', 3000, 14),
  () => engineLikeFixture('spike-engine-1000', 1000, 21),
];

/**
 * Backend evidence: the renderer's concrete class plus a genuine WebGL2
 * probe (getContext('webgl2') returns the live context only when the
 * canvas actually runs WebGL2). Reported in stats and boot logs so the
 * return package can state what really ran.
 */
function backendLabel(app: Application): string {
  const ctor = (app.renderer as unknown as { constructor?: { name?: string } })
    .constructor?.name ?? 'unknown';
  let webgl2 = 'unknown';
  try {
    webgl2 = app.canvas.getContext('webgl2') ? 'yes' : 'no';
  } catch {
    webgl2 = 'error';
  }
  return `${ctor}/webgl2:${webgl2}`;
}

export async function bootSpike(host: HTMLElement, fixtureIdx: number, initialTier?: LodTier): Promise<SpikeHandle> {
  const app = new Application();
  // Accepted production direction: WebGL2 as the initial backend.
  // 'webgl' pins the WebGL renderer family (v8 serves WebGL2 through it);
  // backendLabel() below proves what the browser actually provided.
  await app.init({ width: WORLD, height: WORLD, background: '#060b0f', antialias: false, preference: 'webgl' });
  console.info(`[pixi-spike] backend=${backendLabel(app)}`);
  app.canvas.id = 'pixi-world';
  host.appendChild(app.canvas);

  // Genuine Canvas2D comparison pane: same grids, real 2D canvas element.
  const c2d = document.createElement('canvas');
  c2d.id = 'c2d-world';
  c2d.width = WORLD;
  c2d.height = WORLD;
  c2d.style.border = '1px solid #1d2f3a';
  host.appendChild(c2d);

  let fixture = FIXTURES[fixtureIdx]!();
  let tier: LodTier = initialTier ?? 'population';
  let mode: 'pixi' | 'canvas2d' = 'pixi';
  let generation = 0;
  const cache = new TextureCache();
  const textures = new Map<string, Texture>();
  const churn = churnState(4242, 100000);
  const world = new Container();
  app.stage.addChild(world);
  const overlay = new Graphics();
  app.stage.addChild(overlay);
  let selected = -1;

  // Persistent sprite pool: one Sprite per organism slot, created once.
  const sprites: Sprite[] = [];
  const spriteKey: string[] = [];
  for (let i = 0; i < fixture.organisms.length; i++) {
    const spr = new Sprite();
    spr.anchor.set(0.5);
    spr.label = String(i);
    sprites.push(spr);
    spriteKey.push('');
    world.addChild(spr);
  }

  function texFor(key: string, bits: string, size: number): Texture {
    let t = textures.get(key);
    if (!t) {
      t = textureFromBits(bits, size);
      textures.set(key, t);
    }
    return t;
  }

  /** Re-map sprites to current (res, tier, activity). Creates sprites NEVER. */
  function remap(): void {
    const s = CELL_PX[tier]!;
    fixture.organisms.forEach((o, i) => {
      const e = cache.acquire(o.res, tier, o.activity);
      if (spriteKey[i] !== e.key) {
        if (spriteKey[i] !== '') cache.release(spriteKey[i]!);
        spriteKey[i] = e.key;
        sprites[i]!.texture = texFor(e.key, e.bits, e.size);
      } else {
        cache.release(e.key); // unchanged key: neutralize the acquire
      }
      sprites[i]!.position.set(o.x, o.y);
      sprites[i]!.scale.set(s);
      sprites[i]!.alpha = o.activity === 'dormant' ? 0.85 : 1;
    });
    // Destroy GPU textures whose cache entries were pruned.
    for (const [key, tex] of textures) {
      if (!cache.entriesList().some((e) => e.key === key)) {
        tex.destroy();
        textures.delete(key);
      }
    }
    if (selected >= 0 && fixture.organisms[selected]) {
      const o = fixture.organisms[selected]!;
      overlay.clear();
      overlay.rect(o.x - 12, o.y - 12, 24, 24).stroke({ width: 2, color: 0xff5a5a });
    } else {
      overlay.clear();
    }
    drawComparison();
  }

  /** Genuine Canvas2D: same grids through drawGridToCanvas on a real 2D canvas. */
  function drawComparison(): void {
    const ctx = c2d.getContext('2d')!;
    ctx.fillStyle = '#060b0f';
    ctx.fillRect(0, 0, WORLD, WORLD);
    const s = CELL_PX[tier]!;
    ctx.fillStyle = '#e6f2ea';
    for (const o of fixture.organisms) {
      // Cache-neutral read: render bits directly, never touching the cache,
      // so comparison draws cannot inflate texture statistics.
      const g = renderPhenotypeGrid(o.res, tier, o.activity);
      ctx.globalAlpha = o.activity === 'dormant' ? 0.85 : 1;
      drawGridToCanvas(ctx as unknown as FillSurface, g, o.x - (g.size * s) / 2, o.y - (g.size * s) / 2, s);
    }
    ctx.globalAlpha = 1;
  }

  function applyVisibility(): void {
    app.canvas.style.display = mode === 'pixi' ? '' : 'none';
    c2d.style.display = mode === 'canvas2d' ? '' : 'none';
    // Don't burn software-GL frames on a hidden canvas: headless SwiftShader
    // starves the compositor otherwise (proven context-loss logs).
    if (mode === 'pixi') app.ticker.start();
    else app.ticker.stop();
  }

  app.stage.eventMode = 'static';
  app.stage.on('pointerdown', (ev) => {
    const p = ev.global;
    selected = selectAt(p.x, p.y);
    overlay.clear();
    if (selected >= 0 && fixture.organisms[selected]) {
      const o = fixture.organisms[selected]!;
      overlay.rect(o.x - 12, o.y - 12, 24, 24).stroke({ width: 2, color: 0xff5a5a });
    }
  });

  function selectAt(wx: number, wy: number): number {
    let best = -1;
    let bd = Infinity;
    fixture.organisms.forEach((o, i) => {
      const d = (o.x - wx) ** 2 + (o.y - wy) ** 2;
      if (d < bd) { bd = d; best = i; }
    });
    return bd < 900 ? best : -1;
  }

  function stats(): SpikeStats {
    return {
      fixture: fixture.name, organisms: fixture.organisms.length, sprites: sprites.length,
      liveTextures: cache.live(), gpuTextures: textures.size,
      reuse: fixture.organisms.length / Math.max(1, cache.live()),
      cumulative: cache.cumulative, pruned: cache.pruned, tier, mode, generation,
      backend: backendLabel(app),
    };
  }

  remap();
  applyVisibility();
  // eslint-disable-next-line prefer-const
  let handleRef!: SpikeHandle;
  const handle: SpikeHandle = {
    app,
    stats,
    setTier(t: LodTier): void { tier = t; remap(); },
    setMode(m: 'pixi' | 'canvas2d'): void { mode = m; applyVisibility(); drawComparison(); },
    step(): { spritesReused: number; newTextures: number } {
      const beforeObjs = new Set(sprites);
      const beforeCreated = cache.cumulative;
      fixture = moveFixture(fixture, 9000 + generation);
      // Position-only update: same Sprite objects, same textures.
      const s = CELL_PX[tier]!;
      fixture.organisms.forEach((o, i) => {
        sprites[i]!.position.set(o.x, o.y);
        sprites[i]!.scale.set(s);
      });
      drawComparison();
      const reused = sprites.filter((sp) => beforeObjs.has(sp)).length;
      return { spritesReused: reused, newTextures: cache.cumulative - beforeCreated };
    },
    evolve(turnover = 0.05): { replaced: number; live: number; cumulative: number; pruned: number } {
      generation++;
      const { replaced } = evolveFixture(fixture, churn, turnover);
      remap();
      cache.prune();
      // Destroy GPU textures for pruned entries.
      for (const [key, tex] of textures) {
        if (!cache.entriesList().some((e) => e.key === key)) {
          tex.destroy();
          textures.delete(key);
        }
      }
      drawComparison();
      return { replaced, live: cache.live(), cumulative: cache.cumulative, pruned: cache.pruned };
    },
    audit(): string {
      const users = (): number => cache.entriesList().reduce((n, e) => n + e.users, 0);
      const u0 = users();
      remap(); remap(); remap();
      const u1 = users();
      const live0 = cache.live();
      const r = handleRef.evolve(0.05);
      const verdict =
        `remap-neutral=${u0 === u1} (users ${u0}->${u1}) | ` +
        `evolve: replaced=${r.replaced} live=${r.live} (was ${live0}) cum=${r.cumulative} pruned=${r.pruned}`;
      return verdict;
    },
    selectAt(wx: number, wy: number): number {
      selected = selectAt(wx, wy);
      overlay.clear();
      if (selected >= 0 && fixture.organisms[selected]) {
        const o = fixture.organisms[selected]!;
        overlay.rect(o.x - 12, o.y - 12, 24, 24).stroke({ width: 2, color: 0xff5a5a });
      }
      return selected;
    },
  };
  handleRef = handle;
  (window as unknown as { __spike?: SpikeHandle }).__spike = handle;
  return handle;
}
