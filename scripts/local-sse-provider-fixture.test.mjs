import { afterEach, describe, expect, it } from "vitest";
import { createLocalSseProviderFixture } from "./local-sse-provider-fixture.mjs";
import {
  localSseProviderFixtureConfigSchema,
  localSseProviderFixtureOptionsSchema,
} from "./local-sse-provider-fixture.schema.mjs";

const modelId = "tavern-headless-local-stream-fixture";
let fixture;
let baseUrl;

async function startFixture(options = {}, runtimeOptions = {}) {
  fixture = createLocalSseProviderFixture(
    {
      port: 0,
      modelId,
      firstChunkDelayMs: 0,
      chunkDelayMs: 0,
      chunks: ["林岚收起登记册，", "走到窗边确认风已经停下。"],
      ...options,
    },
    runtimeOptions,
  );
  const port = await fixture.listen();
  baseUrl = `http://127.0.0.1:${port}`;
}

async function requestCompletion() {
  return fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: modelId, stream: true, messages: [] }),
  });
}

afterEach(async () => {
  await fixture?.close();
  fixture = undefined;
});

describe("local OpenAI-compatible stream fixture", () => {
  it("shares fixture shape while reserving port zero for ephemeral tests", () => {
    const options = {
      port: 0,
      modelId,
      chunks: ["第一段", "第二段"],
    };
    expect(
      localSseProviderFixtureOptionsSchema.safeParse(options).success,
    ).toBe(true);
    expect(localSseProviderFixtureConfigSchema.safeParse(options).success).toBe(
      false,
    );
  });

  it("returns delayed-stream-compatible SSE chunks and exposes counts", async () => {
    await startFixture();
    const response = await requestCompletion();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const text = await response.text();
    expect(text).toContain('"content":"林岚收起登记册，"');
    expect(text).toContain('"content":"走到窗边确认风已经停下。"');
    expect(text).toContain('"finish_reason":"stop"');
    expect(text).toContain("data: [DONE]");
    await expect(
      (await fetch(`${baseUrl}/__fixture/stats`)).json(),
    ).resolves.toMatchObject({
      requests: 1,
      failedRequests: 0,
      successfulStreams: 1,
      activeStreams: 0,
      chunksSent: 2,
    });
  });

  it("fails the requested number of calls once, then streams successfully", async () => {
    await startFixture();
    const armed = await fetch(`${baseUrl}/__fixture/fail-next`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ count: 1 }),
    });
    expect(armed.status).toBe(200);
    await expect((await requestCompletion()).json()).resolves.toMatchObject({
      error: { code: "fixture_transient_failure" },
    });
    const retry = await requestCompletion();
    expect(retry.status).toBe(200);
    await retry.text();
    await expect(
      (await fetch(`${baseUrl}/__fixture/stats`)).json(),
    ).resolves.toMatchObject({
      requests: 2,
      failedRequests: 1,
      successfulStreams: 1,
      failuresRemaining: 0,
    });
  });

  it("rejects invalid model and non-stream requests without counting them", async () => {
    await startFixture();
    for (const body of [
      { model: "another-model", stream: true, messages: [] },
      { model: modelId, stream: false, messages: [] },
    ]) {
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
    }
    expect(
      (
        await fetch(`${baseUrl}/__fixture/stats`).then((response) =>
          response.json(),
        )
      ).requests,
    ).toBe(0);
  });

  it("validates failure controls and resets observable counters", async () => {
    await startFixture();
    const invalid = await fetch(`${baseUrl}/__fixture/fail-next`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ count: 11 }),
    });
    expect(invalid.status).toBe(400);
    await (await requestCompletion()).text();
    const reset = await fetch(`${baseUrl}/__fixture/reset`, { method: "POST" });
    expect(reset.status).toBe(200);
    await expect(
      (await fetch(`${baseUrl}/__fixture/stats`)).json(),
    ).resolves.toMatchObject({
      requests: 0,
      failedRequests: 0,
      successfulStreams: 0,
      chunksSent: 0,
      failuresRemaining: 0,
    });
  });

  it("does not reset counters while a stream is active", async () => {
    let releaseFirstChunk;
    let signalDelayStarted;
    const delayStarted = new Promise((resolve) => {
      signalDelayStarted = resolve;
    });
    const wait = (ms) =>
      ms === 0
        ? Promise.resolve()
        : new Promise((resolve) => {
            releaseFirstChunk = resolve;
            signalDelayStarted();
          });

    await startFixture({ firstChunkDelayMs: 25 }, { wait });
    const response = await requestCompletion();
    await delayStarted;
    try {
      const reset = await fetch(`${baseUrl}/__fixture/reset`, {
        method: "POST",
      });
      expect(reset.status).toBe(409);
    } finally {
      releaseFirstChunk();
    }
    await response.text();
    await expect(
      (await fetch(`${baseUrl}/__fixture/stats`)).json(),
    ).resolves.toMatchObject({
      requests: 1,
      successfulStreams: 1,
      activeStreams: 0,
      chunksSent: 2,
    });
  });

  it("returns a 404 for paths outside the fixture contract", async () => {
    await startFixture();
    const response = await fetch(`${baseUrl}/v1/models`);
    expect(response.status).toBe(404);
  });
});
