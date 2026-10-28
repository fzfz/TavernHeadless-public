import { migratePresetOutput } from "./preset-output-migration.mjs";
import { migrateMvuToAgent, readMvuInitialVariables } from "./mvu-agent-migration.mjs";
import { compileRegexMigration } from "./regex-migration.mjs";
import fs from "node:fs";
import path from "node:path";
import { registerHooks, createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
const root = path.resolve(
  fileURLToPath(new URL("../../../../", import.meta.url)),
);
const config = JSON.parse(
  fs.readFileSync(
    new URL("./published-prototype.config.json", import.meta.url),
    "utf8",
  ),
);
const modules = {
  "@tavern/core": "packages/core/src/index.ts",
  "@tavern/shared": "packages/shared/src/index.ts",
  "@tavern/shared/types/backup-file":
    "packages/shared/src/types/backup-file.ts",
  "@tavern/adapters-sillytavern": "packages/adapters-sillytavern/src/index.ts",
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "ajv")
      return {
        url: pathToFileURL(
          path.join(
            root,
            "node_modules/.pnpm/ajv@8.17.1/node_modules/ajv/dist/ajv.js",
          ),
        ).href,
        shortCircuit: true,
      };
    if (specifier === "yaml")
      return {
        url: pathToFileURL(
          path.join(
            root,
            "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/index.js",
          ),
        ).href,
        shortCircuit: true,
      };
    if (modules[specifier])
      return {
        url: pathToFileURL(path.join(root, modules[specifier])).href,
        shortCircuit: true,
      };
    if (specifier === "better-sqlite3")
      return {
        url: pathToFileURL(
          "/srv/tavern/TavernHeadless-inspect-20260914/node_modules/.pnpm/better-sqlite3@12.8.0/node_modules/better-sqlite3/lib/index.js",
        ).href,
        shortCircuit: true,
      };
    return next(specifier, context);
  },
});
const Ajv = createRequire(import.meta.url)("ajv");
const validateConfig = new Ajv({ allErrors: true }).compile(
  JSON.parse(
    fs.readFileSync(
      new URL("./published-prototype.config.schema.json", import.meta.url),
      "utf8",
    ),
  ),
);
if (!validateConfig(config))
  throw new Error(
    `Published service configuration invalid: ${JSON.stringify(validateConfig.errors)}`,
  );
if (!fs.existsSync(config.masterKeyFile))
  fs.writeFileSync(config.masterKeyFile, randomBytes(32).toString("hex"), {
    mode: 0o600,
  });
