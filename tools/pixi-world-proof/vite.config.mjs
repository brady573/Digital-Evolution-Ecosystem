// Dev-only server config for the pixiWorld proof entry (plain .mjs so the
// config loader needs no dependency resolution). probe.ts imports production
// modules via relative paths outside this root, so the repo root must be
// servable. Run: pnpm test:pixi-world
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
export default {
  server: {
    port: 5194,
    strictPort: true,
    host: "127.0.0.1",
    fs: { allow: [resolve(here, "../..")] },
  },
};
