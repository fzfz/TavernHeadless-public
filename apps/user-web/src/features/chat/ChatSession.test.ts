import { afterEach, describe, expect, it, vi } from "vitest";
import { createRenderer, defineComponent, h, nextTick, ref, ssrContextKey } from "vue";
import type { RoleRuntimeSession } from "@tavern/shared";
import interaction from "../../config/role-interaction.json";
import ChatSession from "./ChatSession.vue";

const mocks = vi.hoisted(() => ({
  createRoleTransport: vi.fn(),
  createScriptRuntime: vi.fn(),
}));

vi.mock("./transport.js", () => ({
  createRoleTransport: mocks.createRoleTransport,
}));

vi.mock("../../runtime/script-runtime.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../runtime/script-runtime.js")
  >("../../runtime/script-runtime.js");
  return { ...actual, createScriptRuntime: mocks.createScriptRuntime };
});

type TestNode = {
  type: string;
  props: Record<string, unknown>;
  children: TestNode[];
  parent: TestNode | null;
  text: string;
};

function createNode(type: string, text = ""): TestNode {
  return { type, props: {}, children: [], parent: null, text };
}

const renderer = createRenderer<TestNode, TestNode>({
  createElement: (type) => createNode(type),
  createText: (text) => createNode("#text", text),
  createComment: (text) => createNode("#comment", text),
  setText(node, text) {
    node.text = text;
  },
  setElementText(node, text) {
    node.text = text;
    node.children = [];
  },
  patchProp(node, key, _previous, next) {
    node.props[key] = next;
  },
  insert(node, parent, anchor) {
    if (node.parent) {
      const oldIndex = node.parent.children.indexOf(node);
      if (oldIndex >= 0) node.parent.children.splice(oldIndex, 1);
    }
    node.parent = parent;
    const anchorIndex = anchor ? parent.children.indexOf(anchor) : -1;
    parent.children.splice(
      anchorIndex < 0 ? parent.children.length : anchorIndex,
      0,
      node,
    );
  },
  remove(node) {
    if (!node.parent) return;
    const index = node.parent.children.indexOf(node);
    if (index >= 0) node.parent.children.splice(index, 1);
    node.parent = null;
  },
  parentNode: (node) => node.parent,
  nextSibling(node) {
    if (!node.parent) return null;
    return node.parent.children[node.parent.children.indexOf(node) + 1] ?? null;
  },
});

const initial = {
  sessionId: "session-history",
  branchId: "branch-history",
  floorId: null,
  attemptId: null,
  versionId: "version-history",
  snapshotId: "snapshot-initial",
  parentSnapshotId: null,
  variables: { place: "起点" },
  source: { kind: "initial", runId: null, jobId: null },
};

function floorSnapshot(snapshotId: string, floorId: string, place: string) {
  return {
    sessionId: initial.sessionId,
    branchId: initial.branchId,
    floorId,
    attemptId: `attempt-${floorId}`,
    versionId: initial.versionId,
    snapshotId,
    parentSnapshotId: initial.snapshotId,
    variables: { place },
    source: { kind: "floor", runId: `run-${floorId}`, jobId: null },
  };
}

const policy = {
  overscanFloors: 1,
  historyCache: { maxEntries: 10, maxBytes: 4096 },
  settledStreamCache: { maxEntries: 5, maxBytes: 2048 },
  diagnosticsCache: { maxEntries: 5, maxBytes: 2048 },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function settle() {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
    await nextTick();
  }
}

