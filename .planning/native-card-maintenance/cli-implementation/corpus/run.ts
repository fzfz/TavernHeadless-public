import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { begin, precheckCard } from "../../../../scripts/native-card-conversion/source.ts";
const execute = promisify(execFile);
const evidence = resolve(".planning/native-card-maintenance/cli-implementation/corpus");
const list = JSON.parse(await readFile("docs/plans/native-card-converter/acceptance-cards.json", "utf8"));
const rows: unknown[] = [];
function pointer(value: unknown, path: string) {
  for (const key of path.slice(1).split("/")) value = (value as Record<string, unknown>)[key.replaceAll("~1", "/").replaceAll("~0", "~")];
  return value;
}
for (const card of list.cards) {
  const start = performance.now();
  try {
    const result = await begin(card.inputFile);
    const source = JSON.parse(await readFile(join(dirname(result.taskFile), "source.json"), "utf8"));
    const precheck = precheckCard(source);
    const unequal = precheck.written.filter((item) => JSON.stringify(pointer(source, item.sourcePointer)) !== JSON.stringify(pointer(precheck.character, item.targetPointer)));
    rows.push({id: card.id, inputFile: card.inputFile, taskFile: result.taskFile, durationMs: performance.now() - start, pendingCount: result.pendingCount, copiedFields: precheck.written.length, unequal, passed: unequal.length === 0});
  } catch (error) { rows.push({ id: card.id, inputFile: card.inputFile, durationMs: performance.now() - start, passed: false, error: String(error) }); }
}
const entry = resolve(".agents/skills/native-card-conversion/scripts/convert.mjs");
const start = performance.now();
const baseline = await execute(process.execPath, [entry, "begin", resolve(".planning/native-card-maintenance/cli-audit/source.json")], {maxBuffer: 2048});
const reference = JSON.parse(baseline.stdout);
const result = JSON.parse(await readFile(reference.resultFile, "utf8"));
await writeFile(join(evidence, "results.json"), JSON.stringify({scope: "begin结构与机械复制复核；不代表角色卡语义转换验收", rows, totals: {inputs: rows.length, failed: (rows as Array<{passed: boolean}>).filter((r) => !r.passed).length}, sameBaselineSource: {durationMs: performance.now() - start, stdoutBytes: Buffer.byteLength(baseline.stdout), stderrBytes: Buffer.byteLength(baseline.stderr), oldStdoutBytes: 501402, reference, result}}, null, 2));
process.stdout.write(join(evidence, "results.json") + "\n");
