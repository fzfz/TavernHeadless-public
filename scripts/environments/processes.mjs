import { execFile, spawn } from "node:child_process";
import { openSync, closeSync } from "node:fs";
import {
  mkdir,
  readFile,
  realpath,
  readlink,
  rm,
  stat,
} from "node:fs/promises";
import { request } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { Transform } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { setTimeout as delay } from "node:timers/promises";
import { EnvironmentError } from "./errors.mjs";
import { writeNginxConfig } from "./nginx.mjs";

const execute = promisify(execFile);
const runnerPath = fileURLToPath(
  new URL("./process-runner.mjs", import.meta.url),
);

function interrupted(details = {}) {
  return new EnvironmentError("环境操作已中断，请查询环境状态。", 130, details);
}

function throwIfInterrupted(signal) {
  if (signal?.aborted) throw interrupted();
}

function conflict(env, reason, details) {
  return new EnvironmentError(
    `${reason}。请执行 node scripts/environments/cli.mjs status --env ${env.name}。`,
    4,
    details,
  );
}

export function createProcessLogRedactor(values) {
  const secrets = [...values]
    .filter(Boolean)
    .flatMap((value) => [value, JSON.stringify(value).slice(1, -1)])
    .sort((a, b) => b.length - a.length);
  const maximum = Math.max(1, ...secrets.map((value) => value.length));
  const decoder = new StringDecoder("utf8");
  let pending = "";
  function drain(final) {
    let output = "";
    while (pending.length && (final || pending.length >= maximum)) {
      const secret = secrets.find((value) => pending.startsWith(value));
      output += secret ? "[REDACTED]" : pending[0];
      pending = pending.slice(secret ? secret.length : 1);
    }
    return output;
  }
  return new Transform({
    transform(chunk, _encoding, callback) {
      pending += decoder.write(chunk);
      callback(null, drain(false));
    },
    flush(callback) {
      pending += decoder.end();
      callback(null, drain(true));
    },
  });
}

export function processRecordPath(env) {
  return join(env.paths.run, env.files.processIdentity);
}

async function readRecord(env) {
  try {
    const record = JSON.parse(await readFile(processRecordPath(env), "utf8"));
    if (
      !record.startId ||
      !Number.isSafeInteger(record.runner?.pid) ||
      record.runner.pgid !== record.runner.pid ||
      record.runner.uid !== process.getuid() ||
      !record.components ||
      !record.configuration
    ) {
      throw conflict(env, "进程记录缺少有效身份字段");
    }
    return record;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw conflict(env, "进程记录无法读取", { path: processRecordPath(env) });
  }
}

async function readProcessIdentity(pid) {
  let output;
  try {
    ({ stdout: output } = await execute(
      "ps",
      [
        "-ww",
        "-p",
        String(pid),
        "-o",
        "pid=,pgid=,uid=,lstart=,stat=,command=",
      ],
      { env: { ...process.env, LC_ALL: "C" } },
    ));
  } catch (error) {
    if (error.code === 1) return null;
    throw error;
  }
  const match = output
    .trim()
    .match(
      /^(\d+)\s+(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(\S+)\s+(.+)$/,
    );
  if (!match || /^[ZX]/.test(match[5])) return null;
  return {
    pid: Number(match[1]),
    pgid: Number(match[2]),
    uid: Number(match[3]),
    startTime: match[4].replace(/\s+/g, " "),
    command: match[6],
  };
}

export async function inspectProcess(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  let identity = await readProcessIdentity(pid);
  if (!identity) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    let cwd;
    let executable;
    let startTime = identity.startTime;
    try {
      if (process.platform === "linux") {
        cwd = await readlink(`/proc/${pid}/cwd`);
        executable = await readlink(`/proc/${pid}/exe`);
        const stat = await readFile(`/proc/${pid}/stat`, "utf8");
        startTime += `:${stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]}`;
      } else {
        const { stdout } = await execute("lsof", [
          "-a",
          "-p",
          String(pid),
          "-d",
          "cwd",
          "-Fn",
        ]);
        cwd = stdout
          .split("\n")
          .find((line) => line.startsWith("n"))
          ?.slice(1);
        const result = await execute("ps", ["-p", String(pid), "-o", "comm="]);
        executable = result.stdout.trim();
      }
    } catch (error) {
      if (["ENOENT", "ESRCH"].includes(error.code) || error.code === 1)
        return null;
      throw error;
    }
    const confirmed = await readProcessIdentity(pid);
    if (!confirmed) return null;
    if (sameProcess(identity, confirmed))
      return { ...identity, startTime, cwd, executable };
    identity = confirmed;
  }
  throw new EnvironmentError(
    `进程 ${pid} 的身份已改变，请重新查询环境状态。`,
    4,
  );
}

