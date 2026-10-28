---
outline: [2, 3]
文档用途: 说明备份作业的查询、控制接口和 worker 配置入口。
读取时机: 接入备份作业或定位作业执行状态时读取。
---

# Backup Jobs（备份作业）

`/backup-jobs/*` 这组接口负责观察和控制核心资产备份作业。

这些接口直接投影 `runtime_job`，只显示 `scope_type = "backup"` 的作业。
共享模型见 [Background Jobs（后台作业）](./background-jobs)。

## 作业字段

| 字段                   | 说明                                         |
| ---------------------- | -------------------------------------------- |
| `job_kind`             | 作业类型                                     |
| `status`               | 作业整体执行状态，取值见下节                 |
| `phase`                | 作业当前所处的细分阶段                       |
| `output_artifact_path` | 后台导出产物在 artifact store 中的路径       |
| `output_expires_at`    | 导出文件的过期时间戳，过期后下载会返回 `410` |

`job_kind` 取值为 `export_core_assets`（导出）或 `restore_core_assets`（恢复）。

## 作业状态与阶段

### `status` 取值

| 值              | 说明                             |
| --------------- | -------------------------------- |
| `pending`       | 已入队，等待 worker 领取         |
| `leased`        | 已被 worker 领取，正在持有租约   |
| `running`       | 正在执行                         |
| `retry_waiting` | 失败后等待重试                   |
| `succeeded`     | 已成功完成                       |
| `dead_letter`   | 已达到最大重试次数，不再自动重试 |
| `cancelled`     | 已取消                           |

### 导出作业的 `phase`

1. `queued`
1. `collecting`
1. `serializing`
1. `writing_artifact`
1. `finalizing`
1. `completed`

### 恢复作业的 `phase`

1. `queued`
1. `validating`
1. `normalizing`
1. `remapping`
1. `publishing`
1. `rebuilding_runtime_state`
1. `finalizing`
1. `completed`

## 导出作业查询与下载示例

1. 调用 `POST /backup/jobs/export` 创建导出作业。
2. 调用 `GET /backup-jobs/:id` 轮询 `status` 和 `phase`。
3. 当 `status=succeeded` 时，调用 `GET /backup-jobs/:id/file` 下载文件。
4. 当作业进入 `dead_letter` 时，调用 `POST /backup-jobs/:id/retry` 重新排队。

## 列出作业

```http
GET /backup-jobs
```

按当前账号列出 backup 作业。

### 查询参数

| 参数         | 类型    | 必填 | 默认值       | 说明                 |
| ------------ | ------- | ---- | ------------ | -------------------- |
| `limit`      | integer | 否   | `50`         | 每页条数，最大 `100` |
| `offset`     | integer | 否   | `0`          | 偏移量               |
| `sort_order` | string  | 否   | `desc`       | 排序方向             |
| `sort_by`    | string  | 否   | `created_at` | 排序字段             |
| `job_kind`   | string  | 否   | 未指定       | 按作业类型过滤       |
| `status`     | string  | 否   | 未指定       | 按作业状态过滤       |

