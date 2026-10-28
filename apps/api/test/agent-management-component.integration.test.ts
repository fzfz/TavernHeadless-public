import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTavernClient, type TavernClient } from "@tavern/sdk";
import { buildTestApp } from "./helpers/create-test-db.js";
import {
  createTestProject,
  createTestWorkspace,
} from "../src/__tests__/helpers/workspace-project.js";
import RoleAgentManagement from "../../web/src/components/workspace/RoleAgentManagement.vue";
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

function createClient(app: FastifyInstance): TavernClient {
  return createTavernClient({
    baseUrl: "http://agent-management.test",
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      const response = await app.inject({
        method: (init?.method ?? "GET") as
          | "GET"
          | "POST"
          | "PUT"
          | "PATCH"
          | "DELETE",
        url: `${url.pathname}${url.search}`,
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        payload: typeof init?.body === "string" ? init.body : undefined,
      });
      return new Response(response.body, {
        status: response.statusCode,
        headers: response.headers as Record<string, string>,
      });
    },
  });
}

function button(
  host: ReturnType<typeof mountComponent>,
  text: string,
  index = 0,
) {
  return host.all(
    (node) => node.tagName === "BUTTON" && node.textContent.trim() === text,
  )[index]!;
}

function descendants(node: ComponentNode): ComponentNode[] {
  return node.children.flatMap((child) => [child, ...descendants(child)]);
}

function field(
  host: ReturnType<typeof mountComponent>,
  labelText: string,
  tagName: "INPUT" | "SELECT" | "TEXTAREA",
) {
  const label = host
    .all((node) => node.tagName === "LABEL")
    .find((node) => node.textContent.startsWith(labelText));
  if (!label) throw new Error(`Missing field label: ${labelText}`);
  const control = descendants(label).find((node) => node.tagName === tagName);
  if (!control) throw new Error(`Missing ${tagName} for field: ${labelText}`);
  return control;
}

function setField(
  host: ReturnType<typeof mountComponent>,
  labelText: string,
  tagName: "INPUT" | "SELECT" | "TEXTAREA",
  value: string,
) {
  const control = field(host, labelText, tagName);
  control.value = value;
  if (tagName === "SELECT") {
    for (const option of control.options)
      option.selected = option.value === value;
    control.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
  }
  return control;
}

