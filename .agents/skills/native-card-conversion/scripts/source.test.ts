import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { begin, extract } from "./source.ts";
import {
  precheckSourceFixture as precheckCard,
  completeSourceFixture,
  v3Card,
} from "./source-fixtures.ts";
import runtime from "./runtime.json" with { type: "json" };
import { indexPackage } from "./index.ts";
import { taskPaths } from "./source-config.ts";
import { taskRepositoryRoot } from "./task-context.ts";
import { pack, validate } from "./tool.ts";

const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function card(data: Record<string, unknown> = {}) {
  return {
    spec: "chara_card_v3",
    spec_version: "3.0",
    data: { name: "测试角色", ...data },
  };
}

async function sourceFile(value: unknown) {
  const directory = await mkdtemp(join(tmpdir(), "source begin "));
  cleanup.push(directory);
  const file = join(directory, "角色 card.json");
  await writeFile(file, JSON.stringify(completeSourceFixture(value)));
  return file;
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

describe("source precheck and begin", () => {
  it("copies supported character fields when they contain plain prose", () => {
    const description = "她在港口经营一家修船铺，习惯先听完再回答。";
    const source = card({
      description,
      post_history_instructions: "回复保持角色口吻并接续当前场景。",
    });
    const result = precheckCard(source);

    expect(result.character).toMatchObject({
      name: "测试角色",
      description,
      postHistoryInstructions: "回复保持角色口吻并接续当前场景。",
    });
    expect(result.written).toContainEqual({
      sourcePointer: "/data/description",
      targetPointer: "/description",
    });
    expect(result.pending).toEqual([]);
  });

  it("writes character, worldbook, entry and regex files and indexes only unresolved values", async () => {
    const file = await sourceFile(
      card({
        description: "她在港口经营一家修船铺。",
        first_mes: "开场正文。",
        character_book: {
          name: "内嵌世界书",
          scan_depth: 7,
          recursive_scanning: true,
          case_sensitive: true,
          match_whole_words: false,
          max_recursion_steps: 5,
          custom_setting: { mode: "保留" },
          entries: [
            {
              id: "stable-entry",
              keys: ["港口"],
              content: "船长曾在旧灯塔下救过一名水手。",
              enabled: true,
              insertion_order: 100,
            },
            {
              id: 11,
              keys: ["船长"],
              content: "第二条。",
              insertion_order: 101,
            },
          ],
        },
        extensions: {
          regex_scripts: [
            {
              scriptName: "港口替换",
              findRegex: "\\b港口\\b",
              replaceString: "$1",
              trimStrings: [],
              placement: [2],
              disabled: true,
              markdownOnly: false,
              promptOnly: false,
              runOnEdit: false,
              plugin_setting: { keep: true },
            },
          ],
        },
      }),
    );
    const result = await begin(file);
    cleanup.push(dirname(result.taskFile));

    expect(Object.keys(result).sort()).toEqual(
      ["taskFile", "packageDirectory", "workFile", "pendingCount"].sort(),
    );
    expect(result.pendingCount).toBe(3);

    const character = await readJson<Record<string, unknown>>(
      join(result.packageDirectory, "character.json"),
    );
    expect(character).toMatchObject({
      name: "测试角色",
      description: "她在港口经营一家修船铺。",
      worldbooks: [
        {
          id: taskPaths.worldbookId,
          file: taskPaths.worldbookFile,
          enabled: true,
        },
      ],
      regexProfiles: [taskPaths.regexFile],
    });

    const book = await readJson<Record<string, unknown>>(
      join(result.packageDirectory, taskPaths.worldbookFile),
    );
    expect(book).toMatchObject({
      name: "内嵌世界书",
      scanDepth: 7,
      caseSensitive: true,
      matchWholeWords: false,
      recursive: true,
      maxRecursionSteps: 5,
      entryFiles: [
        `${taskPaths.worldbookEntriesDirectory}/e0.json`,
        `${taskPaths.worldbookEntriesDirectory}/e1.json`,
      ],
    });
    const firstEntry = await readJson<Record<string, unknown>>(
      join(
        result.packageDirectory,
        taskPaths.worldbookEntriesDirectory,
        "e0.json",
      ),
    );
    expect(firstEntry).toMatchObject({
      key: ["港口"],
      content: "船长曾在旧灯塔下救过一名水手。",
      disable: false,
    });
    expect(firstEntry.uid).toEqual(expect.any(Number));

    const rules = await readJson<Array<Record<string, unknown>>>(
      join(result.packageDirectory, taskPaths.regexFile),
    );
    expect(rules).toEqual([
      expect.objectContaining({
        id: "regex-0",
        findRegex: "\\b港口\\b",
        replaceString: "$1",
        disabled: true,
      }),
    ]);

    const work = await readJson<{
      items: Array<Record<string, unknown>>;
    }>(result.workFile);
    expect(work.items.map((item) => item.pointer)).toEqual([
      "/data/first_mes",
      "/data/character_book/custom_setting",
      "/data/extensions/regex_scripts/0/plugin_setting",
    ]);
    expect(JSON.stringify(work)).not.toContain("开场正文");
    expect(JSON.stringify(work)).not.toContain("灯塔");
    expect(await readFile(work.items[0]!.contentFile as string, "utf8")).toBe(
      "开场正文。",
    );
    expect(
      JSON.parse(await readFile(work.items[1]!.contentFile as string, "utf8")),
    ).toEqual({ mode: "保留" });
  });

  it("skips known unused and empty fields", () => {
    const result = precheckCard(
      card({
        avatar: "none",
        fav: true,
        talkativeness: 0.8,
        extensions: {
          fav: false,
          talkativeness: 0,
          world: "",
          depth_prompt: { prompt: "", depth: 4, role: "system" },
          tavern_helper: { variables: {} },
        },
      }),
    );

    expect(result.pending).toEqual([]);
    expect(result.issues).toEqual([]);
  });

  it("leaves conflicting worldbook aliases for review while mapping other settings", () => {
    const result = precheckCard(
      card({
        character_book: {
          scan_depth: 3,
          extensions: { scanDepth: 8 },
          entries: [],
        },
      }),
    );

    expect(result.worldbook?.value.scanDepth).toBe(2);
    expect(result.pending.map((item) => item.pointer)).toEqual([
      "/data/character_book/scan_depth",
      "/data/character_book/extensions/scanDepth",
    ]);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        pointer: "/data/character_book/extensions/scanDepth",
      }),
    );
  });

  it("creates a review task when the source omits the target name", async () => {
    const source = v3Card();
    delete (source.data as Record<string, unknown>).name;
    const file = await sourceFile(v3Card());
    await writeFile(file, JSON.stringify(source));
    const result = await begin(file);
    cleanup.push(dirname(result.taskFile));
    expect(
      (await readJson<{ items: unknown[] }>(result.workFile)).items,
    ).toEqual([
      expect.objectContaining({ pointer: "/data/name", valuePresent: false }),
    ]);
    await expect(
      readFile(join(result.packageDirectory, "character.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("writes an empty openings collection when the source has no opening fields", async () => {
    const file = await sourceFile(
      card({
        character_book: { entries: [] },
        extensions: {
          regex_scripts: [
            {
              scriptName: "替换",
              findRegex: "foo",
              replaceString: "bar",
              placement: [2],
              disabled: false,
              markdownOnly: false,
              promptOnly: false,
              runOnEdit: false,
            },
          ],
        },
      }),
    );
    const result = await begin(file);
    cleanup.push(dirname(result.taskFile));

    expect(result.pendingCount).toBe(0);
    expect(
      await readJson(join(result.packageDirectory, taskPaths.openingsFile)),
    ).toEqual({ defaultOpeningIds: {}, items: [] });

    const indexed = await indexPackage(result.taskFile);
    expect(indexed.passed).toBe(true);
    expect(indexed.issues).toEqual([]);
    const validation = await validate(result.taskFile);
    expect(validation.passed).toBe(true);
    expect(validation.issues).toEqual([]);
    const packed = await pack(result.taskFile);
    expect(packed).toMatchObject({ passed: true });
  });

  it("uses a short work-file entry when the pending index exceeds the result limit", async () => {
    const data: Record<string, unknown> = { name: "待判断索引" };
    for (let index = 0; index < 240; index++)
      data[`custom_field_${index}`] = `待确认值 ${index}`;
    const result = await begin(await sourceFile(card(data)));
    cleanup.push(dirname(result.taskFile));

    const workEntry = await readJson<{
      itemCount: number;
      itemsFile: string;
      partsDirectory: string;
      partCount: number;
    }>(result.workFile);
    expect(
      Buffer.byteLength(await readFile(result.workFile, "utf8")),
    ).toBeLessThanOrEqual(runtime.resultPartBytes);
    expect(workEntry.itemCount).toBe(result.pendingCount);
    expect(workEntry.partCount).toBeGreaterThan(0);
    const fullText = await readFile(workEntry.itemsFile, "utf8");
    const partNames = (await readdir(workEntry.partsDirectory)).sort();
    const parts = await Promise.all(
      partNames.map((name) =>
        readFile(join(workEntry.partsDirectory, name), "utf8"),
      ),
    );
    expect(parts.join("")).toBe(fullText);
    expect(JSON.parse(fullText).items).toHaveLength(result.pendingCount);
    expect(JSON.stringify(workEntry)).not.toContain("待确认值");
  });

  it("rejects a symlinked output root before creating a task", async () => {
    const inputDirectory = await mkdtemp(join(tmpdir(), "begin output link "));
    const outsideDirectory = await mkdtemp(
      join(tmpdir(), "begin output target "),
    );
    cleanup.push(inputDirectory, outsideDirectory);
    const source = join(inputDirectory, "card.json");
    await writeFile(source, JSON.stringify(completeSourceFixture(card())));
    const outputRoot = join(
      taskRepositoryRoot,
      ".tmp",
      `begin-output-link-${process.pid}-${Date.now()}`,
    );
    await mkdir(dirname(outputRoot), { recursive: true });
    await symlink(outsideDirectory, outputRoot, "dir");
    const previous = runtime.outputDirectory;
    try {
      runtime.outputDirectory = relative(taskRepositoryRoot, outputRoot);
      await expect(begin(source)).rejects.toThrow("是符号链接");
      expect(await readdir(outsideDirectory)).toEqual([]);
    } finally {
      runtime.outputDirectory = previous;
      await rm(outputRoot, { force: true });
    }
  });

  it("rejects unsupported source extensions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "begin unsupported "));
    cleanup.push(directory);
    const file = join(directory, "card.txt");
    await writeFile(file, JSON.stringify(completeSourceFixture(card())));
    await expect(begin(file)).rejects.toThrow("PNG 或 JSON");
  });
});

