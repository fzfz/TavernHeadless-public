import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "../apps/api/dist/app.js";
import { createDatabase } from "../apps/api/dist/db/client.js";
import { migrateDatabase } from "../apps/api/dist/db/migrations.js";
import { loadConfig } from "../apps/api/dist/config.js";
import {
  loadStorageConfig,
  prepareStorageDirectories,
} from "../apps/api/dist/storage-config.js";
import {
  roleAcceptanceConfigSchema,
  roleAcceptanceCredentialsSchema,
} from "./role-acceptance.schema.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const acceptance = roleAcceptanceConfigSchema.parse(
  await readJson(
    process.argv[2] ??
      resolve(root, ".tmp/team-browser-acceptance/config.json"),
  ),
);
const credentials = roleAcceptanceCredentialsSchema.parse(
  await readJson(acceptance.credentialsFile),
);
const providerUrl = new URL(credentials.baseUrl);
if (
  providerUrl.protocol !== "http:" ||
  providerUrl.hostname !== "127.0.0.1" ||
  providerUrl.pathname !== "/v1"
) {
  throw new Error(
    "Browser acceptance provider must use http://127.0.0.1:<port>/v1",
  );
}

process.env.DATA_DIR = acceptance.dataRoot;
process.env.DATABASE_URL = "";
process.env.APP_SECRETS_MASTER_KEY = (
  await readFile(acceptance.masterKeyFile, "utf8")
).trim();
process.env.ALLOW_PRIVATE_BASE_URL = "true";
process.env.ENABLE_SSE_CHAT = "true";
process.env.AUTH_MODE = "off";
process.env.ACCOUNT_MODE = "single";
process.env.LLM_PROVIDER = "openai-compatible";
process.env.OPENAI_API_MODE = "chat";

const storage = loadStorageConfig({ DATA_DIR: acceptance.dataRoot });
prepareStorageDirectories(storage);
const databaseConnection = createDatabase(storage.databasePath);
try {
  migrateDatabase(databaseConnection);
} catch (error) {
  databaseConnection.close();
  throw error;
}
const built = await buildApp({
  ...loadConfig(),
  databasePath: storage.databasePath,
  databaseConnection,
  storage,
  auth: { mode: "off" },
  logger: false,
  enableSseChat: true,
  llmProfileApiMode: "chat",
});
const call = async (method, path, payload) => {
  const response = await built.app.inject({
    method,
    url: path,
    ...(payload === undefined ? {} : { payload }),
  });
  if (response.statusCode >= 400)
    throw new Error(
      `${method} ${path}: ${response.statusCode} ${response.body}`,
    );
  return response.json().data;
};

