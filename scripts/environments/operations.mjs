import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  stat,
  writeFile,
  rm,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { loadEnvironment, assertOwnedPath } from "./config.mjs";
import { EnvironmentError } from "./errors.mjs";
import { verifyTools } from "./tools.mjs";
import { writePublicConfiguration } from "./public-config.mjs";

function redact(value, secrets) {
  const patterns = [...secrets]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  return JSON.stringify(value, (_key, field) => {
    if (typeof field !== "string") return field;
    for (const secret of patterns)
      field = field.split(secret).join("[REDACTED]");
    return field;
  });
}

async function readLogs(env, options) {
  let path;
  if (options.component === "operations") {
    let operation = options.operation;
    if (!operation) {
      const entries = await readdir(env.paths.operations, {
        withFileTypes: true,
      }).catch((error) => {
        if (error.code === "ENOENT") return [];
        throw error;
      });
      operation = entries
        .filter(
          (entry) => entry.isDirectory() && entry.name !== options.operationId,
        )
        .map((entry) => entry.name)
        .sort()
        .at(-1);
    }
    if (!operation)
      throw new EnvironmentError(
        "尚无操作日志。请先执行 status --env " + env.name + "。",
        3,
      );
    path = join(env.paths.operations, operation, "result.json");
  } else if (options.component === "debug")
    path = join(env.paths.processLogs, "debug");
  else
    path = join(
      env.paths.processLogs,
      options.component === "nginx"
        ? "nginx-error.log"
        : `${options.component}.log`,
    );
  await assertOwnedPath(env.root, path);
  let metadata;
  try {
    metadata = await stat(path);
  } catch {
    throw new EnvironmentError(`日志尚不存在：${path}`, 3);
  }
  if (options.follow) {
    if (!metadata.isFile())
      throw new EnvironmentError(
        "--follow 需要单个日志文件，请选择 api、nginx、web、user-web、studio 或指定操作。",
        2,
      );
    let offset = 0;
    while (!options.signal?.aborted) {
      const size = (await stat(path)).size;
      if (size < offset) offset = 0;
      if (size > offset) {
        for await (const chunk of createReadStream(path, {
          start: offset,
          end: size - 1,
        }))
          process.stdout.write(chunk);
        offset = size;
      }
      await delay(250, undefined, { signal: options.signal });
    }
  }
  return { path, bytes: metadata.size };
}

async function dispatch(env, command, options) {
  if (["start", "restart", "build", "migrate", "restore"].includes(command))
    await verifyTools(
      env,
      command === "start" || command === "restart"
        ? undefined
        : ["node", "pnpm"],
    );
  if (["start", "restart"].includes(command))
    await writePublicConfiguration(env);
  if (["start", "stop", "restart", "status"].includes(command)) {
    const processes = await import("./processes.mjs");
    const methods = {
      start: "startEnvironment",
      stop: "stopEnvironment",
      restart: "restartEnvironment",
      status: "getEnvironmentStatus",
    };
    return processes[methods[command]](env, options);
  }
  if (command === "init")
    return (await import("./initialize.mjs")).initializeEnvironment(
      env,
      options,
    );
  if (command === "logs") return readLogs(env, options);
  if (command === "verify")
    return (await import("./verify.mjs")).verifyEnvironment(env, options);
  if (["build", "deploy", "rollback"].includes(command)) {
    const release = await import("./release.mjs");
    return release[
      {
        build: "buildRelease",
        deploy: "deployRelease",
        rollback: "rollbackRelease",
      }[command]
    ](env, options);
  }
  const data = await import("./data.mjs");
  return data[
    {
      migrate: "migrateEnvironment",
      backup: "backupEnvironment",
      restore: "restoreEnvironment",
    }[command]
  ](env, options);
}

export async function executeCommand(command, options) {
  const env = await loadEnvironment(options.env, {
    sandboxRoot: options.sandbox,
  });
  if (
    !env.sandbox &&
    resolve(env.sourceRoot) !== resolve(env.configuration.environments.dev.root)
  ) {
    throw new EnvironmentError(
      `请从 ${env.configuration.environments.dev.root} 的统一入口执行实际环境命令。独立 worktree 验证请使用 --sandbox <绝对目录>。`,
      3,
    );
  }
  const operationId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`;
  const finalDirectory = await assertOwnedPath(
    env.root,
    join(env.paths.operations, operationId),
  );
  const initialized = await access(join(env.root, ".git")).then(
    () => true,
    () => false,
  );
  const outputDirectory =
    command === "init" || (!initialized && ["status", "logs"].includes(command))
      ? await mkdtemp(join(tmpdir(), `tavern-${command}-`))
      : finalDirectory;
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  const startedAt = new Date().toISOString();
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  let result,
    exitCode = 0;
  try {
    result = await dispatch(env, command, {
      ...options,
      operationId,
      outputDirectory,
      signal: controller.signal,
    });
    if (result?.state === "degraded") exitCode = 7;
    if (result?.state === "identity-conflict") exitCode = 4;
    if (controller.signal.aborted) exitCode = 130;
  } catch (error) {
    exitCode = controller.signal.aborted ? 130 : (error.exitCode ?? 3);
    result = { error: error.message, details: error.details };
    process.stderr.write(
      JSON.parse(redact(error.message, env.secretValues)) + "\n",
    );
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
  }
  const status = exitCode === 0 ? "passed" : "failed";
  const resultDirectory =
    command === "init" && exitCode === 0 ? finalDirectory : outputDirectory;
  await mkdir(resultDirectory, { recursive: true, mode: 0o700 });
  if (resultDirectory !== outputDirectory)
    await rm(outputDirectory, { recursive: true });
  const resultPath = join(resultDirectory, "result.json");
  await writeFile(
    resultPath,
    redact(
      {
        schemaVersion: 1,
        operationId,
        environment: env.name,
        command,
        startedAt,
        finishedAt: new Date().toISOString(),
        status,
        exitCode,
        result,
      },
      env.secretValues,
    ) + "\n",
    { mode: 0o600 },
  );
  return { operationId, status, exitCode, resultPath };
}
