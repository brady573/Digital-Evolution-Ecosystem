import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { UniverseSession } from "../../packages/sim-runtime/src/session.ts";
import type { EngineConfig } from "../../packages/contracts/src/index.ts";
import { ENGINE_VERSION } from "../../packages/sim-core/src/index.ts";
import { CATALYST_POLICY_VERSION } from "../../packages/sim-decisions/src/index.ts";

/**
 * Issue #30 Stage 2 Level-3 multi-seed evidence: matched C-washout assays
 * across fixed seeds on the balanced config. Establishment, material
 * response, weak response, and non-establishment are ALL retained as
 * evidence; nothing here asserts a target frequency. Deterministic:
 * re-running reproduces every row bit-for-bit.
 *
 * Post-assay C-use arc capture: the assay previously read `cuse` records only
 * BEFORE the washout, so it could not evidence any rung above establishment —
 * the arc was structurally unobservable, not merely absent. The ladder is now
 * judged from what the arc actually emits after the intervention, on the live
 * branch. Nothing is tuned to manufacture a rung.
 *
 * Usage: pnpm exec tsx tools/validation/washout-reliance.ts
 * Retains to testdata/washout-reliance-0.21.json (resume-safe).
 *
 * CAPTURE_VERSION invalidates rows retained before post-assay capture existed.
 * Without it, a resume would accept those rows as done and the arc would stay
 * unobserved forever while the artifact looked complete. v3 additionally
 * narrows retained evidence to scalars and records the collapse tripwire, so a
 * non-firing disruption rung is interpretable rather than merely absent.
 * v4 removes the last dependence of a recorded outcome on artifact state: the
 * extended horizon is now reached on the biology, not on a stale row existing.
 */

const OUT = "testdata/washout-reliance-0.21.json";
const CAPTURE_VERSION = 4;
const SEEDS = [821947219, 2088626459, 3543950664, 2121676508, 111111111, 222222222, 333333333, 444444444];
const SETTLE_TICKS = 60000;
const EXTENDED_TICKS = 120000;
const ASSAY_TICKS = 15000;

function config(seed: number): EngineConfig {
  return {
    seed, start: 0.58, prod: 0.77, cap: 360, pop: 30, div: 0.35, mr: 0.03,
    ms: 0.12, press: 1.0875, patch: 0.6, resource_b_fraction: 0.5, cat: "global", st: null,
    resource_model: "definition_driven_substances", resource_grid: 60,
    enable_byproduct: true, enable_dormancy: true, study: true,
  };
}

function settle(session: UniverseSession, target: number): void {
  for (let i = 0; i < 2000 && session.snapshot().tick < target; i++) {
    const snapshot = session.advance(1000);
    const pending = snapshot.pendingDecision;
    if (pending) session.resolveEventDecision(pending.opportunityId, "keep-watching");
  }
  const leftover = session.snapshot().pendingDecision;
  if (leftover) session.resolveEventDecision(leftover.opportunityId, "keep-watching");
}

/**
 * The C-use guild arc, in tick order, as emitted by sim-analysis. Only the
 * SCALAR evidence fields are retained: a record's `evidence` also carries the
 * whole nested observation frame (including per-lineage flow arrays), which is
 * already exported elsewhere and made this artifact 296 KB of duplicated
 * accounting for eight rows. Ladder rungs above establishment are DERIVED from
 * the observed phase sequence; the succession classification compares the
 * leading lineage identity carried in entityRefs across records rather than
 * matching summary text, so it stays factual if the wording changes.
 */
function cuseArc(session: UniverseSession, fromTick: number) {
  return (((session.analysis as any).records as any[])
    .filter((r: any) => r.kind === "cuse" && r.tick >= fromTick)
    .map((r: any) => {
      const scalars: Record<string, number | string | boolean> = {};
      for (const [k, v] of Object.entries(r.evidence ?? {})) {
        if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") scalars[k] = v;
      }
      return {
        tick: r.tick,
        phase: r.phase,
        leadingLineage: (r.entityRefs && r.entityRefs[0]) ?? null,
        scavengerShare: typeof scalars.crossfeeder_fraction === "number" ? scalars.crossfeeder_fraction : null,
        evidence: scalars,
      };
    }));
}

/** The relative collapse tripwire the analysis layer applies. Mirrors
 *  DEP_GUILD_COLLAPSE in sim-analysis; a non-firing disruption rung is only
 *  interpretable against this number, so it is retained with the result. */
const DEP_GUILD_COLLAPSE = 0.33;

