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
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { begin } from "./source.ts";
import { readTaskContext } from "./task-context.ts";
import { commandStderr, readCommandData } from "./cli-test-result.ts";

const run = promisify(execFile);
const entrypoint = resolve(
  ".agents/skills/native-card-conversion/scripts/convert.mjs",
);
const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function entry(id: number, content: string) {
  return {
    id,
    keys: [`关键词${id}`],
    insertion_order: id,
    enabled: true,
    content,
  };
}

async function fixture(entries: unknown[]) {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), "map entry batch ")),
  );
  cleanup.push(directory);
  const sourceFile = join(directory, "card.json");
  await writeFile(
    sourceFile,
    JSON.stringify(
      completeSourceFixture({ name: "批量角色", character_book: { entries } }),
    ),
  );
  const begun = await begin(sourceFile);
  const task = {
    ...(await readTaskContext(begun.taskFile)),
    taskFile: begun.taskFile,
  };
  cleanup.push(task.outputDirectory);
  const targetDirectory = join(
    task.packageDirectory,
    "worldbooks",
    "book-0",
    "entries",
  );
  return { task, targetDirectory };
}

async function batch(
  taskFile: string,
  targetDirectory: string,
  indices: string,
  copyContent = false,
) {
  const result = await run(process.execPath, [
    entrypoint,
    "map-entry",
    taskFile,
    "/character_book/entries",
    targetDirectory,
    "--indices",
    indices,
    ...(copyContent ? ["--copy-content"] : []),
  ]);
  return {
    ...result,
    stdout: JSON.stringify(await readCommandData(result.stdout)),
  };
}

async function failedBatch(
  taskFile: string,
  targetDirectory: string,
  indices: string,
) {
  try {
    await batch(taskFile, targetDirectory, indices);
    throw new Error("Expected map-entry to exit unsuccessfully");
  } catch (error) {
    const failure = error as {
      code: number;
    };
    expect(failure.code).toBe(1);
    return readCommandData(commandStderr(error));
  }
}