describe("extract source values", () => {
  it("writes each requested value to an independent file and splits long text", async () => {
    const longText = "海😀港\n".repeat(9000);
    const file = await sourceFile(
      card({ description: longText, alternate_greetings: ["第二段"] }),
    );
    const task = await begin(file);
    cleanup.push(dirname(task.taskFile));

    const first = await extract(task.taskFile, [
      "/data/description",
      "/data/alternate_greetings/0",
    ]);
    const second = await extract(task.taskFile, ["/data/description"]);

    expect(first.passed).toBe(true);
    expect(first.items).toHaveLength(2);
    expect(second.directory).not.toBe(first.directory);
    expect(second.items[0]!.contentFile).not.toBe(first.items[0]!.contentFile);
    const item = first.items[0]!;
    expect(item.partCount).toBeGreaterThan(1);
    expect("value" in item).toBe(false);
    const partFiles = (await readdir(item.partsDirectory!)).sort();
    const joined = await Promise.all(
      partFiles.map((name) =>
        readFile(join(item.partsDirectory!, name), "utf8"),
      ),
    );
    expect(joined.join("")).toBe(longText);
    expect(await readFile(first.items[1]!.contentFile, "utf8")).toBe("第二段");
  });

  it("preserves successful extracts when another pointer is invalid", async () => {
    const file = await sourceFile(card({ description: "不得丢失的原文" }));
    const task = await begin(file);
    cleanup.push(dirname(task.taskFile));

    const result = await extract(task.taskFile, [
      "/data/description",
      "/data/not_found",
    ]);

    expect(result.passed).toBe(false);
    expect(result.items).toHaveLength(1);
    expect(await readFile(result.items[0]!.contentFile, "utf8")).toBe(
      "不得丢失的原文",
    );
    expect(result.issues).toMatchObject([
      {
        pointer: "/data/not_found",
        message: expect.stringContaining("不存在"),
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("不得丢失的原文");
  });

  it("rejects an empty pointer list before creating an extraction directory", async () => {
    const file = await sourceFile(card());
    const task = await begin(file);
    cleanup.push(dirname(task.taskFile));
    await expect(extract(task.taskFile, [])).rejects.toThrow(
      "至少一个源 JSON Pointer",
    );
    expect(
      (await readdir(dirname(task.taskFile))).filter((name) =>
        name.startsWith(taskPaths.extractPrefix),
      ),
    ).toEqual([]);
  });
});
