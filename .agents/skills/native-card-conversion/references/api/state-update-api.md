---
文档用途: "说明角色变量更新的正式接口、目标任务契约、计算入口和恢复行为。"
读取时机: "配置原生角色变量更新、对接状态查询、实施目标任务契约或排查状态更新失败时读取。"
---

<!-- markdownlint-disable MD013 MD033 -->

# 角色变量更新 API

## 1. 用途与契约来源

1. 当前正式后端接线与已验收范围见[角色发布与正式后端重新接线](../../../../../docs/plans/published-backend-reconnection.md)。
1. 本文定义角色变量更新配置、后端计算入口、任务查询和恢复接口。[MVU 转换方案](../../../../../docs/character-authoring/mvu-agent-state.md)定义来源迁移和执行流程；[角色 JavaScript API](script-api.md)定义前端布局、变量与文本回调。目标任务结构由 [state-update.schema.json](state-update.schema.json) 定义；当前模型输出格式见[角色卡后端 API 第4章](backend-api.md#4-变量更新模型的输入与输出协议)，角色变量和事实分别由角色的状态 schema 与 `factsSchema` 定义。状态模型使用的独立预设、提示词来源和正式 dry-run 见[状态提示词组装](state-prompt-assembly.md)。
2. 本文的 `/runtime/sessions/.../state-updates` 任务查询、重试与重算路由是目标开发契约，对应的持久化任务及 Runtime `stateUpdates` 命名空间仍须实现。当前后端提供 `/sessions/:id/role-state/updates` 更新入口、`/sessions/:id/role-state/updates/dry-run` 提示词预览、提案检查入口和本文末尾的 `state-contract` 预览接口。

## 2. 角色版本与服务端配置

1. 角色状态 profile 的正式字段、文件保存与会话版本绑定规则见[角色卡后端 API 第 3 章](backend-api.md#3-stateupdate配置变量更新)；原生包的目录和字段边界见该文档[第 1 章](backend-api.md#1-执行入口与数据流)。原生链路的验收结果见[正式实现验收](../../../../../docs/plans/role-runtime-core/native-card-production-acceptance.md)。
2. 目标契约另设 `sourceAgentBindingIds`，由作者填写可参与状态更新的后续 Agent 绑定 ID。目标后端按绑定顺序读取执行配置，并根据各 Agent 的新增正文更新角色变量；主回复触发角色配置的更新器，该数组为空时只处理主回复。
3. 正式系统使用已有 LLM Profile 管理服务端模型凭证和请求参数。旧隔离原型的 `live-model.json` 保存正文提示词、更新提示词、`maxTokens` 和后续 Agent 提示词，供原型联调使用。
4. 目标发布校验覆盖所有引用文件、模块导出、变量和事实 schema、模型槽位、Agent 绑定及路径声明。管理端展示具体文件、字段和错误；正式界面及纵向验收见[实施计划的 M1–M5](../../../../../docs/plans/role-app-dual-web-plan.md#mvu-与变量更新-agent-的补充交付项)。

## 3. 后端计算入口

1. `ComputeContext` 的正式字段及当前服务取值见[角色卡后端 API 第 2.2 节](backend-api.md#22-computecontext)。
2. `derive` 的正式签名、只读输入和完整状态返回规则见[角色卡后端 API 第 5 章](backend-api.md#5-derivecontext计算完整状态)。
3. `validate` 的正式签名、只读输入和 issues 返回规则见[角色卡后端 API 第 6 章](backend-api.md#6-validatecontext校验业务规则)。

### 3.1 目标契约：同轮累计与跨轮继承

1. 本节记录目标同轮累计契约；当前服务中 `priorFacts` 与 `floorBefore` 的正式取值见[角色卡后端 API 第 2.2 节](backend-api.md#22-computecontext)。
2. 目标实现将主楼层更新前的状态保存为 `floorBefore`，并将 `priorFacts` 初始化为空数组。
3. 每次状态更新成功提交后，目标实现按提交顺序将该次事实追加到 `priorFacts`；失败和重放已提交结果时不重复追加。
4. 后续 Agent 状态任务使用最新已提交快照作为本次 `before`，沿用主楼层开始时固定的 `floorBefore`，并按顺序读取此前已提交任务的 `priorFacts`。
5. 下一轮主楼层以该分支最近一个已提交状态任务的快照建立新的 `floorBefore`，并将 `priorFacts` 重置为空数组。
6. 角色模块按 `floorBefore`、`priorFacts` 和本次 `facts` 计算同轮累计值，再写入 `candidate`。

## 4. 模型输入、输出与校验顺序

1. 目标任务服务按共享 schema 为 `proposal` 填写角色版本、更新配置、会话、分支、楼层、尝试、前值和消息修订；模型返回 `agentOutput`，后端为其附加上述身份字段。
2. 正式状态请求由独立状态预设组装；绑定、marker、变量历史及正文成功时保存的 Agent 与记忆资料见[状态提示词组装第 2–6 章](state-prompt-assembly.md#2-状态预设绑定与会话固定)。
3. 模型输出字段、证据来源和路径约束、changes 计算与校验规则见[角色卡后端 API 第 4–6 章](backend-api.md#4-变量更新模型的输入与输出协议)。本次 `facts` 描述新增来源造成的变化。
4. 目标契约中的状态任务提交服务先查询同一任务的已有结果，已提交时返回原结果；新提交在事务内核对前值仍有效、尝试仍生效、来源尚未消费，再保存变量、事实、来源消费记录和不可变快照；事务完成后交付事件。

## 5. 目标契约：更新状态与前端能力

1. 角色 Runtime 的目标读取接口如下；业务发送继续使用 `api.chat.send({text})`。

   | 接口                               | 参数与结果                                                                                                                      |
   | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
   | `api.stateUpdates.get(updateId)`   | 非空字符串；Promise 返回只读 `updateStatus`；查询本会话获准记录，保持 current 与 view                                           |
   | `api.stateUpdates.watch(callback)` | 注册时投递当前生效楼层各更新器的最新 queued、running 或 failed 状态；之后投递所订阅会话、分支和生效尝试的状态变化；返回取消函数 |

2. `updateStatus` 的身份、revision、status、committedSnapshotId 和 error 字段由 schema 定义。宿主按 `(updateId, revision)` 投递递增版本；接收方丢弃重复或较旧的 revision，不更新已交付状态，也不触发观察者或提交回调。订阅随 Runtime 或楼层范围释放，错误处理沿用[生命周期契约](script-api.md#15-生命周期与错误)。初始化与恢复只同步任务状态；历史提交回调保持静默。
3. 状态值及后续处理如下。

   | 状态      | 含义与后续处理                                                   |
   | --------- | ---------------------------------------------------------------- |
   | queued    | 已登记更新输入，等待执行                                         |
   | running   | 正在请求模型或计算、校验、提交                                   |
   | committed | 事务已完成；committedSnapshotId 指向结果，error 为 null          |
   | failed    | 本次执行失败；error 提供 code 与具体 paths，系统展示相应恢复入口 |
   | stale     | baseSnapshotId 已失效；重试原提案返回失效错误，重算创建新任务    |
   | cancelled | 该任务已取消；保留历史诊断记录                                   |

4. 首次任务按 queued → running → committed/failed/stale/cancelled 推进。重试失败任务沿用 updateId，增加 revision 并进入 queued/running；已 committed 的重复请求返回原结果。重算采用新的 updateId，原任务保持可查询；后端任务记录保存二者关联。
5. 主楼层状态提交后，宿主应用完整显示快照并通知 `variables.watch`，再按[提交回调顺序](script-api.md#5-多轮变量读取与提交回调)交付 `onTurnCommitted`，最后通知 `stateUpdates.watch`。每个后续 Agent 的变量提交对应独立任务快照；宿主应用该快照并通知 `variables.watch` 与 `stateUpdates.watch`，不交付 `onTurnCommitted`。`stateUpdates` 只用于执行进度与失败反馈；角色数值、图片和剧情选项以 variables 接口的已提交记录为准。

## 6. 目标契约：宿主 HTTP 接口

1. 以下路径为目标路由，响应 JSON 结构统一使用 `updateStatus`。服务端从会话和任务查找绑定版本、前值和已保存来源。

   | 请求                                                                    | 请求体与成功响应                                                                                         | 失败语义                                                                                                                           |
   | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
   | `GET /runtime/sessions/:sessionId/state-updates/:updateId`              | 无请求体；200，updateStatus                                                                              | 找不到获准记录：STATE_UPDATE_NOT_FOUND                                                                                             |
   | `POST /runtime/sessions/:sessionId/state-updates/:updateId/retry`       | `{}`；200，原任务最新 updateStatus。failed 任务重新入队，queued/running 返回原任务，committed 返回原结果 | stale：STATE_UPDATE_STALE；失效尝试：STATE_UPDATE_ATTEMPT_INACTIVE；cancelled：STATE_UPDATE_NOT_RETRYABLE                          |
   | `POST /runtime/sessions/:sessionId/state-updates/:updateId/recalculate` | `{}`；202，新任务的 updateStatus。在原任务已终止且来源仍属生效尝试时，绑定当前前值重新计算               | 失效尝试：STATE_UPDATE_ATTEMPT_INACTIVE；原任务仍为 queued/running：STATE_UPDATE_RUNNING；已消费来源：STATE_UPDATE_SOURCE_CONSUMED |

2. 用户会话主体可读取自己的任务；管理员通过管理端发起重试或重算。用户 Web 的系统恢复控件复用相同恢复服务，只开放后端返回的会话操作权限；角色脚本的调用面保持第5章定义的读取、订阅及 `chat.send`。正式错误响应沿用项目错误信封，由唯一错误码文案表提供提示。
3. 变量更新重试沿用对应 `updateId` 及其绑定的 `floorId`、`attemptId`、前值和来源，只重试尚未成功的变量更新。主楼层提交和后续 Agent 任务各自沿用所属任务的正文与来源；变量更新重试不负责恢复尚未完整保存的正文生成。重算用于未消费来源的失效前值，后端绑定新前值产生新的提案；修改已提交剧情应使用系统的编辑、重新生成或分支操作。

## 7. 目标契约：刷新与断线恢复

1. 系统会话控制器读取后端保存的运行、正文和任务状态，恢复正文及可操作入口。主正文已完成而主楼层变量尚未提交时，`current` 保持上次已提交状态；主楼层提交后，宿主更新为主楼层快照。后续 Agent 任务按配置顺序提交独立快照；任务失败时，`current` 保持最近一次成功的主楼层或后续任务快照。重试后续处理保持用户尚未发送的草稿。
2. 浏览器断线与后端执行结果分别记录。服务端查询确认任务已 committed 后，宿主只同步该任务的提交结果；已成功的任务再次请求时返回原结果。系统的恢复按钮绑定任务身份，角色模板无需自行保存提案或拼装第二条模型请求。正式服务重启后的恢复依赖持久化任务和快照，原型内存恢复仅覆盖页面刷新。

## 8. 后端控制器持有的变量

1. `profile.controllerOwnedPaths` 是 JSON Pointer 数组，正式字段见[角色卡后端 API 第3章](backend-api.md#3-stateupdate配置变量更新)。配置方必须将控制器写入字段放入该数组，并将 Agent 的 writablePaths 限定为其他字段。后端在生成结束后的变量更新入口读取正式变量存储中的这些字段，作为本次 before 的对应值；校验通过后随显示快照提交。Runtime 继续通过已有变量回调读取快照。

## 9. 角色版本状态契约预览

1. 管理端通过 `GET /characters/:id/versions/:versionId/state-contract` 读取保存版本的 `systemPrompt` 与 `outputSchema`。
2. 此接口沿用正式角色版本读取的账号归属检查；缺少变量配置时返回 `role_state_config_missing`。
3. 预览契约用字符串表示来源消息 ID，执行时后端按本批来源 ID 收紧枚举；具体迁移与时序见[执行记录](../../../../../docs/plans/mvu-execution/results.md)。
