import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { finished } from "node:stream/promises";
import { EnvironmentError } from "./errors.mjs";
import { createProcessLogRedactor } from "./processes.mjs";

export async function runDatabaseCommand(
  env,
  command,
  {
    outputPath,
    databasePath = env.paths.database,
    target,
    apiDirectory,
    dataDirectory,
    signal = env.signal,
  } = {},
) {
  if (!["status", "migrate", "backup"].includes(command) || !outputPath) {
    throw new EnvironmentError(
      "数据库命令需要 status、migrate 或 backup，以及 outputPath 绝对路径。",
      2,
    );
  }
  const development = env.mode === "development" && !apiDirectory;
  const cwd =
    apiDirectory ||
    (development
      ? join(env.sourceRoot, "apps/api")
      : join(env.paths.current, "api"));
  const entry = join(
    cwd,
    development
      ? "src/db/environment-command.ts"
      : "dist/db/environment-command.js",
  );
  try {
    await access(entry);
  } catch {
    throw new EnvironmentError(
      "数据库命令入口缺失，请先准备源码或部署完整发布产物。",
      3,
      { entry },
    );
  }
  outputPath = resolve(outputPath);
  await mkdir(dirname(outputPath), { recursive: true });
  await rm(outputPath, { force: true });
  const args = [
    ...(development ? ["--conditions=development", "--import", "tsx"] : []),
    entry,
    command,
    "--database",
    resolve(databasePath),
    "--output",
    outputPath,
    ...(target ? ["--target", resolve(target)] : []),
    ...(dataDirectory ? ["--data-directory", resolve(dataDirectory)] : []),
  ];
  const log = createWriteStream(`${outputPath}.log`, {
    flags: "a",
    mode: 0o600,
  });
  const logFinished = finished(log);
  logFinished.catch(() => {});
  const child = spawn(env.tools.node.path, args, {
    cwd,
    env: env.runtimeEnv,
    signal,
    stdio: ["ignore", "pipe", "pipe"],
  });
  log.on("error", () => child.kill("SIGTERM"));
  const outputs = [child.stdout, child.stderr].map((stream) =>
    stream.pipe(createProcessLogRedactor(env.secretValues || [])),
  );
  for (const output of outputs) output.pipe(log, { end: false });
  let spawnError;
  const exit = new Promise((resolve) => {
    child.once("error", (error) => {
      spawnError = error;
    });
    child.once("close", (code) => resolve(code));
  });
  const code = await exit;
  await Promise.all(outputs.map((output) => finished(output)));
  log.end();
  await logFinished;
  if (signal?.aborted || spawnError?.name === "AbortError") {
    let result;
    try {
      result = JSON.parse(await readFile(outputPath, "utf8"));
    } catch {
      result = { command, status: "interrupted", exitCode: 130 };
      await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, {
        mode: 0o600,
      });
    }
    throw new EnvironmentError("数据库操作已中断，请查看结果文件。", 130, {
      outputPath,
      logPath: `${outputPath}.log`,
      result,
    });
  }
  if (spawnError)
    throw new EnvironmentError(
      "无法运行数据库命令，请确认 Node 可执行文件。",
      3,
      { path: env.tools.node.path },
    );
  let result;
  try {
    result = JSON.parse(await readFile(outputPath, "utf8"));
  } catch {
    throw new EnvironmentError(
      "数据库命令未生成有效结果，请查看命令日志。",
      6,
      { logPath: `${outputPath}.log`, exitCode: code },
    );
  }
  if (
    code === 0 ||
    (command === "status" && code === 3 && result.ready === false)
  )
    return result;
  throw new EnvironmentError(
    "数据库命令执行失败，请查看结果文件与命令日志。",
    code === 3 ? 3 : 6,
    { outputPath, logPath: `${outputPath}.log`, exitCode: code, result },
  );
}
