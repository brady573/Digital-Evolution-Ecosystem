import type { AftermathState, DecisionCommandId, HistoryRecordId } from "@digital-evolution/contracts";

export const AFTERMATH_OBSERVATION_TICKS = 25_000;

export type DevelopmentEvidenceSource = "matched-comparison" | "history" | "measured-response";

/** A candidate is usable only when an existing stable identity link names this Aftermath. */
export interface DevelopmentEvidence {
  readonly aftermathCommandId: DecisionCommandId;
  readonly source: DevelopmentEvidenceSource;
  readonly sourceId: string;
  readonly historyRecordId?: HistoryRecordId;
  readonly followLens?: "normal" | "clades" | "traits";
  /** Only used by the deeTest-only presentation fixture; never production evidence. */
  readonly fixtureOnly?: boolean;
  readonly title: string;
  readonly summary: string;
}

export type AftermathStage = "impact" | "observation" | "development" | "settlement";
export type AftermathStage2Fixture = "development" | "settlement";
export type SettlementReason = "horizon" | "extinction";

export interface AftermathProjectionInput {
  readonly aftermath: AftermathState;
  readonly currentTick: number;
  readonly population: number;
  /** Origin decision/event provenance only; never grounds a later development. */
  readonly originHistoryRecordId?: HistoryRecordId | null;
  /** Only candidates with an existing stable association may be supplied. */
  readonly candidates: readonly DevelopmentEvidence[];
  readonly fixtureOnly?: boolean;
}

export interface AftermathProjection {
  readonly stage: AftermathStage;
  readonly fixtureOnly: boolean;
  readonly development: DevelopmentEvidence | null;
  readonly historyRecordId: HistoryRecordId | null;
  readonly originHistoryRecordId: HistoryRecordId | null;
  readonly settlement: string | null;
  readonly settlementReason: SettlementReason | null;
}

export interface AftermathPresentationState {
  readonly commandId: DecisionCommandId;
  readonly stage: AftermathStage;
  readonly expanded: boolean;
  readonly suspended: boolean;
  readonly dismissed: boolean;
  readonly following: boolean;
  readonly automaticLens: "normal" | "clades" | "traits" | null;
  readonly manualLensOverride: boolean;
}

export type AftermathLifecycleEvent =
  | { readonly type: "acknowledge-impact" }
  | { readonly type: "expand" }
  | { readonly type: "collapse" }
  | { readonly type: "suspend" }
  | { readonly type: "resume-presentation" }
  | { readonly type: "dismiss" }
  | { readonly type: "settle" }
  | { readonly type: "supersede"; readonly commandId: DecisionCommandId }
  | { readonly type: "follow"; readonly lens: "normal" | "clades" | "traits" | null }
  | { readonly type: "automatic-lens-change"; readonly lens: "normal" | "clades" | "traits" }
  | { readonly type: "stop-follow" }
  | { readonly type: "manual-lens-change" }
  | { readonly type: "navigate-history" };
