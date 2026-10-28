# 当前 API 与角色运行能力核对

核对日期：2026-09-28。工作区基线为 `d266d2d`。本文件是源码调研记录；改动建议等待实际卡样本的对照结论，既有设计计划保持原样。

## 已确认的实现与边界

| 能力             | 当前实现证据                                                                                                                                                                                                                       | 对转换的含义                                                                                                                                        |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 变量更新 Agent   | `apps/api/src/services/role-runtime/state-update-service.ts` 加载规则、JSON Schema、derive/validate 模块并调用模型；`packages/shared/src/schemas/role-state.ts` 定义配置                                                           | 已有可复用执行器；迁移自然语言规则的目标应为这个执行器，卡的插件名本身不能决定是否可迁移。                                                          |
| 变量变更         | `apps/api/src/services/role-runtime/state-proposal.ts` 的 `applyProposal` 只允许精确 writablePaths，要求父路径及最终键已存在，操作为 set/remove                                                                                    | 动态背包、新 NPC 字典和数组操作需要进一步对照。整体替换已存在的父对象可能表达某些需求，但它扩大写入范围，不能宣称已有等价的细粒度插入能力。         |
| 派生与验证       | `apps/api/src/services/role-runtime/state-proposal.ts` 的 applyProposal 在候选变更后运行 derive 和 validate，再检查最终 schema；RoleStateProposalProfile 包含 derivedPaths 与 factsSchema                                          | Zod 的结构约束可研究映射到 JSON Schema；transform/refine 等函数行为要单独分析，并映射到对应模块，单纯转 schema 会丢行为。                           |
| 写入归属         | `apps/api/src/services/role-runtime/state-contract.ts` 检查 controllerOwnedPaths 与 Agent 路径冲突                                                                                                                                 | 转换报告需要识别旧卡中多个写入来源，并决定执行阶段及路径归属。                                                                                      |
| 世界书扫描       | `packages/adapters-sillytavern/src/types/worldbook.ts` 与 `worldbook/trigger-engine.ts` 实现关键词、辅助逻辑、八种位置、递归及来源匹配                                                                                             | 可以复用；扩展字段被保存在 STWorldBookEntry.extra 时，转换器负责人应另查该字段是否参与实际计算。                                                    |
| 世界书时效与选择 | `worldbook/trigger-engine.ts` 的 TriggerContext 没有分支级 sticky/cooldown 状态；该引擎没有 probability/groupWeight 选择逻辑                                                                                                       | 静态保留不等于行为兼容。若样本使用这些语义，需要在触发引擎及按会话分支保存的触发记录中实现，以供重放和回退。                                        |
| EJS 迁移         | `packages/adapters-sillytavern/src/role-migrations/mvu-controller.ts` 将分隔符转为函数，提供有限 getvar/setvar/getwi；getvar 跳过路径首段，setvar 拼宏，toastr 为无操作                                                            | 这是此前卡的专用迁移逻辑，不能当作通用 EJS 解释器。诊断必须显示读写、依赖及丢失的界面反馈。                                                         |
| 控制器执行       | `apps/api/src/services/role-prompt-controller.ts` 向 renderController 提供变量及角色世界书，接收文本和引用条目                                                                                                                     | 更复杂的请求前、状态提交后等事件需求需要独立契约；不能通过把所有代码放进提示词渲染函数来替代。                                                      |
| 作者前端         | `apps/user-web/src/runtime/script-runtime.ts` 提供 variables、messages、history、chat、ui、assets、data、media、events、timers、widgets；变量 API 为读取/监听，chat 为填输入/发送                                                  | 状态栏、历史阅读、按钮发送、图音展示已有基础。直接修改剧情状态、编辑消息或独立生成不是这个角色前端 API 已有的公开能力。                             |
| 通用变量 API     | `apps/api/src/routes/variables.ts` 已有 global/chat/floor/branch/page 作用域、upsert 与批量写入                                                                                                                                    | 系统并非没有写变量接口。应研究如何复用已有服务并与角色 schema、显示快照、分支和幂等提交连接，接口验收者应分别验证通用变量写入和角色动作的完整提交。 |
| Agent 体系       | `apps/api/src/services/agent-runtime/builtin/index.ts` 注册 scene、memory、worldbook、director、verifier 等角色；director-agent.ts 当前为启发式提示；state-proposal-agent.ts 只提取显式 state 标签                                 | 名称注册不代表已具备卡所需语义推理。另有真正调用模型的 StateUpdateService，需要区分两条执行路径。                                                   |
| Agent 编排与工具 | `apps/api/src/services/agent-runtime/` 有 inline/background/temporary-conversation、输出调度、提示词注入；`apps/api/src/routes/tooling/session-runtime-tools.ts` 提供工具目录；`apps/api/src/routes/node-graphs.ts` 提供图资源入口 | 先复用已有编排与预算机制。尚须验证卡声明如何绑定到会话、消息、状态提交及模型调用记录，完整卡的可执行结论应由实际调用与结果验证支持。                |
| 资源交付         | `packages/shared/src/schemas/role-view.ts` 的 assets 为 image/audio，`docs/adr/0005-role-resource-file-storage.md` 已接受按版本文件存储                                                                                            | 图片、音频已有交付基础。其它媒体类型、远程资源归集、字体及动态路径的支持须分别核对；数据库有文件记录不足以证明前端能渲染。                          |

## 需要在样本调研中回答的问题

- 动态对象新增、数组插入和增量更新是否是多张卡的核心玩法，还是可选展示脚本？
- 卡使用世界书条件来选择剧情、执行数值计算，还是只是格式化提示词？这些行为应分别进入控制器、派生函数或正文知识。
- 前端按钮是发送台词、填写动作，还是消费物品、购买、掷骰、修改状态？后者需要提交确定性动作结果。
- 辅助生成在主生成前后做什么，结果进入正文、状态、记忆还是显示？确定性工作与语义判断应分别归属函数和 Agent。
- 原卡必需功能、可选装饰与依赖缺失应分别记录，单次静态读取不能证明转换后等价。

## 外部基准

SillyTavern 官方世界书文档定义持续、冷却、延迟及包含组。这些规则有跨消息行为，转换后的行为需要触发引擎在各轮实际执行。[官方世界书文档](https://docs.sillytavern.app/usage/core-concepts/worldinfo/)

本轮仅阅读源码和资料，尚未调用真实模型、执行外部卡脚本或进行转换等价验收。
