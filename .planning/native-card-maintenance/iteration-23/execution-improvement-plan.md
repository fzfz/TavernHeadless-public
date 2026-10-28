---
文档用途: 指导维护负责人改进角色卡转换 Skill 的转换及验收流程，解决第23轮复盘发现的耗时和转换错误。
读取时机: 维护负责人审阅本方案、实施改进或验收一次复测时。
---

# 角色卡转换 Skill 执行改进方案

## 1. 总目标

1. 维护负责人完善 Skill，使转换 Agent 能判断单个角色卡 JSON 中各部分的用途、删除范围，以及目标目录、文件和格式。
2. 转换 Agent 保留有效文字、HTML 和 CSS 原文，并按正式 API 转写程序逻辑。主代理验收转换结果的核心行为。
3. 本方案拟将同一转换 Agent 的离线耗时降至30分钟以内。离线耗时从 Harness 记录的子代理会话启动时间起算，至子代理写完适用离线检查验收记录的工具返回时间结束，包含资料读取、预检、转换、正式导入、回读和离线页面检查。其中，语义判断及文件生成耗时不超过20分钟，从预检命令返回时间起算，至子代理完成最后一次内容文件或程序写入的工具返回时间结束。真实模型检查在离线检查之后执行。完整 Skill 耗时从会话启动时间起算，至 Harness 记录的子代理最终答复时间结束。主代理分别判定效率与正确性。

## 2. 现状调研

1. 第23轮林茜卡转换耗时104分16秒，产生371组工具调用，启动5次预览、执行4次正式导入，最终主验收为7项通过、6项失败；真实模型语义生成未执行。统计依据见[耗时记录](conversion-time-analysis.json)，逐项结果见[主验收记录](main-acceptance.json)。
2. 公开工具记录覆盖约103分11秒，其中调用至返回累计约3分55秒，调用之间累计约99分16秒。完整任务还包含公开记录之前及之后的约1分05秒。调用之间的时间包含模型生成、决策、上下文压缩及调度，日志无法精确区分各自耗时。
3. 转换 Agent 在首次预览前使用约57分钟读取资料、生成文件和校验；其后使用约38分钟处理资源数量、前端挂载和状态 schema 错误，最后使用约8分钟检查页面及整理记录。
4. 本次生成脚本有1198行；170项字段决策列出6116个源路径，记录文件约535KB；执行期间发生4次上下文压缩。当前记录说明要求覆盖全部非根 JSON 路径，工具按路径逐个检查，促使 Agent 枚举容器、成员和叶值。
5. 已完成的文档层次修正尚未经过新的角色卡转换测试，其提速效果仍待验证。
6. 原维护任务的输入和检查项由[117项验收清单](../../../docs/plans/native-card-converter/acceptance-cards.json)及[清单 schema](../../../docs/plans/native-card-converter/acceptance-cards.schema.json)定义。
7. [结构核对记录](source-structure-design-evidence.json)覆盖清单中的117张角色卡：这些角色卡均采用 CCv3 `3.0` 格式，内嵌世界书包含5043个条目，正则包含444条规则。核对使用的本机 SillyTavern 为 `1.18.0`，提交为 `51ad27fb86d39a3daca3adaa970375c9670c12df`。

## 3. 面临的问题

### 3.1. 执行负担与错误发现顺序

1. 字段决策混入大量结构枚举，Agent 花费时间填写路径，而维护负责人需要检查的是内容用途和转换位置。
2. Agent 编写大型生成脚本、反复修改脚本再生成产物，增加了调试对象；记录中的规则文字还被改写为摘要。
3. 包校验和正式导入通过后，运行阶段才发现模块资源超限、前端注册缺失和状态 schema 重复注册。Agent 因此反复打包、导入和启动页面。
4. Skill 允许转换 Agent 编写辅助脚本，却没有预置原文复制和包文件写入工具，也没有区分卡内程序与包生成程序。临时生成器因此混入了字段分类、卡内逻辑和文件拼接。

