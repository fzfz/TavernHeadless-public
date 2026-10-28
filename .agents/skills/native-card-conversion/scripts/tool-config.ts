import { fileURLToPath } from "node:url";
import stateRequestSchema from "./state-request.schema.json" with { type: "json" };
import pageMacroSupport from "../config/page-macros.json" with { type: "json" };
import bindingInputSchema from "./page-macro-bindings.schema.json" with { type: "json" };

export const toolMessages = {
  defaultAction: "修正指定文件或提供可访问的资料，再重新执行该检查。",
  schemaAction: "请按 {schema} 修正 {file} 的格式后重新验证。",
  taskLocationAction:
    "请使用 begin 返回的 task.json，并恢复其任务目录与包目录路径。",
  taskFileAction: "请使用任务目录中的普通 task.json 文件。",
  cliAction:
    "执行 node scripts/convert.mjs --help 查看有效命令，再执行 node scripts/convert.mjs <命令> --help 核对必填参数和路径。",
  cliFallbackAction: "核对输入和保存的检查结果，修正具体问题后重试。",
  taskFields:
    "任务文件缺少必需字段或字段值为空；请使用 begin 返回的 task.json。",
  taskSource:
    "任务源副本不存在、不是普通文件或不在任务目录中，请恢复 source.json。",
  taskBoundary:
    "任务文件与工作区根目录、任务目录或包目录之间的路径关系不符合要求，请使用 begin 返回的 task.json。",
  packageDirectory: "任务包路径不是普通目录，请恢复任务目录下的 package 目录。",
  packageFiles: "无法读取包目录中的文件，请移除链接或特殊文件后重新验证。",
  zipPath: "ZIP 路径必须位于当前任务目录内。",
  archivePath: "归档路径必须位于打包归档目录内。",
  previousArchivePath: "旧版 ZIP 归档必须位于打包归档目录内。",
  archiveDirectory: "打包归档目录必须位于当前任务目录内。",
  archiveReadback: "ZIP 归档回读校验失败。",
  stagedZipPath: "待发布 ZIP 必须位于当前任务目录内。",
  formal: {
    evidenceEscape: "正式校验证据目录必须位于任务目录内；请修正路径 {path}。",
    evidenceMissing: "正式校验证据目录不存在；请确认任务目录包含路径 {path}。",
    evidenceDirectoryType:
      "正式校验证据路径必须指向普通目录；请修正路径 {path}。",
    evidenceResolvesOutside:
      "正式校验证据目录解析到了任务目录之外；请检查路径 {path}。",
    evidenceParent:
      "正式校验必须在任务目录中保存证据；请提供任务目录内的证据目录。",
    zipInsideTask:
      "正式校验的 ZIP 必须位于任务目录内；请修正 ZIP 路径 {path}。",
    zipRegularFile: "正式校验的 ZIP 必须指向普通文件；请修正路径 {path}。",
    zipResolvesOutside:
      "正式校验的 ZIP 解析到了任务目录之外；请修正路径 {path}。",
    runAlreadyExists:
      "正式校验运行目录已存在；请为本次校验选择新的证据目录 {path}。",
    requestBodyEvidenceEscape:
      "ZIP 请求正文证据路径超出本次正式校验目录；请修正路径 {path}。",
    zipReadFailed:
      "正式 ZIP 读取器无法读取提交的角色包；请修复 ZIP 后重新打包。",
    importNotConfirmed:
      "正式导入尚未成功；请先查看导入诊断并修复角色包，再重新执行校验。",
    inspectHttp:
      "正式导入检查请求返回 HTTP {statusCode}；请核对请求与响应诊断，修正具体错误后重试。",
    inspectSchema:
      "正式导入检查响应不符合原生角色包导入结构；请核对服务端响应和当前接口版本。",
    packageRejected:
      "正式包结构校验发现 {count} 个问题；请根据详细诊断修复角色包后重新校验。",
    apiReadyZipReadFailed:
      "服务端接受了角色包，但本地正式 ZIP 读取器无法读取该包；请核对 ZIP 数据后重试。",
    apiAcceptedSchemaRejected:
      "服务端接受了角色包，但本地原生包结构校验未通过；请根据详细诊断修复包文件。",
    confirmHttp:
      "正式导入确认请求返回 HTTP {statusCode}；请检查响应详情并重新执行导入。",
    confirmSchema:
      "正式导入确认响应不符合原生角色卡结构；请检查服务端响应后重新执行导入。",
    confirmCardMissing:
      "正式导入响应未返回有效的角色卡记录；请检查导入响应后重试。",
    fileReadHttp:
      "回读角色包文件 {path} 时收到 HTTP {statusCode}；请检查导入结果后重新回读。",
    fileContentSchema:
      "回读角色包文件 {path} 的响应结构或 Base64 内容无效；请检查接口响应后重试。",
    fileBytesDiffer:
      "回读角色包文件 {path} 的字节与提交的 ZIP 不一致；请核对提交ZIP、导入记录及回读文件，修正证据指出的问题后重新验证。",
    fileReadFailed:
      "无法回读角色包文件 {path}；请检查导入记录和接口响应后重新验证。",
    verificationFailed:
      "正式包验证在阶段 {stage} 失败；请根据实际错误详情修复对应问题。",
    verificationStopped:
      "正式校验在阶段 {stage} 停止，尚未完成导入；请修复该阶段报告的问题后重试。",
    appCloseFailed: "正式校验 API 服务未能正常关闭；请检查清理错误详情。",
    readbackIncomplete:
      "正式包回读尚未覆盖所有已导入文件；请检查逐文件回读诊断并重新验证。",
    evidenceSaveFailed:
      "无法保存正式校验证据；请检查任务目录的写入权限后重试。",
  },
  preview: {
    failureContext: "{stage}：{message}（证据目录：{directory}）",
    taskDirectoryChanged:
      "准备预览证据时任务目录发生变化；请检查任务目录 {path} 后重试。",
    evidenceDirectorySymlink:
      "预览证据目录不能是符号链接；请移除链接并重试：{path}。",
    evidencePathType: "预览证据路径必须指向目录；请修正路径 {path}。",
    evidenceDirectoryEscape:
      "预览证据目录解析到了任务目录之外；请修正路径 {path}。",
    runDirectoryType: "预览运行证据路径必须指向普通目录；请修正路径 {path}。",
    runDirectoryEscape:
      "预览运行证据目录解析到了任务目录之外；请修正路径 {path}。",
    masterKeyConflict:
      "并行预览必须使用相同的隔离测试密钥；请统一预览运行配置后重试。",
    regularFileExpected: "预览需要读取普通文件；请修正文件路径 {path}。",
    schemaInvalid:
      "预览配置 {file} 不符合结构要求；请补全必需字段并修正校验问题：{details}。",
    requestBodyEvidence:
      "预览请求正文必须保存到已验证的运行目录；请检查证据目录 {path}。",
    requestBodyDirectoryEscape:
      "预览请求正文目录解析到了运行证据目录之外；请修正路径 {path}。",
    requestBodyPathEscape:
      "预览请求正文路径超出运行证据目录；请修正路径 {path}。",
    requestBodyResolvesOutside:
      "预览请求正文文件的实际路径超出了用于保存该请求的目录；请修正路径 {path}。",
    multipleReplayModels:
      "离线回放中用途为 {purpose} 的步骤使用了不同的模型名称（{models}）；请为这些步骤配置相同的模型名称。",
    viteListenerMissing:
      "Vite 预览服务没有创建 HTTP 监听器；请检查前端服务启动错误后重试。",
    viteAddressMissing:
      "Vite 预览服务没有提供 TCP 监听地址；请检查前端服务启动状态后重试。",
    viteCloseFailed:
      "Vite 页面服务关闭失败：{error}；请保存关闭诊断，向用户报告关闭失败的页面服务名称及实际错误。",
    apiCloseFailed:
      "预览 API 服务关闭失败：{error}；请保存关闭诊断，向用户报告关闭失败的API服务名称及实际错误。",
    replayCloseFailed:
      "离线回放服务关闭失败：{error}；请保存关闭诊断，向用户报告关闭失败的回放服务名称及实际错误。",
    browserLogFlushFailed:
      "浏览器请求日志保存失败：{error}；请按实际错误检查证据目录的写入权限和磁盘空间，修复后重新运行预览。",
    closeRecordFailed:
      "无法保存预览关闭记录：{error}；请按实际错误检查证据目录的写入权限和磁盘空间，修复后重新运行预览。",
    cleanupFailed:
      "预览服务清理失败：{errors}；请保存清理诊断，向用户报告清理失败的服务名称及实际错误。",
    requestEvidenceSaveFailed:
      "无法保存预览 API 请求证据；请检查证据目录写入权限。实际错误：{error}。",
    configuredZipEscape:
      "配置的 ZIP 路径解析到了任务目录之外；请修正 ZIP 路径 {path}。",
    configuredZipRegularFile:
      "预览需要普通 ZIP 文件 {file}；请修正路径 {path}。",
    roleZipEscape: "角色 ZIP 解析到了任务目录之外；请修正路径 {path}。",
    replayNotLoopback:
      "离线回放服务未绑定本机回环地址；请检查回放服务配置 {address}。",
    requestFailed:
      "预览 API 请求 {method} {url} 返回 HTTP {statusCode}；请核对请求参数和响应详情，修正具体错误后重试。响应：{body}。",
    importIdMissing:
      "正式导入检查响应没有返回导入 ID；请检查接口响应详情后重试：{response}。",
    cardRevisionMissing:
      "正式导入确认响应没有返回已保存的角色版本；请检查接口响应详情后重试：{response}。",
    previewSessionMissing:
      "预览会话响应没有返回会话 ID；请检查接口响应详情后重试：{response}。",
    roleViewInvalid:
      "角色视图响应不是有效对象；请检查接口响应详情后重试：{response}。",
    personaNameMismatch:
      "角色视图返回的人设姓名与预览配置不一致；预期 {expected}，实际 {actual}。请修正预览人设或导入角色后重试。",
    dryRunEmptyMessages:
      "dry-run 请求 {id} 未返回已组装消息；请检查预设、会话和当前输入。实际响应：{response}。",
    dryRunPersonaMissing:
      "dry-run 请求 {id} 的已组装消息未包含完整 persona.description；请检查人设配置和预设中的人设注入。",
    dryRunRequestFailed: "dry-run 检查项 {id} 未通过；实际错误：{error}。",
    frontendListenerNoPort:
      "预览前端监听器没有绑定端口；请检查 Vite 服务启动状态。",
    usage:
      "用法：node scripts/convert.mjs preview <taskFile> --archive <ZIP路径>；在 taskFile 所在目录填写 preview.json。",
  },
  outputPath: {
    worktreeRootMissing: "目标工作区根目录 {path} 不存在。",
    worktreeRootSymlink: "目标工作区根目录 {path} 是符号链接。",
    worktreeRootType: "目标工作区根目录 {path} 不是目录。",
    worktreeRootUnavailable: "无法读取目标工作区根目录 {path} 的真实路径。",
    worktreeRootUnavailableAction:
      "请确认目标工作区根目录 {path} 存在且当前进程可访问；修正工作区根路径或恢复访问后重试。",
    worktreeRootAction:
      "请将目标工作区根路径改为实际存在且可访问的真实目录，然后重新执行。",
    escape: "输出路径 {path} 不在目标工作区 {worktreeRoot} 的下级目录内。",
    escapeAction:
      "请将 runtime.json 的 outputDirectory 设置为目标工作区内的目录，然后重试。",
    realpathMismatch:
      "输出路径 {path} 的真实路径为 {actualPath}，不符合工作区内的预期目录。",
    realpathMismatchAction:
      "请检查 {path} 及其祖先目录的真实路径，并将 runtime.json 的 outputDirectory 指向工作区内与配置一致的真实目录。",
    symlink: "输出路径 {path} 是符号链接，不能用于任务输出。",
    symlinkAction:
      "请移除该符号链接，并将 runtime.json 的 outputDirectory 指向工作区内的真实目录：{path}。",
    notDirectory: "输出路径 {path} 已存在，但它不是目录。",
    notDirectoryAction:
      "请移走该非目录项，并将 runtime.json 的 outputDirectory 指向工作区内的真实目录：{path}。",
    missing: "输出目录 {path} 在创建后仍不存在。",
    missingAction:
      "请为 runtime.json 的 outputDirectory 建立工作区内的真实目录：{path}。",
  },
} as const;

