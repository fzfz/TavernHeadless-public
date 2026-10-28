import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  createCallDirectory,
  emitCommandResult,
  getCallDirectory,
  saveTextParts,
  withCallContext,
} from "./output.ts";
const directories: string[] = [],
  previousExitCode = process.exitCode;
afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = previousExitCode;
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function root() {
  const directory = await mkdtemp(join(tmpdir(), "output-test-"));
  directories.push(directory);
  return directory;
}
it("并发创建调用目录互不覆盖，异步上下文各自返回其目录", async () => {
  const directory = await root();
  const calls = await Promise.all(
    Array.from({ length: 8 }, () => createCallDirectory(directory)),
  );
  expect(new Set(calls).size).toBe(8);
  const results = await Promise.all(
    calls.map((call) =>
      withCallContext(call, async () => {
        await Promise.resolve();
        return getCallDirectory();
      }),
    ),
  );
  expect(results).toEqual(calls);
  expect(getCallDirectory()).toBeUndefined();
});
it("成功只向stdout输出文件引用", async () => {
  const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true),
    stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  const directory = await root();
  await emitCommandResult("copy", { text: "长正文".repeat(10000) }, directory);
  expect(stderr).not.toHaveBeenCalled();
  const reference = JSON.parse(String(stdout.mock.calls[0]![0]));
  expect(JSON.stringify(reference).length).toBeLessThan(1000);
  expect(reference.resultFile).toBeTruthy();
  expect(
    JSON.parse(await readFile(reference.resultFile, "utf8")).data.text.length,
  ).toBe(30000);
});
it("失败只向stderr输出诊断引用并设置非零退出码", async () => {
  const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true),
    stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  await emitCommandResult(
    "parse",
    { error: "语法错误".repeat(20000) },
    await root(),
    false,
  );
  expect(stdout).not.toHaveBeenCalled();
  const reference = JSON.parse(String(stderr.mock.calls[0]![0]));
  expect(reference.diagnosticFile).toBeTruthy();
  expect(process.exitCode).toBe(1);
  expect(
    JSON.parse(await readFile(reference.diagnosticFile, "utf8")).passed,
  ).toBe(false);
});
it("保存失败时保留短位置、错误码及修正动作", async () => {
  const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  const path = join(await root(), "occupied");
  await writeFile(path, "占用");
  await emitCommandResult("test", { secret: "不得进入终端的完整正文" }, path);
  const text = String(stderr.mock.calls[0]![0]);
  expect(text).not.toContain("完整正文");
  expect(JSON.parse(text)).toMatchObject({ directory: path, code: "EEXIST" });
  expect(process.exitCode).toBe(1);
});
it.each([0, 3, 1.5, NaN])("拒绝非法分片字节上限%s", async (bytes) => {
  await expect(saveTextParts("文本", await root(), bytes)).rejects.toThrow(
    "resultPartBytes",
  );
});
