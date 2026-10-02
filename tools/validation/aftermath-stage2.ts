import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AftermathState, HistoryRecordId } from "../../packages/contracts/src/index.ts";
import { AftermathStage2Panel } from "../../apps/explorer/src/AftermathStage2Panel.tsx";
import * as aftermathProjection from "../../apps/explorer/src/experience/aftermath/project.ts";
import * as aftermathLifecycle from "../../apps/explorer/src/experience/aftermath/lifecycle.ts";
import type { AftermathPresentationState, DevelopmentEvidence } from "../../apps/explorer/src/experience/aftermath/model.ts";

const commandId = "decision-command-7" as AftermathState["commandId"];
const recordId = "history-record-7" as HistoryRecordId;
const projectAftermath=aftermathProjection.projectAftermath;
const transitionAftermath=aftermathLifecycle.transitionAftermath;
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

function liveProjectionDoesNotDependOnRetainedSnapshot() {
  const projectLive=(aftermathProjection as any).projectLiveAftermath;
  assert.equal(typeof projectLive,"function","live Aftermath has a bounded-read-model projection adapter");
  const staleDetail={
    aftermath:{...aftermath,phase:"impact"},
    tick:aftermath.resolutionTick,
    population:10,
    resolvedDecisions:[],
    analysis:{records:[]},
  };
  const atLastProtectedTick=projectLive({
    interpretation:{aftermath},
    live:{tick:aftermath.resolutionTick+24_999,population:10},
    detail:staleDetail,
    candidates:[],
  });
  assert.equal(atLastProtectedTick.stage,"observation","stale retained impact/tick cannot rewind live observation");
  const atHorizon=projectLive({
    interpretation:{aftermath},
    live:{tick:aftermath.resolutionTick+25_000,population:10},
    detail:null,
    candidates:[],
  });
  assert.equal(atHorizon.stage,"settlement","null retained detail cannot hide live settlement at the horizon");
  assert.equal(atHorizon.settlementReason,"horizon");
  assert.equal(projectLive({interpretation:{aftermath:null},live:{tick:25_100,population:10},detail:staleDetail,candidates:[]}),null,
    "a stale detail Aftermath cannot resurrect after the live read model clears it");
}

function liveProjectionUsesRetainedDetailOnlyForMatchingOriginHistory() {
  const projectLive=(aftermathProjection as any).projectLiveAftermath;
  const detail={
    aftermath:{...aftermath,phase:"impact"},
    tick:aftermath.resolutionTick,
    population:10,
    resolvedDecisions:[{commandId,sourceEventId:"event-origin-7"}],
    analysis:{records:[{id:"event-origin-7"}]},
  };
  const enriched=projectLive({interpretation:{aftermath},live:{tick:101,population:10},detail,candidates:[]});
  assert.equal(enriched.stage,"observation","retained detail does not rewind live phase");
  assert.equal(enriched.originHistoryRecordId,"event-origin-7","matching detail may enrich the origin History link");

  const missingOrigin=projectLive({
    interpretation:{aftermath},
    live:{tick:101,population:10},
    detail:{...detail,analysis:{records:[]}},
    candidates:[],
  });
  assert.equal(missingOrigin.stage,"observation","missing origin evidence cannot hide the live Aftermath");
  assert.equal(missingOrigin.originHistoryRecordId,null,"missing origin History simply omits its link");
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

function liveLifecycleSynchronizesBeforeTheNextRender() {
  const synchronize=(aftermathLifecycle as any).synchronizeAftermathPresentation;
  assert.equal(typeof synchronize,"function","live lifecycle has a synchronous presentation projection");
  const observation={...aftermath,phase:"observation" as const};
  const rendered=synchronize(initialState,observation,false);
  assert.equal(rendered.stage,"observation","live observation immediately supersedes stale impact presentation");
  assert.equal(rendered.expanded,false,"impact sheet collapses on the first live advance");
  const preempted=synchronize(rendered,observation,true);
  assert.equal(preempted.suspended,true,"pending decision synchronously preempts Aftermath");
  assert.equal(preempted.expanded,false,"preemption keeps the single large sheet slot");
  const resumed=synchronize(preempted,observation,false);
  assert.equal(resumed.suspended,false,"Aftermath resumes after the decision clears");
  assert.equal(resumed.stage,"observation","resume does not rewind live lifecycle state");
  assert.equal(synchronize(resumed,null,false),null,"cleared live aftermath cannot be restored by retained state");
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
liveProjectionDoesNotDependOnRetainedSnapshot();
liveProjectionUsesRetainedDetailOnlyForMatchingOriginHistory();
settlesWhenSnapshotSkipsPastHorizon();
doesNotSettleFromMetricStability();
extinctionMaySettleEarly();
developmentDoesNotResetHorizon();
strongestSupportedEvidenceWins();
impactAcknowledgementMovesToObservation();
liveLifecycleSynchronizesBeforeTheNextRender();
pendingDecisionSuspendsWithoutDroppingEvidenceIdentity();
foregroundSupersessionDoesNotMutateTheOldState();
manualLensOverrideStopsAutomaticLensSwitching();
fixtureDevelopmentCardShowsOneSupportedRecordAndOptionalFollow();
quietSettlementShowsEvidenceBoundedCopyWithoutHistoryLink();
console.log("aftermath stage 2 projection/lifecycle/presentation fixture: PASS (19 cases)");