export function sameProcess(expected, actual) {
  return (
    actual !== null &&
    ["pid", "pgid", "uid", "startTime", "command", "cwd", "executable"].every(
      (key) => expected[key] === actual[key],
    )
  );
}

export async function processGroupMembers(pgid) {
  const inspection = execute("ps", ["-axo", "pid=,pgid=,uid="]);
  const inspectionPid = inspection.child.pid;
  const { stdout } = await inspection;
  return stdout
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/).map(Number))
    .filter(([pid, group]) => group === pgid && pid !== inspectionPid)
    .map(([pid, group, uid]) => ({ pid, pgid: group, uid }));
}

export async function getListeningProcesses() {
  let output;
  try {
    ({ stdout: output } = await execute("lsof", [
      "-nP",
      "-iTCP",
      "-sTCP:LISTEN",
      "-Fpn",
    ]));
  } catch (error) {
    if (error.code === 1) return [];
    throw new EnvironmentError("无法读取 TCP 监听进程，请确认 lsof 可用。", 3);
  }
  let pid;
  return output.split("\n").flatMap((line) => {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    const port = line.startsWith("n") ? line.match(/:(\d+)$/) : null;
    return port ? [{ pid, port: Number(port[1]) }] : [];
  });
}

function expectedPorts(env) {
  return {
    api: [env.ports.api],
    nginx: env.frontends.map((name) => env.ports.frontends[name].http),
    ...(env.mode === "development"
      ? Object.fromEntries(
          env.frontends.map((name) => [name, [env.ports.frontends[name].dev]]),
        )
      : {}),
  };
}

async function configurationFile(path) {
  try {
    const actualPath = await realpath(path);
    const identity = await stat(actualPath);
    return {
      path: actualPath,
      ino: identity.ino,
      size: identity.size,
      mtimeMs: identity.mtimeMs,
    };
  } catch (error) {
    if (error.code === "ENOENT") return { path, missing: true };
    throw error;
  }
}

export async function processConfiguration(env) {
  return {
    root: env.root,
    processPrefix: env.processPrefix,
    mode: env.mode,
    hostname: env.hostname,
    listenHost: env.listenHost,
    gatewayListenHost: env.gatewayListenHost,
    hostAliases: env.hostAliases,
    sessionCookieName: env.sessionCookieName,
    sessionCookieSecure: env.sessionCookieSecure,
    ports: env.ports,
    tools: Object.fromEntries(
      ["node", "pnpm", "nginx"].map((name) => [
        name,
        { path: env.tools[name].path, version: env.tools[name].version },
      ]),
    ),
    files: {
      application: await configurationFile(env.paths.applicationEnv),
      secrets: await configurationFile(env.paths.secretsEnv),
    },
    release:
      env.mode === "release"
        ? await realpath(env.paths.current).catch(() => null)
        : null,
  };
}

async function probe(env, port, path, expectedStatus, signal) {
  return new Promise((resolve) => {
    const req = request(
      {
        hostname: env.listenHost,
        signal,
        port,
        path,
        headers: { Host: env.hostname },
        timeout: env.timeouts.probeSeconds * 1000,
      },
      (response) => {
        response.resume();
        resolve({
          port,
          path,
          ok: expectedStatus
            ? response.statusCode === expectedStatus
            : response.statusCode >= 200 && response.statusCode < 300,
          statusCode: response.statusCode,
        });
      },
    );
    req.on("error", () => resolve({ port, path, ok: false }));
    req.on("timeout", () => req.destroy());
    req.end();
  });
}