### 3.2. 转换错误与未验证事项

1. 转换位置或消费绑定错误：`sourceEntries` 只保存来源信息，状态服务未读取对应世界书正文，导致规则没有进入状态请求。
2. 删除遗漏：旧变量写入指令仍进入正文模型提示，正文模型仍承担变量更新职责。
3. 原文改写失真：状态规则被摘要替代，丢失日期及结局条件。
4. 程序逻辑转写错误：结局保护条件缺失，历史选项显示与发送内容不一致。
5. 格式或运行错误：第3.1节第3项所列错误阻碍后续检查。
6. 真实模型语义检查尚未执行，现有证据无法判断模型是否误解正确转换后的内容。

## 4. 解决和实施方案

1. 本章规定执行者需要实现的字段处理规则和脚本接口，脚本改动尚未实施。
2. 本章的 `SKILL.md` 和 `references/` 路径相对于仓库内 `.agents/skills/native-card-conversion/`；工具源码和测试位于仓库的 `scripts/native-card-conversion/`。

### 实施约束

1. 执行者不得设计或新增任何程序门禁（由程序决定是否允许继续转换、打包或交付的逻辑），不得设计或新增任何 hashing 门禁或校验逻辑。
2. 执行者不得设计转换记录的自动生成、强制保存、保存校验、schema 校验、字段覆盖检查或完成度判定；不得根据转换记录决定是否允许继续转换、打包或交付。执行者删除现有工具中的这些逻辑。
3. 主代理继续保存维护测试的请求结果、产物、截图和逐项结论。转换工具使用已有正式包校验及正式导入接口。

### 4.1. 各阶段脚本如何帮助 Agent

1. 本节命令路径相对于 Skill 目录。写入命令的目标文件路径相对于 `packageDirectory`；返回的实际文件路径使用绝对路径。
2. 维护负责人将 `SKILL.md` 的执行顺序改为：读取与预检、Agent 语义判断、固定工具写入、文件登记、校验打包、正式联调、交付。

#### 4.1.1. begin：完成直接复制并列出待判断内容

