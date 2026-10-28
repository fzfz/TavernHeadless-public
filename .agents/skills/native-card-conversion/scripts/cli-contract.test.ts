import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { commandDefinitions, commandHelp } from "./tool-config.ts";
import { parseInvocation } from "./cli.ts";
import { saveCommandResult, saveTextParts } from "./output.ts";
const execute = promisify(execFile),
  directories: string[] = [];
async function temporary() {
  const path = await mkdtemp(join(tmpdir(), "card-cli-test-"));
  directories.push(path);
  return path;
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});
describe("CLI文件输出、帮助及管道", () => {
  it("保存超长结果并生成完整Unicode分片", async () => {
    const directory = await temporary(),
      text = "甲😀\n".repeat(400000);
    const reference = await saveCommandResult("test", { text }, directory);
    expect(reference.bytes).toBeGreaterThan(1887456);
    const names = (await readdir(reference.partsDirectory!)).sort();
    const parts = await Promise.all(
      names.map((name) =>
        readFile(join(reference.partsDirectory!, name), "utf8"),
      ),
    );
    expect(parts.join("")).toBe(await readFile(reference.resultFile!, "utf8"));
    expect(
      parts.every(
        (part) => Buffer.byteLength(part) <= 16384 && !part.includes("�"),
      ),
    ).toBe(true);
    expect(JSON.stringify(reference).length).toBeLessThan(1000);
    expect(await saveTextParts("短文", await temporary())).toEqual({
      partCount: 0,
    });
  });
  it("每个命令具有渐进式帮助并且只输出文件引用", async () => {
    for (const name of Object.keys(commandDefinitions)) {
      const { stdout, stderr } = await execute(
        process.execPath,
        [
          ".agents/skills/native-card-conversion/scripts/convert.mjs",
          name,
          "--help",
        ],
        { cwd: resolve(".") },
      );
      expect(stderr).toBe("");
      expect(stdout.length).toBeLessThan(1200);
      const help = JSON.parse(
        await readFile(JSON.parse(stdout).resultFile, "utf8"),
      );
      expect(help.data.description).toBeTruthy();
      expect(help.data.example).toBeTruthy();
      expect(
        help.data.flags.every(
          (p: Record<string, unknown>) =>
            p.description &&
            p.type &&
            p.default &&
            typeof p.required === "boolean",
        ),
      ).toBe(true);
      expect(
        help.data.parameters.every(
          (p: Record<string, unknown>) =>
            p.type &&
            p.default &&
            p.description &&
            typeof p.required === "boolean",
        ),
      ).toBe(true);
    }
  }, 30000);
  it("参数错误诊断进入stderr文件引用，stdout为空且退出非零", async () => {
    try {
      await execute(process.execPath, [
        ".agents/skills/native-card-conversion/scripts/convert.mjs",
        "parse",
        "task.json",
        "/data/x",
        "data/a.json",
        "--format",
        "invalid",
      ]);
      throw new Error("unexpected success");
    } catch (error) {
      const failure = error as { code: number; stdout: string; stderr: string };
      expect(failure.code).toBe(1);
      expect(failure.stdout).toBe("");
      const saved = JSON.parse(
        await readFile(JSON.parse(failure.stderr).diagnosticFile, "utf8"),
      );
      expect(saved.passed).toBe(false);
      expect(saved.data.error).toContain("json、yaml");
      expect(saved.data.error).toContain("示例");
    }
  });
  it("管道按文件取得taskFile及archive，拒绝错误、空输入和冲突", async () => {
    const directory = await temporary(),
      file = join(directory, "result.json"),
      taskFile = join(directory, "task.json"),
      archive = join(directory, "a.zip");
    await writeFile(
      file,
      JSON.stringify({ passed: true, data: { taskFile, archive } }),
    );
    const pipe = JSON.stringify({ resultFile: file });
    expect(
      await parseInvocation(["formal", "-"], directory, pipe),
    ).toMatchObject({ taskFile, archive });
    await expect(
      parseInvocation(["formal", "-", "--archive", "b.zip"], directory, pipe),
    ).rejects.toThrow("冲突");
    await expect(
      parseInvocation(["validate", "-"], directory, ""),
    ).rejects.toThrow("stdin");
    await expect(
      parseInvocation(["validate", "-"], directory, "{"),
    ).rejects.toThrow("有效JSON");
    await writeFile(
      file,
      JSON.stringify({
        passed: true,
        data: { taskFile, archive: "relative.zip" },
      }),
    );
    await expect(
      parseInvocation(["formal", "-"], directory, pipe),
    ).rejects.toThrow("archive必须");
    await writeFile(
      file,
      JSON.stringify({ passed: false, data: { taskFile } }),
    );
    await expect(
      parseInvocation(["validate", "-"], directory, pipe),
    ).rejects.toThrow("失败");
  });
  it("仅把调用路径转为绝对路径，保留JSON Pointer和包内路径", async () => {
    expect(
      await parseInvocation(
        ["copy", "task.json", "/data/name", "character.json"],
        "/tmp",
      ),
    ).toMatchObject({
      args: ["/tmp/task.json", "/data/name", "character.json"],
    });
    await expect(
      parseInvocation([
        "parse",
        "t",
        "/p",
        "data/a.json",
        "--format",
        "yaml",
        "--start",
        "-1",
      ]),
    ).rejects.toThrow("非负整数");
  });
  it("documents replacement mode as an optional JSON-only boolean flag", async () => {
    const help = commandHelp("parse");
    if (!("flags" in help)) throw new Error("parse command help is missing flags");
    const apply = help.flags.find((flag) => flag.name === "--apply-replacements"),
      format = help.flags.find((flag) => flag.name === "--format");
    expect(apply).toMatchObject({
      type: "boolean",
      required: false,
      default: "false",
    });
    expect(apply?.description).toContain("按顺序覆盖");
    expect(format).toMatchObject({
      type: "string",
      required: true,
      values: ["json", "yaml"],
    });

    await expect(
      parseInvocation(
        [
          "parse",
          "task.json",
          "/replacements",
          "data/initial.json",
          "--format",
          "toml",
          "--apply-replacements",
        ],
        "/tmp",
      ),
    ).rejects.toThrow("json、yaml");
    await expect(
      parseInvocation(
        [
          "parse",
          "task.json",
          "/replacements",
          "data/initial.json",
          "--apply-replacements",
        ],
        "/tmp",
      ),
    ).rejects.toThrow("缺少必填参数--format");
    await expect(
      parseInvocation(
        [
          "parse",
          "task.json",
          "/replacements",
          "data/initial.json",
          "--format",
          "json",
          "--apply-replacements",
          "--apply-replacements",
        ],
        "/tmp",
      ),
    ).rejects.toThrow("重复");
  });
});

it("flags may precede positionals without changing runner inputs", async () => {
  expect(
    await parseInvocation(
      ["copy", "--start", "2", "task.json", "/data/name", "character.json"],
      "/tmp",
    ),
  ).toMatchObject({
    args: ["/tmp/task.json", "/data/name", "character.json", "--start", "2"],
  });
});
