---
文档用途: 提供对话生成的 HTTP 请求、响应、事件及错误。
读取时机: 转换 Agent 核对提示组装、消息发送、重试或流式回复时。
---

<!-- markdownlint-disable MD013 MD033 -->
<!-- markdownlint-configure-file {"MD024":{"siblings_only":true}} -->

# Chat（对话生成）

## 一个简单例子

最基础的调用是 `POST /sessions/:id/respond`。传一条消息，拿回一条回复：

```bash
curl -X POST http://localhost:3000/sessions/sess_001/respond \
  -H 'Content-Type: application/json' \
  -d '{"message": "你好，请讲个故事"}'
```

如果要流式输出，换成 `POST /sessions/:id/respond/stream` 就行，请求体一样。

如果只是想看提示词怎么组装的，不想真的调用模型，用 `POST /sessions/:id/respond/dry-run`。

## 先理解几个词

| 词         | 这里的意思                     |
| ---------- | ------------------------------ |
| floor      | 一次对话回合的容器             |
| branch     | 对话的分支线，默认是 `main`    |
| dry-run    | 只组装提示词，不调用模型       |
| SSE        | 服务端推送事件流，用于流式输出 |
| regenerate | 最后回合的生成操作             |
| retry      | 指定楼层的生成操作             |

## 补充阅读

如果你只需要对一段文本做宏预览，而不需要完整提示词组装，请改用 `POST /sessions/:id/prompt-runtime/preview`。它不会创建 floor，也不会调用模型。

如果你需要回看某个已提交楼层当时真正保存的提示词快照，而不是当前请求的调试结果，请使用 `GET /floors/:id/prompt-runtime/explain`。

如果你需要比较两个已提交楼层的提示词差异，请使用 `POST /sessions/:id/prompt-runtime/compare`。

## 发送消息并生成回复

```http
POST /sessions/:id/respond
```

向会话发送用户消息，触发 AI 回复生成。返回完整的生成结果。

### 路径参数

| 参数 | 类型   | 说明    |
| ---- | ------ | ------- |
| `id` | string | 会话 ID |

### 请求体

