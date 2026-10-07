import type {
  OrganismId,
  RenderOrganism,
  WorldEnvironmentFrame,
  WorldId,
} from "@digital-evolution/contracts";
import type { ResolvedPhenotype } from "@digital-evolution/phenotype";
import type { WorldCamera } from "./pixiWorld/camera";
export type { WorldCamera } from "./pixiWorld/camera";

export type Lens = "normal" | "nutrients" | "waste" | "clades" | "traits";
export type ResourceView = "combined" | "a" | "b" | "c";
export type TraitView =
  | "speed"
  | "sensing"
  | "metabolism"
  | "reproduction"
  | "diet"
  | "habitat"
  | "byproductUse"
  | "dormancyResponse";

export const TRAIT_DISPLAY_RANGES: Record<TraitView, readonly [number, number, string]> = {
  speed: [0.25, 4, "Movement"],
  sensing: [10, 180, "Nutrient sensing"],
  metabolism: [0.04, 0.5, "Energy use"],
  reproduction: [55, 220, "Reproduction energy"],
  diet: [-1.5, 1.5, "Nutrient tendency"],
  habitat: [-1.5, 1.5, "Home-zone preference"],
  byproductUse: [0, 1.5, "Byproduct use"],
  dormancyResponse: [0, 1.5, "Dormancy response"],
};

export interface PixiWorldProps {
  readonly worldId: WorldId;
  readonly tick: number;
  readonly environment: WorldEnvironmentFrame;
  readonly organisms: readonly RenderOrganism[];
  readonly resolvedPhenotypes: ReadonlyMap<number, ResolvedPhenotype>;
  readonly lens: Lens;
  readonly resourceView: ResourceView;
  readonly traitView: TraitView;
  readonly selectedId: OrganismId | null;
  readonly camera: WorldCamera;
  readonly zoom: number;
  readonly onSelect: (id: OrganismId | null) => void;
  readonly onCamera: (camera: WorldCamera) => void;
  readonly onView: (view: { w: number; h: number }) => void;
}
