import { useEffect, useRef, useState } from "react";
import type {
  AftermathBaseline,
  AftermathComparison,
  RenderResourceField,
  RenderSnapshot,
} from "@digital-evolution/contracts";
import {
  DELTA_EPSILON,
  availableComparisons,
  changedScalars,
  defaultComparison,
  deltaColor,
  fieldDelta,
  formatComparable,
  formatDelta,
  formatRelative,
} from "./aftermath";

/**
 * The aftermath impact sheet (M3 Aftermath Stage 2, impact state).
 *
 * Shows the mechanical effect of a resolved intervention and nothing else.
 * The world is paused at the resolution tick, so no organism has responded yet
 * and this sheet must not imply that any has: every later biological state is
 * still in the future. The single causal claim it makes is the direct effect,
 * because the command contract proves that one and nothing more.
 *
 * Rendered in place of the decision sheet content rather than beside it, so
 * resolving a decision morphs one sheet into the next instead of closing one
 * and opening another.
 */

/** The substrate's three nutrient kinds, named for display. The names come
 *  from the same vocabulary the direct-effect copy already uses. */
const NUTRIENT_LABELS = ["Nutrient A", "Nutrient B", "Nutrient C"] as const;

interface KindChange {
  readonly kind: number;
  readonly label: string;
  readonly delta: NonNullable<ReturnType<typeof fieldDelta>>;
  /** Fraction-of-capacity for this nutrient, before and now, so Before and Now
   *  share one encoding and both read as the quantity the World draws. */
  readonly beforeFractions: Float32Array;
  readonly nowFractions: Float32Array;
}

function fractionsFor(
  stock: readonly (readonly number[])[],
  capacity: readonly (readonly number[])[],
  kind: number,
  cells: number,
): Float32Array {
  const out = new Float32Array(cells);
  const s = stock[kind];
  const c = capacity[kind];
  for (let i = 0; i < cells; i++) {
    const cap = c ? c[i] ?? 0 : 0;
    out[i] = cap > 1e-9 ? (s ? s[i] ?? 0 : 0) / cap : 0;
  }
  return out;
}

/**
 * Which nutrients the intervention actually moved.
 *
 * Driven entirely by the two RETAINED states: a nutrient that did not change is
 * not shown, and nothing here re-derives which nutrient an intervention was
 * supposed to touch. If the engine's effect is not visible in the retained
 * evidence, the sheet says nothing rather than asserting one.
 *
 * `capacity` is read live, and that is deliberate: capacity is a static
 * configuration value that no intervention alters, so unlike a measurement it
 * cannot drift while the world resumes behind the sheet. Only the changing
 * quantities (stock, scalars) are retained.
 */
function changedNutrients(
  baseline: AftermathBaseline,
  resolved: AftermathBaseline,
  capacity: RenderResourceField["capacity"],
): KindChange[] {
  const grid = baseline.resources.gridSize;
  const cells = grid * grid;
  // The retained field is kind-major and flat: stock[kind] is a row-major run of
  // grid*grid cells. Reshaping to rows is what lets a signed delta keep its
  // spatial layout all the way to the canvas.
  const asRows = (flat: Float32Array): number[][] => {
    const rows: number[][] = [];
    for (let r = 0; r < grid; r++) rows.push(Array.from(flat.subarray(r * grid, (r + 1) * grid)));
    return rows;
  };
  const changes: KindChange[] = [];
  for (let kind = 0; kind < NUTRIENT_LABELS.length; kind++) {
    const before = fractionsFor(baseline.resources.stock, capacity, kind, cells);
    const now = fractionsFor(resolved.resources.stock, capacity, kind, cells);
    const spatial = fieldDelta(asRows(before), asRows(now));
    // A nutrient that did not move is not shown, and nothing here re-derives
    // which nutrient the intervention was supposed to touch.
    if (!spatial || Math.abs(spatial.magnitude) < DELTA_EPSILON) continue;
    changes.push({
      kind,
      label: NUTRIENT_LABELS[kind] ?? `Nutrient ${kind}`,
      delta: spatial,
      beforeFractions: before,
      nowFractions: now,
    });
  }
  return changes;
}

