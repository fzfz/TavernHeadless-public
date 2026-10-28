import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
const execute = promisify(execFile),
  roots: string[] = [],
  children: ChildProcess[] = [];
const entry = resolve(
  ".agents/skills/native-card-conversion/scripts/convert.mjs",
);
afterEach(async () => {
  for (const child of children.splice(0))
    if (child.exitCode === null) child.kill("SIGKILL");
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function service() {
  const root = await mkdtemp(join(tmpdir(), "cli-service-"));
  roots.push(root);
  const config = join(root, "replay.json"),
    id = randomUUID();
  roots.push(
    resolve(".tmp/native-card-conversion/creations/replay-fixture", id),
  );
  await writeFile(
    config,
    JSON.stringify({
      host: "127.0.0.1",
      port: 0,
      steps: [{ purpose: "narrator", model: "offline", text: "样本正文" }],
    }),
  );
  const args = ["replay-fixture", config, root, "--request-id", id];
  const child = spawn(process.execPath, [entry, ...args]);
  children.push(child);
  const output: Buffer[] = [],
    errors: Buffer[] = [],
    closed = once(child, "close");
  child.stdout.on("data", (chunk) => output.push(chunk));
  child.stderr.on("data", (chunk) => errors.push(chunk));
  const ready = await new Promise<{ resultFile: string }>((done, fail) => {
    let text = "";
    const timeout = setTimeout(
      () => fail(new Error("No service result")),
      10000,
    );
    child.stdout.on("data", (chunk) => {
      text += chunk;
      if (text.includes("\n")) {
        clearTimeout(timeout);
        try {
          done(JSON.parse(text.split("\n")[0]!));
        } catch (error) {
          fail(error);
        }
      }
    });
    child.once("close", () => {
      clearTimeout(timeout);
      fail(new Error(Buffer.concat(errors).toString()));
    });
  });
  const saved = JSON.parse(await readFile(ready.resultFile, "utf8"));
  return { root, args, child, output, errors, closed, ready, data: saved.data };
}
it("前台回放同ID复用一个地址，关闭保存路径且关闭后的重试不重建", async () => {
  const running = await service();
  const retry = await execute(process.execPath, [entry, ...running.args]);
  const reused = JSON.parse(
    await readFile(JSON.parse(retry.stdout).resultFile, "utf8"),
  );
  expect(reused.data.baseUrl).toBe(running.data.baseUrl);
  running.child.kill("SIGTERM");
  expect((await running.closed)[0]).toBe(0);
  const lines = Buffer.concat(running.output).toString().trim().split("\n");
  expect(lines.length).toBe(2);
  const saved = JSON.parse(
    await readFile(JSON.parse(lines[1]!).resultFile, "utf8"),
  );
  expect(saved.data.status).toBe("stopped");
  expect(Buffer.concat(running.errors).length).toBe(0);
  await expect(fetch(running.data.baseUrl)).rejects.toThrow();
  try {
    await execute(process.execPath, [entry, ...running.args]);
    throw new Error("unexpected restart");
  } catch (error) {
    const failure = error as { stdout: string; stderr: string; code: number };
    expect(failure.stdout).toBe("");
    expect(failure.code).toBe(1);
    const diagnostic = JSON.parse(
      await readFile(JSON.parse(failure.stderr).diagnosticFile, "utf8"),
    );
    expect(diagnostic.data.error).toContain("closed");
  }
}, 20000);
it("关闭结果无法写入时服务仍释放，stderr输出短错误并退出非零", async () => {
  const running = await service();
  await writeFile(
    join(dirname(dirname(running.ready.resultFile)), "closed"),
    "阻止创建目录",
  );
  running.child.kill("SIGTERM");
  expect((await running.closed)[0]).toBe(1);
  expect(Buffer.concat(running.errors).length).toBeLessThan(1024);
  expect(JSON.parse(Buffer.concat(running.errors).toString()).code).toBe(
    "EEXIST",
  );
  await expect(fetch(running.data.baseUrl)).rejects.toThrow();
}, 20000);
