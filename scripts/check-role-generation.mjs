import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import assert from "node:assert/strict";
import { buildApp } from "../apps/api/dist/app.js";
import { loadConfig } from "../apps/api/dist/config.js";
import {
  roleAcceptanceConfigSchema,
  roleAcceptanceCredentialsSchema,
  roleAcceptanceBindingsSchema,
} from "./role-acceptance.schema.mjs";
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const config = roleAcceptanceConfigSchema.parse(await json(process.argv[2]));
const credentials = roleAcceptanceCredentialsSchema.parse(
  await json(config.credentialsFile),
);
const bindings = roleAcceptanceBindingsSchema.parse(
  await json(resolve(config.fixturesRoot, "bindings.json")),
);
const imported = await json(config.resultFile);
const directory = dirname(config.resultFile);
const prompts = await json(resolve(directory, "generation-scenarios.json"));
const resultFile = resolve(directory, "generation-result.json");
Object.assign(process.env, {
  DATA_DIR: config.dataRoot,
  DATABASE_URL: "",
  APP_SECRETS_MASTER_KEY: (await readFile(config.masterKeyFile, "utf8")).trim(),
  LLM_API_KEY: credentials.apiKey,
  LLM_BASE_URL: credentials.baseUrl,
  LLM_MODEL: credentials.narratorModel,
  LLM_PROVIDER: "openai-compatible",
  OPENAI_API_MODE: "chat",
  LLM_DEFAULT_TIMEOUT_MS: String(bindings.modelTimeoutMs),
  ENABLE_SSE_CHAT: "true",
  AUTH_MODE: "off",
  ACCOUNT_MODE: "single",
});
let app;
const result =
  process.argv[3] === "resume"
    ? await json(resultFile)
    : { status: "running", flows: [] };
result.status = "running";
delete result.error;
const save = () =>
  writeFile(resultFile, JSON.stringify(result, null, 2) + "\n");
const call = async (method, url, payload) => {
  const response = await app.inject({
    method,
    url,
    ...(payload === undefined ? {} : { payload }),
  });
  if (response.statusCode >= 400)
    throw new Error(
      `${method} ${url}: ${response.statusCode} ${response.body}`,
    );
  return response.json().data;
};
async function start() {
  ({ app } = await buildApp({ ...loadConfig(), logger: false }));
}
async function turn(flow, index) {
  if (flow.turns.some((item) => item.turn === index + 1 && item.complete))
    return;
  console.log(
    JSON.stringify({
      stage: "generation-start",
      role: flow.role,
      mode: flow.mode,
      sessionId: flow.sessionId,
      turn: index + 1,
    }),
  );
  let evidence = flow.turns.findLast(
    (item) => item.turn === index + 1 && item.floorId,
  );
  if (!evidence) {
    const response = await app.inject({
      method: "POST",
      url: `/sessions/${flow.sessionId}/respond/stream`,
      payload: { message: prompts[flow.role][index] },
    });
    const events = response.body
      .split(/\r?\n\r?\n/)
      .filter(Boolean)
      .map((block) => {
        const lines = block.split(/\r?\n/);
        return {
          type: lines
            .find((line) => line.startsWith("event:"))
            ?.slice(6)
            .trim(),
          data: lines
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n"),
        };
      })
      .filter((event) => event.data)
      .map((event) => ({ ...event, data: JSON.parse(event.data) }));
    const done = events.find((event) => event.type === "done");
    evidence = {
      turn: index + 1,
      statusCode: response.statusCode,
      events,
      ...(response.statusCode >= 400 ? { errorBody: response.body } : {}),
    };
    flow.turns.push(evidence);
    await save();
    if (!done)
      throw new Error(
        `Generation did not complete: ${flow.role}/${flow.mode}; inspect ${resultFile}`,
      );
    evidence.floorId = done.data.floor_id;
    await save();
  }
  const floorId = evidence.floorId;
  evidence.messages = await call(
    "GET",
    `/sessions/${flow.sessionId}/role-messages?floor_id=${encodeURIComponent(floorId)}`,
    undefined,
  );
  await save();
  assert(
    evidence.messages.some(
      (message) => message.role === "assistant" && message.content.trim(),
    ),
    `Empty narration ${flow.role}/${flow.mode}/${floorId}`,
  );
  evidence.snapshot = await call(
    "POST",
    `/sessions/${flow.sessionId}/role-state/updates`,
    { floor_id: floorId },
  );
  evidence.calls = await call("GET", `/floors/${floorId}/model-calls`);
  assert(
    evidence.calls.some(
      (item) =>
        item.call.purpose === "narration" && item.call.status === "succeeded",
    ),
  );
  assert(
    evidence.calls.some(
      (item) =>
        item.call.purpose === "state_update" &&
        item.call.status === "succeeded",
    ),
  );
  const reloaded = await call(
    "GET",
    `/sessions/${flow.sessionId}/role-view`,
    undefined,
  );
  assert.equal(reloaded.current.snapshotId, evidence.snapshot.snapshotId);
  evidence.complete = true;
  await save();
  console.log(
    JSON.stringify({
      stage: "generation-complete",
      role: flow.role,
      mode: flow.mode,
      turn: index + 1,
      floorId,
      calls: evidence.calls.length,
    }),
  );
}
try {
  await start();
  for (const role of imported.roles) {
    for (const mode of ["formal", "preview"]) {
      const previous = result.flows.find(
        (flow) => flow.role === role.role && flow.mode === mode,
      );
      if (previous) {
        await turn(previous, 0);
        await turn(previous, 1);
        continue;
      }
      const body = {
        user_id: imported.performerIds[mode === "formal" ? 0 : 1],
        opening_id: role.openings.find((opening) => opening.default).id,
      };
      const created =
        mode === "formal"
          ? await call(
              "POST",
              `/role-releases/${role.releaseId}/sessions`,
              body,
            )
          : await call("POST", `/role-apps/${role.draft.id}/preview-sessions`, {
              ...body,
              expected_revision: role.draft.revision,
            });
      const flow = {
        role: role.role,
        mode,
        sessionId: created.session.id,
        turns: [],
      };
      result.flows.push(flow);
      await save();
      await turn(flow, 0);
      await turn(flow, 1);
    }
  }
  await app.close();
  await start();
  result.restarted = true;
  await save();
  for (const flow of result.flows) await turn(flow, 2);
  result.status = "passed";
  await save();
} catch (error) {
  result.status = "failed";
  result.error = { name: error.name, message: error.message };
  await save();
  console.error(JSON.stringify({ status: "failed", resultFile }));
  process.exitCode = 1;
} finally {
  if (app) await app.close();
}
