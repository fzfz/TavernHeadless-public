---
文档用途: 记录正文与状态更新在指定提交中的源码事实、数据来源和处理行为。
读取时机: 核对当前实现或为改动评估提供源码依据时。
---

<!-- markdownlint-disable MD013 -->

# 正文与状态提示词组装调研

## 1. 核对范围与证据基线

1. 本文依据目标 worktree 的提交 `254f70b623ddd2ddf11aa9e8b0ceda497227b3c5`，核对正式正文聊天调用链、状态更新服务、共享组装器、SillyTavern 适配器、PromptGraph 编译器及 PromptIR 消息构建器。
2. 本文中的“实际聊天主链”指 `ChatService` 经 `PreparedTurnContextBuilder`、`PreparedPromptArtifactsBuilder` 进入 `assemblePrompt`，再把物化后的消息交给 `TurnOrchestrator` 的路径。源码入口：`apps/api/src/services/chat/chat-service.ts:2295`、`apps/api/src/services/chat/prepared-turn-context-builder.ts:93`、`apps/api/src/services/chat/prepared-prompt-artifacts-builder.ts:447`。
3. 本文区分进入 `messages` 的文本、进入模型请求其他字段的数据、用于选择与变换的配置，以及追踪或业务控制数据。数据类型声明表示支持能力；调用参数表示主链实际接入情况。

## 2. 正式聊天主链的准备与交付

### 2.1. 会话资源、模型和执行上下文

1. `TurnModelService.buildSessionPromptInfo` 从会话或分支绑定取预设、世界书、正则及固定版本；正文模型槽位可覆盖预设 ID。预设来源改变后，旧绑定的预设版本 ID 不再沿用。该方法保留角色快照、角色版本、人设快照和 `promptMode`，并合入第一方状态元数据。源码：`apps/api/src/services/chat/turn-model-service.ts:74`。
2. `PreparedPromptArtifactsBuilder` 使用正文 `narrator` 槽位解析生成参数、assistant prefill 能力、工具、工具传输和记忆写入设置。正文模型槽位的选择属于这一准备层；`assemblePrompt` 本身接收 token 计数器与预算覆盖参数。源码：`apps/api/src/services/chat/prepared-prompt-artifacts-builder.ts:240`、`apps/api/src/services/prompt-assembler.ts:785`。
3. 楼层图通过 `resolvePromptRecipe` 提供 `narratorPresetRef`，主链将它作为 `presetRefOverride` 传给组装器；世界书与正则仍取会话信息中的绑定。源码：`apps/api/src/services/chat/prepared-prompt-artifacts-builder.ts:399`、`apps/api/src/services/chat/prepared-prompt-artifacts-builder.ts:486`、`apps/api/src/services/prompt-assembler.ts:797`。
4. `nativePromptBridge` 与 `compatPromptBridge` 控制组装的承载方式和影子比对。当前 `NodeGraphTurnProcessor.execute` 仍调用同一个 `composePromptModeIr` 闭包生成 IR；它没有按不同业务任务改写数据来源。源码：`apps/api/src/services/prompt-assembler.ts:1185`、`apps/api/src/services/agent-runtime/node-graph-turn-processor.ts:114`。

### 2.2. 输入和历史的准备

1. 正式 `respond` 先保存用户消息，再通过 `RegexInputService.applyPersistedUserInputRegex` 执行 `persist.user_input`；文本变化时，该服务更新已保存消息的 `content` 与 token 数。历史读取因此得到保存通道处理后的用户文本。源码：`apps/api/src/services/chat/chat-service.ts:537`、`apps/api/src/services/chat/regex-input-service.ts:77`、`apps/api/src/services/chat/regex-input-service.ts:110`、`apps/api/src/services/chat-message-persistence.ts:88`。
2. `ChatHistoryLoader` 按楼层父链和替代关系选择可见祖先，应用楼层可见性及 `historyMaxFloors`，再读取活动 page 中未隐藏的消息。消息按楼层编号、page 编号和消息序号排序。源码：`apps/api/src/services/chat-history-loader.ts:171`、`apps/api/src/services/chat-history-loader.ts:189`、`apps/api/src/services/chat-history-loader.ts:224`。
3. `PromptPreparationService.loadPromptRuntimeConversationWindow` 把当前输入加入历史条目后进行正规化。正规化合并相邻 user 消息及同楼层相邻 assistant 消息，保留来源楼层、page、消息 ID；跨楼层相邻 assistant 产生诊断。源码：`apps/api/src/services/chat/prompt-preparation-service.ts:97`、`apps/api/src/services/chat/conversation-history-normalizer.ts:53`。
4. 历史窗口按正规化后的消息数量选择；末尾 user 被拆成 `effectiveUserMessage`，其他消息组成 `history`。末尾 assistant 则完整留在 `history`。旧的 `loadPromptRuntimeHistoryWindow` 直接按消息数组裁切，与正规化窗口的消费位置不同。源码：`apps/api/src/services/chat/conversation-history-normalizer.ts:94`、`apps/api/src/services/chat/prompt-preparation-service.ts:79`、`apps/api/src/services/chat/prompt-preparation-service.ts:128`。
5. 准备层把 `conversationState.history` 与 `effectiveUserMessage` 分开传给共享组装器；共享组装器再构造包含当前 user 的完整消息序列。源码：`apps/api/src/services/chat/prepared-prompt-artifacts-builder.ts:232`、`apps/api/src/services/chat/prepared-prompt-artifacts-builder.ts:447`、`apps/api/src/services/prompt-assembler.ts:2417`。

### 2.3. 共享组装、交付和生成后处理

