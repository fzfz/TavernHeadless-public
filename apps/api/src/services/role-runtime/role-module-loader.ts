import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFileSync } from "node:fs";
import { posix } from "node:path";
import { types as nodeTypes } from "node:util";
import {
  nativeCardFileRules,
  type RoleStateProposalProfile,
} from "@tavern/shared";
import type {
  NativeCardRevisionSnapshot,
} from "../native-card/native-card-service.js";
import type { RoleAssetService } from "./role-asset-service.js";
import {
  loadNativeModuleRuntimeConfig,
} from "./native-module-runtime-config.js";
import type {
  NativeModuleRuntimeConfig,
} from "./native-module-runtime-config.schema.js";
import {
  nativeModuleWorkerRequestSchema,
  nativeModuleWorkerResponseSchema,
  type NativeModuleWorkerRequest,
  type NativeModuleWorkerResponse,
} from "./native-module-worker.schema.js";
import { collectNativeModuleDependencies } from "./native-module-dependencies.js";

type NativeModuleContract = (typeof nativeCardFileRules.backendModuleApi.exports)[number];
type NativeWorkerModule = NativeModuleWorkerRequest["modules"][number];
type NativeWorkerRequest = NativeModuleWorkerRequest;
type AwaitableModuleFunction<K extends "derive" | "validate"> =
  NonNullable<RoleStateProposalProfile[K]> extends (...args: infer A) => infer R
    ? (...args: A) => R | Promise<R>
    : never;
type NativeWorkerSpawner = typeof spawn;

const backendModuleApi = nativeCardFileRules.backendModuleApi;
const processWorkerLimit = loadNativeModuleRuntimeConfig().maxConcurrentWorkers;
let activeNativeWorkers = 0;
const nativeModuleWorkerSource = readFileSync(
  new URL("./native-module-worker.mjs", import.meta.url),
  "utf8",
);

export class RoleModuleLoader {
  private readonly nativeRuntimeConfig: NativeModuleRuntimeConfig;

  constructor(
    private readonly assets: RoleAssetService,
    config: NativeModuleRuntimeConfig = loadNativeModuleRuntimeConfig(),
    private readonly spawnWorker: NativeWorkerSpawner = spawn,
  ) {
    this.nativeRuntimeConfig = config;
    if (config.maxConcurrentWorkers !== processWorkerLimit)
      throw new Error(
        `Native module worker configuration must use the process-wide limit of ${processWorkerLimit}.`,
      );
  }

  async load<K extends "derive" | "validate">(
    accountId: string,
    versionId: string,
    path: string,
    exportName: K,
  ): Promise<AwaitableModuleFunction<K>> {
    const module = await this.loadModule(accountId, versionId, path);
    if (typeof module[exportName] !== "function") {
      throw new Error(
        `Role module ${versionId}/${path} does not export ${exportName}(). Add the required function and publish a new character version.`,
      );
    }
    return module[exportName] as AwaitableModuleFunction<K>;
  }