function submit(host: ReturnType<typeof mountComponent>) {
  const form = host.all((node) => node.tagName === "FORM")[0];
  if (!form) throw new Error("Agent editor form is not visible");
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

describe("Agent management controls through Vue, SDK and Fastify", () => {
  let app: FastifyInstance;
  let database: Awaited<ReturnType<typeof buildTestApp>>["database"];
  let projectId: string;
  let workspaceId: string;
  let host: ReturnType<typeof mountComponent> | undefined;

  beforeEach(async () => {
    const built = await buildTestApp({
      databasePath: ":memory:",
      logger: false,
      auth: { mode: "off" },
    });
    app = built.app;
    database = built.database;
    const project = createTestProject(database, {
      accountId: "default-admin",
      id: "ui-agent-management",
      name: "Agent management test project",
    });
    projectId = project.projectId;
    workspaceId = project.workspaceId;
    bridge.client = createClient(app);
  });

  afterEach(async () => {
    host?.unmount();
    await app?.close();
  });

  async function mount(panel: "agent-types" | "agent-bindings") {
    host = mountComponent(RoleAgentManagement, { panel, sessionId: "" });
    await vi.waitFor(() => {
      expect(host!.all((node) => node.tagName === "H1")).toHaveLength(1);
      expect(button(host!, "刷新").props.disabled).not.toBe(true);
    });
    await settleComponent();
    return host;
  }

  it("在类型页面新建、编辑、取消编辑并启用和停用 Agent 类型", async () => {
    const changed = vi.fn();
    host = mountComponent(RoleAgentManagement, {
      panel: "agent-types",
      sessionId: "",
      onChanged: changed,
    });
    await vi.waitFor(() =>
      expect(button(host!, "新建类型").props.disabled).toBe(false),
    );

    button(host!, "新建类型").click();
    await settleComponent();
    setField(host!, "类型 Key", "INPUT", "ui.review.agent");
    setField(host!, "类型名称", "INPUT", "Review Agent");
    setField(host!, "运行作用域", "SELECT", "project");
    setField(host!, "附加信息", "TEXTAREA", '{"createdFrom":"ui"}');
    submit(host!);

    await vi.waitFor(() =>
      expect(host!.root.textContent).toContain("Review Agent"),
    );
    let types = await bridge.client!.workspaces.agentTypes.list(workspaceId);
    expect(types).toHaveLength(1);
    expect(types[0]).toMatchObject({
      key: "ui.review.agent",
      name: "Review Agent",
      scopeKind: "project",
      defaults: { metadata: { createdFrom: "ui" } },
      status: "active",
    });

    button(host!, "编辑").click();
    await settleComponent();
    expect(field(host!, "类型名称", "INPUT").value).toBe("Review Agent");
    setField(host!, "类型名称", "INPUT", "Unsubmitted name");
    button(host!, "取消").click();
    await settleComponent();
    types = await bridge.client!.workspaces.agentTypes.list(workspaceId);
    expect(types[0]!.name).toBe("Review Agent");
    expect(host!.root.textContent).not.toContain("Unsubmitted name");

    button(host!, "编辑").click();
    await settleComponent();
    setField(host!, "类型名称", "INPUT", "Reviewed Agent");
    setField(host!, "允许读取范围（逗号分隔）", "INPUT", "project.summary");
    submit(host!);
    await vi.waitFor(() =>
      expect(host!.root.textContent).toContain("Reviewed Agent"),
    );
    types = await bridge.client!.workspaces.agentTypes.list(workspaceId);
    expect(types[0]).toMatchObject({
      name: "Reviewed Agent",
      defaults: { grants: { reads: ["project.summary"] } },
    });

    button(host!, "停用").click();
    await vi.waitFor(async () => {
      types = await bridge.client!.workspaces.agentTypes.list(workspaceId);
      expect(types[0]!.status).toBe("disabled");
    });
    await vi.waitFor(() => expect(host!.root.textContent).toContain("启用"));
    await vi.waitFor(() =>
      expect(button(host!, "启用").props.disabled).toBe(false),
    );
    button(host!, "启用").click();
    await vi.waitFor(async () => {
      types = await bridge.client!.workspaces.agentTypes.list(workspaceId);
      expect(types[0]!.status).toBe("active");
    });
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(4));
  });

  it("在项目 Agent 页面新增、编辑、取消修改、启停并提交任务", async () => {
    const agentType = await bridge.client!.workspaces.agentTypes.create(
      workspaceId,
      {
        key: "ui.binding.agent",
        name: "Binding Agent",
        scopeKind: "project",
        defaults: {
          grants: {
            reads: ["project.summary"],
            allowed_output_targets: ["derived_output"],
          },
        },
      },
    );
    const changed = vi.fn();
    host = mountComponent(RoleAgentManagement, {
      panel: "agent-bindings",
      sessionId: "",
      onChanged: changed,
    });
    await vi.waitFor(() =>
      expect(button(host!, "添加项目 Agent").props.disabled).toBe(false),
    );

    setField(host!, "项目", "SELECT", projectId);
    await settleComponent();
    await vi.waitFor(() =>
      expect(button(host!, "添加项目 Agent").props.disabled).toBe(false),
    );
    button(host!, "添加项目 Agent").click();
    await settleComponent();
    const scopeSelect = field(host!, "运行作用域", "SELECT");
    expect(scopeSelect.props.disabled).toBe(true);
    expect(scopeSelect.options.map((option) => option.value)).toContain(
      "project",
    );
    setField(host!, "附加信息", "TEXTAREA", '{"createdFrom":"binding-ui"}');
    setField(host!, "允许输出目标（逗号分隔）", "INPUT", "derived_output");
    submit(host!);

    await vi.waitFor(async () => {
      expect(
        await bridge.client!.projects.agentBindings.list(projectId),
        host!.root.textContent,
      ).toHaveLength(1);
    });
    let bindings = await bridge.client!.projects.agentBindings.list(projectId);
    expect(bindings[0]).toMatchObject({
      agentTypeId: agentType.id,
      scopeKind: "project",
      metadata: { createdFrom: "binding-ui" },
      grants: { allowed_output_targets: ["derived_output"] },
      status: "enabled",
    });

    button(host!, "编辑").click();
    await settleComponent();
    setField(host!, "附加信息", "TEXTAREA", '{"discarded":true}');
    button(host!, "取消").click();
    await settleComponent();
    bindings = await bridge.client!.projects.agentBindings.list(projectId);
    expect(bindings[0]!.metadata).toEqual({ createdFrom: "binding-ui" });

    button(host!, "编辑").click();
    await settleComponent();
    setField(host!, "允许读取范围（逗号分隔）", "INPUT", "project.summary");
    submit(host!);
    await vi.waitFor(async () => {
      bindings = await bridge.client!.projects.agentBindings.list(projectId);
      expect(bindings[0]!.grants.reads).toEqual(["project.summary"]);
    });

    button(host!, "停用").click();
    await vi.waitFor(async () => {
      bindings = await bridge.client!.projects.agentBindings.list(projectId);
      expect(bindings[0]!.status).toBe("disabled");
    });
    expect(button(host!, "运行").props.disabled).toBe(true);
    await vi.waitFor(() =>
      expect(button(host!, "启用").props.disabled).toBe(false),
    );
    button(host!, "启用").click();
    await vi.waitFor(async () => {
      bindings = await bridge.client!.projects.agentBindings.list(projectId);
      expect(bindings[0]!.status).toBe("enabled");
    });
    await vi.waitFor(() =>
      expect(button(host!, "运行").props.disabled).toBe(false),
    );
    button(host!, "运行").click();
    await vi.waitFor(() =>
      expect(host!.root.textContent).toContain("Agent 任务已提交"),
    );
    await vi.waitFor(() => expect(host!.root.textContent).toContain("pending"));
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(5));
  });

  it("切换工作区时保留未保存表单，确认放弃后切换且不创建类型", async () => {
    const other = createTestWorkspace(database, {
      accountId: "default-admin",
      id: "ui-agent-other-workspace",
      name: "Other agent workspace",
    });
    const root = await mount("agent-types");
    const select = field(root, "工作区", "SELECT");
    const initialWorkspace = String(select.value);
    expect(
      select.options.some((option) => option.value === other.workspaceId),
    ).toBe(true);
    const targetWorkspaceId = select.options.find(
      (option) => option.value && option.value !== initialWorkspace,
    )?.value as string | undefined;
    expect(targetWorkspaceId).toBeDefined();

    button(root, "新建类型").click();
    await settleComponent();
    setField(root, "类型 Key", "INPUT", "ui.cancel.agent");
    setField(root, "类型名称", "INPUT", "Keep this draft");
    select.value = targetWorkspaceId;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() =>
      expect(root.all((node) => node.props.role === "dialog")).toHaveLength(1),
    );
    expect(select.value).toBe(initialWorkspace);

    button(root, "继续编辑").click();
    await settleComponent();
    expect(field(root, "类型名称", "INPUT").value).toBe("Keep this draft");
    expect(root.all((node) => node.props.role === "dialog")).toHaveLength(0);

    select.value = targetWorkspaceId;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() =>
      expect(root.all((node) => node.props.role === "dialog")).toHaveLength(1),
    );
    button(root, "放弃修改").click();
    await vi.waitFor(() => expect(select.value).toBe(targetWorkspaceId));
    await vi.waitFor(() =>
      expect(button(root, "新建类型").props.disabled).toBe(false),
    );
    expect(root.root.textContent).not.toContain("Keep this draft");
    expect(
      await bridge.client!.workspaces.agentTypes.list(initialWorkspace),
    ).toEqual([]);
    expect(
      await bridge.client!.workspaces.agentTypes.list(targetWorkspaceId!),
    ).toEqual([]);
  });

  it("显示 API 冲突错误，刷新列表后保留表单并可修正提交", async () => {
    await bridge.client!.workspaces.agentTypes.create(workspaceId, {
      key: "ui.duplicate.agent",
      name: "Existing Agent",
      scopeKind: "floor",
    });
    const root = await mount("agent-types");
    button(root, "新建类型").click();
    await settleComponent();
    setField(root, "类型 Key", "INPUT", "ui.duplicate.agent");
    setField(root, "类型名称", "INPUT", "Replacement Agent");
    submit(root);

    await vi.waitFor(() =>
      expect(root.all((node) => node.props.role === "alert")).toHaveLength(1),
    );
    expect(root.root.textContent).toContain("Agent 操作未完成");
    expect(field(root, "类型名称", "INPUT").value).toBe("Replacement Agent");
    button(root, "刷新").click();
    await vi.waitFor(() =>
      expect(root.all((node) => node.props.role === "alert")).toHaveLength(0),
    );
    expect(field(root, "类型名称", "INPUT").value).toBe("Replacement Agent");

    setField(root, "类型 Key", "INPUT", "ui.replacement.agent");
    submit(root);
    await vi.waitFor(() =>
      expect(root.root.textContent).toContain("Replacement Agent"),
    );
    expect(
      await bridge.client!.workspaces.agentTypes.list(workspaceId),
    ).toHaveLength(2);
  });

  it("拒绝非对象 JSON 元数据并提示如何修正", async () => {
    const root = await mount("agent-types");
    button(root, "新建类型").click();
    await settleComponent();
    setField(root, "类型 Key", "INPUT", "ui.invalid.metadata");
    setField(root, "类型名称", "INPUT", "Invalid Metadata Agent");
    setField(root, "附加信息", "TEXTAREA", "[]");
    submit(root);

    await vi.waitFor(() =>
      expect(root.all((node) => node.props.role === "alert")).toHaveLength(1),
    );
    expect(root.root.textContent).toContain(
      "附加信息必须是有效的 JSON 对象。请修改后重试。",
    );
    expect(
      await bridge.client!.workspaces.agentTypes.list(workspaceId),
    ).toEqual([]);
  });

  it("刷新类型列表后仍显示已保存的类型", async () => {
    await bridge.client!.workspaces.agentTypes.create(workspaceId, {
      key: "ui.refresh.agent",
      name: "Refresh Agent",
      scopeKind: "floor",
    });
    const root = await mount("agent-types");
    expect(root.root.textContent).toContain("Refresh Agent");
    button(root, "刷新").click();
    await vi.waitFor(() =>
      expect(root.root.textContent).toContain("Refresh Agent"),
    );
    expect(root.all((node) => node.props.role === "alert")).toHaveLength(0);
  });
});
