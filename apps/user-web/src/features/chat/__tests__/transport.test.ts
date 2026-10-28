import { describe, expect, it, vi } from "vitest";
import type { TavernClient } from "@tavern/sdk";
import type {
  RoleDisplaySnapshot,
  RoleEnvelope,
  RoleRuntimeTransport,
} from "@tavern/shared";
import { createRoleTransport } from "../transport.js";

const initial: RoleDisplaySnapshot = {
  sessionId: "s",
  branchId: "main",
  versionId: "v",
  snapshotId: "initial",
  parentSnapshotId: null,
  floorId: null,
  attemptId: null,
  variables: {},
  source: { kind: "initial", runId: null, jobId: null },
};
const after: RoleDisplaySnapshot = {
  ...initial,
  snapshotId: "after",
  parentSnapshotId: "initial",
  floorId: "f",
  attemptId: "r:1",
  source: { kind: "floor", runId: "r", jobId: null },
};
function setup() {
  const getView = vi.fn().mockResolvedValue({
    character_id: "c",
    character_version_id: "v",
    name: "角色",
    initial,
    current: initial,
    delivery: {},
    processing: { pendingStateFloorId: null, pendingFollowups: false },
    capabilities: { send: true, history: true, customFloors: false },
  });
  const getMessages = vi
    .fn()
    .mockResolvedValue([
      { id: "m", role: "assistant", content: "visible", source: "narrator" },
    ]);
  const updateState = vi.fn().mockResolvedValue(after);
  const getRun = vi
    .fn()
    .mockResolvedValue({ run: { runId: "r", attemptNo: 1 } });
  const respondStream = vi.fn(
    async (
      options: Parameters<TavernClient["sessions"]["respondStream"]>[0],
    ) => {
      options.onEvent?.({
        type: "start",
        payload: { floorId: "f", branchId: "main", floorNo: 1 },
      });
      options.onEvent?.({
        type: "chunk",
        payload: { chunk: "private raw content" },
      });
      options.onEvent?.({
        type: "role_text",
        payload: { text: "visible", phase: "completed" },
      });
      return { floorId: "f" };
    },
  );
  const listSnapshots = vi.fn().mockResolvedValue({
    items: [{ snapshotId: "initial", floorId: null, attemptId: null }],
    nextCursor: "older-state",
  });
  const listFloors = vi.fn().mockResolvedValue({
    items: [{ floorId: "body-without-state", floorNo: 1, state: "committed" }],
    nextCursor: "older-floor",
  });
  const client = {
    roleRuntime: {
      getView,
      getMessages,
      updateState,
      listSnapshots,
      listFloors,
    },
    sessions: {
      respondStream,
      getResponseOperation: vi.fn(),
      getActiveRun: vi.fn().mockResolvedValue({ activeRun: null }),
      stopResponseOperation: vi.fn().mockResolvedValue({ requested: true }),
    },
    floors: { getRun },
  } as unknown as TavernClient;
  return {
    client,
    transport: createRoleTransport(client, "s"),
    getView,
    listSnapshots,
    listFloors,
    getMessages,
    updateState,
    getRun,
    respondStream,
  };
}
const request = (
  emit: (event: RoleEnvelope) => void,
  retry = false,
): Parameters<RoleRuntimeTransport["send"]>[0] => ({
  text: "hello",
  current: initial,
  route: "/send",
  testHeaders: retry ? { "x-state-update-retry": "true" } : {},
  emit,
});