1. 共享组装器依次读取资源、解析来源开关、读取快照、解析变量、渲染角色控制器、准备宏、执行提示输入正则、触发世界书、按 `promptMode` 构造 IR、应用结构化注入、执行预算和消息构建，再处理延后注入与模式相关的后置文本。源码：`apps/api/src/services/prompt-assembler.ts:795`、`apps/api/src/services/prompt-assembler.ts:979`、`apps/api/src/services/prompt-assembler.ts:1062`、`apps/api/src/services/prompt-assembler.ts:1127`、`apps/api/src/services/prompt-assembler.ts:1279`、`apps/api/src/services/prompt-assembler.ts:1346`。
2. `materializePromptRuntimeMessages` 在上述组装结果上应用结构策略与交付策略，处理 assistant prefill。准备层将这一结果的 `messages` 放入 `TurnInput`。源码：`apps/api/src/services/chat/prepared-prompt-artifacts-builder.ts:498`、`apps/api/src/services/prompt-assembler.ts:2584`、`apps/api/src/services/chat/prepared-turn-context-builder.ts:151`。
3. `TurnOrchestrator` 将消息、模型、生成参数、工具、工具选择和流式设置分别交给 `GenerationPipeline`。纯文本消息最终归一化为 `{ role, content }`；模型请求还可包含结构化工具往返消息。源码：`packages/core/src/orchestration/turn-orchestrator.ts:1097`、`packages/core/src/generation/generation-pipeline.ts:95`。
4. 正文输出正则属于生成后处理。`GenerationPipeline` 保存 `rawText`，提取摘要得到 `cleanedText`，再调用 `postProcess` 得到最终正文；组装器提供的闭包执行 `persist.ai_output`。源码：`apps/api/src/services/prompt-assembler.ts:1373`、`packages/core/src/generation/generation-pipeline.ts:139`。
5. 助手持久化文本由 `generatedText` 与工具结果写回文本组合；历史读取 `messages.content`，不会重新读取供应商原始输出。源码：`apps/api/src/services/turn-commit-service.ts:255`、`apps/api/src/services/chat/chat-service.ts:2519`、`apps/api/src/services/chat-history-loader.ts:234`。
6. 支持矩阵将 `MD_DISPLAY` 标为可执行，提示流水线执行 `USER_INPUT` 与 `AI_OUTPUT`。角色正文的完成阶段投影由第9.3节所列消费者处理。源码：`apps/api/src/services/prompt-runtime/regex/support-matrix.ts:25`、`apps/api/src/services/prompt-runtime/regex/support-matrix.ts:70`、`apps/api/src/services/prompt-runtime/regex/phase-contract.ts:14`。

## 3. 数据来源及实际用途全表

1. 下表按照当前实现列出独立的数据来源和处理输入。某行配置既可控制选择，也可通过宏或渲染结果成为消息文本；表中写明两条路径。

