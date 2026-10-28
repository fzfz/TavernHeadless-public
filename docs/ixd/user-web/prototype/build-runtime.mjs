import { createRequire } from "node:module";
import { dirname } from "node:path";
const require = createRequire(import.meta.url);
const { build } = require(
  require.resolve("esbuild", {
    paths: [dirname(require.resolve("vite/package.json"))],
  }),
);
import { fileURLToPath } from "node:url";

await build({
  entryPoints: [fileURLToPath(new URL("./runtime-entry.ts", import.meta.url))],
  outfile: fileURLToPath(new URL("./runtime.bundle.js", import.meta.url)),
  bundle: true,
  format: "esm",
  platform: "browser",
  minify: true,
  alias: {
    "@tavern/shared": fileURLToPath(
      new URL("../../../../packages/shared/src/index.ts", import.meta.url),
    ),
  },
});
