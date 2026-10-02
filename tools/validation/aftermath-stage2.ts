import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AftermathState, HistoryRecordId } from "../../packages/contracts/src/index.ts";
import { AftermathStage2Panel } from "../../apps/explorer/src/AftermathStage2Panel.tsx";
import { projectAftermath } from "../../apps/explorer/src/experience/aftermath/project.ts";
import { transitionAftermath } from "../../apps/explorer/src/experience/aftermath/lifecycle.ts";
import type { AftermathPresentationState, DevelopmentEvidence } from "../../apps/explorer/src/experience/aftermath/model.ts";

const commandId = "decision-command-7" as AftermathState["commandId"];
const recordId = "history-record-7" as HistoryRecordId;
const aftermath = {
  schemaVersion: 1,
  opportunityId: "opportunity-7",
  commandId,
  resolutionTick: 100,
  phase: "observation",
  choiceTitle: "Keep watching",
  directEffectDescription: "A resource changed.",
  intervention: null,
  source: "event_decision",
  baseline: { tick: 100, scalars: {}, resources: { gridSize: 0, stock: [] }, waste: { gridSize: 0, stock: [] } },
  resolved: { tick: 100, scalars: {}, resources: { gridSize: 0, stock: [] }, waste: { gridSize: 0, stock: [] } },
} as unknown as AftermathState;

function candidate(overrides: Partial<DevelopmentEvidence> = {}): DevelopmentEvidence {
  return {
    aftermathCommandId: commandId,
    source: "history",
    sourceId: recordId,
    historyRecordId: recordId,
    title: "Measured development",
    summary: "An observation recorded by analysis.",
    ...overrides,
  };
}

function doesNotLinkLaterHistoryByChronology() {
  const result = projectAftermath({ aftermath, currentTick: 25_100, population: 10,
    candidates: [candidate({ aftermathCommandId: "another-command" as AftermathState["commandId"] })] });
  assert.equal(result.stage, "settlement");
  assert.equal(result.development, null);
  assert.equal(result.historyRecordId, null);
}

function acceptsOnlyExplicitStableIdentityLink() {
  const result = projectAftermath({ aftermath, currentTick: 200, population: 10, candidates: [candidate()] });
  assert.equal(result.stage, "development");
  assert.equal(result.historyRecordId, recordId);
}

function originRecordIsProvenanceNotDevelopmentEvidence() {
  const result = projectAftermath({ aftermath, currentTick: 200, population: 10,
    originHistoryRecordId: recordId, candidates: [] });
  assert.equal(result.stage, "observation");
  assert.equal(result.development, null);
  assert.equal(result.historyRecordId, null);
  assert.equal(result.originHistoryRecordId, recordId);
}

function staysQuietWhenNoDevelopmentLinkExists() {
  const result = projectAftermath({ aftermath, currentTick: 200, population: 10, candidates: [] });
  assert.equal(result.stage, "observation");
  assert.equal(result.development, null);
  assert.equal(result.historyRecordId, null);
}

function settlesAtResolutionTickPlus25000() {
  const result = projectAftermath({ aftermath, currentTick: 25_100, population: 10, candidates: [] });
  assert.equal(result.stage, "settlement");
  assert.equal(result.settlement, "little/no major measured response within the observation window");
}

function settlesWhenSnapshotSkipsPastHorizon() {
  const result = projectAftermath({ aftermath, currentTick: 25_101, population: 10, candidates: [] });
  assert.equal(result.stage, "settlement");
  assert.equal(result.settlementReason, "horizon");
}

function doesNotSettleFromMetricStability() {
  const result = projectAftermath({ aftermath, currentTick: 24_999, population: 10, candidates: [] });
  assert.equal(result.stage, "observation");
}

function extinctionMaySettleEarly() {
  const result = projectAftermath({ aftermath, currentTick: 101, population: 0, candidates: [] });
  assert.equal(result.stage, "settlement");
  assert.equal(result.settlementReason, "extinction");
  assert.equal(result.settlement, "Observation ended because the world reached extinction.");
}

function developmentDoesNotResetHorizon() {
  const result = projectAftermath({ aftermath, currentTick: 25_100, population: 10, candidates: [candidate()] });
  assert.equal(result.stage, "settlement");
  assert.equal(result.development?.title, "Measured development");
}

function strongestSupportedEvidenceWins() {
  const result = projectAftermath({ aftermath, currentTick: 200, population: 10, candidates: [
    candidate({ source: "measured-response", sourceId: "m-2", title: "Measured response" }),
    candidate({ source: "matched-comparison", sourceId: "c-1", title: "Matched comparison" }),
    candidate({ source: "history", sourceId: "history-2", title: "History record" }),
  ] });
  assert.equal(result.development?.title, "Matched comparison");
}

