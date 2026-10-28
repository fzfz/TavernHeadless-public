import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { buildTestApp, type BuildAppResult } from "../../../test/helpers/create-test-db.js";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../accounts/constants.js";
import { createTestProject } from "../../__tests__/helpers/workspace-project.js";
import {
  characters,
  characterVersions,
  floors,
  messagePages,
  messages,
  modelCallRecords,
  presets,
  sessions,
  toolExecutionRecords,
} from "../../db/schema.js";
import { roleReleases } from "../../db/role-release-schema.js";
import { SessionBranchRegistryService } from "../../services/variables/host/session-branch-registry-service.js";
import { loadAcceptedRoleToolEvidence } from "../../services/role-runtime/role-tool-evidence.js";
import { persistRoleModelCapabilitySessionSnapshot } from "../../services/role-model-capabilities.js";

const persona = {
  name: "裴修远",
  description:
    "裴修远是二十八岁的男性药师，性格谨慎，正在向林澄询问药草的数量。",
};
const character = {
  name: "林澄",
  description: "林澄是药铺的店主。",
  primaryGreeting: "林澄指着药柜，问裴修远：‘你想买几份药草？’",
};
const userMessage = "“请给我两份药草，并计算三份药草的总价。”";
const narrative =
  "林澄取出两份药草，告诉裴修远：‘每份四枚铜钱，三份共十二枚。’";
const config = {
  enableDirector: false,
  enableVerifier: false,
  enableMemoryConsolidation: false,
};
const apps: BuildAppResult[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  while (apps.length) await apps.pop()!.app.close();
});

