import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { pngCard } from "./source-config.ts";
import runtime from "./runtime.json" with { type: "json" };
import { taskRepositoryRoot } from "./task-context.ts";
import {
  sourceBook,
  sourceEntry,
  sourceTaskFiles,
  v3Card,
} from "./source-fixtures.ts";

const roots: string[] = [];
const entry = resolve(
  ".agents/skills/native-card-conversion/scripts/convert.mjs",
);
const output = join(taskRepositoryRoot, runtime.outputDirectory);
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function chunk(type: string, data: Buffer) {
  const bytes = Buffer.alloc(data.length + 12);
  bytes.writeUInt32BE(data.length);
  bytes.write(type, 4, "ascii");
  data.copy(bytes, 8);
  bytes.writeUInt32BE(crc32(bytes.subarray(4, -4)), bytes.length - 4);
  return bytes;
}
function png(text: string) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from(pngCard.signature),
    chunk("IHDR", header),
    chunk("tEXt", Buffer.from("ccv3\0" + Buffer.from(text).toString("base64"))),
    chunk("IDAT", deflateSync(Buffer.from([0, 0, 0, 0, 255]))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
async function processBegin(file: string, id = randomUUID()) {
  roots.push(join(output, "creations", "begin", id));
  const child = spawn(process.execPath, [
    entry,
    "begin",
    file,
    "--request-id",
    id,
  ]);
  const stdout: Buffer[] = [],
    stderr: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  child.stdin.end();
  const [code] = await once(child, "close");
  const result = {
    code,
    stdout: Buffer.concat(stdout).toString(),
    stderr: Buffer.concat(stderr).toString(),
  };
  const reference = JSON.parse(result.stderr || result.stdout);
  const savedFile = reference.diagnosticFile ?? reference.resultFile;
  roots.push(dirname(savedFile));
  const saved = JSON.parse(await readFile(savedFile, "utf8"));
  if (typeof saved.data?.taskFile === "string")
    roots.push(dirname(saved.data.taskFile));
  return {
    ...result,
    reference,
    saved,
    creation: JSON.parse(
      await readFile(
        join(output, "creations", "begin", id, "creation.json"),
        "utf8",
      ),
    ),
  };
}
async function sourceFile(text: string, format = "json") {
  const root = await mkdtemp(join(tmpdir(), "source-cli-"));
  roots.push(root);
  const file = join(root, "源角色." + format);
  await writeFile(file, format === "png" ? png(text) : text);
  return file;
}
describe.sequential("真实CLI源卡准入", () => {
  it.each(["json", "png"])(
    "%s错误输入输出完整诊断且不生成任务",
    async (format) => {
      const text = JSON.stringify(
        v3Card({
          description: [],
          tags: [0],
          character_book: sourceBook([
            sourceEntry({ comment: ["源正文保密样本"] }),
          ]),
        }),
      );
      const file = await sourceFile(text, format);
      const bytes = await readFile(file);
      const result = await processBegin(file);
      expect(result).toMatchObject({
        code: 1,
        stdout: "",
        creation: { status: "failed" },
      });
      expect(result.reference.diagnosticFile).toEqual(expect.any(String));
      expect(result.saved).toMatchObject({
        passed: false,
        data: {
          code: "SOURCE_CARD_FORMAT_INVALID",
          sourceFile: file,
          cardName: "测试角色",
          declaredVersion: { spec: "chara_card_v3", specVersion: "3.0" },
        },
      });
      expect(
        result.saved.data.issues.map(
          (issue: { pointer: string }) => issue.pointer,
        ),
      ).toEqual(
        expect.arrayContaining([
          "/data/description",
          "/data/tags/0",
          "/data/character_book/entries/0/comment",
        ]),
      );
      expect(JSON.stringify(result.saved)).not.toContain("源正文保密样本");
      expect(await sourceTaskFiles(file)).toEqual([]);
      expect(await readFile(file)).toEqual(bytes);
      const retried = await processBegin(file);
      expect(retried.saved.data.code).toBe("SOURCE_CARD_FORMAT_INVALID");
      expect(retried.creation.status).toBe("failed");
      expect(await sourceTaskFiles(file)).toEqual([]);
    },
  );
  it.each([
    [{ spec: "chara_card_v3", data: {} }, "SOURCE_CARD_FORMAT_INVALID"],
    [
      { spec: "chara_card_v3", spec_version: "2.0", data: {} },
      "SOURCE_CARD_FORMAT_INVALID",
    ],
    [
      { spec: "chara_card_v4", spec_version: "4.0", data: {} },
      "SOURCE_CARD_VERSION_UNSUPPORTED",
    ],
  ])("声明错误按CLI失败协议返回 %#", async (source, code) => {
    const result = await processBegin(await sourceFile(JSON.stringify(source)));
    expect(result).toMatchObject({
      code: 1,
      stdout: "",
      saved: { passed: false, data: { code } },
    });
  });
  it.each(["json", "png"])(
    "%s资源元数据进入待判断内容且原件不变",
    async (format) => {
      const source = v3Card({
        assets: ["icon", "background"].flatMap((type) =>
          ["PNG", "png"].map((ext) => ({
            type,
            uri: "https://example.com/a",
            name: "main",
            ext,
          })),
        ),
      });
      const file = await sourceFile(JSON.stringify(source), format);
      const bytes = await readFile(file);
      const result = await processBegin(file);
      expect(result).toMatchObject({
        code: 0,
        stderr: "",
        creation: { status: "complete" },
        saved: { passed: true },
      });
      const work = JSON.parse(
        await readFile(result.saved.data.workFile, "utf8"),
      );
      const item = work.items.find(
        (item: { pointer: string }) => item.pointer === "/data/assets",
      );
      expect(item).toMatchObject({ category: "other", valuePresent: true });
      expect(JSON.parse(await readFile(item.contentFile, "utf8"))).toEqual(
        (source.data as Record<string, unknown>).assets,
      );
      expect(await sourceTaskFiles(file)).toEqual([result.saved.data.taskFile]);
      expect(await readFile(file)).toEqual(bytes);
    },
  );
  it("并发成功调用与拒绝调用分别记录各自任务归属", async () => {
    const invalidFile = await sourceFile(
      JSON.stringify(v3Card({ description: [] })),
    );
    const validFile = await sourceFile(
      JSON.stringify(v3Card({ first_mes: "港口的铃声响了。" })),
    );
    const [invalid, valid] = await Promise.all([
      processBegin(invalidFile),
      processBegin(validFile),
    ]);
    expect(invalid).toMatchObject({
      code: 1,
      stdout: "",
      creation: { status: "failed" },
    });
    expect(valid).toMatchObject({
      code: 0,
      stderr: "",
      creation: { status: "complete" },
    });
    expect(await sourceTaskFiles(invalidFile)).toEqual([]);
    expect(await sourceTaskFiles(validFile)).toEqual([
      valid.saved.data.taskFile,
    ]);
  });
  it.each(["json", "png"])(
    "%s标准data URI创建任务且保留原件",
    async (format) => {
      const file = await sourceFile(
        JSON.stringify(
          v3Card({
            assets: [
              {
                type: "icon",
                uri: "DATA:image/png;BASE64,AA%3D%3D#fragment",
                name: "main",
                ext: "png",
              },
            ],
          }),
        ),
        format,
      );
      const bytes = await readFile(file);
      const result = await processBegin(file);
      expect(result).toMatchObject({
        code: 0,
        stderr: "",
        creation: { status: "complete" },
        saved: { passed: true },
      });
      expect(await sourceTaskFiles(file)).toEqual([result.saved.data.taskFile]);
      expect(await readFile(file)).toEqual(bytes);
    },
  );
  it.each([
    ["json", "https://example.com/a\\b"],
    ["png", "https://example.com/a\\b"],
    ["json", "data:bogus;base64,AAAA"],
    ["png", "data:image/png;broken;base64,AAAA"],
    ["json", "https://example.com/a b"],
    ["png", "https://example.com/a b"],
    ["json", "data:image/png;base64,AA%FF"],
    ["png", "data:image/png;base64,AA%FF"],
  ])("%s资源定位字符串进入待判断原文 %#", async (format, uri) => {
    const file = await sourceFile(
      JSON.stringify(
        v3Card({ assets: [{ type: "icon", uri, name: "main", ext: "png" }] }),
      ),
      format,
    );
    const bytes = await readFile(file);
    const result = await processBegin(file);
    expect(result).toMatchObject({
      code: 0,
      stderr: "",
      creation: { status: "complete" },
      saved: { passed: true },
    });
    const work = JSON.parse(await readFile(result.saved.data.workFile, "utf8"));
    const item = work.items.find(
      (item: { pointer: string }) => item.pointer === "/data/assets",
    );
    expect(JSON.parse(await readFile(item.contentFile, "utf8"))[0].uri).toBe(
      uri,
    );
    expect(await sourceTaskFiles(file)).toEqual([result.saved.data.taskFile]);
    expect(await readFile(file)).toEqual(bytes);
  });
  it.each(["json", "png"])(
    "%s源卡缺少书级与条目扩展和群聊数组时创建任务并保存原始快照",
    async (format) => {
      const source = {
        spec: "chara_card_v3",
        spec_version: "3.0",
        data: {
          name: "码头守望者",
          character_book: {
            entries: [
              { keys: ["码头"], content: "灯塔每晚点灯。", insertion_order: 1 },
            ],
          },
        },
      };
      const text = JSON.stringify(source, null, 4) + "\n";
      const file = await sourceFile(text, format);
      const bytes = await readFile(file);
      const result = await processBegin(file);
      expect(result).toMatchObject({
        code: 0,
        stderr: "",
        saved: { passed: true },
      });
      const task = JSON.parse(
        await readFile(result.saved.data.taskFile, "utf8"),
      );
      expect(await readFile(task.sourceFile, "utf8")).toBe(text);
      expect(await readFile(file)).toEqual(bytes);
      expect(JSON.parse(await readFile(task.sourceFile, "utf8"))).toEqual(
        source,
      );
      expect(result.saved.data.pendingCount).toBe(0);
    },
  );
  it("JSON语法错误按通用失败协议返回且诊断省略源正文", async () => {
    const result = await processBegin(await sourceFile("源正文不应进入诊断"));
    expect(result).toMatchObject({
      code: 1,
      stdout: "",
      saved: { passed: false },
    });
    expect(result.saved.data.error).toContain("SyntaxError");
    expect(JSON.stringify(result.saved)).not.toContain("源正文不应进入诊断");
  });
  it("修正源文件后以新请求ID生成转换任务", async () => {
    const file = await sourceFile(JSON.stringify(v3Card({ description: [] })));
    expect((await processBegin(file)).code).toBe(1);
    await writeFile(
      file,
      JSON.stringify(v3Card({ first_mes: "港口的铃声响了。" })),
    );
    const result = await processBegin(file);
    expect(result).toMatchObject({
      code: 0,
      stderr: "",
      saved: { passed: true, data: { pendingCount: 1 } },
    });
    expect(
      JSON.parse(await readFile(result.saved.data.workFile, "utf8")).items,
    ).toHaveLength(1);
  });
});
