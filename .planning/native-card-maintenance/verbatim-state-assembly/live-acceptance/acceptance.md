---
文档用途: 记录真实角色卡使用 OpenRouter 免费模型的组装、生成、状态更新和页面验收结果。
读取时机: 核对本次实现的真实模型验收范围、失败原因及证据时。
---

# 真实角色卡与免费模型验收

## 1. 验收结论

1. 2026 年 10 月 5 日，验收程序实际向 OpenRouter 发出了 21 笔模型请求，使用了 6 个目录定价为零的 `:free` 模型。六笔有生成账单的请求费用均为零；账户累计费用保持为 `0.040084413`。证据见 [请求清单](request-index.json)、[生成账单](generation-billing.json)和 `quota-before.json`、`quota-after.json`。
2. 四个“角色卡 × 状态预设”组合的正式 dry-run、实际请求一致性和正文来源关联检查均通过。Qwen 的四份正文均生成非空文本并保存成功，人工阅读发现每份正文均有未满足的要求。
3. 十二笔真实状态请求全部失败，没有产生成功的状态提案或新状态快照。真实模型的多轮状态历史、状态变更正确性及顾声慢新正文的页面显示尚未通过验收。既有[30 组离线记录](../acceptance)覆盖的确定性行为仍已通过；该结果不能代替真实状态提交。
4. 本次页面验收发现并修复了状态 SSE 响应遗漏 CORS 头的问题。修复后的全量测试通过 562 个测试文件、5,175 项测试。

## 2. 实际输入与固定配置

1. 验收在独立 worktree 的 `codex/state-assembly-implementation` 分支运行。实现提交为`32df2e5d0354f76180f5cf742c99304d133d5e12`，本次补充修改为 API 的状态 SSE 路由及其测试。`server.json.sourceChanges` 记录补充修改的文件。
2. 验收使用仓库中的林茜、顾声慢原始角色资料及其正式原生迁移输入，通过正式接口导入完整角色资源、世界书、规则和浏览器资源，并创建隔离的角色发布与会话。`cases.json` 保存固定版本、人设描述、发布参数、初始状态和正文结果；`run.ts` 保存导入与调用程序。
3. 正文使用天琴 3.9 预设，选择 `prompt_order` 的 `100001` 分支，采用 `compat_plus`，关闭请求中的姓名前缀，要求第三人称叙述。第三人称要求适用于叙述，人物台词、自我劝告和内心话按实际说话者解释。测试配置将原本为空的 `wi_format` 明确设置为 `{0}`，使已激活世界书条目进入请求。`preflight-empty-worldbook-format.json` 保存修改前的组装证据；本次结果适用于修改后的测试配置。
4. 林茜会话将玩家固定为裴修远，顾声慢会话将玩家固定为周听澜。两人的完整描述分别包含具体姓名、性别、年龄、身份和当前知情范围，实际输入分别接续后窗目击和走廊报姓名的开场。`cases.json.*.persona.description` 保存完整描述，各`r1-body-dry-arguments.json` 保存输入。
5. 每张角色卡分别固定主状态预设和 MVU 备用预设，`stateHistoryTurns` 均为 5。验收关闭正文工具、导演、验证器和记忆写入，供应商自动重试次数为零。模型切换和 Liquid 的推理参数调整均通过显式配置执行，状态输出契约始终保留。

## 3. 供应商实际返回

1. `dots-studio/dots-3-note-preview:free`：三笔正文请求返回 HTTP 400。其中第一笔使用 Responses 接口；后两笔使用 Chat Completions 接口，AtlasCloud 均返回 `bad request`。第一笔证据保存在`preflight-responses-400-model-call-records.json`。
2. `apodex/apodex-1.1-mini:free`：一笔正文流返回 HTTP 200 并保存非空正文；一笔状态请求返回 HTTP 400，Novita 明确拒绝 `json_schema`。
3. `nvidia/nemotron-3-super-120b-a12b:free`：一笔正文流返回 HTTP 200，但 8,192 个输出 token 用于推理，正文为空；一笔状态请求的 HTTP 外层为 200，响应正文包含 `uniqueItems` 不支持的错误。两笔请求均未达到各自验收目标。
4. `qwen/qwen3.8-27b:free`：四笔正文流均返回 HTTP 200 并保存非空正文。三笔状态请求返回 HTTP 429；林茜 × MVU备用预设的状态请求返回 HTTP 400，ModelRun 报告 `oneOf` 分支无法编译。
5. `google/gemma-4-31b-it:free`：四个组合各进行一笔状态对照，全部返回 HTTP 429，错误指向共享上游限流。
6. `liquid/lfm-2.5-2.6b:free`：顾声慢 × 主状态预设进行了两笔状态对照。关闭推理的第一笔被拒绝；显式改为 `low` 后，第二笔仍返回 HTTP 400，Liquid 明确拒绝 `evidenceMessageIds.uniqueItems`。
7. 各供应商结论的样本范围以本节列出的请求数为准。

## 4. 正式组装及正文处理检查

