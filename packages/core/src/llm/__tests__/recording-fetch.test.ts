import { describe, expect, it, vi } from "vitest";
import type { ModelCallContext, ModelCallRecord } from "@tavern/shared";

import { createRecordingFetch } from "../recording-fetch.js";

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

describe("recorded provider transport", () => {
  it("waits for the actual adapted request to be saved before sending and saves the parsed result last", async () => {
    const saved: ModelCallRecord[] = [];
    const transport = createRecordingFetch(
      {
        context,
        streamSaveIntervalMs: 0,
        recorder: {
          async save(record) {
            saved.push(structuredClone(record));
          },
        },
      },
      "openai",
      "test",
      async (input, init) => {
        expect(saved.map((record) => record.status)).toEqual([
          "prepared",
          "in_flight",
        ]);
        expect(saved[0]?.requestBody).toBe(
          await new Request(input, init).text(),
        );
        return new Response('{"text":"hello"}');
      },
    );
    const response = await transport.fetch(
      "https://provider.test/v1/chat/completions?api_key=secret",
      {
        method: "POST",
        headers: { authorization: "Bearer secret" },
        body: '{"messages":[]}',
      },
    );
    await response.text();
    await transport.complete({
      text: "hello",
      reasoning: null,
      toolData: null,
      usage: null,
      finishReason: "stop",
    });
    expect(saved.at(-1)).toMatchObject({
      status: "succeeded",
      responseBody: '{"text":"hello"}',
      text: "hello",
      usage: null,
    });
    expect(JSON.stringify(saved)).not.toContain("secret");
  });

  it("sends nothing when prepared evidence cannot be saved", async () => {
    const network = vi.fn();
    const transport = createRecordingFetch(
      {
        context,
        streamSaveIntervalMs: 0,
        recorder: {
          async save() {
            throw new Error("database unavailable");
          },
        },
      },
      "openai",
      "test",
      network,
    );
    await expect(
      transport.fetch("https://provider.test/chat", {
        method: "POST",
        body: "{}",
      }),
    ).rejects.toMatchObject({
      code: "MODEL_CALL_SAVE_FAILED",
      stage: "prepared",
    });
    expect(network).not.toHaveBeenCalled();
    expect(transport.signal.aborted).toBe(true);
  });
  it("retains an HTTP failure alongside a failed evidence write", async () => {
    const transport = createRecordingFetch(
      {
        context,
        streamSaveIntervalMs: 0,
        recorder: {
          async save(record) {
            if (record.status === "failed")
              throw new Error("database unavailable");
          },
        },
      },
      "openai",
      "test",
      async () => new Response("busy", { status: 503 }),
    );
    const response = await transport.fetch("https://provider.test/chat", {
      method: "POST",
      body: "{}",
    });
    const error = await response.text().catch((error: unknown) => error);
    expect(error).toMatchObject({
      code: "MODEL_CALL_SAVE_FAILED",
      cause: {
        errors: [{ code: "HTTP_503" }, { message: "database unavailable" }],
      },
    });
  });

  it("passes a response with no body to the provider parser", async () => {
    const saved: ModelCallRecord[] = [];
    const transport = createRecordingFetch(
      {
        context,
        streamSaveIntervalMs: 0,
        recorder: {
          async save(record) {
            saved.push(record);
          },
        },
      },
      "openai",
      "test",
      async () => new Response(null, { status: 204 }),
    );
    const response = await transport.fetch("https://provider.test/chat", {
      method: "POST",
      body: "{}",
    });
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(saved.at(-1)).toMatchObject({
      httpStatus: 204,
      responseBody: "",
      status: "in_flight",
    });
  });
});

it("retains partial output and fails a provider response ending with finish_reason error", async () => {
  const saved: ModelCallRecord[] = [];
  const transport = createRecordingFetch(
    {
      context,
      streamSaveIntervalMs: 0,
      recorder: {
        async save(record) {
          saved.push(structuredClone(record));
        },
      },
    },
    "openai",
    "test",
    async () =>
      new Response(
        'data: {"error":{"code":502,"message":"upstream timed out"}}\n\n',
      ),
  );
  await (
    await transport.fetch("https://provider.test/chat", {
      method: "POST",
      body: "{}",
    })
  ).text();
  await expect(
    transport.complete({
      text: "partial",
      reasoning: null,
      toolData: null,
      usage: null,
      finishReason: "error",
    }),
  ).rejects.toMatchObject({ code: "MODEL_PROVIDER_RESPONSE_ERROR" });
  expect(saved.at(-1)).toMatchObject({
    status: "failed",
    text: "partial",
    finishReason: "error",
    error: { code: "MODEL_PROVIDER_RESPONSE_ERROR" },
  });
  expect(saved.at(-1)!.responseBody).toContain("upstream timed out");
});

it("retains provider result and both causes when finish error persistence fails", async () => {
  let failed: ModelCallRecord | undefined;
  const transport = createRecordingFetch(
    {
      context,
      streamSaveIntervalMs: 0,
      recorder: {
        async save(record) {
          if (record.status === "failed") {
            failed = structuredClone(record);
            throw new Error("database locked permanently");
          }
        },
      },
    },
    "openai",
    "test",
    async () => new Response("partial provider response"),
  );
  await (
    await transport.fetch("https://provider.test/chat", {
      method: "POST",
      body: "{}",
    })
  ).text();
  const result = {
    text: "partial",
    reasoning: "partial reasoning",
    toolData: null,
    usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
    finishReason: "error",
  };
  await expect(transport.complete(result)).rejects.toMatchObject({
    code: "MODEL_CALL_SAVE_FAILED",
    stage: "failed",
    cause: {
      errors: [
        expect.objectContaining({ code: "MODEL_PROVIDER_RESPONSE_ERROR" }),
        expect.objectContaining({ message: "database locked permanently" }),
      ],
    },
  });
  expect(failed).toMatchObject({ ...result, status: "failed" });
});

it.each([false, true])(
  "preserves a Request body and init overrides before network dispatch (override=%s)",
  async (override) => {
    const saved: ModelCallRecord[] = [];
    const controller = new AbortController();
    const original = new Request("https://provider.test/chat", {
      method: "POST",
      headers: { "content-type": "application/json", "x-route": "original" },
      body: JSON.stringify({ message: "original" }),
      signal: controller.signal,
    });
    const body = JSON.stringify({
      message: override ? "override" : "original",
    });
    const network = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const sent = new Request(input, init);
        expect(await sent.text()).toBe(body);
        expect(sent.headers.get("x-route")).toBe(
          override ? "override" : "original",
        );
        expect(saved[0]?.requestBody).toBe(body);
        controller.abort();
        expect(sent.signal.aborted).toBe(true);
        return new Response("ok");
      },
    );
    const transport = createRecordingFetch(
      {
        context,
        streamSaveIntervalMs: 0,
        recorder: {
          async save(record) {
            saved.push(structuredClone(record));
          },
        },
      },
      "openai",
      "test",
      network,
    );
    const response = await transport.fetch(
      original,
      override
        ? {
            headers: {
              "content-type": "application/json",
              "x-route": "override",
            },
            body,
          }
        : undefined,
    );
    expect(await response.text()).toBe("ok");
    expect(network).toHaveBeenCalledTimes(1);
  },
);
