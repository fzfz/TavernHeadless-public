import { constants } from "node:fs";
import { lstat, mkdir, mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { listFiles } from "./index.ts";
import { taskPaths } from "./source-config.ts";
import { readTaskContext, type ConversionTask } from "./task-context.ts";
import stateConfig from "./state-write-config.json" with { type: "json" };

export type DerivedTask = { taskFile: string; task: ConversionTask };

async function readTaskInput(file: string) {
  if (!(await lstat(file)).isFile()) throw new Error(stateConfig.messages.link);
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

export async function withDerivedTask<T>(
  taskFile: string,
  operation: (derived: DerivedTask) => Promise<T>,
): Promise<T & { taskFile: string; packageDirectory: string }> {
  const parent = await readTaskContext(taskFile);
  const packageFiles = await listFiles(parent.packageDirectory);
  const source = await readTaskInput(parent.sourceFile);
  const records = new Map<string, Buffer>();
  for (const name of Object.values(stateConfig.files)) {
    try {
      records.set(
        name,
        await readTaskInput(join(parent.outputDirectory, name)),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const outputDirectory = await mkdtemp(
    join(dirname(parent.outputDirectory), taskPaths.prefix),
  );
  const task: ConversionTask = {
    ...parent,
    id: basename(outputDirectory),
    outputDirectory,
    packageDirectory: join(outputDirectory, taskPaths.package),
    sourceFile: join(outputDirectory, taskPaths.source),
  };
  const derivedTaskFile = join(outputDirectory, taskPaths.task);
  try {
    await mkdir(task.packageDirectory);
    await writeFile(task.sourceFile, source);
    for (const { path, content } of packageFiles) {
      const file = join(task.packageDirectory, path);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, content);
    }
    for (const [name, contents] of records)
      await writeFile(join(outputDirectory, name), contents);
    await writeFile(derivedTaskFile, JSON.stringify(task, null, 2) + "\n");
    await readTaskContext(derivedTaskFile);
    const result = await operation({ taskFile: derivedTaskFile, task });
    return {
      ...result,
      taskFile: derivedTaskFile,
      packageDirectory: task.packageDirectory,
    };
  } catch (error) {
    await rm(outputDirectory, { recursive: true, force: true });
    throw error;
  }
}
