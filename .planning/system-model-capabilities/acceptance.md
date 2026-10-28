# 系统模型能力验收记录

## 必须要实现的目标

主 Agent 核对正式角色会话中的系统 random、calculate、同轮续步、正文归属和状态证据，并向原生卡转换会话交付正式接口与验收证据。

## 验收清单

- 正式 HTTP 验收采用本地固定供应商响应。`acceptance/native_function_call.json` 和 `acceptance/text_protocol.json` 保存 dry-run、实际请求、最终正文、执行记录和状态证据。
- 两组 dry-run 的 `messages[0]` 包含裴修远的完整人设、第三人称要求及林澄的身份。`messages[1]` 保留林澄询问药草数量的开场，`messages[2]` 保留裴修远接续开场的台词。`assembly.names_behavior_applied` 为 off；系统消息中的人物绑定仍明确。
- 两组最终正文由林澄取药并向裴修远报价。叙述采用第三人称，直接引语归属林澄，三份药草的价格与工具计算结果 12 一致。
- `acceptance/*-dependent.json` 保存 random 样本 3 进入下一次 calculate 请求、结果 12 进入下一次模型请求和最终正文的完整链路。两条执行记录的 `acceptedPageId` 指向同一最终正文页。
- `acceptance/*-error.json` 保存除零错误。两种协议均向下一次模型请求回传 `ok:false` 和 `DIVISION_BY_ZERO`，执行记录保留完整错误对象。
- HTTP 测试同时核对关闭授权、缺失快照、固定目录隔离及请求提高额度时的 422 错误。持久化与状态测试核对最终尝试归属、事务回滚、错误证据引用和重算保留原结果。
- `session-role-model-capabilities.test.ts` 通过正式接口核对固定授权保护：普通创建请求伪造 metadata 后取得空目录，模型调用无执行记录；PATCH 修改能力、额度或来源返回 400，保留固定字段的普通 metadata 更新返回 200。创建链路测试核对私有快照和固定版本，跨主体试聊测试核对同账号已授权客户端创建的草稿可由账号主体试聊并执行 random。
- 以上证据验证组装、传输和系统执行；真实模型的随机生成表现由具备相应供应商和预算授权的后续验收记录确认。

## 非本次目标

原生角色转换任务清单由原转换会话维护，共有 117 项；下文的 C011、USER001、USER002、C023、C058、C087、C083 和 C091 是该清单中的来源角色编号。原会话继续负责 `.agents/skills/native-card-conversion/` 和清单的完整转换迭代。本次系统验收采用独立测试角色，C011、USER001、USER002、C023、C058、C087 的真实转换结果由原会话分别验收。C083 和 C091 保持跳过。

## 已获得的授权

用户已授权本次系统实现、独立工作目录、提交、推送、PR 和按正常流程合入 main。当前验收调用本地固定供应商响应，使用已有依赖与已安装的 Node 25.8.2。

## 转换会话交付入口

转换 Agent 从 `docs/character-authoring/model-capabilities.md` 读取参数、额度、错误和证据契约，从 `packages/shared/src/schemas/role-model-capabilities.schema.json` 读取结构定义，从 `apps/api/config/role-model-capabilities.json` 读取系统许可与上限。角色包继续使用 1.0.0。发布与试聊的字段位置见[启用能力](../../docs/character-authoring/model-capabilities.md#启用能力)，服务将授权固定到会话快照，前端按已有聊天接口提交文本。

转换 Agent 依据来源角色规则填写 random 的 `domain`、`distribution`、`count` 和 `replacement` 字段和 calculate 的明确表达式；原有来源规定的公式、精度、取整或权重须在角色资料和表达式中保持一致。来源资料尚未确定的参数由该卡的转换记录列为待明确项。

转换 Agent 在状态模块的 `derive(context)` 和 `validate(context)` 中读取 `toolEvidence`；状态提案需要引用工具执行时，转换 Agent 按[同轮结果和状态证据](../../docs/character-authoring/model-capabilities.md#同轮结果和状态证据)填写 `evidenceExecutionIds`。状态 Agent 结合正文判断行动是否发生，并沿用执行记录中的随机结果。普通 prompt、世界书选择、界面随机或日期派生继续采用各自已有入口。
