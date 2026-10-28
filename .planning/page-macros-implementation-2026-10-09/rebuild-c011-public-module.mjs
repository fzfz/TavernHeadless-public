import { register } from "tsx/esm/api";
register();
import { readFile, writeFile, copyFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
const evidence = resolve(".planning/page-macros-implementation-2026-10-09");
const directory = join(evidence, "conversions/C011-final");
const independent = JSON.parse(
  await readFile(join(directory, "result.json"), "utf8"),
);
const { bindPageMacros } = await import(
  resolve(
    ".agents/skills/native-card-conversion/scripts/page-macro-bindings.ts",
  )
);
const { indexPackage } = await import(
  resolve(".agents/skills/native-card-conversion/scripts/index.ts")
);
const { pack } = await import(
  resolve(".agents/skills/native-card-conversion/scripts/tool.ts")
);
const config = JSON.parse(
  await readFile(
    resolve(
      ".agents/skills/native-card-conversion/config/page-macro-bindings.json",
    ),
    "utf8",
  ),
);
let taskFile = independent.taskFile;
let task = JSON.parse(await readFile(taskFile, "utf8"));
const source = JSON.parse(await readFile(task.sourceFile, "utf8"));
const installation = JSON.parse(
  await readFile(
    join(task.packageDirectory, config.paths.installation),
    "utf8",
  ),
);
const bindings = (
  await import(join(task.packageDirectory, config.paths.bindings))
)[config.exports.bindings];
const operations = [];
for (const metadata of installation.sources) {
  let text = source;
  for (const token of metadata.source.pointer.slice(1).split("/"))
    text = text[token.replaceAll("~1", "/").replaceAll("~0", "~")];
  const binding = bindings.find((item) => item.id === metadata.id);
  const request = {
    ...metadata,
    template: text.slice(metadata.source.start, metadata.source.end),
    ...(binding.conditions ? { conditions: binding.conditions } : {}),
  };
  const requestFile = join(directory, metadata.id + "-rebuild.request.json");
  await writeFile(requestFile, JSON.stringify(request, null, 2));
  const result = await bindPageMacros(taskFile, requestFile);
  assert.equal(result.passed, true, JSON.stringify(result));
  operations.push({ taskFile, requestFile, result });
  taskFile = result.taskFile;
  task = JSON.parse(await readFile(taskFile, "utf8"));
}
const index = await indexPackage(taskFile, config.paths.frontendManifest);
assert.equal(index.passed, true, JSON.stringify(index));
const packed = await pack(taskFile);
assert.equal(packed.passed, true, JSON.stringify(packed));
const archive = join(directory, "C011-current-public-module.zip");
await copyFile(packed.archive, archive);
const result = {
  status: "success",
  independentResult: join(directory, "result.json"),
  taskFile,
  packageDirectory: task.packageDirectory,
  skillArchive: packed.archive,
  archive,
  index,
  packed,
  operations,
};
await writeFile(
  join(directory, "final-generation-result.json"),
  JSON.stringify(result, null, 2),
);
process.stdout.write(
  JSON.stringify({
    resultFile: join(directory, "final-generation-result.json"),
  }) + "\n",
);
