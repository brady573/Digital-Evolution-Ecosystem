export { WorkerRuntimeClient } from "./client";
export { RUNTIME_IDENTITY } from "./provenance";
/** Test-only: deeTest transport seam. Never part of the production contract. */
export { InstrumentedTransport, createInstrumentedTransport } from "./test-transport";
export { MAX_SLICE_TICKS, TICKS_PER_SECOND, normalizeSpeedMode, sliceFor, type SpeedMode } from "./speed";
export type { RuntimeClient, TerminalFailure, WorkerLike } from "./client";