export function formatToolMessage(
  template: string,
  values: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    String(values[name]),
  );
}

export const replacementMessages = {
  arguments:
    'parse --apply-replacements 需要任务文件、源 JSON Pointer、目标初值 JSON 和 --format json；--start、--end 为可选参数，--target-pointer、--field 与该模式互斥。示例：node scripts/convert.mjs parse "task.json" "/replacements" "data/initial.json" --format json --apply-replacements。',
  conflict:
    'parse --apply-replacements 与 --target-pointer、--field 互斥；请移除冲突参数后重试。示例：node scripts/convert.mjs parse "task.json" "/replacements" "data/initial.json" --format json --apply-replacements。',
  format:
    'parse --apply-replacements 仅支持 --format json；请修正格式参数后重试。示例：node scripts/convert.mjs parse "task.json" "/replacements" "data/initial.json" --format json --apply-replacements。',
  sourceString:
    "源 JSON Pointer 应指向 JSON 文本，选定片段应解析为 replace 操作数组；请核对源位置和 --format json。",
  sourceJson:
    "指定片段不是有效的 JSON 文本；请核对源 JSON Pointer，并修正 --start、--end 后重试。",
  sourceArray: "指定片段必须解析为 JSON 数组；请核对源位置和片段范围。",
  member:
    "replace 数组第 {index} 项必须是包含 op、path 和 value 的对象；请核对源 JSON Pointer 和片段范围，重新选择完整数组后重试。",
  operation:
    "replace 数组第 {index} 项的 op 必须为 replace；该模式仅执行已有字段覆写。请按该源操作的语义直接编辑目标初值 JSON。",
  pathString:
    "replace 数组第 {index} 项的 path 必须是字符串；请核对源 JSON Pointer 和片段范围，重新选择具有字符串路径的数组后重试。",
  valueMissing:
    "replace 数组第 {index} 项缺少 value 字段；请核对源 JSON Pointer 和片段范围。源数据确实缺值时，停止并报告该源位置。",
  pathInvalid:
    "replace 数组第 {index} 项的 path 必须是指向字段或数组成员的有效 JSON Pointer；路径段中的 ~ 和 / 分别写作 ~0 和 ~1。",
  pathMissing:
    "目标 JSON 中不存在 replace 数组第 {index} 项指定的路径 {path}；replace 只覆盖已有字段或数组成员，请先生成对应初值字段或修正路径。",
  retryPathMissing:
    "覆写结果中不存在第 {index} 项路径 {path}，使用相同参数重试会再次失败；目标文件尚未修改。请按源数组中各项的顺序直接编辑目标初值 JSON。",
  targetMissing:
    '目标初值 JSON 不存在：{file}。请先生成基础初值。示例：node scripts/convert.mjs parse "task.json" "/initialState" "data/initial.json" --format json。',
  targetJson: "目标初值文件不是有效 JSON：{file}。请修复该文件后重试覆写。",
} as const;

