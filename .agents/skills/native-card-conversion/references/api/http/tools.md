---
文档用途: 提供模型工具定义、会话工具目录、权限及执行记录接口。
读取时机: 转换 Agent 核对模型工具的可用性、调用参数或结果时。
---

<!-- markdownlint-disable MD013 MD033 -->
<!-- markdownlint-configure-file {"MD024":{"siblings_only":true}} -->

# Tools（工具调用）

## 一个简单例子

假设你发现模型这次聊天没有调用到本来应该出现的工具，可以按这个顺序排查：

1. `GET /sessions/:id/tools/runtime`：先看这个会话当前真正可见的工具目录。
2. 如果工具已经在目录里，
   再看 `GET /tool-executions` 或
   `GET /floors/:id/tool-executions`，确认执行阶段发生了什么。
3. 如果工具根本没出现，
   再检查 `GET /sessions/:id/tool-permissions`，
   确认会话基础权限是否把它禁掉了。

## 先理解几个词

| 词                 | 这里的意思                                                         |
| ------------------ | ------------------------------------------------------------------ |
| 内置工具           | 系统提供的工具，例如掷骰子和读取时间                               |
| 自定义工具定义     | 客户端创建的工具名称、参数结构和处理方式                           |
| 会话运行时工具目录 | 某个会话当前可见的工具及其可用状态                                 |
| 执行记录           | `/tool-executions` 返回的工具运行状态和运行信息                    |
| 兼容调用记录       | `/tools/call-records` 返回的页级记录；状态投影见“兼容调用记录”一节 |

`script` handler 表示由服务端运行自定义脚本的工具处理方式。服务端配置 `ENABLE_UNSAFE_SCRIPT_HANDLER=true` 时，API 允许创建、更新和启用这类工具，并允许会话调用其脚本；配置关闭时，API 拒绝创建、更新或启用请求并返回 `403 tool_script_handler_disabled`，会话运行时目录将已登记定义标为 `unavailable`。

## 会话运行时工具目录

### 获取会话运行时工具目录

```http
GET /sessions/:id/tools/runtime
```

这个端点返回 `generated_at` 时刻的会话运行时工具目录，以及每个工具的可用状态。

路径参数 `id` 为会话 ID。

`availability` 为 `available` 时，调用方可以向当前回合提供该工具；`unavailable` 表示当前会话不能调用该工具；`conflict` 表示多个提供方使用了相同工具名。不可用项通过 `availability_reason` 说明原因。

MCP 工具的 `catalog_source` 表示目录读取方式：live 列举成功时为 `live`；读取失败但有可用快照时为 `cached`；读取失败且没有快照时为 `unavailable`。`unavailable` 表示当前目录内容无法确认。非 MCP 工具的 `catalog_source` 为 `null`。

每个 `*_basis` 字段说明对应运行时元数据的来源。`metadata_basis_detail` 为各字段提供 `basis` 与 `scope`：

| 字段    | 可选值                                                                                                                                        | 含义                                                                             |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `basis` | `tool_declared` / `account_override` / `server_default` / `platform_default` / `inferred_from_execution_policy` / `shallow_schema_projection` | 分别表示工具声明、账号覆盖、服务端默认、平台默认、执行策略推导和浅层参数结构投影 |
| `scope` | `tool` / `server` / `platform` / `local` / `projection` / `inference`                                                                         | 标识该来源所属范围或处理阶段                                                     |

#### 响应 `200`

```json
{
  "data": {
    "session_id": "sess_001",
    "generated_at": 1735689600000,
    "tools": [
      {
        "name": "github_create_issue",
        "description": "创建 GitHub Issue",
        "parameters": {
          "type": "object",
          "properties": { "title": { "type": "string" } },
          "required": ["title"],
          "additionalProperties": false
        },
        "provider_id": "mcp:mcp-1",
        "provider_type": "mcp",
        "source": "mcp",
        "side_effect_level": "irreversible",
        "allowed_slots": ["narrator"],
        "availability": "available",
        "availability_reason": null,
        "async_capability": "deferred_ok",
        "default_delivery_mode": "async_job",
        "catalog_source": "cached",
        "replay_safety": "never_auto_replay",
        "result_visibility": "deferred_receipt",
        "side_effect_level_basis": "server_default",
        "allowed_slots_basis": "platform_default",
        "parameter_schema_basis": "shallow_schema_projection",
        "replay_safety_basis": "inferred_from_execution_policy",
        "metadata_basis_detail": {
          "side_effect_level": { "basis": "server_default", "scope": "server" },
          "allowed_slots": { "basis": "platform_default", "scope": "platform" },
          "parameter_schema": {
            "basis": "shallow_schema_projection",
            "scope": "projection"
          },
          "replay_safety": {
            "basis": "inferred_from_execution_policy",
            "scope": "inference"
          }
        }
      }
    ],
    "conflicts": []
  }
}
```

