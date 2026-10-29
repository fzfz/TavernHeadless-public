import { createServer as createHttpServer, type Server } from "node:http";
import { appendFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  appendFile,
  mkdir,
  readFile,
  realpath,
  lstat,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import Ajv from "ajv/dist/2020.js";
import { createServer, type ViteDevServer, type Logger } from "vite";
import type { RuntimeParamsResponse } from "../../../../packages/shared/src/schemas/llm-generation-params.js";
import type { RoleModelCapabilitiesGrant } from "../../../../packages/shared/src/schemas/role-model-capabilities.js";

import { buildApp } from "../../../../apps/api/src/app.js";
import { createDatabase } from "../../../../apps/api/src/db/client.js";
import { migrateDatabase } from "../../../../apps/api/src/db/migrations.js";
import { loadStorageConfig } from "../../../../apps/api/src/storage-config.js";
import { formatToolMessage, toolMessages } from "./tool-config.ts";
import { createCallDirectory, getCallDirectory } from "./output.ts";
import { runForegroundService } from "./foreground-service.ts";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../../../apps/api/src/accounts/constants.js";
import {
  accountUsers,
  presets,
  presetVersions,
} from "../../../../apps/api/src/db/schema.js";
import { ensureTestDefaultWorkspace } from "../../../../apps/api/src/__tests__/helpers/workspace-project.js";
import { LlmProfileService } from "../../../../apps/api/src/services/llm-profile-service.js";
import {
  parseReplayFixtureConfig,
  startReplayFixture,
  type ReplayFixtureConfig,
  type RunningReplayFixture,
} from "./replay-fixture.ts";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = resolve(scriptDirectory, "../../../..");
const messages = toolMessages.preview;

type PreviewMasterKeyState = {
  originalValue: string | undefined;
  testValue: string;
  leaseCount: number;
};

let previewMasterKeyState: PreviewMasterKeyState | undefined;

export type PreviewPersona = { name: string; description: string };
export type PreviewTestMessage = {
  id: string;
  message: string;
  branch_id?: string;
  prompt_intent?:
    | "normal"
    | "continue"
    | "impersonate"
    | "swipe"
    | "regenerate"
    | "quiet";
  debug_options?: { include_worldbook_matches?: boolean };
};
export type PreviewScenario = {
  version: 1;
  persona: PreviewPersona;
  preset: { name: string; data: Record<string, unknown> };
  statePreset?: { name: string; data: Record<string, unknown> };
  modelParams: RuntimeParamsResponse & { max_context_tokens: number };
  modelCapabilities?: RoleModelCapabilitiesGrant | null;
  sessionType: "individual" | "group";
  openingId?: string;
  testMessages: PreviewTestMessage[];
  offlineReplay?: { steps: ReplayFixtureConfig["steps"] };
};
export type PreviewRuntime = {
  $schema: "./preview-runtime.schema.json";
  host: "127.0.0.1";
  apiPort: 0;
  frontendPort: 0;
  enableSseChat: true;
  testMasterKey: "native-maintenance-isolated-test-key";
  offlineProvider: {
    provider: "openai-compatible";
    apiMode: "chat";
    presetName: string;
    defaultModelId: string;
    baseUrl: string;
    apiKey: "offline-placeholder";
  };
};

export type ReplayStarter = (
  config: ReplayFixtureConfig,
  evidenceDirectory: string,
) => Promise<RunningReplayFixture>;

export type PreviewDependencies = {
  startReplayFixture?: ReplayStarter;
  transformDryRunResponse?: (
    request: { url: string; payload: unknown },
    response: { statusCode: number; body: unknown },
  ) => { statusCode: number; body: unknown } | undefined;
};

export type PreviewHandle = {
  url: string;
  apiUrl: string;
  generationMode: "offline_replay" | "unavailable";
  evidenceDirectory: string;
  sessionId: string;
  cardId: string;
  dryRuns: Array<{
    id: string;
    passed: boolean;
    status: number | null;
    error?: string;
  }>;
  offlineReplayUrl?: string;
  replaySnapshot(): Record<string, unknown> | undefined;
  close(): Promise<void>;
};

export class PreviewFailure extends Error {
  constructor(
    readonly stage: string,
    message: string,
    readonly evidenceDirectory: string,
    options?: ErrorOptions,
  ) {
    super(
      formatToolMessage(messages.failureContext, {
        stage,
        message,
        directory: evidenceDirectory,
      }),
      options,
    );
    this.name = "PreviewFailure";
  }
}

type JsonObject = Record<string, unknown>;
type ApiRequest = {
  method: "GET" | "POST";
  url: string;
  payload?: unknown;
  headers?: Record<string, string>;
  bodyReference?: { path: string; byteLength: number };
};
type PreviewRequestEvidence = {
  at: string;
  method: "GET" | "POST";
  url: string;
  request: unknown;
  headers: Record<string, string>;
  bodyReference?: string;
  bodyByteLength?: number;
  statusCode: number | null;
  response: unknown;
  transportError?: string;
};
type DryRunEvidence = {
  id: string;
  request: unknown;
  status: number | null;
  response: unknown;
  passed: boolean;
  checks?: {
    assembledMessageCount: number;
    personaDescriptionIncluded: boolean;
    personaNameInRoleView: boolean;
  };
  transportError?: string;
  error?: string;
};

function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

class PreviewEvidencePersistenceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PreviewEvidencePersistenceError";
  }
}

