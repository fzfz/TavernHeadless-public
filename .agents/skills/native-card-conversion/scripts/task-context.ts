import { lstat, mkdir, readFile, realpath } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";

import runtime from "./runtime.json" with { type: "json" };
import { taskPaths } from "./source-config.ts";
import { formatToolMessage, toolMessages } from "./tool-config.ts";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
export const taskRepositoryRoot = resolve(scriptDirectory, "../../../..");

export type ConversionTask = {
  id: string;
  sourceFile: string;
  originalSourceFile: string;
  repositoryRoot: string;
  outputDirectory: string;
  packageDirectory: string;
};

export type TaskContextFailureKind =
  | "task_fields"
  | "task_source"
  | "task_boundary"
  | "package_directory"
  | "task_file";

export class TaskContextError extends Error {
  constructor(
    readonly kind: TaskContextFailureKind,
    readonly path: string,
  ) {
    const message =
      kind === "task_fields"
        ? toolMessages.taskFields
        : kind === "task_source"
          ? toolMessages.taskSource
          : kind === "package_directory"
            ? toolMessages.packageDirectory
            : toolMessages.taskBoundary;
    super(message);
    this.name = "TaskContextError";
  }
}

export type TaskContextOptions = {
  repositoryRoot?: string;
  outputDirectoryRoot?: string;
};

export type TaskOutputPathIssue =
  | "worktree_root_missing"
  | "worktree_root_symlink"
  | "worktree_root_type"
  | "worktree_root_unavailable"
  | "escape"
  | "realpath_mismatch"
  | "symlink"
  | "not_directory"
  | "missing";

export type TaskOutputPathFailure = (
  path: string,
  issue: TaskOutputPathIssue,
  worktreeRoot?: string,
  actualPath?: string,
) => never;

export function isPathContained(root: string, path: string): boolean {
  const child = relative(root, path);
  return (
    child !== "" &&
    child !== ".." &&
    !child.startsWith(".." + sep) &&
    !child.startsWith(sep)
  );
}

export function formatTaskOutputPathFailure(
  path: string,
  issue: TaskOutputPathIssue,
  worktreeRoot?: string,
  actualPath?: string,
) {
  let check = "output_path_boundary";
  const templates = toolMessages.outputPath;
  let messageTemplate: string;
  let actionTemplate: string;
  const values = {
    path,
    worktreeRoot: worktreeRoot ?? "",
    actualPath: actualPath ?? "",
  };
  if (issue.startsWith("worktree_root_")) {
    check = "output_worktree_root";
    messageTemplate =
      issue === "worktree_root_missing"
        ? templates.worktreeRootMissing
        : issue === "worktree_root_symlink"
          ? templates.worktreeRootSymlink
          : issue === "worktree_root_type"
            ? templates.worktreeRootType
            : templates.worktreeRootUnavailable;
    actionTemplate =
      issue === "worktree_root_unavailable"
        ? templates.worktreeRootUnavailableAction
        : templates.worktreeRootAction;
  } else if (issue === "escape") {
    check = "output_path_escape";
    messageTemplate = templates.escape;
    actionTemplate = templates.escapeAction;
  } else if (issue === "realpath_mismatch") {
    check = "output_path_realpath";
    messageTemplate = templates.realpathMismatch;
    actionTemplate = templates.realpathMismatchAction;
  } else if (issue === "symlink") {
    check = "output_path_symlink";
    messageTemplate = templates.symlink;
    actionTemplate = templates.symlinkAction;
  } else if (issue === "not_directory") {
    check = "output_path_type";
    messageTemplate = templates.notDirectory;
    actionTemplate = templates.notDirectoryAction;
  } else {
    check = "output_path_missing";
    messageTemplate = templates.missing;
    actionTemplate = templates.missingAction;
  }
  return {
    check,
    category: "configuration",
    message: formatToolMessage(messageTemplate, values),
    action: formatToolMessage(actionTemplate, values),
  } as const;
}

async function validateOutputDirectoryChain(
  worktreeRoot: string,
  targetDirectory: string,
  createMissing: boolean,
  fail: TaskOutputPathFailure,
): Promise<string> {
  const root = resolve(worktreeRoot);
  const target = resolve(targetDirectory);
  if (!isPathContained(root, target)) fail(target, "escape", root);

  const rootInfo = await lstatOptional(root);
  if (!rootInfo) fail(root, "worktree_root_missing");
  if (rootInfo.isSymbolicLink()) fail(root, "worktree_root_symlink");
  if (!rootInfo.isDirectory()) fail(root, "worktree_root_type");
  let rootRealPath: string;
  try {
    rootRealPath = await realpath(root);
  } catch {
    fail(root, "worktree_root_unavailable");
  }

  const segments = relative(root, target).split(sep).filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = join(current, segment);
    let info = await lstatOptional(current);
    if (!info && createMissing) {
      try {
        await mkdir(current);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      info = await lstatOptional(current);
    }
    if (!info) {
      if (createMissing) fail(current, "missing", root);
      break;
    }
    if (info.isSymbolicLink()) fail(current, "symlink", root);
    if (!info.isDirectory()) fail(current, "not_directory", root);
    const actualPath = await realpath(current);
    const expectedRealPath = resolve(rootRealPath, relative(root, current));
    if (
      actualPath !== expectedRealPath ||
      !isPathContained(rootRealPath, actualPath)
    )
      fail(current, "realpath_mismatch", root, actualPath);
  }

  if (createMissing) {
    const finalInfo = await lstatOptional(target);
    if (!finalInfo) fail(target, "missing", root);
    if (finalInfo.isSymbolicLink()) fail(target, "symlink", root);
    if (!finalInfo.isDirectory()) fail(target, "not_directory", root);
    const finalRealPath = await realpath(target);
    const expectedRealPath = resolve(rootRealPath, relative(root, target));
    if (
      finalRealPath !== expectedRealPath ||
      !isPathContained(rootRealPath, finalRealPath)
    )
      fail(target, "realpath_mismatch", root, finalRealPath);
  }
  return target;
}

