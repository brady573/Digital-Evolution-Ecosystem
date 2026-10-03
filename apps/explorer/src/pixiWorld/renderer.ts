import { TRAIT_DISPLAY_RANGES, type PixiWorldProps } from "../worldViewTypes";
import type { OrganismId } from "@digital-evolution/contracts";
import { viewScale, visibleWindow, wrapCoord, type WorldCamera } from "./camera";
import { selectAtScreenPoint } from "./interaction";
import { updateEnvironmentLayer, destroyEnvironmentLayer, destroyEnvironmentWorld } from "./environment";
import { updateOrganismLayer, destroyOrganismLayer, type OrganismMetrics } from "./organisms";
import type { PixiWorldHandle } from "./boot";
import { Container, Graphics } from "pixi.js";

export interface WorldRenderer {
  update(props: PixiWorldProps): void;
  destroy(): void;
  metrics(): OrganismMetrics | null;
}

export function createWorldRenderer(handle: PixiWorldHandle): WorldRenderer {
  let destroyed = false;
  let currentWorld: number | null = null;
  let lastView = { w: -1, h: -1 };
  let organismMetrics: OrganismMetrics | null = null;
  let lastProps: PixiWorldProps | null = null;
  let pointer: { id: number; x: number; y: number; camera: WorldCamera; moved: boolean } | null = null;
  const focus = new Container();
  focus.label = "selection-focus-marker";
  const focusGraphic = new Graphics();
  focusGraphic.circle(0, 0, 15).stroke({ color: 0xeaffff, width: 1.6 });
  focusGraphic.circle(0, 0, 9.5).stroke({ color: 0x7fe9ff, width: 1 });
  focusGraphic.circle(0, 0, 3).fill({ color: 0x7fe9ff, alpha: 0.18 });
  focus.addChild(focusGraphic);
  handle.layers.layers["selection-focus"].addChild(focus);
  const { root, layers } = handle.layers;

  const reportView = () => {
    const size = handle.size();
    const props = lastProps;
    if (!props || destroyed) return;
    const scale = viewScale(size.w, size.h, props.zoom);
    const view = visibleWindow(size.w, size.h, scale);
    if (view.w === lastView.w && view.h === lastView.h) return;
    lastView = view;
    props.onView(view);
  };

  const resizeObserver = new ResizeObserver(() => reportView());
  resizeObserver.observe(handle.app.canvas.parentElement!);

  const canvas = handle.app.canvas;
  const onPointerDown = (event: PointerEvent) => {
    if (!lastProps) return;
    canvas.setPointerCapture(event.pointerId);
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, camera: lastProps.camera, moved: false };
  };
  const onPointerMove = (event: PointerEvent) => {
    const drag = pointer;
    const props = lastProps;
    if (!drag || !props || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 6) return;
    drag.moved = true;
    const rect = canvas.getBoundingClientRect();
    const scale = viewScale(rect.width, rect.height, props.zoom);
    const next = { x: wrapCoord(drag.camera.x - dx / scale), y: wrapCoord(drag.camera.y - dy / scale) };
    if (next.x !== props.camera.x || next.y !== props.camera.y) props.onCamera(next);
  };
  const onPointerUp = (event: PointerEvent) => {
    const drag = pointer;
    const props = lastProps;
    pointer = null;
    if (!drag || !props || drag.id !== event.pointerId || drag.moved) return;
    const rect = canvas.getBoundingClientRect();
    const scale = viewScale(rect.width, rect.height, props.zoom);
    props.onSelect(selectAtScreenPoint(event.clientX, event.clientY, rect, props.camera, scale, props.organisms) as OrganismId | null);
  };
  const onPointerCancel = () => { pointer = null; };
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerCancel);

  const update = (props: PixiWorldProps): void => {
    if (destroyed) return;
    lastProps = props;
    const world = Number(props.worldId);
    if (currentWorld !== world) {
      if (currentWorld !== null) {
        destroyEnvironmentLayer(layers.environment);
        destroyOrganismLayer(layers.organisms);
        destroyEnvironmentWorld(String(currentWorld));
      }
      currentWorld = world;
      lastView = { w: -1, h: -1 };
    }

    const size = handle.size();
    const scale = viewScale(size.w, size.h, props.zoom);
    root.scale.set(scale);
    root.position.set(size.w / 2 - props.camera.x * scale, size.h / 2 - props.camera.y * scale);

    updateEnvironmentLayer(layers.environment, {
      worldId: String(props.worldId),
      tick: props.tick,
      environment: props.environment,
      lens: props.lens,
      resourceView: props.resourceView,
    });

    organismMetrics = updateOrganismLayer(layers.organisms, {
      worldId: world,
      organisms: props.organisms,
      resolvedPhenotypes: props.resolvedPhenotypes,
      tier: props.zoom < 1.75 ? "ecosystem" : props.zoom < 2.75 ? "population" : "inspection",
      lens: props.lens,
      traitView: props.traitView,
      traitRange: [TRAIT_DISPLAY_RANGES[props.traitView][0], TRAIT_DISPLAY_RANGES[props.traitView][1]],
      selectedId: props.selectedId,
      scale,
    });
    const selected = props.selectedId === null
      ? undefined
      : props.organisms.find((organism) => organism.id === props.selectedId);
    focus.visible = !!selected;
    if (selected) focus.position.set(selected.x, selected.y);
    reportView();
  };

  return {
    update,
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      resizeObserver.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerCancel);
      pointer = null;
      focus.destroy({ children: true });
      destroyEnvironmentLayer(layers.environment);
      destroyOrganismLayer(layers.organisms);
      if (currentWorld !== null) destroyEnvironmentWorld(String(currentWorld));
      handle.destroy();
    },
    metrics: () => organismMetrics,
  };
}
