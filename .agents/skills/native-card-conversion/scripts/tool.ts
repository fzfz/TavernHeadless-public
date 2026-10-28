import {
  readFile,
  writeFile,
  mkdir,
  mkdtemp,
  lstat,
  realpath,
  readdir,
} from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv/dist/2020.js";
import {
  readNativeCardZip,
  type NativeCardZipLimits,
  writeNativeCardZip,
} from "../../../../apps/api/src/services/native-card/zip.ts";
import nativeCardLimits from "../../../../apps/api/config/native-card.json" with { type: "json" };
import {
  validateNativeCardPackage,
  nativeCardFileRules,
} from "../../../../packages/shared/src/native-card-package.ts";
import { listFiles } from "./index.ts";
import { formatToolMessage, toolMessages } from "./tool-config.ts";
import {
  parseTaskContext,
  formatTaskOutputPathFailure,
  isPathContained,
  prepareTaskOutputDirectory,
  readTaskValue,
  taskLocationMatches,
  taskRepositoryRoot,
  TaskContextError,
  validateTaskContext,
  type ConversionTask,
  type TaskOutputPathIssue,
} from "./task-context.ts";
import { buildRestrictedOutputSchema } from "../../../../apps/api/src/services/role-runtime/state-contract.ts";
import { validateNativeCardModules } from "../../../../apps/api/src/services/native-card/module-static-checker.ts";
import { validateNativeCardFrontendModules } from "../../../../apps/api/src/services/native-card/frontend-module-static-checker.ts";
import { validateNativeCardFrontendMarkup } from "../../../../apps/api/src/services/native-card/frontend-markup-checker.ts";
import { validateNativeCardStatePackage } from "../../../../apps/api/src/services/native-card/state-package-validator.ts";

export { begin } from "./source.ts";
export { listFiles } from "./index.ts";

export const repositoryRoot = taskRepositoryRoot;
const schemaDirectory = dirname(fileURLToPath(import.meta.url));
export type Task = ConversionTask;
type Config = {
  outputDirectory: string;
  zipFile: string;
  stateOutputDiagnostics: {
    pathInvalid: {
      code: string;
      messageTemplate: string;
      actionTemplate: string;
    };
    buildFailed: {
      code: string;
      messageTemplate: string;
      actionTemplate: string;
    };
  };
};

