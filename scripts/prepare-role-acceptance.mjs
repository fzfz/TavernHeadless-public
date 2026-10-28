import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve, extname } from "node:path";
import { buildApp } from "../apps/api/dist/app.js";
import { createDatabase } from "../apps/api/dist/db/client.js";
import { migrateDatabase } from "../apps/api/dist/db/migrations.js";
import {
  loadStorageConfig,
  prepareStorageDirectories,
} from "../apps/api/dist/storage-config.js";
import {
  snapshotToStCharacterCard,
  preparePresetImport,
  migratePresetOutput,
  compileRegexMigration,
} from "../packages/adapters-sillytavern/dist/index.js";
import {
  roleStateProfileSchema,
  rolePromptControllerConfigSchema,
  mvuMigrationSchema,
  presetImportPolicySchema,
  presetOutputMigrationSchema,
  regexMigrationSchema,
} from "../packages/shared/dist/index.js";
import {
  roleAcceptanceConfigSchema,
  roleAcceptanceCredentialsSchema,
  roleAcceptanceBindingsSchema,
} from "./role-acceptance.schema.mjs";
const json = async (file) => JSON.parse(await readFile(file, "utf8"));
const config = roleAcceptanceConfigSchema.parse(await json(process.argv[2]));
const bindings = roleAcceptanceBindingsSchema.parse(
  await json(resolve(config.fixturesRoot, "bindings.json")),
);
const credentials = roleAcceptanceCredentialsSchema.parse(
  await json(config.credentialsFile),
);
process.env.APP_SECRETS_MASTER_KEY = (
  await readFile(config.masterKeyFile, "utf8")
).trim();
const storage = loadStorageConfig({ DATA_DIR: config.dataRoot });
prepareStorageDirectories(storage);
const databaseConnection = createDatabase(storage.databasePath);
try {
  migrateDatabase(databaseConnection);
} catch (error) {
  databaseConnection.close();
  throw error;
}
const { app, database } = await buildApp({
  databasePath: storage.databasePath,
  databaseConnection,
  storage,
  auth: { mode: "off" },
  logger: false,
});
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
try {
  if (
    database.$client.prepare("SELECT count(*) AS count FROM character").get()
      .count
  )
    throw new Error(
      "Acceptance database already contains characters. Use a new dataRoot for a fresh import.",
    );
  const performers = [];
  for (const snapshot of bindings.performers)
    performers.push(await call("POST", "/users", { snapshot }));
  const narrator = await call("POST", "/llm-profiles", {
    preset_name: "验收 · 正文",
    provider: "openai-compatible",
    model_id: credentials.narratorModel,
    api_key: credentials.apiKey,
    base_url: credentials.baseUrl,
  });
  const updater = await call("POST", "/llm-profiles", {
    preset_name: "验收 · 变量更新",
    provider: "openai-compatible",
    model_id: credentials.updaterModel,
    api_key: credentials.apiKey,
    base_url: credentials.baseUrl,
  });
  for (const slot of bindings.disabledSlots)
    await call("PUT", `/llm-instances/${slot}`, {
      scope: "global",
      enabled: false,
    });
  const bundle = await json(
    resolve(config.fixturesRoot, "linqian/prompt-bundle.json"),
  );
  const preset = migratePresetOutput(
    preparePresetImport(
      await json(resolve(config.fixturesRoot, bindings.roles[0].preset)),
      presetImportPolicySchema.parse(bundle.presetImport),
    ).data,
    presetOutputMigrationSchema.parse(
      await json(
        resolve(config.fixturesRoot, "migrations/preset-output-migration.json"),
      ),
    ),
  );
  const importedPreset = await call("POST", "/import/preset", {
    name: bundle.presetName,
    data: preset,
  });
  const editor = await call("GET", `/presets/${importedPreset.id}/editor`);
  editor.editor.default_character_id = bindings.presetPromptOrderCharacterId;
  await call("PUT", `/presets/${importedPreset.id}`, {
    name: editor.name,
    editor: editor.editor,
    expected_version: editor.version,
  });
  const presetVersion = (
    await call("GET", `/presets/${importedPreset.id}/versions`)
  ).sort((a, b) => b.version_no - a.version_no)[0];
  const migration = mvuMigrationSchema.parse(
    await json(
      resolve(config.fixturesRoot, "migrations/mvu-agent-migration.json"),
    ),
  );
  const regexPlan = regexMigrationSchema.parse(
    await json(resolve(config.fixturesRoot, "migrations/regex-migration.json")),
  );
  const results = [];
  for (const role of bindings.roles) {
    const directory = resolve(config.fixturesRoot, role.directory),
      source = await json(resolve(directory, "snapshot.json")),
      manifest = await json(resolve(directory, "manifest.json"));
    const profile = roleStateProfileSchema.parse(
        await json(resolve(directory, "live-model.json")),
      ),
      files = {};
    for (const path of [
      profile.stateSchemaFile,
      ...(profile.ruleFiles ?? []),
      profile.deriveScript,
      profile.validateScript,
      ...(profile.moduleFiles ?? []),
    ].filter(Boolean))
      files[path] = await readFile(resolve(directory, path), "utf8");
    if (role.promptBundle) {
      const bundle = await json(resolve(directory, role.promptBundle));
      const controller = rolePromptControllerConfigSchema.parse({
        modulePath: bundle.controllerModule,
        controllerEntryIds: bundle.controllerEntryIds,
        updaterEntryIds: bundle.updaterEntryIds,
        variableRoot: bundle.variableRoot,
        variableMacros: bundle.variableMacros,
      });
      source.extensions ??= {};
      source.extensions.tavern_headless ??= {};
      source.extensions.tavern_headless.promptController = controller;
      profile.moduleFiles = [
        ...new Set([...(profile.moduleFiles ?? []), controller.modulePath]),
      ];
      files[controller.modulePath] = await readFile(
        resolve(directory, controller.modulePath),
        "utf8",
      );
    }
    const imported = await call("POST", "/import/character", {
      payload: snapshotToStCharacterCard(source),
      create_session: false,
      role_migration: {
        stateUpdate: { profile, files },
        migration: migration[role.id],
        metadata: await json(resolve(directory, "openings.json")),
      },
    });
    const version = (
      await call("GET", `/characters/${imported.character_id}/versions`)
    ).find((item) => item.id === imported.character_version_id);
    const state = version.snapshot.extensions.tavern_headless.stateUpdate;
    const inputPaths = new Map([
      ["manifest.json", "manifest"],
      [manifest.html, "template"],
      [manifest.css, "template"],
      [manifest.script, "browser_script"],
    ]);
    if (manifest.floorHtml) inputPaths.set(manifest.floorHtml, "template");
    for (const asset of Object.values(manifest.assets))
      inputPaths.set(asset.file, "media");
    for (const path of Object.keys(state.files))
      inputPaths.set(path, path.endsWith(".js") ? "server_script" : "data");
    const mime = {
      ".json": "application/json",
      ".html": "text/html",
      ".css": "text/css",
      ".js": "text/javascript",
      ".svg": "image/svg+xml",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
      ".mp3": "audio/mpeg",
      ".ogg": "audio/ogg",
      ".wav": "audio/wav",
    };
    let assetFiles = [];
    for (const [name, purpose] of inputPaths) {
      if (!mime[extname(name)])
        throw new Error("Missing MIME mapping: " + name);
      const content =
        state.files[name] === undefined
          ? await readFile(resolve(directory, name))
          : Buffer.from(state.files[name]);
      assetFiles.push({
        name,
        purpose,
        mime: mime[extname(name)],
        base64: content.toString("base64"),
      });
    }
    await call("POST", `/role-assets/${imported.character_version_id}`, {
      character_id: imported.character_id,
      files: assetFiles,
    });
    assetFiles = [];
    const regex = compileRegexMigration(
      [
        {
          key: role.id,
          kind: "character",
          name: source.name,
          resourceId: imported.character_id,
          versionId: imported.character_version_id,
          scripts: source.extensions.regex_scripts,
        },
        {
          key: "preset",
          kind: "preset",
          name: bundle.presetName,
          resourceId: importedPreset.id,
          versionId: presetVersion.id,
          scripts: preset.extensions.regex_scripts,
        },
      ],
      regexPlan,
    );
    const importedRegex = await call("POST", "/import/regex", {
      name: source.name + " · 演绎正则",
      data: regex.scripts,
    });
    const regexVersion = (
      await call("GET", `/regex-profiles/${importedRegex.id}/versions`)
    )[0];
    const configuration = {
      name: source.name,
      character_id: imported.character_id,
      character_version_id: imported.character_version_id,
      preset_id: importedPreset.id,
      preset_version_id: presetVersion.id,
      regex_profile_id: importedRegex.id,
      regex_profile_version_id: regexVersion.id,
      worldbook_id: imported.worldbook.id,
      worldbook_version_id: imported.worldbook.version_id,
      prompt_mode: "compat_plus",
      default_user_id: performers[0].id,
      model_slots: [
        {
          slot: "narrator",
          profile_id: narrator.id,
          params: {
            max_output_tokens: bindings.maxOutputTokens,
            reasoning_effort: "none",
          },
        },
        {
          slot: "verifier",
          profile_id: updater.id,
          params: {
            max_output_tokens: bindings.maxOutputTokens,
            reasoning_effort: "none",
          },
        },
      ],
    };
    const draft = await call("POST", "/role-apps", { configuration });
    const release = await call("POST", `/role-apps/${draft.id}/releases`, {
      expected_revision: draft.revision,
    });
    results.push({
      role: role.id,
      draft,
      releaseId: release.id,
      characterId: imported.character_id,
      versionId: imported.character_version_id,
      fileCount: inputPaths.size,
      openings: release.openings.map((item) => ({
        id: item.id,
        title: item.title,
        default: item.default,
      })),
      regexAudit: regex.audit,
    });
  }
  await mkdir(dirname(config.resultFile), { recursive: true });
  await writeFile(
    config.resultFile,
    JSON.stringify(
      {
        dataRoot: config.dataRoot,
        performerIds: performers.map((item) => item.id),
        roles: results,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      roles: results.map((item) => ({
        role: item.role,
        draftId: item.draft.id,
        releaseId: item.releaseId,
        fileCount: item.fileCount,
      })),
      resultFile: config.resultFile,
    }),
  );
} finally {
  await app.close();
}
