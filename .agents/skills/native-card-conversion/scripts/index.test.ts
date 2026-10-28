import { completeSourceFixture } from "./source-fixtures.ts";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { pngCard } from "./source-config.ts";
import { begin } from "./source.ts";
import { readTaskContext } from "./task-context.ts";
import { indexPackage } from "./index.ts";
import { readCommandData, commandStderr } from "./cli-test-result.ts";

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

async function fixture(prefix = "index package ") {
  const directory = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  cleanup.push(directory);
  const sourceFile = join(directory, "card.json");
  await writeFile(
    sourceFile,
    JSON.stringify(completeSourceFixture({ name: "索引测试角色" })),
  );
  const begun = await begin(sourceFile);
  const task = {
    ...(await readTaskContext(begun.taskFile)),
    taskFile: begun.taskFile,
  };
  cleanup.push(task.outputDirectory);
  await writeFile(
    join(task.packageDirectory, "openings.json"),
    JSON.stringify({ defaultOpeningIds: {}, items: [] }, null, 2) + "\n",
  );
  return { directory, task };
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

async function packageFile(
  task: { packageDirectory: string },
  path: string,
  content: string | Buffer,
) {
  const file = join(task.packageDirectory, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
  return file;
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

describe("index command", () => {
  it("indexes the required files in a minimal package", async () => {
    const { directory, task } = await fixture();
    const result = await cli(["index", task.taskFile], directory);
    const manifestPath = join(task.packageDirectory, "manifest.json");

    expect(result).toEqual({
      file: manifestPath,
      files: 2,
      issues: [],
      passed: true,
      taskFile: task.taskFile,
    });
    expect(JSON.parse(await readFile(manifestPath, "utf8"))).toMatchObject({
      format: "tavern_headless_role_package",
      formatVersion: "1.0.0",
      packageId: task.id,
      character: "character.json",
      openings: "openings.json",
      files: [
        {
          path: "character.json",
          mediaType: "application/json",
          purpose: "data",
        },
        {
          path: "openings.json",
          mediaType: "application/json",
          purpose: "data",
        },
      ],
    });
  });

  it("sorts nested records, replaces an old manifest, and is repeatable", async () => {
    const { task } = await fixture();
    await packageFile(task, "data/zeta.json", '{"z":true}');
    await packageFile(task, "data/alpha.json", '{"a":true}');
    await packageFile(task, "assets/b.png", Buffer.from([1, 2, 3]));
    await packageFile(task, "assets/a.jpg", Buffer.from([4, 5, 6]));
    const manifestPath = join(task.packageDirectory, "manifest.json");
    await writeFile(manifestPath, '{"old":"manifest"}\n');

    const first = await indexPackage(task.taskFile);
    const firstBytes = await readFile(manifestPath);
    const firstManifest = JSON.parse(firstBytes.toString("utf8")) as {
      files: Array<Record<string, string>>;
    };
    const second = await indexPackage(task.taskFile);

    expect(first).toEqual({
      file: manifestPath,
      files: 6,
      issues: [],
      passed: true,
    });
    expect(second).toEqual(first);
    expect(await readFile(manifestPath)).toEqual(firstBytes);
    expect(firstManifest.files.map(({ path }) => path)).toEqual([
      "assets/a.jpg",
      "assets/b.png",
      "character.json",
      "data/alpha.json",
      "data/zeta.json",
      "openings.json",
    ]);
    expect(firstManifest.files).toContainEqual({
      path: "assets/a.jpg",
      mediaType: "image/jpeg",
      purpose: "media",
    });
    expect(firstManifest.files).toContainEqual({
      path: "assets/b.png",
      mediaType: "image/png",
      purpose: "media",
    });
    expect(
      firstManifest.files.some(({ path }) => path === "manifest.json"),
    ).toBe(false);
  });

  it("rejects a package root changed to an unrelated directory", async () => {
    const { directory, task } = await fixture();
    const unrelatedDirectory = await realpath(
      await mkdtemp(join(tmpdir(), "unrelated index package ")),
    );
    cleanup.push(unrelatedDirectory);
    const savedTask = JSON.parse(
      await readFile(task.taskFile, "utf8"),
    ) as Record<string, unknown>;
    savedTask.packageDirectory = unrelatedDirectory;
    await writeFile(task.taskFile, JSON.stringify(savedTask));

    await expect(indexPackage(task.taskFile)).rejects.toThrow();
    expect(await readdir(unrelatedDirectory)).toEqual([]);
    await expect(
      readFile(join(task.packageDirectory, "manifest.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readdir(directory)).toEqual(["card.json"]);
  });

  it("rejects a package root symlink before writing to its target", async () => {
    const { task } = await fixture();
    const outsidePackage = await realpath(
      await mkdtemp(join(tmpdir(), "linked index package ")),
    );
    cleanup.push(outsidePackage);
    await rm(task.packageDirectory, { recursive: true });
    await symlink(outsidePackage, task.packageDirectory, "dir");

    await expect(indexPackage(task.taskFile)).rejects.toThrow(
      "任务文件与工作区根目录",
    );
    expect(await readdir(outsidePackage)).toEqual([]);
  });

  it("adds a frontend entry only when explicitly enabled", async () => {
    const { task } = await fixture();
    await packageFile(
      task,
      "frontend/manifest.json",
      JSON.stringify({
        apiVersion: 1,
        html: "frontend/index.html",
        css: "frontend/style.css",
        script: "frontend/main.js",
        assets: {},
        data: {},
      }),
    );
    await packageFile(task, "frontend/index.html", "<main></main>\n");
    await packageFile(task, "frontend/style.css", "");
    await packageFile(
      task,
      "frontend/main.js",
      "export function mount({ api }) { return () => {}; }\n",
    );

    const disabled = await indexPackage(task.taskFile);
    const disabledManifest = JSON.parse(
      await readFile(disabled.file, "utf8"),
    ) as Record<string, unknown>;
    const enabled = await indexPackage(task.taskFile, "frontend/manifest.json");
    const enabledManifest = JSON.parse(
      await readFile(enabled.file, "utf8"),
    ) as Record<string, unknown>;

    expect(disabledManifest).not.toHaveProperty("frontend");
    expect(disabled.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "NATIVE_CARD_FILE_FEATURE_DISABLED",
          path: "frontend/manifest.json",
        }),
      ]),
    );
    expect(enabledManifest.frontend).toBe("frontend/manifest.json");
    expect(enabled.files).toBe(6);
    expect(enabled.issues).toEqual([]);
  });

  it("reports unknown package paths and unsupported asset extensions but writes the manifest", async () => {
    const { task } = await fixture();
    await packageFile(task, "unknown/notes.txt", "unrecognized");
    await packageFile(task, "assets/cover.unknown", Buffer.from([1, 2]));

    const result = await indexPackage(task.taskFile);
    const manifest = JSON.parse(await readFile(result.file, "utf8")) as {
      files: Array<{ path: string }>;
    };

    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "unknown/notes.txt" }),
        expect.objectContaining({ path: "assets/cover.unknown" }),
      ]),
    );
    expect(manifest.files.map(({ path }) => path)).not.toContain(
      "unknown/notes.txt",
    );
    expect(manifest.files.map(({ path }) => path)).not.toContain(
      "assets/cover.unknown",
    );
  });

  it("reports absent required package files and still writes the manifest", async () => {
    const { task } = await fixture();
    await rm(join(task.packageDirectory, "openings.json"));

    const result = await indexPackage(task.taskFile);

    expect(result.files).toBe(1);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "openings.json" }),
      ]),
    );
    expect(JSON.parse(await readFile(result.file, "utf8")).files).toEqual([
      {
        path: "character.json",
        mediaType: "application/json",
        purpose: "data",
      },
    ]);
  });

  it("reports missing opening references without suppressing manifest output", async () => {
    const { task } = await fixture();
    await packageFile(
      task,
      "openings.json",
      JSON.stringify({
        defaultOpeningIds: { individual: "start" },
        items: [
          {
            id: "start",
            title: "开始",
            summary: "",
            kind: "story",
            audience: "individual",
            textFile: "openings/missing.txt",
          },
        ],
      }),
    );

    const result = await indexPackage(task.taskFile);

    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "NATIVE_CARD_OPENING_TEXT_MISSING",
          path: "openings/missing.txt",
        }),
      ]),
    );
    expect(await readFile(result.file, "utf8")).toContain('"packageId"');
  });

  it("indexes a begin task when the caller working directory contains spaces", async () => {
    const { directory, task } = await fixture("index cli with spaces ");
    const result = await cli(
      ["index", relative(directory, task.taskFile)],
      directory,
    );

    expect(result).toEqual({
      file: join(task.packageDirectory, "manifest.json"),
      files: 2,
      issues: [],
      passed: true,
      taskFile: task.taskFile,
    });
  });

  it("rejects symlinks, malformed tasks, frontend paths and CLI arguments", async () => {
    const { directory, task } = await fixture();
    const link = join(task.packageDirectory, "data/linked.json");
    await mkdir(dirname(link), { recursive: true });
    await symlink(join(task.packageDirectory, "character.json"), link);
    await expect(indexPackage(task.taskFile)).rejects.toThrow();
    await rm(link);

    const invalidTaskFile = join(directory, "invalid task.json");
    await writeFile(
      invalidTaskFile,
      JSON.stringify({ id: "", packageDirectory: "relative" }),
    );
    await expect(indexPackage(invalidTaskFile)).rejects.toThrow();
    expect(
      await failedCli(["index", task.taskFile, "--unexpected"], directory),
    ).toHaveProperty("error");
    expect(
      await failedCli(
        ["index", task.taskFile, "--frontend", "frontend/index.html"],
        directory,
      ),
    ).toHaveProperty("error");
  });
});

