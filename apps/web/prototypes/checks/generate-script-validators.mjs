// Uses already installed workspace tools; no dependency installation.
import fs from "node:fs";
import { pathToFileURL } from "node:url";
const dependencyRoot =
  process.argv[2] ||
  "/srv/tavern/TavernHeadless/node_modules/.pnpm";
const ajvRoot = dependencyRoot + "/ajv@8.17.1/node_modules";
const { default: Ajv } = await import(
  pathToFileURL(ajvRoot + "/ajv/dist/ajv.js")
);
const { default: standalone } = await import(
  pathToFileURL(ajvRoot + "/ajv/dist/standalone/index.js")
);
const esbuild = await import(
  pathToFileURL(
    dependencyRoot + "/esbuild@0.25.12/node_modules/esbuild/lib/main.js",
  )
);
const schema = JSON.parse(
  fs.readFileSync("docs/character-authoring/script-runtime.schema.json"),
);
schema.$id = "runtime";
const ajv = new Ajv({ strict: true, code: { source: true, esm: true } });
ajv.addSchema(schema);
const refs = Object.fromEntries(
  Object.keys(schema.definitions).map((k) => [
    k === "package" ? "packageSchema" : k,
    "runtime#/definitions/" + k,
  ]),
);
esbuild.buildSync({
  stdin: { contents: standalone(ajv, refs), resolveDir: ajvRoot },
  bundle: true,
  format: "esm",
  platform: "browser",
  outfile: "apps/web/prototypes/shared/script-validators.prototype.js",
});