export class ToolFailure extends Error {
  constructor(
    readonly diagnostic: {
      file: string;
      pointer: string;
      check: string;
      category: string;
      message: string;
      action: string;
    },
  ) {
    super(diagnostic.message);
  }
}
type Diagnostic = {
  file: string;
  pointer: string;
  check: string;
  category: string;
  message: string;
  action: string;
};
function fail(
  file: string,
  check: string,
  message: string,
  category = "validation",
  action: string = toolMessages.defaultAction,
): never {
  throw new ToolFailure({
    file,
    pointer: "",
    check,
    category,
    message,
    action,
  });
}
export async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    fail(path, "read_json", String(error), "input");
  }
}
export async function checkSchema(
  value: unknown,
  name: string,
  file = name,
  definition?: string,
): Promise<void> {
  const document = await readJson(join(schemaDirectory, name));
  let schema = document;
  if (definition) {
    const schemaDocument = document as {
      $schema?: string;
      $defs?: Record<string, unknown>;
    };
    if (!schemaDocument.$defs?.[definition])
      fail(
        name,
        "schema_definition",
        `Schema ${name} does not define ${definition}.`,
        "configuration",
      );
    schema = {
      $schema: schemaDocument.$schema,
      $defs: schemaDocument.$defs,
      $ref: `#/$defs/${definition}`,
    };
  }
  const validate = new Ajv({ strict: false, allErrors: true }).compile(
    schema as object,
  );
  if (!validate(value)) {
    const firstError = validate.errors?.[0];
    throw new ToolFailure({
      file,
      pointer: firstError?.instancePath ?? "",
      check: "json_schema",
      category: "validation",
      message: JSON.stringify(validate.errors),
      action:
        file === name
          ? toolMessages.defaultAction
          : formatToolMessage(toolMessages.schemaAction, {
              schema: name,
              file,
            }),
    });
  }
}
export async function saveJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
}
export async function saveRecord(
  directory: string,
  label: string,
  value: unknown,
): Promise<string> {
  const callDirectory = await mkdtemp(join(directory, label + "-"));
  const path = join(callDirectory, "result.json");
  await saveJson(path, value);
  return path;
}
async function lstatOptional(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
type OutputPathIssue = TaskOutputPathIssue;
export function formatOutputPathFailure(
  path: string,
  issue: OutputPathIssue,
  worktreeRoot?: string,
  actualPath?: string,
): Pick<Diagnostic, "check" | "category" | "message" | "action"> {
  return formatTaskOutputPathFailure(path, issue, worktreeRoot, actualPath);
}
function outputPathFailure(
  file: string,
  path: string,
  issue: OutputPathIssue,
  worktreeRoot?: string,
  actualPath?: string,
): never {
  throw new ToolFailure({
    file,
    pointer: "",
    ...formatOutputPathFailure(path, issue, worktreeRoot, actualPath),
  });
}
export async function prepareOutputDirectory(
  worktreeRoot: string,
  configuredOutputDirectory: string,
  createMissing = false,
  file = join(schemaDirectory, "runtime.json"),
): Promise<string> {
  const root = resolve(worktreeRoot);
  const outputRoot = resolve(root, configuredOutputDirectory);
  return prepareTaskOutputDirectory(
    root,
    outputRoot,
    createMissing,
    (path, issue, outputRoot, actualPath) =>
      outputPathFailure(file, path, issue, outputRoot, actualPath),
  );
}
export async function loadConfig(
  path = join(schemaDirectory, "runtime.json"),
  worktreeRoot = repositoryRoot,
): Promise<Config> {
  const config = (await readJson(path)) as Config;
  await checkSchema(config, "runtime.schema.json");
  await prepareOutputDirectory(
    worktreeRoot,
    config.outputDirectory,
    false,
    path,
  );
  return config;
}
type TaskLocation = Pick<
  Task,
  "id" | "repositoryRoot" | "outputDirectory" | "packageDirectory"
>;
export function assertTaskLocation(
  task: TaskLocation,
  path: string,
  outputDirectory: string,
  worktreeRoot: string,
): void {
  if (!taskLocationMatches(task, path, outputDirectory, worktreeRoot))
    fail(
      path,
      "task_boundary",
      toolMessages.taskBoundary,
      "configuration",
      toolMessages.taskLocationAction,
    );
}

function failTaskContext(path: string, error: TaskContextError): never {
  if (error.kind === "task_fields")
    fail(path, "task_fields", toolMessages.taskFields, "input");
  if (error.kind === "task_source")
    fail(error.path || path, "task_source", toolMessages.taskSource, "input");
  if (error.kind === "package_directory")
    fail(path, "task_boundary", toolMessages.packageDirectory, "configuration");
  if (error.kind === "task_file")
    fail(
      path,
      "task_boundary",
      toolMessages.taskBoundary,
      "configuration",
      toolMessages.taskFileAction,
    );
  fail(
    path,
    "task_boundary",
    toolMessages.taskBoundary,
    "configuration",
    toolMessages.taskLocationAction,
  );
}

export async function loadTask(path: string): Promise<Task> {
  let task: Task;
  try {
    task = parseTaskContext(await readTaskValue(path));
  } catch (error) {
    if (error instanceof TaskContextError) failTaskContext(path, error);
    fail(path, "read_json", String(error), "input");
  }
  const config = await loadConfig();
  const outputDirectory = await prepareOutputDirectory(
    repositoryRoot,
    config.outputDirectory,
    false,
    path,
  );
  try {
    return await validateTaskContext(path, task, {
      repositoryRoot,
      outputDirectoryRoot: outputDirectory,
    });
  } catch (error) {
    if (error instanceof TaskContextError) failTaskContext(path, error);
    throw error;
  }
}
export async function validate(
  path: string,
): Promise<{ passed: boolean; record: string; issues: unknown[] }> {
  const task = await loadTask(path);
  const config = await loadConfig();
  let issues: unknown[];
  try {
    const files = await listFiles(task.packageDirectory);
    issues = validatePackageFiles(files, config.stateOutputDiagnostics);
  } catch (error) {
    issues = [
      {
        file: task.packageDirectory,
        pointer: "",
        check: "package_files",
        category: "validation",
        message: error instanceof Error ? error.message : String(error),
        action: toolMessages.packageFiles,
      },
    ];
  }
  const record = await saveRecord(task.outputDirectory, "validation", {
    passed: issues.length === 0,
    issues,
  });
  return { passed: issues.length === 0, record, issues };
}

function validatePackageFiles(
  files: Array<{ path: string; content: Uint8Array }>,
  diagnostics: Config["stateOutputDiagnostics"],
): unknown[] {
  const result = validateNativeCardPackage(files);
  const issues: unknown[] = [...result.issues];
  if (result.package) {
    const nativePackage = result.package;
    const profile = nativePackage.stateUpdateProfile;
    if (profile) {
      const profilePath = nativePackage.character.stateUpdate!;
      const schemaPath = profile.stateSchemaFile!;
      // The package validator has already checked the fixed schema file and its
      // object root, matching the root shape required by state-update hydrate.
      const stateSchema = nativePackage.parsedJson.get(schemaPath) as Record<
        string,
        unknown
      >;
      try {
        buildRestrictedOutputSchema({ ...profile, stateSchema });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        let pathIndex = -1;
        for (const [index, writablePath] of profile.writablePaths.entries()) {
          try {
            buildRestrictedOutputSchema({
              ...profile,
              writablePaths: [writablePath],
              stateSchema,
            });
          } catch {
            pathIndex = index;
            break;
          }
        }
        const missingPath = profile.writablePaths[pathIndex];
        if (missingPath !== undefined) {
          const diagnostic = diagnostics.pathInvalid;
          issues.push({
            code: diagnostic.code,
            path: profilePath,
            pointer:
              pathIndex >= 0 ? `/writablePaths/${pathIndex}` : "/writablePaths",
            message: diagnostic.messageTemplate.replaceAll(
              "{path}",
              missingPath,
            ),
            action: diagnostic.actionTemplate
              .replaceAll("{path}", missingPath)
              .replaceAll("{profilePath}", profilePath),
          });
        } else {
          const diagnostic = diagnostics.buildFailed;
          issues.push({
            code: diagnostic.code,
            path: profilePath,
            pointer: "/writablePaths",
            message: diagnostic.messageTemplate
              .replaceAll("{profilePath}", profilePath)
              .replaceAll("{schemaPath}", schemaPath)
              .replaceAll("{detail}", detail),
            action: diagnostic.actionTemplate
              .replaceAll("{profilePath}", profilePath)
              .replaceAll("{schemaPath}", schemaPath),
          });
        }
      }
    }
    issues.push(...validateNativeCardStatePackage(nativePackage));
    issues.push(
      ...validateNativeCardModules(files, nativeCardFileRules.backendModuleApi),
      ...validateNativeCardFrontendModules(
        files,
        result.package.frontendManifest?.script,
        nativeCardFileRules.frontendModuleApi,
      ),
      ...validateNativeCardFrontendMarkup(files),
    );
  }
  return issues;
}

export async function pack(path: string): Promise<unknown> {
  const task = await loadTask(path);
  const config = await loadConfig();
  let files: Awaited<ReturnType<typeof listFiles>>;
  let issues: unknown[];
  try {
    files = await listFiles(task.packageDirectory);
    issues = validatePackageFiles(files, config.stateOutputDiagnostics);
  } catch (error) {
    files = [];
    issues = [
      {
        file: task.packageDirectory,
        pointer: "",
        check: "package_files",
        category: "validation",
        message: error instanceof Error ? error.message : String(error),
        action: toolMessages.packageFiles,
      },
    ];
  }
  const validationRecord = await saveRecord(
    task.outputDirectory,
    "validation",
    {
      passed: issues.length === 0,
      issues,
    },
  );
  if (issues.length > 0)
    return { passed: false, record: validationRecord, issues };

  const packDirectory = await mkdtemp(join(task.outputDirectory, "pack-"));
  if (
    !isPathContained(task.outputDirectory, packDirectory) ||
    (await realpath(packDirectory)) !== packDirectory
  )
    fail(
      packDirectory,
      "pack_path",
      toolMessages.archiveDirectory,
      "configuration",
    );

  const archive = resolve(packDirectory, config.zipFile);
  if (!isPathContained(packDirectory, archive))
    fail(
      config.zipFile,
      "pack_path",
      toolMessages.archivePath,
      "configuration",
    );
  await mkdir(dirname(archive), { recursive: true });
  const bytes = writeNativeCardZip(files);
  await writeFile(archive, bytes, { flag: "wx" });

  const archiveFiles = readNativeCardZip(
    await readFile(archive),
    nativeCardLimits as NativeCardZipLimits,
  );
  const archiveIssues = validatePackageFiles(
    archiveFiles,
    config.stateOutputDiagnostics,
  );
  const archiveValidation = join(packDirectory, "archive-validation.json");
  await saveJson(archiveValidation, {
    archive,
    passed: archiveIssues.length === 0,
    files: archiveFiles.length,
    issues: archiveIssues,
  });
  if (archiveIssues.length > 0)
    fail(
      archive,
      "pack_archive_validation",
      `${toolMessages.archiveReadback} ${JSON.stringify(archiveIssues)}`,
      "validation",
    );
  const record = {
    archive,
    bytes: bytes.length,
    packageValidation: validationRecord,
    validation: archiveValidation,
  };
  const packRecord = join(packDirectory, "result.json");
  await saveJson(packRecord, record);
  return { ...record, packRecord, passed: true };
}
export async function resume(path: string): Promise<unknown> {
  const task = await loadTask(path);
  return {
    taskFile: resolve(path),
    sourceFile: task.sourceFile,
    originalSourceFile: task.originalSourceFile,
    packageDirectory: task.packageDirectory,
    outputDirectory: task.outputDirectory,
    artifacts: await readdir(task.outputDirectory),
  };
}
