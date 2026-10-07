export const APP_VERSION = "0.31.0";
// Foundation Slice 1: consequential spatial opportunity/occupancy changes
// births and movement settlement in maintained worlds, so this is a new
// production engine line. 0.24.0 (not 0.23.x) to stay unambiguous against
// unmerged experimental numbers. Checkpoint schemas unchanged: occupancy
// is derived per step (never persisted); interval facts are additive keys
// tolerated as absent by old decodes.
export const ENGINE_VERSION = "0.25.0";
export const EXPORT_FORMAT_VERSION = "0.31";
export const CHECKPOINT_SCHEMA_VERSION = "0.1";