| 数据来源 | 准备与选择 | 对最终请求的作用 | 源码证据 |
| --- | --- | --- | --- |
| 预设的任意静态条目文本 | `parsePreset` 选择活动 `prompt_order` 轨道，只把启用标识放入 `promptOrder`；条目的 trigger 再按 intent 选择 | compat 生成任意标识的 section；native 生成 static text 节点，指定消息 role | `packages/adapters-sillytavern/src/parsers/preset-parser.ts:476`；`packages/adapters-sillytavern/src/compat-assembler.ts:271`、`:427`；`packages/adapters-sillytavern/src/preset-to-native-group.ts:104` |
| 预设 marker、条目位置、顺序、角色和语义设置 | `behavior.placement`、`behavior.triggers`、`behavior.semantics`，以及活动轨道顺序 | marker 决定数据节点位置；in-chat 指定深度；角色指定消息 role；兼容路径用 `forbidOverrides` 判断角色系统提示 | `packages/adapters-sillytavern/src/parsers/preset-parser.ts:262`；`apps/api/src/services/prompt-assembler.ts:1605`；`packages/core/src/prompt-graph/compiler.ts:47` |
| 预设格式和续写配置 | `wiFormat`、`namesBehavior`、`continueNudgePrompt`、`assistantPrefill` | compat 世界书 before/after 等分区使用 `wiFormat`；姓名前缀按配置添加；native 的 continue intent 添加 nudge；prefill 在交付时处理 | `packages/adapters-sillytavern/src/compat-assembler.ts:154`；`packages/adapters-sillytavern/src/preset-to-native-group.ts:313`；`packages/core/src/prompt-graph/compiler.ts:557`；`apps/api/src/services/prompt-assembler.ts:2494` |
| 角色姓名、描述、性格、场景 | 会话 `characterSnapshotJson` 解析和文本正规化 | 姓名参与宏和前缀；其余通过预设数据占位或 native 基础节点成为消息文本；无预设分支仅组合描述、性格和人设描述 | `apps/api/src/lib/character-snapshot.ts:127`；`apps/api/src/services/prompt-assembler.ts:1098`、`:1149`、`:1590` |
| 角色 systemPrompt、postHistoryInstructions | 角色系统提示先通过 ST 宏求值；native 把两者交给对应节点，compat 后置注入 | systemPrompt 在 compat 第 1 个位置插入 system；postHistoryInstructions 在 compat 末尾追加 system；native 按节点顺序编译 | `apps/api/src/services/prompt-assembler.ts:912`、`:1349`、`:1618`、`:1635`；`packages/adapters-sillytavern/src/preset-to-native-group.ts:489` |
| 角色 exampleDialogue | examples 来源开关控制直接示例参数 | compat 与 native 通过示例数据节点进入消息；宏环境也提供 `mesExamples` 与 `mesExamplesRaw` | `apps/api/src/services/prompt-assembler.ts:1105`、`:1160`；`apps/api/src/services/prompt-runtime/macro/context-builder.ts:244` |
| 角色 creatorNotes、其他说明 | 作者说明进入宏环境，还可作为世界书扫描来源 | `charAuthorsNote`、`authorsNote` 等宏可把说明变成消息文本；没有单独自动追加所有 creatorNotes 的步骤 | `apps/api/src/services/prompt-runtime/macro/context-builder.ts:180`、`:254`；`apps/api/src/services/prompt-assembler.ts:1081` |
| 角色开场与候选开场 | 开场不属于 `assemblePrompt` 的直接参数；选定开场保存为历史消息后由历史入口参与 | 已保存开场通过 history 进入请求；greeting、alternateGreetings 等快照字段没有通用的直接渲染节点 | `apps/api/src/lib/character-snapshot.ts:3`；`apps/api/src/services/chat-history-loader.ts:234`；`apps/api/src/services/prompt-assembler.ts:1098`、`:1149` |
| 人设姓名与完整描述 | `userSnapshotJson` 优先于 `metadata.persona` | 姓名参与 user 宏和消息前缀；描述进入 persona 节点、宏及世界书扫描；native 描述增加 `The user is ...` 前缀 | `apps/api/src/services/prompt-assembler.ts:818`；`packages/core/src/prompt-graph/compiler.ts:300` |
| 会话世界书与角色内置世界书 | 普通角色合并两类来源；原生包存在时只用启用的包内固定世界书，按绑定 ordinal 加载 | 激活条目的文本按 before/after、作者注、示例消息、深度、outlet 位置进入消息 | `apps/api/src/services/prompt-resource-loader.ts:186`；`apps/api/src/services/prompt-assembler.ts:2863`、`:3054` |
| 世界书触发配置与扫描资料 | 最近消息、persona/角色描述、性格、场景、作者说明、深度提示；启用、key、secondary key、递归、delay、trigger、分组与概率参与选择 | 配置决定条目是否激活；配置本身不自动作为请求文本；激活来源和决策形成追踪 | `apps/api/src/services/prompt-assembler.ts:1071`；`packages/adapters-sillytavern/src/worldbook/trigger-engine.ts:764` |
| 角色 promptController | 按角色固定版本加载模块，把指定变量根和 characterBook 交给 `renderController`；禁用 updater 条目并替换 variableMacros | 控制器结果替换世界书条目 `content`，随后按正常世界书触发和组装路径进入文本 | `apps/api/src/services/prompt-assembler.ts:831`；`apps/api/src/services/role-prompt-controller.ts:10` |
| 会话、分支、楼层、page 和全局变量 | `VariableService.resolveSnapshot` 返回合并值及分层值；local 取 branch 或 chat，global 单独保留 | 变量经宏、正则替换或控制器引用后形成文本；变量快照本身不自动整体追加 | `apps/api/src/services/prompt-assembler.ts:1515`；`apps/api/src/services/chat/regex-input-service.ts:120` |
| 宏上下文与宏状态变更 | 角色、人设、预设文本、模型名称、日期时间、预算、summary、最近消息和 runKind 构成只读宏值，覆盖同名普通变量；ST 宏可产生暂存变更 | 渲染后的文本进入消息；warning、usedMacros、mutationPreview、stagedMutations 和 traces 分别进入追踪或后续提交 | `apps/api/src/services/prompt-runtime/macro/context-builder.ts:18`、`:134`、`:214`；`apps/api/src/services/prompt-assembler.ts:890`、`:1440` |
| 活动历史消息 | 可见性、来源分支、楼层窗口、正规化窗口及预算分别处理 | user/assistant 保留文本角色；当前 compat 和 native 历史节点均过滤 system；无预设分支保留 system | `apps/api/src/services/chat-history-loader.ts:171`；`apps/api/src/services/chat/conversation-history-normalizer.ts:94`；`apps/api/src/services/prompt-assembler.ts:1011`、`:1590`；`packages/core/src/prompt-graph/compiler.ts:324` |
| 本轮 user 输入 | 准备层使用保存正则处理后的文本，末尾相邻 user 可能正规化合并；组装器再次执行 prompt 通道输入正则 | 组装器无条件追加为 user，同时提供世界书扫描与最近消息宏的原始组装输入 | `apps/api/src/services/chat/prepared-prompt-artifacts-builder.ts:195`、`:232`；`apps/api/src/services/prompt-assembler.ts:862`、`:994`、`:2417` |
| 记忆摘要、fact、open_loop | 准备层调用 MemoryStore，按账户及可见 scope 检索，最多 500 tokens、24 items、最低 importance 0.35；启用 dual summary 时切换检索策略 | formattedText 作为 memorySummary 交给组装器；native memory 节点渲染，strict 后置插入；compat_plus 当前差异见第 8 节 | `apps/api/src/services/memory/injection/turn-memory-injection-service.ts:29`、`:67`；`apps/api/src/services/chat/prepared-prompt-artifacts-builder.ts:299`；`apps/api/src/services/prompt-assembler.ts:1346` |
| 记忆选择、来源、计数与写入策略追踪 | `memoryRuntimeTrace` 与 memory contributor payload 保留检索结果说明 | 主要进入 runtimeTrace 与检查视图；memory projection 不再映射为第二份组装 renderable，summary 另走记忆入口 | `apps/api/src/services/chat/prepared-prompt-artifacts-builder.ts:309`；`apps/api/src/services/chat/prompt-runtime-contributors.ts:219` |
| 第一方 scene/world 状态 | `FirstPartyStateContextService` 按会话、分支或来源楼层读取；built-in state projection 提取 generatedText、summaries、worldbook 信息及来源字段 | compat_plus/native 形成 `Managed state projection` 文本；strict 的 contributor runner 不产生该投影 | `apps/api/src/services/chat/first-party-state-context-service.ts:22`；`apps/api/src/services/chat/prompt-runtime-contributors.ts:81`；`apps/api/src/services/chat/prompt-runtime-contributor-runner.ts:45` |
| 正则资源 | 普通会话使用 regexProfile；原生包用按 ordinal 排序的固定 regexProfiles，并替代会话单一正则来源 | 保存 user、提示 user、保存 assistant 各通道改写文本；世界书正则阶段保留为 reserved；显示通道见第 2.3 节 | `apps/api/src/services/chat/regex-input-service.ts:50`；`apps/api/src/services/prompt-assembler.ts:254`、`:979`、`:1362`；`apps/api/src/services/prompt-runtime/regex/phase-contract.ts:14` |
| request/session/branch 注入 | 准备层读取持久注入并合并请求注入；builder 处理启用、TTL、modeScope、位置、限额与顺序 | 普通锚点形成 IR system section；延后锚点在 MessageBuilder 后追加 system；sourceChain 和原因进入 trace | `apps/api/src/services/chat/prepared-prompt-artifacts-builder.ts:327`；`apps/api/src/services/chat/prompt-runtime-injection-contributor-builder.ts:70`；`apps/api/src/services/prompt-assembler.ts:1857`、`:2210` |
| pre_response Agent 的 contributor | 仅开启 inline_mvp 时执行；aggregator 汇总成功 Agent 输出，主链只传 `aggregated.contributors` | compat_plus/native 进入 contributor renderable，或按选项改走 agent_injection；strict 只保留工具类白名单 | `apps/api/src/services/chat/chat-service.ts:2273`、`:2333`；`apps/api/src/services/agent-runtime/agent-context-aggregator.ts:23`；`apps/api/src/services/chat/prepared-prompt-artifacts-builder.ts:339` |
| Agent 的独立约束、世界书和记忆 selection override | aggregator 除 contributors 外还产出 `narratorConstraints`、`worldbookSelectionOverride`、`memorySelectionOverride` | 正式调用仅传 contributors；这些独立字段没有在此调用中覆盖世界书或记忆入口 | `apps/api/src/services/agent-runtime/agent-context-aggregator.ts:77`；`apps/api/src/services/chat/chat-service.ts:2333` |
| 工具清单与调用协议说明 | narrator 槽位的工具权限及模型能力选择 text_protocol/native_function_call/none | 文本协议清单和调用说明可进入消息；原生 function call 的工具 schema 进入模型请求 `tools`，另外有协议说明 contributor | `apps/api/src/services/chat/prepared-prompt-artifacts-builder.ts:246`；`apps/api/src/services/chat/prompt-runtime-builtin-contributors.ts:134`；`packages/core/src/orchestration/turn-orchestrator.ts:1097` |
| 工具结果与重试前缀往返 | 编排层在模型工具循环中产生结果；step 重试可传 `priorRoundtrips` | 结构化工具消息或文本协议结果进入后续模型调用；PromptGraph 字段接入见第5.1节第2项 | `apps/api/src/services/chat/prepared-turn-context-builder.ts:169`；`packages/core/src/orchestration/agent-loop.ts:449`；`packages/core/src/prompt-graph/types.ts:165`；`apps/api/src/services/prompt-assembler.ts:1146` |
| Director 与 Verifier 输入和结果 | TurnInput 类型支持；编排器分别要求 enable 开关及对应 input | 独立调用与校验/重试控制；正式准备层构造的 TurnInput 没有 directorInput/verifierInput，结果也未自动回灌到正文 messages | `packages/core/src/orchestration/turn-orchestrator.ts:603`、`:1324`；`apps/api/src/services/chat/prepared-turn-context-builder.ts:151` |
| 模型、生成参数及请求能力 | 准备层读取已绑定模型及本次请求配置 | 模型配置控制请求字段，参数来源、覆盖规则和预算边界见第6.2节 | `apps/api/src/services/chat/turn-model-service.ts:154`；`packages/core/src/generation/generation-pipeline.ts:95` |
| 资源 provenance、快照、摘要标识和诊断 | 组装快照记录加载的资源、版本、激活、规则、hash、计数；检查服务补充策略与来源 | 用于检查、运行记录及持久化；这些字段不自动加入模型消息 | `apps/api/src/services/prompt-assembler.ts:920`、`:1406`、`:1464`；`apps/api/src/services/chat/prompt-preparation-service.ts:145` |
| 角色 tags、creator、version、assets、nickname 等快照字段 | 角色 schema 允许这些字段并保留其他扩展字段 | 正文组装传入的 character 参数取本节表格列出的角色资料字段，其余字段由具体消费者使用 | `apps/api/src/lib/character-snapshot.ts:3`；`apps/api/src/services/prompt-assembler.ts:1149` |

