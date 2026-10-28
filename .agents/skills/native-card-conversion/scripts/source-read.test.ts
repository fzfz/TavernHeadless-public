import { v1Card } from "./source-fixtures.ts";
import {
  lstat,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { begin, readSource } from "./source.ts";
import { taskPaths } from "./source-config.ts";

const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture(source: unknown) {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), "source read ")),
  );
  cleanup.push(directory);
  const originalSourceFile = join(directory, "source card.json");
  await writeFile(originalSourceFile, JSON.stringify(v1Card()));
  const task = await begin(originalSourceFile);
  const outputDirectory = dirname(task.taskFile);
  await writeFile(originalSourceFile, JSON.stringify(source));
  await writeFile(
    join(outputDirectory, taskPaths.source),
    JSON.stringify(source),
  );
  cleanup.push(outputDirectory);
  return {
    directory,
    originalSourceFile,
    sourceFile: join(outputDirectory, taskPaths.source),
    taskFile: task.taskFile,
    task: {
      ...task,
      outputDirectory,
      sourceFile: join(outputDirectory, taskPaths.source),
    },
  };
}

describe("read source values", () => {
  it.each(
    [null, false, 0, 42, "", " 文本 ", [1, "甲"], { content: "正文" }].map(
      (value) => ({ value }),
    ),
  )("returns the original value %j", async ({ value }) => {
    const { taskFile } = await fixture({ data: { value } });
    const result = await readSource(taskFile, "/data/value");
    expect(result.pointer).toBe("/data/value");
    expect(result.value).toEqual(value);
    expect("lines" in result).toBe(typeof value === "string");
  });
  it.each(
    [null, false, 0, "正文", ["甲"], { name: "角色" }].map((source) => ({
      source,
    })),
  )("reads a root value %j", async ({ source }) => {
    const { taskFile } = await fixture(source);
    expect((await readSource(taskFile, "")).value).toEqual(source);
  });
  it("decodes escaped and empty object keys and reads array members", async () => {
    const { taskFile } = await fixture({
      "": { "a/b": { "~key": ["原文"] }, "~1": "字面键" },
    });
    expect((await readSource(taskFile, "//a~1b/~0key/0")).value).toBe("原文");
    expect((await readSource(taskFile, "//~01")).value).toBe("字面键");
  });
  it("reads explicit prototype-like keys as ordinary source properties", async () => {
    const { taskFile } = await fixture(
      JSON.parse('{"__proto__":{"constructor":"正文"}}'),
    );
    expect((await readSource(taskFile, "/__proto__/constructor")).value).toBe(
      "正文",
    );
  });
  it.each(["data", "#", "/bad~", "/bad~2", "/bad~~0"])(
    "rejects malformed pointers %s",
    async (pointer) => {
      const { taskFile } = await fixture({});
      await expect(readSource(taskFile, pointer)).rejects.toThrow(
        "源 JSON Pointer",
      );
    },
  );
  it.each([
    "/missing",
    "/data/missing",
    "/data/value/child",
    "/data/null/child",
    "/constructor",
    "/__proto__",
    "/toString",
    "/data/array/length",
    "/data/array/01",
    "/data/array/-",
    "/data/array/-1",
    "/data/array/1",
  ])("rejects missing or inherited properties %s", async (pointer) => {
    const { taskFile } = await fixture({
      data: { value: 1, null: null, array: [1] },
    });
    await expect(readSource(taskFile, pointer)).rejects.toThrow(
      `源位置 ${pointer} 不存在`,
    );
  });
  it("does not treat a numeric object key as an array index", async () => {
    const { taskFile } = await fixture({ "01": "原文" });
    expect((await readSource(taskFile, "/01")).value).toBe("原文");
  });
});

describe("read string line positions", () => {
  it.each([
    ["", [{ start: 0, end: 0 }]],
    ["甲😀乙", [{ start: 0, end: 4 }]],
    [
      "甲\n乙",
      [
        { start: 0, end: 2 },
        { start: 2, end: 3 },
      ],
    ],
    [
      "甲\r\n乙\r\n",
      [
        { start: 0, end: 3 },
        { start: 3, end: 6 },
        { start: 6, end: 6 },
      ],
    ],
    [
      "\n\n",
      [
        { start: 0, end: 1 },
        { start: 1, end: 2 },
        { start: 2, end: 2 },
      ],
    ],
    [
      "a\rb\u2028c\u2029d",
      [
        { start: 0, end: 2 },
        { start: 2, end: 4 },
        { start: 4, end: 6 },
        { start: 6, end: 7 },
      ],
    ],
  ] as const)("indexes %j without changing its text", async (value, lines) => {
    const { taskFile } = await fixture({ value });
    expect(await readSource(taskFile, "/value")).toEqual({
      pointer: "/value",
      value,
      lines,
    });
  });
  it("preserves source HTML, CSS, template code, whitespace and UTF-16 offsets", async () => {
    const value =
      "  <style>\r\n.x{content:'😀'}\r\n</style>\n<% const x = 1; %>\n<script>throw Error('不可执行');</script>  ";
    const { taskFile } = await fixture({ content: value });
    const result = await readSource(taskFile, "/content");
    expect(result.value).toBe(value);
    if (!result.lines) throw new Error("Expected string line positions");
    expect(
      result.lines.map(({ start, end }) => value.slice(start, end)).join(""),
    ).toBe(value);
    expect(result.lines[1]).toEqual({ start: 11, end: 29 });
  });
  it("repeated reads produce the same line ranges", async () => {
    const { taskFile } = await fixture({ content: "甲\r\n乙\n" });
    expect(await readSource(taskFile, "/content")).toEqual(
      await readSource(taskFile, "/content"),
    );
  });
});

