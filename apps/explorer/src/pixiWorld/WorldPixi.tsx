import { useEffect, useRef, useState, type ReactElement } from "react";
import type { PixiWorldProps } from "../worldViewTypes";
import { bootPixiWorld, type PixiWorldHandle } from "./boot";
import { createWorldRenderer, type WorldRenderer } from "./renderer";

/** React owns only the host lifecycle; renderer input remains bounded/read-only. */
export function WorldPixi(_props: PixiWorldProps): ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  const latestPropsRef = useRef(_props);
  const rendererRef = useRef<WorldRenderer | null>(null);
  const [backend, setBackend] = useState("initializing");
  latestPropsRef.current = _props;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let current = true;
    let ownedHandle: PixiWorldHandle | null = null;
    let ownedRenderer: WorldRenderer | null = null;
    let removeContextListeners = () => {};
    const params = new URLSearchParams(window.location.search);
    const forceTestFailure = params.has("deeTest") && params.has("deePixiFailure");
    const boot = forceTestFailure
      ? Promise.reject(new Error("test-only Pixi initialization failure"))
      : bootPixiWorld(host, () => current);
    void boot.then((next) => {
      if (!current) {
        next?.destroy();
        return;
      }
      ownedHandle = next;
      if (next) {
        const canvas = next.app.canvas;
        const onContextLost = (event: Event) => {
          event.preventDefault();
          if (current) setBackend("failed");
        };
        const onContextRestored = () => {
          if (current) setBackend(next.backend);
        };
        canvas.addEventListener("webglcontextlost", onContextLost);
        canvas.addEventListener("webglcontextrestored", onContextRestored);
        removeContextListeners = () => {
          canvas.removeEventListener("webglcontextlost", onContextLost);
          canvas.removeEventListener("webglcontextrestored", onContextRestored);
        };
        ownedRenderer = createWorldRenderer(next);
        rendererRef.current = ownedRenderer;
        ownedRenderer.update(latestPropsRef.current);
        setBackend(next.backend);
      }
    }).catch((error: unknown) => {
      if (current) {
        removeContextListeners();
        try {
          if (ownedRenderer) ownedRenderer.destroy();
          else ownedHandle?.destroy();
        } catch (cleanupError) {
          console.error("Pixi World failed to release renderer resources", cleanupError);
        }
        ownedRenderer = null;
        ownedHandle = null;
        rendererRef.current = null;
        setBackend("failed");
        console.error("Pixi World failed to initialize", error);
      }
    });

    return () => {
      current = false;
      removeContextListeners();
      ownedRenderer?.destroy();
      if (!ownedRenderer) ownedHandle?.destroy();
      if (rendererRef.current === ownedRenderer) rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    // The first effect closes over a stable boot generation; this effect keeps
    // ordinary React props current without recreating the Pixi application.
    rendererRef.current?.update(_props);
  });

  const failed = backend === "failed";
  return <div
    ref={hostRef}
    className={`world-pixi-host${failed ? " renderer-failed" : ""}`}
    role={failed ? undefined : "img"}
    aria-label={failed ? undefined : "Evolution world"}
    data-renderer-backend={backend}
  >
    {failed && <div className="world-renderer-failure" role="alert">
      <strong>World display unavailable</strong>
      <span>Simulation data and state remain intact. You can continue to use the Explorer controls.</span>
    </div>}
  </div>;
}