  async loadModule(
    accountId: string,
    versionId: string,
    path: string,
  ): Promise<Record<string, unknown>> {
    const native = await this.assets.nativeRevision(accountId, versionId);
    if (!native) {
      const file = await this.assets.resolveServerModule(accountId, versionId, path);
      return import((await import("node:url")).pathToFileURL(file).href);
    }

    const contract = backendModuleApi.exports.find(
      (candidate) =>
        path.startsWith(candidate.directory) && path.endsWith(".js"),
    );
    if (!contract)
      throw moduleRuntimeError(versionId, path, "The module path has no registered runtime contract.");
    const entryRecord = native.fileRecords.find((file) => file.path === path);
    if (!entryRecord || entryRecord.purpose !== "server_script")
      throw moduleRuntimeError(versionId, path, "The module is not a declared server_script file.");
    const entryBytes = native.files.get(path);
    if (!entryBytes)
      throw moduleRuntimeError(versionId, path, "The module file is missing from the validated revision.");

    const recordsByPath = new Map(
      native.fileRecords.map((record) => [record.path, record]),
    );
    let moduleBytes = 0;
    let moduleFileCount = 0;
    let modules: NativeWorkerModule[];
    try {
      modules = collectNativeModuleDependencies(path, (modulePath) => {
        const record = recordsByPath.get(modulePath);
        if (!record)
          throw new Error(`Relative import ${modulePath} is not a declared package file.`);

        const extension = posix.extname(record.path);
        const isServerModule =
          record.purpose === "server_script" && extension === ".js";
        const isJsonData = record.purpose === "data" && extension === ".json";
        if (!isServerModule && !isJsonData) {
          if (extension === ".js")
            throw new Error(
              `JavaScript import ${modulePath} must be a declared server_script file.`,
            );
          if (extension === ".json")
            throw new Error(`JSON import ${modulePath} must have data purpose.`);
          throw new Error(
            `Relative import ${modulePath} must reference a declared JavaScript module or JSON data file.`,
          );
        }

        const bytes = native.files.get(record.path);
        if (!bytes)
          throw new Error(`The declared module resource ${record.path} is missing from the validated revision.`);
        moduleBytes += bytes.byteLength;
        if (moduleBytes > this.nativeRuntimeConfig.maxModuleBytes)
          throw new Error(`Native module resources exceed the configured ${this.nativeRuntimeConfig.maxModuleBytes}-byte limit.`);
        moduleFileCount += 1;
        if (moduleFileCount > this.nativeRuntimeConfig.maxModuleFiles)
          throw new Error(`Native module resources exceed the configured ${this.nativeRuntimeConfig.maxModuleFiles}-file limit.`);

        let source: string;
        try {
          source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        } catch (cause) {
          throw new Error(`The module resource ${record.path} is not valid UTF-8.`, { cause });
        }

        return {
          path: record.path,
          source,
          purpose: isServerModule ? "server_script" : "data",
        };
      });
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw moduleRuntimeError(versionId, path, detail, cause);
    }

    const invoke = async (context: unknown): Promise<unknown> => {
      const safeContext = serializeModuleContext(versionId, path, contract, context);
      const request = nativeModuleWorkerRequestSchema.parse({
        entryPath: path,
        exportName: contract.name,
        context: safeContext,
        contract,
        modules,
        globals: backendModuleApi.globals,
        evaluationTimeoutMs: this.nativeRuntimeConfig.evaluationTimeoutMs,
      }) satisfies NativeWorkerRequest;
      const encoded = JSON.stringify(copyHostJsonValue(request, "worker request", new WeakSet()));
      if (Buffer.byteLength(encoded, "utf8") > this.nativeRuntimeConfig.maxInputBytes)
        throw moduleRuntimeError(versionId, path, `The invocation exceeds the configured ${this.nativeRuntimeConfig.maxInputBytes}-byte input limit.`);
      return runNativeModuleWorker(
        encoded,
        this.nativeRuntimeConfig,
        versionId,
        path,
        contract.name,
        this.spawnWorker,
      );
    };

    const exported: Record<string, unknown> = {};
    Object.defineProperty(exported, contract.name, {
      enumerable: true,
      value: async (...args: unknown[]) => {
        if (args.length !== 1)
          throw moduleRuntimeError(versionId, path, `${contract.name}() requires exactly one context argument.`);
        const context = args[0];
        if (nodeTypes.isProxy(context))
          throw moduleRuntimeError(versionId, path, `${contract.name}() context must not be a Proxy.`);
        if (!context || typeof context !== "object" || Array.isArray(context))
          throw moduleRuntimeError(versionId, path, `${contract.name}() requires a JSON object context.`);
        return invoke(context);
      },
    });
    return exported;
  }
}

