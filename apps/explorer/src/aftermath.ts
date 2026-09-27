import type {
  AftermathBaseline,
  AftermathComparableDescriptor,
  AftermathComparison,
} from "@digital-evolution/contracts";
import { AFTERMATH_COMPARABLES } from "@digital-evolution/contracts";

/**
 * Comparison logic for the aftermath impact sheet.
 *
 * Pure and presentation-only: it reads two retained read models and formats
 * them. It never touches simulation state, never advances time, and never
 * decides what is true - it only reports what the runtime retained.
 *
 * The honesty rules encoded here, because they are easy to get wrong in JSX:
 *  - a missing value is OMITTED, never rendered as zero;
 *  - a difference on a fraction is a change in proportion, not a count;
 *  - only measures that actually changed are offered, because the player's
 *    question is "what changed?", and a table of unchanged values answers it
 *    with silence;
 *  - when nothing changed, that is stated outright rather than implied by an
 *    empty list.
 */

/** Below this, a difference is not shown as a difference at all. */
export const DELTA_EPSILON = 1e-9;

export interface ScalarRow {
  readonly descriptor: AftermathComparableDescriptor;
  readonly before: number;
  readonly now: number;
  /** Signed now-minus-before. Zero when equal. */
  readonly delta: number;
  /** Change as a fraction of `before`, or null when `before` is zero and a
   *  relative change would be undefined rather than infinite. */
  readonly relative: number | null;
}

/** Format a comparable for display. Fractions are shown as percentages because
 *  the underlying value is a 0..1 proportion and a bare 0.42 reads as a count. */
export function formatComparable(value: number, descriptor: AftermathComparableDescriptor): string {
  if (descriptor.fraction) return `${(value * 100).toFixed(1)}%`;
  // Trait means are unitless small decimals; counts are whole organisms.
  if (descriptor.key === "tolerance_mean" || descriptor.key === "cleanup_mean") return value.toFixed(3);
  return Math.round(value).toLocaleString();
}

/** A signed difference, always signed, so a decrease never reads as an
 *  increase. Percentages on fractions, plain numbers otherwise. */
export function formatDelta(delta: number, descriptor: AftermathComparableDescriptor): string {
  const magnitude = descriptor.fraction ? `${Math.abs(delta * 100).toFixed(1)}pp` : formatComparable(
    Math.abs(delta),
    descriptor,
  );
  if (Math.abs(delta) < DELTA_EPSILON) return `no change`;
  return `${delta > 0 ? "+" : "−"}${magnitude}`;
}

/** Relative change, used only where it is meaningful. On a fraction this is a
 *  change in proportion and the caller must not phrase it as a count. */
export function formatRelative(relative: number | null): string {
  if (relative === null) return "no prior value";
  const percent = relative * 100;
  if (!Number.isFinite(percent)) return "no prior value";
  if (Math.abs(percent) < 0.05) return "no material change";
  return `${percent > 0 ? "+" : "−"}${Math.abs(percent).toFixed(0)}% vs before`;
}

/**
 * The comparable measures that changed, strongest first.
 *
 * Only measures present in BOTH retained sets are considered: a measure the
 * runtime did not retain a value for is not comparable, and an incomparable
 * measure is omitted rather than shown with a blank or zero.
 */
export function changedScalars(
  baseline: AftermathBaseline,
  now: Readonly<Record<string, number>>,
  comparables: readonly AftermathComparableDescriptor[] = AFTERMATH_COMPARABLES,
): ScalarRow[] {
  const rows: ScalarRow[] = [];
  for (const descriptor of comparables) {
    const before = baseline.scalars[descriptor.key];
    const current = now[descriptor.key];
    if (typeof before !== "number" || !Number.isFinite(before)) continue;
    if (typeof current !== "number" || !Number.isFinite(current)) continue;
    const delta = current - before;
    if (Math.abs(delta) < DELTA_EPSILON) continue;
    rows.push({
      descriptor,
      before,
      now: current,
      delta,
      relative: before !== 0 ? delta / before : null,
    });
  }
  // Strongest first, with a deterministic tiebreak so the sheet does not
  // reshuffle equal-magnitude rows between renders.
  return rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)
    || a.descriptor.key.localeCompare(b.descriptor.key));
}

