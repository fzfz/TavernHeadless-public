import { completeSourceFixture } from "./source-fixtures.ts";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { nativeCardRegexProfileSchema } from "../../../../packages/shared/src/schemas/native-card-package/schema.ts";
import { parseRegexScripts } from "../../../../packages/adapters-sillytavern/src/parsers/regex-parser.ts";
import { applyRegexScripts } from "../../../../packages/adapters-sillytavern/src/regex/regex-engine.ts";
import { pngCard } from "./source-config.ts";
import { begin } from "./source.ts";
import { readTaskContext } from "./task-context.ts";
import { readCommandData, commandStderr } from "./cli-test-result.ts";
import { mapRegex, mapRegexFile, mapRegexIds } from "./write.ts";

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

function regexRule(fields: Record<string, unknown> = {}) {
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
    ...fields,
  };
}

function rulePointer(index: number, field?: string) {
  return `${regexPointer}/${index}${field ? `/${field}` : ""}`;
}

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
    Buffer.from(pngCard.signature),
    chunk("IHDR", Buffer.alloc(13)),
    ...chunks,
    chunk("IEND"),
  ]);
}

function card(regexScripts: unknown[] = [regexRule()]) {
  return {
    name: "映射测试角色",
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
    extensions: { regex_scripts: regexScripts },
  };
}

