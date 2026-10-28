import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { mount } from "./commit-panel.mjs";
import { derive, validate, renderController } from "./backend-hooks.mjs";
import { createSessionHost } from "../../../../apps/user-web/src/features/chat/session-controller.ts";
import { roleRuntimeValidators, apiErrorMessages } from "@tavern/shared";
import {
  RoleModelCapabilitiesToolProvider,
  PresetToolProvider,
  ToolRegistry,
  ToolExecutor,
  createEventBus,
} from "@tavern/core";
import { TextProtocolToolCallParser } from "../../../../packages/core/src/tools/transport/text-protocol/tool-call-parser.ts";
import { TextProtocolToolResultFormatter } from "../../../../packages/core/src/tools/transport/text-protocol/tool-result-formatter.ts";

const input = JSON.parse(
  await readFile(new URL("./backend-input.json", import.meta.url), "utf8"),
);
const roundtrips = JSON.parse(
  await readFile(new URL("./tool-roundtrips.json", import.meta.url), "utf8"),
);

function createExampleHost({ fail = false, energy = 8 } = {}) {
  const before = {
    sessionId: "session-1",
    branchId: "main",
    floorId: null,
    attemptId: null,
    versionId: "version-1",
    snapshotId: "snapshot-0",
    parentSnapshotId: null,
    variables: { location: "大厅", energy: 10 },
    source: { kind: "initial", runId: null, jobId: null },
  };
  const after = {
    ...before,
    floorId: "floor-1",
    attemptId: "run-1:1",
    snapshotId: "snapshot-1",
    parentSnapshotId: before.snapshotId,
    variables: { location: "花园", energy },
    source: { kind: "floor", runId: "run-1", jobId: null },
  };
  const event = {
    eventId: "commit:snapshot-1",
    sessionId: before.sessionId,
    branchId: before.branchId,
    kind: "generated",
    previousCurrentSnapshotId: before.snapshotId,
    before,
    after,
  };
  expect(roleRuntimeValidators.turnCommit(event)).toBe(true);
  const session = {
    sessionId: before.sessionId,
    branchId: before.branchId,
    versionId: before.versionId,
    current: before,
    delivery: { assets: {}, data: {} },
  };
  const host = createSessionHost({
    session,
    transport: {
      subscribeState() { return () => {}; },
      async getCurrentSnapshot() { return session.current; },
      async send({ emit }) {
        if (fail)
          throw Object.assign(new Error("state update failed"), {
            code: "ROLE_STATE_UPDATE_FAILED",
          });
        emit({ type: "commit", data: event });
        emit({ type: "completed", data: { snapshotId: after.snapshotId } });
      },
      async loadSession() {
        return session;
      },
      async getSnapshot(id) {
        return id === before.snapshotId ? before : after;
      },
      dispose() {},
    },
    policy: Object.fromEntries(
      ["historyCache", "settledStreamCache", "diagnosticsCache"].map((key) => [
        key,
        { maxEntries: 4, maxBytes: 20000 },
      ]),
    ),
    errors: apiErrorMessages,
  });
  let text = "等待本轮变量提交";
  const handlers = new Map();
  const panel = {
    update(patch) {
      expect(roleRuntimeValidators.layoutPatch(patch)).toBe(true);
      expect(roleRuntimeValidators.textElementUpdate(patch.change)).toBe(true);
      text = patch.change.text;
    },
    on(id, eventName, fn) {
      handlers.set(id + ":" + eventName, fn);
      return () => {};
    },
  };
  mount({
    api: {
      ui: { register: () => panel },
      variables: { onTurnCommitted: (fn) => host.onTurnCommitted(fn) },
      widgets: { mountChat: vi.fn() },
    },
  });
  return {
    host,
    before,
    after,
    text: () => text,
    stop: () => handlers.get("stop:click")(),
  };
}

describe("documented TurnCommit usage through the real session host", () => {
  it.each([
    [8, "精力 10 → 8（-2）"],
    [10, "精力 10 → 10（0）"],
    [12, "精力 10 → 12（+2）"],
  ])("renders submitted energy %s", async (energy, expected) => {
    const example = createExampleHost({ energy });
    expect(example.text()).toBe("等待本轮变量提交");
    await example.host.send({ text: "继续检查。" });
    expect(example.text()).toBe(expected);
    await example.host.select(example.before.snapshotId);
    expect(example.text()).toBe(expected);
    example.stop();
    await example.host.send({ text: "继续检查。" });
    expect(example.text()).toBe("已停止变化提示");
    example.host.dispose();
  });
  it("keeps the message unchanged when variable submission fails", async () => {
    const example = createExampleHost({ fail: true });
    await expect(
      example.host.send({ text: "继续检查。" }),
    ).rejects.toMatchObject({ code: "ROLE_STATE_UPDATE_FAILED" });
    expect(example.text()).toBe("等待本轮变量提交");
    example.host.dispose();
  });
});

