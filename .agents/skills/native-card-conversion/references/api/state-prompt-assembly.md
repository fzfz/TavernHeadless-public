---
文档用途: "说明状态更新请求如何绑定独立预设、取得状态与正文来源，并通过正式预览接口核对组装结果。"
读取时机: "配置原生角色状态更新、创建发布配置、检查提示词内容或排查状态请求时读取。"
---

<!-- markdownlint-disable MD013 -->

# 状态提示词组装

本文说明正式状态更新如何从固定角色资源、目标楼层和正文成功提交记录准备模型请求。变量更新提案、计算与保存规则见[角色变量更新 API](state-update-api.md)；`updaterPrompt` 的卡包兼容契约见[角色卡后端 API 第 3 章](backend-api.md#3-stateupdate配置变量更新)。

## 1. 状态模型与状态预设的职责

1. 状态模型仍由角色状态更新配置中的模型槽选择；状态预设负责模型看到的任务指令和上下文，两者分别配置。

## 2. 状态预设绑定与会话固定

1. 作者在原生包的 `agents/state-update/profile.json` 中填写 `presetRef`，声明默认状态预设；字段为 `presetId` 和 `presetVersionId`，共同指向一个已保存的预设版本。发布服务将该引用保存到角色运行快照的 `extensions.tavern_headless.stateUpdate.profile.presetRef`。
2. 管理员创建角色发布配置时，可以通过 `statePresetId` 和 `statePresetVersionId` 覆盖角色包默认值，并用 `stateHistoryTurns` 指定变量历史轮数。预设 ID 和版本 ID 必须同时提供；历史轮数必须为非负整数。
3. 发布配置未指定覆盖值时，系统采用 `profile.presetRef`。没有单独设置历史轮数时，系统采用共享配置 `roleStatePolicy.defaultHistoryTurns`，当前值为 5。
4. 发布服务保存生效的预设 ID、版本 ID 和历史轮数。根据发布配置创建会话时，系统将其写入会话元数据的 `statePrompt`，后续状态更新读取这份会话固定绑定。
5. 非发布配置创建的会话若没有 `statePrompt` 元数据，状态服务读取会话所固定角色版本的 `profile.presetRef`，并按本章第 3 项确定默认历史轮数；两处都没有预设绑定时，状态更新返回 `ROLE_STATE_PRESET_MISSING`。
6. 状态服务按账号、预设 ID 和版本 ID 读取对应资源。预设的创建或发布覆盖不更改已经固定的会话绑定。

## 3. 请求上下文与状态变量历史

1. 组装器读取目标楼层之前的对话历史，遵守会话的历史可见性、消息窗口和分支祖先规则；该对话历史由正式 `ChatHistoryLoader` 准备。
2. 状态请求将目标楼层中实际采用的消息作为当前消息序列传入组装器。每条消息携带消息 ID 和楼层号，便于历史节点、最近消息宏、世界书扫描及来源追踪识别其归属。
3. 状态预设可分别引用对话历史和变量历史。变量历史由 `stateHistory` 数据源提供，与对话文本历史分开计算。
4. 系统从目标分支的可见祖先中，按时间倒序查找有已提交变量快照的前置楼层，最多收集会话固定的 `statePrompt.historyTurns` 轮；最终结果按时间正序提供给预设。
5. 每轮变量历史记录将同一前置楼层内的状态提交合并为一项：`before` 取该楼层首次状态计算前的值，`after` 取该楼层最后一个已提交快照；`changes` 表示两者之间的字段差异，`snapshotIds` 列出组成该轮的快照。
6. 当前状态前值通过 `stateBefore` 数据源提供，同时作为共享 `variableContext.statData` 传给组装器；状态宏读取 `stat_data` 时因此使用本次计算的 `before`。

## 4. 六个状态数据源

1. 共享配置 `packages/shared/src/config/state-prompt-sources.json` 固定以下六个 marker ID。角色状态预设在需要的位置引用 marker；预设顺序及消息角色决定对应内容在最终请求中的位置。

   | Marker ID             | 组装内容                                                                                                                                                                                                                     |
   | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `stateDefinition`     | `stateSchema`、`writablePaths`、`derivedPaths` 和 `factsSchema`；未配置 `derivedPaths` 时提供空数组。                                                                                                                        |
   | `stateRules`          | 按角色状态配置 `ruleFiles` 的数组顺序连接文件全文。                                                                                                                                                                          |
   | `stateBefore`         | JSON 对象 `{before, floorBefore, previousSnapshotId}`；当前 `floorBefore` 取值见[角色卡后端 API 第 2.2 节](backend-api.md#22-computecontext)。                                                                                     |
   | `stateHistory`        | 第 3 章定义的变量历史轮及每轮状态差异。                                                                                                                                                                                      |
   | `stateEvidence`       | 当前 `sources`、楼层与运行来源身份、正文工具证据、正文采用的世界书条目选择，以及已有的 Agent 结果。当前 `priorFacts` 取值见[角色卡后端 API 第 2.2 节](backend-api.md#22-computecontext)；当前服务将 `consumedSources` 设为空数组。 |
   | `stateOutputContract` | 本次提案使用的 `outputSchema`。                                                                                                                                                                                              |

2. marker 的默认参数来自同一共享配置：消息角色为 `system`，预算组为 `role_state`，`pinned` 为 `false`，`prunable` 为 `true`。预设可配置其节点位置及节点参数；预算分配和裁剪依照共享组装器规则执行。
3. `sourceIdentity` 记录活动助手页 ID、助手消息 ID 和消息版本；`runId` 与 `attemptNo` 取该页对应的已提交模型调用记录，记录缺失时两者为 `null`。当前楼层运行另存为 `floorRunId` 和 `floorAttemptNo`。

## 5. 复用正文成功时保存的 Agent 与记忆资料

1. 正文请求提交成功时，系统在与正文结果相同的事务中，将该次实际采用的前置 Agent 结果、Agent contributor、记忆摘要、记忆追踪和请求级注入写入 `floor_result_snapshot.prompt_context_json`。
2. 存储对象的字段类型如下；Agent、contributor 和注入项的具体结构由 API 运行时类型定义。

   ```typescript
   type SourcePromptContext = {
     agentResults: AgentRunRecord[];
     agentContributors: PromptRuntimeContributorOutput[];
     requestInjections?: PromptRuntimeInjectionBuilderInput[];
     memorySummary?: string;
     memoryTrace?: PromptRuntimeTrace["memory"];
   };
   ```

3. `requestInjections` 保存正文请求提供的 `promptRuntimeInjections` 输入项，包括 `enabled`、位置参数和模式范围等字段；省略 `scope` 时按 `request` 保存。状态提示词组装再将保存项交给现有注入构建器评估。
4. 状态服务按目标楼层有效正文的 `outputPageId` 读取 `prompt_context_json`。重新生成成功后，查询读取最终正文输出页关联的数据。
5. 状态服务将保存的 `agentResults` 放入 `stateEvidence`，将 `agentContributors`、`requestInjections`、`memorySummary` 与 `memoryTrace` 交给共享 contributor、注入和追踪处理；一次性请求注入因此随正文输出页供对应状态请求复用。
6. 数据库字段为 `null` 或 `SourcePromptContext` JSON 对象。对象始终保存 `agentResults` 和 `agentContributors` 数组，没有对应内容时数组为空；没有值的可选记忆字段会省略。状态服务以 `null` 上下文处理未保存来源，按空 Agent 数组准备请求，不启动前置 Agent 或记忆生成。

## 6. 正式组装与请求内容

1. `StatePromptService.prepare` 同时供状态 dry-run 和正式状态更新使用。它加载会话固定预设、角色版本文件、目标楼层来源、`before`、变量历史和保存的正文来源上下文。
2. 状态服务把普通对话历史、当前消息、六个 marker 和 `variableContext` 交给共享 `assemblePrompt`；正文与状态因此遵守相同的节点启用、宏展开、世界书处理、预算、裁剪和最终请求消息生成规则。
3. 状态模型参数的覆盖规则见[角色卡后端 API 第 3 章](backend-api.md#3-stateupdate配置变量更新)。状态服务使用按该规则解析出的 `maxContextTokens` 和 `maxOutputTokens` 计算组装预算。
4. 状态服务把所选状态模型的 `modelId` 写入本次组装的模型元数据；预设中的 `{{model}}` 因此展开为本次状态请求所选模型的 `modelId`。
5. 正式状态更新使用准备好的消息调用配置的状态模型槽，解析模型提案后依照[角色变量更新 API 第 4 章](state-update-api.md#4-模型输入输出与校验顺序)完成证据、路径、计算和 schema 校验。

## 7. 状态提示词 dry-run

1. 管理员可以使用 `POST /sessions/:id/role-state/updates/dry-run` 查看正式状态请求的组装结果。服务必须启用 `ENABLE_PROMPT_DRY_RUN=true`，调用者必须具有管理员身份和 `project.config.write` 能力。
2. 请求体使用目标楼层 ID 和操作页面当前看到的预期状态快照 ID：

   ```json
   {
     "floor_id": "floor-3",
     "expected_snapshot_id": "snapshot-3"
   }
   ```

3. 服务检查楼层属于该会话且已提交、楼层运行已完成、预期快照仍为该分支最新快照，并复用正式状态更新的组装入口。会话已有变量更新正在执行时，服务返回 `ROLE_STATE_BUSY`；该错误的说明见[角色卡后端 API 第 10 章](backend-api.md#10-错误定位)。状态尚未初始化或楼层运行未完成时，服务返回对应错误；预期快照已经变化时返回 `ROLE_STATE_REPAIR_STALE`，错误说明见[角色卡后端 API 第 11.6 节](backend-api.md#116-操作错误)。
4. 成功响应为 `{ "data": ... }`。`data` 包含最终 `messages`、预设 ID 与版本、`before`、来源消息、变量历史、`sourceIdentity`、输出 schema、`prompt_snapshot`、`assembly`、`runtime_trace` 和 token 使用量。
5. 管理员使用 dry-run 检查会话实际绑定、marker 顺序、宏和来源展开、输出约束及预算追踪。正文请求仍使用正式 `POST /sessions/:id/respond/dry-run`，具体接口见[Chat HTTP API 的 Prompt Dry-run](http/chat.md#prompt-dry-run)。

## 8. 实现入口

1. `apps/api/src/services/role-runtime/state-prompt-service.ts` 负责读取绑定、准备来源上下文、生成六个 marker 并调用共享组装器。
2. `apps/api/src/services/chat/source-context.ts` 定义 `SourcePromptContext` 结构；`readSavedPromptSourceContextByOutputPageId` 按所选 `outputPageId` 读取正文保存上下文。
3. `apps/api/src/services/role-runtime/state-update-service.ts` 提供 dry-run 和正式状态更新的准备调用；`apps/api/src/routes/role-view.ts` 注册 dry-run HTTP 路由。
4. 适配器和核心 prompt graph 从 `packages/shared/src/config/state-prompt-sources.json` 读取状态数据源定义。
