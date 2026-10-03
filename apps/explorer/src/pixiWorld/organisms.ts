import type { RenderOrganism } from "@digital-evolution/contracts";
import type { LodTier, ResolvedPhenotype } from "@digital-evolution/phenotype";
import { Container, Sprite, Texture } from "pixi.js";
import { renderPhenotypeGrid } from "@digital-evolution/phenotype";
import { toTextureRequests } from "../pixi/adapter";
import { PhenotypeTextureCache } from "../pixi/textureCache";
import type { Lens, TraitView } from "../worldViewTypes";
import { organismColor, dormantChannel } from "../organismEncoding";
import { destroyTexture, textureFromBits } from "./textures";
import { PHENOTYPE_CELL_FRACTION } from "../phenotype";

export interface OrganismTextureResource {
  readonly texture: Texture;
  destroy(): void;
}

export type OrganismTextureFactory = (bits: string, size: number) => OrganismTextureResource;

export interface OrganismInput {
  readonly worldId: number;
  readonly organisms: readonly RenderOrganism[];
  readonly resolvedPhenotypes: ReadonlyMap<number, ResolvedPhenotype>;
  readonly tier: LodTier;
  readonly lens: Lens;
  readonly traitView: TraitView;
  readonly traitRange: [number, number];
  readonly selectedId: number | null;
  readonly scale: number;
}

export interface OrganismMetrics {
  readonly liveDisplayCount: number;
  readonly textureCreates: number;
  readonly textureReuses: number;
  readonly textureReleases: number;
  readonly texturePrunes: number;
  readonly liveTextures: number;
  readonly displayCreates: number;
}

interface DisplayRecord {
  readonly sprite: Sprite;
  textureKey: string | null;
}

interface GpuTextureRecord {
  readonly resource: OrganismTextureResource;
  users: number;
}

interface OrganismLayerState {
  readonly worldId: number;
  readonly cache: PhenotypeTextureCache;
  readonly displays: Map<number, DisplayRecord>;
  readonly textures: Map<string, GpuTextureRecord>;
  displayCreates: number;
  textureCreates: number;
  textureReuses: number;
  textureReleases: number;
  texturePrunes: number;
}

const states = new WeakMap<Container, OrganismLayerState>();

function makeTexture(bits: string, size: number): OrganismTextureResource {
  const texture = textureFromBits(bits, size, "#ffffff");
  return { texture, destroy: () => destroyTexture(texture) };
}