type Parameter = {
  name: string;
  type: "path" | "string" | "integer" | "boolean" | "pointer" | "uuid";
  required: boolean;
  default: string;
  count?: number;
  repeat?: boolean;
  pathBase?: "package";
  values?: string[];
};
const pathParameter = (name: string, required = true): Parameter => ({
  name,
  type: "path",
  required,
  default: "无",
});
const flag = (
  name: string,
  type: Parameter["type"],
  count = 1,
  values?: string[],
  repeat = false,
): Parameter => ({
  name,
  type,
  required: false,
  default: type === "boolean" ? "false" : "无",
  count,
  values,
  repeat,
});
const requestId = { ...flag("--request-id", "uuid"), default: "脚本生成UUID" };
const fieldFlags = [
  {
    ...flag("--target-pointer", "pointer"),
    default: "空JSON Pointer，替换整个文件",
  },
  { ...flag("--start", "integer"), default: "0" },
  { ...flag("--end", "integer"), default: "源字符串长度" },
  flag("--field", "pointer", 2, undefined, true),
];
export const commandDefinitions: Record<
  string,
  {
    description: string;
    parameters: Parameter[];
    flags: Parameter[];
    example: string;
  }
> = {
  begin: {
    description:
      "读取单个JSON或PNG角色卡，将直接映射的字段写入原生包；结果文件提供任务文件、包目录和待判断原文索引的路径。",
    parameters: [pathParameter("sourceFile")],
    flags: [requestId],
    example: 'begin "角色卡.png"',
  },
  extract: {
    description: "提取一个或多个源JSON Pointer，分别保存完整内容和阅读分片。",
    parameters: [
      pathParameter("taskFile"),
      {
        name: "pointer...",
        type: "pointer",
        required: true,
        default: "无",
        repeat: true,
      },
    ],
    flags: [],
    example: 'extract "task.json" /data/description /data/scenario',
  },
  "map-entry": {
    description: "映射所选世界书条目，写入条目文件并更新包内引用。",
    parameters: [
      pathParameter("taskFile"),
      {
        name: "entriesPointer",
        type: "pointer",
        required: true,
        default: "无",
      },
      pathParameter("targetFile或targetDirectory"),
    ],
    flags: [flag("--indices", "string"), flag("--copy-content", "boolean", 0)],
    example:
      'map-entry "task.json" /data/character_book/entries worldbooks/book-0/entries --indices 1,3 --copy-content',
  },
  "map-regex": {
    description: "将选择保留的正则与自动写入规则合并，保留源顺序。",
    parameters: [
      pathParameter("taskFile"),
      { name: "regexPointer", type: "pointer", required: true, default: "无" },
      pathParameter("targetFile"),
    ],
    flags: [{ ...flag("--indices", "string"), required: true }],
    example:
      'map-regex "task.json" /data/extensions/regex_scripts regex/source.json --indices "1,3"',
  },
  copy: {
    description: "复制源字段到文件，或一次修改同一JSON文件的多个字段。",
    parameters: [
      pathParameter("taskFile"),
      {
        name: "sourcePointer或targetFile",
        type: "string",
        required: true,
        default: "无",
      },
      pathParameter("targetFile", false),
    ],
    flags: fieldFlags,
    example:
      'copy "task.json" character.json --field /data/description /description --field /data/scenario /scenario',
  },
  parse: {
    description: "解析源字符串中的JSON或YAML数据，写入指定JSON文件或字段。",
    parameters: [
      pathParameter("taskFile"),
      {
        name: "sourcePointer或targetFile",
        type: "string",
        required: true,
        default: "无",
      },
      pathParameter("targetFile", false),
    ],
    flags: [
      ...fieldFlags,
      { ...flag("--format", "string", 1, ["json", "yaml"]), required: true },
      flag("--apply-replacements", "boolean", 0),
    ],
    example:
      'parse "task.json" /data/character_book/entries/0/content state/initial/default.json --format yaml',
  },
  "bind-page-macros": {
    description:
      "从输入任务快照生成独立任务的完整页面宏包，返回 taskFile 和 packageDirectory；连续绑定及 index、validate、pack 使用返回的 taskFile。",
    parameters: [pathParameter("taskFile"), pathParameter("requestFile")],
    flags: [],
    example: 'bind-page-macros "task.json" "request.json"',
  },
  "state-source": {
    description:
      "提取选定 Zod 声明的静态字段与待解释位置，登记本任务的源字段清单。",
    parameters: [pathParameter("taskFile"), pathParameter("requestFile")],
    flags: [],
    example: 'state-source "task.json" "request.json"',
  },
  "state-schema": {
    description:
      "校验状态字段定义与源字段覆盖，生成 schema、初值引用及可写路径；同时接受配套初值和权限。",
    parameters: [pathParameter("taskFile"), pathParameter("requestFile")],
    flags: [],
    example: 'state-schema "task.json" "request.json"',
  },
  "state-initial": {
    description: "按状态 schema 校验开场完整初值，保存初值及开场引用。",
    parameters: [
      pathParameter("taskFile"),
      { name: "openingId", type: "string", required: true, default: "无" },
      pathParameter("requestFile"),
    ],
    flags: [],
    example: 'state-initial "task.json" default "request.json"',
  },
  "state-fields": {
    description: "列出状态 schema 中的字段引用、类型、父对象及数组字段。",
    parameters: [pathParameter("taskFile")],
    flags: [],
    example: 'state-fields "task.json"',
  },
  "state-permissions": {
    description: "提交字段写入权限与变量更新配置，生成并保存可写路径。",
    parameters: [pathParameter("taskFile"), pathParameter("requestFile")],
    flags: [],
    example: 'state-permissions "task.json" "request.json"',
  },
  "state-paths": {
    description: "依据当前 schema 和已保存的字段权限重新生成可写路径。",
    parameters: [pathParameter("taskFile")],
    flags: [],
    example: 'state-paths "task.json"',
  },
  index: {
    description: "扫描已完成的包文件并写入manifest.json。",
    parameters: [pathParameter("taskFile")],
    flags: [{ ...flag("--frontend", "path"), pathBase: "package" }],
    example: 'index "task.json"',
  },
  validate: {
    description: "检查原生包格式、文件引用和模块。",
    parameters: [pathParameter("taskFile")],
    flags: [],
    example: 'validate "task.json"',
  },
  pack: {
    description: "校验文件快照及实际归档，生成独立ZIP。",
    parameters: [pathParameter("taskFile")],
    flags: [],
    example: 'pack "task.json"',
  },
  formal: {
    description: "通过正式接口导入指定ZIP并逐文件回读。",
    parameters: [pathParameter("taskFile")],
    flags: [{ ...flag("--archive", "path"), required: true }, requestId],
    example: 'formal "task.json" --archive "archives/role-1.zip"',
  },
  preview: {
    description: "启动指定ZIP的正式页面与API预览，前台运行至收到停止信号。",
    parameters: [pathParameter("taskFile")],
    flags: [{ ...flag("--archive", "path"), required: true }, requestId],
    example: 'preview "task.json" --archive "archives/role-1.zip"',
  },
  "replay-fixture": {
    description: "启动离线模型回放服务，每个实例保存独立请求证据。",
    parameters: [
      pathParameter("configFile"),
      pathParameter("evidenceDirectory"),
    ],
    flags: [requestId],
    example: 'replay-fixture "fixture.json" "evidence"',
  },
};