## 4. 三种现有组装策略

### 4.1. 策略与任务字段分别承担的行为

1. `promptMode` 的值只有 `compat_strict`、`compat_plus`、`native`，它控制 IR 构造策略。来源优先级为 session 字段、旧 metadata 字段、默认 strict。源码：`apps/api/src/services/prompt-assembler.ts:141`、`apps/api/src/services/prompt-assembler.ts:2439`。
2. `PromptRunIntent` 的共享枚举为 `normal`、`continue`、`impersonate`、`swipe`、`regenerate`、`quiet`。预设 `injection_trigger` 解析为 `behavior.triggers`；compat 与 native 都按 intent 判断，世界书也使用同一 intent。当前枚举没有状态更新值。源码：`packages/shared/src/config/prompt-intent.schema.ts:3`、`packages/adapters-sillytavern/src/parsers/preset-parser.ts:297`、`packages/core/src/prompt-graph/compiler.ts:47`、`packages/adapters-sillytavern/src/worldbook/trigger-engine.ts:780`。
3. `runKind` 表示 dry-run/respond/regenerate/retry，宏 `runKind` 与 `lastGenerationType` 均取该值。当前组装参数及 PromptGraph compiler input 没有独立 `generationType` 或业务任务分类字段。源码：`apps/api/src/services/prompt-assembler.ts:161`、`apps/api/src/services/prompt-assembler.ts:697`、`apps/api/src/services/prompt-runtime/macro/context-builder.ts:270`、`packages/core/src/prompt-graph/types.ts:156`。
4. `PreparedPromptArtifactsMode`、`FloorRunType` 和 carrier 分别描述准备服务调用方式、楼层运行类别和组装承载。它们与 `promptMode`、intent 分开传递；正文预设覆盖已经可以通过 `presetRefOverride` 表达。源码：`apps/api/src/services/chat/prepared-prompt-artifacts-builder.ts:118`、`apps/api/src/services/chat/prepared-prompt-artifacts-builder.ts:447`、`apps/api/src/services/prompt-assembler.ts:1185`。

### 4.2. IR、文本变换和来源处理对照

1. 下表列出主链真实使用的方式；各策略共同的准备顺序见第 2 节。

| 行为 | compat_strict | compat_plus | native | 源码证据 |
| --- | --- | --- | --- | --- |
| IR 构造 | `assembleCompat` | `assembleCompat` 后加 contributor 与记忆 section 能力 | 从预设生成 PromptGraph，再 `compilePromptGraph` | `apps/api/src/services/prompt-assembler.ts:1134`；`packages/adapters-sillytavern/src/compat-plus-assembler.ts:139` |
| 数据节点顺序 | 活动 `promptOrder` 的顺序索引 | 同 strict | `promptOrder` 每项递增 10，另外加入 native 基础节点 | `packages/adapters-sillytavern/src/compat-assembler.ts:271`；`packages/adapters-sillytavern/src/preset-to-native-group.ts:322` |
| 历史缺失 marker | 没有 chatHistory section 时不自动加入历史 | 同 strict | 自动添加 chat_history 节点 | `packages/adapters-sillytavern/src/compat-assembler.ts:407`；`packages/adapters-sillytavern/src/preset-to-native-group.ts:342` |
| 角色、人设缺失 marker | 根据现有 marker 生成资料 section | 同 strict | 为描述、性格、场景、人设增加基础节点 | `packages/adapters-sillytavern/src/preset-to-native-group.ts:438` |
| 角色系统提示与后历史指令 | MessageBuilder 后处理，角色 systemPrompt 受 forbidOverrides 控制 | 同 strict | 基础节点进入 IR；编译器的 character 分支直接取字段 | `apps/api/src/services/prompt-assembler.ts:1349`；`packages/core/src/prompt-graph/compiler.ts:252`；`packages/adapters-sillytavern/src/preset-to-native-group.ts:489` |
| 模板展开 | 预设、角色资料、世界书由 ST macroRuntime 展开；history 不展开宏 | 同 strict；额外 contributor 在适配器中仅加标题与 trim | compiler 通过 `TemplateEngine` 展开所有数据节点，包括 history/contributor；该引擎处理变量与默认值，不接收 ST macroRuntime | `packages/adapters-sillytavern/src/compat-assembler.ts:35`、`:407`；`packages/adapters-sillytavern/src/compat-plus-assembler.ts:77`；`packages/core/src/prompt-graph/compiler.ts:43`、`:324`；`packages/core/src/prompt/template-engine.ts:44` |
| 世界书 before/after 缺失 marker | 依赖预设 marker | 同 strict | 加入 before/after 基础节点 | `packages/adapters-sillytavern/src/preset-to-native-group.ts:355` |
| 作者注和示例消息位置的世界书 | 在活动预设遍历结束后追加四类 section | 同 strict | 四类基础节点放在 chatHistory order 之后的小偏移 | `packages/adapters-sillytavern/src/compat-assembler.ts:447`；`packages/adapters-sillytavern/src/preset-to-native-group.ts:381` |
| 世界书 depth/outlet | depth 取条目 role、depth、order；outlet 按对应预设标识定位 | 同 strict | depth 汇集同深度条目，outlet 可绑定 marker anchor | `packages/adapters-sillytavern/src/compat-assembler.ts:483`；`packages/core/src/prompt-graph/compiler.ts:358` |
| 世界书与示例预算 | 世界书 pinned，示例沿普通固定 section | 同 strict | registry 可裁剪世界书、示例；条目 ignoreBudget 可保持固定 | `packages/adapters-sillytavern/src/compat-assembler.ts:91`、`:391`；`packages/core/src/prompt-graph/compiler.ts:358`、`:402` |
| 记忆 summary | MessageBuilder 后在第 1 个位置插入 system | 当前正式调用的记忆摘要接入情况见第8.2节 | memory 节点按基础位置进入 IR | `apps/api/src/services/prompt-assembler.ts:1346`、`:1676`；`packages/adapters-sillytavern/src/compat-plus-assembler.ts:151`；`packages/adapters-sillytavern/src/preset-to-native-group.ts:502` |
| state/Agent contributor | 正式 runner 只保留 tool_list | contributor 放在 chatHistory 前，order 为 historyOrder−0.25+index×0.01 | contributor 节点默认 order 为 27.5+index×0.01 | `apps/api/src/services/chat/prompt-runtime-contributors.ts:40`；`packages/adapters-sillytavern/src/compat-plus-assembler.ts:87`；`apps/api/src/services/prompt-assembler.ts:1142` |
| 工具 contributor | MessageBuilder 后在首个 system 后加入文本 | 进入 contributor section | 进入 contributor 节点 | `apps/api/src/services/prompt-assembler.ts:1352`、`:1705` |
| continue nudge | 当前 assembleCompat 未添加该续写 section | 同 strict | intent=continue 时 compiler 在末尾加入 nudge | `packages/adapters-sillytavern/src/compat-assembler.ts:523`；`packages/core/src/prompt-graph/compiler.ts:557` |
| assistant prefill | 根据 intent、供应商能力及交付策略物化 | 同 strict | 同 strict | `apps/api/src/services/prompt-assembler.ts:2490`、`:2584` |

