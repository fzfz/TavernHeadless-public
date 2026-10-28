import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  roleStateBundleSchema,
  type RoleAssetFile,
  type RoleRuntimeManifest,
} from "@tavern/shared";
import {
  preparePresetImport,
  migratePresetOutput,
  compileRegexMigration,
} from "@tavern/adapters-sillytavern";
import {
  presetImportPolicySchema,
  presetOutputMigrationSchema,
  regexMigrationSchema,
  rolePresetSourceSchema,
  roleRegexSourceSchema,
} from "@tavern/shared";
import { buildTestApp } from "./helpers/create-test-db.js";
import {
  characterVersions,
  roleAssets,
  worldbookVersions,
} from "../src/db/schema.js";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../src/accounts/constants.js";
import { loadStorageConfig } from "../src/storage-config.js";
import { RoleAssetService } from "../src/services/role-runtime/role-asset-service.js";
import { RoleFileStore } from "../src/services/storage/role-file-store.js";
import { RoleModuleLoader } from "../src/services/role-runtime/role-module-loader.js";
import { renderBoundWorldbookController } from "../src/services/role-prompt-controller.js";
import { roleFixture } from "./helpers/role-fixture.js";

let app: FastifyInstance | undefined;
let root: string;
afterEach(async () => {
  await app?.close();
  if (root) await rm(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

it.each(["linqian", "gushengman"])(
  "persists the complete %s runtime files through the standard API and reopens them",
  async (role) => {
    vi.stubEnv(
      "APP_SECRETS_MASTER_KEY",
      "fixture-key-for-complete-role-import-test",
    );
    root = await mkdtemp(join(tmpdir(), "full-role-assets-"));
    const storage = loadStorageConfig({ DATA_DIR: root });
    let built = await buildTestApp({
      databasePath: storage.databasePath,
      storage,
      logger: false,
      auth: { mode: "off" },
      enablePromptDryRun: true,
      orchestration: {
        providers: [
          {
            id: "fixture",
            type: "openai-compatible",
            apiMode: "chat",
            apiKey: "fixture-key",
          },
        ],
        defaultModel: { providerId: "fixture", modelId: "fixture-model" },
      },
    });
    app = built.app;
    const { source, payload } = await roleFixture(role);
    const imported = await app.inject({
      method: "POST",
      url: "/import/character",
      payload,
    });
    expect(imported.statusCode, imported.body).toBe(201);
    const identity = imported.json().data;
    const versionId = identity.character_version_id;
    const version = built.database
      .select()
      .from(characterVersions)
      .where(eq(characterVersions.id, versionId))
      .get()!;
    const state = roleStateBundleSchema.parse(
      JSON.parse(version.dataJson).extensions.tavern_headless.stateUpdate,
    );
    const directory = resolve(
      import.meta.dirname,
      "../../../fixtures/role-apps",
      role,
    );
    const manifest: RoleRuntimeManifest = JSON.parse(
      await readFile(join(directory, "manifest.json"), "utf8"),
    );
    const inputs = new Map<string, RoleAssetFile["purpose"]>([
      ["manifest.json", "manifest"],
      [manifest.html, "template"],
      [manifest.css, "template"],
      [manifest.script, "browser_script"],
    ]);
    if (manifest.floorHtml) inputs.set(manifest.floorHtml, "template");
    for (const asset of Object.values(manifest.assets))
      inputs.set(asset.file, "media");
    for (const path of Object.keys(state.files))
      inputs.set(path, path.endsWith(".js") ? "server_script" : "data");
    const mime: Record<string, string> = {
      ".json": "application/json",
      ".html": "text/html",
      ".css": "text/css",
      ".js": "text/javascript",
      ".svg": "image/svg+xml",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".webp": "image/webp",
      ".mp3": "audio/mpeg",
      ".ogg": "audio/ogg",
      ".wav": "audio/wav",
    };
    let files: RoleAssetFile[] = [];
    for (const [name, purpose] of inputs) {
      const content =
        state.files[name] === undefined
          ? await readFile(join(directory, name))
          : Buffer.from(state.files[name]);
      expect(mime[extname(name)], name).toBeDefined();
      files.push({
        name,
        purpose,
        mime: mime[extname(name)]!,
        base64: content.toString("base64"),
      });
    }
    const saved = await app.inject({
      method: "POST",
      url: `/role-assets/${versionId}`,
      payload: { character_id: identity.character_id, files },
    });
    files = [];
    expect(saved.statusCode, saved.body).toBe(201);
    expect(saved.json().data.count).toBe(inputs.size);
    expect(
      built.database
        .select()
        .from(roleAssets)
        .where(eq(roleAssets.versionId, versionId))
        .all(),
    ).toHaveLength(inputs.size);
    await new RoleAssetService(
      built.database,
      new RoleFileStore(storage),
    ).requireCompleteBundle(DEFAULT_ADMIN_ACCOUNT_ID, versionId);
    const rule = await app.inject(
      `/role-assets/${versionId}/migrated-variable-rules.json`,
    );
    expect(rule.json()).toEqual(
      JSON.parse(state.files["migrated-variable-rules.json"]!),
    );
    if (state.profile.deriveScript)
      expect(
        (
          await app.inject(
            `/role-assets/${versionId}/${state.profile.deriveScript}`,
          )
        ).statusCode,
      ).toBe(403);
    const fixtures = resolve(directory, "..");
    const json = async (path: string) =>
      JSON.parse(await readFile(resolve(fixtures, path), "utf8"));
    const presetBundle = await json("linqian/prompt-bundle.json");
    const preparedPreset = preparePresetImport(
      rolePresetSourceSchema.parse(await json("presets/tianqin-beta-3.9.json")),
      presetImportPolicySchema.parse(presetBundle.presetImport),
    );
    const preset = migratePresetOutput(
      preparedPreset.data,
      presetOutputMigrationSchema.parse(
        await json("migrations/preset-output-migration.json"),
      ),
    );
    const post = async (url: string, body: unknown) => {
      const response = await app!.inject({
        method: "POST",
        url,
        payload: body as Record<string, unknown>,
      });
      expect(response.statusCode, response.body).toBe(201);
      return response.json().data;
    };
    const presetResource = await post("/import/preset", {
      name: presetBundle.presetName,
      data: preset,
    });
    const presetVersion = (
      await app.inject(`/presets/${presetResource.id}/versions`)
    ).json().data[0];
    const statePresetData = JSON.parse(
      await readFile(
        new URL(
          "../../../.planning/native-card-maintenance/verbatim-state-assembly/presets/primary-state-update.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const statePresetResource = await post("/import/preset", {
      name: "Fixture state update preset",
      data: statePresetData,
    });
    const statePresetVersion = (
      await app.inject(`/presets/${statePresetResource.id}/versions`)
    ).json().data[0];
    const regex = compileRegexMigration(
      [
        roleRegexSourceSchema.parse({
          key: role,
          kind: "character",
          name: source.name,
          resourceId: identity.character_id,
          versionId,
          scripts: source.extensions.regex_scripts,
        }),
        roleRegexSourceSchema.parse({
          key: "preset",
          kind: "preset",
          name: presetBundle.presetName,
          resourceId: presetResource.id,
          versionId: presetVersion.id,
          scripts: preset.extensions?.regex_scripts,
        }),
      ],
      regexMigrationSchema.parse(await json("migrations/regex-migration.json")),
    );
    const regexResource = await post("/import/regex", {
      name: source.name,
      data: regex.scripts,
    });
    const regexVersion = (
      await app.inject(`/regex-profiles/${regexResource.id}/versions`)
    ).json().data[0];
    const user = await post("/users", {
      snapshot: { name: "Fixture performer", description: "" },
    });
    const model = await post("/llm-profiles", {
      preset_name: "Fixture model",
      provider: "openai-compatible",
      model_id: "fixture-model",
      api_key: "fixture-key",
      base_url: "https://fixture.invalid/v1",
    });
    const release = await post("/role-releases", {
      name: source.name,
      character_id: identity.character_id,
      character_version_id: versionId,
      preset_id: presetResource.id,
      preset_version_id: presetVersion.id,
      regex_profile_id: regexResource.id,
      regex_profile_version_id: regexVersion.id,
      worldbook_id: identity.worldbook.id,
      worldbook_version_id: identity.worldbook.version_id,
      prompt_mode: "compat_plus",
      default_user_id: user.id,
      statePresetId: statePresetResource.id,
      statePresetVersionId: statePresetVersion.id,
      model_slots: [
        { slot: "narrator", profile_id: model.id },
        { slot: "verifier", profile_id: model.id },
      ],
    });
    const created = await post(`/role-releases/${release.id}/sessions`, {});
    const view = await app.inject(`/sessions/${created.session.id}/role-view`);
    expect(view.statusCode, view.body).toBe(200);
    expect(view.json().data.character_version_id).toBe(versionId);
    expect(view.json().data.initial.variables).not.toEqual({});
    expect(Object.keys(view.json().data.delivery.assets)).toHaveLength(
      Object.keys(manifest.assets).length,
    );
    await app.close();
    built = await buildTestApp({
      databasePath: storage.databasePath,
      storage,
      logger: false,
      auth: { mode: "off" },
      enablePromptDryRun: true,
      orchestration: {
        providers: [
          {
            id: "fixture",
            type: "openai-compatible",
            apiMode: "chat",
            apiKey: "fixture-key",
          },
        ],
        defaultModel: { providerId: "fixture", modelId: "fixture-model" },
      },
    });
    app = built.app;
    await new RoleAssetService(
      built.database,
      new RoleFileStore(storage),
    ).requireCompleteBundle(DEFAULT_ADMIN_ACCOUNT_ID, versionId);
    expect(
      (await app.inject(`/role-assets/${versionId}/manifest.json`)).json(),
    ).toEqual(manifest);
    const restoredView = await app.inject(
      `/sessions/${created.session.id}/role-view`,
    );
    expect(restoredView.statusCode, restoredView.body).toBe(200);
    expect(restoredView.json()).toEqual(view.json());
    {
      const loader = new RoleModuleLoader(
        new RoleAssetService(built.database, new RoleFileStore(storage)),
      );
      const saved = JSON.parse(version.dataJson);
      const variables = restoredView.json().data.initial.variables;
      const book = JSON.parse(
        built.database
          .select()
          .from(worldbookVersions)
          .where(eq(worldbookVersions.id, identity.worldbook.version_id))
          .get()!.dataJson,
      );
      const rendered = await renderBoundWorldbookController(
        saved,
        { stat_data: variables },
        book,
        (path) => loader.loadModule(DEFAULT_ADMIN_ACCOUNT_ID, versionId, path),
      );
      const entries = rendered.entries;
      for (const id of role === "linqian"
        ? [109, 111, 127]
        : [8, 15, 16, 17, 20])
        expect(
          entries.find((entry) => entry.uid === id)!.content,
        ).not.toContain("<%");
      expect(JSON.stringify(entries)).not.toContain(
        "format_message_variable::",
      );
      if (role === "linqian") {
        const module = await loader.loadModule(
          DEFAULT_ADMIN_ACCOUNT_ID,
          versionId,
          "prompt-controllers.js",
        );
        const result = await (
          module.renderController as (
            input: unknown,
          ) => Promise<{ text: string; referencedEntryIds: number[] }>
        )({
          entryId: 109,
          variables,
          characterBook: {
            ...book,
            entries: book.entries.map((entry: { uid: number }) => ({
              ...entry,
              id: entry.uid,
            })),
          },
        });
        expect(result.referencedEntryIds.length).toBeGreaterThan(0);
        for (const id of result.referencedEntryIds)
          expect(result.text).toContain(
            book.entries.find((entry: { uid: number }) => entry.uid === id)
              .content,
          );
      }
    }
    if (role === "gushengman") {
      const prompt = await app.inject({
        method: "POST",
        url: `/sessions/${created.session.id}/respond/dry-run`,
        payload: { message: "继续" },
      });
      expect(prompt.statusCode, prompt.body).toBe(200);
      const content = prompt
        .json()
        .data.messages.map((message: { content: string }) => message.content)
        .join("\n");
      expect(content).not.toContain("format_message_variable::");
      expect(content).not.toContain("{{getvar::stat_data}}");
      const current = content.match(
        /<status_current_variables>\s*([\s\S]*?)\s*<\/status_current_variables>/,
      );
      expect(current).not.toBeNull();
      expect(JSON.parse(current![1]!)).toEqual(
        restoredView.json().data.initial.variables,
      );
    }
    const media = Object.values(manifest.assets)[0]!;
    const response = await app.inject(
      `/role-assets/${versionId}/${media.file}`,
    );
    expect(response.statusCode).toBe(200);
    expect(
      response.rawPayload.equals(await readFile(join(directory, media.file))),
    ).toBe(true);
  },
  60_000,
);
