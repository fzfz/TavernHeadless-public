import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { apiErrorMessages } from "@tavern/shared";
import { buildTestApp, type BuildAppResult } from "../../../test/helpers/create-test-db.js";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../accounts/constants.js";
import { createTestProject } from "../../__tests__/helpers/workspace-project.js";
import {
  characters,
  characterVersions,
  sessions,
  toolExecutionRecords,
} from "../../db/schema.js";
import { persistRoleModelCapabilitySessionSnapshot } from "../../services/role-model-capabilities.js";

const modelCapabilities = {
  enabled: true,
  allowed: ["random"],
  slot: "narrator",
  transport: "native_function_call",
  limits: { maxCallsPerTurn: 2 },
} as const;

const originalMetadata = {
  role_release_id: "fixed-release",
  model_capabilities: modelCapabilities,
  display_theme: "quiet",
};

const createdApps: BuildAppResult[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  while (createdApps.length > 0) await createdApps.pop()!.app.close();
});

async function makeEnvironment() {
  const built = await buildTestApp({
    databasePath: ":memory:",
    auth: { mode: "off" },
    accountMode: "single",
    orchestration: {
      providers: [
        {
          id: "session-capability-test",
          type: "openai-compatible",
          apiMode: "chat",
          apiKey: "test",
          baseURL: "https://session-capability-test.invalid/v1",
        },
      ],
      defaultModel: {
        providerId: "session-capability-test",
        modelId: "session-test-model",
      },
    },
  });
  createdApps.push(built);

  const now = Date.now();
  const scope = createTestProject(built.database, {
    accountId: DEFAULT_ADMIN_ACCOUNT_ID,
    now,
  });
  const characterData = {
    name: "林澄",
    description: "林澄是药铺的店主。",
    primaryGreeting: "林澄指着药柜，问裴修远：‘你想买几份药草？’",
  };
  built.database
    .insert(characters)
    .values({
      id: "session-capability-character",
      name: characterData.name,
      source: "test",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      workspaceId: scope.workspaceId,
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
      id: "session-capability-character-version",
      characterId: "session-capability-character",
      versionNo: 1,
      dataJson: JSON.stringify(characterData),
      contentHash: "session-capability-character-v1",
      createdAt: now,
    })
    .run();

  await built.app.ready();
  return { ...built, scope };
}