#### 关键字段

| 字段                      | 类型           | 说明                                                                    |
| ------------------------- | -------------- | ----------------------------------------------------------------------- |
| `name`                    | string         | 调用时使用的工具名称                                                    |
| `description`             | string         | 向模型说明该工具的用途                                                  |
| `parameters`              | object         | 当前会话向模型提供的实际参数 JSON Schema；模型提交的参数须满足此 schema |
| `availability`            | string         | `available` / `unavailable` / `conflict`                                |
| `availability_reason`     | string \| null | 当前不可用或冲突时的原因                                                |
| `async_capability`        | string         | `inline_only` / `deferred_ok`                                           |
| `default_delivery_mode`   | string         | `inline` / `async_job`                                                  |
| `catalog_source`          | string \| null | MCP 目录来源：`live` / `cached` / `unavailable`；非 MCP 工具为 `null`   |
| `replay_safety`           | string         | `safe` / `confirm_on_replay` / `never_auto_replay` / `uncertain`        |
| `result_visibility`       | string         | `immediate` / `deferred_receipt`                                        |
| `side_effect_level_basis` | string \| null | 字段来源依据，见 metadata basis 说明                                    |
| `allowed_slots_basis`     | string \| null | 同上                                                                    |
| `parameter_schema_basis`  | string \| null | 同上                                                                    |
| `replay_safety_basis`     | string \| null | 同上                                                                    |
| `metadata_basis_detail`   | object \| null | 各元数据字段的来源与范围，见上表                                        |

