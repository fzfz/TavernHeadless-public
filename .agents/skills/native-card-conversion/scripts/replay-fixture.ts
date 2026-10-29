import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import Ajv from "ajv/dist/2020.js";
import { createCallDirectory, getCallDirectory } from "./output.ts";
import { runForegroundService } from "./foreground-service.ts";

type ReplayPurpose = "narrator" | "state_updater";
type AgentChange =
  | { op: "set"; path: string; value: unknown }
  | { op: "remove"; path: string };
type AgentOutput = {
  changes: AgentChange[];
  evidenceMessageIds: string[];
  facts?: Record<string, unknown>;
};
type ReplayFailure = {
  statusCode: number;
  type: string;
  code: string;
  message: string;
};
type ReplayStep =
  | { purpose: "narrator"; model: string; text: string }
  | { purpose: "state_updater"; model: string; agentOutput: AgentOutput }
  | { purpose: ReplayPurpose; model: string; failure: ReplayFailure };
export type ReplayFixtureConfig = {
  host: "127.0.0.1";
  port: number;
  steps: ReplayStep[];
};

type ErrorRecord = {
  callNumber: number | null;
  statusCode: number;
  code: string;
  message: string;
};

type FixtureCounters = {
  requestCount: number;
  callCount: number;
  stepsConsumed: number;
  jsonResponses: number;
  streamedResponses: number;
  plannedFailures: number;
  requestErrors: number;
  modelMismatches: number;
  unexpectedCalls: number;
  errors: ErrorRecord[];
};

type RequestBody = {
  rawText: string;
  json: unknown;
};

const fixtureSchema = JSON.parse(
  await readFile(
    new URL("./replay-fixture.schema.json", import.meta.url),
    "utf8",
  ),
) as Record<string, unknown>;
const validateConfig = new Ajv({ allErrors: true, strict: true }).compile(
  fixtureSchema,
);

export function parseReplayFixtureConfig(value: unknown): ReplayFixtureConfig {
  if (!validateConfig(value)) {
    throw new Error(
      `Replay fixture configuration is invalid: ${JSON.stringify(validateConfig.errors)}`,
    );
  }
  if (!isRecord(value) || value.host !== "127.0.0.1") {
    throw new Error("Replay fixture host must be 127.0.0.1.");
  }
  return value as ReplayFixtureConfig;
}

export async function readReplayFixtureConfig(
  path: string,
): Promise<ReplayFixtureConfig> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  return parseReplayFixtureConfig(parsed);
}

export type RunningReplayFixture = {
  evidenceDirectory: string;
  server: Server;
  host: "127.0.0.1";
  port: number;
  baseUrl: string;
  close(): Promise<void>;
  snapshot(): Record<string, unknown>;
};

