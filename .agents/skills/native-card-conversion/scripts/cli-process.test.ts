import { completeSourceFixture } from "./source-fixtures.ts";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
const execute = promisify(execFile),
  roots: string[] = [];
const entry = resolve(
  ".agents/skills/native-card-conversion/scripts/convert.mjs",
);
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function cli(...args: string[]) {
  const result = await execute(process.execPath, [entry, ...args], {
    maxBuffer: 2048,
  });
  expect(result.stderr).toBe("");
  const reference = JSON.parse(result.stdout);
  const saved = JSON.parse(await readFile(reference.resultFile, "utf8"));
  expect(saved.passed).toBe(true);
  return saved.data;
}
async function runProcess(args: string[], input = "") {
  const child = spawn(process.execPath, [entry, ...args]);
  const stdout: Buffer[] = [],
    stderr: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  const closed = once(child, "close");
  child.stdin.end(input);
  const [code, signal] = await closed;
  return {
    code,
    signal,
    stdout: Buffer.concat(stdout).toString(),
    stderr: Buffer.concat(stderr).toString(),
  };
}
it("八个进程重试begin只创建一个任务，八个extract分别保存正确正文", async () => {
  const root = await mkdtemp(join(tmpdir(), "cli-process-"));
  roots.push(root);
  const source = join(root, "源卡.json"),
    id = randomUUID();
  await writeFile(
    source,
    JSON.stringify(
      completeSourceFixture({
        name: "并发样本",
        description: "原样正文",
        extensions: { values: Array.from({ length: 8 }, (_, i) => "值" + i) },
      }),
    ),
  );
  const tasks = await Promise.all(
    Array.from({ length: 8 }, () => cli("begin", source, "--request-id", id)),
  );
  expect(new Set(tasks.map((task) => task.taskFile)).size).toBe(1);
  const task = tasks[0];
  roots.push(dirname(task.taskFile));
  roots.push(resolve(".tmp/native-card-conversion/creations/begin", id));
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      cli("extract", task.taskFile, "/extensions/values/" + i),
    ),
  );
  expect(new Set(results.map((r) => r.items[0].contentFile)).size).toBe(8);
  for (const [i, result] of results.entries())
    expect(await readFile(result.items[0].contentFile, "utf8")).toBe("值" + i);
}, 30000);
it("pack的stdout可直接管道到formal，相同创建ID并发只产生一次正式导入", async () => {
  const root = await mkdtemp(join(tmpdir(), "cli-pipe-"));
  roots.push(root);
  const source = join(root, "source.json");
  await writeFile(
    source,
    JSON.stringify(
      completeSourceFixture({ name: "管道样本", description: "完整原文" }),
    ),
  );
  const task = await cli("begin", source);
  roots.push(dirname(task.taskFile));
  await cli("index", task.taskFile);
  const pack = spawn(process.execPath, [entry, "pack", task.taskFile]);
  const formal = spawn(process.execPath, [entry, "formal", "-"]);
  const packClosed = once(pack, "close"),
    formalClosed = once(formal, "close");
  pack.stdout.pipe(formal.stdin);
  const output: Buffer[] = [],
    errors: Buffer[] = [];
  formal.stdout.on("data", (chunk) => output.push(chunk));
  formal.stderr.on("data", (chunk) => errors.push(chunk));
  pack.stderr.on("data", (chunk) => errors.push(chunk));
  expect((await packClosed)[0]).toBe(0);
  expect((await formalClosed)[0]).toBe(0);
  expect(Buffer.concat(errors).length).toBe(0);
  const reference = JSON.parse(Buffer.concat(output).toString());
  const result = JSON.parse(await readFile(reference.resultFile, "utf8"));
  expect(result.passed).toBe(true);
  const archive = (await cli("pack", task.taskFile)).archive,
    id = randomUUID();
  const retries = await Promise.all(
    Array.from({ length: 3 }, () =>
      cli("formal", task.taskFile, "--archive", archive, "--request-id", id),
    ),
  );
  expect(new Set(retries.map((r) => r.evidenceDirectory)).size).toBe(1);
}, 30000);

it("parse覆写从stdin读取taskFile并将结果路径写入stdout，错误诊断写入stderr路径", async () => {
  const root = await mkdtemp(join(tmpdir(), "cli-parse-replacements-"));
  roots.push(root);
  const source = join(root, "source.json");
  await writeFile(
    source,
    JSON.stringify(
      completeSourceFixture({
        name: "管道覆写样本",
        replacements: JSON.stringify([
          { op: "replace", path: "/count", value: 5 },
        ]),
      }),
    ),
  );
  const task = await cli("begin", source);
  roots.push(dirname(task.taskFile));
  const target = join(task.packageDirectory, "data/initial.json");
  await mkdir(join(task.packageDirectory, "data"), { recursive: true });
  await writeFile(target, '{"count":1}\n');
  const upstreamResult = join(root, "upstream-result.json");
  await writeFile(
    upstreamResult,
    JSON.stringify({ passed: true, data: { taskFile: task.taskFile } }),
  );

  const success = await runProcess(
    [
      "parse",
      "-",
      "/replacements",
      "data/initial.json",
      "--format",
      "json",
      "--apply-replacements",
    ],
    JSON.stringify({ resultFile: upstreamResult }),
  );
  expect(success.code).toBe(0);
  expect(success.signal).toBeNull();
  expect(success.stderr).toBe("");
  expect(Buffer.byteLength(success.stdout)).toBeLessThan(1200);
  const reference = JSON.parse(success.stdout);
  const saved = JSON.parse(await readFile(reference.resultFile, "utf8"));
  expect(saved.passed).toBe(true);
  expect(saved.data).toMatchObject({ file: target, replacements: 1 });
  expect(JSON.parse(await readFile(target, "utf8"))).toEqual({ count: 5 });

  const before = await readFile(target);
  const failure = await runProcess([
    "parse",
    task.taskFile,
    "/replacements",
    "data/initial.json",
    "--format",
    "yaml",
    "--apply-replacements",
  ]);
  expect(failure.code).toBe(1);
  expect(failure.signal).toBeNull();
  expect(failure.stdout).toBe("");
  const diagnosticReference = JSON.parse(failure.stderr);
  const diagnostic = JSON.parse(
    await readFile(diagnosticReference.diagnosticFile, "utf8"),
  );
  expect(diagnostic.passed).toBe(false);
  expect(diagnostic.data.error).toContain("仅支持 --format json");
  expect(diagnostic.data.action).toContain("--help");
  expect(await readFile(target)).toEqual(before);
}, 30000);
