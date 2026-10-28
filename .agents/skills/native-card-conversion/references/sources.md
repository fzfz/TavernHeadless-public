---
文档用途: 提供适用版本、正式来源、只读实现入口和 API 资料的读取条件。
读取时机: 转换 Agent 核对来源版本、实现行为或选择当前功能的 API 文档时。
---

<!-- markdownlint-disable MD013 -->

# 参考资料的用途、版本与来源

## 1. 适用版本与正式来源

1. 源环境的字段消费说明依据 SillyTavern `1.18.0`，源码版本为 `51ad27fb86d39a3daca3adaa970375c9670c12df`。CCv2、CCv3 定义交换格式；SillyTavern 的导入器、提示组装器和已启用插件决定字段的实际运行效果。源卡的 `spec`、`spec_version` 和插件代码决定本次适用的格式与扩展。

2. 正式来源包括 [CCv2 规范](https://github.com/malfoyslastname/character-card-spec-v2/blob/main/spec_v2.md)、[CCv3 规范](https://github.com/kwaroran/character-card-spec-v3/blob/main/SPEC_V3.md)、[SillyTavern 角色文档](https://docs.sillytavern.app/usage/characters/)、[世界书文档](https://docs.sillytavern.app/usage/core-concepts/worldinfo/)和[正则文档](https://docs.sillytavern.app/extensions/regex/)。

3. 目标格式为 `tavern_headless_role_package` `1.0.0`，前端 API 为 `1`。正式文档来源与工作区版本见 [API 清单](api/manifest.json)。状态提示词组装及其 dry-run 路由以合入提交 `88722f36568a5b098bb9974a6999c524679c081c` 为版本基线；清单中的 `sourceRevision` 标明文件是否反映当前 worktree 修改。

## 2. 只读实现依据

1. 源实现的固定版本入口为 [角色字段](https://github.com/SillyTavern/SillyTavern/blob/51ad27fb86d39a3daca3adaa970375c9670c12df/public/scripts/char-data.js)、[世界书映射与激活](https://github.com/SillyTavern/SillyTavern/blob/51ad27fb86d39a3daca3adaa970375c9670c12df/public/scripts/world-info.js)和[正则运行引擎](https://github.com/SillyTavern/SillyTavern/blob/51ad27fb86d39a3daca3adaa970375c9670c12df/public/scripts/extensions/regex/engine.js)。

2. 需要确认 API 的实际消费行为时，转换 Agent 以 `begin` 返回的 `repositoryRoot` 为根目录，只读核对对应实现：

   | 核对对象               | 实现入口                                                                                                                                                                                                                                     |
   | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | 原生包 schema          | `packages/shared/src/schemas/native-card-package/schema.ts`；文件与引用规则为 `packages/shared/src/config/native-card-file-rules.json`                                                                                                       |
   | 状态提议与保存         | `apps/api/src/services/role-runtime/state-contract.ts`、`apps/api/src/services/role-runtime/role-proposal-inspection.ts`、`apps/api/src/services/role-runtime/state-update-service.ts`                                                                                                               |
   | 状态提示词组装         | `apps/api/src/services/role-runtime/state-prompt-service.ts`、`apps/api/src/routes/role-view.ts`、`packages/shared/src/config/state-prompt-sources.json`                                                                                     |
   | 提示控制器             | `apps/api/src/services/role-prompt-controller.ts`                                                                                                                                                                                            |
   | 世界书触发与组装       | `packages/adapters-sillytavern/src/worldbook/trigger-engine.ts`、`packages/adapters-sillytavern/src/worldbook/trigger-runtime.schema.ts`、`apps/api/src/services/prompt-assembler.ts`                                                        |
   | 生成正文处理顺序与摘要标签 | `packages/core/src/generation/generation-pipeline.ts`、`packages/core/src/generation/summary-extractor.ts` |
   | 前端快照与消息         | `apps/user-web/src/runtime/script-runtime.ts`、`apps/user-web/src/features/chat/session-controller.ts`                                                                                                                                       |
   | 系统模型能力与工具证据 | `packages/shared/src/schemas/role-model-capabilities.schema.json`、`packages/shared/src/schemas/role-tool-evidence.schema.json`、`apps/api/config/role-model-capabilities.json`、`packages/core/src/tools/role-model-capability-executor.ts` |
   | 模型工具目录与调用时序 | `apps/api/src/services/tooling/session-tool-registry-service.ts`、`apps/api/src/services/chat/turn-tooling-service.ts`、`packages/core/src/orchestration/turn-orchestrator.ts`、`packages/core/src/llm/llm-service.ts`                       |

## 3. 转换 Agent 何时读取 API 资料

1. 转换 Agent 按正在处理的功能读取下表对应章节。

   | 资料                                          | 读取条件                                                   | 读取目的                                                                           |
   | --------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------- |
   | [角色前端 API](api/script-api.md)             | 生成或检查角色前端时                                       | 选择正式的聊天、状态、历史、资源和界面方法，核对参数、返回值与回调时序。           |
   | [角色预置数据第12.3节](api/script-api.md#123-apidataget--读取角色预置数据) | 页面宏使用人设姓名或固定角色资料时 | 核对页面数据键、会话姓名和缺键诊断。 |
   | [前端入口格式](api/script-template-api.md)    | 创建前端 manifest 与入口模块时                             | 配置页面文件、资源别名及模块入口。                                                 |
   | [角色后端 API](api/backend-api.md)            | 实现角色后端模块或动态提示控制器时                         | 核对模块配置、函数输入输出、执行顺序及保存行为。                                   |
   | [角色变量更新 API](api/state-update-api.md)    | 核对状态更新路由或状态契约预览时 | 区分当前正式接口与文档中的目标任务契约。                               |
   | [状态提示词组装](api/state-prompt-assembly.md) | 配置状态预设、状态历史或理解状态请求上下文时               | 核对 `profile.presetRef`、会话固定、来源消息、状态规则及请求组装入口。              |
   | [状态更新 profile schema](api/state-update-profile.schema.json) | 填写原生包 `agents/state-update/profile.json` 时 | 核对 profile 字段、类型及路径约束。                                                |
   | [状态提示词数据源](api/state-prompt-sources.json) | 配置状态预设 marker 时 | 核对正式数据源 ID 与默认节点参数。                                                 |
   | [正文模型系统能力](api/model-capabilities.md) | 正文生成中才能确定采样或计算参数，且同轮后续剧情依赖结果时 | 配置系统能力的授权，填写 random/calculate 参数，核对同轮回传、最终正文与状态证据。 |
   | [Agent tool API](api/agent-tools-api.md)      | 判断源功能是否需要模型工具，或核对包外工具依赖时           | 核对原生 ZIP 的支持边界、工具定义、启用条件、实际调用时序及结果消费者。            |
   | [原生包接口](api/native-card-api.md)          | 检查正式导入、回读、发布或下载结果时                       | 核对包操作的请求、响应、错误及产物。                                               |
   | [Chat HTTP API](api/http/chat.md)             | 验证提示组装、发送、重试或执行追踪时                       | 核对 dry-run 与生成请求的参数、响应及流式事件。                                    |
   | [Worldbooks HTTP API](api/http/worldbooks.md) | 判断或验收世界书条目的运行行为时                           | 核对触发条件、筛选顺序、注入位置、消息角色及正式保存字段。                         |
   | [Tools HTTP API](api/http/tools.md)           | 核对模型工具的包外定义、会话可用性或执行结果时             | 查询目标会话的工具目录、权限及执行记录，核对调用参数和实际结果。                   |
   | [通用后端模块示例](api/examples/api-usage/backend-hooks.mjs) | 编写 `derive`、`validate` 或 `renderController` 函数时 | 查看符合当前模块 API 的通用函数示例。                                              |
   | [本机后端函数调用示例](api/examples/api-usage/run-backend.mjs) | 检查示例函数的本机调用参数和返回值时 | 查看 `derive`、`validate` 与 `renderController` 的本地调用方式。                   |
