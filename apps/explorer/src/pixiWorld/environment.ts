import type { WorldEnvironmentFrame } from "@digital-evolution/contracts";
import { Container, Sprite, Texture } from "pixi.js";
import { fillEnvironmentFractions, landscapeCell, LandscapeSmoother, microTexture, nutrientOverlayCell, wasteOverlayCell } from "../landscape";
import { environmentIdentity, environmentMatchesWorld, sameNormalFieldInput } from "./environmentIdentity";
import { WORLD_EXTENT } from "./layers";
import { torusTilePositions, type WorldCamera } from "./camera";

export type WorldLens = "normal" | "nutrients" | "waste" | "clades" | "traits";
export type WorldResourceView = "combined" | "a" | "b" | "c";

export interface EnvironmentInput {
  readonly worldId: string;
  readonly tick: number;
  readonly environment: WorldEnvironmentFrame;
  readonly lens: WorldLens;
  readonly resourceView: WorldResourceView;
  readonly camera: WorldCamera;
  readonly viewWidth: number;
  readonly viewHeight: number;
  readonly scale: number;
}

export interface EnvironmentMetrics {
  readonly cellCount: number;
  readonly effectiveTick: number;
  readonly identity: string;
  readonly rebuilt: boolean;
  readonly textureCreates: number;
  readonly wasteCueCells: number;
  readonly wasteCueTextureCreates: number;
  readonly tileCount: number;
}

interface EnvironmentState {
  signature: string;
  texture: Texture;
  textureCreates: number;
  readonly tiles: Sprite[];
}

const stateByLayer = new WeakMap<Container, EnvironmentState>();
const normalSmootherByWorld = new Map<string, LandscapeSmoother>();
const normalFieldByWorld = new Map<string, { liveTick: number; fieldIdentity: string; values: Float32Array }>();
const wasteCueByLayer = new WeakMap<Container, { signature: string; sprites: Sprite[]; texture: Texture; creates: number }>();

function reconcileTiles(
  layer: Container,
  sprites: Sprite[],
  texture: Texture,
  positions: readonly { readonly x: number; readonly y: number }[],
): void {
  while (sprites.length < positions.length) {
    const tile = new Sprite(texture);
    sprites.push(tile);
    layer.addChild(tile);
  }
  while (sprites.length > positions.length) {
    const tile = sprites.pop()!;
    layer.removeChild(tile);
    tile.destroy();
  }
  positions.forEach((position, index) => {
    const tile = sprites[index]!;
    tile.texture = texture;
    tile.position.set(position.x, position.y);
    tile.width = WORLD_EXTENT;
    tile.height = WORLD_EXTENT;
  });
}

