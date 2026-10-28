---
文档用途: 记录用户 Web 的真实模型剧情、状态更新与页面显示验收结果。
读取时机: 判断真实演绎质量、复查模型输出或定位本轮失败原因时读取。
---

# 用户 Web 真实模型验收

## 1. 验收结论

1. 2026 年 10 月 20 日完成真实模型采样。六份正文均使用第三人称，完整保存并通过公开接口读取；已核对的五份浏览器正文与公开正文逐字一致。说话者归属、用户角色控制和地点更新存在失败样本，当前配置尚未通过剧情质量验收。
2. 用户 Web 运行地址为 `http://localhost:4190/`。角色“雾港来信 · 真实演绎”使用真实供应商；[三轮会话](http://localhost:4190/#chat/Ivn7ExR1vrksChJQGUO7z)保留实际输出。账号和会话存放在[实现验收第 2 节](implementation-acceptance.md#2-验收环境与证据)的隔离数据库中。

## 2. 模型与测试输入

1. 正文采用 OpenRouter 的 `minimax/minimax-m3.1-flash:free`。初次状态更新也采用该模型；后续状态更新采用 `dots-studio/dots-3-note-preview:free`。执行时从[官方模型目录](https://openrouter.ai/api/v1/models)核对了零价格，保存结果见[模型资料](implementation-evidence/real-model/models.json)及两个模型的端点文件。
2. 固定人格为裴修远，角色卡中的向导为沈知夏。完整人格与发布参数见[会话配置](implementation-evidence/real-model/selection.json)；正文预设、世界书、开场和当前输入的实际展开见各样本的 `dry-run.json`。六次正文请求的 `messages` 均与各自 dry-run 相同。
3. 初始请求要求先留在邮局检查邮戳，再决定是否出发。dry-run 的 `messages[0]` 包含完整人格及第三人称要求，`messages[1]` 为既有开场，最后一条 `user` 消息为当前输入。`assembly.names_behavior_applied` 为 `off`；后续两轮的 dry-run 保留此前用户与助手消息，并分别标明当前动作、台词和给写作者的要求。
4. A 为正文和状态均采用 MiniMax 的初次样本。B1、B2、B3 采用 MiniMax 正文与 Dots 状态更新，三者使用相同的初始正文请求。B2 继续演绎至第三轮。R2、R3 将 B2 第三轮的实际状态请求原样发送至同一供应商，用于观察同一请求的重复结果。
5. 本轮共发出 14 次模型请求，执行上限为 16 次。API 调用记录中的 `requestAttemptNo` 均为 1；两次直接重复采样各发送一次请求。12 次成功请求的[账单](implementation-evidence/real-model/billing.json)均为零；一次失败请求的账单查询返回 404，一次长时间等待的请求未取得 generation ID。账号付费累计用量前后均为 `0.101379054`。
6. 实际正文请求的 `max_tokens` 为 3761—3982，`temperature` 为 0.3；实际状态请求未携带 `max_tokens`。发布参数与实际传输参数的差异保留在[会话配置](implementation-evidence/real-model/selection.json)、调用记录及[逐层核对结果](implementation-evidence/real-model/chain-checks.json)中。

## 3. 剧情与状态结果

1. A 的正文保持第三人称，在邮局检查信封并继续询问下一步。MiniMax 状态请求收到 HTTP 200，但响应体包含 `invalid params` 错误，指向 JSON Schema 的 `items: false`。正文保留，页面显示状态更新失败及重试入口。本次判定为该供应商与当前结构化输出请求组合失败。
2. B1 的正文替裴修远说出“先去码头”，超出了输入中“检查后再决定”的角色控制范围。Dots 状态请求持续返回空白保活内容；观察至 438 秒时，调用记录仍为 `in_flight`。浏览器停止等待后出现状态重试入口，后端记录仍未结束。隔离 API 服务重启后，已保存会话和状态快照保持不变。
3. B2 第一轮保持第三人称，在邮局检查邮戳，保留拆信与继续核对的选择。状态返回空变更，地点保持“夜间邮局”，符合该轮正文。
4. B3 第一轮保持第三人称，在邮局核对纪念邮戳及潮汐资料。状态保持地点，并将信任由 20 更新为 22；本轮存在共同检查信封的协作行为，增量位于角色卡规定的 1—3 范围内。
5. B2 第二轮中，裴修远询问沈知夏是否见过窗格标记；模型却让裴修远回答“见过”，随后继续讲解邮政资料。人物姓名和第三人称形式正确，台词说话者归属错误。状态保持邮局，符合尚未转场的正文。
6. B2 第三轮明确区分写作者要求与用户角色动作，要求保留裴修远的发言和决定权，并写明两人已抵达码头卖报摊。正文接续报摊场景，该轮没有替裴修远发言。Dots 返回空变更，页面地点仍为“夜间邮局”，地点更新失败。
7. B2 第三轮的实际状态请求包含用户抵达码头的动作及助手在报摊询问的正文，也包含“人物明确抵达另一地点时更新 location”的规则。R2 再次返回空变更；R3 正确写入“码头卖报摊前”。三次相同请求中两次漏写地点，说明该请求下的状态输出不稳定。
8. 当前正文预设规定了叙述人称，但未明确划分用户与模型分别控制哪些人物。B2 第三轮提供了显式角色控制要求；该单轮结果供后续预设验证参考。模型、提示词和结构化输出模式对失败的各自影响仍待独立对照。

## 4. 传输、保存与浏览器证据

1. [逐层核对结果](implementation-evidence/real-model/chain-checks.json)确认六份正文在以下各层逐字相同：
   1. 供应商原始服务器发送事件（SSE）中 `choices[].delta.content` 拼接出的正文。
   2. 模型调用记录的 `text`。
   3. 数据库消息的 `content`。
   4. 公开消息的 `content`。
2. B1、B2 三轮及 B3 的页面正文与公开正文相同；B2 刷新前后正文保持一致。
3. 证据位于 [real-model](implementation-evidence/real-model/) 目录。`minimax-only-sample-1-*` 对应 A，`sample-1-*`、`sample-2-*`、`sample-3-*` 分别对应 B1、B2、B3，`state-repeat-2.json`、`state-repeat-3.json` 分别对应 R2、R3。每组的 `calls.json` 保存实际请求、响应、用量及状态；`stored-messages.json`、`public-messages.json`、`browser.json` 分别保存各层正文。
4. [多轮页面截图](implementation-evidence/real-model/sample-2-desktop.png)保存 B2 第三轮的实际显示，[长时间等待记录](implementation-evidence/real-model/long-state-wait.json)保存 B1 的观察结果，[重启核对](implementation-evidence/real-model/restart-check.json)保存隔离 API 重启后的读回结果。
5. 浏览器在 `127.0.0.1` 登录后，`tavern_session` Cookie 被替换，随后两次会话读取返回 401。切换为 `localhost` 并重新登录后恢复读取；B1 已保存的正文通过页面重试入口发起状态更新。Cookie 替换来源尚未定位。

## 5. 适用范围

1. 本轮结论适用于当前角色包、预设、人格、模型及采样请求。长篇设定一致性、其他角色卡和其他模型组合需要分别验收。
2. 当前需要解决的具体问题为用户角色控制、台词归属、状态模型漏写地点、MiniMax 结构化输出兼容性，以及长时间状态请求的取消与结束记录。各问题的已观察行为和证据分别见第 3 节及第 4 节。
