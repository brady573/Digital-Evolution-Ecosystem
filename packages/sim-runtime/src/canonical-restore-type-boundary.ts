/**
 * Compile-time guard for the A3.4 canonical-restore boundary.
 *
 * The accepted property is:
 *
 *   runtime code may consume `ValidatedCanonicalRestoreState`, but not
 *   `CanonicalRestoreCandidate`.
 *
 * That is only worth anything if the COMPILER enforces it, so it is asserted
 * here rather than described in a comment.
 *
 * Why this file lives under `src/` rather than in a validation suite: `tools/`
 * is not compiled by any tsconfig, so a `@ts-expect-error` there would be checked
 * by nothing and could not protect the repository after merge. `pnpm typecheck`
 * compiles this file, which is what makes the assertions below load-bearing.
 *
 * Deliberately written WITHOUT `as any`. A cast would erase exactly the type
 * distinction under test and make every assertion here vacuous.
 *
 * This module has NO exports and no runtime statements. It exists purely so the
 * compiler evaluates these types; it is not part of the package's runtime API and
 * must not become so merely by living under `src/`. The declarations below are
 * intentionally unreferenced, which is why `noUnusedLocals` must stay disabled
 * in `tsconfig.base.json` — enabling it would require referencing them, and
 * that is a deliberate future decision rather than an accident to work around.
 *
 * If the barrier is ever widened so the negative uses below become legal, the
 * `@ts-expect-error` directives stop matching and `pnpm typecheck` FAILS on the
 * unused directive. If a directive is deleted while its illegal use remains,
 * the illegal use becomes a hard compile error. Both directions are the alarm.
 */
import type {
  CanonicalRestoreCandidate,
  ValidatedCanonicalRestoreState,
} from "@digital-evolution/contracts";

// Ambient only: this file asserts types and performs no work.
declare const candidate: CanonicalRestoreCandidate;
declare const validated: ValidatedCanonicalRestoreState;

// --- NEGATIVE: the untrusted candidate cannot pass as validated state --------
/* @ts-expect-error a runtime-untrusted candidate must not stand in for a validated state */
const notAValidatedState: ValidatedCanonicalRestoreState = candidate;

/* @ts-expect-error a candidate's observer payload is `unknown`, so it has no `.state` to consume */
const candidateObserver = candidate.analysis.state;

/* @ts-expect-error the decisions half is narrowed too: `unknown` is not a DecisionCheckpoint */
const candidateDecisions: ValidatedCanonicalRestoreState["decisions"] = candidate.decisions;

// --- POSITIVE: the validated state is usable where it is required -----------
const alsoValidated: ValidatedCanonicalRestoreState = validated;

const observerPayload: Record<string, unknown> = alsoValidated.analysis.state;

const controlPayload: Record<string, unknown> | null =
  alsoValidated.controlAnalysis === null ? null : alsoValidated.controlAnalysis.state;

const decisionCheckpoint = alsoValidated.decisions;
