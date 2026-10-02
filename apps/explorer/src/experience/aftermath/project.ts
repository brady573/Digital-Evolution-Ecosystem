import { AFTERMATH_OBSERVATION_TICKS, type AftermathProjection, type AftermathProjectionInput, type DevelopmentEvidence } from "./model";
import type { RenderSnapshot, WorldInterpretationState, WorldLiveFrame } from "@digital-evolution/contracts";

export interface LiveAftermathProjectionInput {
  readonly interpretation: Pick<WorldInterpretationState,"aftermath">;
  readonly live: Pick<WorldLiveFrame,"tick"|"population">;
  /** Optional retained detail enriches origin navigation only; it is not lifecycle authority. */
  readonly detail: Pick<RenderSnapshot,"resolvedDecisions"|"analysis"> | null;
  readonly candidates: readonly DevelopmentEvidence[];
  readonly fixtureOnly?: boolean;
}

const SOURCE_PRIORITY: Record<DevelopmentEvidence["source"], number> = {
  "matched-comparison": 0,
  history: 1,
  "measured-response": 2,
};

const QUIET_SETTLEMENT = "little/no major measured response within the observation window";

function strongestLinkedEvidence(input: AftermathProjectionInput): DevelopmentEvidence | null {
  return input.candidates
    .filter(candidate => candidate.aftermathCommandId === input.aftermath.commandId)
    .slice()
    .sort((a, b) => SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source]
      || a.sourceId.localeCompare(b.sourceId))[0] ?? null;
}

/** Select one linked development and settle only at the fixed horizon or extinction. */
export function projectAftermath(input: AftermathProjectionInput): AftermathProjection {
  const development = strongestLinkedEvidence(input);
  const extinct = input.population === 0;
  const horizonReached = input.currentTick >= input.aftermath.resolutionTick + AFTERMATH_OBSERVATION_TICKS;

  if (input.aftermath.phase === "impact") {
    return { stage: "impact", fixtureOnly:input.fixtureOnly===true||development?.fixtureOnly===true,
      development, historyRecordId: development?.historyRecordId ?? null,
      originHistoryRecordId: input.originHistoryRecordId ?? null,
      settlement: null, settlementReason: null };
  }

  if (extinct || horizonReached) {
    return {
      stage: "settlement",
      fixtureOnly:input.fixtureOnly===true||development?.fixtureOnly===true,
      development,
      historyRecordId: development?.historyRecordId ?? null,
      originHistoryRecordId: input.originHistoryRecordId ?? null,
      settlement: extinct
        ? development?.summary ?? "Observation ended because the world reached extinction."
        : development?.summary ?? QUIET_SETTLEMENT,
      settlementReason: extinct ? "extinction" : "horizon",
    };
  }

  if (development) {
    return { stage: "development", fixtureOnly:input.fixtureOnly===true||development.fixtureOnly===true,
      development, historyRecordId: development.historyRecordId ?? null,
      originHistoryRecordId: input.originHistoryRecordId ?? null,
      settlement: null, settlementReason: null };
  }

  return { stage: "observation", fixtureOnly:input.fixtureOnly===true,
    development: null, historyRecordId: null,
    originHistoryRecordId: input.originHistoryRecordId ?? null,
    settlement: null, settlementReason: null };
}

/** Project lifecycle exclusively from bounded live read models. Retained detail
 * is consulted only for a matching origin History link, when one is available. */
export function projectLiveAftermath(input: LiveAftermathProjectionInput): AftermathProjection | null {
  const aftermath=input.interpretation.aftermath;
  if(!aftermath)return null;

  const resolution=input.detail?.resolvedDecisions.find(item=>item.commandId===aftermath.commandId);
  const originRecord=resolution?.sourceEventId
    ?input.detail?.analysis.records.find(record=>String(record.id)===String(resolution.sourceEventId))
    :undefined;

  return projectAftermath({
    aftermath,
    currentTick:input.live.tick,
    population:input.live.population,
    originHistoryRecordId:originRecord?.id??null,
    candidates:input.candidates,
    ...(input.fixtureOnly===undefined?{}:{fixtureOnly:input.fixtureOnly}),
  });
}