function mountChat(
  transport: Record<string, any>,
  snapshotId: string | null = null,
) {
  const events = {
    history: [] as unknown[],
    state: [] as Array<{ busy: boolean; following: boolean; view: any }>,
    loading: [] as boolean[],
    failures: [] as unknown[],
    current: [] as unknown[],
    ready: [] as string[],
    failure: [] as unknown[],
  };
  const historySelection = ref("latest");
  const historyRefreshVersion = ref(0);
  const historyMoreVersion = ref(0);
  const historyRetryCursor = ref<string | null>(null);
  const historySelectionRetryVersion = ref(0);
  const historyRetrySnapshotId = ref("");
  let runtimeHost: any;
  const runtime = {
    mount: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn(),
  };
  mocks.createRoleTransport.mockReturnValue(transport);
  mocks.createScriptRuntime.mockImplementation((options: { host: unknown }) => {
    runtimeHost = options.host;
    return runtime;
  });
  const wrapper = defineComponent({
    setup() {
      return () =>
        h(ChatSession, {
          client: {} as never,
          sessionId: initial.sessionId,
          snapshotId,
          policy,
          historySelection: historySelection.value,
          historyRefreshVersion: historyRefreshVersion.value,
          historyMoreVersion: historyMoreVersion.value,
          historyRetryCursor: historyRetryCursor.value,
          historySelectionRetryVersion: historySelectionRetryVersion.value,
          historyRetrySnapshotId: historyRetrySnapshotId.value,
          onReady: (name) => events.ready.push(name),
          onFailure: (error) => events.failure.push(error),
          onCurrent: (snapshot) => events.current.push(snapshot),
          onHistory: (items) => events.history.push(items),
          onHistoryState: (state) => events.state.push(state),
          onHistoryLoading: (loading) => events.loading.push(loading),
          onHistoryFailure: (error) => events.failures.push(error),
        });
    },
  });
  const root = createNode("root");
  const app = renderer.createApp(wrapper);
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount(root);
  return {
    app,
    events,
    historySelection,
    historyRefreshVersion,
    historyMoreVersion,
    historyRetryCursor,
    historySelectionRetryVersion,
    historyRetrySnapshotId,
    get host() {
      return runtimeHost;
    },
    runtime,
  };
}

function makeTransport(
  options: {
    listSnapshots?: (query: {
      branchId: string;
      cursor?: string;
      limit: number;
    }) => unknown;
    getSnapshot?: (snapshotId: string) => unknown;
    send?: (request: {
      current: typeof initial;
      emit: (event: any) => void;
    }) => unknown;
  } = {},
) {
  const session: RoleRuntimeSession = {
    characterId: "character-history",
    sessionId: initial.sessionId,
    branchId: initial.branchId,
    versionId: initial.versionId,
    name: "历史角色",
    initial: initial as never,
    current: initial as never,
    messages: [],
    delivery: {
      html: "",
      css: "",
      scriptUrl: "/script.js",
      floorHtml: null,
      assets: {},
      data: {},
    },
    processing: { pendingMain: null, pendingFollowups: false },
    capabilities: { send: true, history: true, customFloors: false },
  };
  return {
    loadSession: vi.fn().mockResolvedValue(session),
    subscribeState: vi.fn(() => () => {}),
    recalculateLatest: vi.fn(),
    restoreMissing: vi.fn(),
    getSnapshot: vi.fn(
      (snapshotId: string) =>
        options.getSnapshot?.(snapshotId) ?? Promise.resolve(initial),
    ),
    listSnapshots: vi.fn(
      (query: { branchId: string; cursor?: string; limit: number }) =>
        options.listSnapshots?.(query) ??
        Promise.resolve({ items: [], nextCursor: null }),
    ),
    getFloor: vi.fn(),
    getMessages: vi.fn().mockResolvedValue([]),
    send: vi.fn(
      (request: { current: typeof initial; emit: (event: any) => void }) =>
        options.send?.(request) ?? Promise.resolve(),
    ),
    dispose: vi.fn(),
  };
}

