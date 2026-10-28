import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { begin } from "./source.ts";
import { v3Card } from "./source-fixtures.ts";
import { runStateCommand } from "./state-write.ts";
import { readTaskContext } from "./task-context.ts";
import { listFiles, runIndex } from "./index.ts";
import { validate, pack } from "./tool.ts";

const cleanup: string[] = [];
const failures = vi.hoisted(() => ({ enabled: false, failedDirectory: "" }));
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: async (source: string, target: string) => {
      if (
        failures.enabled &&
        target.endsWith("state/initial/default.json") &&
        JSON.parse(await actual.readFile(source, "utf8")).count === 3
      ) {
        failures.failedDirectory = target.split("/package/")[0]!;
        throw new Error("Injected initial-state replacement failure");
      }
      return actual.rename(source, target);
    },
  };
});
afterEach(async () => {
  failures.enabled = false;
  failures.failedDirectory = "";
  await Promise.all(
    cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "state-group-"));
  cleanup.push(directory);
  const source = join(directory, "source.json");
  await writeFile(source, JSON.stringify(v3Card()));
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
  const request = join(directory, "schema.json");
  await writeFile(
    request,
    JSON.stringify({
      schema: {
        properties: { count: { type: "integer" } },
        required: ["count"],
        additionalProperties: false,
      },
      initialStates: [{ openingId: "default", value: { count: 1 } }],
      permissions: [{ field: "/count", write: true }],
    }),
  );
  const result = await runStateCommand("state-schema", [
    begun.taskFile,
    request,
  ]);
  if (!("taskFile" in result)) throw new Error("状态提交未返回任务");
  const taskFile = result.taskFile as string;
  cleanup.push(dirname(taskFile));
  return { directory, taskFile, task: await readTaskContext(taskFile) };
}

it("一个并发状态写入失败时清理本次任务并保留输入任务及成功ZIP", async () => {
  const f = await fixture();
  const original = await listFiles(f.task.packageDirectory);
  const requests = await Promise.all(
    [2, 3].map(async (count) => {
      const file = join(f.directory, "initial-" + count + ".json");
      await writeFile(file, JSON.stringify({ value: { count } }));
      return file;
    }),
  );
  failures.enabled = true;
  const [success, failure] = await Promise.allSettled(
    requests.map((file) =>
      runStateCommand("state-initial", [f.taskFile, "default", file]),
    ),
  );
  expect(success!.status).toBe("fulfilled");
  expect(failure).toMatchObject({
    status: "rejected",
    reason: expect.objectContaining({
      message: "Injected initial-state replacement failure",
    }),
  });
  if (success!.status !== "fulfilled" || !("taskFile" in success!.value))
    throw new Error("状态提交未返回成功任务");
  const taskFile = success!.value.taskFile as string;
  cleanup.push(dirname(taskFile));
  const child = await readTaskContext(taskFile);
  expect(
    JSON.parse(
      await readFile(
        join(child.packageDirectory, "state/initial/default.json"),
        "utf8",
      ),
    ),
  ).toEqual({ count: 2 });
  expect(await listFiles(f.task.packageDirectory)).toEqual(original);
  expect(failures.failedDirectory).not.toBe("");
  await expect(readdir(failures.failedDirectory)).rejects.toMatchObject({
    code: "ENOENT",
  });
  await runIndex([taskFile]);
  expect(await validate(taskFile)).toMatchObject({ passed: true });
  expect(await pack(taskFile)).toMatchObject({ passed: true });
});
