import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accounts, characterVersions, characters, nativeCards } from "../../../db/schema.js";
import { nativeCardPublications, nativeCardResourceBindings, nativeCardVersionBindings } from "../../../db/native-card-runtime-schema.js";
import { roleReleases } from "../../../db/role-release-schema.js";
import { nativeCardRevisionConflictDetailsSchema, nativeCardWriteFailureDetailsSchema } from "@tavern/shared";
import { createTestDatabase, type DatabaseConnection } from "../../../../test/helpers/create-test-db.js";
import type { NativeCardConfig } from "../../../native-card-config.schema.js";
import { NativeCardService, NativeCardServiceError } from "../native-card-service.js";
import { writeNativeCardZip } from "../zip.js";

let database: DatabaseConnection;
let root: string;
let config: NativeCardConfig;
let service: NativeCardService;

beforeEach(async () => {
  database = createTestDatabase(":memory:");
  root = await mkdtemp(join(tmpdir(), "native-card-service-"));
  config = {
    storageRoot: join(root, "cards"), importStagingRoot: join(root, "imports"), buildRoot: join(root, "builds"),
    maxUploadBytes: 1_000_000, maxExpandedBytes: 2_000_000, maxFileCount: 128,
    maxFileBytes: 512_000, maxPathBytes: 512, importTtlMs: 60_000, buildTtlMs: 60_000,
  };
  const now = Date.now();
  await database.db.insert(accounts).values([
    { id: "account-a", name: "A", role: "user", status: "active", isDefault: false, createdAt: now, updatedAt: now },
    { id: "account-b", name: "B", role: "user", status: "active", isDefault: false, createdAt: now, updatedAt: now },
  ]);
  service = new NativeCardService(database.db, config);
});

afterEach(async () => {
  database.close();
  await rm(root, { recursive: true, force: true });
});

