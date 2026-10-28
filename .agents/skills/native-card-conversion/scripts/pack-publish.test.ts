import { completeSourceFixture } from "./source-fixtures.ts";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readNativeCardZip,
  type NativeCardZipLimits,
} from "../../../../apps/api/src/services/native-card/zip.ts";
import nativeCardLimits from "../../../../apps/api/config/native-card.json" with { type: "json" };
import { indexPackage } from "./index.ts";
import { begin } from "./source.ts";
import { readTaskContext } from "./task-context.ts";
import { pack } from "./tool.ts";

const faults = vi.hoisted(() => ({
  stage: "",
  packageDirectory: "",
  packageReads: 0,
}));
vi.mock("node:fs/promises", async () => {
  const fs =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  function reject(stage: string): void {
    if (faults.stage === stage)
      throw Object.assign(new Error(`Injected ${stage} output failure`), {
        code: "EIO",
      });
  }
  return {
    ...fs,
    readFile: async (...args: Parameters<typeof fs.readFile>) => {
      const path = String(args[0]);
      if (
        faults.packageDirectory &&
        (path === faults.packageDirectory ||
          path.startsWith(faults.packageDirectory + "/"))
      )
        faults.packageReads++;
      return fs.readFile(...args);
    },
    writeFile: async (...args: Parameters<typeof fs.writeFile>) => {
      const path = String(args[0]);
      if (path.includes("/pack-") && basename(path) === "role.zip")
        reject("archive");
      if (
        path.includes("/pack-") &&
        basename(path) === "archive-validation.json"
      )
        reject("archiveValidation");
      if (path.includes("/pack-") && basename(path) === "result.json")
        reject("record");
      return fs.writeFile(...args);
    },
  };
});

const directories: string[] = [];
afterEach(async () => {
  faults.stage = "";
  faults.packageDirectory = "";
  faults.packageReads = 0;
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function preparedTask() {
  const directory = await mkdtemp(join(tmpdir(), "pack-publish-test-"));
  directories.push(directory);
  const source = join(directory, "source.json");
  await writeFile(
    source,
    JSON.stringify(
      completeSourceFixture({
        spec: "chara_card_v2",
        spec_version: "2.0",
        data: { name: "测试角色", first_mes: "开场" },
      }),
    ),
  );
  const begun = await begin(source);
  const task = await readTaskContext(begun.taskFile);
  directories.push(task.outputDirectory);
  await mkdir(task.packageDirectory, { recursive: true });
  await writeFile(
    join(task.packageDirectory, "openings.json"),
    JSON.stringify({ defaultOpeningIds: {}, items: [] }),
  );
  await indexPackage(begun.taskFile);
  return { task, taskFile: begun.taskFile };
}

async function countFiles(directory: string): Promise<number> {
  let count = 0;
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) count += await countFiles(path);
    else if (item.isFile()) count++;
  }
  return count;
}

describe("pack snapshot and independent archives", () => {
  it("validates and archives one package snapshot without publishing a fixed alias", async () => {
    const { task, taskFile } = await preparedTask();
    faults.packageDirectory = task.packageDirectory;
    const expectedReads = await countFiles(task.packageDirectory);

    const first = (await pack(taskFile)) as {
      passed: boolean;
      archive: string;
      validation: string;
      packageValidation: string;
      packRecord: string;
    };
    const firstBytes = await readFile(first.archive);
    const firstFiles = readNativeCardZip(
      firstBytes,
      nativeCardLimits as NativeCardZipLimits,
    );
    const archiveValidation = JSON.parse(
      await readFile(first.validation, "utf8"),
    ) as { archive: string; passed: boolean; files: number };
    const firstRecord = JSON.parse(
      await readFile(first.packRecord, "utf8"),
    ) as Record<string, unknown>;

    expect(faults.packageReads).toBe(expectedReads);
    expect(first.passed).toBe(true);
    expect(archiveValidation).toMatchObject({
      archive: first.archive,
      passed: true,
      files: firstFiles.length,
    });
    expect(firstRecord).toMatchObject({
      archive: first.archive,
      validation: first.validation,
      packageValidation: first.packageValidation,
    });
    expect(await readdir(task.outputDirectory)).not.toContain("role.zip");

    const characterPath = join(task.packageDirectory, "character.json");
    const character = JSON.parse(await readFile(characterPath, "utf8"));
    character.name = "修改后的测试角色";
    await writeFile(characterPath, JSON.stringify(character));
    faults.packageReads = 0;

    const second = (await pack(taskFile)) as {
      passed: boolean;
      archive: string;
    };
    const secondFiles = readNativeCardZip(
      await readFile(second.archive),
      nativeCardLimits as NativeCardZipLimits,
    );
    const readCharacter = (files: typeof firstFiles) =>
      JSON.parse(
        files
          .find((file) => file.path === "character.json")!
          .content.toString(),
      );

    expect(second.passed).toBe(true);
    expect(second.archive).not.toBe(first.archive);
    expect(readCharacter(firstFiles).name).toBe("测试角色");
    expect(readCharacter(secondFiles).name).toBe("修改后的测试角色");
    expect(await readdir(task.outputDirectory)).not.toContain("role.zip");
  });

  it.each(["archive", "archiveValidation", "record"])(
    "keeps each partial pack isolated when %s output fails",
    async (stage) => {
      const { task, taskFile } = await preparedTask();
      faults.stage = stage;

      await expect(pack(taskFile)).rejects.toMatchObject({ code: "EIO" });
      expect(await readdir(task.outputDirectory)).not.toContain("role.zip");

      faults.stage = "";
      const recovered = (await pack(taskFile)) as {
        passed: boolean;
        archive: string;
        validation: string;
        packRecord: string;
      };
      expect(recovered.passed).toBe(true);
      expect(await readFile(recovered.archive)).toBeTruthy();
      expect(await readFile(recovered.validation, "utf8")).toContain(
        recovered.archive,
      );
      expect(await readFile(recovered.packRecord, "utf8")).toContain(
        recovered.validation,
      );
      expect(await readdir(task.outputDirectory)).not.toContain("role.zip");
    },
  );
});