function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function contained(root: string, child: string): boolean {
  const relativePath = relative(root, child);
  return (
    relativePath !== "" &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  );
}

async function createPreviewEvidenceDirectory(
  taskDirectory: string,
  runId: string,
): Promise<string> {
  const resolvedTaskDirectory = await realpath(taskDirectory);
  if (resolvedTaskDirectory !== taskDirectory) {
    throw new Error(
      formatToolMessage(messages.taskDirectoryChanged, {
        path: taskDirectory,
      }),
    );
  }

  const previewRunsDirectory = join(taskDirectory, "preview-runs");
  let previewRunsMetadata: Awaited<ReturnType<typeof lstat>>;
  try {
    previewRunsMetadata = await lstat(previewRunsDirectory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    try {
      await mkdir(previewRunsDirectory);
    } catch (mkdirError) {
      if ((mkdirError as NodeJS.ErrnoException).code !== "EEXIST")
        throw mkdirError;
    }
    previewRunsMetadata = await lstat(previewRunsDirectory);
  }
  if (previewRunsMetadata.isSymbolicLink()) {
    throw new Error(
      formatToolMessage(messages.evidenceDirectorySymlink, {
        path: previewRunsDirectory,
      }),
    );
  }
  if (!previewRunsMetadata.isDirectory()) {
    throw new Error(
      formatToolMessage(messages.evidencePathType, {
        path: previewRunsDirectory,
      }),
    );
  }

  const resolvedPreviewRunsDirectory = await realpath(previewRunsDirectory);
  if (!contained(taskDirectory, resolvedPreviewRunsDirectory)) {
    throw new Error(
      formatToolMessage(messages.evidenceDirectoryEscape, {
        path: resolvedPreviewRunsDirectory,
      }),
    );
  }

  const runDirectoryPath = join(resolvedPreviewRunsDirectory, runId);
  await mkdir(runDirectoryPath);
  const runMetadata = await lstat(runDirectoryPath);
  if (!runMetadata.isDirectory() || runMetadata.isSymbolicLink()) {
    throw new Error(
      formatToolMessage(messages.runDirectoryType, {
        path: runDirectoryPath,
      }),
    );
  }
  const resolvedRunDirectory = await realpath(runDirectoryPath);
  if (
    !contained(taskDirectory, resolvedRunDirectory) ||
    !contained(resolvedPreviewRunsDirectory, resolvedRunDirectory)
  ) {
    throw new Error(
      formatToolMessage(messages.runDirectoryEscape, {
        path: resolvedRunDirectory,
      }),
    );
  }
  return resolvedRunDirectory;
}

function acquirePreviewMasterKey(testValue: string): () => void {
  if (previewMasterKeyState && previewMasterKeyState.testValue !== testValue) {
    throw new Error(messages.masterKeyConflict);
  }

  if (!previewMasterKeyState) {
    previewMasterKeyState = {
      originalValue: process.env.APP_SECRETS_MASTER_KEY,
      testValue,
      leaseCount: 0,
    };
    process.env.APP_SECRETS_MASTER_KEY = testValue;
  }

  const state = previewMasterKeyState;
  state.leaseCount += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.leaseCount -= 1;
    if (state.leaseCount > 0) return;

    if (state.originalValue === undefined) {
      delete process.env.APP_SECRETS_MASTER_KEY;
    } else {
      process.env.APP_SECRETS_MASTER_KEY = state.originalValue;
    }
    if (previewMasterKeyState === state) previewMasterKeyState = undefined;
  };
}

async function readRegularFile(path: string): Promise<string> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(formatToolMessage(messages.regularFileExpected, { path }));
  }
  return readFile(path, "utf8");
}

async function loadJson(path: string): Promise<unknown> {
  return JSON.parse(await readRegularFile(path)) as unknown;
}

async function validateWithSchema(
  value: unknown,
  schemaPath: string,
  label: string,
  referencedSchemas: object[] = [],
): Promise<void> {
  const schema = (await loadJson(schemaPath)) as object;
  const ajv = new Ajv({ allErrors: true, strict: true });
  for (const referencedSchema of referencedSchemas)
    ajv.addSchema(referencedSchema);
  const validate = ajv.compile(schema);
  if (!validate(value)) {
    throw new Error(
      formatToolMessage(messages.schemaInvalid, {
        file: label,
        details: JSON.stringify(validate.errors),
      }),
    );
  }
}

async function savePreviewRequestBody(
  evidenceDirectory: string,
  bytes: Buffer,
): Promise<{ path: string; byteLength: number }> {
  const evidenceMetadata = await lstat(evidenceDirectory);
  const resolvedEvidenceDirectory = await realpath(evidenceDirectory);
  if (
    !evidenceMetadata.isDirectory() ||
    evidenceMetadata.isSymbolicLink() ||
    resolvedEvidenceDirectory !== evidenceDirectory
  ) {
    throw new Error(
      formatToolMessage(messages.requestBodyEvidence, {
        path: evidenceDirectory,
      }),
    );
  }

  const bodiesDirectory = join(evidenceDirectory, "request-bodies");
  await mkdir(bodiesDirectory);
  const bodiesMetadata = await lstat(bodiesDirectory);
  const resolvedBodiesDirectory = await realpath(bodiesDirectory);
  if (
    !bodiesMetadata.isDirectory() ||
    bodiesMetadata.isSymbolicLink() ||
    resolvedBodiesDirectory !== bodiesDirectory ||
    !contained(evidenceDirectory, resolvedBodiesDirectory)
  ) {
    throw new Error(
      formatToolMessage(messages.requestBodyDirectoryEscape, {
        path: bodiesDirectory,
      }),
    );
  }

  const bodyPath = join(bodiesDirectory, "000.bin");
  if (!contained(evidenceDirectory, bodyPath)) {
    throw new Error(
      formatToolMessage(messages.requestBodyPathEscape, { path: bodyPath }),
    );
  }
  await writeFile(bodyPath, bytes, { flag: "wx" });
  const resolvedBodyPath = await realpath(bodyPath);
  if (
    resolvedBodyPath !== bodyPath ||
    !contained(resolvedBodiesDirectory, resolvedBodyPath)
  ) {
    throw new Error(
      formatToolMessage(messages.requestBodyResolvesOutside, {
        path: bodyPath,
      }),
    );
  }
  return {
    path: relative(evidenceDirectory, bodyPath).split(sep).join("/"),
    byteLength: bytes.byteLength,
  };
}

