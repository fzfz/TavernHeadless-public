<!-- markdownlint-disable MD013 -->

# 正文模型的系统能力

本文供角色作者配置正文模型的随机采样和数值计算。角色资料规定人物、变量、公式和业务规则；系统执行模型提交的明确参数。原生角色包继续使用 `1.0.0` 格式。

## 启用能力

管理员必须在下列接口的请求体字段中填写能力配置。各字段使用相同结构，管理员按角色需要选择配置值。

| 配置入口                                                  | 请求体字段                         |
| --------------------------------------------------------- | ---------------------------------- |
| `POST /role-releases`：正式发布                           | `model_capabilities`               |
| `POST /role-apps`、`PUT /role-apps/:id`：草稿配置         | `configuration.model_capabilities` |
| `POST /native-cards/:cardId/publications`：原生卡发布     | `configuration.model_capabilities` |
| `POST /native-cards/:cardId/preview-sessions`：原生卡试聊 | `configuration.model_capabilities` |

例如：

```json
{
  "enabled": true,
  "allowed": ["random", "calculate"],
  "slot": "narrator",
  "transport": "text_protocol",
  "limits": {
    "maxCallsPerTurn": 16,
    "maxStepsPerGeneration": 8,
    "maxRandomSamples": 32
  }
}
```

管理员必须将 `transport` 设置为 `native_function_call` 或 `text_protocol`。正文生成服务必须使用 `packages/core/src/tools/role-model-capability-executor.ts` 中的系统提供者 `RoleModelCapabilitiesToolProvider`，向模型提供获准工具的参数说明并执行调用。前端继续提交消息文本。服务必须在每次执行前检查系统许可、固定授权和当前角色授权；系统许可或当前角色授权撤销后，下一次执行该能力返回 `CAPABILITY_DENIED`。

会话创建入口分别为 `POST /role-releases/:id/sessions`（正式角色）、`POST /role-apps/:id/preview-sessions`（草稿试聊）和上述原生卡试聊接口。创建服务必须将授权及固定角色版本写入 session 数据表的私有 `roleModelCapabilitiesSnapshotJson` 字段；运行时必须从该字段读取固定授权。普通会话创建接口 `POST /sessions` 提交的 metadata 只保存描述信息。

正式角色发布新版后，旧发布停止提供新会话，已有会话继续使用原固定授权。管理员需要撤销某个发布版本的能力时，必须调用 `PUT /role-releases/:id/publication` 并提交 `active:false`；该接口必须撤销该版本已有会话的能力，即使旧发布已经停止提供新会话。管理员提交 `active:true` 后，服务恢复该版本配置允许的能力。草稿试聊继续以草稿当前能力配置收紧固定授权。

调用方使用 `PATCH /sessions/:id` 修改由上述角色会话创建入口生成的会话 metadata 时，必须保留 `model_capabilities` 和该会话的来源字段：正式角色使用 `role_release_id`，草稿试聊使用 `role_preview`，原生卡试聊使用 `native_card`。服务必须将这些字段与私有快照比较；授权、额度或来源发生变化时，接口返回 `ROLE_MODEL_CAPABILITY_SNAPSHOT_IMMUTABLE`。用户须返回创建当前会话的角色页面，使用新的能力配置创建会话。

能力配置、工具参数及成功和错误结果由 `packages/shared/src/schemas/role-model-capabilities.schema.json` 定义。系统许可、上限和工具错误文案由 `apps/api/config/role-model-capabilities.json` 提供。发布与试聊创建服务必须验证配置额度不超过系统上限；消息处理服务必须验证单次请求额度不超过系统、固定授权及当前角色授权的共同上限。调用方须在 `POST /sessions/:id/respond`、`POST /sessions/:id/regenerate` 或 `POST /sessions/:id/respond/dry-run` 的请求体 `config.modelCapabilityLimits` 中提交需收紧的额度；dry-run 必须用该额度构建本次工具配置与模型请求，供调用方核对组装结果。

## random：随机采样

模型必须提交 `domain`、`distribution`、`count` 和 `replacement`。两枚六面骰使用：

```json
{
  "domain": { "kind": "integer_range", "min": 1, "max": 6 },
  "distribution": { "kind": "uniform" },
  "count": 2,
  "replacement": true
}
```

整数区间包含两端，边界和成员数必须为安全整数。候选抽样使用 `{"kind":"choices","values":["A","B","C"]}`。候选每个位置是独立成员，重复值保留不同下标。候选内容作为 JSON 数据返回。

`distribution` 使用均匀分布 `{"kind":"uniform"}`，或候选列表专用的加权分布 `{"kind":"weighted","weights":[0,3,1]}`。权重必须为有限非负数，与候选等长，且总和为正的有限数。零权重位置不参加抽取。

`count` 是正的安全整数。`replacement:true` 表示每次独立抽取；`false` 表示抽中位置退出后续抽样，数量须不超过可选成员数。加权无放回每次按剩余权重重新计算概率。

成功结果为 `{"ok":true,"data":{"samples":[2,5],"indices":null}}`。区间的 `indices` 固定为 `null`；候选结果返回原列表的零基下标，顺序与 `samples` 一致。骰子求和由 `calculate` 完成。旧采样入口 `roll_dice` 和 `random_choice` 迁移到 `random` 及上述参数。

## calculate：受限数值计算

模型必须提交 `expression`，取值为有限数值或运算对象。示例按攻击 28、防御 10 和最低伤害 0 计算：

```json
{
  "expression": {
    "op": "max",
    "args": [0, { "op": "sub", "args": [28, 10] }]
  }
}
```

