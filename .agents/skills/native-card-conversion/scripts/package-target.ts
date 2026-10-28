import { lstat, mkdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { getNativeCardPackageFileRule } from "../../../../packages/shared/src/native-card-package.ts";
import { readTaskContext } from "./task-context.ts";
import { writeMessages } from "./write-config.ts";
import runtime from "./runtime.json" with { type: "json" };

export async function normalizeTarget(
  taskFile: string,
  path: string,
  schema?: string,
) {
  const task = await readTaskContext(taskFile);
  const root = await realpath(task.packageDirectory);
  if (path.split(/[\\/]/u).includes(".."))
    throw new Error(writeMessages.targetPath);
  const targetFile = isAbsolute(path) ? resolve(path) : resolve(root, path);
  const packageRelative = relative(root, targetFile);
  if (
    packageRelative === "" ||
    packageRelative === ".." ||
    packageRelative.startsWith(".." + sep) ||
    isAbsolute(packageRelative)
  )
    throw new Error(writeMessages.targetPath);
  const packagePath = packageRelative.split(sep).join("/");
  const rule = getNativeCardPackageFileRule(
    packagePath,
    runtime.packageVersion,
  );
  if (!rule || (schema && rule.schema !== schema))
    throw new Error(writeMessages.targetPath);
  return { root, targetFile, packageRelative, rule };
}

export async function prepareTarget(
  taskFile: string,
  path: string,
  schema?: string,
) {
  const normalized = await normalizeTarget(taskFile, path, schema);
  const { root, packageRelative } = normalized;
  let directory = root;
  for (const segment of dirname(packageRelative).split(sep)) {
    directory = join(directory, segment);
    try {
      await mkdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    if ((await lstat(directory)).isSymbolicLink())
      throw new Error(writeMessages.targetLink);
    const outside = relative(root, await realpath(directory));
    if (
      outside === ".." ||
      outside.startsWith(".." + sep) ||
      isAbsolute(outside)
    )
      throw new Error(writeMessages.targetLink);
  }
  return normalized;
}
