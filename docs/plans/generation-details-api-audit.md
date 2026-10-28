# 生成详情接口核对

## 必须要实现的目标

独立生成详情页按会话和轮次 ID 读取后端保存的记录。前端通过 `generation-inspection.config.json` 定义详情分类及对应接口，结构由同目录 `generation-inspection.config.schema.json` 定义。当前配置预览使用单独表单。

## 接口与页面对应

| 页面内容 | 已接入的后端接口 |
| --- | --- |
| 轮次、执行状态、尝试次数、错误、Token、提交结果 | `GET /floors`、`/floors/:id/run`、`/floors/:id/result` |
| 输入与输出页面、消息 | `GET /pages?floor_id=...`、`/messages?page_id=...`，读取全部分页 |
| 历史资源版本、世界书命中、正则规则、来源与裁剪、段落统计、记忆注入 | `GET /floors/:id/prompt-runtime/explain`，已提交轮次可读取 |
| 工具执行、生命周期、提交结果；工具调用参数与结果 | `GET /floors/:id/tool-executions`、`/tools/call-records?floor_id=...` |
| 变量暂存与提交 | `GET /pages/:id/variables/staged`、`/pages/:id/variables/promotions` |
| 记忆提案、提交和后台任务 | `GET /pages/:id/memory/proposals`、`/pages/:id/memory/promotions`、`/memory/jobs?floor_id=...` |
| 会话状态变更和公开状态快照 | `GET /pages/:id/session-state/mutations`、`/sessions/:sessionId/state/floors/:floorId/snapshot` |
| 角色变量更新后的完整快照 | `GET /sessions/:id/role-view/floors/:floorId` |
| 页面与消息的手动修订 | `GET /pages/:id/manual-revisions`、`/messages/:id/manual-revisions`，已提交轮次可读取 |
| 轮次操作日志 | `GET /floors/:id/operation-logs` |
| 按当前配置预览提示词 | `POST /sessions/:id/respond/dry-run` |

每一类记录独立显示请求错误，其他成功记录保留。刷新记录按钮重新读取当前轮次。分页接口读取到 `meta.has_more` 为 false。

## 后端仍缺少的历史数据

`apps/api/src/routes/prompt-runtime/register-routes.ts` 的历史 explain 返回资源版本、命中条目、规则名和来源裁剪记录；它不返回当时发送给供应商的完整消息数组。当前 dry-run 重新组装提示词，只能用于当前配置预览。

`apps/api/src/routes/floors.ts` 的 run 接口返回运行摘要、当前阶段、尝试次数和 pending_output；它不返回每次阶段切换的完整历史事件列表。

`apps/api/src/routes/role-view.mjs` 提供提交后的变量快照；失败的变量更新 Agent 请求、响应和每次重试记录尚无独立历史查询接口。

`apps/api/src/routes/project-agent-jobs.ts` 提供项目任务列表，响应包含 source_event_id，但没有会话、轮次筛选参数。当前详情页读取与轮次直接关联的记忆任务；完整后续 Agent 任务链需要后端提供事件到轮次的关联查询。

后续实现由后端开发者在现有运行记录服务中补齐以上持久化数据和查询接口，前端开发者再接入详情页。验收须能查询同一轮的每次请求、响应、阶段事件和后续 Agent 任务，并能在服务重启后读取同一记录。

## 验收清单

- 通过单元检查：接口分类覆盖、分页、空列表、失败轮次限制、单类请求失败不阻断其他分类。
- 通过真实接口检查：失败轮次的工具、日志、变量暂存、记忆提案和快照请求；未启用的会话状态变更接口按后端返回的 feature_unavailable 展示。
- 已通过浏览器复查：独立页面切换轮次、展开分类和刷新保持轮次。
- 尚未具备：上一章列出的完整历史请求和 Agent 任务链。

## 非本次目标

“后端仍缺少的历史数据”一章所列的持久化与关联查询属于后续后端实施范围。

## 已获得的授权

用户要求对照后端接口检查并补齐生成详情独立页。