function FieldCanvas({ change, mode }: { change: KindChange; mode: AftermathComparison }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const size = change.delta?.gridSize ?? 0;
    if (!size) return;
    const image = ctx.createImageData(size, size);
    for (let i = 0; i < size * size; i++) {
      let r = 0;
      let g = 0;
      let b = 0;
      if (mode === "difference" && change.delta) {
        const colour = deltaColor(change.delta.values[i] ?? 0, change.delta.magnitude);
        [r, g, b] = colour.match(/\d+/g)!.map(Number) as [number, number, number];
      } else {
        // Before and Now share one encoding, so the two are visually
        // comparable and both read as the same quantity the World draws.
        const source = mode === "before" ? change.beforeFractions : change.nowFractions;
        const fraction = source[i] ?? 0;
        // Fertile-to-barren ramp matching the substrate: dark fertile, pale
        // barren. This is a quantity, not a verdict.
        const lit = Math.round(38 + 168 * (1 - Math.min(1, Math.max(0, fraction))));
        r = lit;
        g = Math.round(lit * 0.97);
        b = Math.round(lit * 0.88);
      }
      const o = i * 4;
      image.data[o] = r;
      image.data[o + 1] = g;
      image.data[o + 2] = b;
      image.data[o + 3] = 255;
    }
    const buffer = document.createElement("canvas");
    buffer.width = size;
    buffer.height = size;
    buffer.getContext("2d")!.putImageData(image, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(buffer, 0, 0, canvas.width, canvas.height);
  }, [change, mode]);
  return <canvas ref={ref} className="aftermath-field" width={216} height={216} aria-hidden="true" />;
}

export interface AftermathPanelProps {
  readonly snapshot: RenderSnapshot;
  readonly onAcknowledge: () => void;
  readonly busy: boolean;
}

