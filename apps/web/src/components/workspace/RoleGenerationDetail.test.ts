import { afterEach, expect, it, vi } from "vitest";
import {
  apiErrorMessages,
  modelCallUi,
  modelCallUiSchema,
  type ModelCallDetail,
} from "@tavern/shared";
import type { FloorRecord, TimelineFloor, TimelinePage } from "@tavern/sdk";
import RoleGenerationDetail from "./RoleGenerationDetail.vue";
import { mountComponent, settleComponent } from "../../test/component-host.js";

const bridge = vi.hoisted(() => ({ api: {} as Record<string, unknown> }));
vi.mock("../../lib/api.js", () => ({
  get apiClient() {
    return bridge.api;
  },
}));

const inputPage: TimelinePage = {
  id: "page-input",
  isActive: true,
  pageKind: "input",
  pageNo: 1,
  version: 1,
  messages: [
    {
      id: "message-user",
      role: "user",
      seq: 1,
      content: "Meet me at the old lighthouse.",
      contentFormat: "text",
    },
  ],
};
const outputPage: TimelinePage = {
  id: "page-output",
  isActive: true,
  pageKind: "output",
  pageNo: 2,
  version: 1,
  messages: [
    {
      id: "message-assistant",
      role: "assistant",
      seq: 1,
      content: "Lin Lan unfolds the letter.",
      contentFormat: "text",
    },
  ],
};

const floor: TimelineFloor = {
  id: "floor-1",
  floorNo: 1,
  state: "committed",
  tokenIn: 120,
  tokenOut: 34,
  createdAt: 100,
  pageCount: 2,
  pages: [inputPage, outputPage],
  activePages: [inputPage, outputPage],
  activePage: null,
  messages: [...inputPage.messages, ...outputPage.messages],
};
const floorRecord: FloorRecord = {
  branchId: "main",
  createdAt: 100,
  floorNo: 1,
  id: floor.id,
  parentFloorId: null,
  sessionId: "session-1",
  state: "committed",
  supersededAt: null,
  supersededByFloorId: null,
  tokenIn: 120,
  tokenOut: 34,
  updatedAt: 130,
};

const modelCall: ModelCallDetail = {
  call: {
    accountId: "default",
    sessionId: "session-1",
    branchId: "main",
    floorId: floor.id,
    runId: "run-1",
    attemptNo: 1,
    stepIndex: 0,
    slot: "narrator",
    purpose: "reply",
    releaseId: null,
    draftRevision: null,
    resourceVersions: {},
    inputPageId: inputPage.id,
    inputMessageId: inputPage.messages[0]!.id,
    callId: "call-1",
    invocationId: "invocation-1",
    requestAttemptNo: 1,
    provider: "provider-1",
    model: "model-1",
    endpoint: "https://example.test/chat",
    requestBody: '{"messages":[{"role":"user"}]}',
    responseBody: '{"choices":[{"message":{"content":"reply"}}]}',
    httpStatus: 200,
    status: "succeeded",
    preparedAt: 100,
    sentAt: 110,
    firstResponseAt: 120,
    endedAt: 130,
    text: "Lin Lan unfolds the letter.",
    reasoning: null,
    toolData: null,
    usage: { inputTokens: 120, outputTokens: 34, totalTokens: 154 },
    finishReason: "stop",
    error: null,
    outputPageId: outputPage.id,
    outputMessageId: outputPage.messages[0]!.id,
  },
  completionEvidence: "complete",
  turnCommitStatus: "committed",
};