describe("backend module usage examples", () => {
  it("computes, validates and renders the documented complete input", () => {
    const saved = structuredClone(input);
    const candidate = derive(input);
    expect(candidate).toEqual({ score: 25, level: 2, location: "花园" });
    expect(validate({ ...input, candidate })).toEqual({ issues: [] });
    expect(
      renderController({
        entryId: 10,
        variables: candidate,
        characterBook: { entries: [] },
      }),
    ).toEqual({ text: "当前地点：花园。" });
    expect(input).toEqual(saved);
  });
  it.each([
    [0, 0],
    [9, 0],
    [10, 1],
  ])("computes score boundary %s", (score, level) => {
    expect(
      derive({ ...input, candidate: { ...input.candidate, score } }).level,
    ).toBe(level);
  });
  it("returns a rule issue for decreasing score", () => {
    expect(
      validate({ ...input, candidate: { ...input.candidate, score: 15 } })
        .issues[0],
    ).toMatchObject({ path: "/score", code: "SCORE_DECREASED" });
  });
});

const context = {
  sessionId: "session-1",
  branchId: "main",
  floorId: "floor-1",
  callerSlot: "narrator",
  variableContext: { sessionId: "session-1" },
};
describe("tool calling usage examples", () => {
  it.each(roundtrips)(
    "parses and formats $toolName using production protocol implementations",
    ({ toolName, callId, args, result }) => {
      const parser = new TextProtocolToolCallParser();
      const output = parser.parse({
        modelOutputText: `<tool_call id="${callId}" name="${toolName}">\n${JSON.stringify({ args })}\n</tool_call>`,
        allowedToolNames: new Set([toolName]),
      });
      expect(output.calls).toEqual([{ toolName, callId, args }]);
      const formatted = new TextProtocolToolResultFormatter().format({
        toolName,
        callId,
        result,
      });
      expect(formatted.content).toContain(
        `name="${toolName}" status="success"`,
      );
      expect(formatted.content).toContain(JSON.stringify(typeof result.data?.ok === "boolean" ? result.data : result, null, 2));
    },
  );
  it("executes the documented success, failure, denial, event and record paths", async () => {
    const registry = new ToolRegistry();
    const systemConfig = JSON.parse(await readFile(new URL("../../../../apps/api/config/role-model-capabilities.json", import.meta.url), "utf8"));
    const grant = { enabled: true, allowed: ["random", "calculate"], slot: "narrator", transport: "text_protocol" };
    registry.register(new RoleModelCapabilitiesToolProvider({ systemConfig, grant, resolveGrant: () => grant }));
    const bus = createEventBus();
    const completed = vi.fn();
    const off = bus.on("tool.call_completed", completed);
    const executor = new ToolExecutor(registry, bus);
    const permissions = { enabled: true, maxCallsPerTurn: 5 };
    const success = await executor.execute(
      "random",
      { domain: { kind: "integer_range", min: 1, max: 1 }, distribution: { kind: "uniform" }, count: 2, replacement: true },
      context,
      permissions,
    );
    expect(success.data).toEqual({
      ok: true,
      data: { samples: [1, 1], indices: null },
    });
    const failure = await executor.execute(
      "calculate",
      { expression: { op: "div", args: [1, 0] } },
      context,
      permissions,
    );
    expect(failure).toMatchObject({
      executionStatus: "error",
      executionReasonCode: "DIVISION_BY_ZERO",
    });
    const denied = await executor.execute("random", {}, context, {
      enabled: false,
    });
    expect(denied.denied).toBe("disabled");
    expect(completed).toHaveBeenCalledTimes(1);
    expect(
      executor.getExecutionRecords().map((record) => record.status),
    ).toEqual(["success", "error", "denied"]);
    off();
  });
  it("runs the custom script with concrete input and output", async () => {
    const provider = new PresetToolProvider(
      "character:character-1",
      [
        {
          name: "remaining_points",
          description: "计算剩余积分",
          parameters: {
            type: "object",
            properties: { total: { type: "number" }, used: { type: "number" } },
            required: ["total", "used"],
          },
          sideEffectLevel: "none",
          allowedSlots: ["narrator"],
          handlerType: "script",
          handler: { script: "return { remaining: args.total - args.used };" },
        },
      ],
      { allowUnsafeScriptHandlerExecution: true },
    );
    expect(
      await provider.executeTool(
        "remaining_points",
        { total: 20, used: 7 },
        context,
      ),
    ).toEqual({ data: { remaining: 13 } });
  });
});
