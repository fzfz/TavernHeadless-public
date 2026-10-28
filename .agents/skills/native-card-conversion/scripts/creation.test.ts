import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import {
  markCreationClosed,
  markCreationReady,
  withCreation,
} from "./creation.ts";
const roots: string[] = [];
async function root() {
  const directory = await mkdtemp(join(tmpdir(), "card-creation-"));
  roots.push(directory);
  return directory;
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
it("八个相同ID创建只执行一次且返回相同结果", async () => {
  const directory = await root();
  let calls = 0;
  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      withCreation(
        directory,
        "begin",
        "same",
        { source: "card.json" },
        async () => ({ taskFile: String(++calls) }),
      ),
    ),
  );
  expect(calls).toBe(1);
  expect(
    results.every(
      (value) => JSON.stringify(value) === JSON.stringify(results[0]),
    ),
  ).toBe(true);
  expect(await readdir(join(directory, "creations", "begin"))).toEqual([
    "same",
  ]);
  await expect(
    withCreation(
      directory,
      "begin",
      "same",
      { source: "other.json" },
      async () => null,
    ),
  ).rejects.toThrow("冲突");
});
it("失败、未完成与已关闭创建不自动重放", async () => {
  const directory = await root();
  await expect(
    withCreation(directory, "formal", "failed", {}, async () => {
      throw new Error("实际导入失败");
    }),
  ).rejects.toThrow("实际导入失败");
  await expect(
    withCreation(directory, "formal", "failed", {}, async () => "再次导入"),
  ).rejects.toThrow("failed");
  await withCreation(directory, "preview", "closed", {}, async () => {
    await markCreationReady({ url: "http://localhost" });
    await markCreationClosed({ status: "stopped" });
  });
  await expect(
    withCreation(directory, "preview", "closed", {}, async () => "再次启动"),
  ).rejects.toThrow("closed");
  const path = join(directory, "creations", "formal", "interrupted");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(path));
  await writeFile(
    join(path, "creation.json"),
    JSON.stringify({ command: "formal", inputs: {}, status: "starting" }),
  );
  await expect(
    withCreation(
      directory,
      "formal",
      "interrupted",
      {},
      async () => "再次导入",
      0,
    ),
  ).rejects.toThrow("超时");
});
it("成功返回passedfalse的创建记录失败状态", async () => {
  const directory = await root();
  await withCreation(directory, "formal", "bad", {}, async () => ({
    passed: false,
  }));
  await expect(
    withCreation(directory, "formal", "bad", {}, async () => ({
      passed: true,
    })),
  ).rejects.toThrow("failed");
});

it("已结束服务的创建ID不返回失效地址且不重建服务", async () => {
  const directory = await root();
  const path = join(directory, "creations", "preview", "dead");
  await import("node:fs/promises").then(({ mkdir }) =>
    mkdir(path, { recursive: true }),
  );
  await writeFile(
    join(path, "creation.json"),
    JSON.stringify({
      command: "preview",
      inputs: {},

      status: "listening",
      data: { url: "http://localhost:1" },
    }),
  );
  let invoked = false;
  await expect(
    withCreation(directory, "preview", "dead", {}, async () => {
      invoked = true;
    }),
  ).rejects.toThrow("不可访问");
  expect(invoked).toBe(false);
});
