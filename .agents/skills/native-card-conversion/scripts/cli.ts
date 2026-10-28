import { readFile } from "node:fs/promises";
import { SourceCardInputError } from "./source-format.ts";
import { StateWriteError } from "./state-write.ts";
import { appendFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { commandDefinitions, commandHelp } from "./tool-config.ts";
import {
  createCallDirectory,
  emitCommandResult,
  withCallContext,
  getCallDirectory,
} from "./output.ts";
import { taskRepositoryRoot, readTaskContext } from "./task-context.ts";
import runtime from "./runtime.json" with { type: "json" };
import { withCreation } from "./creation.ts";

type Invocation = {
  command: string;
  args: string[];
  positional: string[];
  flags: Map<string, string[]>;
  taskFile?: string;
  archive?: string;
};
export async function parseInvocation(
  argv: string[],
  cwd = process.cwd(),
  stdin?: string,
): Promise<Invocation> {
  const [command, ...args] = argv;
  const definition = command && commandDefinitions[command];
  if (!definition)
    throw new Error(
      `未知命令${command ?? "（缺失）"}。有效值：${Object.keys(commandDefinitions).join("、")}。示例：node scripts/convert.mjs --help`,
    );
  const fail: (text: string) => never = (text) => {
    throw new Error(
      `${text}。示例：node scripts/convert.mjs ${definition.example}`,
    );
  };
  const flags = new Map<string, string[]>(),
    positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const value = args[i]!;
    if (value.startsWith("--")) {
      const spec = definition.flags.find((f) => f.name === value);
      if (!spec)
        fail(
          `无效参数${value}。有效值：${definition.flags.map((f) => f.name).join("、") || "无"}`,
        );
      if (flags.has(value) && !spec.repeat) fail(`参数${value}重复`);
      const values = args.slice(i + 1, i + 1 + (spec.count ?? 1));
      if (
        values.length !== (spec.count ?? 1) ||
        values.some((v) => v.startsWith("--"))
      )
        fail(`参数${value}缺少${spec.count ?? 1}个值`);
      if (spec.values && !spec.values.includes(values[0]!))
        fail(`参数${value}的有效值：${spec.values.join("、")}`);
      if (
        spec.type === "integer" &&
        !values.every((v) => /^(0|[1-9]\d*)$/.test(v))
      )
        fail(`参数${value}需要非负整数`);
      if (
        spec.type === "uuid" &&
        !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(
          values[0]!,
        )
      )
        fail(`参数${value}需要UUID，例如11111111-1111-4111-8111-111111111111`);
      const converted =
        spec.type === "path" && spec.pathBase !== "package"
          ? values.map((v) => resolve(cwd, v))
          : values;
      flags.set(value, [...(flags.get(value) ?? []), ...converted]);
      i += spec.count ?? 1;
    } else {
      const index = positional.length;
      const spec =
        definition.parameters[index] ??
        (definition.parameters.at(-1)?.repeat
          ? definition.parameters.at(-1)
          : undefined);
      if (!spec) fail(`多余参数${value}`);
      const path =
        spec.type === "path" &&
        (index === 0 ||
          command === "replay-fixture" ||
          command === "bind-page-macros" ||
          (command.startsWith("state-") && spec.name === "requestFile"));
      const converted = path && value !== "-" ? resolve(cwd, value) : value;
      positional.push(converted);
    }
  }
  if (
    positional.length < definition.parameters.filter((p) => p.required).length
  )
    fail("缺少必填位置参数");
  let archive = flags.get("--archive")?.[0];
  if (positional[0] === "-") {
    let raw = stdin;
    if (raw === undefined) {
      raw = "";
      for await (const chunk of process.stdin) raw += String(chunk);
    }
    let short: { resultFile?: unknown } | null = null;
    try {
      short = JSON.parse(raw || "null");
    } catch {
      fail("stdin不是有效JSON，需提供成功命令的resultFile");
    }
    if (!short || typeof short.resultFile !== "string")
      fail("stdin缺少成功结果resultFile");
    const result = JSON.parse(
      await readFile(resolve(cwd, short.resultFile), "utf8"),
    ) as { passed?: boolean; data?: { taskFile?: string; archive?: string } };
    if (
      result.passed !== true ||
      typeof result.data?.taskFile !== "string" ||
      !isAbsolute(result.data.taskFile)
    )
      fail("管道结果失败或缺少绝对路径taskFile");
    if (
      result.data.archive !== undefined &&
      (typeof result.data.archive !== "string" ||
        !isAbsolute(result.data.archive))
    )
      fail("管道archive必须是ZIP的绝对路径");
    if (
      archive &&
      result.data.archive &&
      archive !== resolve(cwd, result.data.archive)
    )
      fail("--archive与管道中的archive冲突，请只保留一个归档输入");
    archive ??= result.data.archive;

    positional[0] = result.data.taskFile;
  }
  for (const spec of definition.flags)
    if (
      spec.required &&
      !(spec.name === "--archive" && archive) &&
      !flags.has(spec.name)
    )
      fail(`缺少必填参数${spec.name}`);
  const flagArguments: string[] = [];
  for (const spec of definition.flags) {
    if (spec.name === "--archive" || spec.name === "--request-id") continue;
    const values = flags.get(spec.name);
    if (!values) continue;
    const count = spec.count ?? 1;
    if (count === 0) flagArguments.push(spec.name);
    else
      for (let index = 0; index < values.length; index += count)
        flagArguments.push(spec.name, ...values.slice(index, index + count));
  }
  return {
    command: command!,
    args: [...positional, ...flagArguments],
    positional,
    flags,
    archive,
    ...(command !== "begin" && command !== "replay-fixture"
      ? { taskFile: positional[0] }
      : {}),
  };
}

