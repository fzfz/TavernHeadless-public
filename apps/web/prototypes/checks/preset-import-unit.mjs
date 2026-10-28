import assert from "node:assert/strict";
import { preparePresetImport } from "./preset-import.mjs";
const source = {
  prompts: [
    {
      identifier: "a",
      role: "model",
      content: "A\n\n{{trim}}\nB{{// note::text}}C",
    },
    { identifier: "b", role: "user", content: "{{getvar::name}}" },
  ],
};
const policy = {
  roleAliases: { model: "assistant" },
  trimMacro: true,
  commentMacros: true,
};
const result = preparePresetImport(source, policy);
assert.equal(result.data.prompts[0].role, "assistant");
assert.equal(result.data.prompts[0].content, "ABC");
assert.equal(result.data.prompts[1].content, "{{getvar::name}}");
assert.equal(source.prompts[0].role, "model");
assert.ok(source.prompts[0].content.includes("{{trim}}"));
assert.equal(result.conversions.length, 3);
assert.deepEqual(
  preparePresetImport(source, {
    roleAliases: {},
    trimMacro: false,
    commentMacros: false,
  }).data,
  source,
);
assert.deepEqual(preparePresetImport({}, policy), {
  data: {},
  conversions: [],
});
assert.equal(
  preparePresetImport(
    { prompts: [{ content: "before{{// unfinished" }] },
    policy,
  ).data.prompts[0].content,
  "before{{// unfinished",
);
console.log(
  "Preset import conversions preserve originals and explicit policy branches",
);
