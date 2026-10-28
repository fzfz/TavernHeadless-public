import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { begin } from "./source.ts";
import { v3Card } from "./source-fixtures.ts";
import { runStateCommand } from "./state-write.ts";
import { readTaskContext } from "./task-context.ts";
import { bindPageMacros } from "./page-macro-bindings.ts";
import {
  mapCopyFile,
  mapCopyFieldsFile,
  mapParseFile,
  mapParseFieldsFile,
  mapParseReplacementsFile,
} from "./write.ts";

const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function request(directory: string, name: string, value: unknown) {
  const file = join(directory, name + ".json");
  await writeFile(file, JSON.stringify(value));
  return file;
}

async function stateTask() {
  const directory = await mkdtemp(join(tmpdir(), "task-state-isolation-"));
  cleanup.push(directory);
  const source = await request(
    directory,
    "source",
    v3Card({
      first_mes: "开场",
      description: "const State = z.object({ count: z.number().int() });",
      extensions: {
        page: "<p>{{char}}</p>",
        valid: { count: 5 },
        text: '{"count":5}',
        scalar: "5",
        replacements: '[{"op":"replace","path":"/count","value":5}]',
      },
    }),
  );
  const begun = await begin(source);
  cleanup.push(dirname(begun.taskFile));
  await mkdir(join(begun.packageDirectory, "openings"), { recursive: true });
  await writeFile(join(begun.packageDirectory, "openings/default.txt"), "开场");
  await writeFile(
    join(begun.packageDirectory, "openings.json"),
    JSON.stringify({
      defaultOpeningIds: { individual: "default" },
      items: [
        {
          id: "default",
          title: "开场",
          summary: "",
          kind: "story",
          audience: "individual",
          textFile: "openings/default.txt",
        },
      ],
    }),
  );
  const sourceRequest = await request(directory, "inventory", {
    sourcePointer: "/data/description",
    symbol: "State",
  });
  const inventory = await runStateCommand("state-source", [
    begun.taskFile,
    sourceRequest,
  ]);
  if (!("taskFile" in inventory)) throw new Error("源字段提交未返回任务");
  const sourceTaskFile = inventory.taskFile as string;
  cleanup.push(dirname(sourceTaskFile));
  const initialRequest = await request(directory, "schema", {
    schema: {
      properties: { count: { type: "integer" } },
      required: ["count"],
      additionalProperties: false,
    },
    initialStates: [{ openingId: "default", value: { count: 1 } }],
    permissions: [{ field: "/count", write: true }],
    coverage: {
      sourcePointer: "/data/description",
      symbol: "State",
      mappings: [{ source: "/count", target: "/count" }],
      decisions: [],
    },
  });
  const result = await runStateCommand("state-schema", [
    sourceTaskFile,
    initialRequest,
  ]);
  if (!("taskFile" in result)) throw new Error("状态提交未返回任务");
  const taskFile = result.taskFile as string;
  cleanup.push(dirname(taskFile));
  return { directory, taskFile, task: await readTaskContext(taskFile) };
}

it.each([
  "copy",
  "copy-pointer",
  "copy-fields",
  "parse",
  "parse-pointer",
  "parse-fields",
  "parse-replacements",
])("%s状态目标返回完整任务及实际写入文件", async (command) => {
  const f = await stateTask();
  const path = "state/initial/default.json";
  const operations = {
    copy: () => mapCopyFile(f.taskFile, "/data/extensions/valid", path),
    "copy-pointer": () =>
      mapCopyFile(f.taskFile, "/data/extensions/valid/count", path, {
        targetPointer: "/count",
      }),
    "copy-fields": () =>
      mapCopyFieldsFile(f.taskFile, path, [
        {
          sourcePointer: "/data/extensions/valid/count",
          targetPointer: "/count",
        },
      ]),
    parse: () =>
      mapParseFile(f.taskFile, "/data/extensions/text", path, {
        format: "json",
      }),
    "parse-pointer": () =>
      mapParseFile(f.taskFile, "/data/extensions/scalar", path, {
        format: "json",
        targetPointer: "/count",
      }),
    "parse-fields": () =>
      mapParseFieldsFile(
        f.taskFile,
        path,
        [{ sourcePointer: "/data/extensions/scalar", targetPointer: "/count" }],
        "json",
      ),
    "parse-replacements": () =>
      mapParseReplacementsFile(
        f.taskFile,
        "/data/extensions/replacements",
        path,
        { format: "json" },
      ),
  };
  const result = await operations[command as keyof typeof operations]();
  expect(result).toHaveProperty("taskFile");
  const taskFile = (result as { taskFile: string }).taskFile;
  cleanup.push(dirname(taskFile));
  const child = await readTaskContext(taskFile);
  expect(result.file).toBe(join(child.packageDirectory, path));
  expect(JSON.parse(await readFile(result.file, "utf8"))).toEqual({ count: 5 });
  expect(
    JSON.parse(await readFile(join(f.task.packageDirectory, path), "utf8")),
  ).toEqual({ count: 1 });
  expect(
    JSON.parse(
      await readFile(
        join(child.packageDirectory, "agents/state-update/profile.json"),
        "utf8",
      ),
    ),
  ).toMatchObject({ writablePaths: ["/count"] });
});

