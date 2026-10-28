import { nativeCardFileRules } from "../../../../packages/shared/src/schemas/native-card-package/schema.ts";
import runtime from "./runtime.json" with { type: "json" };

export const characterFields = {
  name: { target: "name" },
  creator: { target: "creator" },
  character_version: { target: "characterVersion" },
  tags: { target: "tags" },
  nickname: { target: "nickname" },
  source: { target: "source" },
  description: { target: "description" },
  personality: { target: "personality" },
  scenario: { target: "scenario" },
  mes_example: { target: "exampleDialogue" },
  system_prompt: { target: "systemPrompt" },
  post_history_instructions: { target: "postHistoryInstructions" },
  creator_notes: { target: "creatorNotes" },
} as const;

export const worldbookSourceFields = [
  { target: "name", sources: [["name"]] },
  {
    target: "scanDepth",
    sources: [
      ["scan_depth"],
      ["scanDepth"],
      ["extensions", "scan_depth"],
      ["extensions", "scanDepth"],
    ],
  },
  {
    target: "caseSensitive",
    sources: [
      ["case_sensitive"],
      ["caseSensitive"],
      ["extensions", "case_sensitive"],
      ["extensions", "caseSensitive"],
    ],
  },
  {
    target: "matchWholeWords",
    sources: [
      ["match_whole_words"],
      ["matchWholeWords"],
      ["extensions", "match_whole_words"],
      ["extensions", "matchWholeWords"],
    ],
  },
  {
    target: "recursive",
    sources: [
      ["recursive_scanning"],
      ["recursive"],
      ["extensions", "recursive_scanning"],
      ["extensions", "recursive"],
    ],
  },
  {
    target: "maxRecursionSteps",
    sources: [
      ["max_recursion_steps"],
      ["maxRecursionSteps"],
      ["extensions", "max_recursion_steps"],
      ["extensions", "maxRecursionSteps"],
    ],
  },
] as const;
export const worldbookDefaultTemplate = "worldbookIndex";
export const emptyOpeningsTemplate = { defaultOpeningIds: {}, items: [] };
export const markedSourceFields = {
  character: [
    "name",
    "description",
    "personality",
    "scenario",
    "mes_example",
    "system_prompt",
    "post_history_instructions",
    "creator_notes",
  ],
  worldbook: ["name"],
  worldbookEntry: ["keys", "secondary_keys", "comment", "content"],
  regex: ["scriptName", "findRegex", "replaceString"],
} as const;
export const sourceTextFeatures = [
  {
    feature: "MVU标记",
    pattern: /\bMVU\b|\[(?:initvar|mvu_update|mvu_plot)\]/iu,
  },
  {
    feature: "旧变量输出协议",
    pattern:
      /<\/?(?:UpdateVariable|JSONPatch|VariableUpdate|initvar)\b|\bJSONPatch\b/iu,
  },
  {
    feature: "变量更新指令",
    pattern:
      /变量(?:更新|变化)(?:规则|指令)|(?:更新|修改|维护|写入)[^。！？\n]{0,24}变量|变量[^。！？\n]{0,24}(?:更新|修改|写入)/u,
  },
  {
    feature: "变量输出要求",
    pattern:
      /变量输出(?:协议|格式)|(?:输出|返回|生成)[^。！？\n]{0,24}(?:变量|JSON\s*Patch)|(?:要求|必须|需要|请)[^。！？\n]{0,24}(?:JSON|YAML)/iu,
  },
  { feature: "EJS模板", pattern: /<%/u },
  {
    feature: "不支持的变量宏",
    pattern: /\{\{(?!\s*(?:char|user)\s*\}\})[^{}]+\}\}/u,
  },
  {
    feature: "插件调用",
    pattern:
      /\b(?:Mvu|SillyTavern|TavernHelper)\s*\.[A-Za-z_$][\w$]*|\b(?:getvar|setvar|hasvar|addvar|incvar|decvar|deletevar|getAllVariables|getVariables|replaceVariables|getChatMessages|eventOn|triggerSlash|executeSlashCommands)\s*\(/iu,
  },
  {
    feature: "HTML标签",
    pattern: /<\/?[A-Za-z][\w:-]*(?:\s[^<>]*)?>/u,
  },
  {
    feature: "CSS样式",
    pattern:
      /<style\b[^>]*>[\s\S]*?<\/style\s*>|\bstyle\s*=\s*["'][^"']*[{}:][^"']*["']|(?:^|\n)\s*[.#][\w-]+\s*\{[^{}]*[A-Za-z-]+\s*:[^{};]+;?[^{}]*\}/iu,
  },
  {
    feature: "程序代码",
    pattern:
      /```[ \t]*(?:ejs|html|css|javascript|js|typescript|ts|json)\b|\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=|\bfunction\s*(?:[A-Za-z_$][\w$]*)?\s*\(|(?:=>)|\b(?:window|document|console)\.[A-Za-z_$][\w$]*/iu,
  },
  {
    feature: "状态展示标记",
    pattern:
      /\[(?:status|statusbar|stats|statsbar)(?:\b[^\]]*)\]|<\/?(?:status|statusbar|status-panel|stats-panel)\b/iu,
  },
] as const;
export const sourceRegexTags = {
  feature: "源正则引用标签",
  pattern: /<(?:\\?\/)?([A-Za-z_][\w:-]*|[①-⑳])(?:\s[^>]{0,128})?>/gu,
} as const;
export const pluginVariableReferences = {
  pattern:
    /\{\{(?:getvar|hasvar|setvar|addvar|incvar|decvar|deletevar)::([^}:]+)(?:::[^}]*)?\}\}/giu,
  apiPattern:
    /\b(?:getvar|hasvar|setvar|addvar|incvar|decvar|deletevar)\s*\(\s*["']([^"']+)["']/giu,
} as const;

export const sourceFieldAliases = { creatorcomment: "creator_notes" } as const;
export const excludedSourcePaths = [
  "/fav",
  "/extensions/fav",
  "/talkativeness",
  "/extensions/talkativeness",
] as const;

export const emptySourceValues = {
  "/avatar": "none",
  "/extensions/world": "",
} as const;
export const emptyDepthPrompt = {
  path: "/extensions/depth_prompt",
  fields: ["prompt", "depth", "role"],
  roles: ["system", "user", "assistant"],
} as const;

export const openings = [
  "first_mes",
  "alternate_greetings",
  "group_only_greetings",
];
export const questions = {
  character: "Agent 确定文字的保留、删除或拆分范围，以及保留内容的目标文件。",
  opening: "Agent 确定开场类型、需要写入的正文片段及状态初始值。",
  worldbook: "Agent 判断无法直接映射的世界书内容及目标位置。",
  worldbookSettings: "Agent 选择无法自动映射的世界书设置值。",
  regex: "Agent 判断无法直接映射的正则内容及目标位置。",
  helperScript: "Agent 判断助手脚本的职责及目标文件。",
  helperVariables: "Agent 判断助手变量的用途及目标状态字段。",
  extension: "Agent 判断扩展内容的用途及处理方式。",
  other: "Agent 判断字段内容的用途及处理方式。",
};

export const sourceFormats = {
  legacy: "v1",
  v2: "chara_card_v2",
  v3: "chara_card_v3",
} as const;
export const sourceVersions = {
  [sourceFormats.v3]: "3.0",
  [sourceFormats.v2]: "2.0",
} as const;
export const legacySourceFormat = {
  format: sourceFormats.legacy,
  version: "1.0",
  fields: [
    "name",
    "description",
    "personality",
    "scenario",
    "first_mes",
    "mes_example",
  ],
} as const;
export const sourceVersionSpecifications = {
  [sourceFormats.legacy]:
    "https://github.com/malfoyslastname/character-card-spec-v2/blob/main/spec_v1.md",
  [sourceFormats.v2]:
    "https://github.com/malfoyslastname/character-card-spec-v2/blob/main/spec_v2.md",
  [sourceFormats.v3]:
    "https://github.com/kwaroran/character-card-spec-v3/blob/main/SPEC_V3.md",
} as const;
export const sourceInputDiagnostics = {
  formatInvalid: {
    code: "SOURCE_CARD_FORMAT_INVALID",
    message: "源角色卡的字段类型、可读取结构或版本声明有误。",
    action:
      "转换 Agent 应结束当前卡的转换并报告 issues 中的字段位置、期望约束和实际类型；用户提供可读取的输入后，转换 Agent 可重新执行 begin。",
  },
  versionUnsupported: {
    code: "SOURCE_CARD_VERSION_UNSUPPORTED",
    message: "源角色卡声明的格式或版本超出当前支持范围。",
    action:
      "转换 Agent 应结束当前卡的转换；用户按 supportedFormats 列出的格式重新导出源卡后，可重新执行 begin。",
  },
} as const;
export const arrayMemberTypes: Record<string, "string" | "object"> = {
  opening: "string",
  worldbook: "object",
  regex: "object",
  helperScript: "object",
};

export const pngCard = {
  signature: [137, 80, 78, 71, 13, 10, 26, 10],
  textChunk: "tEXt",
  endChunk: "IEND",
  metadataKeys: ["ccv3", "chara"],
  errors: {
    signature: "文件没有 PNG 签名，请提供有效的 PNG 角色卡。",
    chunk: "PNG 数据块不完整，请提供完整的 PNG 角色卡文件。",
    end: "PNG 文件缺少 IEND 结束块；请重新导出完整的 PNG 角色卡后重试。",
    text: "PNG 的 tEXt 数据块缺少关键词分隔符；请重新导出完整的 PNG 角色卡后重试。",
    metadata:
      "PNG 中没有 chara 或 ccv3 角色卡数据；请提供包含角色卡数据的 PNG，或导出的 JSON 角色卡。",
  },
} as const;

export const sourceMessages = {
  jsonSyntax:
    "源角色卡 {path} 的 JSON 语法错误；请重新导出有效的 JSON 角色卡后重试。",
  rootConflict: "根字段的值与 {pointer} 的值不同；转换器使用 data 中的字段值。",
  aliasConflict:
    "该字段的值或类型与 {pointer} 处字段的值或类型不同，请确认应保留的内容。",
  arrayString: "数组项应为字符串。",
  arrayObject: "数组项应为对象。",
  array: "该字段应为数组。",
  characterField: "字段不符合 {file} 的 {field} 格式。",
  characterRequired:
    "目标文件 {file} 的 {field} 字段需要填写；请根据源卡内容确定目标字段的值。",
  bookObject: "内嵌世界书应为对象或 null。",
  entriesMissing: "内嵌世界书缺少 entries 字段。",
  worldbookField: "源值不符合目标世界书字段 {field} 的格式。",
  worldbookAliasConflict:
    "该世界书设置与 {pointer} 的值不同，请确认应保留的来源。",
  worldbookTarget:
    "世界书配置不符合 {file} 的schema；请核对世界书配置的源值，按世界书schema修正目标配置。",
  entryTarget:
    "条目字段不符合 {file} 的schema；请核对条目字段的源值，按条目schema修正目标字段。",
  regexTarget:
    "正则字段不符合 {file} 的schema；请核对正则字段的源值，按正则schema修正目标字段。",
  stringIdDuplicate: "世界书条目的字符串 ID {id} 重复。",
  numericIdDuplicate: "世界书条目 ID {id} 与其他条目冲突。",
  idType: "世界书条目 ID 应为非负整数或字符串。",
  helperVariables: "tavern_helper 的 variables 字段应为对象。",
  helperTuple:
    "tavern_helper 数组中的每一项应为二元组，第一项为字符串键，第二项为值。",
  helperKeyDuplicate: "tavern_helper 的键 {key} 重复。",
  helperObject: "tavern_helper 扩展应为对象或二元组数组。",
  extensionsObject: "角色卡的 extensions 字段应为对象。",
  inputFormat: "请提供 PNG 或 JSON 角色卡文件。",
  inputMissing: "请提供 PNG 或 JSON 角色卡文件的路径。",
  sourcePointer:
    "源 JSON Pointer 应为空字符串或以 / 开头；字段名中的 ~ 和 / 分别写为 ~0 和 ~1。",
  sourceMissing:
    "源位置 {pointer} 不存在，请核对字段名和数组序号；需要查看相邻字段时，请提取其父对象。",
  extractArguments:
    "extract 需要任务文件路径及至少一个源 JSON Pointer；读取根值时，Pointer 填写空字符串。",
  extractItemFailure: "无法提取源位置 {pointer}：{detail}",
} as const;

export const sourceReadPatterns = {
  invalidEscape: /~(?![01])/u,
  arrayIndex: /^(?:0|[1-9]\d*)$/u,
  lineBreak: /\r\n|[\r\n\u2028\u2029]/gu,
} as const;

const characterSchema = "native-card-package/character.schema.json";

export const taskPaths = {
  prefix: "run-",
  package: "package",
  task: "task.json",
  source: "source.json",
  review: "review",
  reviewItems: "items",
  workFile: "review/work.json",
  workIndexFile: "review/work-items.json",
  openingsFile: "openings.json",
  reviewItemPrefix: "item-",
  contextDirectoryPrefix: "context-",
  reviewText: "content.txt",
  reviewJson: "content.json",
  extractPrefix: "extract-",
  extractItemPrefix: "item-",
  extractText: "content.txt",
  extractJson: "content.json",
  worldbookEntryPrefix: "e",
  worldbookEntrySuffix: ".json",
  worldbookId: "book-0",
  worldbookFile: "worldbooks/book-0/book.json",
  worldbookEntriesDirectory: "worldbooks/book-0/entries",
  regexFile: "regex/source.json",
  characterFile: nativeCardFileRules.versions[
    runtime.packageVersion
  ]!.fixedFiles.find((rule) => rule.schema === characterSchema)!.pathPattern,
  characterSchema,
} as const;

export function worldbookEntryFile(index: number) {
  return `${taskPaths.worldbookEntryPrefix}${index}${taskPaths.worldbookEntrySuffix}`;
}

export function worldbookEntryPath(index: number) {
  return `${taskPaths.worldbookEntriesDirectory}/${worldbookEntryFile(index)}`;
}

export function worldbookEntryIndex(path: string): number | undefined {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (
    !name.startsWith(taskPaths.worldbookEntryPrefix) ||
    !name.endsWith(taskPaths.worldbookEntrySuffix)
  )
    return undefined;
  const index = name.slice(
    taskPaths.worldbookEntryPrefix.length,
    -taskPaths.worldbookEntrySuffix.length,
  );
  return /^(0|[1-9]\d*)$/u.test(index) ? Number(index) : undefined;
}
