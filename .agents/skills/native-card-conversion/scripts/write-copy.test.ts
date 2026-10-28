import {
  withTestResources,
  testResources,
  testRuntime,
} from "./test-resources.ts";
import { completeSourceFixture } from "./source-fixtures.ts";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { begin } from "./source.ts";
import { readTaskContext } from "./task-context.ts";
import { readCommandData, commandStderr } from "./cli-test-result.ts";
import { mapCopyFile, mapCopyFieldsFile } from "./write.ts";

const run = promisify(execFile);
const entrypoint = resolve(
  ".agents/skills/native-card-conversion/scripts/convert.mjs",
);

function chunk(type: string, data = Buffer.alloc(0)) {
  const bytes = Buffer.alloc(data.length + 12);
  bytes.writeUInt32BE(data.length);
  bytes.write(type, 4, "ascii");
  data.copy(bytes, 8);
  return bytes;
}

function pngText(key: string, value: string) {
  return chunk("tEXt", Buffer.from(key + "\0" + value, "latin1"));
}

function png(...chunks: Buffer[]) {
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", Buffer.alloc(13)),
    ...chunks,
    chunk("IEND"),
  ]);
}

async function fixture(source: unknown, extension: "json" | "png" = "json") {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), "copy command ")),
  );
  testResources().addDirectory(directory);
  const sourceFile = join(directory, `card.${extension}`);
  const sourceJson = JSON.stringify(completeSourceFixture(source));
  const sourceBytes =
    extension === "png"
      ? png(pngText("ccv3", Buffer.from(sourceJson).toString("base64")))
      : Buffer.from(sourceJson);
  await writeFile(sourceFile, sourceBytes);
  const begun = await begin(sourceFile);
  const task = {
    ...(await readTaskContext(begun.taskFile)),
    taskFile: begun.taskFile,
  };
  testResources().addDirectory(task.outputDirectory);
  return { directory, sourceFile, sourceBytes, task };
}

async function fixtureJson(sourceJson: string) {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), "copy command ")),
  );
  testResources().addDirectory(directory);
  const sourceFile = join(directory, "card.json");
  await writeFile(sourceFile, sourceJson);
  const begun = await begin(sourceFile);
  const task = {
    ...(await readTaskContext(begun.taskFile)),
    taskFile: begun.taskFile,
  };
  testResources().addDirectory(task.outputDirectory);
  return { directory, sourceFile, task };
}

async function cli(args: string[], cwd = process.cwd()) {
  const running = run(process.execPath, [entrypoint, ...args], {
    cwd,
    maxBuffer: 1024 * 1024,
    timeout: testRuntime.processTimeoutMs,
    killSignal: "SIGKILL",
  });
  testResources().trackChild(running.child);
  const result = await testResources().measure(`cli:${args[0]}`, () => running);
  return readCommandData(result.stdout);
}

async function failedCli(args: string[], cwd = process.cwd()) {
  try {
    await cli(args, cwd);
    throw new Error("Expected the CLI command to fail.");
  } catch (error) {
    if ((error as Error).message === "Expected the CLI command to fail.")
      throw error;
    const result = await readCommandData(commandStderr(error));
    expect(result.error).toBeTypeOf("string");
    expect(String(result.error).trim()).not.toBe("");
    return result;
  }
}