function responseBody(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return body;
  }
}

function responseData(value: unknown): unknown {
  return isRecord(value) ? value.data : undefined;
}

function extractMessages(
  value: unknown,
): Array<{ role?: unknown; content?: unknown }> {
  const data = responseData(value);
  if (!isRecord(data) || !Array.isArray(data.messages)) return [];
  return data.messages.filter(isRecord) as Array<{
    role?: unknown;
    content?: unknown;
  }>;
}

function messageText(
  messages: Array<{ role?: unknown; content?: unknown }>,
): string {
  return messages
    .map((message) =>
      typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content ?? ""),
    )
    .join("\n");
}

function modelForPurpose(
  steps: ReplayFixtureConfig["steps"],
  purpose: "narrator" | "state_updater",
  fallback: string,
): string {
  const models = [
    ...new Set(
      steps
        .filter((step) => step.purpose === purpose)
        .map((step) => step.model),
    ),
  ];
  if (models.length > 1) {
    throw new Error(
      formatToolMessage(messages.multipleReplayModels, {
        purpose,
        models: models.join(", "),
      }),
    );
  }
  return models[0] ?? fallback;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function listenViteOnEphemeralPort(
  server: Server,
  host: string,
): Promise<AddressInfo> {
  const listening = once(server, "listening");
  server.listen(0, host);
  await listening;

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error(messages.viteAddressMissing);
  }
  return address as AddressInfo;
}

/**
 * Imports a task ZIP, creates a named persona and preset in isolated storage,
 * verifies prompt assembly through the formal dry-run endpoint, and exposes a
 * foreground Vite page bound only to IPv4 loopback.
 */
