import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createTavernClient } from "@tavern/sdk";
import { apiErrorMessages } from "@tavern/shared";
import { buildTestApp } from "./helpers/create-test-db.js";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../src/accounts/constants.js";
import { characters, characterVersions, sessions } from "../src/db/schema.js";
import { DisplaySnapshotService } from "../src/services/role-runtime/display-snapshot-service.js";
import { LlmProfileService } from "../src/services/llm-profile-service.js";
import { createRoleTransport } from "../../user-web/src/features/chat/transport.js";
import { createSessionHost } from "../../user-web/src/features/chat/session-controller.js";
import policy from "../../user-web/public/config/runtime-policy.json" with { type: "json" };

type FailureMode =
  | "narrator-once"
  | "state-agent-once"
  | "state-response-lost-once"
  | "none";
type Build = Awaited<ReturnType<typeof buildTestApp>>;
let built: Build | undefined;
let tempRoot: string | undefined;
afterEach(async () => {
  await built?.app.close();
  built = undefined;
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  tempRoot = undefined;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const roleName = "Role user integration fixture";
const versionId = "role-user-version";
const characterId = "role-user-character";
const roleSnapshot = {
  name: roleName,
  description: "A fixture role for the user web client integration.",
  primaryGreeting: "The north gate is closed.",
  extensions: {
    tavern_headless: {
      openings: {
        items: [
          {
            id: "opening",
            displayText: "The north gate is closed.",
            variables: { score: 0 },
          },
        ],
      },
      stateUpdate: {
        profile: {
          updaterPrompt: "Update the score when the reply provides evidence.",
          writablePaths: ["/score"],
          stateSchema: {
            type: "object",
            properties: { score: { type: "integer" } },
            required: ["score"],
            additionalProperties: false,
          },
          modelSlot: "narrator",
        },
        files: {},
      },
    },
  },
};

function extractStateSources(messages: Array<{ content?: unknown }>) {
  for (const message of messages) {
    if (typeof message.content !== "string") continue;
    const text = message.content;
    const keyStart = text.indexOf('"sources"');
    if (keyStart < 0) continue;
    const colon = text.indexOf(":", keyStart + '"sources"'.length);
    const arrayStart = colon < 0 ? -1 : text.indexOf("[", colon + 1);
    if (arrayStart < 0) continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = arrayStart; index < text.length; index++) {
      const character = text[index]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === "[") depth++;
      else if (character === "]") {
        depth--;
        if (depth === 0) {
          return JSON.parse(text.slice(arrayStart, index + 1)) as Array<{
            messageId: string;
            role: string;
            text: string;
          }>;
        }
      }
    }
  }
  throw new Error("State evidence was not found in the state prompt request");
}

function completion(text: string, finishReason = "stop") {
  return JSON.stringify({
    id: "fixture-response",
    object: "chat.completion",
    created: 1,
    model: "fixture-model",
    choices: [
      {
        index: 0,
        finish_reason: finishReason,
        message: { role: "assistant", content: text },
      },
    ],
  });
}

function streamedCompletion(text: string, finishReason = "stop") {
  const chunk = (delta: Record<string, unknown>, reason: string | null) =>
    `data: ${JSON.stringify({
      id: "fixture-stream",
      object: "chat.completion.chunk",
      created: 1,
      model: "fixture-model",
      choices: [{ index: 0, delta, finish_reason: reason }],
    })}\n\n`;
  return [
    chunk({ role: "assistant", content: text }, null),
    chunk({}, finishReason),
    "data: [DONE]\n\n",
  ].join("");
}

