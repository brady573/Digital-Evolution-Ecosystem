import type { Cleanliness, SourceProvenance } from "@digital-evolution/contracts";
import { APP_VERSION, ENGINE_VERSION, EXPORT_FORMAT_VERSION } from "@digital-evolution/sim-core";

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
    typeof __DEE_GIT_COMMIT__ === "undefined" || __DEE_GIT_COMMIT__ === null
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
  let cleanliness: Cleanliness;
  if (commit === null) cleanliness = "unknown";
  else if (dirty) cleanliness = "dirty";
  else cleanliness = "clean";
  return {
    revision: {
      engine_version: ENGINE_VERSION,
      app_version: APP_VERSION,
      // Task 1 types this field as number while version.ts holds the "0.31"
      // string; coerce numerically so the carried value stays the maintained
      // export-format version rather than a literal chosen here.
      format_version: Number(EXPORT_FORMAT_VERSION),
      git_commit: commit,
    },
    cleanliness,
  };
}
