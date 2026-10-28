import { completeSourceFixture } from "./source-fixtures.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { readNativeCardZip } from "../../../../apps/api/src/services/native-card/zip.ts";
import limits from "../../../../apps/api/config/native-card.json" with { type: "json" };
const execute = promisify(execFile),
  roots: string[] = [];
const entrypoint = resolve(
  ".agents/skills/native-card-conversion/scripts/convert.mjs",
);
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function cli(...args: string[]) {
  const result = await execute(process.execPath, [entrypoint, ...args]);
  expect(result.stderr).toBe("");
  expect(Buffer.byteLength(result.stdout)).toBeLessThan(1200);
  const ref = JSON.parse(result.stdout),
    saved = JSON.parse(await readFile(ref.resultFile, "utf8"));
  expect(saved.passed).toBe(true);
  return saved.data;
}
it("begin后的初值parse再按replace顺序覆写，通过index、validate并进入pack", async () => {
  const root = await mkdtemp(join(tmpdir(), "card-cli-replacements-flow-"));
  roots.push(root);
  const source = join(root, "replacement-card.json");
  await writeFile(
    source,
    JSON.stringify(
      completeSourceFixture({
        name: "开场初值流程",
        description: "转换期初值覆写",
        initialState: '{"counter":1,"profile":{"ready":false}}',
        replacements: JSON.stringify([
          { op: "replace", path: "/counter", value: 2 },
          { op: "replace", path: "/counter", value: 7 },
          { op: "replace", path: "/profile/ready", value: true },
        ]),
      }),
    ),
  );
  const task = await cli("begin", source);
  roots.push(dirname(task.taskFile));

  await cli(
    "parse",
    task.taskFile,
    "/initialState",
    "data/initial.json",
    "--format",
    "json",
  );
  await cli(
    "parse",
    task.taskFile,
    "/replacements",
    "data/initial.json",
    "--format",
    "json",
    "--apply-replacements",
  );
  const initialPath = join(task.packageDirectory, "data/initial.json");
  expect(JSON.parse(await readFile(initialPath, "utf8"))).toEqual({
    counter: 7,
    profile: { ready: true },
  });

  await cli("index", task.taskFile);
  await cli("validate", task.taskFile);
  const packed = await cli("pack", task.taskFile);
  const zip = readNativeCardZip(await readFile(packed.archive), limits);
  expect(
    JSON.parse(
      Buffer.from(
        zip.find((file) => file.path === "data/initial.json")!.content,
      ).toString(),
    ),
  ).toEqual({ counter: 7, profile: { ready: true } });
}, 60000);

it("begin自动结果经多字段、解析、条目和正则选择后打包，正式导入两次独立归档保持A内容", async () => {
  const root = await mkdtemp(join(tmpdir(), "card-cli-flow-"));
  roots.push(root);
  const source = join(root, "卡片.json");
  const regex = (id: string, text: string) => ({
    id,
    scriptName: id,
    findRegex: text,
    replaceString: "替换",
    placement: [2],
    disabled: false,
    markdownOnly: false,
    promptOnly: false,
    runOnEdit: false,
    substituteRegex: 0,
    minDepth: null,
    maxDepth: null,
    trimStrings: [],
  });
  await writeFile(
    source,
    JSON.stringify(
      completeSourceFixture({
        name: "流程样本",
        description: "保留原文",
        character_book: {
          name: "嵌入世界书",
          entries: [
            {
              id: 0,
              keys: ["关键词"],
              content: "普通事实",
              insertion_order: 0,
              enabled: true,
            },
            {
              id: 1,
              keys: [],
              comment: "[initvar]",
              content: "counter: 7",
              insertion_order: 1,
              enabled: false,
            },
          ],
        },
        extensions: {
          regex_scripts: [regex("auto", "foo"), regex("manual", "<script>")],
          values: Array.from({ length: 8 }, (_, index) => index),
        },
      }),
    ),
  );
  const task = await cli("begin", source);
  roots.push(dirname(task.taskFile));
  expect(Object.keys(task).sort()).toEqual([
    "packageDirectory",
    "pendingCount",
    "taskFile",
    "workFile",
  ]);
  const output = await cli(
    "extract",
    task.taskFile,
    "/description",
    "/character_book/entries/1/content",
  );
  expect(output.items).toHaveLength(2);
  await cli(
    "copy",
    task.taskFile,
    "data/values.json",
    ...Array.from({ length: 8 }, (_, index) => [
      "--field",
      `/extensions/values/${index}`,
      `/v${index}`,
    ]).flat(),
  );
  expect(
    JSON.parse(
      await readFile(join(task.packageDirectory, "data/values.json"), "utf8"),
    ),
  ).toEqual(
    Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`v${i}`, i])),
  );
  await cli(
    "parse",
    task.taskFile,
    "/character_book/entries/1/content",
    "data/initial.json",
    "--format",
    "yaml",
  );
  expect(
    JSON.parse(
      await readFile(join(task.packageDirectory, "data/initial.json"), "utf8"),
    ),
  ).toEqual({ counter: 7 });
  await cli(
    "map-entry",
    task.taskFile,
    "/character_book/entries/1",
    "worldbooks/book-0/entries/e1.json",
    "--copy-content",
  );
  await cli(
    "map-regex",
    task.taskFile,
    "/extensions/regex_scripts",
    "regex/source.json",
    "--indices",
    "1",
  );
  expect(
    JSON.parse(
      await readFile(join(task.packageDirectory, "regex/source.json"), "utf8"),
    ),
  ).toHaveLength(2);
  const book = JSON.parse(
    await readFile(
      join(task.packageDirectory, "worldbooks/book-0/book.json"),
      "utf8",
    ),
  );
  expect(book.entryFiles).toEqual([
    "worldbooks/book-0/entries/e0.json",
    "worldbooks/book-0/entries/e1.json",
  ]);
  await cli("index", task.taskFile);
  await cli("validate", task.taskFile);
  const a = await cli("pack", task.taskFile);
  await writeFile(
    join(task.packageDirectory, "data/initial.json"),
    '{"counter":99}',
  );
  await cli("index", task.taskFile);
  const b = await cli("pack", task.taskFile);
  expect(a.archive).not.toBe(b.archive);
  const zip = readNativeCardZip(await readFile(a.archive), limits);
  expect(
    JSON.parse(
      Buffer.from(
        zip.find((file) => file.path === "data/initial.json")!.content,
      ).toString(),
    ),
  ).toEqual({ counter: 7 });
  const formal = await cli("formal", task.taskFile, "--archive", a.archive);
  expect(formal.passed).toBe(true);
  expect(formal.sourceZipPath ?? formal.zipPath ?? formal.archive).not.toBe(
    b.archive,
  );
}, 60000);