export async function getEnvironmentStatus(
  env,
  { probe: useProbes = true, signal } = {},
) {
  const record = await readRecord(env);
  const listening = await getListeningProcesses();
  const ports = expectedPorts(
    record
      ? {
          ...env,
          mode: record.configuration.mode,
          ports: record.configuration.ports,
        }
      : env,
  );
  const relevant = listening.filter((item) =>
    Object.values(ports).flat().includes(item.port),
  );
  const result = {
    environment: env.name,
    state: "stopped",
    components: {},
    health: useProbes ? [] : "not-checked",
    recordPath: processRecordPath(env),
    startId: record?.startId,
  };
  if (!record) {
    if (relevant.length) {
      result.state = "identity-conflict";
      result.listeners = relevant;
    }
    return result;
  }
  result.phase = record.phase;
  const configuration = await processConfiguration(env);
  if (record.environment !== env.name || record.root !== env.root) {
    result.state = "identity-conflict";
    result.reason = "environment-identity-changed";
    return result;
  }
  result.configurationChanged =
    JSON.stringify(configuration) !== JSON.stringify(record.configuration);
  let anyAlive = false;
  let identityConflict = false;
  const identities = { runner: record.runner, ...record.components };
  for (const [name, identity] of Object.entries(identities)) {
    if (!identity) {
      identityConflict = true;
      continue;
    }
    const actual = await inspectProcess(identity.pid);
    const matches = sameProcess(identity, actual);
    anyAlive ||= actual !== null;
    identityConflict ||= actual !== null && !matches;
    result.components[name] = {
      ...identity,
      alive: actual !== null,
      identityMatches: matches,
      listening: [],
      ...(actual && !matches ? { actual } : {}),
    };
  }
  for (const listener of relevant) {
    const owner = await inspectProcess(listener.pid);
    if (!owner) continue;
    const name = Object.keys(ports).find((name) =>
      ports[name].includes(listener.port),
    );
    const owned =
      owner &&
      owner.pgid === record.runner.pgid &&
      owner.uid === record.runner.uid;
    if (!owned) identityConflict = true;
    result.components[name] ??= {
      alive: false,
      identityMatches: false,
      listening: [],
    };
    result.components[name].listening.push({
      ...listener,
      owned: Boolean(owned),
    });
  }
  if (identityConflict) {
    result.state = "identity-conflict";
    return result;
  }
  const members = await processGroupMembers(record.runner.pgid);
  if (!anyAlive && members.length === 0 && relevant.length === 0) return result;
  const complete =
    result.components.runner?.identityMatches &&
    Object.entries(ports).every(
      ([name, expected]) =>
        result.components[name]?.identityMatches &&
        expected.every((port) =>
          result.components[name].listening.some(
            (listener) => listener.port === port && listener.owned,
          ),
        ),
    );
  result.state =
    complete && record.phase === "running" && !result.configurationChanged
      ? "running"
      : "degraded";
  if (result.state === "running" && useProbes) {
    const tasks = [
      probe(env, env.ports.api, env.probes.api, undefined, signal),
    ];
    for (const frontend of env.frontends) {
      const port = env.ports.frontends[frontend].http;
      tasks.push(
        probe(env, port, env.probes.frontend, undefined, signal),
        probe(env, port, "/healthz", 204, signal),
        probe(env, port, `/api${env.probes.api}`, undefined, signal),
      );
    }
    result.health = await Promise.all(tasks);
    if (result.health.some((item) => !item.ok)) result.state = "degraded";
  }
  return result;
}

export async function assertEnvironmentStopped(env) {
  const status = await getEnvironmentStatus(env, { probe: false });
  if (status.state !== "stopped")
    throw conflict(env, "目标环境仍有进程或端口冲突", status);
  return status;
}

async function discardStoppedRecord(env) {
  const record = await readRecord(env);
  if (!record) return;
  await assertEnvironmentStopped(env);
  const current = await readRecord(env);
  if (current?.startId !== record.startId)
    throw conflict(env, "进程记录在操作期间发生变化");
  await rm(processRecordPath(env));
}