## 5. PromptGraph、PromptIR 与注入的通用数据形状

### 5.1. 共享节点与消息结构

1. PromptGraph 支持 static_text、variable_template、marker、chat_history、character、persona、worldbook、example_dialogue、memory、contributor、tool_result 共十一类节点；节点共同字段为 ID、名称、启用、role、trigger、placement 与 metadata。源码：`packages/core/src/prompt-graph/types.ts:14`、`packages/core/src/prompt-graph/types.ts:90`。
2. 正式正文入口向 `compilePromptGraph` 传入 `intent`、`variables`、`character`、`persona`、`chatHistory`、`worldbookEntries`、`exampleDialogue`、`memorySummary`、`maxTokens`、`reservedForReply` 和 `tokenCounter`。类型另支持可选 `toolResults`，当前调用未传该字段。源码：`packages/core/src/prompt-graph/types.ts:156`、`apps/api/src/services/prompt-assembler.ts:1146`。
3. PromptIR 的 section 使用 name、messages、pinned、budgetGroup、budgetPriority、order、insertion 与 semantic；IRMessage 使用 role、content、source、tokenCount、prunable、priority。metadata 只承载 token 预算、回复预留与 tokenizer。源码：`packages/core/src/prompt/types.ts:21`、`packages/core/src/prompt/types.ts:54`、`packages/core/src/prompt/types.ts:87`。
4. MessageBuilder 去除 IR 来源和预算元数据，仅输出 role/content 消息；来源和分区计数保留在 tokenUsage。源码：`packages/core/src/prompt/message-builder.ts:74`。

### 5.2. 结构化注入的已有位置与顺序

1. 现有注入位置包含 system、character、persona、worldbook、memory、examples、history、current_user_input、output_instruction、assistant_prefill 前后锚点，以及楼层、世界书深度、作者注和 contributor block。各位置的模式支持由 placement resolver 决定。源码：`apps/api/src/services/prompt-runtime-injection-types.ts:1`、`apps/api/src/services/chat/prompt-runtime-injection-contributor-builder.ts:89`。
2. 注入 builder 在组装前处理 enabled、TTL、modeScope、scope 数量、内容长度、单项 token 和合计 token 限额；排序顺序为位置、order、scope、source、持久创建时间和请求索引。trace 同时记录未应用原因。源码：`apps/api/src/services/chat/prompt-runtime-injection-contributor-builder.ts:125`、`apps/api/src/services/chat/prompt-runtime-injection-contributor-builder.ts:206`。
3. 可定位到 IR 的注入构造 `system` 消息，使用 client injection 预算组，消息 `prunable=false`；current_user_input.before/after 分别映射深度 1/0。楼层锚点依据 `historyFloorNos` 计算深度。源码：`apps/api/src/services/prompt-assembler.ts:1828`、`apps/api/src/services/prompt-assembler.ts:1961`、`apps/api/src/services/prompt-assembler.ts:2138`。
4. assistant_prefill.before 延后处理；output_instruction.before 在找不到 IR 锚点时也延后追加 system。延后操作发生在 MessageBuilder 之后，prefill 注入要求当前请求确有 prefill。源码：`apps/api/src/services/prompt-assembler.ts:1955`、`apps/api/src/services/prompt-assembler.ts:1993`、`apps/api/src/services/prompt-assembler.ts:2210`。

## 6. 预算、消息顺序与模型参数边界

### 6.1. 已有预算和深度行为

1. `maxInputTokens` 显式策略优先；否则组装器使用 context override、预设 maxContext 或默认 1000，再扣除回复预留。回复预留依次取策略、output override、预设 maxTokens 或 0。显式 budget.groups 才启用组间分配。源码：`apps/api/src/services/prompt-assembler.ts:743`、`apps/api/src/services/prompt-assembler.ts:773`。
2. TokenBudget 先统计 pinned section 与 non-prunable 消息为固定 token。固定文本超预算时，现有算法把可裁剪额度置为 0，保留固定文本；它没有抛出预算错误的分支。源码：`packages/core/src/prompt/token-budget.ts:98`、`packages/core/src/prompt/token-budget.ts:132`。
3. 可裁剪项按实际比较器优先保留较小 priority，同 priority 优先保留较后的全局位置。历史节点的 priority 为正序 index，因此较早历史具有更小 priority；这一实现与“旧历史先裁”注释不能等同。源码：`packages/core/src/prompt/token-budget.ts:237`、`packages/core/src/prompt/token-budget.ts:278`、`packages/adapters-sillytavern/src/compat-assembler.ts:417`、`packages/core/src/prompt-graph/compiler.ts:336`。
4. MessageBuilder 先裁剪，再按 section.order 排序；in-chat 深度按裁剪后历史消息数从尾部计算，越界深度夹到历史边界。同深度按 insertion.order、role 优先级 user/assistant/system、section.order 排序，最后合并相邻同 role 文本。源码：`packages/core/src/prompt/message-builder.ts:46`、`packages/core/src/prompt/message-builder.ts:160`、`packages/core/src/prompt/message-builder.ts:226`。
5. 延后注入、strict memory、compat 角色指令、strict 工具文本均在 MessageBuilder 预算处理后发生。最终 token 总数会重算，但这些后置文本不回到 IR 裁剪；组装器计数也发生在结构与 prefill 物化之前。源码：`apps/api/src/services/prompt-assembler.ts:1309`、`apps/api/src/services/prompt-assembler.ts:1346`、`apps/api/src/services/prompt-assembler.ts:1406`、`apps/api/src/services/chat/prepared-prompt-artifacts-builder.ts:498`。