async function postSession(
  built: Awaited<ReturnType<typeof makeEnvironment>>,
  metadata: Record<string, unknown>,
) {
  const response = await built.app.inject({
    method: "POST",
    url: "/sessions",
    payload: {
      project_id: built.scope.projectId,
      title: "角色能力会话",
      character_id: "session-capability-character",
      character_version_id: "session-capability-character-version",
      user_snapshot: {
        name: "裴修远",
        description: "裴修远是二十八岁的男性药师。",
      },
      model_provider: "session-capability-test",
      model_name: "session-test-model",
      prompt_mode: "native",
      metadata,
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().data.id as string;
}

async function createFixedSession(
  built: Awaited<ReturnType<typeof makeEnvironment>>,
) {
  const sessionId = await postSession(built, originalMetadata);
  persistRoleModelCapabilitySessionSnapshot(built.database, {
    sessionId,
    accountId: DEFAULT_ADMIN_ACCOUNT_ID,
    metadata: originalMetadata,
  });
  const [session] = built.database
    .select({ metadataJson: sessions.metadataJson })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .all();
  return {
    sessionId,
    metadata: JSON.parse(session!.metadataJson!) as Record<string, unknown>,
  };
}

describe("session PATCH protects fixed role model capability authorization", () => {
  it("rejects capability expansion, quota increases, authorization deletion, and source changes over HTTP", async () => {
    const built = await makeEnvironment();
    const fixed = await createFixedSession(built);
    const attempts: Array<[string, Record<string, unknown>]> = [
      [
        "adding calculate",
        {
          ...fixed.metadata,
          model_capabilities: {
            ...modelCapabilities,
            allowed: ["random", "calculate"],
          },
        },
      ],
      [
        "raising maxCallsPerTurn",
        {
          ...fixed.metadata,
          model_capabilities: {
            ...modelCapabilities,
            limits: { maxCallsPerTurn: 3 },
          },
        },
      ],
      [
        "deleting authorization",
        { ...fixed.metadata, model_capabilities: undefined },
      ],
      [
        "changing the role source",
        { ...fixed.metadata, role_release_id: "another-release" },
      ],
    ];

    for (const [label, metadata] of attempts) {
      const response = await built.app.inject({
        method: "PATCH",
        url: `/sessions/${fixed.sessionId}`,
        payload: { metadata },
      });
      expect(response.statusCode, `${label}: ${response.body}`).toBe(400);
      expect(response.json().error.code, label).toBe(
        "ROLE_MODEL_CAPABILITY_SNAPSHOT_IMMUTABLE",
      );
      expect(response.json().error.message, label).toBe(
        apiErrorMessages.ROLE_MODEL_CAPABILITY_SNAPSHOT_IMMUTABLE,
      );
    }
  });

  it("allows ordinary metadata edits when every protected field stays unchanged", async () => {
    const built = await makeEnvironment();
    const fixed = await createFixedSession(built);
    const nextMetadata = { ...fixed.metadata, display_theme: "warm" };
    const response = await built.app.inject({
      method: "PATCH",
      url: `/sessions/${fixed.sessionId}`,
      payload: { metadata: nextMetadata },
    });

    expect(response.statusCode, response.body).toBe(200);
    const [session] = built.database
      .select({ metadataJson: sessions.metadataJson })
      .from(sessions)
      .where(eq(sessions.id, fixed.sessionId))
      .all();
    expect(JSON.parse(session!.metadataJson!)).toEqual(nextMetadata);
    const [stored] = built.database
      .select({ snapshotJson: sessions.roleModelCapabilitiesSnapshotJson })
      .from(sessions)
      .where(eq(sessions.id, fixed.sessionId))
      .all();
    expect(stored!.snapshotJson).toBeTruthy();
  });

  it("does not grant capabilities forged in an ordinary POST or execute an unadvertised model call", async () => {
    const built = await makeEnvironment();
    const forgedMetadata = {
      role_release_id: "forged-release",
      model_capabilities: {
        enabled: true,
        allowed: ["random", "calculate"],
        slot: "narrator",
        transport: "native_function_call",
        limits: { maxCallsPerTurn: 16 },
      },
    };
    const sessionId = await postSession(built, forgedMetadata);
    const [stored] = built.database
      .select({ snapshotJson: sessions.roleModelCapabilitiesSnapshotJson })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .all();
    expect(stored!.snapshotJson).toBeNull();

    const catalog = await built.app.inject({
      url: `/sessions/${sessionId}/tools/runtime`,
    });
    expect(catalog.statusCode, catalog.body).toBe(200);
    expect(catalog.json().data.tools).toEqual([]);

    const requests: Array<Record<string, any>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        const body = JSON.parse(await request.text());
        requests.push(body);
        const first = requests.length === 1;
        return new Response(
          JSON.stringify({
            id: `session-capability-completion-${requests.length}`,
            object: "chat.completion",
            created: 1,
            model: "session-test-model",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: first ? null : "林澄继续照料药铺。",
                  ...(first
                    ? {
                        tool_calls: [
                          {
                            id: "forged-random-call",
                            type: "function",
                            function: {
                              name: "random",
                              arguments: JSON.stringify({
                                domain: {
                                  kind: "integer_range",
                                  min: 1,
                                  max: 6,
                                },
                                distribution: { kind: "uniform" },
                                count: 1,
                                replacement: true,
                              }),
                            },
                          },
                        ],
                      }
                    : {}),
                },
                finish_reason: first ? "tool_calls" : "stop",
              },
            ],
            usage: {
              prompt_tokens: 20,
              completion_tokens: 10,
              total_tokens: 30,
            },
          }),
          { headers: { "content-type": "application/json" } },
        );
      }),
    );

    const response = await built.app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/respond`,
      payload: {
        message: "请掷骰子并告诉我结果。",
        config: {
          enableDirector: false,
          enableVerifier: false,
          enableMemoryConsolidation: false,
        },
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.tools ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          function: expect.objectContaining({ name: "random" }),
        }),
        expect.objectContaining({
          function: expect.objectContaining({ name: "calculate" }),
        }),
      ]),
    );
    const executions = built.database.select().from(toolExecutionRecords).all();
    expect(executions).toEqual([]);
  });
});