function serializeModuleContext(
  versionId: string,
  path: string,
  contract: NativeModuleContract,
  input: unknown,
): Record<string, unknown> {
  if (nodeTypes.isProxy(input))
    throw moduleRuntimeError(versionId, path, `${contract.name}() context must not be a Proxy.`);
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw moduleRuntimeError(versionId, path, `${contract.name}() requires a JSON object context.`);
  const record = input as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!contract.contextFields.includes(key))
      throw moduleRuntimeError(versionId, path, `${contract.name}() context field ${key} is not in the registered API contract.`);
  }
  let safeRecord: Record<string, unknown>;
  try {
    safeRecord = copyHostJsonValue(record, "context", new WeakSet()) as Record<string, unknown>;
  } catch (cause) {
    throw moduleRuntimeError(versionId, path, `${contract.name}() context must contain JSON-compatible data only.`, cause);
  }
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(safeRecord);
  } catch (cause) {
    throw moduleRuntimeError(versionId, path, `${contract.name}() context must contain JSON data only.`, cause);
  }
  if (encoded === undefined)
    throw moduleRuntimeError(versionId, path, `${contract.name}() context must contain JSON data only.`);
  return safeRecord;
}

function copyHostJsonValue(value: unknown, path: string, active: WeakSet<object>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0))
      throw new TypeError(`${path} contains a number that JSON.stringify would change.`);
    return value;
  }
  if (typeof value !== "object")
    throw new TypeError(`${path} contains ${typeof value}, which JSON.stringify would drop or change.`);
  if (nodeTypes.isProxy(value)) throw new TypeError(`${path} must not be a Proxy.`);
  if (active.has(value)) throw new TypeError(`${path} contains a circular reference.`);
  const prototype = Object.getPrototypeOf(value);
  const array = Array.isArray(value);
  if (!array && prototype !== null && prototype !== Object.prototype && !isPlainObjectPrototype(prototype)) {
    throw new TypeError(`${path} is not a plain JSON object.`);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key === "symbol"))
    throw new TypeError(`${path} contains symbol properties that JSON.stringify would drop.`);
  active.add(value);
  try {
    if (array) {
      const source = value as unknown[];
      const result: unknown[] = [];
      for (let index = 0; index < source.length; index += 1) {
        if (!ownKeys.includes(String(index))) throw new TypeError(`${path}[${index}] is an array hole.`);
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor))
          throw new TypeError(`${path}[${index}] must be an enumerable data property.`);
        result.push(copyHostJsonValue(descriptor.value, `${path}[${index}]`, active));
      }
      for (const key of ownKeys) {
        if (key === "length") continue;
        if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= source.length)
          throw new TypeError(`${path} contains non-index array properties.`);
      }
      Object.setPrototypeOf(result, null);
      return result;
    }
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of ownKeys) {
      if (typeof key !== "string") throw new TypeError(`${path} contains a symbol property.`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor))
        throw new TypeError(`${path}.${key} must be an enumerable data property.`);
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        value: copyHostJsonValue(descriptor.value, `${path}.${key}`, active),
        writable: true,
      });
    }
    return result;
  } finally {
    active.delete(value);
  }
}

function isPlainObjectPrototype(value: object): boolean {
  if (nodeTypes.isProxy(value) || Object.getPrototypeOf(value) !== null) return false;
  const constructor = Object.getOwnPropertyDescriptor(value, "constructor")?.value;
  if (typeof constructor !== "function" || nodeTypes.isProxy(constructor)) return false;
  return (
    Object.getOwnPropertyDescriptor(constructor, "name")?.value === "Object" &&
    Object.getOwnPropertyDescriptor(constructor, "prototype")?.value === value
  );
}

async function runNativeModuleWorker(
  encodedRequest: string,
  config: NativeModuleRuntimeConfig,
  versionId: string,
  path: string,
  exportName: string,
  spawnWorker: NativeWorkerSpawner,
): Promise<unknown> {
  const releaseWorker = reserveNativeWorker(versionId, path, exportName);
  try {
    return await runNativeModuleWorkerProcess(
      encodedRequest,
      config,
      versionId,
      path,
      exportName,
      spawnWorker,
    );
  } finally {
    releaseWorker();
  }
}

