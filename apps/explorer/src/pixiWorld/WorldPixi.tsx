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
    void bootPixiWorld(host, () => current).then((next) => {
      if (!current) {
        next?.destroy();
        return;
      }
      ownedHandle = next;
      if (next) {
        ownedRenderer = createWorldRenderer(next);
        rendererRef.current = ownedRenderer;
        ownedRenderer.update(latestPropsRef.current);
        setBackend(next.backend);
      }
    }).catch((error: unknown) => {
      if (current) {
        setBackend("failed");
        console.error("Pixi World failed to initialize", error);
      }
    });

    return () => {
      current = false;
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

  return <div ref={hostRef} className="world-pixi-host" role="img" aria-label="Evolution world" data-renderer-backend={backend} />;
}
