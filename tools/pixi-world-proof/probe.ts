// Probe entry: boots the INACTIVE production scaffold and exposes a
// string-callable handle for the playwright driver. No RenderSnapshot, no
// runtime, no World activation — the driver asserts lifecycle only.
import { bootPixiWorld, type PixiWorldHandle } from "../../apps/explorer/src/pixiWorld/boot.ts";
import { destroyTexture, textureFromBits } from "../../apps/explorer/src/pixiWorld/textures.ts";
import { LOD_GRID_SIZE, renderPhenotypeGrid, resolvePhenotype } from "../../packages/phenotype/src/index.ts";
import type { Texture } from "pixi.js";
import { createWorldRenderer } from "../../apps/explorer/src/pixiWorld/renderer.ts";
import type { PixiWorldProps } from "../../apps/explorer/src/worldViewTypes.ts";

let handle: PixiWorldHandle | null = null;
let minted: Texture | null = null;
  let repeatedDestroyObserved = false;

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
        backingW: handle.app.canvas.width,
        backingH: handle.app.canvas.height,
        resolution: handle.app.renderer.resolution,
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
      const currentHandle = handle;
      if (currentHandle) {
        currentHandle.destroy();
        currentHandle.destroy();
        repeatedDestroyObserved = true;
      }
      handle?.destroy();
      handle = null;
      return document.getElementById("pixi-world") === null;
    },
    teardownStats: () => ({
      canvasCount: document.querySelectorAll("#pixi-world").length,
      destroyWasRepeated: repeatedDestroyObserved,
    }),
    // Exercise the boot cancellation boundary without involving React. The
    // gate flips while Pixi's async init is in flight; cancelled initialization
    // must not leave a canvas attached to this detached host.
    obsoleteBootProbe: async () => {
      const staleHost = document.createElement("div");
      document.body.appendChild(staleHost);
      let current = true;
      const pending = bootPixiWorld(staleHost, () => current);
      current = false;
      const staleHandle = await pending;
      const result = {
        returnedNull: staleHandle === null,
        attachedCanvasCount: staleHost.querySelectorAll("canvas").length,
      };
      staleHost.remove();
      staleHandle?.destroy();
      return result;
    },
    productionSceneProbe: async (count: number) => {
      if (!Number.isInteger(count) || count < 1 || count > 3000) throw new Error("invalid production scene count");
      const sceneHost = document.createElement("div");
      sceneHost.style.width = "800px";
      sceneHost.style.height = "600px";
      document.body.appendChild(sceneHost);
      const sceneHandle = await bootPixiWorld(sceneHost);
      if (!sceneHandle) throw new Error("unexpected scene boot cancellation");
      const renderer = createWorldRenderer(sceneHandle);
      const organisms = Array.from({ length: count }, (_, i) => ({
        id: i + 1,
        parent: null,
        generation: 0,
        lineageId: i + 1,
        cladeId: i + 1,
        x: (i * 37) % 600,
        y: (i * 71) % 600,
        energy: 80,
        activity: "active" as const,
        speed: 1.5,
        sensing: 70,
        metabolism: 0.2,
        reproduction: 100,
        diet: 0,
        habitat: 0,
        byproductUse: 0,
        dormancyResponse: 1,
        tolerance: 0,
        cleanup: 0,
      }));
      const resolved = new Map(organisms.map((o) => [o.id, resolvePhenotype(o, { parentFamily: null, organismId: o.id, lineageId: o.lineageId })]));
      const env = {
        readModelVersion: 1,
        worldId: 1,
        tick: 5,
        resources: {
          gridSize: 60,
          stock: Array.from({ length: 3 }, (_, k) => Array.from({ length: 3600 }, (_, i) => ((i + k * 11) % 100) / 100)),
          capacity: Array.from({ length: 3 }, () => Array.from({ length: 3600 }, () => 1)),
        },
        waste: { gridSize: 60, stock: Array.from({ length: 3600 }, (_, i) => (i % 7) / 10), capacity: Array.from({ length: 3600 }, () => 1) },
      };
      const props = {
        worldId: 1,
        tick: 5,
        environment: env,
        organisms,
        resolvedPhenotypes: resolved,
        lens: "normal",
        resourceView: "combined",
        traitView: "speed",
        selectedId: null,
        camera: { x: 300, y: 300 },
        zoom: 1,
        onSelect: () => undefined,
        onCamera: () => undefined,
        onView: () => undefined,
      } as unknown as PixiWorldProps;
      renderer.update(props);
      const first = renderer.metrics()!;
      renderer.update({ ...props, tick: 6, organisms: organisms.map((o, i) => ({ ...o, x: (o.x + 17) % 600, y: (o.y + 31) % 600 })) });
      const moved = renderer.metrics()!;
      renderer.destroy();
      const result = {
        count,
        initialLiveDisplays: first.liveDisplayCount,
        movedLiveDisplays: moved.liveDisplayCount,
        initialTextureCreates: first.textureCreates,
        movedTextureCreates: moved.textureCreates,
        textureReuses: moved.textureReuses,
        movementTextureCreateDelta: moved.textureCreates - first.textureCreates,
        remainingCanvasCount: sceneHost.querySelectorAll("canvas").length,
      };
      sceneHost.remove();
      return result;
    },
  };
  (window as unknown as { __pixiworldReady: boolean }).__pixiworldReady = true;
}

main().catch((e) => {
  document.getElementById("stats")!.textContent = `boot-failed: ${String(e)}`;
});
