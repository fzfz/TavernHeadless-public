import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, asc, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterEach, expect, it } from "vitest";
import { ToolRegistry } from "@tavern/core";
import { apiErrorMessages, type NativeCard, type NativeCardImport } from "@tavern/shared";
import { buildTestApp } from "./helpers/create-test-db.js";
import { loadStorageConfig } from "../src/storage-config.js";
import { writeNativeCardZip, readNativeCardZip } from "../src/services/native-card/zip.js";
import {
  accountUsers,
  characters,
  characterVersions,
  floors,
  floorRunStates,
  llmProfiles,
  llmInstanceConfigs,
  llmProfileBindings,
  messagePages,
  messages,
  nativeCardResourceBindings,
  nativeCardVersionBindings,
  presetVersions,
  presets,
  regexProfileVersions,
  regexProfiles,
  roleReleases,
  sessionBranches,
  promptSnapshots,
  sessions,
  worldbookEntries,
  worldbookVersions,
  worldbooks,
} from "../src/db/schema.js";
import { AssetVersionService } from "../src/services/asset-version-service.js";
import { loadNativeCardConfig } from "../src/native-card-config.js";
import { NativeCardService } from "../src/services/native-card/native-card-service.js";
import { RoleAssetService } from "../src/services/role-runtime/role-asset-service.js";
import { RoleModuleLoader } from "../src/services/role-runtime/role-module-loader.js";
import { RoleFileStore } from "../src/services/storage/role-file-store.js";
import { PromptResourceLoader } from "../src/services/prompt-resource-loader.js";
import { SessionToolRegistryService } from "../src/services/tooling/session-tool-registry-service.js";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../src/accounts/constants.js";
import nativeLimits from "../config/native-card.json";
import { ensureTestDefaultWorkspace } from "../src/__tests__/helpers/workspace-project.js";

let app: FastifyInstance | undefined;
let root: string | undefined;
afterEach(async () => {
  await app?.close();
  if (root) await rm(root, { recursive: true, force: true });
}, 30_000);