export async function prepareTaskOutputDirectory(
  worktreeRoot: string,
  targetDirectory: string,
  createMissing: boolean,
  fail: TaskOutputPathFailure,
): Promise<string> {
  const root = resolve(worktreeRoot);
  const target = resolve(root, targetDirectory);
  await validateOutputDirectoryChain(root, target, false, fail);
  if (createMissing)
    return validateOutputDirectoryChain(root, target, true, fail);
  return target;
}

const requiredTaskFields = [
  "id",
  "sourceFile",
  "originalSourceFile",
  "repositoryRoot",
  "outputDirectory",
  "packageDirectory",
] as const;

export function parseTaskContext(value: unknown): ConversionTask {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    requiredTaskFields.some(
      (field) =>
        typeof (value as Record<string, unknown>)[field] !== "string" ||
        ((value as Record<string, unknown>)[field] as string).trim() === "",
    )
  )
    throw new TaskContextError("task_fields", "");

  const task = value as ConversionTask;
  if (
    !isAbsolute(task.sourceFile) ||
    !isAbsolute(task.originalSourceFile) ||
    task.sourceFile !== join(task.outputDirectory, taskPaths.source)
  )
    throw new TaskContextError("task_source", task.sourceFile);
  return task;
}

export function taskLocationMatches(
  task: Pick<
    ConversionTask,
    "id" | "repositoryRoot" | "outputDirectory" | "packageDirectory"
  >,
  taskFile: string,
  outputDirectoryRoot: string,
  repositoryRoot: string,
): boolean {
  return (
    task !== null &&
    typeof task === "object" &&
    !Array.isArray(task) &&
    task.repositoryRoot === repositoryRoot &&
    typeof task.id === "string" &&
    typeof task.outputDirectory === "string" &&
    typeof task.packageDirectory === "string" &&
    dirname(task.outputDirectory) === outputDirectoryRoot &&
    task.id.length > 0 &&
    basename(task.outputDirectory) === task.id &&
    resolve(taskFile) === join(task.outputDirectory, taskPaths.task) &&
    task.packageDirectory === join(task.outputDirectory, taskPaths.package)
  );
}

async function lstatOptional(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function readTaskValue(taskFile: string): Promise<unknown> {
  const taskPath = resolve(taskFile);
  const taskInfo = await lstat(taskPath);
  if (taskInfo.isSymbolicLink() || !taskInfo.isFile())
    throw new TaskContextError("task_file", taskPath);
  return JSON.parse(await readFile(taskPath, "utf8")) as unknown;
}

export async function validateTaskContext(
  taskFile: string,
  task: ConversionTask,
  options: TaskContextOptions = {},
): Promise<ConversionTask> {
  const repositoryRoot = resolve(options.repositoryRoot ?? taskRepositoryRoot);
  const outputDirectoryRoot = resolve(
    options.outputDirectoryRoot ??
      join(repositoryRoot, runtime.outputDirectory),
  );
  const taskPath = resolve(taskFile);
  if (!taskLocationMatches(task, taskPath, outputDirectoryRoot, repositoryRoot))
    throw new TaskContextError("task_boundary", taskPath);

  for (const [directory, kind] of [
    [task.outputDirectory, "task_boundary"],
    [task.packageDirectory, "task_boundary"],
  ] as const) {
    const stat = await lstatOptional(directory);
    if (
      !stat ||
      stat.isSymbolicLink() ||
      (await realpath(directory)) !== directory
    )
      throw new TaskContextError(kind, directory);
    if (!stat.isDirectory())
      throw new TaskContextError("package_directory", directory);
  }

  const taskInfo = await lstat(taskPath);
  if (
    taskInfo.isSymbolicLink() ||
    !taskInfo.isFile() ||
    (await realpath(taskPath)) !== taskPath
  )
    throw new TaskContextError("task_file", taskPath);

  const sourceInfo = await lstatOptional(task.sourceFile);
  if (
    !sourceInfo ||
    sourceInfo.isSymbolicLink() ||
    !sourceInfo.isFile() ||
    (await realpath(task.sourceFile)) !== task.sourceFile
  )
    throw new TaskContextError("task_source", task.sourceFile);
  return task;
}

export async function readTaskContext(
  taskFile: string,
  options: TaskContextOptions = {},
): Promise<ConversionTask> {
  const value = await readTaskValue(taskFile);
  const task = parseTaskContext(value);
  return validateTaskContext(taskFile, task, options);
}
