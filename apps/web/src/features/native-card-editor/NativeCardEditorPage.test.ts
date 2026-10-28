import { afterEach, describe, expect, it, vi } from "vitest";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";

const { nativeCards } = vi.hoisted(() => ({
  nativeCards: {
    list: vi.fn(),
    create: vi.fn(),
    get: vi.fn(),
    readFile: vi.fn(),
    save: vi.fn(),
    validate: vi.fn(),
    checkImport: vi.fn(),
    confirmImport: vi.fn(),
    publish: vi.fn(),
    createPreview: vi.fn(),
    createBuild: vi.fn(),
    getBuild: vi.fn(),
    retryBuild: vi.fn(),
    downloadBuild: vi.fn(),
  },
}));
vi.mock("../../lib/api.js", () => ({ apiClient: { nativeCards } }));
vi.mock("../../directives/modal-focus.js", () => ({ vModalFocus: {} }));
vi.mock("./native-card-editor.css", () => ({}));

describe("native card editor page", () => {
  afterEach(() => vi.clearAllMocks());

  it("renders the real catalog entry points and empty state", async () => {
    const { default: page } = await import("./NativeCardEditorPage.vue");
    const app = createSSRApp(page);
    const html = await renderToString(app);

    expect(html).toContain("导入 ZIP");
    expect(html).toContain("新建角色卡");
    expect(html).toContain("暂无角色卡");
  });
});
