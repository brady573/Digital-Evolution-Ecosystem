/**
 * pixiWorld camera — toroidal camera contract (pure, no Pixi import).
 *
 * Behavioral parity with the retired Canvas2D World (`App.tsx`, pre-P1.6) is the
 * point: same 600x600 extent, uniform zoom only (1.0-3.0), wrapped pan with a
 * normalized camera center, constant on-screen hit feel. The wrap primitives
 * are absorbed from the P0 preparation (`../pixi/layers`) so the two cannot
 * drift; the projection helpers preserve the former WorldCanvas transform by
 * line. P1 must keep them aligned, not merely similarly named.
 */

import { WORLD_EXTENT, ZOOM_MAX, ZOOM_MIN, clampZoom, wrapCoord, wrapDelta } from "../pixi/layers";

export { WORLD_EXTENT, ZOOM_MAX, ZOOM_MIN, clampZoom, wrapCoord, wrapDelta };

export interface WorldCamera {
  readonly x: number;
  readonly y: number;
}

export interface ViewRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface TorusTilePosition {
  readonly x: number;
  readonly y: number;
}

/** Tile origins in world space for a viewport rendered beneath the camera root. */
export function torusTilePositions(
  camera: WorldCamera,
  viewWidth: number,
  viewHeight: number,
  scale: number,
): TorusTilePosition[] {
  if (!(scale > 0) || !(viewWidth > 0) || !(viewHeight > 0)) return [];
  const halfWidth = viewWidth / scale / 2;
  const halfHeight = viewHeight / scale / 2;
  const iStart = Math.floor((camera.x - halfWidth) / WORLD_EXTENT);
  const iEnd = Math.ceil((camera.x + halfWidth) / WORLD_EXTENT) - 1;
  const jStart = Math.floor((camera.y - halfHeight) / WORLD_EXTENT);
  const jEnd = Math.ceil((camera.y + halfHeight) / WORLD_EXTENT) - 1;
  const positions: TorusTilePosition[] = [];
  for (let i = iStart; i <= iEnd; i++) {
    for (let j = jStart; j <= jEnd; j++) {
      positions.push({ x: i * WORLD_EXTENT, y: j * WORLD_EXTENT });
    }
  }
  return positions;
}

/**
 * Uniform scale for a stage, never a stretch. Preserves the former WorldCanvas portrait
 * stages fit by height so the world fills the frame; wide stages fit the
 * smaller dimension so the whole 600x600 field shows at the baseline.
 */
export function viewScale(viewW: number, viewH: number, zoom: number): number {
  const fit = viewH > viewW ? viewH / WORLD_EXTENT : Math.min(viewW, viewH) / WORLD_EXTENT;
  return fit * clampZoom(zoom);
}

/** World units -> screen pixels. Preserves the former WorldCanvas toX/toY mapping. */
export function worldToScreen(
  wx: number,
  wy: number,
  cam: WorldCamera,
  scale: number,
  viewW: number,
  viewH: number,
): { x: number; y: number } {
  return { x: viewW / 2 + wrapDelta(wx, cam.x) * scale, y: viewH / 2 + wrapDelta(wy, cam.y) * scale };
}

/**
 * Screen pixels -> world units. Preserves the former WorldCanvas selectAt/viewOf mapping:
 * constant on-screen geometry, so zoom never changes hit feel. Distance
 * checks against organisms stay toroidal at the call site.
 */
export function screenToWorld(
  clientX: number,
  clientY: number,
  rect: ViewRect,
  cam: WorldCamera,
  scale: number,
): { x: number; y: number } {
  return {
    x: wrapCoord(cam.x + (clientX - rect.left - rect.width / 2) / scale),
    y: wrapCoord(cam.y + (clientY - rect.top - rect.height / 2) / scale),
  };
}

/** Visible window in world units. Mirrors the onView report the minimap marks. */
export function visibleWindow(viewW: number, viewH: number, scale: number): { w: number; h: number } {
  return { w: viewW / scale, h: viewH / scale };
}
