import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  localSseProviderFixtureConfigSchema,
  localSseProviderFixtureFailureRequestSchema,
  localSseProviderFixtureOptionsSchema,
} from "./local-sse-provider-fixture.schema.mjs";

const maxBodyBytes = 1_048_576;

function json(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes)
      throw Object.assign(new Error("Request body too large"), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON"), {
      status: 400,
    });
  }
}

function delay(ms) {
  return ms > 0
    ? new Promise((resolve) => setTimeout(resolve, ms))
    : Promise.resolve();
}

function createCounters() {
  return {
    requests: 0,
    failedRequests: 0,
    successfulStreams: 0,
    activeStreams: 0,
    chunksSent: 0,
    failuresRemaining: 0,
  };
}

function sseChunk(modelId, content, finishReason = null) {
  return `data: ${JSON.stringify({
    id: "local-stream-fixture",
    object: "chat.completion.chunk",
    created: 1,
    model: modelId,
    choices: [
      {
        index: 0,
        delta: content === null ? {} : { content },
        finish_reason: finishReason,
      },
    ],
  })}\n\n`;
}

export function createLocalSseProviderFixture(options, { wait = delay } = {}) {
  const config = localSseProviderFixtureOptionsSchema.parse(options);
  const counters = createCounters();

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/health") {
      json(response, 200, { status: "ok", modelId: config.modelId });
      return;
    }
    if (request.method === "GET" && url.pathname === "/__fixture/stats") {
      json(response, 200, { ...counters });
      return;
    }
    if (request.method === "POST" && url.pathname === "/__fixture/reset") {
      if (counters.activeStreams > 0) {
        json(response, 409, { error: "Cannot reset while a stream is active" });
        return;
      }
      Object.assign(counters, createCounters());
      json(response, 200, { ...counters });
      return;
    }
    if (request.method === "POST" && url.pathname === "/__fixture/fail-next") {
      let body;
      try {
        body = await readJson(request);
      } catch (error) {
        json(response, error.status ?? 400, { error: error.message });
        return;
      }
      const parsedBody =
        localSseProviderFixtureFailureRequestSchema.safeParse(body);
      if (!parsedBody.success) {
        json(response, 400, { error: "count must be an integer from 1 to 10" });
        return;
      }
      const { count } = parsedBody.data;
      counters.failuresRemaining += count;
      json(response, 200, { failuresRemaining: counters.failuresRemaining });
      return;
    }
    if (request.method !== "POST" || url.pathname !== "/v1/chat/completions") {
      json(response, 404, { error: "fixture route not found" });
      return;
    }

    let body;
    try {
      body = await readJson(request);
    } catch (error) {
      json(response, error.status ?? 400, { error: error.message });
      return;
    }
    if (body?.model !== config.modelId || body?.stream !== true) {
      json(response, 400, {
        error: `expected model ${config.modelId} and stream=true`,
      });
      return;
    }

    counters.requests += 1;
    if (counters.failuresRemaining > 0) {
      counters.failuresRemaining -= 1;
      counters.failedRequests += 1;
      json(response, 503, {
        error: {
          message:
            "Local acceptance fixture failed this request by instruction.",
          type: "server_error",
          code: "fixture_transient_failure",
        },
      });
      return;
    }

    counters.activeStreams += 1;
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    });
    response.flushHeaders();
    try {
      await wait(config.firstChunkDelayMs);
      for (const [index, chunk] of config.chunks.entries()) {
        if (response.destroyed) return;
        response.write(sseChunk(config.modelId, chunk));
        counters.chunksSent += 1;
        if (index < config.chunks.length - 1) await wait(config.chunkDelayMs);
      }
      if (!response.destroyed) {
        response.write(sseChunk(config.modelId, null, "stop"));
        response.end("data: [DONE]\n\n");
        counters.successfulStreams += 1;
      }
    } finally {
      counters.activeStreams -= 1;
    }
  });

  return {
    server,
    async listen() {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(config.port, "127.0.0.1", resolve);
      });
      return server.address().port;
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

async function main() {
  const configPath = process.argv[2];
  if (!configPath)
    throw new Error(
      "Usage: node scripts/local-sse-provider-fixture.mjs <fixture-config.json>",
    );
  const config = localSseProviderFixtureConfigSchema.parse(
    JSON.parse(await readFile(configPath, "utf8")),
  );
  const fixture = createLocalSseProviderFixture(config);
  const port = await fixture.listen();
  console.log(
    JSON.stringify({
      url: `http://127.0.0.1:${port}`,
      modelId: config.modelId,
      firstChunkDelayMs: config.firstChunkDelayMs,
      chunkDelayMs: config.chunkDelayMs,
      statsUrl: `http://127.0.0.1:${port}/__fixture/stats`,
    }),
  );
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, async () => {
      await fixture.close();
      process.exit(0);
    });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
