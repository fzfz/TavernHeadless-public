---
文档用途: 提供世界书和条目的管理接口及运行条件。
读取时机: 转换 Agent 配置世界书或核对条目的保存及激活结果时。
---

<!-- markdownlint-disable MD013 MD033 -->
<!-- markdownlint-configure-file {"MD024":{"siblings_only":true}} -->

# Worldbooks（世界书管理）

## 一个简单例子

```bash
# 列出所有世界书
curl http://localhost:3000/worldbooks

# 查看某个世界书里的条目
curl "http://localhost:3000/worldbooks/wb_001/entries"
```

## 提示词组装配置

### 条目激活与筛选条件

原生角色包条目的扩展配置保存以下筛选条件。这里的“生成动作”表示请求的提示词意图；这些字段决定候选条目是否进入本次提示词。

| 字段             | 类型、默认值                        | 用途                                                                                                                                                                                       |
| ---------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `triggers`       | 生成动作数组，默认 `[]`             | 空数组接受全部动作；非空数组只接受列出的动作。可选值为 `normal`、`continue`、`impersonate`、`swipe`、`regenerate`、`quiet`。                                                               |
| `delay`          | 非负整数或 `null`，默认 `null`      | `null` 或 `0` 直接通过；其他值要求扫描输入中的消息条数达到此值后，条目才能参与匹配。计数包含本次用户消息，发生在扫描深度截取之前。                                                         |
| `group`          | 字符串，默认空字符串                | 空字符串表示条目独立参与后续筛选；非空字符串使用逗号分隔组名。本次组装使用的各本世界书共同参与同组选择，每组至多保留一个候选条目。条目属于多个组时，依次接受各组筛选，后续组仍可将它排除。 |
| `group_override` | 布尔值，默认 `false`                | 同组存在此值为 `true` 的候选时，按 `order` 从大到小取第一个候选；相同 `order` 保持输入顺序。                                                                                               |
| `group_weight`   | 非负有限数或 `null`，默认权重 `100` | 同组加权随机选择时使用的权重；`null` 使用权重 `100`。                                                                                                                                      |
| `useProbability` | 布尔值，默认 `true`                 | 为 `false` 时直接通过概率条件。                                                                                                                                                            |
| `probability`    | 0 至 100 的有限数，默认 `100`       | 通过条件为 `随机数 × 100 <= probability`；100 直接通过。                                                                                                                                   |

**执行顺序**：生成动作筛选 → 消息数量条件 → 关键词与递归匹配 → 同组选择 → 概率筛选 → 预算与插入。组内获选条目未通过概率条件时，该次该组选择结束，其他组继续执行各自的筛选。

**示例**：以下条件让条目只参与普通回复，扫描输入至少包含一条消息（本次用户消息计入），与 `encounter` 组内其他命中条目按权重竞争，获选后再按 40 的概率值筛选。

```json
{
  "extra": {
    "extensions": {
      "triggers": ["normal"],
      "delay": 1,
      "group": "encounter",
      "group_weight": 25,
      "useProbability": true,
      "probability": 40
    }
  }
}
```

**查看筛选结果**：调用 `POST /sessions/:id/respond/dry-run` 并设置 `debug_options.include_worldbook_matches=true`，读取 `data.runtime_trace.worldbook.decision_traces`。调用 `POST /sessions/:id/respond` 时，在请求体 `debug_options` 中同时设置 `include_runtime_trace=true` 和 `include_worldbook_matches=true`；流式回复在 `done` 事件的 `runtime_trace` 中返回同一结构。

| 追踪字段                     | 用途                                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------------------- |
| `uid`、`activation_key`      | 标识参与筛选的条目及其本次组装标识。                                                         |
| `asset_scope_id`、`source`   | 定位条目所属资源；`source` 包含 `kind`、`worldbook_id`、`worldbook_name`、`asset_scope_id`。 |
| `stage`                      | 本条记录对应的筛选阶段：`trigger`、`delay`、`group` 或 `probability`。                       |
| `outcome`                    | 当前阶段的结果：`selected` 或 `excluded`。最终注入结果见 `matches`。                         |
| `intent`                     | 生成动作筛选时的实际请求动作。                                                               |
| `message_count`、`delay`     | 消息数量筛选时的实际消息条数与要求值。                                                       |
| `group`                      | 同组选择对应的组名。                                                                         |
| `probability`、`random_draw` | 概率条件及本次抽取的随机数；同组加权抽样也记录 `random_draw`。                               |

