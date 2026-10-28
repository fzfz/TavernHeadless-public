import { register } from "tsx/esm/api";
register();
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
const evidence = resolve(".planning/page-macros-implementation-2026-10-09");
const skill = resolve(".agents/skills/native-card-conversion/scripts");
const { bindPageMacros } = await import(join(skill, "page-macro-bindings.ts"));
const { indexPackage } = await import(join(skill, "index.ts"));
const { pack } = await import(join(skill, "tool.ts"));
const { verifyFormalPackage } = await import(join(skill, "formal.ts"));
const fixtures = JSON.parse(
  await readFile(join(evidence, "macro-fixtures.json"), "utf8"),
);
const input = JSON.parse(
  await readFile(join(evidence, "acceptance-cases.json"), "utf8"),
);
const operations = [];
for (const fixture of fixtures.fixtures) {
  const request = join(
    evidence,
    "macro-fixtures",
    fixture.id,
    input.cases[0].id + ".request.json",
  );
  const binding = await bindPageMacros(fixture.taskFile, request);
  assert.equal(binding.passed, true, JSON.stringify(binding));
  const task = JSON.parse(await readFile(binding.taskFile, "utf8"));
  const index = await indexPackage(binding.taskFile, "frontend/manifest.json");
  assert.equal(index.passed, true, JSON.stringify(index));
  const packed = await pack(binding.taskFile);
  assert.equal(packed.passed, true, JSON.stringify(packed));
  const formal = await verifyFormalPackage(
    packed.archive,
    join(dirname(binding.taskFile), "acceptance-formal"),
  );
  assert.equal(formal.passed, true, JSON.stringify(formal));
  fixture.taskFile = binding.taskFile;
  fixture.packageDirectory = task.packageDirectory;
  fixture.archive = packed.archive;
  fixture.formal = formal;
  fixture.frontend = JSON.parse(
    await readFile(
      join(task.packageDirectory, "frontend/manifest.json"),
      "utf8",
    ),
  );
  await writeFile(
    join(evidence, "macro-fixtures", fixture.id, "package-result.json"),
    JSON.stringify(fixture, null, 2),
  );
  operations.push({ card: fixture.id, binding, index, packed });
}
await writeFile(
  join(evidence, "macro-fixtures.json"),
  JSON.stringify(fixtures, null, 2),
);
await writeFile(
  join(evidence, "final-bundle-refresh.json"),
  JSON.stringify({ passed: true, operations }, null, 2),
);
process.stdout.write(
  JSON.stringify({ resultFile: join(evidence, "final-bundle-refresh.json") }) +
    "\n",
);