聊天请求中的 `config.toolMode` 枚举和当前执行支持范围见[Chat API 的 TurnConfig](./chat.md#turnconfig-对象)。运行时目录中的 `async_capability` 与 `default_delivery_mode` 分别说明工具是否支持后台执行，以及本次调用的默认投递方式；采用 `async_job` 时，回合先返回 deferred receipt，再由 `runtime_job_id` 标识后台任务。

## 内置工具

### 列出内置工具

```http
GET /tools/builtin
```

这个端点列出通用系统内置工具定义。正式角色的 `random` 和 `calculate` 来自会话固定的系统能力目录，其授权和结果按[正文模型系统能力](../model-capabilities.md)契约处理。会话运行时目录还包含会话上下文工具、资源管理工具和 MCP 工具；调用方使用 `GET /sessions/:id/tools/runtime` 查看指定会话可调用的完整目录。

## 工具定义 CRUD

### 列出工具定义

```http
GET /tools/definitions
```

#### 查询参数

| 参数         | 类型    | 默认值       | 说明                                          |
| ------------ | ------- | ------------ | --------------------------------------------- |
| `source`     | string  | —            | 按来源过滤：`preset` / `character` / `custom` |
| `source_id`  | string  | —            | 按来源 ID 过滤                                |
| `enabled`    | boolean | —            | 按启用状态过滤                                |
| `sort_by`    | string  | `updated_at` | 排序字段：`updated_at` / `name`               |
| `sort_order` | string  | `desc`       | 排序方向：`asc` / `desc`                      |
| `limit`      | integer | `50`         | 每页条数                                      |
| `offset`     | integer | `0`          | 偏移量                                        |

#### 响应 `200`

```json
{
  "data": [
    {
      "id": "tooldef_lookup_npc",
      "name": "lookup_npc",
      "description": "根据名字查找 NPC 信息",
      "parameters": {
        "type": "object",
        "properties": {
          "name": { "type": "string", "description": "NPC 名字" }
        },
        "required": ["name"]
      },
      "side_effect_level": "none",
      "allowed_slots": ["narrator", "director"],
      "source": "custom",
      "source_id": null,
      "enabled": true,
      "handler_type": "script",
      "handler": {
        "script": "return { found: true, info: args.name };"
      },
      "created_at": 1735689600000,
      "updated_at": 1735689660000
    }
  ],
  "meta": {
    "total": 1,
    "limit": 50,
    "offset": 0,
    "has_more": false,
    "sort_by": "updated_at",
    "sort_order": "desc"
  }
}
```

### 获取工具定义

```http
GET /tools/definitions/:id
```

路径参数 `id` 为工具定义 ID。更新、删除和启用状态接口复用此参数。

返回单个工具定义对象，字段与列表中的单项相同。

#### 错误

错误条件和处理方式见[工具定义错误处理](#工具定义错误处理)。

### 创建工具定义

```http
POST /tools/definitions
```

#### 请求体

| 字段                | 类型           | 必填   | 说明                                                            |
| ------------------- | -------------- | ------ | --------------------------------------------------------------- |
| `name`              | string         | **是** | 工具名                                                          |
| `description`       | string         | 否     | 工具说明，默认空字符串                                          |
| `parameters`        | object         | 否     | 参数 JSON Schema，默认 `{ "type": "object", "properties": {} }` |
| `side_effect_level` | string         | 否     | 副作用级别，默认 `none`                                         |
| `allowed_slots`     | string[]       | 否     | 允许使用该工具的槽位名数组                                      |
| `source`            | string         | 否     | 来源，默认 `custom`                                             |
| `source_id`         | string \| null | 否     | 来源对象 ID                                                     |
| `enabled`           | boolean        | 否     | 是否启用，默认 `true`                                           |
| `handler_type`      | string         | 否     | 当前只公开 `script`                                             |
| `handler`           | object         | 否     | `script` 处理器配置对象                                         |

`script` handler 的配置许可、错误码及目录状态见[配置说明](#先理解几个词)。

工具定义的唯一性按账号空间计算。同一账号下，重复的 `(name, source, source_id)` 组合会返回稳定的冲突错误；不同账号可以创建同名 custom tool。

#### 请求示例

```json
{
  "name": "lookup_npc",
  "description": "根据名字查找 NPC 信息",
  "parameters": {
    "type": "object",
    "properties": {
      "name": { "type": "string", "description": "NPC 名字" }
    },
    "required": ["name"]
  },
  "side_effect_level": "none",
  "allowed_slots": ["narrator", "director"],
  "source": "custom",
  "handler_type": "script",
  "handler": {
    "script": "return { found: true, info: args.name };"
  }
}
```

#### 响应 `201`

返回创建后的完整工具定义对象。

#### 错误

错误条件和处理方式见[工具定义错误处理](#工具定义错误处理)。

### 更新工具定义

```http
PATCH /tools/definitions/:id
```

部分更新。至少传一个字段。

请求体字段与创建接口一致，但全部改为可选。

#### 错误

错误条件和处理方式见[工具定义错误处理](#工具定义错误处理)。

### 删除工具定义

```http
DELETE /tools/definitions/:id
```

#### 响应 `200`

```json
{
  "data": {
    "id": "tooldef_lookup_npc",
    "deleted": true
  }
}
```

#### 错误

错误条件和处理方式见[工具定义错误处理](#工具定义错误处理)。

### 启用或禁用工具定义

```http
PATCH /tools/definitions/:id/toggle
```

#### 请求体

```json
{
  "enabled": false
}
```

#### 错误

错误条件和处理方式见[工具定义错误处理](#工具定义错误处理)。

### 工具定义错误处理

| 状态码 | `error.code`                   | 情况与调用方操作                                                                                                            |
| ------ | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `400`  | `validation_error`             | 请求字段或参数 schema 未通过校验。读取 `error.details` 指向的字段，修正请求体后重试；更新接口还要求至少提供一个可更新字段。 |
| `403`  | `tool_script_handler_disabled` | 服务端策略关闭了 `script` handler。调用方联系服务管理员启用该处理方式后再提交写入。                                         |
| `404`  | `not_found`                    | 工具定义 ID 不存在。调用 `GET /tools/definitions` 刷新列表，再使用返回的定义 ID。                                           |
| `409`  | `tool_definition_conflict`     | 当前账号下已有相同的 `(name, source, source_id)` 身份。调用方选择新的身份组合，或读取并更新现有定义。                       |

## 执行记录

### 查询工具执行记录

```http
GET /tool-executions
```

`GET /tool-executions` 为每次工具执行返回一条记录。调用方至少提供 `session_id`、`floor_id`、`run_id` 三个过滤参数之一。

#### 查询参数

| 参数              | 类型    | 默认值       | 说明                                                                                                        |
| ----------------- | ------- | ------------ | ----------------------------------------------------------------------------------------------------------- |
| `session_id`      | string  | —            | 按会话过滤                                                                                                  |
| `floor_id`        | string  | —            | 按楼层过滤                                                                                                  |
| `run_id`          | string  | —            | 按楼层运行 ID 过滤                                                                                          |
| `caller_slot`     | string  | —            | 按调用方槽位过滤：`narrator` / `director` / `verifier` / `memory`                                           |
| `tool_name`       | string  | —            | 按工具名过滤                                                                                                |
| `status`          | string  | —            | 按执行状态过滤：`running` / `queued` / `success` / `error` / `denied` / `timeout` / `uncertain` / `blocked` |
| `lifecycle_state` | string  | —            | 生命周期状态：`opened` / `finished`                                                                         |
| `commit_outcome`  | string  | —            | 提交结果：`pending` / `committed` / `discarded` / `replay_blocked` / `uncertain`                            |
| `provider_type`   | string  | —            | provider 类型：`builtin` / `preset` / `mcp` / `unknown`                                                     |
| `sort_by`         | string  | `started_at` | 排序字段：`created_at` / `started_at` / `finished_at`                                                       |
| `sort_order`      | string  | `desc`       | 排序方向：`asc` / `desc`                                                                                    |
| `limit`           | integer | `50`         | 每页条数                                                                                                    |
| `offset`          | integer | `0`          | 偏移量                                                                                                      |

#### 响应 `200`

```json
{
  "data": [
    {
      "execution_id": "texec_001",
      "id": "texec_001",
      "run_id": "floorrun_001",
      "floor_id": "floor_001",
      "page_id": null,
      "call_id": null,
      "generation_attempt_no": null,
      "generation_step_no": null,
      "accepted_page_id": null,
      "caller_slot": "narrator",
      "provider_id": "mcp:mcp_1",
      "provider_type": "mcp",
      "tool_name": "github_create_issue",
      "args": { "title": "Need help" },
      "result": { "accepted": true, "status": "queued" },
      "status": "uncertain",
      "lifecycle_state": "finished",
      "commit_outcome": "committed",
      "side_effect_level": "irreversible",
      "error_message": null,
      "duration_ms": 50,
      "delivery_mode": "async_job",
      "started_at": 1735689600000,
      "finished_at": 1735689600050,
      "attempt_no": 1,
      "runtime_job_id": "runtime_job_001",
      "replay_parent_execution_id": null,
      "created_at": 1735689600000,
      "replay_safety": "uncertain",
      "replay_reason": "uncertain_execution_outcome",
      "runtime_job": {
        "id": "runtime_job_001",
        "job_type": "tool.execute",
        "status": "succeeded",
        "phase": "uncertain",
        "attempt_count": 1,
        "max_attempts": 7,
        "available_at": 1735689600000,
        "started_at": 1735689600005,
        "finished_at": 1735689600050,
        "last_error": null
      },
      "policy": {
        "enable_deferred_irreversible_tools": true,
        "deferred_tool_allowlist": ["mcp:mcp_1/github_create_issue"],
        "timeout_ms": 1500,
        "max_attempts": 7,
        "retryable_statuses": ["timeout", "uncertain"],
        "max_deferred_jobs_per_run": 2,
        "max_irreversible_calls_per_run": 1
      },
      "provenance": {
        "trigger_scope": "chat_turn",
        "step_id": null,
        "parent_run_job_id": null,
        "agent_binding_id": null,
        "source_event_id": null
      },
      "roundtrip": {
        "wasAccepted": true,
        "wasEnqueued": true,
        "wasStarted": true,
        "wasCompleted": true,
        "wasUncertain": true
      }
    }
  ],
  "meta": {
    "total": 1,
    "limit": 50,
    "offset": 0,
    "has_more": false,
    "sort_by": "started_at",
    "sort_order": "desc"
  }
}
```

#### 执行记录扩展字段

| 字段                           | 类型            | 说明                                                                                              |
| ------------------------------ | --------------- | ------------------------------------------------------------------------------------------------- |
| `page_id`                      | string \| null  | 调用发生时关联的消息页；尚未关联时为 `null`                                                       |
| `call_id`                      | string \| null  | 模型调用标识，用于关联请求中的调用与回传结果；执行上下文未提供时为 `null`                         |
| `generation_attempt_no`        | integer \| null | 正文生成尝试序号，从 1 开始；执行上下文未提供时为 `null`                                          |
| `generation_step_no`           | integer \| null | 该生成尝试内的模型步骤序号，从 1 开始；执行上下文未提供时为 `null`                                |
| `accepted_page_id`             | string \| null  | 最终正文所属生成尝试中，已实际回传该执行结果时关联的正文页；未关联最终正文页或尚未提交时为 `null` |
| `attempt_no`                   | integer         | 工具执行序号，从 1 开始；与正文生成尝试序号分别记录                                               |
| `execution_id`                 | string          | 与 `id` 相同，用作执行记录标识                                                                    |
| `replay_safety`                | string          | 回放安全级别：`safe` / `confirm_on_replay` / `never_auto_replay` / `uncertain`                    |
| `replay_reason`                | string          | 回放安全判断的原因码                                                                              |
| `runtime_job`                  | object          | 后台任务摘要；同步执行时对象字段为 `null`                                                         |
| `policy`                       | object \| null  | 后台任务使用的执行策略快照；同步执行时为 `null`                                                   |
| `provenance`                   | object          | 执行来源信息                                                                                      |
| `provenance.trigger_scope`     | string          | 触发执行的请求范围                                                                                |
| `provenance.step_id`           | string \| null  | 所属执行步骤 ID                                                                                   |
| `provenance.parent_run_job_id` | string \| null  | 父运行任务 ID                                                                                     |
| `provenance.agent_binding_id`  | string \| null  | 发起执行的 Agent 绑定 ID                                                                          |
| `provenance.source_event_id`   | string \| null  | 触发执行的来源事件 ID                                                                             |
| `roundtrip`                    | object          | 汇总接收、入队、启动、完成和结果不确定状态                                                        |
| `roundtrip.wasAccepted`        | boolean         | 执行记录已被接受；`denied` 和 `blocked` 为 `false`                                                |
| `roundtrip.wasEnqueued`        | boolean         | 执行已关联后台任务                                                                                |
| `roundtrip.wasStarted`         | boolean         | 执行已开始                                                                                        |
| `roundtrip.wasCompleted`       | boolean         | 执行或后台任务已结束                                                                              |
| `roundtrip.wasUncertain`       | boolean         | 执行状态或提交结果为 `uncertain`                                                                  |

正式角色的调用记录例如 `call_id: "roll_1"`、`generation_attempt_no: 1`、`generation_step_no: 1`、`accepted_page_id: "page_final"`。调用方核对最终正文页与 `accepted_page_id` 一致，再检查相应生成尝试的参数和回传结果；同轮消费和状态证据见[同轮结果和状态证据](../model-capabilities.md#同轮结果和状态证据)。

### 查询楼层的工具执行记录

```http
GET /floors/:id/tool-executions
```

这个端点会把路径参数 `:id` 作为楼层过滤主键。查询时不需要再传 `floor_id`。

#### 路径参数

| 参数 | 类型   | 必填   | 说明    |
| ---- | ------ | ------ | ------- |
| `id` | string | **是** | 楼层 ID |

#### 查询参数

支持以下过滤字段：`run_id`、`caller_slot`、`tool_name`、`status`、`lifecycle_state`、`commit_outcome`、`provider_type`、`sort_by`、`sort_order`、`limit`、`offset`。

返回结构与 `GET /tool-executions` 相同，字段见“执行记录扩展字段”。

## 兼容调用记录

### 查询调用记录

```http
GET /tools/call-records
```

至少需要提供 `page_id` 或 `floor_id` 之一。

`GET /tools/call-records` 返回按消息页组织的兼容调用记录。完整执行状态和运行字段见 `GET /tool-executions`。

主执行状态投影为调用记录状态的规则如下：

| 主执行状态                        | 调用记录状态 |
| --------------------------------- | ------------ |
| `success`                         | `success`    |
| `denied` / `blocked`              | `denied`     |
| `queued`                          | `queued`     |
| `running`                         | `running`    |
| `error` / `timeout` / `uncertain` | `error`      |

调用记录不包含 `delivery_mode`、`runtime_job_id`、`lifecycle_state`、`commit_outcome`、`attempt_no`、`replay_parent_execution_id`、`side_effect_level` 和 `provider_type`。

#### 查询参数

| 参数          | 类型    | 默认值 | 说明                                                              |
| ------------- | ------- | ------ | ----------------------------------------------------------------- |
| `page_id`     | string  | —      | 按消息页 ID 过滤                                                  |
| `floor_id`    | string  | —      | 按楼层 ID 过滤，返回该楼层下所有页的记录                          |
| `caller_slot` | string  | —      | 按调用方实例过滤                                                  |
| `status`      | string  | —      | 按状态过滤：`success` / `error` / `denied` / `queued` / `running` |
| `sort_by`     | string  | `seq`  | 排序字段：`seq` / `created_at`                                    |
| `sort_order`  | string  | `desc` | 排序方向：`asc` / `desc`                                          |
| `limit`       | integer | `50`   | 每页条数                                                          |
| `offset`      | integer | `0`    | 偏移量                                                            |

#### 响应 `200`

```json
{
  "data": [
    {
      "id": "tc_abc123",
      "page_id": "page_xyz",
      "seq": 0,
      "caller_slot": "narrator",
      "tool_name": "random",
      "args": {
        "domain": { "kind": "integer_range", "min": 1, "max": 20 },
        "distribution": { "kind": "uniform" },
        "count": 1,
        "replacement": true
      },
      "result": { "ok": true, "data": { "samples": [17], "indices": null } },
      "status": "success",
      "duration_ms": 2,
      "created_at": 1719400000000
    }
  ],
  "meta": {
    "total": 1,
    "limit": 50,
    "offset": 0,
    "has_more": false,
    "sort_by": "seq",
    "sort_order": "desc"
  }
}
```

#### 错误

| 状态码 | code               | 说明                                                                                                                    |
| ------ | ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `400`  | `validation_error` | 请求缺少 `page_id` 与 `floor_id`，或查询参数格式不合法。读取 `error.details` 指向的参数，补齐过滤条件或修正参数后重试。 |

## 会话基础工具权限

### 权限字段

| 字段                       | 类型    | 约束              | 说明                           |
| -------------------------- | ------- | ----------------- | ------------------------------ |
| `enabled`                  | boolean | —                 | 是否启用会话工具               |
| `max_calls_per_turn`       | integer | 1–1000            | 单回合允许的工具调用数上限     |
| `max_steps_per_generation` | integer | 1–50              | 单次生成允许的工具步骤数上限   |
| `allow_irreversible`       | boolean | —                 | 是否允许不可逆工具             |
| `slot_allow_list`          | object  | 每个值为 string[] | 按实例槽位列出允许使用的工具名 |
| `slot_deny_list`           | object  | 每个值为 string[] | 按实例槽位列出禁止使用的工具名 |

`slot_allow_list` 和 `slot_deny_list` 的键为实例槽位名，例如 `narrator`、`director` 或 `verifier`。

### 获取工具权限

```http
GET /sessions/:id/tool-permissions
```

路径参数 `id` 为会话 ID。

#### 响应 `200`

```json
{
  "data": {
    "allow_irreversible": false,
    "max_calls_per_turn": 10,
    "max_steps_per_generation": 5,
    "slot_allow_list": {
      "narrator": ["random", "calculate"]
    },
    "slot_deny_list": {
      "verifier": ["set_variable"]
    }
  }
}
```

### 替换工具权限

```http
PUT /sessions/:id/tool-permissions
```

路径参数 `id` 为会话 ID。请求体整体替换该会话的工具权限对象，字段名使用上表中的 `snake_case` 名称。

### 合并更新工具权限

```http
PATCH /sessions/:id/tool-permissions
```

路径参数 `id` 为会话 ID。`PATCH` 按以下规则更新：

- `slot_allow_list` 与 `slot_deny_list` 按槽位键合并。
- 其他顶层字段使用请求中的值覆盖当前值。

#### 请求示例

```json
{
  "max_calls_per_turn": 20,
  "slot_allow_list": {
    "director": ["get_time"]
  }
}
```

### 权限接口错误处理

| 状态码 | `error.code`                                         | 情况与调用方操作                                                                     |
| ------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `400`  | `validation_error`                                   | 权限字段类型或范围不符合 schema。读取 `error.details` 指向的字段，修正请求体后重试。 |
| `403`  | `project_access_denied`                              | 当前账号缺少会话所属项目的写入权限。请项目所有者授予相应权限后重试。                 |
| `404`  | `not_found`                                          | 会话不可见或不存在。核对会话 ID 和当前账号的项目成员身份。                           |
| `409`  | `session_project_scope_missing` / `project_archived` | 会话缺少项目范围或所属项目已归档。改用活动项目中的会话，或请项目所有者恢复项目。     |

## SDK 对应方法

`@tavern/sdk` 提供以下方法读取会话工具目录和执行记录：

```ts
const catalog = await client.sessions.getRuntimeToolCatalog({
  sessionId: "sess_1",
  accountId: "acc_1",
});

const executions = await client.tools.listExecutions({
  sessionId: "sess_1",
  accountId: "acc_1",
  status: "uncertain",
});
```
