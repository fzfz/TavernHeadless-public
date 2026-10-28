import { afterEach, expect, it, vi } from "vitest";
import type { FloorRecord, TimelineFloor } from "@tavern/sdk";
import { apiErrorMessages } from "@tavern/shared";
import GenerationDetailView from "./GenerationDetailView.vue";
import { mountComponent, settleComponent } from "../test/component-host.js";

const bridge = vi.hoisted(() => ({ api: {} as Record<string, unknown> }));
const page = vi.hoisted(() => ({ mounted: 0 }));
vi.mock("../lib/api.js", () => ({
  get apiClient() {
    return bridge.api;
  },
}));
vi.mock("../composables/useRoleLabels.js", () => ({
  useRoleLabels: () => ({
    labels: {
      opening: "Opening",
      pageSize: 2,
      loading: "Loading",
      floorStates: {
        committed: "Committed",
        failed: "Failed",
        generating: "Generating",
        draft: "Draft",
      },
      roundPrefix: "Turn",
      round: "round",
    },
  }),
}));
vi.mock("../components/workspace/RoleGenerationDetail.vue", async () => {
  const { h, onMounted } = await import("vue");
  return {
    default: {
      props: [
        "floor",
        "floors",
        "sessionTitle",
        "presentation",
        "branchId",
        "floorRecord",
        "pending",
        "initialCall",
        "initialRunId",
        "initialPageId",
      ],
      setup(
        props: {
          floor: TimelineFloor;
          floors: TimelineFloor[];
          sessionTitle: string;
          presentation: string;
          branchId: string;
          floorRecord: FloorRecord;
          pending?: boolean;
          initialCall?: unknown;
          initialRunId?: string;
          initialPageId?: string;
        },
        { emit }: { emit: (name: string, ...args: unknown[]) => void },
      ) {
        onMounted(() => {
          page.mounted += 1;
        });
        return () =>
          h(
            "role-generation-detail",
            {
              selectedFloorId: props.floor.id,
              floorIds: props.floors.map((floor) => floor.id).join(","),
              floor: props.floor,
              floorRecord: props.floorRecord,
              state: props.floor.state,
              sessionTitle: props.sessionTitle,
              presentation: props.presentation,
              branchId: props.branchId,
              pending: props.pending,
              initialCall: props.initialCall,
              initialRunId: props.initialRunId,
              initialPageId: props.initialPageId,
            },
            [
              h(
                "button",
                { onClick: () => emit("select", props.floors[0]) },
                "select-first",
              ),
              h(
                "button",
                { onClick: () => emit("select", props.floors.at(-1)) },
                "select-last",
              ),
              h(
                "button",
                {
                  onClick: () =>
                    emit(
                      "select",
                      props.floors.find(
                        (floor) =>
                          "branchId" in floor &&
                          floor.branchId !== props.branchId,
                      ),
                    ),
                },
                "select-other-branch",
              ),
              h("button", { onClick: () => emit("refresh") }, "refresh"),
            ],
          );
      },
    },
  };
});

const sessionId = "session-1";
const branchId = "main";
const floor = (
  id: string,
  floorNo: number,
  state: FloorRecord["state"] = "committed",
  branch = branchId,
): FloorRecord => ({
  id,
  floorNo,
  state,
  sessionId,
  branchId: branch,
  createdAt: floorNo,
  updatedAt: floorNo,
  parentFloorId: null,
  supersededAt: null,
  supersededByFloorId: null,
  tokenIn: floorNo + 10,
  tokenOut: floorNo + 20,
});

const defaultFloors = [
  floor("opening", 0),
  floor("floor-1", 1, "failed", "branch-a"),
  floor("floor-2", 2, "generating", "main"),
  floor("floor-3", 3, "committed", "branch-b"),
  floor("floor-4", 4, "draft", "main"),
];

function pageRecord(
  id: string,
  floorId: string,
  pageNo: number,
  active: boolean,
) {
  return {
    id,
    floorId,
    pageNo,
    isActive: active,
    pageKind: pageNo === 1 ? "input" : "output",
    version: pageNo + 1,
    checksum: `${id}-checksum`,
    createdAt: pageNo,
    updatedAt: pageNo + 10,
  };
}

function messageRecord(
  id: string,
  pageId: string,
  role: string,
  content: string,
  isHidden = false,
) {
  return {
    id,
    pageId,
    role,
    seq: 1,
    content,
    contentFormat: "text",
    createdAt: 1,
    isHidden,
    source: "saved-source",
    tokenCount: content.length,
  };
}

