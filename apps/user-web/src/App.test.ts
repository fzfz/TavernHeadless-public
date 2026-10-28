import { afterEach, describe, expect, it, vi } from "vitest";
import { createRenderer, nextTick } from "vue";
import { apiErrorMessages } from "@tavern/shared";
import type { RoleApplicationContext } from "./lib/bootstrap.js";
import type { SessionRecord } from "@tavern/sdk";
import App from "./App.vue";

vi.mock("./features/chat/ChatSession.vue", async () => {
  const vue = await vi.importActual<typeof import("vue")>("vue");
  return {
    default: vue.defineComponent({
      props: {
        sessionId: { type: String, required: true },
        snapshotId: { type: String, default: null },
        historySelection: { type: String, required: true },
        historyRefreshVersion: { type: Number, required: true },
        historyMoreVersion: { type: Number, required: true },
        historyRetryCursor: { type: String, default: null },
        historySelectionRetryVersion: { type: Number, required: true },
        historyRetrySnapshotId: { type: String, required: true },
      },
      emits: [
        "ready",
        "history",
        "history-state",
        "history-loading",
        "history-failure",
        "failure",
        "current",
      ],
      setup(props, { emit }) {
        return () =>
          vue.h("div", {
            class: "chat-session-test-double",
            "data-session-id": props.sessionId,
            "data-snapshot-id": props.snapshotId,
            "data-history-selection": props.historySelection,
            "data-history-refresh-version": props.historyRefreshVersion,
            "data-history-more-version": props.historyMoreVersion,
            "data-history-retry-cursor": props.historyRetryCursor,
            "data-history-selection-retry-version":
              props.historySelectionRetryVersion,
            "data-history-retry-snapshot-id": props.historyRetrySnapshotId,
            onTestReady: (name: string) => emit("ready", name),
            onTestHistory: (page: unknown) => emit("history", page),
            onTestHistoryState: (state: unknown) =>
              emit("history-state", state),
            onTestCurrent: (snapshot: unknown) => emit("current", snapshot),
            onTestHistoryLoading: (loading: boolean) =>
              emit("history-loading", loading),
            onTestHistoryFailure: (error: unknown) =>
              emit("history-failure", error),
          });
      },
    }),
  };
});

type TestNode = {
  type: string;
  elementTag: string;
  props: Record<string, unknown>;
  children: TestNode[];
  parent: TestNode | null;
  text: string;
  value?: string;
  checked?: boolean;
  disabled?: boolean;
  focusCount: number;
  tagName: string;
  tabIndex: number;
  getAttribute(name: string): string | null;
  getClientRects(): Array<{ testRect: true }>;
  focus(): void;
  contains(other: TestNode | null): boolean;
  querySelectorAll<T extends TestNode = TestNode>(selector: string): T[];
  querySelector<T extends TestNode = TestNode>(selector: string): T | null;
  listeners: Map<string, Set<(event: { type: string }) => void>>;
  addEventListener(
    type: string,
    listener: (event: { type: string }) => void,
  ): void;
  dispatchEvent(event: { type: string }): boolean;
};

let focusedTestNode: TestNode | null = null;

function makeNode(type: string, text = ""): TestNode {
  const node: TestNode = {
    type,
    elementTag: type,
    props: {},
    children: [],
    parent: null,
    text,
    focusCount: 0,
    get tagName() {
      return this.elementTag.toUpperCase();
    },
    get tabIndex() {
      const configured = this.props.tabindex;
      if (typeof configured === "number") return configured;
      if (typeof configured === "string") return Number(configured);
      return ["button", "input", "select", "textarea", "a"].includes(
        this.elementTag,
      )
        ? 0
        : -1;
    },
    getAttribute(name) {
      const value = this.props[name];
      if (["disabled", "hidden", "inert"].includes(name))
        return value ? "" : null;
      return value === undefined || value === null ? null : String(value);
    },
    getClientRects() {
      return [{ testRect: true }];
    },
    focus() {
      if (this.disabled) return;
      this.focusCount += 1;
      focusedTestNode = node;
    },
    contains(other) {
      let current = other;
      while (current) {
        if (current === this) return true;
        current = current.parent;
      }
      return false;
    },
    querySelectorAll<T extends TestNode = TestNode>(selector: string) {
      const matches = (candidate: TestNode) => {
        const selectors = selector.split(",").map((item) => item.trim());
        return selectors.some((item) => {
          if (item.startsWith("button"))
            return candidate.elementTag === "button" && !candidate.disabled;
          if (item.startsWith("input"))
            return (
              candidate.elementTag === "input" &&
              !candidate.disabled &&
              candidate.props.type !== "hidden"
            );
          if (item.startsWith("select"))
            return candidate.elementTag === "select" && !candidate.disabled;
          if (item.startsWith("textarea"))
            return candidate.elementTag === "textarea" && !candidate.disabled;
          if (item.startsWith("a[href]")) return candidate.elementTag === "a";
          if (item.startsWith("[tabindex]"))
            return candidate.props.tabindex !== undefined;
          return false;
        });
      };
      const result: TestNode[] = [];
      const visit = (parent: TestNode) => {
        for (const child of parent.children) {
          if (matches(child)) result.push(child);
          visit(child);
        }
      };
      visit(this);
      return result as T[];
    },
    querySelector<T extends TestNode = TestNode>(selector: string) {
      if (selector.includes('input[type="radio"]:checked')) {
        return (
          this.querySelectorAll<T>("input").find(
            (candidate) =>
              candidate.props.type === "radio" &&
              candidate.checked &&
              !candidate.disabled,
          ) ?? null
        );
      }
      return this.querySelectorAll<T>(selector)[0] ?? null;
    },
    listeners: new Map(),
    addEventListener(eventType, listener) {
      const listeners = this.listeners.get(eventType) ?? new Set();
      listeners.add(listener);
      this.listeners.set(eventType, listeners);
    },
    dispatchEvent(event) {
      for (const listener of this.listeners.get(event.type) ?? [])
        listener(event);
      return true;
    },
  };
  return node;
}

