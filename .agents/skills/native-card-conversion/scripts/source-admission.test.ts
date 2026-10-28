import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { begin, precheckCard } from "./source.ts";
import { SourceCardInputError, validateSourceCard } from "./source-format.ts";
import {
  nativeCardCharacterSchema,
  nativeCardWorldbookEntrySchema,
} from "../../../../packages/shared/src/schemas/native-card-package/schema.ts";
import {
  sourceBook,
  sourceEntry,
  sourceTaskFiles,
  v3Card,
} from "./source-fixtures.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

it("begin在创建任务前拒绝源结构错误并保留源文件", async () => {
  const root = await mkdtemp(join(tmpdir(), "source-admission-"));
  roots.push(root);
  const file = join(root, "角色.json");
  const text = JSON.stringify(
    v3Card({
      character_book: sourceBook([sourceEntry({ comment: ["城市烟火人间"] })]),
    }),
  );
  await writeFile(file, text);
  await expect(begin(file)).rejects.toBeInstanceOf(SourceCardInputError);
  await expect(begin(file)).rejects.toMatchObject({
    diagnostic: {
      sourceFile: file,
      cardName: "测试角色",
      issues: [
        expect.objectContaining({
          pointer: "/data/character_book/entries/0/comment",
        }),
      ],
    },
  });
  expect(await readFile(file, "utf8")).toBe(text);
  expect(await sourceTaskFiles(file)).toEqual([]);
});

