import { completeSourceFixture } from "./source-fixtures.ts";
import { readTaskContext } from "./task-context.ts";
import {
  lstat,
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
import { dirname, join, relative, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { indexPackage } from "./index.ts";
import { begin as sourceBegin } from "./source.ts";
import { toolMessages } from "./tool-config.ts";
import {
  assertTaskLocation,
  formatOutputPathFailure,
  loadConfig,
  loadTask,
  pack,
  prepareOutputDirectory,
  repositoryRoot,
  resume,
  validate,
} from "./tool.ts";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture(source: unknown = { name: "原生角色" }) {
  const inputDirectory = await mkdtemp(join(tmpdir(), "native tool input "));
  cleanup.push(inputDirectory);
  const sourcePath = join(inputDirectory, "card.json");
  await writeFile(sourcePath, JSON.stringify(completeSourceFixture(source)));
  const result = await sourceBegin(sourcePath);
  const task = { ...(await readTaskContext(result.taskFile)), ...result };
  cleanup.push(task.outputDirectory);
  return { inputDirectory, sourcePath, task };
}

async function packageFile(
  task: { packageDirectory: string },
  path: string,
  value: unknown,
): Promise<string> {
  const file = join(task.packageDirectory, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(
    file,
    typeof value === "string" || Buffer.isBuffer(value)
      ? value
      : JSON.stringify(value, null, 2) + "\n",
  );
  return file;
}

async function indexedTask(source?: unknown) {
  const result = await fixture(source);
  await packageFile(result.task, "openings.json", {
    defaultOpeningIds: {},
    items: [],
  });
  await indexPackage(result.task.taskFile);
  return result;
}

async function outputRuntime(root: string, outputDirectory: string) {
  const config = JSON.parse(
    await readFile(
      join(
        repositoryRoot,
        ".agents/skills/native-card-conversion/scripts/runtime.json",
      ),
      "utf8",
    ),
  ) as {
    outputDirectory: string;
    examples: { preview: string; replayFixture: string; acceptance: string };
  };
  config.outputDirectory = outputDirectory;
  config.examples = {
    preview: "missing-preview.json",
    replayFixture: "missing-replay.json",
    acceptance: "missing-acceptance.json",
  };
  const path = join(root, "controlled-runtime.json");
  await writeFile(path, JSON.stringify(config));
  return path;
}

async function expectOutputPathRejected(
  root: string,
  outputDirectory: string,
  expected: { check: string; message: string; action: string },
) {
  const runtimePath = await outputRuntime(root, outputDirectory);
  const before = (await readdir(root)).sort();
  await expect(loadConfig(runtimePath, root)).rejects.toMatchObject({
    diagnostic: {
      check: expected.check,
      category: "configuration",
      message: expect.stringContaining(expected.message),
      action: expect.stringContaining(expected.action),
    },
  });
  expect((await readdir(root)).sort()).toEqual(before);
}

describe("simplified conversion tasks", () => {
  it("loads the six-field task produced by source.begin", async () => {
    const { sourcePath, task } = await fixture({
      name: "简化任务角色",
      description: "人物简介",
    });
    const savedTask = JSON.parse(
      await readFile(task.taskFile, "utf8"),
    ) as Record<string, unknown>;

    expect(Object.keys(savedTask).sort()).toEqual([
      "id",
      "originalSourceFile",
      "outputDirectory",
      "packageDirectory",
      "repositoryRoot",
      "sourceFile",
    ]);
    expect(await loadTask(task.taskFile)).toMatchObject({
      id: task.id,
      sourceFile: join(task.outputDirectory, "source.json"),
      originalSourceFile: sourcePath,
      repositoryRoot,
      outputDirectory: task.outputDirectory,
      packageDirectory: task.packageDirectory,
    });
  });

  it("reports missing required task input fields without an old schema gate", async () => {
    const { task } = await fixture();
    const saved = JSON.parse(await readFile(task.taskFile, "utf8")) as Record<
      string,
      unknown
    >;
    delete saved.sourceFile;
    await writeFile(task.taskFile, JSON.stringify(saved));

    await expect(loadTask(task.taskFile)).rejects.toMatchObject({
      diagnostic: { check: "task_fields", category: "input" },
    });
  });

  it("requires the source copy but does not compare it with the original input", async () => {
    const { sourcePath, task } = await fixture();
    await writeFile(
      task.sourceFile,
      JSON.stringify(completeSourceFixture({ name: "已改写的源副本" })),
    );
    await rm(sourcePath);

    await expect(loadTask(task.taskFile)).resolves.toMatchObject({
      originalSourceFile: sourcePath,
      sourceFile: task.sourceFile,
    });
    await rm(task.sourceFile);
    await expect(loadTask(task.taskFile)).rejects.toMatchObject({
      diagnostic: { check: "task_source", category: "input" },
    });
  });

  it("keeps task directories directly under the configured output root", async () => {
    const config = await loadConfig();
    const outputDirectory = join(repositoryRoot, config.outputDirectory);
    const location = (outputPath: string) => ({
      id: outputPath.split(sep).at(-1)!,
      repositoryRoot,
      outputDirectory: outputPath,
      packageDirectory: join(outputPath, "package"),
    });
    const current = join(outputDirectory, "run-current");
    expect(() =>
      assertTaskLocation(
        location(current),
        join(current, "task.json"),
        outputDirectory,
        repositoryRoot,
      ),
    ).not.toThrow();

    for (const outputPath of [
      join(current, "nested"),
      join(repositoryRoot, "outside-task"),
    ]) {
      expect(() =>
        assertTaskLocation(
          location(outputPath),
          join(outputPath, "task.json"),
          outputDirectory,
          repositoryRoot,
        ),
      ).toThrowError(toolMessages.taskBoundary);
    }
  });

  it("rejects a package path replaced by a regular file", async () => {
    const { task } = await fixture();
    await rm(task.packageDirectory, { recursive: true });
    await writeFile(task.packageDirectory, "not a directory");

    await expect(loadTask(task.taskFile)).rejects.toMatchObject({
      diagnostic: { check: "task_boundary", category: "configuration" },
    });
  });

  it("rejects a task file symlink before reading the linked file", async () => {
    const { inputDirectory, task } = await fixture();
    const taskCopy = join(inputDirectory, "copied-task.json");
    await writeFile(taskCopy, await readFile(task.taskFile));
    await rm(task.taskFile);
    await symlink(taskCopy, task.taskFile);

    await expect(loadTask(task.taskFile)).rejects.toMatchObject({
      diagnostic: {
        check: "task_boundary",
        category: "configuration",
        action: toolMessages.taskFileAction,
      },
    });
  });

  it("rejects changed package roots and source copies with the existing diagnostics", async () => {
    const packageTask = await fixture();
    const outsidePackage = await realpath(
      await mkdtemp(join(tmpdir(), "tool outside package ")),
    );
    cleanup.push(outsidePackage);
    const packageTaskValue = JSON.parse(
      await readFile(packageTask.task.taskFile, "utf8"),
    ) as Record<string, unknown>;
    packageTaskValue.packageDirectory = outsidePackage;
    await writeFile(
      packageTask.task.taskFile,
      JSON.stringify(packageTaskValue),
    );
    await expect(loadTask(packageTask.task.taskFile)).rejects.toMatchObject({
      diagnostic: { check: "task_boundary", category: "configuration" },
    });
    expect(await readdir(outsidePackage)).toEqual([]);

    const linkedPackageTask = await fixture();
    const linkedPackage = await realpath(
      await mkdtemp(join(tmpdir(), "tool linked package ")),
    );
    cleanup.push(linkedPackage);
    await rm(linkedPackageTask.task.packageDirectory, { recursive: true });
    await symlink(
      linkedPackage,
      linkedPackageTask.task.packageDirectory,
      "dir",
    );
    await expect(
      loadTask(linkedPackageTask.task.taskFile),
    ).rejects.toMatchObject({
      diagnostic: { check: "task_boundary", category: "configuration" },
    });
    expect(await readdir(linkedPackage)).toEqual([]);

    const replacedSourceTask = await fixture();
    const replacedSource = join(
      replacedSourceTask.inputDirectory,
      "replacement.json",
    );
    await writeFile(
      replacedSource,
      JSON.stringify(completeSourceFixture({ name: "外部源" })),
    );
    const sourceTaskValue = JSON.parse(
      await readFile(replacedSourceTask.task.taskFile, "utf8"),
    ) as Record<string, unknown>;
    sourceTaskValue.sourceFile = replacedSource;
    await writeFile(
      replacedSourceTask.task.taskFile,
      JSON.stringify(sourceTaskValue),
    );
    await expect(
      loadTask(replacedSourceTask.task.taskFile),
    ).rejects.toMatchObject({
      diagnostic: { check: "task_source", category: "input" },
    });

    const linkedSourceTask = await fixture();
    const linkedSource = join(
      linkedSourceTask.inputDirectory,
      "linked-source.json",
    );
    await writeFile(
      linkedSource,
      JSON.stringify(completeSourceFixture({ name: "外部链接源" })),
    );
    await rm(linkedSourceTask.task.sourceFile);
    await symlink(linkedSource, linkedSourceTask.task.sourceFile);
    await expect(
      loadTask(linkedSourceTask.task.taskFile),
    ).rejects.toMatchObject({
      diagnostic: { check: "task_source", category: "input" },
    });
  });

  it("resumes from the source copy and returns the package and existing artifacts", async () => {
    const { sourcePath, task } = await fixture();
    const retained = join(task.outputDirectory, "progress.txt");
    await writeFile(retained, "progress");
    await rm(sourcePath);

    const result = (await resume(task.taskFile)) as {
      taskFile: string;
      sourceFile: string;
      originalSourceFile: string;
      packageDirectory: string;
      outputDirectory: string;
      artifacts: string[];
    };

    expect(result).toMatchObject({
      taskFile: task.taskFile,
      sourceFile: task.sourceFile,
      originalSourceFile: sourcePath,
      packageDirectory: task.packageDirectory,
      outputDirectory: task.outputDirectory,
    });
    expect(result.artifacts).toEqual(
      expect.arrayContaining([
        "package",
        "progress.txt",
        "source.json",
        "task.json",
      ]),
    );
    expect(result.artifacts).not.toContain("source-original.json");
    expect(JSON.parse(await readFile(task.sourceFile, "utf8"))).toEqual(
      completeSourceFixture({
        name: "原生角色",
      }),
    );
  });
});

describe("formal package validation", () => {
  it("validates a native package and saves the actual diagnostics", async () => {
    const { task } = await indexedTask();

    const result = await validate(task.taskFile);
    const record = JSON.parse(await readFile(result.record, "utf8")) as {
      passed: boolean;
      issues: unknown[];
    };

    expect(result.passed).toBe(true);
    expect(result.issues).toEqual([]);
    expect(record).toEqual({ passed: true, issues: [] });
  });

  it("saves formal missing-reference diagnostics instead of field inventories", async () => {
    const { task } = await fixture();
    await packageFile(task, "openings.json", {
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
    });
    await indexPackage(task.taskFile);

    const result = await validate(task.taskFile);
    const record = JSON.parse(await readFile(result.record, "utf8")) as {
      passed: boolean;
      issues: Array<{ code?: string; path?: string }>;
    };

    expect(result.passed).toBe(false);
    expect(record.passed).toBe(false);
    expect(record.issues).toEqual(result.issues);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "NATIVE_CARD_OPENING_TEXT_MISSING",
          path: "openings/missing.txt",
        }),
      ]),
    );
  });

  it("builds state output schemas from the package state profile", async () => {
    const { task } = await fixture();
    await packageFile(task, "openings.json", {
      defaultOpeningIds: {},
      items: [],
    });
    const characterPath = join(task.packageDirectory, "character.json");
    const character = JSON.parse(await readFile(characterPath, "utf8")) as {
      stateUpdate?: string;
    };
    character.stateUpdate = "agents/state-update/profile.json";
    await writeFile(characterPath, JSON.stringify(character, null, 2) + "\n");
    await packageFile(task, "state/schema.json", {
      type: "object",
      properties: { mood: { type: "string" } },
    });
    const profile = {
      updaterPrompt: "Update mood from the saved messages.",
      writablePaths: ["/mood"],
      stateSchemaFile: "state/schema.json",
      ruleFiles: [],
    };
    const profilePath = await packageFile(
      task,
      "agents/state-update/profile.json",
      profile,
    );
    await indexPackage(task.taskFile);

    const valid = await validate(task.taskFile);
    expect(valid.passed).toBe(true);

    await writeFile(
      profilePath,
      JSON.stringify({ ...profile, writablePaths: ["/missing"] }, null, 2),
    );
    await indexPackage(task.taskFile);
    const invalid = await validate(task.taskFile);
    expect(invalid.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "NATIVE_CARD_STATE_OUTPUT_SCHEMA_PATH_INVALID",
          path: "agents/state-update/profile.json",
          pointer: "/writablePaths/0",
        }),
      ]),
    );
  });

  it("rejects an opening initial state that does not match the package state schema", async () => {
    const { task } = await fixture();
    await packageFile(task, "openings.json", {
      defaultOpeningIds: { individual: "start" },
      items: [
        {
          id: "start",
          title: "开始",
          summary: "",
          kind: "story",
          audience: "individual",
          textFile: "openings/start.txt",
          initialStateFile: "state/initial/start.json",
        },
      ],
    });
    await packageFile(task, "openings/start.txt", "开始正文");
    const characterPath = join(task.packageDirectory, "character.json");
    const character = JSON.parse(await readFile(characterPath, "utf8")) as {
      stateUpdate?: string;
    };
    character.stateUpdate = "agents/state-update/profile.json";
    await writeFile(characterPath, JSON.stringify(character, null, 2) + "\n");
    await packageFile(task, "state/schema.json", {
      type: "object",
      properties: { mood: { type: "string" } },
      required: ["mood"],
      additionalProperties: false,
    });
    await packageFile(task, "agents/state-update/profile.json", {
      updaterPrompt: "Update mood from saved messages.",
      writablePaths: ["/mood"],
      stateSchemaFile: "state/schema.json",
      ruleFiles: [],
    });
    await packageFile(task, "state/initial/start.json", { mood: 3 });
    await indexPackage(task.taskFile);

    const result = await validate(task.taskFile);

    expect(result.passed).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "NATIVE_CARD_INITIAL_STATE_INVALID",
          path: "state/initial/start.json",
          pointer: "/mood",
        }),
      ]),
    );
  });

  it("runs static backend module checks without executing module source", async () => {
    const { task } = await fixture();
    await packageFile(task, "openings.json", {
      defaultOpeningIds: {},
      items: [],
    });
    const characterPath = join(task.packageDirectory, "character.json");
    const character = JSON.parse(await readFile(characterPath, "utf8")) as {
      stateUpdate?: string;
    };
    character.stateUpdate = "agents/state-update/profile.json";
    await writeFile(characterPath, JSON.stringify(character, null, 2) + "\n");
    await packageFile(task, "state/schema.json", {
      type: "object",
      properties: { mood: { type: "string" } },
    });
    await packageFile(task, "agents/state-update/profile.json", {
      updaterPrompt: "",
      writablePaths: ["/mood"],
      stateSchemaFile: "state/schema.json",
      deriveScript: "backend/variable-tools/derive.js",
    });
    await packageFile(
      task,
      "backend/variable-tools/derive.js",
      "export function derive({ candidate }) { return process.exit(); }\n",
    );
    await indexPackage(task.taskFile);

    const result = await validate(task.taskFile);

    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "NATIVE_CARD_MODULE_INVALID",
          path: "backend/variable-tools/derive.js",
        }),
      ]),
    );
  });

  it("runs frontend module and HTML static checks for an enabled frontend", async () => {
    const { task } = await fixture();
    await packageFile(task, "openings.json", {
      defaultOpeningIds: {},
      items: [],
    });
    await packageFile(task, "frontend/manifest.json", {
      apiVersion: 1,
      html: "frontend/index.html",
      css: "frontend/style.css",
      script: "frontend/main.js",
      assets: {},
      data: {},
    });
    await packageFile(
      task,
      "frontend/index.html",
      '<main><img src="/missing.png"></main>\n',
    );
    await packageFile(task, "frontend/style.css", "main { color: red; }\n");
    await packageFile(
      task,
      "frontend/main.js",
      "export function mount({ api }) { return () => {}; }\n",
    );
    await indexPackage(task.taskFile, "frontend/manifest.json");

    const result = await validate(task.taskFile);
    const issueCodes = result.issues.map(
      (issue) => (issue as { code?: string }).code,
    );

    expect(issueCodes).toContain("NATIVE_CARD_FRONTEND_MARKUP_INVALID");
  });

  it("records package directory symlink errors as validation diagnostics", async () => {
    const { task } = await indexedTask();
    const external = join(task.outputDirectory, "outside.json");
    await writeFile(external, "{}");
    await symlink(external, join(task.packageDirectory, "data-link.json"));

    const result = await validate(task.taskFile);
    const record = JSON.parse(await readFile(result.record, "utf8")) as {
      issues: Array<{ check?: string; message?: string }>;
    };

    expect(result.passed).toBe(false);
    expect(record.issues).toEqual(result.issues);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ check: "package_files" }),
      ]),
    );
  });

  it("refuses to pack a package with formal validation issues", async () => {
    const { task } = await fixture();
    await packageFile(task, "openings.json", {
      defaultOpeningIds: {},
      items: [],
    });
    await indexPackage(task.taskFile);
    await packageFile(task, "unregistered/unsupported.txt", "unsupported");

    const result = (await pack(task.taskFile)) as {
      passed: boolean;
      issues: unknown[];
    };

    expect(result.passed).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    await expect(
      lstat(join(task.outputDirectory, "role.zip")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("creates an independent archive when a legacy ZIP directory exists", async () => {
    const { task } = await indexedTask();
    await mkdir(join(task.outputDirectory, "role.zip"));
    const result = (await pack(task.taskFile)) as {
      passed: boolean;
      archive: string;
    };
    expect(result.passed).toBe(true);
    expect(result.archive).not.toBe(join(task.outputDirectory, "role.zip"));
    expect((await lstat(result.archive)).isFile()).toBe(true);
  });
});

describe("worktree output path boundaries", () => {
  it("does not gate task commands on absent configured example files", async () => {
    const root = await mkdtemp(join(tmpdir(), "tool-config-examples-"));
    cleanup.push(root);
    const runtimePath = await outputRuntime(root, "output");

    await expect(loadConfig(runtimePath, root)).resolves.toMatchObject({
      outputDirectory: "output",
    });
  });

  it("rejects output directories outside the worktree before creating them", async () => {
    const root = await mkdtemp(join(tmpdir(), "tool-config-escape-"));
    cleanup.push(root);
    await expectOutputPathRejected(root, "../outside", {
      check: "output_path_escape",
      message: `输出路径 ${join(root, "../outside")} 不在目标工作区 ${root}`,
      action: "runtime.json 的 outputDirectory 设置为目标工作区内的目录",
    });
  });

  it("rejects symlinked output roots before writing to their targets", async () => {
    const root = await mkdtemp(join(tmpdir(), "tool-config-link-root-"));
    const outside = await mkdtemp(join(tmpdir(), "tool-config-link-outside-"));
    cleanup.push(root, outside);
    const marker = join(outside, "keep.txt");
    await writeFile(marker, "unchanged");
    await symlink(outside, join(root, "output"));

    await expectOutputPathRejected(root, "output", {
      check: "output_path_symlink",
      message: "是符号链接",
      action: "runtime.json 的 outputDirectory",
    });
    expect(await readFile(marker, "utf8")).toBe("unchanged");
  });

  it("creates missing output directories inside the worktree", async () => {
    const root = await mkdtemp(join(tmpdir(), "tool-config-create-"));
    cleanup.push(root);
    const runtimePath = await outputRuntime(root, "planning/maintenance");
    const config = await loadConfig(runtimePath, root);
    const outputPath = join(root, config.outputDirectory);

    await expect(lstat(outputPath)).rejects.toMatchObject({ code: "ENOENT" });
    const created = await prepareOutputDirectory(
      root,
      config.outputDirectory,
      true,
      runtimePath,
    );

    expect(created).toBe(outputPath);
    expect((await lstat(created)).isDirectory()).toBe(true);
    expect(await realpath(created)).toBe(
      join(await realpath(root), config.outputDirectory),
    );
  });

  it("keeps actionable real-path boundary diagnostics", () => {
    const path = "/worktree/.tmp/native-card-conversion/run-5";
    const actualPath = "/external/run-5";
    const diagnostic = formatOutputPathFailure(
      path,
      "realpath_mismatch",
      "/worktree",
      actualPath,
    );

    expect(diagnostic).toMatchObject({
      check: "output_path_realpath",
      message: expect.stringContaining(actualPath),
      action: expect.stringContaining(`${path} 及其祖先目录的真实路径`),
    });
  });
});