| 运算                                 | 操作数数量 | 结果                                       |
| ------------------------------------ | ---------- | ------------------------------------------ |
| `add`、`mul`、`min`、`max`           | 至少 2 个  | 和、积、最小值、最大值                     |
| `sub`、`div`                         | 恰好 2 个  | 差、商；除数须非零                         |
| `floor`、`ceil`、`trunc`             | 恰好 1 个  | 向负无穷、正无穷、零取整                   |
| `eq`、`ne`、`lt`、`lte`、`gt`、`gte` | 恰好 2 个  | 相等、不等、小于、小于等于、大于、大于等于 |

数值运算可以嵌套；比较仅用于最外层表达式。系统按 `args` 顺序计算操作数和运算，采用 IEEE 754 binary64，每个中间结果必须有限。相等比较将正零和负零视为相等，最终负零返回 0；其他结果保持计算值。

成功数值结果为 `{"ok":true,"data":{"type":"number","value":18}}`，比较结果以 `type:"boolean"` 和布尔 `value` 返回。模型依据角色资料选择对象和操作数，表达式承载明确数值及表中运算。

## 校验、额度和失败

系统先检查授权和本轮调用额度，并限制递归数据规模。随后，系统按参数 schema 校验结构，核对跨字段约束，并检查其余输入及结果额度。控制对象采用严格字段集合，系统按原类型校验。模型只提交工具参数；调用 ID、账号、会话和生成身份由服务与协议提供。

初始系统上限为每轮 16 次工具调用、每个生成尝试 8 个模型步骤、每次 32 个样本、1024 个候选、256 个计算节点、32 层表达式深度及 32 层候选 JSON 容器。数值叶子与运算对象各计一个节点，根表达式深度为 1，根候选容器深度为 1。

工具参数和完整工具结果各限 65536 字节，服务按 `Buffer.byteLength(JSON.stringify(value), "utf8")` 计量。工具结果额度至少 1024 字节；完整工具失败结果最多 1024 字节。包装标签和调用身份由协议承载。

工具失败结果统一包含 `ok:false` 和 `error.code`、`error.message`。除数为 0 时，结果示例如下：`{"ok":false,"error":{"code":"DIVISION_BY_ZERO","message":"除数为 0，请修改 expression 中的除数。"}}`。调用方按错误码处理：

| 错误码                    | 处理动作                                   |
| ------------------------- | ------------------------------------------ |
| `INVALID_ARGUMENT`        | 按参数 schema 修正结构、类型、字段和值域。 |
| `INVALID_RANGE`           | 修正区间顺序及成员数。                     |
| `INVALID_WEIGHTS`         | 修正权重长度或总和。                       |
| `INSUFFICIENT_POPULATION` | 减少数量，或按角色规则改用有放回抽样。     |
| `LIMIT_EXCEEDED`          | 减小参数或结果规模。                       |
| `DIVISION_BY_ZERO`        | 修改除数。                                 |
| `NUMERIC_OVERFLOW`        | 缩小操作数或按角色规则拆解计算。           |
| `CAPABILITY_DENIED`       | 由管理员检查系统许可和角色授权。           |
| `EXECUTION_FAILED`        | 保留执行记录，由管理员检查服务日志。       |

工具错误返回模型后，模型可修正参数或据此续写。模型协议不匹配、轮次或步骤额度耗尽、最终正文缺失以及最后一步仍有未完成调用时，服务结束生成并保留执行证据。

供应商明确拒绝正式原生工具 schema 时，接口返回 `ROLE_MODEL_TOOL_PROTOCOL_UNSUPPORTED`，调用方须选择支持该 schema 的模型或改用文本协议。服务必须按 `packages/shared/src/config/role-tool-protocol-errors.json` 中的 HTTP 状态、结构化错误码及参数路径识别拒绝，并保留原供应商响应。限流、超时及其他请求错误继续使用各自的错误处理。生成失败与系统工具执行入口不可用的提示由 `packages/shared/src/config/api-error-messages.json` 提供。

## 同轮结果和状态证据

原生协议将调用与结构化结果送入同轮下一次模型请求；文本协议使用调用 ID 关联 `<tool_call>` 和 `<tool_result>` 后继续生成。模型收到前一步结果后再选择依赖该结果的参数。正文校验消费完成续步后的最终正文。

编排器产生 `acceptedToolExecutionIds`，包含最终正文所属生成尝试中实际回传的成功、错误和拒绝终态执行。提交服务核对运行、楼层、尝试及终态后，将这些记录的 `accepted_page_id` 固定为正文页。其他尝试保留审计记录。供应商传输重试复用已有往返，正文校验重试另记生成尝试。

`GET /floors/:id/tool-executions` 与 `GET /tool-executions` 返回执行参数、结果、调用 `call_id`、`generation_attempt_no`、`generation_step_no` 和 `accepted_page_id`。原有 `attempt_no` 继续表示工具执行序号。

状态更新模型和 `derive(context)`、`validate(context)` 取得只读 `toolEvidence`。单条证据含执行 ID、调用 ID、运行、生成尝试、步骤、正文页、工具名、参数、结果和终态，结构由 `packages/shared/src/schemas/role-tool-evidence.schema.json` 定义。提案可通过 `evidenceExecutionIds` 引用当前证据；该字段可省略，省略表示提案未引用工具执行。服务验证所提供引用的归属后继续提案、派生、校验和提交。

执行结果只证明采样或计算完成。状态 Agent 必须阅读来源正文判断行动实际发生，并按角色规则决定状态变化。状态阶段沿用记录中的随机结果。状态回看、世界书读取及固定后端计算继续使用[后端 API](backend-api.md)和[角色 JavaScript API](script-api.md)的已有入口。