async function fixture(source: unknown = card(), prefix = "map regex ") {
  const directory = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  cleanup.push(directory);
  const inputFile = join(directory, "card.json");
  await writeFile(inputFile, JSON.stringify(completeSourceFixture(source)));
  const begun = await begin(inputFile);
  const task = {
    ...(await readTaskContext(begun.taskFile)),
    taskFile: begun.taskFile,
  };
  cleanup.push(task.outputDirectory);
  return { directory, inputFile, task };
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

describe("mapped profiles consumed by the regex engine", () => {
  it("executes selected rules in source order", () => {
    const source = [
      regexRule({
        id: "first",
        findRegex: "seed",
        replaceString: "middle",
        markdownOnly: false,
      }),
      regexRule({
        id: "second",
        findRegex: "middle",
        replaceString: "final",
        markdownOnly: false,
      }),
    ];
    const result = mapRegex(source, [1, 0], regexPointer);
    expect(applyRegexScripts("seed", parseRegexScripts(result.rules), 2)).toBe(
      "final",
    );
  });

  it("retains prompt channel and depth conditions", () => {
    const result = mapRegex(
      [
        regexRule({
          findRegex: "seed",
          replaceString: "final",
          markdownOnly: false,
          promptOnly: true,
          minDepth: 2,
          maxDepth: 3,
        }),
      ],
      [0],
      regexPointer,
    );
    const scripts = parseRegexScripts(result.rules);
    expect(
      applyRegexScripts("seed", scripts, 2, { channel: "prompt", depth: 2 }),
    ).toBe("final");
    for (const context of [
      { channel: "persist" as const, depth: 2 },
      { channel: "prompt" as const, depth: 1 },
      { channel: "prompt" as const, depth: 4 },
    ]) {
      expect(applyRegexScripts("seed", scripts, 2, context)).toBe("seed");
    }
  });

  it("preserves RAW and ESCAPED macro substitution", () => {
    for (const [mode, expected] of [
      [true, "[aXb] [a.b]"],
      [2, "aXb [a.b]"],
    ] as const) {
      const result = mapRegex(
        [
          regexRule({
            findRegex: "{{pattern}}",
            replaceString: "[$0]",
            markdownOnly: false,
            substituteRegex: mode,
          }),
        ],
        [0],
        regexPointer,
      );
      expect(
        applyRegexScripts("aXb a.b", parseRegexScripts(result.rules), 2, {
          substituteFindParams: (text) => text.replace("{{pattern}}", "a.b"),
        }),
      ).toBe(expected);
    }
  });
});

describe("map-regex deterministic fields", () => {
  it("copies the supported fields and reports unknown source positions", () => {
    const result = mapRegex(
      [
        regexRule({
          id: "custom-id",
          scriptName: "清理输出",
          findRegex: "/<tag>(.*?)<\\/tag>/gs",
          replaceString: "$1",
          trimStrings: ["\r", "\n"],
          placement: [1, 2],
          disabled: true,
          markdownOnly: false,
          promptOnly: true,
          runOnEdit: false,
          substituteRegex: 2,
          minDepth: 0,
          maxDepth: null,
          "vendor/key~mode": { enabled: true },
        }),
      ],
      [0],
      regexPointer,
    );

    expect(result).toEqual({
      rules: [
        {
          id: "custom-id",
          scriptName: "清理输出",
          findRegex: "/<tag>(.*?)<\\/tag>/gs",
          replaceString: "$1",
          trimStrings: ["\r", "\n"],
          placement: [1, 2],
          disabled: true,
          markdownOnly: false,
          promptOnly: true,
          runOnEdit: false,
          substituteRegex: 2,
          minDepth: 0,
          maxDepth: null,
        },
      ],
      issues: [],
      remaining: [`${rulePointer(0)}/vendor~1key~0mode`],
    });
    expect(nativeCardRegexProfileSchema.parse(result.rules)).toEqual(
      result.rules,
    );
  });

  it.each([
    [false, 0],
    [true, 1],
  ])("maps boolean substituteRegex=%s to %s", (source, expected) => {
    expect(
      mapRegex([regexRule({ substituteRegex: source })], [0], regexPointer)
        .rules[0]?.substituteRegex,
    ).toBe(expected);
  });

  it("uses only declared defaults and leaves optional depths absent", () => {
    const source = regexRule({
      id: undefined,
      trimStrings: undefined,
      substituteRegex: undefined,
      minDepth: undefined,
      maxDepth: undefined,
    });
    const result = mapRegex([source], [0], regexPointer);

    expect(result.rules).toEqual([
      {
        id: "regex-0",
        scriptName: "规则名称",
        findRegex: "/源词/g",
        replaceString: "目标词",
        trimStrings: [],
        placement: [2],
        disabled: false,
        markdownOnly: true,
        promptOnly: false,
        runOnEdit: true,
        substituteRegex: 0,
      },
    ]);
    expect(result.issues).toEqual([]);
  });

  it.each([
    ["scriptName", undefined],
    ["findRegex", undefined],
    ["replaceString", undefined],
    ["placement", undefined],
    ["disabled", undefined],
    ["markdownOnly", undefined],
    ["promptOnly", undefined],
    ["runOnEdit", undefined],
  ])("reports a missing required field %s without inventing a value", (key) => {
    const result = mapRegex(
      [regexRule({ [key as string]: undefined })],
      [0],
      regexPointer,
    );
    expect(result.rules[0]).not.toHaveProperty(key as string);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ pointer: rulePointer(0, key as string) }),
    );
  });

  it.each([
    ["id", "", "id"],
    ["scriptName", 9, "scriptName"],
    ["findRegex", null, "findRegex"],
    ["replaceString", [], "replaceString"],
    ["trimStrings", ["ok", 1], "trimStrings"],
    ["placement", [1, 1.5], "placement"],
    ["disabled", 1, "disabled"],
    ["markdownOnly", null, "markdownOnly"],
    ["promptOnly", "true", "promptOnly"],
    ["runOnEdit", {}, "runOnEdit"],
    ["substituteRegex", 3, "substituteRegex"],
    ["substituteRegex", -1, "substituteRegex"],
    ["substituteRegex", 1.5, "substituteRegex"],
    ["substituteRegex", "1", "substituteRegex"],
  ] as const)(
    "reports an invalid %s and omits only that output field",
    (key, value, expectedField) => {
      const result = mapRegex([regexRule({ [key]: value })], [0], regexPointer);
      expect(result.rules[0]).not.toHaveProperty(expectedField);
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          pointer: rulePointer(0, expectedField),
        }),
      );
    },
  );

  it.each([
    ["minDepth", 1.5],
    ["minDepth", "2"],
    ["maxDepth", false],
    ["maxDepth", -0.5],
  ] as const)("reports invalid optional %s=%j and omits it", (key, value) => {
    const result = mapRegex([regexRule({ [key]: value })], [0], regexPointer);
    expect(result.rules[0]).not.toHaveProperty(key);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ pointer: rulePointer(0, key) }),
    );
  });

  it.each([0, 1, 2])("accepts formal substituteRegex value %s", (value) => {
    expect(
      mapRegex([regexRule({ substituteRegex: value })], [0], regexPointer)
        .rules[0]?.substituteRegex,
    ).toBe(value);
  });

  it("keeps null optional depth values", () => {
    const result = mapRegex(
      [regexRule({ minDepth: null, maxDepth: null })],
      [0],
      regexPointer,
    );
    expect(result.rules[0]).toMatchObject({ minDepth: null, maxDepth: null });
    expect(result.issues).toEqual([]);
  });

  it("sorts selected rules by source position and ignores unselected members", () => {
    const scripts = [
      regexRule({ id: "first" }),
      null,
      regexRule({ id: "third" }),
    ];
    const result = mapRegex(scripts, [2, 0], regexPointer);
    expect(result.rules.map((rule) => rule.id)).toEqual(["first", "third"]);
    expect(result.issues).toEqual([]);
    expect(result.remaining).toEqual([]);
  });

  it("returns an empty profile for an empty selection", () => {
    expect(mapRegex([null], [], regexPointer)).toEqual({
      rules: [],
      issues: [],
      remaining: [],
    });
  });

  it.each([[[-1]], [[1.5]], [[Number.MAX_SAFE_INTEGER + 1]], [[2]], [[0, 0]]])(
    "rejects invalid or repeated source indices %j",
    (indices) => {
      expect(() =>
        mapRegex([regexRule(), regexRule()], indices, regexPointer),
      ).toThrow();
    },
  );

  it.each([null, {}, "not an array"])(
    "rejects non-array regex scripts %j",
    (scripts) => {
      expect(() =>
        mapRegex(scripts as unknown as unknown[], [], regexPointer),
      ).toThrow();
    },
  );

  it.each([null, [], "text", 4])(
    "rejects selected non-object rule %j",
    (script) => {
      expect(() => mapRegex([script], [0], regexPointer)).toThrow();
    },
  );

  it("reserves IDs across the complete source array when generating missing IDs", () => {
    const scripts = [
      regexRule({ id: undefined }),
      regexRule({ id: undefined }),
      regexRule({ id: "regex-0" }),
      regexRule({ id: "regex-1" }),
      regexRule({ id: "regex-2" }),
    ];
    const result = mapRegex(scripts, [1, 0], regexPointer);
    expect(result.rules.map((rule) => rule.id)).toEqual(["regex-3", "regex-4"]);
  });

  it.each([[0, 1], [1]])(
    "reserves schema-normalized IDs while retaining source IDs for selection %j",
    (...selection) => {
      const result = mapRegex(
        [regexRule({ id: " regex-1 " }), regexRule({ id: undefined })],
        selection,
        regexPointer,
      );
      expect(result.issues).toEqual([]);
      expect(result.rules.at(-1)?.id).toBe("regex-2");
      if (selection.includes(0)) expect(result.rules[0]?.id).toBe(" regex-1 ");
    },
  );

  it("reports selected duplicate IDs and preserves both source IDs", () => {
    const result = mapRegex(
      [regexRule({ id: "duplicate" }), regexRule({ id: "duplicate" })],
      [0, 1],
      regexPointer,
    );
    expect(result.rules.map((rule) => rule.id)).toEqual([
      "duplicate",
      "duplicate",
    ]);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ pointer: rulePointer(1, "id") }),
    );
  });

  it("does not mutate the source rules", () => {
    const scripts = [regexRule({ nested: { vendor: [1, 2] } })];
    const original = structuredClone(scripts);
    mapRegex(scripts, [0], regexPointer);
    expect(scripts).toEqual(original);
  });
  it("assigns missing IDs around explicit source IDs", () => {
    const scripts = [
      regexRule({ id: undefined }),
      regexRule({ id: "regex-0" }),
    ];
    expect(mapRegexIds(scripts)).toEqual(["regex-1", "regex-0"]);
    expect(mapRegex(scripts, [0], regexPointer).rules[0]?.id).toBe("regex-1");
  });
});

