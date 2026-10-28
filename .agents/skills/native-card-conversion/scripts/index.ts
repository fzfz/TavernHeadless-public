import { lstat, readFile, readdir } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import {
  getNativeCardPackageFileRule,
  nativeCardFileRules,
  nativeCardPackageManifestSchema,
  validateNativeCardPackage,
  type NativeCardPackageFileRecord,
} from "../../../../packages/shared/src/native-card-package.ts";
import runtime from "./runtime.json" with { type: "json" };
import { indexMessages, indexSchemas } from "./index-config.ts";
import { readTaskContext, TaskContextError } from "./task-context.ts";
import { writeJson } from "./write.ts";

/** 本函数读取包内普通文件，按路径排序，并拒绝符号链接。 */
export async function listFiles(
  directory: string,
  prefix = "",
): Promise<Array<{ path: string; content: Buffer }>> {
  const root = await lstat(directory);
  if (root.isSymbolicLink()) throw new Error(indexMessages.link);
  if (!root.isDirectory()) throw new Error(indexMessages.fileType);
  const files: Array<{ path: string; content: Buffer }> = [];
  for (const item of (await readdir(directory, { withFileTypes: true })).sort(
    (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  )) {
    const path = join(directory, item.name);
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new Error(indexMessages.link);
    const name = prefix + item.name;
    if (stat.isDirectory()) files.push(...(await listFiles(path, name + "/")));
    else if (stat.isFile())
      files.push({ path: name, content: await readFile(path) });
    else throw new Error(indexMessages.fileType);
  }
  return files;
}

/** 本函数按实际包文件生成根 manifest，并返回正式包诊断。 */
export async function indexPackage(taskFile: string, frontend?: string) {
  let task;
  try {
    task = await readTaskContext(taskFile);
  } catch (error) {
    if (error instanceof TaskContextError && error.kind === "task_fields")
      throw new Error(indexMessages.task, { cause: error });
    throw error;
  }
  if (
    !nativeCardPackageManifestSchema.shape.packageId.safeParse(task.id).success
  )
    throw new Error(indexMessages.task);
  const rules =
    nativeCardFileRules.versions[runtime.packageVersion]!.fixedFiles;
  const rootRule = rules.find((rule) => rule.inManifestFiles === false)!;
  if (
    frontend !== undefined &&
    getNativeCardPackageFileRule(frontend, runtime.packageVersion)?.schema !==
      indexSchemas.frontend
  )
    throw new Error(
      indexMessages.frontend.replace(
        "{path}",
        rules.find((rule) => rule.schema === indexSchemas.frontend)!
          .pathPattern,
      ),
    );
  const files = (await listFiles(task.packageDirectory)).filter(
    (file) => file.path !== rootRule.pathPattern,
  );
  const records: NativeCardPackageFileRecord[] = [];
  const issues: { path: string; message: string }[] = [];
  for (const file of files) {
    const rule = getNativeCardPackageFileRule(
      file.path,
      runtime.packageVersion,
    );
    if (!rule) {
      issues.push({ path: file.path, message: indexMessages.unknownPath });
      continue;
    }
    const mediaType =
      rule.schema === "binary"
        ? nativeCardFileRules.assetMediaFormats
            .flatMap((format) => format.extensions)
            .find(
              (format) => format.extension === extname(file.path).toLowerCase(),
            )?.mediaType
        : rule.mediaTypes[0];
    if (!mediaType) {
      issues.push({
        path: file.path,
        message: indexMessages.mediaType.replace(
          "{extensions}",
          nativeCardFileRules.assetMediaFormats
            .flatMap((format) =>
              format.extensions.map((item) => item.extension),
            )
            .join(", "),
        ),
      });
      continue;
    }
    records.push({ path: file.path, mediaType, purpose: rule.purpose });
  }
  const manifest = {
    format: nativeCardFileRules.format,
    formatVersion: runtime.packageVersion,
    packageId: task.id,
    character: rules.find((rule) => rule.schema === indexSchemas.character)!
      .pathPattern,
    openings: rules.find((rule) => rule.schema === indexSchemas.openings)!
      .pathPattern,
    ...(frontend === undefined ? {} : { frontend }),
    files: records,
  };
  const file = resolve(task.packageDirectory, rootRule.pathPattern);
  await writeJson(file, manifest, task.packageDirectory);
  const validation = validateNativeCardPackage([
    ...files,
    {
      path: rootRule.pathPattern,
      content: Buffer.from(JSON.stringify(manifest)),
    },
  ]);
  return {
    file,
    files: records.length,
    issues: [...issues, ...validation.issues],
    passed: issues.length === 0 && validation.issues.length === 0,
  };
}

/** 本函数执行 index，输出根 manifest 路径、文件数量及诊断。 */
export async function runIndex(args: string[]) {
  if (!(args.length === 1 || (args.length === 3 && args[1] === "--frontend")))
    throw new Error(indexMessages.arguments);
  return indexPackage(args[0]!, args[2]);
}