it("源卡缺少姓名时创建待判断任务并保留原件与原始快照", async () => {
  const root = await mkdtemp(join(tmpdir(), "source-admission-"));
  roots.push(root);
  const file = join(root, "无姓名.json");
  const text =
    '{\n  "spec": "chara_card_v3",\n  "spec_version": "3.0",\n  "data": { "description": "她在码头等候。" }\n}\n';
  await writeFile(file, text);
  const result = await begin(file);
  roots.push(dirname(result.taskFile));
  const task = JSON.parse(await readFile(result.taskFile, "utf8"));
  expect(await readFile(file, "utf8")).toBe(text);
  expect(await readFile(task.sourceFile, "utf8")).toBe(text);
  await expect(
    access(join(result.packageDirectory, "character.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
  const work = JSON.parse(await readFile(result.workFile, "utf8"));
  const item = work.items.find(
    (item: { pointer: string }) => item.pointer === "/data/name",
  );
  expect(item).toMatchObject({
    category: "character",
    valueType: "undefined",
    valuePresent: false,
  });
  expect(await readFile(item.contentFile, "utf8")).toBe("");
  expect(JSON.parse(await readFile(task.sourceFile, "utf8")).data).toEqual({
    description: "她在码头等候。",
  });
});

it("begin按实际源字段生成严格候选并保留未知平台原文", async () => {
  const source = {
    spec: "chara_card_v3",
    spec_version: "3.0",
    data: {
      name: "码头守望者",
      description: "她在码头等候。",
      character_book: {
        entries: [
          {
            keys: ["码头"],
            content: "灯塔每晚点灯。",
            insertion_order: 1,
            enabled: true,
          },
        ],
      },
      extensions: {
        platform: {
          script: "throw new Error('源脚本不得执行');",
          state: { score: 1 },
        },
      },
    },
  };
  const before = structuredClone(source);
  const admitted = validateSourceCard(source);
  if (!admitted.success) throw new Error("源字段类型应可读取");
  const checked = precheckCard(admitted);
  expect(checked.character).toEqual({
    name: "码头守望者",
    description: "她在码头等候。",
    worldbooks: [
      { id: "book-0", file: "worldbooks/book-0/book.json", enabled: true },
    ],
  });
  expect(nativeCardCharacterSchema.safeParse(checked.character).success).toBe(
    true,
  );
  expect(checked.worldbook?.entries).toHaveLength(1);
  expect(
    nativeCardWorldbookEntrySchema.safeParse(
      checked.worldbook?.entries[0]?.value,
    ).success,
  ).toBe(true);
  expect(source).toEqual(before);

  const root = await mkdtemp(join(tmpdir(), "source-admission-"));
  roots.push(root);
  const file = join(root, "不补字段.json");
  const text = JSON.stringify(source, null, 4) + "\n";
  await writeFile(file, text);
  const result = await begin(file);
  roots.push(dirname(result.taskFile));
  const task = JSON.parse(await readFile(result.taskFile, "utf8"));
  expect(await readFile(file, "utf8")).toBe(text);
  expect(await readFile(task.sourceFile, "utf8")).toBe(text);
  expect(
    JSON.parse(
      await readFile(join(result.packageDirectory, "character.json"), "utf8"),
    ),
  ).toEqual(checked.character);
  const work = JSON.parse(await readFile(result.workFile, "utf8"));
  expect(work.items).toEqual([
    expect.objectContaining({
      pointer: "/data/extensions/platform",
      category: "extension",
      valuePresent: true,
    }),
  ]);
  expect(JSON.parse(await readFile(work.items[0].contentFile, "utf8"))).toEqual(
    source.data.extensions.platform,
  );
});

it("源字段类型与目标字段类型不同的时候保留原值供Agent判断", () => {
  const source = {
    spec: "chara_card_v3",
    spec_version: "3.0",
    data: {
      name: "码头守望者",
      source: ["platform-card-id"],
      creation_date: 1_700_000_000,
    },
  };
  const before = structuredClone(source);
  const admitted = validateSourceCard(source);
  if (!admitted.success) throw new Error("源字段类型应可读取");
  const checked = precheckCard(admitted);
  expect(checked.character).toEqual({ name: "码头守望者" });
  expect(checked.pending).toEqual([
    expect.objectContaining({ pointer: "/data/source", category: "character" }),
    expect.objectContaining({
      pointer: "/data/creation_date",
      category: "other",
    }),
  ]);
  expect(nativeCardCharacterSchema.safeParse(checked.character).success).toBe(
    true,
  );
  expect(source).toEqual(before);
});

it("世界书条目缺少正文时留下待判断任务并阻止候选写入", async () => {
  const source = {
    spec: "chara_card_v3",
    spec_version: "3.0",
    data: {
      name: "码头守望者",
      character_book: {
        entries: [{ keys: ["码头"], insertion_order: 1, enabled: true }],
      },
    },
  };
  const root = await mkdtemp(join(tmpdir(), "source-admission-"));
  roots.push(root);
  const file = join(root, "缺正文.json");
  const text = JSON.stringify(source);
  await writeFile(file, text);
  const result = await begin(file);
  roots.push(dirname(result.taskFile));
  const task = JSON.parse(await readFile(result.taskFile, "utf8"));
  expect(await readFile(task.sourceFile, "utf8")).toBe(text);
  const work = JSON.parse(await readFile(result.workFile, "utf8"));
  const missing = work.items.find(
    (item: { pointer: string }) =>
      item.pointer === "/data/character_book/entries/0/content",
  );
  expect(missing).toMatchObject({ valuePresent: false, category: "worldbook" });
  expect(await readFile(missing.contentFile, "utf8")).toBe("");
  const character = JSON.parse(
    await readFile(join(result.packageDirectory, "character.json"), "utf8"),
  );
  const book = JSON.parse(
    await readFile(
      join(result.packageDirectory, character.worldbooks[0].file),
      "utf8",
    ),
  );
  expect(book.entryFiles).toEqual([]);
  expect(source.data.character_book.entries[0]).toEqual({
    keys: ["码头"],
    insertion_order: 1,
    enabled: true,
  });
});

it.each(["alternate_greetings", "group_only_greetings"])(
  "空first_mes保留%s中的开场正文",
  async (field) => {
    const root = await mkdtemp(join(tmpdir(), "source-openings-"));
    roots.push(root);
    const file = join(root, "角色.json");
    await writeFile(
      file,
      JSON.stringify(v3Card({ [field]: ["雨声从窗外传来。"] })),
    );
    const result = await begin(file);
    roots.push(result.taskFile.slice(0, result.taskFile.lastIndexOf("/")));
    expect(JSON.parse(await readFile(result.workFile, "utf8")).items).toEqual([
      expect.objectContaining({ pointer: "/data/" + field + "/0" }),
    ]);
    await expect(
      readFile(join(result.packageDirectory, "openings.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  },
);