try {
  const db = built.database.$client;
  const characterCount = db
    .prepare("SELECT count(*) AS count FROM character")
    .get().count;
  if (characterCount > 0) {
    throw new Error(
      "Browser acceptance database is already seeded; remove its isolated data directory first.",
    );
  }

  const user = await call("POST", "/users", {
    snapshot: {
      name: "周明远",
      description:
        "周明远，29岁男性，社区图书馆的夜班志愿者，性格稳重而直接，习惯先观察环境，再向林岚说明情况。",
    },
  });
  const card = await call("POST", "/import/character", {
    payload: {
      spec: "chara_card_v2",
      spec_version: "2.0",
      data: {
        name: "林岚",
        description:
          "林岚，27岁女性，社区图书馆的管理员，做事细致有条理，熟悉阅览室的书架、登记册和日常开放流程。",
        personality: "沉稳、耐心、表达清楚。",
        scenario:
          "傍晚的社区图书馆阅览室刚下过一阵雨，周明远正在帮忙整理桌面，林岚把登记册放在窗边。",
        first_mes:
          "林岚合上登记册，抬头看向周明远。窗台上还放着几张刚被风吹动的便签。",
        mes_example: "<START>\n林岚：我先把便签收好，再检查窗户。",
      },
    },
    create_session: false,
  });
  const importedCharacter = await call(
    "GET",
    `/characters/${card.character_id}`,
  );
  const importedSnapshot = importedCharacter.latest_version?.snapshot;
  if (!importedSnapshot || typeof importedSnapshot !== "object") {
    throw new Error("Character import did not return a version snapshot.");
  }
  const openingText =
    "林岚合上登记册，抬头看向周明远。窗台上还放着几张刚被风吹动的便签。";
  const characterVersion = await call(
    "POST",
    `/characters/${card.character_id}/versions`,
    {
      expected_revision: importedCharacter.revision,
      snapshot: {
        ...importedSnapshot,
        extensions: {
          ...(importedSnapshot.extensions ?? {}),
          tavern_headless: {
            ...(importedSnapshot.extensions?.tavern_headless ?? {}),
            openings: {
              defaultOpeningId: "first",
              items: [
                {
                  id: "first",
                  title: "阅览室的傍晚",
                  summary: "林岚与周明远整理窗边便签。",
                  kind: "story",
                  displayText: openingText,
                  variables: {},
                },
              ],
            },
          },
        },
      },
    },
  );
  const purposeByName = {
    "manifest.json": "manifest",
    "view.html": "template",
    "view.css": "template",
    "main.js": "browser_script",
  };
  const mimeByExtension = {
    ".json": "application/json",
    ".html": "text/html",
    ".css": "text/css",
    ".js": "text/javascript",
  };
  const roleFixtureDir = resolve(acceptance.fixturesRoot, "role");
  const assetNames = Object.keys(purposeByName);
  const assetFiles = await Promise.all(
    assetNames.map(async (name) => {
      const content = await readFile(resolve(roleFixtureDir, name));
      return {
        name: basename(name),
        purpose: purposeByName[name],
        mime: mimeByExtension[extname(name)],
        base64: content.toString("base64"),
      };
    }),
  );
  await call("POST", `/role-assets/${characterVersion.id}`, {
    character_id: card.character_id,
    files: assetFiles,
  });
  const preset = await call("POST", "/import/preset", {
    name: "本地流式验收 · 第三人称",
    data: {
      prompts: [
        {
          identifier: "main",
          name: "叙述规则",
          role: "system",
          content:
            "使用第三人称叙述林岚的动作，以“林岚”或“她”指称林岚；直接引语按说话者表达。",
        },
        {
          identifier: "chatHistory",
          name: "对话历史",
          system_prompt: true,
          marker: true,
        },
      ],
      prompt_order: [
        {
          character_id: 100000,
          order: [
            { identifier: "main", enabled: true },
            { identifier: "chatHistory", enabled: true },
          ],
        },
      ],
    },
  });
  const regex = await call("POST", "/import/regex", {
    name: "本地流式验收 · 空正则",
    data: [],
  });
  const profile = await call("POST", "/llm-profiles", {
    preset_name: "本地 SSE 验收 fixture",
    provider: "openai-compatible",
    model_id: credentials.narratorModel,
    api_key: credentials.apiKey,
    base_url: credentials.baseUrl,
  });
  const draft = await call("POST", "/role-apps", {
    configuration: {
      name: "本地 SSE 流式验收",
      character_id: card.character_id,
      character_version_id: characterVersion.id,
      preset_id: preset.id,
      preset_version_id: (
        await call("GET", `/presets/${preset.id}/versions`)
      )[0].id,
      regex_profile_id: regex.id,
      regex_profile_version_id: (
        await call("GET", `/regex-profiles/${regex.id}/versions`)
      )[0].id,
      worldbook_id: null,
      worldbook_version_id: null,
      prompt_mode: "compat_plus",
      model_slots: [
        {
          slot: "narrator",
          profile_id: profile.id,
          params: {
            max_output_tokens: 128,
            max_retries: 0,
            reasoning_effort: "none",
            stream: true,
            timeout_ms: 120_000,
          },
        },
      ],
      default_user_id: user.id,
    },
  });
  const release = await call("POST", `/role-apps/${draft.id}/releases`, {
    expected_revision: draft.revision,
  });
  const created = await call("POST", `/role-releases/${release.id}/sessions`, {
    opening_id: "first",
  });
  const roleView = await call(
    "GET",
    `/sessions/${created.session.id}/role-view`,
  );
  if (
    roleView.character_version_id !== characterVersion.id ||
    roleView.delivery?.data?.opening !== openingText ||
    roleView.delivery?.data?.actionOptions?.[0] !== "周明远检查窗边的便签。" ||
    !roleView.delivery?.html?.includes("data-chat") ||
    !roleView.delivery?.html?.includes("data-option")
  ) {
    throw new Error(
      `Seeded role-view does not match the expected character and opening: ${JSON.stringify(roleView)}`,
    );
  }
  const scriptResponse = await built.app.inject({
    method: "GET",
    url: roleView.delivery.scriptUrl,
  });
  if (
    scriptResponse.statusCode !== 200 ||
    !scriptResponse.body.includes("api.widgets.mountChat") ||
    !scriptResponse.body.includes("api.chat.send")
  ) {
    throw new Error(
      `Seeded browser script is unavailable or missing the official chat/action flow: ${scriptResponse.statusCode}`,
    );
  }

  const result = {
    apiPort: acceptance.apiPort,
    adminPort: acceptance.adminPort,
    userPort: acceptance.userPort,
    fixtureBaseUrl: credentials.baseUrl,
    modelId: credentials.narratorModel,
    persona: {
      name: "周明远",
      description:
        "周明远，29岁男性，社区图书馆的夜班志愿者，性格稳重而直接，习惯先观察环境，再向林岚说明情况。",
    },
    character: {
      name: "林岚",
      description:
        "林岚，27岁女性，社区图书馆的管理员，做事细致有条理，熟悉阅览室的书架、登记册和日常开放流程。",
    },
    narratorPerspective: "第三人称；直接引语按说话者表达。",
    releaseId: release.id,
    characterVersionId: characterVersion.id,
    sessionId: created.session.id,
    userUrl: `http://127.0.0.1:${acceptance.userPort}/?sessionId=${encodeURIComponent(created.session.id)}`,
    expectedInput: "周明远看向窗边的便签，问林岚：“这些便签已经收好了吗？”",
    fixtureStatsUrl: `${credentials.baseUrl.replace(/\/v1\/?$/, "")}/__fixture/stats`,
    fixtureFailNextUrl: `${credentials.baseUrl.replace(/\/v1\/?$/, "")}/__fixture/fail-next`,
    statsCurl: `curl -fsS '${credentials.baseUrl.replace(/\/v1\/?$/, "")}/__fixture/stats'`,
    failNextCurl: `curl -fsS -X POST '${credentials.baseUrl.replace(/\/v1\/?$/, "")}/__fixture/fail-next' -H 'Content-Type: application/json' -d '{"count":1}'`,
  };
  await mkdir(dirname(acceptance.resultFile), { recursive: true });
  await writeFile(
    acceptance.resultFile,
    `${JSON.stringify(result, null, 2)}\n`,
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await built.app.close();
}
