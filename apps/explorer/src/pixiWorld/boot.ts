/**
 * pixiWorld boot — Application lifecycle with no snapshot input (browser only).
 *
 * Boots the PixiJS v8 Application with the WebGL renderer family, assembles
 * the production layer tree, follows the host element size (same 160-1400px
 * clamp as the Canvas2D stage), and reports genuine backend evidence
 * (renderer class + live WebGL2 probe) for the return package. Takes no
 * snapshot, binds no runtime, renders no organisms yet — environment and
 * organism layers arrive with the read-model-bound slices after the gate.
 * Requires DOM + WebGL: covered by typecheck and browser evidence on CI.
 */

import { Application } from "pixi.js";
import { createWorldLayers, type WorldLayers } from "./layers";

export interface PixiWorldHandle {
  readonly app: Application;
  readonly layers: WorldLayers;
  /** Renderer backend evidence, e.g. "WebGLRenderer/webgl2:yes". */
  readonly backend: string;
  /** Current canvas backing-store size. */
  size(): { w: number; h: number };
  /** Remove listeners, canvases, and GPU resources. */
  destroy(): void;
}

function backendLabel(app: Application): string {
  const ctor = (app.renderer as unknown as { constructor?: { name?: string } }).constructor?.name ?? "unknown";
  let webgl2 = "unknown";
  try {
    webgl2 = app.canvas.getContext("webgl2") ? "yes" : "no";
  } catch {
    webgl2 = "error";
  }
  return `${ctor}/webgl2:${webgl2}`;
}

export async function bootPixiWorld(host: HTMLElement): Promise<PixiWorldHandle> {
  const app = new Application();
  // Accepted production direction: WebGL2 as the initial backend.
  // 'webgl' pins the WebGL renderer family (v8 serves WebGL2 through it);
  // backendLabel() proves what the browser actually provided.
  await app.init({ width: 600, height: 600, background: "#060b0f", antialias: false, preference: "webgl" });
  app.canvas.id = "pixi-world";
  app.canvas.style.display = "block";
  host.appendChild(app.canvas);

  const layers = createWorldLayers();
  app.stage.addChild(layers.root);

  const ro = new ResizeObserver((entries) => {
    const r = entries[0]?.contentRect;
    if (!r) return;
    const w = Math.max(160, Math.min(1400, Math.round(r.width)));
    const h = Math.max(160, Math.min(1400, Math.round(r.height)));
    if (app.canvas.width !== w || app.canvas.height !== h) app.renderer.resize(w, h);
  });
  ro.observe(host);

  const backend = backendLabel(app);
  return {
    app,
    layers,
    backend,
    size: () => ({ w: app.canvas.width, h: app.canvas.height }),
    destroy: () => {
      ro.disconnect();
      app.canvas.remove();
      app.destroy();
    },
  };
}