const initialState: AftermathPresentationState = {
  commandId,
  stage: "impact",
  expanded: true,
  suspended: false,
  dismissed: false,
  following: false,
  automaticLens: null,
  manualLensOverride: false,
};

function impactAcknowledgementMovesToObservation() {
  const next=transitionAftermath(initialState, { type: "acknowledge-impact" });
  assert.equal(next.stage, "observation");
  assert.equal(next.expanded, false, "impact release collapses to compact observation");
}

function pendingDecisionSuspendsWithoutDroppingEvidenceIdentity() {
  const suspended = transitionAftermath(initialState, { type: "suspend" });
  assert.equal(suspended.suspended, true);
  assert.equal(suspended.commandId, commandId);
  assert.equal(suspended.expanded, false);
}

function foregroundSupersessionDoesNotMutateTheOldState() {
  const replacement = "decision-command-8" as AftermathState["commandId"];
  const next = transitionAftermath(initialState, { type: "supersede", commandId: replacement });
  assert.equal(next.commandId, replacement);
  assert.equal(next.stage, "impact");
  assert.equal(initialState.commandId, commandId);
}

function manualLensOverrideStopsAutomaticLensSwitching() {
  const following = transitionAftermath(initialState, { type: "follow", lens: "clades" });
  const changed = transitionAftermath(following, { type: "manual-lens-change" });
  assert.equal(changed.stage, "impact", "manual lens changes do not end Aftermath");
  assert.equal(changed.following, true, "manual lens changes only stop automatic lens control");
  assert.equal(changed.automaticLens, null);
  assert.equal(changed.manualLensOverride, true);
  assert.deepEqual(transitionAftermath(changed, { type: "automatic-lens-change", lens: "traits" }), changed);
}

function fixtureDevelopmentCardShowsOneSupportedRecordAndOptionalFollow() {
  const {historyRecordId:_testOnlyUnlinkedId,...evidence}=candidate({followLens:"clades",fixtureOnly:true});
  const projection=projectAftermath({aftermath,currentTick:200,population:10,candidates:[evidence]});
  const html=renderToStaticMarkup(createElement(AftermathStage2Panel,{
    projection,
    presentation:{...initialState,stage:"development",expanded:true},
    remainingTicks:24_900,
    onEvent:()=>{},
    onReviewHistory:()=>{},
  }));
  assert.match(html,/Measured development/);
  assert.match(html,/TEST FIXTURE — synthetic presentation only; not a world finding/);
  assert.match(html,/Follow this view/);
  assert.doesNotMatch(html,/Review development in History/);
  assert.doesNotMatch(html,/little\/no major measured response/);
}

function quietSettlementShowsEvidenceBoundedCopyWithoutHistoryLink() {
  const projection=projectAftermath({aftermath,currentTick:25_100,population:10,candidates:[],fixtureOnly:true});
  const html=renderToStaticMarkup(createElement(AftermathStage2Panel,{
    projection,
    presentation:{...initialState,stage:"settlement",expanded:true},
    remainingTicks:0,
    onEvent:()=>{},
  }));
  assert.match(html,/little\/no major measured response within the observation window/);
  assert.match(html,/TEST FIXTURE — synthetic presentation only; not a world finding/);
  assert.doesNotMatch(html,/Review .* in History/);
  assert.doesNotMatch(html,/recovery|resilience|success|damage/i);
}

doesNotLinkLaterHistoryByChronology();
acceptsOnlyExplicitStableIdentityLink();
originRecordIsProvenanceNotDevelopmentEvidence();
staysQuietWhenNoDevelopmentLinkExists();
settlesAtResolutionTickPlus25000();
settlesWhenSnapshotSkipsPastHorizon();
doesNotSettleFromMetricStability();
extinctionMaySettleEarly();
developmentDoesNotResetHorizon();
strongestSupportedEvidenceWins();
impactAcknowledgementMovesToObservation();
pendingDecisionSuspendsWithoutDroppingEvidenceIdentity();
foregroundSupersessionDoesNotMutateTheOldState();
manualLensOverrideStopsAutomaticLensSwitching();
fixtureDevelopmentCardShowsOneSupportedRecordAndOptionalFollow();
quietSettlementShowsEvidenceBoundedCopyWithoutHistoryLink();
console.log("aftermath stage 2 projection/lifecycle/presentation fixture: PASS (16 cases)");