1. `deterministic-verification.json` 逐项记录四个 Qwen 样本。每个样本的正文 dry-run `messages` 与实际供应商请求一致，状态 dry-run `messages` 和 `outputSchema` 也分别与实际状态请求一致。
2. 正文和状态的实际消息均包含完整人设描述；开场、当前输入及其人物姓名保留。`assembly.namesBehaviorApplied` 显示姓名前缀关闭，当前输入通过显式人物姓名说明动作主体。状态消息的索引 3、4、5 分别对应开场、当前输入和保存的公开正文。
3. `token_usage.bySection` 记录 `stateDefinition`、`stateRules`、`stateBefore`、`stateHistory`、`stateEvidence`、`stateOutputContract` 六个状态来源的实际 token 用量，`before`、空的第一轮 `variableHistory` 和输出契约均展开进入消息。所选状态预设及版本见 `preset`、`prompt_snapshot`；世界书条目集合与成功正文的 `promptSnapshot.worldbookActivatedEntryUids`一致。
4. `sourceIdentity` 中的运行、尝试、输出页和助手消息标识与成功正文的模型调用记录对应。供应商原始流的正文拼接结果与`generatedText`、调用记录中的 `text` 一致；正式角色消息的 `content` 与状态请求的 `sources[].text` 一致。
5. Qwen 四份保存的模型文本包含思考标记和前言，四份公开正文已清除这些内容。Apodex 的公开正文仍残留思考结束标记，且存在未解释的中午到深夜跳转，因此该样本也未通过内容与格式验收。
6. 所有状态失败后的 `role-view.current.snapshotId` 和完整变量均保持为原快照。证据见各`r1-inspect-result.json` 及 `state-snapshots.json`。

## 5. 四份 Qwen 正文的人工结论

1. 林茜 × 主状态预设：丈夫、妻子与杨桃子的身份、直接引语归属、第三人称及丈夫现身后的知情变化符合输入。同一只飞机杯却先在地上、再被林茜握着、最后才掉落，物件连续性失败；声音比喻也违反启用的正文预设要求。
2. 林茜 × MVU 备用预设：裴修远仍是林茜的丈夫，杨桃子仍是房内另一人物，叙述使用第三人称。飞机杯已经掉落，丈夫仍两次问它为何在妻子手里；杨桃子在林茜面前请求丈夫“别告诉林姐”，在场人物的知情关系不成立；正文以玩家台词结束，违反已启用的结尾要求。
3. 顾声慢 × 主状态预设：报姓名后的称呼、钢琴开场的先后因果、台词归属及玩家知情范围符合输入。正文缺少学校日常 CG 指令，且 `<gametext>` 首行使用 BGM 指令，与源卡 entry 18 的 BG 首行要求冲突。
4. 顾声慢 × MVU 备用预设：正文将报姓名的台词归给周听澜，将回应归给顾声慢，却将开场中已经完成的创作破局归因于本轮才收到的评论。选项“反问他”使用错误的对话对象性别，废社危机选项又让玩家使用尚未获知的信息。
5. 顾声慢源卡 entry 6 的示例使用 BGM 首行，entry 18 却要求 BG 首行，两项均激活；此项格式结果同时受源配置冲突影响。

## 6. 页面显示与修复验证

1. 浏览器使用实际 `user-web` 页面和角色资源。最终四份 `*-page.json` 均记录对应页面已挂载 ShadowRoot，运行异常列表为空，截图保存在同名 `*-page.png`。
2. 林茜两个页面均显示了原始开场、用户输入、生成正文及原状态，状态失败后提供重试入口。顾声慢两个页面显示学校背景、开场文本和阅读控件；由于当前状态快照仍为初始快照，其页面仍选中开场，没有完成新正文显示验收。
3. 状态 SSE 路由在 `reply.hijack()` 后将 Fastify 已计算的响应头写入原始响应。`cors-live-response.json` 保存实际跨域请求的允许来源头、`Vary: Origin` 和首个状态事件。新增测试覆盖允许来源、有无凭据、拒绝来源和无 Origin 请求。
4. 状态路由的 27 项测试、API 类型检查、相关文件 lint 和全量测试均通过；用户页面使用当前源码构建成功。

## 7. 证据读取方式

1. 先读取本报告与 `request-index.json` 判断范围，再按请求编号读取 `*-provider-request.json`、`*-provider-response.json`。第一笔请求按第 3 节第 1 项读取；`model-call-records.json` 保存后续调用记录，Apodex 的记录单独保存在 `apodex-model-call-records.json`。
2. 核对组装时读取 `deterministic-verification.json` 和对应的 `*-dry-result.json`；核对正文展示时读取对应的 `*-inspect-result.json`、`*-page.json` 与截图。
3. 文件名中的 `r2-state`、`r3-state`、`r4-state` 表示针对第一轮已保存正文执行的后续状态尝试。
4. `sse-capture-index.json` 记录流式事件保留范围：供应商原始流完整保存，客户端事件保存全部正文 chunk、运行事件及首末公开正文快照。
5. 在 worktree 根目录使用 `node` 执行 [verify.mjs](verify.mjs)，可以重算已保存数据的确定性检查。该命令读取本地证据，不调用模型。
