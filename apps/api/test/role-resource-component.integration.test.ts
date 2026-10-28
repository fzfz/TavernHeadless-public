import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadStorageConfig } from "../src/storage-config.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTavernClient, type TavernClient } from "@tavern/sdk";
import { apiErrorMessages, PROMPT_ASSET_REQUEST_LIMITS } from "@tavern/shared";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "./helpers/create-test-db.js";
import RoleResourceLibrary from "../../web/src/components/workspace/RoleResourceLibrary.vue";
import {
  ComponentNode,
  mountComponent,
  settleComponent,
} from "../../web/src/test/component-host.js";

const bridge = vi.hoisted(() => ({
  client: undefined as TavernClient | undefined,
}));
vi.mock("../../web/src/lib/api.js", () => ({
  get apiClient() {
    return bridge.client;
  },
}));

describe("resource file event through Vue, SDK and API", () => {
  let app: FastifyInstance;
  let deletionGate: Promise<void> | undefined;
  let dataRoot: string;
  let host: ReturnType<typeof mountComponent> | undefined;
  let responseStatuses: number[];
  let apiResponses: Array<{ method: string; path: string; status: number }>;
  let localStorageValues: Map<string, string>;
  let originalMasterKey: string | undefined;
  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), "role-component-"));
    deletionGate = undefined;
    responseStatuses = [];
    apiResponses = [];
    localStorageValues = new Map();
    originalMasterKey = process.env.APP_SECRETS_MASTER_KEY;
    process.env.APP_SECRETS_MASTER_KEY = "role-component-test-master-key";
    app = (
      await buildTestApp({
        databasePath: ":memory:",
        storage: loadStorageConfig({ DATA_DIR: dataRoot }),
        logger: false,
        llmProfileApiMode: "chat",
        auth: { mode: "off" },
      })
    ).app;
    bridge.client = createTavernClient({
      baseUrl: "http://local.test",
      fetchImpl: async (input, init) => {
        const url = new URL(String(input));
        const method = init?.method ?? "GET";
        if (method === "DELETE") await deletionGate;
        const response = await app.inject({
          method: method as "GET" | "POST" | "PUT" | "DELETE" | "PATCH",
          url: url.pathname + url.search,
          headers: Object.fromEntries(new Headers(init?.headers)),
          payload: init?.body as string | undefined,
        });
        responseStatuses.push(response.statusCode);
        apiResponses.push({
          method,
          path: url.pathname,
          status: response.statusCode,
        });
        return new Response(
          response.statusCode === 204 ? null : response.body,
          {
            status: response.statusCode,
            headers: response.headers as Record<string, string>,
          },
        );
      },
    });
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => localStorageValues.get(key) ?? null,
      setItem: (key: string, value: string) =>
        localStorageValues.set(key, value),
    });
    vi.stubGlobal("document", { activeElement: null });
  });
  afterEach(async () => {
    host?.unmount();
    await app.close();
    await rm(dataRoot, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (originalMasterKey === undefined)
      delete process.env.APP_SECRETS_MASTER_KEY;
    else process.env.APP_SECRETS_MASTER_KEY = originalMasterKey;
  });
  async function open(kind = "preset") {
    host = mountComponent(RoleResourceLibrary, { kind });
    await vi.waitFor(() =>
      expect(host!.all((n) => n.tagName === "DIALOG")[0]?.open).toBe(true),
    );
    return host;
  }
  async function upload(text: string) {
    host!
      .all(
        (node) =>
          node.tagName === "BUTTON" && node.textContent.trim() === "导入 JSON",
      )[0]!
      .click();
    const input = host!.all(
      (n) => n.tagName === "INPUT" && n.props.type === "file",
    )[0]!;
    input.files = [new File([text], "test.json", { type: "application/json" })];
    input.value = "test.json";
    input.dispatchEvent(new Event("change"));
    await settleComponent();
    await vi.waitFor(() =>
      expect(
        host!
          .all((n) => n.props.role === "status")
          .some((n) => n.textContent.includes("读取")),
      ).toBe(false),
    );
  }
  const descendants = (node: ComponentNode): ComponentNode[] => [
    node,
    ...node.children.flatMap(descendants),
  ];
  const cards = () => host!.all((node) => node.props.class === "resource-card");
  const cardName = (card: ComponentNode) =>
    descendants(card)
      .find((node) => node.tagName === "STRONG")
      ?.textContent.trim();
  const visibleNames = () => cards().map((card) => cardName(card));
  const resourceCard = (name: string) =>
    cards().find((card) => cardName(card) === name);
  const cardButton = (name: string, label: string) =>
    descendants(resourceCard(name)!).find(
      (node) => node.tagName === "BUTTON" && node.textContent.trim() === label,
    )!;
  const clickButton = (label: string) =>
    host!
      .all(
        (node) =>
          node.tagName === "BUTTON" && node.textContent.trim() === label,
      )[0]!
      .click();
  const labeledControl = (label: string, tagName: string) => {
    const parent = host!.all(
      (node) =>
        node.tagName === "LABEL" && node.textContent.trim().startsWith(label),
    )[0]!;
    return descendants(parent).find((node) => node.tagName === tagName)!;
  };
  const setTextControl = async (label: string, value: string) => {
    const input = labeledControl(label, "INPUT");
    input.value = value;
    input.dispatchEvent(new Event("input"));
    await settleComponent();
  };
  const setSelectControl = async (label: string, value: string) => {
    const select = labeledControl(label, "SELECT");
    select.value = value;
    select.options.forEach((option) => {
      option.selected = option.value === value;
    });
    select.dispatchEvent(new Event("change"));
    await settleComponent();
  };
  async function createPreset(name: string, content = `${name} content`) {
    return bridge.client!.imports.preset({
      name,
      data: {
        default_character_id: 100001,
        prompts: [
          {
            identifier: "main",
            name: "Main",
            role: "system",
            content,
            system_prompt: true,
            enabled: true,
          },
        ],
        prompt_order: [
          {
            character_id: 100001,
            order: [{ identifier: "main", enabled: true }],
          },
        ],
      },
    });
  }
  async function createPersona(name: string, status: "active" | "disabled") {
    const user = await bridge.client!.users.create({
      snapshot: { name, description: `${name} description` },
    });
    if (status === "disabled")
      await bridge.client!.users.update({ userId: user.id, status });
    return user;
  }
  const waitForNames = async (names: string[]) =>
    vi.waitFor(() => expect(visibleNames()).toEqual(names));
  it("reports invalid JSON instead of a network error and resets the file input", async () => {
    await open();
    await upload("{");
    expect(host!.root.textContent).toContain(
      "JSON 格式不正确，请检查括号、引号和逗号后重试。",
    );
    expect(host!.root.textContent).not.toContain("检查网络");
  });
  it("shows the configured payload-too-large message after Fastify rejects a preset save", async () => {
    await open();
    await upload(
      JSON.stringify({
        prompts: [
          {
            identifier: "main",
            name: "main",
            role: "system",
            content: "Large preset",
            enabled: true,
          },
        ],
        prompt_order: [
          {
            character_id: 100001,
            order: [{ identifier: "main", enabled: true }],
          },
        ],
        size_probe: "x".repeat(PROMPT_ASSET_REQUEST_LIMITS.bodyLimitBytes),
      }),
    );

    const save = host!.all(
      (node) =>
        node.tagName === "BUTTON" && node.textContent.trim() === "保存资源",
    )[0]!;
    responseStatuses.length = 0;
    save.click();

    await vi.waitFor(() => expect(responseStatuses).toContain(413));
    await vi.waitFor(() =>
      expect(
        host!
          .all((node) => node.props.role === "alert")
          .some((node) =>
            node.textContent
              .trim()
              .startsWith(apiErrorMessages.payload_too_large),
          ),
      ).toBe(true),
    );
    expect(responseStatuses).toContain(413);
    expect(host!.root.textContent).not.toContain(
      apiErrorMessages.ROLE_USER_REQUEST_FAILED,
    );
  });
  it("filters resources through the visible search field without another API request", async () => {
    await createPreset("Alpha Resource");
    await createPreset("Bravo Resource");
    await open();

    const initialRequestCount = apiResponses.length;
    const searchInput = labeledControl("搜索资源名称", "INPUT");
    searchInput.value = "Alpha";
    searchInput.dispatchEvent(new Event("input"));
    await settleComponent();
    await waitForNames(["Alpha Resource"]);

    searchInput.value = "missing";
    searchInput.dispatchEvent(new Event("input"));
    await settleComponent();
    expect(visibleNames()).toEqual([]);
    expect(host!.root.textContent).toContain("没有符合条件的资源");
    expect(apiResponses).toHaveLength(initialRequestCount);
  });
  it("sorts visible resources by title and then by update time", async () => {
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(1_800_000_000_000);
    await createPreset("Alpha Resource");
    now.mockReturnValue(1_800_000_001_000);
    await createPreset("Zulu Resource");
    now.mockReturnValue(1_800_000_002_000);
    await createPreset("Bravo Resource");
    now.mockRestore();
    const byUpdatedAt = (await bridge.client!.presets.list())
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map((item) => item.name);
    await open();

    expect(visibleNames()).toEqual(byUpdatedAt);
    await setSelectControl("资源排序", "name");
    await waitForNames(["Alpha Resource", "Bravo Resource", "Zulu Resource"]);
    await setSelectControl("资源排序", "updated");
    await waitForNames(byUpdatedAt);
  });
  it("toggles and persists favorites, then filters to the saved favorite", async () => {
    const favorite = await createPreset("Favorite Resource");
    await createPreset("Other Resource");
    await open();

    cardButton("Favorite Resource", "收藏").click();
    await settleComponent();
    expect(
      JSON.parse(localStorageValues.get("tavern.role-resource-favorites")!),
    ).toEqual([favorite.id]);
    expect(cardButton("Favorite Resource", "取消收藏")).toBeDefined();

    const favoritesOnly = labeledControl("仅收藏", "INPUT");
    favoritesOnly.checked = true;
    favoritesOnly.dispatchEvent(new Event("change"));
    await settleComponent();
    await waitForNames(["Favorite Resource"]);

    host!.unmount();
    host = undefined;
    await open();
    expect(cardButton("Favorite Resource", "取消收藏")).toBeDefined();
    expect(
      JSON.parse(localStorageValues.get("tavern.role-resource-favorites")!),
    ).toEqual([favorite.id]);
  });
  it("filters persona resources by active and disabled status", async () => {
    await createPersona("Active Persona", "active");
    await createPersona("Disabled Persona", "disabled");
    await open("persona");

    await waitForNames(["Active Persona"]);
    await setSelectControl("资源状态", "disabled");
    await waitForNames(["Disabled Persona"]);
    await setSelectControl("资源状态", "all");
    await vi.waitFor(() =>
      expect(visibleNames().sort()).toEqual([
        "Active Persona",
        "Disabled Persona",
      ]),
    );
  });
  it("rejects a scalar JSON preset with an actionable format error", async () => {
    await open();
    await upload("null");
    await vi.waitFor(() =>
      expect(host!.all((n) => n.props.role === "alert").length).toBeGreaterThan(
        0,
      ),
    );
    expect(host!.root.textContent).not.toContain("检查网络");
    expect(await bridge.client!.presets.list()).toHaveLength(0);
  });
  it("loads valid JSON into the editor without creating a resource before save", async () => {
    await open();
    await upload(
      JSON.stringify({
        prompts: [
          {
            identifier: "main",
            name: "main",
            role: "system",
            content: "Integration import",
            enabled: true,
          },
        ],
        prompt_order: [
          {
            character_id: 100001,
            order: [{ identifier: "main", enabled: true }],
          },
        ],
      }),
    );
    await vi.waitFor(() =>
      expect(host!.all((n) => n.tagName === "TEXTAREA").length).toBeGreaterThan(
        0,
      ),
    );
    expect(await bridge.client!.presets.list()).toHaveLength(0);
  });
  it("creates exactly one resource only after saving an imported preset", async () => {
    await open();
    await upload(
      JSON.stringify({
        prompts: [
          {
            identifier: "main",
            name: "main",
            role: "system",
            content: "Saved import",
            enabled: true,
          },
        ],
      }),
    );
    const save = host!.all(
      (n) => n.tagName === "BUTTON" && n.textContent.trim() === "保存资源",
    )[0]!;
    save.click();
    save.click();
    await vi.waitFor(async () =>
      expect(await bridge.client!.presets.list()).toHaveLength(1),
    );
    await vi.waitFor(() =>
      expect(host!.root.textContent).toContain("资源已保存"),
    );
  });
  it("allows keeping the imported draft, then discarding it without writing", async () => {
    await open();
    await upload(JSON.stringify({ prompts: [] }));
    const click = (label: string) =>
      host!
        .all(
          (n) => n.tagName === "BUTTON" && n.textContent.trim() === label,
        )[0]!
        .click();
    click("取消编辑");
    await settleComponent();
    click("继续编辑");
    await settleComponent();
    expect(
      host!.all(
        (n) => n.tagName === "BUTTON" && n.textContent.trim() === "保存资源",
      ),
    ).toHaveLength(1);
    click("取消编辑");
    await settleComponent();
    click("放弃修改");
    await settleComponent();
    expect(await bridge.client!.presets.list()).toHaveLength(0);
  });

  it("executes the unsaved regex editor against the real preview API", async () => {
    await open("regex");
    await upload(
      JSON.stringify([
        {
          scriptName: "replace greeting",
          findRegex: "/hello/g",
          replaceString: "welcome",
          placement: [2],
          disabled: false,
        },
      ]),
    );
    const field = host!.all(
      (n) => n.tagName === "LABEL" && n.textContent.trim() === "输入文本",
    )[0]!;
    const input = field.children.find((n) => n.tagName === "TEXTAREA")!;
    input.value = "hello visitor";
    input.dispatchEvent(new Event("input"));
    await settleComponent();
    host!
      .all(
        (n) => n.tagName === "BUTTON" && n.textContent.trim() === "运行测试",
      )[0]!
      .click();
    await vi.waitFor(() =>
      expect(host!.root.textContent).toContain("welcome visitor"),
    );
    expect(await bridge.client!.regexProfiles.list()).toHaveLength(0);
  });
  it("preserves regex extension fields from source JSON through first save and export", async () => {
    await open("regex");
    await upload(
      JSON.stringify([
        {
          scriptName: "extension rule",
          findRegex: "/hello/g",
          replaceString: "welcome",
          placement: [2],
          extension_settings: { color: "blue", priority: 7 },
        },
      ]),
    );
    host!
      .all(
        (n) => n.tagName === "BUTTON" && n.textContent.trim() === "保存资源",
      )[0]!
      .click();
    await vi.waitFor(async () =>
      expect(await bridge.client!.regexProfiles.list()).toHaveLength(1),
    );
    const [profile] = await bridge.client!.regexProfiles.list();
    const exported = await (
      await bridge.client!.exports.regex({ profileId: profile!.id })
    ).json();
    expect(exported[0].extension_settings).toEqual({
      color: "blue",
      priority: 7,
    });
    await vi.waitFor(() =>
      expect(host!.root.textContent).toContain("资源已保存"),
    );
    const nameInput = host!
      .all(
        (n) => n.tagName === "LABEL" && n.textContent.trim() === "资源名称",
      )[0]!
      .children.find((n) => n.tagName === "INPUT")!;
    nameInput.value = "Renamed extension rule";
    nameInput.dispatchEvent(new Event("input"));
    await settleComponent();
    host!
      .all(
        (n) => n.tagName === "BUTTON" && n.textContent.trim() === "保存资源",
      )[0]!
      .click();
    await vi.waitFor(async () =>
      expect((await bridge.client!.regexProfiles.list())[0]!.name).toBe(
        "Renamed extension rule",
      ),
    );
    const updated = await (
      await bridge.client!.exports.regex({ profileId: profile!.id })
    ).json();
    expect(updated[0].extension_settings).toEqual({
      color: "blue",
      priority: 7,
    });
  });
  it("edits a resource and saves a copy only after the visible save action", async () => {
    const original = await createPreset("Source preset");
    await open();
    cardButton("Source preset", "编辑").click();
    await vi.waitFor(() =>
      expect(host!.root.textContent).toContain("保存资源"),
    );
    await setTextControl("资源名称", "Edited preset");
    clickButton("保存资源");
    await vi.waitFor(async () =>
      expect(
        (await bridge.client!.presets.getEditor({ presetId: original.id }))
          .name,
      ).toBe("Edited preset"),
    );
    host!.unmount();
    await open();
    cardButton("Edited preset", "复制").click();
    await vi.waitFor(() =>
      expect(labeledControl("资源名称", "INPUT").value).toBe(
        "Edited preset 副本",
      ),
    );
    expect(await bridge.client!.presets.list()).toHaveLength(1);
    clickButton("保存资源");
    await vi.waitFor(async () =>
      expect(await bridge.client!.presets.list()).toHaveLength(2),
    );
    expect(
      (await bridge.client!.presets.getEditor({ presetId: original.id })).name,
    ).toBe("Edited preset");
  });
  it("keeps deletion confirmation open while the API request is pending", async () => {
    await createPreset("Pending deletion");
    await open();
    cardButton("Pending deletion", "删除").click();
    await settleComponent();
    let release!: () => void;
    deletionGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      clickButton("确认");
      await settleComponent();
      const dialog = host!.all((node) => node.props.role === "alertdialog")[0]!;
      const cancel = host!.all(
        (node) =>
          node.tagName === "BUTTON" && node.textContent.trim() === "取消",
      )[0]!;
      expect(cancel.props.disabled).toBe(true);
      cancel.click();
      dialog.dispatchEvent(
        Object.assign(new Event("keydown", { cancelable: true }), {
          key: "Escape",
        }),
      );
      await settleComponent();
      expect(
        host!.all((node) => node.props.role === "alertdialog"),
      ).toHaveLength(1);
    } finally {
      release();
    }
    await vi.waitFor(() =>
      expect(
        host!.all((node) => node.props.role === "alertdialog"),
      ).toHaveLength(0),
    );
    expect(await bridge.client!.presets.list()).toHaveLength(0);
  });
  it("cancels resource deletion and deletes only after confirmation", async () => {
    const original = await createPreset("Delete preset");
    await open();
    cardButton("Delete preset", "删除").click();
    await settleComponent();
    clickButton("取消");
    await settleComponent();
    expect(
      (await bridge.client!.presets.getEditor({ presetId: original.id })).name,
    ).toBe("Delete preset");
    cardButton("Delete preset", "删除").click();
    await settleComponent();
    clickButton("确认");
    await vi.waitFor(() => expect(visibleNames()).toEqual([]));
    expect(await bridge.client!.presets.list()).toEqual([]);
  });
  it("exports an actual JSON Blob through the download action and reports a deleted source", async () => {
    const original = await createPreset("Export preset");
    let downloaded: Blob | undefined;
    const anchor = { href: "", download: "", click: vi.fn() };
    vi.stubGlobal("document", {
      activeElement: null,
      createElement: () => anchor,
    });
    const objectUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockImplementation((blob) => {
        downloaded = blob as Blob;
        return "blob:test-export";
      });
    const revoke = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    try {
      await open();
      cardButton("Export preset", "导出").click();
      await vi.waitFor(() => expect(anchor.click).toHaveBeenCalledOnce());
      expect(anchor.download).toBe("Export preset.json");
      expect(JSON.parse(await downloaded!.text()).prompts[0].content).toBe(
        "Export preset content",
      );
      expect(revoke).toHaveBeenCalledWith("blob:test-export");
      await bridge.client!.presets.remove({ presetId: original.id });
      cardButton("Export preset", "导出").click();
      await vi.waitFor(() =>
        expect(host!.root.textContent).toContain(
          apiErrorMessages.preset_not_found,
        ),
      );
      expect(anchor.click).toHaveBeenCalledOnce();
    } finally {
      objectUrl.mockRestore();
      revoke.mockRestore();
    }
  });
  it("reports the actual in-use model deletion error and permits retry after unbinding", async () => {
    const model = await bridge.client!.llmProfiles.create({
      presetName: "Bound model",
      provider: "openai-compatible",
      modelId: "offline",
      apiKey: "test-only",
    });
    await bridge.client!.llmProfiles.activate({
      profileId: model.id,
      scope: "global",
      slot: "narrator",
    });
    await open("model");
    cardButton("Bound model", "删除").click();
    await settleComponent();
    clickButton("确认");
    await vi.waitFor(() =>
      expect(host!.root.textContent).toContain(apiErrorMessages.profile_in_use),
    );
    expect(host!.root.textContent).not.toContain("检查网络");
    await bridge.client!.llmProfiles.unbind({
      scope: "global",
      slot: "narrator",
    });
    clickButton("确认");
    await vi.waitFor(() => expect(visibleNames()).toEqual([]));
    expect(await bridge.client!.llmProfiles.list()).toEqual([]);
  });

  it("adds, reorders and deletes preset entries through editor controls", async () => {
    const original = await createPreset("Ordered preset");
    await open();
    cardButton("Ordered preset", "编辑").click();
    await vi.waitFor(() =>
      expect(host!.root.textContent).toContain("新增条目"),
    );
    clickButton("新增条目");
    await settleComponent();
    await setTextControl("条目标识", "second");
    await setTextControl("条目名称", "Second");
    const body = labeledControl("正文", "TEXTAREA");
    body.value = "Second body";
    body.dispatchEvent(new Event("input"));
    await settleComponent();
    clickButton("上移");
    await settleComponent();
    clickButton("保存资源");
    await vi.waitFor(async () =>
      expect(
        (
          await bridge.client!.presets.getEditor({ presetId: original.id })
        ).editor.entries.map((e) => e.identifier),
      ).toEqual(["second", "main"]),
    );
    await vi.waitFor(() =>
      expect(host!.root.textContent).toContain("资源已保存"),
    );
    clickButton("Second");
    await settleComponent();
    clickButton("删除此条目");
    await settleComponent();
    clickButton("保存资源");
    await vi.waitFor(async () =>
      expect(
        (
          await bridge.client!.presets.getEditor({ presetId: original.id })
        ).editor.entries.map((e) => e.identifier),
      ).toEqual(["main"]),
    );
    const exported = await (
      await bridge.client!.exports.preset({ presetId: original.id })
    ).json();
    expect(exported.prompt_order[0].order).toEqual([
      { identifier: "main", enabled: true },
    ]);
  });
  it("discovers and tests a saved model through visible actions without exposing its credential", async () => {
    const network = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      return new Response(
        JSON.stringify(
          url.endsWith("/models")
            ? { data: [{ id: "offline-model" }] }
            : {
                id: "offline-test",
                object: "chat.completion",
                created: 1,
                model: "offline-model",
                choices: [
                  {
                    index: 0,
                    message: {
                      role: "assistant",
                      content: "offline connection confirmed",
                    },
                    finish_reason: "stop",
                  },
                ],
              },
        ),
        { headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", network);
    await bridge.client!.llmProfiles.create({
      presetName: "Testable model",
      provider: "openai-compatible",
      modelId: "offline-model",
      baseUrl: "http://provider.test/v1",
      apiKey: "fixture-secret-key",
    });
    await open("model");
    cardButton("Testable model", "编辑").click();
    await vi.waitFor(() =>
      expect(host!.root.textContent).toContain("获取模型列表"),
    );
    expect(labeledControl("API Key", "INPUT").value).toBe("");
    clickButton("获取模型列表");
    await vi.waitFor(() =>
      expect(host!.root.textContent).toContain("offline-model (offline-model)"),
    );
    clickButton("测试连接");
    await vi.waitFor(() =>
      expect(host!.root.textContent).toContain("offline connection confirmed"),
    );
    expect(host!.root.textContent).not.toContain("fixture-secret-key");
    expect(network).toHaveBeenCalledTimes(2);
  });
  it("blocks saving invalid JSON fields and recovers after correction", async () => {
    await createPreset("Validated preset");
    await open();
    cardButton("Validated preset", "编辑").click();
    await vi.waitFor(() =>
      expect(host!.root.textContent).toContain("保存资源"),
    );
    const extra = labeledControl("扩展字段", "TEXTAREA");
    extra.value = "{";
    extra.dispatchEvent(new Event("input"));
    await settleComponent();
    expect(
      host!.all(
        (n) => n.tagName === "BUTTON" && n.textContent.trim() === "保存资源",
      )[0]!.props.disabled,
    ).toBe(true);
    extra.value = '{"custom":true}';
    extra.dispatchEvent(new Event("input"));
    await settleComponent();
    expect(
      host!.all(
        (n) => n.tagName === "BUTTON" && n.textContent.trim() === "保存资源",
      )[0]!.props.disabled,
    ).toBe(false);
    clickButton("保存资源");
    await vi.waitFor(() =>
      expect(host!.root.textContent).toContain("资源已保存"),
    );
    const preset = (await bridge.client!.presets.list())[0]!;
    expect(
      (await bridge.client!.presets.getEditor({ presetId: preset.id })).editor
        .entries[0]!.extra,
    ).toMatchObject({ custom: true });
  });
});