const parameterDescriptions: Record<string, string> = {
  openingId: "openings.json 的 items 中已有的开场 id。",
  "state-source:requestFile": "源状态声明请求 JSON 文件路径。",
  "state-schema:requestFile":
    "状态字段定义、源字段覆盖及配套初值与权限的请求 JSON 文件路径。",
  "state-initial:requestFile": "包含完整开场初值 value 的请求 JSON 文件路径。",
  "state-permissions:requestFile": "字段权限与变量更新配置请求 JSON 文件路径。",
  sourceFile: "用户指定的单个JSON或PNG角色卡文件路径。",
  taskFile:
    "当前转换任务的 task.json 文件路径；传入 - 时，命令从 stdin 读取上游结果文件路径。",
  "pointer...": "一个或多个源JSON Pointer；空字符串表示完整源卡。",
  entriesPointer: "单个世界书条目或条目数组的源JSON Pointer。",
  targetFile或targetDirectory:
    "单条映射的包内条目文件，或批量映射的包内条目目录。",
  regexPointer: "源正则数组的JSON Pointer。",
  targetFile: "包内目标文件路径。",
  sourcePointer或targetFile:
    "单字段形式使用源JSON Pointer；批量--field形式使用包内目标文件路径。",
  requestFile:
    "页面宏绑定请求 JSON 文件路径；结构由 scripts/page-macro-bindings.schema.json 定义。",
  configFile: "离线回放配置JSON文件路径。",
  evidenceDirectory: "各回放实例创建独立子目录的父目录。",
  "--request-id": "同次创建重试沿用的UUID；新输入使用新UUID。",
  "map-entry:--indices":
    "从0开始的世界书条目序号，以逗号分隔；空字符串表示不写入条目。",
  "map-regex:--indices":
    "从0开始的正则序号，以逗号分隔；空字符串表示不保留待判断正则。",
  "--copy-content": "将世界书条目正文原样写入目标条目。",
  "--target-pointer": "单字段形式写入目标JSON内的JSON Pointer。",
  "--start": "源字符串片段的UTF-16起始位置，包含此位置。",
  "--end": "源字符串片段的UTF-16结束位置，不包含此位置。",
  "--field":
    "依次传入源JSON Pointer和目标JSON Pointer，可重复提交同文件的不同字段。",
  "--format": "指定源字符串的解析格式。",
  "parse:--apply-replacements":
    "将选定的 JSON replace 数组按顺序覆盖目标初值中已存在的字段或数组成员；要求 --format json，且不能与 --target-pointer 或 --field 同用。",
  "--frontend": "包内前端manifest文件路径。",
  "--archive": "本次要导入或预览的ZIP路径，使用pack返回的archive。",
};