function commands(env) {
  const api =
    env.mode === "development"
      ? {
          command: env.tools.node.path,
          args: [
            "--conditions=development",
            "--import",
            "tsx",
            "--watch",
            "src/index.ts",
          ],
          cwd: join(env.sourceRoot, "apps/api"),
        }
      : {
          command: env.tools.node.path,
          args: [join(env.paths.current, "api/dist/index.js")],
          cwd: join(env.paths.current, "api"),
        };
  const result = [
    { name: "api", ...api, env: env.runtimeEnv, ports: [env.ports.api] },
  ];
  if (env.mode === "development") {
    const allowedHosts = JSON.stringify([
      ...new Set([env.hostname, ...env.hostAliases]),
    ]);
    for (const name of env.frontends) {
      const ports = env.ports.frontends[name];
      result.push({
        name,
        command: env.tools.pnpm.path,
        args: ["exec", "vite"],
        cwd: join(env.sourceRoot, "apps", name),
        ports: [ports.dev],
        env: {
          ...env.hostEnv,
          TAVERN_VITE_HOST: env.listenHost,
          TAVERN_VITE_PORT: String(ports.dev),
          TAVERN_HMR_HOST: env.hostname,
          TAVERN_ALLOWED_HOSTS: allowedHosts,
          TAVERN_HMR_PORT: String(ports.http),
          TAVERN_ENVIRONMENT: env.name,
        },
      });
    }
  }
  result.push({
    name: "nginx",
    command: env.tools.nginx.path,
    args: ["-p", `${env.paths.run}/`, "-c", env.paths.nginxConfig],
    cwd: env.root,
    env: env.hostEnv,
    ports: env.frontends.map((name) => env.ports.frontends[name].http),
    testArgs: ["-t", "-p", `${env.paths.run}/`, "-c", env.paths.nginxConfig],
  });
  return result;
}

