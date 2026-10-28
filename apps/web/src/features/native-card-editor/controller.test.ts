import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { NativeCardsResource } from "@tavern/sdk";
import { createNativeCardEditorController } from "./controller.js";

const checkedSummary = { formatVersion: "1.0.0", worldbookCount: 0, openingCount: 0, initialStateCount: 0, stateUpdate: { rules: false, schema: false, validators: false, tools: false }, promptController: false, frontend: { page: false, script: false, style: false, media: false }, regexProfileCount: 0 };

const importedCard = {
  id: "card-1",
  characterId: "character-1",
  packageId: "harbor-letter",
  name: "雾港来信",
  revision: 1,
  createdAt: 10,
  updatedAt: 10,
  files: [
    {
      path: "character.json",
      mediaType: "application/json",
      purpose: "data",
      byteSize: 220,
    },
  ],
  versions: [],
} as const;
const harborFixture = JSON.parse(
  readFileSync(new URL("../../../../api/test/fixtures/native-card/harbor.files.json", import.meta.url), "utf8"),
) as Record<string, string>;

describe("native card editor import boundary", () => {
  it("discards an old check after resetting the import and keeps the next check", async () => {
    let finishOld: ((value: unknown) => void) | undefined;
    const latest = { id: "latest", status: "ready", summary: null };
    const sdk = { checkImport: vi.fn().mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; })).mockResolvedValueOnce(latest) };
    const editor = createNativeCardEditorController(sdk as unknown as NativeCardsResource);
    const old = editor.checkImport(new Blob(["old"]), "old.zip");
    editor.resetImport();
    await editor.checkImport(new Blob(["new"]), "new.zip");
    finishOld?.({ id: "old", status: "ready" });
    expect(await old).toBe(false);
    expect(editor.importPreview.value).toEqual(latest);
    expect(editor.checkingImport.value).toBe(false);
  });

  it("discards a canceled confirmation without replacing the current card or failure", async () => {
    let finish: ((value: unknown) => void) | undefined;
    const sdk = { confirmImport: vi.fn(() => new Promise((resolve) => { finish = resolve; })) };
    const editor = createNativeCardEditorController(sdk as unknown as NativeCardsResource);
    editor.importPreview.value = { id: "checked", status: "ready" } as never;
    const confirming = editor.confirmImport();
    editor.resetImport();
    finish?.(importedCard);
    expect(await confirming).toBeUndefined();
    expect(editor.selectedCard.value).toBeNull();
    expect(editor.confirmingImport.value).toBe(false);
  });

  it("discards an error from a canceled ZIP check", async () => {
    let fail: ((reason: unknown) => void) | undefined;
    const sdk = { checkImport: vi.fn(() => new Promise((_, reject) => { fail = reject; })) };
    const editor = createNativeCardEditorController(sdk as unknown as NativeCardsResource);
    const checking = editor.checkImport(new Blob(["old"]), "old.zip");
    editor.resetImport();
    fail?.(new Error("old request failed"));
    expect(await checking).toBe(false);
    expect(editor.failure.value).toBeUndefined();
  });

  it("shows a checked ZIP for review and opens it only after confirmation", async () => {
    const sdk = {
      checkImport: vi.fn().mockResolvedValue({
        id: "import-1",
        fileName: "harbor.zip",
        packageId: "harbor-letter",
        name: "雾港来信",
        summary: checkedSummary,
        files: importedCard.files,
        issues: [],
        status: "ready",
      }),
      confirmImport: vi.fn().mockResolvedValue(importedCard),
    };
    const editor = createNativeCardEditorController(sdk as unknown as NativeCardsResource);
    const archive = new Blob(["zip bytes"]);

    await editor.checkImport(archive, "harbor.zip");

    expect(editor.importPreview.value?.status).toBe("ready");
    expect(editor.selectedCard.value).toBeNull();
    expect(sdk.confirmImport).not.toHaveBeenCalled();

    await editor.confirmImport();

    expect(sdk.confirmImport).toHaveBeenCalledWith({ importId: "import-1" });
    expect(editor.selectedCard.value?.id).toBe("card-1");
    expect(editor.screen.value).toBe("editor");
  });

  it("uses the official build download artifact and preserves its server filename", async () => {
    const artifact = { blob: new Blob(["zip bytes"]), fileName: "harbor-revision-4.zip" };
    const sdk = {
      get: vi.fn().mockResolvedValue(importedCard),
      createBuild: vi.fn().mockResolvedValue({
        id: "build-1", cardId: importedCard.id, revision: 1, status: "succeeded", stage: "ready",
        createdAt: 10, updatedAt: 11, issues: [],
      }),
      downloadArtifact: vi.fn().mockResolvedValue(artifact),
    };
    const editor = createNativeCardEditorController(sdk as unknown as NativeCardsResource);
    await editor.openCard(importedCard.id);
    await editor.createBuild({ revision: 1 });

    const result = await editor.downloadBuild();

    expect(sdk.downloadArtifact).toHaveBeenCalledWith({ buildId: "build-1" });
    expect(result).toEqual(artifact);
  });

  it("keeps an invalid ZIP in review and never sends the import confirmation", async () => {
    const sdk = {
      checkImport: vi.fn().mockResolvedValue({
        id: "import-2",
        fileName: "damaged.zip",
        packageId: "unknown",
        name: "无法读取",
        summary: null,
        files: [],
        issues: [
          {
            code: "NATIVE_CARD_PACKAGE_INVALID",
            path: "manifest.json",
            message: "包清单无法读取。",
            action: "请修复 ZIP 中的包清单后重新选择文件。",
          },
        ],
        status: "invalid",
      }),
      confirmImport: vi.fn(),
    };
    const editor = createNativeCardEditorController(sdk as unknown as NativeCardsResource);

    await editor.checkImport(new Blob(["invalid"]), "damaged.zip");
    await editor.confirmImport();

    expect(editor.importPreview.value?.status).toBe("invalid");
    expect(editor.selectedCard.value).toBeNull();
    expect(sdk.confirmImport).not.toHaveBeenCalled();
  });

  it("prevents a second confirmation while the first import is pending", async () => {
    let finishImport: ((card: typeof importedCard) => void) | undefined;
    const sdk = {
      checkImport: vi.fn().mockResolvedValue({
        id: "import-3",
        fileName: "harbor.zip",
        packageId: "harbor-letter",
        name: "雾港来信",
        summary: checkedSummary,
        files: importedCard.files,
        issues: [],
        status: "ready",
      }),
      confirmImport: vi.fn(
        () =>
          new Promise<typeof importedCard>((resolve) => {
            finishImport = resolve;
          }),
      ),
    };
    const editor = createNativeCardEditorController(sdk as unknown as NativeCardsResource);
    await editor.checkImport(new Blob(["zip bytes"]), "harbor.zip");

    const first = editor.confirmImport();
    const second = editor.confirmImport();
    expect(sdk.confirmImport).toHaveBeenCalledTimes(1);
    finishImport?.(importedCard);
    await Promise.all([first, second]);

    expect(editor.selectedCard.value?.id).toBe("card-1");
  });
});

