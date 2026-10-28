import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { createGunzip } from "node:zlib";
import {
  access,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { finished } from "node:stream/promises";

import { runDatabaseCommand } from "./api-command.mjs";
import { assertOwnedPath } from "./config.mjs";
import { EnvironmentError } from "./errors.mjs";
import { readInstallationRequirements } from "./installation-approval.mjs";
import { writePublicConfiguration } from "./public-config.mjs";
import {
  assertEnvironmentStopped,
  createProcessLogRedactor,
  processGroupMembers,
} from "./processes.mjs";

export function assertNotAborted(signal) {
  if (signal?.aborted)
    throw new EnvironmentError("操作已中断，请查看阶段记录后再重试。", 130);
}

export function assertIdentifier(value, field = "release") {
  if (
    typeof value !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)
  ) {
    throw new EnvironmentError(
      `${field} 需要字母、数字、点、下划线或短横线，且必须以字母或数字开头。`,
      2,
    );
  }
  return value;
}

export async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new EnvironmentError(
      "记录文件缺失或 JSON 无效，请核对记录路径。",
      3,
      { path, reason: error.code ?? error.name },
    );
  }
}

export async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  await rename(temporary, path);
}

export async function beginOperation(
  env,
  operation,
  operationId = randomUUID(),
) {
  assertIdentifier(operationId, "operationId");
  const directory = join(env.paths.operations, operationId);
  await assertOwnedPath(env.root, directory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const work = await mkdtemp(join(directory, `${operation}-`));
  const result = {
    operationId,
    operation,
    environment: env.name,
    startedAt: new Date().toISOString(),
    work,
    stages: [],
  };
  const path = join(work, "stages.json");
  const stage = async (name, action) => {
    assertNotAborted(env.signal);
    const entry = {
      name,
      status: "running",
      startedAt: new Date().toISOString(),
    };
    result.stages.push(entry);
    await writeJson(path, result);
    try {
      const value = await action();
      assertNotAborted(env.signal);
      entry.status = "passed";
      return value;
    } catch (error) {
      entry.status = "failed";
      entry.error = error.message;
      throw error;
    } finally {
      entry.finishedAt = new Date().toISOString();
      await writeJson(path, result);
    }
  };
  await writeJson(path, result);
  return { ...result, path, stage };
}

export async function runCommand(
  env,
  file,
  args,
  {
    cwd,
    logPath,
    input,
    environment = env.hostEnv,
    timeout,
    signal = env.signal,
  } = {},
) {
  assertNotAborted(signal);
  await mkdir(dirname(logPath), { recursive: true, mode: 0o700 });
  const log = createWriteStream(logPath, { flags: "a", mode: 0o600 });
  const detached = process.platform !== "win32";
  const child = spawn(file, args, {
    cwd,
    env: environment,
    detached,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  let captured = "",
    spawnError,
    closed = false,
    terminationTask,
    deadline;
  const terminate = () => {
    if (closed || !child.pid || terminationTask) return;
    terminationTask = (async () => {
      const members = async () => {
        const group = detached
          ? await processGroupMembers(child.pid)
          : child.exitCode === null
            ? [{ uid: process.getuid?.() }]
            : [];
        if (group.some((member) => member.uid !== process.getuid?.()))
          throw new EnvironmentError(
            "子进程组的用户身份发生变化，请检查操作日志。",
            4,
            { pid: child.pid },
          );
        return group;
      };
      const send = (signalName) => {
        try {
          if (detached) process.kill(-child.pid, signalName);
          else child.kill(signalName);
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
      };
      if ((await members()).length === 0) return;
      send("SIGTERM");
      const until = Date.now() + env.timeouts.stopSeconds * 1000;
      while ((await members()).length && Date.now() < until)
        await new Promise((resolveWait) =>
          setTimeout(resolveWait, env.timeouts.pollMs),
        );
      if ((await members()).length) send("SIGKILL");
      const forceUntil = Date.now() + env.timeouts.stopSeconds * 1000;
      while ((await members()).length && Date.now() < forceUntil)
        await new Promise((resolveWait) =>
          setTimeout(resolveWait, env.timeouts.pollMs),
        );
      if ((await members()).length)
        throw new EnvironmentError(
          "本次命令的子进程组尚未全部退出，请检查操作日志。",
          4,
          { pid: child.pid },
        );
    })();
    terminationTask.catch((error) => {
      spawnError = error;
    });
  };
  signal?.addEventListener("abort", terminate, { once: true });
  if (signal?.aborted) terminate();
  if (timeout) deadline = setTimeout(terminate, timeout);
  if (input !== undefined) {
    child.stdin.on("error", (error) => {
      if (error.code !== "EPIPE") spawnError = error;
    });
    child.stdin.end(input);
  }
  child.stdout.on("data", (chunk) => {
    if (captured.length < 1_048_576) captured += chunk.toString();
  });
  const streams = [child.stdout, child.stderr].map((stream) =>
    stream.pipe(createProcessLogRedactor(env.secretValues ?? [])),
  );
  for (const stream of streams) stream.pipe(log, { end: false });
  try {
    const code = await new Promise((resolveExit) => {
      child.once("error", (error) => {
        spawnError = error;
      });
      child.once("close", (code) => {
        closed = true;
        resolveExit(code);
      });
    });
    await Promise.all(streams.map((stream) => finished(stream)));
    log.end();
    await finished(log);
    if (terminationTask) await terminationTask;
    assertNotAborted(signal);
    if (spawnError || code !== 0)
      throw new EnvironmentError("命令执行失败，请查看操作日志后重试。", 5, {
        file,
        args,
        logPath,
        exitCode: code,
        reason: spawnError?.code,
      });
    return captured.trim();
  } finally {
    signal?.removeEventListener("abort", terminate);
    clearTimeout(deadline);
    if (!log.writableEnded) log.end();
  }
}

function assertRelativePath(path) {
  if (
    typeof path !== "string" ||
    !path ||
    path.includes("\0") ||
    path.includes("\\") ||
    isAbsolute(path) ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new EnvironmentError("产物文件路径必须位于发布目录内。", 5, { path });
  }
}

export async function inventoryDirectory(
  root,
  { exclude = [], allowExternalSymlinks = false } = {},
) {
  const files = [];
  async function walk(directory) {
    for (const name of (await readdir(directory)).sort()) {
      const path = join(directory, name),
        itemPath = relative(root, path);
      if (exclude.includes(itemPath)) continue;
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) {
        const target = await readlink(path);
        if (!allowExternalSymlinks && isAbsolute(target))
          throw new EnvironmentError(
            "产物符号链接必须使用目录内的相对路径。",
            5,
            { path: itemPath, target },
          );
        if (!allowExternalSymlinks) await assertOwnedPath(root, path);
        files.push({ path: itemPath, type: "symlink", target });
      } else if (stat.isDirectory()) await walk(path);
      else if (stat.isFile())
        files.push({ path: itemPath, type: "file", bytes: stat.size });
      else
        throw new EnvironmentError("产物包含不支持的文件类型。", 5, {
          path: itemPath,
        });
    }
  }
  await walk(root);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export async function sameFile(first, second) {
  const [left, right] = await Promise.all([open(first), open(second)]);
  try {
    const [leftStat, rightStat] = await Promise.all([
      left.stat(),
      right.stat(),
    ]);
    if (leftStat.size !== rightStat.size) return false;
    const a = Buffer.alloc(65536),
      b = Buffer.alloc(65536);
    for (let offset = 0; offset < leftStat.size; offset += a.length) {
      const count = Math.min(a.length, leftStat.size - offset);
      const [ra, rb] = await Promise.all([
        left.read(a, 0, count, offset),
        right.read(b, 0, count, offset),
      ]);
      if (
        ra.bytesRead !== count ||
        rb.bytesRead !== count ||
        !a.subarray(0, count).equals(b.subarray(0, count))
      )
        return false;
    }
    return true;
  } finally {
    await Promise.all([left.close(), right.close()]);
  }
}

export async function verifyInventory(root, expected, { exclude = [] } = {}) {
  if (!Array.isArray(expected))
    throw new EnvironmentError("发布清单缺少文件列表。", 5);
  const names = new Set();
  for (const item of expected) {
    assertRelativePath(item.path);
    if (
      names.has(item.path) ||
      !["file", "symlink"].includes(item.type) ||
      (item.type === "file" &&
        (!Number.isSafeInteger(item.bytes) || item.bytes < 0))
    )
      throw new EnvironmentError("发布清单包含重复路径或无效文件记录。", 5, {
        path: item.path,
      });
    names.add(item.path);
  }
  const actual = await inventoryDirectory(root, { exclude });
  const normalized = expected.map((item) =>
    item.type === "file"
      ? { path: item.path, type: item.type, bytes: item.bytes }
      : { path: item.path, type: item.type, target: item.target },
  );
  if (
    JSON.stringify(actual) !==
    JSON.stringify(normalized.sort((a, b) => a.path.localeCompare(b.path)))
  )
    throw new EnvironmentError(
      "目录文件与清单不一致，请重新准备原始归档。",
      5,
      { root },
    );
}

async function compareDirectories(first, second, files) {
  for (const item of files) {
    if (
      item.type === "file" &&
      !(await sameFile(join(first, item.path), join(second, item.path)))
    )
      throw new EnvironmentError("发布文件字节与原始归档不一致。", 5, {
        path: item.path,
      });
  }
}

function validateManifest(manifest, release) {
  if (
    manifest.version !== 1 ||
    manifest.release !== release ||
    !/^[a-f0-9]{40,64}$/.test(manifest.commit ?? "") ||
    !manifest.ref ||
    !Array.isArray(manifest.migrationSequence)
  )
    throw new EnvironmentError("发布清单的版本、发布标识或源码提交无效。", 5, {
      release,
    });
}

function archiveNames(env) {
  return {
    archive: env.files?.archive ?? env.configuration.defaults.files.archive,
    manifest: env.files?.manifest ?? env.configuration.defaults.files.manifest,
  };
}

function artifactSource(env, release, artifact) {
  const source = artifact
    ? resolve(artifact)
    : join(
        env.environmentRoots.dev,
        env.configuration.defaults.layout.artifacts,
        release,
      );
  return source.endsWith(".tar.gz") ? dirname(source) : source;
}

async function validateArchive(
  archive,
  manifest,
  manifestName,
  manifestBytes,
  signal,
) {
  const expected = new Map(
    [
      ...manifest.files,
      { path: manifestName, type: "file", bytes: manifestBytes },
    ].map((item) => [item.path, item]),
  );
  for (const path of expected.keys()) {
    assertRelativePath(path);
    for (let parent = dirname(path); parent !== "."; parent = dirname(parent)) {
      if (expected.has(parent))
        throw new EnvironmentError(
          "归档文件的父目录不能是文件或符号链接。",
          5,
          { path, parent },
        );
    }
  }
  const source = createReadStream(archive),
    stream = createGunzip();
  source.on("error", (error) => stream.destroy(error));
  source.pipe(stream);
  const iterator = stream[Symbol.asyncIterator]();
  let pending = Buffer.alloc(0),
    ended = false,
    extended = {},
    longPath,
    longLink;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const bytes = async (size, collect = true) => {
    const chunks = [];
    let remaining = size;
    while (remaining) {
      assertNotAborted(signal);
      if (!pending.length) {
        const item = await iterator.next();
        if (item.done)
          throw new EnvironmentError("发布归档在 TAR 记录结束前截断。", 5);
        pending = item.value;
      }
      const count = Math.min(remaining, pending.length);
      if (collect) chunks.push(pending.subarray(0, count));
      pending = pending.subarray(count);
      remaining -= count;
    }
    return collect ? Buffer.concat(chunks, size) : null;
  };
  const text = (buffer) =>
    decoder.decode(
      buffer.subarray(
        0,
        buffer.indexOf(0) < 0 ? buffer.length : buffer.indexOf(0),
      ),
    );
  const number = (buffer) => {
    let value;
    if (buffer[0] & 0x80) {
      value = BigInt(buffer[0] & 0x7f);
      for (const byte of buffer.subarray(1))
        value = value * 256n + BigInt(byte);
    } else {
      const valueText = text(buffer).trim();
      if (!/^[0-7]*$/.test(valueText))
        throw new EnvironmentError("归档文件长度无效。", 5);
      value = BigInt("0o" + (valueText || "0"));
    }
    if (value > BigInt(Number.MAX_SAFE_INTEGER))
      throw new EnvironmentError("归档文件长度超出支持范围。", 5);
    return Number(value);
  };
  try {
    while (!ended) {
      const header = await bytes(512);
      if (header.every((byte) => byte === 0)) {
        ended = true;
        break;
      }
      const checksum = number(header.subarray(148, 156));
      const actualChecksum = header.reduce(
        (sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte),
        0,
      );
      if (checksum !== actualChecksum)
        throw new EnvironmentError("发布归档 TAR 头校验失败。", 5);
      const type = String.fromCharCode(header[156] || 48);
      let size = number(header.subarray(124, 136));
      if (["x", "g", "L", "K"].includes(type)) {
        if (size > 1_048_576)
          throw new EnvironmentError("归档路径元数据超出支持范围。", 5);
        const metadata = await bytes(size);
        await bytes((512 - (size % 512)) % 512, false);
        if (type === "L") longPath = text(metadata);
        else if (type === "K") longLink = text(metadata);
        else {
          const fields = {};
          for (let offset = 0; offset < metadata.length; ) {
            const space = metadata.indexOf(32, offset);
            const length = Number(
              decoder.decode(metadata.subarray(offset, space)),
            );
            if (
              space < offset ||
              !Number.isSafeInteger(length) ||
              length <= space - offset + 1 ||
              offset + length > metadata.length ||
              metadata[offset + length - 1] !== 10
            )
              throw new EnvironmentError("归档 PAX 元数据无效。", 5);
            const record = decoder.decode(
                metadata.subarray(space + 1, offset + length - 1),
              ),
              equal = record.indexOf("=");
            if (equal < 1) throw new EnvironmentError("归档 PAX 字段无效。", 5);
            const key = record.slice(0, equal);
            if (
              ![
                "path",
                "linkpath",
                "size",
                "mtime",
                "atime",
                "ctime",
                "uid",
                "gid",
                "uname",
                "gname",
                "LIBARCHIVE.creationtime",
              ].includes(key) ||
              (type === "g" && ["path", "linkpath", "size"].includes(key))
            )
              throw new EnvironmentError(
                "归档包含不支持的路径或稀疏文件元数据。",
                5,
                { key },
              );
            fields[key] = record.slice(equal + 1);
            offset += length;
          }
          if (type === "x") extended = { ...extended, ...fields };
        }
        continue;
      }
      const prefix =
        decoder.decode(header.subarray(257, 263)) === "ustar\0"
          ? text(header.subarray(345, 500))
          : "";
      const name =
        (
          extended.path ??
          longPath ??
          [prefix, text(header.subarray(0, 100))].filter(Boolean).join("/")
        )
          .replace(/^\.\//, "")
          .replace(/\/$/, "") || ".";
      const link =
        extended.linkpath ?? longLink ?? text(header.subarray(157, 257));
      if (extended.size !== undefined) {
        if (
          !/^\d+$/.test(extended.size) ||
          !Number.isSafeInteger(Number(extended.size))
        )
          throw new EnvironmentError("归档 PAX 文件长度无效。", 5);
        size = Number(extended.size);
      }
      extended = {};
      longPath = undefined;
      longLink = undefined;
      if (type === "5") {
        if (name !== ".") assertRelativePath(name);
        for (let parent = name; parent !== "."; parent = dirname(parent))
          if (expected.has(parent))
            throw new EnvironmentError(
              "归档目录不能覆盖清单中的文件或符号链接。",
              5,
              { path: name },
            );
        if (size !== 0)
          throw new EnvironmentError("归档目录长度必须为零。", 5, {
            path: name,
          });
      } else {
        assertRelativePath(name);
        const item = expected.get(name);
        if (!item)
          throw new EnvironmentError("归档包含发布清单之外的文件。", 5, {
            path: name,
          });
        if (type === "2") {
          if (
            item.type !== "symlink" ||
            item.target !== link ||
            size !== 0 ||
            isAbsolute(link) ||
            link.includes("\0")
          )
            throw new EnvironmentError("归档符号链接与清单不一致。", 5, {
              path: name,
            });
          const local = resolve("/archive-root", dirname(name), link);
          if (!local.startsWith("/archive-root/"))
            throw new EnvironmentError("归档符号链接目标越界。", 5, {
              path: name,
            });
        } else if (type === "1") {
          const target = link.replace(/^\.\//, "");
          assertRelativePath(target);
          if (
            item.type !== "file" ||
            size !== 0 ||
            expected.get(target)?.type !== "file" ||
            expected.get(target)?.bytes !== item.bytes
          )
            throw new EnvironmentError("归档硬链接目标无效。", 5, {
              path: name,
            });
        } else if (
          !["0", "7"].includes(type) ||
          item.type !== "file" ||
          item.bytes !== size
        )
          throw new EnvironmentError(
            "归档文件类型或长度与发布清单不一致。",
            5,
            { path: name },
          );
      }
      await bytes(size + ((512 - (size % 512)) % 512), false);
    }
    if (pending.some((byte) => byte !== 0))
      throw new EnvironmentError("归档结束标记后存在附加内容。", 5);
    for await (const chunk of { [Symbol.asyncIterator]: () => iterator })
      if (chunk.some((byte) => byte !== 0))
        throw new EnvironmentError("归档结束标记后存在附加内容。", 5);
  } finally {
    source.destroy();
    stream.destroy();
  }
}

export async function prepareRelease(env, options = {}) {
  try {
    return await prepareReleaseInternal(env, options);
  } catch (error) {
    if (error instanceof EnvironmentError) throw error;
    throw new EnvironmentError(
      "发布归档无法准备，请核对原始归档和清单，并查看操作记录。",
      5,
      { release: options.release, reason: error.message },
    );
  }
}

async function prepareReleaseInternal(
  env,
  { release, artifact, operationId, signal } = {},
) {
  env = { ...env, signal: signal ?? env.signal };
  assertNotAborted(env.signal);
  assertIdentifier(release);
  const operation = await beginOperation(env, "prepare", operationId);
  const names = archiveNames(env);
  const localArtifact = join(env.paths.artifacts, release);
  const source = artifactSource(
    env,
    release,
    artifact ?? ((await exists(localArtifact)) ? localArtifact : undefined),
  );
  const manifest = await readJson(join(source, names.manifest));
  validateManifest(manifest, release);
  const artifactDirectory = join(env.paths.artifacts, release);
  await assertOwnedPath(env.root, artifactDirectory);
  await mkdir(env.paths.artifacts, { recursive: true });
  await operation.stage("copy-original-archive", async () => {
    if (await exists(artifactDirectory)) {
      for (const name of [names.archive, names.manifest])
        if (
          !(await sameFile(join(source, name), join(artifactDirectory, name)))
        )
          throw new EnvironmentError(
            "同一发布标识已有不同归档，请使用新的发布标识。",
            5,
            { release },
          );
    } else {
      const staged = await mkdtemp(join(env.paths.artifacts, `.${release}-`));
      for (const name of [names.archive, names.manifest])
        await cp(join(source, name), join(staged, name));
      await validateArchive(
        join(staged, names.archive),
        manifest,
        names.manifest,
        (await lstat(join(staged, names.manifest))).size,
        env.signal,
      );
      try {
        await rename(staged, artifactDirectory);
      } catch (error) {
        if (!(await exists(artifactDirectory))) throw error;
        for (const name of [names.archive, names.manifest])
          if (
            !(await sameFile(join(staged, name), join(artifactDirectory, name)))
          )
            throw new EnvironmentError(
              "并发准备生成了不同产物，请检查发布标识。",
              4,
              { release },
            );
        await rm(staged, { recursive: true });
      }
    }
  });
  const releaseDirectory = join(env.paths.releases, release);
  await assertOwnedPath(env.root, releaseDirectory);
  await mkdir(env.paths.releases, { recursive: true });
  const staged = await mkdtemp(join(env.paths.releases, `.${release}-`));
  await operation.stage("extract-and-verify", async () => {
    await validateArchive(
      join(artifactDirectory, names.archive),
      manifest,
      names.manifest,
      (await lstat(join(artifactDirectory, names.manifest))).size,
      env.signal,
    );
    await runCommand(
      env,
      "tar",
      [
        "-xzf",
        join(artifactDirectory, names.archive),
        "--no-same-owner",
        "--no-same-permissions",
        "-C",
        staged,
      ],
      { logPath: join(operation.work, "extract.log") },
    );
    if (
      !(await sameFile(
        join(staged, names.manifest),
        join(artifactDirectory, names.manifest),
      ))
    )
      throw new EnvironmentError("归档中的发布清单与配套清单不一致。", 5, {
        release,
      });
    await verifyInventory(staged, manifest.files, {
      exclude: [names.manifest],
    });
  });
  await operation.stage("publish-prepared-release", async () => {
    if (await exists(releaseDirectory)) {
      await verifyInventory(releaseDirectory, manifest.files, {
        exclude: [names.manifest],
      });
      await compareDirectories(staged, releaseDirectory, manifest.files);
      if (
        !(await sameFile(
          join(staged, names.manifest),
          join(releaseDirectory, names.manifest),
        ))
      )
        throw new EnvironmentError("已有发布目录的清单发生变化。", 5, {
          release,
        });
      await rm(staged, { recursive: true });
    } else {
      try {
        await rename(staged, releaseDirectory);
      } catch (error) {
        if (!(await exists(releaseDirectory))) throw error;
        await verifyInventory(releaseDirectory, manifest.files, {
          exclude: [names.manifest],
        });
        await compareDirectories(staged, releaseDirectory, manifest.files);
        await rm(staged, { recursive: true });
      }
    }
  });
  return {
    release,
    releaseDirectory,
    apiDirectory: join(releaseDirectory, "api"),
    manifest,
    artifactDirectory,
    archivePath: join(artifactDirectory, names.archive),
    operationId: operation.operationId,
    evidencePath: operation.path,
  };
}

async function git(env, args, operation, cwd = env.sourceRoot) {
  return runCommand(env, "git", args, {
    cwd,
    logPath: join(operation.work, "git.log"),
  });
}

async function runtimePlatform(env, operation) {
  const output = await runCommand(
    env,
    env.tools.node.path,
    [
      "--input-type=module",
      "-e",
      'import os from "node:os"; console.log(JSON.stringify({os:process.platform,arch:process.arch,abi:process.versions.modules,node:process.versions.node,release:os.release()}))',
    ],
    { logPath: join(operation.work, "platform.log") },
  );
  const platform = JSON.parse(output);
  if (platform.os === "darwin")
    platform.productVersion = await runCommand(
      env,
      "/usr/bin/sw_vers",
      ["-productVersion"],
      { logPath: join(operation.work, "platform.log") },
    );
  return platform;
}

export async function verifyReleaseRuntime(
  env,
  prepared,
  operation,
  { apiHealth = false } = {},
) {
  const platform = await runtimePlatform(env, operation);
  if (
    ["os", "arch", "abi"].some(
      (key) =>
        String(platform[key]) !== String(prepared.manifest.platform?.[key]),
    )
  )
    throw new EnvironmentError(
      "发布产物的平台或 Node ABI 与目标工具不匹配。",
      5,
      { expected: prepared.manifest.platform, actual: platform },
    );
  if (platform.os === "darwin" && prepared.manifest.platform.productVersion) {
    const built = prepared.manifest.platform.productVersion
        .split(".")
        .slice(0, 2)
        .map(Number),
      target = platform.productVersion.split(".").slice(0, 2).map(Number);
    if (
      target[0] < built[0] ||
      (target[0] === built[0] && (target[1] ?? 0) < (built[1] ?? 0))
    )
      throw new EnvironmentError(
        "目标 macOS 版本低于产物构建平台，请在兼容平台重新构建。",
        5,
        { expected: prepared.manifest.platform, actual: platform },
      );
  }
  for (const frontend of env.frontends)
    await access(join(prepared.releaseDirectory, frontend, "index.html"));
  await access(join(prepared.apiDirectory, "dist/index.js"));
  const isolatedData = join(operation.work, "runtime-data");
  await mkdir(isolatedData, { recursive: true });
  const isolated = {
    ...env,
    mode: "release",
    runtimeEnv: {
      ...env.hostEnv,
      HOST: "127.0.0.1",
      PORT: "0",
      NODE_ENV: "production",
      DATA_DIR: isolatedData,
      DATABASE_URL: join(isolatedData, env.storage.databaseFile),
      AUTH_MODE: "off",
      TAVERN_ENVIRONMENT: "build-verification",
    },
  };
  if (apiHealth)
    await runDatabaseCommand(isolated, "migrate", {
      apiDirectory: prepared.apiDirectory,
      databasePath: isolated.runtimeEnv.DATABASE_URL,
      outputPath: join(operation.work, "runtime-migration.json"),
    });
  const dependencies = `import {readFileSync,realpathSync} from 'node:fs'; import {resolve,relative,isAbsolute,sep} from 'node:path';
const root=realpathSync(${JSON.stringify(prepared.releaseDirectory)}),pkg=JSON.parse(readFileSync('package.json','utf8'));
for(const name of Object.keys(pkg.dependencies??{})){const directory=realpathSync(resolve('node_modules',name)),manifest=realpathSync(resolve(directory,'package.json'));for(const path of [directory,manifest]){const rel=relative(root,path);if(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))throw new Error('Dependency outside archive: '+name);}JSON.parse(readFileSync(manifest,'utf8'));}
if(pkg.dependencies?.['better-sqlite3']){const {default:Database}=await import('better-sqlite3');const db=new Database(':memory:');db.prepare('select 1').get();db.close();}
const {buildApp}=await import('./dist/app.js');if (${JSON.stringify(apiHealth)}) {const {app}=await buildApp({databasePath:process.env.DATABASE_URL,logger:false,auth:{mode:'off'}});
try{await app.listen({port:0,host:'127.0.0.1'});const address=app.server.address();const response=await fetch('http://127.0.0.1:'+address.port+'/health');if(!response.ok)throw new Error('API health failed');}finally{await app.close();}}
console.log('runtime dependencies and API health passed');`;
  await runCommand(
    env,
    env.tools.node.path,
    ["--input-type=module", "-e", dependencies],
    {
      cwd: prepared.apiDirectory,
      environment: isolated.runtimeEnv,
      logPath: join(operation.work, "runtime-api.log"),
      timeout: env.timeouts.startSeconds * 1000,
    },
  );
  const worker = join(
    prepared.apiDirectory,
    "dist/services/role-runtime/native-module-worker.mjs",
  );
  const request = {
    globals: ["Object", "Array", "JSON"],
    modules: [
      {
        path: "probe.js",
        purpose: "server_script",
        source: "export function probe() { return { verified: true }; }",
      },
    ],
    entryPath: "probe.js",
    exportName: "probe",
    context: {},
    contract: { async: false },
    evaluationTimeoutMs: 1000,
  };
  const workerResult = JSON.parse(
    await runCommand(
      env,
      env.tools.node.path,
      ["--experimental-vm-modules", worker],
      {
        cwd: prepared.apiDirectory,
        environment: isolated.runtimeEnv,
        input: JSON.stringify(request),
        logPath: join(operation.work, "runtime-worker.log"),
        timeout: env.timeouts.startSeconds * 1000,
      },
    ),
  );
  if (
    workerResult.ok !== true ||
    JSON.parse(workerResult.value).verified !== true
  )
    throw new EnvironmentError("角色 worker 未通过独立执行验证。", 5, {
      evidencePath: join(operation.work, "runtime-worker.log"),
    });
  return platform;
}

export async function archiveRelease(
  env,
  { payload, manifest, destination },
  operation,
) {
  const names = archiveNames(env);
  await mkdir(dirname(destination), { recursive: true });
  const artifact = await mkdtemp(
    join(dirname(destination), `.${manifest.release}-`),
  );
  await cp(join(payload, names.manifest), join(artifact, names.manifest));
  await runCommand(
    env,
    "tar",
    [
      "-czf",
      join(artifact, names.archive),
      ...(process.platform === "darwin"
        ? ["--no-mac-metadata", "--no-xattrs", "--no-acls", "--no-fflags"]
        : []),
      "-C",
      payload,
      ".",
    ],
    {
      environment: { ...env.hostEnv, COPYFILE_DISABLE: "1" },
      logPath: join(operation.work, "archive.log"),
    },
  );
  await validateArchive(
    join(artifact, names.archive),
    manifest,
    names.manifest,
    (await lstat(join(artifact, names.manifest))).size,
    env.signal,
  );
  try {
    await rename(artifact, destination);
  } catch (error) {
    if (!(await exists(destination))) throw error;
    throw new EnvironmentError(
      "其他构建已使用该发布标识，请比较操作记录后重试。",
      4,
      { release: manifest.release, artifact },
    );
  }
}

export async function buildRelease(
  env,
  { ref, release, installationApproval, operationId, signal } = {},
) {
  env = { ...env, signal: signal ?? env.signal };
  assertNotAborted(env.signal);
  if (env.name !== "dev" || env.mode !== "development")
    throw new EnvironmentError(
      "构建需要 dev 环境。示例：node scripts/environments/cli.mjs build --env dev --ref v1.0.0 --release release-1 --installation-approval <授权JSON>。",
      2,
    );
  assertIdentifier(release);
  if (
    typeof ref !== "string" ||
    !ref ||
    ref.startsWith("-") ||
    /[\s\0]/.test(ref)
  )
    throw new EnvironmentError("ref 需要已批准的 Git 标签名称。", 2);
  const operation = await beginOperation(env, "build", operationId);
  let commit;
  try {
    await git(env, ["check-ref-format", `refs/tags/${ref}`], operation);
    await git(env, ["show-ref", "--verify", `refs/tags/${ref}`], operation);
    commit = await git(
      env,
      ["rev-parse", "--verify", `refs/tags/${ref}^{commit}`],
      operation,
    );
  } catch (error) {
    if ([4, 130].includes(error.exitCode)) throw error;
    throw new EnvironmentError("ref 需要当前仓库中已存在的批准标签。", 3, {
      ref,
      reason: error.message,
    });
  }
  if (
    await git(
      env,
      ["status", "--porcelain", "--untracked-files=normal"],
      operation,
    )
  )
    throw new EnvironmentError(
      "源码目录存在未提交文件，请先整理源码，再从批准标签构建。",
      3,
    );
  const destination = join(env.paths.artifacts, release);
  if (await exists(destination)) {
    const manifest = await readJson(
      join(destination, archiveNames(env).manifest),
    );
    if (manifest.ref !== ref || manifest.commit !== commit)
      throw new EnvironmentError("同一发布标识已经对应其他标签或提交。", 5, {
        release,
      });
    return prepareRelease(env, {
      release,
      artifact: destination,
      operationId: operation.operationId,
    });
  }
  if (!installationApproval)
    throw new EnvironmentError(
      "构建需要 installationApproval JSON 记录，请提供批准标签、提交、工具版本及生命周期脚本。",
      3,
    );
  const approval = await readJson(resolve(installationApproval));
  const platform = await runtimePlatform(env, operation);
  const pnpmVersion = await runCommand(
    env,
    env.tools.pnpm.path,
    ["--version"],
    { cwd: env.sourceRoot, logPath: join(operation.work, "pnpm-version.log") },
  );
  const nodeVersion = env.tools.node.version.replace(/^[v=<>~^ ]+/, "");
  if (
    approval.approved !== true ||
    approval.ref !== ref ||
    approval.commit !== commit ||
    approval.nodeVersion !== platform.node ||
    approval.pnpmVersion !== pnpmVersion ||
    platform.node !== nodeVersion ||
    pnpmVersion !== env.tools.pnpm.version ||
    !Array.isArray(approval.lifecycleScripts)
  )
    throw new EnvironmentError(
      "安装授权与构建输入不匹配。请核对 ref、commit、Node 和 pnpm 版本，使用 installation-approval.mjs 重新生成并提交对应的授权 JSON。",
      3,
      { ref, commit, nodeVersion: platform.node, pnpmVersion },
    );
  await assertOwnedPath(env.root, env.paths.buildWork);
  await mkdir(env.paths.buildWork, { recursive: true });
  const work = await mkdtemp(
    join(env.paths.buildWork, `${operation.operationId}-`),
  );
  const source = join(work, "source"),
    payload = join(work, "payload");
  await mkdir(source);
  await mkdir(payload);
  const commandOptions = {
    cwd: source,
    environment: { ...env.hostEnv, CI: "true", HUSKY: "0" },
    logPath: join(operation.work, "build.log"),
  };
  await operation.stage("export-approved-tag", async () => {
    await git(
      env,
      ["archive", "--format=tar", "--output", join(work, "source.tar"), commit],
      operation,
    );
    await runCommand(
      env,
      "tar",
      ["-xf", join(work, "source.tar"), "-C", source],
      { logPath: join(operation.work, "source.log") },
    );
    await access(join(source, "pnpm-lock.yaml"));
    const requirements = await readInstallationRequirements(source);
    if (
      requirements.nodeVersion !== approval.nodeVersion ||
      requirements.pnpmVersion !== approval.pnpmVersion ||
      JSON.stringify([...approval.lifecycleScripts].sort()) !==
        JSON.stringify(requirements.lifecycleScripts)
    )
      throw new EnvironmentError(
        "安装授权与标签中的工具版本或生命周期脚本不匹配。请核对 ref、commit、Node 和 pnpm 版本，使用 installation-approval.mjs 重新生成并提交对应的授权 JSON。",
        3,
        { required: requirements.lifecycleScripts },
      );
  });
  await operation.stage("install-frozen-dependencies", () =>
    runCommand(
      env,
      env.tools.pnpm.path,
      ["install", "--frozen-lockfile", "--prod=false"],
      commandOptions,
    ),
  );
  await operation.stage("build-workspace", () =>
    runCommand(
      env,
      env.tools.pnpm.path,
      [
        "-r",
        "--filter",
        "@tavern/api...",
        "--filter",
        "@tavern/web...",
        "--filter",
        "@tavern/user-web...",
        "--filter",
        "@tavern/studio...",
        "--if-present",
        "build",
      ],
      commandOptions,
    ),
  );
  await operation.stage("deploy-production-dependencies", async () => {
    await runCommand(
      env,
      env.tools.pnpm.path,
      ["--filter", "@tavern/api", "--prod", "deploy", join(payload, "api")],
      commandOptions,
    );
    for (const frontend of env.frontends)
      await cp(
        join(source, "apps", frontend, "dist"),
        join(payload, frontend),
        { recursive: true, dereference: false },
      );
  });
  const journal = await readJson(
    join(payload, "api/drizzle/meta/_journal.json"),
  );
  const packages = {};
  for (const directory of ["apps", "packages"])
    for (const entry of await readdir(join(source, directory), {
      withFileTypes: true,
    })) {
      const path = join(source, directory, entry.name, "package.json");
      if (entry.isDirectory() && (await exists(path))) {
        const pkg = await readJson(path);
        packages[pkg.name] = pkg.version;
      }
    }
  const manifest = {
    version: 1,
    release,
    ref,
    commit,
    createdAt: new Date().toISOString(),
    tools: { node: platform.node, pnpm: pnpmVersion },
    platform: {
      os: platform.os,
      arch: platform.arch,
      abi: platform.abi,
      release: platform.release,
      ...(platform.productVersion
        ? { productVersion: platform.productVersion }
        : {}),
    },
    packages,
    migrationSequence: journal.entries.map(({ idx, tag, when }) => ({
      idx,
      tag,
      when,
    })),
    files: await inventoryDirectory(payload),
  };
  const names = archiveNames(env);
  await writeJson(join(payload, names.manifest), manifest);
  await operation.stage("verify-independent-runtime", () =>
    verifyReleaseRuntime(
      env,
      {
        releaseDirectory: payload,
        apiDirectory: join(payload, "api"),
        manifest,
      },
      operation,
      { apiHealth: true },
    ),
  );
  await operation.stage("archive-verified-release", () =>
    archiveRelease(env, { payload, manifest, destination }, operation),
  );
  return {
    release,
    artifactDirectory: destination,
    archivePath: join(destination, names.archive),
    manifest,
    operationId: operation.operationId,
    evidencePath: operation.path,
  };
}

export async function getCurrentRelease(env) {
  if (!(await exists(env.paths.current))) return null;
  const stat = await lstat(env.paths.current);
  if (!stat.isSymbolicLink())
    throw new EnvironmentError(
      "current 必须是指向本环境发布目录的符号链接。",
      3,
    );
  await assertOwnedPath(env.root, env.paths.current);
  await assertOwnedPath(
    await realpath(env.paths.releases),
    await realpath(env.paths.current),
  );
  const target = await readlink(env.paths.current);
  const directory = await realpath(env.paths.current);
  const manifest = await readJson(join(directory, archiveNames(env).manifest));
  return {
    target,
    directory,
    release: manifest.release,
    commit: manifest.commit,
    manifest,
  };
}

export async function getSourceState(env, operation) {
  try {
    const root = await git(
      env,
      ["rev-parse", "--show-toplevel"],
      operation,
      env.root,
    );
    const sourceCommon = await git(
      env,
      ["rev-parse", "--git-common-dir"],
      operation,
    );
    const targetCommon = await git(
      env,
      ["rev-parse", "--git-common-dir"],
      operation,
      env.root,
    );
    if (
      (await realpath(root)) !== (await realpath(env.root)) ||
      (await realpath(env.root)) === (await realpath(env.sourceRoot)) ||
      (await realpath(resolve(env.sourceRoot, sourceCommon))) !==
        (await realpath(resolve(env.root, targetCommon)))
    )
      throw new EnvironmentError(
        "发布环境需要由 dev 仓库创建的独立 Git worktree。",
        3,
      );
    if (
      await git(
        env,
        ["status", "--porcelain", "--untracked-files=no"],
        operation,
        env.root,
      )
    )
      throw new EnvironmentError(
        "发布环境的受版本控制文件存在人工改动，请先整理该 worktree。",
        3,
      );
    return {
      commit: await git(env, ["rev-parse", "HEAD"], operation, env.root),
      current: await getCurrentRelease(env),
    };
  } catch (error) {
    if (
      error instanceof EnvironmentError &&
      [3, 4, 130].includes(error.exitCode)
    )
      throw error;
    throw new EnvironmentError(
      "发布环境 Git worktree 无法核对，请先初始化目标环境。",
      3,
      { reason: error.message },
    );
  }
}

async function replaceCurrent(env, target) {
  await mkdir(dirname(env.paths.current), { recursive: true });
  if (target === null) {
    await rm(env.paths.current, { force: true });
    return;
  }
  const temporary = `${env.paths.current}.${randomUUID()}.tmp`;
  await symlink(target, temporary);
  try {
    await rename(temporary, env.paths.current);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function activatePreparedRelease(
  env,
  prepared,
  operation,
  expected,
  { publicDirectory } = {},
) {
  const original = expected ?? (await getSourceState(env, operation));
  await assertEnvironmentStopped(env);
  const actual = await getSourceState(env, operation);
  if (
    actual.commit !== original.commit ||
    actual.current?.target !== original.current?.target
  )
    throw new EnvironmentError(
      "操作期间源码提交或 current 已变化，请重新查询状态。",
      4,
    );
  const target = relative(
    dirname(env.paths.current),
    prepared.releaseDirectory,
  );
  let pointerChanged = false,
    publicChanged = false;
  const previousPublic = join(operation.work, "public-before");
  const hadPublic = await exists(env.paths.publicConfig);
  try {
    await operation.stage("switch-source-commit", async () => {
      await git(
        env,
        ["switch", "--detach", "--no-guess", prepared.manifest.commit],
        operation,
        env.root,
      );
    });
    if (publicDirectory)
      await operation.stage("switch-public-configuration", async () => {
        await assertOwnedPath(env.root, env.paths.publicConfig);
        if (hadPublic) await rename(env.paths.publicConfig, previousPublic);
        publicChanged = true;
        await rename(publicDirectory, env.paths.publicConfig);
      });
    await operation.stage("switch-current", async () => {
      if ((await getCurrentRelease(env))?.target !== original.current?.target)
        throw new EnvironmentError(
          "current 已由其他操作修改，请重新查询状态。",
          4,
        );
      await replaceCurrent(env, target);
      pointerChanged = true;
      const active = await getCurrentRelease(env);
      if (
        active.release !== prepared.release ||
        active.commit !== prepared.manifest.commit
      )
        throw new EnvironmentError("current 切换后未指向目标发布标识。", 5);
    });
  } catch (error) {
    const recovery = [];
    const recoveryEnv = { ...env, signal: undefined };
    if (pointerChanged) {
      try {
        if ((await getCurrentRelease(recoveryEnv))?.target !== target)
          throw new EnvironmentError(
            "恢复原发布指针前，current 已被其他操作修改。请核对阶段记录和 current。",
            4,
          );
        await replaceCurrent(recoveryEnv, original.current?.target ?? null);
      } catch (failure) {
        recovery.push(failure.message);
      }
    }
    if (publicChanged) {
      try {
        await rm(env.paths.publicConfig, { recursive: true, force: true });
        if (hadPublic) await rename(previousPublic, env.paths.publicConfig);
      } catch (failure) {
        recovery.push(failure.message);
      }
    }
    try {
      const head = await git(
        recoveryEnv,
        ["rev-parse", "HEAD"],
        operation,
        recoveryEnv.root,
      );
      if (head === prepared.manifest.commit && head !== original.commit) {
        if (
          (await getCurrentRelease(recoveryEnv))?.target !==
          original.current?.target
        )
          throw new EnvironmentError(
            "恢复原源码提交前，current 已被其他操作修改。请核对阶段记录和目标 worktree。",
            4,
          );
        await git(
          recoveryEnv,
          ["switch", "--detach", "--no-guess", original.commit],
          operation,
          recoveryEnv.root,
        );
      } else if (head !== original.commit)
        throw new EnvironmentError(
          "恢复原源码提交前，HEAD 已被其他操作修改。请核对阶段记录和目标 worktree。",
          4,
        );
    } catch (failure) {
      recovery.push(failure.message);
    }
    if (recovery.length)
      throw new EnvironmentError(
        "发布切换失败，原发布指针、公开配置或源码提交尚未全部恢复。请按阶段记录恢复列出的对象。",
        5,
        { cause: error.message, recovery, evidencePath: operation.path },
      );
    if (!(error instanceof EnvironmentError))
      throw new EnvironmentError(
        "发布切换失败，已恢复原发布状态。请查看阶段记录。",
        5,
        { cause: error.message, evidencePath: operation.path },
      );
    throw error;
  }
  return {
    previousRelease: original.current?.release ?? null,
    release: prepared.release,
    commit: prepared.manifest.commit,
    stopped: true,
  };
}

export async function restoreReleaseState(
  env,
  state,
  operation,
  expectedRelease,
) {
  env = { ...env, signal: undefined };
  await assertEnvironmentStopped(env);
  if ((await getCurrentRelease(env))?.release !== expectedRelease)
    throw new EnvironmentError(
      "恢复发布指针前检测到其他操作，请按阶段记录处理。",
      4,
    );
  await replaceCurrent(env, state.current?.target ?? null);
  await git(
    env,
    ["switch", "--detach", "--no-guess", state.commit],
    operation,
    env.root,
  );
}

function assertReleaseEnvironment(env) {
  if (env.mode !== "release" || !["staging", "prod"].includes(env.name))
    throw new EnvironmentError("发布切换需要 staging 或 prod 环境。", 2);
}

async function validateStagingAcceptance(prepared, acceptance) {
  const record = await readJson(resolve(acceptance));
  const required = (
    await readJson(new URL("./acceptance.json", import.meta.url))
  ).stages.staging.required;
  if (
    record.schemaVersion !== 1 ||
    record.environment !== "staging" ||
    record.release !== prepared.release ||
    record.commit !== prepared.manifest.commit ||
    record.status !== "passed" ||
    record.suite !== "acceptance" ||
    required.some(
      (id) =>
        !record.checks?.some(
          (check) =>
            check.id === id &&
            check.status === "passed" &&
            typeof check.evidencePath === "string",
        ),
    )
  )
    throw new EnvironmentError(
      "staging 验收记录的格式、发布对象或验收结果不符合部署要求。请核对 schemaVersion、environment、release、commit、suite、status 和必需验收项，再提供目标产物对应的通过记录。",
      3,
      { release: prepared.release },
    );
  for (const check of record.checks)
    if (check.status === "passed") await access(resolve(check.evidencePath));
  if (
    !record.artifactPath ||
    !(await sameFile(resolve(record.artifactPath), prepared.archivePath))
  )
    throw new EnvironmentError(
      "staging 验收记录缺少 artifactPath，或该路径对应的归档与待部署归档不同。请提供包含原归档路径的验收记录，并部署该归档；目标归档改变后，须重新完成 staging 验收。",
      5,
    );
  return record;
}

export function assertMigrationSequence(status, manifest) {
  const sequence = manifest.migrationSequence.map((entry) => entry.when);
  if (
    !status.ready ||
    JSON.stringify(
      status.appliedMigrationSequence?.map((entry) => entry.when),
    ) !== JSON.stringify(sequence)
  )
    throw new EnvironmentError(
      "目标数据库尚未完成该发布版本的迁移，请先备份并执行 migrate。",
      3,
      { status },
    );
}

async function preparePublicConfiguration(env, operation, prepared) {
  await mkdir(dirname(env.paths.publicConfig), { recursive: true });
  const directory = await mkdtemp(
    join(dirname(env.paths.publicConfig), ".public-"),
  );
  await operation.stage("prepare-public-configuration", () =>
    writePublicConfiguration(
      { ...env, paths: { ...env.paths, publicConfig: directory } },
      { releaseDirectory: prepared.releaseDirectory },
    ),
  );
  return directory;
}

export async function deployRelease(
  env,
  { release, artifact, acceptance, operationId, signal } = {},
) {
  env = { ...env, signal: signal ?? env.signal };
  assertNotAborted(env.signal);
  assertReleaseEnvironment(env);
  assertIdentifier(release);
  if (env.name === "prod" && !acceptance)
    throw new EnvironmentError(
      "prod 部署需要 staging 验收文件。请通过 --acceptance <staging-acceptance.json路径> 提供已通过的记录。",
      3,
    );
  await assertEnvironmentStopped(env);
  const operation = await beginOperation(env, "deploy", operationId);
  const original = await getSourceState(env, operation);
  const prepared = await prepareRelease(env, {
    release,
    artifact,
    operationId: operation.operationId,
  });
  if (env.name === "prod")
    await operation.stage("staging-acceptance", () =>
      validateStagingAcceptance(prepared, acceptance),
    );
  await operation.stage("runtime-preflight", () =>
    verifyReleaseRuntime(env, prepared, operation),
  );
  const status = await operation.stage("database-preflight", () =>
    runDatabaseCommand(env, "status", {
      apiDirectory: prepared.apiDirectory,
      outputPath: join(operation.work, "database-status.json"),
    }),
  );
  assertMigrationSequence(status, prepared.manifest);
  const publicDirectory = await preparePublicConfiguration(
    env,
    operation,
    prepared,
  );
  const activated = await activatePreparedRelease(
    env,
    prepared,
    operation,
    original,
    { publicDirectory },
  );
  return {
    ...activated,
    artifactDirectory: prepared.artifactDirectory,
    archivePath: prepared.archivePath,
    operationId: operation.operationId,
    evidencePath: operation.path,
  };
}

export async function rollbackRelease(
  env,
  { release, compatibility, backup, operationId, signal } = {},
) {
  env = { ...env, signal: signal ?? env.signal };
  assertNotAborted(env.signal);
  assertReleaseEnvironment(env);
  assertIdentifier(release);
  if (!compatibility || !backup)
    throw new EnvironmentError(
      "应用回退需要 --compatibility <兼容性记录JSON> 和 --backup <操作前备份标识>。记录格式见 docs/environment-operations.md 第 6.1 节。",
      3,
    );
  assertIdentifier(backup, "backup");
  await assertEnvironmentStopped(env);
  const operation = await beginOperation(env, "rollback", operationId);
  const original = await getSourceState(env, operation);
  const prepared = await prepareRelease(env, {
    release,
    operationId: operation.operationId,
  });
  const record = await readJson(resolve(compatibility));
  const { validateBackup } = await import("./data.mjs");
  const backupRecord = (
    await validateBackup(env, backup, operation, {
      apiDirectory: original.current
        ? join(original.current.directory, "api")
        : undefined,
      requireCurrent: true,
    })
  ).manifest;
  const status = await runDatabaseCommand(env, "status", {
    apiDirectory: prepared.apiDirectory,
    outputPath: join(operation.work, "database-status.json"),
  });
  assertMigrationSequence(status, prepared.manifest);
  if (
    record.fromRelease !== original.current?.release ||
    record.release !== release ||
    record.readWrite !== "passed" ||
    record.backup !== backup ||
    JSON.stringify(record.migrationSequence) !==
      JSON.stringify(prepared.manifest.migrationSequence) ||
    backupRecord.environment !== env.name ||
    backupRecord.backup !== backup ||
    backupRecord.status !== "complete" ||
    backupRecord.release !== original.current?.release
  )
    throw new EnvironmentError(
      "回退记录或操作前备份未满足回退条件。请按 docs/environment-operations.md 第 6.1 节核对发布标识、备份标识、迁移序列和读写验收结果，并确认备份状态为 complete。",
      3,
    );
  await operation.stage("runtime-preflight", () =>
    verifyReleaseRuntime(env, prepared, operation),
  );
  const publicDirectory = await preparePublicConfiguration(
    env,
    operation,
    prepared,
  );
  const activated = await activatePreparedRelease(
    env,
    prepared,
    operation,
    original,
    { publicDirectory },
  );
  return {
    ...activated,
    backup,
    compatibility: resolve(compatibility),
    operationId: operation.operationId,
    evidencePath: operation.path,
  };
}
