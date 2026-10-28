import { build } from "esbuild";
import { fileURLToPath } from "node:url";

export async function buildPageMacros(): Promise<string> {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("./page-macros.ts", import.meta.url))],
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "es2022",
    write: false,
    legalComments: "inline",
    logLevel: "silent",
  });
  return result.outputFiles[0]!.text;
}