export function AftermathPanel({ snapshot, onAcknowledge, busy }: AftermathPanelProps) {
  const aftermath = snapshot.aftermath;
  // Both sides are RETAINED at the resolution tick, not read live. Playback
  // resumes automatically once the choice resolves (AC22), so a live "Now"
  // would drift while the player reads the sheet and would stop being the
  // direct effect (AC23).
  const resolved = aftermath?.resolved ?? null;
  const baselinePresent = !!aftermath && !!resolved;
  const modes = availableComparisons(baselinePresent);
  const [mode, setMode] = useState<AftermathComparison>(() => defaultComparison(baselinePresent));

  // A new aftermath resets the comparison to its honest default rather than
  // inheriting a mode that may not be available for the new evidence.
  useEffect(() => {
    setMode(defaultComparison(baselinePresent));
  }, [aftermath?.commandId, baselinePresent]);

  if (!aftermath) return null;

  const rows = baselinePresent ? changedScalars(aftermath!.baseline, resolved!.scalars) : [];
  const nutrients = baselinePresent
    ? changedNutrients(aftermath!.baseline, aftermath!.resolved, snapshot.resources.capacity)
    : [];
  const showingDifference = mode === "difference" && baselinePresent;
  const quiet = showingDifference && rows.length === 0 && nutrients.length === 0;

  return (
    <div className="aftermath-body" data-testid="aftermath-impact">
      <span className="eyebrow">Aftermath</span>
      <h2>{aftermath.choiceTitle}</h2>
      {/* The one causal claim this sheet may make: the command contract proves
          the mechanical effect, and nothing here extends it. */}
      <p className="aftermath-effect" data-testid="aftermath-direct-effect">
        {aftermath.directEffectDescription}
      </p>

      {modes.length > 1 && (
        <div className="aftermath-compare" role="group" aria-label="Comparison mode">
          {modes.map(option => (
            <button
              key={option}
              type="button"
              className={option === mode ? "compare-option active" : "compare-option"}
              aria-pressed={option === mode}
              data-compare={option}
              onClick={() => setMode(option)}
            >
              {option === "difference" ? "Difference" : option === "now" ? "Now" : "Before"}
            </button>
          ))}
        </div>
      )}

      {showingDifference && (
        <div className="aftermath-evidence" data-testid="aftermath-difference">
          {quiet ? (
            <p className="aftermath-quiet" data-testid="aftermath-quiet">
              Nothing measurable changed at this tick. The world is paused here, so this is a true
              absence of change rather than a change too small to see.
            </p>
          ) : (
            <>
              {rows.length > 0 && (
                <ul className="aftermath-rows" data-testid="aftermath-rows">
                  {rows.map(row => (
                    <li key={row.descriptor.key} className="aftermath-row">
                      <span className="row-label">{row.descriptor.label}</span>
                      <span className="row-values">
                        <span className="row-before">{formatComparable(row.before, row.descriptor)}</span>
                        <span className="row-arrow" aria-hidden="true">&rarr;</span>
                        <span className="row-now">{formatComparable(row.now, row.descriptor)}</span>
                      </span>
                      <span className={row.delta > 0 ? "row-delta up" : "row-delta down"}>
                        {formatDelta(row.delta, row.descriptor)}
                        <span className="row-relative">{formatRelative(row.relative)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {nutrients.map(change => (
                <figure key={change.kind} className="aftermath-figure">
                  <FieldCanvas change={change} mode={mode} />
                  <figcaption>
                    <strong>{change.label}</strong>{" "}
                    {showingDifference && change.delta ? (
                      <>
                        changed by up to{" "}
                        {formatDelta(change.delta.magnitude, { key: "x", label: "x", unit: "", fraction: false })}
                        {` · ${change.delta.unchanged} of ${change.delta.values.length} cells unchanged`}
                      </>
                    ) : (
                      <>as a share of its own capacity</>
                    )}
                  </figcaption>
                </figure>
              ))}
              {showingDifference && (
                <p className="aftermath-legend">
                  <span className="legend-chip" style={{ background: deltaColor(-1, 1) }} aria-hidden="true" />
                  less
                  <span className="legend-chip" style={{ background: deltaColor(0, 1) }} aria-hidden="true" />
                  unchanged
                  <span className="legend-chip" style={{ background: deltaColor(1, 1) }} aria-hidden="true" />
                  more
                </p>
              )}
            </>
          )}
        </div>
      )}

      {!showingDifference && baselinePresent && (
        <div className="aftermath-evidence" data-testid="aftermath-single">
          <p className="aftermath-asof">
            {mode === "before" ? "Retained baseline" : "Current state"} at tick{" "}
            {(mode === "before" ? aftermath!.baseline.tick : resolved!.tick).toLocaleString()}.
            {mode === "before" && " This is the moment the intervention was applied."}
          </p>
          {nutrients.map(change => (
            <figure key={change.kind} className="aftermath-figure">
              <FieldCanvas change={change} mode={mode} />
              <figcaption><strong>{change.label}</strong> as a share of its own capacity</figcaption>
            </figure>
          ))}
        </div>
      )}

      {/* Keeps the mechanical effect separate from biology. Both sides of the
          comparison were retained at the resolution tick, so nothing here
          depends on later ticks - and the world may already be running behind
          the sheet, which is exactly why the evidence is pinned. */}
      <p className="aftermath-note">
        This is the mechanical effect only, captured at tick{" "}
        {aftermath.resolutionTick.toLocaleString()}. It is not an outcome: no biological
        response to this intervention is implied.
      </p>

      {/* Non-blocking by design. Playback resumes on its own when the player had
          the world playing before the decision (AC22), so this collapses the
          sheet rather than releasing a pause. It is never a prerequisite for
          time moving. */}
      <button
        className="aftermath-resume"
        data-testid="aftermath-acknowledge"
        onClick={onAcknowledge}
        disabled={busy}
      >
        Continue watching
      </button>
    </div>
  );
}
