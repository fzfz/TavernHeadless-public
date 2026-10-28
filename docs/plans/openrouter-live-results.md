<!-- markdownlint-disable MD013 -->

# OpenRouter 真实模型联调记录

## 结论与范围

顾声慢的隔离原型已通过三轮真实免费模型调用。正文通过文本流进入角色自定义 GAL 容器；独立变量更新请求生成提案，后端验证后提交快照，前端状态栏读取提交后的变量。第二轮遇到提供者流式错误，单独重试变量更新后成功，原正文保持不变。

这项结果证明主链路可行。林茜 MVU 转换与后续 Agent 多次更新的结果见[林茜验收记录](linqian-live-results.md)。正式数据库事务与管理 Web 编辑界面归入[双端实施计划](role-app-dual-web-plan.md)。顾声慢本次使用角色目录内的联调规则，其全部世界书语义仍需另行转换验收。

## 三轮结果

| 轮次 | 请求中的实际经过时间 | 提交时间 | 情感连结度 | 创作完成度 | 地点 |
| --- | --- | --- | --- | --- | --- |
| 初始 | — | 17:20 | 0 | 10 | 轻音社活动室 |
| 第一轮 | 5 分钟 | 17:25 | 1 | 10 | 轻音社活动室 |
| 第二轮 | 10 分钟 | 17:35 | 3 | 10 | 轻音社活动室 |
| 第三轮 | 2 分钟 | 17:37 | 4 | 10 | 旧教学楼走廊 |

Agent 阅读了三轮正文与变量提案：时间按本轮经过时间累加；友善交流提升情感连结度；听琴没有被当作完成创作；第三轮地点与道别事件一致。每轮的基础快照连接上一轮提交快照。

第三轮由浏览器的“说话”输入面板发起。页面收到 163 次文本更新、1 次文本结束和 1 次变量提交。状态栏数值与后端快照一致，背景图片加载成功，浏览器未报告运行时异常。

## 发现的问题与修正

| 实际问题 | 已实施修正 | 验证 |
| --- | --- | --- |
| 第一轮尝试的变量结果不是合法 JSON | `checks/openrouter-live.mjs` 从角色可写路径与变量 schema 生成 `response_format.json_schema`；请求只路由到支持所需参数的提供者 | 后续三轮提案通过结构验证 |
| 正文引用不存在的背景 | 后端向正文模型提供角色资源索引；角色提示词要求从索引选择资源 | 第三轮浏览器背景加载通过 |
| 第二轮变量调用中途失败 | 后端保存正文与基础快照；同一输入通过 `x-state-update-retry: true` 单独重试更新器 | [第二轮重试记录](evidence/openrouter-live/retry-turn-2.ndjson)没有重新生成正文的 update 事件，最终提交 17:35 |
| 未收齐的 `[show\|…]` 被当成对白 | 顾声慢解析器等待指令闭合后执行，识别开闭标签的流式前缀 | 实际第三轮回复的全部 233 个前缀测试通过 |
| 模型把对白续写到下一行，解析器漏掉续行 | 顾声慢解析器将普通续行合入上一段对白；提示词明确完整对白行格式 | 实际回复中的“明天见”保留测试通过 |
| 浏览器检查结束时临时目录删除失败 | 测试程序等待 Chrome 退出后删除目录 | 修正后浏览器复查通过，进程退出码为 0 |

上表的代码路径均位于 `apps/web/prototypes/`。错误提示统一读取 `shared/card-errors.json`。

## 证据与复现

- [模型名、提案和快照关联](evidence/openrouter-live/live-evidence.json)。实际模型均使用免费变体，正文和变量更新分别记录提供者返回的模型名。
- [三轮前后状态](evidence/openrouter-live/session-after-three.json)。
- [第三轮浏览器检查数据](evidence/openrouter-live/three-turn-browser-result.json)及[提交后截图](evidence/openrouter-live/three-turn-committed.png)。
- [浏览器发起的第三轮原文](evidence/openrouter-live/third-messages.json)。
- `apps/web/prototypes/checks/openrouter-live-unit.mjs`：传输和提案验证。
- `apps/web/prototypes/checks/openrouter-live-integration.mjs`：受控提供者下的连续提交、失败拒绝、正文复用与失效重试。
- `apps/web/prototypes/checks/gal-live-stream-unit.mjs`：真实回复逐前缀解析与跨行对白。
- `apps/web/prototypes/checks/openrouter-live-browser.mjs`：通过页面输入发起真实调用，保存流式与提交后截图。

第一组浏览器业务断言全部通过，但测试进程因临时目录清理报错退出。修正后的服务已再次通过真实浏览器调用，六项业务断言通过，测试进程退出码为 0；结果见[最终复查数据](evidence/openrouter-live/browser-result.json)和[最终页面截图](evidence/openrouter-live/browser-committed.png)。当前后端数据在内存中，重启会重新创建会话。三轮证据在重启前已保存。

## 后续工作

角色版本持久化与管理 Web 编辑界面按[双端实施计划](role-app-dual-web-plan.md)实现。
