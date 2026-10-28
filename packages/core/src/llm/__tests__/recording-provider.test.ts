import { describe, expect, it, vi } from "vitest";
import { jsonSchema } from "ai";
import type { ModelCallContext, ModelCallRecord } from "@tavern/shared";

import { LLMService } from "../llm-service.js";
import { ProviderRegistry } from "../provider-registry.js";
import { findModelCallPersistenceError } from "../model-call-recorder.js";

const context: ModelCallContext = {
  accountId: "account",
  sessionId: "session",
  branchId: "main",
  floorId: "floor",
  runId: "run",
  attemptNo: 1,
  stepIndex: 0,
  slot: "narrator",
  purpose: "narration",
  releaseId: null,
  draftRevision: null,
  resourceVersions: {},
  inputPageId: null,
  inputMessageId: null,
};
const completion = (content = "hello") =>
  new Response(
    JSON.stringify({
      id: "response-1",
      object: "chat.completion",
      created: 1,
      model: "test",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content },
          finish_reason: "stop",
        },
      ],
    }),
    { headers: { "content-type": "application/json" } },
  );

function streamResponse() {
  const chunk = (
    delta: Record<string, unknown>,
    finish_reason: string | null,
  ) =>
    `data: ${JSON.stringify({
      id: "stream-1",
      object: "chat.completion.chunk",
      created: 1,
      model: "test",
      choices: [{ index: 0, delta, finish_reason }],
    })}\n\n`;
  return new Response(
    chunk({ role: "assistant", content: "hel" }, null) +
      chunk({ content: "lo" }, null) +
      chunk({}, "stop") +
      "data: [DONE]\n\n",
    { headers: { "content-type": "text/event-stream" } },
  );
}

function setup(
  network: typeof fetch,
  save: (record: ModelCallRecord) => Promise<void>,
) {
  const registry = new ProviderRegistry();
  registry.register({
    id: "provider",
    type: "openai-compatible",
    apiMode: "chat",
    apiKey: "secret",
    options: { fetch: network },
  });
  return new LLMService(
    registry,
    { providerId: "provider", modelId: "test" },
    () => ({ context, recorder: { save }, streamSaveIntervalMs: 0 }),
  );
}

