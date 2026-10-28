import { SUBSTITUTE_REGEX } from "../../../../packages/adapters-sillytavern/src/types/regex.ts";

export const entryFields = [
  { source: "keys", target: "key" },
  { source: "secondary_keys", target: "keysecondary", default: [] },
  { source: "selective", target: "selective", default: false },
  { source: "constant", target: "constant", default: false },
  { source: "comment", target: "comment", default: "" },
  { source: "insertion_order", target: "order" },
  { source: "enabled", target: "disable", default: false, transform: "invert" },
] as const;

export const entryExtensionFields = [
  { source: "selectiveLogic", target: "selectiveLogic", default: 0 },
  { source: "depth", target: "depth", default: 4 },
  { source: "role", target: "role", default: 0 },
  { source: "scan_depth", target: "scanDepth", default: null },
  { source: "case_sensitive", target: "caseSensitive", default: null },
  { source: "match_whole_words", target: "matchWholeWords", default: null },
  { source: "exclude_recursion", target: "excludeRecursion", default: false },
  { source: "prevent_recursion", target: "preventRecursion", default: false },
  {
    source: "delay_until_recursion",
    target: "delayUntilRecursion",
    default: 0,
    transform: "boolean-number",
  },
  { source: "outlet_name", target: "outletName", default: "" },
] as const;

export const entryRuntimeFlags = [
  "match_persona_description",
  "match_character_description",
  "match_character_personality",
  "match_character_depth_prompt",
  "match_scenario",
  "match_creator_notes",
  "ignore_budget",
] as const;

export const entryEditorFields = ["display_index", "addMemo"] as const;

export const entryUnusedExtensions = [
  "secondary_keys_logic",
  "weight",
  "cfSortKey",
] as const;

export const entryDuplicateFields = [
  { source: ["name"], canonical: ["comment"], target: ["comment"] },
  {
    source: ["case_sensitive"],
    canonical: ["extensions", "case_sensitive"],
    target: ["caseSensitive"],
  },
  { source: ["extensions", "uid"], canonical: ["id"], target: ["uid"] },
  {
    source: ["extensions", "ignoreBudget"],
    canonical: ["extensions", "ignore_budget"],
    target: ["extra", "extensions", "ignore_budget"],
  },
] as const;

export const entryInactiveExtensions = {
  use_group_scoring: [false],
  automation_id: [""],
  vectorized: [false],
  sticky: [0, null],
  cooldown: [0, null],
} as const;

export const entryUnusedFields = {
  use_regex: [true, false, null],
} as const;

export const writeSelection = {
  indicesFlag: "--indices",
  indicesPattern: /^(?:0|[1-9]\d*)(?:,(?:0|[1-9]\d*))*$/u,
} as const;

export const entryWrite = {
  schema: "native-card-package/worldbook-entry.schema.json",
  sourcePointer: /^(.*\/entries)\/(0|[1-9]\d*)$/u,
  entriesPointer: /^(.*\/entries)$/u,
  ignoredSourceFields: ["id", "content", "position", "extensions"],
  positionNames: { before_char: 0, after_char: 1 },
  copyFlag: "--copy-content",
} as const;

export const regexFields = [
  { source: "scriptName" },
  { source: "findRegex" },
  { source: "replaceString" },
  { source: "trimStrings", default: [] },
  { source: "placement" },
  { source: "disabled" },
  { source: "markdownOnly" },
  { source: "promptOnly" },
  { source: "runOnEdit" },
  { source: "minDepth", optional: true },
  { source: "maxDepth", optional: true },
  { source: "substituteRegex", default: SUBSTITUTE_REGEX.NONE },
] as const;

export const regexWrite = {
  schema: "native-card-package/regex-profile.schema.json",
  idPrefix: "regex-",
} as const;

