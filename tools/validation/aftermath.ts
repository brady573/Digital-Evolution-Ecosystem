import assert from "node:assert/strict";
import {
  availableComparisons,
  changedScalars,
  defaultComparison,
  deltaColor,
  fieldDelta,
  formatComparable,
  formatDelta,
  formatRelative,
} from "../../apps/explorer/src/aftermath.ts";
import type {
  AftermathBaseline,
  AftermathComparableDescriptor,
} from "../../packages/contracts/src/index.ts";
import { AFTERMATH_COMPARABLES } from "../../packages/contracts/src/index.ts";

/**
 * Aftermath comparison logic.
 *
 * The behaviours guarded here are the ones that would quietly lie: rendering an
 * absent value as zero, describing a proportion change as a count, and
 * presenting an incomparable difference as if it were measured.
 */

const COUNT: AftermathComparableDescriptor = { key: "population", label: "Living population", unit: "", fraction: false };
const SHARE: AftermathComparableDescriptor = { key: "dormant_fraction", label: "Dormant share", unit: "%", fraction: true };

function baselineWith(scalars: Record<string, number>): AftermathBaseline {
  return {
    tick: 1000,
    resources: { gridSize: 1, stock: [[0]] },
    waste: { gridSize: 1, stock: [0] },
    scalars,
  };
}

function testFractionsReadAsProportions() {
  assert.equal(formatComparable(0.42, SHARE), "42.0%", "a 0..1 proportion is shown as a percentage, not as 0.42");
  assert.equal(formatComparable(1234, COUNT), "1,234", "a count is shown as a whole number");
}

function testDeltasAreAlwaysSigned() {
  assert.equal(formatDelta(0.05, SHARE), "+5.0pp", "a rise in a proportion is percentage points");
  assert.equal(formatDelta(-0.05, SHARE), "−5.0pp", "a fall is signed the other way and never reads as a rise");
  assert.equal(formatDelta(0, SHARE), "no change", "an unchanged measure says so rather than showing +0.0");
  assert.equal(formatDelta(-40, COUNT), "−40", "a fall in a count is signed");
}

function testRelativeChangeRefusesUndefined() {
  assert.equal(formatRelative(null), "no prior value", "a change from zero has no defined relative size and says so");
  assert.equal(formatRelative(0.0001), "no material change", "a negligible relative change is not dressed up as one");
  assert.equal(formatRelative(0.14), "+14% vs before", "a real relative change is stated plainly");
}

function testOnlyChangedMeasuresAreOffered() {
  const baseline = baselineWith({ population: 1200, dormant_fraction: 0.3 });
  const rows = changedScalars(baseline, { population: 1150, dormant_fraction: 0.3 });
  assert.equal(rows.length, 1, "an unchanged measure is not offered as a change");
  assert.equal(rows[0].descriptor.key, "population", "the changed measure is the one reported");
  assert.equal(rows[0].delta, -50, "the delta is signed now-minus-before");
  assert.ok(Math.abs((rows[0].relative ?? 0) - -50 / 1200) < 1e-12, "relative change is against the retained baseline");
}

function testAbsentValuesAreOmittedNotZeroed() {
  const baseline = baselineWith({ population: 1200 });
  // waste_fraction was never retained on either side: it is not comparable.
  const rows = changedScalars(baseline, { population: 1200 });
  assert.equal(rows.length, 0, "a measure missing from the comparison is omitted, not shown as zero or as no change");
  // Retained on one side only: still not comparable.
  const oneSided = changedScalars(baselineWith({ population: 10 }), { population: 10, waste_fraction: 0.4 });
  assert.equal(oneSided.length, 0, "a measure retained on only one side is not comparable and is omitted");
}

function testStrongestChangeLeadsDeterministically() {
  // Magnitude ordering first: -100 outranks +20.
  const ranked = changedScalars(
    baselineWith({ population: 1000, dormant_population: 500 }),
    { population: 900, dormant_population: 520 },
  );
  assert.deepEqual(ranked.map(r => r.descriptor.key), ["population", "dormant_population"],
    "the largest change leads regardless of its sign");

  // A genuine tie (-100 against +100) must still order deterministically, or
  // the sheet reshuffles equal rows between renders. Key order breaks the tie.
  const tied = changedScalars(
    baselineWith({ population: 1000, dormant_population: 100 }),
    { population: 900, dormant_population: 200 },
  );
  assert.deepEqual(tied.map(r => r.descriptor.key), ["dormant_population", "population"],
    "equal magnitudes order by key, so the sheet does not reshuffle between renders");
}