/**
 * Which C-ladder rungs the observed arc actually reached after the assay.
 * Reported as evidence, never as a pass/fail: a rung that did not fire is a
 * finding about current biology, not a defect in the assay.
 *
 * `collapseTripwire` / `retainedShare` are the diagnostic that makes a
 * non-firing rung readable. Disruption is defined RELATIVE to the established
 * scavenger share, so "no disruption record" must be expressible as "the guild
 * retained X% of its established share against a tripwire of Y%".
 */
function ladderFromArc(pre: any[], post: any[], liveScavengerShare: number) {
  const phases = post.map((r) => r.phase);
  const est = [...pre].reverse().find((r) => r.phase === "established");
  const establishedLead = est?.leadingLineage ?? null;
  const estScav = est?.scavengerShare ?? null;
  const tripwire = estScav === null ? null : estScav * DEP_GUILD_COLLAPSE;
  const recovery = post.filter((r) => r.phase === "recovered");
  return {
    postPhases: phases,
    // Disruption and recovery are read straight off the arc.
    disrupted: phases.includes("disrupted"),
    recovered: recovery.length > 0,
    // Reorganization/replacement: recovery led by a different lineage than the
    // one that led at establishment. Same-lineage recovery is not replacement.
    replacement: recovery.some((r) => r.leadingLineage !== null && r.leadingLineage !== establishedLead),
    establishedLeadLineage: establishedLead,
    establishedScavengerShare: estScav,
    collapseTripwire: tripwire,
    liveScavengerShareAfterAssay: liveScavengerShare,
    // Fraction of the established guild the live branch still held.
    retainedShare: estScav === null || estScav <= 0 ? null : liveScavengerShare / estScav,
    belowCollapseTripwire: tripwire === null ? null : liveScavengerShare < tripwire,
  };
}

const result: any = {
  engine: ENGINE_VERSION,
  captureVersion: CAPTURE_VERSION,
  policyVersion: CATALYST_POLICY_VERSION,
  config: "balanced",
  settleTicks: SETTLE_TICKS,
  assayTicks: ASSAY_TICKS,
  intervention: { schemaVersion: 1, kind: "nutrient_disturbance", mode: "c_washout" },
  rows: [],
};
try {
  const prior = JSON.parse(readFileSync(OUT, "utf8"));
  // Resume only when the artifact was produced by the SAME engine, capture
  // shape AND catalyst policy. Policy is part of the key because eligibility
  // changes the deterministic command stream: removing the universal stock
  // floor (Issue #30 §21.1) moved the balanced fixture's establishment by 502
  // ticks, so an artifact retained under an older policy records timing the
  // current product would never produce. Keying on engine alone would let it be
  // accepted as done forever.
  if (
    prior.engine === result.engine &&
    prior.captureVersion === CAPTURE_VERSION &&
    prior.policyVersion === result.policyVersion &&
    Array.isArray(prior.rows)
  ) {
    result.rows = prior.rows;
    console.log(`resuming: ${result.rows.length} rows already retained`);
  } else {
    console.log(`prior artifact does not match capture v${CAPTURE_VERSION}; re-running every seed`);
  }
} catch { /* fresh run */ }
// A row counts as done only if it carries the post-assay capture. Otherwise a
// pre-capture row would be accepted as complete and the arc would stay
// unobserved while the artifact looked finished.
const done = new Set(
  result.rows.filter((r: any) => (r.applicable || r.extended) && r.cuseArcPost !== undefined).map((r: any) => r.seed),
);