export async function startReplayFixture(
  input: unknown,
  evidenceDirectory: string,
): Promise<RunningReplayFixture> {
  const config = parseReplayFixtureConfig(input);
  const parentDirectory = resolve(evidenceDirectory);
  await mkdir(parentDirectory, { recursive: true });
  const outputDirectory = await mkdtemp(join(parentDirectory, "replay-"));

  const counters: FixtureCounters = {
    requestCount: 0,
    callCount: 0,
    stepsConsumed: 0,
    jsonResponses: 0,
    streamedResponses: 0,
    plannedFailures: 0,
    requestErrors: 0,
    modelMismatches: 0,
    unexpectedCalls: 0,
    errors: [],
  };
  let writeQueue: Promise<void> = Promise.resolve();
  const startedAt = new Date().toISOString();
  let actualPort = config.port;

  const snapshot = () => ({
    evidenceDirectory: outputDirectory,
    schemaVersion: 1,
    host: config.host,
    port: actualPort,
    baseUrl: `http://${config.host}:${actualPort}/v1`,
    startedAt,
    updatedAt: new Date().toISOString(),
    configuredSteps: config.steps.length,
    allStepsConsumed: counters.stepsConsumed === config.steps.length,
    ...counters,
  });

  const persistEvent = (event: Record<string, unknown>) => {
    writeQueue = writeQueue.then(async () => {
      await appendFile(
        join(outputDirectory, "requests.jsonl"),
        `${JSON.stringify(event)}\n`,
      );
      await writeFile(
        join(outputDirectory, "summary.json"),
        `${JSON.stringify(snapshot(), null, 2)}\n`,
      );
    });
    return writeQueue;
  };

  const server = createServer(async (request, response) => {
    counters.requestCount += 1;
    const isCompletionCall =
      request.method === "POST" && request.url === "/v1/chat/completions";
    const callNumber = isCompletionCall ? ++counters.callCount : null;
    const step = isCompletionCall ? config.steps[callNumber! - 1] : undefined;
    if (isCompletionCall && step) counters.stepsConsumed = callNumber!;
    if (isCompletionCall && !step) counters.unexpectedCalls += 1;

    let requestBody: RequestBody = { rawText: "", json: null };
    try {
      requestBody = await readRequestBody(request);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const invalidBody =
        error instanceof RequestJsonError
          ? { rawText: error.rawText, json: null }
          : requestBody;
      await answerError({
        request,
        response,
        requestBody: invalidBody,
        callNumber,
        step,
        statusCode: 400,
        code: "fixture_request_body_unreadable",
        message: `Request body could not be read: ${detail}`,
        outcome: "request_error",
      });
      return;
    }

    if (request.method === "GET" && request.url === "/health") {
      const body = { status: "ready", ...snapshot() };
      await persistEvent(
        createEvent(
          request,
          requestBody,
          callNumber,
          step,
          200,
          body,
          "health",
        ),
      );
      writeJson(response, 200, body);
      return;
    }

    if (!isCompletionCall) {
      await answerError({
        request,
        response,
        requestBody,
        callNumber,
        step,
        statusCode: 404,
        code: "fixture_route_not_found",
        message:
          "Only GET /health and POST /v1/chat/completions are available.",
        outcome: "route_error",
      });
      return;
    }

    if (
      !String(request.headers["content-type"] ?? "")
        .toLowerCase()
        .includes("application/json")
    ) {
      await answerError({
        request,
        response,
        requestBody,
        callNumber,
        step,
        statusCode: 415,
        code: "fixture_json_required",
        message:
          "POST /v1/chat/completions requires an application/json request body.",
        outcome: "request_error",
      });
      return;
    }

    if (!isRecord(requestBody.json)) {
      await answerError({
        request,
        response,
        requestBody,
        callNumber,
        step,
        statusCode: 400,
        code: "fixture_json_object_required",
        message: "POST /v1/chat/completions requires a JSON object.",
        outcome: "request_error",
      });
      return;
    }

    const requestedModel = requestBody.json.model;
    if (typeof requestedModel !== "string" || requestedModel.length === 0) {
      await answerError({
        request,
        response,
        requestBody,
        callNumber,
        step,
        statusCode: 400,
        code: "fixture_model_required",
        message:
          "The OpenAI-compatible request must include a non-empty model.",
        outcome: "request_error",
      });
      return;
    }

    if (!step) {
      const code = "fixture_sequence_exhausted";
      const message = `Call ${callNumber} has no configured replay step.`;
      counters.errors.push({ callNumber, statusCode: 409, code, message });
      const body = openAIError(code, message, "invalid_request_error");
      await persistEvent(
        createEvent(
          request,
          requestBody,
          callNumber,
          undefined,
          409,
          body,
          "unexpected_call",
        ),
      );
      writeJson(response, 409, body);
      return;
    }

    if (requestedModel !== step.model) {
      const code = "fixture_model_mismatch";
      const message = `Call ${callNumber} expected model ${step.model} but received ${requestedModel}.`;
      counters.modelMismatches += 1;
      counters.errors.push({ callNumber, statusCode: 409, code, message });
      const body = openAIError(code, message, "invalid_request_error");
      await persistEvent(
        createEvent(
          request,
          requestBody,
          callNumber,
          step,
          409,
          body,
          "model_mismatch",
        ),
      );
      writeJson(response, 409, body);
      return;
    }

    if ("failure" in step) {
      counters.plannedFailures += 1;
      counters.errors.push({
        callNumber,
        statusCode: step.failure.statusCode,
        code: step.failure.code,
        message: step.failure.message,
      });
      const body = openAIError(
        step.failure.code,
        step.failure.message,
        step.failure.type,
      );
      await persistEvent(
        createEvent(
          request,
          requestBody,
          callNumber,
          step,
          step.failure.statusCode,
          body,
          "planned_failure",
        ),
      );
      writeJson(response, step.failure.statusCode, body);
      return;
    }

    let content: string;
    try {
      content =
        step.purpose === "narrator"
          ? step.text
          : JSON.stringify(
              resolveEvidenceMessageIds(step.agentOutput, requestBody.json),
            );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      counters.requestErrors += 1;
      const code = "fixture_response_resolution_failed";
      counters.errors.push({
        callNumber,
        statusCode: 422,
        code,
        message: detail,
      });
      const body = openAIError(code, detail, "invalid_request_error");
      await persistEvent(
        createEvent(
          request,
          requestBody,
          callNumber,
          step,
          422,
          body,
          "response_resolution_error",
        ),
      );
      writeJson(response, 422, body);
      return;
    }

    const completion = openAICompletion(requestedModel, content, callNumber!);
    if (requestBody.json.stream === true) {
      const responseText = openAIStream(completion, content);
      counters.streamedResponses += 1;
      await persistEvent(
        createEvent(
          request,
          requestBody,
          callNumber,
          step,
          200,
          responseText,
          "stream_success",
        ),
      );
      response.statusCode = 200;
      response.setHeader("content-type", "text/event-stream; charset=utf-8");
      response.setHeader("cache-control", "no-cache");
      response.setHeader("connection", "keep-alive");
      response.end(responseText);
      return;
    }

    counters.jsonResponses += 1;
    await persistEvent(
      createEvent(
        request,
        requestBody,
        callNumber,
        step,
        200,
        completion,
        "json_success",
      ),
    );
    writeJson(response, 200, completion);
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(config.port, config.host, () => {
      server.removeListener("error", rejectListen);
      const address = server.address();
      if (!address || typeof address === "string") {
        rejectListen(new Error("Replay fixture did not bind an IP socket."));
        return;
      }
      actualPort = address.port;
      resolveListen();
    });
  });

  const baseUrl = `http://${config.host}:${actualPort}/v1`;
  try {
    await writeFile(
      join(outputDirectory, "summary.json"),
      `${JSON.stringify(snapshot(), null, 2)}\n`,
    );
  } catch (error) {
    await new Promise<void>((done) => server.close(() => done()));
    throw error;
  }

  return {
    evidenceDirectory: outputDirectory,
    server,
    host: config.host,
    port: actualPort,
    baseUrl,
    snapshot,
    close: async () => {
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      });
      await writeQueue;
      await writeFile(
        join(outputDirectory, "summary.json"),
        `${JSON.stringify(snapshot(), null, 2)}\n`,
      );
    },
  };

  async function answerError(args: {
    request: IncomingMessage;
    response: ServerResponse;
    requestBody: RequestBody;
    callNumber: number | null;
    step: ReplayStep | undefined;
    statusCode: number;
    code: string;
    message: string;
    outcome: string;
  }): Promise<void> {
    counters.requestErrors += 1;
    counters.errors.push({
      callNumber: args.callNumber,
      statusCode: args.statusCode,
      code: args.code,
      message: args.message,
    });
    const body = openAIError(args.code, args.message, "invalid_request_error");
    await persistEvent(
      createEvent(
        args.request,
        args.requestBody,
        args.callNumber,
        args.step,
        args.statusCode,
        body,
        args.outcome,
      ),
    );
    writeJson(args.response, args.statusCode, body);
  }
}

