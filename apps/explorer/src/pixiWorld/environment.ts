import type { WorldEnvironmentFrame } from "@digital-evolution/contracts";
import { Container, Sprite, Texture } from "pixi.js";
import { fillEnvironmentFractions, landscapeCell, LandscapeSmoother, microTexture, nutrientOverlayCell, wasteOverlayCell } from "../landscape";
import { environmentIdentity } from "./environmentIdentity";
import { WORLD_EXTENT } from "./layers";
import { landscapeTileLayout } from "../landscape";
import type { WorldCamera } from "./camera";

export type WorldLens = "normal" | "nutrients" | "waste" | "clades" | "traits";
export type WorldResourceView = "combined" | "a" | "b" | "c";

export interface EnvironmentInput {
  readonly worldId: string;
  readonly tick: number;
  readonly environment: WorldEnvironmentFrame;
  readonly lens: WorldLens;
  readonly resourceView: WorldResourceView;
  readonly camera?: WorldCamera;
  readonly viewWidth?: number;
  readonly viewHeight?: number;
  readonly scale?: number;
}

export interface EnvironmentMetrics {
  readonly cellCount: number;
  readonly effectiveTick: number;
  readonly identity: string;
  readonly rebuilt: boolean;
  readonly textureCreates: number;
  readonly wasteCueCells: number;
  readonly wasteCueTextureCreates: number;
}

interface EnvironmentState {
  signature: string;
  readonly sprite: Sprite;
  texture: Texture;
  textureCreates: number;
  readonly tiles: Sprite[];
}

const stateByLayer = new WeakMap<Container, EnvironmentState>();
const normalSmootherByWorld = new Map<string, LandscapeSmoother>();
const wasteCueByLayer = new WeakMap<Container, { signature: string; sprite: Sprite; texture: Texture; creates: number }>();

export function updateEnvironmentLayer(layer: Container, input: EnvironmentInput): EnvironmentMetrics {
  const { environment: env } = input;
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
    let smoother = normalSmootherByWorld.get(worldKey);
    if (!smoother) {
      smoother = new LandscapeSmoother(n);
      normalSmootherByWorld.set(worldKey, smoother);
    }
    const smoothed = smoother.advance(`w${env.worldId}`, input.tick, a, b, c, waste, 0.35);
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
  const signature = `${identity}/${input.lens === "normal" ? input.tick : "exact"}/${values.a.join(",")}/${values.b.join(",")}/${values.c.join(",")}/${values.waste.join(",")}`;
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
      state.sprite.texture = Texture.EMPTY;
      state.texture.destroy(true);
      state.texture = texture;
      state.sprite.texture = texture;
      state.signature = signature;
      state.textureCreates++;
    } else {
      const sprite = new Sprite(texture);
      state = { signature, sprite, texture, textureCreates: 1, tiles: [] };
      stateByLayer.set(layer, state);
    }
    rebuilt = true;
  }

  if (state && input.camera && input.viewWidth && input.viewHeight && input.scale) {
    const layout = landscapeTileLayout(input.camera.x, input.camera.y, input.scale, input.viewWidth, input.viewHeight, WORLD_EXTENT);
    // Sprite copies are presentation-only. Keep one shared exact field texture;
    // remove old copies before placing the viewport-covering torus copies.
    const positions: Array<{ x: number; y: number }> = [];
    for (let i = layout.iStart; i <= layout.iEnd; i++) {
      for (let j = layout.jStart; j <= layout.jEnd; j++) {
        positions.push({ x: layout.baseX + i * layout.periodX, y: layout.baseY + j * layout.periodY });
      }
    }
    while (state.tiles.length < positions.length) {
      const tile = state.tiles.length === 0 ? state.sprite : new Sprite(state.texture);
      tile.width = layout.periodX;
      tile.height = layout.periodY;
      state.tiles.push(tile);
      layer.addChild(tile);
    }
    while (state.tiles.length > positions.length) state.tiles.pop()!.destroy();
    positions.forEach((position, index) => {
      const tile = state!.tiles[index]!;
      tile.texture = state!.texture;
      tile.position.set(position.x, position.y);
      tile.width = layout.periodX;
      tile.height = layout.periodY;
    });
  }

  if (input.lens === "normal") {
    const cueLayer = (layer.parent?.children.find((child) => child.label === "waste-cue") as Container | undefined);
    if (cueLayer) {
      const cueSignature = `${env.worldId}/${env.tick}/${input.tick}/${values.waste.join(",")}`;
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
          cueState.sprite.texture = Texture.EMPTY;
          cueState.texture.destroy(true);
          cueState.sprite.texture = texture;
          wasteCueTextureCreates = cueState.creates + 1;
          wasteCueByLayer.set(cueLayer, { signature: cueSignature, sprite: cueState.sprite, texture, creates: wasteCueTextureCreates });
        } else {
          const sprite = new Sprite(texture);
          sprite.width = WORLD_EXTENT;
          sprite.height = WORLD_EXTENT;
          cueLayer.addChild(sprite);
          wasteCueTextureCreates = 1;
          wasteCueByLayer.set(cueLayer, { signature: cueSignature, sprite, texture, creates: 1 });
        }
      }
      wasteCueTextureCreates = wasteCueByLayer.get(cueLayer)?.creates ?? 0;
    }
  } else {
    const cueLayer = layer.parent?.children.find((child) => child.label === "waste-cue") as Container | undefined;
    if (cueLayer) {
      const cue = wasteCueByLayer.get(cueLayer);
      if (cue) {
        cue.sprite.texture = Texture.EMPTY;
        cue.texture.destroy(true);
        cue.sprite.destroy();
      }
      cueLayer.removeChildren();
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
  };
}

export function destroyEnvironmentLayer(layer: Container): void {
  const state = stateByLayer.get(layer);
  if (state) {
    state.sprite.texture = Texture.EMPTY;
    state.texture.destroy(true);
    for (const tile of state.tiles) {
      tile.texture = Texture.EMPTY;
      tile.destroy();
    }
    if (!state.tiles.includes(state.sprite)) state.sprite.destroy();
    stateByLayer.delete(layer);
  }
  const cueLayer = layer.parent?.children.find((child) => child.label === "waste-cue") as Container | undefined;
  if (cueLayer) {
    const cue = wasteCueByLayer.get(cueLayer);
    if (cue) {
      cue.sprite.texture = Texture.EMPTY;
      cue.texture.destroy(true);
      cue.sprite.destroy();
      wasteCueByLayer.delete(cueLayer);
    }
    cueLayer.removeChildren();
  }
}

export function destroyEnvironmentWorld(worldId: string): void {
  normalSmootherByWorld.delete(worldId);
}
