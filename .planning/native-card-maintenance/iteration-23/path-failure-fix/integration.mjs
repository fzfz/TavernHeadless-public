import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { performance } from "node:perf_hooks";
import { begin } from "../../../../scripts/native-card-conversion/source.ts";
import { mapEntry } from "../../../../scripts/native-card-conversion/write.ts";

const run = promisify(execFile);
const entrypoint = resolve(
  ".agents/skills/native-card-conversion/scripts/convert.mjs",
);
const input = resolve(".tmp/native-card-inputs/USER002-v1.3.32/input.json");
const source = JSON.parse(await readFile(input, "utf8"));
const entries = source.data.character_book.entries;
const sourcePointer = "/data/character_book/entries";
const beforeSource = await readFile(input);
const report = {
  input,
  entries: entries.length,
  single: {},
  batch: {},
  failures: {},
};

async function command(args) {
  try {
    const r = await run(process.execPath, [entrypoint, ...args], {
      maxBuffer: 8 * 1024 * 1024,
    });
    return { code: 0, result: JSON.parse(r.stdout) };
  } catch (e) {
    return { code: e.code, result: JSON.parse(e.stdout) };
  }
}

let one, results;
if (process.argv[2] === "batch") {
  report.single = JSON.parse(
    await readFile(
      resolve(
        ".planning/native-card-maintenance/iteration-23/path-failure-fix/single-results.json",
      ),
      "utf8",
    ),
  );
  one = JSON.parse(await readFile(report.single.taskFile, "utf8"));
  results = report.single.results;
} else {
  one = await begin(input);
  const startOne = performance.now();
  results = [];
  for (let i = 0; i < entries.length; i++) {
    const file = join(
      one.packageDirectory,
      `worldbooks/test/entries/e${i}.json`,
    );
    const result = await command([
      "map-entry",
      one.taskFile,
      `${sourcePointer}/${i}`,
      file,
      "--copy-content",
    ]);
    results.push({ index: i, ...result });
  }
  report.single = {
    taskFile: one.taskFile,
    elapsedMs: performance.now() - startOne,
    results,
  };

  await writeFile(
    resolve(
      ".planning/native-card-maintenance/iteration-23/path-failure-fix/single-results.json",
    ),
    JSON.stringify(report.single, null, 2) + "\n",
  );
  if (process.argv[2] === "single") {
    console.log(
      JSON.stringify({
        elapsedMs: report.single.elapsedMs,
        total: results.length,
        passed: results.filter((r) => r.code === 0 && r.result.passed === true)
          .length,
      }),
    );
    process.exit(
      results.every((r) => r.code === 0 && r.result.passed === true) ? 0 : 1,
    );
  }
}

const many = await begin(input);
const startMany = performance.now();
const batch = await command([
  "map-entry",
  many.taskFile,
  sourcePointer,
  join(many.packageDirectory, "worldbooks/test/entries"),
  "--indices",
  entries.map((_, i) => i).join(","),
  "--copy-content",
]);
report.batch = {
  taskFile: many.taskFile,
  elapsedMs: performance.now() - startMany,
  ...batch,
};
let equalSourceMappings = 0;
let equalSingleBatch = 0;
for (let i = 0; i < entries.length; i++) {
  const a = JSON.parse(
    await readFile(
      join(one.packageDirectory, `worldbooks/test/entries/e${i}.json`),
      "utf8",
    ),
  );
  const b = JSON.parse(
    await readFile(
      join(many.packageDirectory, `worldbooks/test/entries/e${i}.json`),
      "utf8",
    ),
  );
  if (
    JSON.stringify(a) ===
    JSON.stringify(mapEntry(entries, i, sourcePointer, true).entry)
  )
    equalSourceMappings++;
  if (
    JSON.stringify(a) === JSON.stringify(b) &&
    b.content === entries[i].content
  )
    equalSingleBatch++;
}
const bad = await command([
  "map-entry",
  many.taskFile,
  `${sourcePointer}/0`,
  join(many.outputDirectory, "outside.json"),
  "--copy-content",
]);
const partialTask = await begin(input);
const partialDir = join(
  partialTask.packageDirectory,
  "worldbooks/test/entries",
);
await mkdir(partialDir, { recursive: true });
await writeFile(join(partialDir, "e1.json"), "[]");
const partial = await command([
  "map-entry",
  partialTask.taskFile,
  sourcePointer,
  "worldbooks/test/entries",
  "--indices",
  "0,1,2",
  "--copy-content",
]);
const partialContinued =
  partial.code === 1 &&
  partial.result.passed === false &&
  partial.result.results.length === 3 &&
  partial.result.results[0].passed === true &&
  partial.result.results[1].passed === false &&
  partial.result.results[1].file === join(partialDir, "e1.json") &&
  partial.result.results[2].passed === true &&
  (await readFile(join(partialDir, "e1.json"), "utf8")) === "[]";
const invalidIndices = await command([
  "map-entry",
  many.taskFile,
  sourcePointer,
  "worldbooks/test/entries",
  "--indices",
  String(entries.length),
  "--copy-content",
]);
report.failures = {
  outsidePath: bad,
  outOfBoundsSelection: invalidIndices,
  partialBatch: partial,
};
report.checks = {
  singlePassed: results.filter((r) => r.code === 0 && r.result.passed === true)
    .length,
  batchPassed: batch.code === 0 && batch.result.passed === true,
  equalSourceMappings,
  equalSingleBatch,
  partialContinued,
  sourceUnchanged: beforeSource.equals(await readFile(input)),
  failureSignaled:
    bad.code === 1 &&
    bad.result.passed === false &&
    invalidIndices.code === 1 &&
    invalidIndices.result.passed === false,
};
await writeFile(
  resolve(
    ".planning/native-card-maintenance/iteration-23/path-failure-fix/integration.json",
  ),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      singleMs: report.single.elapsedMs,
      batchMs: report.batch.elapsedMs,
      checks: report.checks,
    },
    null,
    2,
  ),
);
if (
  report.checks.singlePassed !== entries.length ||
  !report.checks.batchPassed ||
  equalSourceMappings !== entries.length ||
  equalSingleBatch !== entries.length ||
  !report.checks.partialContinued ||
  !report.checks.sourceUnchanged ||
  !report.checks.failureSignaled
)
  process.exitCode = 1;
