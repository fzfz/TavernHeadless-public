import { completeSourceFixture } from "./source-fixtures.ts";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { begin } from "./source.ts";
import { readTaskContext } from "./task-context.ts";
import { readCommandData, commandStderr } from "./cli-test-result.ts";
import { mapParseFile, mapParseFieldsFile, runParse } from "./write.ts";

const run = promisify(execFile);
const entrypoint = resolve(
  ".agents/skills/native-card-conversion/scripts/convert.mjs",
);
const cleanup: string[] = [];
const regexPointer = "/extensions/regex_scripts";

afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

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

function regexRule() {
  return {
    id: "rule-id",
    scriptName: "规则名称",
    findRegex: "/源词/g",
    replaceString: "目标词",
    trimStrings: [" ", "\n"],
    placement: [2],
    disabled: false,
    markdownOnly: true,
    promptOnly: false,
    runOnEdit: true,
    substituteRegex: 2,
  };
}

async function fixture(source: unknown, extension: "json" | "png" = "json") {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), "parse command ")),
  );
  cleanup.push(directory);
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
  cleanup.push(task.outputDirectory);
  return { directory, sourceFile, sourceBytes, task };
}

async function cli(args: string[], cwd = process.cwd()) {
  const result = await run(process.execPath, [entrypoint, ...args], {
    cwd,
    maxBuffer: 1024 * 1024,
  });
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

describe("parse command JSON format", () => {
  it.each([
    ['prefix {"n":1}', { start: 7 }],
    ['{"n":1} suffix', { end: 7 }],
  ])("parses with an omitted fragment boundary", async (text, options) => {
    const { task } = await fixture({ name: "解析角色", text });
    await mapParseFile(task.taskFile, "/text", "data/parsed.json", {
      ...options,
      format: "json",
    });
    expect(
      JSON.parse(
        await readFile(join(task.packageDirectory, "data/parsed.json"), "utf8"),
      ),
    ).toEqual({ n: 1 });
  });

  it("does not parse into an unrelated packageDirectory from a changed task", async () => {
    const { task } = await fixture({ name: "解析边界角色", configText: "{}" });
    const outsidePackage = await realpath(
      await mkdtemp(join(tmpdir(), "parse outside package ")),
    );
    cleanup.push(outsidePackage);
    const savedTask = JSON.parse(
      await readFile(task.taskFile, "utf8"),
    ) as Record<string, unknown>;
    savedTask.packageDirectory = outsidePackage;
    await writeFile(task.taskFile, JSON.stringify(savedTask));

    await expect(
      mapParseFile(task.taskFile, "/configText", "data/parsed.json", {
        format: "json",
      }),
    ).rejects.toThrow("任务文件与工作区根目录");
    await expect(
      readFile(join(outsidePackage, "data/parsed.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("parses JSON text from the source and writes the value to a package file", async () => {
    const value = { count: 3, active: true, labels: ["甲", "乙"] };
    const { directory, task } = await fixture({
      name: "解析测试角色",
      configText: JSON.stringify(value),
    });
    const result = await cli(
      [
        "parse",
        task.taskFile,
        "/configText",
        "data/parsed.json",
        "--format",
        "json",
      ],
      directory,
    );

    expect(result).toMatchObject({
      file: join(task.packageDirectory, "data/parsed.json"),
    });
    expect(JSON.parse(await readFile(String(result.file), "utf8"))).toEqual(
      value,
    );
  });

  it.each([
    { label: "object", text: '{"count":2}', value: { count: 2 } },
    { label: "array", text: '[1,"甲"]', value: [1, "甲"] },
    { label: "string", text: '"作为 JSON 字符串"', value: "作为 JSON 字符串" },
    { label: "number", text: "0", value: 0 },
    { label: "boolean", text: "false", value: false },
    { label: "null", text: "null", value: null },
  ])("writes a parsed JSON $label value as JSON", async ({ text, value }) => {
    const { task } = await fixture({ name: "JSON 值角色", configText: text });
    const result = await mapParseFile(
      task.taskFile,
      "/configText",
      "data/parsed.json",
      { format: "json" },
    );

    expect(result).toMatchObject({
      file: join(task.packageDirectory, "data/parsed.json"),
    });
    expect(JSON.parse(await readFile(result.file, "utf8"))).toEqual(value);
  });

  it("applies UTF-16 slicing before JSON parsing and updates the requested field", async () => {
    const text = '😀\r\n{"n":1}\r\nignored';
    const { task } = await fixture({ name: "JSON 片段角色", configText: text });
    const targetFile = join(task.packageDirectory, "data/parsed.json");
    await mkdir(join(task.packageDirectory, "data"), { recursive: true });
    await writeFile(targetFile, JSON.stringify({ keep: true, initial: null }));

    const result = await mapParseFile(
      task.taskFile,
      "/configText",
      "data/parsed.json",
      { format: "json", start: 4, end: 11, targetPointer: "/initial" },
    );

    expect(result).toEqual({ file: targetFile, targetPointer: "/initial" });
    expect(JSON.parse(await readFile(targetFile, "utf8"))).toEqual({
      keep: true,
      initial: { n: 1 },
    });
  });

  it("rejects a non-string source value", async () => {
    const { task } = await fixture({
      name: "非文本角色",
      configText: { value: 1 },
    });

    await expect(
      mapParseFile(task.taskFile, "/configText", "data/parsed.json", {
        format: "json",
      }),
    ).rejects.toThrow();
  });
});

describe("parse command YAML format", () => {
  it("parses YAML mappings, sequences, block scalars and aliases", async () => {
    const text =
      "base: &base\n  enabled: true\nlabels:\n  - 第一\n  - 第二\ndetails:\n  text: |\n    第一行\n    第二行\ncopy: *base\n";
    const { task } = await fixture({ name: "YAML 角色", configText: text });

    const result = await mapParseFile(
      task.taskFile,
      "/configText",
      "data/yaml.json",
      { format: "yaml" },
    );

    expect(JSON.parse(await readFile(result.file, "utf8"))).toEqual({
      base: { enabled: true },
      labels: ["第一", "第二"],
      details: { text: "第一行\n第二行\n" },
      copy: { enabled: true },
    });
  });

  it("parses multiple JSON fields before writing the target once", async () => {
    const { directory, task } = await fixture({
      name: "批量解析角色",
      first: '{"n":1}',
      second: '{"n":2}',
    });
    const target = join(task.packageDirectory, "data/multiple.json");
    await mkdir(join(task.packageDirectory, "data"), { recursive: true });
    await writeFile(target, JSON.stringify({ keep: true }));

    const result = await cli(
      [
        "parse",
        task.taskFile,
        "data/multiple.json",
        "--format",
        "json",
        "--field",
        "/first",
        "/parsed/first",
        "--field",
        "/second",
        "/parsed/second",
      ],
      directory,
    );

    expect(result).toMatchObject({ file: target, fields: 2 });
    expect(JSON.parse(await readFile(target, "utf8"))).toEqual({
      keep: true,
      parsed: { first: { n: 1 }, second: { n: 2 } },
    });
  });

  it("preserves an existing target when a later batch field cannot be parsed", async () => {
    const { task } = await fixture({
      name: "解析失败角色",
      valid: '{"n":1}',
      invalid: "{",
    });
    const target = join(task.packageDirectory, "data/parse-failure.json");
    await mkdir(join(task.packageDirectory, "data"), { recursive: true });
    const before = Buffer.from('{"keep":"原文件"}\n');
    await writeFile(target, before);

    await expect(
      mapParseFieldsFile(
        task.taskFile,
        "data/parse-failure.json",
        [
          { sourcePointer: "/valid", targetPointer: "/parsed/valid" },
          { sourcePointer: "/invalid", targetPointer: "/parsed/invalid" },
        ],
        "json",
      ),
    ).rejects.toThrow();
    expect(await readFile(target)).toEqual(before);
  });

  it("rejects duplicate and parent-child parse targets before writing", async () => {
    const { task } = await fixture({
      name: "解析重叠角色",
      one: '{"n":1}',
      two: '{"n":2}',
    });
    const target = join(task.packageDirectory, "data/parse-overlap.json");
    await mkdir(join(task.packageDirectory, "data"), { recursive: true });
    const before = Buffer.from('{"keep":true}\n');
    await writeFile(target, before);

    await expect(
      mapParseFieldsFile(
        task.taskFile,
        "data/parse-overlap.json",
        [
          { sourcePointer: "/one", targetPointer: "/value" },
          { sourcePointer: "/two", targetPointer: "/value/nested" },
        ],
        "json",
      ),
    ).rejects.toThrow("父子重叠");
    expect(await readFile(target)).toEqual(before);
  });

  it("parses a YAML fragment through the CLI and preserves existing target fields", async () => {
    const text = "prefix\nvalue: 2\nsuffix";
    const { directory, task } = await fixture({
      name: "YAML CLI 角色",
      configText: text,
    });
    const targetFile = join(task.packageDirectory, "data/initial.json");
    await mkdir(join(task.packageDirectory, "data"), { recursive: true });
    await writeFile(targetFile, JSON.stringify({ existing: "保留" }));

    const result = await cli(
      [
        "parse",
        task.taskFile,
        "/configText",
        "data/initial.json",
        "--format",
        "yaml",
        "--start",
        "7",
        "--end",
        "15",
        "--target-pointer",
        "/initialState",
      ],
      directory,
    );

    expect(result).toMatchObject({
      file: targetFile,
      targetPointer: "/initialState",
    });
    expect(JSON.parse(await readFile(targetFile, "utf8"))).toEqual({
      existing: "保留",
      initialState: { value: 2 },
    });
  });
});

describe("parse errors leave package content unchanged", () => {
  const invalidSources: Array<{
    format: "json" | "yaml";
    text: string;
    reason: string;
  }> = [
    { format: "json", text: "{", reason: "JSON 语法错误" },
    { format: "yaml", text: "value: [", reason: "YAML 语法错误" },
    {
      format: "yaml",
      text: "value: first\nvalue: second\n",
      reason: "YAML 重复键",
    },
    {
      format: "yaml",
      text: '1: first\n"1": second\n',
      reason: "数值键与字符串键转换后冲突",
    },
    {
      format: "yaml",
      text: "? [甲, 乙]\n: 复杂键值\n",
      reason: "YAML 复杂映射键",
    },
    {
      format: "yaml",
      text: "value: !custom private\n",
      reason: "未知 YAML 标签警告",
    },
    { format: "yaml", text: "value: .nan\n", reason: "NaN" },
    { format: "yaml", text: "value: .inf\n", reason: "正无穷" },
    { format: "yaml", text: "value: -.inf\n", reason: "负无穷" },
    {
      format: "yaml",
      text: "value: !!binary SGVsbG8=\n",
      reason: "非 JSON 二进制对象",
    },
    {
      format: "yaml",
      text: "root: &node\n  child: *node\n",
      reason: "循环别名",
    },
  ];

  it.each(invalidSources)(
    "rejects $reason without changing an existing target",
    async ({ format, text }) => {
      const { task } = await fixture({
        name: "解析失败角色",
        configText: text,
      });
      const targetFile = join(task.packageDirectory, "data/existing.json");
      await mkdir(join(task.packageDirectory, "data"), { recursive: true });
      const existing = Buffer.from('{"keep":"原值"}\r\n');
      await writeFile(targetFile, existing);

      await expect(
        mapParseFile(task.taskFile, "/configText", "data/existing.json", {
          format,
          targetPointer: "/parsed",
        }),
      ).rejects.toThrow();
      expect(await readFile(targetFile)).toEqual(existing);
    },
  );

  it("rejects a JSON number that overflows to a non-finite value without changing the target", async () => {
    const { task } = await fixture({
      name: "非有限数角色",
      configText: '{"x":1e400}',
    });
    const targetFile = join(task.packageDirectory, "data/finite.json");
    await mkdir(join(task.packageDirectory, "data"), { recursive: true });
    const existing = Buffer.from('{"keep":"原值"}\r\n');
    await writeFile(targetFile, existing);

    await expect(
      mapParseFile(task.taskFile, "/configText", "data/finite.json", {
        format: "json",
      }),
    ).rejects.toThrow();
    expect(await readFile(targetFile)).toEqual(existing);
  });

  it("preserves the existing target when pretty-printing a 10000-level JSON value fails", async () => {
    const { task } = await fixture({ name: "深层解析角色", configText: "[]" });
    const nested = "[".repeat(10_000) + "0" + "]".repeat(10_000);
    await writeFile(
      task.sourceFile,
      JSON.stringify(
        completeSourceFixture({ name: "深层解析角色", configText: nested }),
      ),
    );
    const targetFile = join(task.packageDirectory, "data/deep-parse.json");
    await mkdir(join(task.packageDirectory, "data"), { recursive: true });
    const existing = Buffer.from('{"keep":"解析前内容"}\r\n');
    await writeFile(targetFile, existing);

    await expect(
      mapParseFile(task.taskFile, "/configText", "data/deep-parse.json", {
        format: "json",
      }),
    ).rejects.toThrow();
    expect(await readFile(targetFile)).toEqual(existing);
  });

  it.each([0, false, null, [], { value: "文本外" }])(
    "rejects non-string source %j through the CLI",
    async (configText) => {
      const { directory, task } = await fixture({
        name: "CLI 类型角色",
        configText,
      });
      const result = await failedCli(
        [
          "parse",
          task.taskFile,
          "/configText",
          "data/parsed.json",
          "--format",
          "json",
        ],
        directory,
      );
      expect(result.error).toBeTruthy();
    },
  );

  it("rejects a target pointer that is not valid JSON Pointer", async () => {
    const { task } = await fixture({
      name: "目标 Pointer 角色",
      configText: '{"value":true}',
    });
    const targetFile = join(task.packageDirectory, "data/target.json");
    await mkdir(join(task.packageDirectory, "data"), { recursive: true });
    const existing = Buffer.from('{"keep":1}');
    await writeFile(targetFile, existing);

    await expect(
      mapParseFile(task.taskFile, "/configText", "data/target.json", {
        format: "json",
        targetPointer: "/bad~2key",
      }),
    ).rejects.toThrow();
    expect(await readFile(targetFile)).toEqual(existing);
  });

  it("rejects malformed CLI format arguments as JSON errors", async () => {
    const { directory, task } = await fixture({
      name: "CLI 格式角色",
      configText: "{}",
    });
    for (const options of [
      [],
      ["--format", "toml"],
      ["--format", "json", "--format", "yaml"],
      ["--format", "json", "--unknown", "value"],
    ]) {
      const result = await failedCli(
        ["parse", task.taskFile, "/configText", "data/parsed.json", ...options],
        directory,
      );
      expect(result.error).toBeTruthy();
    }
  });

  it("rejects a target outside the formal JSON file rules", async () => {
    const { task } = await fixture({
      name: "路径角色",
      configText: '{"value":true}',
    });
    await expect(
      mapParseFile(task.taskFile, "/configText", "openings/parsed.txt", {
        format: "json",
      }),
    ).rejects.toThrow();
  });
});

describe("parse command full conversion flow", () => {
  it.each(["json", "png"] as const)(
    "completes begin, extract, map-entry, map-regex, copy and parse from a %s input",
    async (extension) => {
      const directory = await realpath(
        await mkdtemp(join(tmpdir(), "parse CLI cwd ")),
      );
      cleanup.push(directory);
      const source = {
        name: "完整流程角色",
        verbatim:
          "<section>\r\n<style>.panel{color:red}</style>\r\n原文😀</section>",
        initialYaml: "day: 3\nlocation: 港口\n",
        character_book: {
          entries: [
            {
              id: 17,
              keys: ["来源关键词"],
              insertion_order: 3,
              enabled: true,
              position: "before_char",
              content: "来源条目正文",
            },
          ],
        },
        extensions: { regex_scripts: [regexRule()] },
      };
      const sourceJson = JSON.stringify(completeSourceFixture(source));
      const inputName = `角色卡.${extension}`;
      const inputFile = join(directory, inputName);
      const inputBytes =
        extension === "png"
          ? png(pngText("ccv3", Buffer.from(sourceJson).toString("base64")))
          : Buffer.from(sourceJson);
      await writeFile(inputFile, inputBytes);

      const begun = await cli(["begin", inputName], directory);
      const task = {
        ...(await readTaskContext(String(begun.taskFile))),
        taskFile: String(begun.taskFile),
      };
      cleanup.push(task.outputDirectory);

      const extractedEntry = (await cli(
        ["extract", task.taskFile, "/character_book/entries/0"],
        directory,
      )) as { items: { contentFile: string }[] };
      expect(
        JSON.parse(
          await readFile(extractedEntry.items[0]!.contentFile, "utf8"),
        ),
      ).toEqual(source.character_book.entries[0]);

      const entryPath = "worldbooks/book-0/entries/e0.json";
      const mappedEntry = await cli(
        [
          "map-entry",
          task.taskFile,
          "/character_book/entries/0",
          entryPath,
          "--copy-content",
        ],
        directory,
      );
      expect(mappedEntry.file).toBe(join(task.packageDirectory, entryPath));
      expect(
        JSON.parse(await readFile(String(mappedEntry.file), "utf8")).content,
      ).toBe("来源条目正文");

      const regexPath = "regex/source.json";
      const mappedRegex = await cli(
        ["map-regex", task.taskFile, regexPointer, regexPath, "--indices", "0"],
        directory,
      );
      expect(mappedRegex.file).toBe(join(task.packageDirectory, regexPath));
      expect(
        JSON.parse(await readFile(String(mappedRegex.file), "utf8")),
      ).toHaveLength(1);

      const copiedPath = "openings/verbatim.txt";
      const copied = await cli(
        ["copy", task.taskFile, "/verbatim", copiedPath],
        directory,
      );
      expect(copied.file).toBe(join(task.packageDirectory, copiedPath));
      expect(await readFile(String(copied.file), "utf8")).toBe(source.verbatim);

      const parsedPath = "data/initial.json";
      const parsed = await cli(
        [
          "parse",
          task.taskFile,
          "/initialYaml",
          parsedPath,
          "--format",
          "yaml",
        ],
        directory,
      );
      expect(parsed.file).toBe(join(task.packageDirectory, parsedPath));
      expect(JSON.parse(await readFile(String(parsed.file), "utf8"))).toEqual({
        day: 3,
        location: "港口",
      });
      expect(await readFile(inputFile)).toEqual(inputBytes);
      expect(await readFile(task.sourceFile, "utf8")).toBe(sourceJson);
    },
    30_000,
  );
});

describe("parse --apply-replacements", () => {
  it.each([{}, 2])(
    "keeps source operation objects intact when later paths overwrite descendants (%j)",
    async (finalValue) => {
      const { task } = await fixture({
        name: "对象覆写重试角色",
        replacements: JSON.stringify([
          { op: "replace", path: "/a", value: { b: { c: 0 } } },
          { op: "replace", path: "/a/b/c", value: 1 },
          { op: "replace", path: "/a/b", value: finalValue },
        ]),
      });
      const target = join(task.packageDirectory, "data/initial.json");
      await mkdir(join(task.packageDirectory, "data"), { recursive: true });
      await writeFile(target, JSON.stringify({ a: null }));
      const args = [
        task.taskFile,
        "/replacements",
        "data/initial.json",
        "--format",
        "json",
        "--apply-replacements",
      ];
      await runParse(args);
      const first = await readFile(target, "utf8");
      expect(JSON.parse(first)).toEqual({ a: { b: finalValue } });
      await runParse(args);
      expect(await readFile(target, "utf8")).toBe(first);
    },
  );

  it("replaces existing object fields and array members", async () => {
    const { task } = await fixture({
      name: "初值覆写角色",
      replacements: JSON.stringify([
        { op: "replace", path: "/profile/name", value: "新姓名" },
        { op: "replace", path: "/records/0/score", value: 9 },
      ]),
    });
    const target = join(task.packageDirectory, "data/initial.json");
    await mkdir(join(task.packageDirectory, "data"), { recursive: true });
    await writeFile(
      target,
      JSON.stringify({
        profile: { name: "旧姓名" },
        records: [{ score: 1 }, { score: 2 }],
      }),
    );

    const result = await runParse([
      task.taskFile,
      "/replacements",
      "data/initial.json",
      "--format",
      "json",
      "--apply-replacements",
    ]);

    expect(result).toEqual({ file: target, replacements: 2 });
    expect(JSON.parse(await readFile(target, "utf8"))).toEqual({
      profile: { name: "新姓名" },
      records: [{ score: 9 }, { score: 2 }],
    });
  });

  it("decodes escaped pointer segments and applies repeated paths in source order", async () => {
    const { task } = await fixture({
      name: "转义路径角色",
      replacements: JSON.stringify([
        { op: "replace", path: "/a~1b/~0key", value: "第一次" },
        { op: "replace", path: "/a~1b/~0key", value: "最后一次" },
      ]),
    });
    const target = join(task.packageDirectory, "data/initial.json");
    await mkdir(join(task.packageDirectory, "data"), { recursive: true });
    await writeFile(target, JSON.stringify({ "a/b": { "~key": "原值" } }));

    await runParse([
      task.taskFile,
      "/replacements",
      "data/initial.json",
      "--format",
      "json",
      "--apply-replacements",
    ]);

    expect(JSON.parse(await readFile(target, "utf8"))).toEqual({
      "a/b": { "~key": "最后一次" },
    });
  });

  it("rejects replacements that remove a path needed by the same retry before writing", async () => {
    const { task } = await fixture({
      name: "祖先覆写角色",
      replacements: JSON.stringify([
        { op: "replace", path: "/profile/name", value: "新姓名" },
        { op: "replace", path: "/profile", value: { score: 2 } },
      ]),
    });
    const target = join(task.packageDirectory, "data/initial.json");
    await mkdir(join(task.packageDirectory, "data"), { recursive: true });
    const original = '{ "profile": { "name": "旧姓名" } }\n';
    await writeFile(target, original);
    await expect(
      runParse([
        task.taskFile,
        "/replacements",
        "data/initial.json",
        "--format",
        "json",
        "--apply-replacements",
      ]),
    ).rejects.toThrow("使用相同参数重试");
    expect(await readFile(target, "utf8")).toBe(original);
  });

  it("keeps source order and retries ancestor replacements retaining all addressed paths", async () => {
    const { task } = await fixture({
      name: "可重试祖先覆写角色",
      replacements: JSON.stringify([
        { op: "replace", path: "/profile/name", value: "中间姓名" },
        { op: "replace", path: "/profile", value: { name: "最终姓名" } },
      ]),
    });
    const target = join(task.packageDirectory, "data/initial.json");
    await mkdir(join(task.packageDirectory, "data"), { recursive: true });
    await writeFile(target, JSON.stringify({ profile: { name: "旧姓名" } }));
    const args = [
      task.taskFile,
      "/replacements",
      "data/initial.json",
      "--format",
      "json",
      "--apply-replacements",
    ];
    await runParse(args);
    const first = await readFile(target, "utf8");
    await runParse(args);
    expect(await readFile(target, "utf8")).toBe(first);
    expect(JSON.parse(first)).toEqual({ profile: { name: "最终姓名" } });
  });

  it("parses only the selected source fragment", async () => {
    const operations = JSON.stringify([
      { op: "replace", path: "/count", value: 4 },
    ]);
    const prefix = "prefix:";
    const { task } = await fixture({
      name: "片段覆写角色",
      replacements: prefix + operations + ":suffix",
    });
    const target = join(task.packageDirectory, "data/initial.json");
    await mkdir(join(task.packageDirectory, "data"), { recursive: true });
    await writeFile(target, JSON.stringify({ count: 1 }));

    await runParse([
      task.taskFile,
      "/replacements",
      "data/initial.json",
      "--start",
      String(prefix.length),
      "--end",
      String(prefix.length + operations.length),
      "--format",
      "json",
      "--apply-replacements",
    ]);

    expect(JSON.parse(await readFile(target, "utf8"))).toEqual({ count: 4 });
  });

  it("keeps target bytes unchanged when the source fragment range is invalid", async () => {
    const { task } = await fixture({
      name: "越界片段角色",
      replacements: "[]",
    });
    const target = join(task.packageDirectory, "data/initial.json");
    await mkdir(join(task.packageDirectory, "data"), { recursive: true });
    const before = Buffer.from('{ "count": 1 }\r\n');
    await writeFile(target, before);

    await expect(
      runParse([
        task.taskFile,
        "/replacements",
        "data/initial.json",
        "--start",
        "0",
        "--end",
        "3",
        "--format",
        "json",
        "--apply-replacements",
      ]),
    ).rejects.toThrow();
    expect(await readFile(target)).toEqual(before);
  });

  it("leaves an existing target byte-for-byte unchanged for an empty array", async () => {
    const { task } = await fixture({ name: "空覆写角色", replacements: "[]" });
    const target = join(task.packageDirectory, "data/initial.json");
    await mkdir(join(task.packageDirectory, "data"), { recursive: true });
    const before = Buffer.from('{  "count" : 1  }\r\n');
    await writeFile(target, before);

    const result = await runParse([
      task.taskFile,
      "/replacements",
      "data/initial.json",
      "--format",
      "json",
      "--apply-replacements",
    ]);

    expect(result).toEqual({ file: target, replacements: 0 });
    expect(await readFile(target)).toEqual(before);
  });

  it.each([
    [
      "state/schema.json",
      '{  "properties" : { "count" : { "type" : "integer" } }  }\r\n',
    ],
    [
      "agents/state-update/profile.json",
      '{  "enabled" : false, "writablePaths" : []  }\r\n',
    ],
    ["state/initial/default.json", '{  "count" : 1  }\r\n'],
  ])(
    "returns independent tasks preserving empty replacement bytes at %s",
    async (path, text) => {
      const { task, sourceFile, sourceBytes } = await fixture({
        name: "空状态覆写角色",
        replacements: "[]",
      });
      const target = join(task.packageDirectory, path);
      await mkdir(dirname(target), { recursive: true });
      const before = Buffer.from(text);
      await writeFile(target, before);
      const taskBefore = await readFile(task.taskFile);
      const args = [
        task.taskFile,
        "/replacements",
        path,
        "--format",
        "json",
        "--apply-replacements",
      ];

      const results = await Promise.all([
        runParse(args),
        cli(["parse", ...args]),
      ]);
      const taskFiles: string[] = [];
      for (const result of results) {
        expect(result).toHaveProperty("taskFile", expect.any(String));
        const taskFile = (result as { taskFile: string }).taskFile;
        cleanup.push(dirname(taskFile));
        taskFiles.push(taskFile);
        expect(taskFile).not.toBe(task.taskFile);
        const derived = await readTaskContext(taskFile);
        expect(derived.packageDirectory).not.toBe(task.packageDirectory);
        expect(result).toMatchObject({
          file: join(derived.packageDirectory, path),
          packageDirectory: derived.packageDirectory,
          replacements: 0,
        });
        expect(await readFile(join(derived.packageDirectory, path))).toEqual(
          before,
        );
        expect(await readFile(derived.sourceFile)).toEqual(sourceBytes);
      }
      expect(new Set(taskFiles).size).toBe(results.length);
      expect(await readFile(target)).toEqual(before);
      expect(await readFile(task.taskFile)).toEqual(taskBefore);
      expect(await readFile(sourceFile)).toEqual(sourceBytes);
    },
  );

  it("produces the same target bytes when the same replacements are repeated", async () => {
    const { task } = await fixture({
      name: "重复覆写角色",
      replacements: JSON.stringify([
        { op: "replace", path: "/count", value: 7 },
      ]),
    });
    const target = join(task.packageDirectory, "data/initial.json");
    await mkdir(join(task.packageDirectory, "data"), { recursive: true });
    await writeFile(target, '{"count":1}\r\n');
    const args = [
      task.taskFile,
      "/replacements",
      "data/initial.json",
      "--format",
      "json",
      "--apply-replacements",
    ];

    await runParse(args);
    const first = await readFile(target);
    await runParse(args);

    expect(await readFile(target)).toEqual(first);
    expect(JSON.parse(first.toString())).toEqual({ count: 7 });
  });

  it("applies concurrent calls to different target files independently", async () => {
    const { task } = await fixture({
      name: "并行初值角色",
      replacements: JSON.stringify([
        { op: "replace", path: "/count", value: 8 },
      ]),
    });
    const directory = join(task.packageDirectory, "data");
    await mkdir(directory, { recursive: true });
    await Promise.all([
      writeFile(join(directory, "first.json"), JSON.stringify({ count: 1 })),
      writeFile(join(directory, "second.json"), JSON.stringify({ count: 2 })),
    ]);

    const results = await Promise.all(
      ["first.json", "second.json"].map((name) =>
        runParse([
          task.taskFile,
          "/replacements",
          `data/${name}`,
          "--format",
          "json",
          "--apply-replacements",
        ]),
      ),
    );

    expect(results.map((result) => result.file)).toEqual([
      join(directory, "first.json"),
      join(directory, "second.json"),
    ]);
    expect(
      await Promise.all(
        ["first.json", "second.json"].map(async (name) =>
          JSON.parse(await readFile(join(directory, name), "utf8")),
        ),
      ),
    ).toEqual([{ count: 8 }, { count: 8 }]);
  });

  it.each([
    {
      label: "malformed JSON source",
      source: "[",
      expected: "不是有效的 JSON 文本",
    },
    {
      label: "non-array source",
      source: "{}",
      expected: "必须解析为 JSON 数组",
    },
    { label: "non-object member", source: "[null]", expected: "必须是包含" },
    {
      label: "non-replace operation",
      source: JSON.stringify([{ op: "add", path: "/count", value: 2 }]),
      expected: "op 必须为 replace",
    },
    {
      label: "non-string path",
      source: JSON.stringify([{ op: "replace", path: 1, value: 2 }]),
      expected: "path 必须是字符串",
    },
    {
      label: "missing value",
      source: JSON.stringify([{ op: "replace", path: "/count" }]),
      expected: "缺少 value 字段",
    },
    {
      label: "invalid escaped pointer",
      source: JSON.stringify([{ op: "replace", path: "/count~2", value: 2 }]),
      expected: "有效 JSON Pointer",
    },
    {
      label: "missing object path",
      source: JSON.stringify([{ op: "replace", path: "/missing", value: 2 }]),
      expected: "不存在 replace 数组第 1 项指定的路径",
    },
    {
      label: "missing array member",
      source: JSON.stringify([{ op: "replace", path: "/items/2", value: 2 }]),
      expected: "不存在 replace 数组第 1 项指定的路径",
    },
  ])(
    "rejects $label and preserves the original target",
    async ({ source, expected }) => {
      const { task } = await fixture({
        name: "无效覆写角色",
        replacements: source,
      });
      const target = join(task.packageDirectory, "data/initial.json");
      await mkdir(join(task.packageDirectory, "data"), { recursive: true });
      const before = Buffer.from('{ "count": 1, "items": [0] }\r\n');
      await writeFile(target, before);

      await expect(
        runParse([
          task.taskFile,
          "/replacements",
          "data/initial.json",
          "--format",
          "json",
          "--apply-replacements",
        ]),
      ).rejects.toThrow(expected);
      expect(await readFile(target)).toEqual(before);
    },
  );

  it("rejects non-string replacement sources without changing the target", async () => {
    const { task } = await fixture({
      name: "非文本覆写角色",
      replacements: [],
    });
    const target = join(task.packageDirectory, "data/initial.json");
    await mkdir(join(task.packageDirectory, "data"), { recursive: true });
    const before = Buffer.from('{"count":1}');
    await writeFile(target, before);

    await expect(
      runParse([
        task.taskFile,
        "/replacements",
        "data/initial.json",
        "--format",
        "json",
        "--apply-replacements",
      ]),
    ).rejects.toThrow("源 JSON Pointer 应指向");
    expect(await readFile(target)).toEqual(before);
  });

  it("requires an existing target and reports the base parse command", async () => {
    const { task } = await fixture({
      name: "缺少初值角色",
      replacements: "[]",
    });
    const target = join(task.packageDirectory, "data/initial.json");

    await expect(
      runParse([
        task.taskFile,
        "/replacements",
        "data/initial.json",
        "--format",
        "json",
        "--apply-replacements",
      ]),
    ).rejects.toThrow("先生成基础初值");
    await expect(readFile(target)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a non-JSON target and preserves its original bytes", async () => {
    const { task } = await fixture({
      name: "损坏初值角色",
      replacements: "[]",
    });
    const target = join(task.packageDirectory, "data/initial.json");
    await mkdir(join(task.packageDirectory, "data"), { recursive: true });
    const before = Buffer.from("not JSON\r\n");
    await writeFile(target, before);

    await expect(
      runParse([
        task.taskFile,
        "/replacements",
        "data/initial.json",
        "--format",
        "json",
        "--apply-replacements",
      ]),
    ).rejects.toThrow("不是有效 JSON");
    expect(await readFile(target)).toEqual(before);
  });

  it.each([
    ["--format", "yaml", "--apply-replacements"],
    ["--format", "json", "--target-pointer", "/count", "--apply-replacements"],
    [
      "--format",
      "json",
      "--field",
      "/replacement",
      "/count",
      "--apply-replacements",
    ],
  ])(
    "rejects an unsupported format or incompatible write option",
    async (...options) => {
      const { task } = await fixture({
        name: "参数冲突角色",
        replacements: "[]",
      });
      const target = join(task.packageDirectory, "data/initial.json");
      await mkdir(join(task.packageDirectory, "data"), { recursive: true });
      const before = Buffer.from('{"count":1}\n');
      await writeFile(target, before);

      await expect(
        runParse([
          task.taskFile,
          "/replacements",
          "data/initial.json",
          ...options,
        ]),
      ).rejects.toThrow();
      expect(await readFile(target)).toEqual(before);
    },
  );
});
