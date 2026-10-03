import { screenToWorld, wrapDelta, type ViewRect, type WorldCamera } from "./camera";

export type OrganismPoint = { readonly id: number; readonly x: number; readonly y: number };

export interface WorldPoint {
  readonly x: number;
  readonly y: number;
}

export function hitTestOrganism(
  point: WorldPoint,
  organisms: readonly OrganismPoint[],
  radiusWorld: number,
): number | null {
  let best: OrganismPoint | null = null;
  let bestDistance = radiusWorld;
  for (const organism of organisms) {
    const dx = wrapDelta(organism.x, point.x);
    const dy = wrapDelta(organism.y, point.y);
    const distance = Math.hypot(dx, dy);
    if (distance <= bestDistance) {
      best = organism;
      bestDistance = distance;
    }
  }
  return best?.id ?? null;
}

export function selectAtScreenPoint(
  clientX: number,
  clientY: number,
  rect: ViewRect,
  camera: WorldCamera,
  scale: number,
  organisms: readonly OrganismPoint[],
): number | null {
  const point = screenToWorld(clientX, clientY, rect, camera, scale);
  return hitTestOrganism(point, organisms, 26 / scale);
}