async function cleanStartedGroup(env, startId, spawnedRunner) {
  const record = await readRecord(env).catch(() => null);
  const matching = record?.startId === startId;
  const runner = matching ? record.runner : spawnedRunner;
  if (!runner) return;
  const identities = matching
    ? [runner, ...Object.values(record.components)]
    : [runner];
  const active = await Promise.all(
    identities.map(async (identity) => ({
      identity,
      actual: await inspectProcess(identity.pid),
    })),
  );
  if (
    active.some(
      ({ identity, actual }) => actual && !sameProcess(identity, actual),
    )
  )
    throw conflict(env, "启动清理期间进程身份发生变化");
  const members = await processGroupMembers(runner.pgid);
  if (members.length === 0) return;
  if (members.some((member) => member.uid !== runner.uid))
    throw conflict(env, "启动清理无法确认进程组归属");
  if (!active.some(({ identity, actual }) => sameProcess(identity, actual))) {
    const deadline = Date.now() + env.timeouts.stopSeconds * 1000;
    while (
      (await processGroupMembers(runner.pgid)).length &&
      Date.now() < deadline
    )
      await delay(env.timeouts.pollMs);
    if ((await processGroupMembers(runner.pgid)).length)
      throw conflict(env, "启动清理无法确认进程组归属");
    return;
  }
  try {
    process.kill(-runner.pgid, "SIGTERM");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
  const deadline = Date.now() + env.timeouts.stopSeconds * 1000;
  while (
    (await processGroupMembers(runner.pgid)).length &&
    Date.now() < deadline
  )
    await delay(env.timeouts.pollMs);
  if ((await processGroupMembers(runner.pgid)).length) {
    const anchor = await Promise.all(
      identities.map(async (identity) =>
        sameProcess(identity, await inspectProcess(identity.pid)),
      ),
    );
    if (!anchor.some(Boolean))
      throw conflict(env, "启动清理无法再次确认进程组身份");
    process.kill(-runner.pgid, "SIGKILL");
    const forcedDeadline = Date.now() + env.timeouts.stopSeconds * 1000;
    while (
      (await processGroupMembers(runner.pgid)).length &&
      Date.now() < forcedDeadline
    )
      await delay(env.timeouts.pollMs);
    if ((await processGroupMembers(runner.pgid)).length)
      throw conflict(env, "启动清理等待超时");
  }
}

export async function startEnvironment(env, options = {}) {
  const signal = options.signal ?? env.signal;
  throwIfInterrupted(signal);
  if (
    env.mode === "release" &&
    (typeof env.runtimeEnv.APP_SECRETS_MASTER_KEY !== "string" ||
      !env.runtimeEnv.APP_SECRETS_MASTER_KEY.trim())
  ) {
    throw new EnvironmentError(
      `发布环境缺少 APP_SECRETS_MASTER_KEY。请填写 ${env.paths.secretsEnv} 后重试。`,
      3,
    );
  }
  const configuration = await processConfiguration(env);
  const initial = await getEnvironmentStatus(env, { signal });
  throwIfInterrupted(signal);
  if (initial.state === "running") return initial;
  if (initial.configurationChanged && initial.state !== "stopped")
    throw new EnvironmentError(
      `环境配置已变化。请执行 node scripts/environments/cli.mjs restart --env ${env.name}。`,
      4,
      initial,
    );
  if (initial.state !== "stopped")
    throw conflict(env, "目标环境尚未停止或身份冲突", initial);
  await discardStoppedRecord(env);
  await assertEnvironmentStopped(env);
  await mkdir(env.paths.run, { recursive: true });
  await mkdir(env.paths.processLogs, { recursive: true });
  const startId = randomUUID();
  const operationDirectory = join(
    env.paths.operations,
    options.operationId || startId,
  );
  await mkdir(operationDirectory, { recursive: true });
  const { runDatabaseCommand } = await import("./api-command.mjs");
  const database = await runDatabaseCommand(env, "status", {
    outputPath: join(operationDirectory, "database-status.json"),
    signal,
  });
  if (!database.ready)
    throw new EnvironmentError("数据库迁移尚未完成，请先执行 migrate。", 3);
  throwIfInterrupted(signal);
  await writeNginxConfig(env);
  throwIfInterrupted(signal);
  const log = openSync(join(env.paths.processLogs, "debug.log"), "a", 0o600);
  let child;
  try {
    child = spawn(env.tools.node.path, [runnerPath], {
      cwd: env.root,
      env: env.hostEnv,
      detached: true,
      stdio: ["ignore", log, log, "ipc"],
    });
  } finally {
    closeSync(log);
  }
  const deadline =
    Date.now() + (options.timeoutSeconds ?? env.timeouts.startSeconds) * 1000;
  const initialized = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) =>
      reject(
        new EnvironmentError(
          `环境进程启动失败，退出码为 ${code}。`,
          code === 4 ? 4 : 7,
        ),
      ),
    );
    child.on("message", (message) => {
      if (message.type === "ready") resolve();
      if (message.type === "failed")
        reject(new EnvironmentError(message.message, message.exitCode));
    });
  });
  initialized.catch(() => {});
  let runnerIdentity;
  let abortListener;
  try {
    while (!runnerIdentity && Date.now() < deadline) {
      runnerIdentity = await inspectProcess(child.pid);
      if (!runnerIdentity) {
        if (child.exitCode !== null || child.signalCode !== null)
          throw new EnvironmentError("Runner 在启动期间退出。", 7);
        await delay(env.timeouts.pollMs);
      }
    }
    if (!runnerIdentity)
      throw new EnvironmentError("无法核对 Runner 身份，请查询环境状态。", 7);
    throwIfInterrupted(signal);
    if (
      JSON.stringify(configuration) !==
      JSON.stringify(await processConfiguration(env))
    )
      throw conflict(env, "配置在启动期间发生变化");
    child.send({
      env: { ...env, runtimeEnv: undefined },
      commands: commands(env),
      startId,
      operationId: options.operationId,
      configuration,
    });
    let timer;
    try {
      await Promise.race([
        initialized,
        new Promise((_resolve, reject) => {
          abortListener = () => reject(interrupted());
          signal?.addEventListener("abort", abortListener, { once: true });
          if (signal?.aborted) abortListener();
        }),
        new Promise((_resolve, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new EnvironmentError("环境启动等待超时，请查看组件日志。", 7),
              ),
            Math.max(0, deadline - Date.now()),
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    while (Date.now() < deadline) {
      throwIfInterrupted(signal);
      const status = await getEnvironmentStatus(env, { signal });
      throwIfInterrupted(signal);
      if (
        status.startId !== startId ||
        status.state === "identity-conflict" ||
        status.configurationChanged
      )
        throw conflict(env, "启动期间进程记录或监听归属发生变化", status);
      if (status.state === "running") return status;
      if (status.phase === "failed" || status.state === "stopped")
        throw new EnvironmentError("组件在启动期间退出，请查看组件日志。", 7);
      await delay(env.timeouts.pollMs);
    }
    throw new EnvironmentError("环境启动等待超时，请查看组件日志。", 7);
  } catch (error) {
    const failure =
      signal?.aborted && error.exitCode !== 130
        ? interrupted({ cause: error.message })
        : error;
    await cleanStartedGroup(env, startId, runnerIdentity).catch(
      (cleanupError) => {
        failure.details = {
          ...failure.details,
          cleanupError: cleanupError.message,
        };
      },
    );
    throw failure;
  } finally {
    if (abortListener) signal?.removeEventListener("abort", abortListener);
    if (child.connected) child.disconnect();
    child.unref();
  }
}

function stoppedResult(status, signal) {
  if (signal?.aborted)
    throw interrupted({ state: "stopped", recordPath: status.recordPath });
  return status;
}

export async function requestComponentStop(env, record, deadline) {
  for (const name of ["nginx", "api", ...env.frontends]) {
    if (Date.now() >= deadline) return;
    const identity = record.components[name];
    if (!identity) continue;
    if (sameProcess(identity, await inspectProcess(identity.pid))) {
      try {
        process.kill(identity.pid, name === "nginx" ? "SIGQUIT" : "SIGTERM");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
    if (name === "nginx") {
      const ports = Object.values(record.configuration.ports.frontends).map(
        (frontend) => frontend.http,
      );
      while (
        Date.now() < deadline &&
        (await getListeningProcesses()).some((listener) =>
          ports.includes(listener.port),
        )
      )
        await delay(env.timeouts.pollMs);
    }
  }
}

export async function stopEnvironment(
  env,
  { force = false, signal = env.signal } = {},
) {
  const status = await getEnvironmentStatus(env, { probe: false });
  if (status.state === "identity-conflict")
    throw conflict(env, "进程身份或监听归属不符，停止操作已终止", status);
  if (status.state === "stopped") {
    await discardStoppedRecord(env);
    return stoppedResult(status, signal);
  }
  const record = await readRecord(env);
  const actual = await inspectProcess(record.runner.pid);
  if (actual && !sameProcess(record.runner, actual))
    throw conflict(env, "Runner 的进程身份已改变");
  const members = await processGroupMembers(record.runner.pgid);
  if (members.some((member) => member.uid !== record.runner.uid))
    throw conflict(env, "进程组包含其他用户的进程");
  if (!actual && members.length) {
    const anchors = await Promise.all(
      Object.values(record.components).map(async (identity) =>
        sameProcess(identity, await inspectProcess(identity.pid)),
      ),
    );
    if (!anchors.some(Boolean))
      throw conflict(env, "Runner 已退出，子进程身份无法确认");
  }
  const deadline = Date.now() + env.timeouts.stopSeconds * 1000;
  try {
    if (force) process.kill(-record.runner.pgid, "SIGKILL");
    else if (actual) process.kill(record.runner.pid, "SIGTERM");
    else await requestComponentStop(env, record, deadline);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
  while (Date.now() < deadline) {
    const latest = await getEnvironmentStatus(env, { probe: false });
    if (latest.state === "identity-conflict")
      throw conflict(env, "停止期间进程身份发生变化", latest);
    if (latest.state === "stopped") {
      await discardStoppedRecord(env);
      return stoppedResult(latest, signal);
    }
    await delay(env.timeouts.pollMs);
  }
  if (signal?.aborted)
    throw interrupted({
      state: "degraded",
      phase: (await readRecord(env))?.phase,
      recordPath: processRecordPath(env),
    });
  throw conflict(env, "环境停止等待超时，请核对状态后执行 stop --force");
}

export async function restartEnvironment(env, options = {}) {
  await stopEnvironment(env, options);
  return startEnvironment(env, options);
}