export async function startPreviewServer(
  taskDirectoryInput: string,
  dependencies: PreviewDependencies = {},
  archivePathInput: string,
): Promise<PreviewHandle> {
  const taskDirectory = await realpath(resolve(taskDirectoryInput));
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`;
  let evidenceDirectory = join(taskDirectory, "preview-runs", runId);
  let evidenceDirectoryReady = false;

  let stage = "read_inputs";
  let app: FastifyInstance | undefined;
  let vite: ViteDevServer | undefined;
  let frontendServer: Server | undefined;
  let replay: RunningReplayFixture | undefined;
  let releaseMasterKey: (() => void) | undefined;
  let closePromise: Promise<void> | undefined;
  let viteLogClosed = false;
  let browserWriteQueue: Promise<void> = Promise.resolve();
  let browserWriteError: unknown;
  const requests: PreviewRequestEvidence[] = [];

  const appendBrowserRecord = (
    record: Record<string, unknown>,
  ): Promise<void> => {
    browserWriteQueue = browserWriteQueue.then(() =>
      appendFile(
        join(evidenceDirectory, "browser-requests.jsonl"),
        `${JSON.stringify(record)}\n`,
      ),
    );
    void browserWriteQueue.catch((error: unknown) => {
      browserWriteError ??= error;
    });
    return browserWriteQueue;
  };

  const closeResources = (): Promise<void> => {
    closePromise ??= (async () => {
      const errors: string[] = [];
      if (vite) {
        try {
          await vite.environments.client.waitForRequestsIdle();
          await vite.environments.client.depsOptimizer?.scanProcessing;
          const metadata = vite.environments.client.depsOptimizer?.metadata;
          await Promise.all(
            Object.values(metadata?.discovered ?? {}).map(
              (dependency) => dependency.processing,
            ),
          );
        } catch (error) {
          errors.push(
            formatToolMessage(messages.viteCloseFailed, {
              error: describeError(error),
            }),
          );
        }
        try {
          await vite.close();
        } catch (error) {
          errors.push(
            formatToolMessage(messages.viteCloseFailed, {
              error: describeError(error),
            }),
          );
        }
      }
      if (frontendServer?.listening) {
        try {
          await new Promise<void>((done, fail) =>
            frontendServer!.close((error) => (error ? fail(error) : done())),
          );
        } catch (error) {
          errors.push(
            formatToolMessage(messages.viteCloseFailed, {
              error: describeError(error),
            }),
          );
        }
      }
      if (app) {
        try {
          await app.close();
        } catch (error) {
          errors.push(
            formatToolMessage(messages.apiCloseFailed, {
              error: describeError(error),
            }),
          );
        }
      }
      if (replay) {
        try {
          await replay.close();
        } catch (error) {
          errors.push(
            formatToolMessage(messages.replayCloseFailed, {
              error: describeError(error),
            }),
          );
        }
      }
      try {
        await browserWriteQueue;
      } catch (error) {
        errors.push(
          formatToolMessage(messages.browserLogFlushFailed, {
            error: describeError(browserWriteError ?? error),
          }),
        );
      }
      viteLogClosed = true;
      releaseMasterKey?.();
      releaseMasterKey = undefined;
      if (evidenceDirectoryReady) {
        try {
          await writeJson(join(evidenceDirectory, "closed.json"), {
            closedAt: new Date().toISOString(),
            offlineReplay: replay?.snapshot(),
            cleanupErrors: errors,
          });
        } catch (error) {
          errors.push(
            formatToolMessage(messages.closeRecordFailed, {
              error: describeError(error),
            }),
          );
        }
      }
      if (errors.length > 0)
        throw new AggregateError(
          errors,
          formatToolMessage(messages.cleanupFailed, {
            errors: errors.join("\n"),
          }),
        );
    })();
    return closePromise;
  };

  try {
    evidenceDirectory = await createPreviewEvidenceDirectory(
      taskDirectory,
      runId,
    );
    evidenceDirectoryReady = true;

    const archiveInput = resolve(archivePathInput);
    const zipPath = join(
      await realpath(dirname(archiveInput)),
      basename(archiveInput),
    );
    const previewPath = join(taskDirectory, "preview.json");
    const runtimePath = join(scriptDirectory, "preview-runtime.json");
    const runtimeSchemaPath = join(
      scriptDirectory,
      "preview-runtime.schema.json",
    );
    const previewSchemaPath = join(scriptDirectory, "preview.schema.json");
    const replaySchemaPath = join(
      scriptDirectory,
      "replay-fixture.schema.json",
    );
    const modelCapabilitiesSchemaPath = join(
      repositoryRoot,
      "packages/shared/src/schemas/role-model-capabilities.schema.json",
    );
    const runtimeRaw = await readRegularFile(runtimePath);
    const scenarioRaw = await readRegularFile(previewPath);
    await writeFile(
      join(evidenceDirectory, "preview-runtime.json"),
      runtimeRaw,
    );
    await writeFile(join(evidenceDirectory, "preview.json"), scenarioRaw);
    const runtime = JSON.parse(runtimeRaw) as PreviewRuntime;
    const scenario = JSON.parse(scenarioRaw) as PreviewScenario;
    const replaySchema = (await loadJson(replaySchemaPath)) as object;
    const modelCapabilitiesSchema = (await loadJson(
      modelCapabilitiesSchemaPath,
    )) as JsonObject;
    await validateWithSchema(runtime, runtimeSchemaPath, runtimePath);
    await validateWithSchema(scenario, previewSchemaPath, previewPath, [
      replaySchema,
      {
        ...modelCapabilitiesSchema,
        $schema: "https://json-schema.org/draft/2020-12/schema",
      },
    ]);

    if (!contained(taskDirectory, zipPath)) {
      throw new Error(
        formatToolMessage(messages.configuredZipEscape, { path: zipPath }),
      );
    }
    const zipMetadata = await lstat(zipPath);
    if (!zipMetadata.isFile() || zipMetadata.isSymbolicLink()) {
      throw new Error(
        formatToolMessage(messages.configuredZipRegularFile, {
          file: archivePathInput,
          path: zipPath,
        }),
      );
    }
    const resolvedZipPath = await realpath(zipPath);
    if (!contained(taskDirectory, resolvedZipPath)) {
      throw new Error(
        formatToolMessage(messages.roleZipEscape, {
          path: resolvedZipPath,
        }),
      );
    }
    const zipBytes = await readFile(resolvedZipPath);

    releaseMasterKey = acquirePreviewMasterKey(runtime.testMasterKey);

    let narratorModel = runtime.offlineProvider.defaultModelId;
    let stateUpdaterModel = runtime.offlineProvider.defaultModelId;
    let providerBaseUrl = runtime.offlineProvider.baseUrl;
    const fixtureEvidenceDirectory = join(evidenceDirectory, "offline-replay");
    if (scenario.offlineReplay) {
      stage = "offline_replay_config";
      const fixtureConfig = parseReplayFixtureConfig({
        host: runtime.host,
        port: 0,
        steps: scenario.offlineReplay.steps,
      });
      narratorModel = modelForPurpose(
        fixtureConfig.steps,
        "narrator",
        runtime.offlineProvider.defaultModelId,
      );
      stateUpdaterModel = modelForPurpose(
        fixtureConfig.steps,
        "state_updater",
        runtime.offlineProvider.defaultModelId,
      );
      stage = "offline_replay_start";
      replay = await (dependencies.startReplayFixture ?? startReplayFixture)(
        fixtureConfig,
        fixtureEvidenceDirectory,
      );
      if (
        replay.host !== "127.0.0.1" ||
        !replay.baseUrl.startsWith("http://127.0.0.1:")
      ) {
        throw new Error(
          formatToolMessage(messages.replayNotLoopback, {
            address: replay.baseUrl,
          }),
        );
      }
      providerBaseUrl = replay.baseUrl;
    }

    stage = "isolated_api_start";
    const storage = loadStorageConfig({
      DATA_DIR: join(evidenceDirectory, "storage"),
    });
    const database = createDatabase(storage.databasePath);
    try {
      migrateDatabase(database);
    } finally {
      database.close();
    }
    const built = await buildApp({
      storage,
      databasePath: storage.databasePath,
      logger: false,
      auth: { mode: "off" },
      enablePromptDryRun: true,
      enableSseChat: runtime.enableSseChat,
      llmProfileApiMode: runtime.offlineProvider.apiMode,
      orchestration: {
        providers: [
          {
            id: "offline-preview",
            type: runtime.offlineProvider.provider,
            apiMode: runtime.offlineProvider.apiMode,
            apiKey: runtime.offlineProvider.apiKey,
            baseURL: providerBaseUrl,
          },
        ],
        defaultModel: {
          providerId: "offline-preview",
          modelId: narratorModel,
        },
      },
    });
    app = built.app;

    let apiOrigin: string | undefined;
    const apiResponseBodies = new Map<string, unknown>();
    app.addHook("onRequest", async (request, reply) => {
      if (
        !apiOrigin ||
        request.routeOptions.url !== "/sessions/:id/respond/stream"
      ) {
        return;
      }
      const chunks: Buffer[] = [];
      const capture = (chunk: unknown): void => {
        if (typeof chunk === "string") chunks.push(Buffer.from(chunk));
        else if (Buffer.isBuffer(chunk)) chunks.push(chunk);
        else if (chunk instanceof Uint8Array)
          chunks.push(
            Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength),
          );
      };
      const originalWrite = reply.raw.write.bind(reply.raw);
      const originalEnd = reply.raw.end.bind(reply.raw);
      reply.raw.write = ((...args: Parameters<typeof reply.raw.write>) => {
        capture(args[0]);
        return originalWrite(...args);
      }) as typeof reply.raw.write;
      reply.raw.end = ((...args: Parameters<typeof reply.raw.end>) => {
        capture(args[0]);
        apiResponseBodies.set(
          request.id,
          responseBody(Buffer.concat(chunks).toString("utf8")),
        );
        return originalEnd(...args);
      }) as typeof reply.raw.end;
    });
    app.addHook("onSend", async (request, _reply, payload) => {
      if (typeof payload === "string") {
        apiResponseBodies.set(request.id, responseBody(payload));
      } else if (Buffer.isBuffer(payload)) {
        apiResponseBodies.set(
          request.id,
          responseBody(payload.toString("utf8")),
        );
      }
      return payload;
    });
    app.addHook("onResponse", async (request, response) => {
      if (!apiOrigin) {
        apiResponseBodies.delete(request.id);
        return;
      }
      await appendBrowserRecord({
        source: "api",
        method: request.method,
        url: `${apiOrigin}${request.url}`,
        path: request.url,
        request: request.body ?? null,
        statusCode: response.statusCode,
        response: apiResponseBodies.get(request.id) ?? null,
      });
      apiResponseBodies.delete(request.id);
    });

    const saveRequestRecord = async (
      record: PreviewRequestEvidence,
    ): Promise<void> => {
      try {
        await appendFile(
          join(evidenceDirectory, "http-results.jsonl"),
          `${JSON.stringify(record)}\n`,
        );
        requests.push(record);
        await writeJson(join(evidenceDirectory, "requests.json"), requests);
      } catch (error) {
        throw new PreviewEvidencePersistenceError(
          formatToolMessage(messages.requestEvidenceSaveFailed, {
            error: describeError(error),
          }),
          { cause: error },
        );
      }
    };

    const request = async (
      input: ApiRequest,
    ): Promise<{ statusCode: number; body: unknown }> => {
      let statusCode: number | null = null;
      let body: unknown = null;
      const requestEvidence = (
        responseStatusCode: number | null,
        response: unknown,
        transportError?: string,
      ): PreviewRequestEvidence => ({
        at: new Date().toISOString(),
        method: input.method,
        url: input.url,
        request:
          input.bodyReference === undefined ? (input.payload ?? null) : null,
        headers: input.headers ?? {},
        ...(input.bodyReference === undefined
          ? {}
          : {
              bodyReference: input.bodyReference.path,
              bodyByteLength: input.bodyReference.byteLength,
            }),
        statusCode: responseStatusCode,
        response,
        ...(transportError === undefined ? {} : { transportError }),
      });
      try {
        const response = await app!.inject({
          method: input.method,
          url: input.url,
          ...(input.payload === undefined
            ? {}
            : { payload: input.payload as never }),
          ...(input.headers === undefined ? {} : { headers: input.headers }),
        });
        statusCode = response.statusCode;
        body = responseBody(response.body);
        if (input.url.endsWith("/respond/dry-run")) {
          const transformed = dependencies.transformDryRunResponse?.(
            { url: input.url, payload: input.payload },
            { statusCode, body },
          );
          if (transformed) {
            statusCode = transformed.statusCode;
            body = transformed.body;
          }
        }
      } catch (error) {
        await saveRequestRecord(
          requestEvidence(null, null, describeError(error)),
        );
        throw error;
      }
      await saveRequestRecord(requestEvidence(statusCode, body));
      if (statusCode >= 400) {
        throw new Error(
          formatToolMessage(messages.requestFailed, {
            method: input.method,
            url: input.url,
            statusCode,
            body: JSON.stringify(body),
          }),
        );
      }
      return { statusCode, body };
    };

    stage = "import_inspect";
    const filename = basename(zipPath);
    const zipBodyReference = await savePreviewRequestBody(
      evidenceDirectory,
      zipBytes,
    );
    const inspectionResponse = await request({
      method: "POST",
      url: `/native-cards/imports?fileName=${encodeURIComponent(filename)}`,
      headers: { "content-type": "application/zip" },
      bodyReference: zipBodyReference,
      payload: zipBytes,
    });
    const inspection = responseData(inspectionResponse.body);
    if (!isRecord(inspection) || typeof inspection.id !== "string") {
      throw new Error(
        formatToolMessage(messages.importIdMissing, {
          response: JSON.stringify(inspectionResponse.body),
        }),
      );
    }

    stage = "import_confirm";
    const confirmation = await request({
      method: "POST",
      url: `/native-cards/imports/${encodeURIComponent(inspection.id)}/confirm`,
    });
    const card = responseData(confirmation.body);
    if (
      !isRecord(card) ||
      typeof card.id !== "string" ||
      typeof card.revision !== "number"
    ) {
      throw new Error(
        formatToolMessage(messages.cardRevisionMissing, {
          response: JSON.stringify(confirmation.body),
        }),
      );
    }

    stage = "seed_persona_and_preset";
    const now = Date.now();
    const { workspaceId } = ensureTestDefaultWorkspace(
      built.database,
      DEFAULT_ADMIN_ACCOUNT_ID,
      now,
    );
    const personaId = `preview-persona-${randomUUID()}`;
    const seedPreset = (
      name: string,
      data: Record<string, unknown>,
      resourceName: string,
    ) => {
      const presetId = `preview-${resourceName}-${randomUUID()}`;
      const presetVersionId = `preview-${resourceName}-version-${randomUUID()}`;
      built.database
        .insert(presets)
        .values({
          id: presetId,
          name,
          source: "test",
          accountId: DEFAULT_ADMIN_ACCOUNT_ID,
          workspaceId,
          dataJson: JSON.stringify(data),
          version: 1,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      built.database
        .insert(presetVersions)
        .values({
          id: presetVersionId,
          presetId,
          versionNo: 1,
          dataJson: JSON.stringify(data),
          contentHash: "isolated-preview-preset",
          createdAt: now,
        })
        .run();
      return { presetId, presetVersionId };
    };
    const { presetId, presetVersionId } = seedPreset(
      scenario.preset.name,
      scenario.preset.data,
      "preset",
    );
    const statePresetBinding =
      scenario.statePreset === undefined
        ? undefined
        : {
            ...seedPreset(
              scenario.statePreset.name,
              scenario.statePreset.data,
              "state-preset",
            ),
            name: scenario.statePreset.name,
          };
    built.database
      .insert(accountUsers)
      .values({
        id: personaId,
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        workspaceId,
        name: scenario.persona.name,
        snapshotJson: JSON.stringify(scenario.persona),
        status: "active",
        revision: 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const profileService = new LlmProfileService(built.database, {
      masterKey: runtime.testMasterKey,
    });
    const narratorProfile = await profileService.createProfile(
      {
        presetName: `${runtime.offlineProvider.presetName} narrator`,
        provider: runtime.offlineProvider.provider,
        modelId: narratorModel,
        baseUrl: providerBaseUrl,
        apiKey: runtime.offlineProvider.apiKey,
      },
      DEFAULT_ADMIN_ACCOUNT_ID,
    );
    const stateUpdaterProfile = await profileService.createProfile(
      {
        presetName: `${runtime.offlineProvider.presetName} state updater`,
        provider: runtime.offlineProvider.provider,
        modelId: stateUpdaterModel,
        baseUrl: providerBaseUrl,
        apiKey: runtime.offlineProvider.apiKey,
      },
      DEFAULT_ADMIN_ACCOUNT_ID,
    );

    stage = "preview_session_create";
    const previewPayload = {
      revision: card.revision,
      ...(scenario.openingId === undefined
        ? {}
        : { openingId: scenario.openingId }),
      userId: personaId,
      sessionType: scenario.sessionType,
      configuration: {
        presetId,
        presetVersionId,
        defaultUserId: personaId,
        promptMode: "native",
        modelSlots: [
          {
            slot: "narrator",
            profile_id: narratorProfile.id,
            params: scenario.modelParams,
          },
          {
            slot: "state_updater",
            profile_id: stateUpdaterProfile.id,
            params: scenario.modelParams,
          },
        ],
        ...(scenario.modelCapabilities === undefined
          ? {}
          : { model_capabilities: scenario.modelCapabilities }),
        ...(statePresetBinding === undefined
          ? {}
          : {
              statePresetId: statePresetBinding.presetId,
              statePresetVersionId: statePresetBinding.presetVersionId,
            }),
      },
    };
    const previewResponse = await request({
      method: "POST",
      url: `/native-cards/${encodeURIComponent(card.id)}/preview-sessions`,
      payload: previewPayload,
    });
    const preview = responseData(previewResponse.body);
    if (!isRecord(preview) || typeof preview.sessionId !== "string") {
      throw new Error(
        formatToolMessage(messages.previewSessionMissing, {
          response: JSON.stringify(previewResponse.body),
        }),
      );
    }

    stage = "role_view_read";
    const roleViewResponse = await request({
      method: "GET",
      url: `/sessions/${encodeURIComponent(preview.sessionId)}/role-view`,
    });
    const roleView = responseData(roleViewResponse.body);
    if (!isRecord(roleView)) {
      throw new Error(
        formatToolMessage(messages.roleViewInvalid, {
          response: JSON.stringify(roleViewResponse.body),
        }),
      );
    }
    const delivery = isRecord(roleView.delivery) ? roleView.delivery : {};
    const deliveryData = isRecord(delivery.data) ? delivery.data : {};
    const actualPersonaName = deliveryData.performerName;
    if (actualPersonaName !== scenario.persona.name) {
      throw new Error(
        formatToolMessage(messages.personaNameMismatch, {
          expected: JSON.stringify(scenario.persona.name),
          actual: JSON.stringify(actualPersonaName),
        }),
      );
    }

    stage = "prompt_dry_run";
    const dryRuns: DryRunEvidence[] = [];
    for (const testMessage of scenario.testMessages) {
      const dryRunPayload = {
        message: testMessage.message,
        ...(testMessage.branch_id === undefined
          ? {}
          : { branch_id: testMessage.branch_id }),
        ...(testMessage.prompt_intent === undefined
          ? {}
          : { prompt_intent: testMessage.prompt_intent }),
        ...(testMessage.debug_options === undefined
          ? {}
          : { debug_options: testMessage.debug_options }),
      };
      const dryRunUrl = `/sessions/${encodeURIComponent(preview.sessionId)}/respond/dry-run`;
      const requestStartIndex = requests.length;
      let record: DryRunEvidence;
      try {
        const dryRunResponse = await request({
          method: "POST",
          url: dryRunUrl,
          payload: dryRunPayload,
        });
        const assembledMessages = extractMessages(dryRunResponse.body);
        if (assembledMessages.length === 0) {
          throw new Error(
            formatToolMessage(messages.dryRunEmptyMessages, {
              id: testMessage.id,
              response: JSON.stringify(dryRunResponse.body),
            }),
          );
        }
        const assembledText = messageText(assembledMessages);
        const personaDescriptionIncluded = assembledText.includes(
          scenario.persona.description,
        );
        if (!personaDescriptionIncluded) {
          throw new Error(
            formatToolMessage(messages.dryRunPersonaMissing, {
              id: testMessage.id,
            }),
          );
        }
        record = {
          id: testMessage.id,
          request: dryRunPayload,
          status: dryRunResponse.statusCode,
          response: dryRunResponse.body,
          passed: true,
          checks: {
            assembledMessageCount: assembledMessages.length,
            personaDescriptionIncluded,
            personaNameInRoleView: actualPersonaName === scenario.persona.name,
          },
        };
      } catch (error) {
        if (error instanceof PreviewEvidencePersistenceError) throw error;
        const requestRecord = requests
          .slice(requestStartIndex)
          .find((request) => request.url === dryRunUrl);
        record = {
          id: testMessage.id,
          request: dryRunPayload,
          status: requestRecord?.statusCode ?? null,
          response: requestRecord?.response ?? null,
          ...(requestRecord?.transportError === undefined
            ? {}
            : { transportError: requestRecord.transportError }),
          passed: false,
          error: formatToolMessage(messages.dryRunRequestFailed, {
            id: testMessage.id,
            error: describeError(error),
          }),
        };
      }
      dryRuns.push(record);
      await writeJson(join(evidenceDirectory, "dry-runs.json"), dryRuns);
    }

    const dryRunResults = dryRuns.map(
      ({ id, passed, status, checks, error }) => ({
        id,
        passed,
        status,
        ...(checks === undefined ? {} : { checks }),
        ...(error === undefined ? {} : { error }),
      }),
    );

    const apiAddress = await app.listen({
      host: runtime.host,
      port: runtime.apiPort,
    });
    const apiUrl = new URL(apiAddress).origin;
    apiOrigin = apiUrl;
    stage = "vite_start";
    const loggedErrors = new Set<unknown>();
    const warned = new Set<string>();
    const writeViteLog = (level: string, message: string) => {
      if (viteLogClosed) return;
      appendFileSync(
        join(evidenceDirectory, "vite.log.jsonl"),
        JSON.stringify({ level, message }) + "\n",
      );
    };
    const viteLogger: Logger = {
      hasWarned: false,
      info: (message) => writeViteLog("info", message),
      warn(message) {
        this.hasWarned = true;
        writeViteLog("warn", message);
      },
      warnOnce(message) {
        if (!warned.has(message)) {
          warned.add(message);
          this.warn(message);
        }
      },
      error(message, options) {
        if (options?.error) loggedErrors.add(options.error);
        writeViteLog("error", message);
      },
      clearScreen() {},
      hasErrorLogged: (error) => loggedErrors.has(error),
    };
    frontendServer = createHttpServer((request, response) =>
      vite!.middlewares(request, response),
    );
    vite = await createServer({
      root: join(repositoryRoot, "apps/user-web"),
      cacheDir: join(evidenceDirectory, "vite-cache"),
      customLogger: viteLogger,
      plugins: [
        {
          name: "isolated-preview-application-config",
          configureServer(server) {
            server.middlewares.use((req, res, next) => {
              const requestUrl = req.url ?? "/";
              const address = frontendServer?.address();
              const port =
                address && typeof address !== "string" ? address.port : null;
              res.once("finish", () => {
                void appendBrowserRecord({
                  source: "vite",
                  method: req.method ?? "GET",
                  url:
                    port === null
                      ? requestUrl
                      : `http://${runtime.host}:${port}${requestUrl}`,
                  path: requestUrl,
                  statusCode: res.statusCode,
                });
              });
              if (requestUrl === "/config/application.json") {
                const addressInfo = frontendServer?.address();
                const frontendPort =
                  addressInfo && typeof addressInfo !== "string"
                    ? addressInfo.port
                    : null;
                if (frontendPort === null) {
                  res.statusCode = 503;
                  res.end(messages.frontendListenerNoPort);
                  return;
                }
                res.setHeader("content-type", "application/json");
                res.end(
                  JSON.stringify({
                    apiBaseUrl: `http://${runtime.host}:${frontendPort}/api`,
                    adminBaseUrl: apiUrl,
                  }),
                );
                return;
              }
              next();
            });
          },
        },
      ],
      optimizeDeps: { entries: ["src/main.ts"] },
      server: {
        middlewareMode: { server: frontendServer },
        hmr: { server: frontendServer },
        host: runtime.host,
        port: runtime.frontendPort,
        strictPort: true,
        proxy: {
          "/api": {
            target: apiUrl,
            rewrite: (path) => path.replace(/^\/api/, ""),
          },
          "/role-assets": { target: apiUrl },
        },
      },
    });
    const frontendAddress = await listenViteOnEphemeralPort(
      frontendServer,
      runtime.host,
    );
    const dependencyScan =
      vite.environments.client.depsOptimizer?.scanProcessing;
    if (dependencyScan) await dependencyScan;
    const frontendPort = frontendAddress.port;
    const url = new URL(`http://${runtime.host}:${frontendPort}/`);
    url.searchParams.set("sessionId", preview.sessionId);
    const page = {
      url: url.toString(),
      apiUrl,
      evidenceDirectory,
      sessionId: preview.sessionId,
      cardId: card.id,
      persona: scenario.persona,
      preset: {
        name: scenario.preset.name,
        id: presetId,
        versionId: presetVersionId,
      },
      ...(statePresetBinding === undefined
        ? {}
        : {
            statePreset: {
              name: statePresetBinding.name,
              id: statePresetBinding.presetId,
              versionId: statePresetBinding.presetVersionId,
            },
          }),
      dryRunCount: dryRuns.length,
      dryRuns: dryRunResults,
      offlineReplayUrl: replay?.baseUrl,
      generationMode: replay ? "offline_replay" : "unavailable",
      storageDirectory: storage.dataRoot,
      sourceZipFile: zipPath,
      boundHost: runtime.host,
      boundApiPort: new URL(apiUrl).port,
      boundFrontendPort: frontendPort,
    };
    await writeJson(join(evidenceDirectory, "page.json"), page);
    await writeJson(join(evidenceDirectory, "configuration.json"), {
      runtime,
      scenario,
      sourceZipFile: zipPath,
      importedCardId: card.id,
      revision: card.revision,
      preview,
      personaId,
      presetId,
      presetVersionId,
      ...(statePresetBinding === undefined
        ? {}
        : {
            statePresetId: statePresetBinding.presetId,
            statePresetVersionId: statePresetBinding.presetVersionId,
          }),
      narratorProfileId: narratorProfile.id,
      stateUpdaterProfileId: stateUpdaterProfile.id,
      storageDirectory: storage.dataRoot,
      dryRuns: dryRunResults,
    });

    return {
      url: url.toString(),
      apiUrl,
      generationMode: replay ? "offline_replay" : "unavailable",
      evidenceDirectory,
      sessionId: preview.sessionId,
      cardId: card.id,
      dryRuns: dryRunResults,
      ...(replay === undefined ? {} : { offlineReplayUrl: replay.baseUrl }),
      replaySnapshot: () => replay?.snapshot(),
      close: closeResources,
    };
  } catch (error) {
    const message = describeError(error);
    if (evidenceDirectoryReady) {
      try {
        await writeJson(join(evidenceDirectory, "failure.json"), {
          stage,
          message,
          stack: error instanceof Error ? error.stack : undefined,
          at: new Date().toISOString(),
        });
      } catch {
        // Preserve the original stage error when evidence storage itself is unavailable.
      }
    }
    try {
      await closeResources();
    } catch (cleanupError) {
      if (evidenceDirectoryReady) {
        try {
          await appendFile(
            join(evidenceDirectory, "failure-cleanup-errors.jsonl"),
            `${JSON.stringify({ at: new Date().toISOString(), message: describeError(cleanupError) })}\n`,
          );
        } catch {
          // The original startup error remains the surfaced failure.
        }
      }
    }
    throw new PreviewFailure(stage, message, evidenceDirectory, {
      cause: error,
    });
  }
}

export async function runPreviewForeground(
  taskDirectory: string,
  archivePath: string,
): Promise<void> {
  if (!taskDirectory) {
    throw new Error(messages.usage);
  }
  const callDirectory =
    getCallDirectory() ?? (await createCallDirectory(taskDirectory));
  const preview = await startPreviewServer(
    resolve(taskDirectory),
    {},
    archivePath,
  );
  await runForegroundService({
    command: "preview",
    callDirectory,
    ready: {
      status: "listening",
      url: preview.url,
      apiUrl: preview.apiUrl,
      offlineReplayUrl: preview.offlineReplayUrl,
      generationMode: preview.generationMode,
      evidenceDirectory: preview.evidenceDirectory,
      sessionId: preview.sessionId,
      cardId: preview.cardId,
      dryRuns: preview.dryRuns,
    },
    close: () => preview.close(),
    snapshot: () => ({ offlineReplay: preview.replaySnapshot() }),
    failure: {
      describe: describeError,
      action: "检查关闭记录中的服务错误及端口占用。",
    },
  });
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const { runCli } = await import("./cli.ts");
  await runCli(["preview", ...process.argv.slice(2)]);
}