function cssColorToTint(color: string): number {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (hex) return Number.parseInt(hex[1]!, 16);
  const hsl = /^hsl\(([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\)$/i.exec(color);
  if (!hsl) return 0xffffff;
  const h = ((Number(hsl[1]) % 360) + 360) % 360 / 360;
  const s = Number(hsl[2]) / 100;
  const l = Number(hsl[3]) / 100;
  const hue = (p: number, q: number, t0: number): number => {
    let t = t0;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = Math.round(hue(p, q, h + 1 / 3) * 255);
  const g = Math.round(hue(p, q, h) * 255);
  const b = Math.round(hue(p, q, h - 1 / 3) * 255);
  return (r << 16) | (g << 8) | b;
}

export function updateOrganismLayer(
  layer: Container,
  input: OrganismInput,
  createTexture: OrganismTextureFactory = makeTexture,
): OrganismMetrics {
  let state = states.get(layer);
  if (!state || state.worldId !== input.worldId) {
    if (state) destroyOrganismLayer(layer);
    state = {
      worldId: input.worldId,
      cache: new PhenotypeTextureCache(),
      displays: new Map(),
      textures: new Map(),
      displayCreates: 0,
      textureCreates: 0,
      textureReuses: 0,
      textureReleases: 0,
      texturePrunes: 0,
    };
    states.set(layer, state);
  }

  const requests = input.lens === "normal"
    ? toTextureRequests(input.organisms, input.resolvedPhenotypes, input.tier)
    : [];
  const requestById = new Map(requests.map((request) => [request.organismId, request]));
  const organismById = new Map(input.organisms.map((organism) => [organism.id, organism]));
  const liveIds = new Set<number>(input.organisms.map((organism) => Number(organism.id)));

  for (const [id, record] of state.displays) {
    if (liveIds.has(id)) continue;
    layer.removeChild(record.sprite);
    record.sprite.texture = Texture.EMPTY;
    record.sprite.destroy();
    if (record.textureKey) {
      state.cache.release(record.textureKey);
      state.textureReleases++;
      const gpu = state.textures.get(record.textureKey);
      if (gpu) gpu.users--;
    }
    state.displays.delete(id);
  }

  const rows = input.organisms;
  for (const organism of rows) {
    const request = requestById.get(organism.id);
    if (!request && input.lens === "normal") continue;
    const id = organism.id;
    let display = state.displays.get(id);
    if (!display) {
      const sprite = new Sprite(Texture.EMPTY);
      sprite.anchor.set(0.5);
      display = { sprite, textureKey: null };
      state.displays.set(id, display);
      layer.addChild(sprite);
      state.displayCreates++;
    }
    if (request && display.textureKey !== request.key) {
      const cacheEntry = state.cache.acquire(input.resolvedPhenotypes.get(request.organismId)!, input.tier, request.activity);
      let gpu = state.textures.get(cacheEntry.key);
      if (!gpu) {
        gpu = { resource: createTexture(cacheEntry.bits, cacheEntry.size), users: 0 };
        state.textures.set(cacheEntry.key, gpu);
        state.textureCreates++;
      } else state.textureReuses++;
      gpu.users++;
      display.sprite.texture = gpu.resource.texture;
      if (display.textureKey) {
        state.cache.release(display.textureKey);
        state.textureReleases++;
        const previousGpu = state.textures.get(display.textureKey);
        if (previousGpu) previousGpu.users--;
      }
      display.textureKey = cacheEntry.key;
    }

    const resolved = input.resolvedPhenotypes.get(id);
    const tint = organismColor(organism as never, input.lens, input.traitView, input.traitRange);
    display.sprite.tint = cssColorToTint(tint);
    display.sprite.alpha = dormantChannel(organism as never).alpha;
    display.sprite.position.set(organism.x, organism.y);
    if (request && resolved) {
      const grid = renderPhenotypeGrid(resolved, input.tier, request.activity);
      const cell = Math.max(2, 2.2 * PHENOTYPE_CELL_FRACTION[input.tier]);
      display.sprite.width = grid.size * cell;
      display.sprite.height = grid.size * cell;
      display.sprite.visible = true;
    } else {
      const span = organism.activity === "dormant" ? 2 : organism.energy > 120 ? 4 : organism.energy > 60 ? 3 : 2;
      display.sprite.width = span * Math.max(2, input.scale * 2.2);
      display.sprite.height = display.sprite.width;
      display.sprite.visible = true;
      if (dormantChannel(organism as never).hollow) display.sprite.alpha = 0.55;
    }
  }

  const deadKeys = state.cache.prune();
  for (const key of deadKeys) {
    const gpu = state.textures.get(key);
    if (gpu && gpu.users <= 0) {
      gpu.resource.destroy();
      state.textures.delete(key);
      state.texturePrunes++;
    }
  }

  return {
    liveDisplayCount: state.displays.size,
    textureCreates: state.textureCreates,
    textureReuses: state.textureReuses,
    textureReleases: state.textureReleases,
    texturePrunes: state.texturePrunes,
    liveTextures: state.textures.size,
    displayCreates: state.displayCreates,
  };
}

export function destroyOrganismLayer(layer: Container): void {
  const state = states.get(layer);
  if (!state) return;
  for (const { sprite } of state.displays.values()) {
    layer.removeChild(sprite);
    sprite.texture = Texture.EMPTY;
    sprite.destroy();
  }
  for (const gpu of state.textures.values()) gpu.resource.destroy();
  state.displays.clear();
  state.textures.clear();
  state.cache.prune();
  states.delete(layer);
}