### 6.2. 模型请求和业务控制

1. `TurnModelService.buildGenerationParamsResult` 合并 request 与 narrator 槽位参数，请求参数优先，null 可取消对应参数，模型能力决定参数是否可发送。该方法支持 temperature、maxOutputTokens、topP、topK、frequencyPenalty、presencePenalty、stopSequences、seed、repetitionPenalty、minP、logitBias、responseFormat、reasoningEffort 和 stream。maxContextTokens 被剥离后仅服务组装预算；本文核对的调用没有把预设的 temperature 等采样字段直接复制到请求。源码：`apps/api/src/services/chat/turn-model-service.ts:154`、`apps/api/src/services/chat/prepared-prompt-artifacts-builder.ts:578`。
2. structured tools、toolChoice、maxSteps、model 和 params 位于模型请求独立字段中；tool permissions、TurnConfig、consolidationContext、recording 和运行 observer 控制编排或追踪。它们只有经明确的 renderer/contributor 才成为消息正文。源码：`apps/api/src/services/chat/prepared-turn-context-builder.ts:151`、`packages/core/src/orchestration/turn-orchestrator.ts:1097`、`packages/core/src/generation/generation-pipeline.ts:95`。
3. `promptSnapshot` 标记组装阶段；结构合并、prefill 及最终 delivery trace 由物化与执行产物记录。源码：`apps/api/src/services/prompt-assembler.ts:185`、`apps/api/src/services/chat/prompt-preparation-service.ts:274`。

## 7. 当前 userMessage 对扫描、宏与消息的共同影响

### 7.1. 已确认的数据依赖

1. `assemblePrompt` 的 `userMessage` 是字符串；当前签名没有本轮消息数组参数，也没有独立扫描文本参数。下表记录该字段的实际消费者。源码：`apps/api/src/services/prompt-assembler.ts:785`、`apps/api/src/services/prompt-assembler.ts:697`。

| 消费点 | 当前依赖与顺序 | 源码证据 |
| --- | --- | --- |
| `buildFullHistory` | 过滤并复制 chatHistory 后，无条件追加 `{role:user,content:userMessage}`，空字符串也追加 | `apps/api/src/services/prompt-assembler.ts:2417` |
| `triggerHistory` | 由 `buildFullHistory(chatHistory,userMessage)` 直接构造 | `apps/api/src/services/prompt-assembler.ts:862` |
| 世界书扫描消息 | 使用 `triggerHistory.map(content).reverse()` 和 scanSources，读取 prompt 通道正则处理前的序列；contributor 文本在扫描后加入 | `apps/api/src/services/prompt-assembler.ts:1071` |
| recent 宏消息 | 已提交 history 的非空 user/assistant 加非空 currentUserMessage，所有现有 runKind 均包含这个追加步骤 | `apps/api/src/services/prompt-assembler.ts:864`；`apps/api/src/services/prompt-runtime/macro/context-builder.ts:50`、`:72`、`:325` |
| `fullHistory` | 初始与 triggerHistory 相同，文本处理阶段见第7.2节 | `apps/api/src/services/prompt-assembler.ts:994` |
| 输入正则深度 | 从 fullHistory 尾部数 user/assistant 消息，trace sample 选最后一条 user | `apps/api/src/services/prompt-assembler.ts:3091`、`:3105` |
| compat 历史节点 | 使用处理后的 fullHistory，文本处理阶段见第7.2节 | `apps/api/src/services/prompt-assembler.ts:1011`；`packages/adapters-sillytavern/src/compat-assembler.ts:407` |
| native 历史节点 | 使用 fullHistory，文本处理阶段见第7.2节，编译器过滤空内容 | `apps/api/src/services/prompt-assembler.ts:1158`；`packages/core/src/prompt-graph/compiler.ts:203`、`:324` |
| 当前输入注入锚点 | 位置映射见第5.2节第3项 | `apps/api/src/services/prompt-assembler.ts:1961` |
| 楼层注入坐标 | 坐标映射见第5.2节第3项 | `apps/api/src/services/chat/prepared-prompt-artifacts-builder.ts:475`；`apps/api/src/services/prompt-assembler.ts:2138` |
| assemblyInputDigest | 记录处理后的 fullHistory 和原始 userMessage 字段 | `apps/api/src/services/prompt-assembler.ts:1244` |
| 检查和持久化辅助产物 | `buildPromptRuntimeExecutionResult` 及 conversationInputSnapshot 使用 effectiveUserMessage | `apps/api/src/services/chat/prepared-prompt-artifacts-builder.ts:233`、`:562` |

### 7.2. 已保存文本与处理次数

1. 用户文本的保存处理见第2.2节第1项。共享组装器为本次请求对所有历史 user 和本轮 user 执行 prompt 通道，使用该通道的筛选规则。改写仅发生在本次 fullHistory，组装器不会回写历史数据库。源码：`apps/api/src/services/prompt-assembler.ts:994`。
2. 助手正文的保存与历史读取见第2.3节第4、5项；不同模式的历史模板处理见第4.2节“模板展开”行。
3. `RegexInputService` 可保存变化后的 user 文本；准备层仍分别携带 rawUserMessage、preprocessedUserMessage 和 effectiveUserMessage。组装器内部的 prompt 正则 trace 与 rawUserMessage 不是同一个阶段的证据。源码：`apps/api/src/services/chat/prepared-prompt-artifacts-builder.ts:195`、`apps/api/src/services/chat/prepared-prompt-artifacts-builder.ts:593`。

## 8. 共享入口与记忆摘要的当前行为

### 8.1. 共享入口的当前选项和正文调用

1. 共享入口的选项包括 `presetRefOverride`、`variableContext`、`intent`、`runKind`、`sourceSelection`、`contributors` 和 `injections`。源码：`apps/api/src/services/prompt-assembler.ts:697`。
2. 正文准备层使用 narrator 模型槽位、narrator 预设图引用、单条 user 输入、正文任务的工具配置和正文输出正则；工具配置见第3节“工具清单与调用协议说明”行，世界书条目处理见同节“角色 promptController”行。源码：`apps/api/src/services/chat/prepared-prompt-artifacts-builder.ts:240`、`:399`；`apps/api/src/services/prompt-assembler.ts:831`。

