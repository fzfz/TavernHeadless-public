import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountComponent, settleComponent, ComponentNode } from "../../test/component-host.js";

const { nativeCards, roleReleases, presets, users, llmProfiles, roleRuntime } = vi.hoisted(() => ({
  nativeCards: {
    list: vi.fn(), create: vi.fn(), get: vi.fn(), readFile: vi.fn(), save: vi.fn(), validate: vi.fn(),
    checkImport: vi.fn(), confirmImport: vi.fn(), publish: vi.fn(), createPreview: vi.fn(), createBuild: vi.fn(),
    getBuild: vi.fn(), retryBuild: vi.fn(), downloadBuild: vi.fn(), downloadArtifact: vi.fn(),
    allocateEntryUid: vi.fn(),
  },
  roleReleases: { createSession: vi.fn() },
  presets: { list: vi.fn(), listVersions: vi.fn() },
  users: { list: vi.fn() },
  llmProfiles: { list: vi.fn(), runtime: vi.fn() },
  roleRuntime: { getView: vi.fn(), inspectProposal: vi.fn(), previewStateUpdate: vi.fn() },
}));
vi.mock("../../lib/api.js", () => ({ apiClient: { nativeCards, roleReleases, presets, users, llmProfiles, roleRuntime } }));
vi.mock("../../directives/modal-focus.js", () => ({ vModalFocus: {} }));
vi.mock("./native-card-editor.css", () => ({}));

const importSummary = {
  formatVersion: "1.0.0" as const, worldbookCount: 2, openingCount: 1, initialStateCount: 1,
  stateUpdate: { rules: true, schema: true, validators: true, tools: true },
  promptController: true, frontend: { page: true, script: true, style: true, media: true }, regexProfileCount: 1,
};

const card = {
  id: "card-1", characterId: "character-1", packageId: "package-1", name: "角色甲", revision: 1,
  createdAt: 1, updatedAt: 1, files: [{ path: "character.json", mediaType: "application/json", purpose: "data", byteSize: 20 }],
  versions: [] as Array<{ id: string; revision: number; createdAt: number }>,
};

const componentQuerySelector = Object.getOwnPropertyDescriptor(ComponentNode.prototype, "querySelector");
const componentScrollTo = Object.getOwnPropertyDescriptor(ComponentNode.prototype, "scrollTo");
const componentSetSelectionRange = Object.getOwnPropertyDescriptor(ComponentNode.prototype, "setSelectionRange");
Object.defineProperty(ComponentNode.prototype, "querySelector", { configurable: true, value: () => null });
Object.defineProperty(ComponentNode.prototype, "scrollTo", { configurable: true, value: () => {} });

function installBrowser(search = "?id=card-1") {
  const body = new ComponentNode("BODY");
  Object.assign(body, { append: vi.fn() });
  const fakeDocument = {
    activeElement: body,
    body,
    querySelector: vi.fn(() => null),
    createElement: vi.fn((tag: string) => Object.assign(new ComponentNode(tag.toUpperCase()), {
      remove: vi.fn(), download: "", href: "",
    })),
  };
  const fakeWindow = new EventTarget() as Window;
  Object.assign(fakeWindow, { location: { search, assign: vi.fn() }, requestAnimationFrame: (callback: FrameRequestCallback) => callback(0), setTimeout: globalThis.setTimeout, document: fakeDocument });
  vi.stubGlobal("window", fakeWindow);
  vi.stubGlobal("document", fakeDocument);
  vi.stubGlobal("history", { replaceState: vi.fn() });
  vi.stubGlobal("HTMLElement", ComponentNode);
  vi.stubGlobal("HTMLInputElement", ComponentNode);
  vi.stubGlobal("HTMLTextAreaElement", ComponentNode);
  vi.stubGlobal("HTMLSelectElement", ComponentNode);
  return fakeWindow;
}

function keyboardEvent(key: string, modifiers: { ctrlKey?: boolean; metaKey?: boolean } = {}): Event {
  const event = new Event("keydown", { cancelable: true });
  Object.assign(event, { key, ctrlKey: modifiers.ctrlKey ?? false, metaKey: modifiers.metaKey ?? false });
  return event;
}

function findAction(root: ComponentNode, action: string): ComponentNode | undefined {
  const visit = (node: ComponentNode): ComponentNode | undefined => {
    if (node.props["data-action"] === action) return node;
    for (const child of node.children) {
      const found = visit(child);
      if (found) return found;
    }
    return undefined;
  };
  return visit(root);
}

function findById(root: ComponentNode, id: string): ComponentNode | undefined {
  const visit = (node: ComponentNode): ComponentNode | undefined => {
    if (node.props.id === id) return node;
    for (const child of node.children) {
      const found = visit(child);
      if (found) return found;
    }
    return undefined;
  };
  return visit(root);
}

function selectValue(select: ComponentNode, value: string): void {
  select.options.forEach((option) => { option.selected = String(option.value) === value; });
  select.value = value;
  select.dispatchEvent(new Event("change"));
}

function configurePreviewMocks(): void {
  presets.list.mockResolvedValue([{ id: "preset-1", name: "预设" }]);
  presets.listVersions.mockResolvedValue([{ id: "preset-version-1", versionNo: 3 }]);
  users.list.mockResolvedValue([{ id: "user-1", name: "用户", status: "active" }]);
  llmProfiles.list.mockResolvedValue([{ id: "profile-1", name: "模型", status: "active", provider: "local", modelId: "model-1" }]);
  llmProfiles.runtime.mockResolvedValue([]);
  roleRuntime.getView.mockResolvedValue({ initial: { variables: {} }, current: { variables: {} } });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ userWebBaseUrl: "http://localhost:5174/role" }) }));
}

async function chooseNarratorAndRunSystemAction(root: ComponentNode): Promise<void> {
  const narrator = findById(root, "dialog-body")?.querySelectorAll("select")[4];
  if (narrator) selectValue(narrator, "profile-1");
  await settleComponent();
  const action = findAction(root, "system-action");
  expect(action?.props.disabled).toBe(false);
  action?.click();
  await settleComponent();
}

async function openStatePromptPreview(view: unknown) {
  configurePreviewMocks();
  roleRuntime.getView.mockResolvedValue(view);
  nativeCards.createPreview.mockResolvedValue({
    cardId: card.id,
    revision: 1,
    sessionId: "preview-state-prompt",
    openingId: "opening-a",
  });
  const mounted = await mountEditor();
  findAction(mounted.root, "preview")?.click();
  await settleComponent();
  await chooseNarratorAndRunSystemAction(mounted.root);
  mounted.all((node) => node.props["data-preview"] === "state-prompt")[0]?.click();
  await settleComponent();
  return mounted;
}

function findStatePromptPreviewButton(root: ComponentNode): ComponentNode | undefined {
  return root.querySelectorAll("button").find((button) => button.textContent === "查看变量更新请求");
}

async function mountEditor(editorCard = card, readFile = ({ path }: { path: string }) => Promise.resolve({ path, mediaType: "application/json", encoding: "utf8", content: '{"name":"角色甲","characterVersion":"1.0"}' })) {
  const browser = installBrowser();
  nativeCards.list.mockResolvedValue([editorCard]);
  nativeCards.get.mockResolvedValue(editorCard);
  nativeCards.readFile.mockImplementation(readFile);
  const { default: page } = await import("./NativeCardEditorPage.vue");
  const mounted = mountComponent(page, {});
  await settleComponent();
  return { ...mounted, browser };
}