function testFieldDeltaIsSignedAndCountsUnchanged() {
  const before = [[1, 0.5], [0.25, 0]];
  const after = [[0.5, 0.5], [0.25, 0.75]];
  const delta = fieldDelta(before, after);
  assert.ok(delta, "same-grid fields compare");
  assert.equal(delta.gridSize, 2, "the grid is carried through");
  assert.deepEqual([...delta.values], [-0.5, 0, 0, 0.75], "cellwise signed now-minus-before");
  assert.equal(delta.min, -0.5, "the minimum is the largest fall");
  assert.equal(delta.max, 0.75, "the maximum is the largest rise");
  assert.equal(delta.unchanged, 2, "unchanged cells are counted so 'no change' is a visible state");
}

function testIncomparableFieldsAreRefused() {
  assert.equal(fieldDelta([[1, 1]], [[1]]), null, "a different row count is not a correspondence and is refused");
  assert.equal(fieldDelta([[1, 1]], [[1, 1, 1]]), null, "a different column count is refused");
  assert.equal(fieldDelta([], [[1]]), null, "an empty baseline has no comparable geometry");
}

function testNoChangeIsVisuallyDistinct() {
  const neutral = deltaColor(0, 1);
  const fall = deltaColor(-0.4, 1);
  const rise = deltaColor(0.4, 1);
  assert.notEqual(neutral, fall, "no change is not the low end of the ramp");
  assert.notEqual(neutral, rise, "no change is not the high end of the ramp");
  assert.notEqual(fall, rise, "a fall and a rise are different colours");
  // A tiny real change must still be visible, not swallowed by the neutral.
  assert.notEqual(deltaColor(-0.0001, 1), neutral, "a small real change is still a change");
  // Degenerate scale must not produce NaN or a crash.
  assert.equal(deltaColor(0.5, 0), neutral, "a zero-magnitude field degrades to neutral rather than dividing by zero");
  assert.equal(deltaColor(Number.NaN, 1), neutral, "a non-finite delta degrades to neutral");
}

function testComparisonAvailabilityIsOmissionNotFabrication() {
  assert.deepEqual(availableComparisons(true), ["difference", "now", "before"], "with a baseline all three are truthful");
  assert.deepEqual(availableComparisons(false), ["now"], "without a baseline only Now is offered");
  assert.equal(defaultComparison(true), "difference", "the player's question is 'what changed?', so Difference leads");
  assert.equal(defaultComparison(false), "now", "without a baseline, Now is the only honest default");
}

function testEveryDeclaredComparableIsFormattable() {
  // The runtime retains exactly these keys, so each must survive a format with
  // real numbers. A descriptor that throws here would throw in the sheet.
  for (const descriptor of AFTERMATH_COMPARABLES) {
    assert.equal(typeof formatComparable(0.5, descriptor), "string", `${descriptor.key} formats`);
    assert.equal(typeof formatDelta(-0.5, descriptor), "string", `${descriptor.key} formats a delta`);
  }
  // And the two descriptor families must not be conflated.
  const fractions = AFTERMATH_COMPARABLES.filter(d => d.fraction);
  assert.ok(fractions.length > 0, "some comparables are proportions");
  assert.ok(AFTERMATH_COMPARABLES.some(d => !d.fraction), "some comparables are counts");
  for (const descriptor of fractions) {
    assert.ok(formatDelta(0.01, descriptor).endsWith("pp"), `${descriptor.key} uses percentage points, not a count`);
  }
}

async function main() {
  testFractionsReadAsProportions();
  testDeltasAreAlwaysSigned();
  testRelativeChangeRefusesUndefined();
  testOnlyChangedMeasuresAreOffered();
  testAbsentValuesAreOmittedNotZeroed();
  testStrongestChangeLeadsDeterministically();
  testFieldDeltaIsSignedAndCountsUnchanged();
  testIncomparableFieldsAreRefused();
  testNoChangeIsVisuallyDistinct();
  testComparisonAvailabilityIsOmissionNotFabrication();
  testEveryDeclaredComparableIsFormattable();
  console.log("aftermath comparison validation: PASS");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
