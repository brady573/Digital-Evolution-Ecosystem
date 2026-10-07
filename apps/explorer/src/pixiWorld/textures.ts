/**
 * pixiWorld textures — phenotype bitmap to GPU Texture upload (browser only).
 *
 * Production shape of the spike's `textureFromBits` (tools/pixi-spike/view.ts):
 * offscreen canvas painted from grid bits, uploaded with nearest scale mode
 * so organism pixel clusters stay crisp — never blurred, never subpixel.
 * Color and alpha stay caller-owned (lens + dormancy channels, as in the
 * Canvas2D World). Lifecycle (acquire/release/prune) is owned by the
 * CPU-side `PhenotypeTextureCache`; this module only mints and destroys the
 * GPU object. Requires DOM canvas + WebGL: covered by typecheck and browser
 * capture evidence on CI, not by Node harnesses.
 */

import { Texture } from "pixi.js";

export interface PhenotypeBitmap {
  readonly bits: string;
  readonly size: number;
  readonly rgba?: Uint8Array;
}

/** Mint one nearest-filtered GPU texture from grid bits. Caller retires it. */
export function textureFromBits(bits: string, size: number, fill = "#e6f2ea"): Texture {
  if (bits.length !== size * size) throw new Error(`bitmap mismatch: ${bits.length} bits for ${size}x${size}`);
  const cv = document.createElement("canvas");
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable for texture upload");
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = fill;
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] === "1") ctx.fillRect(i % size, Math.floor(i / size), 1, 1);
  }
  const tex = Texture.from(cv);
  tex.source.scaleMode = "nearest";
  return tex;
}

/** Mint a nearest-filtered material RGBA texture from a rich Plated raster. */
export function textureFromRgba(rgba: Uint8Array, size: number): Texture {
  if (rgba.length !== size * size * 4) throw new Error(`RGBA mismatch: ${rgba.length} bytes for ${size}x${size}`);
  const cv = document.createElement("canvas");
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable for texture upload");
  const image = ctx.createImageData(size, size);
  image.data.set(rgba);
  ctx.putImageData(image, 0, 0);
  const texture = Texture.from(cv);
  texture.source.scaleMode = "nearest";
  return texture;
}

export function textureFromPixels(bits: string, rgba: Uint8Array | undefined, size: number): Texture {
  return rgba ? textureFromRgba(rgba, size) : textureFromBits(bits, size, "#ffffff");
}

/**
 * Retire a minted texture, freeing GPU memory AND its one-off canvas source.
 * `destroy(true)` matters: these sources exist only for one texture, so
 * retiring the texture without its source would leak GPU backing resources
 * indefinitely (production acceptance AC-P7). removeChild alone never frees.
 */
export function destroyTexture(tex: Texture): void {
  tex.destroy(true);
}
