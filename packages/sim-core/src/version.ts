export const APP_VERSION = "0.31.0";
// Foundation Slice 2: detritus is maintained persistent biological state
// (field + pending + counters + du/md/gd organism state), so this is a new
// production engine line. 0.25.0 refuses 0.24.0 saves at the existing engine
// gate (no backfill: a persisted detritus field cannot be reconstructed).
// Checkpoint schemas unchanged: the detritus-field tag decodes like waste.
export const ENGINE_VERSION = "0.25.0";
export const EXPORT_FORMAT_VERSION = "0.31";
export const CHECKPOINT_SCHEMA_VERSION = "0.1";
