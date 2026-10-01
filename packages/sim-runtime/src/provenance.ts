import type { Cleanliness, SourceProvenance } from "@digital-evolution/contracts";
// Version facts via the package's public constants export (the boundary):
// values only, never the engine module graph directly.
import { APP_VERSION, ENGINE_VERSION, EXPORT_FORMAT_VERSION } from "@digital-evolution/sim-core";

/**
 * Display/runtime provenance for presentation consumers (Lane 3 F1, AC1).
 * Explorer reads versions through this runtime boundary surface, never
 * through a direct sim-core import. Values only, no new authority: both
 * fields are the existing sim-core version facts republished for display.
 */
export const RUNTIME_IDENTITY = { engineVersion: ENGINE_VERSION, appVersion: APP_VERSION } as const;

// Build-time injected source facts. Vite replaces these textually via the
// `define` in apps/explorer/vite.config.ts; the `declare` emits nothing, so
// under tsx/Node (no defines) the bare identifiers stay unbound and the
// `typeof` guards below read them as undeterminable — never as clean.
declare const __DEE_GIT_COMMIT__: string | null | undefined;
declare const __DEE_GIT_DIRTY__: boolean | undefined;

/**
 * Read the build-time injected source facts. Under vite the values are the
 * commit SHA (or null) and the dirty flag baked in at build time; under
 * tsx/Node there is no injection, so this yields the unknown-triggering
 * shape `{ commit: null, dirty: false }`.
 */
export function readInjectedSource(): { commit: string | null; dirty: boolean } {
  const commit =
    typeof __DEE_GIT_COMMIT__ === "undefined" ||
    __DEE_GIT_COMMIT__ == null ||
    __DEE_GIT_COMMIT__ === ""
      ? null
      : __DEE_GIT_COMMIT__;
  const dirty = typeof __DEE_GIT_DIRTY__ === "undefined" ? false : __DEE_GIT_DIRTY__;
  return { commit, dirty };
}

/**
 * Resolve tri-state source cleanliness (Decision 4 §A6). A known commit on a
 * clean tree is the only clean state; a dirty tree is dirty (its commit is
 * still recorded); a null commit is unknown — never silently clean, even
 * when dirty is false. Dirty and unknown exports remain exportable; only a
 * known clean revision satisfies exact-source mapping.
 */
export function resolveSourceProvenance(commit: string | null, dirty: boolean): SourceProvenance {
  // Defense-in-depth: an empty string is not a revision — normalize it to
  // null so it resolves unknown, never clean, and never lands in git_commit.
  const resolved = commit == null || commit === "" ? null : commit;
  let cleanliness: Cleanliness;
  if (resolved === null) cleanliness = "unknown";
  else if (dirty) cleanliness = "dirty";
  else cleanliness = "clean";
  return {
    revision: {
      engine_version: ENGINE_VERSION,
      app_version: APP_VERSION,
      // The maintained export-format version passes through as-is (the "0.31"
      // string experiment.out() emits); the numeric envelope version is the
      // separate export_format_version: 1 field.
      format_version: EXPORT_FORMAT_VERSION,
      git_commit: resolved,
    },
    cleanliness,
  };
}