export function commandHelp(command?: string) {
  if (!command)
    return {
      description: "角色卡转换CLI",
      commands: Object.entries(commandDefinitions).map(
        ([name, definition]) => ({ name, description: definition.description }),
      ),
      example: "node scripts/convert.mjs begin --help",
    };
  const definition = commandDefinitions[command];
  if (!definition)
    throw new Error(
      `未知命令${command}。有效命令：${Object.keys(commandDefinitions).join("、")}。示例：node scripts/convert.mjs --help`,
    );
  return {
    command,
    ...definition,
    ...(Object.hasOwn(stateRequestSchema.$defs, command)
      ? {
          requestSchema: fileURLToPath(
            new URL("./state-request.schema.json", import.meta.url),
          ),
          definition: "#/$defs/" + command,
          inputSchema: stateRequestSchema,
        }
      : {}),
    ...(command === "bind-page-macros"
      ? { inputSchema: bindingInputSchema, pageMacroSupport }
      : {}),
    parameters: definition.parameters.map((p) => ({
      ...p,
      description:
        parameterDescriptions[`${command}:${p.name}`] ??
        parameterDescriptions[p.name],
    })),
    flags: definition.flags.map((p) => ({
      ...p,
      description:
        parameterDescriptions[`${command}:${p.name}`] ??
        parameterDescriptions[p.name],
    })),
    result:
      "读取stdout返回的resultFile。失败时读取stderr返回的diagnosticFile；成功退出0，失败退出非零。",
    pipeline: "taskFile为-时，从stdin的resultFile读取任务和归档。",
  };
}