### 8.2. 当前 compat_plus 的记忆摘要数据流

1. 主链检索结果含有 `MemoryInjectionResult.items`，准备层保留该结构作调试与返回，却只把 summary 字符串传给 `assemblePrompt`。源码：`apps/api/src/services/chat/prepared-prompt-artifacts-builder.ts:308`、`apps/api/src/services/chat/prepared-prompt-artifacts-builder.ts:447`、`apps/api/src/services/chat/prepared-prompt-artifacts-builder.ts:606`。
2. 组装器为 compat_plus 新建的 injection 使用 `items: []`；适配器遇到空 items 时返回基础 IR 与 contributor section，跳过 memory section。与此同时，组装器因 injection 对象存在而设置 `memorySummaryHandledInPromptIR=true`，后置注入也被跳过。源码：`apps/api/src/services/prompt-assembler.ts:1676`、`packages/adapters-sillytavern/src/compat-plus-assembler.ts:151`、`apps/api/src/services/prompt-assembler.ts:1178`、`apps/api/src/services/prompt-assembler.ts:1346`。
3. 该路径下，摘要独立文本不会自动进入最终消息；预设显式引用 `summary` 宏仍可展开摘要。trace 中的 `memorySummaryInjected` 按字符串存在判断，不能单独证明 memory section 已进入请求。源码：`apps/api/src/services/prompt-runtime/macro/context-builder.ts:275`、`apps/api/src/services/prompt-assembler.ts:1415`。

## 9. 当前状态更新链路

### 9.1. 数据来源与消费位置

1. `StateUpdateService` 从会话固定角色快照取得 `stateUpdate`，按 `characterVersionId` 读取 profile 引用的规则、schema 和计算模块。它在成功正文提交后读取来源，再分别构造 system 文本和 JSON user 消息。源码：`apps/api/src/services/role-runtime/state-update-service.ts:426`、`:472`、`:625`、`:782`、`:831`。

| 数据 | 当前消费情况 | 源码证据 |
| --- | --- | --- |
| `updaterPrompt` 与 `ruleFiles` | system 文本按顺序连接任务指令、全部规则内容和统一输出说明，再展开宏 | `apps/api/src/services/role-runtime/state-update-service.ts:782`、`:822` |
| 角色资料及用户人设 | 宏环境提供角色与人设字段，规则引用对应宏时进入文本 | `apps/api/src/services/prompt-assembler.ts:2371`；`apps/api/src/services/prompt-runtime/macro/context-builder.ts:174`、`:214` |
| 本轮 `sources` | 查询目标楼层的有效 page 和未隐藏 user/assistant 消息；按 pageNo、seq 排序，携带消息 ID、页面版本、角色和正文 | `apps/api/src/services/role-runtime/state-update-service.ts:651`、`:670`、`:838` |
| 用户来源文本 | 直接读取保存的 `message.content`，作为来源进入 JSON | `apps/api/src/services/role-runtime/state-update-service.ts:670` |
| 助手来源文本 | 对保存正文应用会话正文预设的完成阶段投影，作为来源进入 JSON | `apps/api/src/services/role-runtime/state-update-service.ts:664`、`:674` |
| `before` | 从最新显示快照取得变量，再按 `controllerOwnedPaths` 合并控制器值；进入模型请求及后端计算 | `apps/api/src/services/role-runtime/state-update-service.ts:579`、`:647`、`:679`、`:838` |
| `floorBefore` | 当前主更新和重算均传入本次计算的 before | `apps/api/src/services/role-runtime/state-update-service.ts:286`、`:718`、`:843` |
| 宏变量上下文 | ordinary/local 均提供 `stat_data: before`，global 为空，chatHistory 为空 | `apps/api/src/services/role-runtime/state-update-service.ts:823` |
| 宏请求信息 | 预览入口使用 preset=null，缺省 runKind=dry_run、maxPrompt=1000；模型名取 metadata，summary 未传 | `apps/api/src/services/prompt-assembler.ts:2391`；`apps/api/src/services/prompt-runtime/macro/context-builder.ts:270` |
| 宏局部变更 | 预览返回 staged mutations，状态生成只消费展开后的 text | `apps/api/src/services/role-runtime/state-update-service.ts:823`；`apps/api/src/services/prompt-assembler.ts:2395` |
| `toolEvidence` | 读取有效助手输出页已经接受、完成且 committed 的执行记录；进入模型请求、证据校验和计算上下文 | `apps/api/src/services/role-runtime/role-tool-evidence.ts:11`；`apps/api/src/services/role-runtime/state-update-service.ts:687`、`:840` |
| `priorFacts`、`consumedSources` | 当前主更新的模型 JSON 中均为 []；priorFacts 同样以 [] 传给计算模块 | `apps/api/src/services/role-runtime/state-update-service.ts:718`、`:841` |
| 完整状态 schema | 从固定角色资源加载，全文进入模型 JSON，并在派生后验证完整候选状态 | `apps/api/src/services/role-runtime/state-update-service.ts:477`、`:845`；`apps/api/src/services/role-runtime/role-proposal-inspection.ts:161` |
| `writablePaths` | 进入模型 JSON、动态输出 schema 及后端路径检查 | `apps/api/src/services/role-runtime/state-update-service.ts:844`；`apps/api/src/services/role-runtime/state-contract.ts:154` |
| `derivedPaths` | 后端拒绝模型写入与其相同、祖先或后代的路径 | `apps/api/src/services/role-runtime/role-proposal-inspection.ts:88` |
| `factsSchema` 与输出 schema | 进入消息及供应商 responseFormat；后端再校验事实和提案 | `apps/api/src/services/role-runtime/state-update-service.ts:846`、`:855`；`apps/api/src/services/role-runtime/state-contract.ts:196` |
| `deriveScript`、`validateScript` | 后端模块运行器加载并执行固定版本的脚本；执行顺序见第9.4节 | `apps/api/src/services/role-runtime/state-update-service.ts:492`；`apps/api/src/services/role-runtime/role-proposal-inspection.ts:130`、`:171` |
| `moduleFiles` | 包检查验证资源引用，模块运行器提供 server_script 和 JSON data 导入 | `apps/api/src/services/role-runtime/role-asset-service.ts:281`；`apps/api/src/services/role-runtime/role-module-loader.ts:97` |
| 模型槽、供应商及参数 | 角色包发布服务将状态 profile 的 modelSlot 写为 state_updater；状态更新服务随后读取该字段，解析其模型绑定及参数 | `apps/api/src/services/native-card-runtime/native-card-runtime-service.ts:636`；`apps/api/src/services/role-runtime/state-update-service.ts:803`、`:851` |
| 模型 facts | 进入 derive/validate，调用记录保留模型响应，显示快照保存最终 variables | `apps/api/src/services/role-runtime/role-proposal-inspection.ts:130`；`apps/api/src/services/role-runtime/state-update-service.ts:731` |

