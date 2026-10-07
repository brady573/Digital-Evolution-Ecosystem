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

export async function bootPixiWorld(
  host: HTMLElement,
  isCurrent: () => boolean = () => true,
): Promise<PixiWorldHandle | null> {
  if (!isCurrent()) return null;
  const app = new Application();
  let initialized = false;
  let destroyed = false;
  let ro: ResizeObserver | null = null;
  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    ro?.disconnect();
    ro = null;
    // Pixi's canvas getter dereferences its renderer and throws if Application
    // initialization rejected before creating one. Preserve the original boot
    // error and only inspect/destroy renderer-owned resources after init passed.
    if (initialized) {
      app.canvas.remove();
      app.destroy();
    }
  };

  try {
    // Accepted production direction: WebGL2 as the initial backend.
    // 'webgl' pins the WebGL renderer family (v8 serves WebGL2 through it);
    // backendLabel() proves what the browser actually provided.
    await app.init({
      width: 600,
      height: 600,
      resolution: Math.max(1, window.devicePixelRatio || 1),
      autoDensity: true,
      background: "#060b0f",
      antialias: false,
      preference: "webgl",
    });
    initialized = true;
    if (!isCurrent()) {
      destroy();
      return null;
    }

    app.canvas.id = "pixi-world";
    app.canvas.style.display = "block";
    host.appendChild(app.canvas);

    const layers = createWorldLayers();
    app.stage.addChild(layers.root);

    ro = new ResizeObserver((entries) => {
      if (destroyed) return;
      const r = entries[0]?.contentRect;
      if (!r) return;
      const w = Math.max(160, Math.min(1400, Math.round(r.width)));
      const h = Math.max(160, Math.min(1400, Math.round(r.height)));
      if (app.canvas.clientWidth !== w || app.canvas.clientHeight !== h) app.renderer.resize(w, h);
    });
    ro.observe(host);

    if (!isCurrent()) {
      destroy();
      return null;
    }

    const backend = backendLabel(app);
    return {
      app,
      layers,
      backend,
      size: () => ({ w: app.canvas.clientWidth, h: app.canvas.clientHeight }),
      destroy,
    };
  } catch (error) {
    destroy();
    throw error;
  }
}