function setup(
  options: {
    presentation?: "categories" | "accordion";
    pages?: TimelinePage[];
    modelCalls?: ModelCallDetail[];
    rejectCalls?: boolean;
    rejectInspection?: boolean;
    rejectResult?: boolean;
    noRun?: boolean;
    initialPageId?: string;
    initialCall?: ModelCallDetail;
    runError?: boolean;
    state?: string;
    onRefresh?: () => void;
  } = {},
) {
  const pages = options.pages ?? floor.pages;
  const currentFloor = { ...floor, pages, state: options.state ?? floor.state };
  const modelCallsList = vi.fn(async () => {
    if (options.rejectCalls)
      throw Object.assign(new Error(), { code: "CALLS_FAILED" });
    return { data: options.modelCalls ?? [modelCall], nextCursor: null };
  });
  const inspectionLoad = vi.fn(async () => {
    if (options.rejectInspection)
      throw Object.assign(new Error(), { code: "INSPECTION_FAILED" });
    return [
      {
        key: "prompt",
        label: "Historical prompt evidence",
        value: { prompt_snapshot: ["system", "user"] },
      },
    ];
  });
  const getResult = vi.fn(async () => {
    if (options.rejectResult)
      throw Object.assign(new Error(), { code: "RESULT_FAILED" });
    return {
      assistantMessageId: "committed-message",
      committedAt: 130,
      floorId: floor.id,
      generatedText: "Committed result from the result endpoint.",
      inputTokens: 120,
      outputPageId: outputPage.id,
      outputTokens: 34,
      summaries: ["A summary saved with the committed result."],
      totalTokens: 154,
      totalUsage: { inputTokens: 120, outputTokens: 34, totalTokens: 154 },
      verifier: null,
    };
  });
  const getRun = vi.fn(async () => ({
    floorId: currentFloor.id,
    state: currentFloor.state,
    run: options.noRun
      ? null
      : {
          sessionId: "session-1",
          floorId: floor.id,
          runId: "run-1",
          runType: "respond",
          status: "completed",
          phase: "completed",
          publicPhase: "completed",
          phaseSeq: 2,
          attemptNo: 1,
          startedAt: 100,
          updatedAt: 130,
          completedAt: 130,
          error: options.runError
            ? { code: "RUN_FAILED", message: "The turn stopped before commit." }
            : null,
        },
  }));
  bridge.api = {
    modelCalls: { list: modelCallsList },
    floors: {
      getResult,
      getRun,
    },
    generationInspection: { load: inspectionLoad },
    sessions: {},
  };
  vi.stubGlobal("window", {
    location: { href: `http://local.test/generation-detail${options.initialPageId ? `?pageId=${options.initialPageId}` : ""}` },
    history: { replaceState: vi.fn((_state, _unused, url) => { window.location.href = String(url); }) },
  });
  const host = mountComponent(RoleGenerationDetail, {
    floor: currentFloor,
    floorRecord,
    sessionId: "session-1",
    sessionTitle: "Harbor Bookshop",
    branchId: "main",
    initialPageId: options.initialPageId,
    initialCall: options.initialCall,
    ...(options.presentation ? { presentation: options.presentation } : {}),
    ...(options.onRefresh ? { onRefresh: options.onRefresh } : {}),
  });
  return { host, modelCallsList, inspectionLoad, getResult, getRun };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it("renders the standalone vertical accordion and keeps model call evidence inside its fold", async () => {
  const { host, modelCallsList, inspectionLoad, getResult } = setup({
    presentation: "accordion",
    runError: true,
  });
  try {
    await vi.waitFor(async () => {
      await settleComponent();
      expect(host.root.textContent).toContain(modelCallUi.modelCalls);
      expect(host.root.textContent).toContain("会话轮次");
      expect(host.root.textContent).toContain("刷新记录");
      expect(host.root.textContent).toContain("执行状态与阶段");
      expect(host.root.textContent).toContain("演绎者消息");
      expect(host.root.textContent).toContain("生成消息");
      expect(host.root.textContent).toContain("轮次提交结果");
      expect(host.root.textContent).toContain("轮次记录");
      expect(host.root.textContent).toContain("错误详情");
      expect(host.root.textContent).toContain("Historical prompt evidence");
      expect(host.root.textContent).toContain(
        "Committed result from the result endpoint.",
      );
    });

    const sections = host.all((node) => node.tagName === "DETAILS");
    expect(host.all((node) => node.tagName === "NAV")).toHaveLength(0);
    expect(
      host
        .all((node) => node.tagName === "PRE")
        .every((node) => node.props.tabindex === "0"),
    ).toBe(true);
    const detailRoot = host.all(
      (node) => node.props.class === "generation-detail",
    )[0]!;
    const headings = detailRoot.children.filter(
      (node) => node.tagName === "H2",
    );
    const selectIndex = detailRoot.children.findIndex(
      (node) => node.tagName === "LABEL",
    );
    const actionIndex = detailRoot.children.findIndex((node) =>
      String(node.props.class).includes("generation-accordion-actions"),
    );
    const accordion = host.all(
      (node) => node.props.class === "generation-accordion",
    )[0]!;
    expect(headings[0]?.textContent).toBe("生成详情");
    expect(selectIndex).toBeGreaterThan(0);
    expect(actionIndex).toBeGreaterThan(selectIndex);
    expect(detailRoot.children[actionIndex]?.children).toHaveLength(1);
    expect(detailRoot.children.indexOf(accordion)).toBeGreaterThan(actionIndex);
    expect(accordion.children[0]?.tagName).toBe("DL");
    const topLevelFolds = accordion.children.filter(
      (node) => node.tagName === "DETAILS",
    );
    expect(topLevelFolds[0]?.open).toBe(false);
    expect(topLevelFolds[1]?.open).toBe(false);
    expect(topLevelFolds[2]?.open).toBe(true);
    expect(topLevelFolds[3]?.open).toBe(false);
    expect(
      topLevelFolds.map((fold) => fold.children[0]?.textContent.trim()),
    ).toEqual([
      "执行状态与阶段",
      "错误详情",
      "演绎者消息 · 第 1 页",
      "生成消息 · 第 2 页",
      "轮次提交结果",
      "轮次记录",
      "Historical prompt evidence",
      "模型调用记录",
    ]);
    expect(topLevelFolds[0]?.textContent).toContain('"floorId": "floor-1"');
    expect(topLevelFolds[0]?.textContent).toContain('"runId": "run-1"');
    expect(topLevelFolds[2]?.textContent).toContain("页面记录");
    const modelCallsFold = topLevelFolds.find((fold) =>
      fold.textContent.includes(modelCallUi.modelCalls),
    );
    expect(modelCallsFold?.open).toBe(false);
    const rawFloorFold = topLevelFolds.find((fold) =>
      fold.textContent.includes("轮次记录"),
    );
    expect(rawFloorFold?.textContent).toContain('"branchId": "main"');
    expect(rawFloorFold?.textContent).not.toContain('"activePages"');
    const previewFold = detailRoot.children.find((node) =>
      String(node.props.class).includes("generation-preview"),
    );
    expect(detailRoot.children.indexOf(previewFold!)).toBeGreaterThan(
      detailRoot.children.indexOf(accordion),
    );
    expect(
      sections.some((section) =>
        section.textContent.includes("Meet me at the old lighthouse."),
      ),
    ).toBe(true);
    expect(
      sections.some((section) =>
        section.textContent.includes(modelCall.call.requestBody),
      ),
    ).toBe(true);
    expect(
      sections.some(
        (section) =>
          section.open &&
          section.children.some(
            (child) =>
              child.tagName === "SUMMARY" &&
              child.textContent.includes("演绎者消息"),
          ),
      ),
    ).toBe(true);
    expect(host.root.textContent).toContain('{"messages":[{"role":"user"}]}');
    expect(modelCallUi.modelCalls).toBe("模型调用记录");
    expect(modelCallUi.detailHeading).toBe("TavernHeadless · 生成详情");
    expect(modelCallUi.detailBackAdmin).toBe("返回管理端");
    expect(modelCallUiSchema.safeParse(modelCallUi).success).toBe(true);
    expect(
      modelCallUiSchema.safeParse({ ...modelCallUi, modelCalls: undefined })
        .success,
    ).toBe(false);
    expect(modelCallsList).toHaveBeenCalledWith({ floorId: floor.id });
    expect(getResult).toHaveBeenCalledWith({ floorId: floor.id });
    expect(inspectionLoad).toHaveBeenCalledWith({ floorId: floor.id });
  } finally {
    host.unmount();
  }
});

it("forwards accordion refresh to the parent and keeps management refresh local", async () => {
  const onRefresh = vi.fn();
  const standalone = setup({ presentation: "accordion", onRefresh });
  try {
    await vi.waitFor(async () => {
      await settleComponent();
      expect(standalone.getRun).toHaveBeenCalledTimes(1);
      expect(standalone.modelCallsList).toHaveBeenCalledTimes(1);
    });
    standalone.host
      .all(
        (node) => node.tagName === "BUTTON" && node.textContent === "刷新记录",
      )[0]!
      .click();
    expect(onRefresh).toHaveBeenCalledOnce();
    await settleComponent();
    expect(standalone.getRun).toHaveBeenCalledTimes(1);
    expect(standalone.modelCallsList).toHaveBeenCalledTimes(1);
  } finally {
    standalone.host.unmount();
  }

  const management = setup();
  try {
    await vi.waitFor(async () => {
      await settleComponent();
      expect(management.getRun).toHaveBeenCalledTimes(1);
    });
    management.host
      .all(
        (node) => node.tagName === "BUTTON" && node.textContent === "刷新",
      )[0]!
      .click();
    await vi.waitFor(async () => {
      await settleComponent();
      expect(management.getRun).toHaveBeenCalledTimes(2);
    });
  } finally {
    management.host.unmount();
  }
});

it("reports model-call history load failures inside the collapsed history region", async () => {
  const { host, modelCallsList } = setup({
    presentation: "accordion",
    rejectCalls: true,
  });
  try {
    await vi.waitFor(async () => {
      await settleComponent();
      expect(host.root.textContent).toContain(
        apiErrorMessages.MODEL_CALL_LOAD_FAILED,
      );
    });
    expect(modelCallsList).toHaveBeenCalledTimes(1);
    expect(host.all((node) => node.props.role === "alert")).not.toHaveLength(0);
  } finally {
    host.unmount();
  }
});

it("keeps inspection sections available when committed-result loading fails", async () => {
  const { host, getResult, inspectionLoad } = setup({
    presentation: "accordion",
    rejectResult: true,
  });
  try {
    await vi.waitFor(async () => {
      await settleComponent();
      expect(host.root.textContent).toContain(
        apiErrorMessages.MODEL_CALL_LOAD_FAILED,
      );
      expect(host.root.textContent).toContain("Historical prompt evidence");
    });
    expect(getResult).toHaveBeenCalledWith({ floorId: floor.id });
    expect(inspectionLoad).toHaveBeenCalledWith({ floorId: floor.id });
  } finally {
    host.unmount();
  }
});

it.each(["failed", "committed"])(
  "does not request a committed result for a %s floor without a run",
  async (state) => {
    const { host, getResult, inspectionLoad } = setup({
      presentation: "accordion",
      state,
      noRun: true,
    });
    try {
      await vi.waitFor(async () => {
        await settleComponent();
        expect(host.root.textContent).toContain("Historical prompt evidence");
      });
      expect(getResult).not.toHaveBeenCalled();
      expect(inspectionLoad).toHaveBeenCalledWith({ floorId: floor.id });
    } finally {
      host.unmount();
    }
  },
);

it("shows missing model-call evidence and inspection errors while empty pages remain valid", async () => {
  const { host, modelCallsList } = setup({
    presentation: "accordion",
    pages: [],
    modelCalls: [],
    rejectInspection: true,
    noRun: true,
  });
  try {
    await vi.waitFor(async () => {
      await settleComponent();
      expect(
        host.all((node) => node.props.role === "alert").length,
      ).toBeGreaterThan(0);
      expect(host.root.textContent).toContain(modelCallUi.empty);
    });
    expect(host.root.textContent).toContain("暂无生成记录。");
    expect(host.root.textContent).toContain('"run": null');
    expect(modelCallsList).toHaveBeenCalledTimes(1);
  } finally {
    host.unmount();
  }
});

it("keeps the category panel for the management workspace default", async () => {
  const { host } = setup();
  try {
    await vi.waitFor(async () => {
      await settleComponent();
      expect(host.all((node) => node.tagName === "NAV")).toHaveLength(1);
    });

    expect(
      host
        .all((node) => node.tagName === "BUTTON")
        .map((button) => button.textContent)
        .join(" "),
    ).toContain("运行概览");
    expect(
      host.all((node) => node.props.class === "generation-accordion"),
    ).toHaveLength(0);
  } finally {
    host.unmount();
  }
});

for (const initialPageId of [inputPage.id, outputPage.id]) {
  it(`preserves and opens the explicitly linked page ${initialPageId}`, async () => {
    const { host } = setup({ presentation: "accordion", initialPageId, initialCall: modelCall });
    try {
      await vi.waitFor(async () => {
        await settleComponent();
        expect(host.root.textContent).toContain("Historical prompt evidence");
      });
      const folds = host.root.querySelectorAll("details");
      const pageFold = folds.find(node => node.children[0]?.textContent.includes(
        initialPageId === inputPage.id ? "演绎者消息" : "生成消息"));
      expect(pageFold?.open).toBe(true);
      expect(new URL(window.location.href).searchParams.get("pageId")).toBe(initialPageId);
    } finally { host.unmount(); }
  });
}

for (const outputPageId of [outputPage.id, null]) {
  it(`updates the page locator when selecting a call with output ${outputPageId}`, async () => {
    const otherCall: ModelCallDetail = { ...modelCall, call: { ...modelCall.call, callId: "call-other", runId: "run-other", model: "other-model", outputPageId } };
    const { host } = setup({ presentation: "accordion", initialPageId: inputPage.id, modelCalls: [modelCall, otherCall] });
    try {
      await vi.waitFor(async () => {
        await settleComponent();
        expect(host.root.textContent).toContain("Historical prompt evidence");
      });
      const button = host.root.querySelectorAll("button").find(node => node.textContent.includes("other-model"));
      expect(button).toBeDefined();
      button!.click();
      await settleComponent();
      const params = new URL(window.location.href).searchParams;
      expect(params.get("callId")).toBe("call-other");
      expect(params.get("runId")).toBe("run-other");
      expect(params.get("pageId")).toBe(outputPageId);
      if (outputPageId) {
        expect(host.root.querySelectorAll("details").find(node => node.children[0]?.textContent.includes("生成消息"))?.open).toBe(true);
      }
    } finally { host.unmount(); }
  });
}

it("clears stale call, run and page locators when filtering returns no calls", async () => {
  const { host, modelCallsList } = setup({ presentation: "accordion", initialPageId: outputPage.id });
  try {
    await vi.waitFor(async () => {
      await settleComponent();
      expect(host.root.textContent).toContain("Historical prompt evidence");
    });
    expect(new URL(window.location.href).searchParams.get("callId")).toBe(modelCall.call.callId);
    modelCallsList.mockResolvedValueOnce({ data: [], nextCursor: null });
    host.root.querySelectorAll("form")[0]!.dispatchEvent(new Event("submit"));
    await vi.waitFor(async () => {
      await settleComponent();
      expect(modelCallsList).toHaveBeenCalledTimes(2);
    });
    const params = new URL(window.location.href).searchParams;
    for (const key of ["callId", "runId", "pageId"]) expect(params.has(key)).toBe(false);
    expect(host.root.querySelectorAll("details").find(node => node.children[0]?.textContent.includes("生成消息"))?.open).toBe(false);
  } finally { host.unmount(); }
});