async function fixture(
  transport: "native_function_call" | "text_protocol",
  enabled = true,
) {
  const built = await buildTestApp({
    databasePath: ":memory:",
    auth: { mode: "off" },
    accountMode: "single",
    enablePromptDryRun: true,
    orchestration: {
      providers: [
        {
          id: "capability-test",
          type: "openai-compatible",
          apiMode: "chat",
          apiKey: "test",
          baseURL: "https://capability-test.invalid/v1",
        },
      ],
      defaultModel: { providerId: "capability-test", modelId: "test-model" },
    },
  });
  apps.push(built);
  const now = Date.now();
  const { workspaceId, projectId } = createTestProject(built.database, {
    accountId: DEFAULT_ADMIN_ACCOUNT_ID,
    now,
  });
  built.database
    .insert(characters)
    .values({
      id: "capability-character",
      name: character.name,
      source: "test",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      workspaceId,
      status: "active",
      revision: 0,
      latestVersionNo: 1,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  built.database
    .insert(characterVersions)
    .values({
      id: "capability-version",
      characterId: "capability-character",
      versionNo: 1,
      dataJson: JSON.stringify(character),
      contentHash: "test-character",
      createdAt: now,
    })
    .run();
  const grant = {
    enabled,
    allowed: ["random", "calculate"],
    slot: "narrator",
    transport,
  };
  built.database
    .insert(presets)
    .values({
      id: "capability-preset",
      name: "第三人称药铺预设",
      source: "test",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      workspaceId,
      version: 1,
      createdAt: now,
      updatedAt: now,
      dataJson: JSON.stringify({
        names_behavior: 0,
        prompts: [
          {
            identifier: "main",
            name: "Narration",
            role: "system",
            content:
              "作者必须使用第三人称叙述，台词中的我和你按照说话者和听话者解释。用户扮演{{user}}，角色为{{char}}。",
          },
          {
            identifier: "personaDescription",
            name: "Persona Description",
            marker: true,
          },
          {
            identifier: "charDescription",
            name: "Character Description",
            marker: true,
          },
          { identifier: "chatHistory", name: "Chat History", marker: true },
        ],
        prompt_order: [
          {
            character_id: 100001,
            order: [
              "main",
              "personaDescription",
              "charDescription",
              "chatHistory",
            ].map((identifier) => ({ identifier, enabled: true })),
          },
        ],
      }),
    })
    .run();
  built.database
    .insert(roleReleases)
    .values({
      id: "capability-release",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      name: "药铺",
      characterId: "capability-character",
      characterVersionId: "capability-version",
      characterSnapshotJson: JSON.stringify(character),
      presetId: "capability-preset",
      presetVersionId: "capability-preset-version",
      promptMode: "native",
      modelSlotsJson: "[]",
      modelCapabilitiesJson: JSON.stringify(grant),
      defaultUserId: "capability-user",
      defaultUserSnapshotJson: JSON.stringify(persona),
      openingsJson: "[]",
      isActive: true,
      createdAt: now,
    })
    .run();
  built.database
    .insert(sessions)
    .values({
      id: "capability-session",
      title: "药铺工具验收",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      workspaceId,
      projectId,
      characterId: "capability-character",
      characterVersionId: "capability-version",
      presetId: "capability-preset",
      characterSnapshotJson: JSON.stringify(character),
      userSnapshotJson: JSON.stringify(persona),
      promptMode: "native",
      status: "active",
      metadataJson: JSON.stringify({
        role_release_id: "capability-release",
        model_capabilities: grant,
      }),
      createdAt: now,
      updatedAt: now,
    })
    .run();
  new SessionBranchRegistryService(built.database).ensure({
    accountId: DEFAULT_ADMIN_ACCOUNT_ID,
    sessionId: "capability-session",
    branchId: "main",
    createdAt: now,
  });
  persistRoleModelCapabilitySessionSnapshot(built.database, {
    sessionId: "capability-session",
    accountId: DEFAULT_ADMIN_ACCOUNT_ID,
    metadata: {
      role_release_id: "capability-release",
      model_capabilities: grant,
    },
  });
  built.database
    .insert(floors)
    .values({
      id: "capability-opening-floor",
      sessionId: "capability-session",
      floorNo: 0,
      branchId: "main",
      state: "committed",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  built.database
    .insert(messagePages)
    .values({
      id: "capability-opening-page",
      floorId: "capability-opening-floor",
      pageNo: 0,
      pageKind: "output",
      isActive: true,
      version: 1,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  built.database
    .insert(messages)
    .values({
      id: "capability-opening-message",
      pageId: "capability-opening-page",
      seq: 0,
      role: "assistant",
      content: character.primaryGreeting,
      contentFormat: "text",
      createdAt: now,
    })
    .run();
  await built.app.ready();
  return built;
}

function returnedToolResult(
  request: Record<string, any>,
  transport: "native_function_call" | "text_protocol",
) {
  return transport === "native_function_call"
    ? JSON.parse(
        request.messages.find(
          (message: Record<string, any>) => message.role === "tool",
        ).content,
      )
    : JSON.parse(
        request.messages
          .map((message: Record<string, any>) => message.content)
          .join("\n")
          .match(/<tool_result[^>]*>([\s\S]*?)<\/tool_result>/)![1],
      );
}

function modelResponses(
  transport: "native_function_call" | "text_protocol",
  argumentsValue: Record<string, unknown>,
  toolName = "calculate",
  dependentCalculation = false,
) {
  const requests: Array<Record<string, any>> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const body = JSON.parse(await request.text());
      requests.push(body);
      const first = requests.length === 1;
      const continues =
        first || (dependentCalculation && requests.length === 2);
      let callArguments = argumentsValue;
      if (dependentCalculation && requests.length === 2) {
        const toolResult = returnedToolResult(body, transport);
        callArguments = {
          expression: { op: "mul", args: [toolResult.data.samples[0], 4] },
        };
      }
      const callName = first ? toolName : "calculate";
      const callId = first ? "capability-call" : "dependent-call";
      const toolCall = {
        id: callId,
        type: "function",
        function: { name: callName, arguments: JSON.stringify(callArguments) },
      };
      const content =
        continues && transport === "text_protocol"
          ? `<tool_call id="${callId}" name="${callName}">${JSON.stringify({ args: callArguments })}</tool_call>`
          : continues
            ? null
            : narrative;
      return new Response(
        JSON.stringify({
          id: `completion-${requests.length}`,
          object: "chat.completion",
          created: 1,
          model: "test-model",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content,
                ...(continues && transport === "native_function_call"
                  ? { tool_calls: [toolCall] }
                  : {}),
              },
              finish_reason:
                continues && transport === "native_function_call"
                  ? "tool_calls"
                  : "stop",
            },
          ],
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        }),
        { headers: { "content-type": "application/json" } },
      );
    }),
  );
  return requests;
}

