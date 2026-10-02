import type { AftermathLifecycleEvent, AftermathPresentationState } from "./model";

/** Presentation-only reducer: it never owns simulation commands or ticks. */
export function transitionAftermath(
  state: AftermathPresentationState,
  event: AftermathLifecycleEvent,
): AftermathPresentationState {
  switch (event.type) {
    case "acknowledge-impact":
      return state.stage === "impact" ? { ...state, stage: "observation", expanded: false } : state;
    case "expand":
      return state.suspended || state.dismissed ? state : { ...state, expanded: true };
    case "collapse":
      return { ...state, expanded: false };
    case "suspend":
      return { ...state, suspended: true, expanded: false };
    case "resume-presentation":
      return { ...state, suspended: false };
    case "dismiss":
      return { ...state, dismissed: true, expanded: false, following: false, automaticLens: null };
    case "settle":
      return { ...state, stage: "settlement", expanded: false, following: false, automaticLens: null };
    case "supersede":
      return {
        commandId: event.commandId,
        stage: "impact",
        expanded: true,
        suspended: false,
        dismissed: false,
        following: false,
        automaticLens: null,
        manualLensOverride: false,
      };
    case "follow":
      return state.suspended || state.dismissed
        ? state
        : { ...state, following: true, automaticLens: event.lens, manualLensOverride: false };
    case "automatic-lens-change":
      return state.following && !state.manualLensOverride
        ? { ...state, automaticLens: event.lens }
        : state;
    case "stop-follow":
      return { ...state, following: false, automaticLens: null };
    case "manual-lens-change":
      return state.following
        ? { ...state, automaticLens: null, manualLensOverride: true }
        : state;
    case "navigate-history":
      return { ...state, expanded: false, following: false, automaticLens: null };
  }
}
