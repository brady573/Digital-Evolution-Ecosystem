// Dev-only server config for the Pixi spike entry point (plain .mjs so the
// config loader needs no dependency resolution). boot.ts imports workspace
// packages via relative paths outside this root, so the repo root must be
// servable. Run: pnpm spike:dev
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
export default {
  server: {
    port: 5193,
    strictPort: true,
    host: "127.0.0.1",
    fs: { allow: [resolve(here, "../..")] },
  },
};
