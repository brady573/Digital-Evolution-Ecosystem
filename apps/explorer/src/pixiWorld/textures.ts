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
}

/** Mint one nearest-filtered GPU texture from grid bits. Caller destroys it. */
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

/** Destroy a minted texture, freeing GPU memory. removeChild alone never does. */
export function destroyTexture(tex: Texture): void {
  tex.destroy();
}