function setup(
  options: {
    floors?: FloorRecord[];
    initialFloorId?: string;
    initialPageId?: string;
    failFloors?: boolean;
    failPages?: boolean;
    selectedCall?: {
      call: {
        callId: string;
        runId: string;
        sessionId: string;
        branchId: string;
        floorId: string;
      };
    };
  } = {},
) {
  let floorRows = options.floors ?? defaultFloors;
  let pageRows: Record<string, ReturnType<typeof pageRecord>[]> = {
    "floor-2": [
      pageRecord("input-page", "floor-2", 1, true),
      pageRecord("inactive-input-page", "floor-2", 2, false),
      pageRecord("inactive-page", "floor-2", 3, false),
    ],
  };
  let messageRows: Record<string, ReturnType<typeof messageRecord>[]> = {
    "input-page": [
      messageRecord("user-message", "input-page", "user", "original request"),
      messageRecord(
        "hidden-message",
        "input-page",
        "system",
        "hidden saved message",
        true,
      ),
    ],
    "inactive-input-page": [
      messageRecord(
        "old-user-message",
        "inactive-input-page",
        "user",
        "stale prior input",
      ),
    ],
    "inactive-page": [
      messageRecord(
        "inactive-reply",
        "inactive-page",
        "assistant",
        "inactive output",
      ),
    ],
  };
  let failFloorList = options.failFloors ?? false;
  let failPageList = options.failPages ?? false;
  const floorList = vi.fn(
    async ({ offset, limit }: { offset: number; limit: number }) => {
      if (failFloorList)
        throw Object.assign(new Error("floor listing failed"), {
          code: "FLOORS_FAILED",
        });
      return floorRows.slice(offset, offset + limit);
    },
  );
  const floorDetail = vi.fn(async ({ floorId }: { floorId: string }) => {
    const item =
      floorRows.find((record) => record.id === floorId) ??
      defaultFloors.find((record) => record.id === floorId);
    if (!item)
      throw Object.assign(new Error("floor not found"), {
        code: "FLOOR_NOT_FOUND",
      });
    return item;
  });
  const pageList = vi.fn(
    async ({
      floorId,
      offset,
      limit,
    }: {
      floorId: string;
      offset: number;
      limit: number;
    }) => {
      if (failPageList)
        throw Object.assign(new Error("page listing failed"), {
          code: "PAGES_FAILED",
        });
      return (pageRows[floorId] ?? []).slice(offset, offset + limit);
    },
  );
  const messageList = vi.fn(
    async ({
      pageId,
      offset,
      limit,
    }: {
      pageId: string;
      offset: number;
      limit: number;
    }) => (messageRows[pageId] ?? []).slice(offset, offset + limit),
  );
  const modelCallGet = vi.fn(async () => options.selectedCall);
  bridge.api = {
    floors: { list: floorList, getDetail: floorDetail },
    pages: { list: pageList, getDetail: async ({ pageId }: { pageId: string }) => Object.values(pageRows).flat().find(page => page.id === pageId) },
    messages: { list: messageList },
    sessions: {
      getDetail: async () => ({ id: sessionId, title: "Session Title" }),
    },
    modelCalls: { get: modelCallGet },
    pages_detail_unused: {},
  };
  const initialFloorId = options.initialFloorId ?? "floor-2";
  const location = {
    search: new URLSearchParams({
      sessionId,
      branchId,
      floorId: initialFloorId,
    }).toString(),
    href: `http://local.test/generation-detail?${new URLSearchParams({ sessionId, branchId, floorId: initialFloorId })}`,
  };
  if (options.selectedCall) {
    const url = new URL(location.href);
    url.searchParams.set("callId", options.selectedCall.call.callId);
    url.searchParams.set("runId", options.selectedCall.call.runId);
    location.href = url.href;
    location.search = url.search;
  }
  if (options.initialPageId) {
    const url = new URL(location.href);
    url.searchParams.set("pageId", options.initialPageId);
    location.href = url.href;
    location.search = url.search;
  }
  const replacedUrls: string[] = [];
  vi.stubGlobal("window", {
    location,
    history: {
      replaceState(_state: unknown, _title: string, target: URL) {
        location.href = target.toString();
        location.search = target.search;
        replacedUrls.push(target.toString());
      },
    },
  });
  page.mounted = 0;
  const host = mountComponent(GenerationDetailView, {});
  return {
    host,
    floorList,
    floorDetail,
    pageList,
    messageList,
    replacedUrls,
    modelCallGet,
    setFloorRows(value: FloorRecord[]) {
      floorRows = value;
    },
    setPageRows(value: typeof pageRows) {
      pageRows = value;
    },
    setMessageRows(value: typeof messageRows) {
      messageRows = value;
    },
    failFloorList(value: boolean) {
      failFloorList = value;
    },
    failPageList(value: boolean) {
      failPageList = value;
    },
  };
}