1. 作用：`begin` 脚本将第4.2.1节规定的直接复制字段写入 `character.json`，并定位需要 Agent 判断用途的内容。
2. 调用时机与输入：转换 Agent 开始转换用户指定的单个 PNG 或 JSON 角色卡文件时调用 `begin`。计划执行者将调用方法写入 SKILL.md 第1章。
3. 返回结果：计划执行者按[转换工具第1章的 begin](../../../.agents/skills/native-card-conversion/references/tools.md#begin复制人物字段并定位待判断内容)规定的返回字段实现 begin。

#### 4.1.2. read：取得源字段原文及片段位置

1. 计划执行者按[转换工具第1章的 read](../../../.agents/skills/native-card-conversion/references/tools.md#read读取指定源内容)实现 `read`。
2. 转换 Agent 根据读取的源内容，判断需要保留、删除或拆分的内容及其目标文件。

#### 4.1.3. map-entry：写入 Agent 选择保留的世界书条目

1. 计划执行者按[转换工具第1章的 map-entry](../../../.agents/skills/native-card-conversion/references/tools.md#map-entry写入已选择保留的世界书条目)实现命令。
2. 转换 Agent 决定条目的用途和正文处理方式后，使用该命令写入固定配置。

#### 4.1.4. map-regex：写入 Agent 选择保留的正则

1. 作用：Agent 判断哪些规则仍应作为正则后，脚本转换这些规则的固定字段格式并保持源顺序。
2. 调用时机与输入：Agent 完成规则用途判断后，调用 `node scripts/convert.mjs map-regex "<taskFile>" "<源正则数组 JSON Pointer>" "<目标正则文件>" --indices "<逗号分隔的源序号>"`。
3. 返回数据：命令返回实际写入文件的路径和具体字段问题。

#### 4.1.5. copy：将选定源内容原样写入目标

1. 作用：脚本根据 Agent 指定的源位置和目标位置复制内容，保持文字、HTML、CSS 及其他有效原文。
2. 调用时机与输入：Agent 确定目标位置后，调用 `node scripts/convert.mjs copy "<taskFile>" "<源 JSON Pointer>" "<目标文件>"`。写入 JSON 字段时添加 `--target-pointer "<目标 JSON Pointer>"`；复制字符串片段时同时添加 `--start <起点>` 和 `--end <终点>`，位置使用 `read` 的返回值。
3. 返回数据：命令返回实际写入文件的路径；写入 JSON 字段时同时返回目标 JSON Pointer，执行失败时返回具体错误。

#### 4.1.6. parse：将 Agent 识别的初始化数据写为 JSON

1. 作用：Agent 识别 JSON 或 YAML 数据后，脚本完成语法解析和 JSON 写入。
2. 调用时机与输入：Agent 确定数据片段后，调用 `node scripts/convert.mjs parse "<taskFile>" "<源 JSON Pointer>" "<目标文件>" --format <json或yaml>`。片段及目标字段参数沿用第4.1.5节。
3. 返回数据：命令返回实际写入文件及适用的目标 JSON Pointer；解析失败时返回具体错误。

#### 4.1.7. index：登记已经写入的包文件

1. 作用：脚本根据实际包文件生成根 `manifest.json`。
2. 调用时机与输入：Agent 完成角色包文件后，调用 `node scripts/convert.mjs index "<taskFile>"`；启用角色前端时添加 `--frontend "frontend/manifest.json"`。
3. 返回数据：命令返回根 manifest 的实际路径、登记文件数量及具体文件或引用问题。

#### 4.1.8. 使用已有检查及联调命令

1. 转换 Agent 继续使用现有 `validate`、`pack`、`formal`、`preview` 和 `resume`；命令用法见 Skill 的 `references/tools.md`。同一个转换 Agent 执行正式导入、回读及适用联调，运行错误按第4.3节复核。

### 4.2. 计划执行者需要实现的内部规则

#### 4.2.1. 源结构、直接复制字段及待判断内容

1. 实现位置：执行者在 `scripts/native-card-conversion/source.ts` 实现 `begin/read`。`begin` 在现有固定输出根下建立任务目录，保存唯一源正文副本；第4.1.1节的结果直接在命令返回中提供。
2. 字段根：`spec` 为 `chara_card_v3`、`spec_version` 为 `3.0`，或 `spec` 为 `chara_card_v2`、`spec_version` 为 `2.0` 时，使用 `data`；无版本封装的旧卡使用根对象。未知版本及结构异常返回具体问题。
3. 直接复制：源 `name`、`creator`、`character_version`、`tags`、`nickname`、`source` 分别写入 `character.json` 的 `name`、`creator`、`characterVersion`、`tags`、`nickname`、`source`。脚本按正式人物 schema 确认值的类型，保持原值，写入后加入 `written`。缺失可选字段保持未写入，类型不适配的字段加入 `pending` 并返回具体问题。
4. 人物文字：源 `description`、`personality`、`scenario`、`mes_example`、`system_prompt`、`post_history_instructions`、`creator_notes` 对应目标 `description`、`personality`、`scenario`、`exampleDialogue`、`systemPrompt`、`postHistoryInstructions`、`creatorNotes`。脚本按内置特征规则检测文字，命中时将字段及命中片段加入 `pending`，未命中且类型正确时原样写入目标字段。Agent 阅读命中的内容，决定保留、删除、拆分或转写。
5. 开场：`first_mes`、`alternate_greetings`、`group_only_greetings` 的各开场加入 `pending`。Agent 判断故事或介绍、正文片段和初值，写入 `openings.json` 及对应原文文件；标题或摘要缺少源内容时填写空字符串。
6. 世界书：`character_book.entries` 的每个条目加入 `pending`，由 Agent 判断正文属于提示内容、初始化、变量规则、前端或后端功能，还是应删除的旧插件协议。程序仅定位条目及其配置字段。
7. 正则：`extensions.regex_scripts` 的每条规则加入 `pending`。Agent 阅读匹配文本、替换文本和执行条件，判断保留正则、转为前端、转为后端或删除；程序按结构定位规则。
8. 助手：`extensions.tavern_helper` 为对象时，定位 `scripts` 和 `variables`；为二元组数组时，读取键为 `scripts` 或 `variables` 的成员值。脚本及变量加入 `pending`，由 Agent 判断职责与目标位置；结构异常返回具体问题。
9. 其他内容：未列出的扩展、时间字段及媒体引用加入 `pending`，由 Agent 判断用途和资源是否完整。待判断对象按人物字段、开场成员、条目、规则、脚本或扩展对象列出。

#### 4.2.2. 世界书条目配置的固定转换

1. 实现位置：执行者在 `scripts/native-card-conversion/write.ts` 实现 `map-entry`。条目用途及正文写入方式采用第4.1.3节的 Agent 输入。
2. 基础字段：`keys` 转为 `key`，`secondary_keys` 转为 `keysecondary`，`insertion_order` 转为 `order`；`selective`、`constant` 和字符串 `comment` 保持原值，`enabled` 转为相反的 `disable`。目标不接受的类型返回具体问题。
3. 位置：非 null 的 `extensions.position` 优先写入目标 `position`；否则源 `position` 的 `before_char` 转为 `0`，`after_char` 转为 `1`。角色、深度和位置的枚举使用正式目标定义。
4. 扩展配置：本项列出的源字段均取自条目的 `extensions` 对象。`selectiveLogic`、`depth`、`role` 保持字段名；`scan_depth`、`case_sensitive`、`match_whole_words`、`exclude_recursion`、`prevent_recursion`、`delay_until_recursion`、`outlet_name` 分别转为 `scanDepth`、`caseSensitive`、`matchWholeWords`、`excludeRecursion`、`preventRecursion`、`delayUntilRecursion`、`outletName`。递归延迟布尔值 `false` 转为 `0`，`true` 转为 `1`；合法非负整数保持原值。
5. 源消费者缺省值：缺少次级关键词时使用空数组；`selective`、`constant`、`excludeRecursion`、`preventRecursion` 使用 `false`；`selectiveLogic`、`role`、`delayUntilRecursion` 使用 `0`；深度使用 `4`；`scanDepth`、`caseSensitive`、`matchWholeWords` 使用 `null`；`comment`、`outletName` 使用空字符串。
6. UID：脚本先将同一本书的非负整数 ID，以及缺失 ID 条目从 0 开始的源成员序号，预留为目标 UID；这些整数重复时，返回具体问题。脚本再按源顺序为字符串 ID 分配最小未占用非负整数，并将分配结果写入对应条目的 UID。
7. 已有运行扩展：`probability`、`useProbability`、`group`、`group_override`、`group_weight`、`triggers`、`delay`、`match_persona_description`、`match_character_description`、`match_character_personality`、`match_character_depth_prompt`、`match_scenario`、`match_creator_notes`、`ignore_budget` 按原键写入目标 `extra.extensions`，使用正式扩展 schema 及现有消费者处理。
8. Agent 处理范围：其他扩展字段以及书级 `scanDepth`、`caseSensitive`、`matchWholeWords`、`recursive`、`maxRecursionSteps` 由 Agent 按源内容及正式格式确定。条目名称为数组等目标不接受的类型时，Agent 判断名称及实际引用关系。

#### 4.2.3. 保留正则的固定转换

1. 实现位置：执行者在第4.2.2节的实现文件中实现 `map-regex`。脚本只选取 Agent 指定的源序号，保持源数组顺序。
2. 复制字段：`id`、`scriptName`、`findRegex`、`replaceString`、`trimStrings`、`placement`、`disabled`、`markdownOnly`、`promptOnly`、`runOnEdit`、`minDepth`、`maxDepth` 保持原值。
3. 格式转换：布尔值 `substituteRegex` 的 `false` 转为 `0`，`true` 转为 `1`；数值枚举使用正式适配器定义。缺少 `trimStrings` 时使用空数组，缺少 `substituteRegex` 时使用 `0`。
4. 标识：缺失 ID 时，脚本以 `regex-<源序号>` 作为候选 ID；候选 ID 已被源规则或本次生成的 ID 占用时，脚本递增数字，直至找到未占用的 ID。已有重复 ID 时返回具体问题。

#### 4.2.4. 原文复制与数据解析

1. 实现位置：执行者在第4.2.2节的实现文件中实现 `copy/parse`。脚本按 Agent 传入的源 JSON Pointer 读取值，根据目标字段参数写入 JSON 字段或独立文件。
2. 写入：`copy` 将字符串写为 UTF-8 文本，其余 JSON 值写为 JSON；指定目标 JSON Pointer 时写入该字段。`parse` 使用内置 JSON 解析器或 `apps/api/package.json` 已声明的 `yaml 2.9.1`，将结果写为 JSON。
3. 片段：脚本按第4.1.2节的索引取得选定原文，完成目录创建、文本写入及 JSON 序列化；片段越界、字符被截断、路径越界或解析失败时返回具体错误。

#### 4.2.5. 文件登记

1. 实现位置：执行者在 `scripts/native-card-conversion/index.ts` 实现 `index`，复用正式文件规则的匹配实现。任务 ID 用作 `packageId`，格式版本及人物、开场入口使用正式包定义。
2. 登记内容：脚本按实际文件生成根 `manifest.json.files`，根 manifest 自身不列入数组，前端入口按显式参数写入；`purpose` 和 `mediaType` 使用正式文件规则。
3. 问题返回：无法匹配规则的文件、重复路径、缺少必需文件或引用目标不存在时，脚本返回具体问题。

### 4.3. 运行错误复核

1. 转换 Agent 调用已有正式接口，读取模块加载、前端挂载及状态更新的实际错误，修正对应产物。
2. 正式后端错误按现有 API 授权流程处理：维护负责人提交现有接口不足、修复位置及验收方法，待批准后实施后端修改。

### 4.4. 减少重复阅读和联调

1. 维护负责人修改 `SKILL.md`、`references/sources.md` 和 `references/tools.md`，把每个读取入口限定到当前需要解决的问题：架构用于判断职责，格式用于写文件，API 用于具体接口，工具文档用于调用命令。
2. 转换 Agent 分段读取单个源 JSON 中正在处理的字段和条目。上下文恢复时，Agent 从已有目标文件及会话中的工具结果继续，按未完成事项读取源内容及接口章节。
3. 转换 Agent 在完成语义判断和文件写入后，集中检查当前产物，按同一份完整诊断修正格式及引用，再打包并执行正式导入和回读。修改产物后仅重做受影响的检查。
4. 转换 Agent 在同一预览会话中执行当前 ZIP 的适用检查。发生阻断错误时保存诊断，完成其他独立检查，并记录失败和未执行项。

### 4.5. 实施顺序与一次复测

1. 执行者按第4.1节的协作流程和第4.2节的实现规则开发工具，完成第4.3、4.4节的测试和文档修订。开发遵守 `skill-creator` 与 `writing-for-agents`。
2. 维护负责人为新增确定性工具编写测试，覆盖通过、失败及边界分支；按仓库要求派发新的干净上下文审计队员，逐行审计改动后的文字。维护负责人执行工具测试及适用项目检查，修复发现的问题后，使用 `code-review` 审阅本次改动。
3. 主代理通过 `team-mode` 创建一个 `fork_turns="none"` 的转换子代理，任务消息严格只有：`调用 $native-card-conversion（Skill：〈实际 SKILL.md 路径〉）转换角色卡〈林茜单个输入 JSON 的实际路径〉。` 主代理在执行期间不追加指导。
4. 主代理检查子代理可见分析、工具调用与返回、文件改动和产物，随后按第6章验收。测试结束后，主代理提交问题分层、根因及下一次迭代建议。
5. 维护负责人将复测报告保存在本方案所在维护目录，更新第2章第6项清单中本次输入的状态；受本次改动影响的已通过卡加入后续回归队列。

## 5. 方案待决策项清单

1. 本方案当前没有新增待决策项。

## 6. 计划验收清单

### 6.1. Skill 与工具改动

1. 主代理确认预检脚本按第4.2节的映射规则处理确定性字段，将混合文本、未知扩展及类型错误正确列入对应结果；对条目用途、代码职责和删除范围的判断由 Agent 作出。
2. 主代理确认工具实现符合第4章的实施约束；架构、文件映射、语义经验、API 和工具文档各自用途清晰。
3. 主代理核对有效文字、HTML、CSS 的解析后内容与源片段一致；拆分内容逐段对应，宏和程序转写分别检查。
4. 主代理核对正式接口的模块加载、前端挂载及状态更新结果，确认工具测试及适用项目检查通过。

### 6.2. 一次角色卡复测

1. 主代理确认输入为单个 JSON、子代理上下文干净、派发消息符合第4.5节，源卡、Skill、API、schema 和正式文档的只读边界得到遵守。
2. 主代理分别记录第3.2节各层问题的结果，逐项复查上次6项失败；通过结论引用源片段、目标文件和实际消费证据。
3. 主代理核对正式包校验、ZIP 导入和逐文件回读；页面验收检查内容、最小可用布局、状态栏及适用操作。
4. 主代理按第2章第6项清单检查历史选项、变量状态归属、画廊、解锁、滚动、弹窗、发送锁及失败恢复。提示组装优先使用正式 dry-run；模型输出验收使用已有授权的真实模型，并分别保存请求、响应、正文和状态结果。
5. 主代理记录转换 Agent 的完整 Skill 耗时、各阶段耗时、工具调用次数、上下文压缩次数、重做次数、累计 token 和模型费用；费用数据缺失时明确标注。前后比较采用相同执行主体、任务范围和计时起止点。
6. 主代理对全部适用项分别填写通过、失败或未执行。正确性与第1章的效率目标分别判定；真实模型语义检查保留实际结论。

## 7. 非本次目标

1. 完整复刻 UI、系统新增工具及包自定义工具分别按专项授权处理。
2. 状态 Agent 的完整预设与上下文组装由[状态组装架构方案](../verbatim-state-assembly/architecture-proposal.md)处理，其实施仍待批准。
3. 第2章第6项清单的剩余角色卡转换和受影响卡回归在后续阶段执行。

## 8. 已获得的授权

1. 用户已授权在既有 worktree `/srv/tavern/TavernHeadless-remove-preview-credentials`、分支 `codex/native-card-converter-design` 维护 Skill，保留其他改动并精确选择本次提交文件。
2. 用户已授权完善语义识别、原文保留、目标文件映射、确定性工具及内置完整 API 文档，并要求遵守既定开发 Skill 和独立语义审计规则。
3. 用户已要求林茜卡使用一个新的干净上下文子代理测试一次，由主代理检查过程、区分问题层次并提出迭代方案。
4. 用户本次要求针对耗时及失败复盘形成改进方案。后端接口修复的授权流程见第4.3节第2项。
5. 用户已决定排除包含独立手机会话与历史、原子恢复剧情及完整变量逻辑的角色卡；维护负责人按原维护计划继续处理其余清单项。
