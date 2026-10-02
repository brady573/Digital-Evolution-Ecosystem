import { AFTERMATH_OBSERVATION_TICKS, type AftermathProjection, type AftermathProjectionInput, type DevelopmentEvidence } from "./model";

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