const renderer = createRenderer<TestNode, TestNode>({
  createElement: (type) => makeNode(type),
  createText(text) {
    return makeNode("#text", text);
  },
  createComment(text) {
    return makeNode("#comment", text);
  },
  setText(node, text) {
    node.text = text;
  },
  setElementText(node, text) {
    for (const child of node.children) child.parent = null;
    node.children = [];
    node.text = text;
  },
  patchProp(node, key, _previous, next) {
    node.props[key] = next;
    if (
      key === "value" ||
      key === "type" ||
      key === "checked" ||
      key === "disabled"
    )
      Object.assign(node, { [key]: next });
    if (key === "disabled" && next && focusedTestNode === node)
      focusedTestNode = null;
  },
  insert(node, parent, anchor) {
    if (node.parent) {
      const oldIndex = node.parent.children.indexOf(node);
      if (oldIndex >= 0) node.parent.children.splice(oldIndex, 1);
    }
    node.parent = parent;
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    if (index < 0) parent.children.push(node);
    else parent.children.splice(index, 0, node);
  },
  remove(node) {
    if (!node?.parent) return;
    if (
      focusedTestNode &&
      (focusedTestNode === node || node.contains(focusedTestNode))
    )
      focusedTestNode = null;
    const index = node.parent.children.indexOf(node);
    if (index >= 0) node.parent.children.splice(index, 1);
    node.parent = null;
  },
  parentNode(node) {
    return node.parent;
  },
  nextSibling(node) {
    if (!node.parent) return null;
    return node.parent.children[node.parent.children.indexOf(node) + 1] ?? null;
  },
});

function find(
  root: TestNode,
  predicate: (node: TestNode) => boolean,
): TestNode | undefined {
  if (predicate(root)) return root;
  for (const child of root.children) {
    const result = find(child, predicate);
    if (result) return result;
  }
  return undefined;
}

function label(node: TestNode): string {
  return node.text + node.children.map(label).join("");
}

async function settle() {
  await Promise.resolve();
  await nextTick();
  await Promise.resolve();
  await nextTick();
}

function mountHistory(updateOverride?: ReturnType<typeof vi.fn>) {
  const session = {
    id: "session-1",
    title: "First title",
    updatedAt: 1,
    metadata: { role_release_id: "release-1" },
  } as SessionRecord;
  const update =
    updateOverride ??
    vi.fn(async (input: { sessionId: string; title?: string }) => ({
      ...session,
      title: input.title ?? session.title,
    }));
  const context = {
    config: {
      apiBaseUrl: "http://localhost:3000",
      adminBaseUrl: "http://localhost:5173",
    },
    policy: {},
    client: {
      roleReleases: { list: vi.fn().mockResolvedValue([]) },
      sessions: {
        list: vi.fn().mockResolvedValue([session]),
        update,
        remove: vi.fn().mockResolvedValue(true),
      },
    },
    sessionId: null,
    snapshotId: null,
    preview: null,
    roleReleaseId: null,
    characterName: null,
  } as unknown as RoleApplicationContext;
  const root = makeNode("root");
  const app = renderer.createApp(App, { context });
  app.mount(root);
  return { root, app, update };
}

function sessionRecord(
  id: string,
  title = "History title",
  characterName: string | null = null,
) {
  return {
    id,
    title,
    characterBinding: characterName
      ? {
          characterId: "character-fixed",
          characterVersionId: "version-fixed",
          snapshotSummary: { name: characterName, hasGreeting: true },
          syncPolicy: "pin",
        }
      : null,
    updatedAt: 1,
    metadata: { role_release_id: "release-1" },
  } as SessionRecord;
}

function roleRelease(
  openings = [
    {
      id: "opening-default",
      title: "默认开场",
      summary: "城门外",
      default: true,
    },
    {
      id: "opening-later",
      title: "后续开场",
      summary: "钟楼下",
      default: false,
    },
  ],
) {
  return {
    id: "release-1",
    name: "北境旅人",
    openings,
  } as unknown as import("@tavern/shared").RoleReleasePublic;
}

function roleReleaseNamed(id: string, name: string) {
  return { ...roleRelease(), id, name };
}

function installWindow() {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const target = {
    confirm: vi.fn(() => true),
    location: {
      href: "https://user.example/role?snapshotId=old-snapshot&floorId=legacy-floor",
      assign: vi.fn(),
    },
    history: { replaceState: vi.fn() },
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: target,
  });
  return {
    target,
    restore() {
      if (previous) Object.defineProperty(globalThis, "window", previous);
      else delete (globalThis as { window?: Window }).window;
    },
  };
}

