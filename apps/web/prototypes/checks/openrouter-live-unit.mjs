import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { streamCompletion, applyProposal } from "./openrouter-live.mjs";
const require = createRequire(
  "/srv/tavern/TavernHeadless/node_modules/.pnpm/ajv@8.17.1/node_modules/ajv/package.json",
);
const Ajv = require("./dist/ajv.js");
const ajv = new Ajv({ strict: false });
const contract = JSON.parse(
  fs.readFileSync(
    new URL(
      "../../../../docs/character-authoring/state-update.schema.json",
      import.meta.url,
    ),
  ),
);
const validateOutput = ajv.compile({
  definitions: contract.definitions,
  $ref: "#/definitions/agentOutput",
});
const profile = JSON.parse(
  fs.readFileSync(
    new URL("../characters/gushengman/live-model.json", import.meta.url),
  ),
);
const initial = JSON.parse(
  fs.readFileSync(
    new URL("../characters/gushengman/scenario.json", import.meta.url),
  ),
).initial;
const validateState = ajv.compile(profile.stateSchema);
const proposal = {
  changes: [{ op: "set", path: "/顾声慢/情感连结度", value: 3 }],
  evidenceMessageIds: ["a"],
};
const apply = (output) =>
  applyProposal(initial, output, profile, validateOutput, validateState, ["a"]);
assert.equal(apply(proposal).顾声慢.情感连结度, 3);
assert.equal(initial.顾声慢.情感连结度, 0);
assert.deepEqual(apply({ changes: [], evidenceMessageIds: [] }), initial);
assert.throws(
  () => apply({ ...proposal, evidenceMessageIds: [] }),
  /EVIDENCE_REQUIRED/,
);
assert.throws(
  () => apply({ ...proposal, evidenceMessageIds: ["unknown"] }),
  /EVIDENCE_INVALID/,
);
assert.throws(() => apply({ ...proposal, facts: {} }), /FACTS_UNDECLARED/);
for (const [path, value, code] of [
  ["/顾声慢/情感连结度", 101, "SCHEMA"],
  ["/顾声慢/情感连结度", "3", "SCHEMA"],
  ["/__proto__/x", 1, "PATH_FORBIDDEN"],
]) {
  assert.throws(
    () =>
      apply({
        changes: [{ op: "set", path, value }],
        evidenceMessageIds: ["a"],
      }),
    new RegExp(code),
  );
}
assert.throws(
  () =>
    apply({
      changes: [{ op: "remove", path: "/世界/当前地址" }],
      evidenceMessageIds: ["a"],
    }),
  /SCHEMA/,
);
const config = { baseUrl: "https://openrouter.ai/api/v1", apiKey: "test-only" };
async function read(body, status = 200) {
  const chunks = [];
  const bytes = new TextEncoder().encode(body);
  const stream = new ReadableStream({
    start(c) {
      for (let i = 0; i < bytes.length; i += 3)
        c.enqueue(bytes.slice(i, i + 3));
      c.close();
    },
  });
  for await (const chunk of streamCompletion(
    config,
    "openrouter/free",
    [],
    undefined,
    async () => new Response(stream, { status }),
  ))
    chunks.push(chunk);
  return chunks;
}
const event = (value) => `data: ${JSON.stringify(value)}\n\n`;
const valid =
  event({ model: "free-provider", choices: [{ delta: { content: "你好" } }] }) +
  event({ choices: [{ delta: {}, finish_reason: "stop" }] }) +
  "data: [DONE]\n\n";
assert.equal((await read(valid)).map((x) => x.text).join(""), "你好");
await assert.rejects(read(valid, 429), /HTTP_429/);
await assert.rejects(
  read(event({ error: { message: "failed" } })),
  /STREAM_ERROR/,
);
await assert.rejects(
  read(event({ choices: [{ finish_reason: "length" }] })),
  /INCOMPLETE/,
);
await assert.rejects(
  read(event({ choices: [{ delta: { content: "partial" } }] })),
  /INTERRUPTED/,
);
console.log("OpenRouter transport and state proposal unit checks passed");

const { providerSchema } = await import("./openrouter-live.mjs");
const tuple = {
  type: "array",
  items: [{ type: "string", pattern: "^元指令:" }, { type: "string" }],
  additionalItems: false,
  minItems: 2,
  maxItems: 2,
};
assert.deepEqual(providerSchema(tuple), {
  type: "array",
  prefixItems: tuple.items,
  items: false,
  minItems: 2,
  maxItems: 2,
});
assert.ok(Array.isArray(tuple.items));

for await (const chunk of streamCompletion(
  { ...config, maxTokens: 4096 },
  "openrouter/free",
  [],
  undefined,
  async (_url, options) => {
    assert.equal(JSON.parse(options.body).max_tokens, 4096);
    return new Response("data: [DONE]\n\n");
  },
)) {
  assert.fail(JSON.stringify(chunk));
}

let capturedRequest;
for await (const _chunk of streamCompletion(
  {
    ...config,
    maxTokens: 4096,
    reasoning: { effort: "none" },
    sampling: { temperature: 1, top_p: 0.9, top_k: 40 },
  },
  "openrouter/free",
  [{ role: "user", content: "你好" }],
  undefined,
  async (_url, options) => {
    capturedRequest = JSON.parse(options.body);
    return new Response("data: [DONE]\n\n");
  },
))
  void _chunk;
assert.equal(capturedRequest.max_tokens, 4096);
assert.equal(capturedRequest.temperature, 1);
assert.equal(capturedRequest.top_p, 0.9);
assert.equal(capturedRequest.top_k, 40);
assert.deepEqual(capturedRequest.messages, [{ role: "user", content: "你好" }]);

const exhausted =
  event({
    id: "generation-budget",
    model: "fixture",
    choices: [{ delta: { content: "partial" }, finish_reason: "length" }],
  }) +
  event({
    choices: [],
    usage: {
      completion_tokens: 100,
      completion_tokens_details: { reasoning_tokens: 90 },
    },
  }) +
  "data: [DONE]\n\n";
await assert.rejects(read(exhausted), (error) => {
  assert.equal(error.message, "OPENROUTER_INCOMPLETE");
  assert.equal(error.providerError.generationId, "generation-budget");
  assert.equal(error.providerError.usage.completion_tokens, 100);
  assert.equal(
    error.providerError.usage.completion_tokens_details.reasoning_tokens,
    90,
  );
  return true;
});
await assert.rejects(
  read(exhausted.replace("data: [DONE]\n\n", "")),
  (error) => {
    assert.equal(error.providerError.finishReason, "length");
    assert.equal(error.providerError.usage.completion_tokens, 100);
    return true;
  },
);

assert.deepEqual(capturedRequest.reasoning, { effort: "none" });
const liveProfileSchema = JSON.parse(
  fs.readFileSync(
    new URL("./openrouter-live.schema.json", import.meta.url),
    "utf8",
  ),
);
const validateProfile = ajv.compile(liveProfileSchema);
assert.equal(validateProfile(profile), true);
assert.equal(
  validateProfile({
    ...profile,
    narratorReasoning: { effort: "none" },
    updaterReasoning: { effort: "medium" },
  }),
  true,
);
assert.equal(
  validateProfile({ ...profile, narratorReasoning: { effort: "invalid" } }),
  false,
);
assert.equal(validateProfile({ ...profile, updaterReasoning: {} }), false);