describe("read task and command errors", () => {
  it.each([null, [], {}, { sourceFile: 1 }, { sourceFile: "source.json" }])(
    "rejects a task without an absolute source path %j",
    async (task) => {
      const { taskFile } = await fixture({});
      await writeFile(taskFile, JSON.stringify(task));
      await expect(readSource(taskFile, "")).rejects.toThrow(
        "任务文件缺少必需字段",
      );
    },
  );
  it("reports malformed task JSON", async () => {
    const { taskFile } = await fixture({});
    await writeFile(taskFile, "{");
    await expect(readSource(taskFile, "")).rejects.toBeInstanceOf(SyntaxError);
  });
  it("reports malformed source JSON", async () => {
    const { taskFile, sourceFile } = await fixture({});
    await writeFile(sourceFile, "{");
    await expect(readSource(taskFile, "")).rejects.toBeInstanceOf(SyntaxError);
  });
  it("reports missing task and source files", async () => {
    const { taskFile, sourceFile } = await fixture({});
    await expect(readSource(taskFile + ".missing", "")).rejects.toThrow(
      "ENOENT",
    );
    await rm(sourceFile);
    await expect(readSource(taskFile, "")).rejects.toThrow("源副本不存在");
  });
  it("rejects a sourceFile path replaced with a file outside the task", async () => {
    const { taskFile, task, directory } = await fixture({ name: "边界角色" });
    const outsideSource = join(directory, "replacement.json");
    await writeFile(outsideSource, JSON.stringify({ secret: "不应读取" }));
    const savedTask = JSON.parse(await readFile(taskFile, "utf8")) as Record<
      string,
      unknown
    >;
    savedTask.sourceFile = outsideSource;
    await writeFile(taskFile, JSON.stringify(savedTask));

    await expect(readSource(taskFile, "")).rejects.toThrow("源副本");
    expect(await readFile(outsideSource, "utf8")).toBe(
      JSON.stringify({ secret: "不应读取" }),
    );
    expect(await readFile(task.sourceFile, "utf8")).toContain("边界角色");
  });
  it("rejects a linked source copy", async () => {
    const { taskFile, task, directory } = await fixture({ name: "链接角色" });
    const outsideSource = join(directory, "external.json");
    await writeFile(outsideSource, JSON.stringify({ name: "外部源" }));
    await rm(task.sourceFile);
    await symlink(outsideSource, task.sourceFile);

    await expect(readSource(taskFile, "")).rejects.toThrow("源副本");
    expect(await readFile(outsideSource, "utf8")).toBe(
      JSON.stringify({ name: "外部源" }),
    );
  });
  it("rejects a packageDirectory replaced with an unrelated path", async () => {
    const { taskFile } = await fixture({ name: "包根替换角色" });
    const outsidePackage = await realpath(
      await mkdtemp(join(tmpdir(), "source read outside package ")),
    );
    cleanup.push(outsidePackage);
    const savedTask = JSON.parse(await readFile(taskFile, "utf8")) as Record<
      string,
      unknown
    >;
    savedTask.packageDirectory = outsidePackage;
    await writeFile(taskFile, JSON.stringify(savedTask));

    await expect(readSource(taskFile, "")).rejects.toThrow(
      "任务文件与工作区根目录",
    );
    expect(await readdir(outsidePackage)).toEqual([]);
  });
  it("rejects a package root symlink", async () => {
    const { taskFile, task } = await fixture({ name: "包根链接角色" });
    const outsidePackage = await realpath(
      await mkdtemp(join(tmpdir(), "source read linked package ")),
    );
    cleanup.push(outsidePackage);
    await rm(task.packageDirectory, { recursive: true });
    await symlink(outsidePackage, task.packageDirectory, "dir");

    await expect(readSource(taskFile, "")).rejects.toThrow(
      "任务文件与工作区根目录",
    );
    expect(await readdir(outsidePackage)).toEqual([]);
  });
});