function createEvent(
  request: IncomingMessage,
  requestBody: RequestBody,
  callNumber: number | null,
  step: ReplayStep | undefined,
  responseStatus: number,
  responseBody: unknown,
  outcome: string,
) {
  return {
    at: new Date().toISOString(),
    callNumber,
    method: request.method ?? null,
    url: request.url ?? null,
    requestHeaders: {
      accept: request.headers.accept ?? null,
      contentType: request.headers["content-type"] ?? null,
    },
    requestBodyText: requestBody.rawText,
    requestBody: requestBody.json,
    requestedModel:
      isRecord(requestBody.json) && typeof requestBody.json.model === "string"
        ? requestBody.json.model
        : null,
    configuredPurpose: step?.purpose ?? null,
    configuredModel: step?.model ?? null,
    responseStatus,
    responseBodyText:
      typeof responseBody === "string"
        ? responseBody
        : JSON.stringify(responseBody),
    responseBody: typeof responseBody === "string" ? null : responseBody,
    outcome,
    error:
      responseStatus >= 400
        ? isRecord(responseBody) && isRecord(responseBody.error)
          ? responseBody.error
          : null
        : null,
  };
}

async function readRequestBody(request: IncomingMessage): Promise<RequestBody> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const rawText = Buffer.concat(chunks).toString("utf8");
  if (!rawText.trim()) return { rawText, json: null };
  try {
    return { rawText, json: JSON.parse(rawText) as unknown };
  } catch (error) {
    throw new RequestJsonError(rawText, error);
  }
}