describe("SDK role transport", () => {
  it("sends and retries an operation over HTTP without crypto.randomUUID", async () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.fill(0);
      return bytes;
    });
    vi.stubGlobal("crypto", { getRandomValues });
    try {
      const { client, transport, respondStream } = setup();
      respondStream.mockRejectedValueOnce(
        new TypeError("offline before start"),
      );
      vi.mocked(client.sessions.getResponseOperation).mockRejectedValueOnce(
        Object.assign(new Error("missing"), { status: 404 }),
      );

      await expect(transport.send(request(() => {}))).rejects.toThrow(
        "offline before start",
      );
      expect(await transport.reconcile()).toMatchObject({
        response: "unaccepted",
        input: "hello",
      });
      await transport.send(request(() => {}));

      expect(
        respondStream.mock.calls.map(([options]) => options.clientOperationId),
      ).toEqual([
        "00000000-0000-4000-8000-000000000000",
        "00000000-0000-4000-8000-000000000000",
      ]);
      expect(getRandomValues).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("recovers an accepted operation after its first stream response was lost and the page reloaded", async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    try {
      const { client, respondStream, updateState } = setup();
      respondStream.mockRejectedValueOnce(
        new TypeError("stream response lost"),
      );
      vi.mocked(client.sessions.getResponseOperation).mockResolvedValue({
        operationId: "unused",
        sessionId: "s",
        branchId: "main",
        floorId: "f",
        floorState: "committed",
        runStatus: "completed",
        publicPhase: "completed",
        intent: "send",
      });
      const first = createRoleTransport(client, "s", {
        operationStorageKey: "actor:s:main",
      });
      await expect(first.send(request(() => {}))).rejects.toThrow(
        "stream response lost",
      );
      const operationId =
        vi.mocked(respondStream).mock.calls[0]![0].clientOperationId;
      const second = createRoleTransport(client, "s", {
        operationStorageKey: "actor:s:main",
      });
      expect(await second.reconcile()).toMatchObject({
        busy: false,
        response: "saved",
        input: "hello",
      });
      expect(client.sessions.getResponseOperation).toHaveBeenCalledWith({
        sessionId: "s",
        operationId,
      });
      expect(updateState).toHaveBeenCalledOnce();
      expect(respondStream).toHaveBeenCalledOnce();
      expect(storage.size).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reuses the same operation when the server confirms that the request was never accepted", async () => {
    const { client, respondStream } = setup();
    respondStream.mockRejectedValueOnce(new TypeError("offline before start"));
    vi.mocked(client.sessions.getResponseOperation).mockRejectedValueOnce(
      Object.assign(new Error("missing"), { status: 404 }),
    );
    const transport = createRoleTransport(client, "s");
    await expect(transport.send(request(() => {}))).rejects.toThrow(
      "offline before start",
    );
    expect(await transport.reconcile()).toMatchObject({
      busy: false,
      response: "unaccepted",
      input: "hello",
    });
    await transport.send(request(() => {}));
    expect(respondStream.mock.calls[1]![0].clientOperationId).toBe(
      respondStream.mock.calls[0]![0].clientOperationId,
    );
  });

  it("publishes projected text and commits state only after the updater succeeds", async () => {
    const { transport, updateState } = setup();
    const events: RoleEnvelope[] = [];
    await transport.send(request((event) => events.push(event)));
    expect(events.map((event) => event.type)).toEqual([
      "text",
      "text",
      "text",
      "commit",
      "completed",
    ]);
    expect(
      events
        .filter((event) => event.type === "text")
        .map((event) => event.data.text),
    ).toEqual(["", "visible", "visible"]);
    expect(updateState).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "s",
        floorId: "f",
        signal: expect.any(AbortSignal),
      }),
    );
  });
  it("retries a failed state update without generating another body", async () => {
    const { transport, updateState, respondStream } = setup();
    updateState.mockRejectedValueOnce(new Error("state failed"));
    const events: RoleEnvelope[] = [];
    await expect(
      transport.send(request((event) => events.push(event))),
    ).rejects.toMatchObject({
      code: "ROLE_STATE_UPDATE_FAILED",
      cause: new Error("state failed"),
    });
    expect(events.some((event) => event.type === "commit")).toBe(false);
    await transport.send(request((event) => events.push(event), true));
    expect(respondStream).toHaveBeenCalledOnce();
    expect(updateState).toHaveBeenCalledTimes(2);
    expect(events.at(-1)?.type).toBe("completed");
  });
  it("rejects a state retry without a pending floor", async () => {
    const { transport, respondStream, updateState } = setup();
    await expect(transport.send(request(vi.fn(), true))).rejects.toMatchObject({
      code: "STATE_RETRY_INVALID",
    });
    expect(respondStream).not.toHaveBeenCalled();
    expect(updateState).not.toHaveBeenCalled();
  });
  it("retains the run lookup error and does not commit state", async () => {
    const { transport, getRun, updateState } = setup();
    const error = new Error("run lookup failed");
    getRun.mockRejectedValue(error);
    await expect(transport.send(request(vi.fn()))).rejects.toBe(error);
    expect(updateState).not.toHaveBeenCalled();
  });
  it("queries each history directly using the server cursor without loading the full view", async () => {
    const { transport, getView, listSnapshots, listFloors } = setup();
    const query = { branchId: "main", cursor: "opaque-cursor", limit: 3 };
    const states = await transport.listSnapshots(query);
    const conversations = await transport.listFloors(query);
    expect(listSnapshots).toHaveBeenCalledWith({ sessionId: "s", ...query });
    expect(listFloors).toHaveBeenCalledWith({ sessionId: "s", ...query });
    expect(states.nextCursor).toBe("older-state");
    expect(conversations.items[0]?.floorId).toBe("body-without-state");
    expect(getView).not.toHaveBeenCalled();
  });
  it("propagates a failed history page and keeps message identity independent of attempts", async () => {
    const { transport, listSnapshots, getMessages } = setup();
    const error = new Error("invalid cursor");
    listSnapshots.mockRejectedValueOnce(error);
    await expect(transport.listSnapshots({ branchId: "main" })).rejects.toBe(
      error,
    );
    const messages = await transport.getMessages({
      branchId: "main",
      floorId: "f",
    });
    expect(getMessages).toHaveBeenCalledWith({
      sessionId: "s",
      branchId: "main",
      floorId: "f",
    });
    expect(messages[0]).not.toHaveProperty("attemptId");
  });
});

