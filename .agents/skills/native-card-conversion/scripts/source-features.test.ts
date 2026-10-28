import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { begin } from "./source.ts";
import {
  precheckSourceFixture as precheckCard,
  completeSourceFixture,
  v3Card,
} from "./source-fixtures.ts";
import { taskPaths } from "./source-config.ts";

const created: string[] = [];
const card = (
  data: Record<string, unknown>,
  mirrors: Record<string, unknown> = {},
) => ({
  spec: "chara_card_v3",
  spec_version: "3.0",
  data: { name: "角色", ...data },
  ...mirrors,
});

async function sourceFile(value: unknown) {
  const directory = await mkdtemp(join(tmpdir(), "source feature "));
  created.push(directory);
  const file = join(directory, "card.json");
  await writeFile(file, JSON.stringify(completeSourceFixture(value)));
  return file;
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

afterEach(async () => {
  for (const path of created.splice(0))
    await rm(path, { recursive: true, force: true });
});

describe("source marker screening", () => {
  it("directly maps plain prose while leaving an unknown entry field separate", () => {
    const result = precheckCard(
      card({
        description: "她在港口经营修船铺，常替水手留一盏灯。",
        character_book: {
          name: "港口传闻",
          entries: [
            {
              keys: ["灯塔"],
              content: "旧灯塔在暴风雨前会先亮起。",
              insertion_order: 100,
              custom_detail: "<custom>需要单独判断</custom>",
            },
          ],
        },
        extensions: {
          regex_scripts: [
            {
              scriptName: "港口替换",
              findRegex: "\\b港口\\b",
              replaceString: "海湾",
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

    expect(result.character.description).toBe(
      "她在港口经营修船铺，常替水手留一盏灯。",
    );
    expect(result.worldbook?.entries[0]?.value.content).toBe(
      "旧灯塔在暴风雨前会先亮起。",
    );
    expect(result.regexRules?.[0]?.findRegex).toBe("\\b港口\\b");
    expect(result.pending.map((item) => item.pointer)).toEqual([
      "/data/character_book/entries/0/custom_detail",
    ]);
    expect(result.pending[0]?.matches).toContainEqual({
      pointer: "/data/character_book/entries/0/custom_detail",
      feature: "HTML标签",
    });
  });

  it.each([
    ["[initvar]设置", "MVU标记"],
    ["[mvu_update]更新", "MVU标记"],
    ["[mvu_plot]记录", "MVU标记"],
    ["每轮更新角色变量。", "变量更新指令"],
    ["结尾输出完整变量。", "变量输出要求"],
    ["请按 JSON 输出。", "变量输出要求"],
    ["<UpdateVariable>旧协议</UpdateVariable>", "旧变量输出协议"],
    ["<% if (ready) { %>", "EJS模板"],
    ["<section>正文</section>", "HTML标签"],
    ['<p>正文</p><a href="page">链接</a>', "HTML标签"],
    ["<style>.card { color: red; }</style>", "CSS样式"],
    [".card { color: red; }", "CSS样式"],
    ["const status = 1;", "程序代码"],
    ["TavernHelper.getvar('affection')", "插件调用"],
    ["{{custom_macro}}", "不支持的变量宏"],
    ["[status]心情", "状态展示标记"],
  ])("holds marked character text: %s", (text, feature) => {
    const result = precheckCard(card({ description: text }));

    expect(result.character).not.toHaveProperty("description");
    expect(result.pending).toContainEqual(
      expect.objectContaining({
        pointer: "/data/description",
        matches: expect.arrayContaining([
          expect.objectContaining({
            pointer: "/data/description",
            feature,
          }),
        ]),
      }),
    );
  });

  it("keeps a marked entry and disabled regex out of the package", async () => {
    const file = await sourceFile(
      card({
        character_book: {
          name: "世界书",
          entries: [
            {
              keys: ["港口"],
              content: "<div>含 HTML 标记</div>",
              insertion_order: 100,
            },
            { keys: ["灯塔"], content: "普通记忆正文", insertion_order: 101 },
          ],
        },
        extensions: {
          regex_scripts: [
            {
              scriptName: "协议规则",
              findRegex: "\\b状态\\b",
              replaceString: "[initvar]需要判断",
              placement: [2],
              disabled: true,
              markdownOnly: false,
              promptOnly: false,
              runOnEdit: false,
            },
            {
              scriptName: "普通替换",
              findRegex: "\\b灯塔\\b",
              replaceString: "旧灯塔",
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

    const precheck = precheckCard(
      JSON.parse(await readFile(file, "utf8")) as unknown,
    );
    expect(precheck.regexSourceIndices).toEqual([1]);
    expect(precheck.regexSourcePointer).toBe("/data/extensions/regex_scripts");
    expect(precheck.worldbook?.entries.map((entry) => entry.index)).toEqual([
      1,
    ]);
    expect(precheck.pending).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pointer: "/data/character_book/entries/0/content",
          matches: [expect.objectContaining({ feature: "HTML标签" })],
        }),
        expect.objectContaining({
          pointer: "/data/extensions/regex_scripts/0/replaceString",
          matches: [expect.objectContaining({ feature: "MVU标记" })],
        }),
      ]),
    );

    const result = await begin(file);
    created.push(dirname(result.taskFile));
    const book = await readJson<Record<string, unknown>>(
      join(result.packageDirectory, taskPaths.worldbookFile),
    );
    expect(book.entryFiles).toEqual([
      `${taskPaths.worldbookEntriesDirectory}/e1${taskPaths.worldbookEntrySuffix}`,
    ]);
    const safeEntry = await readJson<Record<string, unknown>>(
      join(
        result.packageDirectory,
        taskPaths.worldbookEntriesDirectory,
        `e1${taskPaths.worldbookEntrySuffix}`,
      ),
    );
    expect(safeEntry.content).toBe("普通记忆正文");
    const regex = await readJson<Array<Record<string, unknown>>>(
      join(result.packageDirectory, taskPaths.regexFile),
    );
    expect(regex).toEqual([
      expect.objectContaining({ id: "regex-1", findRegex: "\\b灯塔\\b" }),
    ]);
    expect(JSON.stringify([book, safeEntry, regex])).not.toContain("initvar");
    expect(JSON.stringify([book, safeEntry, regex])).not.toContain("含 HTML");
  });

  it("adds referenced plugin variables and regex tags as reading context", () => {
    const result = precheckCard(
      card({
        description:
          "当前好感：{{getvar::affection}}；心情 <mood>平静</mood>。",
        extensions: {
          tavern_helper: { variables: { affection: "calm" } },
          regex_scripts: [
            {
              scriptName: "心情标签",
              findRegex: "<mood>([\\s\\S]*?)</mood>",
              replaceString: "$1",
              placement: [2],
              disabled: true,
              markdownOnly: false,
              promptOnly: false,
              runOnEdit: false,
            },
          ],
        },
      }),
    );
    const description = result.pending.find(
      (item) => item.pointer === "/data/description",
    );
    expect(description?.matches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ feature: "不支持的变量宏" }),
        expect.objectContaining({ feature: "HTML标签" }),
      ]),
    );
    expect(description?.contextPointers).toEqual(
      expect.arrayContaining([
        "/data/extensions/tavern_helper/variables/affection",
        "/data/extensions/regex_scripts/0/findRegex",
      ]),
    );
    expect(result.pending).toContainEqual(
      expect.objectContaining({
        pointer: "/data/extensions/regex_scripts/0/findRegex",
      }),
    );

    const tupleVariables = precheckCard(
      card({
        description: "当前心情：{{getvar::mood}}",
        extensions: {
          tavern_helper: [["variables", [["mood", "steady"]]]],
        },
      }),
    );
    expect(
      tupleVariables.pending.find(
        (item) => item.pointer === "/data/description",
      )?.contextPointers,
    ).toContain("/data/extensions/tavern_helper/0/1/0");
  });

  it("prepares each related source value and its long-text parts during begin", async () => {
    const longVariable = "潮汐状态".repeat(6_000);
    const file = await sourceFile(
      card({
        description: "好感：{{getvar::affection}}；心情 <mood>平静</mood>。",
        extensions: {
          tavern_helper: { variables: { affection: longVariable } },
          regex_scripts: [
            {
              scriptName: "心情标签",
              findRegex: "<mood>([\\s\\S]*?)</mood>",
              replaceString: "$1",
              placement: [2],
              disabled: true,
              markdownOnly: false,
              promptOnly: false,
              runOnEdit: false,
            },
          ],
        },
      }),
    );

    const result = await begin(file);
    created.push(dirname(result.taskFile));
    const work = await readJson<{
      items: Array<{
        pointer: string;
        contexts?: Array<{
          pointer: string;
          valueType: string;
          valuePresent: boolean;
          contentFile: string;
          partsDirectory?: string;
          partCount: number;
        }>;
      }>;
    }>(result.workFile);
    const description = work.items.find(
      (item) => item.pointer === "/data/description",
    );
    expect(description?.contexts?.map((item) => item.pointer)).toEqual(
      expect.arrayContaining([
        "/data/extensions/tavern_helper/variables/affection",
        "/data/extensions/regex_scripts/0/findRegex",
      ]),
    );

    const variable = description?.contexts?.find(
      (item) =>
        item.pointer === "/data/extensions/tavern_helper/variables/affection",
    );
    expect(variable).toMatchObject({
      valueType: "string",
      valuePresent: true,
      partCount: expect.any(Number),
    });
    expect(variable?.partCount).toBeGreaterThan(0);
    expect(variable?.partsDirectory).toBeDefined();
    expect(await readFile(variable!.contentFile, "utf8")).toBe(longVariable);
    const partNames = (await readdir(variable!.partsDirectory!)).sort();
    const parts = await Promise.all(
      partNames.map((name) =>
        readFile(join(variable!.partsDirectory!, name), "utf8"),
      ),
    );
    expect(parts.join("")).toBe(longVariable);
    expect(JSON.stringify(work)).not.toContain(longVariable);
  });

  it("keeps conflicts and unknown source fields distinct from marker screening", () => {
    const result = precheckCard(
      card(
        {
          creator_notes: "普通作者备注",
          character_book: {
            entries: [
              {
                keys: ["港口"],
                content: "普通正文",
                insertion_order: 100,
                unknown_field: "需保留原样",
              },
            ],
          },
        },
        { creatorcomment: "<% 原作者模板 %>" },
      ),
    );

    expect(result.pending.map((item) => item.pointer)).toEqual([
      "/data/creator_notes",
      "/creatorcomment",
      "/data/character_book/entries/0/unknown_field",
    ]);
    expect(result.pending[0]?.matches).toBeUndefined();
    expect(result.pending[1]?.matches).toEqual([
      expect.objectContaining({ feature: "EJS模板" }),
    ]);
    expect(result.worldbook?.entries[0]?.value.content).toBe("普通正文");
    expect(result.worldbook?.entries[0]?.value.key).toEqual(["港口"]);
  });

  it("keeps a missing target name in review while mapping readable resources", async () => {
    const source = v3Card({
      character_book: { entries: [] },
      extensions: { regex_scripts: [] },
    });
    delete (source.data as Record<string, unknown>).name;
    const file = await sourceFile(v3Card());
    const text = JSON.stringify(source);
    await writeFile(file, text);
    const result = await begin(file);
    created.push(dirname(result.taskFile));
    const work = await readJson<{ items: unknown[] }>(result.workFile);
    expect(work.items).toEqual([
      expect.objectContaining({ pointer: "/data/name", valuePresent: false }),
    ]);
    await expect(
      readFile(join(result.packageDirectory, taskPaths.characterFile)),
    ).rejects.toMatchObject({ code: "ENOENT" });
    const book = await readJson<{ entryFiles: string[] }>(
      join(result.packageDirectory, taskPaths.worldbookFile),
    );
    expect(book.entryFiles).toEqual([]);
    expect(await readFile(file, "utf8")).toBe(text);
  });
});