class RequestJsonError extends Error {
  constructor(
    readonly rawText: string,
    cause: unknown,
  ) {
    super("Request body is not valid JSON.", { cause });
  }
}

function resolveEvidenceMessageIds(
  output: AgentOutput,
  request: unknown,
): AgentOutput {
  const clone = structuredClone(output);
  clone.evidenceMessageIds = clone.evidenceMessageIds.map((value) => {
    const match = /^\$sourceMessageId\[(0|[1-9][0-9]*)\]$/.exec(value);
    if (!match) return value;
    const index = Number(match[1]);
    const sourceMessages = getUpdaterSources(request);
    const messageId = sourceMessages[index]?.messageId;
    if (typeof messageId !== "string" || messageId.length === 0) {
      throw new Error(
        `The request has no sources[${index}].messageId for the configured evidence token.`,
      );
    }
    return messageId;
  });
  return clone;
}

function getUpdaterSources(request: unknown): Array<{ messageId?: unknown }> {
  if (!isRecord(request) || !Array.isArray(request.messages)) {
    throw new Error(
      "The state updater request has no messages array for evidence token resolution.",
    );
  }
  let sources: Array<{ messageId?: unknown }> | undefined;
  for (const message of request.messages) {
    if (!isRecord(message) || typeof message.content !== "string") continue;
    for (const content of message.content.split("\n\n")) {
      let input: unknown;
      try {
        input = JSON.parse(content) as unknown;
      } catch {
        continue;
      }
      if (
        !isRecord(input) ||
        !Object.hasOwn(input, "sourceIdentity") ||
        !Object.hasOwn(input, "sources")
      )
        continue;
      if (!isRecord(input.sourceIdentity)) {
        throw new Error(
          "The stateEvidence sourceIdentity field is not an object.",
        );
      }
      if (sources !== undefined) {
        throw new Error(
          "The state updater request contains multiple stateEvidence objects for evidence token resolution.",
        );
      }
      if (!Array.isArray(input.sources)) {
        throw new Error("The stateEvidence sources field is not an array.");
      }
      if (!input.sources.every(isRecord)) {
        throw new Error(
          "The state updater sources array contains a non-object item.",
        );
      }
      sources = input.sources as Array<{ messageId?: unknown }>;
    }
  }
  if (sources === undefined) {
    throw new Error(
      "The state updater request has no structured stateEvidence object. Include the stateEvidence marker in the state preset.",
    );
  }
  return sources;
}

function openAICompletion(model: string, content: string, callNumber: number) {
  return {
    id: `chatcmpl-replay-${String(callNumber).padStart(4, "0")}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
  };
}

function openAIStream(
  completion: ReturnType<typeof openAICompletion>,
  content: string,
): string {
  const prefix = {
    id: completion.id,
    object: "chat.completion.chunk",
    created: completion.created,
    model: completion.model,
  };
  const roleChunk = {
    ...prefix,
    choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
  };
  const textChunk = {
    ...prefix,
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  };
  const finishChunk = {
    ...prefix,
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  };
  return (
    [roleChunk, textChunk, finishChunk]
      .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
      .join("") + "data: [DONE]\n\n"
  );
}

function openAIError(code: string, message: string, type: string) {
  return { error: { message, type, code } };
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function runReplayForeground(
  configPath: string,
  evidenceDirectory: string,
): Promise<void> {
  const config = await readReplayFixtureConfig(resolve(configPath));
  const callDirectory =
    getCallDirectory() ?? (await createCallDirectory(evidenceDirectory));
  const fixture = await startReplayFixture(config, evidenceDirectory);
  await runForegroundService({
    command: "replay-fixture",
    callDirectory,
    ready: {
      status: "listening",
      bindAddress: `${fixture.host}:${fixture.port}`,
      baseUrl: fixture.baseUrl,
      evidenceDirectory: fixture.evidenceDirectory,
      configuredSteps: config.steps.length,
    },
    close: () => fixture.close(),
    snapshot: () => fixture.snapshot(),
    failure: {
      describe: String,
      action: "检查回放服务关闭记录及证据目录写入权限。",
    },
  });
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const { runCli } = await import("./cli.ts");
  await runCli(["replay-fixture", ...process.argv.slice(2)]);
}
