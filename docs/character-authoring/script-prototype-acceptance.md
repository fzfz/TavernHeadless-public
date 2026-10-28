<!-- markdownlint-disable MD013 -->

# 角色脚本 Runtime 原型验收

## 必须要实现的目标

本次原型把角色自己的 HTML、CSS、JavaScript 和资源交给同一个 Runtime 执行，核对[架构图及其时序图](runtime-architecture.md)、[模板规范](script-template-api.md)与[脚本 API](script-api.md)能否共同支撑实际页面。角色切换采用整页导航。管理端旧原型与已有功能继续保留；本次新增独立用户页面验证脚本契约。

## 运行入口与实现文件

浏览器入口为 `http://127.0.0.1:43872/prototype/apps/user-web/prototypes/script-roleplay.prototype.html`。顶部“角色”选择框加载后端目录，选择后整页导航到目标会话。页面的标题、角色脚本和资源均来自该会话固定的版本。

| 对象           | 文件与职责                                                                                                              |
| -------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 页面外壳       | `apps/user-web/prototypes/script-roleplay.prototype.html`：角色选择、历史选择和管理端入口                               |
| 页面初始化     | `apps/web/prototypes/shared/script-page.prototype.js`：读取会话、创建 Runtime、整页导航                                 |
| 通用 Runtime   | `apps/web/prototypes/shared/script-runtime.prototype.js`：命名空间 API、布局更新、事件、媒体、楼层范围和虚拟列表        |
| 系统会话与聊天 | `apps/web/prototypes/shared/script-host.prototype.js`：文本流、提交顺序、历史读取、头像、发送状态和聊天组件             |
| 隔离后端       | `apps/web/prototypes/checks/serve-script-prototype.mjs`：真实角色版本接口、包校验、固定文件版本、快照和可控生成事件     |
| 作者包         | `apps/web/prototypes/characters/{harbor,novel,expedition,cinema}/`：manifest、HTML、CSS、入口脚本、楼层模板及资源       |
| 生成输入       | 每个角色目录内的 `scenario.json`：初始变量、逐轮完整变量、回复与后续任务结果                                            |
| 结构与配置     | `script-runtime.schema.json`、`runtime-resource-policy.json`、`apps/web/prototypes/shared/script-transport.schema.json` |
| 浏览器参数校验 | `script-validators.prototype.js`：由 `checks/generate-script-validators.mjs` 从 Runtime schema 生成                     |

在原型 worktree 根目录使用本机已有依赖启动隔离服务：

```sh
node /srv/tavern/TavernHeadless/node_modules/tsx/dist/cli.mjs apps/web/prototypes/checks/serve-script-prototype.mjs /srv/tavern/TavernHeadless 43872 /srv/tavern/TavernHeadless-inspect-20260914/node_modules/.pnpm/better-sqlite3@12.8.0/node_modules/better-sqlite3
```

启动参数依次指定后端源码目录、监听端口和本机已安装的 SQLite 模块目录。服务绑定 `127.0.0.1`，使用独立内存数据库；退出服务后清空会话。启动和检查均复用本机依赖，未安装新依赖。

## 角色包与系统边界

| 元素或行为                                 | 角色负责                                       | 系统负责                                           |
| ------------------------------------------ | ---------------------------------------------- | -------------------------------------------------- |
| 背景、立绘、状态栏及整体布局               | HTML/CSS、资源 ID、多变量计算与布局更新函数    | 后端解析固定资源地址，Runtime 应用元素更新         |
| 书店分栏、琴房剧情画面、远征地图、全屏剧情 | 四份不同的包内容与函数                         | 同一个 Runtime 加载协议                            |
| 地图点击                                   | 作者函数通过 chat.send 提交前往地点的消息             | 统一控制器请求后端并保存消息；背景绑定后端提交的场景变量 |
| 信任、体力、人物在场                       | 根据快照计算进度、派生体力、立绘显隐和状态样式 | current/view 分离、只读记录与更新通知              |
| 选项与音乐                                 | 作者选择文本、资源和播放时机                   | 共用发送入口、播放通道和错误结果                   |
| 主回复与 Agent 可见输出                    | 自定义元素、按流来源选定显示位置               | 完整显示文本回调、楼层消息读取                     |
| 聊天记录与头像                             | 包中预置角色与演绎者的头像资源 ID              | 每条消息的身份、头像布局、发送状态和历史控件       |
| 角色历史面板                               | floorHtml 与 renderFloor                       | 分页、占位、可见窗口、作用域资源释放               |

这四个包使用同一组变量名称，便于比较布局与处理函数；Runtime 与页面外壳均按包内容执行，角色名称和目录 ID 不参与布局分支判断。后端为可重复验收提供固定回复数据，页面按收到的完整变量与消息更新。

## 全屏剧情卡

`characters/cinema` 的页面与用户提供的视觉小说布局对应：背景和立绘铺满内容区，底部独立剧情框显示当前回复的一段文本，底栏提供翻页、隐藏、音乐、状态、Auto、Skip、说话和继续剧情。该包使用自定义函数直接处理 `messages.onTextStream`，通过 `layout.update` 更新自己的文本元素；它同时省略 `widgets.mountChat` 和 `ui.mountFloors`。