async function importStatePromptPreset(target: FastifyInstance) {
  const data = JSON.parse(
    await readFile(
      new URL(
        "../../../.planning/native-card-maintenance/verbatim-state-assembly/presets/primary-state-update.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const imported = await target.inject({
    method: "POST",
    url: "/import/preset",
    payload: { name: "Native card state update preset", data },
  });
  expect(imported.statusCode, imported.body).toBe(201);
  const statePresetId = imported.json().data.id as string;
  const versions = await target.inject(`/presets/${statePresetId}/versions`);
  expect(versions.statusCode, versions.body).toBe(200);
  const statePresetVersionId = versions.json().data[0]?.id as string | undefined;
  expect(statePresetVersionId).toBeTruthy();
  return {
    statePresetId,
    statePresetVersionId: statePresetVersionId!,
    statePrompt: {
      presetId: statePresetId,
      presetVersionId: statePresetVersionId!,
      historyTurns: 5,
    },
  };
}

it("imports full resources, rejects invalid writes, resolves concurrent saves and exports a fixed revision to an independent database", async () => {
  root = await mkdtemp(join(tmpdir(), "native-card-roundtrip-"));
  const start = async (directory: string) => {
    const storage = loadStorageConfig({ DATA_DIR: directory });
    return (await buildTestApp({ storage, databasePath: storage.databasePath, logger: false, auth: { mode: "off" } })).app;
  };
  app = await start(join(root, "a"));
  const fixture = JSON.parse(await readFile(new URL("./fixtures/native-card/harbor.files.json", import.meta.url), "utf8")) as Record<string,string>;
  const zip = writeNativeCardZip(Object.entries(fixture).map(([path, content]) => ({ path, content: Buffer.from(content) })));
  const inspect = await app.inject({ method: "POST", url: "/native-cards/imports?fileName=harbor.zip", headers: { "content-type": "application/zip" }, payload: zip });
  expect(inspect.statusCode, inspect.body).toBe(200);
  expect(inspect.json().data).toMatchObject({ status: "ready", issues: [] });
  const imported = await app.inject({ method: "POST", url: `/native-cards/imports/${inspect.json().data.id}/confirm` });
  expect(imported.statusCode, imported.body).toBe(201);
  const card = imported.json().data;
  expect(card.files).toHaveLength(Object.keys(fixture).length);
  const badSave = await app.inject({ method: "PUT", url: `/native-cards/${card.id}/files`, payload: { expectedRevision: 1, operations: [{ op: "delete", path: "openings/first.txt" }] } });
  expect(badSave.statusCode, badSave.body).toBe(422);
  expect((await app.inject({ method: "GET", url: `/native-cards/${card.id}` })).json().data.revision).toBe(1);
  const save = (text: string) => app!.inject({ method: "PUT", url: `/native-cards/${card.id}/files`, payload: { expectedRevision: 1, operations: [{ op: "write", path: "openings/first.txt", encoding: "utf8", content: text }] } });
  const results = await Promise.all([save("沈知夏在门边等候。"), save("沈知夏在灯下等候。")]);
  expect(results.map(r=>r.statusCode).sort()).toEqual([200,409]);
  const conflict = results.find(r=>r.statusCode===409)!;
  expect(conflict.json().error.code).toBe("NATIVE_CARD_REVISION_CONFLICT");
  const saved = results.find(r=>r.statusCode===200)!.json().data;
  expect(saved.revision).toBe(2);
  const oldFile = await app.inject({ method: "GET", url: `/native-cards/${card.id}/file?path=openings%2Ffirst.txt&revision=1` });
  expect(oldFile.json().data.content).toBe(fixture["openings/first.txt"]);
  const task = await app.inject({ method: "POST", url: `/native-cards/${card.id}/builds`, payload: { source: { revision: 1 } } });
  expect(task.statusCode, task.body).toBe(202);
  const buildId = task.json().data.id;
  await app.close(); // onClose waits for the real packaging worker.
  app = await start(join(root, "a"));
  const status = await app.inject({ method: "GET", url: `/native-card-builds/${buildId}` });
  expect(status.json().data).toMatchObject({ status: "succeeded", revision: 1 });
  const download = await app.inject({ method: "GET", url: `/native-card-builds/${buildId}/download` });
  expect(download.statusCode, download.body).toBe(200);
  const files = readNativeCardZip(download.rawPayload, nativeLimits);
  expect(Object.fromEntries(files.map(f=>[f.path,Buffer.from(f.content).toString("utf8")]))).toEqual(fixture);
  await app.close();
  app = await start(join(root, "b"));
  const rechecked = await app.inject({ method: "POST", url: "/native-cards/imports?fileName=roundtrip.zip", headers: { "content-type": "application/zip" }, payload: download.rawPayload });
  expect(rechecked.json().data).toMatchObject({ status: "ready", issues: [] });
  const reimported = await app.inject({ method: "POST", url: `/native-cards/imports/${rechecked.json().data.id}/confirm` });
  expect(reimported.statusCode, reimported.body).toBe(201);
  expect(reimported.json().data).toMatchObject({ packageId: card.packageId, name: card.name, revision: 1, files: card.files });
  expect(reimported.json().data.id).not.toBe(card.id);
}, 30_000);
it("creates a persistent native card and reads its saved files after a service restart", async () => {
  root = await mkdtemp(join(tmpdir(), "native-card-api-"));
  const storage = loadStorageConfig({ DATA_DIR: root });
  const options = {
    databasePath: storage.databasePath,
    storage,
    logger: false,
    auth: { mode: "off" as const },
  };
  app = (await buildTestApp(options)).app;
  const created = await app.inject({
    method: "POST",
    url: "/native-cards",
    payload: { name: "花园向导" },
  });
  expect(created.statusCode, created.body).toBe(201);
  const card = created.json().data;
  expect(card).toMatchObject({ name: "花园向导", revision: 1 });
  const read = await app.inject({
    method: "GET",
    url: `/native-cards/${card.id}/file?path=character.json&revision=1`,
  });
  expect(read.statusCode, read.body).toBe(200);
  expect(JSON.parse(read.json().data.content).name).toBe("花园向导");
  await app.close();
  app = (await buildTestApp(options)).app;
  const reopened = await app.inject({
    method: "GET",
    url: `/native-cards/${card.id}`,
  });
  expect(reopened.statusCode, reopened.body).toBe(200);
  expect(reopened.json().data).toEqual(card);
}, 30_000);

it("imports equivalent validator property forms and executes their persisted modules", async () => {
  root = await mkdtemp(join(tmpdir(), "native-card-module-bindings-"));
  const storage = loadStorageConfig({ DATA_DIR: root });
  const built = await buildTestApp({
    databasePath: storage.databasePath,
    storage,
    logger: false,
    auth: { mode: "off" },
  });
  app = built.app;
  const nativeCards = new NativeCardService(built.database, loadNativeCardConfig(storage.dataRoot));
  const assets = new RoleAssetService(built.database, new RoleFileStore(storage), nativeCards);
  const loader = new RoleModuleLoader(assets);
  const fixture = JSON.parse(await readFile(new URL("./fixtures/native-card/harbor.files.json", import.meta.url), "utf8")) as Record<string, string>;

  for (const [name, result] of [
    ["shorthand", "{ issues }"],
    ["explicit", "{ issues: issues }"],
  ]) {
    const source = [
      "export function validate(context) {",
      "  function normalize(context) { return context; }",
      "  const { trust: score } = context.candidate;",
      "  function unwrap({ value: result }) { return result; }",
      "  const fallback = [];",
      "  let issues;",
      "  ({ issues = fallback } = { issues: normalize(unwrap({ value: score }) < 0 ? ['negative trust'] : []) });",
      `  return ${result};`,
      "}",
    ].join("\n");
    const files = { ...fixture, "backend/validators/validate.js": source };
    const archive = writeNativeCardZip(Object.entries(files).map(([path, text]) => ({ path, content: Buffer.from(text) })));
    const inspection = await app.inject({
      method: "POST",
      url: `/native-cards/imports?fileName=${name}.zip`,
      headers: { "content-type": "application/zip" },
      payload: archive,
    });
    expect(inspection.statusCode, inspection.body).toBe(200);
    const checked = inspection.json<{ data: NativeCardImport }>().data;
    expect(checked).toMatchObject({ status: "ready", issues: [] });
    const confirmation = await app.inject({
      method: "POST",
      url: `/native-cards/imports/${checked.id}/confirm`,
    });
    expect(confirmation.statusCode, confirmation.body).toBe(201);
    const card = confirmation.json<{ data: NativeCard }>().data;
    const versions = await app.inject(`/characters/${card.characterId}/versions`);
    expect(versions.statusCode, versions.body).toBe(200);
    const versionId = versions.json<{ data: { id: string }[] }>().data[0]?.id;
    expect(versionId).toBeDefined();
    const validate = await loader.load(DEFAULT_ADMIN_ACCOUNT_ID, versionId!, "backend/validators/validate.js", "validate");
    const context = {
      before: { trust: 1 },
      candidate: { trust: -1 },
      sourceMessages: [],
      priorFacts: [],
      toolEvidence: [],
      floorBefore: { trust: 1 },
      facts: {},
    };
    await expect(validate(context)).resolves.toEqual({ issues: ["negative trust"] });
    await expect(validate({ ...context, candidate: { trust: 1 } })).resolves.toEqual({ issues: [] });
  }
}, 30_000);

it("rejects validator imports with unresolved values or unauthorized entry context access", async () => {
  root = await mkdtemp(join(tmpdir(), "native-card-invalid-module-bindings-"));
  const storage = loadStorageConfig({ DATA_DIR: root });
  app = (await buildTestApp({
    databasePath: storage.databasePath,
    storage,
    logger: false,
    auth: { mode: "off" },
  })).app;
  const fixture = JSON.parse(await readFile(new URL("./fixtures/native-card/harbor.files.json", import.meta.url), "utf8")) as Record<string, string>;
  for (const [source, expected] of [
    ["export function validate(context) { return { issues }; }", "Global issues is not part of the role module API."],
    ["export function validate(context) { return { issues: context.privateField }; }", "The validate context does not expose privateField."],
    ["export function validate(context) { return { context }; }", "Read the role API through one of the documented top-level context fields."],
  ]) {
    const files = { ...fixture, "backend/validators/validate.js": source! };
    const archive = writeNativeCardZip(Object.entries(files).map(([path, text]) => ({ path, content: Buffer.from(text) })));
    const inspection = await app.inject({
      method: "POST",
      url: "/native-cards/imports?fileName=invalid-binding.zip",
      headers: { "content-type": "application/zip" },
      payload: archive,
    });
    expect(inspection.statusCode, inspection.body).toBe(200);
    const checked = inspection.json<{ data: NativeCardImport }>().data;
    expect(checked.status).toBe("invalid");
    expect(checked.issues).toContainEqual(expect.objectContaining({
      code: "NATIVE_CARD_MODULE_INVALID",
      path: "backend/validators/validate.js",
      expected,
      line: 1,
      column: expect.any(Number),
    }));
    const confirmation = await app.inject({
      method: "POST",
      url: `/native-cards/imports/${checked.id}/confirm`,
    });
    expect(confirmation.statusCode, confirmation.body).toBe(422);
    expect(confirmation.json().error.code).toBe("NATIVE_CARD_PACKAGE_INVALID");
  }
}, 30_000);

it("materializes the full fixture and resolves its pinned regex profiles through the runtime loader", async () => {
  root = await mkdtemp(join(tmpdir(), "native-card-runtime-resources-"));
  const storage = loadStorageConfig({ DATA_DIR: root });
  const built = await buildTestApp({
    databasePath: storage.databasePath,
    storage,
    logger: false,
    auth: { mode: "off" },
  });
  app = built.app;
  const fixture = JSON.parse(await readFile(new URL("./fixtures/native-card/harbor.files.json", import.meta.url), "utf8")) as Record<string, string>;
  const zip = writeNativeCardZip(Object.entries(fixture).map(([path, content]) => ({ path, content: Buffer.from(content) })));
  const inspect = await app.inject({ method: "POST", url: "/native-cards/imports?fileName=harbor.zip", headers: { "content-type": "application/zip" }, payload: zip });
  expect(inspect.statusCode, inspect.body).toBe(200);
  expect(inspect.json().data).toMatchObject({ status: "ready", issues: [] });
  const imported = await app.inject({ method: "POST", url: `/native-cards/imports/${inspect.json().data.id}/confirm` });
  expect(imported.statusCode, imported.body).toBe(201);
  const card = imported.json().data;
  const version = built.database.select().from(characterVersions)
    .where(eq(characterVersions.characterId, card.characterId))
    .orderBy(desc(characterVersions.versionNo)).get();
  expect(version).toBeDefined();
  const snapshot = JSON.parse(version!.dataJson) as { extensions: { tavern_headless: { nativePackage: unknown } } };
  const loaded = await new PromptResourceLoader(built.database)
    .loadNativeCardRuntimeResources(DEFAULT_ADMIN_ACCOUNT_ID, snapshot.extensions.tavern_headless.nativePackage);
  expect(loaded.worldbooks.map(({ bookId, resource }) => [bookId, resource.worldbook.name])).toEqual([
    ["harbor", "雾港地理"],
    ["people", "雾港人物"],
  ]);
  expect(loaded.regexProfiles.map(({ path }) => path)).toEqual(["regex/first.json", "regex/second.json"]);
  for (const item of loaded.regexProfiles) {
    expect(item.resource.scripts[0]).toMatchObject({ minDepth: 0, maxDepth: 0 });
  }
}, 30_000);

it("keeps preview failures atomic and initializes the selected opening content and state", async () => {
  root = await mkdtemp(join(tmpdir(), "native-card-preview-opening-"));
  const storage = loadStorageConfig({ DATA_DIR: root });
  const now = Date.now();
  let failNextPreviewInitialization = false;
  let blockNextPreviewDeletion = false;
  let previewCharacterId: string | undefined;
  let previewCardId: string | undefined;
  let failedSessionId: string | undefined;
  let snapshotPreviewStorage: (() => {
    character: typeof characters.$inferSelect | undefined;
    versions: (typeof characterVersions.$inferSelect)[];
    versionBindings: (typeof nativeCardVersionBindings.$inferSelect)[];
    resourceBindings: (typeof nativeCardResourceBindings.$inferSelect)[];
    worldbooks: (typeof worldbooks.$inferSelect)[];
    worldbookEntries: (typeof worldbookEntries.$inferSelect)[];
    worldbookVersions: (typeof worldbookVersions.$inferSelect)[];
    regexProfiles: (typeof regexProfiles.$inferSelect)[];
    regexProfileVersions: (typeof regexProfileVersions.$inferSelect)[];
  }) | undefined;
  let injectedConcurrentUpdate: {
    previewVersionId: string;
    character: typeof characters.$inferSelect;
    version: typeof characterVersions.$inferSelect;
    binding: typeof nativeCardVersionBindings.$inferSelect;
  } | undefined;
  let concurrentResourceSnapshot: {
    resourceBindings: (typeof nativeCardResourceBindings.$inferSelect)[];
    worldbooks: (typeof worldbooks.$inferSelect)[];
    worldbookEntries: (typeof worldbookEntries.$inferSelect)[];
    worldbookVersions: (typeof worldbookVersions.$inferSelect)[];
    regexProfiles: (typeof regexProfiles.$inferSelect)[];
    regexProfileVersions: (typeof regexProfileVersions.$inferSelect)[];
  } | undefined;
  let failedSessionConfigSnapshot: {
    profileBindings: (typeof llmProfileBindings.$inferSelect)[];
    instanceConfigs: (typeof llmInstanceConfigs.$inferSelect)[];
  } | undefined;
  let built!: Awaited<ReturnType<typeof buildTestApp>>;
  built = await buildTestApp({
    databasePath: storage.databasePath,
    storage,
    logger: false,
    auth: { mode: "off" },
    onRoleSessionCreated: async ({ release, session }) => {
      if (!failNextPreviewInitialization && !blockNextPreviewDeletion) return;
      const blockDeletion = blockNextPreviewDeletion;
      failNextPreviewInitialization = false;
      blockNextPreviewDeletion = false;
      failedSessionId = String(session.id);
      if (!previewCharacterId || !previewCardId || !snapshotPreviewStorage || !failedSessionId) {
        throw new Error("Preview failure fixture was not ready.");
      }
      failedSessionConfigSnapshot = {
        profileBindings: built.database.select().from(llmProfileBindings).where(and(
          eq(llmProfileBindings.accountId, DEFAULT_ADMIN_ACCOUNT_ID),
          eq(llmProfileBindings.scope, "session"),
          eq(llmProfileBindings.scopeId, failedSessionId),
        )).all(),
        instanceConfigs: built.database.select().from(llmInstanceConfigs).where(and(
          eq(llmInstanceConfigs.accountId, DEFAULT_ADMIN_ACCOUNT_ID),
          eq(llmInstanceConfigs.scope, "session"),
          eq(llmInstanceConfigs.scopeId, failedSessionId),
        )).all(),
      };
      if (blockDeletion) {
        const floor = built.database.select().from(floors)
          .where(eq(floors.sessionId, failedSessionId)).get();
        if (!floor) throw new Error("Preview greeting floor was not created.");
        const runAt = Date.now();
        built.database.transaction((tx) => {
          tx.update(floors).set({ state: "generating", updatedAt: runAt })
            .where(eq(floors.id, floor.id)).run();
          tx.insert(floorRunStates).values({
            floorId: floor.id,
            runId: "native-preview-blocking-run",
            runType: "respond",
            status: "running",
            phase: "page_generating",
            publicPhase: "generating",
            phaseSeq: 1,
            attemptNo: 1,
            pendingOutputJson: null,
            verifierJson: null,
            errorJson: null,
            startedAt: runAt,
            updatedAt: runAt,
            completedAt: null,
          }).run();
        });
        throw new Error("Forced preview initialization failure while the session has an active run.");
      }
      const character = built.database.select().from(characters)
        .where(eq(characters.id, previewCharacterId)).get();
      if (!character) throw new Error("Preview character disappeared.");
      const createdAt = now + 100_000_000;
      const version = {
        id: "native-preview-concurrent-version",
        characterId: character.id,
        versionNo: character.latestVersionNo + 1,
        dataJson: JSON.stringify(release.character_snapshot),
        contentHash: "native-preview-concurrent-content",
        createdAt,
      };
      const binding = {
        characterVersionId: version.id,
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        cardId: previewCardId,
        revision: 2,
        createdAt,
      };
      built.database.transaction((tx) => {
        tx.insert(characterVersions).values(version).run();
        tx.insert(nativeCardVersionBindings).values(binding).run();
        tx.update(characters).set({
          name: "并发更新后的角色名",
          revision: character.revision + 1,
          latestVersionNo: version.versionNo,
          updatedAt: createdAt,
        }).where(eq(characters.id, character.id)).run();
      });
      injectedConcurrentUpdate = {
        previewVersionId: release.character_version_id,
        character: built.database.select().from(characters)
          .where(eq(characters.id, character.id)).get()!,
        version: built.database.select().from(characterVersions)
          .where(eq(characterVersions.id, version.id)).get()!,
        binding: built.database.select().from(nativeCardVersionBindings)
          .where(eq(nativeCardVersionBindings.characterVersionId, version.id)).get()!,
      };
      const checkpoint = snapshotPreviewStorage();
      concurrentResourceSnapshot = {
        resourceBindings: checkpoint.resourceBindings,
        worldbooks: checkpoint.worldbooks,
        worldbookEntries: checkpoint.worldbookEntries,
        worldbookVersions: checkpoint.worldbookVersions,
        regexProfiles: checkpoint.regexProfiles,
        regexProfileVersions: checkpoint.regexProfileVersions,
      };
      throw new Error("Forced preview initialization failure after a concurrent character update.");
    },
  });
  app = built.app;

  const { workspaceId } = ensureTestDefaultWorkspace(built.database, DEFAULT_ADMIN_ACCOUNT_ID, now);
  built.database.insert(accountUsers).values({
    id: "native-preview-user",
    accountId: DEFAULT_ADMIN_ACCOUNT_ID,
    workspaceId,
    name: "预览测试用户",
    snapshotJson: JSON.stringify({ name: "预览测试用户", description: "用于原生预览错误验收。" }),
    status: "active",
    revision: 0,
    createdAt: now,
    updatedAt: now,
  }).run();
  built.database.insert(presets).values({
    id: "native-preview-preset",
    name: "原生预览测试预设",
    source: "test",
    accountId: DEFAULT_ADMIN_ACCOUNT_ID,
    workspaceId,
    dataJson: "{}",
    version: 1,
    createdAt: now,
    updatedAt: now,
  }).run();
  built.database.insert(presetVersions).values({
    id: "native-preview-preset-version",
    presetId: "native-preview-preset",
    versionNo: 1,
    dataJson: "{}",
    contentHash: "native-preview-preset-hash",
    createdAt: now,
  }).run();
  const statePreset = await importStatePromptPreset(app);
  built.database.insert(llmProfiles).values({
    id: "native-preview-profile",
    presetName: "原生预览测试模型",
    accountId: DEFAULT_ADMIN_ACCOUNT_ID,
    workspaceId,
    provider: "openai",
    modelId: "test-model",
    apiKeyEncrypted: "unused-in-route-test",
    apiKeyMasked: "****test",
    status: "active",
    createdAt: now,
    updatedAt: now,
  }).run();

  const fixture = JSON.parse(await readFile(new URL("./fixtures/native-card/harbor.files.json", import.meta.url), "utf8")) as Record<string, string>;
  const manifest = JSON.parse(fixture["manifest.json"]!) as {
    files: Array<{ path: string; mediaType: string; purpose: string }>;
  };
  const openingManifest = JSON.parse(fixture["openings.json"]!) as {
    items: Array<Record<string, unknown>>;
    defaultOpeningIds: { individual: string; group: string };
  };
  const explicitOpeningText = "山门初雪。沈知夏把红伞交给同行者。";
  const revisionTwoOpeningText = "山门灯亮了。沈知夏把红伞交给同行者。";
  fixture["openings/third.txt"] = explicitOpeningText;
  fixture["state/initial/third.json"] = JSON.stringify({ location: "山门", hour: 6, trust: 45 });
  openingManifest.items.push({
    id: "third",
    title: "山门初雪",
    summary: "从山门开始调查",
    kind: "story",
    audience: "group",
    textFile: "openings/third.txt",
    initialStateFile: "state/initial/third.json",
  });
  manifest.files.push(
    { path: "openings/third.txt", mediaType: "text/plain", purpose: "data" },
    { path: "state/initial/third.json", mediaType: "application/json", purpose: "data" },
  );
  fixture["manifest.json"] = JSON.stringify(manifest);
  fixture["openings.json"] = JSON.stringify(openingManifest);
  const zip = writeNativeCardZip(Object.entries(fixture).map(([path, content]) => ({ path, content: Buffer.from(content) })));
  const inspect = await app.inject({ method: "POST", url: "/native-cards/imports?fileName=harbor.zip", headers: { "content-type": "application/zip" }, payload: zip });
  expect(inspect.statusCode, inspect.body).toBe(200);
  const imported = await app.inject({ method: "POST", url: `/native-cards/imports/${inspect.json().data.id}/confirm` });
  expect(imported.statusCode, imported.body).toBe(201);
  const cardId = imported.json().data.id as string;
  previewCardId = cardId;
  previewCharacterId = imported.json().data.characterId as string;
  const saveRevision = await app.inject({
    method: "PUT",
    url: `/native-cards/${cardId}/files`,
    payload: {
      expectedRevision: 1,
      operations: [{ op: "write", path: "openings/third.txt", encoding: "utf8", content: revisionTwoOpeningText }],
    },
  });
  expect(saveRevision.statusCode, saveRevision.body).toBe(200);
  expect(saveRevision.json().data.revision).toBe(2);
  const configuration = {
    presetId: "native-preview-preset",
    presetVersionId: "native-preview-preset-version",
    defaultUserId: "native-preview-user",
    promptMode: "native",
    modelSlots: ["narrator", "state_updater"].map((slot) => ({
      slot,
      profile_id: "native-preview-profile",
      params: { temperature: 0.4, max_output_tokens: 256, reasoning_effort: "none" },
    })),
    statePresetId: statePreset.statePresetId,
    statePresetVersionId: statePreset.statePresetVersionId,
    model_capabilities: {
      enabled: true,
      allowed: ["random"],
      slot: "narrator",
      transport: "native_function_call",
      limits: { maxCallsPerTurn: 2 },
    },
  };

  snapshotPreviewStorage = () => {
    const character = built.database.select().from(characters)
      .where(eq(characters.id, previewCharacterId!)).get();
    const versions = built.database.select().from(characterVersions)
      .where(eq(characterVersions.characterId, previewCharacterId!)).all();
    const versionBindings = built.database.select().from(nativeCardVersionBindings)
      .where(eq(nativeCardVersionBindings.cardId, cardId)).all();
    const resourceBindings = built.database.select().from(nativeCardResourceBindings)
      .where(eq(nativeCardResourceBindings.cardId, cardId)).all();
    return {
      character,
      versions,
      versionBindings,
      resourceBindings,
      worldbooks: built.database.select().from(worldbooks).all(),
      worldbookEntries: built.database.select().from(worldbookEntries).all(),
      worldbookVersions: built.database.select().from(worldbookVersions).all(),
      regexProfiles: built.database.select().from(regexProfiles).all(),
      regexProfileVersions: built.database.select().from(regexProfileVersions).all(),
    };
  };

  const createPreview = (payload: { openingId?: string; sessionType: "individual" | "group"; revision?: number }) => app!.inject({
    method: "POST",
    url: `/native-cards/${cardId}/preview-sessions`,
    payload: {
      revision: payload.revision ?? 2,
      configuration,
      ...(payload.openingId ? { openingId: payload.openingId } : {}),
      sessionType: payload.sessionType,
    },
  });

  for (const { openingId, sessionType } of [
    { openingId: "missing-opening", sessionType: "group" },
    { openingId: "first", sessionType: "group" },
  ]) {
    const before = snapshotPreviewStorage();
    const response = await app.inject({
      method: "POST",
      url: `/native-cards/${cardId}/preview-sessions`,
      payload: { revision: 2, configuration, openingId, sessionType },
    });
    expect(response.statusCode, response.body).toBe(404);
    expect(response.json().error).toEqual({
      code: "ROLE_RELEASE_OPENING_NOT_FOUND",
      message: apiErrorMessages.ROLE_RELEASE_OPENING_NOT_FOUND,
      details: { opening_id: openingId },
    });
    expect(snapshotPreviewStorage()).toEqual(before);
  }

  const sessionsAfterInvalidOpenings = await app.inject({ method: "GET", url: "/sessions" });
  expect(sessionsAfterInvalidOpenings.statusCode, sessionsAfterInvalidOpenings.body).toBe(200);
  expect(sessionsAfterInvalidOpenings.json().data).toEqual([]);

  const beforeInitializationFailure = snapshotPreviewStorage();
  failNextPreviewInitialization = true;
  const initializationFailure = await createPreview({ openingId: "third", sessionType: "group" });
  expect(initializationFailure.statusCode).toBeGreaterThanOrEqual(500);
  expect(injectedConcurrentUpdate).toBeDefined();
  const afterInitializationFailure = snapshotPreviewStorage();
  expect(afterInitializationFailure.character).toEqual(injectedConcurrentUpdate!.character);
  expect(afterInitializationFailure.versions.map(({ id }) => id).sort()).toEqual([
    ...beforeInitializationFailure.versions.map(({ id }) => id),
    injectedConcurrentUpdate!.version.id,
  ].sort());
  expect(afterInitializationFailure.versionBindings.map(({ characterVersionId }) => characterVersionId).sort()).toEqual([
    ...beforeInitializationFailure.versionBindings.map(({ characterVersionId }) => characterVersionId),
    injectedConcurrentUpdate!.binding.characterVersionId,
  ].sort());
  expect(afterInitializationFailure.resourceBindings).toEqual(concurrentResourceSnapshot!.resourceBindings);
  expect(afterInitializationFailure.worldbooks).toEqual(concurrentResourceSnapshot!.worldbooks);
  expect(afterInitializationFailure.worldbookEntries).toEqual(concurrentResourceSnapshot!.worldbookEntries);
  expect(afterInitializationFailure.worldbookVersions).toEqual(concurrentResourceSnapshot!.worldbookVersions);
  expect(afterInitializationFailure.regexProfiles).toEqual(concurrentResourceSnapshot!.regexProfiles);
  expect(afterInitializationFailure.regexProfileVersions).toEqual(concurrentResourceSnapshot!.regexProfileVersions);
  const sessionsAfterInitializationFailure = await app.inject({ method: "GET", url: "/sessions" });
  expect(sessionsAfterInitializationFailure.statusCode, sessionsAfterInitializationFailure.body).toBe(200);
  expect(sessionsAfterInitializationFailure.json().data).toEqual([]);
  expect(failedSessionConfigSnapshot?.profileBindings.length).toBeGreaterThan(0);
  expect(failedSessionConfigSnapshot?.instanceConfigs.length).toBeGreaterThan(0);
  expect(built.database.select().from(llmProfileBindings).where(and(
    eq(llmProfileBindings.accountId, DEFAULT_ADMIN_ACCOUNT_ID),
    eq(llmProfileBindings.scope, "session"),
    eq(llmProfileBindings.scopeId, failedSessionId!),
  )).all()).toEqual([]);
  expect(built.database.select().from(llmInstanceConfigs).where(and(
    eq(llmInstanceConfigs.accountId, DEFAULT_ADMIN_ACCOUNT_ID),
    eq(llmInstanceConfigs.scope, "session"),
    eq(llmInstanceConfigs.scopeId, failedSessionId!),
  )).all()).toEqual([]);

  const expectOpeningView = async (
    response: Awaited<ReturnType<typeof createPreview>>,
    expectedText: string,
    expectedVariables: Record<string, unknown>,
    expectedRevision = 2,
  ) => {
    const sessionId = response.json().data.sessionId as string;
    const session = built.database.select().from(sessions)
      .where(eq(sessions.id, sessionId)).get()!;
    const versionBinding = session.characterVersionId
      ? built.database.select().from(nativeCardVersionBindings).where(and(
          eq(nativeCardVersionBindings.characterVersionId, session.characterVersionId),
          eq(nativeCardVersionBindings.accountId, DEFAULT_ADMIN_ACCOUNT_ID),
          eq(nativeCardVersionBindings.cardId, cardId),
          eq(nativeCardVersionBindings.revision, expectedRevision),
        )).get()
      : undefined;
    expect(versionBinding).toBeDefined();
    const boundVersion = session.characterVersionId
      ? built.database.select({ characterId: characterVersions.characterId })
          .from(characterVersions)
          .where(eq(characterVersions.id, session.characterVersionId)).get()
      : undefined;
    expect(boundVersion?.characterId).toBe(previewCharacterId);
    expect(JSON.parse(session.metadataJson!)).toMatchObject({
      native_card: { card_id: cardId, revision: expectedRevision },
      model_capabilities: {
        enabled: true,
        allowed: ["random"],
        slot: "narrator",
        transport: "native_function_call",
        limits: { maxCallsPerTurn: 2, maxStepsPerGeneration: 8 },
      },
    });
    expect(JSON.parse(session.roleModelCapabilitiesSnapshotJson!)).toMatchObject({
      metadata: {
        native_card: { card_id: cardId, revision: expectedRevision },
        model_capabilities: {
          enabled: true,
          allowed: ["random"],
          slot: "narrator",
          transport: "native_function_call",
        },
      },
      character_id: previewCharacterId,
      character_version_id: session.characterVersionId,
    });
    const runtimeCatalog = await new SessionToolRegistryService(built.database, {
      baseRegistry: new ToolRegistry(),
    }).getRuntimeCatalog(sessionId, DEFAULT_ADMIN_ACCOUNT_ID);
    expect(runtimeCatalog.tools.map((tool) => tool.name)).toEqual(["random"]);
    expect(runtimeCatalog.tools[0]?.providerId).toBe("system:role-model-capabilities");
    const roleView = await app!.inject({ method: "GET", url: `/sessions/${sessionId}/role-view` });
    expect(roleView.statusCode, roleView.body).toBe(200);
    expect(roleView.json().data.delivery.data.opening).toBe(expectedText);
    expect(roleView.json().data.initial.variables).toEqual(expectedVariables);
    const savedGreeting = built.database.select({
      role: messages.role,
      content: messages.content,
      source: messages.source,
    }).from(messages)
      .innerJoin(messagePages, eq(messages.pageId, messagePages.id))
      .innerJoin(floors, eq(messagePages.floorId, floors.id))
      .where(and(eq(floors.sessionId, sessionId), eq(messages.source, "greeting")))
      .orderBy(asc(floors.floorNo), asc(messagePages.pageNo), asc(messages.seq))
      .get();
    expect(savedGreeting).toEqual({ role: "assistant", content: expectedText, source: "greeting" });
  };

  const explicitOpening = await createPreview({ openingId: "third", sessionType: "group" });
  expect(explicitOpening.statusCode, explicitOpening.body).toBe(201);
  expect(explicitOpening.json().data).toMatchObject({ cardId, revision: 2, openingId: "third" });
  expect(explicitOpening.json().data.sessionId).toEqual(expect.any(String));
  await expectOpeningView(explicitOpening, revisionTwoOpeningText, { location: "山门", hour: 6, trust: 45 });

  const individualDefault = await createPreview({ sessionType: "individual" });
  expect(individualDefault.statusCode, individualDefault.body).toBe(201);
  expect(individualDefault.json().data).toMatchObject({ cardId, revision: 2, openingId: "first" });
  expect(individualDefault.json().data.sessionId).toEqual(expect.any(String));
  await expectOpeningView(individualDefault, fixture["openings/first.txt"]!, { location: "夜间邮局", hour: 23, trust: 20 });

  const groupDefault = await createPreview({ sessionType: "group" });
  expect(groupDefault.statusCode, groupDefault.body).toBe(201);
  expect(groupDefault.json().data).toMatchObject({ cardId, revision: 2, openingId: "second" });
  expect(groupDefault.json().data.sessionId).toEqual(expect.any(String));
  await expectOpeningView(groupDefault, fixture["openings/second.txt"]!, { location: "花园门口", hour: 18, trust: 30 });

  const revisionThreeText = "山门钟声响起。沈知夏把红伞交给同行者。";
  const saveRevisionThree = await app.inject({
    method: "PUT",
    url: `/native-cards/${cardId}/files`,
    payload: {
      expectedRevision: 2,
      operations: [{ op: "write", path: "openings/third.txt", encoding: "utf8", content: revisionThreeText }],
    },
  });
  expect(saveRevisionThree.statusCode, saveRevisionThree.body).toBe(200);
  expect(saveRevisionThree.json().data.revision).toBe(3);
  const existingPreviewRuntimeCatalog = await new SessionToolRegistryService(built.database, {
    baseRegistry: new ToolRegistry(),
  }).getRuntimeCatalog(
    explicitOpening.json().data.sessionId,
    DEFAULT_ADMIN_ACCOUNT_ID,
  );
  expect(existingPreviewRuntimeCatalog.tools.map((tool) => tool.name)).toEqual(["random"]);
  expect(existingPreviewRuntimeCatalog.tools[0]?.providerId).toBe("system:role-model-capabilities");

  const pinnedRevisionPreview = await createPreview({
    openingId: "third",
    sessionType: "group",
    revision: 2,
  });
  expect(pinnedRevisionPreview.statusCode, pinnedRevisionPreview.body).toBe(201);
  expect(pinnedRevisionPreview.json().data).toMatchObject({ cardId, revision: 2, openingId: "third" });
  await expectOpeningView(
    pinnedRevisionPreview,
    revisionTwoOpeningText,
    { location: "山门", hour: 6, trust: 45 },
    2,
  );

  const beforeBlockedDeletion = snapshotPreviewStorage();
  blockNextPreviewDeletion = true;
  const blockedDeletion = await createPreview({ openingId: "third", sessionType: "group", revision: 3 });
  expect(blockedDeletion.statusCode).toBe(500);
  expect(blockedDeletion.json().error).toMatchObject({
    code: "ROLE_RELEASE_SESSION_CLEANUP_FAILED",
    details: {
      session_id: failedSessionId,
      delete_status: 409,
      preview_materialization_retained: true,
    },
  });
  expect(failedSessionConfigSnapshot?.profileBindings.length).toBeGreaterThan(0);
  expect(failedSessionConfigSnapshot?.instanceConfigs.length).toBeGreaterThan(0);
  expect(built.database.select().from(sessions).where(eq(sessions.id, failedSessionId!)).get()).toBeDefined();
  const retainedVersion = built.database.select().from(characterVersions)
    .where(eq(characterVersions.id, blockedDeletion.json().error.details.preview_character_version_id as string)).get();
  expect(retainedVersion).toBeDefined();
  const retainedBinding = built.database.select().from(nativeCardVersionBindings)
    .where(eq(nativeCardVersionBindings.characterVersionId, retainedVersion!.id)).get();
  expect(retainedBinding).toMatchObject({ cardId, revision: 3 });
  const retainedSnapshot = JSON.parse(retainedVersion!.dataJson) as {
    extensions: { tavern_headless: { nativePackage: unknown } };
  };
  const retainedResources = await new PromptResourceLoader(built.database)
    .loadNativeCardRuntimeResources(DEFAULT_ADMIN_ACCOUNT_ID, retainedSnapshot.extensions.tavern_headless.nativePackage);
  expect(retainedResources.worldbooks.map(({ bookId, resource }) => [bookId, resource.worldbook.name])).toEqual([
    ["harbor", "雾港地理"],
    ["people", "雾港人物"],
  ]);
  expect(retainedResources.regexProfiles.map(({ path }) => path)).toEqual(["regex/first.json", "regex/second.json"]);
  const retainedRoleView = await app.inject({ method: "GET", url: `/sessions/${failedSessionId}/role-view` });
  expect(retainedRoleView.statusCode, retainedRoleView.body).toBe(200);
  expect(retainedRoleView.json().data.character_version_id).toBe(retainedVersion!.id);
  expect(retainedRoleView.json().data.initial.variables).toEqual({ location: "山门", hour: 6, trust: 45 });
  expect(snapshotPreviewStorage().versions.map(({ id }) => id)).toContain(retainedVersion!.id);
  expect(snapshotPreviewStorage().resourceBindings.length).toBeGreaterThan(beforeBlockedDeletion.resourceBindings.length);
}, 30_000);

function previewGate() {
  let enter!: (value: { versionId: string; sessionId: string }) => void;
  let finish!: (succeed: boolean) => void;
  return {
    entered: new Promise<{ versionId: string; sessionId: string }>((resolve) => { enter = resolve; }),
    result: new Promise<boolean>((resolve) => { finish = resolve; }),
    enter: (value: { versionId: string; sessionId: string }) => enter(value),
    finish: (succeed: boolean) => finish(succeed),
  };
}

it.each<{ name: string; order: number[]; successes: number[]; save: boolean; concurrent?: string }>([
  { name: "save during a failed preview", order: [0], successes: [], save: true },
  { name: "first preview fails before the second", order: [0, 1], successes: [], save: false },
  { name: "second preview fails before the first", order: [1, 0], successes: [], save: false },
  { name: "first preview succeeds before the second fails", order: [0, 1], successes: [0], save: false },
  { name: "second preview fails before the first succeeds", order: [1, 0], successes: [0], save: false },
  { name: "first preview fails before the second succeeds", order: [0, 1], successes: [1], save: false },
  { name: "second preview succeeds before the first fails", order: [1, 0], successes: [1], save: false },
  { name: "publication commits while a preview fails", order: [0], successes: [], save: false, concurrent: "publication" },
  { name: "another session pins the failing preview version", order: [0], successes: [], save: false, concurrent: "session" },
  { name: "a release pins the failing preview version", order: [0], successes: [], save: false, concurrent: "release" },
  { name: "a draft pins the failing preview character version", order: [0], successes: [], save: false, concurrent: "character-draft" },
  { name: "a prompt snapshot pins the failing preview character version", order: [0], successes: [], save: false, concurrent: "character-history" },
  ...["session", "unpinned-session", "release", "draft", "branch", "snapshot", "version-only-snapshot", "native-snapshot", "native-character", "edit", "released", "released-later"].flatMap((consumer) =>
    ["worldbook", "regex_profile"].map((kind) => ({
      name: `resource ${kind} retained by ${consumer}`, order: [0], successes: [], save: false,
      concurrent: `resource:${consumer}:${kind}`,
    }))),
])("keeps preview concurrency consistent: $name", async ({ order, successes, save, concurrent }) => {
  root = await mkdtemp(join(tmpdir(), "native-preview-concurrency-"));
  const storage = loadStorageConfig({ DATA_DIR: root });
  const gates = order.map(() => previewGate());
  let enteredCount = 0;
  const built = await buildTestApp({
    databasePath: storage.databasePath, storage, logger: false, auth: { mode: "off" },
    onRoleSessionCreated: async ({ release, session }) => {
      const gate = gates[enteredCount++]!;
      gate.enter({ versionId: release.character_version_id, sessionId: String(session.id) });
      if (!await gate.result) throw new Error("Injected concurrent preview initialization failure.");
    },
  });
  app = built.app;
  const now = Date.now();
  const { workspaceId } = ensureTestDefaultWorkspace(built.database, DEFAULT_ADMIN_ACCOUNT_ID, now);
  built.database.insert(accountUsers).values({
    id: "concurrent-user", accountId: DEFAULT_ADMIN_ACCOUNT_ID, workspaceId, name: "裴修远",
    snapshotJson: JSON.stringify({ name: "裴修远", description: "裴修远是前来调查雾港的成年旅人。" }),
    status: "active", revision: 0, createdAt: now, updatedAt: now,
  }).run();
  built.database.insert(presets).values({
    id: "concurrent-preset", name: "并发预览预设", source: "test", accountId: DEFAULT_ADMIN_ACCOUNT_ID,
    workspaceId, dataJson: "{}", version: 1, createdAt: now, updatedAt: now,
  }).run();
  built.database.insert(presetVersions).values({
    id: "concurrent-preset-version", presetId: "concurrent-preset", versionNo: 1,
    dataJson: "{}", contentHash: "test-preset", createdAt: now,
  }).run();
  const statePreset = await importStatePromptPreset(app);
  built.database.insert(llmProfiles).values({
    id: "concurrent-profile", presetName: "并发预览模型", accountId: DEFAULT_ADMIN_ACCOUNT_ID,
    workspaceId, provider: "openai", modelId: "test-model", apiKeyEncrypted: "unused-in-route-test",
    apiKeyMasked: "****test", status: "active", createdAt: now, updatedAt: now,
  }).run();
  const fixture = JSON.parse(await readFile(new URL("./fixtures/native-card/harbor.files.json", import.meta.url), "utf8")) as Record<string, string>;
  const zip = writeNativeCardZip(Object.entries(fixture).map(([path, content]) => ({ path, content: Buffer.from(content) })));
  const inspected = await app.inject({ method: "POST", url: "/native-cards/imports?fileName=harbor.zip", headers: { "content-type": "application/zip" }, payload: zip });
  expect(inspected.statusCode, inspected.body).toBe(200);
  const imported = await app.inject({ method: "POST", url: `/native-cards/imports/${inspected.json().data.id}/confirm` });
  expect(imported.statusCode, imported.body).toBe(201);
  const card = imported.json().data as { id: string; characterId: string };
  const writeCharacter = (expectedRevision: number, name: string) => app!.inject({
    method: "PUT", url: `/native-cards/${card.id}/files`, payload: {
      expectedRevision, operations: [{ op: "write", path: "character.json", encoding: "utf8", content: JSON.stringify({ ...JSON.parse(fixture["character.json"]!), name }) }],
    },
  });
  const saved = await writeCharacter(1, "预览修订二");
  expect(saved.statusCode, saved.body).toBe(200);
  const readCharacter = () => built.database.select().from(characters).where(eq(characters.id, card.characterId)).get()!;
  const readResources = () => ({
    bindings: built.database.select().from(nativeCardResourceBindings).all(),
    books: built.database.select().from(worldbooks).all(),
    entries: built.database.select().from(worldbookEntries).all(),
    bookVersions: built.database.select().from(worldbookVersions).all(),
    profiles: built.database.select().from(regexProfiles).all(),
    profileVersions: built.database.select().from(regexProfileVersions).all(),
  });
  const before = { character: readCharacter(), resources: readResources(), versions: built.database.select().from(characterVersions).all() };
  const configuration = {
    presetId: "concurrent-preset", presetVersionId: "concurrent-preset-version",
    defaultUserId: "concurrent-user", promptMode: "native",
    modelSlots: ["narrator", "state_updater"].map((slot) => ({ slot, profile_id: "concurrent-profile" })),
    statePresetId: statePreset.statePresetId,
    statePresetVersionId: statePreset.statePresetVersionId,
  };
  const requests: Promise<Awaited<ReturnType<FastifyInstance["inject"]>>>[] = [];
  try {
    const entered: { versionId: string; sessionId: string }[] = [];
    for (const gate of gates) {
      requests.push(app.inject({
        method: "POST", url: `/native-cards/${card.id}/preview-sessions`, payload: {
          revision: 2, sessionType: "individual", configuration,
        },
      }).then((response) => response));
      entered.push(await Promise.race([
        gate.entered,
        requests[requests.length - 1]!.then((response) => {
          throw new Error(`Preview completed before its initialization gate: ${response.statusCode} ${response.body}`);
        }),
      ]));
    }
    let savedCharacter = before.character;
    if (save) {
      const concurrentSave = await writeCharacter(2, "并发保存后的名称");
      expect(concurrentSave.statusCode, concurrentSave.body).toBe(200);
      savedCharacter = readCharacter();
    }
    const retainedVersionIds = successes.map((index) => entered[index]!.versionId);
    let pinnedSessionId: string | undefined;
    let pinnedReleaseId: string | undefined;
    let committedCharacter: typeof characters.$inferSelect | undefined;
    if (concurrent === "publication") {
      const publication = await app.inject({
        method: "POST", url: `/native-cards/${card.id}/publications`, payload: { revision: 2, configuration },
      });
      expect(publication.statusCode, publication.body).toBe(201);
      retainedVersionIds.push(publication.json().data.characterVersionId as string);
      committedCharacter = readCharacter();
    } else if (concurrent === "session") {
      const pinned = await app.inject({ method: "POST", url: "/sessions", payload: {
        character_id: card.characterId, character_version_id: entered[0]!.versionId,
        character_sync_policy: "pin", user_id: "concurrent-user", preset_id: configuration.presetId,
        preset_version_id: configuration.presetVersionId,
        metadata: { opening_id: "first", statePrompt: statePreset.statePrompt },
      } });
      expect(pinned.statusCode, pinned.body).toBe(201);
      pinnedSessionId = pinned.json().data.id as string;
      retainedVersionIds.push(entered[0]!.versionId);
    } else if (concurrent === "release") {
      const pinned = await app.inject({ method: "POST", url: "/role-releases", payload: {
        name: "固定预览版本", character_id: card.characterId, character_version_id: entered[0]!.versionId,
        preset_id: configuration.presetId, preset_version_id: configuration.presetVersionId,
        regex_profile_id: null, regex_profile_version_id: null, worldbook_id: null, worldbook_version_id: null,
        prompt_mode: "native", default_user_id: configuration.defaultUserId, model_slots: configuration.modelSlots,
        statePresetId: configuration.statePresetId,
        statePresetVersionId: configuration.statePresetVersionId,
      } });
      expect(pinned.statusCode, pinned.body).toBe(201);
      pinnedReleaseId = pinned.json().data.id as string;
      retainedVersionIds.push(entered[0]!.versionId);
    }
    if (concurrent === "character-draft") {
      const response = await app.inject({ method: "POST", url: "/role-apps", payload: { configuration: {
        name: "固定预览人物", character_id: card.characterId, character_version_id: entered[0]!.versionId,
        preset_id: configuration.presetId, preset_version_id: configuration.presetVersionId,
        worldbook_id: null, worldbook_version_id: null, regex_profile_id: null, regex_profile_version_id: null,
        prompt_mode: "native", default_user_id: configuration.defaultUserId, model_slots: configuration.modelSlots,
        statePresetId: configuration.statePresetId,
        statePresetVersionId: configuration.statePresetVersionId,
      } } });
      expect(response.statusCode, response.body).toBe(201);
      retainedVersionIds.push(entered[0]!.versionId);
    }
    let reclaimAfterConsumerRemoval: (() => Promise<void>) | undefined;
    let retainedResources: ReturnType<typeof readResources> | undefined;
    let verifyIndependentConsumer: (() => Promise<void>) | undefined;
    if (concurrent?.startsWith("resource:")) {
      const [, consumer, kind] = concurrent.split(":");
      const resource = built.database.select().from(nativeCardResourceBindings).where(and(
        eq(nativeCardResourceBindings.cardId, card.id), eq(nativeCardResourceBindings.revision, 2),
        eq(nativeCardResourceBindings.kind, kind!),
      )).get()!;
      const isBook = kind === "worldbook";
      const releaseConfiguration = {
        name: "独立资源消费者", character_id: card.characterId, character_version_id: before.versions[0]!.id,
        preset_id: configuration.presetId, preset_version_id: configuration.presetVersionId,
        worldbook_id: isBook ? resource.localId : null, worldbook_version_id: isBook ? resource.localVersionId : null,
        regex_profile_id: isBook ? null : resource.localId, regex_profile_version_id: isBook ? null : resource.localVersionId,
        prompt_mode: "native", default_user_id: configuration.defaultUserId, model_slots: configuration.modelSlots,
        statePresetId: configuration.statePresetId,
        statePresetVersionId: configuration.statePresetVersionId,
      };
      let verifyRows = () => {};
      if (consumer === "release" || consumer === "draft") {
        const response = await app.inject({ method: "POST", url: consumer === "release" ? "/role-releases" : "/role-apps",
          payload: consumer === "release" ? releaseConfiguration : { configuration: releaseConfiguration },
        });
        expect(response.statusCode, response.body).toBe(201);
      } else if (consumer === "native-character") {
        const source = built.database.select().from(characterVersions).where(eq(characterVersions.id, entered[0]!.versionId)).get()!;
        const nativeSnapshot = JSON.parse(source.dataJson);
        nativeSnapshot.extensions.tavern_headless.nativePackage[isBook ? "regexProfiles" : "worldbooks"] = [];
        built.database.insert(characters).values({ ...before.character, id: "independent-character", latestVersionNo: 1 }).run();
        built.database.insert(characterVersions).values({ ...source, id: "independent-character-version", characterId: "independent-character", versionNo: 1, dataJson: JSON.stringify(nativeSnapshot) }).run();
      } else if (consumer === "edit") {
        const service = new AssetVersionService(built.database);
        if (isBook) service.createWorldbookVersion(resource.localId, { versionNo: 2 });
        else service.createRegexProfileVersion(resource.localId, { versionNo: 2, data: {} });
      } else {
        const source = built.database.select().from(characterVersions).where(eq(characterVersions.id, entered[0]!.versionId)).get()!;
        const nativeSnapshot = JSON.parse(source.dataJson);
        nativeSnapshot.extensions.tavern_headless.nativePackage[isBook ? "regexProfiles" : "worldbooks"] = [];
        const response = await app.inject({ method: "POST", url: "/sessions", payload: {
          character_id: card.characterId, character_version_id: before.versions[0]!.id,
          user_id: "concurrent-user", preset_id: configuration.presetId, preset_version_id: configuration.presetVersionId,
          metadata: { statePrompt: statePreset.statePrompt },
          ...(["session", "released", "released-later", "unpinned-session"].includes(consumer!) ? {
            worldbook_profile_id: releaseConfiguration.worldbook_id,
            regex_profile_id: releaseConfiguration.regex_profile_id,
            ...(consumer === "unpinned-session" ? { deep_binding: false } : {
              worldbook_version_id: releaseConfiguration.worldbook_version_id,
              regex_profile_version_id: releaseConfiguration.regex_profile_version_id,
            }),
          } : {}),
          ...(consumer === "native-snapshot" ? { character_snapshot: nativeSnapshot } : {}),
        } });
        expect(response.statusCode, response.body).toBe(201);
        const sessionId = response.json().data.id as string;
        expect(built.database.select().from(sessions).where(eq(sessions.id, sessionId)).get()?.characterVersionId).not.toBe(entered[0]!.versionId);
        if (consumer === "released") {
          const deleted = await app.inject({ method: "DELETE", url: `/sessions/${sessionId}` });
          expect(deleted.statusCode, deleted.body).toBe(200);
        } else if (consumer === "released-later") {
          reclaimAfterConsumerRemoval = async () => {
            const deleted = await app!.inject({ method: "DELETE", url: `/sessions/${sessionId}` });
            expect(deleted.statusCode, deleted.body).toBe(200);
            const gate = previewGate();
            gates.push(gate);
            const retry = app!.inject({ method: "POST", url: `/native-cards/${card.id}/preview-sessions`, payload: { revision: 2, sessionType: "individual", configuration } }).then((response) => response);
            requests.push(retry);
            await Promise.race([
              gate.entered,
              retry.then((response) => { throw new Error(`Retry completed before initialization: ${response.statusCode} ${response.body}`); }),
            ]);
            gate.finish(false);
            expect((await retry).statusCode).toBe(500);
            expect(readResources()).toEqual(before.resources);
            expect(readCharacter()).toEqual(before.character);
          };
        } else if (consumer === "branch") {
          built.database.insert(sessionBranches).values({
            id: "independent-resource-branch", accountId: DEFAULT_ADMIN_ACCOUNT_ID, sessionId, branchId: "independent",
            assetBindingDeepBinding: true,
            assetBindingWorldbookProfileId: releaseConfiguration.worldbook_id,
            assetBindingWorldbookVersionId: releaseConfiguration.worldbook_version_id,
            assetBindingRegexProfileId: releaseConfiguration.regex_profile_id,
            assetBindingRegexProfileVersionId: releaseConfiguration.regex_profile_version_id,
            createdAt: now, updatedAt: now,
          }).run();
          const branch = built.database.select().from(sessionBranches).where(eq(sessionBranches.id, "independent-resource-branch")).get();
          verifyRows = () => expect(built.database.select().from(sessionBranches).where(eq(sessionBranches.id, "independent-resource-branch")).get()).toEqual(branch);
        } else if (consumer === "snapshot" || consumer === "version-only-snapshot") {
          const floor = built.database.select().from(floors).where(eq(floors.sessionId, sessionId)).get()!;
          built.database.insert(promptSnapshots).values({
            floorId: floor.id, sessionId, worldbookId: consumer === "version-only-snapshot" ? null : releaseConfiguration.worldbook_id,
            worldbookVersionId: releaseConfiguration.worldbook_version_id, regexProfileId: consumer === "version-only-snapshot" ? null : releaseConfiguration.regex_profile_id,
            regexProfileVersionId: releaseConfiguration.regex_profile_version_id, promptMode: "native", promptDigest: "fixture", createdAt: now,
          }).run();
          const snapshot = built.database.select().from(promptSnapshots).where(eq(promptSnapshots.floorId, floor.id)).get();
          verifyRows = () => expect(built.database.select().from(promptSnapshots).where(eq(promptSnapshots.floorId, floor.id)).get()).toEqual(snapshot);
        }
      }
      if (consumer !== "released") {
        retainedResources = readResources();
        verifyIndependentConsumer = async () => {
          verifyRows();
          const loader = new PromptResourceLoader(built.database);
          if (isBook) expect(await loader.loadPinnedWorldbook(DEFAULT_ADMIN_ACCOUNT_ID, resource.localId, resource.localVersionId)).toBeDefined();
          else expect(await loader.loadPinnedRegexProfile(DEFAULT_ADMIN_ACCOUNT_ID, resource.localId, resource.localVersionId)).toBeDefined();
        };
      }
    }
    if (concurrent === "character-history") {
      const response = await app.inject({ method: "POST", url: "/sessions", payload: {
        character_id: card.characterId, character_version_id: before.versions[0]!.id, user_id: "concurrent-user",
      } });
      expect(response.statusCode, response.body).toBe(201);
      const sessionId = response.json().data.id as string;
      const floor = built.database.select().from(floors).where(eq(floors.sessionId, sessionId)).get()!;
      built.database.insert(promptSnapshots).values({ floorId: floor.id, sessionId, characterId: card.characterId,
        characterVersionId: entered[0]!.versionId, promptMode: "native", promptDigest: "fixture", createdAt: now }).run();
      retainedVersionIds.push(entered[0]!.versionId);
    }
    for (const index of order) {
      gates[index]!.finish(successes.includes(index));
      const response = await requests[index]!;
      expect(response.statusCode, response.body).toBe(successes.includes(index) ? 201 : 500);
      const current = readCharacter();
      const latest = built.database.select().from(characterVersions).where(and(
        eq(characterVersions.characterId, card.characterId), eq(characterVersions.versionNo, current.latestVersionNo),
      )).get();
      expect.soft(latest, "latest version must exist after each cleanup").toBeDefined();
    }
    const remaining = built.database.select().from(characterVersions).where(eq(characterVersions.characterId, card.characterId)).all();
    expect(remaining.map(({ id }) => id).sort()).toEqual([
      ...before.versions.map(({ id }) => id), ...retainedVersionIds,
    ].sort());
    const after = readCharacter();
    expect.soft(after.latestVersionNo).toBe(Math.max(...remaining.map(({ versionNo }) => versionNo)));
    expect(after.name).toBe(savedCharacter.name);
    expect.soft(after.revision).toBe(before.character.revision + retainedVersionIds.length);
    if (retainedVersionIds.length === 0) {
      expect.soft(after).toEqual({ ...savedCharacter, latestVersionNo: before.character.latestVersionNo, revision: before.character.revision });
      expect(readResources()).toEqual(retainedResources ?? before.resources);
      expect(built.database.select().from(nativeCardVersionBindings).where(and(
        eq(nativeCardVersionBindings.cardId, card.id), eq(nativeCardVersionBindings.revision, 2),
      )).all()).toEqual([]);
    }
    await verifyIndependentConsumer?.();
    await reclaimAfterConsumerRemoval?.();
    if (committedCharacter) expect(after).toEqual(committedCharacter);
    const characterResponse = await app.inject({ method: "GET", url: `/characters/${card.characterId}` });
    expect(characterResponse.statusCode, characterResponse.body).toBe(200);
    expect(characterResponse.json().data.latest_version).not.toBeNull();
    if (pinnedSessionId) {
      expect(built.database.select().from(sessions).where(eq(sessions.id, pinnedSessionId)).get()?.characterVersionId).toBe(entered[0]!.versionId);
    }
    if (pinnedReleaseId) {
      expect(built.database.select().from(roleReleases).where(eq(roleReleases.id, pinnedReleaseId)).get()?.characterVersionId).toBe(entered[0]!.versionId);
    }
    for (const versionId of retainedVersionIds) {
      const version = built.database.select().from(characterVersions).where(eq(characterVersions.id, versionId)).get()!;
      const snapshot = JSON.parse(version.dataJson) as { extensions: { tavern_headless: { nativePackage: unknown } } };
      const loaded = await new PromptResourceLoader(built.database).loadNativeCardRuntimeResources(DEFAULT_ADMIN_ACCOUNT_ID, snapshot.extensions.tavern_headless.nativePackage);
      expect(loaded.worldbooks).toHaveLength(2);
      expect(loaded.regexProfiles).toHaveLength(2);
    }
    for (const index of successes) {
      const session = built.database.select().from(sessions).where(eq(sessions.id, entered[index]!.sessionId)).get();
      expect(session?.characterVersionId).toBe(entered[index]!.versionId);
      const roleView = await app.inject({ method: "GET", url: `/sessions/${session!.id}/role-view` });
      expect(roleView.statusCode, roleView.body).toBe(200);
      expect(roleView.json().data.delivery.data.opening).toBe(fixture["openings/first.txt"]);
    }
  } finally {
    for (const gate of gates) gate.finish(false);
    await Promise.allSettled(requests);
  }

}, 30_000);

it("retains native ZIP budget protection through persisted resource versions and prompt assembly", async () => {
  const { assemblePrompt } = await import('../src/services/prompt-assembler.js');
  const { SimpleTokenCounter } = await import('@tavern/core');
  root = await mkdtemp(join(tmpdir(), 'native-card-budget-'));
  const storage=loadStorageConfig({DATA_DIR:root});
  const built=await buildTestApp({databasePath:storage.databasePath,storage,logger:false,auth:{mode:'off'}});app=built.app;
  const fixture=JSON.parse(await readFile(new URL('./fixtures/native-card/harbor.files.json',import.meta.url),'utf8')) as Record<string,string>;
  const character=JSON.parse(fixture['character.json']!);delete character.promptController;fixture['character.json']=JSON.stringify(character);
  for (const path of Object.keys(fixture)) if(path.startsWith('backend/controllers/')) delete fixture[path];
  const manifest=JSON.parse(fixture['manifest.json']!);manifest.files=manifest.files.filter((file:{path:string})=>!file.path.startsWith('backend/controllers/'));fixture['manifest.json']=JSON.stringify(manifest);
  const entries=['worldbooks/harbor/entries/110.json','worldbooks/harbor/entries/120.json','worldbooks/people/entries/110.json'];
  entries.forEach((path,index)=>{const e=JSON.parse(fixture[path]!);e.constant=true;e.disable=index===2;e.position=0;e.content=(index===0?'PINNED_NATIVE_LORE ':'ORDINARY_NATIVE_LORE ')+'x'.repeat(1200);e.extra={extensions:{ignore_budget:index===0}};fixture[path]=JSON.stringify(e)});
  const zip=writeNativeCardZip(Object.entries(fixture).map(([path,content])=>({path,content:Buffer.from(content)})));
  const inspected=await app.inject({method:'POST',url:'/native-cards/imports?fileName=budget.zip',headers:{'content-type':'application/zip'},payload:zip});expect(inspected.statusCode,inspected.body).toBe(200);
  const imported=await app.inject({method:'POST',url:`/native-cards/imports/${inspected.json().data.id}/confirm`});expect(imported.statusCode,imported.body).toBe(201);
  const card=imported.json().data;const version=built.database.select().from(characterVersions).where(eq(characterVersions.characterId,card.characterId)).orderBy(desc(characterVersions.versionNo)).get()!;
  const snapshot=JSON.parse(version.dataJson);
  const loaded=await new PromptResourceLoader(built.database).loadNativeCardRuntimeResources(DEFAULT_ADMIN_ACCOUNT_ID,snapshot.extensions.tavern_headless.nativePackage);
  expect(loaded.worldbooks[0]!.resource.worldbook.entries[0]!.extra).toEqual({extensions:{ignore_budget:true}});
  const now=Date.now(),presetId='budget-test-preset';
  built.database.insert(presets).values({id:presetId,name:'Budget',source:'sillytavern',accountId:DEFAULT_ADMIN_ACCOUNT_ID,dataJson:JSON.stringify({prompts:[{identifier:'main',name:'Main',role:'system',content:'Guide.'},{identifier:'chatHistory',name:'History',marker:true}],prompt_order:[{character_id:100000,order:[{identifier:'main',enabled:true},{identifier:'chatHistory',enabled:true}]}],openai_max_context:4096,openai_max_tokens:256}),createdAt:now,updatedAt:now}).run();
  const result=await assemblePrompt(built.database,DEFAULT_ADMIN_ACCOUNT_ID,{presetId,worldbookProfileId:null,regexProfileId:null,metadataJson:null,characterId:card.characterId,characterVersionId:version.id,characterSnapshotJson:version.dataJson,promptMode:'native'},[],'Continue',new SimpleTokenCounter(),undefined,{budget:{maxInputTokens:128,reservedCompletionTokens:16}});
  const text=result.messages.map(m=>m.content).join('\n');expect(text).toContain('PINNED_NATIVE_LORE');expect(text).not.toContain('ORDINARY_NATIVE_LORE');
},30_000);