process.env.APP_SECRETS_MASTER_KEY = fs.readFileSync(
  config.masterKeyFile,
  "utf8",
);
fs.mkdirSync(config.dataDirectory, { recursive: true });
const { buildTestApp: buildApp } = await import(
  pathToFileURL(path.join(root, "apps/api/test/helpers/create-test-db.ts"))
);
const { registerRoleReleaseRoutes } = await import(
  pathToFileURL(path.join(root, "apps/api/src/routes/role-releases.ts"))
);
const { registerRoleViewRoutes } = await import(
  pathToFileURL(path.join(root, "apps/api/src/routes/role-view.mjs"))
);
const { registerRoleAssetRoutes } = await import(
  pathToFileURL(path.join(root, "apps/api/src/routes/role-assets.mjs"))
);
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const prototype = path.join(root, "apps/web/prototypes");
const credentials = read(config.credentialsFile);
const { app, database } = await buildApp({
  databasePath: path.join(config.dataDirectory, "backend.sqlite"),
  logger: false,
  enableWebSocket: false,
  enableSseChat: true,
  enablePromptDryRun: true,
  enableMemory: false,
  enableAgentRuntimeWorker: false,
  enableNodeGraphWorker: false,
  llmDefaultTimeoutMs: config.modelTimeoutMs,
  llmProfileApiMode: config.llmProfileApiMode,
  orchestration: {
    providers: [
      {
        id: "bootstrap",
        type: "openai-compatible",
        apiKey: credentials.apiKey,
        baseURL: credentials.baseUrl,
        apiMode: "chat",
      },
    ],
    defaultModel: {
      providerId: "bootstrap",
      modelId: credentials.narratorModel,
    },
  },
});
const views = registerRoleViewRoutes(app, database, {
  moduleDirectory: path.join(config.dataDirectory, "modules"),
  runtimeSchema: read(
    path.join(root, "docs/character-authoring/script-runtime.schema.json"),
  ),
  updateSchema: read(
    path.join(root, "docs/character-authoring/state-update.schema.json"),
  ),
});
registerRoleAssetRoutes(app, database);
const { registerRegexPreviewRoutes } = await import(
  pathToFileURL(path.join(root, "apps/api/src/routes/regex-preview.ts"))
);
await registerRegexPreviewRoutes(app);
await registerRoleReleaseRoutes(
  app,
  { db: database, sqlite: database.$client },
  { onSessionCreated: views.initialize },
);
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
};
app.get("/prototype/*", async (req, reply) => {
  const file = path.resolve(root, req.params["*"]);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file))
    return reply.code(404).send();
  return reply
    .type(types[path.extname(file)] ?? "application/octet-stream")
    .send(fs.readFileSync(file));
});
const call = async (method, url, payload) => {
  const res = await app.inject({ method, url, payload });
  if (res.statusCode >= 400)
    throw new Error(
      `${method} ${url}: ${res.statusCode} ${res.body.slice(0, 700)}`,
    );
  return res.json().data;
};
const releases = await call("GET", "/role-releases");
if (!releases.length) {
  const { snapshotToStCharacterCard } =
    await import("../../../../packages/adapters-sillytavern/src/serializers/character-serializer.ts");
  const { importOpenings } = await import("../shared/import-openings.js");
  const { preparePresetImport } = await import("./preset-import.mjs");
  const { parse: parseYaml } = await import("yaml");
  const performers = [];
  for (const snapshot of config.performers)
    performers.push(await call("POST", "/users", { snapshot }));
  const profile = await call("POST", "/llm-profiles", {
    preset_name: "OpenRouter · 正文",
    provider: "openai-compatible",
    model_id: credentials.narratorModel,
    base_url: credentials.baseUrl,
    api_key: credentials.apiKey,
  });
  const updater = await call("POST", "/llm-profiles", {
    preset_name: "OpenRouter · 变量更新",
    provider: "openai-compatible",
    model_id: credentials.updaterModel,
    base_url: credentials.baseUrl,
    api_key: credentials.apiKey,
  });
  for (const slot of config.disabledSlots)
    await call("PUT", `/llm-instances/${slot}`, {
      scope: "global",
      enabled: false,
    });
  const presetDir = path.join(prototype, config.presetDirectory),
    bundle = read(path.join(presetDir, "prompt-bundle.json"));
  const preset = migratePresetOutput(preparePresetImport(
    read(path.join(presetDir, bundle.presetFile)),
    bundle.presetImport,
  ).data);
  const presetResource = await call("POST", "/import/preset", {
    name: bundle.presetName,
    data: preset,
  });
  const editor = await call("GET", `/presets/${presetResource.id}/editor`);
  editor.editor.default_character_id = config.presetPromptOrderCharacterId;
  await call("PUT", `/presets/${presetResource.id}`, {
    name: editor.name,
    editor: editor.editor,
    expected_version: editor.version,
  });
  const presetVersions = await call(
    "GET",
    `/presets/${presetResource.id}/versions`,
  );
  for (const id of config.characters) {
    const directory = path.join(prototype, "characters", id),
      snapshot = read(path.join(directory, "snapshot.json")),
      manifest = read(path.join(directory, "manifest.json"));
    const openings = importOpenings(
      snapshot,
      read(path.join(directory, "openings.json")),
      readMvuInitialVariables(id, snapshot.characterBook, parseYaml),
      { parseYaml },
    );
    const localProfile = read(path.join(directory, "live-model.json"));
    const stateFiles = {};
    for (const f of [
      localProfile.stateSchemaFile,
      ...(localProfile.ruleFiles || []),
      localProfile.deriveScript,
      localProfile.validateScript,
      ...(localProfile.moduleFiles || []),
    ].filter(Boolean))
      stateFiles[f] = fs.readFileSync(path.join(directory, f), "utf8");
    const delivery = {
      html: fs.readFileSync(path.join(directory, manifest.html), "utf8"),
      css: fs.readFileSync(path.join(directory, manifest.css), "utf8"),
      scriptUrl: `/role-assets/{version}/${manifest.script}`,
      floorHtml: manifest.floorHtml
        ? fs.readFileSync(path.join(directory, manifest.floorHtml), "utf8")
        : null,
      assets: Object.fromEntries(
        Object.entries(manifest.assets).map(([key, a]) => [
          key,
          {
            kind: a.kind,
            url: `/role-assets/{version}/${a.file}`,
            label: a.label,
            tags: a.tags,
          },
        ]),
      ),
      data: manifest.data,
    };
    const ext = {
      ...(snapshot.extensions?.tavern_headless || {}),
      frontend: manifest,
      runtimeDelivery: delivery,
      openings,
      stateUpdate: { profile: localProfile, files: stateFiles },
    };
    if (localProfile.promptBundleFile) {
      const b = read(path.join(directory, localProfile.promptBundleFile));
      ext.promptController = {
        moduleSource: fs.readFileSync(
          path.join(directory, b.controllerModule),
          "utf8",
        ),
        controllerEntryIds: b.controllerEntryIds,
        updaterEntryIds: b.updaterEntryIds,
        variableRoot: b.variableRoot,
        variableMacros: b.variableMacros,
      };
    }
    snapshot.extensions = { ...snapshot.extensions, tavern_headless: ext };
    const migratedMvu = migrateMvuToAgent(id, snapshot, snapshot.characterBook);
    Object.assign(snapshot, migratedMvu.snapshot, {
      characterBook: migratedMvu.worldbook,
    });
    const imported = await call("POST", "/import/character", {
      payload: snapshotToStCharacterCard(snapshot),
      create_session: false,
    });
    const version = { id: imported.character_version_id };
    const { scripts } = compileRegexMigration([
      {
        key: id,
        kind: "character",
        name: snapshot.name,
        resourceId: imported.character_id,
        versionId: version.id,
        scripts: snapshot.extensions.regex_scripts || [],
      },
      {
        key: "preset",
        kind: "preset",
        name: bundle.presetName,
        resourceId: presetResource.id,
        versionId: presetVersions.at(-1).id,
        scripts: preset.extensions?.regex_scripts || [],
      },
    ]);
    const regex = await call("POST", "/import/regex", {
      name: snapshot.name + " · 演绎正则",
      data: scripts,
    });
    const regexVersions = await call(
      "GET",
      `/regex-profiles/${regex.id}/versions`,
    );
    const assets = [];
    const walk = (dir) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const f = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(f);
        else if (
          [
            ".js",
            ".css",
            ".svg",
            ".png",
            ".webp",
            ".jpg",
            ".jpeg",
            ".mp3",
            ".ogg",
          ].includes(path.extname(f))
        )
          assets.push({
            name: path.relative(directory, f),
            mime: types[path.extname(f)] ?? "application/octet-stream",
            base64: fs.readFileSync(f).toString("base64"),
          });
      }
    };
    walk(directory);
    for (const asset of assets)
      await call("POST", `/role-assets/${version.id}`, {
        character_id: imported.character_id,
        files: [asset],
      });
    const published = await call("POST", "/role-releases", {
      name: snapshot.name,
      character_id: imported.character_id,
      character_version_id: version.id,
      preset_id: presetResource.id,
      preset_version_id: presetVersions.at(-1).id,
      regex_profile_id: regex.id,
      regex_profile_version_id: regexVersions.at(-1).id,
      worldbook_id: imported.worldbook?.id ?? null,
      worldbook_version_id: imported.worldbook?.version_id ?? null,
      prompt_mode: "compat_strict",
      default_user_id: performers[0].id,
      model_slots: [
        {
          slot: "narrator",
          profile_id: profile.id,
          params: {
            max_context_tokens: config.narratorContextTokens,
            max_output_tokens: preset.openai_max_tokens,
            reasoning_effort: "none",
          },
        },
        {
          slot: "verifier",
          profile_id: updater.id,
          params: {
            max_output_tokens: localProfile.maxTokens,
            reasoning_effort: "none",
          },
        },
      ],
    });
    console.log(
      JSON.stringify({ published: published.id, name: published.name }),
    );
  }
}
await app.listen({ port: config.port, host: "127.0.0.1" });
console.log(
  JSON.stringify({
    url: `http://127.0.0.1:${config.port}/prototype/apps/user-web/prototypes/script-roleplay.prototype.html`,
    database: path.join(config.dataDirectory, "backend.sqlite"),
  }),
);