describe("copy command text files", () => {
  it.each(["json", "png"] as const)(
    "copies HTML, CSS, CRLF and UTF-16 content from a %s card without adding bytes",
    withTestResources(async (extension) => {
      const value =
        "  <section>\r\n<style>.x { color: red; }</style>\r\n😀</section>\r\n";
      const source = { name: "复制测试", body: value };
      const directory = await realpath(
        await mkdtemp(join(tmpdir(), "copy CLI cwd ")),
      );
      testResources().addDirectory(directory);
      const sourceFile = join(directory, `角色卡.${extension}`);
      const sourceJson = JSON.stringify(completeSourceFixture(source));
      const sourceBytes =
        extension === "png"
          ? png(pngText("ccv3", Buffer.from(sourceJson).toString("base64")))
          : Buffer.from(sourceJson);
      await writeFile(sourceFile, sourceBytes);

      const begun = await cli(["begin", `角色卡.${extension}`], directory);
      const task = {
        ...(await readTaskContext(String(begun.taskFile))),
        taskFile: String(begun.taskFile),
      };
      testResources().addDirectory(task.outputDirectory);
      const result = await cli(
        ["copy", task.taskFile, "/body", "openings/source.txt"],
        directory,
      );

      expect(result).toMatchObject({
        file: join(task.packageDirectory, "openings/source.txt"),
      });
      expect(await readFile(String(result.file))).toEqual(Buffer.from(value));
      expect(await readFile(sourceFile)).toEqual(sourceBytes);
    }),
  );

  it(
    "does not copy into an unrelated packageDirectory from a changed task",
    withTestResources(async () => {
      const { task } = await fixture({ name: "复制边界角色", body: "原文" });
      const outsidePackage = await realpath(
        await mkdtemp(join(tmpdir(), "copy outside package ")),
      );
      testResources().addDirectory(outsidePackage);
      const savedTask = JSON.parse(
        await readFile(task.taskFile, "utf8"),
      ) as Record<string, unknown>;
      savedTask.packageDirectory = outsidePackage;
      await writeFile(task.taskFile, JSON.stringify(savedTask));

      await expect(
        mapCopyFile(task.taskFile, "/body", "openings/copied.txt"),
      ).rejects.toThrow("任务文件与工作区根目录");
      await expect(
        readFile(join(outsidePackage, "openings/copied.txt")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    }),
  );

  it(
    "writes the selected UTF-16 substring, including its CRLF and HTML bytes",
    withTestResources(async () => {
      const value = "A😀\r\n<b>猫</b>";
      const { task } = await fixture({ name: "片段角色", body: value });
      const result = await mapCopyFile(
        task.taskFile,
        "/body",
        "openings/fragment.txt",
        { start: 1, end: 9 },
      );

      expect(result).toMatchObject({
        file: join(task.packageDirectory, "openings/fragment.txt"),
      });
      expect(await readFile(result.file, "utf8")).toBe("😀\r\n<b>猫");
    }),
  );

  it(
    "accepts the matching substring flags through the public CLI",
    withTestResources(async () => {
      const value = "A😀\r\n<b>猫</b>";
      const { directory, task } = await fixture({
        name: "CLI 片段角色",
        body: value,
      });
      const result = await cli(
        [
          "copy",
          task.taskFile,
          "/body",
          "openings/cli-fragment.txt",
          "--start",
          "1",
          "--end",
          "9",
        ],
        directory,
      );

      expect(result.file).toBe(
        join(task.packageDirectory, "openings/cli-fragment.txt"),
      );
      expect(await readFile(String(result.file), "utf8")).toBe("😀\r\n<b>猫");
    }),
  );

  const invalidRanges: Array<{
    options: { start?: number; end?: number };
    reason: string;
  }> = [
    { options: { start: -1, end: 1 }, reason: "负起点" },
    { options: { start: 1.5, end: 2 }, reason: "非整数起点" },
    {
      options: { start: 0, end: Number.MAX_SAFE_INTEGER + 1 },
      reason: "不安全终点",
    },
    { options: { start: 4, end: 3 }, reason: "倒置范围" },
    { options: { start: 0, end: 14 }, reason: "超出字符串长度" },
  ];
  it.each(invalidRanges)(
    "rejects a source range with $reason",
    withTestResources(async ({ options }) => {
      const { task } = await fixture({
        name: "范围角色",
        body: "A😀\r\n<b>猫</b>",
      });
      await expect(
        mapCopyFile(task.taskFile, "/body", "openings/fragment.txt", options),
      ).rejects.toThrow();
    }),
  );

  it.each([
    { options: { start: 2, end: 3 }, reason: "起点切开代理对" },
    { options: { start: 1, end: 2 }, reason: "终点切开代理对" },
  ])(
    "rejects a substring when $reason splits a surrogate pair",
    withTestResources(async ({ options }) => {
      const { task } = await fixture({ name: "代理对角色", body: "A😀B" });
      await expect(
        mapCopyFile(task.taskFile, "/body", "openings/fragment.txt", options),
      ).rejects.toThrow();
    }),
  );

  it(
    "rejects fragment ranges for a non-string source value",
    withTestResources(async () => {
      const { task } = await fixture({ name: "JSON 角色", body: { value: 1 } });
      await expect(
        mapCopyFile(task.taskFile, "/body", "data/copied.json", {
          start: 0,
          end: 1,
        }),
      ).rejects.toThrow();
    }),
  );
});

describe("copy command JSON values and target pointers", () => {
  it(
    "writes a non-string source value as JSON",
    withTestResources(async () => {
      const value = { active: false, count: 0, values: ["甲", null] };
      const { task } = await fixture({ name: "JSON 角色", body: value });
      const result = await mapCopyFile(
        task.taskFile,
        "/body",
        "data/copied.json",
      );

      expect(result).toMatchObject({
        file: join(task.packageDirectory, "data/copied.json"),
      });
      expect(JSON.parse(await readFile(result.file, "utf8"))).toEqual(value);
    }),
  );

  it(
    "preserves the existing target when pretty-printing a 10000-level JSON value fails",
    withTestResources(async () => {
      const { task } = await fixture({ name: "深层复制角色", nested: null });
      const nested = "[".repeat(10_000) + "0" + "]".repeat(10_000);
      await writeFile(
        task.sourceFile,
        `{"name":"深层复制角色","nested":${nested}}`,
      );
      const targetFile = join(task.packageDirectory, "data/deep-copy.json");
      await mkdir(join(task.packageDirectory, "data"), { recursive: true });
      const existing = Buffer.from('{"keep":"复制前内容"}\r\n');
      await writeFile(targetFile, existing);

      await expect(
        mapCopyFile(task.taskFile, "/nested", "data/deep-copy.json"),
      ).rejects.toThrow();
      expect(await readFile(targetFile)).toEqual(existing);
    }),
  );

  it(
    "writes an escaped target pointer while preserving existing sibling fields",
    withTestResources(async () => {
      const { task } = await fixture({
        name: "目标角色",
        "source/name~": "新值",
      });
      const targetFile = join(task.packageDirectory, "data/profile.json");
      await mkdir(join(task.packageDirectory, "data"), { recursive: true });
      await writeFile(
        targetFile,
        JSON.stringify({
          keep: { enabled: true },
          profile: { "a/b~c": "旧值" },
        }),
      );

      const result = await mapCopyFile(
        task.taskFile,
        "/source~1name~0",
        "data/profile.json",
        { targetPointer: "/profile/a~1b~0c" },
      );

      expect(result).toEqual({
        file: targetFile,
        targetPointer: "/profile/a~1b~0c",
      });
      expect(JSON.parse(await readFile(targetFile, "utf8"))).toEqual({
        keep: { enabled: true },
        profile: { "a/b~c": "新值" },
      });
    }),
  );

  it(
    "writes eight source fields in one copy operation",
    withTestResources(async () => {
      const values = Array.from({ length: 8 }, (_, index) => `value-${index}`);
      const source = {
        name: "多字段角色",
        ...Object.fromEntries(
          values.map((value, index) => [`source${index}`, value]),
        ),
      };
      const { directory, task } = await fixture(source);
      const target = join(task.packageDirectory, "data/eight-fields.json");
      await mkdir(join(task.packageDirectory, "data"), { recursive: true });
      await writeFile(target, JSON.stringify({ result: { keep: true } }));
      const fields = values.flatMap((_, index) => [
        "--field",
        `/source${index}`,
        `/result/field${index}`,
      ]);

      const result = await cli(
        ["copy", task.taskFile, "data/eight-fields.json", ...fields],
        directory,
      );

      expect(result).toMatchObject({ file: target, fields: 8 });
      expect(JSON.parse(await readFile(target, "utf8"))).toEqual({
        result: {
          keep: true,
          ...Object.fromEntries(
            values.map((value, index) => [`field${index}`, value]),
          ),
        },
      });
    }),
  );

  it.each([
    ["/target", "/target"],
    ["/target", "/target/child"],
  ])(
    "preserves an existing file for overlapping target fields %j",
    withTestResources(async (first, second) => {
      const { task } = await fixture({ one: "one", two: "two" });
      const target = join(task.packageDirectory, "data/overlap.json");
      await mkdir(join(task.packageDirectory, "data"), { recursive: true });
      const before = Buffer.from('{"keep":true}\n');
      await writeFile(target, before);

      await expect(
        mapCopyFieldsFile(task.taskFile, "data/overlap.json", [
          { sourcePointer: "/one", targetPointer: first },
          { sourcePointer: "/two", targetPointer: second },
        ]),
      ).rejects.toThrow("父子重叠");
      expect(await readFile(target)).toEqual(before);
    }),
  );

  it(
    "supports eight concurrent CLI writes to distinct files",
    withTestResources(async () => {
      const { directory, task } = await fixture({ name: "并发写入角色" });
      const completed = await Promise.allSettled(
        Array.from({ length: 8 }, (_, index) =>
          cli(
            [
              "copy",
              task.taskFile,
              `data/concurrent-${index}.json`,
              "--field",
              "/name",
              "/name",
            ],
            directory,
          ),
        ),
      );

      const writes = completed.map((result) => {
        if (result.status === "rejected") throw result.reason;
        return result.value;
      });
      expect(writes).toHaveLength(8);
      for (let index = 0; index < writes.length; index++) {
        const target = join(
          task.packageDirectory,
          `data/concurrent-${index}.json`,
        );
        expect(writes[index]).toMatchObject({ file: target, fields: 1 });
        expect(JSON.parse(await readFile(target, "utf8"))).toEqual({
          name: "并发写入角色",
        });
      }
    }),
    testRuntime.integrationTimeoutMs,
  );

  it(
    "creates absent parent objects and arrays from the next pointer token",
    withTestResources(async () => {
      const { task } = await fixture({ name: "父级角色", text: "原文" });
      await mapCopyFile(task.taskFile, "/text", "data/parents.json", {
        targetPointer: "/created/0/value",
      });
      await mapCopyFile(task.taskFile, "/text", "data/parents.json", {
        targetPointer: "/named/01/value",
      });

      expect(
        JSON.parse(
          await readFile(
            join(task.packageDirectory, "data/parents.json"),
            "utf8",
          ),
        ),
      ).toEqual({
        created: [{ value: "原文" }],
        named: { "01": { value: "原文" } },
      });
    }),
  );

  it(
    "replaces an existing array member and appends at its current length",
    withTestResources(async () => {
      const { task } = await fixture({ name: "数组角色", text: "新值" });
      const targetFile = join(task.packageDirectory, "data/list.json");
      await mkdir(join(task.packageDirectory, "data"), { recursive: true });
      await writeFile(
        targetFile,
        JSON.stringify({ values: [{ text: "旧值" }] }),
      );

      await mapCopyFile(task.taskFile, "/text", "data/list.json", {
        targetPointer: "/values/0/text",
      });
      await mapCopyFile(task.taskFile, "/text", "data/list.json", {
        targetPointer: "/values/1",
      });

      expect(JSON.parse(await readFile(targetFile, "utf8"))).toEqual({
        values: [{ text: "新值" }, "新值"],
      });
    }),
  );

  it(
    "uses an empty target pointer to replace the entire JSON value",
    withTestResources(async () => {
      const replacement = { nested: ["完整替换"] };
      const { directory, task } = await fixture({
        name: "根替换角色",
        replacement,
      });
      await mkdir(join(task.packageDirectory, "data"), { recursive: true });
      await writeFile(
        join(task.packageDirectory, "data/root.json"),
        JSON.stringify({ old: true }),
      );
      const result = await cli(
        [
          "copy",
          task.taskFile,
          "/replacement",
          "data/root.json",
          "--target-pointer",
          "",
        ],
        directory,
      );

      expect(result).toMatchObject({
        file: join(task.packageDirectory, "data/root.json"),
        targetPointer: "",
      });
      expect(JSON.parse(await readFile(String(result.file), "utf8"))).toEqual(
        replacement,
      );
    }),
  );

  it.each([
    ["/values/2", "稀疏数组下标"],
    ["/values/01", "非规范数组下标"],
    ["/values/-", "追加标记"],
  ])(
    "rejects %s when it does not address an existing index or array length",
    withTestResources(async (pointer) => {
      const { task } = await fixture({ name: "数组边界角色", text: "原文" });
      const targetFile = join(task.packageDirectory, "data/list.json");
      await mkdir(join(task.packageDirectory, "data"), { recursive: true });
      await writeFile(targetFile, JSON.stringify({ values: ["已有"] }));

      await expect(
        mapCopyFile(task.taskFile, "/text", "data/list.json", {
          targetPointer: pointer,
        }),
      ).rejects.toThrow();
      expect(JSON.parse(await readFile(targetFile, "utf8"))).toEqual({
        values: ["已有"],
      });
    }),
  );

  it(
    "rejects an existing parent whose type conflicts with the pointer path",
    withTestResources(async () => {
      const { task } = await fixture({ name: "冲突角色", text: "原文" });
      const targetFile = join(task.packageDirectory, "data/conflict.json");
      await mkdir(join(task.packageDirectory, "data"), { recursive: true });
      await writeFile(targetFile, JSON.stringify({ parent: "文本" }));

      await expect(
        mapCopyFile(task.taskFile, "/text", "data/conflict.json", {
          targetPointer: "/parent/child",
        }),
      ).rejects.toThrow();
      expect(JSON.parse(await readFile(targetFile, "utf8"))).toEqual({
        parent: "文本",
      });
    }),
  );

  it.each(["__proto__", "constructor", "prototype", "toString"])(
    "writes %s as an ordinary JSON key without changing prototypes",
    withTestResources(async (key) => {
      const sourceJson = JSON.stringify(
        completeSourceFixture({
          name: "原型角色",
          [key]: { value: "安全值" },
        }),
      );
      const { task } = await fixtureJson(sourceJson);
      const targetFile = join(task.packageDirectory, "data/prototype.json");
      const pointer = `/${key}/value`;

      await mapCopyFile(task.taskFile, pointer, "data/prototype.json", {
        targetPointer: pointer,
      });

      const target = JSON.parse(await readFile(targetFile, "utf8")) as Record<
        string,
        unknown
      >;
      expect(Object.hasOwn(target, key)).toBe(true);
      expect(target[key]).toEqual({ value: "安全值" });
      expect(Object.getPrototypeOf(target)).toBe(Object.prototype);
      expect(({} as Record<string, unknown>).value).toBeUndefined();
    }),
  );

  it(
    "rejects malformed source and target JSON Pointers",
    withTestResources(async () => {
      const { task } = await fixture({ name: "Pointer 角色", text: "原文" });
      await expect(
        mapCopyFile(task.taskFile, "/text~2", "openings/copy.txt"),
      ).rejects.toThrow();
      await expect(
        mapCopyFile(task.taskFile, "/text", "data/pointer.json", {
          targetPointer: "/bad~2key",
        }),
      ).rejects.toThrow();
    }),
  );

  it(
    "returns malformed CLI Pointer errors as JSON",
    withTestResources(async () => {
      const { directory, task } = await fixture({
        name: "CLI Pointer 角色",
        text: "原文",
      });
      const result = await failedCli(
        [
          "copy",
          task.taskFile,
          "/text",
          "data/pointer.json",
          "--target-pointer",
          "/bad~2key",
        ],
        directory,
      );
      expect(result.error).toBeTruthy();
    }),
  );

  it(
    "rejects target pointers for files without a JSON media type",
    withTestResources(async () => {
      const { task } = await fixture({ name: "字段角色", text: "原文" });
      await expect(
        mapCopyFile(task.taskFile, "/text", "openings/copy.txt", {
          targetPointer: "",
        }),
      ).rejects.toThrow();
    }),
  );

  it(
    "rejects malformed existing JSON when a target pointer is requested",
    withTestResources(async () => {
      const { task } = await fixture({ name: "损坏目标角色", text: "原文" });
      const targetFile = join(task.packageDirectory, "data/broken.json");
      await mkdir(join(task.packageDirectory, "data"), { recursive: true });
      await writeFile(targetFile, "{");

      await expect(
        mapCopyFile(task.taskFile, "/text", "data/broken.json", {
          targetPointer: "/value",
        }),
      ).rejects.toThrow();
      expect(await readFile(targetFile, "utf8")).toBe("{");
    }),
  );
});

describe("copy command arguments and package paths", () => {
  const invalidCliOptions: Array<{ options: string[]; reason: string }> = [
    {
      options: ["--start", "0", "--start", "1", "--end", "2"],
      reason: "重复选项",
    },
    {
      options: ["--target-pointer", "/a", "--target-pointer", "/b"],
      reason: "重复目标字段选项",
    },
    { options: ["--unknown", "value"], reason: "未知选项" },
    { options: ["--start", "1.5", "--end", "2"], reason: "非整数索引" },
    { options: ["--start", "-1", "--end", "2"], reason: "负索引" },
    {
      options: ["--start", "0", "--end", "9007199254740992"],
      reason: "不安全索引",
    },
  ];
  it.each(invalidCliOptions)(
    "rejects CLI options for $reason",
    withTestResources(async ({ options }) => {
      const { directory, task } = await fixture({
        name: "选项角色",
        text: "0123456789",
      });
      const result = await failedCli(
        ["copy", task.taskFile, "/text", "openings/copy.txt", ...options],
        directory,
      );
      expect(result.error).toBeTruthy();
    }),
  );

  it(
    "rejects a fragment option for a non-string value through the CLI",
    withTestResources(async () => {
      const { directory, task } = await fixture({
        name: "JSON 片段角色",
        value: { nested: true },
      });
      const result = await failedCli(
        [
          "copy",
          task.taskFile,
          "/value",
          "data/value.json",
          "--start",
          "0",
          "--end",
          "1",
        ],
        directory,
      );
      expect(result.error).toBeTruthy();
    }),
  );

  it.each([
    [{ start: 2 }, "cdef"],
    [{ end: 4 }, "abcd"],
    [{ start: 6 }, ""],
    [{ end: 0 }, ""],
  ] as const)(
    "applies omitted fragment defaults: %j",
    withTestResources(async (options, expected) => {
      const { task } = await fixture({ name: "片段角色", text: "abcdef" });
      await mapCopyFile(task.taskFile, "/text", "openings/copy.txt", options);
      expect(
        await readFile(
          join(task.packageDirectory, "openings/copy.txt"),
          "utf8",
        ),
      ).toBe(expected);
    }),
  );

  it.each(["../outside.txt", "notes/unlisted.txt", "text/original.html"])(
    "rejects a target path outside the formal package file rules: %s",
    withTestResources(async (target) => {
      const { task } = await fixture({ name: "路径角色", text: "原文" });
      await expect(
        mapCopyFile(task.taskFile, "/text", target),
      ).rejects.toThrow();
    }),
  );

  it(
    "rejects a target directory symlink without writing outside the package",
    withTestResources(async () => {
      const { directory, task } = await fixture({
        name: "目录链接角色",
        text: "原文",
      });
      const outside = join(directory, "outside");
      await mkdir(outside);
      await symlink(outside, join(task.packageDirectory, "openings"));

      await expect(
        mapCopyFile(task.taskFile, "/text", "openings/copy.txt"),
      ).rejects.toThrow();
      await expect(readFile(join(outside, "copy.txt"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    }),
  );

  it(
    "rejects a target file symlink without changing its destination",
    withTestResources(async () => {
      const { directory, task } = await fixture({
        name: "文件链接角色",
        text: "新文",
      });
      const outsideFile = join(directory, "outside.txt");
      await mkdir(join(task.packageDirectory, "openings"), { recursive: true });
      await writeFile(outsideFile, "保持原文");
      await symlink(
        outsideFile,
        join(task.packageDirectory, "openings/copy.txt"),
      );

      await expect(
        mapCopyFile(task.taskFile, "/text", "openings/copy.txt"),
      ).rejects.toThrow();
      expect(await readFile(outsideFile, "utf8")).toBe("保持原文");
    }),
  );
});