function mountLibrary(
  options: {
    listRoles?: ReturnType<typeof vi.fn>;
    listSessions?: ReturnType<typeof vi.fn>;
    createSession?: ReturnType<typeof vi.fn>;
    updateSession?: ReturnType<typeof vi.fn>;
    removeSession?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const listRoles = options.listRoles ?? vi.fn().mockResolvedValue([]);
  const listSessions = options.listSessions ?? vi.fn().mockResolvedValue([]);
  const createSession =
    options.createSession ??
    vi.fn().mockResolvedValue({ session: { id: "created-session" } });
  const updateSession =
    options.updateSession ??
    vi.fn().mockResolvedValue(sessionRecord("session-1"));
  const removeSession =
    options.removeSession ?? vi.fn().mockResolvedValue(true);
  const context = {
    config: {
      apiBaseUrl: "http://localhost:3000",
      adminBaseUrl: "http://localhost:5173",
    },
    policy: {},
    client: {
      roleReleases: { list: listRoles, createSession },
      sessions: {
        list: listSessions,
        update: updateSession,
        remove: removeSession,
      },
    },
    sessionId: null,
    snapshotId: null,
    preview: null,
    roleReleaseId: null,
    characterName: null,
  } as unknown as RoleApplicationContext;
  const root = makeNode("root");
  const app = renderer.createApp(App, { context });
  app.mount(root);
  return {
    root,
    app,
    listRoles,
    listSessions,
    createSession,
    updateSession,
    removeSession,
  };
}

function mountSession(
  options: {
    sessionId?: string;
    snapshotId?: string | null;
    roleReleaseId?: string | null;
    characterName?: string | null;
    preview?: RoleApplicationContext["preview"];
    listRoles?: ReturnType<typeof vi.fn>;
    createSession?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const listRoles = options.listRoles ?? vi.fn().mockResolvedValue([]);
  const createSession =
    options.createSession ??
    vi.fn().mockResolvedValue({ session: { id: "created-session" } });
  const context = {
    config: {
      apiBaseUrl: "http://localhost:3000",
      adminBaseUrl: "http://localhost:5173",
    },
    policy: {},
    client: {
      roleReleases: { list: listRoles, createSession },
      sessions: {
        list: vi.fn().mockResolvedValue([]),
        update: vi.fn(),
        remove: vi.fn(),
      },
    },
    sessionId: options.sessionId ?? "existing-session",
    snapshotId: options.snapshotId ?? null,
    preview: options.preview ?? null,
    roleReleaseId: options.roleReleaseId ?? null,
    characterName: options.characterName ?? null,
  } as unknown as RoleApplicationContext;
  const root = makeNode("root");
  const app = renderer.createApp(App, { context });
  app.mount(root);
  return { root, app, listRoles, createSession };
}

function selectByLabel(root: TestNode, ariaLabel: string) {
  return find(
    root,
    (node) =>
      node.elementTag === "select" && node.props["aria-label"] === ariaLabel,
  );
}

function selectedRoleIdentityOption(select: TestNode) {
  return select.children.find(
    (node) =>
      node.type === "option" && node.props.value === "__current_session_role__",
  );
}

function changeSelect(select: TestNode, value: string) {
  (select.props.onChange as (event: { target: { value: string } }) => void)({
    target: { value },
  });
}

function emitChatEvent(root: TestNode, prop: string, value: unknown) {
  const chat = find(
    root,
    (node) => node.props.class === "chat-session-test-double",
  );
  if (!chat) throw new Error("ChatSession test double was not rendered");
  const callback = chat.props[prop];
  if (typeof callback !== "function")
    throw new Error(`ChatSession test event ${prop} was not rendered`);
  (callback as (payload: unknown) => void)(value);
  return chat;
}

function button(root: TestNode, text: string) {
  return find(root, (node) => node.type === "button" && label(node) === text);
}

async function chooseRole(view: { root: TestNode }) {
  const card = find(view.root, (node) => node.props.class === "role-card");
  if (!card) throw new Error("Role card was not rendered");
  (card.props.onClick as (event: { currentTarget: TestNode }) => void)({
    currentTarget: card,
  });
  await settle();
  return card;
}

function keydown(
  dialog: TestNode,
  target: TestNode,
  key: string,
  shiftKey = false,
) {
  const event = {
    type: "keydown",
    key,
    shiftKey,
    target,
    currentTarget: dialog,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
  (dialog.props.onKeydown as (value: typeof event) => void)(event);
  return event;
}

describe("user role session history", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    focusedTestNode = null;
  });

  it("passes a route snapshot ID directly to the role session", async () => {
    const view = mountSession({ snapshotId: "snapshot-from-route" });
    try {
      await settle();
      const chat = find(
        view.root,
        (node) => node.props.class === "chat-session-test-double",
      );
      expect(chat?.props["data-snapshot-id"]).toBe("snapshot-from-route");
    } finally {
      view.app.unmount();
    }
  });

  it("routes a role choice through opening confirmation without changing the bound session", async () => {
    const browser = installWindow();
    const pinned = roleReleaseNamed("release-bound", "绑定角色版本");
    const alternate = roleReleaseNamed("release-next", "另一角色");
    const createSession = vi.fn().mockResolvedValue({
      session: {
        id: "created-session",
        character_binding: {
          snapshot_summary: { name: "创建会话绑定角色名" },
        },
      },
    });
    const view = mountSession({
      roleReleaseId: pinned.id,
      characterName: "会话绑定角色名",
      listRoles: vi.fn().mockResolvedValue([pinned, alternate]),
      createSession,
    });
    try {
      await settle();
      emitChatEvent(view.root, "onTestReady", pinned.name);
      await settle();
      const selector = selectByLabel(view.root, "选择要开始新对话的角色");
      expect(selector?.props.value).toBe("__current_session_role__");
      expect(label(selector!)).toContain("会话绑定角色名");
      expect(label(selector!)).not.toContain("绑定角色版本");

      changeSelect(selector!, alternate.id);
      await settle();
      expect(
        label(find(view.root, (node) => node.props.role === "dialog")!),
      ).toContain(alternate.name);
      expect(createSession).not.toHaveBeenCalled();
      expect(
        find(
          view.root,
          (node) => node.props.class === "chat-session-test-double",
        )?.props["data-session-id"],
      ).toBe("existing-session");

      await (button(view.root, "取消")!.props.onClick as () => void)();
      await settle();
      expect(selector?.props.value).toBe("__current_session_role__");
      expect(label(selectedRoleIdentityOption(selector!)!)).toContain(
        "会话绑定角色名",
      );
      expect(label(selectedRoleIdentityOption(selector!)!)).not.toContain(
        alternate.name,
      );
      expect(createSession).not.toHaveBeenCalled();

      changeSelect(selector!, alternate.id);
      await settle();
      await (
        button(view.root, "开始演绎")!.props.onClick as () => Promise<void>
      )();
      await settle();
      expect(createSession).toHaveBeenCalledWith({
        releaseId: alternate.id,
        input: { opening_id: "opening-default" },
      });
      expect(
        find(
          view.root,
          (node) => node.props.class === "chat-session-test-double",
        )?.props["data-session-id"],
      ).toBe("created-session");
      const updatedSelector = selectByLabel(
        view.root,
        "选择要开始新对话的角色",
      );
      expect(updatedSelector?.props.value).toBe("__current_session_role__");
      expect(label(selectedRoleIdentityOption(updatedSelector!)!)).toContain(
        "创建会话绑定角色名",
      );
      expect(
        label(selectedRoleIdentityOption(updatedSelector!)!),
      ).not.toContain("绑定角色版本");
    } finally {
      view.app.unmount();
      browser.restore();
    }
  });

  it("lists status snapshots in server order and offers older pages on request", async () => {
    const view = mountSession({
      listRoles: vi.fn().mockResolvedValue([roleRelease()]),
    });
    try {
      await settle();
      const pointers = [
        {
          floorId: "floor-1",
          attemptId: "attempt-1",
          snapshotId: "snapshot-1",
        },
        {
          floorId: "floor-2",
          attemptId: "attempt-2",
          snapshotId: "snapshot-2",
        },
        {
          floorId: null,
          attemptId: null,
          snapshotId: "snapshot-initial",
        },
      ];
      const chat = emitChatEvent(view.root, "onTestHistory", {
        items: pointers,
        append: false,
        hasMore: true,
      });
      await settle();
      const selector = selectByLabel(view.root, "选择要查看的状态");
      expect(label(selector!)).toContain("当前状态");
      expect(label(selector!)).toContain("历史状态 1");
      expect(label(selector!)).toContain("历史状态 2");
      expect(label(selector!)).toContain("初始状态");

      const more = button(view.root, "加载更早状态");
      expect(more).toBeDefined();
      emitChatEvent(view.root, "onTestHistoryState", {
        busy: true,
        following: true,
        view: { snapshotId: "snapshot-live" },
      });
      await settle();
      expect(more?.disabled).toBe(true);
      emitChatEvent(view.root, "onTestHistoryState", {
        busy: false,
        following: true,
        view: { snapshotId: "snapshot-live" },
      });
      await settle();
      expect(more?.disabled).toBe(false);
      await (more!.props.onClick as () => void)();
      await settle();
      expect(chat.props["data-history-more-version"]).toBe(1);
      emitChatEvent(view.root, "onTestHistory", {
        items: [
          {
            floorId: "floor-3",
            attemptId: "attempt-3",
            snapshotId: "snapshot-3",
          },
        ],
        append: true,
        hasMore: false,
      });
      await settle();
      expect(label(selector!)).toContain("历史状态 4");
      expect(button(view.root, "加载更早状态")).toBeUndefined();

      changeSelect(selector!, "snapshot-2");
      await settle();
      expect(chat.props["data-history-selection"]).toBe("snapshot-2");
      emitChatEvent(view.root, "onTestHistoryState", {
        busy: false,
        following: false,
        view: { snapshotId: "snapshot-2" },
      });
      await settle();
      expect(selector?.props.value).toBe("snapshot-2");

      emitChatEvent(view.root, "onTestHistoryState", {
        busy: true,
        following: true,
        view: { snapshotId: "snapshot-live" },
      });
      await settle();
      expect(selector?.disabled).toBe(true);
      expect(selector?.props.value).toBe("latest");
      emitChatEvent(view.root, "onTestHistoryState", {
        busy: false,
        following: true,
        view: { snapshotId: "snapshot-live" },
      });
      await settle();
      expect(selector?.disabled).toBe(false);
    } finally {
      view.app.unmount();
    }
  });

  it("shows only current state when the snapshot page is empty", async () => {
    const view = mountSession();
    try {
      await settle();
      emitChatEvent(view.root, "onTestHistory", {
        items: [],
        append: false,
        hasMore: false,
      });
      await settle();
      const selector = selectByLabel(view.root, "选择要查看的状态");
      expect(selector).toBeDefined();
      expect(label(selector!)).toContain("当前状态");
      expect(
        selector!.children.filter((node) => node.type === "option"),
      ).toHaveLength(1);
    } finally {
      view.app.unmount();
    }
  });

  it("shows history loading failures and asks the session controller to retry", async () => {
    const view = mountSession();
    try {
      await settle();
      emitChatEvent(view.root, "onTestHistoryLoading", true);
      emitChatEvent(view.root, "onTestHistoryFailure", {
        error: Object.assign(new Error("offline"), {
          code: "NETWORK_ERROR",
        }),
        action: { kind: "list", cursor: "older-page-cursor" },
      });
      await settle();
      expect(label(view.root)).toContain("正在读取历史状态…");
      expect(label(view.root)).toContain("历史状态读取失败");
      expect(label(view.root)).toContain(apiErrorMessages.NETWORK_ERROR);

      const chat = find(
        view.root,
        (node) => node.props.class === "chat-session-test-double",
      );
      expect(chat?.props["data-history-refresh-version"]).toBe(0);
      await (button(view.root, "重新加载")!.props.onClick as () => void)();
      await settle();
      expect(chat?.props["data-history-refresh-version"]).toBe(1);
      expect(chat?.props["data-history-retry-cursor"]).toBe(
        "older-page-cursor",
      );
    } finally {
      view.app.unmount();
    }
  });

  it("retries the failed snapshot and drops that retry when generation starts", async () => {
    const view = mountSession();
    try {
      await settle();
      const snapshotFailure = {
        error: Object.assign(new Error("snapshot offline"), {
          code: "NETWORK_ERROR",
        }),
        action: { kind: "snapshot", snapshotId: "snapshot-failed" },
      };
      emitChatEvent(view.root, "onTestHistoryFailure", snapshotFailure);
      await settle();
      const chat = find(
        view.root,
        (node) => node.props.class === "chat-session-test-double",
      );
      expect(label(view.root)).toContain(apiErrorMessages.NETWORK_ERROR);
      await (button(view.root, "重新加载")!.props.onClick as () => void)();
      await settle();
      expect(chat?.props["data-history-selection-retry-version"]).toBe(1);
      expect(chat?.props["data-history-retry-snapshot-id"]).toBe(
        "snapshot-failed",
      );
      expect(label(view.root)).not.toContain(apiErrorMessages.NETWORK_ERROR);

      emitChatEvent(view.root, "onTestHistoryFailure", snapshotFailure);
      await settle();
      emitChatEvent(view.root, "onTestHistoryState", {
        busy: true,
        following: true,
        view: { snapshotId: "snapshot-current" },
      });
      await settle();
      expect(label(view.root)).not.toContain(apiErrorMessages.NETWORK_ERROR);
      expect(button(view.root, "重新加载")).toBeUndefined();
      expect(chat?.props["data-history-selection-retry-version"]).toBe(1);
    } finally {
      view.app.unmount();
    }
  });

  it("shows role catalog loading failures and reloads the available roles", async () => {
    const available = roleReleaseNamed("release-retry", "重试成功角色");
    const listRoles = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("offline"), { code: "NETWORK_ERROR" }),
      )
      .mockResolvedValueOnce([available]);
    const view = mountSession({ listRoles });
    try {
      await settle();
      const selector = selectByLabel(view.root, "选择要开始新对话的角色");
      expect(selector?.disabled).toBe(true);
      expect(label(view.root)).toContain("已发布角色读取失败");
      expect(label(view.root)).toContain(apiErrorMessages.NETWORK_ERROR);
      expect(listRoles).toHaveBeenCalledTimes(1);

      await (
        button(view.root, "重新加载")!.props.onClick as () => Promise<void>
      )();
      await settle();
      expect(listRoles).toHaveBeenCalledTimes(2);
      expect(selector?.disabled).toBe(false);
      expect(label(selector!)).toContain(available.name);
      expect(label(view.root)).not.toContain("已发布角色读取失败");
    } finally {
      view.app.unmount();
    }
  });

  it("clears a resolved role catalog failure after returning to the catalog and starting a session", async () => {
    const browser = installWindow();
    const available = roleReleaseNamed(
      "release-after-return",
      "返回后可用角色",
    );
    const listRoles = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("offline"), { code: "NETWORK_ERROR" }),
      )
      .mockResolvedValueOnce([available]);
    const view = mountSession({
      listRoles,
      createSession: vi.fn().mockResolvedValue({
        session: {
          id: "created-after-return",
          character_binding: {
            snapshot_summary: { name: "返回后新会话角色" },
          },
        },
      }),
    });
    try {
      await settle();
      expect(label(view.root)).toContain("已发布角色读取失败");
      await (
        button(view.root, "返回角色列表")!.props.onClick as () => Promise<void>
      )();
      await settle();

      expect(listRoles).toHaveBeenCalledTimes(2);
      expect(label(view.root)).not.toContain("已发布角色读取失败");
      await chooseRole(view);
      await (
        button(view.root, "开始演绎")!.props.onClick as () => Promise<void>
      )();
      await settle();

      expect(
        find(
          view.root,
          (node) => node.props["data-session-id"] === "created-after-return",
        ),
      ).toBeDefined();
      expect(label(view.root)).not.toContain("已发布角色读取失败");
      expect(label(view.root)).not.toContain(apiErrorMessages.NETWORK_ERROR);
    } finally {
      view.app.unmount();
      browser.restore();
    }
  });

  it.each([false, true])(
    "reloads the role selector after opening creation fails in preview=%s",
    async (preview) => {
      const browser = installWindow();
      const alternate = roleReleaseNamed("release-next", "另一角色");
      const listRoles = vi
        .fn()
        .mockResolvedValueOnce([alternate])
        .mockResolvedValueOnce([]);
      const view = mountSession({
        preview: preview
          ? { draft_id: "draft-a", draft_revision: 7, creator_id: "admin" }
          : null,
        listRoles,
        createSession: vi
          .fn()
          .mockRejectedValue(
            Object.assign(new Error(), { code: "NETWORK_ERROR" }),
          ),
      });
      try {
        await settle();
        const selector = selectByLabel(view.root, "选择要开始新对话的角色")!;
        changeSelect(selector, alternate.id);
        await settle();
        await (
          button(view.root, "开始演绎")!.props.onClick as () => Promise<void>
        )();
        await settle();
        expect(label(view.root)).toContain(apiErrorMessages.NETWORK_ERROR);
        await (
          button(view.root, "重新加载")!.props.onClick as () => Promise<void>
        )();
        await settle();
        expect(listRoles).toHaveBeenCalledTimes(2);
        expect(
          find(view.root, (node) => node.props.role === "dialog"),
        ).toBeUndefined();
        expect(label(selector)).not.toContain(alternate.name);
        expect(label(view.root)).not.toContain(apiErrorMessages.NETWORK_ERROR);
        expect(focusedTestNode).toBe(
          find(view.root, (node) => node.props.class === "chat"),
        );
      } finally {
        view.app.unmount();
        browser.restore();
      }
    },
  );

  it("keeps the pinned role visible when it is no longer published", async () => {
    const view = mountSession({
      roleReleaseId: "release-removed",
      characterName: "已下架的会话角色",
      listRoles: vi
        .fn()
        .mockResolvedValue([roleReleaseNamed("release-other", "其他角色")]),
    });
    try {
      await settle();
      emitChatEvent(view.root, "onTestReady", "已下架的会话角色");
      await settle();
      const selector = selectByLabel(view.root, "选择要开始新对话的角色");
      expect(selector?.props.value).toBe("__current_session_role__");
      expect(label(selector!)).toContain("已下架的会话角色");
      expect(label(selector!)).toContain("其他角色");
      emitChatEvent(view.root, "onTestHistory", {
        items: [
          {
            floorId: "floor-retained",
            attemptId: "attempt-retained",
            snapshotId: "snapshot-retained",
          },
        ],
        append: false,
        hasMore: false,
      });
      await settle();
      expect(
        label(selectByLabel(view.root, "选择要查看的状态")!),
      ).toContain("历史状态 1");
      expect(
        find(
          view.root,
          (node) => node.props.class === "chat-session-test-double",
        )?.props["data-session-id"],
      ).toBe("existing-session");
    } finally {
      view.app.unmount();
    }
  });

  it("keeps preview links and fixed preview identity until another session is explicitly created", async () => {
    const browser = installWindow();
    const preview = {
      draft_id: "draft-a",
      draft_revision: 7,
      creator_id: "admin",
    };
    const alternate = roleReleaseNamed("release-next", "正式新角色");
    const view = mountSession({
      preview,
      listRoles: vi.fn().mockResolvedValue([alternate]),
    });
    try {
      await settle();
      const chat = emitChatEvent(view.root, "onTestCurrent", {
        branchId: "branch-a",
        floorId: "floor-a",
        source: { runId: "run-a" },
      });
      emitChatEvent(view.root, "onTestReady", "管理端试聊角色");
      await settle();
      expect(
        find(
          view.root,
          (node) =>
            node.elementTag === "a" &&
            node.props.href === "http://localhost:5173",
        ),
      ).toBeDefined();
      expect(
        find(
          view.root,
          (node) =>
            node.elementTag === "a" &&
            String(node.props.href).includes("sessionId=existing-session"),
        ),
      ).toBeDefined();

      const selector = selectByLabel(view.root, "选择要开始新对话的角色");
      expect(label(selector!)).toContain("草稿修订 7");
      expect(label(selectedRoleIdentityOption(selector!)!)).toContain(
        "角色身份固定",
      );
      changeSelect(selector!, alternate.id);
      await settle();
      expect(
        find(
          view.root,
          (node) => node.props.class === "chat-session-test-double",
        ),
      ).toBe(chat);
      expect(view.createSession).not.toHaveBeenCalled();
      await (button(view.root, "取消")!.props.onClick as () => void)();
      await settle();
      expect(
        find(
          view.root,
          (node) => node.props.class === "chat-session-test-double",
        )?.props["data-session-id"],
      ).toBe("existing-session");

      changeSelect(selector!, alternate.id);
      await settle();
      await (
        button(view.root, "开始演绎")!.props.onClick as () => Promise<void>
      )();
      expect(browser.target.location.assign).toHaveBeenCalledWith(
        "https://user.example/role?sessionId=created-session",
      );
      expect(view.createSession).toHaveBeenCalledWith({
        releaseId: alternate.id,
        input: { opening_id: "opening-default" },
      });
      expect(
        find(
          view.root,
          (node) => node.props.class === "chat-session-test-double",
        )?.props["data-session-id"],
      ).toBe("existing-session");
    } finally {
      view.app.unmount();
      browser.restore();
    }
  });

  it("renames a history item through the sessions update operation", async () => {
    const view = mountHistory();
    try {
      await settle();
      const historyTab = find(
        view.root,
        (node) => node.type === "button" && label(node) === "我的对话",
      );
      expect(historyTab).toBeDefined();
      await (historyTab!.props.onClick as () => void)();
      await settle();

      const rename = find(view.root, (node) => label(node) === "重命名");
      expect(rename).toBeDefined();
      await (rename!.props.onClick as () => void)();
      await settle();

      const title = find(view.root, (node) => node.type === "input");
      expect(title).toBeDefined();
      (title!.props.onInput as (event: { target: { value: string } }) => void)({
        target: { value: "New title" },
      });
      await settle();
      const save = find(view.root, (node) => label(node) === "保存名称");
      expect(save).toBeDefined();
      await (save!.props.onClick as () => Promise<void>)();
      await settle();

      expect(view.update).toHaveBeenCalledWith({
        sessionId: "session-1",
        title: "New title",
      });
      expect(label(view.root)).toContain("New title");
      expect(label(view.root)).not.toContain("First title");
    } finally {
      view.app.unmount();
    }
  });

  it("cancels an edit without changing the session", async () => {
    const view = mountHistory();
    try {
      await settle();
      const historyTab = find(
        view.root,
        (node) => node.type === "button" && label(node) === "我的对话",
      );
      await (historyTab!.props.onClick as () => void)();
      await settle();
      const rename = find(view.root, (node) => label(node) === "重命名");
      expect(rename).toBeDefined();
      await (rename!.props.onClick as () => void)();
      await settle();
      const cancel = find(view.root, (node) => label(node) === "取消编辑");
      expect(cancel).toBeDefined();
      await (cancel!.props.onClick as () => void)();
      await settle();

      expect(view.update).not.toHaveBeenCalled();
      expect(label(view.root)).toContain("First title");
      expect(find(view.root, (node) => node.type === "input")).toBeUndefined();
    } finally {
      view.app.unmount();
    }
  });

  it("keeps the edit open and shows the configured error when rename fails", async () => {
    const update = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("offline"), { code: "NETWORK_ERROR" }),
      );
    const view = mountHistory(update);
    try {
      await settle();
      const historyTab = find(
        view.root,
        (node) => node.type === "button" && label(node) === "我的对话",
      );
      await (historyTab!.props.onClick as () => void)();
      await settle();
      const rename = find(view.root, (node) => label(node) === "重命名");
      await (rename!.props.onClick as () => void)();
      await settle();

      const title = find(view.root, (node) => node.type === "input");
      (title!.props.onInput as (event: { target: { value: string } }) => void)({
        target: { value: "   " },
      });
      await settle();
      const save = find(view.root, (node) => label(node) === "保存名称");
      expect(save!.props.disabled).toBe(true);
      expect(update).not.toHaveBeenCalled();

      (title!.props.onInput as (event: { target: { value: string } }) => void)({
        target: { value: "Updated after retry" },
      });
      await settle();
      await (save!.props.onClick as () => Promise<void>)();
      await settle();

      expect(update).toHaveBeenCalledWith({
        sessionId: "session-1",
        title: "Updated after retry",
      });
      expect(label(view.root)).toContain(apiErrorMessages.NETWORK_ERROR);
      expect(find(view.root, (node) => node.type === "input")).toBeDefined();
    } finally {
      view.app.unmount();
    }
  });

  it("retries the failed catalog load from the visible reload action", async () => {
    const role = roleRelease();
    const listRoles = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("offline"), { code: "NETWORK_ERROR" }),
      )
      .mockResolvedValue([role]);
    const view = mountLibrary({ listRoles });
    try {
      await settle();
      expect(label(view.root)).toContain(apiErrorMessages.NETWORK_ERROR);
      const retry = button(view.root, "重新加载");
      expect(retry).toBeDefined();
      await (retry!.props.onClick as () => Promise<void>)();
      await settle();

      expect(listRoles).toHaveBeenCalledTimes(2);
      expect(label(view.root)).toContain(role.name);
      expect(label(view.root)).not.toContain(apiErrorMessages.NETWORK_ERROR);
    } finally {
      view.app.unmount();
    }
  });

  it("selects a role opening and starts a session through the client", async () => {
    const browser = installWindow();
    const role = roleRelease();
    const createSession = vi
      .fn()
      .mockResolvedValue({ session: { id: "created-session" } });
    const view = mountLibrary({
      listRoles: vi.fn().mockResolvedValue([role]),
      createSession,
    });
    try {
      await settle();
      await chooseRole(view);

      const alternate = find(
        view.root,
        (node) => node.props.type === "radio" && node.value === "opening-later",
      );
      expect(alternate).toBeDefined();
      alternate!.dispatchEvent({ type: "change" });
      await settle();
      expect(alternate!.checked).toBe(true);

      const start = button(view.root, "开始演绎");
      expect(start).toBeDefined();
      await (start!.props.onClick as () => Promise<void>)();
      await settle();

      expect(createSession).toHaveBeenCalledWith({
        releaseId: "release-1",
        input: { opening_id: "opening-later" },
      });
      expect(
        find(
          view.root,
          (node) => node.props["data-session-id"] === "created-session",
        ),
      ).toBeDefined();
      const url = browser.target.history.replaceState.mock.calls[0]?.[2] as URL;
      expect(url.searchParams.get("sessionId")).toBe("created-session");
      expect(url.searchParams.has("floorId")).toBe(false);
      expect(url.searchParams.has("snapshotId")).toBe(false);
    } finally {
      view.app.unmount();
      browser.restore();
    }
  });

  it("cancels opening selection without creating a session", async () => {
    const browser = installWindow();
    const role = roleRelease();
    const createSession = vi.fn();
    const view = mountLibrary({
      listRoles: vi.fn().mockResolvedValue([role]),
      createSession,
    });
    try {
      await settle();
      const card = await chooseRole(view);
      const cancel = button(view.root, "取消");
      expect(cancel).toBeDefined();
      await (cancel!.props.onClick as () => void)();
      await settle();

      expect(createSession).not.toHaveBeenCalled();
      expect(
        find(view.root, (node) => node.props["role"] === "dialog"),
      ).toBeUndefined();
      expect(card.focusCount).toBe(1);
    } finally {
      view.app.unmount();
      browser.restore();
    }
  });

  it("focuses the selected opening and traps Tab within the dialog", async () => {
    const browser = installWindow();
    const view = mountLibrary({
      listRoles: vi.fn().mockResolvedValue([roleRelease()]),
    });
    try {
      await settle();
      const card = await chooseRole(view);
      const dialog = find(view.root, (node) => node.props.role === "dialog");
      const selected = find(
        dialog!,
        (node) => node.props.type === "radio" && node.checked === true,
      );
      const cancel = button(view.root, "取消");
      const start = button(view.root, "开始演绎");
      expect(dialog).toBeDefined();
      expect(selected?.props.value).toBe("opening-default");
      expect(selected?.focusCount).toBe(1);
      expect(
        find(view.root, (node) => node.props.class === "library")?.props.inert,
      ).toBe(true);

      const forwardWrap = keydown(dialog!, start!, "Tab");
      expect(forwardWrap.defaultPrevented).toBe(true);
      expect(selected?.focusCount).toBe(2);

      const interiorTab = keydown(dialog!, cancel!, "Tab");
      expect(interiorTab.defaultPrevented).toBe(false);

      const backwardFromTail = keydown(dialog!, start!, "Tab", true);
      expect(backwardFromTail.defaultPrevented).toBe(false);
      if (!backwardFromTail.defaultPrevented) cancel!.focus();
      expect(cancel?.focusCount).toBe(1);

      const backwardWrap = keydown(dialog!, selected!, "Tab", true);
      expect(backwardWrap.defaultPrevented).toBe(true);
      expect(start?.focusCount).toBe(1);

      dialog!.focus();
      expect(keydown(dialog!, dialog!, "Tab").defaultPrevented).toBe(true);
      expect(selected?.focusCount).toBe(3);
      dialog!.focus();
      expect(keydown(dialog!, dialog!, "Tab", true).defaultPrevented).toBe(
        true,
      );
      expect(start?.focusCount).toBe(2);

      await (cancel!.props.onClick as () => void)();
      await settle();
      expect(card.focusCount).toBe(1);
      expect(
        find(view.root, (node) => node.props.class === "library")?.props.inert,
      ).toBe(false);
    } finally {
      view.app.unmount();
      browser.restore();
    }
  });

  it("keeps Tab on the cancel action when the selected role has no openings", async () => {
    const browser = installWindow();
    const view = mountLibrary({
      listRoles: vi.fn().mockResolvedValue([roleRelease([])]),
    });
    try {
      await settle();
      await chooseRole(view);
      const dialog = find(view.root, (node) => node.props.role === "dialog");
      const cancel = button(view.root, "取消");
      const start = button(view.root, "开始演绎");
      expect(start?.disabled).toBe(true);
      expect(cancel?.focusCount).toBe(1);
      expect(keydown(dialog!, cancel!, "Tab").defaultPrevented).toBe(true);
      expect(keydown(dialog!, cancel!, "Tab", true).defaultPrevented).toBe(
        true,
      );
      expect(cancel?.focusCount).toBe(3);
    } finally {
      view.app.unmount();
      browser.restore();
    }
  });

  it.each([false, true])(
    "handles Escape with creation pending=%s",
    async (pending) => {
      const browser = installWindow();
      let resolveCreation!: (value: unknown) => void;
      const createSession = vi.fn(
        () =>
          new Promise((resolve) => {
            resolveCreation = resolve;
          }),
      );
      const view = mountLibrary({
        listRoles: vi.fn().mockResolvedValue([roleRelease()]),
        createSession,
      });
      try {
        await settle();
        const card = await chooseRole(view);
        const request = pending
          ? (
              button(view.root, "开始演绎")!.props
                .onClick as () => Promise<void>
            )()
          : undefined;
        await settle();
        const dialog = find(view.root, (node) => node.props.role === "dialog");
        expect(dialog?.props.onKeydown).toBeTypeOf("function");
        keydown(dialog!, dialog!, "Escape");
        await settle();
        expect(
          Boolean(find(view.root, (node) => node.props.role === "dialog")),
        ).toBe(pending);
        expect(createSession).toHaveBeenCalledTimes(pending ? 1 : 0);
        if (!pending) expect(card.focusCount).toBe(1);
        else expect(button(view.root, "取消")?.disabled).toBe(true);
        if (pending) {
          resolveCreation({ session: { id: "created-session" } });
          await request;
          await settle();
          expect(
            find(view.root, (node) => node.props.role === "dialog"),
          ).toBeUndefined();
          expect(card.focusCount).toBe(0);
          const chat = find(view.root, (node) => node.props.class === "chat");
          expect(chat?.props.tabindex).toBe("-1");
          expect(focusedTestNode).toBe(chat);
        }
      } finally {
        view.app.unmount();
        browser.restore();
      }
    },
  );

  it.each(["removed", "changed", "unchanged"])(
    "returns focus to the catalog when failed creation reloads a %s role",
    async (change) => {
      const browser = installWindow();
      let resolveReload!: (value: unknown[]) => void;
      const listRoles = vi
        .fn()
        .mockResolvedValueOnce([roleRelease()])
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveReload = resolve;
            }),
        );
      const createSession = vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error("offline"), { code: "NETWORK_ERROR" }),
        );
      const view = mountLibrary({ listRoles, createSession });
      try {
        await settle();
        await chooseRole(view);
        await (
          button(view.root, "开始演绎")!.props.onClick as () => Promise<void>
        )();
        await settle();
        const reload = (
          button(view.root, "重新加载")!.props.onClick as () => Promise<void>
        )();
        await settle();
        expect(
          find(view.root, (node) => node.props.role === "dialog"),
        ).toBeUndefined();
        const library = find(
          view.root,
          (node) => node.props.class === "library",
        );
        expect(focusedTestNode).toBe(library);
        expect(createSession).toHaveBeenCalledTimes(1);
        const refreshed = roleRelease();
        if (change === "changed")
          refreshed.openings[0]!.title = "Updated opening";
        resolveReload(change === "removed" ? [] : [refreshed]);
        await reload;
        await settle();
        expect(focusedTestNode).toBe(library);
        if (change === "removed") {
          expect(
            find(view.root, (node) => node.props.class === "role-card"),
          ).toBeUndefined();
        } else {
          await chooseRole(view);
          expect(
            label(find(view.root, (node) => node.props.role === "dialog")!),
          ).toContain(refreshed.openings[0]!.title);
        }
      } finally {
        view.app.unmount();
        browser.restore();
      }
    },
  );

  it("keeps the selected role and reports a configured error when creation fails", async () => {
    const browser = installWindow();
    const role = roleRelease();
    const createSession = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("offline"), { code: "NETWORK_ERROR" }),
      );
    const view = mountLibrary({
      listRoles: vi.fn().mockResolvedValue([role]),
      createSession,
    });
    try {
      await settle();
      await chooseRole(view);
      const start = button(view.root, "开始演绎");
      await (start!.props.onClick as () => Promise<void>)();
      await settle();

      expect(createSession).toHaveBeenCalledTimes(1);
      const dialog = find(view.root, (node) => node.props.role === "dialog");
      const error = find(dialog!, (node) => node.props.role === "alert");
      expect(label(error!)).toContain(apiErrorMessages.NETWORK_ERROR);
      expect(error?.props.inert).not.toBe(true);
      expect(
        find(view.root, (node) => node.props["role"] === "dialog"),
      ).toBeDefined();
      expect(
        find(view.root, (node) => node.props["data-session-id"] !== undefined),
      ).toBeUndefined();
    } finally {
      view.app.unmount();
      browser.restore();
    }
  });

  it("restores dialog focus after disabling the focused start button and after creation fails", async () => {
    const browser = installWindow();
    let rejectCreation!: (error: unknown) => void;
    const createSession = vi.fn(
      () =>
        new Promise((_, reject) => {
          rejectCreation = reject;
        }),
    );
    const view = mountLibrary({
      listRoles: vi.fn().mockResolvedValue([roleRelease()]),
      createSession,
    });
    try {
      await settle();
      await chooseRole(view);
      const dialog = find(view.root, (node) => node.props.role === "dialog");
      const selectedOpening = find(
        dialog!,
        (node) => node.props.type === "radio" && node.checked === true,
      );
      const start = button(view.root, "开始演绎");
      start!.focus();
      const request = (start!.props.onClick as () => Promise<void>)();
      await settle();

      expect(start?.disabled).toBe(true);
      expect(focusedTestNode).toBe(selectedOpening);
      expect(selectedOpening?.focusCount).toBe(2);

      const escape = keydown(dialog!, selectedOpening!, "Escape");
      expect(escape.defaultPrevented).toBe(true);
      expect(find(view.root, (node) => node.props.role === "dialog")).toBe(
        dialog,
      );

      rejectCreation(
        Object.assign(new Error("offline"), { code: "NETWORK_ERROR" }),
      );
      await request;
      await settle();

      expect(start?.disabled).toBe(false);
      expect(focusedTestNode).toBe(selectedOpening);
      expect(selectedOpening?.focusCount).toBe(3);
      expect(label(view.root)).toContain(apiErrorMessages.NETWORK_ERROR);
    } finally {
      view.app.unmount();
      browser.restore();
    }
  });

  it("continues a history session and switches between history and catalog", async () => {
    const browser = installWindow();
    const record = sessionRecord(
      "existing-session",
      "Existing session",
      "Bound character name",
    );
    const updateSession = vi.fn(
      async (input: { sessionId: string; title?: string }) => ({
        ...record,
        title: input.title ?? record.title,
      }),
    );
    const view = mountLibrary({
      listSessions: vi.fn().mockResolvedValue([record]),
      updateSession,
    });
    try {
      await settle();
      const historyTab = button(view.root, "我的对话");
      await (historyTab!.props.onClick as () => void)();
      await settle();
      expect(historyTab!.props["aria-pressed"]).toBe(true);

      await (button(view.root, "重命名")!.props.onClick as () => void)();
      await settle();
      const renameInput = find(view.root, (node) => node.type === "input");
      expect(renameInput).toBeDefined();
      (
        renameInput!.props.onInput as (event: {
          target: { value: string };
        }) => void
      )({
        target: { value: "Renamed conversation title" },
      });
      await settle();
      await (
        button(view.root, "保存名称")!.props.onClick as () => Promise<void>
      )();
      await settle();

      const continueButton = button(view.root, "继续对话");
      expect(continueButton).toBeDefined();
      await (continueButton!.props.onClick as () => void)();
      await settle();
      emitChatEvent(view.root, "onTestReady", "Renamed conversation title");
      await settle();

      expect(
        find(
          view.root,
          (node) => node.props["data-session-id"] === "existing-session",
        ),
      ).toBeDefined();
      const topbar = find(view.root, (node) => node.props.class === "topbar");
      expect(label(topbar!.children[0]!)).toBe("Renamed conversation title");
      const roleSelector = selectByLabel(view.root, "选择要开始新对话的角色");
      expect(label(roleSelector!)).toContain("Bound character name");
      expect(label(roleSelector!)).not.toContain("Renamed conversation title");
      expect(updateSession).toHaveBeenCalledWith({
        sessionId: "existing-session",
        title: "Renamed conversation title",
      });
      const url = browser.target.history.replaceState.mock.calls.at(
        -1,
      )?.[2] as URL;
      expect(url.searchParams.get("sessionId")).toBe("existing-session");
      const back = button(view.root, "返回角色列表");
      await (back!.props.onClick as () => Promise<void>)();
      await settle();
      expect(label(view.root)).toContain("选择角色");
      expect(browser.target.history.replaceState).toHaveBeenCalledTimes(2);
      const catalogTab = button(view.root, "选择角色");
      expect(catalogTab!.props["aria-pressed"]).toBe(true);
      await (historyTab!.props.onClick as () => void)();
      await settle();
      expect(button(view.root, "继续对话")).toBeDefined();
    } finally {
      view.app.unmount();
      browser.restore();
    }
  });

  it("honors delete cancellation, keeps a failed deletion, then removes it after success", async () => {
    const browser = installWindow();
    const removeSession = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("offline"), { code: "NETWORK_ERROR" }),
      )
      .mockResolvedValue(true);
    const view = mountLibrary({
      listSessions: vi.fn().mockResolvedValue([sessionRecord("session-1")]),
      removeSession,
    });
    try {
      await settle();
      const historyTab = button(view.root, "我的对话");
      await (historyTab!.props.onClick as () => void)();
      await settle();
      const deleteButton = button(view.root, "删除对话");
      browser.target.confirm.mockReturnValueOnce(false);
      await (deleteButton!.props.onClick as () => Promise<void>)();
      expect(browser.target.confirm).toHaveBeenCalledWith(
        "删除后将无法恢复这段对话，是否继续？",
      );
      expect(removeSession).not.toHaveBeenCalled();
      expect(label(view.root)).toContain("History title");

      browser.target.confirm.mockReturnValue(true);
      await (deleteButton!.props.onClick as () => Promise<void>)();
      await settle();
      expect(removeSession).toHaveBeenCalledTimes(1);
      expect(label(view.root)).toContain(apiErrorMessages.NETWORK_ERROR);
      expect(label(view.root)).toContain("History title");

      await (deleteButton!.props.onClick as () => Promise<void>)();
      await settle();
      expect(removeSession).toHaveBeenCalledTimes(2);
      expect(label(view.root)).not.toContain("History title");
    } finally {
      view.app.unmount();
      browser.restore();
    }
  });

  it("loads the next history page from the visible more action", async () => {
    const browser = installWindow();
    const firstPage = Array.from({ length: 100 }, (_, index) =>
      sessionRecord(`session-${index}`, `History ${index}`),
    );
    const listSessions = vi
      .fn()
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([sessionRecord("session-last", "Last session")]);
    const view = mountLibrary({ listSessions });
    try {
      await settle();
      const historyTab = button(view.root, "我的对话");
      await (historyTab!.props.onClick as () => void)();
      await settle();
      const more = button(view.root, "加载更多");
      expect(more).toBeDefined();
      await (more!.props.onClick as () => Promise<void>)();
      await settle();

      expect(listSessions).toHaveBeenLastCalledWith({
        limit: 100,
        offset: 100,
        sortBy: "updated_at",
        sortOrder: "desc",
      });
      expect(label(view.root)).toContain("Last session");
      expect(button(view.root, "加载更多")).toBeUndefined();
    } finally {
      view.app.unmount();
      browser.restore();
    }
  });
});
