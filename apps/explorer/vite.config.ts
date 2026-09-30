import { execSync } from "node:child_process";
import { defineConfig } from "vite";

// Tranche A6 build-time source injection (Decision 4 §A6). This provides the
// raw revision facts only: the commit SHA (or null) and whether the tree was
// dirty. Cleanliness determination (clean/dirty/unknown) lives in
// sim-runtime's resolveSourceProvenance — never here. Any child-process
// failure yields commit null + dirty false, which resolves to unknown
// downstream, never silently clean.
function injectedSource(): { commit: string | null; dirty: boolean } {
  try {
    const commit = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
    const dirty = execSync("git status --porcelain", { encoding: "utf8" }).trim().length > 0;
    return { commit: commit.length > 0 ? commit : null, dirty };
  } catch {
    return { commit: null, dirty: false };
  }
}

const source = injectedSource();

// Default vite behavior for this project layout (index.html entry,
// src/main.tsx) plus the two source-fact defines.
export default defineConfig({
  define: {
    __DEE_GIT_COMMIT__: JSON.stringify(source.commit),
    __DEE_GIT_DIRTY__: JSON.stringify(source.dirty),
  },
});