async function saveAcceptance(name: string, value: unknown) {
  const directory = process.env.ROLE_CAPABILITY_ACCEPTANCE_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, `${name}.json`),
    JSON.stringify(value, null, 2) + "\n",
  );
}

describe("formal role model capabilities HTTP integration", () => {
  it("reports native provider schema rejection and retains the original response", async () => {
    const built = await fixture("native_function_call");
    const providerBody = {
      error: {
        message: "Invalid schema for function random: oneOf is not supported.",
        type: "invalid_request_error",
        code: "invalid_function_parameters",
        param: "tools[0].function.parameters",
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(providerBody), {
            status: 400,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const response = await built.app.inject({
      method: "POST",
      url: "/sessions/capability-session/respond",
      payload: { message: userMessage, config },
    });
    expect(response.statusCode, response.body).toBe(422);
    expect(response.json().error.code).toBe(
      "ROLE_MODEL_TOOL_PROTOCOL_UNSUPPORTED",
    );
    const records = built.database.select().from(modelCallRecords).all();
    expect(records).toHaveLength(1);
    const record = JSON.parse(records[0]!.recordJson);
    expect(record.httpStatus).toBe(400);
    expect(JSON.parse(record.responseBody)).toEqual(providerBody);
    expect(records[0]!.turnCommitStatus).toBe("failed");
    expect(built.database.select().from(toolExecutionRecords).all()).toEqual(
      [],
    );
  });

  it.each([
    ["native_function_call", true, "invalid_request_error", "messages"],
    [
      "text_protocol",
      true,
      "invalid_function_parameters",
      "tools[0].function.parameters",
    ],
    [
      "native_function_call",
      false,
      "invalid_function_parameters",
      "tools[0].function.parameters",
    ],
  ] as const)(
    "keeps unrelated or non-native provider errors unchanged: %s, enabled=%s, code=%s",
    async (transport, enabled, code, param) => {
      const built = await fixture(transport, enabled);
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                error: {
                  message: "Provider rejected the request.",
                  type: "invalid_request_error",
                  code,
                  param,
                },
              }),
              { status: 400, headers: { "content-type": "application/json" } },
            ),
        ),
      );
      const response = await built.app.inject({
        method: "POST",
        url: "/sessions/capability-session/respond",
        payload: { message: userMessage, config },
      });
      expect(response.statusCode, response.body).toBe(500);
      expect(response.json().error.code).not.toBe(
        "ROLE_MODEL_TOOL_PROTOCOL_UNSUPPORTED",
      );
    },
  );

  it.each(["native_function_call", "text_protocol"] as const)(
    "assembles identity and continues the same turn with %s evidence",
    async (transport) => {
      const built = await fixture(transport);
      const requests = modelResponses(transport, {
        expression: { op: "mul", args: [3, 4] },
      });
      const dryRun = await built.app.inject({
        method: "POST",
        url: "/sessions/capability-session/respond/dry-run",
        payload: { message: userMessage, config },
      });
      expect(dryRun.statusCode, dryRun.body).toBe(200);
      const dry = dryRun.json().data;
      expect(JSON.stringify(dry.messages)).toContain(persona.description);
      expect(JSON.stringify(dry.messages)).toContain("第三人称");
      expect(JSON.stringify(dry.messages)).toContain(userMessage);
      expect(requests).toHaveLength(0);
      const response = await built.app.inject({
        method: "POST",
        url: "/sessions/capability-session/respond",
        payload: {
          message: userMessage,
          config,
          debug: { include_runtime_trace: true },
        },
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json().data.generated_text).toBe(narrative);
      expect(requests).toHaveLength(2);
      expect(returnedToolResult(requests[1]!, transport)).toEqual({
        ok: true,
        data: { type: "number", value: 12 },
      });
      const records = built.database.select().from(toolExecutionRecords).all();
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        callId: "capability-call",
        generationAttemptNo: 1,
        generationStepNo: 1,
        toolName: "calculate",
        status: "success",
        commitOutcome: "committed",
      });
      expect(records[0]!.acceptedPageId).toBeTruthy();
      const evidence = loadAcceptedRoleToolEvidence(
        built.database,
        DEFAULT_ADMIN_ACCOUNT_ID,
        "capability-session",
        [records[0]!.acceptedPageId!],
      );
      expect(evidence).toMatchObject([
        {
          callId: "capability-call",
          result: { ok: true, data: { type: "number", value: 12 } },
        },
      ]);
      const catalog = await built.app.inject({
        url: "/sessions/capability-session/tools/runtime",
      });
      expect(catalog.statusCode, catalog.body).toBe(200);
      expect(JSON.stringify(catalog.json().data)).toContain("calculate");
      expect(JSON.stringify(catalog.json().data)).not.toContain("get_time");
      await saveAcceptance(transport, {
        persona,
        character,
        preset: "第三人称；names_behavior=0",
        userMessage,
        dryRun: dry,
        requests,
        response: response.json(),
        executionRecords: records,
        toolEvidence: evidence,
      });
    },
  );

  it.each(["native_function_call", "text_protocol"] as const)(
    "feeds random samples into dependent calculate through %s",
    async (transport) => {
      const built = await fixture(transport);
      const requests = modelResponses(
        transport,
        {
          domain: { kind: "integer_range", min: 3, max: 3 },
          distribution: { kind: "uniform" },
          count: 1,
          replacement: true,
        },
        "random",
        true,
      );
      const response = await built.app.inject({
        method: "POST",
        url: "/sessions/capability-session/respond",
        payload: { message: userMessage, config },
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json().data.generated_text).toBe(narrative);
      expect(requests).toHaveLength(3);
      const records = built.database.select().from(toolExecutionRecords).all();
      expect(records.map((record) => record.toolName)).toEqual([
        "random",
        "calculate",
      ]);
      expect(JSON.parse(records[1]!.argsJson)).toEqual({
        expression: { op: "mul", args: [3, 4] },
      });
      expect(records[0]!.acceptedPageId).toBe(records[1]!.acceptedPageId);
      await saveAcceptance(`${transport}-dependent`, {
        userMessage,
        requests,
        response: response.json(),
        executionRecords: records,
      });
    },
  );

  it.each(["native_function_call", "text_protocol"] as const)(
    "returns the same structured error through %s",
    async (transport) => {
      const built = await fixture(transport);
      const requests = modelResponses(transport, {
        expression: { op: "div", args: [3, 0] },
      });
      const response = await built.app.inject({
        method: "POST",
        url: "/sessions/capability-session/respond",
        payload: { message: userMessage, config },
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(requests).toHaveLength(2);
      expect(JSON.stringify(requests[1]!.messages)).toContain(
        "DIVISION_BY_ZERO",
      );
      const record = built.database
        .select()
        .from(toolExecutionRecords)
        .all()[0]!;
      expect(record.status).toBe("error");
      expect(JSON.parse(record.resultJson!)).toMatchObject({
        ok: false,
        error: { code: "DIVISION_BY_ZERO" },
      });
      await saveAcceptance(`${transport}-error`, {
        userMessage,
        requests,
        response: response.json(),
        executionRecord: record,
      });
    },
  );

  it("keeps absent or disabled role grants isolated and rejects raised request limits", async () => {
    const built = await fixture("text_protocol", false);
    const catalog = await built.app.inject({
      url: "/sessions/capability-session/tools/runtime",
    });
    expect(catalog.statusCode, catalog.body).toBe(200);
    expect(JSON.stringify(catalog.json().data)).not.toContain(
      '"name":"random"',
    );
    expect(JSON.stringify(catalog.json().data)).not.toContain("get_time");
    built.database
      .update(sessions)
      .set({
        metadataJson: JSON.stringify({ role_release_id: "capability-release" }),
        roleModelCapabilitiesSnapshotJson: null,
      })
      .where(eq(sessions.id, "capability-session"))
      .run();
    const absent = await built.app.inject({
      url: "/sessions/capability-session/tools/runtime",
    });
    expect(JSON.stringify(absent.json().data)).not.toContain("get_time");
    const response = await built.app.inject({
      method: "POST",
      url: "/sessions/capability-session/respond/dry-run",
      payload: {
        message: userMessage,
        config: { ...config, modelCapabilityLimits: { maxCallsPerTurn: 17 } },
      },
    });
    expect(response.statusCode, response.body).toBe(422);
    expect(response.json().error.code).toBe(
      "ROLE_MODEL_CAPABILITY_LIMIT_INVALID",
    );
  });
});
