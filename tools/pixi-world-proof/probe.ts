// Probe entry: boots the production Pixi modules in isolation and exposes a
// string-callable handle for the playwright driver. No RenderSnapshot, no
// runtime, no World activation — the driver asserts lifecycle only.
import { bootPixiWorld, type PixiWorldHandle } from "../../apps/explorer/src/pixiWorld/boot.ts";
import { destroyTexture, textureFromBits } from "../../apps/explorer/src/pixiWorld/textures.ts";
import { LOD_GRID_SIZE, renderPhenotypeGrid, resolvePhenotype } from "../../packages/phenotype/src/index.ts";
import type { Texture } from "pixi.js";
import { createWorldRenderer } from "../../apps/explorer/src/pixiWorld/renderer.ts";
import type { PixiWorldProps } from "../../apps/explorer/src/worldViewTypes.ts";
import { Sprite, Graphics } from "pixi.js";
import { selectAtScreenPoint } from "../../apps/explorer/src/pixiWorld/interaction.ts";
import { viewScale } from "../../apps/explorer/src/pixiWorld/camera.ts";

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
      const waitForSize = async (width: number, height: number) => {
        const start = performance.now();
        while (performance.now() - start < 2000) {
          const size = sceneHandle.size();
          if (size.w === width && size.h === height) return size;
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        }
        throw new Error(`Pixi host resize not observed: wanted ${width}x${height}, got ${JSON.stringify(sceneHandle.size())}`);
      };
      await waitForSize(800, 600);
      const renderer = createWorldRenderer(sceneHandle);
      const reportedViews: Array<{ w: number; h: number }> = [];
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
        onView: (view: { w: number; h: number }) => reportedViews.push(view),
      } as unknown as PixiWorldProps;
      renderer.update(props);
      const first = renderer.metrics()!;
      const firstOrganismDisplays = first.organisms.displayCreates;
      const pannedProps = { ...props, camera: { x: 599, y: 599 } } as PixiWorldProps;
      renderer.update(pannedProps);
      const panned = renderer.metrics()!;
      sceneHost.style.height = "500px";
      const resizedHost = await waitForSize(800, 500);
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const resized = renderer.metrics()!;
      const rect = sceneHandle.app.canvas.getBoundingClientRect();
      const selectionChecks = [1, 3].map((zoom) => {
        const camera = { x: 599, y: 300 };
        const scale = viewScale(rect.width, rect.height, zoom);
        const seamOrganism = [{ id: 707, x: 2, y: 300 }];
        return {
          zoom,
          hit25: selectAtScreenPoint(rect.left + rect.width / 2 + 25, rect.top + rect.height / 2, rect, camera, scale,
            [{ id: 707, x: camera.x, y: camera.y }]),
          miss27: selectAtScreenPoint(rect.left + rect.width / 2 + 27, rect.top + rect.height / 2, rect, camera, scale,
            [{ id: 707, x: camera.x, y: camera.y }]),
          seamIdentity: selectAtScreenPoint(rect.left + rect.width / 2, rect.top + rect.height / 2, rect, camera, scale, seamOrganism),
        };
      });
      renderer.update({ ...pannedProps, tick: 6, organisms: organisms.map((o, i) => ({ ...o, x: (o.x + 17) % 600, y: (o.y + 31) % 600 })) } as unknown as PixiWorldProps);
      const moved = renderer.metrics()!;
      const organismLayer = sceneHandle.layers.layers.organisms;
      const selectedId = organisms[0]!.id;
      const phenotypeSprite = organismLayer.children[0] as Sprite;
      const morphologyTexture = phenotypeSprite.texture;
      const lensResults: Array<{ lens: string; visibleTextureCount: number; textureCreates: number; liveDisplays: number }> = [];
      for (const lens of ["nutrients", "waste", "clades", "traits"] as const) {
        renderer.update({ ...pannedProps, lens, selectedId } as PixiWorldProps);
        const lensMetrics = renderer.metrics()!;
        const voxel = organismLayer.children[1] as Graphics;
        if (phenotypeSprite.visible || !voxel.visible || phenotypeSprite.texture !== morphologyTexture) {
          throw new Error(`${lens} lens changed phenotype identity or failed to show analytical voxel presentation`);
        }
        lensResults.push({
          lens,
          visibleTextureCount: lensMetrics.organisms.liveTextures,
          textureCreates: lensMetrics.organisms.textureCreates,
          liveDisplays: lensMetrics.organisms.liveDisplayCount,
        });
      }
      const focusLayer = sceneHandle.layers.layers["selection-focus"];
      const focusVisible = focusLayer.children[0]?.visible === true;
      renderer.update(pannedProps);
      const restoredNormalPhenotype = phenotypeSprite.visible && phenotypeSprite.texture === morphologyTexture;
      const dormantRows = organisms.map((organism, index) => index === 0 ? { ...organism, activity: "dormant" as const } : organism);
      renderer.update({ ...pannedProps, lens: "traits", organisms: dormantRows } as unknown as PixiWorldProps);
      const dormantVoxel = organismLayer.children[1] as Graphics;
      const dormantAnalyticalAlpha = dormantVoxel.alpha;
      const beforeReplacementDisplays = moved.organisms.liveDisplayCount;
      const replacementProps = {
        ...pannedProps,
        worldId: 2,
        environment: { ...env, worldId: 2 },
        organisms: organisms.slice(0, Math.max(1, Math.floor(count / 2))).map((o) => ({ ...o, id: o.id + 10000 })),
        resolvedPhenotypes: new Map(organisms.slice(0, Math.max(1, Math.floor(count / 2))).map((o) => [o.id + 10000, resolved.get(o.id)!])),
      } as unknown as PixiWorldProps;
      renderer.update(replacementProps);
      const replaced = renderer.metrics()!;
      const afterReplacementTextures = replaced.organisms.liveTextures;
      renderer.destroy();
      const result = {
        count,
        initialLiveDisplays: first.organisms.liveDisplayCount,
        movedLiveDisplays: moved.organisms.liveDisplayCount,
        initialTextureCreates: first.organisms.textureCreates,
        movedTextureCreates: moved.organisms.textureCreates,
        textureReuses: moved.organisms.textureReuses,
        movementTextureCreateDelta: moved.organisms.textureCreates - first.organisms.textureCreates,
        movementDisplayCreateDelta: moved.organisms.displayCreates - firstOrganismDisplays,
        movementDisplayCountBefore: first.organisms.liveDisplayCount,
        movementDisplayCountAfter: moved.organisms.liveDisplayCount,
        analyticalLensResults: lensResults,
        focusVisible,
        restoredNormalPhenotype,
        selectionChecks,
        dormantAnalyticalAlpha,
        worldReplacementDisplayCountBefore: beforeReplacementDisplays,
        worldReplacementDisplayCountAfter: replaced.organisms.liveDisplayCount,
        worldReplacementLiveTextures: afterReplacementTextures,
        worldReplacementTextureCreates: replaced.organisms.textureCreates,
        initialEnvironmentTextureCreates: first.environment.textureCreates,
        pannedEnvironmentTextureCreates: panned.environment.textureCreates,
        pannedEnvironmentRebuilt: panned.environment.rebuilt,
        initialEnvironmentTiles: first.environment.tileCount,
        pannedEnvironmentTiles: panned.environment.tileCount,
        initialWasteCueTextureCreates: first.environment.wasteCueTextureCreates,
        pannedWasteCueTextureCreates: panned.environment.wasteCueTextureCreates,
        movedEnvironmentTextureCreates: moved.environment.textureCreates,
        resizedEnvironmentTextureCreates: resized.environment.textureCreates,
        resizedCanvas: resizedHost,
        reportedViews,
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
