import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readFile, rename, writeFile, link, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { finished } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";
import {
  inspectProcess,
  sameProcess,
  processGroupMembers,
  processRecordPath,
  createProcessLogRedactor,
  getListeningProcesses,
  requestComponentStop,
} from "./processes.mjs";

async function run({ env, commands, startId, operationId, configuration }) {
  const recordPath = processRecordPath(env);
  const runner = await inspectProcess(process.pid);
  const record = {
    environment: env.name,
    processPrefix: env.processPrefix,
    root: env.root,
    releaseId: configuration.release ? basename(configuration.release) : null,
    startId,
    operationId,
    configuration,
    phase: "starting",
    runner,
    components: {},
    exits: {},
  };
  const children = new Map();
  const logs = new Set();
  let saveSequence = Promise.resolve();
  let stopping = false;
  let phase = "starting";
  let ownsRecord = false;

  function save() {
    saveSequence = saveSequence
      .catch(() => {})
      .then(async () => {
        const current = JSON.parse(await readFile(recordPath, "utf8"));
        if (current.startId !== startId)
          throw new Error("进程记录已由另一次启动替换。");
        const temporary = `${recordPath}.${startId}.tmp`;
        await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, {
          mode: 0o600,
        });
        await rename(temporary, recordPath);
      });
    return saveSequence;
  }

  function logChild(child, name) {
    const log = createWriteStream(join(env.paths.processLogs, `${name}.log`), {
      flags: "a",
      mode: 0o600,
    });
    const outputs = [child.stdout, child.stderr].map((stream) =>
      stream.pipe(createProcessLogRedactor(env.secretValues || [])),
    );
    for (const output of outputs) output.pipe(log, { end: false });
    let pending = outputs.length;
    for (const output of outputs)
      output.once("end", () => {
        if (--pending === 0) log.end();
      });
    const written = finished(log).catch(() => {});
    logs.add(written);
    written.finally(() => logs.delete(written));
    log.on("error", () => shutdown("failed"));
  }

  async function shutdown(finalPhase = "stopped") {
    if (stopping) return;
    stopping = true;
    const deadline = Date.now() + env.timeouts.stopSeconds * 1000;
    record.phase = "stopping";
    if (ownsRecord) await save().catch(() => {});
    await requestComponentStop(env, record, deadline);
    for (const [name, child] of children) {
      if (!record.components[name]) continue;
      while (
        child.exitCode === null &&
        child.signalCode === null &&
        Date.now() < deadline
      )
        await delay(env.timeouts.pollMs);
      if (child.exitCode === null && child.signalCode === null) {
        record.phase = "stop-timeout";
        if (ownsRecord) await save().catch(() => {});
        stopping = false;
        return;
      }
    }
    const members = (await processGroupMembers(process.pid)).filter(
      (member) => member.pid !== process.pid,
    );
    if (members.every((member) => member.uid === runner.uid)) {
      for (const member of members) {
        try {
          process.kill(member.pid, "SIGTERM");
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
      }
    }
    while (
      (await processGroupMembers(process.pid)).some(
        (member) => member.pid !== process.pid,
      ) &&
      Date.now() < deadline
    )
      await delay(env.timeouts.pollMs);
    if (
      (await processGroupMembers(process.pid)).some(
        (member) => member.pid !== process.pid,
      )
    ) {
      record.phase = "stop-timeout";
      if (ownsRecord) await save().catch(() => {});
      stopping = false;
      return;
    }
    await Promise.all(logs);
    record.phase = finalPhase;
    if (ownsRecord) await save().catch(() => {});
    process.exit(finalPhase === "failed" ? 7 : 0);
  }

  process.on("SIGTERM", () => shutdown());
  process.on("SIGINT", () => shutdown());
  process.on("exit", () => {
    try {
      process.kill(-process.pid, "SIGTERM");
    } catch {
      /* The process group may already be empty. */
    }
  });
  try {
    const initialPath = `${recordPath}.${startId}.initial`;
    await writeFile(initialPath, `${JSON.stringify(record, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    try {
      await link(initialPath, recordPath);
      ownsRecord = true;
    } finally {
      await rm(initialPath, { force: true });
    }
    for (const spec of commands) {
      if (stopping) throw new Error("环境启动已被停止。");
      phase = spec.name;
      if (spec.testArgs) {
        const tested = spawn(spec.command, spec.testArgs, {
          cwd: spec.cwd,
          env: spec.env,
          stdio: ["ignore", "pipe", "pipe"],
        });
        logChild(tested, spec.name);
        const exit = await new Promise((resolve, reject) => {
          tested.once("error", reject);
          tested.once("exit", resolve);
        });
        if (exit !== 0)
          throw new Error("Nginx 配置测试失败，请查看 nginx.log。");
      }
      const child = spawn(spec.command, spec.args, {
        cwd: spec.cwd,
        env: spec.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      children.set(spec.name, child);
      logChild(child, spec.name);
      let failure;
      child.once("error", (error) => {
        failure = error;
      });
      child.once("exit", (code, signal) => {
        record.exits[spec.name] = { code, signal };
        if (stopping) return;
        if (record.phase === "running" || record.phase === "degraded") {
          record.phase = "degraded";
          save().catch(() => shutdown("failed"));
        } else {
          shutdown("failed");
        }
      });
      const deadline = Date.now() + env.timeouts.startSeconds * 1000;
      let identity;
      let previous;
      while (
        !identity &&
        Date.now() < deadline &&
        !failure &&
        child.exitCode === null &&
        child.signalCode === null &&
        !stopping
      ) {
        const listening = await getListeningProcesses();
        const owners = await Promise.all(
          listening
            .filter((item) => spec.ports.includes(item.port))
            .map(async (item) => ({
              ...item,
              owner: await inspectProcess(item.pid),
            })),
        );
        if (
          spec.ports.every((port) =>
            owners.some(
              (item) =>
                item.port === port &&
                item.owner?.pgid === process.pid &&
                item.owner.uid === runner.uid,
            ),
          )
        ) {
          const current = await inspectProcess(child.pid);
          if (previous && sameProcess(previous, current)) identity = current;
          previous = current;
        }
        if (!identity) await delay(env.timeouts.pollMs);
      }
      if (!identity || failure)
        throw new Error(`组件 ${spec.name} 无法启动，请查看组件日志。`);
      record.components[spec.name] = {
        ...identity,
        name: spec.name,
        executablePath: spec.command,
        workingDirectory: spec.cwd,
        release: configuration.release,
      };
      await save();
    }
    if (stopping) throw new Error("环境启动已被停止。");
    record.phase = "running";
    await save();
    if (process.connected) process.send({ type: "ready" }, () => {});
  } catch (error) {
    record.failure = { phase, message: error.message };
    if (process.connected)
      process.send(
        {
          type: "failed",
          message:
            error.code === "EEXIST"
              ? "目标环境已有进程身份记录，请查询环境状态。"
              : error.message,
          exitCode: error.code === "EEXIST" ? 4 : 7,
        },
        () => {},
      );
    await shutdown("failed");
  }
}

process.once("message", (message) => {
  run(message).catch(() => {
    try {
      process.kill(-process.pid, "SIGTERM");
    } catch {
      /* The process group may already be empty. */
    }
    process.exit(7);
  });
});
