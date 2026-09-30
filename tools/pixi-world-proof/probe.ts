// Probe entry: boots the INACTIVE production scaffold and exposes a
// string-callable handle for the playwright driver. No RenderSnapshot, no
// runtime, no World activation — the driver asserts lifecycle only.
import { bootPixiWorld, type PixiWorldHandle } from "../../apps/explorer/src/pixiWorld/boot.ts";
import { destroyTexture, textureFromBits } from "../../apps/explorer/src/pixiWorld/textures.ts";
import { LOD_GRID_SIZE, renderPhenotypeGrid, resolvePhenotype } from "../../packages/phenotype/src/index.ts";
import type { Texture } from "pixi.js";

let handle: PixiWorldHandle | null = null;
let minted: Texture | null = null;

function statsText(): string {
  if (!handle) return "no-handle";
  const s = handle.size();
  return (
    `backend=${handle.backend} canvas=${s.w}x${s.h} ` +
    `layers=${handle.layers.root.children.map((c) => c.label).join(",")}`
  );
}

async function main(): Promise<void> {
  const host = document.getElementById("stage") as HTMLElement;
  const statsEl = document.getElementById("stats") as HTMLElement;
  handle = await bootPixiWorld(host);
  statsEl.textContent = statsText();

  (window as unknown as { __pixiworld: unknown }).__pixiworld = {
    stats: () => {
      if (!handle) throw new Error("no handle");
      const s = handle.size();
      return {
        backend: handle.backend,
        canvasW: s.w,
        canvasH: s.h,
        layers: handle.layers.root.children.map((c) => c.label),
      };
    },
    // Resize the host; the boot ResizeObserver propagates to the renderer.
    setStageSize: (w: number, h: number) => {
      host.style.width = `${w}px`;
      host.style.height = `${h}px`;
    },
    // Mint one production texture from real phenotype geometry (blob
    // founder, population tier): deterministic input, nearest output.
    mintProbe: () => {
      const res = resolvePhenotype(
        {
          speed: 1.5, sensing: 70, metabolism: 0.2, reproduction: 100,
          diet: 0, habitat: 0, byproductUse: 0, dormancyResponse: 1.0,
        },
        { parentFamily: null, organismId: 7, lineageId: 7 },
      );
      const g = renderPhenotypeGrid(res, "population", "active");
      if (g.size !== LOD_GRID_SIZE.population) throw new Error(`unexpected grid ${g.size}`);
      const bits = g.cells.map((b) => (b ? "1" : "0")).join("");
      minted = textureFromBits(bits, g.size);
      return { w: minted.width, h: minted.height, scaleMode: minted.source.scaleMode };
    },
    // Retire it through the production path: texture AND source must die.
    // Capture the source first: Texture.destroy() clears its source
    // reference, so the flag must be read from the held object.
    destroyProbe: () => {
      if (!minted) throw new Error("nothing minted");
      const src = minted.source;
      destroyTexture(minted);
      const out = { texDestroyed: minted.destroyed, srcDestroyed: src.destroyed };
      minted = null;
      return out;
    },
    teardown: () => {
      handle?.destroy();
      handle = null;
      return document.getElementById("pixi-world") === null;
    },
  };
  (window as unknown as { __pixiworldReady: boolean }).__pixiworldReady = true;
}

main().catch((e) => {
  document.getElementById("stats")!.textContent = `boot-failed: ${String(e)}`;
});