describe("map-regex file and CLI", () => {
  it("keeps begin rules, replaces prior selections, and remains idempotent", async () => {
    const { task } = await fixture(
      card([
        regexRule({ id: "first" }),
        regexRule({ id: "pending-a", findRegex: "<title>.*</title>" }),
        regexRule({ id: "pending-b", findRegex: "<script>.*</script>" }),
        regexRule({ id: "last" }),
      ]),
    );
    const sourceBefore = await readFile(task.sourceFile);
    const taskBefore = await readFile(task.taskFile);
    const profilePath = join(task.packageDirectory, "regex", "source.json");
    expect(
      nativeCardRegexProfileSchema
        .parse(JSON.parse(await readFile(profilePath, "utf8")))
        .map((rule) => rule.id),
    ).toEqual(["first", "last"]);

    const firstSelection = await mapRegexFile(
      task.taskFile,
      regexPointer,
      "regex/source.json",
      [1],
    );

    expect(firstSelection.file).toBe(profilePath);
    expect(firstSelection.issues).toEqual([]);
    expect(firstSelection.remaining).toEqual([]);
    expect(
      nativeCardRegexProfileSchema
        .parse(JSON.parse(await readFile(profilePath, "utf8")))
        .map((rule) => rule.id),
    ).toEqual(["first", "pending-a", "last"]);

    const secondSelection = await mapRegexFile(
      task.taskFile,
      regexPointer,
      "regex/source.json",
      [2],
    );
    expect(secondSelection.passed).toBe(true);
    expect(
      nativeCardRegexProfileSchema
        .parse(JSON.parse(await readFile(profilePath, "utf8")))
        .map((rule) => rule.id),
    ).toEqual(["first", "pending-b", "last"]);
    const secondWrite = await readFile(profilePath);
    await mapRegexFile(task.taskFile, regexPointer, "regex/source.json", [2]);
    expect(await readFile(profilePath)).toEqual(secondWrite);
    expect(await readFile(task.sourceFile)).toEqual(sourceBefore);
    expect(await readFile(task.taskFile)).toEqual(taskBefore);
  });

  it("rejects target paths outside the package", async () => {
    const { task } = await fixture();
    await expect(
      mapRegexFile(task.taskFile, regexPointer, "../outside.json", [0]),
    ).rejects.toThrow();
  });

  it("rejects a symbolic-link target directory", async () => {
    const { directory, task } = await fixture();
    const outside = join(directory, "outside directory");
    await mkdir(outside);
    await rm(join(task.packageDirectory, "regex"), {
      recursive: true,
      force: true,
    });
    await symlink(outside, join(task.packageDirectory, "regex"));

    await expect(
      mapRegexFile(task.taskFile, regexPointer, "regex/source.json", [0]),
    ).rejects.toThrow();
    await expect(readFile(join(outside, "active.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects a symbolic-link target file without changing its destination", async () => {
    const { directory, task } = await fixture();
    const regexDirectory = join(task.packageDirectory, "regex");
    const outsideFile = join(directory, "outside.json");
    await mkdir(regexDirectory, { recursive: true });
    await writeFile(outsideFile, "keep this file");
    await rm(join(regexDirectory, "source.json"));
    await symlink(outsideFile, join(regexDirectory, "source.json"));

    await expect(
      mapRegexFile(task.taskFile, regexPointer, "regex/source.json", [0]),
    ).rejects.toThrow();
    expect(await readFile(outsideFile, "utf8")).toBe("keep this file");
  });

  it("reports malformed CLI selections as JSON errors", async () => {
    const { task } = await fixture();
    const result = await failedCli([
      "map-regex",
      task.taskFile,
      regexPointer,
      "regex/source.json",
      "--indices",
      "0,no",
    ]);
    expect(result.error).toMatch(/index|序号|选择|indices/i);
  });

  it.each(["json", "png"])(
    "completes begin, extract, map-entry, and map-regex from a %s input and a cwd with spaces",
    async (extension) => {
      const directory = await realpath(
        await mkdtemp(join(tmpdir(), "regex CLI cwd ")),
      );
      cleanup.push(directory);
      const source = card([
        regexRule({ id: "first" }),
        regexRule({ id: "regex-0" }),
        regexRule({ id: "third" }),
      ]);
      const json = JSON.stringify(completeSourceFixture(source));
      const inputName = `角色卡.${extension}`;
      const inputFile = join(directory, inputName);
      const inputBytes =
        extension === "png"
          ? png(pngText("ccv3", Buffer.from(json).toString("base64")))
          : Buffer.from(json);
      await writeFile(inputFile, inputBytes);

      const begun = await cli(["begin", inputName], directory);
      const task = {
        ...(await readTaskContext(String(begun.taskFile))),
        taskFile: String(begun.taskFile),
      };
      cleanup.push(task.outputDirectory);
      const taskBefore = await readFile(task.taskFile);
      const sourceBefore = await readFile(task.sourceFile);

      const extractedEntry = (await cli(
        ["extract", task.taskFile, "/character_book/entries/0"],
        directory,
      )) as { items: { contentFile: string }[] };
      expect(
        JSON.parse(
          await readFile(extractedEntry.items[0]!.contentFile, "utf8"),
        ),
      ).toEqual(source.character_book.entries[0]);

      const entryTarget = "worldbooks/book-0/entries/e0.json";
      const mappedEntry = (await cli(
        [
          "map-entry",
          task.taskFile,
          "/character_book/entries/0",
          entryTarget,
          "--copy-content",
        ],
        directory,
      )) as { file: string; issues: unknown[]; remaining: unknown[] };
      expect(mappedEntry.file).toBe(join(task.packageDirectory, entryTarget));
      expect(mappedEntry.issues).toEqual([]);
      expect(mappedEntry.remaining).toEqual([]);
      expect(JSON.parse(await readFile(mappedEntry.file, "utf8")).content).toBe(
        "来源条目正文",
      );

      const extractedRegex = (await cli(
        ["extract", task.taskFile, regexPointer],
        directory,
      )) as { items: { contentFile: string }[] };
      expect(
        JSON.parse(
          await readFile(extractedRegex.items[0]!.contentFile, "utf8"),
        ),
      ).toEqual(source.extensions.regex_scripts);

      const regexTarget = "regex/source.json";
      const mappedRegex = (await cli(
        [
          "map-regex",
          task.taskFile,
          regexPointer,
          regexTarget,
          "--indices",
          "2,0",
        ],
        directory,
      )) as { file: string; issues: unknown[]; remaining: unknown[] };
      expect(mappedRegex.file).toBe(join(task.packageDirectory, regexTarget));
      expect(mappedRegex.issues).toEqual([]);
      expect(mappedRegex.remaining).toEqual([]);
      expect(
        nativeCardRegexProfileSchema
          .parse(JSON.parse(await readFile(mappedRegex.file, "utf8")))
          .map((rule) => rule.id),
      ).toEqual(["first", "regex-0", "third"]);
      expect(await readFile(inputFile)).toEqual(inputBytes);
      expect(await readFile(task.sourceFile)).toEqual(sourceBefore);
      expect(await readFile(task.taskFile)).toEqual(taskBefore);
    },
  );

  it("accepts an empty selection while preserving begin-mapped rules", async () => {
    const { directory, task } = await fixture();
    const result = (await cli(
      [
        "map-regex",
        task.taskFile,
        regexPointer,
        "regex/source.json",
        "--indices",
        "",
      ],
      directory,
    )) as { file: string; issues: unknown[]; remaining: unknown[] };
    expect(result.issues).toEqual([]);
    expect(result.remaining).toEqual([]);
    expect(
      nativeCardRegexProfileSchema
        .parse(JSON.parse(await readFile(result.file, "utf8")))
        .map((rule) => rule.id),
    ).toEqual(["rule-id"]);
  });

  it("rejects a CLI target outside the package with a JSON error", async () => {
    const { directory, task } = await fixture();
    const result = await failedCli(
      [
        "map-regex",
        task.taskFile,
        regexPointer,
        "../outside.json",
        "--indices",
        "0",
      ],
      directory,
    );
    expect(result.error).toMatch(/目标|路径|package|target/i);
  });
});
