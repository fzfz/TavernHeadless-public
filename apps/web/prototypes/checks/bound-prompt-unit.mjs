import assert from "node:assert/strict";
import fs from "node:fs";
const origin = process.argv[2];
assert.ok(origin, "Pass the isolated prototype origin");
const preview = (id, body) =>
  fetch(`${origin}/script-api/sessions/${id}/prompt-preview`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const role = new URL("../characters/linqian/", import.meta.url);
const bundle = JSON.parse(
  fs.readFileSync(new URL("prompt-bundle.json", role), "utf8"),
);
const preset = JSON.parse(
  fs.readFileSync(new URL(bundle.presetFile, role), "utf8"),
);
const card = JSON.parse(
  fs.readFileSync(new URL("snapshot.json", role), "utf8"),
);
const input = "我们先回家吧。";
const first = await preview("script-linqian", { text: input });
assert.equal(first.status, 200);
const trace = await first.json();
assert.equal(trace.presetName, bundle.presetName);
assert.deepEqual(trace.regexSources, [
  { kind: "character", count: card.extensions.regex_scripts.length },
  { kind: "preset", count: preset.extensions.regex_scripts.length },
]);
assert.ok(
  trace.messages.some(
    (message) => message.role === "user" && message.content === input,
  ),
);
assert.equal(trace.sampling.temperature, preset.temperature);
assert.deepEqual(
  trace.controllers.map((value) => value.entryId),
  [109, 111, 127],
);
const entries = trace.worldbookActivatedEntries.map((entry) => entry.uid);
for (const id of [109, 111, 112, 127]) assert.ok(entries.includes(id));
for (const id of [113, 114, 115]) assert.ok(!entries.includes(id));
const repeat = await (await preview("script-linqian", { text: input })).json();
assert.equal(repeat.presetVersionId, trace.presetVersionId);
assert.equal(repeat.regexProfileVersionId, trace.regexProfileVersionId);
assert.equal((await preview("missing-session", { text: input })).status, 404);
assert.equal((await preview("script-linqian", {})).status, 400);
assert.ok(
  !trace.messages.some((message) =>
    message.content.includes("{{format_message_variable::"),
  ),
);
const diagnostics = trace.debug.macroWarnings.filter((warning) =>
  ["macro_unknown", "macro_arg_arity_invalid"].includes(warning.code),
);
assert.deepEqual(diagnostics, []);
assert.ok(
  !trace.messages.some((message) => /\{\{[^{}]+\}\}/.test(message.content)),
);
const report = {
  preset: trace.presetName,
  presetVersionId: trace.presetVersionId,
  regexSources: trace.regexSources,
  activatedWorldbookEntries: entries,
  messageCount: trace.messages.length,
  userInput: input,
  bindingChecks: "passed",
  fullPresetCompatibility: "live_not_yet_accepted",
  unresolvedMacros: [
    ...new Set(diagnostics.map((warning) => warning.macroName)),
  ],
};
const output = new URL(
  "../../../../docs/plans/evidence/linqian-live/prompt-bundle-check.json",
  import.meta.url,
);
fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report));
