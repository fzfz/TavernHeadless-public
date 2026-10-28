import { createServer } from "node:http";
import { appendFile, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createTavernClient } from "@tavern/sdk";
import { roleUserWebConfigSchema } from "@tavern/shared";
import { buildTestApp as buildApp } from "../test/helpers/create-test-db.js";
import { loadStorageConfig } from "../src/storage-config.js";
import { nativeCardAcceptanceConfigSchema } from "../test/fixtures/native-card/acceptance-config.schema.js";

const root = resolve(new URL("../../..", import.meta.url).pathname);
const config = nativeCardAcceptanceConfigSchema.parse(
  JSON.parse(
    await readFile(
      process.env.NATIVE_CARD_ACCEPTANCE_CONFIG ?? new URL(
        "../test/fixtures/native-card/acceptance-config.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ),
);
const dataRoot = resolve(
  root,
  process.env.NATIVE_CARD_ACCEPTANCE_DATA_DIR ?? config.dataDirectory,
);
await mkdir(dataRoot, { recursive: true });
const userPublic = resolve(dataRoot, "user-web-public/config");
await mkdir(userPublic, { recursive: true });
await writeFile(resolve(userPublic, "application.json"), JSON.stringify(roleUserWebConfigSchema.parse({
  apiBaseUrl: `http://127.0.0.1:${config.apiPort}`,
  adminBaseUrl: config.webOrigin,
}), null, 2));
await copyFile(resolve(root, "apps/user-web/public/config/runtime-policy.json"), resolve(userPublic, "runtime-policy.json"));
process.env.APP_SECRETS_MASTER_KEY =
  "native-card-controlled-local-acceptance-only";
process.env.ALLOW_PRIVATE_BASE_URL = "true";
const provider = createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    await appendFile(
      resolve(dataRoot, "provider-requests.jsonl"),
      JSON.stringify(input) + "\n",
    );
    const source = input.messages
      ?.map((m: { content: unknown }) => m.content)
      .find((content: unknown) => {
        if (typeof content !== "string") return false;
        try {
          return Array.isArray(JSON.parse(content).writablePaths);
        } catch {
          return false;
        }
      });
    const updateContext = source ? JSON.parse(source) : null;
    const text = updateContext
      ? JSON.stringify({
          changes: Object.entries(config.updatedState).map(([key, value]) => ({
            op: "set",
            path: `/${key}`,
            value,
          })),
          evidenceMessageIds: updateContext.sources
            .filter((m: { role: string }) => m.role === "assistant")
            .map((m: { messageId: string }) => m.messageId),
        })
      : config.narration.join("");
    const responseBase = {
      id: "controlled-response",
      created: 1,
      model: config.modelId,
    };
    if (input.stream) {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      });
      const pieces = updateContext ? [text] : config.narration;
      for (const content of pieces) {
        res.write(
          `data: ${JSON.stringify({ ...responseBase, object: "chat.completion.chunk", choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`,
        );
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      res.end(
        `data: ${JSON.stringify({ ...responseBase, object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
      );
    } else {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ...responseBase,
          object: "chat.completion",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: text },
              finish_reason: "stop",
            },
          ],
        }),
      );
    }
  } catch (error) {
    res.writeHead(500);
    res.end(String(error));
  }
});
await new Promise<void>((resolve) =>
  provider.listen(config.providerPort, "127.0.0.1", resolve),
);
const storage = loadStorageConfig({ DATA_DIR: dataRoot });
const built = await buildApp({
  storage,
  databasePath: storage.databasePath,
  auth: { mode: "off" },
  logger: false,
  cors: { origins: [config.webOrigin, config.userWebOrigin] },
  enableSseChat: true,
  enablePromptDryRun: true,
  llmProfileApiMode: "chat",
  orchestration: {
    providers: [
      {
        id: config.providerId,
        type: "openai-compatible",
        apiMode: "chat",
        apiKey: "controlled-local-only",
        baseURL: `http://127.0.0.1:${config.providerPort}/v1`,
      },
    ],
    defaultModel: { providerId: config.providerId, modelId: config.modelId },
  },
});
await built.app.listen({ host: "127.0.0.1", port: config.apiPort });
const client = createTavernClient({
  baseUrl: `http://127.0.0.1:${config.apiPort}`,
});
let presetId = (await client.presets.list()).find(
  (p) => p.name === config.preset.name,
)?.id;
if (!presetId)
  presetId = (
    await client.imports.preset({
      data: config.preset,
      name: config.preset.name,
    })
  ).id;
let persona = (await client.users.list()).find(
  (p) => p.name === config.persona.name,
);
if (!persona) persona = await client.users.create({ snapshot: config.persona });
let model = (await client.llmProfiles.list()).find(
  (p) => p.modelId === config.modelId,
);
if (!model)
  model = await client.llmProfiles.create({
    presetName: "本地受控响应验收",
    provider: "openai-compatible",
    modelId: config.modelId,
    baseUrl: `http://127.0.0.1:${config.providerPort}/v1`,
    apiKey: "controlled-local-only",
  });
const presetVersion = (await client.presets.listVersions({ presetId }))[0];
if (!presetVersion)
  throw new Error("The controlled acceptance preset has no saved version.");
await writeFile(
  resolve(dataRoot, "system-selection.json"),
  JSON.stringify(
    {
      presetId,
      presetVersionId: presetVersion.id,
      defaultUserId: persona.id,
      promptMode: "compat_plus",
      modelSlots: [
        { slot: "narrator", profile_id: model.id, params: { max_retries: 0 } },
        { slot: "state_updater", profile_id: model.id, params: { max_retries: 0 } },
      ],
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    api: `http://127.0.0.1:${config.apiPort}`,
    dataRoot,
    presetId,
    personaId: persona.id,
    modelId: model.id,
  }),
);
const close = async () => {
  await built.app.close();
  provider.close();
};
process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());
