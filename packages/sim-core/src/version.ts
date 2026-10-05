export const APP_VERSION = "0.31.0";
// Foundation Slice 2C: staged cell-local cleanup changes biological
// resolution semantics (snapshot/intent/budget/allocate/commit replaces
// immediate per-organism removal), so this is a new production engine
// line. 0.26.0 refuses 0.25.0 saves at the existing engine gate (no
// backfill: intents and budgets are transient tick-local state that was
// never persisted, so there is nothing to reconstruct).
// Checkpoint schemas unchanged: no persisted shape changed.
export const ENGINE_VERSION = "0.26.0";
export const EXPORT_FORMAT_VERSION = "0.31";
export const CHECKPOINT_SCHEMA_VERSION = "0.1";
