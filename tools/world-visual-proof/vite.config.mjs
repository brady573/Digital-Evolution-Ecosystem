import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(root, "../..");

export default {
  root,
  resolve: {
    alias: {
      react: resolve(repoRoot, "apps/explorer/node_modules/react"),
      "react-dom": resolve(repoRoot, "apps/explorer/node_modules/react-dom"),
    },
  },
  server: { fs: { allow: [repoRoot] } },
};
