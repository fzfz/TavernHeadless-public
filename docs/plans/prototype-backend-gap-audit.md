<!-- markdownlint-disable MD013 -->

# 当前原型与正式后端的接入核查

## 核查范围与结论

本核查覆盖 `admin-workspace.prototype.html`、`script-roleplay.prototype.html`、它们引用的共享脚本、`serve-script-prototype.mjs`、模型调用与提示词绑定脚本，并对照 `apps/api` 的正式接口。运行检查针对 2026-09-19 的 `http://127.0.0.1:43875`。检查只读取现有数据，没有发送演绎消息或改变模型指令。

当前服务调用了真实模型，复用了部分正式后端能力，但聊天运行、管理配置和会话状态仍分属不同实现。`/script-api` 是原型专用接口；它返回 HTTP 响应，并不代表它经过正式聊天服务。之前连续两轮成功只证明原型调用模型、计算变量和更新页面的局部链路可运行。

下表将“已接入”限定为实际调用正式接口或明确列出的正式模块；“缺失”表示当前原型没有接通该项，不能据此推断正式后端没有该功能。人设与宏的详细核查见[提示词与宏源码核查](../character-authoring/prompt-macro-source-audit.md)。

## 数据来源和遗漏

| 对象 | 当前实际来源与证据 | 已确认的遗漏或影响 |
| --- | --- | --- |
| 管理端资源编辑、草稿、发布 | `workspace.prototype.js` 的浏览器内存对象；`navigation.prototype.js` 通过 `window.name` 交接数据。[源码](../../apps/web/prototypes/shared/navigation.prototype.js#L1) | 管理端修改不能驱动当前脚本用户端；未形成保存、发布、创建会话的真实闭环。 |
| 管理端试聊跳转 | `navigation.prototype.js` 指向旧 `user-roleplay.prototype.html`。[源码](../../apps/web/prototypes/shared/navigation.prototype.js#L6) | 当前 `script-roleplay.prototype.html` 与管理端仍是两条原型路径，未统一验收。 |
| 角色列表与角色版本 | 服务启动读取 `script-characters.json` 和角色目录，直接插入 characters 表，再调用正式角色版本接口。[源码](../../apps/web/prototypes/checks/serve-script-prototype.mjs#L447) | 角色版本确实保存到隔离数据库；可用角色列表来自启动配置，没有经过角色应用发布查询。 |
| 演绎人设 | `bound-prompt.mjs` 使用 `bundle.performer` 构造 `userSnapshotJson`；头像与名称从模板交付数据读取。[绑定源码](../../apps/web/prototypes/checks/bound-prompt.mjs#L140)、[头像源码](../../apps/web/prototypes/shared/script-host.prototype.js#L476) | 未调用 `/users` 选择人设，未把人设资源引用绑定到会话，页面名称与模型使用的人设可能分别配置。 |
| 开场选择 | 专用创建接口按 `openingId` 创建 Map 中的会话；`import-openings.js` 在启动时用预设名称替换 `{{user}}`。[导入源码](../../apps/web/prototypes/shared/import-openings.js#L1)、[接口](../../apps/web/prototypes/checks/serve-script-prototype.mjs#L662) | 已覆盖原卡备用开场，但未根据用户所选人设重新展开；开场初始化还没有接到正式会话创建流程。 |
| 会话创建 | `/script-api/sessions` 创建内存对象；林茜准备提示词时直接写 sessions、sessionBranches 表。[源码](../../apps/web/prototypes/checks/bound-prompt.mjs#L143) | 绕过正式 `POST /sessions` 的绑定解析；数据库行存在不能证明创建契约已经执行。 |
| 林茜预设与正则 | 本地文件经过 `/import/preset`、`/import/regex` 导入，并固定版本，使用正式 `assemblePrompt`。[源码](../../apps/web/prototypes/checks/bound-prompt.mjs#L20) | 已有真实导入与组装；资源选择仍来自本地配置，没有接管理页面。 |
| 世界书 | 林茜读取角色 snapshot 内嵌世界书，执行已迁移控制器后交给组装器；`worldbookProfileId`、`worldbookVersionId` 为 null。[源码](../../apps/web/prototypes/checks/bound-prompt.mjs#L101) | 内嵌世界书确实参与；独立世界书资源选择、版本绑定和管理编辑未接入。正式列表为空不能解释为没有使用任何世界书。 |
| 顾声慢完整提示词 | `live-model.json` 仍定义手写 `narratorPrompt`，走 `generateLiveTurn` 的简化组装分支。[配置](../../apps/web/prototypes/characters/gushengman/live-model.json#L2)、[调用](../../apps/web/prototypes/checks/openrouter-live.mjs#L248) | 原卡的完整预设、世界书及宏处理没有按林茜链路接入；不能称两张真实卡均已完整迁移。 |
| 模型、槽位与凭证 | `loadCredentials` 读取服务端 JSON，`streamCompletion` 直接请求 OpenRouter。[源码](../../apps/web/prototypes/checks/openrouter-live.mjs#L3) | 没有使用管理端维护的正式 LLM Profile、实例与槽位解析；管理端改配置不会改变此调用。 |
| 正文生成与流 | 专用 `/send` 调用 `generateLiveTurn` 并返回 NDJSON。[源码](../../apps/web/prototypes/checks/serve-script-prototype.mjs#L1026) | 没有调用正式 `/sessions/:id/respond/stream`；正式运行策略、工具与流水线行为不能从这次测试推定。 |
| 消息、楼层与变量提交 | 结果写入 `state.messages`、`state.floors`、`state.snapshots` 等 Map/数组。[源码](../../apps/web/prototypes/checks/serve-script-prototype.mjs#L1172) | 没有经过正式消息、楼层、变量提交事务；正式查询、重启恢复和运行审计无法据此完整还原。 |
| 变量更新 Agent 与后续任务 | 自定义 `updateLiveState` 和 `runFollowups` 执行；服务启动关闭正式 Agent worker。[源码](../../apps/web/prototypes/checks/serve-script-prototype.mjs#L415)、[更新请求](../../apps/web/prototypes/checks/openrouter-live.mjs#L371) | 原型验证了协议与计算；正式 Agent 绑定、任务调度、状态提交及错误追踪尚未接通。林茜当前后续 Agent 配置为空，两轮成功没有验证多 Agent 更新。 |
| 记忆、工具与 MCP | 当前专用生成直接调用模型，启动明确关闭 memory。[源码](../../apps/web/prototypes/checks/serve-script-prototype.mjs#L415) | 管理端已有配置不能影响该链路；尚未验证对应读取、调用、提交与调试。 |
| 用户端正文显示正则 | 系统聊天控件直接对 `message.text` 设置 `textContent`。[源码](../../apps/web/prototypes/shared/script-host.prototype.js#L487) | 不能把后端 `postProcess` 或角色自定义脚本等同于系统已经支持显示专用正则；通用 Markdown/显示正则流水线没有接入这个控件。 |
| 消息操作和能力判断 | 当前服务直接声明 `send: true`、`history: true`；聊天消息只有查看当轮状态按钮。[接口](../../apps/web/prototypes/checks/serve-script-prototype.mjs#L598)、[控件](../../apps/web/prototypes/shared/script-host.prototype.js#L491) | 缺少基于正式后端状态的编辑、删除、重新生成、分支入口及权限判断；旧原型出现这些按钮不等于当前脚本页面有它们。 |
| 刷新、断线与恢复 | 页面可重读进程内状态，连接关闭会 abort 当前模型调用；所有会话数据库均为内存数据库。[源码](../../apps/web/prototypes/checks/serve-script-prototype.mjs#L415)、[断线处理](../../apps/web/prototypes/checks/serve-script-prototype.mjs#L1039) | 页面刷新恢复、断线后运行查询、服务重启恢复是不同能力。当前行为未通过正式 active-run 与持久化记录联调。 |
| 生成详情 | `/live-evidence` 返回原型记录。[源码](../../apps/web/prototypes/checks/serve-script-prototype.mjs#L874) | 未连接管理端的正式 floor/run/result、消息修订和 Agent job 记录；原型调试结果不能充当完整后端审计。 |

## 实际接口读取结果

[读取证据](evidence/prototype-api-source-check.json)仅保存响应字段、数量和展示配置，没有保存密钥或完整人物正文。

| 读取接口 | 结果 | 可得出的结论 |
| --- | --- | --- |
| `/script-api/catalog` | 6 个角色 | 专用原型目录存在六项。 |
| `/users` | 0 项 | 正式人设资源未创建。 |
| `/llm-profiles` | 0 项 | 此次模型调用没有依赖正式 Profile 资源。 |
| `/sessions` | 1 项 | 存在直接创建的正式表记录；仍需检查创建和生成调用链。 |
| `/presets`、`/regex-profiles` | 各 1 项 | 林茜的资源导入已执行。 |
| `/worldbooks` | 0 项 | 未建立独立世界书资源；内嵌世界书另行参与提示词。 |
| `/script-api/sessions/script-linqian` | 名称“你”；send/history 为 true | 返回模板提供的演绎者名称和固定能力值，没有人设选择结果。 |

## 修正验收依据

后续接入按[开发计划](role-app-dual-web-plan.md)执行。验收负责人必须在验收记录中分别写明：界面动作、正式接口、资源或会话标识、实际请求内容、持久化结果、用户端表现。原型负责人使用专用原型接口验证新增 Runtime 协议时，必须注明其与正式接口的差异。

已通过的浏览器和模型测试保留为局部证据。验收负责人必须在相同会话上核对管理配置、绑定版本、人设、宏展开、模型请求、正式生成记录及 Runtime 回调；发现缺项时记录具体文件和接口。