export function updateEnvironmentLayer(layer: Container, input: EnvironmentInput): EnvironmentMetrics {
  const { environment: env } = input;
  if (!environmentMatchesWorld(input.worldId, env.worldId)) {
    destroyEnvironmentLayer(layer);
    destroyEnvironmentWorld(String(env.worldId));
    layer.visible = false;
    const cueLayer = layer.parent?.children.find((child) => child.label === "waste-cue") as Container | undefined;
    if (cueLayer) cueLayer.visible = false;
    return {
      cellCount: 0,
      effectiveTick: env.tick,
      identity: environmentIdentity(env, input.lens, input.resourceView),
      rebuilt: false,
      textureCreates: 0,
      wasteCueCells: 0,
      wasteCueTextureCreates: 0,
      tileCount: 0,
    };
  }
  layer.visible = true;
  const grid = env.resources.gridSize;
  const n = grid * grid;
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  const c = new Float32Array(n);
  const waste = new Float32Array(n);
  fillEnvironmentFractions(env, a, b, c, waste);

  let values = { a, b, c, waste };
  if (input.lens === "normal") {
    const worldKey = String(env.worldId);
    const fieldIdentity = `${env.worldId}/${env.tick}/${a.join(",")}/${b.join(",")}/${c.join(",")}/${waste.join(",")}`;
    let smoother = normalSmootherByWorld.get(worldKey);
    if (!smoother) {
      smoother = new LandscapeSmoother(n);
      normalSmootherByWorld.set(worldKey, smoother);
    }
    let cached = normalFieldByWorld.get(worldKey);
    if (!sameNormalFieldInput(cached ?? null, input.tick, fieldIdentity)) {
      cached = {
        liveTick: input.tick,
        fieldIdentity,
        values: Float32Array.from(smoother.advance(`w${env.worldId}`, input.tick, a, b, c, waste, 0.35)),
      };
      normalFieldByWorld.set(worldKey, cached);
    }
    const smoothed = cached!.values;
    const sa = new Float32Array(n), sb = new Float32Array(n), sc = new Float32Array(n), sw = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const j = i * 4;
      sa[i] = smoothed[j]!;
      sb[i] = smoothed[j + 1]!;
      sc[i] = smoothed[j + 2]!;
      sw[i] = smoothed[j + 3]!;
    }
    values = { a: sa, b: sb, c: sc, waste: sw };
  }

  const identity = environmentIdentity(env, input.lens, input.resourceView);
  const signature = `${env.worldId}/${input.lens}/${input.resourceView}/${values.a.join(",")}/${values.b.join(",")}/${values.c.join(",")}/${values.waste.join(",")}`;
  let state = stateByLayer.get(layer);
  let rebuilt = false;
  let wasteCueTextureCreates = 0;

  if (!state || state.signature !== signature) {
    const pixels = new Uint8Array(n * 4);
    let wasteCueCells = 0;
    for (let i = 0; i < n; i++) {
      let rgb: readonly [number, number, number];
      if (input.lens === "nutrients") {
        const value = input.resourceView === "a" ? a[i]! : input.resourceView === "b" ? b[i]! : input.resourceView === "c" ? c[i]! : (a[i]! + b[i]! + c[i]!) / 3;
        rgb = nutrientOverlayCell(input.resourceView === "a" ? 0 : input.resourceView === "b" ? 1 : input.resourceView === "c" ? 2 : 3, value);
      } else if (input.lens === "waste") {
        rgb = wasteOverlayCell(waste[i]!);
      } else if (input.lens === "normal") {
        rgb = landscapeCell(values.a[i]!, values.b[i]!, values.c[i]!, values.waste[i]!, microTexture(i));
        if (values.waste[i]! >= 0.18) wasteCueCells++;
      } else {
        // Clades and traits are encoded on organisms, not the environment.
        // Transparent field pixels avoid suggesting nonexistent categories.
        rgb = [0, 0, 0];
      }
      const p = i * 4;
      pixels[p] = rgb[0];
      pixels[p + 1] = rgb[1];
      pixels[p + 2] = rgb[2];
      pixels[p + 3] = input.lens === "clades" || input.lens === "traits" ? 0 : 255;
    }

    const canvas = document.createElement("canvas");
    canvas.width = grid;
    canvas.height = grid;
    const context = canvas.getContext("2d", { willReadFrequently: false });
    if (!context) throw new Error("2D canvas unavailable for Pixi environment texture upload");
    context.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer), grid, grid), 0, 0);
    const texture = Texture.from(canvas);
    texture.source.scaleMode = input.lens === "normal" ? "linear" : "nearest";

    if (state) {
      for (const tile of state.tiles) tile.texture = Texture.EMPTY;
      state.texture.destroy(true);
      state.texture = texture;
      state.signature = signature;
      state.textureCreates++;
    } else {
      state = { signature, texture, textureCreates: 1, tiles: [] };
      stateByLayer.set(layer, state);
    }
    rebuilt = true;
  }

  const tilePositions = torusTilePositions(input.camera, input.viewWidth, input.viewHeight, input.scale);
  if (state) reconcileTiles(layer, state.tiles, state.texture, tilePositions);

  if (input.lens === "normal") {
    const cueLayer = (layer.parent?.children.find((child) => child.label === "waste-cue") as Container | undefined);
    if (cueLayer) {
      cueLayer.visible = true;
      const cueSignature = `${env.worldId}/${values.waste.join(",")}`;
      const cueState = wasteCueByLayer.get(cueLayer);
      if (!cueState || cueState.signature !== cueSignature) {
        const cueResolution = grid * 8;
        const pixels = new Uint8ClampedArray(cueResolution * cueResolution * 4);
        const cellPixels = cueResolution / grid;
        for (let i = 0; i < n; i++) {
          const load = values.waste[i]!;
          if (load < 0.18) continue;
          const dots = 1 + Math.min(3, Math.floor((load - 0.18) * 4));
          const cellX = (i % grid) * cellPixels;
          const cellY = Math.floor(i / grid) * cellPixels;
          for (let k = 0; k < dots; k++) {
            const px = cellX + Math.max(0, Math.min(cellPixels - 1, Math.floor((microTexture(i * 8 + k) * 0.5 + 0.25) * cellPixels)));
            const py = cellY + Math.max(0, Math.min(cellPixels - 1, Math.floor((microTexture(i * 13 + k) * 0.5 + 0.25) * cellPixels)));
            const p = (py * cueResolution + px) * 4;
            pixels[p] = 58;
            pixels[p + 1] = 48;
            pixels[p + 2] = 40;
            pixels[p + 3] = Math.round((0.06 + 0.035 * dots) * 255);
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = cueResolution;
        canvas.height = cueResolution;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("2D canvas unavailable for waste cue upload");
        ctx.putImageData(new ImageData(pixels, cueResolution, cueResolution), 0, 0);
        const texture = Texture.from(canvas);
        texture.source.scaleMode = "nearest";
        if (cueState) {
          for (const sprite of cueState.sprites) sprite.texture = Texture.EMPTY;
          cueState.texture.destroy(true);
          wasteCueTextureCreates = cueState.creates + 1;
          reconcileTiles(cueLayer, cueState.sprites, texture, tilePositions);
          wasteCueByLayer.set(cueLayer, { signature: cueSignature, sprites: cueState.sprites, texture, creates: wasteCueTextureCreates });
        } else {
          const sprites: Sprite[] = [];
          reconcileTiles(cueLayer, sprites, texture, tilePositions);
          wasteCueTextureCreates = 1;
          wasteCueByLayer.set(cueLayer, { signature: cueSignature, sprites, texture, creates: 1 });
        }
      } else if (cueState) {
        reconcileTiles(cueLayer, cueState.sprites, cueState.texture, tilePositions);
      }
      wasteCueTextureCreates = wasteCueByLayer.get(cueLayer)?.creates ?? 0;
    }
  } else {
    const cueLayer = layer.parent?.children.find((child) => child.label === "waste-cue") as Container | undefined;
    if (cueLayer) {
      cueLayer.visible = false;
      const cue = wasteCueByLayer.get(cueLayer);
      if (cue) {
        for (const sprite of cue.sprites) {
          sprite.texture = Texture.EMPTY;
          cueLayer.removeChild(sprite);
          sprite.destroy();
        }
        cue.texture.destroy(true);
      }
      wasteCueByLayer.delete(cueLayer);
    }
  }

  return {
    cellCount: n,
    effectiveTick: env.tick,
    identity,
    rebuilt,
    textureCreates: state?.textureCreates ?? 0,
    wasteCueCells: input.lens === "normal" ? waste.filter((v) => v >= 0.18).length : 0,
    wasteCueTextureCreates,
    tileCount: tilePositions.length,
  };
}

export function destroyEnvironmentLayer(layer: Container): void {
  const state = stateByLayer.get(layer);
  if (state) {
    for (const tile of state.tiles) {
      tile.texture = Texture.EMPTY;
      layer.removeChild(tile);
      tile.destroy();
    }
    state.texture.destroy(true);
    stateByLayer.delete(layer);
  }
  const cueLayer = layer.parent?.children.find((child) => child.label === "waste-cue") as Container | undefined;
  if (cueLayer) {
    const cue = wasteCueByLayer.get(cueLayer);
    if (cue) {
      for (const sprite of cue.sprites) {
        sprite.texture = Texture.EMPTY;
        cueLayer.removeChild(sprite);
        sprite.destroy();
      }
      cue.texture.destroy(true);
      wasteCueByLayer.delete(cueLayer);
    }
  }
}

export function destroyEnvironmentWorld(worldId: string): void {
  normalSmootherByWorld.delete(worldId);
  normalFieldByWorld.delete(worldId);
}
