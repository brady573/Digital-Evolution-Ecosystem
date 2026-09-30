/**
 * pixiWorld layers — scene-layer Container assembly (no snapshot input).
 *
 * One Container per semantic layer in LAYER_ORDER (later = on top), so
 * analytical meaning always outranks decoration and layers stay separable
 * through migration. The order constant is absorbed from the P0 preparation
 * (`../pixi/layers`); this module only owns the GPU objects. Headless-safe:
 * constructs Containers without DOM or WebGL (asserted in Node).
 */

import { Container } from "pixi.js";
import { LAYER_ORDER, WORLD_EXTENT, type PixiWorldLayer } from "../pixi/layers";

export { LAYER_ORDER, WORLD_EXTENT, type PixiWorldLayer };

export interface WorldLayers {
  readonly root: Container;
  readonly layers: Record<PixiWorldLayer, Container>;
}

export function createWorldLayers(): WorldLayers {
  const root = new Container();
  root.label = "world";
  const layers = {} as Record<PixiWorldLayer, Container>;
  for (const name of LAYER_ORDER) {
    const c = new Container();
    c.label = name;
    layers[name] = c;
    root.addChild(c);
  }
  return { root, layers };
}