export const writeMessages = {
  parseFormat:
    "parse 需要 --format json 或 --format yaml，格式参数只能提供一次。",
  parseString: "源 JSON Pointer 应指向字符串，请核对源位置。",
  parseJsonValue: "解析结果包含 JSON 无法保留的值，请核对源数据类型。",
  copyArguments:
    "copy 需要任务文件、源 JSON Pointer 和目标文件路径；可选参数为 --target-pointer、--start 和 --end，每项提供一个值。",
  fieldArguments:
    "批量写入需要任务文件、目标JSON和至少一组 --field <源Pointer> <目标Pointer>；请执行当前命令的 --help 核对用法。",
  fieldConflict:
    "目标 JSON Pointer {first} 与 {second} 重复或存在父子重叠；请合并为一次字段修改，或分次顺序调用。",
  fieldSourcePointer:
    "源 JSON Pointer {pointer} 不存在或结构无效；请核对 begin 返回的源位置。",
  fieldTargetPointer:
    "目标 JSON Pointer {pointer} 无法写入现有 JSON 结构；请核对目标字段的父级和数组序号。",
  fragmentString: "片段参数仅适用于源字符串，请核对源位置。",
  fragmentRange:
    "片段起点和终点须为非负安全整数，起点不大于终点，终点不超过源字符串长度。",
  fragmentCharacter:
    "片段边界切开了一个字符，请调整 --start 和 --end，使片段保留完整字符。",
  targetPointer: "目标字段位置应为空字符串或有效的 JSON Pointer，请核对转义。",
  targetContainer: "目标字段的父级应为对象或数组，请核对已有目标文件。",
  targetArray:
    "目标数组位置无效；请将目标JSON Pointer末段改为现有成员序号，或使用数组长度追加成员。",
  targetJson:
    "写入目标字段时，请选择 .json 文件，例如 character.json 或 worldbooks/<书目录名>/entries/<条目文件名>.json。",
  regexArguments:
    "map-regex 需要 taskFile、源正则数组 JSON Pointer、目标文件路径和 --indices 逗号分隔的源序号；--indices 的值为空字符串表示空选择。",
  regexArray: "源正则位置应指向数组，请使用 begin 返回的正则位置。",
  regexIndices: "选择序号应为互不重复、未越界的非负安全整数。",
  regexRule: "选择的源正则成员应为对象，请核对源序号 {index}。",
  regexDuplicate:
    "选定正则的 ID {id} 与 {other} 重复，请在目标文件中为这些正则设置不同的 ID，并更新对应引用。",
  arguments:
    "map-entry 的单项用法需要 taskFile、源条目 JSON Pointer 和目标文件路径；批量用法需要 taskFile、entries 数组 JSON Pointer、目标 entries 目录和 --indices 序号。两种用法均可添加 --copy-content。",
  pointer: "源位置应指向 entries 数组中的条目，请使用 begin 返回的条目位置。",
  entriesPointer:
    "批量源位置应指向 entries 数组，请使用 begin 返回的世界书条目数组位置。",
  entries: "源世界书的 entries 不是数组；请核对源JSON Pointer并选择条目数组。",
  entry: "指定源条目不是对象；请核对源JSON Pointer并选择条目对象。",
  extensions:
    "条目的 extensions 不是对象；请向用户报告该字段的源JSON Pointer及实际类型，停止本次转换。",
  field: "源值不符合目标字段 {target} 的格式；该字段未写入。",
  id: "条目 ID 应为非负整数或字符串；该条目的 UID 未写入。",
  duplicate:
    "条目 ID {id} 与 {other} 重复，请在目标条目中设置不同的 UID，并更新对应引用。",
  package:
    "任务文件的 packageDirectory 应为原生包目录的绝对路径，请使用 begin 返回的 taskFile。",
  targetPath:
    "目标文件路径必须位于 packageDirectory 内；请按 Skill 的 references/conversion-map.md 第1章填写对应目录和文件名。",
  targetObject: "已有目标文件应为 JSON 对象，请先修正该文件。",
  targetLink: "目标目录或文件含符号链接，请选择包内的普通文件路径。",
} as const;
