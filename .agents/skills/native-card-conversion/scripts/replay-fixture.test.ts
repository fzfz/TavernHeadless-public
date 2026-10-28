import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, streamText } from "ai";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseReplayFixtureConfig,
  startReplayFixture,
  type ReplayFixtureConfig,
  type RunningReplayFixture,
} from "./replay-fixture.js";

const evidenceDirectories: string[] = [];
const runningFixtures: RunningReplayFixture[] = [];

afterEach(async () => {
  await Promise.all(
    runningFixtures.splice(0).map((fixture) => fixture.close()),
  );
  await Promise.all(
    evidenceDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("offline OpenAI-compatible replay fixture", () => {
  it("serves narrator, state-updater, planned-failure, and recovery responses in order", async () => {
    const example: ReplayFixtureConfig = {
      host: "127.0.0.1",
      port: 0,
      steps: [
        {
          purpose: "narrator",
          model: "native-page-offline",
          text: "陈舟把伞靠在楼道门边。林岚指向一楼，建议先检查那里。",
        },
        {
          purpose: "state_updater",
          model: "native-page-offline",
          agentOutput: {
            changes: [
              { op: "set", path: "/relationship/trust", value: 64 },
              { op: "remove", path: "/pendingEvent" },
            ],
            evidenceMessageIds: ["$sourceMessageId[0]"],
          },
        },
        {
          purpose: "state_updater",
          model: "native-page-offline",
          failure: {
            statusCode: 422,
            type: "invalid_request_error",
            code: "planned_offline_failure",
            message: "本轮模拟状态更新失败，请重新提交更新请求。",
          },
        },
        {
          purpose: "state_updater",
          model: "native-page-offline",
          agentOutput: {
            changes: [{ op: "set", path: "/relationship/trust", value: 65 }],
            evidenceMessageIds: ["$sourceMessageId[0]"],
          },
        },
      ],
    };
    const fixture = await startFixture({ ...example, port: 0 });

    const narrator = await send(fixture, {
      model: "native-page-offline",
      stream: true,
      messages: [{ role: "user", content: "陈舟问林岚先检查哪间房。" }],
    });
    expect(narrator.response.status).toBe(200);
    expect(narrator.response.headers.get("content-type")).toContain(
      "text/event-stream",
    );
    const streamBody = await narrator.response.text();
    expect(streamBody).toContain('"object":"chat.completion.chunk"');
    expect(streamBody).toContain("陈舟把伞靠在楼道门边");
    expect(streamBody).toContain("data: [DONE]");

    const updaterRequest = {
      model: "native-page-offline",
      stream: false,
      messages: [
        {
          role: "system",
          content:
            "按正式 state_updater schema 返回 changes 与 evidenceMessageIds。",
        },
        {
          role: "system",
          content: makeStateUpdaterPrompt(
            makeStateEvidence([
              {
                messageId: "saved-source-message-42",
                revision: 1,
                role: "user",
                text: "陈舟询问检查顺序。",
              },
            ]),
          ),
        },
        { role: "user", content: "继续按已组装的状态证据返回更新。" },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "state_update",
          strict: true,
          schema: { type: "object" },
        },
      },
    };
    const firstUpdate = await send(fixture, updaterRequest);
    expect(firstUpdate.response.status).toBe(200);
    const firstCompletion =
      (await firstUpdate.response.json()) as OpenAICompletion;
    expect(firstCompletion.object).toBe("chat.completion");
    expect(firstCompletion.choices[0]?.message.content).toBe(
      JSON.stringify({
        changes: [
          { op: "set", path: "/relationship/trust", value: 64 },
          { op: "remove", path: "/pendingEvent" },
        ],
        evidenceMessageIds: ["saved-source-message-42"],
      }),
    );

    const failedUpdate = await send(fixture, updaterRequest);
    expect(failedUpdate.response.status).toBe(422);
    expect(await failedUpdate.response.json()).toMatchObject({
      error: { code: "planned_offline_failure", type: "invalid_request_error" },
    });

    const recoveredUpdate = await send(fixture, {
      ...updaterRequest,
      messages: [
        ...updaterRequest.messages.slice(0, 1),
        {
          role: "system",
          content: makeStateUpdaterPrompt(
            makeStateEvidence([
              {
                messageId: "saved-source-message-43",
                revision: 1,
                role: "assistant",
                text: "陈舟确认先检查一楼。",
              },
            ]),
          ),
        },
        { role: "user", content: "请使用本轮正式证据完成状态更新。" },
      ],
    });
    expect(recoveredUpdate.response.status).toBe(200);
    const recoveredCompletion =
      (await recoveredUpdate.response.json()) as OpenAICompletion;
    expect(JSON.parse(recoveredCompletion.choices[0]!.message.content)).toEqual(
      {
        changes: [{ op: "set", path: "/relationship/trust", value: 65 }],
        evidenceMessageIds: ["saved-source-message-43"],
      },
    );

    const exhausted = await send(fixture, updaterRequest);
    expect(exhausted.response.status).toBe(409);
    expect(await exhausted.response.json()).toMatchObject({
      error: { code: "fixture_sequence_exhausted" },
    });

    const summary = fixture.snapshot();
    expect(summary).toMatchObject({
      host: "127.0.0.1",
      callCount: 5,
      stepsConsumed: 4,
      jsonResponses: 2,
      streamedResponses: 1,
      plannedFailures: 1,
      unexpectedCalls: 1,
      allStepsConsumed: true,
    });
    expect(summary.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "planned_offline_failure",
          statusCode: 422,
        }),
        expect.objectContaining({
          code: "fixture_sequence_exhausted",
          statusCode: 409,
        }),
      ]),
    );

    const records = (
      await readFile(
        join(fixtureEvidenceDirectory(fixture), "requests.jsonl"),
        "utf8",
      )
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(records).toHaveLength(5);
    expect(records[0]).toMatchObject({
      callNumber: 1,
      configuredPurpose: "narrator",
      outcome: "stream_success",
    });
    expect(records[1]).toMatchObject({
      callNumber: 2,
      configuredPurpose: "state_updater",
      outcome: "json_success",
    });
    expect(records[1]?.requestBody).toEqual(updaterRequest);
    expect(records[1]?.responseBody).toEqual(firstCompletion);
    expect(records[2]).toMatchObject({
      callNumber: 3,
      outcome: "planned_failure",
      responseStatus: 422,
    });
    expect(records[3]).toMatchObject({
      callNumber: 4,
      outcome: "json_success",
    });
    expect(records[4]).toMatchObject({
      callNumber: 5,
      outcome: "unexpected_call",
    });
    expect(JSON.stringify(records)).not.toContain("Bearer offline-test-secret");
  });

  it("consumes calls in arrival order, records a model mismatch, and does not reassign the missed step", async () => {
    const fixture = await startFixture({
      host: "127.0.0.1",
      port: 0,
      steps: [
        {
          purpose: "narrator",
          model: "expected-first",
          text: "第一条预设正文。",
        },
        {
          purpose: "narrator",
          model: "expected-second",
          text: "第二条预设正文。",
        },
      ],
    });

    const mismatch = await send(fixture, {
      model: "wrong-first",
      messages: [],
    });
    expect(mismatch.response.status).toBe(409);
    expect(await mismatch.response.json()).toMatchObject({
      error: { code: "fixture_model_mismatch" },
    });

    const next = await send(fixture, {
      model: "expected-second",
      messages: [],
    });
    expect(next.response.status).toBe(200);
    const completion = (await next.response.json()) as OpenAICompletion;
    expect(completion.choices[0]?.message.content).toBe("第二条预设正文。");
    expect(fixture.snapshot()).toMatchObject({
      callCount: 2,
      stepsConsumed: 2,
      modelMismatches: 1,
    });
  });

  it("works through the repository OpenAI-compatible client for JSON and streamed completions", async () => {
    const fixture = await startFixture({
      host: "127.0.0.1",
      port: 0,
      steps: [
        {
          purpose: "narrator",
          model: "story-model",
          text: "陈舟抬手示意林岚留意门边的水迹。",
        },
        {
          purpose: "narrator",
          model: "story-model",
          text: "林岚点头，并把检查顺序记在便签上。",
        },
      ],
    });
    const openai = createOpenAI({
      apiKey: "offline-test-secret",
      baseURL: fixture.baseUrl,
    });
    const model = openai.chat("story-model");

    const generated = await generateText({
      model,
      prompt: "继续描述陈舟与林岚检查旧楼的普通场景。",
    });
    expect(generated.text).toBe("陈舟抬手示意林岚留意门边的水迹。");

    const streamed = streamText({
      model,
      prompt: "继续描述林岚如何回应。",
    });
    expect(await streamed.text).toBe("林岚点头，并把检查顺序记在便签上。");
    expect(fixture.snapshot()).toMatchObject({
      callCount: 2,
      jsonResponses: 1,
      streamedResponses: 1,
    });
  });

  it("records malformed JSON exactly and consumes that request position", async () => {
    const fixture = await startFixture({
      host: "127.0.0.1",
      port: 0,
      steps: [
        {
          purpose: "narrator",
          model: "model-a",
          text: "此位置被无效请求消耗。",
        },
        {
          purpose: "narrator",
          model: "model-b",
          text: "第二位置仍按原调用序号执行。",
        },
      ],
    });

    const invalid = await fetch(`${fixture.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ invalid json",
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({
      error: { code: "fixture_request_body_unreadable" },
    });

    const next = await send(fixture, { model: "model-b", messages: [] });
    expect(next.response.status).toBe(200);
    const completion = (await next.response.json()) as OpenAICompletion;
    expect(completion.choices[0]?.message.content).toBe(
      "第二位置仍按原调用序号执行。",
    );

    const records = (
      await readFile(
        join(fixtureEvidenceDirectory(fixture), "requests.jsonl"),
        "utf8",
      )
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(records[0]).toMatchObject({
      callNumber: 1,
      requestBodyText: "{ invalid json",
      outcome: "request_error",
    });
    expect(records[1]).toMatchObject({
      callNumber: 2,
      outcome: "json_success",
    });
    expect(fixture.snapshot()).toMatchObject({
      callCount: 2,
      requestErrors: 1,
    });
  });

  it("records unsupported routes, media types, non-object bodies, missing models, and health checks", async () => {
    const fixture = await startFixture({
      host: "127.0.0.1",
      port: 0,
      steps: [
        { purpose: "narrator", model: "unused-model", text: "预设响应。" },
      ],
    });

    const wrongRoute = await fetch(`${fixture.baseUrl}/unsupported`, {
      method: "GET",
    });
    expect(wrongRoute.status).toBe(404);

    const wrongMediaType = await fetch(`${fixture.baseUrl}/chat/completions`, {
      method: "POST",
      body: '{"model":"unused-model"}',
    });
    expect(wrongMediaType.status).toBe(415);

    const nonObject = await fetch(`${fixture.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "[]",
    });
    expect(nonObject.status).toBe(400);

    const missingModel = await fetch(`${fixture.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [] }),
    });
    expect(missingModel.status).toBe(400);

    const health = await fetch(`http://${fixture.host}:${fixture.port}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({
      status: "ready",
      host: "127.0.0.1",
    });

    expect(fixture.snapshot()).toMatchObject({
      requestCount: 5,
      callCount: 3,
      stepsConsumed: 1,
      requestErrors: 4,
      unexpectedCalls: 2,
    });
  });

  it("rejects invalid or non-loopback configuration before opening a socket", async () => {
    const valid = {
      host: "127.0.0.1",
      port: 0,
      steps: [
        {
          purpose: "state_updater",
          model: "m",
          agentOutput: {
            changes: [{ op: "remove", path: "/obsolete" }],
            evidenceMessageIds: ["$sourceMessageId[0]"],
          },
        },
      ],
    };
    expect(parseReplayFixtureConfig(valid)).toEqual(valid);
    expect(() =>
      parseReplayFixtureConfig({ ...valid, host: "0.0.0.0" }),
    ).toThrow(/invalid/i);
    expect(() => parseReplayFixtureConfig({ ...valid, port: 65536 })).toThrow(
      /invalid/i,
    );
    expect(() =>
      parseReplayFixtureConfig({
        ...valid,
        steps: [
          {
            purpose: "state_updater",
            model: "m",
            agentOutput: {
              changes: [{ op: "patch", path: "/x", value: 1 }],
              evidenceMessageIds: ["id"],
            },
          },
        ],
      }),
    ).toThrow(/invalid/i);
    expect(() =>
      parseReplayFixtureConfig({ ...valid, unexpected: true }),
    ).toThrow(/invalid/i);
  });

  it("returns and records a deterministic error when an evidence token has no source message", async () => {
    const fixture = await startFixture({
      host: "127.0.0.1",
      port: 0,
      steps: [
        {
          purpose: "state_updater",
          model: "state-model",
          agentOutput: {
            changes: [],
            evidenceMessageIds: ["$sourceMessageId[1]"],
          },
        },
      ],
    });

    const missing = await send(fixture, {
      model: "state-model",
      messages: [
        {
          role: "system",
          content: makeStateUpdaterPrompt(
            makeStateEvidence([
              {
                messageId: "only-source",
                revision: 1,
                role: "user",
                text: "唯一来源消息。",
              },
            ]),
          ),
        },
        { role: "user", content: "使用上一条系统消息中的 stateEvidence。" },
      ],
    });
    expect(missing.response.status).toBe(422);
    expect(await missing.response.json()).toMatchObject({
      error: { code: "fixture_response_resolution_failed" },
    });
    expect(fixture.snapshot()).toMatchObject({
      callCount: 1,
      stepsConsumed: 1,
      requestErrors: 1,
    });
  });

  it.each([
    {
      name: "without a structured stateEvidence object",
      contents: [
        makeStateUpdaterPrompt({
          sources: [{ messageId: "legacy-source" }],
        }),
      ],
      message: "no structured stateEvidence object",
    },
    {
      name: "with multiple stateEvidence objects in one message",
      contents: [
        makeStateUpdaterPrompt(makeStateEvidence([]), makeStateEvidence([])),
      ],
      message: "multiple stateEvidence objects",
    },
    {
      name: "with a non-object sourceIdentity",
      contents: [makeStateUpdaterPrompt({ sources: [], sourceIdentity: [] })],
      message: "sourceIdentity field is not an object",
    },
    {
      name: "with a non-array sources field",
      contents: [makeStateUpdaterPrompt({ sources: {}, sourceIdentity: {} })],
      message: "sources field is not an array",
    },
    {
      name: "with a non-object sources entry",
      contents: [
        makeStateUpdaterPrompt({ sources: ["invalid"], sourceIdentity: {} }),
      ],
      message: "sources array contains a non-object item",
    },
  ])(
    "returns a deterministic parser error $name",
    async ({ contents, message }) => {
      const fixture = await startFixture({
        host: "127.0.0.1",
        port: 0,
        steps: [
          {
            purpose: "state_updater",
            model: "state-model",
            agentOutput: {
              changes: [],
              evidenceMessageIds: ["$sourceMessageId[0]"],
            },
          },
        ],
      });
      const invalid = await send(fixture, {
        model: "state-model",
        messages: contents.map((content, index) => ({
          role: index === 0 ? "system" : "user",
          content,
        })),
      });

      expect(invalid.response.status).toBe(422);
      expect(await invalid.response.json()).toMatchObject({
        error: {
          code: "fixture_response_resolution_failed",
          message: expect.stringContaining(message),
        },
      });
      expect(fixture.snapshot()).toMatchObject({
        callCount: 1,
        stepsConsumed: 1,
        requestErrors: 1,
      });
    },
  );
});

