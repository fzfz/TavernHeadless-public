import { completeSourceFixture } from "./source-fixtures.ts";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readTaskContext } from "./task-context.ts";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { repositoryRoot } from "./tool.ts";

const run = promisify(execFile);
const entry = join(
  repositoryRoot,
  ".agents/skills/native-card-conversion/scripts/convert.mjs",
);
const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function pngChunk(type: string, data = Buffer.alloc(0)) {
  const bytes = Buffer.alloc(data.length + 12);
  bytes.writeUInt32BE(data.length);
  bytes.write(type, 4, "ascii");
  data.copy(bytes, 8);
  return bytes;
}

function cardPng(card: unknown) {
  const metadata = Buffer.from(
    "ccv3\0" +
      Buffer.from(JSON.stringify(completeSourceFixture(card))).toString(
        "base64",
      ),
    "latin1",
  );
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", Buffer.alloc(13)),
    pngChunk("tEXt", metadata),
    pngChunk("IEND"),
  ]);
}

async function invoke(args: string[], cwd: string) {
  const { stdout } = await run(process.execPath, [entry, ...args], {
    cwd,
    maxBuffer: 1024 * 1024,
  });
  const reference = JSON.parse(stdout);
  return JSON.parse(await readFile(reference.resultFile, "utf8"))
    .data as Record<string, any>;
}

describe("native card conversion CLI entry", () => {
  it.each([
    ["JSON", "json"],
    ["PNG", "png"],
  ] as const)(
    "begins from %s and continues through index, validate, pack ",
    async (_label, extension) => {
      const directory = await mkdtemp(
        join(repositoryRoot, ".planning/native-card-maintenance/entry test "),
      );
      cleanup.push(directory);
      const sourceFile = join(directory, `角色 card.${extension}`);
      const card = {
        spec: "chara_card_v2",
        spec_version: "2.0",
        data: { name: `${_label} 入口测试`, first_mes: "开场" },
      };
      const sourceBytes =
        extension === "png"
          ? cardPng(card)
          : Buffer.from(JSON.stringify(completeSourceFixture(card)));
      await writeFile(sourceFile, sourceBytes);

      const result = await invoke(["begin", sourceFile], directory);
      const task = {
        ...(await readTaskContext(result.taskFile)),
        ...result,
        taskFile: String(result.taskFile),
      };
      cleanup.push(task.outputDirectory);
      expect(task.repositoryRoot).toBe(repositoryRoot);
      expect(task.originalSourceFile).toBe(sourceFile);
      expect(task.sourceFile).toBe(join(task.outputDirectory, "source.json"));
      expect(task.packageDirectory).toBe(join(task.outputDirectory, "package"));
      expect(JSON.parse(await readFile(task.sourceFile, "utf8"))).toEqual(
        completeSourceFixture(card),
      );

      await writeFile(
        join(task.packageDirectory, "openings.json"),
        JSON.stringify({ defaultOpeningIds: {}, items: [] }),
      );
      const indexed = await invoke(["index", task.taskFile], directory);
      expect(indexed.issues).toEqual([]);

      const validated = await invoke(["validate", task.taskFile], directory);
      expect(validated.passed).toBe(true);
      expect(validated.issues).toEqual([]);
      expect(JSON.parse(await readFile(validated.record, "utf8"))).toEqual({
        passed: true,
        issues: [],
      });

      const packed = await invoke(["pack", task.taskFile], directory);
      expect(packed.archive).toContain(task.outputDirectory + "/");
      expect((await readFile(packed.archive)).subarray(0, 4).toString()).toBe(
        "PK\u0003\u0004",
      );
    },
    30_000,
  );

  it.each([
    ["unknown", "unused"],
    ["inspect", "unused"],
  ])(
    "preserves a failing CLI status and actionable diagnostics for %j",
    async (...args) => {
      await expect(
        run(process.execPath, [entry, ...args], { maxBuffer: 1024 * 1024 }),
      ).rejects.toMatchObject({
        code: 1,
        stdout: "",
        stderr: expect.stringContaining("diagnosticFile"),
      });
    },
  );

  it.each([
    ["SIGINT", false],
    ["SIGTERM", false],
    ["SIGINT", true],
    ["SIGTERM", true],
  ] as const)(
    "lets the CLI finish asynchronous cleanup after %s (process group: %s)",
    async (signal, group) => {
      const directory = await mkdtemp(
        join(repositoryRoot, ".planning/native-card-maintenance/entry signal "),
      );
      cleanup.push(directory);
      const skillScripts = join(
        directory,
        ".agents/skills/native-card-conversion/scripts",
      );
      await mkdir(skillScripts, { recursive: true });
      const fixtureEntry = join(skillScripts, "convert.mjs");
      await writeFile(fixtureEntry, await readFile(entry));
      await writeFile(join(directory, "tsconfig.json"), "{}");
      await writeFile(
        join(skillScripts, "cli.ts"),
        `export async function runCli() {
const waiting = setInterval(() => {}, 1000);
const stop = () => {
  process.off('SIGINT', stop);
  process.off('SIGTERM', stop);
  clearInterval(waiting);
  setTimeout(() => process.stdout.write('STOPPED\\n'), 100);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.stdout.write('READY\\n');
}
`,
      );
      const child = spawn(process.execPath, [fixtureEntry], {
        detached: group,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const closed = once(child, "close");
      let output = "";
      const ready = new Promise<void>((resolve) => {
        child.stdout.on("data", (chunk) => {
          output += String(chunk);
          if (output.includes("READY\n")) resolve();
        });
      });
      try {
        await ready;
        if (group) process.kill(-child.pid!, signal);
        else child.kill(signal);
        expect(await closed).toEqual([0, null]);
        expect(output).toContain("STOPPED\n");
      } finally {
        if (child.exitCode === null && child.signalCode === null)
          child.kill("SIGKILL");
      }
    },
  );

  it("reports an inaccessible source through the same direct entry", async () => {
    await expect(
      run(process.execPath, [
        entry,
        "begin",
        join(repositoryRoot, "missing-card.json"),
      ]),
    ).rejects.toMatchObject({
      code: 1,
      stdout: "",
      stderr: expect.stringContaining("diagnosticFile"),
    });
  });
});