每条记录提供所属阶段使用的可选字段。SDK 将数组映射为 `runtimeTrace.worldbook.decisionTraces`，其中字段使用驼峰命名，例如 `randomDraw`。

**错误处理**：扫描输入无效时返回 `WORLDBOOK_TRIGGER_INPUT_INVALID`，HTTP 状态为 400，`error.details.path` 指向需修正的字段。随机数依赖返回的值必须为大于等于 0 且小于 1 的有限数；无效值产生 HTTP 500 错误 `WORLDBOOK_TRIGGER_RANDOM_INVALID`，维护者应检查生成服务的随机数配置。

### 预算保留标记

SillyTavern 原始条目的 `extensions.ignore_budget` 为布尔值。原生角色包在条目文件的 `extra.extensions.ignore_budget` 中保存该值；世界书版本保存和读取会保留它。

设置为 `true` 时，后端将该条目生成的提示词消息设为不可裁剪。条目仍按自身条件激活，其内容仍计入提示词的 token 总量。`ignore_budget` 为 `false` 或缺省的世界书条目按当前预算策略参与裁剪。

原生包条目中的配置片段：

```json
{
  "extra": {
    "extensions": {
      "ignore_budget": true
    }
  }
}
```

## 世界书管理

GET 和 PUT /worldbooks/:id 管理原始 SillyTavern payload；结构化条目 CRUD 使用后面的 /worldbooks/:worldbook_id/entries 子资源。主资源路由中的 id 是世界书 ID。

### 列出世界书

```http
GET /worldbooks
```

#### 响应 `200`

```json
{
  "data": [
    {
      "id": "wb_kingdom",
      "name": "Kingdom Lore",
      "source": "sillytavern",
      "created_at": 1735689600000,
      "updated_at": 1735689660000,
      "version": 2
    }
  ]
}
```

### 获取世界书详情

```http
GET /worldbooks/:id
```

返回完整的世界书数据。

#### 响应 `200`

```json
{
  "data": {
    "id": "wb_kingdom",
    "name": "Kingdom Lore",
    "source": "sillytavern",
    "data": {
      "name": "Kingdom Lore",
      "entries": [
        {
          "uid": 0,
          "key": ["kingdom", "realm"],
          "keysecondary": ["history"],
          "selective": true,
          "selectiveLogic": 0,
          "constant": false,
          "content": "The kingdom is recovering from a long war.",
          "comment": "Kingdom basics",
          "position": 0,
          "order": 100,
          "depth": 4,
          "role": 0,
          "disable": false,
          "scanDepth": null,
          "caseSensitive": null,
          "matchWholeWords": null
        }
      ],
      "scanDepth": 2,
      "caseSensitive": false,
      "matchWholeWords": false,
      "recursive": false,
      "maxRecursionSteps": 0
    },
    "created_at": 1735689600000,
    "updated_at": 1735689660000,
    "version": 2
  }
}
```

这里的 `data.entries[]` 使用的是原始 SillyTavern 字段名，例如 `key`、`keysecondary`、`selectiveLogic`、`scanDepth`、`caseSensitive`、`matchWholeWords`。它不同于下方 `Worldbook Entries` 子资源接口里的规范化字段 `keys`、`keys_secondary`、`selective_logic`、`scan_depth` 等。

