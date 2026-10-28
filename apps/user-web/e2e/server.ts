import { createServer } from "node:http";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { buildTestApp } from "../../api/test/helpers/create-test-db.js";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../api/src/accounts/constants.js";
import { loadStorageConfig } from "../../api/src/storage-config.js";
import { writeNativeCardZip } from "../../api/src/services/native-card/zip.js";
import { acceptanceUsers, roleFixture, statePreset } from "./fixture.js";

const apiPort = Number(process.env.USER_WEB_API_PORT ?? 4310);
const providerPort = Number(process.env.USER_WEB_PROVIDER_PORT ?? 4311);
const dataRoot =
  process.env.USER_WEB_DATA_DIR ??
  (await mkdtemp(resolve(tmpdir(), "tavern-user-web-acceptance-")));
const adminKey = "user-web-local-seed-admin";
await mkdir(dataRoot, { recursive: true });
process.env.APP_SECRETS_MASTER_KEY = "user-web-isolated-local-acceptance";
process.env.ALLOW_PRIVATE_BASE_URL = "true";
let bodyCalls = 0;
const provider = createServer(async (request, response) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    await appendFile(
      resolve(dataRoot, "provider-requests.jsonl"),
      JSON.stringify(input) + "\n",
    );
    const sourceMessages = (input.messages ?? []) as { content: string }[];
    const isState = sourceMessages.some((message) =>
      String(message.content).includes("USER_WEB_STATE_FIXTURE"),
    );
    const structured = sourceMessages.flatMap((message) =>
      message.content.split("\n\n").flatMap((part) => {
        try {
          return [JSON.parse(part) as Record<string, unknown>];
        } catch {
          return [];
        }
      }),
    );
    const evidence = structured.find((value) => Array.isArray(value.sources));
    const sources = (evidence?.sources ?? []) as {
      role: string;
      messageId: string;
    }[];
    const alternatives = [
      "沈知夏把信封转向灯光，指着邮戳说：“我们可以先核对这个地址。”她将一张旧街区地图铺在柜台上，等待下一步线索。",
      "沈知夏移开灯罩，让邮戳边缘的蓝色印记显露出来。“这里像是一座灯塔。”她轻轻敲了敲地图，停在花园门口的位置。",
      "窗外的雾逐渐散开。沈知夏把湿信纸压平，认真读完了最后一行：“下一封信，或许会在天亮以前送到。”",
    ];
    const text = isState
      ? JSON.stringify({
          changes: [
            { op: "set", path: "/location", value: "花园门口" },
            { op: "set", path: "/hour", value: 23 },
            { op: "set", path: "/trust", value: 21 },
          ],
          evidenceMessageIds: sources
            .filter((source) => source.role === "assistant")
            .map((source) => source.messageId),
        })
      : alternatives[bodyCalls++ % alternatives.length]!;
    const base = {
      id: `local-fixture-${Date.now()}`,
      created: Math.floor(Date.now() / 1000),
      model: "user-web-controlled-model",
    };
    if (input.stream) {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      });
      const pieces = isState ? [text] : (text.match(/.{1,3}/gu) ?? []);
      for (const content of pieces) {
        if (response.destroyed) break;
        response.write(
          `data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`,
        );
        await new Promise((resolve) => setTimeout(resolve, 90));
      }
      if (!response.destroyed)
        response.end(
          `data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } })}\n\ndata: [DONE]\n\n`,
        );
    } else {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          ...base,
          object: "chat.completion",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: text },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 50,
            total_tokens: 150,
          },
        }),
      );
    }
  } catch (error) {
    response.writeHead(500);
    response.end(String(error));
  }
});
await new Promise<void>((resolve) =>
  provider.listen(providerPort, "127.0.0.1", resolve),
);
const storage = loadStorageConfig({ DATA_DIR: dataRoot });
const built = await buildTestApp({
  storage,
  databasePath: storage.databasePath,
  logger: false,
  accountMode: "multi",
  auth: {
    mode: "api_key",
    apiKeys: [adminKey],
    apiKeyAccountMap: { [adminKey]: DEFAULT_ADMIN_ACCOUNT_ID },
  },
  cors: { origins: ["http://127.0.0.1:4190", "http://localhost:4190"] },
  enableSseChat: true,
  enablePromptDryRun: true,
  llmProfileApiMode: "chat",
  enableMemoryConsolidation: false,
  orchestration: {
    providers: [
      {
        id: "user-web-controlled",
        type: "openai-compatible",
        apiMode: "chat",
        apiKey: "local-provider-only",
        baseURL: `http://127.0.0.1:${providerPort}/v1`,
      },
    ],
    defaultModel: {
      providerId: "user-web-controlled",
      modelId: "user-web-controlled-model",
    },
  },
});
const adminHeaders = { authorization: `Bearer ${adminKey}` };
const api = async (
  method: "GET" | "POST" | "PUT" | "PATCH",
  url: string,
  payload?: Record<string, unknown>,
) => {
  const response = await built.app.inject({
    method,
    url,
    headers: adminHeaders,
    payload,
  });
  if (response.statusCode >= 400)
    throw new Error(
      `${method} ${url}: ${response.statusCode} ${response.body}`,
    );
  return response.json().data;
};
const importPreset = async (data: Record<string, unknown>) => {
  const imported = await api("POST", "/import/preset", {
    name: data.name,
    data,
  });
  const versions = await api("GET", `/presets/${imported.id}/versions`);
  return { id: imported.id as string, versionId: versions[0].id as string };
};
async function seedFixture() {
  const baseConfig = JSON.parse(
    await readFile(
      new URL(
        "../../api/test/fixtures/native-card/acceptance-config.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const bodyPreset = await importPreset(baseConfig.preset);
  const state = await importPreset(statePreset);
  const persona = await api("POST", "/users", { snapshot: baseConfig.persona });
  const model = await api("POST", "/llm-profiles", {
    preset_name: "本地确定性传输验收",
    provider: "openai-compatible",
    model_id: "user-web-controlled-model",
    base_url: `http://127.0.0.1:${providerPort}/v1`,
    api_key: "local-provider-only",
  });
  const roles: { id: string; name: string; mode: string }[] = [];
  for (let index = 0; index < 14; index++) {
    const fixture = await roleFixture(index);
    const zip = writeNativeCardZip(
      Object.entries(fixture.files).map(([path, content]) => ({
        path,
        content: Buffer.from(content),
      })),
    );
    const inspected = await built.app.inject({
      method: "POST",
      url: `/native-cards/imports?fileName=role-${index + 1}.zip`,
      headers: { ...adminHeaders, "content-type": "application/zip" },
      payload: zip,
    });
    if (
      inspected.statusCode !== 200 ||
      inspected.json().data.status !== "ready"
    )
      throw new Error(`Role import: ${inspected.body}`);
    const card = await api(
      "POST",
      `/native-cards/imports/${inspected.json().data.id}/confirm`,
    );
    const published = await api(
      "POST",
      `/native-cards/${card.id}/publications`,
      {
        revision: card.revision,
        configuration: {
          presetId: bodyPreset.id,
          presetVersionId: bodyPreset.versionId,
          statePresetId: state.id,
          statePresetVersionId: state.versionId,
          stateHistoryTurns: 5,
          defaultUserId: persona.id,
          promptMode: "compat_plus",
          modelSlots: [
            {
              slot: "narrator",
              profile_id: model.id,
              params: { max_retries: 0 },
            },
            {
              slot: "state_updater",
              profile_id: model.id,
              params: { max_retries: 0 },
            },
          ],
        },
      },
    );
    roles.push({
      id: published.releaseId,
      name: fixture.name,
      mode: index % 2 ? "system_chat" : "custom",
    });
  }
  for (const user of acceptanceUsers) {
    const response = await built.app.inject({
      method: "POST",
      url: "/auth/register",
      payload: user,
    });
    if (response.statusCode !== 201)
      throw new Error(`Register: ${response.body}`);
  }
  const fixture = {
    apiUrl: `http://127.0.0.1:${apiPort}`,
    providerUrl: `http://127.0.0.1:${providerPort}`,
    dataRoot,
    users: acceptanceUsers,
    roles,
    providerPurpose: "deterministic transport and persistence acceptance",
  };
  await writeFile(
    resolve(dataRoot, "fixture.json"),
    JSON.stringify(fixture, null, 2),
  );
  return fixture;
}
let fixture: Awaited<ReturnType<typeof seedFixture>> | undefined;
try {
  fixture = JSON.parse(
    await readFile(resolve(dataRoot, "fixture.json"), "utf8"),
  ) as Awaited<ReturnType<typeof seedFixture>>;
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
fixture ??= await seedFixture();
await built.app.listen({ host: "127.0.0.1", port: apiPort });
console.log(
  JSON.stringify({
    ...fixture,
    fixtureFile: resolve(dataRoot, "fixture.json"),
  }),
);
const close = async () => {
  provider.close();
  await built.app.close();
};
process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());