describe("NativeCardService saved revisions", () => {
  it("isolates card reads by account and keeps earlier revision bytes immutable", async () => {
    const created = await service.create("account-a", { name: "花园向导" });
    expect(created.files.map((file) => file.path)).toContain("manifest.json");
    await expect(service.get("account-b", created.id)).rejects.toMatchObject({ code: "NATIVE_CARD_NOT_FOUND", statusCode: 404 });
    expect(await service.list("account-b")).toEqual([]);

    const original = await service.readFile("account-a", created.id, "character.json", 1);
    const character = JSON.parse(original.content);
    character.description = "新增说明";
    const updated = await service.save("account-a", created.id, {
      expectedRevision: 1,
      operations: [{ op: "write", path: "character.json", encoding: "utf8", content: JSON.stringify(character) }],
    });
    expect(updated.revision).toBe(2);
    expect(JSON.parse((await service.readFile("account-a", created.id, "character.json", 1)).content).description).toBeUndefined();
    expect(JSON.parse((await service.readFile("account-a", created.id, "character.json", 2)).content).description).toBe("新增说明");
    await expect(service.save("account-a", created.id, {
      expectedRevision: 1,
      operations: [{ op: "write", path: "character.json", encoding: "utf8", content: JSON.stringify(character) }],
    })).rejects.toMatchObject({ code: "NATIVE_CARD_REVISION_CONFLICT", statusCode: 409 });
    await expect(service.readFile("account-b", created.id, "character.json", 1)).rejects.toMatchObject({ code: "NATIVE_CARD_NOT_FOUND" });
  });

  it("creates an independent role card from a published fixed revision", async () => {
    const fixture = JSON.parse(await readFile(new URL("../../../../test/fixtures/native-card/harbor.files.json", import.meta.url), "utf8")) as Record<string, string>;
    const archive = writeNativeCardZip(Object.entries(fixture).map(([path, text]) => ({ path, content: Buffer.from(text) })));
    const checked = await service.inspectImport("account-a", archive, "harbor.zip");
    const source = await service.confirmImport("account-a", checked.id);
    const sourceVersion = database.db.select().from(characterVersions).where(eq(characterVersions.characterId, source.characterId)).get();
    expect(sourceVersion).toBeDefined();
    const now = Date.now();
    await database.db.insert(roleReleases).values({
      id: "release-source",
      accountId: "account-a",
      name: "原始发布",
      characterId: source.characterId,
      characterVersionId: sourceVersion!.id,
      characterSnapshotJson: sourceVersion!.dataJson,
      presetId: "preset",
      presetVersionId: "preset-version",
      regexProfileId: "regex",
      regexProfileVersionId: "regex-version",
      worldbookId: null,
      worldbookVersionId: null,
      promptMode: "strict",
      modelSlotsJson: "[]",
      defaultUserId: "user",
      defaultUserSnapshotJson: "{}",
      openingsJson: "[]",
      isActive: false,
      createdAt: now,
    });
    await database.db.insert(nativeCardPublications).values({
      id: "publication-source",
      accountId: "account-a",
      cardId: source.id,
      revision: 1,
      characterVersionId: sourceVersion!.id,
      releaseId: "release-source",
      resourceMappingsJson: "{}",
      note: "source fixture",
      createdAt: now,
    });

    const clone = await service.create("account-a", { name: "独立副本", sourceVersionId: sourceVersion!.id });
    expect(clone.id).not.toBe(source.id);
    expect(clone.characterId).not.toBe(source.characterId);
    expect(clone.name).toBe("独立副本");
    expect(clone.revision).toBe(1);
    expect(clone.packageId).not.toBe(source.packageId);
    expect(clone.files.map((file) => file.path)).toEqual(source.files.map((file) => file.path));
    expect(JSON.parse((await service.readFile("account-a", clone.id, "character.json")).content).name).toBe("独立副本");
    expect((await service.readFile("account-a", clone.id, "worldbooks/harbor/entries/110.json")).content)
      .toBe((await service.readFile("account-a", source.id, "worldbooks/harbor/entries/110.json")).content);

    const cloneCharacter = JSON.parse((await service.readFile("account-a", clone.id, "character.json")).content);
    cloneCharacter.description = "只属于副本的修改";
    await service.save("account-a", clone.id, {
      expectedRevision: 1,
      operations: [{ op: "write", path: "character.json", encoding: "utf8", content: JSON.stringify(cloneCharacter) }],
    });
    expect((await service.get("account-a", source.id)).revision).toBe(1);
    expect(JSON.parse((await service.readFile("account-a", source.id, "character.json")).content).description)
      .not.toBe("只属于副本的修改");
    await expect(service.create("account-b", { name: "越权副本", sourceVersionId: sourceVersion!.id }))
      .rejects.toMatchObject({ code: "NATIVE_CARD_VERSION_NOT_FOUND", statusCode: 404 });
  });

  it("rolls back entity rows and removes the committed directory when resource materialization fails", async () => {
    const failing = new NativeCardService(database.db, config, {
      commitImportedResources: () => { throw new Error("injected resource transaction failure"); },
    });
    await expect(failing.create("account-a", { name: "事务失败角色" })).rejects.toBeInstanceOf(NativeCardServiceError);
    expect(database.db.select().from(nativeCards).all()).toEqual([]);
    expect((await readdir(config.storageRoot)).filter((path) => path !== ".staging")).toEqual([]);
    expect(await readdir(join(config.storageRoot, ".staging"))).toEqual([]);
  });

  it("maps filesystem and SQLite commit failures to the storage error and leaves no card", async () => {
    const blocker = join(root, "not-a-directory");
    await writeFile(blocker, "file blocks directory creation");
    const brokenFs = new NativeCardService(database.db, { ...config, storageRoot: blocker });
    await expect(brokenFs.create("account-a", { name: "写盘失败角色" })).rejects.toMatchObject({
      code: "NATIVE_CARD_STORAGE_FAILURE", statusCode: 500,
      details: { stage: "file-commit", cardId: expect.any(String), revision: 1 },
    });
    expect(await service.list("account-a")).toEqual([]);

    database.db.$client.exec(`CREATE TRIGGER abort_native_card_insert BEFORE INSERT ON native_card BEGIN SELECT RAISE(ABORT, 'injected SQLite failure'); END;`);
    await expect(service.create("account-a", { name: "数据库失败角色" })).rejects.toMatchObject({
      code: "NATIVE_CARD_STORAGE_FAILURE", statusCode: 500,
      details: { stage: "database-commit", committed: false, cardId: expect.any(String), revision: 1 },
    });
    expect(await service.list("account-a")).toEqual([]);
    expect((await readdir(config.storageRoot)).filter((path) => path !== ".staging")).toEqual([]);
  });

  it("reports failed save and import commits as uncommitted and keeps them retryable", async () => {
    const card = await service.create("account-a", { name: "原有角色" });
    database.db.$client.exec(`CREATE TRIGGER abort_native_card_revision BEFORE INSERT ON native_card_revision WHEN NEW.revision = 2 BEGIN SELECT RAISE(ABORT, 'injected revision failure'); END;`);
    let saveError: unknown;
    try {
      await service.save("account-a", card.id, {
        expectedRevision: 1,
        operations: [{ op: "write", path: "character.json", encoding: "utf8", content: JSON.stringify({ name: "尚未提交" }) }],
      });
    } catch (error) { saveError = error; }
    expect(saveError).toMatchObject({
      code: "NATIVE_CARD_STORAGE_FAILURE",
      details: { stage: "database-commit", committed: false, cardId: card.id, revision: 2 },
    });
    expect(nativeCardWriteFailureDetailsSchema.safeParse((saveError as NativeCardServiceError).details).success).toBe(true);
    expect((await service.get("account-a", card.id)).revision).toBe(1);
    expect(database.db.$client.prepare("SELECT COUNT(*) AS count FROM native_card_revision WHERE card_id = ?").get(card.id)).toMatchObject({ count: 1 });
    database.db.$client.exec("DROP TRIGGER abort_native_card_revision;");

    const fixture = JSON.parse(await readFile(new URL("../../../../test/fixtures/native-card/harbor.files.json", import.meta.url), "utf8")) as Record<string, string>;
    const archive = writeNativeCardZip(Object.entries(fixture).map(([path, text]) => ({ path, content: Buffer.from(text) })));
    const checked = await service.inspectImport("account-a", archive, "retryable-harbor.zip");
    database.db.$client.exec(`CREATE TRIGGER abort_native_card_import BEFORE INSERT ON native_card BEGIN SELECT RAISE(ABORT, 'injected import failure'); END;`);
    await expect(service.confirmImport("account-a", checked.id)).rejects.toMatchObject({
      code: "NATIVE_CARD_STORAGE_FAILURE",
      details: { stage: "database-commit", committed: false, cardId: expect.any(String), revision: 1, importId: checked.id },
    });
    expect(await service.list("account-a")).toHaveLength(1);
    database.db.$client.exec("DROP TRIGGER abort_native_card_import;");
    const imported = await service.confirmImport("account-a", checked.id);
    expect(imported.name).toBe("雾港来信");
  });

  it("includes the actual revision when the guarded card update changes no rows", async () => {
    const card = await service.create("account-a", { name: "并发修改角色" });
    database.db.$client.exec(`CREATE TRIGGER ignore_native_card_update BEFORE UPDATE ON native_card BEGIN SELECT RAISE(IGNORE); END;`);
    let failure: unknown;
    try {
      await service.save("account-a", card.id, {
        expectedRevision: 1,
        operations: [{ op: "write", path: "character.json", encoding: "utf8", content: JSON.stringify({ name: "未提交" }) }],
      });
    } catch (error) { failure = error; }
    expect(failure).toMatchObject({
      code: "NATIVE_CARD_REVISION_CONFLICT",
      details: { expectedRevision: 1, actualRevision: 1 },
    });
    expect(nativeCardRevisionConflictDetailsSchema.safeParse((failure as NativeCardServiceError).details).success).toBe(true);
    expect((await service.get("account-a", card.id)).revision).toBe(1);
    expect(database.db.$client.prepare("SELECT COUNT(*) AS count FROM native_card_revision WHERE card_id = ?").get(card.id)).toMatchObject({ count: 1 });
    database.db.$client.exec("DROP TRIGGER ignore_native_card_update;");
  });

  it("allocates the first unused uid from saved entries and reserved editor ids regardless of entry filenames", async () => {
    const source = JSON.parse(await readFile(new URL("../../../../test/fixtures/native-card/harbor.files.json", import.meta.url), "utf8")) as Record<string, string>;
    const manifest = JSON.parse(source["manifest.json"]!) as { files: Array<{ path: string }> };
    const book = JSON.parse(source["worldbooks/harbor/book.json"]!) as { entryFiles: string[] };
    const renamedEntries = [
      [book.entryFiles[0]!, "worldbooks/harbor/entries/entry-alpha.json"],
      [book.entryFiles[1]!, "worldbooks/harbor/entries/notes-for-mira.json"],
    ] as const;
    for (const [previousPath, nextPath] of renamedEntries) {
      source[nextPath] = source[previousPath]!;
      delete source[previousPath];
      const manifestFile = manifest.files.find((file) => file.path === previousPath);
      expect(manifestFile).toBeDefined();
      manifestFile!.path = nextPath;
    }
    book.entryFiles = renamedEntries.map(([, path]) => path);
    source["manifest.json"] = JSON.stringify(manifest);
    source["worldbooks/harbor/book.json"] = JSON.stringify(book);
    const archive = writeNativeCardZip(Object.entries(source).map(([path, text]) => ({ path, content: Buffer.from(text) })));
    const check = await service.inspectImport("account-a", archive, "custom-entry-names.zip");
    expect(check.status).toBe("ready");
    const card = await service.confirmImport("account-a", check.id);

    await expect(service.allocateEntryUid("account-a", card.id, {
      expectedRevision: 1,
      bookId: "harbor",
      reservedUids: [1, 110],
    })).resolves.toEqual({ uid: 2 });
    expect((await service.get("account-a", card.id)).revision).toBe(1);
  });

  it("uses draft reserved ids only for a missing book and checks the saved revision", async () => {
    const card = await service.create("account-a", { name: "UID target" });
    await expect(service.allocateEntryUid("account-a", card.id, {
      expectedRevision: 1,
      bookId: "draft-book",
      reservedUids: [0, 2],
    })).rejects.toMatchObject({ code: "NATIVE_CARD_WORLDBOOK_NOT_FOUND", statusCode: 404 });

    await expect(service.allocateEntryUid("account-a", card.id, {
      expectedRevision: 1,
      bookId: "draft-book",
      reservedUids: [],
      draftBook: {
        name: "Draft book",
        entryFiles: [],
        scanDepth: 0,
        caseSensitive: false,
        matchWholeWords: false,
        recursive: false,
        maxRecursionSteps: 0,
      },
    })).resolves.toEqual({ uid: 1 });
    await expect(service.allocateEntryUid("account-a", card.id, {
      expectedRevision: 1,
      bookId: "draft-book",
      reservedUids: [1, 2],
      draftBook: {
        name: "Draft book",
        entryFiles: [],
        scanDepth: 0,
        caseSensitive: false,
        matchWholeWords: false,
        recursive: false,
        maxRecursionSteps: 0,
      },
    })).resolves.toEqual({ uid: 3 });

    const character = JSON.parse((await service.readFile("account-a", card.id, "character.json")).content);
    character.name = "UID target revision two";
    await service.save("account-a", card.id, {
      expectedRevision: 1,
      operations: [{ op: "write", path: "character.json", encoding: "utf8", content: JSON.stringify(character) }],
    });
    await expect(service.allocateEntryUid("account-a", card.id, {
      expectedRevision: 1,
      bookId: "draft-book",
      reservedUids: [],
      draftBook: {
        name: "Draft book",
        entryFiles: [],
        scanDepth: 0,
        caseSensitive: false,
        matchWholeWords: false,
        recursive: false,
        maxRecursionSteps: 0,
      },
    })).rejects.toMatchObject({
      code: "NATIVE_CARD_REVISION_CONFLICT",
      statusCode: 409,
      details: { expectedRevision: 1, actualRevision: 2 },
    });
  });

  it("marks queued and running builds failed after restart and retries the same fixed revision", async () => {
    const card = await service.create("account-a", { name: "打包状态角色" });
    const queued = await service.createBuild("account-a", card.id, { revision: 1 });
    const running = await service.createBuild("account-a", card.id, { revision: 1 });
    database.db.$client.prepare("UPDATE native_card_build SET status = 'running' WHERE id = ?").run(running.id);
    await service.recoverInterruptedBuilds();
    expect((await service.getBuild("account-a", queued.id)).status).toBe("failed");
    expect((await service.getBuild("account-a", running.id)).status).toBe("failed");
    const retry = await service.retryBuild("account-a", queued.id);
    expect(retry).toMatchObject({ status: "queued", revision: 1 });
    const completed = await service.executeBuild("account-a", queued.id);
    expect(completed).toMatchObject({ status: "succeeded", revision: 1, stage: "ready" });
    expect(Buffer.from(await service.readBuildZip("account-a", queued.id)).subarray(0, 2).toString()).toBe("PK");
  });

  it("marks a failed build unavailable and retries the same revision after storage recovers", async () => {
    const card = await service.create("account-a", { name: "打包写入失败角色" });
    const build = await service.createBuild("account-a", card.id, { revision: 1 });
    await writeFile(config.buildRoot, "blocks the build directory");
    const failed = await service.executeBuild("account-a", build.id);
    expect(failed).toMatchObject({ status: "failed", revision: 1, stage: "archiving" });
    await expect(service.readBuildZip("account-a", build.id)).rejects.toMatchObject({ code: "NATIVE_CARD_BUILD_NOT_READY" });
    await rm(config.buildRoot, { force: true });

    const retried = await service.retryBuild("account-a", build.id);
    expect(retried).toMatchObject({ status: "queued", revision: 1 });
    expect(await service.executeBuild("account-a", build.id)).toMatchObject({ status: "succeeded", revision: 1, stage: "ready" });
  });

  it("preserves saved-revision validation issues on build failure and retry", async () => {
    const source = JSON.parse(await readFile(new URL("../../../../test/fixtures/native-card/harbor.files.json", import.meta.url), "utf8")) as Record<string, string>;
    const archive = writeNativeCardZip(Object.entries(source).map(([path, text]) => ({ path, content: Buffer.from(text) })));
    const inspected = await service.inspectImport("account-a", archive, "build-validation-issues.zip");
    const card = await service.confirmImport("account-a", inspected.id);
    const character = JSON.parse(source["character.json"]!) as { name: string };
    character.name = "固定修订测试角色的新版本";
    await service.save("account-a", card.id, {
      expectedRevision: 1,
      operations: [{ op: "write", path: "character.json", encoding: "utf8", content: JSON.stringify(character) }],
    });
    expect((await service.get("account-a", card.id)).revision).toBe(2);

    const htmlPath = await service.resolveFilePath("account-a", card.id, 1, "frontend/index.html");
    const statePath = await service.resolveFilePath("account-a", card.id, 1, "state/initial/first.json");
    await writeFile(htmlPath, `<main>\n<img src="missing.png">`);
    await writeFile(statePath, JSON.stringify({ location: "夜间邮局", hour: 24, trust: 20 }));

    const build = await service.createBuild("account-a", card.id, { revision: 1 });
    const expectedIssues = [
      expect.objectContaining({
        code: "NATIVE_CARD_FRONTEND_MARKUP_INVALID",
        path: "frontend/index.html",
        line: 2,
        column: expect.any(Number),
        expected: expect.stringContaining("missing package file"),
      }),
      expect.objectContaining({
        code: "NATIVE_CARD_INITIAL_STATE_INVALID",
        path: "state/initial/first.json",
        pointer: "/hour",
        expected: expect.any(String),
      }),
    ];
    const failed = await service.executeBuild("account-a", build.id);
    expect(failed).toMatchObject({ status: "failed", revision: 1, stage: "validating", issues: expect.arrayContaining(expectedIssues) });
    expect(await service.getBuild("account-a", build.id)).toMatchObject({
      status: "failed",
      revision: 1,
      issues: expect.arrayContaining(expectedIssues),
    });

    expect(await service.retryBuild("account-a", build.id)).toMatchObject({ status: "queued", revision: 1 });
    expect(await service.executeBuild("account-a", build.id)).toMatchObject({
      status: "failed",
      revision: 1,
      issues: expect.arrayContaining(expectedIssues),
    });
    expect((await service.get("account-a", card.id)).revision).toBe(2);
  });

  it("compiles a draft 2020-12 state schema and reports opening values that violate it", async () => {
    const source = JSON.parse(await readFile(new URL("../../../../test/fixtures/native-card/harbor.files.json", import.meta.url), "utf8")) as Record<string, string>;
    expect((await service.inspectImport("account-a", writeNativeCardZip(Object.entries(source).map(([path, text]) => ({ path, content: Buffer.from(text) }))), "harbor.zip")).status).toBe("ready");
    const invalid = {
      ...source,
      "state/initial/first.json": JSON.stringify({ location: "邮局", hour: 25, trust: 20 }),
    };
    const result = await service.inspectImport("account-a", writeNativeCardZip(Object.entries(invalid).map(([path, text]) => ({ path, content: Buffer.from(text) }))), "invalid-state.zip");
    expect(result.status).toBe("invalid");
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: "NATIVE_CARD_INITIAL_STATE_INVALID", path: "state/initial/first.json", pointer: "/hour",
    }));
  });

  it("runs declared media type byte checks on package import", async () => {
    const source = JSON.parse(await readFile(new URL("../../../../test/fixtures/native-card/harbor.files.json", import.meta.url), "utf8")) as Record<string, string>;
    const invalid = { ...source, "assets/portrait.svg": "this is not an SVG document" };
    const result = await service.inspectImport("account-a", writeNativeCardZip(Object.entries(invalid).map(([path, text]) => ({ path, content: Buffer.from(text) }))), "wrong-media.zip");
    expect(result.status).toBe("invalid");
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: "NATIVE_CARD_MEDIA_TYPE_MISMATCH",
      path: "assets/portrait.svg",
    }));
  });

  it("returns the business summary from resolved package references", async () => {
    const source = JSON.parse(await readFile(new URL("../../../../test/fixtures/native-card/harbor.files.json", import.meta.url), "utf8")) as Record<string, string>;
    const complete = await service.inspectImport(
      "account-a",
      writeNativeCardZip(Object.entries(source).map(([path, text]) => ({ path, content: Buffer.from(text) }))),
      "harbor.zip",
    );
    expect(complete.summary).toEqual({
      formatVersion: "1.0.0",
      worldbookCount: 2,
      openingCount: 2,
      initialStateCount: 2,
      stateUpdate: { rules: true, schema: true, validators: true, tools: true },
      promptController: true,
      frontend: { page: true, script: true, style: true, media: true },
      regexProfileCount: 2,
    });

    const textOnlyFiles = [
      { path: "manifest.json", content: Buffer.from(JSON.stringify({
        format: "tavern_headless_role_package", formatVersion: "1.0.0", packageId: "text-only",
        character: "character.json", openings: "openings.json", files: [
          { path: "character.json", mediaType: "application/json", purpose: "data" },
          { path: "openings.json", mediaType: "application/json", purpose: "data" },
          { path: "openings/first.txt", mediaType: "text/plain", purpose: "data" },
          { path: "assets/unreferenced.svg", mediaType: "image/svg+xml", purpose: "media" },
        ],
      })) },
      { path: "character.json", content: Buffer.from(JSON.stringify({ name: "纯对话角色" })) },
      { path: "openings.json", content: Buffer.from(JSON.stringify({ defaultOpeningIds: { individual: "first" }, items: [
        { id: "first", title: "开场", summary: "纯对话", kind: "story", audience: "individual", textFile: "openings/first.txt" },
      ] })) },
      { path: "openings/first.txt", content: Buffer.from("从一段对话开始。") },
      { path: "assets/unreferenced.svg", content: Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1\" height=\"1\"><circle cx=\"0\" cy=\"0\" r=\"1\"/></svg>") },
    ];
    const textOnly = await service.inspectImport("account-a", writeNativeCardZip(textOnlyFiles), "text-only.zip");
    expect(textOnly.status).toBe("ready");
    expect(textOnly.summary).toEqual({
      formatVersion: "1.0.0", worldbookCount: 0, openingCount: 1, initialStateCount: 0,
      stateUpdate: { rules: false, schema: false, validators: false, tools: false },
      promptController: false,
      frontend: { page: false, script: false, style: false, media: false },
      regexProfileCount: 0,
    });

    const moduleReferencePackage = structuredClone(source);
    const profile = JSON.parse(moduleReferencePackage["agents/state-update/profile.json"]!) as Record<string, unknown>;
    delete profile.deriveScript;
    delete profile.validateScript;
    profile.moduleFiles = ["backend/validators/validate.js", "backend/variable-tools/derive.js"];
    moduleReferencePackage["agents/state-update/profile.json"] = JSON.stringify(profile);
    const moduleReferenced = await service.inspectImport(
      "account-a",
      writeNativeCardZip(Object.entries(moduleReferencePackage).map(([path, text]) => ({ path, content: Buffer.from(text) }))),
      "module-references.zip",
    );
    expect(moduleReferenced.status).toBe("ready");
    expect(moduleReferenced.summary?.stateUpdate).toEqual({ rules: true, schema: true, validators: true, tools: true });

    const unsupportedVersion = structuredClone(textOnlyFiles);
    const unsupportedManifest = JSON.parse(Buffer.from(unsupportedVersion[0]!.content).toString("utf8")) as { formatVersion: string };
    unsupportedManifest.formatVersion = "9.0.0";
    unsupportedVersion[0] = { ...unsupportedVersion[0]!, content: Buffer.from(JSON.stringify(unsupportedManifest)) };
    const invalid = await service.inspectImport("account-a", writeNativeCardZip(unsupportedVersion), "invalid.zip");
    expect(invalid.status).toBe("invalid");
    expect(invalid.summary).toBeNull();
  });

  it("makes confirmation idempotent for the same account and import through service restart", async () => {
    const source = JSON.parse(await readFile(new URL("../../../../test/fixtures/native-card/harbor.files.json", import.meta.url), "utf8")) as Record<string, string>;
    const archive = writeNativeCardZip(Object.entries(source).map(([path, text]) => ({ path, content: Buffer.from(text) })));
    const inspected = await service.inspectImport("account-a", archive, "repeatable.zip");
    const imported = await service.confirmImport("account-a", inspected.id);

    const persisted = database.db.$client.prepare("SELECT confirmed_card_id FROM native_card_import WHERE id = ?").get(inspected.id);
    expect(persisted).toEqual({ confirmed_card_id: imported.id });
    await expect(service.confirmImport("account-a", inspected.id)).resolves.toMatchObject({ id: imported.id });
    expect(await service.list("account-a")).toHaveLength(1);

    const restartedService = new NativeCardService(database.db, config);
    await expect(restartedService.confirmImport("account-a", inspected.id)).resolves.toMatchObject({
      id: imported.id, characterId: imported.characterId, revision: 1,
    });
    expect(await restartedService.list("account-a")).toHaveLength(1);
    await expect(restartedService.confirmImport("account-b", inspected.id)).rejects.toMatchObject({
      code: "NATIVE_CARD_IMPORT_NOT_FOUND", statusCode: 404,
    });
  });

  it("reads back the committed card when the response read fails after commit", async () => {
    const dbFile = join(root, "import-retry.sqlite");
    const durable = createTestDatabase(dbFile);
    const now = Date.now();
    await durable.db.insert(accounts).values({ id: "account-a", name: "A", role: "user", status: "active", isDefault: false, createdAt: now, updatedAt: now });
    const source = JSON.parse(await readFile(new URL("../../../../test/fixtures/native-card/harbor.files.json", import.meta.url), "utf8")) as Record<string, string>;
    const archive = writeNativeCardZip(Object.entries(source).map(([path, text]) => ({ path, content: Buffer.from(text) })));
    let durableClosed = false;
    let reopened: DatabaseConnection | undefined;
    try {
      const durableService = new NativeCardService(durable.db, config);
      const inspected = await durableService.inspectImport("account-a", archive, "lost-response.zip");
      expect(inspected.status, JSON.stringify(inspected)).toBe("ready");
      const getSpy = vi.spyOn(durableService, "get").mockRejectedValueOnce(new NativeCardServiceError("NATIVE_CARD_STORAGE_FAILURE", 500));
      await expect(durableService.confirmImport("account-a", inspected.id)).rejects.toMatchObject({ code: "NATIVE_CARD_STORAGE_FAILURE" });
      getSpy.mockRestore();
      durable.close();
      durableClosed = true;

      reopened = createTestDatabase(dbFile);
      const restartedService = new NativeCardService(reopened.db, config);
      const retry = await restartedService.confirmImport("account-a", inspected.id);
      expect(retry).toMatchObject({ id: expect.any(String), name: "雾港来信", revision: 1 });
      expect(await restartedService.list("account-a")).toHaveLength(1);
    } finally {
      if (!durableClosed) durable.close();
      reopened?.close();
    }
  });

  it("returns the same card to concurrent confirmation requests", async () => {
    const source = JSON.parse(await readFile(new URL("../../../../test/fixtures/native-card/harbor.files.json", import.meta.url), "utf8")) as Record<string, string>;
    const archive = writeNativeCardZip(Object.entries(source).map(([path, text]) => ({ path, content: Buffer.from(text) })));
    const inspected = await service.inspectImport("account-a", archive, "concurrent.zip");

    const confirmed = await Promise.all([
      service.confirmImport("account-a", inspected.id),
      service.confirmImport("account-a", inspected.id),
    ]);
    expect(confirmed[0]!.id).toBe(confirmed[1]!.id);
    expect(await service.list("account-a")).toHaveLength(1);
    expect((await service.list("account-a"))[0]!.id).toBe(confirmed[0]!.id);
  });

  it("returns the confirmed card if another request removes staging before a concurrent read", async () => {
    const source = JSON.parse(await readFile(new URL("../../../../test/fixtures/native-card/harbor.files.json", import.meta.url), "utf8")) as Record<string, string>;
    const archive = writeNativeCardZip(Object.entries(source).map(([path, text]) => ({ path, content: Buffer.from(text) })));
    const inspected = await service.inspectImport("account-a", archive, "staging-race.zip");
    const secondService = new NativeCardService(database.db, config);
    const store = (secondService as unknown as { store: {
      read: (area: "cards" | "imports" | "builds", storageKey: string, filePath: string) => Promise<Buffer>;
    } }).store;
    const originalRead = store.read.bind(store);
    let startSecondRead!: () => void;
    let releaseSecondRead!: () => void;
    const secondReadStarted = new Promise<void>((resolve) => { startSecondRead = resolve; });
    const readGate = new Promise<void>((resolve) => { releaseSecondRead = resolve; });
    const readSpy = vi.spyOn(store, "read").mockImplementation(async (area, storageKey, filePath) => {
      if (area === "imports" && filePath === "manifest.json") {
        startSecondRead();
        await readGate;
      }
      return originalRead(area, storageKey, filePath);
    });

    try {
      const secondRequest = secondService.confirmImport("account-a", inspected.id);
      await secondReadStarted;
      const firstResult = await service.confirmImport("account-a", inspected.id);
      releaseSecondRead();
      const secondResult = await secondRequest;
      expect(secondResult.id).toBe(firstResult.id);
      expect(await service.list("account-a")).toHaveLength(1);
    } finally {
      releaseSecondRead();
      readSpy.mockRestore();
    }
  });

  it("reports a deleted confirmed card and an expired confirmation task explicitly", async () => {
    const source = JSON.parse(await readFile(new URL("../../../../test/fixtures/native-card/harbor.files.json", import.meta.url), "utf8")) as Record<string, string>;
    const archive = writeNativeCardZip(Object.entries(source).map(([path, text]) => ({ path, content: Buffer.from(text) })));
    const inspected = await service.inspectImport("account-a", archive, "deleted-card.zip");
    const imported = await service.confirmImport("account-a", inspected.id);
    database.db.$client.pragma("foreign_keys = OFF");
    database.db.delete(nativeCards).where(eq(nativeCards.id, imported.id)).run();
    database.db.$client.pragma("foreign_keys = ON");
    await expect(service.confirmImport("account-a", inspected.id)).rejects.toMatchObject({
      code: "NATIVE_CARD_NOT_FOUND", statusCode: 404,
    });

    const expiring = await service.inspectImport("account-a", archive, "expired-confirmation.zip");
    const second = await service.confirmImport("account-a", expiring.id);
    database.db.$client.prepare("UPDATE native_card_import SET expires_at = ? WHERE id = ?").run(Date.now() - 1, expiring.id);
    await expect(service.confirmImport("account-a", expiring.id)).rejects.toMatchObject({
      code: "NATIVE_CARD_IMPORT_NOT_FOUND", statusCode: 404,
    });
    expect((await service.get("account-a", second.id)).id).toBe(second.id);
  });

  it("returns backend module syntax source positions from the service import response", async () => {
    const source = JSON.parse(await readFile(new URL("../../../../test/fixtures/native-card/harbor.files.json", import.meta.url), "utf8")) as Record<string, string>;
    const invalid = {
      ...source,
      "backend/variable-tools/derive.js": "export function derive(context) {\n  return context.candidate + ;\n}",
    };
    const result = await service.inspectImport("account-a", writeNativeCardZip(Object.entries(invalid).map(([path, text]) => ({ path, content: Buffer.from(text) }))), "syntax-error.zip");
    expect(result.status).toBe("invalid");
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: "NATIVE_CARD_MODULE_INVALID",
      path: "backend/variable-tools/derive.js",
      line: 2,
      column: expect.any(Number),
    }));
  });

  it("attaches the final save operation index to HTML or CSS issues on the written file", async () => {
    const source = JSON.parse(await readFile(new URL("../../../../test/fixtures/native-card/harbor.files.json", import.meta.url), "utf8")) as Record<string, string>;
    const archive = writeNativeCardZip(Object.entries(source).map(([path, text]) => ({ path, content: Buffer.from(text) })));
    const inspected = await service.inspectImport("account-a", archive, "save-parser-operation.zip");
    const card = await service.confirmImport("account-a", inspected.id);
    const html = "<main>\n<img src=\"missing.png>";

    await expect(service.save("account-a", card.id, {
      expectedRevision: 1,
      operations: [
        { op: "write", path: "frontend/index.html", encoding: "utf8", content: "<img src=\"first-missing.png\">" },
        { op: "write", path: "frontend/index.html", encoding: "utf8", content: html },
      ],
    })).rejects.toMatchObject({
      code: "NATIVE_CARD_PACKAGE_INVALID",
      details: {
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: "NATIVE_CARD_FRONTEND_MARKUP_INVALID",
            path: "frontend/index.html",
            operationIndex: 1,
          }),
        ]),
      },
    });
  });

  it("reports the write operation and leaves the revision unchanged when base64 content is invalid", async () => {
    const card = await service.create("account-a", { name: "编码失败角色" });
    const original = await service.readFile("account-a", card.id, "character.json", 1);
    const error = await service.save("account-a", card.id, {
      expectedRevision: 1,
      operations: [
        { op: "write", path: "character.json", encoding: "utf8", content: JSON.stringify({ name: "部分操作未提交" }) },
        { op: "write", path: "openings.json", encoding: "base64", content: "not base64!" },
      ],
    }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(NativeCardServiceError);
    expect(error).toMatchObject({
      code: "NATIVE_CARD_OPERATION_INVALID",
      statusCode: 400,
      details: { operationIndex: 1, path: "openings.json" },
    });
    expect((await service.get("account-a", card.id)).revision).toBe(1);
    await expect(service.readFile("account-a", card.id, "character.json", 1)).resolves.toEqual(original);
  });

  it("leaves operationIndex unset when a save changes a target but the error belongs to an unchanged reference source", async () => {
    const source = JSON.parse(await readFile(new URL("../../../../test/fixtures/native-card/harbor.files.json", import.meta.url), "utf8")) as Record<string, string>;
    const archive = writeNativeCardZip(Object.entries(source).map(([path, text]) => ({ path, content: Buffer.from(text) })));
    const inspected = await service.inspectImport("account-a", archive, "save-parser-source.zip");
    const card = await service.confirmImport("account-a", inspected.id);
    const manifest = JSON.parse(source["manifest.json"]!) as { files: Array<{ path: string }> };
    manifest.files = manifest.files.filter((file) => file.path !== "assets/portrait.svg");
    const frontendManifest = JSON.parse(source["frontend/manifest.json"]!) as { assets: Record<string, unknown> };
    frontendManifest.assets = {};

    const error = await service.save("account-a", card.id, {
      expectedRevision: 1,
      operations: [
        { op: "write", path: "manifest.json", encoding: "utf8", content: JSON.stringify(manifest) },
        { op: "write", path: "frontend/manifest.json", encoding: "utf8", content: JSON.stringify(frontendManifest) },
        { op: "delete", path: "assets/portrait.svg" },
      ],
    }).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(NativeCardServiceError);
    expect(error).toMatchObject({
      code: "NATIVE_CARD_PACKAGE_INVALID",
    });
    const issues = (error as NativeCardServiceError).details?.issues as Array<Record<string, unknown>>;
    const referenceIssue = issues.find((issue) => issue.code === "NATIVE_CARD_FRONTEND_MARKUP_INVALID" && issue.path === "frontend/index.html");
    expect(referenceIssue).toBeDefined();
    expect(referenceIssue?.expected).toEqual(expect.stringContaining("missing package file"));
    expect(referenceIssue).not.toHaveProperty("operationIndex");
  });

  it("does not expose records or resource bindings if the process stops inside the commit transaction", async () => {
    const dbFile = join(root, "interrupted.sqlite");
    const persistent = createTestDatabase(dbFile);
    const now = Date.now();
    await persistent.db.insert(accounts).values({ id: "crash-account", name: "Crash", role: "user", status: "active", isDefault: false, createdAt: now, updatedAt: now });
    const existingService = new NativeCardService(persistent.db, config, {
      commitImportedResources(tx, _snapshot, identity) {
        tx.insert(nativeCardResourceBindings).values({ cardId: identity.cardId, revision: identity.revision, kind: "worldbook", localId: "kept", localVersionId: "kept-version", packageResourceId: "kept-resource", ordinal: 0, enabled: true }).run();
      },
    });
    const existing = await existingService.create("crash-account", { name: "中断前已存在" });
    persistent.close();

    const childCode = `
      import { createTestDatabase } from "./test/helpers/create-test-db.ts";
      import { NativeCardService } from "./src/services/native-card/native-card-service.ts";
      import { nativeCardResourceBindings } from "./src/db/native-card-runtime-schema.ts";
      const database = createTestDatabase(process.argv[1]);
      const root = process.argv[2];
      const config = { storageRoot: root + "/cards", importStagingRoot: root + "/imports", buildRoot: root + "/builds", maxUploadBytes: 1000000, maxExpandedBytes: 2000000, maxFileCount: 128, maxFileBytes: 512000, maxPathBytes: 512, importTtlMs: 60000, buildTtlMs: 60000 };
      const service = new NativeCardService(database.db, config, { commitImportedResources(tx, snapshot, identity) {
        tx.insert(nativeCardResourceBindings).values({ cardId: identity.cardId, revision: identity.revision, kind: "worldbook", localId: "uncommitted", localVersionId: "uncommitted-version", packageResourceId: "test-resource", ordinal: 0, enabled: true }).run();
        process.kill(process.pid, "SIGKILL");
      }});
      await service.create("crash-account", { name: "进程中断角色" });
    `;
    let childError = "";
    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit, reject) => {
      const child = spawn(process.execPath, ["--conditions=development", "--import", "tsx/esm", "--input-type=module", "-e", childCode, dbFile, root], { cwd: new URL("../../../../", import.meta.url), stdio: "pipe" });
      child.stderr?.on("data", chunk => { childError += String(chunk); });
      child.once("error", reject);
      child.once("close", (code, signal) => resolveExit({ code, signal }));
    });
    expect(exit.signal, childError).toBe("SIGKILL");

    const reopened = createTestDatabase(dbFile);
    try {
      const restarted = new NativeCardService(reopened.db, config);
      expect(await restarted.list("crash-account")).toMatchObject([{ id: existing.id, name: "中断前已存在", revision: 1 }]);
      expect((await restarted.readFile("crash-account", existing.id, "character.json")).content).toContain("中断前已存在");
      expect(reopened.db.select().from(nativeCards).all()).toHaveLength(1);
      expect(reopened.db.select().from(characters).where(eq(characters.accountId, "crash-account")).all()).toHaveLength(1);
      expect(reopened.db.select().from(nativeCardVersionBindings).all()).toHaveLength(1);
      expect(reopened.db.select().from(nativeCardResourceBindings).all()).toMatchObject([
        { cardId: existing.id, packageResourceId: "kept-resource" },
      ]);
    } finally {
      reopened.close();
    }
  }, 20_000);
});