describe("native card editor page workflows", () => {
  beforeEach(() => {
    Object.defineProperty(ComponentNode.prototype, "querySelector", { configurable: true, value: () => null });
    Object.defineProperty(ComponentNode.prototype, "scrollTo", { configurable: true, value: () => {} });
  });
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (componentQuerySelector) Object.defineProperty(ComponentNode.prototype, "querySelector", componentQuerySelector);
    else delete (ComponentNode.prototype as unknown as Record<string, unknown>).querySelector;
    if (componentScrollTo) Object.defineProperty(ComponentNode.prototype, "scrollTo", componentScrollTo);
    else delete (ComponentNode.prototype as unknown as Record<string, unknown>).scrollTo;
    if (componentSetSelectionRange) Object.defineProperty(ComponentNode.prototype, "setSelectionRange", componentSetSelectionRange);
    else delete (ComponentNode.prototype as unknown as Record<string, unknown>).setSelectionRange;
  });

  it("opens the conflict workflow after a rejected save and keeps it reachable from the editor", async () => {
    nativeCards.save.mockRejectedValue(Object.assign(new Error("conflict"), {
      code: "NATIVE_CARD_REVISION_CONFLICT", details: { expectedRevision: 1, actualRevision: 2 },
    }));
    const mounted = await mountEditor();
    nativeCards.readFile.mockImplementation(({ path, revision }: { path: string; revision?: number }) => Promise.resolve({
      path, mediaType: "application/json", encoding: "utf8", content: revision === 2 ? '{"name":"服务端角色"}' : '{"name":"角色甲","characterVersion":"1.0"}',
    }));
    const version = mounted.all((node) => node.tagName === "INPUT").find((node) => node.value === "1.0");
    expect(version).toBeDefined();
    version!.value = "1.1";
    version!.dispatchEvent(new Event("input"));
    await settleComponent();

    findAction(mounted.root, "save")?.click();
    await settleComponent();

    expect(findAction(mounted.root, "use-server")).toBeDefined();
    expect(findAction(mounted.root, "keep-local")).toBeDefined();
    expect(nativeCards.readFile).toHaveBeenCalledWith({ cardId: "card-1", path: "character.json", revision: 2 });
    expect(mounted.root.textContent).toContain("服务端角色");
    mounted.unmount();
  });

  it("keeps an edit made while the save request is pending dirty for the next save", async () => {
    let finishSave: ((saved: typeof card) => void) | undefined;
    nativeCards.save.mockImplementation(() => new Promise((resolve) => { finishSave = resolve; }));
    const mounted = await mountEditor();
    const version = mounted.all((node) => node.tagName === "INPUT").find((node) => node.value === "1.0");
    expect(version).toBeDefined();
    version!.value = "1.1";
    version!.dispatchEvent(new Event("input"));
    await settleComponent();
    findAction(mounted.root, "save")?.click();
    await settleComponent();

    version!.value = "1.2";
    version!.dispatchEvent(new Event("input"));
    await settleComponent();
    finishSave?.({
      ...card,
      name: "已保存新名称",
      revision: 2,
      updatedAt: 2,
      files: [...card.files, { path: "data/new.json", mediaType: "application/json", purpose: "data", byteSize: 4 }],
    });
    await settleComponent();

    expect(findById(mounted.root, "save-state")?.textContent).toContain("未保存");
    findAction(mounted.root, "save")?.click();
    await settleComponent();
    expect(nativeCards.save).toHaveBeenCalledTimes(2);
    expect(nativeCards.save.mock.calls[1]?.[0]).toMatchObject({ expectedRevision: 2, operations: [expect.objectContaining({ content: expect.stringContaining("1.2") })] });
    mounted.unmount();
  });

  it("saves edits added during an in-flight save before leaving the card", async () => {
    let finishFirstSave: ((saved: typeof card) => void) | undefined;
    nativeCards.save.mockImplementationOnce(() => new Promise((resolve) => { finishFirstSave = resolve; }))
      .mockResolvedValueOnce({ ...card, revision: 3, updatedAt: 3 });
    nativeCards.list.mockResolvedValue([card]);
    const mounted = await mountEditor();
    const version = mounted.all((node) => node.tagName === "INPUT").find((node) => node.value === "1.0");
    version!.value = "1.1";
    version!.dispatchEvent(new Event("input"));
    await settleComponent();
    findAction(mounted.root, "save")?.click();
    await settleComponent();

    version!.value = "1.2";
    version!.dispatchEvent(new Event("input"));
    await settleComponent();
    findAction(mounted.root, "catalog")?.click();
    await settleComponent();
    findAction(mounted.root, "save-leave")?.click();
    await settleComponent();
    finishFirstSave?.({ ...card, revision: 2, updatedAt: 2 });
    await settleComponent();
    await settleComponent();

    expect(nativeCards.save).toHaveBeenCalledTimes(2);
    expect(nativeCards.save.mock.calls[1]?.[0]).toMatchObject({
      expectedRevision: 2,
      operations: [expect.objectContaining({ content: expect.stringContaining("1.2") })],
    });
    expect(findAction(mounted.root, "new-role")).toBeDefined();
    mounted.unmount();
  });

  it("runs a requested check against the revision containing edits made during save", async () => {
    let finishFirstSave: ((saved: typeof card) => void) | undefined;
    nativeCards.save.mockImplementationOnce(() => new Promise((resolve) => { finishFirstSave = resolve; }))
      .mockResolvedValueOnce({ ...card, revision: 3, updatedAt: 3 });
    nativeCards.validate.mockResolvedValue({ valid: true, issues: [] });
    const mounted = await mountEditor();
    const version = mounted.all((node) => node.tagName === "INPUT").find((node) => node.value === "1.0");
    version!.value = "1.1";
    version!.dispatchEvent(new Event("input"));
    await settleComponent();
    findAction(mounted.root, "check")?.click();
    await settleComponent();
    findAction(mounted.root, "save-and-continue")?.click();
    await settleComponent();

    version!.value = "1.2";
    version!.dispatchEvent(new Event("input"));
    await settleComponent();
    finishFirstSave?.({ ...card, revision: 2, updatedAt: 2 });
    await settleComponent();
    await settleComponent();

    expect(nativeCards.save).toHaveBeenCalledTimes(2);
    expect(nativeCards.validate).toHaveBeenCalledWith({ cardId: "card-1", revision: 3 });
    expect(findAction(mounted.root, "close-dialog")).toBeDefined();
    mounted.unmount();
  });

  it("keeps malformed package JSON visible when switching to the form and offers its file view", async () => {
    const worldbookCard = {
      ...card,
      files: [
        ...card.files,
        { path: "worldbooks/harbor/book.json", mediaType: "application/json", purpose: "data", byteSize: 50 },
        { path: "worldbooks/harbor/entries/2.json", mediaType: "application/json", purpose: "data", byteSize: 30 },
      ],
    };
    const readWorldbookFile = ({ path }: { path: string }) => Promise.resolve({
      path, mediaType: "application/json", encoding: "utf8",
      content: path === "character.json"
        ? '{"name":"角色甲","worldbooks":[{"id":"harbor","file":"worldbooks/harbor/book.json","enabled":true}]}'
        : path === "worldbooks/harbor/book.json"
          ? '{"id":"harbor","name":"雾港","entryFiles":["worldbooks/harbor/entries/2.json"]}'
          : '{"uid":2,"comment":"灯塔"}',
    });
    const mounted = await mountEditor(worldbookCard, readWorldbookFile);
    const worldbooks = mounted.all((node) => node.props["data-domain"] === "worldbooks")[0];
    worldbooks?.click();
    await settleComponent();
    findById(mounted.root, "source-button")?.click();
    await settleComponent();
    const source = findById(mounted.root, "source-editor");
    expect(source).toBeDefined();
    source!.value = '{"uid":';
    source!.dispatchEvent(new Event("input"));
    await settleComponent();
    findById(mounted.root, "form-button")?.click();
    await settleComponent();

    expect(mounted.root.textContent).toContain("worldbooks/harbor/entries/2.json");
    expect(mounted.root.textContent).toMatch(/第\s*1\s*行.*第\s*8\s*列/);
    expect(findAction(mounted.root, "open-json-source")).toBeDefined();
    expect(mounted.root.textContent).not.toContain("这本世界书还没有条目");
    const focusSpy = vi.spyOn(ComponentNode.prototype, "focus");
    findAction(mounted.root, "open-json-source")?.click();
    await settleComponent();
    expect(focusSpy.mock.contexts.some((node) => (node as ComponentNode).props.id === "source-editor")).toBe(true);
    mounted.unmount();
  });

  it("focuses the located source file and selects the reported validation position when present", async () => {
    const sourcePath = "backend/controllers/browser-final.js";
    const validationCard = {
      ...card,
      files: [...card.files, { path: sourcePath, mediaType: "text/javascript", purpose: "controller", byteSize: 28 }],
    };
    const validationIssue = (position?: { line: number; column: number }) => ({
      valid: false,
      issues: [{
        code: "NATIVE_CARD_CONTROLLER_INVALID",
        path: sourcePath,
        ...(position ?? {}),
        message: "控制器配置未通过校验。",
        action: "打开文件并修正配置。",
      }],
    });
    nativeCards.validate.mockResolvedValue(validationIssue({ line: 2, column: 3 }));
    const mounted = await mountEditor(validationCard, ({ path }: { path: string }) => Promise.resolve({
      path,
      mediaType: path === sourcePath ? "text/javascript" : "application/json",
      encoding: "utf8",
      content: path === sourcePath ? "const first = 1;\nconst second = 2;" : '{"name":"角色甲"}',
    }));
    const selectionSpy = vi.fn();
    Object.defineProperty(ComponentNode.prototype, "setSelectionRange", { configurable: true, value: selectionSpy });
    const focusSpy = vi.spyOn(ComponentNode.prototype, "focus");

    findAction(mounted.root, "check")?.click();
    await settleComponent();
    mounted.all((node) => node.props["data-issue"] === sourcePath)[0]?.click();
    await settleComponent();

    const sourceEditor = findById(mounted.root, "source-editor");
    expect(sourceEditor).toBeDefined();
    expect(focusSpy.mock.contexts.some((node) => (node as ComponentNode).props.id === "source-editor")).toBe(true);
    expect(selectionSpy).toHaveBeenCalledWith(19, 19);

    nativeCards.validate.mockResolvedValue(validationIssue());
    findAction(mounted.root, "check")?.click();
    await settleComponent();
    mounted.all((node) => node.props["data-issue"] === sourcePath)[0]?.click();
    await settleComponent();
    expect(focusSpy.mock.contexts.filter((node) => (node as ComponentNode).props.id === "source-editor").length).toBeGreaterThanOrEqual(2);
    mounted.unmount();
  });

  it("loads saved media after upload so existing asset cards show their image instead of a placeholder", async () => {
    const assetCard = {
      ...card,
      files: [...card.files, { path: "assets/portrait.svg", mediaType: "image/svg+xml", purpose: "media", byteSize: 16 }],
    };
    const readAssetFile = ({ path }: { path: string }) => Promise.resolve({
      path,
      mediaType: path === "assets/portrait.svg" ? "image/svg+xml" : "application/json",
      encoding: path === "assets/portrait.svg" ? "base64" : "utf8",
      content: path === "assets/portrait.svg" ? "PHN2Zy8+" : path === "character.json" ? '{"name":"角色甲"}' : '{"packageId":"package-1","files":[]}',
    });
    const mounted = await mountEditor(assetCard, readAssetFile);
    findAction(mounted.root, "upload")?.click();
    const input = findById(mounted.root, "upload-input");
    expect(input).toBeDefined();
    input!.files = [new File(["<svg/>"] , "new.svg", { type: "image/svg+xml" })];
    input!.dispatchEvent(new Event("change"));
    await settleComponent();

    expect(nativeCards.readFile).toHaveBeenCalledWith({ cardId: "card-1", path: "assets/portrait.svg", revision: 1 });
    expect(mounted.all((node) => node.tagName === "IMG").some((node) => String(node.props.src).startsWith("data:image/svg+xml;base64,"))).toBe(true);
    mounted.unmount();
  });

  it("rejects a replacement whose bytes are mapped to a different filename format", async () => {
    const assetCard = {
      ...card,
      files: [...card.files, { path: "assets/portrait.svg", mediaType: "image/svg+xml", purpose: "media", byteSize: 16 }],
    };
    const readAssetFile = ({ path }: { path: string }) => Promise.resolve({
      path,
      mediaType: path === "assets/portrait.svg" ? "image/svg+xml" : "application/json",
      encoding: path === "assets/portrait.svg" ? "base64" : "utf8",
      content: path === "assets/portrait.svg" ? "PHN2Zy8+" : path === "character.json" ? '{"name":"角色甲"}' : '{"packageId":"package-1","files":[]}',
    });
    const mounted = await mountEditor(assetCard, readAssetFile);
    mounted.all((node) => node.props["data-domain"] === "assets")[0]?.click();
    await settleComponent();
    mounted.all((node) => node.props["data-action"] === "replace-media")[0]?.click();
    const input = findById(mounted.root, "upload-input");
    input!.files = [new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "replacement.png", { type: "image/png" })];
    input!.dispatchEvent(new Event("change"));
    await settleComponent();

    expect(mounted.root.textContent).toContain("替换文件的格式必须与现有扩展名相同");
    expect(nativeCards.save).not.toHaveBeenCalled();
    mounted.unmount();
  });

  it("routes Ctrl/Cmd+S through the editor save workflow and leaves shortcuts alone while a dialog is open", async () => {
    nativeCards.save.mockResolvedValue({ ...card, revision: 2, updatedAt: 2 });
    const fakeWindow = installBrowser();
    nativeCards.list.mockResolvedValue([card]);
    nativeCards.get.mockResolvedValue(card);
    nativeCards.readFile.mockResolvedValue({ path: "character.json", mediaType: "application/json", encoding: "utf8", content: '{"name":"角色甲","characterVersion":"1.0"}' });
    const { default: page } = await import("./NativeCardEditorPage.vue");
    const mounted = mountComponent(page, {});
    await settleComponent();
    const version = mounted.all((node) => node.tagName === "INPUT").find((node) => node.value === "1.0");
    version!.value = "1.1";
    version!.dispatchEvent(new Event("input"));
    await settleComponent();

    const shortcut = keyboardEvent("s", { ctrlKey: true });
    fakeWindow.dispatchEvent(shortcut);
    await settleComponent();
    expect(shortcut.defaultPrevented).toBe(true);
    expect(nativeCards.save).toHaveBeenCalledOnce();

    mounted.all((node) => node.props["data-action"] === "check")[0]?.click();
    await settleComponent();
    const dialogShortcut = keyboardEvent("s", { metaKey: true });
    fakeWindow.dispatchEvent(dialogShortcut);
    await settleComponent();
    expect(dialogShortcut.defaultPrevented).toBe(false);
    expect(nativeCards.save).toHaveBeenCalledOnce();
    mounted.unmount();
  });

  it("updates state rule sourceEntries during the real cross-worldbook move workflow", async () => {
    const cardWithBooks = {
      ...card,
      files: [
        ...card.files,
        { path: "worldbooks/source/book.json", mediaType: "application/json", purpose: "data", byteSize: 50 },
        { path: "worldbooks/source/entries/1.json", mediaType: "application/json", purpose: "data", byteSize: 30 },
        { path: "worldbooks/target/book.json", mediaType: "application/json", purpose: "data", byteSize: 50 },
        { path: "agents/state-update/profile.json", mediaType: "application/json", purpose: "stateUpdate", byteSize: 40 },
        { path: "agents/state-update/rules/guard.json", mediaType: "application/json", purpose: "stateUpdate", byteSize: 60 },
      ],
    };
    const documents: Record<string, string> = {
      "character.json": '{"name":"角色甲","worldbooks":[{"id":"source","file":"worldbooks/source/book.json","enabled":true},{"id":"target","file":"worldbooks/target/book.json","enabled":true}]}',
      "manifest.json": '{"packageId":"package-1","files":[]}',
      "openings.json": '{"items":[]}',
      "worldbooks/source/book.json": '{"id":"source","name":"来源书","entryFiles":["worldbooks/source/entries/1.json"]}',
      "worldbooks/source/entries/1.json": '{"uid":1,"comment":"灯塔"}',
      "worldbooks/target/book.json": '{"id":"target","name":"目标书","entryFiles":[]}',
      "agents/state-update/profile.json": '{"ruleFiles":["agents/state-update/rules/guard.json"]}',
      "agents/state-update/rules/guard.json": '{"rules":[{"id":"guard","sourceEntries":[{"bookId":"source","entryId":1}]}]}',
    };
    nativeCards.allocateEntryUid.mockResolvedValue({ uid: 2 });
    const mounted = await mountEditor(cardWithBooks, ({ path }: { path: string }) => Promise.resolve({
      path, mediaType: "application/json", encoding: "utf8", content: documents[path] ?? "{}",
    }));
    const focusSpy = vi.spyOn(ComponentNode.prototype, "focus");
    mounted.all((node) => node.props["data-domain"] === "worldbooks")[0]?.click();
    await settleComponent();
    mounted.all((node) => node.props["data-action"] === "move-entry-to-book")[0]?.click();
    await settleComponent();
    mounted.all((node) => node.props["data-action"] === "move-entry-confirm")[0]?.click();
    await settleComponent();
    await settleComponent();
    expect(focusSpy.mock.contexts.map((node) => `${(node as ComponentNode).tagName}:${String((node as ComponentNode).props["data-action"] ?? "")}`)).toContain("BUTTON:select-entry");
    mounted.all((node) => node.props.id === "nav-files")[0]?.click();
    await settleComponent();
    mounted.all((node) => node.props["data-file"] === "agents/state-update/rules/guard.json")[0]?.click();
    await settleComponent();

    const source = findById(mounted.root, "source-editor");
    expect(source).toBeDefined();
    expect(JSON.parse(String(source?.value))).toMatchObject({
      rules: [{ sourceEntries: [{ bookId: "target", entryId: 2 }] }],
    });
    expect(nativeCards.readFile).not.toHaveBeenCalledWith({ cardId: "card-1", path: "worldbooks/target/entries/2.json", revision: 1 });
    expect(mounted.root.textContent).not.toContain("当前修订中没有该文件");
    mounted.unmount();
  });

  it("runs the published release by creating and opening its real user session", async () => {
    nativeCards.validate.mockResolvedValue({ valid: true, issues: [] });
    nativeCards.publish.mockResolvedValue({
      id: "publication-1", cardId: "card-1", revision: 1, createdAt: 2,
      characterId: "character-1", characterVersionId: "character-version-1", releaseId: "release-1",
    });
    roleReleases.createSession.mockResolvedValue({ release: {}, session: { id: "session-real" }, opening_id: null });
    presets.list.mockResolvedValue([{ id: "preset-1", name: "预设" }]);
    presets.listVersions.mockResolvedValue([{ id: "preset-version-1", versionNo: 3 }]);
    users.list.mockResolvedValue([{ id: "user-1", name: "用户", status: "active" }]);
    llmProfiles.list.mockResolvedValue([{ id: "profile-1", name: "模型", status: "active", provider: "local", modelId: "model-1" }]);
    llmProfiles.runtime.mockResolvedValue([]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ userWebBaseUrl: "http://localhost:5174/role" }) }));
    const fakeWindow = installBrowser();
    nativeCards.list.mockResolvedValue([card]);
    nativeCards.get.mockResolvedValue(card);
    nativeCards.readFile.mockResolvedValue({ path: "character.json", mediaType: "application/json", encoding: "utf8", content: '{"name":"角色甲"}' });
    const { default: page } = await import("./NativeCardEditorPage.vue");
    const mounted = mountComponent(page, {});
    await settleComponent();

    findAction(mounted.root, "publish")?.click();
    await settleComponent();
    await settleComponent();
    const selects = mounted.all((node) => node.tagName === "SELECT");
    const narratorModel = selects[4];
    expect(narratorModel).toBeDefined();
    narratorModel!.options.forEach((option) => { option.selected = option.value === "profile-1"; });
    narratorModel!.value = "profile-1";
    narratorModel!.dispatchEvent(new Event("change"));
    await settleComponent();
    const systemAction = findAction(mounted.root, "system-action");
    expect(systemAction?.props.disabled).toBe(false);
    systemAction?.click();
    await settleComponent();
    expect(nativeCards.publish).toHaveBeenCalledOnce();
    expect(findAction(mounted.root, "run-published-version")).toBeDefined();

    findAction(mounted.root, "run-published-version")?.click();
    await settleComponent();

    expect(roleReleases.createSession).toHaveBeenCalledWith({ releaseId: "release-1", input: {} });
    expect((fakeWindow.location as unknown as { assign: ReturnType<typeof vi.fn> }).assign).toHaveBeenCalledWith("http://localhost:5174/role?sessionId=session-real");
    mounted.unmount();
  });

  it("toggles regex enabled state without reversing the persisted disabled flag", async () => {
    const regexCard = {
      ...card,
      files: [...card.files, { path: "regex/default.json", mediaType: "application/json", purpose: "data", byteSize: 60 }],
    };
    const mounted = await mountEditor(regexCard, ({ path }: { path: string }) => Promise.resolve({
      path, mediaType: "application/json", encoding: "utf8",
      content: path === "regex/default.json" ? '[{"id":"trim","scriptName":"Trim","disabled":false}]' : '{"name":"角色甲"}',
    }));
    mounted.all((node) => node.props["data-domain"] === "regex")[0]?.click();
    await settleComponent();
    let enabled = mounted.all((node) => node.tagName === "INPUT" && node.props.type === "checkbox")[0];
    expect(enabled?.props.checked).toBe(true);
    enabled!.checked = false;
    enabled!.dispatchEvent(new Event("change"));
    await settleComponent();
    mounted.all((node) => node.props.id === "nav-files")[0]?.click();
    await settleComponent();
    mounted.all((node) => node.props["data-file"] === "regex/default.json")[0]?.click();
    await settleComponent();
    expect(JSON.parse(String(findById(mounted.root, "source-editor")?.value))[0].disabled).toBe(true);

    mounted.all((node) => node.props.id === "nav-domain")[0]?.click();
    await settleComponent();
    mounted.all((node) => node.props["data-domain"] === "regex")[0]?.click();
    await settleComponent();
    enabled = mounted.all((node) => node.tagName === "INPUT" && node.props.type === "checkbox")[0];
    expect(enabled?.props.checked).toBe(false);
    enabled!.checked = true;
    enabled!.dispatchEvent(new Event("change"));
    await settleComponent();
    mounted.all((node) => node.props.id === "nav-files")[0]?.click();
    await settleComponent();
    mounted.all((node) => node.props["data-file"] === "regex/default.json")[0]?.click();
    await settleComponent();
    expect(JSON.parse(String(findById(mounted.root, "source-editor")?.value))[0].disabled).toBe(false);
    mounted.unmount();
  });

  it("does not carry a previous card preview iframe into another card", async () => {
    const withFrontendFiles = (id: string, name: string) => ({
      ...card,
      id,
      characterId: `character-${id}`,
      packageId: `package-${id}`,
      name,
      files: [...card.files, { path: "frontend/manifest.json", mediaType: "application/json", purpose: "data", byteSize: 24 }, { path: "frontend/index.html", mediaType: "text/html", purpose: "frontend", byteSize: 0 }],
    });
    const cardA = withFrontendFiles("card-a", "角色甲");
    const cardB = withFrontendFiles("card-b", "角色乙");
    configurePreviewMocks();
    nativeCards.createPreview.mockImplementation(({ cardId }: { cardId: string }) => Promise.resolve({
      cardId, revision: 1, sessionId: cardId === cardA.id ? "preview-a" : "preview-b", openingId: "opening-a",
    }));
    nativeCards.list.mockResolvedValue([cardA, cardB]);
    nativeCards.get.mockImplementation(({ cardId }: { cardId: string }) => Promise.resolve(cardId === cardA.id ? cardA : cardB));
    nativeCards.readFile.mockImplementation(({ cardId, path }: { cardId: string; path: string }) => Promise.resolve({
      path, mediaType: path.endsWith(".html") ? "text/html" : "application/json", encoding: "utf8",
      content: path === "character.json" ? `{"name":"${cardId === cardA.id ? "角色甲" : "角色乙"}"}`
        : path === "frontend/manifest.json" ? '{"html":"frontend/index.html","css":"","script":""}'
          : "<main>页面</main>",
    }));
    installBrowser("?id=card-a");
    const { default: page } = await import("./NativeCardEditorPage.vue");
    const mounted = mountComponent(page, {});
    await settleComponent();
    findAction(mounted.root, "preview")?.click();
    await settleComponent();
    await chooseNarratorAndRunSystemAction(mounted.root);
    expect(mounted.all((node) => node.tagName === "IFRAME").some((node) => node.props.src === "http://localhost:5174/role?sessionId=preview-a")).toBe(true);
    findAction(mounted.root, "close-dialog")?.click();
    await settleComponent();
    findAction(mounted.root, "catalog")?.click();
    await settleComponent();
    mounted.all((node) => node.props["data-card"] === cardB.id)[0]?.click();
    await settleComponent();
    expect(nativeCards.get).toHaveBeenCalledWith({ cardId: cardB.id });
    expect(findById(mounted.root, "role-name")?.textContent).toBe("角色乙");
    mounted.all((node) => node.props["data-domain"] === "frontend")[0]?.click();
    await settleComponent();

    expect(mounted.all((node) => node.tagName === "IFRAME").some((node) => node.props.src === "http://localhost:5174/role?sessionId=preview-a")).toBe(false);
    findAction(mounted.root, "frontend-create-preview")?.click();
    await settleComponent();
    await chooseNarratorAndRunSystemAction(mounted.root);
    expect(nativeCards.createPreview).toHaveBeenCalledTimes(2);
    expect(nativeCards.createPreview.mock.calls[1]?.[0]).toMatchObject({ cardId: cardB.id });
    expect(mounted.all((node) => node.tagName === "IFRAME").some((node) => node.props.src === "http://localhost:5174/role?sessionId=preview-b")).toBe(true);
    mounted.unmount();
  });

  it("explains that a body floor is required when no current or pending floor exists", async () => {
    const mounted = await openStatePromptPreview({
      current: { floorId: null, snapshotId: "snapshot-current" },
      processing: { pendingStateFloorId: null },
    });

    findStatePromptPreviewButton(mounted.root)?.click();
    await settleComponent();

    expect(mounted.root.textContent).toContain(
      "请先在试聊中生成一轮正文，再查看变量更新提示词。",
    );
    expect(roleRuntime.previewStateUpdate).not.toHaveBeenCalled();
    mounted.unmount();
  });

  it.each([
    {
      label: "the current floor when no state floor is pending",
      pendingStateFloorId: null,
      currentFloorId: "floor-current",
      expectedFloorId: "floor-current",
    },
    {
      label: "the pending state floor ahead of the current floor",
      pendingStateFloorId: "floor-pending",
      currentFloorId: "floor-current",
      expectedFloorId: "floor-pending",
    },
  ])("previews state prompt using $label", async ({ pendingStateFloorId, currentFloorId, expectedFloorId }) => {
    roleRuntime.previewStateUpdate.mockResolvedValue({
      messages: [{ role: "system", content: "Fixed state update prompt" }],
      token_usage: { total: 27, availableForReply: 300 },
    });
    const mounted = await openStatePromptPreview({
      current: { floorId: currentFloorId, snapshotId: "snapshot-current" },
      processing: { pendingStateFloorId },
    });

    findStatePromptPreviewButton(mounted.root)?.click();
    await settleComponent();

    expect(roleRuntime.previewStateUpdate).toHaveBeenCalledWith({
      sessionId: "preview-state-prompt",
      floorId: expectedFloorId,
      expectedSnapshotId: "snapshot-current",
    });
    expect(mounted.root.textContent).toContain("Fixed state update prompt");
    mounted.unmount();
  });

  it("opens fixed proposal inspection from the baseline variables card instead of rendering it inline", async () => {
    const variablesCard = {
      ...card,
      files: [...card.files, { path: "state/schema.json", mediaType: "application/schema+json", purpose: "data", byteSize: 20 }],
    };
    configurePreviewMocks();
    nativeCards.createPreview.mockResolvedValue({ cardId: card.id, revision: 1, sessionId: "preview-variables", openingId: "opening-a" });
    const mounted = await mountEditor(variablesCard, ({ path }: { path: string }) => Promise.resolve({
      path, mediaType: path === "state/schema.json" ? "application/schema+json" : "application/json", encoding: "utf8",
      content: path === "character.json" ? '{"name":"角色甲"}' : path === "state/schema.json" ? '{"type":"object","properties":{}}' : "{}",
    }));
    mounted.all((node) => node.props["data-domain"] === "variables")[0]?.click();
    await settleComponent();
    expect(mounted.root.textContent).toContain("检查变量更新");
    expect(mounted.all((node) => node.props["aria-label"] === "来源消息 JSON")).toHaveLength(0);
    findAction(mounted.root, "variables-preview")?.click();
    await settleComponent();
    await chooseNarratorAndRunSystemAction(mounted.root);

    expect(mounted.all((node) => node.props["data-preview"] === "variables")[0]?.props.class).toContain("active");
    expect(mounted.all((node) => node.props["aria-label"] === "来源消息 JSON")).toHaveLength(1);
    expect(findAction(mounted.root, "inspect-proposal")).toBeDefined();
    expect(mounted.root.textContent).toContain("候选提案检查");
    mounted.unmount();
  });

  it("shows the failed package stage and omits an empty issue path", async () => {
    nativeCards.createBuild.mockResolvedValue({
      id: "build-1", cardId: card.id, revision: 1, status: "failed", stage: "archiving",
      createdAt: 2, updatedAt: 3, issues: [{ code: "NATIVE_CARD_BUILD_FAILED", path: "", message: "ZIP 写入失败", action: "请重试。" }],
    });
    const mounted = await mountEditor();
    findAction(mounted.root, "export")?.click();
    await settleComponent();
    findAction(mounted.root, "package-save")?.click();
    await settleComponent();

    expect(mounted.root.textContent).toContain("失败阶段：生成 ZIP");
    expect(mounted.root.textContent).toContain("ZIP 写入失败");
    expect(mounted.root.textContent).not.toContain("：ZIP 写入失败");
    mounted.unmount();
  });

  it("keeps the long card ID accessible while showing revision in the header and footer", async () => {
    const longIdCard = { ...card, id: "native-card-identifier-that-is-long-enough-to-overflow", revision: 7 };
    const mounted = await mountEditor(longIdCard);
    const revision = findById(mounted.root, "revision");
    expect(revision?.props["aria-label"]).toContain(longIdCard.id);
    expect(revision?.children.some((node) => node.props.class === "revision-number" && node.textContent === "修订 7")).toBe(true);
    expect(findById(mounted.root, "status-right")?.textContent).toBe("1 个文件 · 修订 7");
    mounted.unmount();
  });

  it("opens build source choices while dirty and pins the saved revision from dialog entry", async () => {
    let finishSave: ((saved: typeof card) => void) | undefined;
    nativeCards.save.mockImplementationOnce(() => new Promise((resolve) => { finishSave = resolve; }));
    nativeCards.createBuild.mockResolvedValue({
      id: "build-old-revision", cardId: card.id, revision: 1, status: "succeeded", stage: "ready",
      createdAt: 3, updatedAt: 4, issues: [],
    });
    const mounted = await mountEditor();
    const version = mounted.all((node) => node.tagName === "INPUT").find((node) => node.value === "1.0");
    version!.value = "1.1";
    version!.dispatchEvent(new Event("input"));
    await settleComponent();
    findAction(mounted.root, "save")?.click();
    await settleComponent();

    version!.value = "1.2";
    version!.dispatchEvent(new Event("input"));
    await settleComponent();
    findAction(mounted.root, "export")?.click();
    await settleComponent();

    expect(findById(mounted.root, "dialog-title")?.textContent).toBe("打包下载 ZIP");
    expect(findAction(mounted.root, "package-save")).toBeDefined();
    expect(findAction(mounted.root, "package-start")).toBeDefined();
    expect(findAction(mounted.root, "close-dialog")).toBeDefined();
    finishSave?.({ ...card, revision: 2, updatedAt: 2 });
    await settleComponent();
    expect(findById(mounted.root, "save-state")?.textContent).toContain("未保存");
    const sourceDialog = findById(mounted.root, "dialog-body");
    expect(sourceDialog?.textContent).toContain("打包上次保存内容会使用修订 1");
    expect(sourceDialog?.textContent).not.toContain("打包上次保存内容会使用修订 2");
    const sourceOptions = sourceDialog?.querySelectorAll("select")[0]?.options ?? [];
    expect(sourceOptions.find((option) => option.value === "current")?.textContent).toContain("修订 1");
    expect(sourceOptions.find((option) => option.value === "latest-saved")?.textContent).toContain("修订 2");
    expect(sourceDialog?.textContent).toContain("角色甲.zip");
    expect(sourceDialog?.textContent).toContain("1 个文件");
    expect(sourceDialog?.textContent).not.toContain("已保存新名称.zip");
    expect(sourceDialog?.textContent).not.toContain("2 个文件");

    findAction(mounted.root, "package-start")?.click();
    await settleComponent();
    expect(nativeCards.createBuild).toHaveBeenCalledWith({ cardId: card.id, source: { revision: 1 } });
    mounted.unmount();
  });

  it("saves pending edits before building the new saved revision", async () => {
    nativeCards.save.mockResolvedValue({ ...card, revision: 2, updatedAt: 2 });
    nativeCards.createBuild.mockResolvedValue({
      id: "build-new-revision", cardId: card.id, revision: 2, status: "succeeded", stage: "ready",
      createdAt: 3, updatedAt: 4, issues: [],
    });
    const mounted = await mountEditor();
    const version = mounted.all((node) => node.tagName === "INPUT").find((node) => node.value === "1.0");
    version!.value = "1.1";
    version!.dispatchEvent(new Event("input"));
    await settleComponent();
    findAction(mounted.root, "export")?.click();
    await settleComponent();
    findAction(mounted.root, "package-save")?.click();
    await settleComponent();

    expect(nativeCards.save).toHaveBeenCalledOnce();
    expect(nativeCards.createBuild).toHaveBeenCalledWith({ cardId: card.id, source: { revision: 2 } });
    mounted.unmount();
  });

  it("offers a new source selection after success and keeps published source choices", async () => {
    const versionedCard = {
      ...card,
      revision: 3,
      versions: [{ id: "published-v1", revision: 1, createdAt: 1 }],
    };
    nativeCards.createBuild
      .mockResolvedValueOnce({ id: "build-v1", cardId: card.id, revision: 1, versionId: "published-v1", status: "succeeded", stage: "ready", createdAt: 2, updatedAt: 3, issues: [] })
      .mockResolvedValueOnce({ id: "build-v2", cardId: card.id, revision: 3, status: "succeeded", stage: "ready", createdAt: 4, updatedAt: 5, issues: [] });
    const mounted = await mountEditor(versionedCard);
    findAction(mounted.root, "export")?.click();
    await settleComponent();
    const initialSource = findById(mounted.root, "dialog-body")?.querySelectorAll("select")[0];
    expect(initialSource).toBeDefined();
    selectValue(initialSource!, "published-v1");
    findAction(mounted.root, "package-save")?.click();
    await settleComponent();

    expect(findAction(mounted.root, "package-download")).toBeDefined();
    findAction(mounted.root, "package-rebuild")?.click();
    await settleComponent();
    expect(findById(mounted.root, "dialog-title")?.textContent).toBe("打包下载 ZIP");
    const nextSource = findById(mounted.root, "dialog-body")?.querySelectorAll("select")[0];
    expect(nextSource?.options.map((option) => option.value)).toContain("published-v1");
    expect(nextSource?.value).toBe("current");
    findAction(mounted.root, "package-save")?.click();
    await settleComponent();

    expect(nativeCards.createBuild.mock.calls[0]?.[0]).toMatchObject({ source: { versionId: "published-v1" } });
    expect(nativeCards.createBuild.mock.calls[1]?.[0]).toMatchObject({ source: { revision: 3 } });
    mounted.unmount();
  });

  it("retries a failed build using its original build task", async () => {
    const versionedCard = {
      ...card,
      revision: 3,
      versions: [{ id: "published-v1", revision: 1, createdAt: 1 }],
    };
    nativeCards.createBuild.mockResolvedValue({
      id: "build-original", cardId: card.id, revision: 1, versionId: "published-v1", status: "failed", stage: "archiving",
      createdAt: 2, updatedAt: 3, issues: [{ code: "NATIVE_CARD_BUILD_FAILED", path: "", message: "ZIP 写入失败", action: "请重试。" }],
    });
    nativeCards.retryBuild.mockResolvedValue({
      id: "build-original", cardId: card.id, revision: 1, versionId: "published-v1", status: "queued", stage: "validating",
      createdAt: 2, updatedAt: 4, issues: [],
    });
    const mounted = await mountEditor(versionedCard);
    findAction(mounted.root, "export")?.click();
    await settleComponent();
    selectValue(findById(mounted.root, "dialog-body")!.querySelectorAll("select")[0]!, "published-v1");
    findAction(mounted.root, "package-save")?.click();
    await settleComponent();

    expect(findAction(mounted.root, "package-retry")).toBeDefined();
    const focusSpy = vi.spyOn(ComponentNode.prototype, "focus");
    findAction(mounted.root, "package-retry")?.click();
    await settleComponent();
    expect(nativeCards.retryBuild).toHaveBeenCalledWith({ buildId: "build-original" });
    expect(mounted.root.textContent).toContain("来源修订 1 · published-v1");
    expect(focusSpy.mock.contexts.some((node) => (node as ComponentNode).props["aria-label"] === "关闭")).toBe(true);
    mounted.unmount();
  });

  it("shows a mapped retry request failure while preserving the original task issue", async () => {
    nativeCards.createBuild.mockResolvedValue({
      id: "build-original", cardId: card.id, revision: 1, status: "failed", stage: "archiving",
      createdAt: 2, updatedAt: 3, issues: [{ code: "NATIVE_CARD_BUILD_FAILED", path: "", message: "旧任务写入失败", action: "检查产物目录。" }],
    });
    nativeCards.retryBuild.mockRejectedValue(Object.assign(new Error("raw English failure"), { code: "NATIVE_CARD_BUILD_NOT_FOUND" }));
    const mounted = await mountEditor();
    findAction(mounted.root, "export")?.click();
    await settleComponent();
    findAction(mounted.root, "package-save")?.click();
    await settleComponent();
    const focusSpy = vi.spyOn(ComponentNode.prototype, "focus");

    findAction(mounted.root, "package-retry")?.click();
    await settleComponent();

    expect(mounted.root.textContent).toContain("旧任务写入失败");
    expect(mounted.root.textContent).toContain("重试请求失败；上次打包任务及其失败结果保持不变。");
    expect(mounted.root.textContent).toContain("打包任务或产物不存在或已到期，请为所需修订重新打包。");
    expect(mounted.root.textContent).not.toContain("raw English failure");
    expect(focusSpy.mock.contexts.some((node) => (node as ComponentNode).props["aria-label"] === "关闭")).toBe(true);
    mounted.unmount();
  });

  it("stops the download when the official SDK response has no artifact filename", async () => {
    nativeCards.createBuild.mockResolvedValue({
      id: "build-without-filename", cardId: card.id, revision: 1, status: "succeeded", stage: "ready",
      createdAt: 2, updatedAt: 3, issues: [],
    });
    nativeCards.downloadArtifact.mockResolvedValue({ blob: new Blob(["zip"]), fileName: null });
    const mounted = await mountEditor();
    findAction(mounted.root, "export")?.click();
    await settleComponent();
    findAction(mounted.root, "package-save")?.click();
    await settleComponent();
    const createObjectUrl = vi.spyOn(URL, "createObjectURL");
    const createElement = vi.mocked(mounted.browser.document.createElement);
    createElement.mockClear();

    findAction(mounted.root, "package-download")?.click();
    await settleComponent();

    expect(findById(mounted.root, "dialog-body")?.textContent).toContain("服务器没有提供 ZIP 文件名，本次未开始下载。");
    expect(createObjectUrl).not.toHaveBeenCalled();
    expect(createElement).not.toHaveBeenCalled();
    mounted.unmount();
  });

  it("shows only publication identity for a build source without snapshot name or file count and downloads the HTTP filename", async () => {
    const versionedCard = { ...card, versions: [{ id: "publication-original", revision: 1, createdAt: 1 }] };
    nativeCards.createBuild.mockResolvedValue({
      id: "build-publication", cardId: card.id, revision: 1, versionId: "publication-original",
      status: "succeeded", stage: "ready", createdAt: 2, updatedAt: 3, issues: [],
      downloadUrl: "/native-card-builds/build-publication/download",
    });
    nativeCards.downloadArtifact.mockResolvedValue({ blob: new Blob(["zip"]), fileName: "official-artifact.zip" });
    const mounted = await mountEditor(versionedCard);
    findAction(mounted.root, "export")?.click();
    await settleComponent();
    selectValue(findById(mounted.root, "dialog-body")!.querySelectorAll("select")[0]!, "publication-original");
    findAction(mounted.root, "package-save")?.click();
    await settleComponent();

    expect(mounted.root.textContent).toContain("来源修订 1 · publication-original");
    expect(findById(mounted.root, "dialog-body")?.textContent).not.toContain("角色甲.zip");
    expect(findById(mounted.root, "dialog-body")?.textContent).not.toContain("1 个文件");
    findAction(mounted.root, "close-dialog")?.click();
    await settleComponent();
    const name = mounted.all((node) => node.tagName === "INPUT").find((node) => node.value === "角色甲");
    name!.value = "本地未保存名称";
    name!.dispatchEvent(new Event("input"));
    await settleComponent();
    findById(mounted.root, "package-status-button")?.click();
    await settleComponent();

    expect(findById(mounted.root, "dialog-body")?.textContent).not.toContain("本地未保存名称.zip");
    expect(findById(mounted.root, "dialog-body")?.textContent).not.toContain("1 个文件");
    const createObjectUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:build-artifact");
    findAction(mounted.root, "package-download")?.click();
    await settleComponent();

    expect(nativeCards.downloadArtifact).toHaveBeenCalledWith({ buildId: "build-publication" });
    const anchor = vi.mocked(mounted.browser.document.createElement).mock.results.at(-1)?.value as unknown as ComponentNode & { download: string };
    expect(anchor?.download).toBe("official-artifact.zip");
    expect(createObjectUrl).toHaveBeenCalledOnce();
    createObjectUrl.mockRestore();
    mounted.unmount();
  });

  it("keeps a reopened import empty when its previous ZIP check completes", async () => {
    let finishCheck: ((value: unknown) => void) | undefined;
    nativeCards.checkImport.mockImplementation(() => new Promise((resolve) => { finishCheck = resolve; }));
    const mounted = await mountEditor();
    findAction(mounted.root, "catalog")?.click();
    await settleComponent();
    findAction(mounted.root, "import")?.click();
    await settleComponent();
    findById(mounted.root, "import-input")!.files = [new File(["zip"], "old.zip")];
    findById(mounted.root, "import-input")!.dispatchEvent(new Event("change"));
    await settleComponent();
    findAction(mounted.root, "import-check")?.click();
    await settleComponent();
    findAction(mounted.root, "close-dialog")?.click();
    await settleComponent();
    findAction(mounted.root, "import")?.click();
    await settleComponent();
    finishCheck?.({ id: "old", fileName: "old.zip", packageId: "old", name: "old", files: [], issues: [], status: "ready", summary: importSummary });
    await settleComponent();
    expect(findById(mounted.root, "dialog-title")?.textContent).toBe("导入角色包");
    expect(findAction(mounted.root, "import-confirm")).toBeUndefined();
    expect(findAction(mounted.root, "import-check")?.props.disabled).toBe(true);
    mounted.unmount();
  });

  it("shows no import confirmation until a ZIP check is ready and preserves check progress focus target", async () => {
    let finishCheck: ((result: { id: string; fileName: string; packageId: string; name: string; files: Array<{ path: string; mediaType: string; purpose: string; byteSize: number }>; issues: never[]; summary: typeof importSummary; status: "ready" }) => void) | undefined;
    nativeCards.checkImport.mockImplementation(() => new Promise((resolve) => { finishCheck = resolve; }));
    const mounted = await mountEditor();
    findAction(mounted.root, "catalog")?.click();
    await settleComponent();
    findAction(mounted.root, "import")?.click();
    await settleComponent();
    const focusSpy = vi.spyOn(ComponentNode.prototype, "focus");

    expect(findById(mounted.root, "dialog-title")?.textContent).toBe("导入角色包");
    expect(findAction(mounted.root, "import-check")?.props.disabled).toBe(true);
    expect(findAction(mounted.root, "import-check")?.props.class).toBe("primary");
    expect(findAction(mounted.root, "import-confirm")).toBeUndefined();
    findById(mounted.root, "import-input")!.files = [new File(["zip"], "card.zip", { type: "application/zip" })];
    findById(mounted.root, "import-input")!.dispatchEvent(new Event("change"));
    await settleComponent();
    findAction(mounted.root, "import-check")?.click();
    await settleComponent();

    expect(findById(mounted.root, "dialog-title")?.textContent).toBe("检查角色包");
    expect(findById(mounted.root, "dialog-body")?.textContent).toContain("正在上传并检查 card.zip");
    expect(findAction(mounted.root, "import-check")).toBeUndefined();
    expect(findAction(mounted.root, "import-confirm")).toBeUndefined();
    expect(findAction(mounted.root, "close-dialog")).toBeDefined();
    expect(focusSpy.mock.contexts.some((node) => (node as ComponentNode).props["aria-label"] === "关闭")).toBe(true);
    finishCheck?.({ id: "import-ready", fileName: "card.zip", packageId: "package", name: "导入角色", files: [], issues: [], summary: importSummary, status: "ready" });
    await settleComponent();

    expect(findById(mounted.root, "dialog-title")?.textContent).toBe("确认导入角色包");
    expect(findAction(mounted.root, "import-confirm")).toBeDefined();
    expect(findAction(mounted.root, "import-confirm")?.props.disabled).not.toBe(true);
    mounted.unmount();
  });

  it.each([
    ["NATIVE_CARD_IMPORT_NOT_FOUND", "导入检查任务不存在或已到期，请重新选择 ZIP 并检查。"],
    ["NATIVE_CARD_STORAGE_FAILURE", "角色卡文件或数据库操作失败。读取时请重试；保存时请保留修改并核对服务器修订；导入时请保留当前窗口，点击“重试导入”核对本次任务结果。"],
  ])("shows import validation failures and retries confirmation after %s", async (code, message) => {
    nativeCards.checkImport.mockResolvedValue({
      id: "import-invalid", fileName: "invalid.zip", packageId: "package", name: "角色",
      files: [
        { path: "character.json", mediaType: "application/json", purpose: "data", byteSize: 10 },
        { path: "assets/unrelated-preview.svg", mediaType: "image/svg+xml", purpose: "media", byteSize: 20 },
      ], issues: [{ code: "NATIVE_CARD_PACKAGE_INVALID", path: "character.json", pointer: "/name", message: "人物文件无效。", action: "修正人物文件。", expected: "name must be a non-empty string", line: 2, column: 3 }], status: "invalid",
    });
    const imported = { ...card, id: "card-imported", name: "导入角色", revision: 1 };
    nativeCards.confirmImport.mockRejectedValueOnce(Object.assign(new Error("expired"), { code }))
      .mockResolvedValueOnce(imported);
    const mounted = await mountEditor();
    findAction(mounted.root, "catalog")?.click();
    await settleComponent();
    findAction(mounted.root, "import")?.click();
    await settleComponent();
    findById(mounted.root, "import-input")!.files = [new File(["zip"], "invalid.zip", { type: "application/zip" })];
    findById(mounted.root, "import-input")!.dispatchEvent(new Event("change"));
    await settleComponent();
    findAction(mounted.root, "import-check")?.click();
    await settleComponent();

    expect(findById(mounted.root, "dialog-title")?.textContent).toBe("角色包检查失败");
    expect(findAction(mounted.root, "import-confirm")).toBeUndefined();
    expect(findAction(mounted.root, "import-recheck")).toBeDefined();
    expect(findById(mounted.root, "dialog-body")?.textContent).toContain("character.json");
    expect(findById(mounted.root, "dialog-body")?.textContent).toContain("/name");
    expect(findById(mounted.root, "dialog-body")?.textContent).toContain("校验详情");
    expect(findById(mounted.root, "dialog-body")?.textContent).toContain("name must be a non-empty string");
    expect(findById(mounted.root, "dialog-body")?.textContent).not.toContain("assets/unrelated-preview.svg");
    nativeCards.checkImport.mockResolvedValueOnce({
      id: "import-ready", fileName: "invalid.zip", packageId: "package", name: "导入角色",
      files: [
        { path: "character.json", mediaType: "application/json", purpose: "data", byteSize: 10 },
        { path: "openings.json", mediaType: "application/json", purpose: "data", byteSize: 10 },
        { path: "assets/portrait.svg", mediaType: "image/svg+xml", purpose: "media", byteSize: 10 },
      ], issues: [], summary: importSummary, status: "ready",
    });
    findAction(mounted.root, "import-recheck")?.click();
    await settleComponent();
    await settleComponent();
    const readyBody = findById(mounted.root, "dialog-body")?.textContent ?? "";
    expect(readyBody).toContain("文件格式和资源引用检查通过");
    expect(readyBody).toContain("2 本，保留条目顺序");
    expect(readyBody).toContain("1 个开场及对应初始变量");
    expect(readyBody).toContain("预设和模型使用系统配置，可在管理端设置。");
    expect(readyBody).not.toContain("assets/portrait.svg");
    findAction(mounted.root, "import-confirm")?.click();
    await settleComponent();
    expect(mounted.root.textContent).toContain(message);
    expect(mounted.root.textContent).not.toContain("数据库写入失败");
    if (code === "NATIVE_CARD_IMPORT_NOT_FOUND") {
      expect(findById(mounted.root, "dialog-title")?.textContent).toBe("导入检查已失效");
      expect(findAction(mounted.root, "import-confirm-retry")).toBeUndefined();
      expect(mounted.root.textContent).not.toContain("请重试读取本次导入结果");
      nativeCards.checkImport.mockResolvedValueOnce({
        id: "import-renewed", fileName: "invalid.zip", packageId: "package", name: "导入角色",
        files: [], issues: [], summary: importSummary, status: "ready",
      });
      findAction(mounted.root, "import-recheck")?.click();
      await settleComponent();
      expect(nativeCards.checkImport).toHaveBeenCalledTimes(3);
      expect(findById(mounted.root, "dialog-title")?.textContent).toBe("确认导入角色包");
      findAction(mounted.root, "import-confirm")?.click();
      await settleComponent();
      expect(nativeCards.confirmImport).toHaveBeenLastCalledWith({ importId: "import-renewed" });
    } else {
      expect(findById(mounted.root, "dialog-title")?.textContent).toBe("导入结果待确认");
      expect(mounted.root.textContent).toContain("未能确认导入结果。请点击“重试导入”，继续核对本次导入任务的结果。");
      findAction(mounted.root, "import-confirm-retry")?.click();
      await settleComponent();
      expect(nativeCards.confirmImport).toHaveBeenLastCalledWith({ importId: "import-ready" });
    }
    expect(findById(mounted.root, "dialog-title")?.textContent).toBe("角色包已导入");
    expect(mounted.root.textContent).toContain("角色卡 #card-imported · 已保存修订 1");
    expect(findAction(mounted.root, "open-imported-card")).toBeDefined();
    nativeCards.readFile.mockImplementation(({ path }: { path: string }) => Promise.resolve({
      path, mediaType: "application/json", encoding: "utf8", content: JSON.stringify({ name: "导入角色", characterVersion: "1.0" }),
    }));
    findAction(mounted.root, "open-imported-card")?.click();
    await settleComponent();
    expect(findById(mounted.root, "role-name")?.textContent).toBe("导入角色");
    mounted.unmount();
  });

  it("keeps the import dialog focused through the disabled commit progress and success actions", async () => {
    let finishImport: ((imported: typeof card) => void) | undefined;
    nativeCards.checkImport.mockResolvedValue({
      id: "import-ready", fileName: "ready.zip", packageId: "package", name: "导入角色",
      files: [{ path: "character.json", mediaType: "application/json", purpose: "data", byteSize: 10 }], issues: [], summary: importSummary, status: "ready",
    });
    nativeCards.confirmImport.mockImplementation(() => new Promise((resolve) => { finishImport = resolve; }));
    const mounted = await mountEditor();
    findAction(mounted.root, "catalog")?.click();
    await settleComponent();
    findAction(mounted.root, "import")?.click();
    await settleComponent();
    findById(mounted.root, "import-input")!.files = [new File(["zip"], "ready.zip", { type: "application/zip" })];
    findById(mounted.root, "import-input")!.dispatchEvent(new Event("change"));
    await settleComponent();
    findAction(mounted.root, "import-check")?.click();
    await settleComponent();
    const focusSpy = vi.spyOn(ComponentNode.prototype, "focus");

    findAction(mounted.root, "import-confirm")?.click();
    await settleComponent();

    expect(findById(mounted.root, "dialog-title")?.textContent).toBe("正在导入角色包");
    expect(findById(mounted.root, "dialog-body")?.textContent).toContain("正在保存人物、资源文件及关联关系");
    expect(findAction(mounted.root, "import-confirm")).toBeUndefined();
    expect(findAction(mounted.root, "import-progress")?.textContent).toBe("正在导入");
    expect(Object.hasOwn(findAction(mounted.root, "import-progress")?.props ?? {}, "disabled")).toBe(true);
    expect(focusSpy.mock.contexts.some((node) => (node as ComponentNode).props["aria-label"] === "关闭")).toBe(true);

    finishImport?.({ ...card, id: "card-imported", name: "导入角色" });
    await settleComponent();
    expect(findById(mounted.root, "dialog-title")?.textContent).toBe("角色包已导入");
    expect(findAction(mounted.root, "open-imported-card")).toBeDefined();
    expect(focusSpy.mock.contexts.some((node) => (node as ComponentNode).props["data-action"] === "open-imported-card")).toBe(true);
    mounted.unmount();
  });

  it("uses the shared state-update rules schema template for custom allowed rule filenames", async () => {
    const mounted = await mountEditor();
    findAction(mounted.root, "new-file")?.click();
    await settleComponent();
    const body = findById(mounted.root, "dialog-body");
    const directory = body?.querySelectorAll("select")[0];
    const ruleIndex = directory?.options.findIndex((option) => option.textContent.includes("agents/state-update/*.json")) ?? -1;
    expect(ruleIndex).toBeGreaterThanOrEqual(0);
    selectValue(directory!, String(ruleIndex));
    const pathInput = body?.querySelectorAll("input")[0];
    expect(pathInput).toBeDefined();
    pathInput!.value = "agents/state-update/browser-final.json";
    pathInput!.dispatchEvent(new Event("input"));
    await settleComponent();
    findAction(mounted.root, "create-resource")?.click();
    await settleComponent();

    expect(findById(mounted.root, "file-path")?.textContent).toBe("agents/state-update/browser-final.json");
    expect(JSON.parse(String(findById(mounted.root, "source-editor")?.value))).toEqual({ rules: [] });
    mounted.unmount();
  });

  it("keeps the fixed state-update profile template for its canonical path", async () => {
    const mounted = await mountEditor();
    findAction(mounted.root, "new-file")?.click();
    await settleComponent();
    const body = findById(mounted.root, "dialog-body");
    const directory = body?.querySelectorAll("select")[0];
    const ruleIndex = directory?.options.findIndex((option) => option.textContent.includes("agents/state-update/*.json")) ?? -1;
    expect(ruleIndex).toBeGreaterThanOrEqual(0);
    selectValue(directory!, String(ruleIndex));
    const pathInput = body?.querySelectorAll("input")[0];
    expect(pathInput).toBeDefined();
    pathInput!.value = "agents/state-update/profile.json";
    pathInput!.dispatchEvent(new Event("input"));
    await settleComponent();
    findAction(mounted.root, "create-resource")?.click();
    await settleComponent();

    expect(JSON.parse(String(findById(mounted.root, "source-editor")?.value))).toMatchObject({
      stateSchemaFile: "state/schema.json",
      ruleFiles: [],
    });
    mounted.unmount();
  });

  it("renders the file tree in the configured prototype order with explicit backend subdirectories and empty groups", async () => {
    const files = [
      "manifest.json", "character.json", "openings.json", "openings/first.txt", "state/schema.json",
      "agents/state-update/profile.json", "backend/controllers/config.json", "backend/validators/validate.js",
      "backend/variable-tools/derive.js", "frontend/manifest.json", "regex/default.json", "assets/portrait.svg",
    ].map((path) => ({ path, mediaType: "application/json", purpose: "data", byteSize: 2 }));
    const mounted = await mountEditor({ ...card, files });
    findById(mounted.root, "nav-files")?.click();
    await settleComponent();

    const groups = findById(mounted.root, "navigation")?.querySelectorAll("details") ?? [];
    expect(groups.map((group) => group.props["data-group"])).toEqual([
      "worldbooks", "openings", "state", "agents", "backend/controllers", "backend/validators",
      "backend/variable-tools", "frontend", "regex", "assets", "data", "根目录",
    ]);
    expect(groups.find((group) => group.props["data-group"] === "backend/validators")?.textContent).toContain("validate.js");
    expect(groups.find((group) => group.props["data-group"] === "backend/variable-tools")?.textContent).toContain("derive.js");
    expect(groups.find((group) => group.props["data-group"] === "data")?.children.some((node) => node.props["data-file"])).toBe(false);
    expect(groups.find((group) => group.props["data-group"] === "worldbooks")?.children.some((node) => node.props["data-file"])).toBe(false);
    mounted.unmount();
  });

  it("keeps the opening text field wrapper, textarea, and path inside the prototype structure", async () => {
    const openingCard = {
      ...card,
      files: [
        ...card.files,
        { path: "openings.json", mediaType: "application/json", purpose: "data", byteSize: 2 },
        { path: "openings/first.txt", mediaType: "text/plain", purpose: "data", byteSize: 0 },
      ],
    };
    const openingReadFile = ({ path }: { path: string }) => Promise.resolve({
      path,
      mediaType: path.endsWith(".txt") ? "text/plain" : "application/json",
      encoding: "utf8",
      content: path === "openings.json"
        ? JSON.stringify({ defaultOpeningIds: { individual: "first" }, items: [{ id: "first", title: "开场", kind: "story", textFile: "openings/first.txt" }] })
        : path === "character.json" ? '{"name":"角色甲","characterVersion":"1.0"}' : "",
    });
    const mounted = await mountEditor(openingCard, openingReadFile);
    mounted.all((node) => node.props["data-domain"] === "openings")[0]?.click();
    await settleComponent();

    const textarea = mounted.all((node) => node.tagName === "TEXTAREA").find((node) => node.parent?.tagName === "LABEL");
    const field = textarea?.parent?.parent;
    expect(field?.tagName).toBe("DIV");
    expect(field?.props.class).toBe("field");
    expect(field?.children.some((node) => node.props.class === "filepath" && node.textContent === "openings/first.txt")).toBe(true);
    mounted.unmount();
  });
});