describe("native card editor revision boundary", () => {
  it("updates a replaced asset's declared media type in the working copy", async () => {
    const card = {
      ...importedCard,
      files: [
        ...importedCard.files,
        { path: "assets/portrait.svg", mediaType: "image/svg+xml", purpose: "media", byteSize: 16 },
      ],
    };
    const sdk = {
      get: vi.fn().mockResolvedValue(card),
      readFile: vi.fn().mockResolvedValue({
        path: "assets/portrait.svg",
        mediaType: "image/svg+xml",
        encoding: "base64",
        content: "PHN2Zy8+",
      }),
    };
    const editor = createNativeCardEditorController(sdk as unknown as NativeCardsResource);

    await editor.openCard(card.id);
    await editor.openFile("assets/portrait.svg");
    editor.writeFile("assets/portrait.svg", "iVBORw0KGgo=", "base64", "image/png");

    expect(editor.fileContents.value["assets/portrait.svg"]).toMatchObject({
      encoding: "base64",
      mediaType: "image/png",
    });
    expect(editor.isPathDirty("assets/portrait.svg")).toBe(true);
  });

  it("does not mark uncached package files as changed and clears new files after save", async () => {
    const card = {
      ...importedCard,
      files: [
        ...importedCard.files,
        { path: "worldbooks/harbor/book.json", mediaType: "application/json", purpose: "data", byteSize: 2 },
      ],
    };
    const sdk = {
      get: vi.fn().mockResolvedValue(card),
      readFile: vi.fn().mockResolvedValue({
        path: "character.json",
        mediaType: "application/json",
        encoding: "utf8",
        content: '{"name":"雾港来信"}',
      }),
      save: vi.fn().mockResolvedValue({ ...card, revision: 2 }),
    };
    const editor = createNativeCardEditorController(sdk as unknown as NativeCardsResource);

    await editor.openCard(card.id);
    await editor.openFile("character.json");
    expect(editor.dirty.value).toBe(false);
    expect(editor.isPathDirty("worldbooks/harbor/book.json")).toBe(false);

    editor.addFile({ path: "data/note.json", mediaType: "application/json", encoding: "utf8", content: "{}" });
    expect(editor.dirty.value).toBe(true);
    expect(editor.isPathDirty("data/note.json")).toBe(true);
    await editor.save();

    expect(editor.dirty.value).toBe(false);
    expect(editor.isPathDirty("data/note.json")).toBe(false);
  });

  it("keeps every real Harbor fixture file clean after saving the edited character file", async () => {
    const files = Object.keys(harborFixture).map((path) => ({
      path,
      mediaType: path.endsWith(".json") ? "application/json" : "text/plain",
      purpose: "data",
      byteSize: 0,
    }));
    const card = { ...importedCard, files };
    const sdk = {
      get: vi.fn().mockResolvedValue(card),
      readFile: vi.fn().mockImplementation(({ path }: { path: string }) => Promise.resolve({
        path,
        mediaType: files.find((file) => file.path === path)?.mediaType ?? "text/plain",
        encoding: "utf8",
        content: harborFixture[path] ?? "",
      })),
      save: vi.fn().mockResolvedValue({ ...card, revision: 2 }),
    };
    const editor = createNativeCardEditorController(sdk as unknown as NativeCardsResource);

    await editor.openCard(card.id);
    await editor.openFile("character.json");
    editor.writeFile("character.json", `${harborFixture["character.json"]}\n`);
    await editor.save();

    expect(sdk.save).toHaveBeenCalledTimes(1);
    expect(editor.selectedCard.value?.revision).toBe(2);
    for (const file of files) expect(editor.isPathDirty(file.path)).toBe(false);
    expect(editor.dirty.value).toBe(false);
  });

  it("saves changed files as a batch and advances the revision only on success", async () => {
    const updatedCard = { ...importedCard, revision: 2, updatedAt: 20 };
    const sdk = {
      get: vi.fn().mockResolvedValue(importedCard),
      readFile: vi.fn().mockResolvedValue({
        path: "character.json",
        mediaType: "application/json",
        encoding: "utf8",
        content: '{"name":"雾港来信"}',
      }),
      save: vi.fn().mockResolvedValue(updatedCard),
    };
    const editor = createNativeCardEditorController(sdk as unknown as NativeCardsResource);

    await editor.openCard("card-1");
    await editor.openFile("character.json");
    editor.writeFile("character.json", '{"name":"雾港来信：夜航"}');
    expect(editor.dirty.value).toBe(true);

    await editor.save();

    expect(sdk.save).toHaveBeenCalledWith({
      cardId: "card-1",
      expectedRevision: 1,
      operations: [
        {
          op: "write",
          path: "character.json",
          encoding: "utf8",
          content: '{"name":"雾港来信：夜航"}',
        },
      ],
    });
    expect(editor.selectedCard.value?.revision).toBe(2);
    expect(editor.dirty.value).toBe(false);
  });

  it("preserves local edits and reports the current revision after a save conflict", async () => {
    const sdk = {
      get: vi.fn().mockResolvedValue(importedCard),
      readFile: vi.fn().mockResolvedValue({
        path: "character.json",
        mediaType: "application/json",
        encoding: "utf8",
        content: '{"name":"雾港来信"}',
      }),
      save: vi.fn().mockRejectedValue(
        Object.assign(new Error("Revision conflict"), {
          code: "NATIVE_CARD_REVISION_CONFLICT",
          details: { expectedRevision: 1, actualRevision: 2 },
        }),
      ),
    };
    const editor = createNativeCardEditorController(sdk as unknown as NativeCardsResource);

    await editor.openCard("card-1");
    await editor.openFile("character.json");
    editor.writeFile("character.json", '{"name":"本地修改"}');

    await editor.save();

    expect(editor.dirty.value).toBe(true);
    expect(editor.fileContents.value["character.json"]?.content).toBe(
      '{"name":"本地修改"}',
    );
    expect(editor.conflict.value?.currentRevision).toBe(2);
    expect(editor.selectedCard.value?.revision).toBe(1);
  });

  it("refreshes clean cached files when accepting a newer server revision and preserves local edits", async () => {
    const cardWithFiles = {
      ...importedCard,
      files: [
        ...importedCard.files,
        { path: "data/notes.json", mediaType: "application/json", purpose: "data", byteSize: 2 },
      ],
    };
    const latestCard = { ...cardWithFiles, revision: 2, updatedAt: 20 };
    const sdk = {
      get: vi.fn().mockResolvedValueOnce(cardWithFiles).mockResolvedValueOnce(latestCard),
      readFile: vi.fn().mockImplementation(({ path, revision }: { path: string; revision?: number }) => Promise.resolve({
        path,
        mediaType: "application/json",
        encoding: "utf8",
        content: revision === 2
          ? path === "data/notes.json" ? '{"note":"服务器新值"}' : '{"name":"服务器新值"}'
          : path === "data/notes.json" ? '{"note":"旧缓存"}' : '{"name":"旧名称"}',
      })),
      save: vi.fn().mockRejectedValue(Object.assign(new Error("Revision conflict"), {
        code: "NATIVE_CARD_REVISION_CONFLICT", details: { expectedRevision: 1, actualRevision: 2 },
      })),
    };
    const editor = createNativeCardEditorController(sdk as unknown as NativeCardsResource);
    await editor.openCard(cardWithFiles.id);
    await editor.openFile("character.json");
    await editor.openFile("data/notes.json");
    editor.writeFile("character.json", '{"name":"本地未保存名称"}');
    await editor.save();

    await editor.acceptServerRevision();
    const notes = await editor.openFile("data/notes.json");

    expect(notes?.content).toBe('{"note":"服务器新值"}');
    expect(editor.originalContents.value["data/notes.json"]?.content).toBe('{"note":"服务器新值"}');
    expect(editor.fileContents.value["character.json"]?.content).toBe('{"name":"本地未保存名称"}');
    expect(editor.isPathDirty("character.json")).toBe(true);
    expect(sdk.readFile).toHaveBeenCalledWith({ cardId: cardWithFiles.id, path: "data/notes.json", revision: 2 });
  });

  it("saves moves, deletes, and binary uploads as package operations", async () => {
    const card = {
      ...importedCard,
      files: [
        ...importedCard.files,
        { path: "assets/old.png", mediaType: "image/png", purpose: "media", byteSize: 3 },
        { path: "data/obsolete.json", mediaType: "application/json", purpose: "data", byteSize: 2 },
      ],
    };
    const sdk = {
      get: vi.fn().mockResolvedValue(card),
      readFile: vi.fn().mockImplementation(({ path }: { path: string }) => Promise.resolve({
        path,
        mediaType: path.endsWith(".png") ? "image/png" : "application/json",
        encoding: path.endsWith(".png") ? "base64" : "utf8",
        content: path.endsWith(".png") ? "AQID" : "{}",
      })),
      save: vi.fn().mockResolvedValue({ ...card, revision: 2 }),
    };
    const editor = createNativeCardEditorController(sdk as unknown as NativeCardsResource);
    await editor.openCard(card.id);
    await editor.openFile("assets/old.png");
    editor.moveFile("assets/old.png", "assets/new.png");
    expect(editor.fileContents.value["assets/new.png"]).toMatchObject({ path: "assets/new.png", content: "AQID" });
    expect(editor.fileContents.value["assets/old.png"]).toBeUndefined();
    editor.writeFile("assets/new.png", "BAUG", "base64");
    editor.deleteFile("data/obsolete.json");

    await editor.save();

    expect(sdk.save).toHaveBeenCalledWith({
      cardId: "card-1",
      expectedRevision: 1,
      operations: [
        { op: "move", path: "assets/old.png", to: "assets/new.png" },
        { op: "delete", path: "data/obsolete.json" },
        { op: "write", path: "assets/new.png", encoding: "base64", content: "BAUG" },
      ],
    });
    expect(editor.dirty.value).toBe(false);
  });

  it("sends version notes and group preview selection through the SDK", async () => {
    const sdk = {
      get: vi.fn().mockResolvedValue(importedCard),
      publish: vi.fn().mockResolvedValue({
        id: "version-1", cardId: "card-1", characterId: "character-1", characterVersionId: "cv-1", releaseId: "release-1", revision: 1, createdAt: 20, note: "稳定版",
      }),
      createPreview: vi.fn().mockResolvedValue({ cardId: "card-1", revision: 1, sessionId: "session-1", openingId: "opening-2" }),
    };
    const editor = createNativeCardEditorController(sdk as unknown as NativeCardsResource);
    await editor.openCard("card-1");
    const configuration = {
      presetId: "preset-1", presetVersionId: "preset-version-1", defaultUserId: "user-1", promptMode: "native" as const,
      modelSlots: [{ slot: "*" as const, profile_id: "model-1" }],
    };

    await editor.publish(configuration, "稳定版");
    await editor.createPreview(configuration, "opening-2", "user-1", "group");

    expect(sdk.publish).toHaveBeenCalledWith({ cardId: "card-1", revision: 1, configuration, note: "稳定版" });
    expect(sdk.createPreview).toHaveBeenCalledWith({ cardId: "card-1", revision: 1, configuration, openingId: "opening-2", userId: "user-1", sessionType: "group" });
  });
});