async function startFixture(config: unknown): Promise<RunningReplayFixture> {
  const evidenceDirectory = await mkdtemp(
    join(tmpdir(), "native-card-replay-"),
  );
  evidenceDirectories.push(evidenceDirectory);
  const fixture = await startReplayFixture(config, evidenceDirectory);
  runningFixtures.push(fixture);
  return fixture;
}

function fixtureEvidenceDirectory(fixture: RunningReplayFixture): string {
  return fixture.evidenceDirectory;
}

async function send(fixture: RunningReplayFixture, body: unknown) {
  const response = await fetch(`${fixture.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer offline-test-secret",
    },
    body: JSON.stringify(body),
  });
  return { response };
}

type OpenAICompletion = {
  object: string;
  choices: Array<{ message: { content: string } }>;
};

type ReplayEvidenceSource = {
  messageId: string;
  revision: number;
  role: string;
  text: string;
};

function makeStateEvidence(sources: ReplayEvidenceSource[]) {
  const assistantSource = [...sources]
    .reverse()
    .find((source) => source.role === "assistant");
  return {
    sources,
    sourceIdentity: {
      floorId: "floor-42",
      branchId: "main",
      runId: null,
      attemptNo: null,
      floorRunId: "floor-run-42",
      floorAttemptNo: 1,
      outputPageId: assistantSource ? "page-assistant-42" : null,
      assistantMessageId: assistantSource?.messageId ?? null,
      messages: sources.map((source, index) => ({
        messageId: source.messageId,
        pageId: `page-${index + 1}`,
        revision: source.revision,
        seq: index + 1,
        role: source.role,
      })),
    },
    toolEvidence: [],
    worldbookSelection: null,
    priorFacts: [],
    consumedSources: [],
    agentResults: [],
  };
}

function makeStateUpdaterPrompt(...jsonBlocks: unknown[]): string {
  return [
    "根据已经成功保存的剧情消息判断变量变化。",
    JSON.stringify({ stateSchema: { type: "object" } }),
    JSON.stringify({ before: { trust: 20 } }),
    "[]",
    ...jsonBlocks.map((block) => JSON.stringify(block)),
    "依据提供的来源完成状态更新。",
  ].join("\n\n");
}
