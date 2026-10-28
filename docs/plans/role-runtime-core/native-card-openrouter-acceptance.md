# 原生角色卡 OpenRouter 免费模型验收

2026-09-29，主 Agent 完成真实外部模型验收。正式 SDK、API、SSE、持久存储和浏览器已与免费模型连通；本轮模型语义和供应商可用性验收未全部通过。受控响应的既有通过结果见[正式实现验收记录](native-card-production-acceptance.md)。

## 范围与授权

用户授权主 Agent 调研、配置并调用 OpenRouter 中合适的免费模型。本次调用范围限定为公开虚构角色包“雾港来信”，使用独立验收实例 C；实际发出 15 次模型请求，执行上限为 16 次，自动重试次数为 0。业务代码和角色包内容保持本轮开始时的版本。

验收使用提交 `8f85a4fc84806f6a13b263c32c4d707171b00e57` 对应候选目录，API 为 `http://127.0.0.1:3071`，用户端为 `http://localhost:5176`。凭据通过正式模型配置接口保存到隔离数据库的加密字段；模型、供应商和凭据均属于系统配置。

## 模型调研与配置

主 Agent 查询 OpenRouter 官方模型目录与各模型端点，逐项核对 `:free` 标识以及输入、输出单价为 0。官方资料：[免费调用限制](https://openrouter.ai/docs/api_reference/limits)、[结构化输出](https://openrouter.ai/docs/guides/features/structured-outputs)。下表只描述本次采样时的结果。

| 模型 ID | 供应商 | 请求结果 | 本次用途结论 |
| ---- | ---- | ---- | ---- |
| `qwen/qwen3.8-27b:free` | ModelRun | 2 次正文请求均返回 HTTP 429，上游共享资源池限流 | 本次未获得正文，无法判断语义质量。 |
| `dots-studio/dots-3-note-preview:free` | AtlasCloud | 3 次正文和 3 次变量更新均成功 | 可复现完整免费联调链路；语义仍有偏差。 |
| `google/gemma-4-31b-it:free` | Google AI Studio | 1 次正文请求返回 HTTP 429 | 单次限流，无法判断长期可用性或语义质量。 |
| `nvidia/nemotron-3-ultra-550b-a55b:free` | Nvidia | 3 次正文成功；3 次变量请求的 HTTP 200 响应体均包含上游 502 错误 | 当前变量更新调用方式下未通过。 |

官方模型说明：[Dots](https://openrouter.ai/dots-studio/dots-3-note-preview:free)、[Qwen](https://openrouter.ai/qwen/qwen3.8-27b:free)、[Gemma](https://openrouter.ai/google/gemma-4-31b-it:free)、[Nemotron](https://openrouter.ai/nvidia/nemotron-3-ultra-550b-a55b:free)。Gemma 端点声明 JSON 输出但不强制 JSON schema；Nemotron 端点未声明 `response_format` 支持。Nemotron 的 502 错误未说明具体原因，因此本次只判定该调用组合失败。

保留的免费联调配置为 Dots：`provider=openai-compatible`，`baseUrl=https://openrouter.ai/api/v1`；正文和变量更新各绑定一个系统模型 profile。参数为 `max_output_tokens=1600`、`temperature=0.3`、`timeout_ms=90000`、`max_retries=0`、`reasoning_effort=none`。实际请求中的参数已保存；供应商是否执行可选推理参数未单独验证。

实例 C 中正文 profile 为 `gzDIBiMK5HCDejGCXgkoZ`，变量 profile 为 `P3kU0gZT1dVwdw1cWo_tc`。可打开[Dots 第二轮会话](http://localhost:5176/?sessionId=PNyeFEfUvuCYzy_Cz8TnS)查看完整结果。此配置用于免费联调，尚未获得稳定语义质量的验收结论。

## 提示词与实际输出

各模型使用同一包修订、开场、人物、预设、初始状态和用户消息。主 Agent 先阅读正式 dry-run 的 `messages`、`assembly` 和 `runtimeTrace`，再发送请求：

- 用户人物为裴修远，31 岁男性、雾港深夜邮局管理员，完整描述进入 system 消息；沈知夏是 29 岁夜间向导。
- system 消息明确要求第三人称叙述、姓名区分动作主体、直接引语按说话者解释；`namesBehaviorApplied=off`，系统人物说明保留身份。
- 独立控制器展开“当前地点：夜间邮局。”；世界书命中 3 条，实际消息包含北岬灯塔、涨潮石阶和守灯人买报信息。
- assistant 历史为沈知夏询问检查信封或去码头；当前 user 消息为 `“我先检查信封上的邮戳，再和你去花园门口核对地址。”`，承接该开场。

六轮成功正文的实际供应商请求消息均与各自 dry-run 消息逐字段相同；原始 SSE 拼接文本、模型记录正文、持久化消息及正式 `GET /sessions/:id/role-messages` 返回的公开正文逐字相同。Dots 与 Nemotron 的浏览器第二轮还分别核对了页面正文与该公开接口正文，结果逐字相同。身份或人称偏差已经存在于供应商原始正文中。

主 Agent 阅读正文及变量规则后给出如下语义结论。变量规则要求“人物明确抵达另一地点时更新 location”。

| 样本 | 正文判断 | 变量判断 | 本轮结论 |
| ---- | ---- | ---- | ---- |
| Dots 1 | 以裴修远、沈知夏展开第三人称调查，承接检查信封；结尾仅提议“先去码头”。 | 模型将地点写为“码头”，正文没有明确抵达证据。结构与消息引用合法，语义不通过。 | 未通过 |
| Dots 2 | 第三人称与人物身份明确，持续在邮局检查邮戳和信封。 | 返回空变更，保持夜间邮局、23 时、信任 20，符合实际正文。 | 通过 |
| Dots 3 | 多处使用“你指尖”“你抬头”等第二人称叙述，违反预设。 | 正文已到花园门口；地点更新正确，小时和信任保持。 | 未通过 |
| Nemotron 1 | 第三人称检查信封并走到花园地址牌，动作主体明确。 | 上游错误导致状态未提交。 | 未通过 |
| Nemotron 2、3 | 多处第二人称叙述，违反预设。 | 上游错误导致状态未提交。 | 未通过 |

新增地址、旧照片等剧情细节属于本次生成内容；本表判断身份、人称、开场衔接和变量证据，不据此证明长篇设定一致性。

## 浏览器、存储与故障行为

Dots 第二轮由真实浏览器发送：用户正文立即显示，模型正文持续增加，变量更新完成后出现“历史状态 1”，发送按钮恢复。刷新后正文和状态保留；切换初始状态、返回当前状态均可操作。Nemotron 第二轮正文保留，页面显示“变量更新失败，请重试更新。”和重试按钮；状态保持原快照，发送处于禁用状态。

主 Agent 阅读了过程和完成截图。重启 API 后，六个已生成正文会话的显示快照、处理状态和固定版本与重启前完全一致，包括三个 Nemotron 会话尚待更新的状态。首次 SDK 样本脚本遗漏显式调用 `roleRuntime.updateState`，补调后 Dots 第一轮成功提交；该等待属于验收脚本问题。

## 费用、证据和复查

9 次成功调用的 OpenRouter generation 账单均返回 `total_cost=0`。3 次限流没有取得 generation 账单，3 次 Nemotron 变量错误的 generation 查询返回 404。账户付费累计使用量前后均为 `0.040084413`，当日付费使用量均为 0；免费配额由剩余 934 变为 925。账户配额是共享统计，具体调用数以本次 15 条调用记录为准。

下列文件位于工作区 `.planning/native-card-production/evidence/openrouter/`，保留在本机，不随文档提交：

| 证据 | 内容 |
| ---- | ---- |
| `models.json`、`*-endpoints.json` | 本次模型目录、端点与零价格记录。 |
| `*-selection.json`、`*-dry-run.json` | 固定发布配置、会话编号和组装结果。 |
| `*-calls.json`、`calls-summary.json` | 实际请求、原始响应、错误、正文、用量和账单结果。 |
| `dots-sample-2-*.txt/png`、`ultra-sample-2-*.txt/png` | 即时输入、流式正文、完成或失败、刷新和历史操作。 |
| `restart-and-chain-checks.json` | 六个会话的请求、保存正文、公开正文和 API 重启读回对照，及两轮浏览器正文对照。 |
| `quota-before.json`、`quota-after.json` | 已去除账户身份和凭据的配额及费用记录。 |

本轮修改仅同步验收文档，项目检查执行文档构建和变更检查；既有实现的完整测试结果仍见正式实现验收记录。后续要判定适合正式演绎，需修正并重新验收人称遵循、地点证据提取，以及选定供应商的结构化输出调用。当前记录保留失败结论，尚不能宣告真实模型验收全部通过。