上一段、下一段和 Skip 只改变当前回复的阅读段落；Auto 使用受 Runtime 管理的计时器翻页。说话按钮打开角色自有输入面板，通过同一个 `api.chat.send` 提交。页面刷新后，角色用 `messages.getFloor` 读取当前楼层并恢复正文。宿主“对话记录”入口单独打开系统记录面板，默认关闭。

## 验收清单

验收证据保存在 `docs/plans/evidence/script-runtime/`。各项结果以检查脚本的实际输出和截图为准。

| 检查             | 执行对象与完成条件                                                                                                      |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Runtime 单元验证 | `checks/script-runtime-unit.mjs`：原子 patch、参数错误、只读结果、已释放楼层调用、分页、缓存条数与 UTF-8 字节上限       |
| 后端验证         | `checks/script-backend-unit.mjs`：包结构和文件引用、版本身份、主运行与后台返回、100 轮、不可变快照、分页、失败与取消    |
| 浏览器联调       | `checks/script-browser.mjs`：四角色挂载、状态展开、流和提交顺序、历史保持、消息读取、地图点击、失败、连续生成和资源数量 |
| 可见窗口         | 滚动到 100 轮后的末页再返回首轮；消息 DOM 保持可见窗口规模，折叠角色历史面板后楼层范围释放                              |
| 页面布局         | 桌面截图核对四套布局，390 像素宽截图核对横向溢出；手工核对头像、状态栏、选项和输入区                                    |
| 整页切换         | 角色选择改变页面 URL，新文档加载目标包；页面刷新后恢复后端已保存状态与正文                                              |

浏览器主检查通过 64 项，连接与交互边界检查通过 12 项；分别记录于 `checks.json` 与 `edge-checks.json`。Runtime 单元检查及后端 HTTP 检查通过。主检查完成时，103 条历史楼层中挂载 3 条，折叠自定义历史后 floorScopes 为 0，pendingOperations 与 activeStreams 为 0；宿主历史缓存保持 24 条上限。完整计数见 `resources.json`，该计数验证资源归属与窗口规模，不代表浏览器进程内存峰值测量。

定向回归入口为 `checks/script-card-unit.mjs` 与 `checks/script-host-recovery-unit.mjs`，分别验证三个角色在信任值 49、50 时显示与发送相同选项，以及旧恢复响应到达后 current、view 和订阅结果保持最新提交。后端验证同时覆盖旧后台任务在新主提交前推进当前快照的交错时序。

边界检查入口为 `checks/script-edge-browser.mjs`，验证真实页面导航、角色计时翻页、角色自有输入、媒体以及主运行和后续任务两个阶段的连接中断。独立代码审阅发现的占用权竞争、订阅去重状态累积、断线活动流残留和离屏取消误报均已修正并补入相应检查。

## 验收中补齐的契约

1. 已通过隔离服务验证[模板包版本契约](script-template-api.md)，对应检查位于 `script-backend-unit.mjs`。
2. `messages.getFloor` 补齐刷新与历史正文读取；实时输出继续由 `messages.onTextStream` 交付，完整定义见脚本 API。
3. 已通过 `script-runtime-unit.mjs` 验证[元素更新契约](script-api.md)中 progress、meter 属性与原子更新要求。
4. 虚拟列表按实际占位尺寸计算可见范围；刷新列表时保留阅读锚点，处于底部的系统聊天跟随新消息。折叠面板释放楼层范围，展开后重新挂载。
5. 已通过 `script-browser.mjs` 与 `script-edge-browser.mjs` 验证[发送完成与连接中断契约](script-api.md)，覆盖主运行完成、后台文本和变量继续到达的情况。

## 真实模型补充验收

上述四包与固定数据检查验证通用 Runtime。林茜迁移另已验证 OpenRouter 真实正文、结构化事实、角色后端计算和顺序后续 Agent 更新；具体模型、两轮六次状态提交、跨日与恢复证据见[林茜验收记录](../plans/linqian-live-results.md)。live 模式的 completed 晚于后续链，其与正式完成边界的差异见[原型完成边界记录](../plans/role-runtime-core/findings.md#林茜-live-原型的完成边界差异)。

## 非本次目标

隔离原型的真实后端用于角色版本保存和读取；消息、任务及显示快照仍由隔离服务管理。真实模型调用已验证，正式 RuntimeWorker、持久化任务及快照事务仍须接入。验收结果分别记录固定数据的界面验证与真实模型更新验证。

正式开发仍须完成以下接入：

- 后端按规范提供稳定文本流身份、完整提交快照及主运行完成通知，并对断线重连提供状态同步。
- 用户 Web 将现有消息权限、编辑、删除、重生成和分支操作接入统一会话控制器；原型本轮只开放后端明确提供的发送与历史读取能力。
- 管理端试聊导航接入同一个新版用户页面，沿用管理端调试记录；本轮没有删除或迁移旧管理功能。
- 完整显示正则处理、断线事件重放及重新生成分支链路仍须接入正式控制器；本轮回复使用按显示文本契约准备的数据，未把正式正则链路判为通过。
- 正式权限、账号隔离与持久化继续使用业务后端；本地隔离服务的固定会话用于验证数据格式与事件顺序。

## 已获得的授权

用户授权按新的架构图、时序图和 API 规范重做原型及角色卡，运行测试与验收，并根据发现的问题修正规范。用户授权启动隔离系统验证后端边界，明确角色由项目维护、同页面执行，切换角色直接刷新页面；原型中的开发说明与缺口记录放在文档中。
