export interface VersionInfo {
  readonly appVersion: string;
  readonly engineVersion: string;
  readonly exportFormatVersion: string;
  readonly checkpointSchemaVersion: string;
}

export interface WorldRecipe {
  readonly seed: number;
  readonly nutrientSupply: number;
  readonly nutrientZoneSeparation: number;
  readonly nutrientVariety: number;
  readonly foundingPopulation: number;
  readonly startingVariation: number;
  readonly mutationChance: number;
  readonly survivalPressure: number;
}

export type RuntimeCommand =
  | { readonly type: "CREATE_UNIVERSE"; readonly recipe: WorldRecipe }
  | { readonly type: "ADVANCE_TICKS"; readonly ticks: number }
  | { readonly type: "PAUSE" }
  | { readonly type: "SET_SPEED"; readonly multiplier: 1 | 10 | 100 | "max" }
  | { readonly type: "RUN_TO_NEXT_EVENT" }
  | { readonly type: "APPLY_INTERVENTION"; readonly intervention: "global" | "droughtA" | "droughtB" }
  | { readonly type: "CREATE_CONTROL_FORK" }
  | { readonly type: "REQUEST_CHECKPOINT" }
  | { readonly type: "REQUEST_EXPORT" };

export interface RenderOrganism {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly energy: number;
  readonly activity: "active" | "dormant";
  readonly lineageId: number;
}

export interface RenderSnapshot {
  readonly tick: number;
  readonly population: number;
  readonly activePopulation: number;
  readonly dormantPopulation: number;
  readonly organisms: readonly RenderOrganism[];
}

export interface UniverseCheckpointHeader {
  readonly checkpointSchemaVersion: string;
  readonly engineVersion: string;
  readonly tick: number;
  readonly seed: number;
}

export interface EvidenceExportHeader {
  readonly exportFormatVersion: string;
  readonly appVersion: string;
  readonly engineVersion: string;
  readonly tick: number;
  readonly seed: number;
}