it("页面宏绑定后的状态命令继续读取权限、源字段和覆盖记录", async () => {
  const f = await stateTask();
  const frontend = join(f.task.packageDirectory, "frontend");
  await mkdir(frontend, { recursive: true });
  await writeFile(join(frontend, "index.html"), "<p>{{char}}</p>");
  await writeFile(join(frontend, "style.css"), "p { color: red; }");
  await writeFile(
    join(frontend, "main.js"),
    "export function mount({ api }) { return; }",
  );
  await writeFile(
    join(frontend, "manifest.json"),
    JSON.stringify({
      apiVersion: 1,
      html: "frontend/index.html",
      css: "frontend/style.css",
      script: "frontend/main.js",
      assets: {},
      data: {},
    }),
  );
  const binding = await request(f.directory, "binding", {
    id: "character",
    source: { pointer: "/data/extensions/page", start: 3, end: 11 },
    htmlFile: "frontend/index.html",
    template: "{{char}}",
    conditions: { card: "package-card" },
  });
  const bound = await bindPageMacros(f.taskFile, binding);
  if (!bound.passed) throw new Error(JSON.stringify(bound.issues));
  if (!("taskFile" in bound)) throw new Error("绑定未返回任务");
  cleanup.push(dirname(bound.taskFile));
  const child = await readTaskContext(bound.taskFile);
  for (const name of [
    "state-permissions.json",
    "state-source.json",
    "state-coverage.json",
  ])
    expect(await readFile(join(child.outputDirectory, name))).toEqual(
      await readFile(join(f.task.outputDirectory, name)),
    );
  const paths = await runStateCommand("state-paths", [bound.taskFile]);
  expect(paths).toMatchObject({ writablePaths: ["/count"] });
  if (!("taskFile" in paths)) throw new Error("状态提交未返回任务");
  cleanup.push(dirname(paths.taskFile as string));
  const schemaChange = await request(f.directory, "schema-change", {
    schema: {
      properties: { renamed: { type: "integer" } },
      additionalProperties: false,
    },
    permissions: [],
  });
  await expect(
    runStateCommand("state-schema", [paths.taskFile as string, schemaChange]),
  ).rejects.toMatchObject({
    diagnostic: {
      requestFile: schemaChange,
      issues: expect.arrayContaining([
        expect.objectContaining({ keyword: "coverage" }),
      ]),
    },
  });
});

it("同一输入任务并发提交初值时返回两个完整任务并保留输入任务", async () => {
  const f = await stateTask();
  const original = await readFile(
    join(f.task.packageDirectory, "state/initial/default.json"),
  );
  const requests = await Promise.all(
    [2, 3].map((count) =>
      request(f.directory, "initial-" + count, { value: { count } }),
    ),
  );
  const results = await Promise.all(
    requests.map((file) =>
      runStateCommand("state-initial", [f.taskFile, "default", file]),
    ),
  );
  const tasks = await Promise.all(
    results.map(async (result) => {
      expect(result).toHaveProperty("taskFile");
      const taskFile = (result as { taskFile: string }).taskFile;
      cleanup.push(dirname(taskFile));
      return readTaskContext(taskFile);
    }),
  );
  expect(tasks[0]!.outputDirectory).not.toBe(tasks[1]!.outputDirectory);
  for (const [index, task] of tasks.entries()) {
    expect(
      JSON.parse(
        await readFile(
          join(task.packageDirectory, "state/initial/default.json"),
          "utf8",
        ),
      ),
    ).toEqual({ count: index + 2 });
    expect(
      JSON.parse(
        await readFile(
          join(task.packageDirectory, "agents/state-update/profile.json"),
          "utf8",
        ),
      ),
    ).toMatchObject({ writablePaths: ["/count"] });
  }
  expect(
    await readFile(join(f.task.packageDirectory, "state/initial/default.json")),
  ).toEqual(original);
});
