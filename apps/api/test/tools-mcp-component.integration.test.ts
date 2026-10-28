/* eslint-disable vue/one-component-per-file -- Test-only adapters for independent browser primitives. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, effectScope, h, ref, type PropType } from "vue";
import type { FastifyInstance } from "fastify";
import { createTavernClient, type TavernClient } from "@tavern/sdk";
import { buildTestApp } from "./helpers/create-test-db.js";
import { floors, toolExecutionRecords } from "../src/db/schema.js";
import type { McpServerConfig } from "../src/services/tooling/mcp/types.js";
import WorkspaceToolManagerDialog from "../../web/src/components/workspace/WorkspaceToolManagerDialog.vue";
import WorkspaceMcpManagerDialog from "../../web/src/components/workspace/WorkspaceMcpManagerDialog.vue";
import { useWorkspaceToolManagerDialog } from "../../web/src/composables/workspace/tools/tool-manager-dialog.js";
import { useWorkspaceMcpManagerDialog } from "../../web/src/composables/workspace/mcp/mcp-manager-dialog.js";
import {
  ComponentNode,
  mountComponent,
  settleComponent,
} from "../../web/src/test/component-host.js";

const bridge = vi.hoisted(() => ({
  client: undefined as TavernClient | undefined,
  failConnection: false,
}));
vi.mock("../../web/src/lib/api", () => ({
  get apiClient() {
    return bridge.client;
  },
}));
// Only browser layout primitives are replaced. Actual dialogs, inputs, controllers,
// workspace API adapters, SDK, routes and in-memory SQLite participate in every test.
vi.mock("../../web/src/components/ui/UiDialogShell.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    default: defineComponent({
      props: { open: Boolean },
      emits: ["update:open"],
      setup(props, { slots }) {
        return () =>
          props.open
            ? h("section", { role: "dialog" }, slots.default?.())
            : null;
      },
    }),
  };
});
vi.mock("../../web/src/components/ui/UiSelectShell.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    default: defineComponent({
      props: {
        modelValue: { type: String, required: true },
        options: {
          type: Array as PropType<{ value: string; label: string }[]>,
          required: true,
        },
        disabled: Boolean,
      },
      emits: ["update:modelValue"],
      setup(props, { emit }) {
        return () =>
          h(
            "select",
            {
              value: props.modelValue,
              disabled: props.disabled,
              onChange: (event: Event) =>
                emit(
                  "update:modelValue",
                  (event.target as unknown as ComponentNode).value,
                ),
            },
            props.options.map((option: { value: string; label: string }) =>
              h("option", { value: option.value }, option.label),
            ),
          );
      },
    }),
  };
});
vi.mock("../../web/src/components/ui/UiCheckboxField.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    default: defineComponent({
      props: { checked: Boolean, disabled: Boolean },
      emits: ["update:checked"],
      setup(props, { emit, slots }) {
        return () =>
          h("label", [
            h("input", {
              type: "checkbox",
              checked: props.checked,
              disabled: props.disabled,
              onChange: (event: Event) =>
                emit(
                  "update:checked",
                  (event.target as unknown as ComponentNode).checked,
                ),
            }),
            slots.default?.(),
          ]);
      },
    }),
  };
});
// Deterministic MCP connection boundary: no network, subprocess or external MCP program.
// The real manager and HTTP runtime routes still own server selection and lifecycle.
vi.mock("../src/services/tooling/mcp/mcp-connection.js", () => ({
  McpConnection: class {
    state = "disconnected";
    reconnectRequired = false;
    constructor(readonly config: McpServerConfig) {}
    get toolCount() {
      return this.getTools().length;
    }
    async connect() {
      if (bridge.failConnection)
        throw new Error("deterministic connection failure");
      this.state = "connected";
    }
    async disconnect() {
      this.state = "disconnected";
    }
    getTools() {
      return this.state === "connected"
        ? [
            {
              name: "lookup_local",
              description: "Local fixture lookup",
              parameters: { type: "object", properties: {} },
              sideEffectLevel: "none",
              source: "mcp",
              allowedSlots: ["narrator"],
            },
          ]
        : [];
    }
  },
}));

let app: FastifyInstance;
let database: Awaited<ReturnType<typeof buildTestApp>>["database"];
let host: ReturnType<typeof mountComponent> | undefined;
let scope: ReturnType<typeof effectScope>;
const t = (key: string) => key;
function button(text: string, index = 0) {
  const result = host!.all(
    (n) => n.tagName === "BUTTON" && n.textContent.trim() === text,
  )[index];
  if (!result) throw new Error(`Missing button: ${text}`);
  return result;
}
function field(key: string, value: string, tag = "INPUT") {
  const row = host!.all(
    (n) =>
      n.tagName === "DIV" &&
      n.children.some((c) => c.tagName === "SPAN" && c.textContent === key),
  )[0];
  const control = row?.querySelectorAll(tag)[0];
  if (!control) throw new Error(`Missing field: ${key}`);
  control.value = value;
  control.dispatchEvent(new Event(tag === "SELECT" ? "change" : "input"));
}
async function click(text: string, index = 0) {
  button(text, index).click();
  await settleComponent();
}
function search(key: string, value: string, index = 0) {
  const input = host!.all(
    (n) => n.tagName === "INPUT" && n.props.placeholder === key,
  )[index]!;
  input.value = value;
  input.dispatchEvent(new Event("input"));
}
beforeEach(async () => {
  bridge.failConnection = false;
  const built = await buildTestApp({
    databasePath: ":memory:",
    logger: false,
    auth: { mode: "off" },
    enableMcp: true,
    enableUnsafeScriptHandler: true,
    orchestration: {
      providers: [
        {
          id: "offline",
          type: "openai-compatible",
          apiMode: "chat",
          apiKey: "offline",
          options: {
            fetch: () => {
              throw new Error("Model requests are outside this test");
            },
          },
        },
      ],
      defaultModel: { providerId: "offline", modelId: "offline" },
    },
  });
  app = built.app;
  database = built.database;
  bridge.client = createTavernClient({
    baseUrl: "http://tools-mcp.test",
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      const response = await app.inject({
        method: (init?.method ?? "GET") as
          | "GET"
          | "POST"
          | "PUT"
          | "PATCH"
          | "DELETE",
        url: url.pathname + url.search,
        headers: Object.fromEntries(new Headers(init?.headers)),
        payload: init?.body as string,
      });
      return new Response(response.body, {
        status: response.statusCode,
        headers: response.headers as Record<string, string>,
      });
    },
  });
  vi.stubGlobal("HTMLInputElement", ComponentNode);
  vi.stubGlobal("HTMLTextAreaElement", ComponentNode);
  scope = effectScope();
});
afterEach(async () => {
  host?.unmount();
  host = undefined;
  scope.stop();
  await app.close();
  vi.unstubAllGlobals();
});
async function tools(sessionId: string | null = null) {
  const state = scope.run(() =>
    useWorkspaceToolManagerDialog({
      activeSessionId: ref(sessionId),
      currentAccount: ref("default-admin"),
      t,
      addEvent: vi.fn(),
    }),
  )!;
  await state.openToolManagerDialog();
  host = mountComponent(
    defineComponent(
      () => () =>
        h(WorkspaceToolManagerDialog, {
          activeSessionId: sessionId,
          toolManagerDialog: state.toolManagerDialog,
          t,
          onCreateDefinitionDraft: state.beginCreateToolDefinitionDraft,
          onSelectDefinition: state.selectToolDefinition,
          onSaveDefinition: state.saveToolDefinition,
          onSavePermissions: state.saveSessionToolPermissions,
          onRefresh: state.refreshToolManagerDialog,
          onToggleDefinition: ({ definitionId, enabled }: { definitionId: string; enabled: boolean }) =>
            state.toggleToolDefinitionEnabled(definitionId, enabled),
          onDeleteDefinition: state.deleteToolDefinitionById,
          "onUpdate:open": (open: boolean) => {
            if (!open) state.closeToolManagerDialog();
          },
        }),
    ),
    {},
  );
  return state;
}
async function mcp() {
  const state = scope.run(() =>
    useWorkspaceMcpManagerDialog({
      currentAccount: ref("default-admin"),
      t,
      addEvent: vi.fn(),
    }),
  )!;
  await state.openMcpManagerDialog();
  host = mountComponent(
    defineComponent(
      () => () =>
        h(WorkspaceMcpManagerDialog, {
          mcpManagerDialog: state.mcpManagerDialog,
          t,
          onCreateServerDraft: state.beginCreateMcpServerDraft,
          onSelectServer: state.selectMcpServer,
          onSaveServer: state.saveMcpServer,
          onRefresh: state.refreshMcpManagerDialog,
          onToggleServer: ({ serverId, enabled }: { serverId: string; enabled: boolean }) =>
            state.toggleMcpServerEnabled(serverId, enabled),
          onDeleteServer: state.deleteMcpServerById,
          onConnectServer: state.connectSelectedMcpServer,
          onDisconnectServer: state.disconnectSelectedMcpServer,
          onTestServer: state.testSelectedMcpServerConfig,
          "onUpdate:open": (open: boolean) => {
            if (!open) state.closeMcpManagerDialog();
          },
        }),
    ),
    {},
  );
  return state;
}
describe("tool dialog events through SDK and Fastify", () => {
  it("creates, selects, searches, edits, refreshes, toggles and confirms or cancels deletion", async () => {
    const state = await tools();
    await click("dialogs.toolManagerCreateDefinition");
    field("dialogs.toolManagerDefinitionName", "lookup_notes");
    await click("dialogs.toolManagerDefinitionSave");
    await vi.waitFor(() =>
      expect(
        state.toolManagerDialog.definitions,
        state.toolManagerDialog.errorMessage,
      ).toHaveLength(1),
    );
    const id = state.toolManagerDialog.definitions[0]!.id;
    expect(
      (await bridge.client!.tools.getDefinition({ definitionId: id })).name,
    ).toBe("lookup_notes");
    search("dialogs.toolManagerFilterPlaceholder", "unmatched");
    await settleComponent();
    expect(host!.root.textContent).toContain(
      "dialogs.toolManagerEmptyDefinitions",
    );
    search("dialogs.toolManagerFilterPlaceholder", "LOOKUP");
    await settleComponent();
    const item = host!.all(
      (n) => n.tagName === "BUTTON" && n.textContent.includes("lookup_notes"),
    )[0]!;
    item.click();
    await vi.waitFor(() =>
      expect(state.toolManagerDialog.definitionDraft.mode).toBe("edit"),
    );
    field("dialogs.toolManagerDefinitionDescription", "Edited through UI");
    await click("dialogs.toolManagerDefinitionSave");
    await vi.waitFor(async () =>
      expect(
        (await bridge.client!.tools.getDefinition({ definitionId: id }))
          .description,
      ).toBe("Edited through UI"),
    );
    await vi.waitFor(() =>
      expect(state.toolManagerDialog.definitionSaving).toBe(false),
    );
    await click("dialogs.toolManagerDefinitionToggleOff");
    await vi.waitFor(async () =>
      expect(
        (await bridge.client!.tools.getDefinition({ definitionId: id }))
          .enabled,
      ).toBe(false),
    );
    await vi.waitFor(() =>
      expect(state.toolManagerDialog.definitionDraft.enabled).toBe(false),
    );
    await click("dialogs.toolManagerDefinitionToggleOn");
    await vi.waitFor(() =>
      expect(state.toolManagerDialog.definitionDraft.enabled).toBe(true),
    );
    field("dialogs.toolManagerDefinitionDescription", "Unsaved edit");
    await click("dialogs.cancel");
    expect(
      (await bridge.client!.tools.getDefinition({ definitionId: id }))
        .description,
    ).toBe("Edited through UI");
    await state.openToolManagerDialog();
    await settleComponent();
    expect(state.toolManagerDialog.definitionDraft.description).toBe(
      "Edited through UI",
    );
    await click("actions.refresh");
    await vi.waitFor(() => expect(state.toolManagerDialog.loading).toBe(false));
    await click("dialogs.toolManagerDefinitionDelete");
    expect(host!.all((n) => n.props.role === "alertdialog")).toHaveLength(1);
    await click("dialogs.cancel");
    expect(
      (await bridge.client!.tools.listDefinitions()).definitions,
    ).toHaveLength(1);
    await click("dialogs.toolManagerDefinitionDelete");
    await click("dialogs.confirmDelete");
    await vi.waitFor(() =>
      expect(state.toolManagerDialog.definitions).toHaveLength(0),
    );
    expect(
      (await bridge.client!.tools.listDefinitions()).definitions,
    ).toHaveLength(0);
  });
  it("retains invalid JSON for correction, saves session permissions and cancels unsaved creation", async () => {
    const session = await bridge.client!.sessions.create({
      title: "Tool permissions",
    });
    const state = await tools(session!.id);
    expect(state.toolManagerDialog.errorMessage).toBe("");
    expect(state.toolManagerDialog.runtimeCatalog?.sessionId).toBe(session!.id);
    field("dialogs.toolManagerPermissionEnabled", "true", "SELECT");
    field("dialogs.toolManagerPermissionMaxCalls", "3");
    field("dialogs.toolManagerPermissionSlotAllow", "[", "TEXTAREA");
    await click("dialogs.toolManagerPermissionsSave");
    expect(state.toolManagerDialog.errorMessage).toBeTruthy();
    field(
      "dialogs.toolManagerPermissionSlotAllow",
      '{"narrator":["lookup_notes"]}',
      "TEXTAREA",
    );
    await click("dialogs.toolManagerPermissionsSave");
    await vi.waitFor(async () =>
      expect(
        await bridge.client!.sessions.getToolPermissions({
          sessionId: session!.id,
        }),
      ).toMatchObject({
        enabled: true,
        maxCallsPerTurn: 3,
        slotAllowList: { narrator: ["lookup_notes"] },
      }),
    );
    field("dialogs.toolManagerDefinitionName", "invalid_then_cancel");
    field("dialogs.toolManagerDefinitionParameters", "[", "TEXTAREA");
    await click("dialogs.toolManagerDefinitionSave");
    expect(state.toolManagerDialog.errorMessage).toBeTruthy();
    expect(
      (await bridge.client!.tools.listDefinitions()).definitions,
    ).toHaveLength(0);
    await click("dialogs.cancel");
    expect(state.toolManagerDialog.open).toBe(false);
    expect(state.toolManagerDialog.definitionDraft.name).toBe("");
  });
});
it("filters persisted execution records by tool, provider and status and restores them on clear", async () => {
  const session = await bridge.client!.sessions.create({
    title: "Execution search",
  });
  const now = Date.now();
  database
    .insert(floors)
    .values({
      id: "tool-log-floor",
      sessionId: session!.id,
      floorNo: 1,
      branchId: "main",
      state: "committed",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  database
    .insert(toolExecutionRecords)
    .values({
      id: "tool-log",
      runId: "tool-log-run",
      floorId: "tool-log-floor",
      callerSlot: "narrator",
      providerId: "fixture-provider",
      providerType: "builtin",
      toolName: "fixture_lookup",
      status: "success",
      lifecycleState: "finished",
      commitOutcome: "committed",
      sideEffectLevel: "none",
      startedAt: now,
      createdAt: now,
    })
    .run();
  const state = await tools(session!.id);
  expect(state.toolManagerDialog.executions).toHaveLength(1);
  for (const keyword of ["FIXTURE_LOOKUP", "fixture-provider", "success"]) {
    search("dialogs.toolManagerFilterPlaceholder", keyword, 1);
    await settleComponent();
    expect(host!.root.textContent).toContain("fixture_lookup");
  }
  search("dialogs.toolManagerFilterPlaceholder", "missing-execution", 1);
  await settleComponent();
  expect(host!.root.textContent).toContain(
    "dialogs.toolManagerEmptyExecutions",
  );
  expect(host!.root.textContent).not.toContain("fixture_lookup");
  search("dialogs.toolManagerFilterPlaceholder", "", 1);
  await settleComponent();
  expect(host!.root.textContent).toContain("fixture_lookup");
});

describe("MCP dialog events through SDK and Fastify with local transport boundary", () => {
  it("creates, edits, filters, refreshes, toggles, connects, tests, disconnects and confirms deletion", async () => {
    const state = await mcp();
    await click("dialogs.mcpManagerCreateServer");
    field("dialogs.mcpManagerServerName", "Local fixture");
    field("dialogs.mcpManagerTransport", "http", "SELECT");
    await settleComponent();
    field("dialogs.mcpManagerHttpUrl", "https://fixture.invalid/mcp");
    await click("dialogs.mcpManagerSave");
    await vi.waitFor(() =>
      expect(state.mcpManagerDialog.servers).toHaveLength(1),
    );
    const id = state.mcpManagerDialog.servers[0]!.id;
    await vi.waitFor(() => expect(state.mcpManagerDialog.saving).toBe(false));
    search("dialogs.mcpManagerFilterPlaceholder", "unmatched");
    await settleComponent();
    expect(host!.root.textContent).toContain("dialogs.mcpManagerServersEmpty");
    search("dialogs.mcpManagerFilterPlaceholder", "LOCAL");
    await settleComponent();
    host!
      .all(
        (n) =>
          n.tagName === "BUTTON" && n.textContent.includes("Local fixture"),
      )[0]!
      .click();
    await vi.waitFor(() =>
      expect(state.mcpManagerDialog.serverDraft.mode).toBe("edit"),
    );
    field("dialogs.mcpManagerServerName", "Edited fixture");
    await click("dialogs.mcpManagerSave");
    await vi.waitFor(async () =>
      expect((await bridge.client!.mcp.getServer({ serverId: id })).name).toBe(
        "Edited fixture",
      ),
    );
    await vi.waitFor(() => expect(state.mcpManagerDialog.saving).toBe(false));
    await click("dialogs.mcpManagerToggleOff");
    await vi.waitFor(() =>
      expect(state.mcpManagerDialog.serverDraft.enabled).toBe(false),
    );
    await click("dialogs.mcpManagerToggleOn");
    await vi.waitFor(() =>
      expect(state.mcpManagerDialog.serverDraft.enabled).toBe(true),
    );
    await click("dialogs.mcpManagerConnect");
    await vi.waitFor(() =>
      expect(state.mcpManagerDialog.selectedStatus?.state).toBe("connected"),
    );
    await vi.waitFor(() =>
      expect(state.mcpManagerDialog.actionServerId).toBeNull(),
    );
    expect(host!.root.textContent).toContain("lookup_local");
    await click("dialogs.mcpManagerTest");
    await vi.waitFor(() =>
      expect(state.mcpManagerDialog.lastTestResult?.success).toBe(true),
    );
    await vi.waitFor(() =>
      expect(state.mcpManagerDialog.actionServerId).toBeNull(),
    );
    await click("dialogs.mcpManagerDisconnect");
    await vi.waitFor(() =>
      expect(state.mcpManagerDialog.selectedStatus?.state).toBe("disconnected"),
    );
    await vi.waitFor(() =>
      expect(state.mcpManagerDialog.actionServerId).toBeNull(),
    );
    expect(state.mcpManagerDialog.selectedTools).toHaveLength(0);
    field("dialogs.mcpManagerServerName", "Unsaved MCP edit");
    await click("dialogs.cancel");
    expect((await bridge.client!.mcp.getServer({ serverId: id })).name).toBe(
      "Edited fixture",
    );
    await state.openMcpManagerDialog();
    await settleComponent();
    expect(state.mcpManagerDialog.serverDraft.name).toBe("Edited fixture");
    await click("actions.refresh");
    await vi.waitFor(() => expect(state.mcpManagerDialog.loading).toBe(false));
    await click("dialogs.mcpManagerDelete");
    await click("dialogs.cancel");
    expect((await bridge.client!.mcp.listServers()).servers).toHaveLength(1);
    await click("dialogs.mcpManagerDelete");
    await click("dialogs.confirmDelete");
    await vi.waitFor(() =>
      expect(state.mcpManagerDialog.servers).toHaveLength(0),
    );
    expect((await bridge.client!.mcp.listServers()).servers).toHaveLength(0);
  });
  it("shows validation and connection failures and cancels an unsaved server", async () => {
    const state = await mcp();
    field("dialogs.mcpManagerServerName", "Failure fixture");
    field("dialogs.mcpManagerStdioCommand", "never-executed");
    field("dialogs.mcpManagerStdioArgs", "[", "TEXTAREA");
    await click("dialogs.mcpManagerSave");
    expect(state.mcpManagerDialog.errorMessage).toBeTruthy();
    expect((await bridge.client!.mcp.listServers()).servers).toHaveLength(0);
    field("dialogs.mcpManagerStdioArgs", "[]", "TEXTAREA");
    await click("dialogs.mcpManagerSave");
    await vi.waitFor(() =>
      expect(state.mcpManagerDialog.servers).toHaveLength(1),
    );
    await vi.waitFor(() => expect(state.mcpManagerDialog.saving).toBe(false));
    bridge.failConnection = true;
    await click("dialogs.mcpManagerTest");
    await vi.waitFor(() =>
      expect(state.mcpManagerDialog.lastTestResult?.success).toBe(false),
    );
    expect(state.mcpManagerDialog.lastTestResult?.error).toContain(
      "deterministic connection failure",
    );
    await vi.waitFor(() =>
      expect(state.mcpManagerDialog.actionServerId).toBeNull(),
    );
    await click("dialogs.mcpManagerConnect");
    await vi.waitFor(() =>
      expect(state.mcpManagerDialog.errorMessage).toContain(
        "deterministic connection failure",
      ),
    );
    await click("dialogs.mcpManagerCreateServer");
    field("dialogs.mcpManagerServerName", "Discard this server");
    await click("dialogs.cancel");
    expect(state.mcpManagerDialog.open).toBe(false);
    expect(state.mcpManagerDialog.serverDraft.name).toBe("");
    expect((await bridge.client!.mcp.listServers()).servers).toHaveLength(1);
  });
});