describe("user chat history selector", () => {
  afterEach(() => vi.clearAllMocks());

  it("loads only the first snapshot page until the user asks for an older page", async () => {
    const old = floorSnapshot("snapshot-old", "floor-old", "旧地点");
    const transport = makeTransport({
      listSnapshots: vi.fn(async ({ cursor }) =>
        cursor
          ? {
              items: [
                {
                  floorId: "floor-old",
                  attemptId: "attempt-old",
                  snapshotId: "snapshot-old",
                },
              ],
              nextCursor: null,
            }
          : {
              items: [
                {
                  floorId: "floor-new",
                  attemptId: "attempt-new",
                  snapshotId: "snapshot-new",
                },
              ],
              nextCursor: "next-page",
            },
      ),
      getSnapshot: vi.fn(async (snapshotId) =>
        snapshotId === old.snapshotId ? old : initial,
      ),
    });
    const view = mountChat(transport);
    try {
      await settle();
      expect(transport.listSnapshots).toHaveBeenCalledTimes(1);
      expect(transport.listSnapshots).toHaveBeenNthCalledWith(1, {
        branchId: initial.branchId,
        limit: interaction.historyPageSize,
      });
      expect(view.events.history.at(-1)).toEqual({
        items: [
          {
            floorId: "floor-new",
            attemptId: "attempt-new",
            snapshotId: "snapshot-new",
          },
        ],
        append: false,
        hasMore: true,
      });

      view.historyMoreVersion.value += 1;
      await settle();
      expect(transport.listSnapshots).toHaveBeenCalledTimes(2);
      expect(transport.listSnapshots).toHaveBeenNthCalledWith(2, {
        branchId: initial.branchId,
        cursor: "next-page",
        limit: interaction.historyPageSize,
      });
      expect(view.events.history.at(-1)).toEqual({
        items: [
          {
            floorId: "floor-old",
            attemptId: "attempt-old",
            snapshotId: "snapshot-old",
          },
        ],
        append: true,
        hasMore: false,
      });

      view.historySelection.value = old.snapshotId;
      await settle();
      expect(view.host.get("view")).toEqual(old);
      expect(view.events.state.at(-1)).toMatchObject({
        busy: false,
        following: false,
        view: { snapshotId: old.snapshotId },
      });

      view.historySelection.value = "latest";
      await settle();
      expect(view.host.get("view")).toEqual(initial);
      expect(view.events.state.at(-1)).toMatchObject({
        following: true,
        view: { snapshotId: initial.snapshotId },
      });
    } finally {
      view.app.unmount();
    }
  });

  it("publishes an empty snapshot page and reports list failures without failing chat loading", async () => {
    const empty = mountChat(makeTransport());
    try {
      await settle();
      expect(empty.events.history.at(-1)).toEqual({
        items: [],
        append: false,
        hasMore: false,
      });
      expect(empty.events.ready).toEqual(["历史角色"]);
      expect(empty.events.loading.at(-1)).toBe(false);
    } finally {
      empty.app.unmount();
    }

    const offline = new Error("snapshot history offline");
    const failed = mountChat(
      makeTransport({ listSnapshots: vi.fn().mockRejectedValue(offline) }),
    );
    try {
      await settle();
      expect(failed.events.failures).toEqual([
        { error: offline, action: { kind: "list", cursor: null } },
      ]);
      expect(failed.events.ready).toEqual(["历史角色"]);
      expect(failed.events.failure).toEqual([]);
      expect(failed.events.loading.at(-1)).toBe(false);
    } finally {
      failed.app.unmount();
    }
  });

  it("retries the failed older snapshot page with the same cursor", async () => {
    const olderPointer = {
      floorId: "floor-older",
      attemptId: "attempt-older",
      snapshotId: "snapshot-older",
    };
    const failure = new Error("older snapshot page offline");
    const listSnapshots = vi
      .fn()
      .mockResolvedValueOnce({
        items: [
          {
            floorId: "floor-newer",
            attemptId: "attempt-newer",
            snapshotId: "snapshot-newer",
          },
        ],
        nextCursor: "older-cursor",
      })
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce({ items: [olderPointer], nextCursor: null });
    const view = mountChat(makeTransport({ listSnapshots }));
    try {
      await settle();
      view.historyMoreVersion.value += 1;
      await settle();

      expect(view.events.failures.at(-1)).toEqual({
        error: failure,
        action: { kind: "list", cursor: "older-cursor" },
      });
      expect(view.events.history).toEqual([
        {
          items: [
            {
              floorId: "floor-newer",
              attemptId: "attempt-newer",
              snapshotId: "snapshot-newer",
            },
          ],
          append: false,
          hasMore: true,
        },
      ]);

      view.historyRetryCursor.value = "older-cursor";
      view.historyRefreshVersion.value += 1;
      await settle();

      expect(listSnapshots).toHaveBeenNthCalledWith(2, {
        branchId: initial.branchId,
        cursor: "older-cursor",
        limit: interaction.historyPageSize,
      });
      expect(listSnapshots).toHaveBeenNthCalledWith(3, {
        branchId: initial.branchId,
        cursor: "older-cursor",
        limit: interaction.historyPageSize,
      });
      expect(view.events.history.at(-1)).toEqual({
        items: [olderPointer],
        append: true,
        hasMore: false,
      });
      expect(view.events.failures).toHaveLength(1);
      expect(view.events.loading.at(-1)).toBe(false);
    } finally {
      view.app.unmount();
    }
  });

  it("reports a failed snapshot selection and retries that exact snapshot", async () => {
    const selected = floorSnapshot("snapshot-retry", "floor-retry", "重试地点");
    const failure = Object.assign(new Error("snapshot offline"), {
      code: "NETWORK_ERROR",
    });
    const getSnapshot = vi
      .fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(selected);
    const pointer = {
      floorId: selected.floorId,
      attemptId: selected.attemptId,
      snapshotId: selected.snapshotId,
    };
    const view = mountChat(
      makeTransport({
        getSnapshot,
        listSnapshots: vi.fn().mockResolvedValue({
          items: [pointer],
          nextCursor: null,
        }),
      }),
    );
    try {
      await settle();
      view.historySelection.value = selected.snapshotId;
      await settle();
      expect(view.events.failures.at(-1)).toEqual({
        error: failure,
        action: { kind: "snapshot", snapshotId: selected.snapshotId },
      });
      expect(view.host.get("view")).toEqual(initial);
      expect(view.events.history.at(-1)).toEqual({
        items: [pointer],
        append: false,
        hasMore: false,
      });

      view.historyRetrySnapshotId.value = selected.snapshotId;
      view.historySelectionRetryVersion.value += 1;
      await settle();
      expect(getSnapshot).toHaveBeenCalledTimes(2);
      expect(view.host.get("view")).toEqual(selected);
      expect(view.events.state.at(-1)).toMatchObject({
        following: false,
        view: { snapshotId: selected.snapshotId },
      });
      expect(view.events.failures).toHaveLength(1);
      expect(view.events.history).toHaveLength(1);
    } finally {
      view.app.unmount();
    }
  });

  it("opens a route snapshot directly by snapshot ID", async () => {
    const selected = floorSnapshot(
      "snapshot-route",
      "floor-route",
      "路由快照地点",
    );
    const getSnapshot = vi.fn().mockResolvedValue(selected);
    const transport = makeTransport({ getSnapshot });
    const view = mountChat(transport, selected.snapshotId);
    try {
      await settle();
      expect(getSnapshot).toHaveBeenCalledWith(selected.snapshotId);
      expect(view.host.get("view")).toEqual(selected);
      expect(view.events.failure).toEqual([]);
    } finally {
      view.app.unmount();
    }
  });

  it("does not emit a disposed session's late send recovery failure to its parent", async () => {
    const sending = deferred<void>();
    const transport = makeTransport({ send: () => sending.promise });
    const view = mountChat(transport);
    try {
      await settle();
      transport.loadSession.mockRejectedValueOnce(
        Object.assign(new Error("recovery failed"), { code: "NETWORK_ERROR" }),
      );
      const request = view.host
        .send({ text: "继续" })
        .catch((error: unknown) => error);
      await settle();
      view.app.unmount();
      const statesBefore = view.events.state.length;
      const currentBefore = view.events.current.length;
      sending.reject(
        Object.assign(new Error("aborted"), { code: "NETWORK_ERROR" }),
      );
      await request;
      await settle();
      expect(transport.loadSession).toHaveBeenCalledTimes(2);
      expect(transport.dispose).toHaveBeenCalled();
      expect(view.events.failure).toEqual([]);
      expect(view.events.state).toHaveLength(statesBefore);
      expect(view.events.current).toHaveLength(currentBefore);
    } finally {
      view.app.unmount();
    }
  });

  it("ignores an expired snapshot response when a new turn starts during the read", async () => {
    const oldRead = deferred<any>();
    const sending = deferred<void>();
    const committed = floorSnapshot(
      "snapshot-generated",
      "floor-generated",
      "新地点",
    );
    let sendRequest:
      | { current: typeof initial; emit: (event: any) => void }
      | undefined;
    const transport = makeTransport({
      getSnapshot: vi.fn(() => oldRead.promise),
      send: vi.fn((request) => {
        sendRequest = request;
        return sending.promise;
      }),
    });
    const view = mountChat(transport);
    try {
      await settle();
      view.historySelection.value = "snapshot-old";
      await nextTick();
      expect(transport.getSnapshot).toHaveBeenCalledWith("snapshot-old");

      const generation = view.host.send({ text: "继续" });
      await settle();
      expect(view.events.state.at(-1)?.busy).toBe(true);
      expect(view.host.get("view")).toEqual(initial);
      expect(view.events.state.at(-1)).toMatchObject({
        busy: true,
        following: true,
        view: { snapshotId: initial.snapshotId },
      });
      view.historyRetrySnapshotId.value = "snapshot-old";
      view.historySelectionRetryVersion.value += 1;
      await settle();
      expect(transport.getSnapshot).toHaveBeenCalledTimes(1);
      expect(view.host.get("view")).toEqual(initial);

      sendRequest!.emit({
        type: "commit",
        data: {
          eventId: "commit-generated",
          sessionId: initial.sessionId,
          branchId: initial.branchId,
          kind: "generated",
          previousCurrentSnapshotId: sendRequest!.current.snapshotId,
          before: sendRequest!.current,
          after: committed,
        },
      });
      sendRequest!.emit({
        type: "completed",
        data: { snapshotId: committed.snapshotId },
      });
      sending.resolve();
      await generation;
      expect(view.host.get("current")).toEqual(committed);
      expect(view.host.get("view")).toEqual(committed);
      expect(view.events.state.at(-1)).toMatchObject({
        busy: false,
        following: true,
        view: { snapshotId: committed.snapshotId },
      });

      oldRead.reject(new Error("expired history response"));
      await settle();
      expect(view.host.get("view")).toEqual(committed);
      expect(view.events.failures).toEqual([]);
    } finally {
      view.app.unmount();
    }
  });

  it("keeps the newest snapshot page when an older refresh finishes last", async () => {
    const delayedOlder = deferred<any>();
    const delayedNewer = deferred<any>();
    const listSnapshots = vi
      .fn()
      .mockResolvedValueOnce({ items: [], nextCursor: null })
      .mockImplementationOnce(() => delayedOlder.promise)
      .mockImplementationOnce(() => delayedNewer.promise);
    const view = mountChat(makeTransport({ listSnapshots }));
    try {
      await settle();
      view.historyRefreshVersion.value = 1;
      await nextTick();
      view.historyRefreshVersion.value = 2;
      await nextTick();
      expect(listSnapshots).toHaveBeenCalledTimes(3);

      delayedNewer.resolve({
        items: [
          {
            floorId: "floor-new",
            attemptId: "attempt-new",
            snapshotId: "snapshot-new",
          },
        ],
        nextCursor: null,
      });
      await settle();
      expect(view.events.history.at(-1)).toEqual({
        items: [
          {
            floorId: "floor-new",
            attemptId: "attempt-new",
            snapshotId: "snapshot-new",
          },
        ],
        append: false,
        hasMore: false,
      });

      delayedOlder.resolve({
        items: [
          {
            floorId: "floor-old",
            attemptId: "attempt-old",
            snapshotId: "snapshot-old",
          },
        ],
        nextCursor: null,
      });
      await settle();
      expect(view.events.history.at(-1)).toEqual({
        items: [
          {
            floorId: "floor-new",
            attemptId: "attempt-new",
            snapshotId: "snapshot-new",
          },
        ],
        append: false,
        hasMore: false,
      });
    } finally {
      view.app.unmount();
    }
  });
});