function renderedDetail(host: ReturnType<typeof mountComponent>) {
  return host.all((node) => node.tagName === "ROLE-GENERATION-DETAIL")[0];
}

type SnapshotFloor = {
  pages: Array<{
    id: string;
    checksum: string | null;
    messages: Array<{
      id: string;
      isHidden: boolean;
      source: string | null;
      tokenCount: number;
    }>;
  }>;
  messages: Array<{ content: string; id: string; role: string }>;
  state: string;
};

async function waitForDetail(
  host: ReturnType<typeof mountComponent>,
  id = "floor-2",
) {
  await vi.waitFor(async () => {
    await settleComponent();
    expect(renderedDetail(host)?.props.selectedFloorId).toBe(id);
  });
}

function button(host: ReturnType<typeof mountComponent>, text: string) {
  return host.all(
    (node) => node.tagName === "BUTTON" && node.textContent === text,
  )[0]!;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it("loads every floor with the floors API and keeps complete inactive/hidden page records", async () => {
  const { host, floorList, pageList, messageList } = setup();
  try {
    await waitForDetail(host);
    const header = host.all((node) => node.tagName === "HEADER")[0]!;
    expect(
      header.children.find((node) => node.tagName === "H1")?.textContent,
    ).toBe("TavernHeadless · 生成详情");
    const links = host.all((node) => node.tagName === "A");
    expect(links).toHaveLength(1);
    expect(links[0]?.textContent).toBe("返回管理端");
    const detail = renderedDetail(host)!;
    const loadedFloor = detail.props.floor as SnapshotFloor;
    expect(detail.props.presentation).toBe("accordion");
    expect(detail.props.sessionTitle).toBe("Session Title");
    expect(detail.props.floorRecord).toMatchObject({
      id: "floor-2",
      floorNo: 2,
      state: "generating",
      branchId: "main",
    });
    expect(Object.hasOwn(detail.props.floorRecord as object, "pages")).toBe(
      false,
    );
    expect(detail.props.floorIds).toBe(
      "floor-4,floor-3,floor-2,floor-1,opening",
    );
    expect(floorList.mock.calls.map(([query]) => query)).toEqual([
      { sessionId, limit: 2, offset: 0, sortBy: "floor_no", sortOrder: "desc" },
      { sessionId, limit: 2, offset: 2, sortBy: "floor_no", sortOrder: "desc" },
      { sessionId, limit: 2, offset: 4, sortBy: "floor_no", sortOrder: "desc" },
    ]);
    expect(loadedFloor.pages.map((item) => item.id)).toEqual([
      "input-page",
      "inactive-input-page",
      "inactive-page",
    ]);
    expect(loadedFloor.pages[1]?.checksum).toBe("inactive-input-page-checksum");
    expect(loadedFloor.pages[2]?.checksum).toBe("inactive-page-checksum");
    expect(loadedFloor.pages[2]?.messages[0]).toMatchObject({
      id: "inactive-reply",
      isHidden: false,
      source: "saved-source",
      tokenCount: "inactive output".length,
    });
    expect(loadedFloor.pages[0]?.messages[1]).toMatchObject({
      id: "hidden-message",
      isHidden: true,
      source: "saved-source",
    });
    expect(loadedFloor.messages.map((item) => item.id)).toEqual([
      "user-message",
    ]);
    expect(
      loadedFloor.messages.find((item) => item.role === "user")?.content,
    ).toBe("original request");
    expect(pageList.mock.calls.map(([query]) => query.floorId)).toEqual([
      "floor-2",
      "floor-2",
    ]);
    expect(messageList.mock.calls.map(([query]) => query.pageId)).toEqual(
      expect.arrayContaining([
        "input-page",
        "input-page",
        "inactive-input-page",
        "inactive-page",
      ]),
    );
    expect(
      messageList.mock.calls.every(([query]) => !("isHidden" in query)),
    ).toBe(true);
    expect(
      (bridge.api.sessions as { timeline?: unknown }).timeline,
    ).toBeUndefined();
  } finally {
    host.unmount();
  }
});

it("updates branch and URL when a selected floor belongs to another branch", async () => {
  const { host, floorDetail, replacedUrls } = setup();
  try {
    await waitForDetail(host);
    button(host, "select-other-branch").click();
    await waitForDetail(host, "floor-3");
    expect(floorDetail).toHaveBeenCalledWith({ floorId: "floor-3" });
    expect(renderedDetail(host)?.props.branchId).toBe("branch-b");
    expect(replacedUrls.at(-1)).toContain("branchId=branch-b");
    expect(replacedUrls.at(-1)).toContain("floorId=floor-3");
    expect(replacedUrls.at(-1)).not.toContain("runId");
    expect(replacedUrls.at(-1)).not.toContain("callId");
  } finally {
    host.unmount();
  }
});

it("ignores an older floor selection response after a newer selection completes", async () => {
  const { host, floorDetail, floorList, replacedUrls } = setup();
  let resolveFloor1!: (value: FloorRecord) => void;
  floorDetail.mockImplementation(({ floorId }) => {
    if (floorId === "floor-4")
      return new Promise<FloorRecord>((resolve) => {
        resolveFloor1 = resolve;
      });
    return Promise.resolve(defaultFloors.find((item) => item.id === floorId)!);
  });
  try {
    await waitForDetail(host);
    button(host, "select-first").click();
    await settleComponent();
    expect(renderedDetail(host)?.props.pending).toBe(true);
    expect(
      host
        .all((node) => node.props.role === "status")
        .map((node) => node.textContent),
    ).toContain("Loading");
    const floorListCallsWhileSelectionPending = floorList.mock.calls.length;
    button(host, "refresh").click();
    expect(floorList).toHaveBeenCalledTimes(
      floorListCallsWhileSelectionPending,
    );
    button(host, "select-last").click();
    await waitForDetail(host, "opening");
    resolveFloor1(floor("floor-4", 4));
    await settleComponent();
    expect(renderedDetail(host)?.props.selectedFloorId).toBe("opening");
    expect(replacedUrls.at(-1)).toContain("floorId=opening");
  } finally {
    host.unmount();
  }
});

it("refreshes floors and the selected floor snapshot, then remounts detail evidence for refreshed run/result/calls/inspection", async () => {
  const {
    host,
    floorList,
    floorDetail,
    pageList,
    messageList,
    setFloorRows,
    setPageRows,
    setMessageRows,
  } = setup();
  try {
    await waitForDetail(host);
    const refreshedRecord = floor(
      "floor-2",
      2,
      "committed",
      "branch-refreshed",
    );
    setFloorRows([
      ...defaultFloors.filter((item) => item.id !== "floor-2"),
      refreshedRecord,
      floor("floor-5", 5, "generating", "branch-new"),
    ]);
    setPageRows({
      "floor-2": [
        pageRecord("input-page-new", "floor-2", 1, true),
        pageRecord("output-page-new", "floor-2", 2, true),
        pageRecord("late-page", "floor-2", 3, false),
      ],
    });
    setMessageRows({
      "input-page-new": [
        messageRecord("new-input", "input-page-new", "user", "refreshed input"),
      ],
      "output-page-new": [
        messageRecord(
          "new-output",
          "output-page-new",
          "assistant",
          "new committed output",
        ),
      ],
      "late-page": [
        messageRecord(
          "late-hidden",
          "late-page",
          "assistant",
          "late message",
          true,
        ),
      ],
    });
    const mountsBeforeRefresh = page.mounted;
    button(host, "refresh").click();
    await waitForDetail(host);
    expect(page.mounted).toBe(mountsBeforeRefresh + 1);
    expect(floorList).toHaveBeenCalledTimes(7);
    expect(floorDetail).toHaveBeenCalledWith({ floorId: "floor-2" });
    const refreshedFloor = renderedDetail(host)?.props.floor as SnapshotFloor;
    expect(refreshedFloor.state).toBe("committed");
    expect(renderedDetail(host)?.props.branchId).toBe("branch-refreshed");
    expect(String(renderedDetail(host)?.props.floorIds)).toContain("floor-5");
    expect(refreshedFloor.pages.map((item) => item.id)).toEqual([
      "input-page-new",
      "output-page-new",
      "late-page",
    ]);
    expect(refreshedFloor.pages[2]?.messages[0]).toMatchObject({
      id: "late-hidden",
      isHidden: true,
    });
    expect(pageList).toHaveBeenCalledTimes(4);
    expect(messageList).toHaveBeenCalledTimes(7);
    expect(
      (window as unknown as { location: { search: string } }).location.search,
    ).toContain("branchId=branch-refreshed");
  } finally {
    host.unmount();
  }
});

it("passes and retains the selected page, run and call when refreshing the same floor", async () => {
  const selectedCall = {
    call: {
      callId: "selected-call",
      runId: "selected-run",
      sessionId,
      branchId,
      floorId: "floor-2",
    },
  };
  const { host, modelCallGet } = setup({ selectedCall, initialPageId: "inactive-page" });
  try {
    await waitForDetail(host);
    expect(renderedDetail(host)?.props.initialPageId).toBe("inactive-page");
    button(host, "refresh").click();
    await waitForDetail(host);
    expect(renderedDetail(host)?.props.initialPageId).toBe("inactive-page");
    expect(modelCallGet).toHaveBeenCalledTimes(2);
    expect(renderedDetail(host)?.props.initialCall).toEqual(selectedCall);
    expect(renderedDetail(host)?.props.initialRunId).toBe("selected-run");
    const url = new URL(window.location.href);
    expect(url.searchParams.get("callId")).toBe("selected-call");
    expect(url.searchParams.get("runId")).toBe("selected-run");
    expect(url.searchParams.get("pageId")).toBe("inactive-page");
  } finally {
    host.unmount();
  }
});

it("keeps the previously loaded snapshot visible when refreshed page loading fails", async () => {
  const { host, failPageList } = setup();
  try {
    await waitForDetail(host);
    const before = renderedDetail(host)?.props.floor;
    failPageList(true);
    button(host, "refresh").click();
    await vi.waitFor(async () => {
      await settleComponent();
      expect(host.all((node) => node.props.role === "alert")).not.toHaveLength(
        0,
      );
    });
    expect(renderedDetail(host)?.props.floor).toEqual(before);
    expect(host.root.textContent).toContain(
      apiErrorMessages.MODEL_CALL_LOAD_FAILED,
    );
  } finally {
    host.unmount();
  }
});

it("reports a missing current floor on refresh without discarding the visible snapshot", async () => {
  const { host, floorDetail, setFloorRows } = setup();
  try {
    await waitForDetail(host);
    const before = renderedDetail(host)?.props.floor;
    setFloorRows(defaultFloors.filter((item) => item.id !== "floor-2"));
    button(host, "refresh").click();
    await vi.waitFor(async () => {
      await settleComponent();
      expect(host.all((node) => node.props.role === "alert")).not.toHaveLength(
        0,
      );
    });
    expect(host.root.textContent).toContain(
      apiErrorMessages.GENERATION_DETAIL_LOCATION_INVALID,
    );
    expect(renderedDetail(host)?.props.floor).toEqual(before);
    expect(floorDetail).toHaveBeenCalledTimes(1);
  } finally {
    host.unmount();
  }
});

it("shows a floor-list API failure before rendering a partial detail", async () => {
  const { host } = setup({ failFloors: true });
  try {
    await vi.waitFor(() => {
      expect(host.all((node) => node.props.role === "alert")).toHaveLength(1);
    });
    expect(host.root.textContent).toContain(
      apiErrorMessages.MODEL_CALL_LOAD_FAILED,
    );
    expect(renderedDetail(host)).toBeUndefined();
  } finally {
    host.unmount();
  }
});

it("rejects a verified target that is absent from the full floor list", async () => {
  const { host, floorList } = setup({ floors: [] });
  try {
    await vi.waitFor(() => {
      expect(host.all((node) => node.props.role === "alert")).toHaveLength(1);
    });
    expect(floorList).toHaveBeenCalledOnce();
    expect(host.root.textContent).toContain(
      apiErrorMessages.GENERATION_DETAIL_LOCATION_INVALID,
    );
    expect(renderedDetail(host)).toBeUndefined();
  } finally {
    host.unmount();
  }
});

it("stops applying selection results after the page unmounts", async () => {
  const { host, floorDetail } = setup();
  let resolveFloor!: (value: FloorRecord) => void;
  floorDetail.mockImplementation(({ floorId }) => {
    if (floorId === "floor-4")
      return new Promise<FloorRecord>((resolve) => {
        resolveFloor = resolve;
      });
    return Promise.resolve(defaultFloors.find((item) => item.id === floorId)!);
  });
  await waitForDetail(host);
  button(host, "select-first").click();
  await vi.waitFor(() =>
    expect(floorDetail).toHaveBeenCalledWith({ floorId: "floor-4" }),
  );
  host.unmount();
  resolveFloor(floor("floor-4", 4));
  await settleComponent();
  expect(host.root.textContent).toBe("");
});
