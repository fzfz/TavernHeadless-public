<!-- markdownlint-disable MD013 -->

# 管理端轮次调试与后端记录

## 必须要实现的目标

管理端 Agent 必须保留现有 Web 的调试能力，并使管理员从一条试聊消息定位对应轮次。调试选择统一携带 session_id、branch_id 和 floor_id；页面切换轮次后，提示词、运行状态、结果、工具和日志均读取同一轮记录。

用户 Web 的管理员试聊消息提供“查看生成详情”，跳转到管理端对应记录。管理端中间宽区域展示记录详情，返回试聊打开用户 Web 的原会话及消息位置。跳转关联与唯一聊天实现按[主计划](role-app-dual-web-plan.md)执行。开场白属于角色内容，发送消息后才创建生成轮次。

## 旧 Web 能力与对应接口

| 旧 Web 或后端能力                                                                  | 调试入口与读取对象                                              | 现有接口及边界                                                                                                                              |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/workspace-api/timeline.ts`                                                    | 轮次选择与分支身份                                              | session timeline；正式页面使用分页遍历历史，选中具体 floor                                                                                  |
| `inspector/WorkspaceInspectorToolsPanel.vue`                                       | 工具流状态、警告、调用参数、结果与错误                          | 实时 RespondStreamState 工具事件；历史补读 `GET /floors/:id/tool-executions` 及 `/tools/call-records`，按调用关联查询                       |
| `WorkspaceInspectorMemoryPanel.vue` 与 `composables/workspace/inspector/memory.ts` | 记忆条目、统计、scope state、任务状态及实时刷新                 | memories、memory-jobs 等现有 API；按返回的来源关联轮次，当前状态单独标注                                                                    |
| `WorkspaceInspectorVariablesPanel.vue`                                             | 变量与来源、作用域                                              | `/variables`、`/variables/resolve`；本轮写入从已保存运行记录读取，当前值独立展示                                                            |
| `WorkspaceInspectorVcPanel.vue` 与 `composables/workspace/inspector/vc.ts`         | 分支、差异、历史 Explain、操作日志                              | session branches/timeline/diff、`GET /floors/:id/prompt-runtime/explain`、会话 operation-logs                                               |
| `WorkspaceInspectorEventsPanel.vue`                                                | 请求与流事件时间线                                              | 当前 Web 的客户端事件；正式后端审计使用 `GET /floors/:id/operation-logs`，两类来源分别标注                                                  |
| 运行快照                                                                           | 生成阶段、状态、错误与恢复信息                                  | `GET /floors/:id/run`；生成中使用 run，不能提前读取成已提交结果                                                                             |
| 提交结果                                                                           | 正文、usage、verifier、stepNarrations 等返回字段                | `GET /floors/:id/result`；未 committed 返回 409，已提交但无结果快照可返回 404                                                               |
| 提示词历史                                                                         | 固定资源、组装快照、世界书激活/插入信息、裁剪、排除、诊断与限制 | 历史 explain 的 snapshot_available、prompt_snapshot、assets、trim_reasons、excluded_sources、section_stats、diagnostics、limitations 等字段 |
| 当前配置检查                                                                       | 尚未生成的配置检查和比较                                        | session prompt-runtime preview/inspect、compare；页面明确标为当前预览，历史页使用已保存 Explain                                             |

`WorkspaceInspectorImpactPanel.vue` 的部分影响数量和 Token 图形使用固定值。正式调试页必须采用接口记录或展示“未记录”，原型不将这些数字视为已有统计能力。

## 轮次页面设计

- **运行概览**：轮次与分支身份、输入、生成状态、开始结束时间、耗时、实际 usage、错误、提交结果和可用的重试入口。
- **历史提示词**：已保存资源与内容、实际组装记录、命中和插入位置、裁剪/排除原因。配置内容与执行证据分别展示，快照缺失时说明缺少哪些记录。
- **模型与阶段**：narrator、director、verifier、memory 的固定模型参数与已保存结果；配置启用状态和实际执行状态分别呈现。
- **工具调用**：按 execution/call 标识展开参数、返回、耗时和失败原因；流事件用于观察进行中调用，历史数据由持久化接口读取。
- **变量与记忆**：本轮写入、读取来源和关联任务；当前会话值另列，历史快照缺失时明确显示缺失。
- **分支与日志**：所属分支、同分支相邻轮次、分支差异入口、操作日志和请求事件。管理端通过持久化接口重建历史记录，并将浏览器当前事件列表单独标为客户端实时事件。
- **记录详情**：展开轮次身份、运行响应及结果响应，供管理员追踪对应对象。

重试同一失败轮次时，保留已提交用户消息。管理员正在查看历史轮次时，新回复完成必须保持其选择；切换轮次后所有子面板一起切换。刷新记录只更新所选对象，返回聊天不创建新会话或新轮次。

## 已有数据与待补记录

当前 run/result/历史 explain 并不保证保存每次重试的所有旧运行快照，也不能证明一定包含导演完整输入输出、逐阶段模型请求响应和全部变量前后值。实施 Agent 必须逐字段核对实际响应；需要跨刷新恢复的执行尝试、导演结果或变量变更如果尚未持久化，应补齐后端记录和查询契约，再作为历史调试能力验收。

原型中的轮次、执行尝试、输入和结果在内存中关联，每次发送与重试更新同一组记录。原型展示固定配置快照和实际发生的本地状态变化。原型尚未运行提示词组装、导演或工具服务，因此相关区域显示缺失记录；完整提示词、世界书命中、工具及记忆调试的正式验收必须使用后端返回数据。

## 验收清单

1. 从管理端创建试聊，跳转用户 Web 并发送两轮消息。逐条打开记录，核对输入、结果及 floor_id 分别对应；返回试聊保持记录数不变。
2. 在 `?scenario=failure` 下发送消息，查看失败轮次 run 状态和错误，重试后检查同一 floor 的成功结果，用户消息仍为一条。
3. 查看第一轮时让第二轮完成，确认调试仍停留在第一轮；切换轮次后，各面板身份与内容一起变化。
4. 修改资源后查看旧轮次，确认历史配置内容保持不变。历史 Explain 缺失时显示缺失状态，当前 preview/inspect 使用单独入口。
5. 正式联调从 timeline 取得真实 floor_id，依次核对 run、result、explain、tool-executions、operation-logs，并保存页面截图和对应接口记录。验证生成中、已提交、失败、缺快照、无工具及未启用记忆等状态。
6. 正式联调触发一次导演、校验和工具运行，核对已保存的各阶段结果及关联 ID；缺少所需历史字段时完成对应后端记录工作。
7. 独立语义审阅 Agent 审阅页面及本文件，主 Agent 处理意见后交付。

## 非本次目标

此次交付恢复原型中的逐轮调试路径并明确后端记录契约。真实服务接入、缺失历史记录的持久化，以及完整分支操作继续按两端方案实施。原型内存记录不会在刷新浏览器后保留。

## 已获得的授权

用户要求恢复旧 Web 的调试能力，明确每个试聊轮次的后端记录查看方式，并将调试作为管理端的必要功能。