it("resolves role files against the API origin and preserves external URLs", async () => {
  const view = {
    character_id: "c",
    character_version_id: "v",
    name: "role",
    initial,
    current: initial,
    delivery: {
      html: "",
      css: "",
      scriptUrl: "/role-assets/v/main.js",
      htmlUrl: "/role-assets/v/frontend/index.html",
      dataUrls: { caseFile: "/role-assets/v/data/case.json" },
      cssUrl: "/role-assets/v/frontend/style.css",
      floorHtmlUrl: "/role-assets/v/frontend/floor.html",
      floorHtml: null,
      data: {},
      assets: {
        own: {
          url: "/role-assets/v/media.png",
          kind: "image",
          label: "",
          tags: [],
        },
        external: {
          url: "https://other.example/avatar.png",
          kind: "image",
          label: "",
          tags: [],
        },
      },
    },
    processing: { pendingStateFloorId: null, pendingFollowups: false },
    capabilities: { send: true, history: true, customFloors: false },
  };
  const client = {
    roleRuntime: { getView: vi.fn().mockResolvedValue(view) },
  } as unknown as TavernClient;
  const current = vi.fn();
  const originalDelivery = structuredClone(view.delivery);
  const session = await createRoleTransport(client, "s", {
    assetBaseUrl: "https://api.example",
    onCurrent: current,
  }).loadSession();
  expect(session.delivery.scriptUrl).toBe(
    "https://api.example/role-assets/v/main.js",
  );
  expect(session.delivery.dataUrls?.caseFile).toBe(
    "https://api.example/role-assets/v/data/case.json",
  );
  expect(session.delivery.htmlUrl).toBe(
    "https://api.example/role-assets/v/frontend/index.html",
  );
  expect(session.delivery.cssUrl).toBe(
    "https://api.example/role-assets/v/frontend/style.css",
  );
  expect(session.delivery.floorHtmlUrl).toBe(
    "https://api.example/role-assets/v/frontend/floor.html",
  );
  expect(session.delivery.assets.own?.url).toBe(
    "https://api.example/role-assets/v/media.png",
  );
  expect(session.delivery.assets.external?.url).toBe(
    "https://other.example/avatar.png",
  );
  expect(current).toHaveBeenCalledWith(initial);
  vi.mocked(client.roleRuntime.getView).mockResolvedValue({
    ...view,
    delivery: originalDelivery,
  } as any);
  vi.stubGlobal("location", { href: "https://web.example/app/#chat/s" });
  try {
    const proxied = await createRoleTransport(client, "s", {
      assetBaseUrl: "/api",
    }).loadSession();
    expect(proxied.delivery.scriptUrl).toBe(
      "https://web.example/api/role-assets/v/main.js",
    );
    expect(proxied.delivery.htmlUrl).toBe(
      "https://web.example/api/role-assets/v/frontend/index.html",
    );
    expect(proxied.delivery.assets.own?.url).toBe(
      "https://web.example/api/role-assets/v/media.png",
    );
    expect(proxied.delivery.assets.external?.url).toBe(
      "https://other.example/avatar.png",
    );
  } finally {
    vi.unstubAllGlobals();
  }
});