async function createFixture(mode: FailureMode) {
  tempRoot = await mkdtemp(join(tmpdir(), "role-user-client-"));
  vi.stubEnv("APP_SECRETS_MASTER_KEY", "role-user-client-fixture-master-key");
  let narratorCalls = 0;
  let stateAgentCalls = 0;
  let droppedStateResponse = false;
  const stateAgentSources: Array<Array<{ role: string; text: string }>> = [];
  const providerFetch: typeof fetch = async (input, init) => {
    const url = new URL(
      input instanceof Request
        ? input.url
        : typeof input === "string"
          ? input
          : input.toString(),
    );
    if (url.origin !== "http://role-user-fixture.invalid")
      throw new Error(`Unexpected provider origin: ${url.origin}`);
    const requestBody =
      typeof init?.body === "string"
        ? init.body
        : input instanceof Request
          ? await input.clone().text()
          : "{}";
    const request = JSON.parse(requestBody) as {
      messages?: Array<{ content?: unknown }>;
      stream?: boolean;
    };
    const isStateAgentRequest = request.messages?.some(
      (message) =>
        typeof message.content === "string" &&
        message.content.includes("你负责根据已经成功保存的剧情消息判断变量变化"),
    );
    if (isStateAgentRequest) {
      stateAgentCalls++;
      const sources = extractStateSources(request.messages ?? []);
      stateAgentSources.push(
        sources.map(({ role, text }) => ({ role, text })),
      );
      if (mode === "state-agent-once" && stateAgentCalls === 1)
        return new Response("fixture state agent unavailable", {
          status: 503,
          headers: { "content-type": "text/plain" },
        });
      const user = sources.find((item) => item.role === "user");
      const stateOutput = JSON.stringify({
        changes: [{ op: "set", path: "/score", value: 1 }],
        evidenceMessageIds: user ? [user.messageId] : [],
      });
      return new Response(completion(stateOutput), {
        headers: { "content-type": "application/json" },
      });
    }

    narratorCalls++;
    const failed = mode === "narrator-once" && narratorCalls === 1;
    if (request.stream) {
      return new Response(
        streamedCompletion(
          failed
            ? "This partial answer must stay hidden."
            : "The north gate opens.",
          failed ? "error" : "stop",
        ),
        {
          headers: { "content-type": "text/event-stream" },
        },
      );
    }
    return new Response(
      completion(
        failed
          ? "This partial answer must stay hidden."
          : "The north gate opens.",
        failed ? "error" : "stop",
      ),
      { headers: { "content-type": "application/json" } },
    );
  };
  vi.stubGlobal("fetch", providerFetch);
  const { loadStorageConfig } = await import("../src/storage-config.js");
  const storage = loadStorageConfig({ DATA_DIR: tempRoot });
  built = await buildTestApp({
    databasePath: storage.databasePath,
    storage,
    auth: { mode: "off" },
    logger: false,
    enableSseChat: true,
    llmProfileApiMode: "chat",
    orchestration: {
      providers: [
        {
          id: "role-user-fixture",
          type: "openai-compatible",
          apiMode: "chat",
          apiKey: "fixture-api-key",
        },
      ],
      defaultModel: {
        providerId: "role-user-fixture",
        modelId: "fixture-model",
      },
    },
  });
  const app = built.app;
  const database = built.database;
  const accountId = DEFAULT_ADMIN_ACCOUNT_ID;
  const statePresetData = JSON.parse(
    await readFile(
      new URL(
        "../../../.planning/native-card-maintenance/verbatim-state-assembly/presets/primary-state-update.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const importedStatePreset = await app.inject({
    method: "POST",
    url: "/import/preset",
    payload: {
      name: "Role user state update preset",
      data: statePresetData,
    },
  });
  expect(importedStatePreset.statusCode, importedStatePreset.body).toBe(201);
  const statePresetId = importedStatePreset.json().data.id as string;
  const statePresetVersions = await app.inject(
    `/presets/${statePresetId}/versions`,
  );
  expect(statePresetVersions.statusCode, statePresetVersions.body).toBe(200);
  const statePrompt = {
    presetId: statePresetId,
    presetVersionId: statePresetVersions.json().data[0].id as string,
    historyTurns: 5,
  };
  database
    .insert(characters)
    .values({
      id: characterId,
      accountId,
      name: roleName,
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
  database
    .insert(characterVersions)
    .values({
      id: versionId,
      characterId,
      versionNo: 1,
      dataJson: JSON.stringify(roleSnapshot),
      contentHash: "role-user-test-fixture",
      createdAt: 1,
    })
    .run();
  const files = [
    {
      name: "manifest.json",
      purpose: "manifest",
      mime: "application/json",
      content: JSON.stringify({
        apiVersion: 1,
        html: "view.html",
        css: "view.css",
        script: "main.js",
        assets: {},
        data: {},
      }),
    },
    {
      name: "view.html",
      purpose: "template",
      mime: "text/html",
      content: "<p>Role view</p>",
    },
    {
      name: "view.css",
      purpose: "template",
      mime: "text/css",
      content: "p { color: inherit; }",
    },
    {
      name: "main.js",
      purpose: "browser_script",
      mime: "text/javascript",
      content: "export {};",
    },
  ].map((file) => ({
    name: file.name,
    purpose: file.purpose,
    mime: file.mime,
    base64: Buffer.from(file.content).toString("base64"),
  }));
  const importedAssets = await app.inject({
    method: "POST",
    url: `/role-assets/${versionId}`,
    payload: { character_id: characterId, files },
  });
  expect(importedAssets.statusCode, importedAssets.body).toBe(201);

  const clientFetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const response = await app.inject({
      method: (init?.method ?? "GET") as "GET" | "POST" | "PATCH" | "DELETE",
      url: `${url.pathname}${url.search}`,
      headers,
      payload: init?.body as string | undefined,
    });
    if (
      mode === "state-response-lost-once" &&
      !droppedStateResponse &&
      init?.method === "POST" &&
      url.pathname.endsWith("/role-state/updates")
    ) {
      droppedStateResponse = true;
      throw new TypeError("Fixture dropped the committed role-state response");
    }
    return new Response(response.body, {
      status: response.statusCode,
      headers: response.headers as Record<string, string>,
    });
  };
  const client = createTavernClient({
    baseUrl: "http://tavern.local",
    fetchImpl: clientFetch,
  });
  const session = await client.sessions.create({
    title: "Role user retry fixture",
    characterId,
    characterVersionId: versionId,
    characterSnapshot: roleSnapshot,
    metadata: { opening_id: "opening", statePrompt },
  });
  expect(session).not.toBeNull();
  const sessionId = session!.id;
  const persistedSession = database
    .select()
    .from(sessions)
    .all()
    .find((item) => item.id === sessionId);
  expect(
    JSON.parse(persistedSession!.characterSnapshotJson!).extensions
      .tavern_headless.stateUpdate,
  ).toEqual(roleSnapshot.extensions.tavern_headless.stateUpdate);
  new DisplaySnapshotService(database).initialize(accountId, sessionId, {
    score: 0,
  });
  const profiles = new LlmProfileService(database);
  const profile = await profiles.createProfile(
    {
      presetName: "Role user deterministic provider",
      provider: "openai-compatible",
      modelId: "fixture-model",
      baseUrl: "http://role-user-fixture.invalid/v1",
      apiKey: "fixture-api-key",
    },
    accountId,
  );
  await profiles.activateProfile(
    "session",
    sessionId,
    profile.id,
    "narrator",
    { maxRetries: 0 },
    accountId,
  );
  const transport = createRoleTransport(client, sessionId);
  const roleSession = await transport.loadSession();
  const host = createSessionHost({
    session: roleSession,
    transport,
    policy,
    errors: apiErrorMessages,
  });
  return {
    app,
    database,
    client,
    host,
    sessionId,
    counts: () => ({ narratorCalls, stateAgentCalls }),
    stateAgentSources,
  };
}

it("renames a session title through the SDK and Fastify route", async () => {
  const fixture = await createFixture("none");
  const session = await fixture.client.sessions.create({ title: "Old title" });
  expect(session).not.toBeNull();
  const updated = await fixture.client.sessions.update({
    sessionId: session!.id,
    title: "New title",
  });
  expect(updated.title).toBe("New title");
  expect(
    (await fixture.client.sessions.getDetail({ sessionId: session!.id })).title,
  ).toBe("New title");
});

it("retries a failed reply with the retained input and publishes only its successful floor", async () => {
  const fixture = await createFixture("narrator-once");
  const input = "Please investigate the north gate.";
  await expect(fixture.host.send({ text: input })).rejects.toMatchObject({
    code: expect.any(String),
  });
  const viewAfterFailure = await fixture.client.roleRuntime.getView({
    sessionId: fixture.sessionId,
  });
  expect(
    (await fixture.client.roleRuntime.listSnapshots({
      sessionId: fixture.sessionId,
      branchId: "main",
    })).items.filter((snapshot) => snapshot.floorId !== null),
  ).toHaveLength(0);

  await fixture.host.retryPendingResponse();
  const view = await fixture.client.roleRuntime.getView({
    sessionId: fixture.sessionId,
  });
  const snapshots = (await fixture.client.roleRuntime.listSnapshots({
    sessionId: fixture.sessionId,
    branchId: "main",
  })).items.filter((snapshot) => snapshot.floorId !== null);
  expect(snapshots).toHaveLength(1);
  const messages = await fixture.client.roleRuntime.getMessages({
    sessionId: fixture.sessionId,
    branchId: "main",
    floorId: snapshots[0]!.floorId!,
  });
  expect(messages.filter((message) => message.role === "user")).toEqual([
    expect.objectContaining({ content: input }),
  ]);
  expect(messages.filter((message) => message.role === "assistant")).toEqual([
    expect.objectContaining({ content: "The north gate opens." }),
  ]);
  expect(
    messages.some((message) => message.content.includes("partial answer")),
  ).toBe(false);
  expect(fixture.counts()).toEqual({ narratorCalls: 2, stateAgentCalls: 1 });
  fixture.host.dispose();
});

it("retries only the variable agent against the already generated reply", async () => {
  const fixture = await createFixture("state-agent-once");
  const input = "Please investigate the north gate.";
  await expect(fixture.host.send({ text: input })).rejects.toMatchObject({
    code: "ROLE_STATE_UPDATE_FAILED",
  });
  const viewAfterStateFailure = await fixture.client.roleRuntime.getView({
    sessionId: fixture.sessionId,
  });
  expect(
    (await fixture.client.roleRuntime.listSnapshots({
      sessionId: fixture.sessionId,
      branchId: "main",
    })).items.filter((snapshot) => snapshot.floorId !== null),
  ).toHaveLength(0);
  expect(viewAfterStateFailure.processing.pendingStateFloorId).toBeTruthy();
  expect(fixture.counts()).toEqual({ narratorCalls: 1, stateAgentCalls: 1 });

  await fixture.host.retryPendingStateUpdate();
  const view = await fixture.client.roleRuntime.getView({
    sessionId: fixture.sessionId,
  });
  const snapshots = (await fixture.client.roleRuntime.listSnapshots({
    sessionId: fixture.sessionId,
    branchId: "main",
  })).items.filter((snapshot) => snapshot.floorId !== null);
  expect(snapshots).toHaveLength(1);
  const messages = await fixture.client.roleRuntime.getMessages({
    sessionId: fixture.sessionId,
    branchId: "main",
    floorId: snapshots[0]!.floorId!,
  });
  expect(messages.filter((message) => message.role === "user")).toHaveLength(1);
  expect(messages.filter((message) => message.role === "assistant")).toEqual([
    expect.objectContaining({ content: "The north gate opens." }),
  ]);
  expect(fixture.counts()).toEqual({ narratorCalls: 1, stateAgentCalls: 2 });
  expect(fixture.stateAgentSources).toEqual([
    [
      { role: "user", text: input },
      { role: "assistant", text: "The north gate opens." },
    ],
    [
      { role: "user", text: input },
      { role: "assistant", text: "The north gate opens." },
    ],
  ]);
  fixture.host.dispose();
});

it("clears pending input when state committed before its response was lost", async () => {
  const fixture = await createFixture("state-response-lost-once");
  const input = "Please investigate the north gate.";
  await expect(fixture.host.send({ text: input })).rejects.toMatchObject({
    code: "ROLE_STATE_UPDATE_FAILED",
  });

  const viewAfterLostResponse = await fixture.client.roleRuntime.getView({
    sessionId: fixture.sessionId,
  });
  const snapshotsAfterLostResponse = (await fixture.client.roleRuntime.listSnapshots({
    sessionId: fixture.sessionId,
    branchId: "main",
  })).items.filter((snapshot) => snapshot.floorId !== null);
  expect(snapshotsAfterLostResponse).toHaveLength(1);
  expect(viewAfterLostResponse.processing.pendingStateFloorId).toBeNull();
  expect(viewAfterLostResponse.current.floorId).toBe(
    snapshotsAfterLostResponse[0]!.floorId,
  );
  await expect(fixture.host.retryPendingStateUpdate()).rejects.toMatchObject({
    code: "STATE_RETRY_INVALID",
  });

  const firstFloorMessages = await fixture.client.roleRuntime.getMessages({
    sessionId: fixture.sessionId,
    branchId: "main",
    floorId: snapshotsAfterLostResponse[0]!.floorId!,
  });
  expect(
    firstFloorMessages.filter((message) => message.role === "user"),
  ).toEqual([expect.objectContaining({ content: input })]);
  expect(
    firstFloorMessages.filter((message) => message.role === "assistant"),
  ).toEqual([expect.objectContaining({ content: "The north gate opens." })]);

  await fixture.host.send({ text: "Continue after the connection returns." });
  const finalView = await fixture.client.roleRuntime.getView({
    sessionId: fixture.sessionId,
  });
  expect(
    (await fixture.client.roleRuntime.listSnapshots({
      sessionId: fixture.sessionId,
      branchId: "main",
    })).items.filter((snapshot) => snapshot.floorId !== null),
  ).toHaveLength(2);
  expect(fixture.counts()).toEqual({ narratorCalls: 2, stateAgentCalls: 2 });
  fixture.host.dispose();
});
