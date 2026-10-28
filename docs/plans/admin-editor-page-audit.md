<!-- markdownlint-disable MD013 -->

# 管理端逐页字段与操作核对

## 必须要实现的目标

设计 Agent 必须依据后端请求 schema、资源解析器和运行服务逐页核对管理端。每个字段记录所属对象，每项操作区分已有 API、待补 API 和原型本地行为。页面入口继续基于 `apps/web` 的工作区布局。

核对对象为 `apps/web/prototypes/admin-workspace.prototype.html`，业务依据为原型分支中现有后端和适配器源码。以下文件路径均相对仓库根目录。

## 逐页核对结果

| 页面                 | 后端依据                                                                                                                                       | 页面字段及操作                                                                                                                                            | 边界                                                                                                                                              |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 世界书条目           | `apps/api/src/routes/worldbook-entries.ts` 的 createEntrySchema/updateEntryFieldsShape；`packages/adapters-sillytavern/src/types/worldbook.ts` | 主词、辅助词、辅助匹配开关和逻辑、正文、名称、常驻、停用、插入位置、优先级、深度、消息角色、扫描深度、大小写、全词匹配、递归排除/阻断/延迟、Outlet 名称   | 条目覆盖当前写入 schema 的业务字段。ID、uid、版本冲突值和时间戳由资源加载/保存流程维护                                                            |
| 世界书全局设置       | 同一适配器的 STWorldBook                                                                                                                       | 全局扫描深度、大小写、全词匹配、递归扫描、递归步数                                                                                                        | 全局值与条目覆盖分别维护；条目 null 表示沿用全局或关闭延迟                                                                                        |
| 正则规则             | `packages/adapters-sillytavern/src/types/regex.ts`；`apps/api/src/routes/imports.ts`                                                           | 名称、表达式、替换、裁剪数组、执行位置、停用、显示/提示词通道、编辑后执行、宏替换方式、最小/最大深度                                                      | 规则数组通过已有 regex-profile 更新能力保存，规则 ID 由创建流程维护                                                                               |
| 正则测试             | `packages/adapters-sillytavern/src/regex/regex-engine.ts` 的 applyRegexScriptsWithTrace                                                        | 样本文本、位置、通道、深度、宏变量；输出文本、候选规则、改变文本的规则、跳过原因                                                                          | 原型内嵌同一仓库引擎的编译结果，实际处理样本。正式管理 API 尚需增加测试端点并复用该引擎；测试结果与保存分开                                       |
| LLM Profile          | `apps/api/src/routes/llm-profiles.ts`；`routes/schemas/llm-profiles-schemas.ts`                                                                | 名称映射 preset_name；provider、model_id、base_url、api_key_name、api_key、status；获取模型列表、测试模型、编辑与删除                                     | 创建必须提供凭证；已有凭证留空保持不变，替换后仅展示掩码。后端响应字段 api_key_masked 只读。base_url 可留空，沿用 provider 默认地址               |
| 预设条目             | `apps/api/src/routes/preset-entries.ts`；`apps/api/src/lib/preset-utils.ts`                                                                    | identifier、name、role、content、system_prompt、marker、enabled、injection_position/depth/order、forbid_overrides、injection_trigger、extra；条目增删排序 | 新条目标识自动生成且可以在创建草稿中调整；触发数组和未知 extra 使用高级 JSON。实施 Agent 按接口身份规则处理已有 identifier 的修改                 |
| 角色卡               | `apps/api/src/lib/character-snapshot.ts`；适配器 `types/character.ts`                                                                          | 描述、性格、场景、开场白、示例对话、备选/群聊开场白、系统提示词、历史后指令、作者备注、标签、作者、版本标记、昵称、来源、内嵌世界书、扩展、附件           | 编辑器使用角色卡交换字段，正式保存映射为会话快照字段。创建/修改时间与导入格式由导入和版本服务维护；嵌套交换对象保留高级 JSON                      |
| 演绎人设             | `apps/api/src/routes/users.ts`                                                                                                                 | 名称、description、status；创建、编辑、选择和删除                                                                                                         | name/description 属于 snapshot，status 属于用户资源；既有 revision 作为并发控制。此资源承载演绎人设，登录使用者由身份模块管理                     |
| 演绎运行配置         | `apps/api/src/routes/llm-instances.ts`；`routes/schemas/llm-profiles-schemas.ts`                                                               | 五槽位的 enabled、preset_id、model_id_override、params、capabilities；各槽位独立选择 Profile                                                              | 槽位为 `*`、narrator、director、verifier、memory；已有 API 的 scope/session_id 表示生效范围。角色应用草稿及发布解析需补适配，并保留来源和固定配置 |
| 回合流程             | `apps/api/src/routes/chat/schemas.ts` 和 `routes/schemas/chat-schemas.ts` 的 turnConfig                                                        | enableTools、enableDirector、enableVerifier、enableMemoryConsolidation、toolMode、verifierFailStrategy、maxRetries                                        | 开关控制阶段执行，槽位控制所用模型。页面分别保存这些对象到角色草稿，正式生成交由后端解析                                                          |
| 工作区 Agent 类型    | `apps/api/src/routes/workspaces.ts` 的 Agent 类型相关接口                                                                                      | key、name、scope_kind；defaults 中的 llm_profile_id、tool_policy_id、mcp_bindings、event_subscriptions、grants、metadata；创建、编辑、启停                | key/scope_kind 创建后固定。现有接口提供停用/启用，页面按此结束或恢复类型使用                                                                      |
| 项目 Agent           | `apps/api/src/routes/project-agent-bindings.ts`                                                                                                | agent_type_id、scope_kind、模型覆盖、工具策略、MCP、事件订阅、授权、元数据；新增绑定、编辑、启停、运行                                                    | 原型提供模型选择及作用域表单，MCP/订阅的完整嵌套内容可通过高级 JSON 修改。类型默认配置与项目覆盖分别保存                                          |
| Agent 任务           | `apps/api/src/routes/project-agent-jobs.ts`；binding 的 run 接口                                                                               | trigger_reason、dry_run、input_json；任务列表、详情、状态、输入结果、取消                                                                                 | 已有接口为运行、查询及取消，页面按同一生命周期展示。原型任务保留排队状态，展示可取消操作；真实执行和事件调度属于后端联调                          |
| 角色绑定、试聊、发布 | `sessions.ts`；两端方案的角色应用契约                                                                                                          | 资源及版本绑定、保存/撤销、试聊维护、发布/停止/恢复、固定配置检查                                                                                         | 已有会话能力复用；角色应用聚合、发布引用及用户调用适配仍属后端新增能力                                                                            |
| 独立用户 Web         | 两端方案的 runtime 契约                                                                                                                        | 选择角色、继续/新建、改名/删除、发送/重试                                                                                                                 | 模型、导演和 Agent 的内部配置由管理端与后端承担，用户页面读取可用角色和自己的会话                                                                 |