describe("index after the complete source conversion flow", () => {
  it.each(["json", "png"] as const)(
    "indexes JSON and PNG inputs after begin, extract, map-entry, map-regex, copy and parse (%s)",
    async (extension) => {
      const directory = await realpath(
        await mkdtemp(join(tmpdir(), "index full flow with spaces ")),
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
      const inputName = `角色卡 input.${extension}`;
      const inputBytes =
        extension === "png"
          ? png(pngText("ccv3", Buffer.from(sourceJson).toString("base64")))
          : Buffer.from(sourceJson);
      await writeFile(join(directory, inputName), inputBytes);

      const begun = await cli(["begin", inputName], directory);
      const task = {
        ...(await readTaskContext(String(begun.taskFile))),
        taskFile: String(begun.taskFile),
      };
      cleanup.push(task.outputDirectory);
      const taskFile = task.taskFile;

      const extractedEntry = (await cli(
        ["extract", taskFile, "/character_book/entries/0"],
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
          taskFile,
          "/character_book/entries/0",
          entryPath,
          "--copy-content",
        ],
        directory,
      );
      expect(mappedEntry.file).toBe(join(task.packageDirectory, entryPath));

      const regexPath = "regex/source.json";
      const mappedRegex = await cli(
        [
          "map-regex",
          taskFile,
          "/extensions/regex_scripts",
          regexPath,
          "--indices",
          "0",
        ],
        directory,
      );
      expect(mappedRegex.file).toBe(join(task.packageDirectory, regexPath));

      const copiedPath = "openings/verbatim.txt";
      const copied = await cli(
        ["copy", taskFile, "/verbatim", copiedPath],
        directory,
      );
      expect(await readFile(String(copied.file), "utf8")).toBe(source.verbatim);

      const parsedPath = "data/initial.json";
      const parsed = await cli(
        ["parse", taskFile, "/initialYaml", parsedPath, "--format", "yaml"],
        directory,
      );
      expect(JSON.parse(await readFile(String(parsed.file), "utf8"))).toEqual({
        day: 3,
        location: "港口",
      });
      await packageFile(
        task,
        "openings.json",
        JSON.stringify({ defaultOpeningIds: {}, items: [] }),
      );

      const indexed = await cli(["index", taskFile], directory);

      expect(indexed.files).toBeGreaterThanOrEqual(7);
      expect(indexed.issues).toEqual([]);
      const manifest = JSON.parse(
        await readFile(String(indexed.file), "utf8"),
      ) as {
        files: Array<{ path: string }>;
      };
      expect(manifest.files.map(({ path }) => path)).toContain(
        "worldbooks/book-0/entries/e0.json",
      );
      expect(manifest.files.map(({ path }) => path)).not.toContain(
        "manifest.json",
      );
    },
    20000,
  );
});
