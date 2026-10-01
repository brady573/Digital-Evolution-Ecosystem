import type { AftermathLifecycleEvent, AftermathProjection, AftermathPresentationState } from "./experience/aftermath/model";
import type { HistoryRecordId } from "@digital-evolution/contracts";

export interface AftermathStage2PanelProps {
  readonly projection: AftermathProjection;
  readonly presentation: AftermathPresentationState;
  readonly remainingTicks: number;
  readonly onEvent: (event: AftermathLifecycleEvent) => void;
  readonly onReviewHistory?: (recordId: HistoryRecordId, kind: "development" | "decision-context") => void;
}

export function AftermathStage2Panel({ projection, presentation, remainingTicks, onEvent, onReviewHistory }: AftermathStage2PanelProps) {
  if (presentation.suspended || presentation.dismissed || projection.stage === "impact") return null;

  if (!presentation.expanded) {
    return <button className="aftermath-compact" data-testid="aftermath-compact" onClick={() => onEvent({ type: "expand" })}>
      <span className="aftermath-compact-mark" aria-hidden="true">◌</span>
      <span>Aftermath · {projection.stage === "development" ? "development observed" : projection.stage === "settlement" ? "settled" : "observing"}</span>
      <span aria-hidden="true">›</span>
    </button>;
  }

  return <section className="aftermath-stage2" data-testid="aftermath-stage2" data-stage={projection.stage}>
    <header className="aftermath-stage2-head">
      <span className="eyebrow">Aftermath · {projection.stage}</span>
      <button type="button" className="aftermath-stage2-collapse" onClick={() => onEvent({ type: "collapse" })}>Collapse</button>
    </header>
    {projection.fixtureOnly&&<p className="aftermath-fixture-warning" role="note">TEST FIXTURE — synthetic presentation only; not a world finding.</p>}
    {projection.stage === "development" && projection.development ? <>
      <h2>{projection.development.title}</h2>
      <p>{projection.development.summary}</p>
      {presentation.following
        ? <button type="button" onClick={() => onEvent({ type: "stop-follow" })}>Stop Follow</button>
        : projection.development.followLens && <button type="button" onClick={() => onEvent({ type: "follow", lens: projection.development!.followLens! })}>Follow this view</button>}
      {projection.historyRecordId&&onReviewHistory&&<button type="button" onClick={() => { onEvent({ type: "navigate-history" }); onReviewHistory(projection.historyRecordId!, "development"); }}>Review development in History</button>}
      {projection.originHistoryRecordId&&onReviewHistory&&<button type="button" onClick={() => { onEvent({ type: "navigate-history" }); onReviewHistory(projection.originHistoryRecordId!, "decision-context"); }}>Review decision context in History</button>}
    </> : projection.stage === "settlement" ? <>
      <h2>Observation settled</h2>
      <p data-testid="aftermath-settlement">{projection.settlement}</p>
      {projection.historyRecordId&&onReviewHistory&&<button type="button" onClick={() => { onEvent({ type: "navigate-history" }); onReviewHistory(projection.historyRecordId!, "development"); }}>Review development in History</button>}
      {projection.originHistoryRecordId&&onReviewHistory&&<button type="button" onClick={() => { onEvent({ type: "navigate-history" }); onReviewHistory(projection.originHistoryRecordId!, "decision-context"); }}>Review decision context in History</button>}
      <button type="button" onClick={() => onEvent({ type: "dismiss" })}>Dismiss</button>
    </> : <>
      <h2>Watching the World</h2>
      <p>Observation continues for {remainingTicks.toLocaleString()} more simulation ticks. This view does not pause the World.</p>
      {projection.originHistoryRecordId&&onReviewHistory&&<button type="button" onClick={() => { onEvent({ type: "navigate-history" }); onReviewHistory(projection.originHistoryRecordId!, "decision-context"); }}>Review decision context in History</button>}
    </>}
  </section>;
}
