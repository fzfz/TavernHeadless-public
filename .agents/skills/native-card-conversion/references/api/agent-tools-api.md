---
文档用途: 提供模型工具目录、授权、调用时序和结果记录契约。
读取时机: 转换 Agent 核对模型工具的可用性及结果时。
---

<!-- markdownlint-disable MD013 MD033 -->

# Agent 工具定义与调用 API

本文说明角色作者如何确认模型可用工具、定义工具参数、理解执行结果，并通过公开 HTTP 接口查看目录和执行记录。模型工具由对话请求发起；角色浏览器脚本使用[前端 API](script-api.md)，变量更新和提示词计算使用[角色卡后端 API](backend-api.md)。

## 目录

- [1. 模型流程与工具可用性](#1-模型流程与工具可用性)
- [2. 工具定义与角色关联](#2-工具定义与角色关联)
  - [2.1 参数 schema 与定义字段](#21-参数-schema-与定义字段)
  - [2.2 管理来源与运行来源](#22-管理来源与运行来源)
  - [2.3 原生 ZIP 与包外工具配置](#23-原生-zip-与包外工具配置)
- [3. 工具结果字段与状态](#3-工具结果字段与状态)
- [4. 模型调用格式与执行时序](#4-模型调用格式与执行时序)
- [5. 变量工具](#5-变量工具)
  - [5.1 get_variable：读取当前执行可见的变量](#51-get_variable读取当前执行可见的变量)
  - [5.2 set_variable：暂存本轮变量写入](#52-set_variable暂存本轮变量写入)
  - [5.3 变量读取与历史查询入口](#53-变量读取与历史查询入口)
- [6. 随机、计算与时间工具](#6-随机计算与时间工具)
- [7. 记忆与会话信息工具](#7-记忆与会话信息工具)
- [8. 会话待办工具](#8-会话待办工具)
- [9. 自定义脚本工具](#9-自定义脚本工具)
- [10. 执行事件、记录与错误处理](#10-执行事件记录与错误处理)
  - [10.1 对话 SSE 工具事件](#101-对话-sse-工具事件)
  - [10.2 查询楼层执行记录](#102-查询楼层执行记录)
  - [10.3 排查失败或不确定结果](#103-排查失败或不确定结果)
- [11. 运行时工具目录](#11-运行时工具目录)

## 1. 模型流程与工具可用性

正式角色的正文模型通过[系统能力配置](model-capabilities.md#启用能力)取得获准的 `random` 和 `calculate`。发布或试聊创建时固定能力、协议和额度，服务器按固定授权与当前许可构建工具目录；前端继续发送消息文本。

通用对话通过请求 `config.enableTools` 开启工具，`config.toolMode` 使用 `inline`；`standalone` 和 `both` 返回 `invalid_tool_mode`。调用方通过[Chat API](https://fzfz.github.io/TavernHeadless-docs/reference/api/chat#turnconfig-对象)配置请求，并通过[会话运行时工具目录](#11-运行时工具目录)确认本次可用定义。

正文模型只有在当前请求获得工具定义时才能调用。Director、Verifier、记忆整理和状态 Agent 按各自输入输出契约完成工作；状态 Agent 通过[后端 API](backend-api.md#3-stateupdate配置变量更新)取得变量、来源正文和工具证据。

## 2. 工具定义与角色关联

工具定义向模型提供工具名、用途说明和参数 schema。服务使用定义筛选当前可用工具，并在收到模型调用时将工具名路由到对应处理方式。

### 2.1 参数 schema 与定义字段

管理接口创建工具定义时使用以下公开字段；完整请求、响应和错误结构见[工具管理 API](https://fzfz.github.io/TavernHeadless-docs/reference/api/tools#工具定义-crud)。

| 字段                      | 类型                                | 用途                                                         |
| ------------------------- | ----------------------------------- | ------------------------------------------------------------ |
| `name`                    | string                              | 模型调用时使用的工具名。                                     |
| `description`             | string                              | 说明工具用途和适用时机，并发送给模型。                       |
| `parameters`              | object                              | 定义模型提交的 `args`；该对象使用 JSON Schema 风格结构。     |
| `side_effect_level`       | `none` / `sandbox` / `irreversible` | 声明工具副作用级别，供运行策略使用。                         |
| `allowed_slots`           | string[]                            | 限定可使用工具的模型槽位；空数组表示定义本身不增加槽位限制。 |
| `source`、`source_id`     | string、string 或 null              | 标识工具关联的角色、预设或自定义范围。                       |
| `handler_type`、`handler` | string、object                      | 指定处理方式及其配置；当前管理接口公开 `script`。            |
| `enabled`                 | boolean                             | 控制定义是否参与运行时加载。                                 |

`parameters` 使用 JSON Schema draft-07，支持严格字段集合、联合类型和递归引用。模型按实际 schema 的 `required`、类型和约束提交参数。系统能力的完整参数定义见[系统能力契约](model-capabilities.md)，运行时目录返回实际向本次模型提供的 schema。

### 2.2 管理来源与运行来源

工具定义管理接口的 `source` 使用 `character`、`preset` 或 `custom`，表示定义关联角色、预设或自定义范围。`source_id` 填写对应角色或预设 ID；自定义范围可以省略该字段。创建和查询参数见[工具管理 API](https://fzfz.github.io/TavernHeadless-docs/reference/api/tools#工具定义-crud)。

运行时目录中的 `source` 描述提供者类别，取值可能与管理接口中的来源分类不同。调用方使用管理响应中的 `source` 和 `source_id` 确认定义归属，使用运行时目录中的 `availability` 和 `availability_reason` 判断当前会话能否调用。

### 2.3 原生 ZIP 与包外工具配置

原生角色包 `1.0.0` 保存人物、开场、世界书、状态 Agent 配置、后端模块和前端文件。系统 `random` 和 `calculate` 的定义及执行器由服务器提供，发布与试聊的能力配置放在包外，具体请求字段见[启用能力](model-capabilities.md#启用能力)。

角色作者在 `character.json` 的 `systemPrompt` 或原生世界书中保留调用条件、参数取值规则、前后依赖与结果用途，并通过 dry-run 确认这些要求进入正文请求。提示内容提供业务规则，系统能力配置提供调用授权。

`backend/variable-tools/<name>.js` 由 `agents/state-update/profile.json` 的 `deriveScript` 引用，供后端计算状态；函数契约见[后端 API 第5章](backend-api.md#5-derivecontext计算完整状态)。

## 3. 工具结果字段与状态

工具结果包含业务数据或错误说明，并可附带执行状态与提供者诊断字段。

```typescript
type ToolCallResult = {
  data?: unknown;
  error?: string;
  executionStatus?:
    | "success"
    | "error"
    | "denied"
    | "queued"
    | "running"
    | "timeout"
    | "uncertain"
    | "blocked";
  executionReasonCode?: string;
  reconnectRequired?: boolean;
  retryable?: boolean;
  providerMessage?: string;
};
```

| 字段                  | 用途                                                                                    |
| --------------------- | --------------------------------------------------------------------------------------- |
| `data`                | 成功结果；后台交付时包含受理回执。                                                      |
| `error`               | 本次执行失败的说明。                                                                    |
| `executionStatus`     | 本次执行阶段或结果；各状态的处理方式见下表。                                            |
| `executionReasonCode` | 可选原因码，用于区分提供者报告的失败情况。                                              |
| `reconnectRequired`   | 为 `true` 时，提供者要求调用方重新建立连接。                                            |
| `retryable`           | 为 `true` 时，提供者建议调用方考虑重试；调用方仍须按 `uncertain` 处理规则核对业务结果。 |
| `providerMessage`     | 提供者返回的补充诊断文本。                                                              |

| `executionStatus` | 含义                               | 调用方操作                                                                 |
| ----------------- | ---------------------------------- | -------------------------------------------------------------------------- |
| `queued`          | 请求已受理，等待后台执行。         | 使用 `execution_id` 查询执行记录，等待终态。                               |
| `running`         | 执行仍在进行。                     | 稍后查询同一执行记录。                                                     |
| `success`         | 提供者返回成功。                   | 使用 `data`；持久化工具还应按其时序确认本轮提交结果。                      |
| `error`           | 提供者报告业务错误或执行失败。     | 阅读 `error`、原因码和工具参数约束，修正输入或满足执行条件后再调用。       |
| `denied`          | 当前执行策略拒绝调用。             | 阅读运行时目录的不可用原因，并修正工具配置或请求条件。                     |
| `timeout`         | 执行在时限内没有返回确定结果。     | 查询执行记录和业务对象，再决定是否重试。                                   |
| `uncertain`       | 无法判断提供者是否已产生业务结果。 | 先查询目标业务对象和执行详情；确认没有产生结果且符合重试策略后再提交调用。 |
| `blocked`         | 执行条件阻止工具开始或继续。       | 根据执行记录的原因说明修正条件，再发起新调用。                             |

系统能力返回包含 `ok` 的结构化结果，成功时包含 `data`，失败时包含 `error.code` 和 `error.message`。完整成功、失败与额度定义见[系统能力结果](model-capabilities.md#校验额度和失败)。下述通用工具的结果继续使用本章的 `ToolCallResult`。

在文本协议中，成功结果使用 `tool_result status="success"` 并返回 `data`；失败结果使用 `status="error"` 并返回 `error`，可附带上述诊断字段。第 4 章给出完整消息结构。

## 4. 模型调用格式与执行时序

模型根据本次工具定义提交名称和参数。原生 function calling 通过供应商结构化通道提交；文本协议使用下面的调用块：

```text
<tool_call id="call_1" name="calculate">
{"args":{"expression":{"op":"mul","args":[3,4]}}}
</tool_call>
```

`id` 区分本次调用，`name` 属于当前目录，`args` 符合对应 schema。文本协议通过相同调用 ID 关联结果。

| 运行路径                        | 调用和返回时点                                                                               | 结果消费者                                                                |
| ------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 正式角色的系统能力，两种协议    | 本轮执行工具，向下一次模型请求回传结果，再继续生成最终正文。后一步参数可使用前一步实际结果。 | 正文模型消费结果，随后状态 Agent 和后端模块取得与最终正文关联的只读证据。 |
| 通用对话的原生 function calling | 服务执行后向结构化工具消息返回结果，模型在步骤额度内继续生成。                               | 同一生成的后续模型步骤。                                                  |
| 未启用系统能力的通用文本路径    | 文本生成结束后执行调用，并将结果块与助手文本保存。                                           | 后续请求读取历史结果块；该路径在执行后结束当前生成。                      |

正式角色的最终正文归属、工具记录和状态证据见[同轮结果和状态证据](model-capabilities.md#同轮结果和状态证据)。工具结果提供计算或抽样证据，状态 Agent 阅读正文判断行动是否发生。

第10章的 SSE 工具事件通知执行阶段；完整参数、状态和结果由公开执行记录接口返回。接口调用方通过执行记录读取工具数据；角色状态栏继续读取角色状态快照，工具返回值没有状态栏的自动绑定。

inline 工具返回本次执行结果。`async_job` 工具先返回受理数据，结果可能包括 `accepted`、`execution_id`、`job_id` 和 `status:"queued"`；作者通过第 10 章的公开执行记录接口查询后续状态。运行时目录中的 `async_capability`、`default_delivery_mode` 和 `result_visibility` 说明工具的交付能力与默认方式。

业务结果返回与业务数据持久化是两个时点。例如，`set_variable` 先返回暂存结果，只有对话正文通过提交后变量写入才会保存；第 5.2 节定义该工具的保存时序。会话待办工具在返回时保存清单，第 8 章说明其行为。

## 5. 变量工具

变量范围规定值属于哪个对象：

| 范围     | 所属对象                                         |
| -------- | ------------------------------------------------ |
| `page`   | 楼层中的一份具体消息页；同一回复的候选页分别保存 |
| `floor`  | 会话中的一轮对话楼层                             |
| `branch` | 当前会话的一条剧情分支                           |
| `chat`   | 当前会话                                         |
| `global` | 服务器上下文指定的跨会话全局范围                 |

范围标识由本次工具执行上下文提供。下文的读取顺序和写入意图使用这些范围。

### 5.1 get_variable：读取当前执行可见的变量

**用途**：让模型在行动判断前读取会话变量，例如地点或精力值。

**输入**：`{key: string}`；`key` 必填且非空，填写完整变量键，例如 `stat_data`。

**输出**：`{key, value}`。`key` 是查询键；`value` 是按当前变量范围解析的值，未找到时为 `null`。

**读取顺序**：服务按 page → floor → branch → chat → global 的范围顺序读取；本轮尚未提交的工具写入优先于已保存的 page 值。

**错误**：缺少 `key` 时返回 `Missing required parameter: key`；变量读取服务不可用时返回 `VariableStore not available`。调用方填写非空变量键；服务不可用时按运行时目录的 `availability_reason` 联系服务管理员处理。

**调用示例**：

```text
<tool_call id="call-get_variable" name="get_variable">
{"args":{"key":"stat_data"}}
</tool_call>
```

**结果示例**：

```text
<tool_result id="call-get_variable" name="get_variable" status="success">
{
  "data": {
    "key": "stat_data",
    "value": {
      "location": "大厅",
      "energy": 10
    }
  }
}
</tool_result>
```

本例的 `data.value.location` 为“大厅”，模型可以据此继续判断当前位置。

### 5.2 set_variable：暂存本轮变量写入

**用途**：让模型暂存本轮产生的信息，供后续变量查询使用。

| 输入字段 | 类型与缺省                                     | 用途                                                                                                 |
| -------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `key`    | 必填非空 string                                | 要写入的变量键。                                                                                     |
| `value`  | 必填 string                                    | 要暂存的字符串值。                                                                                   |
| `intent` | 可选 string；默认 `promote_to_floor_on_accept` | `promote_to_floor_on_accept` 在正文接受后同时写入 page 和 floor 范围；`page_only` 只写入 page 范围。 |
| `reason` | 可选 string；默认 `builtin:set_variable`       | 随暂存写入保存的原因标识。                                                                           |

**输出**：`{key,value,scope,intent,reason}`。`scope` 表示目标范围；其余字段表示本次实际采用的值。

**保存时序**：工具返回时写入尚未提交的本轮缓冲。正文接受并提交后，服务保存 page 范围；`intent` 为 `promote_to_floor_on_accept` 时同时提升到 floor 范围。正文被拒绝或本轮提交失败时，服务丢弃该次暂存写入。

**错误**：缺少 `key` 时返回 `Missing required parameter: key`；变量写入服务不可用时返回 `VariableStore not available`。调用方提供非空 `key`；服务不可用时按运行时目录的 `availability_reason` 联系服务管理员处理。

**调用示例**：

```text
<tool_call id="call-set_variable" name="set_variable">
{"args":{"key":"last_action","value":"检查仓库","intent":"page_only"}}
</tool_call>
```

**结果示例**：

```text
<tool_result id="call-set_variable" name="set_variable" status="success">
{
  "data": {
    "key": "last_action",
    "value": "检查仓库",
    "scope": "page",
    "intent": "page_only",
    "reason": "builtin:set_variable"
  }
}
</tool_result>
```

此结果表示写入已暂存；正文成功提交后，调用方可读取已保存变量。工具结果状态和提交结果的查询方式见第 10 章。

### 5.3 变量读取与历史查询入口

模型需要当前执行可见值时调用 `get_variable`；角色页面回看已保存记录时使用前端 API。

| 用途                       | 调用入口                                                                           | 输入与返回                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 模型读取当前执行可见的变量 | 本章 `get_variable`                                                                | 提交 `key`，读取解析后的 `value`；见第 5.1 节。                                                |
| 角色页面读取历史对话       | [前端对话 API](script-api.md#6-已保存的楼层消息)                                   | `messages.listFloors` 分页取得楼层 ID，再调用 `messages.getFloor` 读取消息。                   |
| 角色页面读取历史变量       | [前端历史状态 API](script-api.md#93-apihistorylistsnapshots--分页列出历史变量状态) | `history.listSnapshots` 分页取得快照 ID，再调用 `variables.getSnapshot(snapshotId)` 读取状态。 |

## 6. 随机、计算与时间工具

世界书条目的候选筛选和组内选择由世界书配置控制；配置方法见[Worldbooks HTTP API：条目激活与筛选条件](http/worldbooks.md#条目激活与筛选条件)。

### 6.1 random 与 calculate

`random` 统一处理骰子、整数区间和候选采样；范围、分布、数量及放回方式由参数指定。`calculate` 执行明确数值的受限表达式。完整参数、返回值、失败和额度见[正文模型系统能力](model-capabilities.md)。

这两项能力用于生成过程中才能确定参数、且后续剧情需要实际结果的情况。页面脚本完成表单抽样，再通过[前端发送 API](script-api.md#4-聊天输入与发送)提交玩家消息；提示组装器按本章开头引用的世界书配置筛选条目；正文后的确定性状态派生由[derive(context)](backend-api.md#5-derivecontext计算完整状态)执行。

### 6.2 get_time：读取服务器当前时间

**用途**：模型需要现实时间时读取服务器当前时刻。

**输入**：空对象 `{}`。

**输出**：`{iso,unix,readable}`。`iso` 为 UTC ISO 字符串；`unix` 为 Unix 毫秒数；`readable` 为服务器本地格式文本，显示结果受服务器地区设置影响。

**调用示例**：

```text
<tool_call id="call-get-time" name="get_time">
{"args":{}}
</tool_call>
```

**结果示例**：

```text
<tool_result id="call-get-time" name="get_time" status="success">
{
  "data": {
    "iso": "2026-09-28T00:00:00.000Z",
    "unix": 1790553600000,
    "readable": "2026/9/28 08:00:00"
  }
}
</tool_result>
```

## 7. 记忆与会话信息工具

### 7.1 query_memory：读取会话记忆条目

**用途**：读取当前会话已保存的摘要、事实、事件或关系记忆。

| 输入字段        | 类型与缺省           | 用途                                                   |
| --------------- | -------------------- | ------------------------------------------------------ |
| `type`          | 可选 string          | 按 `summary`、`fact`、`event` 或 `relationship` 筛选。 |
| `limit`         | 可选 number；默认 10 | 返回数量；处理器取整并限制在 1–50。                    |
| `minImportance` | 可选 number          | 设定最低重要度筛选条件。                               |

**输出**：`{count,items}`。`count` 是返回条数；每项包含记忆 `id`、`type`、`content` 和 `importance`，结果按重要度降序排列。

**错误**：记忆查询服务不可用时返回 `MemoryStore not available`。调用方读取运行时目录的不可用原因，并联系服务管理员启用会话记忆功能。

**调用示例**：

```text
<tool_call id="call-query-memory" name="query_memory">
{"args":{"type":"fact","limit":5}}
</tool_call>
```

**结果示例**：

```text
<tool_result id="call-query-memory" name="query_memory" status="success">
{
  "data": {
    "count": 1,
    "items": [
      {
        "id": "memory-1",
        "type": "fact",
        "content": "仓库钥匙放在前台抽屉。",
        "importance": 0.8
      }
    ]
  }
}
</tool_result>
```

### 7.2 get_character_info：读取当前会话标识

**用途**：让模型取得当前会话 ID，供后续需要明确会话归属的工具使用。

**输入**：`field` 为可选字符串，默认 `all`。

**输出**：`field=all` 时返回 `{sessionId}`；指定字段时返回 `{[field]:value}`。当前只有 `sessionId` 有值，其他字段为 `null`。

**调用示例**：

```text
<tool_call id="call-character-info" name="get_character_info">
{"args":{"field":"sessionId"}}
</tool_call>
```

**结果示例**：

```text
<tool_result id="call-character-info" name="get_character_info" status="success">
{"data":{"sessionId":"session-1"}}
</tool_result>
```

## 8. 会话待办工具

### 8.1 update_todo_list：写入当前会话待办清单

**用途**：记录需要继续执行的事项及其进度，供后续调用读取。

| 输入字段         | 类型与缺省                                | 用途                                                                      |
| ---------------- | ----------------------------------------- | ------------------------------------------------------------------------- |
| `mode`           | 可选 `rewrite` / `update`；默认 `rewrite` | `rewrite` 替换整份清单；`update` 按事项 `id` 优先、否则按标题匹配并合并。 |
| `items`          | 必填对象数组                              | 本次写入的事项列表。                                                      |
| `items[].id`     | 可选 string                               | 更新已有事项时使用其稳定 ID。                                             |
| `items[].title`  | 新事项必填 string                         | 待办标题。                                                                |
| `items[].status` | 可选枚举；新事项默认 `pending`            | `pending`、`in_progress`、`completed`、`blocked` 或 `cancelled`。         |
| `items[].note`   | 可选 string                               | 事项备注。                                                                |
| `items[].delete` | 可选 boolean                              | `update` 模式下将匹配事项从清单删除。                                     |

**输出**：`{items,counts,revision}`。每项含 `id`、`title`、`status` 和可选 `note`；`counts` 含 `total` 及五种状态的数量；首次写入 `revision` 为 1，之后递增。

**保存时序**：待办服务保存清单后返回结果。正文后续被拒绝时，已返回的清单仍保留。

**错误**：执行上下文缺少账户归属时，工具返回 `accountId is required for todo tools`，角色作者将错误及会话 ID 交给服务管理员修复执行上下文。`mode` 不合法时返回 `mode must be 'rewrite' or 'update'`；`items` 不是数组时返回 `items must be an array`。调用方使用受支持的模式和事项数组，并按错误说明修正事项字段；完整约束见[工具管理 API](https://fzfz.github.io/TavernHeadless-docs/reference/api/tools)。

**调用示例**：

```text
<tool_call id="call-update-todo" name="update_todo_list">
{"args":{"mode":"rewrite","items":[{"title":"检查仓库","status":"pending"}]}}
</tool_call>
```

**结果示例**：

```text
<tool_result id="call-update-todo" name="update_todo_list" status="success">
{
  "data": {
    "items": [{"id":"todo-1","title":"检查仓库","status":"pending"}],
    "counts": {"total":1,"pending":1,"in_progress":0,"completed":0,"blocked":0,"cancelled":0},
    "revision": 1
  }
}
</tool_result>
```

### 8.2 get_todo_list：读取当前会话待办清单

**用途**：让模型根据已保存事项和状态决定后续工作。

**输入**：空对象 `{}`。

**输出**：返回第 8.1 节定义的 `items`、`counts` 和 `revision`；当前会话还没有清单时返回空 `items`、全零 `counts` 和 `revision: 0`。

**错误**：执行上下文缺少账户归属时返回 `accountId is required for todo tools`；会话不属于当前账户时返回归属错误。角色作者将错误及会话 ID 交给服务管理员核对归属并修复执行上下文，条件恢复后重试。

**调用示例**：

```text
<tool_call id="call-get-todo" name="get_todo_list">
{"args":{}}
</tool_call>
```

**结果示例**：

```text
<tool_result id="call-get-todo" name="get_todo_list" status="success">
{
  "data": {
    "items": [{"id":"todo-1","title":"检查仓库","status":"pending"}],
    "counts": {"total":1,"pending":1,"in_progress":0,"completed":0,"blocked":0,"cancelled":0},
    "revision": 1
  }
}
</tool_result>
```

## 9. 自定义脚本工具

角色、预设或自定义范围可以登记同步脚本工具。定义参数遵循第 2.1 节的 `parameters`；管理接口完整字段见[工具管理 API](https://fzfz.github.io/TavernHeadless-docs/reference/api/tools#工具定义-crud)。

**创建请求示例**：以下 JSON 是 `POST /tools/definitions` 的请求体。角色来源需将 `source_id` 替换为会话绑定的角色 ID。

```json
{
  "name": "remaining_points",
  "description": "计算给定总积分扣除已使用积分后的剩余值。",
  "source": "character",
  "source_id": "character-1",
  "parameters": {
    "type": "object",
    "properties": {
      "total": { "type": "number" },
      "used": { "type": "number" }
    },
    "required": ["total", "used"]
  },
  "handler_type": "script",
  "handler": { "script": "return { remaining: args.total - args.used };" },
  "allowed_slots": ["narrator"],
  "side_effect_level": "none",
  "enabled": true
}
```

成功创建返回 HTTP 201 和工具定义；响应中的 `id` 用于后续查询。自定义来源可将 `source` 设为 `custom` 并省略 `source_id`。

**模型调用示例**：

```text
<tool_call id="call-points" name="remaining_points">
{"args":{"total":20,"used":7}}
</tool_call>
```

**结果示例**：

```text
<tool_result id="call-points" name="remaining_points" status="success">
{"data":{"remaining":13}}
</tool_result>
```

脚本读取唯一入参 `args` 并同步返回业务数据。该工具只计算剩余积分；需要保存角色状态时，调用相应变量流程。

**错误与处理**：服务策略关闭 `script` handler 时，创建或更新接口返回 `tool_script_handler_disabled`；联系服务管理员启用该处理方式后再提交。参数或处理脚本校验失败时，读取错误详情并修正请求体或脚本。创建成功后，调用方通过[会话运行时工具目录](#11-运行时工具目录)确认当前会话是否可用。

## 10. 执行事件、记录与错误处理

### 10.1 对话 SSE 工具事件

流式对话接口 `POST /sessions/:id/respond/stream` 按条件发送 `tool` 事件。该事件描述一次工具执行，包含 `execution_id`、`tool_name`、`provider_id`、`provider_type`、`side_effect_level`、`phase`、`message`、`duration_ms` 和 `replay_safety`。完整 SSE 事件及顺序见[Chat API 的 SSE 流式生成](https://fzfz.github.io/TavernHeadless-docs/reference/api/chat#sse-流式生成)。

```text
event: tool
data: {"execution_id":"tool_exec_12","tool_name":"random","provider_id":"builtin","provider_type":"builtin","side_effect_level":"none","phase":"success","message":"Random sample returned","duration_ms":2,"replay_safety":"safe"}
```

`execution_id` 标识该次调用，可用于对话事件与执行记录之间的对应。

### 10.2 查询楼层执行记录

调用方使用公开 HTTP 接口查询某个楼层的工具执行记录：

```http
GET /floors/floor-12/tool-executions?tool_name=random&status=success
```

该接口返回 `data` 记录数组和分页 `meta`。每条记录包含执行 ID、会话运行 ID、楼层与消息页 ID、调用槽位、提供者、工具名、`args`、`result`、`status`、提交结果、交付方式及时间字段。过滤参数、全部返回字段和分页定义见[Tools HTTP API：查询楼层的工具执行记录](http/tools.md#查询楼层的工具执行记录)。

```json
{
  "data": [
    {
      "execution_id": "tool_exec_12",
      "floor_id": "floor-12",
      "tool_name": "random",
      "args": {
        "domain": { "kind": "integer_range", "min": 1, "max": 20 },
        "distribution": { "kind": "uniform" },
        "count": 1,
        "replacement": true
      },
      "result": { "ok": true, "data": { "samples": [17], "indices": null } },
      "call_id": "call-random",
      "generation_attempt_no": 1,
      "generation_step_no": 1,
      "accepted_page_id": "page-12",
      "status": "success",
      "commit_outcome": "committed",
      "delivery_mode": "inline"
    }
  ],
  "meta": { "total": 1, "limit": 50, "offset": 0, "has_more": false }
}
```

### 10.3 排查失败或不确定结果

调用方按以下顺序定位问题：

1. 调用 `GET /sessions/:id/tools/runtime`，按工具名检查 `availability`、`availability_reason` 和参数 schema；修正工具定义或当前权限条件。
2. 从对话 SSE 的 `tool` 事件读取 `execution_id`，调用第 10.2 节接口检查参数、结果、执行状态和提交结果。
3. 状态为 `queued` 或 `running` 时，使用同一查询入口等待状态更新。
4. 状态为 `timeout` 或 `uncertain` 时，先检查执行详情和目标业务系统中的实际结果；确认没有重复副作用且满足提供者重试策略后再调用。
5. 状态为 `denied`、`blocked` 或 `error` 时，按 `error`、原因码、`availability_reason` 和执行记录详情修正条件或参数后再调用。

## 11. 运行时工具目录

调用方使用以下公开接口检查某个会话当前的工具定义和可用状态：

```http
GET /sessions/:id/tools/runtime
```

响应中的 `data.tools` 列出当前会话级工具目录，`data.conflicts` 列出同名冲突。工具条目提供模型所需的 `name`、`description` 和 `parameters`，以及 `provider_id`、`provider_type`、`source`、`side_effect_level`、`allowed_slots`、`availability`、`availability_reason`、`async_capability`、`default_delivery_mode`、`result_visibility` 等运行信息。MCP 工具还会提供 `catalog_source`；各字段的枚举和来源说明见[会话运行时工具目录 API](https://fzfz.github.io/TavernHeadless-docs/reference/api/tools#获取会话运行时工具目录)。

`availability` 为 `available` 时，调用方可把该工具加入当前模型请求；`unavailable` 时先按 `availability_reason` 处理；`conflict` 时读取 `data.conflicts` 并解决重名定义。目录参数 schema 是当前调用的权威输入约束。资源工具、NodeGraph 工具和 MCP 工具的可用名称与参数由目录逐次返回，作者按实际目录生成调用，不依据仓库实现文件推断参数。

工具定义 CRUD、会话权限、工具执行记录和完整错误表见[正式 Tools HTTP API](https://fzfz.github.io/TavernHeadless-docs/reference/api/tools)。对话请求字段、SSE 事件和工具模式见[正式 Chat HTTP API](https://fzfz.github.io/TavernHeadless-docs/reference/api/chat)。