async function execute(call: Invocation): Promise<unknown> {
  const taskFile = call.positional[0]!;
  if (call.command === "begin" || call.command === "extract") {
    const source = await import("./source.ts");
    return call.command === "begin"
      ? source.begin(taskFile)
      : source.extract(taskFile, call.positional.slice(1));
  }
  if (
    ["map-entry", "map-regex", "copy", "parse", "bind-page-macros"].includes(
      call.command,
    )
  ) {
    const write = await import("./write.ts");
    const runners = {
      "map-entry": write.runMapEntry,
      "map-regex": write.runMapRegex,
      copy: write.runCopy,
      parse: write.runParse,
      "bind-page-macros": write.runBindPageMacros,
    };
    return runners[call.command as keyof typeof runners](call.args);
  }
  if (call.command.startsWith("state-"))
    return (await import("./state-write.ts")).runStateCommand(
      call.command,
      call.args,
    );
  if (call.command === "index")
    return (await import("./index.ts")).runIndex(call.args);
  const tool = await import("./tool.ts");
  if (call.command === "validate") return tool.validate(taskFile);
  if (call.command === "pack") return tool.pack(taskFile);
  if (call.command === "formal") {
    const task = await tool.loadTask(taskFile);
    return (await import("./formal.ts")).verifyFormalPackage(
      call.archive!,
      join(task.outputDirectory, "formal"),
    );
  }
  if (call.command === "preview") {
    const task = await tool.loadTask(taskFile);
    await (
      await import("./preview.ts")
    ).runPreviewForeground(task.outputDirectory, call.archive!);
    return;
  }
  await (
    await import("./replay-fixture.ts")
  ).runReplayForeground(call.positional[0]!, call.positional[1]!);
}

export async function runCli(
  argv = process.argv.slice(2),
  cwd = process.cwd(),
) {
  globalThis.AI_SDK_LOG_WARNINGS = (warning) => {
    const callDirectory = getCallDirectory();
    if (callDirectory)
      appendFileSync(
        join(callDirectory, "warnings.jsonl"),
        JSON.stringify(warning) + "\n",
      );
  };
  let directory: string | undefined;
  const command = argv[0] ?? "help";
  try {
    if (!argv.length || argv[0] === "--help" || argv.includes("--help")) {
      directory = await createCallDirectory(
        join(taskRepositoryRoot, runtime.outputDirectory),
      );
      return emitCommandResult(
        "help",
        commandHelp(argv[0] === "--help" || !argv.length ? undefined : command),
        directory,
      );
    }
    const invocation = await parseInvocation(argv, cwd);
    directory = await createCallDirectory(
      invocation.taskFile
        ? (await readTaskContext(invocation.taskFile)).outputDirectory
        : join(taskRepositoryRoot, runtime.outputDirectory),
    );
    const operation = () => execute(invocation);
    const result = await withCallContext(directory, () =>
      ["begin", "formal", "preview", "replay-fixture"].includes(command)
        ? withCreation(
            invocation.taskFile
              ? dirnameOfTask(invocation.taskFile)
              : join(taskRepositoryRoot, runtime.outputDirectory),
            command,
            invocation.flags.get("--request-id")?.[0],
            { args: invocation.args, archive: invocation.archive ?? null },
            operation,
          )
        : operation(),
    );
    if (result === undefined && ["preview", "replay-fixture"].includes(command))
      return;
    const passed = !(
      result &&
      typeof result === "object" &&
      "passed" in result &&
      result.passed === false
    );
    const data =
      result && typeof result === "object"
        ? {
            ...result,
            ...(invocation.taskFile && !("taskFile" in result)
              ? { taskFile: invocation.taskFile }
              : {}),
            ...(!passed
              ? {
                  action: `修正诊断所列输入后重试。命令示例：node scripts/convert.mjs ${commandDefinitions[command]!.example}`,
                }
              : {}),
          }
        : result;
    return emitCommandResult(command, data, directory, passed);
  } catch (error) {
    const data =
      error instanceof SourceCardInputError || error instanceof StateWriteError
        ? error.diagnostic
        : {
            error:
              error instanceof Error
                ? (error.stack ?? error.message)
                : String(error),
            action: commandDefinitions[command]
              ? `先读取实际错误详情，处理错误指出的问题后重试。命令示例：node scripts/convert.mjs ${commandDefinitions[command].example}。参数说明：node scripts/convert.mjs ${command} --help`
              : "有效命令与示例：node scripts/convert.mjs --help",
          };
    try {
      directory ??= await createCallDirectory(
        join(taskRepositoryRoot, runtime.outputDirectory),
      );
      return emitCommandResult(command, data, directory, false);
    } catch {
      /* The result-directory failure has its own short diagnostic. */
    }
    process.stderr.write(
      JSON.stringify({
        code: (error as NodeJS.ErrnoException).code ?? "CALL_DIRECTORY_FAILED",
        directory: join(taskRepositoryRoot, runtime.outputDirectory),
        action: "检查工具输出目录权限与磁盘空间后重试。",
      }) + "\n",
    );
    process.exitCode = 1;
  }
}
function dirnameOfTask(taskFile: string) {
  return resolve(taskFile, "..");
}
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
)
  await runCli();