export interface FieldDelta {
  readonly gridSize: number;
  /** Signed now-minus-before per cell, row-major. */
  readonly values: readonly number[];
  readonly min: number;
  readonly max: number;
  /** Largest absolute change anywhere, for the legend. */
  readonly magnitude: number;
  /** Cells that did not change at all. Kept so "no change" is a visible,
   *  countable state rather than an absence of ink. */
  readonly unchanged: number;
}

/**
 * Cellwise signed difference between two retained fields of the same grid.
 *
 * Returns null when the two are not comparable: different grid sizes, or
 * missing cells. A difference between mismatched grids would be a fabricated
 * correspondence, so it is refused rather than resized.
 */
export function fieldDelta(
  before: readonly (readonly number[])[],
  after: readonly (readonly number[])[],
): FieldDelta | null {
  const gridSize = before.length;
  if (!gridSize || after.length !== gridSize) return null;
  const values: number[] = [];
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let unchanged = 0;
  for (let row = 0; row < gridSize; row++) {
    const beforeRow = before[row];
    const afterRow = after[row];
    if (!beforeRow || !afterRow || beforeRow.length !== afterRow.length) return null;
    for (let col = 0; col < beforeRow.length; col++) {
      const delta = (afterRow[col] ?? 0) - (beforeRow[col] ?? 0);
      values.push(delta);
      if (Math.abs(delta) < DELTA_EPSILON) unchanged++;
      if (delta < min) min = delta;
      if (delta > max) max = delta;
    }
  }
  if (!values.length) return null;
  return { gridSize, values, min, max, magnitude: Math.max(Math.abs(min), Math.abs(max)), unchanged };
}

/**
 * Diverging colour for one signed delta, on a scale normalised to the field's
 * own largest change.
 *
 * Deliberately asymmetric in lightness but symmetric in hue family, and it
 * returns a neutral for no change rather than the low end of the ramp - so
 * "unchanged" never looks like "a very small decrease". The two ends are a
 * cool and a warm tone, not a good/bad pair: a fall in nutrient stock is not
 * damage, and the palette must not imply that it is.
 */
export function deltaColor(delta: number, magnitude: number): string {
  if (!Number.isFinite(delta) || Math.abs(delta) < DELTA_EPSILON) return "rgb(116,107,96)";
  if (magnitude <= 0) return "rgb(116,107,96)";
  const t = Math.min(1, Math.abs(delta) / magnitude);
  // Ease so small real changes are visible without the largest change
  // flattening everything else into the neutral.
  const eased = Math.sqrt(t);
  return delta < 0
    ? `rgb(${Math.round(150 - 110 * eased)},${Math.round(158 - 106 * eased)},${Math.round(168 - 96 * eased)})`
    : `rgb(${Math.round(150 + 92 * eased)},${Math.round(158 + 66 * eased)},${Math.round(168 - 104 * eased)})`;
}

/**
 * Which comparisons can honestly be offered.
 *
 * "Difference" requires both sides to exist and to be comparable. When the
 * baseline is missing the player still gets "Now" - an omission, never a
 * fabricated zero, and never a comparison invented from current state alone.
 */
export function availableComparisons(baselinePresent: boolean): AftermathComparison[] {
  return baselinePresent ? ["difference", "now", "before"] : ["now"];
}

/** The mode to open on: the player's immediate question is "what changed?",
 *  so Difference leads when it is truthfully available. */
export function defaultComparison(baselinePresent: boolean): AftermathComparison {
  return baselinePresent ? "difference" : "now";
}