| 字段                                      | 类型                                       | 必填     | 说明                                                                                                                |
| ----------------------------------------- | ------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------- |
| `message`                                 | string                                     | **是**   | 用户消息文本                                                                                                        |
| `config`                                  | [TurnConfig](#turnconfig-对象)             | 否       | 回合配置覆盖                                                                                                        |
| `generation_params`                       | [GenerationParams](#generationparams-对象) | 否       | 生成参数覆盖                                                                                                        |
| `branch_id`                               | string                                     | 否       | 指定分支 ID                                                                                                         |
| `source_floor_id`                         | string                                     | 否       | 从指定楼层开始（用于在中途插入）                                                                                    |
| `prompt_runtime_injections`               | object[]                                   | 否       | 请求级 Prompt Runtime Injection 列表，字段见[Prompt Runtime Injection 请求字段](#prompt-runtime-injection-请求字段) |
| `session_state_writes`                    | object[]                                   | 否       | 与本次 turn 一起提交的受治理 Session State 写入声明                                                                 |
| `session_state_writes[].namespace`        | string                                     | 是       | 已登记的自定义命名空间，长度为 1–128 个字符并符合命名规则                                                           |
| `session_state_writes[].slot`             | string                                     | 是       | 目标槽位名，长度为 1–256 个字符                                                                                     |
| `session_state_writes[].value`            | any JSON                                   | 条件必填 | 要保存的 JSON 值；每项恰好提供 `value` 或 `delete: true`                                                            |
| `session_state_writes[].delete`           | boolean                                    | 条件必填 | 设为 `true` 时删除该槽位的值；每项恰好提供 `value` 或 `delete: true`                                                |
| `debug_options`                           | object                                     | 否       | live 最小观测开关，默认关闭                                                                                         |
| `debug_options.include_prompt_snapshot`   | boolean                                    | 否       | 打开后在成功响应 `data` 中返回 `prompt_snapshot`                                                                    |
| `debug_options.include_runtime_trace`     | boolean                                    | 否       | 打开后在成功响应 `data` 中返回 `runtime_trace`                                                                      |
| `debug_options.include_worldbook_matches` | boolean                                    | 否       | 只有在 `include_runtime_trace=true` 时才会展开 `runtime_trace.worldbook.matches`                                    |

每项 `session_state_writes` 指定一个已登记的自定义命名空间和槽位，并提供 JSON 值或 `delete: true`。服务器在成功提交本次 turn 时应用这些写入。

示例：

```json
{
  "message": "继续故事",
  "session_state_writes": [
    {
      "namespace": "quest_flags",
      "slot": "companion",
      "value": { "mood": "ally" }
    },
    {
      "namespace": "quest_flags",
      "slot": "expired_hint",
      "delete": true
    }
  ]
}
```

### Prompt Runtime Injection 请求字段

以下接口接受可选 `prompt_runtime_injections`：

- `POST /sessions/:id/respond`
- `POST /sessions/:id/respond/dry-run`
- `POST /sessions/:id/respond/stream`
- `POST /sessions/:id/regenerate`
- `POST /floors/:id/retry`
- `POST /floors/:id/retry-step`
- `POST /messages/:id/edit-and-regenerate`

它用于在本次请求的 Prompt Runtime 组装阶段，临时加入一组客户端提示。

服务器仅在当前请求的提示词组装阶段处理这些条目。每个请求最多提交 32 条；每条 `title` 最多 256 个字符、`content` 最多 8000 个字符和 2000 token；本次实际生效的正文合计最多 4000 token。

每个条目字段如下：

| 字段               | 类型    | 必填 | 说明                                                                   |
| ------------------ | ------- | ---- | ---------------------------------------------------------------------- |
| `source_kind`      | string  | 是   | 当前固定为 `client_injection`                                          |
| `title`            | string  | 是   | 注入标题                                                               |
| `content`          | string  | 是   | 注入正文                                                               |
| `placement`        | string  | 是   | 语义锚点位置                                                           |
| `placement_params` | object  | 否   | 高级位置参数，字段为 `floor_no` / `offset` / `depth`，均为可选非负整数 |
| `order`            | integer | 否   | 同一 placement 内部排序，默认 `100`                                    |
| `scope`            | string  | 否   | 当前固定为 `request`                                                   |

`placement` 表示注入内容相对提示词结构的位置。以下位置在三种 prompt mode 中都可用：

- `before_system_prompt` / `after_system_prompt`
- `before_character` / `after_character`
- `before_persona` / `after_persona`
- `before_worldbook` / `after_worldbook`
- `before_memory` / `after_memory`
- `before_examples` / `after_examples`
- `before_history` / `after_history`
- `before_current_user_input` / `after_current_user_input`
- `before_output_instruction`
- `before_assistant_prefill`

高级 `placement`（需要 `placement_params` 或受 prompt mode 限制）：

- 楼层相对位置：`before_floor` / `after_floor`（需 `placement_params.floor_no`）、`before_floor_from_end` / `after_floor_from_end`（需 `placement_params.offset`）
- 世界书细分位置（仅 `compat_plus` / `native`）：`worldbook_depth`（需 `placement_params.depth`）、`worldbook_before` / `worldbook_after`、`worldbook_author_note_top`
- native 专属位置（仅 `native`）：`before_contributor_block` / `after_contributor_block`

示例：

```json
{
  "message": "请继续这段对话",
  "prompt_runtime_injections": [
    {
      "source_kind": "client_injection",
      "title": "Client guide",
      "content": "Keep the north pass in focus.",
      "placement": "before_history",
      "order": 30,
      "scope": "request"
    }
  ]
}
```

`scope` 为注入条目的适用范围，`visibility` 由来源类型决定；live `respond` 请求没有顶层 `visibility` 覆盖字段。dry-run 的顶层 `visibility` 用于筛选历史楼层，两种 `visibility` 的作用对象不同。

结果还可见于 Prompt Runtime inspect 顶层 `injections`，以及 inspect / preview 的 `runtime_trace.injection.items`。各生成接口的调试追踪条件与响应路径见[respond 响应定义](#响应-200)。

### 响应 `200`

```json
{
  "data": {
    "floor_id": "floor_12",
    "floor_no": 12,
    "branch_id": "main",
    "generated_text": "The firelight wavers as the next part of the story begins.",
    "summaries": ["The group resumes the campfire planning scene."],
    "total_usage": {
      "prompt_tokens": 320,
      "completion_tokens": 128,
      "total_tokens": 448
    },
    "memory": {
      "mode": "sync",
      "status": "applied",
      "job_id": null
    },
    "final_state": "committed"
  }
}
```

如果当前会话启用了记忆持久化，响应里会额外返回 `memory`：

- `mode = "sync"` 且 `status = "applied"`：记忆写入已在本次提交内完成
- `mode = "async"` 且 `status = "queued"`：记忆写入已进入后台队列，`job_id` 对应 `runtime_job.id`

如果当前部署没有启用记忆持久化，这个字段可以省略。

默认关闭 `debug_options.include_prompt_snapshot` 和 `debug_options.include_runtime_trace`。客户端将对应字段设为 `true` 后，成功响应的 `data` 分别包含 `prompt_snapshot` 和 `runtime_trace`。

只有请求同时设置 `debug_options.include_runtime_trace=true` 并携带 `prompt_runtime_injections` 时，解析结果才会进入调试追踪：同步成功响应在 `data.runtime_trace.injection.items` 中逐条返回，SSE 成功响应在 `done` payload 的 `runtime_trace.injection.items` 中逐条返回。每条记录至少包含：

- `request_index`
- `source_kind`
- `visibility`
- `scope`
- `placement_requested`
- `placement_params_requested`
- `order_requested`
- `title`
- `content_length`
- `token_count`
- `budget_group`
- `budget_status`
- `applied`
- `placement_resolved`
- `anchor_resolved`
- `source_chain`
- `not_applied_reason`
- `restricted`

`runtime_trace.injection` 还会给出本次注入的汇总字段：

- `requested_count`
- `applied_count`
- `rejected_count`
- `token_count`
- `budget_group`

其中：

- `applied=true` 表示这条 injection 在本轮组装中成功落到了目标语义锚点
- `placement_params_requested` 回显客户端声明的 `placement_params`，未声明时为 `null`
- `anchor_resolved` 是解析后的锚点描述，不暴露内部数字顺序；无法解析时为 `null`
- `source_chain` 是来源链，客户端来源的 injection 该字段为 `null`
- `token_count` 是本条 injection 正文 token 估算值
- `budget_group` 当前固定为 `injection`，会进入 Prompt Runtime budget trace
- `budget_status` 为 `within_budget`、`rejected_by_item_limit` 或 `rejected_by_total_limit`，尚未进入预算判定时为 `null`
- `visibility` 由 `source_kind` 推导：`client` / `agent_private` / `debug` / `system`
- `restricted` 为 `true` 时，该条受限来源（`agent_private` / `debug` / `system`）的 `title` 与 `source_chain` 已被裁剪为 `null`，结构性字段仍完整保留；客户端声明的 `client_injection` 永不裁剪。chat 运行响应始终裁剪受限来源，完整正文只在 `inspect` 通过 `include_restricted_injection_content` 开放
- `not_applied_reason` 用于说明未生效原因，当前可能为 `placement_not_available_in_mode`、`unknown_placement`、`empty_title_or_content`、`prompt_section_absent`、`disabled`、`mode_scope_mismatch`、`expired`、`scope_quota_exceeded`、`content_length_exceeded`、`content_token_limit_exceeded`、`total_token_limit_exceeded`、`missing_placement_params`、`invalid_placement_params`、`floor_no_out_of_history_window`、`floor_offset_out_of_history_window`

宏诊断字段见[宏系统调试字段](#宏系统调试字段)。

如果这次运行把多个连续 `user floor` 归并成了一个有效 user turn，或者命中了 assistant floor 护栏诊断，`runtime_trace.history_normalization` 会返回原始 entry 数、有效 turn 数、归并来源和违规列表。

当 mutation value 是对象时，`runtime_trace.macro.mutation_preview` 和 `runtime_trace.macro.staged_mutations` 会返回稳定 JSON 字符串，而不是 `[object Object]`。

当 `structure.mode=flattened` 时，`runtime_trace.structure` 还会附带 `transcriptized`、`transcript_message_count` 与 `assistant_prefill_transcriptized`。如果 assistant prefill 被转写进 transcript，`runtime_trace.delivery.assistant_prefill_strategy` 会返回 `transcript_append`。

`runtime_trace.tool_transport` 可返回工具调用 transport 选择、tool list 注入摘要、text protocol 解析诊断，以及 tool result 回写摘要。

### 常见错误

| 状态码 | error.code                                                                                                                                                                                                                    | 情况与调用方操作                                                                                                    |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 400    | `validation_error`                                                                                                                                                                                                            | 请求字段不符合 schema。读取 `error.details` 指向的字段，修正请求后重试。                                            |
| 400    | `invalid_message_scope`                                                                                                                                                                                                       | 消息作用域不属于该接口允许的值。按请求字段定义修正作用域后重试。                                                    |
| 400    | `invalid_message_role`                                                                                                                                                                                                        | 消息角色不属于该接口允许的值。使用支持的消息角色后重试。                                                            |
| 400    | `invalid_from_step_index`                                                                                                                                                                                                     | `from_step_index` 未指向有效生成步。读取目标楼层的生成步信息并提交有效序号。                                        |
| 400    | `invalid_tool_mode`                                                                                                                                                                                                           | `enableTools=true` 时请求选择了当前不支持的工具模式。将 `config.toolMode` 设为 `inline` 后重试。                    |
| 404    | `not_found`                                                                                                                                                                                                                   | 会话不存在或当前账号无法访问。核对会话 ID 和项目访问权限后重试。                                                    |
| 404    | `message_not_found`                                                                                                                                                                                                           | 请求指定的消息 ID 不存在。读取会话消息列表并提交有效消息 ID。                                                       |
| 404    | `branch_not_found`                                                                                                                                                                                                            | 请求指定的分支 ID 不存在。读取会话分支列表并提交有效分支 ID。                                                       |
| 404    | `floor_not_found`                                                                                                                                                                                                             | 请求指定的楼层 ID 不存在。读取会话楼层列表并提交有效楼层 ID。                                                       |
| 404    | `source_floor_not_found`                                                                                                                                                                                                      | 来源楼层 ID 不存在。读取可用楼层并提交有效来源楼层 ID。                                                             |
| 404    | `no_floor_to_regenerate`                                                                                                                                                                                                      | 会话中没有可重新生成的已提交楼层。先提交一个有效楼层，再调用重新生成接口。                                          |
| 404    | `no_user_message`                                                                                                                                                                                                             | 目标楼层没有可用于本次操作的用户消息。读取该楼层消息并选择含有用户消息的目标。                                      |
| 404    | `session_state_namespace_not_registered`                                                                                                                                                                                      | 写入使用的命名空间未登记。改用已登记的自定义命名空间后重试。                                                        |
| 409    | `profile_not_found`                                                                                                                                                                                                           | 请求引用的模型 Profile 不存在。读取可用 Profile 列表并选择有效 ID。                                                 |
| 409    | `profile_disabled`                                                                                                                                                                                                            | 请求引用的模型 Profile 已停用。选择已启用的 Profile 后重试。                                                        |
| 409    | `instance_slot_disabled_required`                                                                                                                                                                                             | 请求所需的实例槽位已停用。选择已启用的实例槽位后重试。                                                              |
| 409    | `session_archived`                                                                                                                                                                                                            | 会话已归档。选择活动会话后重试。                                                                                    |
| 409    | `generation_conflict`                                                                                                                                                                                                         | 目标会话正在处理其他生成操作。读取运行状态，等待该操作结束后重试。                                                  |
| 409    | `invalid_state`                                                                                                                                                                                                               | 目标楼层状态不支持请求操作。查询楼层运行状态并按状态选择恢复入口；楼层重试要求目标楼层已提交。                      |
| 409    | `commit_conflict`                                                                                                                                                                                                             | 提交目标在请求期间发生变化。读取最新会话和楼层状态，再基于当前目标发起请求。                                        |
| 409    | `generation_target_stale`                                                                                                                                                                                                     | 请求排队期间目标楼层或消息上下文发生变化。读取最新已提交目标并使用最新 ID 重新提交。                                |
| 409    | `branch_local_snapshot_missing`                                                                                                                                                                                               | 来源楼层缺少新分支所需的分支变量快照。选择具有完整快照的来源楼层或使用原分支上下文后重试。                          |
| 409    | `session_state_public_write_forbidden`                                                                                                                                                                                        | Session State 写入目标不属于已登记的自定义命名空间。改用已登记命名空间中的槽位后重试。                              |
| 409    | `session_state_namespace_item_limit_exceeded` / `session_state_namespace_byte_limit_exceeded` / `session_state_account_item_limit_exceeded` / `session_state_account_byte_limit_exceeded` / `session_state_payload_too_large` | 命名空间或账号的写入数量、存储容量或单次 payload 超出限制。减少写入项或 JSON 值大小后重试。                         |
| 409    | `tool_catalog_conflict`                                                                                                                                                                                                       | 会话工具目录存在同名冲突。读取 `GET /sessions/:id/tools/runtime`，调整冲突工具定义后重试。                          |
| 409    | `tool_replay_blocked` / `session_state_replay_blocked`                                                                                                                                                                        | 历史工具副作用或 Session State mutation 不能自动回放。读取 blocker 详情并选择其他处理方式；确认 ID 不会解除此错误。 |
| 409    | `tool_replay_confirmation_required` / `session_state_replay_confirmation_required` / `replay_confirmation_required`                                                                                                           | 历史操作需要调用方确认。按“回放确认”一节读取 blocker ID 并重试原接口。                                              |
| 409    | `step_retry_blocked_side_effect`                                                                                                                                                                                              | 重试起点包含带写入副作用的工具调用。选择没有写入副作用的生成步作为起点，或查询执行记录并选择其他恢复入口。          |
| 503    | `feature_unavailable`                                                                                                                                                                                                         | 会话所需功能未启用。使用已启用的会话功能重试，或请服务管理员启用所需功能。                                          |
| 503    | `secret_unavailable`                                                                                                                                                                                                          | 服务端当前无法读取请求所需的凭据。使用其他可用配置重试，或请服务管理员检查凭据服务。                                |
| 503    | `commit_busy` / `generation_queue_timeout`                                                                                                                                                                                    | 提交资源繁忙或请求等待队列超时。读取目标运行状态，等待繁忙操作结束后重试。                                          |
| 504    | `generation_timeout`                                                                                                                                                                                                          | 模型生成超过时限。读取 SSE `run.pending_output.text` 或最新运行状态，再决定是否重新提交。                           |
| 500    | `secret_invalid_format`                                                                                                                                                                                                       | 服务端读取的凭据格式无效。将错误码和 run ID 提供给服务维护者检查凭据配置。                                          |
| 500    | `orchestration_failed`                                                                                                                                                                                                        | 生成编排未能完成。读取本次 run 错误详情并确认提交状态，再决定是否重试。                                             |
| 500    | `turn_commit_failed`                                                                                                                                                                                                          | 回合提交未能完成。读取本次 run 和最新楼层状态，确认是否已提交后再决定是否重试。                                     |
| 500    | `session_state_stage_failed`                                                                                                                                                                                                  | 回合内 Session State 写入未能暂存。读取本次 run 错误详情并检查写入字段后再决定是否重试。                            |
| 500    | `retry_step_failed`                                                                                                                                                                                                           | Step 级重试未能完成。读取本次 run 与目标楼层状态，确认提交状态后再选择恢复入口。                                    |
| 499    | `generation_cancelled`                                                                                                                                                                                                        | 客户端取消了本次生成。确认取消意图后再发起新请求。                                                                  |

## 回放确认

重新生成、楼层重试、Step 级重试和编辑再生成可能需要确认历史工具调用或 Session State mutation。接口返回 `409 tool_replay_confirmation_required`、`409 session_state_replay_confirmation_required` 或 `409 replay_confirmation_required` 时：

1. 从 `error.details.blocking_executions` 读取工具执行 ID，并将获准回放的 ID 放入 `confirmed_execution_ids`。
2. 从 `error.details.blocking_session_state_mutations` 读取 mutation ID，并将获准回放的 ID 放入 `confirmed_session_state_mutation_ids`。
3. 使用同一目标和相应确认字段重新调用原接口。

`tool_replay_blocked` 和 `session_state_replay_blocked` 表示相应操作不能通过确认自动回放；调用方读取 blocker 详情并选择其他处理方式。

## SSE 流式生成

```http
POST /sessions/:id/respond/stream
```

路径参数 `id` 为会话 ID。请求体与 `/respond` 相同，但以 SSE (Server-Sent Events) 格式返回流式结果。

### 响应格式

`Content-Type: text/event-stream`

```text
event: start
data: {"floor_id":"floor_12","floor_no":12,"branch_id":"main"}

event: run
data: {"floor_id":"floor_12","run_id":"run_12","run_type":"respond","status":"running","phase":"page_generating","public_phase":"generating","phase_seq":5,"attempt_no":1,"started_at":1735689720000,"updated_at":1735689720300,"completed_at":null,"pending_output":{"temp_id":"temp_12","attempt_no":1,"state":"streaming","text":"The firelight wavers...","started_at":1735689720100,"updated_at":1735689720300,"error":null},"verifier":null,"error":null}

event: chunk
data: {"chunk":"The firelight wavers..."}

event: tool
data: {"execution_id":"tool_exec_12","tool_name":"get_time","provider_id":"builtin","provider_type":"builtin","side_effect_level":"none","phase":"success","message":"Current time returned","duration_ms":2,"replay_safety":"safe"}

event: chunk
data: {"chunk":" as the next part"}

event: summary
data: {"summaries":["The group resumes the campfire planning scene."]}

event: done
data: {"floor_id":"floor_12","floor_no":12,"branch_id":"main","generated_text":"...","summaries":[...],"total_usage":{...},"memory":{"mode":"sync","status":"applied","job_id":null},"final_state":"committed"}
```

如果请求里打开了 live debug 选项：

- `prompt_snapshot` 与 `runtime_trace` 只会出现在 `done` payload 中
- `start` / `run` / `chunk` / `tool` / `summary` / `error` 事件不变
- 不会新增新的 SSE 事件类型

当前 SSE 事件集包括：

- `start`
- `run`
- `chunk`
- `tool`（按条件出现，表示工具执行过程）
- `summary`（按条件出现，表示提交前摘要结果）
- `done`
- `error`

`resource_busy` 用于资源写入接口；SSE 流式生成使用上文列出的运行错误码。

客户端断开连接时，服务端会自动中止生成。客户端收到 run 事件后，用 pending_output.text 覆盖当前候选文本，再依次处理后续 chunk。

`tool` 事件的主要字段包括：`execution_id`、`tool_name`、`provider_id`、`provider_type`、`side_effect_level`、`phase`、`message`、`duration_ms`、`replay_safety`。

## Prompt Dry-run

```http
POST /sessions/:id/respond/dry-run
```

路径参数 `id` 为会话 ID。

只组装 Prompt 并返回调试信息，不实际调用 LLM，无副作用。除了 `prompt_snapshot`，响应里的 `assembly` 还会返回 preset 兼容边界信息。

如果需要查看命中的世界书条目、来源、注入位置和首个命中位置，可以在请求体里打开 `debug_options.include_worldbook_matches`。

单段文本预览的响应只包含宏展开结果和 `runtime_trace`，完整组装请求使用本接口。

### 请求体

| 字段                                                        | 类型                           | 必填   | 说明                                                                                                                    |
| ----------------------------------------------------------- | ------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------- |
| `config`                                                    | [TurnConfig](#turnconfig-对象) | 否     | 本次配置覆盖；`modelCapabilityLimits` 收紧系统能力额度                                                                  |
| `message`                                                   | string                         | **是** | 用户消息文本，至少包含一个字符                                                                                          |
| `branch_id`                                                 | string                         | 否     | 分支 ID，至少包含一个字符                                                                                               |
| `prompt_intent`                                             | string                         | 否     | Prompt 运行意图：`normal` / `continue` / `impersonate` / `swipe` / `regenerate` / `quiet`                               |
| `prompt_runtime_injections`                                 | object[]                       | 否     | 当前请求级 Prompt Runtime Injection 列表。字段见[Prompt Runtime Injection 请求字段](#prompt-runtime-injection-请求字段) |
| `debug_options.include_worldbook_matches`                   | boolean                        | 否     | 是否返回 `assembly.worldbook_matches`。默认 `false`                                                                     |
| `visibility`                                                | object                         | 否     | 请求级历史楼层筛选；省略该对象时使用会话历史筛选策略                                                                    |
| `visibility.mode`                                           | string                         | 否     | `allow_all_except_hidden` 或 `deny_all_except_visible`；省略时默认为 `allow_all_except_hidden`                          |
| `visibility.hidden_floor_ranges[] / visible_floor_ranges[]` | object[]                       | 否     | 每项使用 `start_floor_no` 和 `end_floor_no` 两个整数标记闭区间                                                          |
| `visibility.hidden_floor_ids[]`                             | string[]                       | 否     | 要从历史中排除的楼层 ID；每个值至少包含一个字符                                                                         |
| `structure`                                                 | object                         | 否     | Prompt 消息结构配置；字段见下表                                                                                         |
| `delivery`                                                  | object                         | 否     | Prompt 投递配置；字段见下表                                                                                             |
| `budget`                                                    | object                         | 否     | 输入与回复预算；省略字段时使用当前组装策略                                                                              |
| `source_selection`                                          | object                         | 否     | 各提示词来源的选择策略；省略字段时使用当前组装策略                                                                      |

`allow_all_except_hidden` 保留隐藏范围和 ID 以外的历史楼层；`deny_all_except_visible` 仅保留可见范围中的楼层，并继续排除隐藏范围和 ID。楼层范围包含起止编号。

`structure` 对象的 `mode` 为必填字段，其余字段可选：

| 字段                                   | 类型    | 约束                                                            | 说明                          |
| -------------------------------------- | ------- | --------------------------------------------------------------- | ----------------------------- |
| `structure.mode`                       | string  | `default` / `strict_alternating` / `no_assistant` / `flattened` | 消息结构模式                  |
| `structure.merge_adjacent_same_role`   | boolean | —                                                               | 是否合并相邻且角色相同的消息  |
| `structure.assistant_rewrite_strategy` | string  | `to_system` / `to_user_transcript`                              | 处理尾部 assistant 消息的策略 |
| `structure.preserve_system_messages`   | boolean | —                                                               | 是否保留 system 消息          |

`delivery` 对象的字段均为可选布尔值：

| 字段                               | 类型    | 说明                                  |
| ---------------------------------- | ------- | ------------------------------------- |
| `delivery.allow_assistant_prefill` | boolean | 是否允许 assistant 前缀               |
| `delivery.require_last_user`       | boolean | 是否要求最后一条消息来自 user         |
| `delivery.no_assistant`            | boolean | 是否要求消息列表不包含 assistant 消息 |

`budget` 和 `source_selection` 的字段及约束如下：

| 字段                                    | 类型    | 约束                | 说明                     |
| --------------------------------------- | ------- | ------------------- | ------------------------ |
| `budget.max_input_tokens`               | integer | ≥ 1                 | 输入 token 预算          |
| `budget.reserved_completion_tokens`     | integer | ≥ 1                 | 为回复预留的 token 数    |
| `source_selection.history.mode`         | string  | `full` / `windowed` | 选择完整历史或窗口化历史 |
| `source_selection.history.max_messages` | integer | ≥ 1                 | 窗口化历史的最大消息数   |
| `source_selection.memory.enabled`       | boolean | —                   | 是否选择记忆来源         |
| `source_selection.worldbook.enabled`    | boolean | —                   | 是否选择世界书来源       |
| `source_selection.examples.enabled`     | boolean | —                   | 是否选择示例来源         |

请求体示例：

```json
{
  "message": "请继续营火旁的对话。",
  "branch_id": "main",
  "prompt_intent": "normal",
  "structure": {
    "mode": "default",
    "merge_adjacent_same_role": true,
    "assistant_rewrite_strategy": "to_system",
    "preserve_system_messages": true
  },
  "delivery": {
    "allow_assistant_prefill": false,
    "require_last_user": true,
    "no_assistant": false
  },
  "debug_options": {
    "include_worldbook_matches": true
  },
  "visibility": {
    "hidden_floor_ranges": [{ "start_floor_no": 1, "end_floor_no": 2 }],
    "mode": "allow_all_except_hidden"
  },
  "budget": {
    "max_input_tokens": 4096,
    "reserved_completion_tokens": 1024
  },
  "source_selection": {
    "history": { "mode": "windowed", "max_messages": 24 },
    "memory": { "enabled": true },
    "worldbook": { "enabled": true },
    "examples": { "enabled": false }
  }
}
```

dry-run 请求体不含 `session_state_writes`；提供该字段时，接口返回 `400 validation_error`。

### 响应 `200`

```json
{
  "data": {
    "messages": [
      {
        "role": "system",
        "content": "Stay in character and keep the tone warm."
      },
      { "role": "user", "content": "请继续营火旁的对话。" }
    ],
    "token_estimate": 512,
    "available_for_reply": 1536,
    "memory": {
      "summary_injected": true,
      "runtime_mode": "async_primary",
      "requested_write": false,
      "effective_write": false,
      "strategy": "dual_summary",
      "summary_text": "[Memory]\n- Bob still holds the vault key.\n- Alice had started to distrust Bob.",
      "summary_text_hash": "sha256:8b210f3247804d17f0e22171db253f411f4ca9bb9da6c69b75837b086d11c2fa",
      "selected_items": [
        {
          "memory_id": "memory-branch-fact-1",
          "scope": "branch",
          "scope_id": "memscope:session-1:main",
          "branch_id": "main",
          "kind": "fact",
          "source": "store",
          "score": 0.82,
          "token_count": 18,
          "selected_reason": null
        }
      ],
      "token_stats": {
        "budget": 500,
        "used": 64,
        "micro_summary": 14,
        "macro_summary": 0,
        "direct_items": 50
      },
      "scope_resolution": {
        "mode": "branch_aware",
        "requested_scopes": ["global", "branch"],
        "resolved_scopes": ["global", "branch"],
        "requested_branch_id": "main",
        "resolved_branch_id": "main",
        "fallback_reason": null
      }
    },
    "memory_summary": "The party recently agreed to search the northern pass.",
    "prompt_snapshot": {
      "preset_id": "preset_001",
      "preset_updated_at": 1735689600000,
      "preset_version": 4,
      "worldbook_id": "wb_001",
      "worldbook_updated_at": 1735689605000,
      "worldbook_version": 2,
      "regex_profile_id": null,
      "regex_profile_updated_at": null,
      "regex_profile_version": null,
      "worldbook_activated_entry_uids": [7],
      "regex_pre_rule_names": ["trim_whitespace"],
      "regex_post_rule_names": [],
      "prompt_mode": "compat_strict",
      "prompt_digest": "sha256:demo",
      "token_estimate": 512
    },
    "assembly": {
      "mode": "preset",
      "prompt_intent": "normal",
      "assistant_prefill_applied": false,
      "assistant_prefill_strategy": "none",
      "preset_used": true,
      "selected_prompt_order_character_id": 100000,
      "ignored_prompt_order_character_ids": [200001],
      "continue_nudge_applied": false,
      "continue_nudge_text": null,
      "names_behavior_applied": "always",
      "trigger_filtered_entry_ids": ["quietPrompt"],
      "in_chat_inserted_entry_ids": [],
      "worldbook_hits": 1,
      "regex_pre_rules": ["trim_whitespace"],
      "regex_post_rules": [],
      "memory_summary_injected": true,
      "reserved_variable_collisions": [],
      "unsupported_preset_fields": [],
      "ignored_preset_fields": [],
      "unresolved_preset_markers": [],
      "preset_warnings": [
        "检测到 2 条 prompt_order 上下文轨道；当前运行时只会使用 character_id=100000 的 active 轨道。"
      ],
      "preprocessed_user_message": "请继续营火旁的对话。",
      "worldbook_matches": [
        {
          "uid": 7,
          "comment": "Campfire Lore",
          "content_preview": "The northern pass is watched by old sentries.",
          "order": 100,
          "source": {
            "kind": "session_worldbook",
            "worldbook_id": "wb_001",
            "worldbook_name": "Campfire Worldbook"
          },
          "insertion": {
            "position": "before"
          },
          "activation": {
            "mode": "triggered",
            "recursion_level": 0,
            "first_match": {
              "source_kind": "message",
              "message_index_from_latest": 0,
              "matched_key": "营火",
              "matched_key_scope": "primary",
              "matched_key_type": "plain",
              "char_start": 3,
              "char_end": 5,
              "excerpt": "请继续营火旁的对话。"
            }
          }
        }
      ]
    }
  }
}
```

- `memory`：本次提示组装的结构化记忆结果，字段分别记录选择的记忆、摘要和 token 用量。
- `memory_summary`：单段文本记忆摘要。

当前 dry-run 不返回原始 `memory_injection`，而以顶层 `memory` 返回结构化记忆结果。

如果需要请求期原始注入结果，请改用：

- `POST /sessions/:id/prompt-runtime/preview`
- `POST /sessions/:id/prompt-runtime/inspect`

`prompt_snapshot.regex_pre_rule_names` 和 `prompt_snapshot.regex_post_rule_names` 当前表示本轮装配时启用并写入快照的规则名列表。
调用方使用这些列表比对资源版本和展示调试资料；逐条命中与执行情况按对应运行追踪判断。

### 宏系统调试字段

调用方通过 `runtime_trace.macro` 检查本次提示组装中的宏求值和变更预览。

| 字段                                   | 位置            | 类型     | 说明                                    |
| -------------------------------------- | --------------- | -------- | --------------------------------------- |
| `runtime_trace.macro.warnings`         | `runtime_trace` | array    | 宏求值 warning 列表                     |
| `runtime_trace.macro.used_names`       | `runtime_trace` | string[] | 本轮实际使用到的宏名                    |
| `runtime_trace.macro.mutation_preview` | `runtime_trace` | array    | preview / dry-run 下的 would-write 列表 |
| `runtime_trace.macro.staged_mutations` | `runtime_trace` | array    | assemble 阶段冻结的 staged mutation     |
| `runtime_trace.macro.traces`           | `runtime_trace` | array    | 宏求值 trace 列表                       |

`runtime_trace.macro.traces` 的记录包含以下字段：

- `macro_name`
- `raw_text`
- `resolved_text`
- `phase`
- `source_kind`
- `selected_branch`

其中：

- `phase` 用于区分 `preview`、`dry_run`、`assemble`、`commit_consume` 等阶段
- `source_kind` 用于区分 `macro`、`if`、`raw` 等来源
- `selected_branch` 当前主要用于 `if` block，可能是 `then`、`else` 或 `raw`

### 宏系统行为边界

`POST /sessions/:id/respond/dry-run` 和 `POST /sessions/:id/prompt-runtime/preview` 使用只读宏执行语义。只读宏照常求值；写宏的预期写入通过 `runtime_trace.macro.mutation_preview` 返回，不更新持久变量。单段文本 preview 的 `runtime_trace.macro.staged_mutations` 为空。

`POST /sessions/:id/respond`、`POST /sessions/:id/respond/stream`、`POST /sessions/:id/regenerate`、`POST /floors/:id/retry`、`POST /floors/:id/retry-step` 和 `POST /messages/:id/edit-and-regenerate` 会在组装提示词时暂存写宏变更，并在本次 turn 成功提交时应用。

### 预算、来源选择与工具调试字段

| 字段                                                 | 位置            | 类型   | 说明                                                                                                          |
| ---------------------------------------------------- | --------------- | ------ | ------------------------------------------------------------------------------------------------------------- |
| `runtime_trace.budgets.trim_reasons`                 | `runtime_trace` | array  | 结构化裁剪原因                                                                                                |
| `runtime_trace.source_selection.excluded_sources`    | `runtime_trace` | array  | history、memory、worldbook 或 examples 来源未进入提示词的原因                                                 |
| `runtime_trace.tool_transport.selection.transport`   | `runtime_trace` | string | 本轮工具调用 transport 选择                                                                                   |
| `runtime_trace.tool_transport.selection.reason_code` | `runtime_trace` | string | transport 选择原因                                                                                            |
| `runtime_trace.tool_transport.tool_list`             | `runtime_trace` | object | text protocol 工具目录注入摘要，按情况返回。包含 `tool_count`、`token_count`、`budget_group`                  |
| `runtime_trace.tool_transport.parsing`               | `runtime_trace` | object | text protocol tool block 解析统计与诊断，按情况返回。包含 `diagnostics_by_reason`                             |
| `runtime_trace.tool_transport.tool_result`           | `runtime_trace` | object | text protocol 工具结果回写摘要，按情况返回。包含 `written_back`、`block_count`、`token_count`、`budget_group` |

`runtime_trace.history_normalization` 说明连续 user floor 的归并结果及跨 floor 连续 assistant 段检查结果。`runtime_trace.budgets.by_group[].group` 与 `runtime_trace.budgets.trim_reasons[].group` 是 budget group 标签，可以出现具体 section 标签，例如 `section:main`；`runtime_trace.source_selection.excluded_sources[].source` 使用公开 source kind `history`、`memory`、`worldbook` 或 `examples`。

### `if` 条件块支持范围

当前宏系统支持以下 `if` 条件子集：

- truthy / falsy
- `==`
- `!=`
- `>`
- `<`
- `>=`
- `<=`
- `and`
- `or`
- `not`
- `contains`
- `startsWith`
- 括号分组

字段含义如下：

- `==` / `!=`：两侧都能解析为有限数字时按数字比较，否则按字符串比较
- `>` / `<` / `>=` / `<=`：只做数值比较
- `contains` / `startsWith`：按区分大小写的字符串谓词处理
- `and` / `or`：按短路语义求值
- 未命中分支和短路未求值一侧不会执行写宏

当条件包含不支持的语法、无法解析的结构或不合法的数值比较类型时，求值器保留原始 `if` block 文本，并分别返回 `macro_condition_unsupported`、`macro_parse_failed` 或 `macro_arg_type_invalid` warning。调用方应按本节支持的语法修正条件表达式和括号结构，并为数值比较提供合法数值；随后调用 `POST /sessions/:id/respond/dry-run`，确认对应 warning 已消失。

### 变量宏与作用域兼容视图

当前 ST 变量宏在运行时区分 local / global 兼容视图：

- `.name` / `getvar::name` / `hasvar::name` 读取 local 兼容视图
- `$name` / `getglobalvar::name` / `hasglobalvar::name` 读取 global 兼容视图
- `setvar`、`addvar`、`incvar`、`decvar`、`deletevar` 只写 local overlay
- `setglobalvar`、`addglobalvar`、`incglobalvar`、`decglobalvar`、`deleteglobalvar` 只写 global overlay

当前也支持结构化变量路径，例如：

```text
{{getvar::资产.金币}}
{{.资产.金币}}
{{setvar::资产.金币::3}}
{{deletevar::资产.银币}}
{{.资产.金币=3}}
{{$账户.余额=100}}
{{.计数++}}
{{.计数--}}
{{varexists::资产.金币}}
{{flushvar::资产.银币}}
```

字段读取规则如下：

- 先按完整 flat key 查找
- 找不到完整 key 时，再按路径语义读取或写入
- `varexists` / `globalvarexists` 分别归一化到 `hasvar` / `hasglobalvar`
- `flushvar` / `flushglobalvar` 分别归一化到 `deletevar` / `deleteglobalvar`
- 当前只支持 shorthand 写入子集：`.name=value`、`$name=value`、`.name++`、`.name--`
- 以下表达式超出当前写入子集：`$name++`、`$name--`、`||=`、`??=`、`==`

如需完整说明，请参考 [Macros](https://fzfz.github.io/TavernHeadless-docs/reference/api/macros#变量作用域兼容视图)。

### 组装结果与 token 预算

`assembly` 包含以下两类字段：

- **兼容 / 摘要字段**：`mode`、`prompt_intent`、`preset_used`、`reserved_variable_collisions`、`selected_prompt_order_character_id`、`unsupported_preset_fields`、`preset_warnings` 等，用来说明当前预设兼容边界和 dry-run 摘要。
- **可与 `runtime_trace` 对齐的事实**：`assistant_prefill_*`、`regex_*`、`worldbook_hits`、`worldbook_matches`、`memory_summary_injected`、`continue_nudge_*`、`names_behavior_applied` 等。

调用方优先读取 `runtime_trace` 中的结构化追踪字段；`assembly` 中对应字段的映射包括：`assistant_prefill_* -> runtime_trace.delivery`、`regex_* / preprocessed_user_message -> runtime_trace.regex`、`worldbook_hits / worldbook_matches -> runtime_trace.worldbook`、`memory_summary_injected -> runtime_trace.memory`。

响应同时提供顶层 `token_estimate`、顶层 `available_for_reply` 和 `prompt_snapshot.token_estimate`。前两项适合直接消费；`prompt_snapshot.token_estimate` 适合与 `prompt_snapshot` 一起展示、持久化比对或查看历史解释。

## 重新生成

```http
POST /sessions/:id/regenerate
```

路径参数 `id` 为会话 ID。

重新生成会话最后一个楼层的 AI 回复。当前实现会创建一个新的 floor，并把旧 floor 标记为 superseded 保留。旧楼层不会出现在默认时间线和分支视图中，但仍可按 ID 审计读取。

### 请求体

| 字段                                      | 类型             | 必填 | 说明                                                                                                                    |
| ----------------------------------------- | ---------------- | ---- | ----------------------------------------------------------------------------------------------------------------------- |
| `config`                                  | TurnConfig       | 否   | 回合配置覆盖                                                                                                            |
| `generation_params`                       | GenerationParams | 否   | 生成参数覆盖                                                                                                            |
| `prompt_runtime_injections`               | object[]         | 否   | 当前请求级 Prompt Runtime Injection 列表。字段见[Prompt Runtime Injection 请求字段](#prompt-runtime-injection-请求字段) |
| `confirmed_execution_ids`                 | string[]         | 否   | 确认允许 replay 的工具执行 ID 列表                                                                                      |
| `confirmed_session_state_mutation_ids`    | string[]         | 否   | 确认允许 replay 的 session-state mutation ID 列表                                                                       |
| `session_state_writes`                    | object[]         | 否   | Session State 写入声明，字段与提交时序见[respond 请求体](#请求体)。                                                     |
| `debug_options`                           | object           | 否   | live 最小观测开关，默认关闭                                                                                             |
| `debug_options.include_prompt_snapshot`   | boolean          | 否   | 成功响应 `data` 中返回 `prompt_snapshot`                                                                                |
| `debug_options.include_runtime_trace`     | boolean          | 否   | 成功响应 `data` 中返回 `runtime_trace`                                                                                  |
| `debug_options.include_worldbook_matches` | boolean          | 否   | 只有在 `include_runtime_trace=true` 时才会展开世界书命中详情                                                            |

回放确认字段和恢复步骤见[回放确认](#回放确认)。

### 响应 `200`

```json
{
  "data": {
    "floor_id": "floor_13",
    "floor_no": 13,
    "previous_floor_id": "floor_12",
    "generated_text": "...",
    "summaries": [],
    "total_usage": {
      "prompt_tokens": 320,
      "completion_tokens": 128,
      "total_tokens": 448
    },
    "memory": {
      "mode": "sync",
      "status": "applied",
      "job_id": null
    },
    "final_state": "committed"
  }
}
```

其中 `previous_floor_id` 指向被替代的旧楼层。

调试字段的返回条件见[respond 响应](#响应-200)。

如果服务端启用了 queue 模式，而请求在排队期间会话的最新 committed floor 已经变化，接口会返回 `409 generation_target_stale`。除此之外，其余生成期错误语义与 `/sessions/:id/respond` 一致，包括 `commit_busy`（`503`）和 `generation_timeout`（`504`）。

## 楼层重试

```http
POST /floors/:id/retry
```

路径参数 `id` 为楼层 ID。

调用方对 `state=committed` 的楼层发起原地重试。服务端清空该楼层当前的 output page 和 assistant message，再在同一楼层重新生成。

目标楼层处于其他状态时，接口返回 `409 invalid_state` 并说明该楼层尚未提交。调用方查询该楼层的运行状态，再按状态选择继续、恢复或重试入口；需要重试时传入已提交楼层 ID。

### 请求体

| 字段                                      | 类型             | 必填 | 说明                                                                                                                    |
| ----------------------------------------- | ---------------- | ---- | ----------------------------------------------------------------------------------------------------------------------- |
| `config`                                  | TurnConfig       | 否   | 回合配置覆盖                                                                                                            |
| `generation_params`                       | GenerationParams | 否   | 生成参数覆盖                                                                                                            |
| `prompt_runtime_injections`               | object[]         | 否   | 当前请求级 Prompt Runtime Injection 列表。字段见[Prompt Runtime Injection 请求字段](#prompt-runtime-injection-请求字段) |
| `confirmed_execution_ids`                 | string[]         | 否   | 确认允许 replay 的工具执行 ID 列表                                                                                      |
| `confirmed_session_state_mutation_ids`    | string[]         | 否   | 确认允许 replay 的 session-state mutation ID 列表                                                                       |
| `session_state_writes`                    | object[]         | 否   | Session State 写入声明，字段与提交时序见[respond 请求体](#请求体)。                                                     |
| `debug_options`                           | object           | 否   | live 最小观测开关，默认关闭                                                                                             |
| `debug_options.include_prompt_snapshot`   | boolean          | 否   | 成功响应 `data` 中返回 `prompt_snapshot`                                                                                |
| `debug_options.include_runtime_trace`     | boolean          | 否   | 成功响应 `data` 中返回 `runtime_trace`                                                                                  |
| `debug_options.include_worldbook_matches` | boolean          | 否   | 只有在 `include_runtime_trace=true` 时才会展开世界书命中详情                                                            |

回放确认字段和恢复步骤见[回放确认](#回放确认)。

### 响应 `200`

```json
{
  "data": {
    "floor_id": "floor_05",
    "floor_no": 5,
    "branch_id": "main",
    "generated_text": "...",
    "summaries": [],
    "total_usage": {
      "prompt_tokens": 200,
      "completion_tokens": 80,
      "total_tokens": 280
    },
    "memory": {
      "mode": "sync",
      "status": "applied",
      "job_id": null
    },
    "final_state": "committed"
  }
}
```

调试字段的返回条件见[respond 响应](#响应-200)。

如果服务端启用了 queue 模式，而目标 floor 在等待期间的结构化上下文已经变化（例如 `branch_id` 或 `floor_no` 被修改），接口会返回 `409 generation_target_stale`。

除楼层不存在、目标状态不允许及 `step_retry_blocked_side_effect` 外，其余错误及恢复操作见[常见错误](#常见错误)。

## 楼层 Step 级重试

```http
POST /floors/:id/retry-step
```

路径参数 `id` 为楼层 ID。

对一个**已 commit** 的楼层，从指定的某个 LLM 生成步（step）开始重试。与「楼层重试」整轮重跑不同，它会保留起点步之前已成功的工具往返结果并原样回放，只把起点步及其之后的内容在同一 floor id 上以新 attempt 重新生成。

起点约束：`from_step_index` 指向的那一步，其工具必须没有写类副作用（`side_effect_level` 为 `none`）。否则返回 `409 step_retry_blocked_side_effect`。

起点之前已经产生的写类副作用**不会回滚**，只会在响应的 `irreversible_side_effects` 中列出，供调用方提示用户。

### 请求体

| 字段                                      | 类型             | 必填   | 说明                                                                                                                    |
| ----------------------------------------- | ---------------- | ------ | ----------------------------------------------------------------------------------------------------------------------- |
| `from_step_index`                         | integer          | **是** | 从哪一步开始重生成，1-based，≥ 1                                                                                        |
| `config`                                  | TurnConfig       | 否     | 回合配置覆盖                                                                                                            |
| `generation_params`                       | GenerationParams | 否     | 生成参数覆盖                                                                                                            |
| `prompt_runtime_injections`               | object[]         | 否     | 当前请求级 Prompt Runtime Injection 列表。字段见[Prompt Runtime Injection 请求字段](#prompt-runtime-injection-请求字段) |
| `confirmed_execution_ids`                 | string[]         | 否     | 确认允许 replay 的工具执行 ID 列表                                                                                      |
| `confirmed_session_state_mutation_ids`    | string[]         | 否     | 确认允许 replay 的 session-state mutation ID 列表                                                                       |
| `session_state_writes`                    | object[]         | 否     | Session State 写入声明，字段与提交时序见[respond 请求体](#请求体)。                                                     |
| `debug_options`                           | object           | 否     | live 最小观测开关，默认关闭                                                                                             |
| `debug_options.include_prompt_snapshot`   | boolean          | 否     | 成功响应 `data` 中返回 `prompt_snapshot`                                                                                |
| `debug_options.include_runtime_trace`     | boolean          | 否     | 成功响应 `data` 中返回 `runtime_trace`                                                                                  |
| `debug_options.include_worldbook_matches` | boolean          | 否     | 只有在 `include_runtime_trace=true` 时才会展开世界书命中详情                                                            |

回放确认字段和恢复步骤见[回放确认](#回放确认)。

### 响应 `200`

```json
{
  "data": {
    "floor_id": "floor_05",
    "floor_no": 5,
    "branch_id": "main",
    "generated_text": "...",
    "summaries": [],
    "total_usage": {
      "prompt_tokens": 200,
      "completion_tokens": 80,
      "total_tokens": 280
    },
    "memory": { "mode": "sync", "status": "applied", "job_id": null },
    "final_state": "committed",
    "discarded_from_step_index": 3,
    "irreversible_side_effects": [
      {
        "execution_id": "exec_01",
        "tool_name": "write_file",
        "side_effect_level": "irreversible",
        "started_at": 1735689600000,
        "generation_step_no": 2
      }
    ]
  }
}
```

在 `/floors/:id/retry` 响应的基础上，额外返回：

| 字段                                             | 类型           | 说明                                     |
| ------------------------------------------------ | -------------- | ---------------------------------------- |
| `discarded_from_step_index`                      | number         | 实际被丢弃并重生成的起点步号             |
| `irreversible_side_effects`                      | object[]       | 起点之前已产生、不会回滚的写类副作用摘要 |
| `irreversible_side_effects[].execution_id`       | string         | 工具执行 ID                              |
| `irreversible_side_effects[].tool_name`          | string         | 工具名                                   |
| `irreversible_side_effects[].side_effect_level`  | string         | 副作用级别                               |
| `irreversible_side_effects[].started_at`         | number         | 执行开始时间戳（ms）                     |
| `irreversible_side_effects[].generation_step_no` | number \| null | 该执行所属的生成步号，允许为 `null`      |

### 错误

| 状态码 | `error.code`                     | 说明                                       |
| ------ | -------------------------------- | ------------------------------------------ |
| `409`  | `step_retry_blocked_side_effect` | 起点步的工具带写类副作用，不能作为重试起点 |

楼层不存在、状态不允许及其他错误的处理方式见[常见错误](#常见错误)；回放确认见[回放确认](#回放确认)。

## 编辑并重新生成

```http
POST /messages/:id/edit-and-regenerate
```

路径参数 `id` 为消息 ID。

修改指定消息的内容，然后基于修改后的上下文重新生成 AI 回复。可选择在新分支上操作。

### 请求体

| 字段                                      | 类型             | 必填   | 说明                                                                                                                    |
| ----------------------------------------- | ---------------- | ------ | ----------------------------------------------------------------------------------------------------------------------- |
| `content`                                 | string           | **是** | 修改后的消息内容                                                                                                        |
| `branch_id`                               | string           | 否     | 指定分支 ID（可创建新分支）                                                                                             |
| `config`                                  | TurnConfig       | 否     | 回合配置覆盖                                                                                                            |
| `generation_params`                       | GenerationParams | 否     | 生成参数覆盖                                                                                                            |
| `prompt_runtime_injections`               | object[]         | 否     | 当前请求级 Prompt Runtime Injection 列表。字段见[Prompt Runtime Injection 请求字段](#prompt-runtime-injection-请求字段) |
| `confirmed_execution_ids`                 | string[]         | 否     | 确认允许 replay 的工具执行 ID 列表                                                                                      |
| `confirmed_session_state_mutation_ids`    | string[]         | 否     | 确认允许 replay 的 session-state mutation ID 列表                                                                       |
| `session_state_writes`                    | object[]         | 否     | Session State 写入声明，字段与提交时序见[respond 请求体](#请求体)。                                                     |
| `debug_options`                           | object           | 否     | live 最小观测开关，默认关闭                                                                                             |
| `debug_options.include_prompt_snapshot`   | boolean          | 否     | 成功响应 `data` 中返回 `prompt_snapshot`                                                                                |
| `debug_options.include_runtime_trace`     | boolean          | 否     | 成功响应 `data` 中返回 `runtime_trace`                                                                                  |
| `debug_options.include_worldbook_matches` | boolean          | 否     | 只有在 `include_runtime_trace=true` 时才会展开世界书命中详情                                                            |

回放确认字段和恢复步骤见[回放确认](#回放确认)。

### 响应 `200`

```json
{
  "data": {
    "floor_id": "floor_12",
    "floor_no": 12,
    "branch_id": "alt-branch",
    "source_floor_id": "floor_11",
    "source_message_id": "msg_21",
    "generated_text": "...",
    "summaries": [],
    "total_usage": {
      "prompt_tokens": 300,
      "completion_tokens": 100,
      "total_tokens": 400
    },
    "final_state": "committed"
  }
}
```

调试字段的返回条件见[respond 响应](#响应-200)。

如果服务端启用了 queue 模式，而源消息对应的 floor 上下文在等待期间已经变化，接口会返回 `409 generation_target_stale`。

除源消息不存在外，其余错误及恢复操作见[常见错误](#常见错误)。

## 公共类型

### TurnConfig 对象

`modelCapabilityLimits` 的字段与约束见[系统能力额度](../model-capabilities.md#额度配置)。

| 字段                        | 类型    | 说明                                                                                                                                                    |
| --------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `modelCapabilityLimits`     | object  | 正整数额度覆盖；仅收紧本轮授权额度                                                                                                                      |
| `enableTools`               | boolean | 是否启用工具调用                                                                                                                                        |
| `enableDirector`            | boolean | 是否启用 Director 模块                                                                                                                                  |
| `enableVerifier`            | boolean | 是否启用 Verifier 模块                                                                                                                                  |
| `enableMemoryConsolidation` | boolean | 是否启用记忆整合                                                                                                                                        |
| `verifierFailStrategy`      | string  | Verifier 失败策略：`warn` / `block` / `retry`                                                                                                           |
| `toolMode`                  | string  | `inline` / `standalone` / `both`，默认 `inline`。`enableTools=true` 时当前运行支持 `inline`；选择 `standalone` 或 `both` 返回 `400 invalid_tool_mode`。 |
| `maxRetries`                | integer | 最大重试次数，0-5                                                                                                                                       |

### GenerationParams 对象

| 字段                | 类型             | 说明                                                              |
| ------------------- | ---------------- | ----------------------------------------------------------------- |
| `temperature`       | number \| null   | 温度，0-2。传 `null` 表示显式取消该参数                           |
| `max_output_tokens` | integer \| null  | 最大输出 token 数。传 `null` 表示显式取消该参数                   |
| `top_p`             | number \| null   | Top-P，0-1。传 `null` 表示显式取消该参数                          |
| `top_k`             | integer \| null  | Top-K，>=1。传 `null` 表示显式取消该参数                          |
| `frequency_penalty` | number \| null   | 频率惩罚。传 `null` 表示显式取消该参数                            |
| `presence_penalty`  | number \| null   | 存在惩罚。传 `null` 表示显式取消该参数                            |
| `stop_sequences`    | string[] \| null | 停止序列。传 `null` 表示显式取消该参数                            |
| `stream`            | boolean \| null  | 是否流式。传 `null` 表示显式取消该参数                            |
| `reasoning_effort`  | string \| null   | 推理力度：`low` / `medium` / `high`。传 `null` 表示显式取消该参数 |