错误条件和恢复操作见[世界书接口错误处理](#世界书接口错误处理)。

### 更新世界书

```http
PUT /worldbooks/:id
```

请求体必须提供 expected_version 或 expected_updated_at 之一作为并发控制基线；缺少两者时返回 400 validation_error。expected_version 对照世界书版本号，expected_updated_at 对照更新时间戳。

#### 请求体

| 字段                | 类型    | 必填     | 说明                                                   |
| ------------------- | ------- | -------- | ------------------------------------------------------ |
| `name`              | string  | **是**   | 名称（至少 1 字符）                                    |
| `data`              | object  | **是**   | 原始 SillyTavern 世界书 JSON 数据                      |
| expected_version    | integer | 条件必填 | 期望的世界书 version 值，与 expected_updated_at 二选一 |
| expected_updated_at | integer | 条件必填 | 期望的更新时间戳，与 expected_version 二选一           |

#### 请求示例

```json
{
  "name": "Kingdom Lore v2",
  "expected_version": 2,
  "data": {
    "name": "Kingdom Lore v2",
    "entries": [
      {
        "uid": 0,
        "key": ["kingdom", "realm"],
        "keysecondary": ["history"],
        "selective": true,
        "selectiveLogic": 0,
        "constant": false,
        "content": "The kingdom has entered a new era of peace.",
        "comment": "Kingdom basics",
        "position": 0,
        "order": 100,
        "depth": 4,
        "role": 0,
        "disable": false,
        "scanDepth": null,
        "caseSensitive": null,
        "matchWholeWords": null
      }
    ]
  }
}
```

#### 响应 `200`

```json
{
  "data": {
    "id": "wb_kingdom",
    "name": "Kingdom Lore v2",
    "source": "sillytavern",
    "created_at": 1735689600000,
    "updated_at": 1735690000000,
    "version": 3
  }
}
```

错误条件和恢复操作见[世界书接口错误处理](#世界书接口错误处理)。

### 删除世界书

```http
DELETE /worldbooks/:id
```

删除世界书时，其下所有条目会被级联删除。

调用方可通过 query string 提供 expected_version 作为删除前置条件。此接口不使用 DELETE 请求体。

#### 查询参数

| 参数             | 类型    | 必填 | 说明                               |
| ---------------- | ------- | ---- | ---------------------------------- |
| expected_version | integer | 否   | 版本前置条件；不传时删除不校验版本 |

#### 请求示例

```http
DELETE /worldbooks/wb_kingdom?expected_version=3
```

#### 响应 `204`

无响应体。

错误条件和恢复操作见[世界书接口错误处理](#世界书接口错误处理)。

### 世界书接口错误处理

| 状态码 | error.code                                    | 情况与调用方操作                                                                                                              |
| ------ | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 400    | validation_error / worldbook_validation_error | 查询参数、并发字段或原始世界书 payload 未通过校验。读取 error.details 指向的字段，修正请求体或 query string 后重试。          |
| 404    | not_found                                     | GET /worldbooks/:id 的世界书 ID 不存在。调用 GET /worldbooks 刷新列表并选择有效 ID。                                          |
| 404    | worldbook_not_found                           | 更新或带版本前置条件的删除请求找不到目标世界书。调用 GET /worldbooks 确认目标 ID。省略 expected_version 的删除仍返回 204。    |
| 409    | worldbook_conflict                            | expected_version 或 expected_updated_at 与当前值不符。重新读取世界书，使用响应中的最新 version 或 updated_at 更新请求后重试。 |
| 503    | resource_busy                                 | 资源暂时无法写入。等待后使用最新并发基线重试。                                                                                |

## 条目管理

所有条目端点都挂载在 /worldbooks/:worldbook_id/entries 下；worldbook_id 为父世界书 ID，id 为条目 ID。

### 写入并发控制

以下写入端点都支持 `expected_version`：

- `POST /worldbooks/:worldbook_id/entries`
- `PATCH /worldbooks/:worldbook_id/entries/:id`
- `DELETE /worldbooks/:worldbook_id/entries/:id`：`expected_version` 放在 query，其余写入端点放在请求体
- `PATCH /worldbooks/:worldbook_id/entries/batch/update`
- `POST /worldbooks/:worldbook_id/entries/batch/delete`
- `PUT /worldbooks/:worldbook_id/entries/batch/reorder`

冲突与资源繁忙的情况及恢复操作见[条目接口错误处理](#条目接口错误处理)。

### 条目字段说明

| 字段                    | 类型            | 说明                                                                                                                                                        |
| ----------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                    | string          | 条目 ID（系统生成）                                                                                                                                         |
| `worldbook_id`          | string          | 所属世界书 ID                                                                                                                                               |
| `uid`                   | integer         | 数值 UID（ST 兼容，自动分配）                                                                                                                               |
| `keys`                  | string[]        | 主关键词                                                                                                                                                    |
| `keys_secondary`        | string[]        | 辅助关键词                                                                                                                                                  |
| `content`               | string          | 注入的文本内容                                                                                                                                              |
| `comment`               | string          | 标题/备注                                                                                                                                                   |
| `selective`             | boolean         | 是否启用辅助关键词                                                                                                                                          |
| `selective_logic`       | integer         | 辅助关键词逻辑（0=AND_ANY, 1=NOT_ALL, 2=NOT_ANY, 3=AND_ALL）                                                                                                |
| `constant`              | boolean         | 常驻条目（无需触发）                                                                                                                                        |
| `position`              | integer         | `0` 角色定义之前；`1` 角色定义之后；`2` Author's Note 之上；`3` Author's Note 之下；`4` 指定深度；`5` 示例消息之上；`6` 示例消息之下；`7` Outlet 宏展开槽位 |
| `order`                 | integer         | 插入优先级                                                                                                                                                  |
| `depth`                 | integer         | @depth 模式的深度                                                                                                                                           |
| `role`                  | integer         | 消息角色（0=system, 1=user, 2=assistant）                                                                                                                   |
| `disable`               | boolean         | 是否禁用                                                                                                                                                    |
| `scan_depth`            | integer \| null | 独立扫描深度（null=使用全局）                                                                                                                               |
| `case_sensitive`        | boolean \| null | 独立大小写设置（null=使用全局）                                                                                                                             |
| `match_whole_words`     | boolean \| null | 独立全词匹配（null=使用全局）                                                                                                                               |
| `exclude_recursion`     | boolean         | 递归轮是否跳过该条目                                                                                                                                        |
| `prevent_recursion`     | boolean         | 该条目内容是否阻止继续进入递归缓冲区                                                                                                                        |
| `delay_until_recursion` | integer \| null | 至少递归到指定层级后才允许命中                                                                                                                              |
| outlet_name             | string          | position=7 时使用的预设插入位置名称                                                                                                                         |
| `created_at`            | integer         | 创建时间戳                                                                                                                                                  |
| `updated_at`            | integer         | 更新时间戳                                                                                                                                                  |

条目写入接口接受以下可更新字段：keys、keys_secondary、content、comment、selective、selective_logic、constant、position、order、depth、role、disable、scan_depth、case_sensitive、match_whole_words、exclude_recursion、prevent_recursion、delay_until_recursion 和 outlet_name。id、worldbook_id、uid、created_at 与 updated_at 由服务端返回。expected_version 属于写入请求顶层，用于检查父世界书版本。

### 列出条目

```http
GET /worldbooks/:worldbook_id/entries
```

#### 查询参数

| 参数         | 类型    | 默认值  | 说明                                     |
| ------------ | ------- | ------- | ---------------------------------------- |
| `limit`      | integer | 50      | 每页数量（1–200）                        |
| `offset`     | integer | 0       | 偏移量                                   |
| `sort_by`    | string  | `order` | 排序字段：`order` / `updated_at` / `uid` |
| `sort_order` | string  | `asc`   | `asc` / `desc`                           |
| `disable`    | boolean | —       | 按禁用状态过滤                           |
| `constant`   | boolean | —       | 按常驻状态过滤                           |
| `position`   | integer | —       | 按插入位置过滤                           |
| `q`          | string  | —       | 搜索关键词/备注/内容                     |

#### 响应 `200`

```json
{
  "data": [
    {
      "id": "ent_abc123",
      "worldbook_id": "wb_kingdom",
      "uid": 0,
      "comment": "Kingdom basics",
      "content": "The kingdom is vast and ancient.",
      "keys": ["kingdom", "realm"],
      "keys_secondary": ["history"],
      "selective": true,
      "selective_logic": 0,
      "constant": false,
      "position": 0,
      "order": 100,
      "depth": 4,
      "role": 0,
      "disable": false,
      "scan_depth": null,
      "case_sensitive": null,
      "match_whole_words": null,
      "exclude_recursion": false,
      "prevent_recursion": false,
      "delay_until_recursion": null,
      "outlet_name": "",
      "created_at": 1735689600000,
      "updated_at": 1735689660000
    }
  ],
  "meta": {
    "total": 1,
    "limit": 50,
    "offset": 0,
    "has_more": false,
    "sort_by": "order",
    "sort_order": "asc"
  }
}
```

### 创建条目

```http
POST /worldbooks/:worldbook_id/entries
```

#### 请求体

| 字段                    | 类型            | 必填   | 说明                                                        |
| ----------------------- | --------------- | ------ | ----------------------------------------------------------- |
| `expected_version`      | integer         | 否     | 期望的父世界书 `version` 值                                 |
| `keys`                  | string[]        | **是** | 主关键词                                                    |
| `content`               | string          | **是** | 注入内容                                                    |
| `comment`               | string          | 否     | 标题/备注                                                   |
| `keys_secondary`        | string[]        | 否     | 辅助关键词                                                  |
| `selective`             | boolean         | 否     | 默认 `true`                                                 |
| `selective_logic`       | integer         | 否     | 默认 `0`                                                    |
| `constant`              | boolean         | 否     | 默认 `false`                                                |
| `position`              | integer         | 否     | 默认 `0`；所有取值及位置含义见[条目字段说明](#条目字段说明) |
| `order`                 | integer         | 否     | 默认 `100`                                                  |
| `depth`                 | integer         | 否     | 默认 `4`                                                    |
| `role`                  | integer         | 否     | 默认 `0`                                                    |
| `disable`               | boolean         | 否     | 默认 `false`                                                |
| `scan_depth`            | integer \| null | 否     | 默认 `null`                                                 |
| `case_sensitive`        | boolean \| null | 否     | 默认 `null`                                                 |
| `match_whole_words`     | boolean \| null | 否     | 默认 `null`                                                 |
| `exclude_recursion`     | boolean         | 否     | 默认 `false`                                                |
| `prevent_recursion`     | boolean         | 否     | 默认 `false`                                                |
| `delay_until_recursion` | integer \| null | 否     | 默认 `null`                                                 |
| `outlet_name`           | string          | 否     | 默认空字符串，仅 `position=7` 时有意义                      |

`position=7` 时，`outlet_name` 选择预设插入位置。预设中的 outlet marker 是 prompt order 中名称与 `outlet_name` 相同的项目；匹配时，条目内容进入该位置。预设没有同名 marker 时，条目内容进入 `worldInfoOutlet:<outlet_name>` 提示词分区。`position` 的全部取值见[条目字段说明](#条目字段说明)。

#### 请求示例

```json
{
  "expected_version": 3,
  "keys": ["kingdom", "realm"],
  "content": "The kingdom is vast and ancient.",
  "comment": "Kingdom basics"
}
```

#### 响应 `201`

返回创建的完整条目对象（格式同列表中的单个条目）。

错误条件与恢复操作见[条目接口错误处理](#条目接口错误处理)。

### 获取条目

```http
GET /worldbooks/:worldbook_id/entries/:id
```

#### 响应 200

```json
{
  "data": {
    "id": "ent_abc123",
    "worldbook_id": "wb_kingdom",
    "content": "The kingdom is vast and ancient."
  }
}
```

`data` 返回完整条目对象。本例仅展示 `id`、`worldbook_id` 和 `content`；所有字段见[条目字段说明](#条目字段说明)。

错误条件与恢复操作见[条目接口错误处理](#条目接口错误处理)。

### 更新条目

```http
PATCH /worldbooks/:worldbook_id/entries/:id
```

部分更新，只传需要修改的字段。至少传一个字段。

请求体可选传入 `expected_version`，用于校验父世界书版本。

#### 请求示例

```json
{
  "expected_version": 3,
  "content": "The kingdom has entered a new golden age.",
  "disable": false
}
```

#### 响应 `200`

返回更新后的完整条目对象。

错误条件与恢复操作见[条目接口错误处理](#条目接口错误处理)。

### 删除条目

```http
DELETE /worldbooks/:worldbook_id/entries/:id
```

#### 查询参数

| 参数               | 类型    | 必填 | 说明                        |
| ------------------ | ------- | ---- | --------------------------- |
| `expected_version` | integer | 否   | 期望的父世界书 `version` 值 |

#### 响应 `200`

```json
{
  "data": {
    "id": "ent_abc123",
    "deleted": true
  }
}
```

错误条件与恢复操作见[条目接口错误处理](#条目接口错误处理)。

### 批量更新条目

```http
PATCH /worldbooks/:worldbook_id/entries/batch/update
```

对多个条目应用相同的字段更新。

#### 请求体

| 字段               | 类型     | 必填   | 说明                                                                              |
| ------------------ | -------- | ------ | --------------------------------------------------------------------------------- |
| `expected_version` | integer  | 否     | 期望的父世界书 `version` 值                                                       |
| ids                | string[] | **是** | 提交 1–100 个互不重复的条目 ID                                                    |
| fields             | object   | **是** | 要更新的条目字段；仅接受本章列出的可更新字段。expected_version 固定放在请求顶层。 |

#### 请求示例

```json
{
  "expected_version": 3,
  "ids": ["ent_abc123", "ent_def456"],
  "fields": {
    "disable": true
  }
}
```

#### 响应 `200`

```json
{
  "data": {
    "results": [
      {
        "index": 0,
        "id": "ent_abc123",
        "action": "updated",
        "data": {
          "id": "ent_abc123",
          "worldbook_id": "wb_kingdom",
          "content": "The kingdom is vast and ancient."
        }
      },
      {
        "index": 1,
        "id": "ent_def456",
        "action": "not_found"
      }
    ],
    "meta": {
      "total": 2,
      "updated": 1,
      "not_found": 1
    }
  }
}
```

每个结果的 `data` 是完整条目对象；本例仅展示 `id`、`worldbook_id` 和 `content`，其余字段见“条目字段说明”。

### 批量删除条目

```http
POST /worldbooks/:worldbook_id/entries/batch/delete
```

#### 请求体

| 字段               | 类型     | 必填   | 说明                           |
| ------------------ | -------- | ------ | ------------------------------ |
| `expected_version` | integer  | 否     | 期望的父世界书 `version` 值    |
| ids                | string[] | **是** | 提交 1–100 个互不重复的条目 ID |

#### 请求示例

```json
{
  "expected_version": 3,
  "ids": ["ent_abc123", "ent_def456"]
}
```

#### 响应 `200`

```json
{
  "data": {
    "results": [
      { "index": 0, "id": "ent_abc123", "action": "deleted" },
      { "index": 1, "id": "ent_def456", "action": "not_found" }
    ],
    "meta": {
      "total": 2,
      "deleted": 1,
      "not_found": 1
    }
  }
}
```

### 批量重排序条目

```http
PUT /worldbooks/:worldbook_id/entries/batch/reorder
```

批量更新条目的 `order` 字段。

#### 请求体

| 字段               | 类型     | 必填   | 说明                                          |
| ------------------ | -------- | ------ | --------------------------------------------- |
| `expected_version` | integer  | 否     | 期望的父世界书 `version` 值                   |
| items              | object[] | **是** | 提交 1–100 个条目排序项，每个条目 ID 互不重复 |
| `items[].id`       | string   | **是** | 条目 ID                                       |
| `items[].order`    | integer  | **是** | 新的排序值                                    |

#### 请求示例

```json
{
  "expected_version": 3,
  "items": [
    { "id": "ent_abc123", "order": 10 },
    { "id": "ent_def456", "order": 20 }
  ]
}
```

#### 响应 `200`

```json
{
  "data": {
    "results": [
      {
        "index": 0,
        "id": "ent_abc123",
        "action": "updated",
        "data": {
          "id": "ent_abc123",
          "worldbook_id": "wb_kingdom",
          "content": "The kingdom is vast and ancient."
        }
      },
      {
        "index": 1,
        "id": "ent_def456",
        "action": "updated",
        "data": {
          "id": "ent_def456",
          "worldbook_id": "wb_kingdom",
          "content": "The kingdom is vast and ancient."
        }
      }
    ],
    "meta": {
      "total": 2,
      "updated": 2,
      "not_found": 0
    }
  }
}
```

每个结果的 `data` 是完整条目对象；本例仅展示 `id`、`worldbook_id` 和 `content`，其余字段见“条目字段说明”。

### 条目接口错误处理

| 状态码 | error.code         | 情况与调用方操作                                                                                                                                                                   |
| ------ | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | validation_error   | 请求字段不符合 schema。读取 error.details 指向的位置后修正请求；批量条目 ID 按各端点请求表中的数量与唯一性约束提交。                                                               |
| 404    | not_found          | 父世界书不存在，或单条查询、更新、删除的条目 ID 无效。调用 GET /worldbooks 或父世界书条目列表刷新 ID。批量响应中的 action: not_found 指向未找到的条目，请读取条目列表并更正该 ID。 |
| 409    | worldbook_conflict | expected_version 与父世界书当前版本不符。调用 GET /worldbooks/:id 读取最新 version，按当前端点的请求体或 query 更新 expected_version 后重试。                                      |
| 503    | resource_busy      | 资源暂时无法写入。等待后使用最新 expected_version 重试。                                                                                                                           |