it("publishes multiple body chunks while the upstream request remains unfinished", async () => {
  const { transport, respondStream, updateState } = setup();
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  respondStream.mockImplementationOnce(async (options) => {
    options.onEvent?.({
      type: "start",
      payload: { floorId: "f", branchId: "main", floorNo: 1 },
    });
    options.onEvent?.({
      type: "role_text",
      payload: { text: "first", phase: "streaming" },
    });
    options.onEvent?.({
      type: "role_text",
      payload: { text: "first second", phase: "streaming" },
    });
    await pending;
    return { floorId: "f" };
  });
  const events: RoleEnvelope[] = [];
  const result = transport.send(request((event) => events.push(event)));
  await vi.waitFor(() =>
    expect(
      events.filter((e) => e.type === "text").map((e) => e.data.text),
    ).toEqual(["", "first", "first second"]),
  );
  expect(updateState).not.toHaveBeenCalled();
  finish();
  await result;
});

it("reconnects state events and stops both active subscriptions and retry timers on disposal", async () => {
  vi.useFakeTimers();
  try {
    let latest:
      | {
          signal: AbortSignal;
          onCurrent: (value: RoleDisplaySnapshot) => void;
          onRepair: (value: {
            operationId: string;
            after: RoleDisplaySnapshot;
          }) => void;
        }
      | undefined;
    const streamState = vi.fn(async (options) => {
      latest = options;
      if (streamState.mock.calls.length === 1)
        throw new Error("connection closed");
      await new Promise<void>((resolve) =>
        options.signal.addEventListener("abort", () => resolve(), {
          once: true,
        }),
      );
    });
    const transport = createRoleTransport(
      { roleRuntime: { streamState } } as unknown as TavernClient,
      "s",
    );
    const onCurrent = vi.fn(),
      onError = vi.fn();
    transport.subscribeState({ branchId: "main", onCurrent, onError });
    await vi.advanceTimersByTimeAsync(1);
    expect(onError).toHaveBeenCalledOnce();
    await vi.runOnlyPendingTimersAsync();
    expect(streamState).toHaveBeenCalledTimes(2);
    latest!.onCurrent(initial);
    latest!.onRepair({ operationId: "op", after: initial });
    expect(onCurrent).toHaveBeenCalledTimes(2);
    transport.dispose();
    expect(latest!.signal.aborted).toBe(true);
    latest!.onCurrent(initial);
    expect(onCurrent).toHaveBeenCalledTimes(2);
    await vi.runOnlyPendingTimersAsync();
    expect(streamState).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});