1. `sort_order` 取值为 `asc` 或 `desc`。
2. `sort_by` 取值为 `created_at`、`updated_at` 或 `available_at`。
3. `job_kind` 和 `status` 的取值见[作业字段](#作业字段)与[作业状态与阶段](#作业状态与阶段)。
   省略相应参数时，接口返回当前账号下全部类型或全部状态的备份作业。

### 列表响应 `200`

```json
{
  "data": [
    {
      "id": "backup-job-export-1",
      "job_kind": "export_core_assets",
      "status": "succeeded",
      "phase": "completed",
      "request": {
        "domains": null,
        "session_ids": ["sess_001"],
        "character_ids": [],
        "preset_ids": [],
        "worldbook_ids": [],
        "regex_profile_ids": [],
        "include_linked_assets": true,
        "include_vc_tags": true,
        "include_operation_logs": "referenced",
        "include_secrets": false
      },
      "result": {
        "file_name": "core-assets-20250101-120000.thbackup",
        "content_type": "application/json; charset=utf-8",
        "byte_length": 2048,
        "included_domains": [
          "characters",
          "presets",
          "worldbooks",
          "regex_profiles",
          "sessions"
        ],
        "counts": {
          "characters": 1,
          "character_versions": 1,
          "presets": 1,
          "preset_versions": 1,
          "worldbooks": 1,
          "worldbook_versions": 1,
          "worldbook_entries": 3,
          "regex_profiles": 1,
          "regex_profile_versions": 1,
          "sessions": 1,
          "session_branches": 2,
          "floors": 4,
          "pages": 4,
          "messages": 8,
          "variables": 6,
          "branch_local_variable_snapshots": 1,
          "memory_items": 3,
          "memory_edges": 2,
          "vc_tags": 1,
          "operation_logs": 1
        }
      },
      "output_artifact_path": "backup-job-export-1/output.thbackup",
      "output_expires_at": 1735689700000,
      "progress_current": 4,
      "progress_total": 4,
      "progress_message": "completed",
      "attempt_count": 1,
      "max_attempts": 5,
      "available_at": 1735689600000,
      "lease_owner": null,
      "lease_until": null,
      "last_error": null,
      "created_at": 1735689600000,
      "updated_at": 1735689650000,
      "finished_at": 1735689650000
    }
  ],
  "meta": {
    "total": 1,
    "limit": 50,
    "offset": 0,
    "has_more": false,
    "sort_by": "created_at",
    "sort_order": "desc"
  }
}
```

## 获取作业详情

```http
GET /backup-jobs/:id
```

读取单个 backup 作业的当前状态。

### 路径参数

| 参数 | 类型   | 说明    |
| ---- | ------ | ------- |
| `id` | string | 作业 ID |

### 详情响应 `200`

返回字段与列表中的单项一致。

### 常见轮询判断

1. `pending`、`leased`、`running` 或 `retry_waiting`：继续轮询。
1. `status === "succeeded"`：
   1. 对导出作业，可继续调用 `GET /backup-jobs/:id/file` 下载文件。
   1. 对恢复作业，可查看 `result.created`、`result.renamed_resources`、`result.warnings`。
1. `status === "dead_letter"`：人工决定是否重试。
1. `status === "cancelled"`：视为结束。

## 取消作业

```http
POST /backup-jobs/:id/cancel
```

只允许取消 `pending` 或 `retry_waiting` 状态的作业。

### 取消响应 `200`

```json
{
  "data": {
    "job_id": "backup-job-export-1",
    "status": "cancelled"
  }
}
```

### 取消错误

| 状态码 | code            | 说明               |
| ------ | --------------- | ------------------ |
| `404`  | `not_found`     | 作业不存在         |
| `409`  | `invalid_state` | 当前状态不允许取消 |

## 重试作业

```http
POST /backup-jobs/:id/retry
```

只允许重试 `dead_letter` 或 `cancelled` 状态的作业。

### 重试响应 `200`

```json
{
  "data": {
    "job_id": "backup-job-restore-1",
    "status": "retry_waiting"
  }
}
```

### 重试错误

| 状态码 | code            | 说明               |
| ------ | --------------- | ------------------ |
| `404`  | `not_found`     | 作业不存在         |
| `409`  | `invalid_state` | 当前状态不允许重试 |

## 下载导出产物

```http
GET /backup-jobs/:id/file
```

下载导出作业的 `.thbackup` 文件。

### 下载前提

只有满足下面条件时才允许下载：

1. 作业存在。
2. 作业类型是 `export_core_assets`。
3. 作业 `status === "succeeded"`。
4. 作业存在 `output_artifact_path`。
5. `output_expires_at` 未过期。
6. 产物文件仍然存在。

### 成功响应

1. `Content-Disposition: attachment`
1. `Content-Type: application/json; charset=utf-8`
1. 响应体为 `.thbackup` 文件内容

### 下载错误

| 状态码 | code                          | 说明                           |
| ------ | ----------------------------- | ------------------------------ |
| `404`  | `not_found`                   | 作业不存在                     |
| `409`  | `backup_artifact_unavailable` | 该作业当前没有可下载的导出产物 |
| `410`  | `artifact_expired`            | 导出文件已过期                 |

## worker 配置入口

1. worker 开关和参数见 `apps/api/src/config.ts` 的 `ENABLE_BACKUP_WORKER`
   与 `BACKUP_*` 配置项。
2. 环境配置与启动流程见 `docs/environment-operations.md`。