for (const seed of SEEDS) {
  if (done.has(seed)) {
    console.log(`${seed}: already retained, skipping`);
    continue;
  }
  // The horizon is decided by the biology, never by artifact state. A seed with
  // no guild by SETTLE_TICKS is ALWAYS given the extended horizon before being
  // recorded as non-establishment.
  //
  // This was previously `rows.some(r => r.seed === seed) ? EXTENDED : SETTLE`,
  // which made a recorded scientific outcome depend on whether a stale row
  // happened to be present. Invalidating the capture version wiped those rows,
  // silently truncated the escalation, and reported seed 821947219 as "no C-use
  // guild established by 60k" even though it establishes at ~108.7k.
  const session = new UniverseSession();
  session.create(config(seed));
  settle(session, SETTLE_TICKS);
  const cuseEstablished = () =>
    ((session.analysis as any).records as any[]).filter((r: any) => r.kind === "cuse" && r.phase === "established");
  let established = cuseEstablished();
  let horizon = SETTLE_TICKS;
  if (established.length === 0) {
    settle(session, EXTENDED_TICKS);
    established = cuseEstablished();
    horizon = EXTENDED_TICKS;
  }
  // Baseline arc, read at the fork point: everything the C-use guild did
  // before the intervention.
  const cusePre = cuseArc(session, 0);
  const entry: any = { seed, horizon };
  if (established.length === 0) {
    entry.applicable = false;
    entry.extended = horizon >= EXTENDED_TICKS;
    entry.reason = `no C-use guild established by ${horizon / 1000}k`;
    // No intervention is applied on a non-establishment row, so there is no
    // post-assay arc. The pre-assay arc is still retained: it is the negative
    // evidence for why the seed is not applicable.
    entry.interventionApplied = false;
    entry.cuseArcPre = cusePre;
    entry.cuseArcPost = [];
    entry.ladder = { postPhases: [], disrupted: false, recovered: false, replacement: false };
    const prior = result.rows.findIndex((r: any) => r.seed === seed);
    if (prior >= 0) result.rows.splice(prior, 1);
    result.rows.push(entry);
  } else {
    session.createControlFork();
    const forkTick = session.snapshot().tick;
    session.applyIntervention(result.intervention, "reliance survey");
    const washTick = session.snapshot().tick;
    settle(session, washTick + ASSAY_TICKS);
    const snap = session.snapshot();
    const live = snap.metrics as any;
    const control = snap.control!.metrics as any;
    const liveShare = (live.metabolic_roles?.counts?.byproduct_scavenger || 0) / live.population;
    const controlShare = (control.metabolic_roles?.counts?.byproduct_scavenger || 0) / control.population;
    const liveRemovals = live.nutrient_field.accounting.removal_events as any[];
    const controlRemovals = control.nutrient_field.accounting.removal_events as any[];
    // Structural invariants hold on every row; the OUTCOME is evidence.
    assert.equal(controlRemovals.length, 0, `${seed}: control records no removals`);
    assert.ok(liveRemovals.some((e: any) => e.type === "cWashout"), `${seed}: washout recorded`);
    assert.ok(liveRemovals.every((e: any) => e.type === "cWashout"), `${seed}: C-only removals`);
    const stale = result.rows.findIndex((r: any) => r.seed === seed);
    if (stale >= 0) result.rows.splice(stale, 1);
    // POST-assay capture: the arc is read again now that the assay has run.
    // This is the observation the tool previously could not make, so rungs
    // above establishment were unevidenced by construction.
    const cusePost = cuseArc(session, washTick);
    const ladder = ladderFromArc(cusePre, cusePost, liveShare);
    result.rows.push({
      seed, horizon, applicable: true, forkTick, washTick,
      establishedTick: established[0].tick,
      livePopulation: live.population, controlPopulation: control.population,
      liveScavengerShare: liveShare, controlScavengerShare: controlShare,
      liveCStock: live.metabolite_c.stock, controlCStock: control.metabolite_c.stock,
      materialResponse: liveShare < controlShare / 2,
      interventionApplied: true,
      cuseArcPre: cusePre,
      cuseArcPost: cusePost,
      ladder,
    });
  }
  writeFileSync(OUT, JSON.stringify(result, null, 2));
  const row = result.rows[result.rows.length - 1];
  assert.equal(row.seed, seed, "just-written row belongs to this seed");
  console.log(
    row.applicable
      ? `${seed}: live ${(row.liveScavengerShare * 100).toFixed(1)}% vs control ${(row.controlScavengerShare * 100).toFixed(1)}% material=${row.materialResponse} arc=[${(row.ladder?.postPhases || []).join(",") || "none"}]`
      : `${seed}: not applicable (${row.reason})`,
  );
}

const applicable = result.rows.filter((r: any) => r.applicable);
for (const seed of SEEDS) {
  assert.ok(result.rows.some((r: any) => r.seed === seed), `missing row for seed ${seed}`);
}
// Ladder census, reported as what the observed arcs actually contained. No
// target frequency is asserted and nothing here is tuned to fill a rung.
const ladder = {
  disrupted: applicable.filter((r: any) => r.ladder?.disrupted).length,
  recovered: applicable.filter((r: any) => r.ladder?.recovered).length,
  replacement: applicable.filter((r: any) => r.ladder?.replacement).length,
};
console.log(
  `washout reliance survey: DONE -> ${OUT} ` +
  `(${applicable.length}/${result.rows.length} applicable, ` +
  `material=${applicable.filter((r: any) => r.materialResponse).length}, ` +
  `post-assay arc: disrupted=${ladder.disrupted} recovered=${ladder.recovered} replacement=${ladder.replacement})`,
);
