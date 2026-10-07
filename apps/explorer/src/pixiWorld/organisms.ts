import type { RenderOrganism } from "@digital-evolution/contracts";
import type { LodTier, ResolvedPhenotype } from "@digital-evolution/phenotype";
import { Container, Graphics, Sprite, Texture } from "pixi.js";
import { renderPhenotypeGrid } from "@digital-evolution/phenotype";
import { toTextureRequests } from "../pixi/adapter";
import { PhenotypeTextureCache } from "../pixi/textureCache";
import type { Lens, TraitView } from "../worldViewTypes";
import { organismColor, dormantChannel } from "../organismEncoding";
import { destroyTexture, textureFromPixels } from "./textures";
import { PHENOTYPE_CELL_FRACTION, PHENOTYPE_FOOTPRINT_REFERENCE_SIZE } from "../phenotype";

export interface OrganismTextureResource {
  readonly texture: Texture;
  readonly pixels: "rich-rgba" | "legacy-grid";
  destroy(): void;
}

export type OrganismTextureFactory = (bits: string, size: number, rgba?: Uint8Array) => OrganismTextureResource;

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

export interface OrganismRasterEvidence {
  readonly organismId: number;
  readonly family: string;
  readonly tier: LodTier;
  readonly key: string;
  readonly pixels: "rich-rgba" | "legacy-grid";
}