describe("AI SDK recording integration", () => {
  it("records the adapted business body and the actual successful SDK result", async () => {
    const saved: ModelCallRecord[] = [];
    const network = vi.fn(async () => completion());
    const service = setup(network, async (record) => {
      saved.push(record);
    });
    const result = await service.generate({
      messages: [{ role: "user", content: "hello" }],
      params: {},
    });
    expect(result.text).toBe("hello");
    expect(saved.at(-1)).toMatchObject({
      status: "succeeded",
      text: "hello",
      usage: { inputTokens: null, outputTokens: null },
    });
    expect(JSON.parse(saved[0]!.requestBody)).toMatchObject({
      model: "test",
      messages: [{ role: "user", content: "hello" }],
    });
    expect(JSON.stringify(saved)).not.toContain("secret");
    expect(network).toHaveBeenCalledTimes(1);
  });

  it.each(["prepared", "in_flight", "succeeded"])(
    "propagates %s persistence failure through the SDK without repeating provider requests",
    async (stage) => {
      const network = vi.fn(async () => completion());
      const service = setup(network, async (record) => {
        if (record.status === stage) throw new Error("database unavailable");
      });
      const error = await service
        .generate({
          messages: [{ role: "user", content: "hello" }],
          params: { maxRetries: 2 },
        })
        .catch((error: unknown) => error);
      expect(findModelCallPersistenceError(error)).toMatchObject({ stage });
      expect(network).toHaveBeenCalledTimes(stage === "succeeded" ? 1 : 0);
    },
  );

  it("assigns separate requests to provider retries under the same invocation", async () => {
    const saved: ModelCallRecord[] = [];
    let sends = 0;
    const service = setup(
      async () =>
        ++sends === 1
          ? new Response('{"error":{"message":"busy"}}', {
              status: 503,
              headers: { "retry-after": "0.001" },
            })
          : completion(),
      async (record) => {
        saved.push(record);
      },
    );
    await service.generate({
      messages: [{ role: "user", content: "hello" }],
      params: { maxRetries: 1 },
    });
    const requests = saved.filter((record) => record.status === "prepared");
    expect(requests.map((record) => record.requestAttemptNo)).toEqual([1, 2]);
    expect(requests[0]!.callId).not.toBe(requests[1]!.callId);
    expect(requests[0]!.invocationId).toBe(requests[1]!.invocationId);
    expect(
      saved.some(
        (record) => record.status === "failed" && record.httpStatus === 503,
      ),
    ).toBe(true);
  });

  it("executes the configured number of tool steps and records each step separately", async () => {
    const saved: ModelCallRecord[] = [];
    let sends = 0;
    const service = setup(
      async () => {
        if (++sends > 1) return completion("done");
        return new Response(
          JSON.stringify({
            id: "tool-response",
            object: "chat.completion",
            created: 1,
            model: "test",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "tool-1",
                      type: "function",
                      function: { name: "lookup", arguments: "{}" },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
          }),
          { headers: { "content-type": "application/json" } },
        );
      },
      async (record) => {
        saved.push(record);
      },
    );
    const result = await service.generate({
      messages: [{ role: "user", content: "lookup" }],
      params: {},
      maxSteps: 2,
      tools: {
        lookup: {
          description: "Lookup",
          inputSchema: jsonSchema({ type: "object", properties: {} }),
          execute: async () => ({ value: 1 }),
        },
      },
    });
    expect(result.text).toBe("done");
    expect(sends).toBe(2);
    const calls = saved.filter((record) => record.status === "succeeded");
    expect(calls.map((record) => record.stepIndex)).toEqual([0, 1]);
    expect(calls[0]!.invocationId).not.toBe(calls[1]!.invocationId);
  });

  it("saves the complete stream and parsed text before returning success", async () => {
    const saved: ModelCallRecord[] = [];
    const service = setup(
      async () => streamResponse(),
      async (record) => {
        saved.push(record);
      },
    );
    const chunks: string[] = [];
    const result = await service.stream(
      { messages: [{ role: "user", content: "hello" }], params: {} },
      { onChunk: (text) => chunks.push(text) },
    );
    expect(result.text).toBe("hello");
    expect(chunks.join("")).toBe("hello");
    expect(saved.at(-1)).toMatchObject({
      status: "succeeded",
      text: "hello",
      usage: { inputTokens: null, outputTokens: null },
    });
    expect(saved.at(-1)!.responseBody).toContain("[DONE]");
  });

  it("rejects a streamed result when its completion cannot be persisted", async () => {
    const network = vi.fn(async () => streamResponse());
    const service = setup(network, async (record) => {
      if (record.status === "succeeded")
        throw new Error("database unavailable");
    });
    const error = await service
      .stream(
        {
          messages: [{ role: "user", content: "hello" }],
          params: { maxRetries: 2 },
        },
        {},
      )
      .catch((error: unknown) => error);
    expect(findModelCallPersistenceError(error)).toMatchObject({
      stage: "succeeded",
    });
    expect(network).toHaveBeenCalledTimes(1);
  });

  it("keeps concurrent sessions in separate request contexts", async () => {
    const saved: ModelCallRecord[] = [];
    const service = setup(
      async () => completion(),
      async () => {},
    );
    await Promise.all(
      ["one", "two"].map((sessionId) =>
        service.generate({
          messages: [{ role: "user", content: sessionId }],
          params: {},
          recording: {
            context: { ...context, sessionId },
            streamSaveIntervalMs: 0,
            recorder: {
              async save(record) {
                saved.push(record);
              },
            },
          },
        }),
      ),
    );
    const requests = saved.filter((record) => record.status === "prepared");
    expect(requests).toHaveLength(2);
    for (const request of requests)
      expect(JSON.parse(request.requestBody).messages[0].content).toBe(
        request.sessionId,
      );
    expect(new Set(requests.map((record) => record.invocationId)).size).toBe(2);
  });
  it("preserves partial raw bytes when a provider stream fails during reading", async () => {
    const saved: ModelCallRecord[] = [];
    const service = setup(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("data: partial\n\n"));
            },
            pull(controller) {
              controller.error(new Error("connection lost"));
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        ),
      async (record) => {
        saved.push(record);
      },
    );
    await expect(
      service.stream(
        {
          messages: [{ role: "user", content: "hello" }],
          params: { maxRetries: 0 },
        },
        {},
      ),
    ).rejects.toThrow();
    expect(saved.at(-1)).toMatchObject({
      status: "failed",
      responseBody: "data: partial\n\n",
    });
  });

  it("records an aborted provider request without inventing a successful response", async () => {
    const saved: ModelCallRecord[] = [];
    const controller = new AbortController();
    const service = setup(
      async (_input, init) => {
        controller.abort();
        throw init?.signal?.reason ?? new Error("cancelled");
      },
      async (record) => {
        saved.push(record);
      },
    );
    await expect(
      service.generate({
        messages: [{ role: "user", content: "hello" }],
        params: { maxRetries: 0 },
        abortSignal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(saved.at(-1)).toMatchObject({
      status: "interrupted",
      usage: null,
      responseBody: null,
    });
  });
});
