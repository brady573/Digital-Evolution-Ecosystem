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

export interface EngineConfig {
  readonly seed: number;
  readonly start: number;
  readonly prod: number;
  readonly cap: number;
  readonly pop: number;
  readonly div: number;
  readonly mr: number;
  readonly ms: number;
  readonly press: number;
  readonly patch: number;
  readonly resource_b_fraction: number;
  readonly cat: "global" | "droughtA" | "droughtB";
  readonly st: number | null;
  readonly resource_model: "definition_driven_substances";
  readonly resource_grid: number;
  readonly enable_byproduct: boolean;
  readonly enable_dormancy: boolean;
  readonly study?: boolean;
}

export interface AnalysisState {
  readonly crossfeeding: unknown;
  readonly seed_bank: unknown;
  readonly eras: readonly unknown[];
  readonly records: readonly unknown[];
  readonly rules: Readonly<Record<string, number>>;
}

export interface RenderOrganism {
  readonly id: number;
  readonly parent: number | null;
  readonly generation: number;
  readonly lineageId: number;
  readonly cladeId: number;
  readonly x: number;
  readonly y: number;
  readonly energy: number;
  readonly activity: "active" | "dormant";
  readonly speed: number;
  readonly sensing: number;
  readonly metabolism: number;
  readonly reproduction: number;
  readonly diet: number;
  readonly habitat: number;
  readonly byproductUse: number;
  readonly dormancyResponse: number;
}

export interface RenderResourceField {
  readonly gridSize: number;
  readonly stock: readonly (readonly number[])[];
  readonly capacity: readonly (readonly number[])[];
}

export interface RenderSnapshot {
  readonly tick: number;
  readonly seed: number;
  readonly population: number;
  readonly activePopulation: number;
  readonly dormantPopulation: number;
  readonly organisms: readonly RenderOrganism[];
  readonly resources: RenderResourceField;
  readonly metrics: any;
  readonly analysis: AnalysisState;
  readonly events: readonly { readonly tick: number; readonly label: string }[];
  readonly control: {
    readonly tick: number;
    readonly population: number;
    readonly metrics: any;
  } | null;
}

export interface UniverseCheckpoint {
  readonly checkpointSchemaVersion: "0.1";
  readonly engineVersion: string;
  readonly createdTick: number;
  readonly experiment: unknown;
  readonly analysis: unknown;
  readonly control: unknown | null;
  readonly controlAnalysis: unknown | null;
}

export type RuntimeCommand =
  | { readonly type: "CREATE_UNIVERSE"; readonly config: EngineConfig }
  | { readonly type: "ADVANCE_TICKS"; readonly ticks: number }
  | { readonly type: "RUN_TO_NEXT_EVENT"; readonly maxTicks?: number }
  | { readonly type: "APPLY_INTERVENTION"; readonly intervention: "global" | "droughtA" | "droughtB" }
  | { readonly type: "CREATE_CONTROL_FORK" }
  | { readonly type: "LOAD_CHECKPOINT"; readonly checkpoint: UniverseCheckpoint }
  | { readonly type: "REQUEST_CHECKPOINT"; readonly requestId: string }
  | { readonly type: "REQUEST_EXPORT"; readonly requestId: string };

export type RuntimeResponse =
  | { readonly type: "SNAPSHOT"; readonly snapshot: RenderSnapshot }
  | { readonly type: "CHECKPOINT"; readonly requestId: string; readonly checkpoint: UniverseCheckpoint }
  | { readonly type: "EXPORT"; readonly requestId: string; readonly data: unknown }
  | { readonly type: "ERROR"; readonly message: string; readonly requestId?: string };