interface DisplayRecord {
  readonly sprite: Sprite;
  readonly voxel: Graphics;
  textureKey: string | null;
  voxelSignature: string | null;
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
const rasterEvidence = new WeakMap<Container, OrganismRasterEvidence[]>();

export function inspectOrganismRasters(layer: Container): readonly OrganismRasterEvidence[] {
  return rasterEvidence.get(layer) ?? [];
}

function resourceFor(entry: { readonly bits: string; readonly rgba?: Uint8Array; readonly size: number }): OrganismTextureResource {
  const texture = textureFromPixels(entry.bits, entry.rgba, entry.size);
  return { texture, pixels: entry.rgba ? "rich-rgba" : "legacy-grid", destroy: () => destroyTexture(texture) };
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

function drawVoxel(
  graphic: Graphics,
  organism: RenderOrganism,
  lens: Lens,
  traitView: TraitView,
  traitRange: [number, number],
  scale: number,
): void {
  graphic.clear();
  const dormant = organism.activity === "dormant";
  const span = dormant ? 2 : organism.energy > 120 ? 4 : organism.energy > 60 ? 3 : 2;
  const unit = Math.max(2, scale * 2.2);
  let hash = Math.imul(organism.id, 2654435761) ^ 0x9e3779b9;
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x85ebca6b) >>> 0;
  const color = cssColorToTint(organismColor(organism as never, lens, traitView, traitRange));
  for (let gy = 0; gy < span; gy++) {
    for (let gx = 0; gx < span; gx++) {
      const edge = gx === 0 || gy === 0 || gx === span - 1 || gy === span - 1;
      let solid = true;
      if (edge) {
        if (organism.diet < -0.25) solid = ((hash >> ((gy * span + gx) % 24)) & 1) === 1;
        else if (organism.diet > 0.25) solid = true;
        else solid = ((gx * 7 + gy * 13 + (hash & 3)) & 3) !== 0;
      }
      if (!solid) continue;
      const x = (gx - span / 2) * unit;
      const y = (gy - span / 2) * unit;
      const cell = graphic.rect(x, y, unit, unit);
      if (dormant) cell.stroke({ color, width: 1 });
      else cell.fill({ color });
    }
  }
}

export function updateOrganismLayer(
  layer: Container,
  input: OrganismInput,
  createTexture?: OrganismTextureFactory,
): OrganismMetrics {
  const evidence: OrganismRasterEvidence[] = [];
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

  const requests = toTextureRequests(input.organisms, input.resolvedPhenotypes, input.tier);
  const requestById = new Map(requests.map((request) => [request.organismId, request]));
  const liveIds = new Set<number>(input.organisms.map((organism) => Number(organism.id)));

  for (const [id, record] of state.displays) {
    if (liveIds.has(id)) continue;
    layer.removeChild(record.sprite);
    layer.removeChild(record.voxel);
    record.sprite.texture = Texture.EMPTY;
    record.sprite.destroy();
    record.voxel.destroy();
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
    const id = organism.id;
    let display = state.displays.get(id);
    if (!display) {
      const sprite = new Sprite(Texture.EMPTY);
      sprite.anchor.set(0.5);
      const voxel = new Graphics();
      display = { sprite, voxel, textureKey: null, voxelSignature: null };
      state.displays.set(id, display);
      layer.addChild(sprite);
      layer.addChild(voxel);
      state.displayCreates++;
    }
    if (request && display.textureKey !== request.key) {
      const phenotype = input.resolvedPhenotypes.get(request.organismId)!;
      const cacheEntry = state.cache.acquire(phenotype, input.tier, request.activity);
      let gpu = state.textures.get(cacheEntry.key);
      if (!gpu) {
        const textureResource = createTexture
          ? createTexture(cacheEntry.bits, cacheEntry.size, cacheEntry.rgba)
          : resourceFor(cacheEntry);
        gpu = { resource: textureResource, users: 0 };
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
      evidence.push({
        organismId: request.organismId,
        family: phenotype.family,
        tier: input.tier,
        key: cacheEntry.key,
        pixels: cacheEntry.rgba ? "rich-rgba" : "legacy-grid",
      });
    }

    const resolved = input.resolvedPhenotypes.get(id);
    const tint = organismColor(organism as never, input.lens, input.traitView, input.traitRange);
    display.sprite.tint = display.textureKey && state.textures.get(display.textureKey)?.resource.pixels === "rich-rgba"
      ? 0xffffff
      : cssColorToTint(tint);
    display.sprite.alpha = dormantChannel(organism as never).alpha;
    display.sprite.position.set(organism.x, organism.y);
    if (request && resolved) {
      const grid = renderPhenotypeGrid(resolved, input.tier, request.activity);
      const cell = input.tier === "ecosystem"
        ? (PHENOTYPE_FOOTPRINT_REFERENCE_SIZE * 2.2 * PHENOTYPE_CELL_FRACTION.ecosystem) / grid.size
        : Math.max(2, 2.2 * PHENOTYPE_CELL_FRACTION[input.tier]);
      display.sprite.width = grid.size * cell;
      display.sprite.height = display.sprite.width;
      evidence.push({
        organismId: id,
        family: resolved.family,
        tier: input.tier,
        key: request.key,
        pixels: input.tier !== "ecosystem" && resolved.family === "plated" ? "rich-rgba" : "legacy-grid",
      });
    }
    display.sprite.visible = input.lens === "normal" && !!request && !!resolved;
    const voxelSignature = [
      organism.id, organism.activity, organism.energy, organism.diet, input.lens,
      input.traitView, input.traitRange[0], input.traitRange[1], input.scale,
      cssColorToTint(tint),
    ].join("/");
    if (display.voxelSignature !== voxelSignature) {
      drawVoxel(display.voxel, organism, input.lens, input.traitView, input.traitRange, input.scale);
      display.voxelSignature = voxelSignature;
    }
    display.voxel.visible = input.lens !== "normal";
    display.voxel.position.set(organism.x, organism.y);
    display.voxel.alpha = dormantChannel(organism as never).alpha;
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
  rasterEvidence.set(layer, evidence);

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
  for (const { sprite, voxel } of state.displays.values()) {
    layer.removeChild(sprite);
    layer.removeChild(voxel);
    sprite.texture = Texture.EMPTY;
    sprite.destroy();
    voxel.destroy();
  }
  for (const gpu of state.textures.values()) gpu.resource.destroy();
  state.displays.clear();
  state.textures.clear();
  state.cache.prune();
  states.delete(layer);
  rasterEvidence.delete(layer);
}