describe("map-entry batch CLI", () => {
  it("accepts copy-content before the selection flag", async () => {
    const { task, targetDirectory } = await fixture([entry(0, "保留原文")]);
    const result = await run(process.execPath, [
      entrypoint,
      "map-entry",
      task.taskFile,
      "/character_book/entries",
      targetDirectory,
      "--copy-content",
      "--indices",
      "0",
    ]);
    const data = await readCommandData(result.stdout);
    expect(data.passed).toBe(true);
    const written = JSON.parse(
      await readFile(join(targetDirectory, "e0.json"), "utf8"),
    );
    expect(written.content).toBe("保留原文");
  });

  it.each([
    { label: "missing selection value", args: ["--indices"] },
    {
      label: "extra arguments",
      args: ["--indices", "0", "--copy-content", "extra"],
    },
    { label: "unknown final flag", args: ["--indices", "0", "--unknown"] },
  ])("reports the usage message for $label", async ({ args }) => {
    const { task, targetDirectory } = await fixture([entry(0, "首条")]);
    try {
      await run(process.execPath, [
        entrypoint,
        "map-entry",
        task.taskFile,
        "/character_book/entries",
        targetDirectory,
        ...args,
      ]);
      throw new Error("Expected map-entry to fail.");
    } catch (error) {
      expect(error).toMatchObject({ code: 1 });
      const result = await readCommandData(commandStderr(error));
      expect(result.error).toBeTypeOf("string");
      expect(result.action).toContain("map-entry");
      expect(result.error).toContain("示例");
    }
  });

  it("reports that the batch source pointer must identify the entries array", async () => {
    const { task, targetDirectory } = await fixture([entry(0, "首条")]);
    try {
      await run(process.execPath, [
        entrypoint,
        "map-entry",
        task.taskFile,
        "/character_book/entries/0",
        targetDirectory,
        "--indices",
        "0",
      ]);
      throw new Error("Expected map-entry to exit unsuccessfully");
    } catch (error) {
      const result = (await readCommandData(commandStderr(error))) as {
        error: string;
      };
      expect((error as { code: number }).code).toBe(1);
      expect(result.error).toContain("entries 数组");
      expect(result.error).not.toContain("entries 数组中的条目");
    }
  });

  it("updates selected entries and leaves unselected source-number files unchanged", async () => {
    const contents = [
      "第一条\r\n  正文😀",
      "第二条",
      "第三条\n<style>.x{}</style>",
    ];
    const { task, targetDirectory } = await fixture(
      contents.map((content, index) => entry(index, content)),
    );
    const unselectedFile = join(targetDirectory, "e1.json");
    const unselectedBefore = await readFile(unselectedFile);

    const result = JSON.parse(
      (await batch(task.taskFile, targetDirectory, "2,0", true)).stdout,
    ) as {
      passed: boolean;
      results: {
        sourcePointer: string;
        passed: boolean;
        file: string;
        issues: unknown[];
        remaining: string[];
      }[];
    };

    expect(result).toMatchObject({
      passed: true,
      results: [
        {
          sourcePointer: "/character_book/entries/0",
          passed: true,
          file: join(targetDirectory, "e0.json"),
          issues: [],
          remaining: [],
        },
        {
          sourcePointer: "/character_book/entries/2",
          passed: true,
          file: join(targetDirectory, "e2.json"),
          issues: [],
          remaining: [],
        },
      ],
    });
    expect(
      JSON.parse(await readFile(join(targetDirectory, "e0.json"), "utf8"))
        .content,
    ).toBe(contents[0]);
    expect(
      JSON.parse(await readFile(join(targetDirectory, "e2.json"), "utf8"))
        .content,
    ).toBe(contents[2]);
    expect(await readFile(unselectedFile)).toEqual(unselectedBefore);
  });

  it("preserves existing content without copying source content", async () => {
    const { task, targetDirectory } = await fixture([
      entry(0, "源正文 0"),
      entry(1, "源正文 1"),
    ]);
    await mkdir(targetDirectory, { recursive: true });
    await writeFile(
      join(targetDirectory, "e0.json"),
      JSON.stringify({ content: "Agent 正文", extra: { note: "保留" } }),
    );

    const result = JSON.parse(
      (await batch(task.taskFile, targetDirectory, "0,1")).stdout,
    ) as { passed: boolean; results: { passed: boolean }[] };

    expect(result.passed).toBe(true);
    expect(result.results.every((item) => item.passed)).toBe(true);
    expect(
      JSON.parse(await readFile(join(targetDirectory, "e0.json"), "utf8")),
    ).toMatchObject({ content: "Agent 正文", extra: { note: "保留" } });
    expect(
      JSON.parse(await readFile(join(targetDirectory, "e1.json"), "utf8"))
        .content,
    ).toBe("源正文 1");
  });

  it("continues after an existing target type error and preserves that file", async () => {
    const { task, targetDirectory } = await fixture([
      entry(0, "首条"),
      entry(1, "次条"),
      entry(2, "末条"),
    ]);
    await mkdir(targetDirectory, { recursive: true });
    await writeFile(join(targetDirectory, "e1.json"), "[]");

    const result = (await failedBatch(
      task.taskFile,
      targetDirectory,
      "0,1,2",
    )) as {
      passed: boolean;
      results: {
        sourcePointer: string;
        passed: boolean;
        file?: string;
        issues?: unknown[];
        error?: string;
      }[];
    };

    expect(result.passed).toBe(false);
    expect(result.results).toHaveLength(3);
    expect(result.results[0]).toMatchObject({
      sourcePointer: "/character_book/entries/0",
      passed: true,
      file: join(targetDirectory, "e0.json"),
    });
    expect(result.results[1]).toMatchObject({
      sourcePointer: "/character_book/entries/1",
      passed: false,
      file: join(targetDirectory, "e1.json"),
      error: expect.stringContaining("JSON 对象"),
    });
    expect(result.results[2]).toMatchObject({
      sourcePointer: "/character_book/entries/2",
      passed: true,
      file: join(targetDirectory, "e2.json"),
    });
    expect(
      JSON.parse(await readFile(join(targetDirectory, "e0.json"), "utf8")).uid,
    ).toBe(0);
    expect(
      JSON.parse(await readFile(join(targetDirectory, "e2.json"), "utf8")).uid,
    ).toBe(2);
    expect(await readFile(join(targetDirectory, "e1.json"), "utf8")).toBe("[]");
  });

  it("passes selected members when an unselected sibling is not an object", async () => {
    const { task, targetDirectory } = await fixture([
      entry(0, "首条"),
      null,
      entry(2, "末条"),
    ]);

    const result = JSON.parse(
      (await batch(task.taskFile, targetDirectory, "0,2")).stdout,
    ) as {
      passed: boolean;
      results: { sourcePointer: string; passed: boolean; issues: unknown[] }[];
    };

    expect(result).toMatchObject({
      passed: true,
      results: [
        {
          sourcePointer: "/character_book/entries/0",
          passed: true,
          issues: [],
        },
        {
          sourcePointer: "/character_book/entries/2",
          passed: true,
          issues: [],
        },
      ],
    });
  });

  it("fails only a selected malformed member while other selected entries pass", async () => {
    const { task, targetDirectory } = await fixture([
      entry(0, "首条"),
      null,
      entry(2, "末条"),
    ]);

    const result = (await failedBatch(
      task.taskFile,
      targetDirectory,
      "0,1,2",
    )) as {
      results: {
        sourcePointer: string;
        passed: boolean;
        issues: { pointer: string; message: string }[];
      }[];
    };

    expect(result.results.map(({ passed }) => passed)).toEqual([
      true,
      false,
      true,
    ]);
    expect(result.results[1]).toMatchObject({
      sourcePointer: "/character_book/entries/1",
      issues: [
        expect.objectContaining({ pointer: "/character_book/entries/1" }),
      ],
    });
    await expect(
      readFile(join(targetDirectory, "e1.json")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("does not mix issues whose source indices share a numeric prefix", async () => {
    const entries = Array.from({ length: 11 }, (_, index) =>
      index === 1
        ? { ...entry(index, "坏条目"), comment: ["错误类型"] }
        : index === 10
          ? { ...entry(index, "坏条目10"), keys: "错误类型" }
          : entry(index, `条目${index}`),
    );
    const { task, targetDirectory } = await fixture(entries);

    const allSelected = (await failedBatch(
      task.taskFile,
      targetDirectory,
      "0,1,2",
    )) as {
      passed: boolean;
      results: {
        sourcePointer: string;
        passed: boolean;
        issues?: { pointer: string }[];
      }[];
    };

    expect(allSelected.passed).toBe(false);
    expect(allSelected.results.map(({ passed }) => passed)).toEqual([
      true,
      false,
      true,
    ]);
    expect(allSelected.results[1]).toMatchObject({
      sourcePointer: "/character_book/entries/1",
      issues: [
        expect.objectContaining({
          pointer: "/character_book/entries/1/comment",
        }),
      ],
    });

    const prefixed = (await failedBatch(
      task.taskFile,
      targetDirectory,
      "1,10",
    )) as {
      passed: boolean;
      results: { sourcePointer: string; passed: boolean; issues?: unknown[] }[];
    };

    expect(prefixed.passed).toBe(false);
    expect(prefixed.results.map(({ passed }) => passed)).toEqual([
      false,
      false,
    ]);
    expect(prefixed.results[0]).toMatchObject({
      sourcePointer: "/character_book/entries/1",
      issues: [
        expect.objectContaining({
          pointer: "/character_book/entries/1/comment",
        }),
      ],
    });
    expect(prefixed.results[1]).toMatchObject({
      sourcePointer: "/character_book/entries/10",
      issues: [
        expect.objectContaining({
          pointer: "/character_book/entries/10/keys",
        }),
      ],
    });
  });

  it("marks field type issues as failed and keeps that item unwritten", async () => {
    const { task, targetDirectory } = await fixture([
      entry(0, "首条"),
      { ...entry(1, "次条"), comment: ["错误类型"] },
    ]);

    const result = (await failedBatch(task.taskFile, targetDirectory, "1")) as {
      passed: boolean;
      results: { passed: boolean; issues: { pointer: string }[] }[];
    };

    expect(result.passed).toBe(false);
    expect(result.results[0]!.passed).toBe(false);
    expect(result.results[0]!.issues).toContainEqual(
      expect.objectContaining({
        pointer: "/character_book/entries/1/comment",
      }),
    );
    await expect(
      readFile(join(targetDirectory, "e1.json")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it.each(["02", "0,0", "2", "1,0,1"])(
    "rejects malformed, duplicate, or out-of-range selection %s",
    async (indices) => {
      const { task, targetDirectory } = await fixture([
        entry(0, "首条"),
        entry(1, "次条"),
      ]);
      const result = await failedBatch(task.taskFile, targetDirectory, indices);
      expect(result.error).toBeTypeOf("string");
      expect(result.error).toContain("选择序号");
    },
  );

  it("accepts an empty selection without changing the begin snapshot", async () => {
    const { task, targetDirectory } = await fixture([entry(0, "未选正文")]);
    const before = await readFile(join(targetDirectory, "e0.json"));

    const result = JSON.parse(
      (await batch(task.taskFile, targetDirectory, "")).stdout,
    ) as { passed: boolean; results: unknown[] };

    expect(result).toMatchObject({ passed: true, results: [] });
    expect(await readFile(join(targetDirectory, "e0.json"))).toEqual(before);
  });

  it("returns a failed CLI result for a single map-entry exception", async () => {
    const { task, targetDirectory } = await fixture([entry(0, "正文")]);
    try {
      await run(process.execPath, [
        entrypoint,
        "map-entry",
        task.taskFile,
        "/character_book/entries/1",
        join(targetDirectory, "e1.json"),
      ]);
      throw new Error("Expected map-entry to exit unsuccessfully");
    } catch (error) {
      expect(error).toMatchObject({ code: 1 });
      const result = await readCommandData(commandStderr(error));
      expect(result.error).toBeTypeOf("string");
    }
  });
});
