/**
 * Presentation-speed scheduling policy (issue #37).
 *
 * Pure mapping from speed mode + elapsed wall time to simulation ticks owed.
 * Biology is untouched: the engine always steps per-tick through the same
 * deterministic trajectory, and event/decision breaks are evaluated per tick
 * inside advance(), so chunk sizes never alter outcomes — only snapshot
 * granularity. Same engine/config/seed/command sequence stays deterministic
 * across modes; render cadence never feeds analysis.
 *
 * Modes are genuinely distinct throughput targets:
 * - 1x:   60 ticks/s (baseline viewing pace, ~1 tick/frame at 60Hz)
 * - 10x:  600 ticks/s (~10 ticks/frame)
 * - 100x: 6000 ticks/s (~100 ticks/frame)
 * - Max:  60000 ticks/s target, slices capped so one worker message cannot
 *         stall the UI; backpressure (one in-flight slice) lets worker
 *         throughput, not a nominal multiplier, set the actual pace.
 */
export type SpeedMode = 1 | 10 | 100 | 500;

export const TICKS_PER_SECOND: Record<SpeedMode, number> = {
  1: 60,
  10: 600,
  100: 6000,
  500: 60000,
};

/** Max ticks in a single worker slice (keeps one message UI-responsive). */
export const MAX_SLICE_TICKS = 2000;

export function normalizeSpeedMode(speed: number): SpeedMode {
  if (speed >= 500) return 500;
  if (speed >= 100) return 100;
  if (speed >= 10) return 10;
  return 1;
}

/**
 * Accumulator scheduler: add elapsedMs at the mode rate, emit whole ticks,
 * keep the fractional carry. Returns {ticks, carry}.
 */
export function sliceFor(mode: SpeedMode, elapsedMs: number, carry: number): { ticks: number; carry: number } {
  const total = carry + (elapsedMs * TICKS_PER_SECOND[mode]) / 1000;
  const ticks = Math.min(MAX_SLICE_TICKS, Math.floor(total));
  return { ticks: Math.max(0, ticks), carry: total - Math.floor(total) };
}