function reserveNativeWorker(
  versionId: string,
  path: string,
  exportName: string,
): () => void {
  if (activeNativeWorkers >= processWorkerLimit)
    throw moduleRuntimeError(
      versionId,
      path,
      `${exportName}() was rejected because the configured limit of ${processWorkerLimit} concurrent native module workers is already in use.`,
    );
  activeNativeWorkers += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeNativeWorkers -= 1;
  };
}

async function runNativeModuleWorkerProcess(
  encodedRequest: string,
  config: NativeModuleRuntimeConfig,
  versionId: string,
  path: string,
  exportName: string,
  spawnWorker: NativeWorkerSpawner,
): Promise<unknown> {
  const args = [
    "--input-type=module",
    "--experimental-vm-modules",
    "--permission",
    `--max-old-space-size=${config.maxOldGenerationSizeMb}`,
    "-e",
    nativeModuleWorkerSource,
  ];
  return new Promise((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawnWorker(process.execPath, args, {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        env: {},
      }) as ChildProcessWithoutNullStreams;
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      reject(moduleRuntimeError(
        versionId,
        path,
        `${exportName}() could not start the restricted native module process: ${detail}`,
        cause,
      ));
      return;
    }
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let totalOutputBytes = 0;
    let timedOut = false;
    let outputLimitExceeded = false;
    let spawnError: Error | undefined;
    let inputError: Error | undefined;
    let timer: NodeJS.Timeout | undefined;

    const stopChild = () => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    };
    const appendOutput = (target: Buffer[], chunk: Buffer) => {
      totalOutputBytes += chunk.byteLength;
      if (totalOutputBytes > config.maxBufferBytes) {
        outputLimitExceeded = true;
        stopChild();
        return;
      }
      target.push(chunk);
    };

    child.stdout.on("data", (chunk: Buffer) => appendOutput(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => appendOutput(stderr, chunk));
    child.on("error", (error) => {
      spawnError = error;
    });
    child.stdin.on("error", (error) => {
      inputError = error;
      stopChild();
    });
    timer = setTimeout(() => {
      timedOut = true;
      stopChild();
    }, config.timeoutMs);
    child.once("close", (status, signal) => {
      if (timer) clearTimeout(timer);
      const stdoutText = Buffer.concat(stdout).toString("utf8");
      const stderrText = Buffer.concat(stderr).toString("utf8");
      const fail = (detail: string, cause?: unknown) => {
        reject(moduleRuntimeError(
          versionId,
          path,
          `${exportName}() failed in the restricted native module process: ${detail}`,
          cause,
        ));
      };
      if (timedOut) {
        fail(`Execution exceeded the configured ${config.timeoutMs}-millisecond limit.`);
        return;
      }
      if (outputLimitExceeded) {
        fail(`Output exceeded the configured ${config.maxBufferBytes}-byte limit.`);
        return;
      }
      if (spawnError) {
        fail(`Could not start the restricted native module process: ${spawnError.message}`, spawnError);
        return;
      }
      if (inputError) {
        fail(`The restricted native module process input failed: ${inputError.message}`, inputError);
        return;
      }
      let result: NativeModuleWorkerResponse;
      try {
        result = nativeModuleWorkerResponseSchema.parse(JSON.parse(stdoutText));
      } catch (cause) {
        const detail = stderrText.trim().slice(-2000) || `Worker exited with status ${status}${signal ? ` (${signal})` : ""}.`;
        fail(`The restricted native module process returned an invalid response: ${detail}`, cause);
        return;
      }
      if (!result.ok || status !== 0) {
        fail(result.ok ? `worker exited with status ${status}${signal ? ` (${signal})` : ""}` : result.error);
        return;
      }
      try {
        resolve(JSON.parse(result.value) as unknown);
      } catch (cause) {
        reject(moduleRuntimeError(versionId, path, `${exportName}() returned invalid JSON data.`, cause));
      }
    });
    child.stdin.end(encodedRequest, "utf8");
  });
}

function moduleRuntimeError(
  versionId: string,
  path: string,
  message: string,
  cause?: unknown,
): Error {
  return new Error(`Native role module ${versionId}/${path}: ${message}`, { cause });
}