1. 配置缺少 `profile.modelSlot` 时，状态更新服务读取 `roleStatePolicy.defaultModelSlot`，当前配置值为 `verifier`。源码：`apps/api/src/services/role-runtime/state-update-service.ts:807`；`packages/shared/src/config/role-state.json:2`。

### 9.2. 共享数据来源的当前接入差异

1. 状态来源查询限定目标 floor，宏历史为空。第3节的历史消息、记忆摘要、世界书扫描结果、预设节点、正则配置、结构化注入和 contributor 尚未通过完整组装器进入状态请求。源码：`apps/api/src/services/role-runtime/state-update-service.ts:657`、`:822`；`apps/api/src/services/prompt-assembler.ts:697`。
2. 原生规则的 `sourceEntries` 保存出处。当前状态运行器读取规则文件全文；世界书激活与递归扫描由正文共享组装路径执行。源码：`packages/shared/src/schemas/native-card-package/schema.ts:169`；`apps/api/src/services/role-runtime/state-update-service.ts:472`；`apps/api/src/services/prompt-assembler.ts:1062`。
3. 正文 `renderRolePromptController` 的条目处理见第3节“角色 promptController”行。该调用器没有任务类型参数，尚未消费 renderController 返回的 referencedEntryIds。源码：`apps/api/src/services/role-prompt-controller.ts:10`、`:33`、`:42`；`packages/shared/src/schemas/role-prompt-controller.ts:68`。
4. MVU 迁移器将 ruleEntryIds 的内容复制到规则文件，却将 disabledEntryIds 记录为控制器停用条目；后者包含变量规则和已退出协议。两个列表对应不同用途。包校验核对 ruleFiles 和 sourceEntries 的引用，不能据此证明所有停用条目已经有规则副本。源码：`packages/adapters-sillytavern/src/role-migrations/mvu-agent.ts:22`、`:50`、`:90`；`packages/shared/src/native-card-package.ts:744`。
5. 当前 profile 和计算链没有名为 guards 的独立入口，业务约束由状态 schema、路径与证据检查、validateScript 承担。sourceAgentBindingIds 存在于目标 JSON schema，当前主状态运行路径尚未加载这些绑定。源码：`packages/shared/src/schemas/role-state.ts:81`；`packages/shared/src/schemas/state-update.schema.json:40`；`apps/api/src/services/role-runtime/role-proposal-inspection.ts:65`。
6. 状态模型请求将工具执行结果当作输入，当前调用参数只有 messages、maxTokens、reasoning、绑定参数及 responseFormat。工具执行能力与已发生工具证据分别对应第3节的请求参数和内容来源。源码：`apps/api/src/services/role-runtime/state-update-service.ts:831`。

### 9.3. 正文投影、变量前值与恢复

1. 状态助手来源、角色消息接口和流式完成 role_text 共用 `loadSessionOutput().project(..., "completed")`，按固定正文预设的 outputProcessing.rules 顺序替换文本。缺少指定预设版本时，该投影器抛错。源码：`apps/api/src/services/preset-output.ts:92`；`apps/api/src/routes/role-view.ts:469`；`apps/api/src/routes/chat/index.ts:618`。
2. 正文宏的暂存变更通过正文提交服务进入变量存储。因此，最新显示快照与正文提交后的解析变量可以不同；状态服务通过 controllerOwnedPaths 合并指定字段。源码：`apps/api/src/services/chat/chat-service.ts:2344`；`apps/api/src/services/turn-commit-service.ts:700`；`apps/api/src/services/role-runtime/state-update-service.ts:579`。
3. 共享组装器的 variableContext 当前只指定 session/branch/floor/page，随后从变量服务解析当前数据。状态重算的原始 before 则来自首份状态快照的 calculationBeforeJson、前置快照或对应原模型请求。源码：`apps/api/src/services/prompt-assembler.ts:349`、`:1515`；`apps/api/src/services/role-runtime/state-update-service.ts:259`、`:320`。
4. 状态更新失败保留当轮成功正文；pending 检查会使后续正文请求返回既有 ROLE_STATE_PENDING。重算只允许最新已提交楼层，并在当前快照后追加 manual 快照。源码：`apps/api/src/services/role-runtime/state-update-service.ts:232`、`:286`、`:404`；`apps/api/src/routes/role-view.ts:122`。

### 9.4. 提案、计算与提交顺序

1. 状态模型完成原有 JSON 请求后，服务要求 finishReason 为 stop，再验证 stateUpdateAgentOutput。源码：`apps/api/src/services/role-runtime/state-update-service.ts:858`。
2. 后端检查 facts、消息证据、工具证据、变化路径重叠及派生路径写入，再对 before 的副本应用允许的 set/remove。源码：`apps/api/src/services/role-runtime/role-proposal-inspection.ts:65`、`:109`。
3. 后端执行 derive，用完整状态 schema 校验结果，再执行 validate。通过后，服务保存最终显示快照及分支 stat_data；普通更新另存计算前值供重算使用。源码：`apps/api/src/services/role-runtime/role-proposal-inspection.ts:130`、`:161`、`:171`；`apps/api/src/services/role-runtime/state-update-service.ts:731`。
4. 动态输出 schema 只将目标属性的类型及数组长度约束交给 set 分支，完整变量约束由后端的状态 schema 校验承担。源码：`apps/api/src/services/role-runtime/state-contract.ts:154`；`apps/api/src/services/role-runtime/role-proposal-inspection.ts:161`。

### 9.5. ZIP 文件契约与包外配置来源

1. ZIP 的固定文件、目录及引用范围由 `native-card-file-rules.json` 的 `versions["1.0.0"]` 定义；各文件的字段由包 schema 定义，包校验器读取引用并核对文件集合。源码：`packages/shared/src/config/native-card-file-rules.json:1`、`packages/shared/src/schemas/native-card-package/schema.ts:23`、`packages/shared/src/native-card-package.ts:244`。
2. 原生包发布时，运行服务将包内人物字段、世界书绑定、正则绑定、开场及状态 profile 写入固定角色快照。后续文件读取以该角色版本为依据。源码：`apps/api/src/services/native-card-runtime/native-card-runtime-service.ts:582`、`:614`、`:636`、`:649`。
3. 发布及预览接口的 `configuration` 单独提供预设、人设、提示词模式和模型槽。该输入属于系统配置，ZIP 格式的角色文件和根清单没有对应的预设或人设文件字段。源码：`packages/shared/src/schemas/native-card-api.ts:161`、`packages/shared/src/schemas/native-card-package/schema.ts:23`、`:49`；发布配置消费见 `apps/api/src/services/native-card-runtime/native-card-runtime-service.ts:342`。

## 10. 验证范围

1. 本次核对覆盖指定提交的源码参数、分支及调用关系。
