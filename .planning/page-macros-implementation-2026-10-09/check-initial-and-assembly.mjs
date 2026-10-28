import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { resolve, join } from "node:path";
const evidence = resolve(".planning/page-macros-implementation-2026-10-09");
const preview = JSON.parse(
  await readFile(join(evidence, "preview-acceptance.json"), "utf8"),
);
assert.equal(preview.passed, true);
const records = [];
for (const result of preview.results) {
  const requests = JSON.parse(
    await readFile(join(result.evidenceDirectory, "requests.json"), "utf8"),
  );
  const dryRun = requests.find((item) => item.url.endsWith("/respond/dry-run"));
  assert.equal(dryRun.statusCode, 200);
  const {
    messages,
    assembly,
    runtime_trace: trace,
    prompt_snapshot: snapshot,
  } = dryRun.response.data;
  const checks = {
    fullDescription: messages.some(
      (item) =>
        item.role === "system" &&
        item.content.includes(result.persona.description),
    ),
    thirdPerson: messages.some(
      (item) =>
        item.role === "system" &&
        item.content.includes("叙述使用第三人称，直接引语按说话者解释。"),
    ),
    currentInput: messages.some(
      (item) =>
        item.role === "user" &&
        item.content === result.persona.name + ": " + dryRun.request.message,
    ),
    savedAssistant: messages.some(
      (item) =>
        item.role === "assistant" &&
        item.content === result.view.card + ": " + result.view.message,
    ),
    initialObject:
      result.initial.variables.details.address ===
      result.persona.name + "与" + result.view.card + "的资料室",
    initialArray:
      JSON.stringify(result.initial.variables.labels) ===
      JSON.stringify([result.persona.name, result.view.card]),
    prefixRule:
      assembly.names_behavior_applied === "always" &&
      trace.preset.names_behavior_applied === "always",
    boundSnapshot: Boolean(
      snapshot.preset_version_id && snapshot.character_version_id,
    ),
  };
  assert.ok(
    Object.values(checks).every(Boolean),
    JSON.stringify({ card: result.card, checks }),
  );
  records.push({
    card: result.card,
    persona: result.persona,
    request: dryRun.request,
    checks,
    messages,
    assembly,
    snapshot,
    macroTrace: trace.macro,
    view: result.view,
    evidenceDirectory: result.evidenceDirectory,
  });
}
await writeFile(
  join(evidence, "initial-and-assembly-acceptance.json"),
  JSON.stringify({ passed: true, records }, null, 2),
);
process.stdout.write(
  JSON.stringify({
    passed: true,
    sessions: records.length,
    resultFile: join(evidence, "initial-and-assembly-acceptance.json"),
  }) + "\n",
);