## 关键字段映射

世界书编辑器使用交换格式字段。正式适配层必须按下表映射条目接口字段，或使用已有整份世界书解析器保存。

| 交换字段                                    | 条目 API 字段                                   |
| ------------------------------------------- | ----------------------------------------------- |
| key / keysecondary                          | keys / keys_secondary                           |
| selectiveLogic                              | selective_logic                                 |
| scanDepth / caseSensitive / matchWholeWords | scan_depth / case_sensitive / match_whole_words |
| excludeRecursion / preventRecursion         | exclude_recursion / prevent_recursion           |
| delayUntilRecursion / outletName            | delay_until_recursion / outlet_name             |

插入位置枚举为：0 角色定义前、1 角色定义后、2 作者注释前、3 作者注释后、4 指定深度、5 示例消息前、6 示例消息后、7 Outlet。消息角色枚举为：0 system、1 user、2 assistant。

生成参数表单覆盖 `llmGenerationParamsJsonSchema` 的全部字段：max_context_tokens、max_output_tokens、temperature、top_p、top_k、frequency_penalty、presence_penalty、stop_sequences、seed、repetition_penalty、min_p、logit_bias、response_format、stream、timeout_ms、max_retries、reasoning_effort。原型用该 schema 的副本检查参数结构与范围。正式代码直接消费共享 schema。

## 导演与 Agent 的边界

演绎中的 narrator 负责生成正文，director 提供叙事指导，verifier 承担校验，memory 承担记忆整理。`*` 是默认模型槽位。槽位配置与回合启停分别决定模型选择及执行行为。

`packages/core/src/orchestration/director.ts` 中的导演提示词为内置常量。当前接口支持导演启停、模型与参数，尚无独立的导演提示词更新接口。自定义导演提示词必须作为后端配置能力扩展后再开放保存。节点图中的 `agent.director_plan` 是另一种执行入口；完整图编辑继续由图模块承担。

工作区 Agent 类型与项目 Agent 绑定具有自己的作用域、工具/MCP、订阅和授权。它们的后台任务单独查询和取消。角色发布如何固定这些项目配置、哪些订阅作用于用户演绎，必须在角色应用解析契约中明确，前端根据后端解析结果展示 Agent 与演绎流程的关联。

## 验收清单

- 世界书选“指定深度”，保存深度和 role；选 Outlet，保存名称；取消编辑后原内容保持不变。
- 正则编辑禁用、通道、深度、宏与裁剪字段，测试样本显示对应处理或跳过原因；无效表达式给出可修正原因。
- 新建 LLM Profile 缺凭证时保持编辑；填入后保存只显示掩码；已有凭证留空保持，替换后更新掩码。模型发现/连接测试的真实请求在联调阶段核验。
- 预设条目新增字段和角色扩展内容可以保存并重新打开；JSON 格式错误时保留输入并阻止保存。
- 在演绎运行配置切换五个槽位，分别设置模型及参数；应用到角色草稿后继续保存；已有试聊保持其原修订。
- 导演开关、导演槽位与 Agent 类型各有明确入口；项目绑定修改不会伪装成导演提示词修改。
- 创建 Agent 类型和项目绑定，保存后重新打开；停用、启用与任务排队取消各改变对应对象。
- 独立语义审阅 Agent 核对页面文案和本文件，主 Agent 处理意见后提交。

## 非本次目标

本轮修改原型并核对接口。真实 LLM 连接与发现结果、Agent 任务执行、发布配置解析和两端联网仍由正式后端联调完成。原型中的模型测试响应使用示例数据；正则测试使用当前仓库实际引擎。

## 已获得的授权

用户要求逐页核对后端字段与功能，明确指出世界书插入位置、正则测试、LLM 凭证、导演及 Agent 配置的遗漏，并要求管理端呈现这些能力。
