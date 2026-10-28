---
文档用途: 定义原生角色前端的方法、参数、返回值和回调契约。
读取时机: 编写或核对原生角色前端脚本时。
---

<!-- markdownlint-disable MD013 MD033 -->

# 角色卡 JavaScript API

1. 本文末尾提供角色入口示例；原生包的导入、发布与下载见[原生角色卡接口](native-card-api.md)。

1. 本文供角色卡作者编写角色脚本使用，定义 `mount({api})` 中可调用的方法、参数、返回值、回调和错误。

1. 角色变量的生成、校验与保存由[角色卡后端 API](backend-api.md#3-stateupdate配置变量更新)规定；模型执行时读取和写入变量的方法见 [Agent 变量工具](agent-tools-api.md#5-变量工具)。本文的第 6 章定义已保存对话的查询，第 9 章定义变量状态回看。

## 目录

1. [1. 入口与基本约定](#1-入口与基本约定)
1. [2. 常用能力的命名空间](#2-常用能力的命名空间)
1. [3. 公共数据类型](#3-公共数据类型)
   1. [3.1 Snapshot：会话初始或某轮回复后的角色变量记录](#31-snapshot会话初始或某轮回复后的角色变量记录)
   1. [3.2 TurnCommit：一轮变量提交完成的通知](#32-turncommit一轮变量提交完成的通知)
   1. [3.3 RoleMessage：供历史对话区域展示的消息](#33-rolemessage供历史对话区域展示的消息)
   1. [3.4 FloorQuery 与 FloorPage：查询一轮对话与分页读取结果](#34-floorquery-与-floorpage查询一轮对话与分页读取结果)
   1. [3.5 SnapshotPage：历史变量状态索引](#35-snapshotpage历史变量状态索引)
1. [4. 聊天输入与发送](#4-聊天输入与发送)
   1. [4.1 api.chat.setDraft — 填写输入草稿](#41-apichatsetdraft--填写输入草稿)
   1. [4.2 api.chat.send — 发送演绎输入](#42-apichatsend--发送演绎输入)
1. [5. 多轮变量读取与提交回调](#5-多轮变量读取与提交回调)
   1. [5.1 api.variables.get — 读取当前或历史角色变量](#51-apivariablesget--读取当前或历史角色变量)
   1. [5.2 api.variables.watch — 订阅快照变化](#52-apivariableswatch--订阅快照变化)
   1. [5.3 api.variables.onTurnCommitted — 接收楼层提交](#53-apivariablesonturncommitted--接收楼层提交)
   1. [5.4 api.variables.getSnapshot — 读取指定快照](#54-apivariablesgetsnapshot--读取指定快照)
   1. [5.5 api.variables.recalculateLatest — 重新计算最新楼层变量](#55-apivariablesrecalculatelatest--重新计算最新楼层变量)
   1. [5.6 api.variables.restoreMissing — 用会话初值补齐缺失变量](#56-apivariablesrestoremissing--用会话初值补齐缺失变量)
1. [6. 已保存的楼层消息](#6-已保存的楼层消息)
   1. [6.1 api.messages.getFloor — 读取保存消息](#61-apimessagesgetfloor--读取保存消息)
   1. [6.2 api.messages.listFloors — 分页列出对话](#62-apimessageslistfloors--分页列出对话)
1. [7. 文本流渲染回调](#7-文本流渲染回调)
   1. [7.1 api.messages.onTextStream — 订阅正文流](#71-apimessagesontextstream--订阅正文流)
1. [8. 一次提交的多次返回与完成边界](#8-一次提交的多次返回与完成边界)
1. [9. 历史变量状态与查看](#9-历史变量状态与查看)
   1. [9.1 api.history.select — 切换历史查看](#91-apihistoryselect--切换历史查看)
   1. [9.2 api.history.latest — 返回最新状态](#92-apihistorylatest--返回最新状态)
   1. [9.3 api.history.listSnapshots — 分页列出历史变量状态](#93-apihistorylistsnapshots--分页列出历史变量状态)
   1. [9.4 历史查看示例](#94-历史查看示例)
1. [10. 布局注册、绑定和更新](#10-布局注册绑定和更新)
   1. [10.1 api.ui.register — 注册角色布局](#101-apiuiregister--注册角色布局)
   1. [10.2 layout.update — 批量更新元素](#102-layoutupdate--批量更新元素)
   1. [10.3 layout.bind — 绑定状态与布局](#103-layoutbind--绑定状态与布局)
   1. [10.4 layout.on — 绑定元素事件](#104-layouton--绑定元素事件)
   1. [10.5 layout.remove — 注销布局](#105-layoutremove--注销布局)
   1. [10.6 layout.animateVisibility — 展开或收起内容](#106-layoutanimatevisibility--展开或收起内容)
1. [11. 系统聊天组件](#11-系统聊天组件)
   1. [11.1 api.widgets.mountChat — 挂载系统聊天组件](#111-apiwidgetsmountchat--挂载系统聊天组件)
   1. [11.2 chat.destroy — 卸载聊天组件](#112-chatdestroy--卸载聊天组件)
1. [12. 预置资源和数据](#12-预置资源和数据)
   1. [12.1 api.assets.url — 读取资源地址](#121-apiassetsurl--读取资源地址)
   1. [12.2 api.assets.list — 筛选角色资源](#122-apiassetslist--筛选角色资源)
   1. [12.3 api.data.get — 读取角色预置数据](#123-apidataget--读取角色预置数据)
1. [13. 媒体、事件与计时器](#13-媒体事件与计时器)
   1. [13.1 api.media.play — 播放音频](#131-apimediaplay--播放音频)
   1. [13.2 api.media.pause — 暂停音频](#132-apimediapause--暂停音频)
   1. [13.3 api.media.stop — 停止音频](#133-apimediastop--停止音频)
   1. [13.4 api.events.on — 监听全局事件](#134-apieventson--监听全局事件)
   1. [13.5 api.timers.after — 延时执行一次](#135-apitimersafter--延时执行一次)
   1. [13.6 api.timers.every — 周期执行](#136-apitimersevery--周期执行)
1. [14. 楼层显示范围与资源释放](#14-楼层显示范围与资源释放)
   1. [14.1 api.ui.mountFloors — 挂载自定义历史楼层](#141-apiuimountfloors--挂载自定义历史楼层)
   1. [14.2 floors.loadNext — 加载下一页](#142-floorsloadnext--加载下一页)
   1. [14.3 floors.setVisibleRange — 设置显示窗口](#143-floorssetvisiblerange--设置显示窗口)
   1. [14.4 floors.diagnostics — 查看列表状态](#144-floorsdiagnostics--查看列表状态)
   1. [14.5 floors.destroy — 卸载楼层列表](#145-floorsdestroy--卸载楼层列表)
1. [15. 生命周期与错误](#15-生命周期与错误)
1. [16. 角色脚本与后端计算的边界](#16-角色脚本与后端计算的边界)
1. [17. 角色入口示例](#17-角色入口示例)

## 1. 入口与基本约定

1. Runtime 是运行角色页面脚本、管理脚本资源并清理这些资源的前端模块；宿主是维护当前会话、输入与查看状态的前端模块。角色作者通过本文 api 调用这些能力。

1. 原生 ZIP 使用根 `manifest.json` 登记包文件，并通过其 `frontend` 字段引用 `frontend/manifest.json`。前端清单指定 HTML、CSS、入口脚本和媒体资源。包文件与 URL 由会话固定的人物版本关联。作者使用第 12 章的方法读取该版本的资源和数据。纯对话包省略 `frontend` 字段，由系统聊天界面显示。包入口完整字段见[模板契约](script-template-api.md)。

1. ```javascript
   export function mount({ api }) {
     // 在这里注册布局、订阅变量、绑定角色交互。
   }
   ```

1. 前端清单的 `script` 字段指向导出 `mount` 的入口文件。系统先挂载角色 HTML、CSS，随后调用 mount，并等待它返回的 Promise（如果有）。本文示例中的 api 来自此入口；含 await 的片段放入 async mount 或 async 事件处理函数。示例字段由角色状态 schema 定义，实际角色使用自身字段。示例注释中的 HTML 须放入角色模板；console 输出可在调试时查看，正式反馈由作者绘制到角色布局。

1. 同步方法直接返回值，失败时抛出带 code 和 message 的错误。
1. 异步方法返回 Promise；使用 await/try/catch 处理失败。参数校验失败也会拒绝 Promise。
1. 返回的状态、消息和交付数据为只读值。角色函数可以复制后计算显示结果，持久变量由后端更新链路提交。
1. 订阅、绑定、事件和计时器返回的解除函数可提前调用；所属角色或楼层视图释放时，Runtime 自动解除其登记资源。
1. 本文的 `scope` 只取 `current` 或 `view`：current 表示最新已提交状态，view 表示当前查看状态。

## 2. 常用能力的命名空间

1. | 命名空间  | 角色可用方法                                                                | 用途                       |
   | --------- | --------------------------------------------------------------------------- | -------------------------- |
   | variables | get、watch、onTurnCommitted、getSnapshot、recalculateLatest、restoreMissing | 读取、订阅和修复变量       |
   | chat      | setDraft、send                                                              | 填写和发送演绎输入         |
   | messages  | listFloors、getFloor、onTextStream                                          | 读取楼层消息和显示流式正文 |
   | history   | select、latest、listSnapshots                                               | 选择和列出历史变量状态     |
   | ui        | register、mountFloors                                                       | 注册布局与自定义历史列表   |
   | widgets   | mountChat                                                                   | 挂载系统聊天组件           |
   | assets    | url、list                                                                   | 读取图片、音频资源         |
   | data      | get                                                                         | 读取角色预置数据和开场     |
   | media     | play、pause、stop                                                           | 播放音频                   |
   | events    | on                                                                          | 监听全局浏览器事件         |
   | timers    | after、every                                                                | 延时和周期回调             |

## 3. 公共数据类型

### 3.1 Snapshot：会话初始或某轮回复后的角色变量记录

#### 3.1.1 用途

1. 保存会话开始时或某轮回复完成变量更新后的完整角色状态。角色页面从 `variables` 读取地点、时间、人物数值和剧情选项等字段；回看某轮对话时，使用该轮记录恢复当时的状态栏。

#### 3.1.2 返回结构

1. 下列键均为接口要求的必有键；值为 `null` 表示该记录没有对应的楼层、前驱或执行来源，具体条件见字段表。

   ```typescript
   type Snapshot = {
     sessionId: string;
     branchId: string;
     floorId: string | null;
     attemptId: string | null;
     versionId: string;
     snapshotId: string;
     parentSnapshotId: string | null;
     variables: Record<string, unknown>;
     source: {
       kind: "initial" | "floor" | "job" | "manual";
       runId: string | null;
       jobId: string | null;
     };
   };
   ```

   | 字段               | 用途                                           | 值与产生条件                                                                            |
   | ------------------ | ---------------------------------------------- | --------------------------------------------------------------------------------------- |
   | `sessionId`        | 确定记录属于哪次会话                           | 会话 ID，始终为字符串                                                                   |
   | `branchId`         | 确定该状态所在的剧情分支                       | 初始记录为 `main`；回复记录使用所属楼层分支                                             |
   | `floorId`          | 将变量状态与某一轮对话关联                     | 初始记录为 `null`；回复后的记录为该楼层 ID                                              |
   | `attemptId`        | 标记产生该轮状态的生成尝试                     | 初始记录为 `null`；当前回复更新写入 `runId:attemptNo`                                   |
   | `versionId`        | 标明用于解释这些变量的角色及资源版本           | 会话固定的角色版本 ID                                                                   |
   | `snapshotId`       | 精确读取这一份状态记录                         | 每份记录独立的 ID，可传给 getSnapshot 或 history.select                                 |
   | `parentSnapshotId` | 读取该轮更新前的状态、比较前后变化             | 初始记录为 `null`；后续记录指向同分支上一份记录                                         |
   | `variables`        | 供状态栏、立绘条件和剧情选项读取的完整变量对象 | 字段由角色状态 schema 定义，例如 `{location:"花园",energy:9}`                           |
   | `source.kind`      | 标明这份状态的产生方式                         | `initial` 为初始状态；`floor` 为楼层更新；`manual` 为变量重算或补全；`job` 为类型预留值 |
   | `source.runId`     | 关联生成该轮正文的运行记录                     | 初始及变量修复记录为 `null`；回复记录为本轮 runId                                       |
   | `source.jobId`     | 关联作业来源                                   | 当前初始、回复更新及变量修复记录均为 `null`                                             |

#### 3.1.3 初始变量值

1. 宿主创建会话初始快照时，递归展开初值字符串中的提示词宏；`{{user}}` 使用会话绑定人设姓名，`{{char}}` 使用固定角色姓名。前端读取的 `Snapshot.variables` 是展开后的值，包内初值文件保留原文宏。

#### 3.1.4 读取入口

1. 当前或正在查看的状态使用第 5.1 节；按 snapshotId 读取使用第 5.4 节。

#### 3.1.5 数据示例

1. 初始变量包含地点和精力。

   ```json
   {
     "sessionId": "session-1",
     "branchId": "main",
     "floorId": null,
     "attemptId": null,
     "versionId": "version-1",
     "snapshotId": "snapshot-0",
     "parentSnapshotId": null,
     "variables": { "location": "大厅", "energy": 10 },
     "source": { "kind": "initial", "runId": null, "jobId": null }
   }
   ```

### 3.2 TurnCommit：一轮变量提交完成的通知

1. ```typescript
   type TurnCommit = {
     eventId: string;
     sessionId: string;
     branchId: string;
     kind: "generated" | "retried" | "regenerated";
     previousCurrentSnapshotId: string;
     before: Snapshot;
     after: Snapshot;
   };
   ```

#### 3.2.1 用途

1. 让角色脚本在一轮变量保存成功后显示数值增减、播放本轮完成动画，或刷新依赖本轮结果的界面。

#### 3.2.2 字段定义

1. | 字段                        | 用途和取值                                                             |
   | --------------------------- | ---------------------------------------------------------------------- |
   | `eventId`                   | 本次通知 ID，当前为 `commit:` 加 after.snapshotId；用于识别同一次通知  |
   | `sessionId`、`branchId`     | 通知所属会话与分支                                                     |
   | `kind`                      | 当前发送适配器返回 generated，适用于正文生成后的变量更新和变量更新重试 |
   | `previousCurrentSnapshotId` | 本次发送开始时客户端持有的最新状态 ID                                  |
   | `before`、`after`           | 本次提交前后的完整状态；读取两者的 variables 比较实际字段变化          |

#### 3.2.3 接收入口

1. 通过第 5.3 节的 api.variables.onTurnCommitted 接收此对象。

#### 3.2.4 回调数据示例

1. 以下两份 Snapshot 和 event 构成一次完整通知；它们用于说明系统传入的数据，业务脚本直接读取收到的 event。

   ```javascript
   const before = {
     sessionId: "session-1",
     branchId: "main",
     floorId: null,
     attemptId: null,
     versionId: "version-1",
     snapshotId: "snapshot-0",
     parentSnapshotId: null,
     variables: { location: "大厅", energy: 10 },
     source: { kind: "initial", runId: null, jobId: null },
   };
   const after = {
     ...before,
     floorId: "floor-1",
     attemptId: "run-1:1",
     snapshotId: "snapshot-1",
     parentSnapshotId: "snapshot-0",
     variables: { location: "花园", energy: 8 },
     source: { kind: "floor", runId: "run-1", jobId: null },
   };
   const event = {
     eventId: "commit:snapshot-1",
     sessionId: "session-1",
     branchId: "main",
     kind: "generated",
     previousCurrentSnapshotId: "snapshot-0",
     before,
     after,
   };
   ```

### 3.3 RoleMessage：供历史对话区域展示的消息

1. ```typescript
   type RoleMessage = {
     id: string;
     role: "user" | "assistant" | "agent";
     text: string;
     floorId: string;
     streamId: string;
     status: "completed";
   };
   ```

#### 3.3.1 用途

1. 保存供角色页面绘制的单条对话消息，包括说话者、正文及所属楼层。

#### 3.3.2 字段定义

1. | 字段       | 用途和当前取值                                                              |
   | ---------- | --------------------------------------------------------------------------- |
   | `id`       | 已保存消息 ID，用于标识消息                                                 |
   | `role`     | 展示说话者类别；user 与 assistant 原样保留，其他类别映射为 agent            |
   | `text`     | 取自后端角色消息接口的 content，供页面显示处理后的完整正文                  |
   | `floorId`  | 本条消息所属的查询楼层                                                      |
   | `streamId` | 取后端消息 source，缺少时取消息 ID；用于标记保存消息的文本来源              |
   | `status`   | 该读取接口固定返回 completed，表示返回的是保存消息；生成中的状态另见第 7 章 |

#### 3.3.3 返回数据示例

1. ```json
   [
     {
       "id": "message-user-1",
       "role": "user",
       "text": "走进花园。",
       "floorId": "floor-1",
       "streamId": "message-user-1",
       "status": "completed"
     },
     {
       "id": "message-assistant-1",
       "role": "assistant",
       "text": "花园的小路铺满落叶。",
       "floorId": "floor-1",
       "streamId": "message-assistant-1",
       "status": "completed"
     }
   ]
   ```

### 3.4 FloorQuery 与 FloorPage：查询一轮对话与分页读取结果

1. `FloorQuery` 指定 `messages.getFloor` 要读取的对话；`FloorPage` 是 `messages.listFloors` 返回的一页对话索引。

1. ```typescript
   type FloorQuery = { branchId: string; floorId: string };
   type FloorPage = {
     items: Array<{
       floorId: string;
       floorNo: number;
       state: "draft" | "generating" | "committed" | "failed";
     }>;
     nextCursor: string | null;
   };
   ```

1. | 字段                        | 用途                                                                                         |
   | --------------------------- | -------------------------------------------------------------------------------------------- |
   | `FloorQuery.branchId`       | 必填非空字符串；后端校验对话所属分支                                                         |
   | `FloorQuery.floorId`        | 必填非空字符串；指定要读取消息的对话楼层                                                     |
   | `FloorPage.items[].floorId` | 传给 `messages.getFloor` 读取该轮消息                                                        |
   | `FloorPage.items[].floorNo` | 该轮在分支中的编号，用于显示对话序号                                                         |
   | `FloorPage.items[].state`   | 后端保存的楼层状态：`draft` 草稿、`generating` 生成中、`committed` 已提交、`failed` 生成失败 |
   | `FloorPage.nextCursor`      | 原样传给下一次 `messages.listFloors`；`null` 表示已到末页                                    |

#### 3.4.1 返回示例

1. 第 8 轮已保存正文，变量更新仍待重试，此轮仍出现在对话索引中。

   ```json
   {
     "items": [{ "floorId": "floor-8", "floorNo": 8, "state": "committed" }],
     "nextCursor": null
   }
   ```

### 3.5 SnapshotPage：历史变量状态索引

1. `history.listSnapshots` 返回一页已经保存的变量状态索引，包含会话初始状态以及后续提交的状态。

1. ```typescript
   type SnapshotPage = {
     items: Array<{
       snapshotId: string;
       floorId: string | null;
       attemptId: string | null;
     }>;
     nextCursor: string | null;
   };
   ```

1. | 字段                 | 用途                                                                            |
   | -------------------- | ------------------------------------------------------------------------------- |
   | `items[].snapshotId` | 传给 `variables.getSnapshot` 读取完整变量，或传给 `history.select` 更新回看画面 |
   | `items[].floorId`    | 该状态关联的对话楼层；初始状态为 `null`                                         |
   | `items[].attemptId`  | 产生该状态的生成尝试标识；初始状态为 `null`                                     |
   | `nextCursor`         | 原样传给下一次 `history.listSnapshots`；`null` 表示已到末页                     |

#### 3.5.1 返回示例

1. 本页列出最近一次提交的状态与初始状态，顺序为从新到旧。

   ```json
   {
     "items": [
       {
         "snapshotId": "snapshot-1",
         "floorId": "floor-1",
         "attemptId": "run-1:1"
       },
       { "snapshotId": "snapshot-initial", "floorId": null, "attemptId": null }
     ],
     "nextCursor": null
   }
   ```

## 4. 聊天输入与发送

### 4.1 api.chat.setDraft — 填写输入草稿

#### 4.1.1 用途

1. 让剧情选项先进入系统输入框，用户可以修改后再发送；也用于用空字符串清空草稿。

#### 4.1.2 数据与存储

1. 草稿保存在当前页面宿主的内存中。

#### 4.1.3 调用签名

1. ```typescript
   api.chat.setDraft(text: string): Promise<null>;
   ```

#### 4.1.4 输入参数

1. | 参数 | 类型   | 必填 / 默认值      | 说明         |
   | ---- | ------ | ------------------ | ------------ |
   | text | string | 必填；允许空字符串 | 新的完整草稿 |

#### 4.1.5 输出结果

1. Promise 成功值为 null。

#### 4.1.6 回调与时序

1. 输入框写入完成后 Promise 成功。

#### 4.1.7 错误处理

1. INVALID_REQUEST：修正 text 类型；FLOOR_VIEW_DISPOSED：结束已释放视图的操作。

#### 4.1.8 使用示例

1. ```javascript
   await api.chat.setDraft("沿着码头继续向前走。");
   ```

#### 4.1.9 示例结果

1. 输入框出现“沿着码头继续向前走。”。

### 4.2 api.chat.send — 发送演绎输入

#### 4.2.1 用途

1. 将用户输入或选中的剧情选项提交到当前会话，生成回复并更新角色变量。

   发送后，后端按角色包内世界书条目配置执行生成动作、分组和概率筛选，再组装提示词。角色作者配置这些条件的方法见 [后端 API 第 7 章](backend-api.md#7-promptcontroller配置提示词控制器)。

#### 4.2.2 数据与存储

1. 正文由回复接口保存，变量由角色状态更新接口保存。失败后的处理见第 8 章。

#### 4.2.3 调用签名

1. ```typescript
   api.chat.send(params: { text: string }): Promise<{ snapshotId: string }>;
   ```

#### 4.2.4 输入参数

1. | 参数        | 类型   | 必填 / 默认值    | 说明         |
   | ----------- | ------ | ---------------- | ------------ |
   | params.text | string | 必填；长度至少 1 | 本次完整输入 |

#### 4.2.5 输出结果

1. Promise 返回 {snapshotId}，指本次角色变量提交后的快照。

#### 4.2.6 回调与时序

1. 调用时序见第8章。自定义聊天区域由角色前端绘制输入。

#### 4.2.7 错误处理

1. 按第15章的错误码和操作提示处理失败。

   1. 宿主可透传请求错误的 `code` 和 `message`。`orchestration_failed` 表示编排未完成，该错误码本身不能证明用户消息尚未保存。
   2. 角色前端通过 `messages.onTextStream` 记录本次 `branchId` 和 `floorId`；失败后将二者传给 `messages.getFloor`，通过返回消息的 `role` 核对用户输入与正文是否已保存。缺少本次楼层证据时，按第15章 `RESULT_UNKNOWN` 的方法核对状态；具有选项锁的前端在确认结果前保留锁。
   3. 回复生成失败使用 `widgets.mountChat` 提供的正文重试操作；变量更新失败的处理见第8章。`variables.onTurnCommitted` 通知提交成功后，角色前端刷新选项。角色前端按第15章显示发送或重试操作的失败提示。

#### 4.2.8 使用示例

1. ```javascript
   try {
     const result = await api.chat.send({ text: "沿着码头继续向前走。" });
     console.log("已提交快照", result.snapshotId);
   } catch (error) {
     console.error(error.code, error.message);
   }
   ```

#### 4.2.9 示例结果

1. 系统聊天组件先显示用户输入，再显示生成正文；已绑定变量的状态栏在提交成功后更新。

## 5. 多轮变量读取与提交回调

### 5.1 api.variables.get — 读取当前或历史角色变量

#### 5.1.1 用途

1. 在按钮条件判断或首次绘制时读取第1章定义的 current 或 view 状态；实际角色字段位于返回值的 variables 中。

#### 5.1.2 数据与存储

1. 从前端宿主内存读取变量记录的只读副本。

#### 5.1.3 调用签名

1. ```typescript
   api.variables.get(scope: 'current' | 'view'): Snapshot;
   ```

#### 5.1.4 输入参数

1. | 参数  | 类型                | 必填 / 默认值 | 说明                                |
   | ----- | ------------------- | ------------- | ----------------------------------- |
   | scope | 'current' 或 'view' | 必填          | 范围定义见第1章 |

#### 5.1.5 输出结果

1. 只读 Snapshot；字段见第 3 章。

#### 5.1.6 回调与时序

1. 无回调；同步返回。楼层作用域的 view 固定为该楼层，current 仍指会话最新。

#### 5.1.7 错误处理

1. INVALID_REQUEST：使用合法 scope；FLOOR_VIEW_DISPOSED：停止读取已释放视图。

#### 5.1.8 使用示例

1. ```javascript
   const record = api.variables.get("view");
   console.log(record.snapshotId, record.variables);
   ```

#### 5.1.9 示例结果

1. 以第 3.1 节的初始状态为例，控制台输出 snapshot-0 和 { location: "大厅", energy: 10 }。

### 5.2 api.variables.watch — 订阅快照变化

#### 5.2.1 用途

1. 让状态栏、立绘和行动区域随最新变量或用户选择的历史状态自动更新。

#### 5.2.2 数据与存储

1. 订阅保存在当前视图；回调获得完整变量记录的只读副本。

#### 5.2.3 调用签名

1. ```typescript
   api.variables.watch(scope: 'current' | 'view', callback: (record: Snapshot) => void): () => void;
   ```

#### 5.2.4 输入参数

1. | 参数     | 类型                       | 必填 / 默认值 | 说明             |
   | -------- | -------------------------- | ------------- | ---------------- |
   | scope    | 'current' 或 'view'        | 必填          | 订阅的数据范围   |
   | callback | (record: Snapshot) => void | 必填          | 接收只读完整快照 |

#### 5.2.5 输出结果

1. 返回解除订阅函数 stop()。

#### 5.2.6 回调与时序

1. 注册时立即投递一次，随后 snapshotId 改变才投递；楼层 view 只投递固定记录。回调异常由 Runtime 报告。

#### 5.2.7 错误处理

1. INVALID_REQUEST：修正 scope 或 callback；FLOOR_VIEW_DISPOSED：结束已释放视图操作。回调异常按上述投递规则报告。

#### 5.2.8 使用示例

1. ```javascript
   const stop = api.variables.watch("view", (record) => {
     console.log("当前查看地点", record.variables.location);
   });
   const page = await api.history.listSnapshots({
     branchId: api.variables.get("current").branchId,
   });
   const currentId = api.variables.get("current").snapshotId;
   const older = page.items.find((item) => item.snapshotId !== currentId);
   if (older) await api.history.select(older.snapshotId);
   stop();
   ```

#### 5.2.9 示例结果

1. 订阅时输出当前查看地点；本页包含旧状态时，选择该记录并输出其地点。本页只有当前状态时保留原画面。最后调用 stop 解除订阅。

### 5.3 api.variables.onTurnCommitted — 接收楼层提交

#### 5.3.1 用途

1. 在本轮变量保存完成后比较前后值，用于精力变化提示或单次提交动画；避免回看历史时再次播放这些效果。

#### 5.3.2 数据与存储

1. 监听器保存在当前视图；before 和 after 指向已提交的状态。

#### 5.3.3 调用签名

1. ```typescript
   api.variables.onTurnCommitted(callback: (event: TurnCommit) => void): () => void;
   ```

#### 5.3.4 输入参数

1. | 参数     | 类型                        | 必填 / 默认值 | 说明                              |
   | -------- | --------------------------- | ------------- | --------------------------------- |
   | callback | (event: TurnCommit) => void | 必填          | event 含 before、after 及提交身份 |

#### 5.3.5 输出结果

1. 返回解除订阅函数。

#### 5.3.6 回调与时序

1. Runtime 在订阅成功后，按[第3.2节](#32-turncommit一轮变量提交完成的通知)将通知传入 callback。

#### 5.3.7 错误处理

1. callback 须为函数，否则抛出 INVALID_REQUEST；回调异常由 Runtime 收集。

#### 5.3.8 使用前提

1. 该角色的状态 schema 定义 `energy` 为数字。把下方 HTML 用作角色模板，把 JavaScript 文件设为角色入口 script。

#### 5.3.9 使用示例

1. ```html
   <p id="energy-change">等待本轮变量提交</p>
   <button id="stop-changes">停止变化提示</button>
   <div id="chat"></div>
   ```

   ```javascript
   export function mount({ api }) {
     const panel = api.ui.register("turnChanges", {
       elements: {
         change: { selector: "#energy-change", kind: "text" },
         stop: { selector: "#stop-changes", kind: "control" },
         chat: { selector: "#chat", kind: "container" },
       },
     });
     const stop = api.variables.onTurnCommitted((event) => {
       const before = event.before.variables.energy;
       const after = event.after.variables.energy;
       const difference = after - before;
       panel.update({
         change: {
           text: `精力 ${before} → ${after}（${difference > 0 ? "+" : ""}${difference}）`,
         },
       });
     });
     panel.on("stop", "click", () => {
       stop();
       panel.update({ change: { text: "已停止变化提示" } });
     });
     api.widgets.mountChat(panel, "chat");
   }
   ```

#### 5.3.10 操作与结果

1. 用户通过模板中的系统聊天组件发送消息；若本轮成功提交第 3.2 节示例中的 after，提示显示 `精力 10 → 8（-2）`。变量保持原值时显示差值 0；变量更新失败时提示保持原文。点击“停止变化提示”后文字改为 `已停止变化提示`，提示保留该文字。

   可直接取用的文件：[HTML](examples/api-usage/commit-panel.html)、[JavaScript](examples/api-usage/commit-panel.mjs)。

### 5.4 api.variables.getSnapshot — 读取指定快照

#### 5.4.1 用途

1. 已知 snapshotId 时读取那一份完整角色状态，用于详情预览或与另一份状态比较。

#### 5.4.2 数据来源

1. 从前端缓存或后端保存的变量记录中读取指定快照。

#### 5.4.3 调用签名

1. ```typescript
   api.variables.getSnapshot(snapshotId: string): Promise<Snapshot>;
   ```

#### 5.4.4 输入参数

1. | 参数       | 类型   | 必填 / 默认值 | 说明              |
   | ---------- | ------ | ------------- | ----------------- |
   | snapshotId | string | 必填；非空    | 需要读取的快照 ID |

#### 5.4.5 输出结果

1. Promise 返回只读 Snapshot。

#### 5.4.6 回调与时序

1. 无回调；记录读取完成后 Promise 返回该记录。

#### 5.4.7 错误处理

1. ROLE_SNAPSHOT_NOT_FOUND：重新选择记录；INVALID_REQUEST：修正 ID。

#### 5.4.8 使用示例

1. 放在角色脚本的 async mount 内。假设角色 schema 定义 location:string 与 energy:number。

   ```javascript
   const branchId = api.variables.get("current").branchId;
   const page = await api.history.listSnapshots({ branchId, limit: 1 });
   if (page.items.length) {
     const after = await api.variables.getSnapshot(page.items[0].snapshotId);
     if (after.parentSnapshotId) {
       const before = await api.variables.getSnapshot(after.parentSnapshotId);
       console.log(before.variables.energy, after.variables.energy);
     } else {
       console.log("初始精力", after.variables.energy);
     }
   }
   ```

#### 5.4.9 示例结果

1. 使用第 3.2 节的提交记录时，输出提交前后的精力 `10 8`；读取第 3.1 节的初始记录时，输出“初始精力 10”。

### 5.5 api.variables.recalculateLatest — 重新计算最新楼层变量

#### 5.5.1 用途

1. 使用最新已提交楼层的正文和该楼层第一次计算前的变量，重新调用变量更新 Agent。连续重算同一楼层时使用同一份前值。

#### 5.5.2 调用签名

1. ```typescript
   api.variables.recalculateLatest(params: {
     branchId: string;
     floorId: string;
     expectedSnapshotId: string;
   }): Promise<{ operationId: string; before: Snapshot; after: Snapshot }>;
   ```

#### 5.5.3 输入参数

1. | 输入字段             | 用途与约束                                                                |
   | -------------------- | ------------------------------------------------------------------------- |
   | `branchId`           | 当前会话分支 ID，从 `api.variables.get('current')` 读取                   |
   | `floorId`            | 要重算的最新已提交楼层 ID；初始状态的 `floorId` 为 null，需先完成一轮对话 |
   | `expectedSnapshotId` | 点击时的当前快照 ID，后端用它检查计算期间是否发生其他提交                 |

#### 5.5.4 输出

1. `operationId` 是宿主为本次点击生成的操作编号；`before` 是提交前的当前记录，`after` 是校验通过后保存的新记录。重算使用的计算前值由后端保存，可与 `before` 不同：重复重算时，`before` 是上次重算结果，计算仍从原楼层前值开始。

#### 5.5.5 回调与时序

1. 后端按会话固定角色版本执行变量更新、派生与校验，成功后保存新快照。成功后 Promise 返回，`variables.watch('current', callback)` 收到新记录。同一会话其他已打开页面通过状态事件同步；正在查看历史的页面保留原 `view`。

#### 5.5.6 错误

1. 会话正在生成或更新时等待完成后重试；当前快照已变化时重新读取 current 后重试；目标已不是最新楼层时切换到最新楼层。模型、派生或校验失败时 Promise 拒绝，错误对象包含 `code` 和 `message`，原当前状态保留。具体错误码见[后端变量操作](backend-api.md#11-已保存变量的更新重算与补全-api)。

#### 5.5.7 示例

1. 把以下 HTML 放入角色模板，把 JavaScript 作为入口文件。按钮在操作期间禁用，失败提示按第15章处理。

   ```html
   <button id="recalculate">重新处理变量</button>
   <p id="repair-result"></p>
   <div id="chat"></div>
   ```

   ```javascript
   export function mount({ api }) {
     const panel = api.ui.register("repair", {
       elements: {
         button: { selector: "#recalculate", kind: "control" },
         result: { selector: "#repair-result", kind: "text" },
         chat: { selector: "#chat", kind: "container" },
       },
     });
     panel.on("button", "click", async () => {
       const current = api.variables.get("current");
       if (current.floorId === null) {
         panel.update({ result: { text: "请先完成一轮对话。" } });
         return;
       }
       panel.update({
         button: { disabled: true },
         result: { text: "正在重新处理变量…" },
       });
       try {
         await api.variables.recalculateLatest({
           branchId: current.branchId,
           floorId: current.floorId,
           expectedSnapshotId: current.snapshotId,
         });
         panel.update({ result: { text: "变量已重新计算。" } });
       } catch (error) {
         console.error(error.code, error.message);
         panel.update({ result: { text: "变量操作未完成，请核对当前变量；如错误持续，请联系角色卡维护者。" } });
       } finally {
         panel.update({ button: { disabled: false } });
       }
     });
     api.widgets.mountChat(panel, "chat");
   }
   ```

### 5.6 api.variables.restoreMissing — 用会话初值补齐缺失变量

#### 5.6.1 用途

1. 读取会话固定角色版本和所选开场的初值，递归补入当前对象缺失的字段，保留已存在的值，再执行该版本的派生与校验。已有的 `0`、`false`、空字符串、`null` 和数组都作为已存在值处理。角色作者在 `agents/state-update/profile.json` 的 `initialDescriptionPaths` 中声明描述字段的位置；这些位置使用初值中的描述替换已有描述。

#### 5.6.2 调用签名

1. ```typescript
   api.variables.restoreMissing(params: {
     branchId: string;
     expectedSnapshotId: string;
   }): Promise<{ operationId: string; before: Snapshot; after: Snapshot }>;
   ```

#### 5.6.3 输入参数

1. | 输入字段             | 用途与约束                                |
   | -------------------- | ----------------------------------------- |
   | `branchId`           | 当前会话分支 ID                           |
   | `expectedSnapshotId` | 点击时的当前快照 ID，用于提交时的并发检查 |

#### 5.6.4 输出

1. 字段含义与第5.5节相同。补全结果与当前变量相同时，`before.snapshotId` 与 `after.snapshotId` 相同；示例按钮据此显示“当前变量完整”。此时后端只完成操作记录，当前状态订阅保持原记录。

#### 5.6.5 回调、时序与存储

1. 后端确定性计算补全结果并校验，成功后保存操作记录；发生变量变化时追加快照并同步分支变量。此操作的模型调用次数为零。当前状态订阅、跨页面通知和历史回看行为遵循第5.5节。

#### 5.6.6 错误

1. Promise 拒绝返回错误。当前快照已变化时重新读取 current，再提交补全请求；派生或校验失败时按错误字段路径修正角色卡，发布后以新版本会话复验。

#### 5.6.7 调用示例

1. 放入已注册按钮的异步点击回调中；布局 `panel` 已注册 ID 为 `result` 的文本元素。

   ```javascript
   const current = api.variables.get("current");
   try {
     const result = await api.variables.restoreMissing({
       branchId: current.branchId,
       expectedSnapshotId: current.snapshotId,
     });
     panel.update({
       result: {
         text:
           result.before.snapshotId === result.after.snapshotId
             ? "当前变量完整。"
             : "缺失变量已补全。",
       },
     });
   } catch (error) {
     console.error(error.code, error.message);
         panel.update({ result: { text: "变量操作未完成，请核对当前变量；如错误持续，请联系角色卡维护者。" } });
   }
   ```

## 6. 已保存的楼层消息

### 6.1 api.messages.getFloor — 读取保存消息

#### 6.1.1 用途

1. 用户重新进入会话或展开历史楼层时，取回该轮已保存并经过展示处理的消息，绘制历史对话。

#### 6.1.2 数据来源

1. 后端保存的楼层消息记录；后端校验会话与 branchId 后，按 floorId 读取该楼层当前活动消息页中的可见消息。

#### 6.1.3 调用签名

1. ```typescript
   api.messages.getFloor(query: FloorQuery): Promise<RoleMessage[]>;
   ```

#### 6.1.4 输入参数

1. `query` 的字段与必填条件见第3.4节的 `FloorQuery`。

#### 6.1.5 输出结果

1. Promise 返回 RoleMessage 数组；各字段见第 3 章。

#### 6.1.6 回调与时序

1. 读取完成后 Promise 返回消息数组。

#### 6.1.7 错误处理

1. ROLE_FLOOR_NOT_FOUND：选择有效楼层；INVALID_REQUEST：修正参数。

#### 6.1.8 使用示例

1. 在 `async mount` 中读取最近一轮对话。

   ```javascript
   const branchId = api.variables.get("current").branchId;
   const page = await api.messages.listFloors({ branchId, limit: 1 });
   if (page.items.length) {
     const messages = await api.messages.getFloor({
       branchId,
       floorId: page.items[0].floorId,
     });
     for (const message of messages)
       console.log(`${message.role}：${message.text}`);
   }
   ```

#### 6.1.9 示例结果

1. 使用第 3.3 节的消息数据时，控制台输出该轮保存的用户输入与回复正文。

### 6.2 api.messages.listFloors — 分页列出对话

#### 6.2.1 用途

1. 为历史聊天区域取得对话索引。每项对应一个拥有已保存可见消息的有效楼层；正文已保存而变量更新失败的楼层也会返回。

#### 6.2.2 调用签名

1. ```typescript
   api.messages.listFloors(params: {
     branchId: string;
     cursor?: string;
     limit?: number;
   }): Promise<FloorPage>;
   ```

#### 6.2.3 输入参数

1. | 参数       | 类型    | 用途与约束                                       |
   | ---------- | ------- | ------------------------------------------------ |
   | `branchId` | string  | 必填非空字符串；指定当前会话中的分支             |
   | `cursor`   | string  | 可选；使用上次返回的 `nextCursor` 请求更早的对话 |
   | `limit`    | integer | 可选；每页条数。默认 `20`，取值为 `1` 至 `100`   |

#### 6.2.4 输出结果

1. 返回第 3.4 节的 `FloorPage`，按楼层编号从新到旧排序。

#### 6.2.5 回调与时序

1. 后端查询一页数据后，Promise 返回该页。页面首次加载请求一页，用户继续浏览时使用 `nextCursor` 请求下一页。

#### 6.2.6 错误处理

1. `INVALID_REQUEST`：按参数表修正请求；`ROLE_HISTORY_CURSOR_INVALID`：为当前会话分支重新读取第一页；`ROLE_HISTORY_LIMIT_INVALID`：按[第 6.2 节](#62-apimessageslistfloors--分页列出对话)的范围调整 `limit`；`ROLE_SESSION_NOT_FOUND`：选择有效会话。

#### 6.2.7 使用示例

1. 在 `async mount` 中加载最近两轮对话的正文。

   ```javascript
   const branchId = api.variables.get("current").branchId;
   const page = await api.messages.listFloors({ branchId, limit: 2 });
   for (const item of [...page.items].reverse()) {
     const messages = await api.messages.getFloor({
       branchId,
       floorId: item.floorId,
     });
     console.log(item.floorNo, messages);
   }
   // 保存 page.nextCursor，供用户下一次加载更早对话时使用。
   ```

#### 6.2.8 示例结果

1. 服务器依次返回第 8、7 轮时，控制台按第 7、8 轮的时间顺序输出消息。

## 7. 文本流渲染回调

### 7.1 api.messages.onTextStream — 订阅正文流

#### 7.1.1 用途

1. 在自定义回复区域显示正在生成的正文，并根据流状态显示完成或失败。

#### 7.1.2 数据与存储

1. 订阅和活动流缓存位于前端内存。

#### 7.1.3 调用签名

1. ```typescript
   api.messages.onTextStream(callback: (event: TextStreamEvent) => void, filter?: { floorId?: string; streamId?: string }): () => void;
   ```

#### 7.1.4 输入参数

1. | 参数            | 类型                             | 必填 / 默认值 | 说明                         |
   | --------------- | -------------------------------- | ------------- | ---------------------------- |
   | callback        | (event: TextStreamEvent) => void | 必填          | 接收完整正文及流状态         |
   | filter.floorId  | string                           | 可选；非空    | 仅匹配此楼层                 |
   | filter.streamId | string                           | 可选；非空    | 仅匹配此流；同时指定时取交集 |

#### 7.1.5 输出结果

1. 返回解除订阅函数。

#### 7.1.6 TextStreamEvent 字段定义

1. ```typescript
   type TextStreamEvent = {
     sessionId: string;
     branchId: string;
     floorId: string;
     attemptId: string;
     streamId: string;
     runId: string | null;
     jobId: string | null;
     messageId: string | null;
     revision: number;
     type: "snapshot" | "start" | "update" | "end" | "error" | "cancelled";
     status: "streaming" | "completed" | "failed" | "cancelled";
     text: string;
     error: { code: string; message: string } | null;
   };
   ```

   | 字段                    | 用途                                           | 当前正式发送的值与条件                                      |
   | ----------------------- | ---------------------------------------------- | ----------------------------------------------------------- |
   | `sessionId`、`branchId` | 校验文本属于正在显示的会话和分支               | 来自当前会话及回复开始事件                                  |
   | `floorId`               | 将实时回复定位到某一轮                         | 本次回复楼层 ID                                             |
   | `attemptId`             | 区分同一轮的生成尝试                           | 当前为 runId 加冒号及 attemptNo                             |
   | `streamId`              | 将一次回复的多次文本更新归到同一区域           | 当前为 `response:` 加 floorId；发送内配合 revision 判断新旧 |
   | `runId`                 | 关联后端运行记录                               | 当前从楼层运行接口取得；公共结构允许 null                   |
   | `jobId`                 | 关联后台任务来源                               | 当前角色发送适配器填 null                                   |
   | `messageId`             | 在生成结束后关联保存消息                       | 生成中为 null；结束时取保存的助手消息 ID，未找到时仍为 null |
   | `revision`              | 判断同一流哪次更新较新                         | 当前发送从 0 递增；宿主忽略同流不大于已接收值的更新         |
   | `type`                  | 表示这次通知是开始、文本更新、结束还是状态补发 | 当前实际投递方式见本节“回调与时序”                          |
   | `status`                | 表示当前文本是否仍在生成或已完成／失败         | 根据此字段更新加载与失败提示                                |
   | `text`                  | 当前可显示的完整正文                           | 用新值替换原显示；可以为空字符串                            |
   | `error`                 | 为失败状态提供原因                             | 正常事件为 null；失败补发含 code 与 message                 |

#### 7.1.7 回调与时序

1. 注册时以 snapshot 投递仍活动的匹配流。运行时投递 start、update、end；发送中断时宿主投递 type=snapshot、status=failed 的事件。预设为整段输出时，完成前可能没有文本更新。

#### 7.1.8 错误处理

1. INVALID_REQUEST：修正筛选或 callback。

#### 7.1.9 使用示例

1. ```javascript
   // 角色 HTML：<div id="live-output"></div><p id="stream-status"></p>
   const output = api.ui.register("liveOutput", {
     elements: {
       body: { selector: "#live-output", kind: "text" },
       status: { selector: "#stream-status", kind: "text" },
     },
   });
   let selectedStreamId = null;
   api.messages.onTextStream((event) => {
     if (event.type === "start" || selectedStreamId === null) {
       selectedStreamId = event.streamId;
     }
     if (event.streamId === selectedStreamId) {
       output.update({
         body: { text: event.text },
         status: {
           text:
             event.status === "failed"
               ? "本次回复未完成。请刷新当前会话，核对最新回复后再决定是否重试。"
               : event.status === "completed"
                 ? "正文已完成"
                 : event.status === "cancelled"
                   ? "本次回复已取消。请刷新当前会话，核对已保存内容后重新发送。"
                   : "正在回复",
         },
       });
     }
   });
   ```

#### 7.1.10 示例结果

1. live-output 显示当前正文，stream-status 随流状态显示“正在回复”“正文已完成”或失败提示。

## 8. 一次提交的多次返回与完成边界

1. 宿主处理一次 api.chat.send 的顺序：

1. ```mermaid
   sequenceDiagram
     participant C as 角色脚本
     participant H as 系统宿主
     participant V as 角色显示
     C->>H: api.chat.send({text})
     H->>V: 已挂载的系统聊天组件显示用户输入
     H-->>C: messages.onTextStream(start)
     loop 正文更新
       H-->>C: messages.onTextStream(update)
       C->>V: layout.update({body:{text}})
     end
     H-->>C: messages.onTextStream(end)
     Note over H: 宿主继续提交角色变量
     H-->>C: variables.watch(新快照)
     H-->>C: variables.onTurnCommitted(before/after)
     H-->>C: chat.send Promise返回snapshotId
   ```

1. 当前宿主先完成正文请求，再提交角色变量，之后完成 send。变量更新失败时，正文保留，send 拒绝 ROLE_STATE_UPDATE_FAILED；用户通过系统界面的“重试变量更新”操作复用已有正文完成变量更新。

## 9. 历史变量状态与查看

1. 本章方法用于读取和选择历史状态。重新生成、创建分支与切换分支通过系统界面的对应操作发起。

### 9.1 api.history.select — 切换历史查看

#### 9.1.1 用途

1. 把状态栏等绑定 view 的区域切换到指定历史变量记录，以查看当时的地点、数值和选项。

#### 9.1.2 数据与存储

1. 前端保存所选查看位置，并停止自动跟随最新状态；下一次发送继续使用当前会话分支的最新状态。

#### 9.1.3 调用签名

1. ```typescript
   api.history.select(snapshotId: string): Promise<{ snapshotId: string }>;
   ```

#### 9.1.4 输入参数

1. | 参数       | 类型   | 必填 / 默认值 | 说明         |
   | ---------- | ------ | ------------- | ------------ |
   | snapshotId | string | 必填；非空    | 目标历史快照 |

#### 9.1.5 输出结果

1. Promise 返回实际选择的 snapshotId。

#### 9.1.6 回调与时序

1. 无回调参数；读取成功后改变 view，触发 view 订阅；current 保持最新。

#### 9.1.7 错误处理

1. ROLE_SNAPSHOT_NOT_FOUND：重新选择记录；失败时保留已显示记录。

#### 9.1.8 使用示例

1. ```javascript
   const branchId = api.variables.get("current").branchId;
   const page = await api.history.listSnapshots({ branchId });
   const currentId = api.variables.get("current").snapshotId;
   const older = page.items.find((item) => item.snapshotId !== currentId);
   if (older) await api.history.select(older.snapshotId);
   ```

#### 9.1.9 示例结果

1. 绑定 view 的状态栏显示选中楼层的状态。

### 9.2 api.history.latest — 返回最新状态

#### 9.2.1 用途

1. 从历史回看返回会话最新变量记录，并让 view 在后续提交时继续跟随 current。

#### 9.2.2 数据与存储

1. 前端将查看位置设为最新状态，并开启自动跟随。

#### 9.2.3 调用签名

1. ```typescript
   api.history.latest(): Promise<{ snapshotId: string }>;
   ```

#### 9.2.4 输入参数

1. 无参数。

#### 9.2.5 输出结果

1. Promise 返回当前 snapshotId。

#### 9.2.6 回调与时序

1. 无回调参数；view 变为 current，快照改变时通知 view 订阅。

#### 9.2.7 错误处理

1. 视图释放时拒绝 FLOOR_VIEW_DISPOSED；宿主失败保留具体错误。

#### 9.2.8 使用示例

1. ```javascript
   await api.history.latest();
   ```

#### 9.2.9 示例结果

1. 历史状态栏恢复最新值，后续提交继续更新显示。

### 9.3 api.history.listSnapshots — 分页列出历史变量状态

#### 9.3.1 用途

1. 为状态回看选择器取得已保存的变量状态索引。成功提交变量后会新增状态记录；初始状态也属于本列表。

#### 9.3.2 调用签名

1. ```typescript
   api.history.listSnapshots(params: {
     branchId: string;
     cursor?: string;
     limit?: number;
   }): Promise<SnapshotPage>;
   ```

#### 9.3.3 输入参数

1. | 参数       | 类型    | 用途与约束                                                                               |
   | ---------- | ------- | ---------------------------------------------------------------------------------------- |
   | `branchId` | string  | 必填非空字符串；指定当前会话中的分支                                                     |
   | `cursor`   | string  | 可选；使用上次返回的 `nextCursor` 请求更早的变量状态                                     |
   | `limit`    | integer | 可选；默认值及上限使用[第 6.2 节](#62-apimessageslistfloors--分页列出对话)规定的分页范围 |

#### 9.3.4 输出结果

1. 返回第 3.5 节的 `SnapshotPage`，按状态保存顺序从新到旧排列。

#### 9.3.5 回调与时序

1. 后端按游标查询一页索引后，Promise 返回该页。详情通过第 5.4 节的 `variables.getSnapshot` 读取；页面切换通过第 9.1 节的 `history.select` 完成。

#### 9.3.6 错误处理

1. `INVALID_REQUEST`：按参数表修正请求；`ROLE_HISTORY_CURSOR_INVALID`：为当前会话分支重新读取第一页；`ROLE_HISTORY_LIMIT_INVALID`：按[第 6.2 节](#62-apimessageslistfloors--分页列出对话)的范围调整 `limit`；`ROLE_SESSION_NOT_FOUND`：选择有效会话。

#### 9.3.7 使用示例

1. 角色模板提供 `<button id="older-state">加载更早状态</button>`。以下代码放在 `async mount` 中。

   ```javascript
   const branchId = api.variables.get("current").branchId;
   const layout = api.ui.register("statePages", {
     elements: { older: { selector: "#older-state", kind: "control" } },
   });
   let cursor;
   let loading = false;
   async function loadPage() {
     if (loading || cursor === null) return;
     loading = true;
     try {
       const page = await api.history.listSnapshots({
         branchId,
         ...(cursor === undefined ? {} : { cursor }),
       });
       console.log(page.items);
       cursor = page.nextCursor;
     } finally {
       loading = false;
     }
   }
   layout.on("older", "click", loadPage);
   await loadPage();
   ```

#### 9.3.8 示例结果

1. 初始化时，控制台输出第一页变量状态索引。用户点击“加载更早状态”后，控制台输出下一页索引；用户在末页再次点击按钮时，控制台保留已有输出。

### 9.4 历史查看示例

1. 以下代码放入 async mount。角色模板包含 `<button id="latest">返回最新</button>`；已有状态栏绑定 view。

1. ```javascript
   const panel = api.ui.register("historyActions", {
     elements: { latest: { selector: "#latest", kind: "control" } },
   });
   panel.on("latest", "click", () => api.history.latest());
   const branchId = api.variables.get("current").branchId;
   const page = await api.history.listSnapshots({ branchId, limit: 20 });
   const currentId = api.variables.get("current").snapshotId;
   const older = page.items.find((item) => item.snapshotId !== currentId);
   if (older) await api.history.select(older.snapshotId);
   ```

#### 9.4.1 示例结果

1. 本页存在旧状态时，状态栏显示该记录；本页只有当前状态时保留原画面。用户点击“返回最新”后，状态栏显示最新状态并跟随之后的提交。

## 10. 布局注册、绑定和更新

### 10.1 api.ui.register — 注册角色布局

#### 10.1.1 用途

1. 将角色模板中已有的文字、图片、进度条和按钮登记为命名元素，供 update、bind 和 on 共同操作。

#### 10.1.2 数据与存储

1. 注册关系保存在当前视图内存，通过选择器关联角色模板中的元素。

#### 10.1.3 调用签名

1. ```typescript
   api.ui.register(id: string, registration: { root?: string; elements: Record<string, { selector: string; kind: 'image' | 'text' | 'progress' | 'fill' | 'control' | 'container' }> }): Layout;
   ```

#### 10.1.4 输入参数

1. | 参数                  | 类型   | 必填 / 默认值 | 说明                                       |
   | --------------------- | ------ | ------------- | ------------------------------------------ |
   | id                    | string | 必填；非空    | 当前作用域唯一布局 ID                      |
   | registration.root     | string | 可选          | CSS 选择器，恰好匹配一个根；省略为角色容器 |
   | registration.elements | object | 必填；非空    | 元素 ID 对应 selector 和 kind              |
   | elements[id].selector | string | 必填          | 在布局根内恰好匹配一个元素                 |
   | elements[id].kind     | 枚举   | 必填          | 声明可更新的元素类型                       |

#### 10.1.5 输出结果

1. 同步返回 Layout，方法为 update、bind、on、remove、animateVisibility。

#### 10.1.6 回调与时序

1. 无回调；在角色模板挂载后登记已有元素。

#### 10.1.7 错误处理

1. UI_REGISTRATION_INVALID：核对重复 ID、选择器、元素和 kind。

#### 10.1.8 使用示例

1. ```javascript
   // 角色 HTML：<p id="location"></p>
   const panel = api.ui.register("panel", {
     elements: { location: { selector: "#location", kind: "text" } },
   });
   panel.update({ location: { text: "港口" } });
   ```

#### 10.1.9 示例结果

1. location 元素显示“港口”。

### 10.2 layout.update — 批量更新元素

#### 10.2.1 用途

1. 把状态计算结果应用到已登记的页面元素，例如修改地点文字、替换立绘资源或禁用行动按钮。

#### 10.2.2 数据与存储

1. 更新当前页面中已登记元素的 DOM 属性。

#### 10.2.3 调用签名

1. ```typescript
   layout.update(patch: Record<string, ElementUpdate>): void;
   ```

#### 10.2.4 输入参数

1. | 参数  | 类型   | 必填 / 默认值 | 说明                                      |
   | ----- | ------ | ------------- | ----------------------------------------- |
   | patch | object | 必填          | 键为已注册元素 ID，值为该 kind 允许的属性 |

#### 10.2.5 ElementUpdate 属性

1. | 元素 kind | 可设置属性                                                   |
   | --------- | ------------------------------------------------------------ |
   | 所有类型  | visible:boolean；classes:Record<string,boolean>              |
   | image     | asset:string；alt:string                                     |
   | text      | text:string                                                  |
   | progress  | value:number；min:number；max:number                         |
   | fill      | percent:number，非负有限数字，可大于100                      |
   | control   | text:string；value:string；disabled:boolean；checked:boolean |
   | container | 通用属性                                                     |

   | 属性         | 用途与应用方式                                                                           |
   | ------------ | ---------------------------------------------------------------------------------------- |
   | `visible`    | 设置元素是否显示，内部写入 hidden 的反值                                                 |
   | `classes`    | 按布尔值添加或移除列出的 CSS 类，保留未列出的类                                          |
   | `asset`      | 用角色资源 ID 查图片 URL，再更新 img.src                                                 |
   | `alt`        | 设置图片替代文本                                                                         |
   | `text`       | 写入 textContent，作为普通文本显示                                                       |
   | `value`      | 设置进度／刻度数值或输入控件的字符串值                                                   |
   | `min`、`max` | 设置进度或刻度范围；HTML progress 的 min 仅接受 0，meter 可设置 min                      |
   | `percent`    | 将填充元素的 style.width 设为百分比，保留原节点和 CSS 的高度、颜色、圆角、裁剪与宽度过渡 |
   | `disabled`   | 设置控件能否操作                                                                         |
   | `checked`    | 设置复选或单选控件的选中状态                                                             |

   control 的 value、checked 等属性要求实际 DOM 控件支持该属性；属性用途由 kind 限定。

#### 10.2.6 输出结果

1. 返回 void。

#### 10.2.7 回调与时序

1. 无回调；先校验整份 patch 再应用，校验失败时保留原有属性；已释放布局为无操作。

#### 10.2.8 错误处理

1. UI_UPDATE_INVALID：核对 ID、属性、资源类型与实际控件。

#### 10.2.9 使用示例

1. ```javascript
   // 角色 HTML：<p id="value"></p>
   const panel = api.ui.register("valuePanel", {
     elements: { value: { selector: "#value", kind: "text" } },
   });
   panel.update({ value: { text: "精力 9", visible: true } });
   ```

#### 10.2.10 示例结果

1. value 元素显示文字并可见。

### 10.3 layout.bind — 绑定状态与布局

#### 10.3.1 用途

1. 把一份变量记录转换为页面更新对象，使状态栏随当前状态提交或历史选择自动重绘。

#### 10.3.2 数据与存储

1. 布局绑定保存在当前视图。

#### 10.3.3 调用签名

1. ```typescript
   layout.bind(scope: 'current' | 'view', mapper: (record: Snapshot) => Record<string, ElementUpdate>): () => void;
   ```

#### 10.3.4 输入参数

1. | 参数   | 类型                | 必填 / 默认值 | 说明                          |
   | ------ | ------------------- | ------------- | ----------------------------- |
   | scope  | 'current' 或 'view' | 必填          | 绑定数据范围                  |
   | mapper | 同步函数            | 必填          | 输入 Snapshot，输出元素 patch |

#### 10.3.5 输出结果

1. 返回解除当前布局绑定的函数。

#### 10.3.6 回调与时序

1. 立即计算一次，之后随快照变化计算；每布局一个绑定，再次 bind 替换旧绑定。当前解除句柄会解除布局现有绑定，作者应保留最新句柄。

#### 10.3.7 错误处理

1. 非法 mapper 为 UI_UPDATE_INVALID；非法 scope 为 INVALID_REQUEST；计算异常报告后跳过本次，后续记录可继续。

#### 10.3.8 使用示例

1. ```javascript
   // 角色 HTML：<p id="location"></p>
   const panel = api.ui.register("locationPanel", {
     elements: { location: { selector: "#location", kind: "text" } },
   });
   const stop = panel.bind("view", (record) => ({
     location: { text: String(record.variables.location) },
   }));
   ```

#### 10.3.9 示例结果

1. 状态栏跟随当前查看快照，包括历史切换。

### 10.4 layout.on — 绑定元素事件

#### 10.4.1 用途

1. 给已登记的按钮、输入框等元素绑定浏览器事件，例如点击行动按钮时填写草稿或发送消息。

#### 10.4.2 数据与存储

1. 事件监听器登记在当前页面的目标元素上。

#### 10.4.3 调用签名

1. ```typescript
   layout.on(elementId: string, event: string, handler: (event: Event) => unknown): () => void;
   ```

#### 10.4.4 输入参数

1. | 参数      | 类型   | 必填 / 默认值 | 说明                           |
   | --------- | ------ | ------------- | ------------------------------ |
   | elementId | string | 必填          | 已注册元素 ID                  |
   | event     | string | 必填；非空    | 浏览器事件名                   |
   | handler   | 函数   | 必填          | 接收原生 Event，可返回 Promise |

#### 10.4.5 输出结果

1. 返回解除监听函数。

#### 10.4.6 回调与时序

1. 事件发生时调用 handler；同步异常及返回 Promise 的拒绝由 Runtime 收集。已释放布局返回空解除函数。

#### 10.4.7 错误处理

1. UI_REGISTRATION_INVALID：核对元素；INVALID_REQUEST：核对事件名和 handler。

#### 10.4.8 使用示例

1. ```javascript
   // 角色 HTML：<button id="prepare">填写行动</button>
   const panel = api.ui.register("actions", {
     elements: { prepare: { selector: "#prepare", kind: "control" } },
   });
   panel.on("prepare", "click", () => api.chat.setDraft("沿着码头继续向前走。"));
   ```

#### 10.4.9 示例结果

1. 点击按钮后系统输入框出现行动文本。

### 10.5 layout.remove — 注销布局

#### 10.5.1 用途

1. 停止一组元素的自动状态绑定和事件响应，并卸载该布局登记的系统聊天组件。

#### 10.5.2 数据与存储

1. 删除前端布局登记；模板原有 DOM 留在页面，已挂载组件按自身清理逻辑卸载。自定义楼层列表须使用其 destroy 方法结束。

#### 10.5.3 调用签名

1. ```typescript
   layout.remove(): void;
   ```

#### 10.5.4 输入参数

1. 无参数。

#### 10.5.5 输出结果

1. 返回 void。

#### 10.5.6 回调与时序

1. 无回调；重复调用无效果，原 HTML 保留。

#### 10.5.7 使用示例

1. ```javascript
   // 角色 HTML：<p id="tip"></p>
   const panel = api.ui.register("tipPanel", {
     elements: { tip: { selector: "#tip", kind: "text" } },
   });
   panel.bind("view", (record) => ({
     tip: { text: String(record.variables.location) },
   }));
   panel.remove();
   ```

#### 10.5.8 示例结果

1. tip 元素显示调用时的地点；remove 后元素保留，后续变量变化时文字保持原值。

### 10.6 layout.animateVisibility — 展开或收起内容

#### 10.6.1 用途

1. 让已注册的 container 按指定时长滑动展开或收起。连续调用按元素分别排队。

#### 10.6.2 数据与存储

1. 临时修改当前页面元素的高度、上下 padding、上下 margin、overflow 和显示状态；动画队列保存在该布局的内存中。

#### 10.6.3 调用签名

1. ```typescript
   layout.animateVisibility(elementId: string, options: {
     visible: boolean;
     durationMs: number;
     easing: "swing";
     queue: "append";
   }): Promise<void>;
   ```

#### 10.6.4 输入参数

1. | 参数               | 必填与约束                  | 用途                                                      |
   | ------------------ | --------------------------- | --------------------------------------------------------- |
   | elementId          | 必填，已注册的 container ID | 指定内容容器                                              |
   | options.visible    | 必填，boolean               | 指定动画完成后的显示状态                                  |
   | options.durationMs | 必填，非负安全整数          | 动画毫秒数；0立即完成                                     |
   | options.easing     | 必填，固定为 swing          | 用 `0.5 - cos(t × π) / 2` 计算动画进度，t为0至1的时间比例 |
   | options.queue      | 必填，固定为 append         | 加入该元素的队尾                                          |

#### 10.6.5 输出结果

1. 返回 `Promise<void>`，本次动画结束后兑现。

#### 10.6.6 回调与时序

1. 同一元素依次执行，不同元素可以同时执行。每次开始时读取当前尺寸，动画结束后恢复高度、上下 padding/margin 和 overflow 的原内联值。展开恢复可见显示方式；收起设置 display:none。`layout.remove()` 或楼层释放会取消动画和排队任务，并拒绝未完成的 Promise。

#### 10.6.7 错误处理

1. `UI_UPDATE_INVALID` 表示元素 ID、kind 或 options 无效，请检查注册项和参数；`FLOOR_VIEW_DISPOSED` 表示布局已释放，请在新挂载的布局上发起操作。通过 Promise 的 catch 接收错误。

#### 10.6.8 使用示例

1. ```javascript
   // 角色 HTML：
   // <button id="toggle">展开</button><div id="details" style="display:none">人物资料</div>
   // <div class="track"><div id="fill"></div></div><p id="error"></p>
   const panel = api.ui.register("profile", {
     elements: {
       toggle: { selector: "#toggle", kind: "control" },
       details: { selector: "#details", kind: "container" },
       fill: { selector: "#fill", kind: "fill" },
       error: { selector: "#error", kind: "text" },
     },
   });
   panel.update({ fill: { percent: 50.5 } });
   let visible = false;
   panel.on("toggle", "click", () => {
     visible = !visible;
     panel.update({ toggle: { text: visible ? "收起" : "展开" } });
     panel
       .animateVisibility("details", {
         visible,
         durationMs: 300,
         easing: "swing",
         queue: "append",
       })
       .catch((error) => {
         if (error.code !== "FLOOR_VIEW_DISPOSED") {
           console.error(error.code, error.message);
           panel.update({ error: { text: "画面操作未完成，请刷新当前页面后重试。" } });
         }
       });
   });
   ```

#### 10.6.9 示例结果

1. 填充条宽度为父容器的50.5%；点击按钮后，人物资料在300毫秒内展开或收起。快速点击三次会按展开、收起、展开的顺序完成动画。

## 11. 系统聊天组件

### 11.1 api.widgets.mountChat — 挂载系统聊天组件

#### 11.1.1 用途

1. 把系统提供的历史消息、输入框、实时回复及失败重试操作放入角色模板容器，避免角色自己重新实现发送与恢复流程。

#### 11.1.2 数据与存储

1. 组件通过 `messages.listFloors` 读取一页对话索引，通过 `messages.getFloor` 读取消息。首次加载最近一页并按时间顺序显示，用户向上滚动或点击“加载更早对话”时再请求一页。浏览旧对话期间保持当前位置，回到末尾时刷新最新一页。

#### 11.1.3 调用签名

1. ```typescript
   api.widgets.mountChat(layout: Layout, elementId: string): { destroy(): void };
   ```

#### 11.1.4 输入参数

1. 每个角色实例最多挂载一个系统聊天组件。

   | 参数      | 类型   | 必填 / 默认值 | 说明                    |
   | --------- | ------ | ------------- | ----------------------- |
   | layout    | Layout | 必填          | 当前作用域活动布局      |
   | elementId | string | 必填          | 注册为 container 的元素 |

#### 11.1.5 输出结果

1. 返回组件句柄；其 destroy 方法见 11.2。

#### 11.1.6 回调与时序

1. 同步创建组件。

#### 11.1.7 错误处理

1. CHAT_ALREADY_MOUNTED：复用或先销毁现有组件；UI_REGISTRATION_INVALID：核对容器。历史读取失败时，组件显示错误与“重新加载”按钮；点击后重试失败的请求并保留已显示的消息。

#### 11.1.8 使用示例

1. ```javascript
   // 角色 HTML：<div id="chat"></div>
   const layout = api.ui.register("chatLayout", {
     elements: { chat: { selector: "#chat", kind: "container" } },
   });
   const chat = api.widgets.mountChat(layout, "chat");
   ```

#### 11.1.9 示例结果

1. 容器中出现统一聊天输入与消息区域。

### 11.2 chat.destroy — 卸载聊天组件

#### 11.2.1 用途

1. 从角色模板中移除已挂载的系统聊天组件，解除它的显示订阅，便于切换布局后重新挂载。

#### 11.2.2 数据与存储

1. 移除前端组件；后端保留会话、消息和变量。

#### 11.2.3 调用签名

1. ```typescript
   chat.destroy(): void;
   ```

#### 11.2.4 输入参数

1. 无参数。

#### 11.2.5 输出结果

1. 返回 void。

#### 11.2.6 回调与时序

1. 无回调；重复调用无效果，销毁后可重新挂载一个系统聊天组件；正在执行的后端生成继续处理。

#### 11.2.7 使用示例

1. ```javascript
   // chat 从第 11.1 节的完整布局与 mountChat 调用获得。
   chat.destroy();
   ```

#### 11.2.8 示例结果

1. 原挂载聊天区域被释放，后端消息保留。

## 12. 预置资源和数据

### 12.1 api.assets.url — 读取资源地址

#### 12.1.1 用途

1. 取得角色版本已交付资源的 URL，供自定义图片或媒体展示使用；资源 ID 来自角色包声明。

#### 12.1.2 数据与存储

1. 从当前角色版本已加载的资源映射读取地址。

#### 12.1.3 调用签名

1. ```typescript
   api.assets.url(id: string): string;
   ```

#### 12.1.4 输入参数

1. | 参数 | 类型   | 必填 / 默认值 | 说明                          |
   | ---- | ------ | ------------- | ----------------------------- |
   | id   | string | 必填          | 角色 assets 中已声明的资源 ID |

#### 12.1.5 输出结果

1. 同步返回 URL 字符串。

#### 12.1.6 回调与时序

1. 无回调；只查找资源。

#### 12.1.7 错误处理

1. ASSET_NOT_FOUND：用 assets.list 检查资源声明。

#### 12.1.8 使用示例

1. ```javascript
   const images = api.assets.list({ kind: "image" });
   if (images.length) console.log(api.assets.url(images[0].id));
   ```

#### 12.1.9 示例结果

1. 存在图片资源时，控制台输出第一张图片的 URL；具体地址由当前版本的资源交付结果决定。

### 12.2 api.assets.list — 筛选角色资源

#### 12.2.1 用途

1. 为立绘或音频选择器列出角色包内资源，并按图片／音频类型和单个标签筛选候选项。

#### 12.2.2 数据与存储

1. 从当前版本已交付的资源元数据中筛选结果。

#### 12.2.3 调用签名

1. ```typescript
   api.assets.list(params?: { kind?: 'image' | 'audio'; tag?: string }): ReadonlyArray<{ id: string; kind: 'image' | 'audio'; label: string; tags: string[] }>;
   ```

#### 12.2.4 输入参数

1. | 参数        | 类型               | 必填 / 默认值 | 说明               |
   | ----------- | ------------------ | ------------- | ------------------ |
   | params.kind | 'image' 或 'audio' | 可选          | 类型筛选           |
   | params.tag  | string             | 可选          | 资源必须包含该标签 |

#### 12.2.5 筛选规则

1. 省略 params 返回全部资源；同时指定 kind 和 tag 时，返回同时满足两项条件的资源。

#### 12.2.6 输出结果

1. 按 ID 排序的只读元数据数组；无匹配时为空数组。每项的 `id` 用于 assets.url、图片更新或音频播放；`kind` 区分 image 与 audio；`label` 是供资源选择器显示的名称；`tags` 是角色资源声明的标签集合。

#### 12.2.7 回调与时序

1. 同步返回筛选结果。

#### 12.2.8 错误处理

1. INVALID_REQUEST：修正筛选参数。

#### 12.2.9 使用示例

1. ```javascript
   const portraits = api.assets.list({ kind: "image", tag: "portrait" });
   console.log(portraits);
   ```

#### 12.2.10 示例结果

1. 控制台输出 kind 为 image 且含 portrait 标签的资源数组；各项包含 id、kind、label、tags。

### 12.3 api.data.get — 读取角色预置数据

1. 原生 ZIP 的 `frontend/manifest.json` 用 `data` 将数据 ID 映射到包内 `data/*.json`。后端读取会话固定版本中的 JSON，`api.data.get(id)` 返回解析后的数据。

#### 12.3.1 用途

1. 读取角色包预置的静态 JSON 数据，或系统已处理的 opening 开场文本，用于初始化角色展示。

#### 12.3.2 数据与存储

1. 从当前角色版本已加载的 delivery.data 读取预置数据。

#### 12.3.3 调用签名

1. ```typescript
   api.data.get(key: string): unknown;
   ```

#### 12.3.4 输入参数

1. | 参数 | 类型   | 必填 / 默认值 | 说明             |
   | ---- | ------ | ------------- | ---------------- |
   | key  | string | 必填          | 实际存在的数据键 |

#### 12.3.5 输出结果

1. 返回只读 JSON 值，具体类型由该数据键定义。
2. 系统数据键 `opening` 返回已展开宏的所选开场正文；具名人设对应的 `performerName` 返回会话绑定的人设姓名。未提供人设姓名时，`performerName` 不存在，读取该键返回 `DATA_NOT_FOUND`。

#### 12.3.6 回调与时序

1. 同步读取。

#### 12.3.7 错误处理

1. DATA_NOT_FOUND：核对交付 data；该错误也用于 key 类型不正确。

#### 12.3.8 使用示例

1. ```javascript
   const opening = api.data.get("opening");
   console.log(opening);
   ```

#### 12.3.9 示例结果

1. 假设当前开场为“你走进大厅。”，控制台输出该字符串。

## 13. 媒体、事件与计时器

### 13.1 api.media.play — 播放音频

#### 13.1.1 用途

1. 在角色页面播放背景音乐或音效；通道名用于控制一组播放，便于用同名通道切换曲目或恢复暂停。

#### 13.1.2 数据与存储

1. 音频元素和播放位置保存在当前视图内存中。

#### 13.1.3 调用签名

1. ```typescript
   api.media.play(params: { asset: string; channel: string; loop?: boolean; volume?: number }): Promise<null>;
   ```

#### 13.1.4 输入参数

1. | 参数           | 类型    | 必填 / 默认值 | 说明              |
   | -------------- | ------- | ------------- | ----------------- |
   | params.asset   | string  | 必填；非空    | audio 类型资源 ID |
   | params.channel | string  | 必填；非空    | 作用域内通道名    |
   | params.loop    | boolean | 可选；false   | 是否循环          |
   | params.volume  | number  | 可选；1       | 范围 0—1          |

#### 13.1.5 输出结果

1. 播放开始后 Promise 成功值为 null。

#### 13.1.6 回调与时序

1. 无回调；同通道同资源保留位置，暂停后恢复；换资源从头播放。

#### 13.1.7 错误处理

1. INVALID_REQUEST：修正参数；ASSET_NOT_FOUND：核对音频；AUDIO_FAILED：播放失败，通道释放，提供用户触发播放入口。

#### 13.1.8 使用示例

1. ```javascript
   const tracks = api.assets.list({ kind: "audio" });
   if (tracks.length)
     await api.media.play({
       asset: tracks[0].id,
       channel: "bgm",
       loop: true,
       volume: 0.4,
     });
   ```

#### 13.1.9 示例结果

1. 开始播放选中音频；浏览器拒绝播放时 Promise 失败。

### 13.2 api.media.pause — 暂停音频

#### 13.2.1 用途

1. 暂停播放某个音频通道，保留当前位置，供下一次 play 同一资源时继续播放。

#### 13.2.2 数据与存储

1. 更新当前页面音频通道的播放状态。

#### 13.2.3 调用签名

1. ```typescript
   api.media.pause(channel: string): void;
   ```

#### 13.2.4 输入参数

1. | 参数    | 类型   | 必填 / 默认值 | 说明           |
   | ------- | ------ | ------------- | -------------- |
   | channel | string | 必填          | 已使用的通道名 |

#### 13.2.5 输出结果

1. 返回 void。

#### 13.2.6 回调与时序

1. 无回调；通道存在时更新音频状态，通道缺失时直接返回。

#### 13.2.7 错误处理

1. 已释放作用域抛 FLOOR_VIEW_DISPOSED。

#### 13.2.8 使用示例

1. ```javascript
   const tracks = api.assets.list({ kind: "audio" });
   if (tracks.length) {
     await api.media.play({ asset: tracks[0].id, channel: "bgm" });
     api.media.pause("bgm");
   }
   ```

#### 13.2.9 示例结果

1. 存在音频资源且播放成功时，bgm 随即暂停并保留播放位置。

### 13.3 api.media.stop — 停止音频

#### 13.3.1 用途

1. 结束指定通道的播放并归零进度，使再次播放该曲目时从开头开始。

#### 13.3.2 数据与存储

1. 更新当前页面音频元素的播放状态与位置。

#### 13.3.3 调用签名

1. ```typescript
   api.media.stop(channel: string): void;
   ```

#### 13.3.4 输入参数

1. | 参数    | 类型   | 必填 / 默认值 | 说明           |
   | ------- | ------ | ------------- | -------------- |
   | channel | string | 必填          | 已使用的通道名 |

#### 13.3.5 输出结果

1. 返回 void。

#### 13.3.6 回调与时序

1. 无回调；通道存在时更新音频状态，通道缺失时直接返回。

#### 13.3.7 错误处理

1. 已释放作用域抛 FLOOR_VIEW_DISPOSED。

#### 13.3.8 使用示例

1. ```javascript
   const tracks = api.assets.list({ kind: "audio" });
   if (tracks.length) {
     await api.media.play({ asset: tracks[0].id, channel: "bgm" });
     api.media.stop("bgm");
   }
   ```

#### 13.3.9 示例结果

1. 存在音频资源且播放成功时，bgm 随即停止，播放位置归零。

### 13.4 api.events.on — 监听全局事件

#### 13.4.1 用途

1. 为角色界面处理 document 或 window 上的按键、窗口变化等浏览器事件，监听器随视图一起释放。

#### 13.4.2 数据与存储

1. 在当前页面登记浏览器事件监听器。

#### 13.4.3 调用签名

1. ```typescript
   api.events.on(target: 'window' | 'document', event: string, handler: (event: Event) => unknown): () => void;
   ```

#### 13.4.4 输入参数

1. | 参数    | 类型                   | 必填 / 默认值 | 说明           |
   | ------- | ---------------------- | ------------- | -------------- |
   | target  | 'window' 或 'document' | 必填          | 事件对象       |
   | event   | string                 | 必填；非空    | 浏览器事件名称 |
   | handler | 函数                   | 必填          | 接收原生 Event |

#### 13.4.5 输出结果

1. 返回解除监听函数。

#### 13.4.6 回调与时序

1. 事件触发时调用 handler，Runtime 收集同步异常和 Promise 拒绝。

#### 13.4.7 错误处理

1. INVALID_REQUEST：修正 target、event 或 handler。

#### 13.4.8 使用示例

1. ```javascript
   const stop = api.events.on("document", "keydown", (event) => {
     if (event.key === "Escape") console.log("收到 Escape");
   });
   ```

#### 13.4.9 示例结果

1. 按 Escape 键时，控制台输出“收到 Escape”。

### 13.5 api.timers.after — 延时执行一次

#### 13.5.1 用途

1. 延迟执行一次页面操作，例如关闭临时提示。

#### 13.5.2 数据与存储

1. 计时器保存在当前前端视图，由浏览器调度回调。

#### 13.5.3 调用签名

1. ```typescript
   api.timers.after(ms: number, callback: () => void): () => void;
   ```

#### 13.5.4 输入参数

1. | 参数     | 类型     | 必填 / 默认值 | 说明         |
   | -------- | -------- | ------------- | ------------ |
   | ms       | integer  | 必填；至少 0  | 延迟毫秒     |
   | callback | 同步函数 | 必填          | 到期执行一次 |

#### 13.5.5 输出结果

1. 返回提前取消函数。

#### 13.5.6 回调与时序

1. 隐藏页面暂停计时，恢复后继续剩余时间；执行后解除登记。

#### 13.5.7 错误处理

1. INVALID_REQUEST：修正时长或 callback；回调错误由 Runtime 报告。

#### 13.5.8 使用示例

1. ```javascript
   const cancel = api.timers.after(1500, () => {
     console.log("提示可以关闭");
   });
   ```

#### 13.5.9 示例结果

1. 页面可见时等待 1500 毫秒，控制台输出一次“提示可以关闭”。

### 13.6 api.timers.every — 周期执行

#### 13.6.1 用途

1. 周期执行页面操作，例如更新动画或倒计时文字。

#### 13.6.2 数据与存储

1. 计时器保存在当前前端视图。

#### 13.6.3 调用签名

1. ```typescript
   api.timers.every(ms: number, callback: () => void): () => void;
   ```

#### 13.6.4 输入参数

1. | 参数     | 类型     | 必填 / 默认值 | 说明       |
   | -------- | -------- | ------------- | ---------- |
   | ms       | integer  | 必填；大于 0  | 间隔毫秒   |
   | callback | 同步函数 | 必填          | 每周期执行 |

#### 13.6.5 输出结果

1. 返回取消函数。

#### 13.6.6 回调与时序

1. 隐藏页面暂停；恢复后重新计时；所属视图销毁时自动停止。

#### 13.6.7 错误处理

1. ms 须为正整数，callback 须为函数，否则抛出 INVALID_REQUEST。

#### 13.6.8 使用示例

1. ```javascript
   const cancel = api.timers.every(1000, () => {
     console.log("更新本地显示");
   });
   // 结束周期刷新时调用 cancel()。
   ```

#### 13.6.9 示例结果

1. 页面可见期间，控制台每隔 1000 毫秒输出一次“更新本地显示”。

## 14. 楼层显示范围与资源释放

### 14.1 api.ui.mountFloors — 挂载自定义历史楼层

#### 14.1.1 用途

1. 用角色提供的 floorHtml 为每份已保存的变量状态创建独立展示区，包括初始状态。每一行使用自己的变量记录绘制角色状态。

#### 14.1.2 模板前提

1. 原生 ZIP 作者在 `frontend/manifest.json` 的 `floorHtml` 中填写包内 HTML 路径。已有角色快照使用 `extensions.tavern_headless.frontend.floorHtml` 指定模板文件。后端固定并读取文件后，将其文本交付为 `delivery.floorHtml`；每一行使用这份模板，具体包结构见[模板入口](script-template-api.md#包入口)。

#### 14.1.3 数据与存储

1. 列表通过 `history.listSnapshots` 从新到旧分页读取索引，通过 `variables.getSnapshot` 读取可见行的变量记录；离屏时释放该行的 DOM 与监听。

#### 14.1.4 调用签名

1. ```typescript
   api.ui.mountFloors(layout: Layout, elementId: string, renderFloor: (context: { api: RoleApi; record: Snapshot }) => void | (() => void) | Promise<void | (() => void)>): FloorListHandle;
   ```

#### 14.1.5 输入参数

1. | 参数        | 类型   | 必填 / 默认值 | 说明                                                                                                       |
   | ----------- | ------ | ------------- | ---------------------------------------------------------------------------------------------------------- |
   | layout      | Layout | 必填          | 当前作用域布局                                                                                             |
   | elementId   | string | 必填          | container 元素                                                                                             |
   | renderFloor | 函数   | 必填          | 接收 api 和 record；api 的类型 RoleApi 包含本文定义的方法，record 为该行变量状态；可返回清理函数或 Promise |

#### 14.1.6 输出结果

1. 返回 FloorListHandle，供调用方控制列表加载、显示范围和资源释放。

#### 14.1.7 FloorListHandle 初始化属性

1. ready 为 Promise<void>，初次加载和窗口挂载完成后成功，读取失败时拒绝。其余四个方法分别见 14.2—14.5。

#### 14.1.8 回调与时序

1. 列表挂载可见及预加载范围内的行。楼层挂载时调用 renderFloor，并等待其 Promise；返回清理函数时，卸载该行会调用它。楼层 api 的 view 固定为该行记录，current 跟随会话。离屏后释放该行登记资源，重新进入窗口时再次调用 renderFloor；提交通知的触发条件见第 5.3 节。

#### 14.1.9 错误处理

1. UI_REGISTRATION_INVALID：检查容器和 floorHtml；非法回调为 INVALID_REQUEST；历史读取失败通过 ready/loadNext 拒绝。

#### 14.1.10 句柄的完整取得与调用示例

1. 下方代码放入 `async function mount({ api })`。角色模板需要 `<div id="history-demo"></div>`，floorHtml 文件需要 `<p class="floor-energy"></p>`，角色变量 energy 为数字。

   ```javascript
   const layout = api.ui.register("historyDemo", {
     elements: { rows: { selector: "#history-demo", kind: "container" } },
   });
   const floors = api.ui.mountFloors(layout, "rows", ({ api: floorApi }) => {
     const row = floorApi.ui.register("row", {
       elements: { energy: { selector: ".floor-energy", kind: "text" } },
     });
     row.bind("view", (record) => ({
       energy: { text: `本轮精力：${record.variables.energy}` },
     }));
   });
   try {
     await floors.ready;
     await floors.loadNext();
     await floors.setVisibleRange(0, 4);
     const stats = floors.diagnostics();
     console.log("已加载", stats.items, "已挂载", stats.mounted);
   } catch (error) {
     console.error("历史列表加载失败", error.code, error.message);
   }
   // 页面自己的关闭动作中调用 floors.destroy()；此处保留列表供用户浏览。
   ```

#### 14.1.11 结果

1. 每行显示该轮精力；控制台输出实际加载与挂载数量。已加载记录不足五行时，只挂载已有行；实际滚动会继续更新窗口。

### 14.2 floors.loadNext — 加载下一页

#### 14.2.1 用途

1. 在用户继续浏览状态历史时，追加下一页变量状态记录。

#### 14.2.2 数据与存储

1. 将后端返回的下一页状态索引加入列表，按显示范围读取变量并缓存。

#### 14.2.3 调用签名

1. ```typescript
   floors.loadNext(): Promise<void>;
   ```

#### 14.2.4 输入参数

1. 无参数。

#### 14.2.5 输出结果

1. Promise 成功值为 undefined；无下一页或已销毁时直接结束。

#### 14.2.6 回调与时序

1. 无回调参数；加载后更新窗口，新增可见楼层触发创建时提供的 renderFloor。

#### 14.2.7 错误处理

1. 读取失败时 Promise 拒绝；捕获错误并保留已加载列表。

#### 14.2.8 使用示例

1. ```javascript
   // floors 从第 14.1 节“句柄的完整取得与调用示例”获得。
   await floors.ready;
   await floors.loadNext();
   ```

#### 14.2.9 示例结果

1. 需要下一页时列表增加楼层，已显示内容保持可用。

### 14.3 floors.setVisibleRange — 设置显示窗口

#### 14.3.1 用途

1. 手动控制自定义历史列表要保留的行区间，例如由外部滚动控件指定当前窗口。

#### 14.3.2 数据与存储

1. 更新前端列表的挂载窗口，按范围挂载和释放行元素。

#### 14.3.3 调用签名

1. ```typescript
   floors.setVisibleRange(start: number, end: number): Promise<void>;
   ```

#### 14.3.4 输入参数

1. start 与 end 均必填，作者须提供有限 number；运行时将有限小数向零截断为整数。end 包含在窗口内，start 调整为至少 0，end 调整为至少 start。

#### 14.3.5 输出结果

1. 窗口处理结束后 Promise 成功值为 undefined。

#### 14.3.6 回调与时序

1. 系统滚动监听也会更新此范围。需要挂载的楼层调用 renderFloor，离屏楼层释放；已销毁列表直接结束。

#### 14.3.7 错误处理

1. 列表读取失败时 Promise 拒绝；调用方捕获错误并保留已显示内容。

#### 14.3.8 使用示例

1. ```javascript
   // floors 从第 14.1 节“句柄的完整取得与调用示例”获得。
   await floors.ready;
   await floors.setVisibleRange(0, 4);
   ```

#### 14.3.9 示例结果

1. 列表按指定范围和系统预加载配置挂载楼层。

### 14.4 floors.diagnostics — 查看列表状态

#### 14.4.1 用途

1. 检查历史列表是否已加载数据、挂载了多少行、还有没有下一页，用于定位空列表、滚动加载或缓存问题。

#### 14.4.2 数据与存储

1. 读取当前列表和共享缓存的内存统计。

#### 14.4.3 调用签名

1. ```typescript
   floors.diagnostics(): FloorListDiagnostics;
   ```

#### 14.4.4 输入参数

1. 无参数。

#### 14.4.5 输出结果

1. 返回以下只读统计对象。

   | 字段                                        | 类型           | 用途与取值                                                   |
   | ------------------------------------------- | -------------- | ------------------------------------------------------------ |
   | `items`                                     | number         | 已加载到当前列表的楼层指针数量                               |
   | `mounted`                                   | number         | 当前实际挂载并运行脚本的行数，包括预加载范围                 |
   | `visibleStart`、`visibleEnd`                | number         | 当前窗口首尾索引，从 0 开始；隐藏容器时 end 可为 -1          |
   | `firstVisibleFloorId`、`lastVisibleFloorId` | string 或 null | 窗口首尾对应的楼层；索引没有记录时为 null                    |
   | `followTail`                                | boolean        | 刷新时是否跟随底部；角色 api 的 mountFloors 当前未开启该选项 |
   | `cached`                                    | number         | Runtime 共享历史缓存中的条目数，可能包含其他列表使用的记录   |
   | `cacheBytes`                                | number         | 共享缓存按序列化键值计算的字节数                             |
   | `hasNextPage`                               | boolean        | 是否仍可请求后续页；初次分页尚未返回时也可能为 true          |

#### 14.4.6 回调与时序

1. 无回调；同步返回当前统计。

#### 14.4.7 使用示例

1. ```javascript
   // floors 从第 14.1 节“句柄的完整取得与调用示例”获得。
   console.log(floors.diagnostics());
   ```

#### 14.4.8 示例结果

1. 控制台输出统计对象。例如 items=20、mounted=5 表示已加载 20 条记录，其中 5 行已挂载；实际值随窗口与预加载配置变化。

### 14.5 floors.destroy — 卸载楼层列表

#### 14.5.1 用途

1. 撤下整份自定义历史列表，结束滚动监听和楼层脚本，清空其容器，供页面切换展示内容。

#### 14.5.2 数据与存储

1. 销毁前端列表；后端消息、变量记录和角色版本资产保留。

#### 14.5.3 调用签名

1. ```typescript
   floors.destroy(): void;
   ```

#### 14.5.4 输入参数

1. 无参数。

#### 14.5.5 输出结果

1. 返回 void。

#### 14.5.6 回调与时序

1. 同步解除监听、卸载楼层并清空容器；重复调用直接结束。已销毁列表的加载与窗口方法直接结束；需要恢复列表时重新调用 mountFloors。

#### 14.5.7 使用示例

1. ```javascript
   // floors 从第 14.1 节“句柄的完整取得与调用示例”获得。
   floors.destroy();
   ```

#### 14.5.8 示例结果

1. 列表容器清空，相关前端资源释放，后端历史保留。

## 15. 生命周期与错误

1. Runtime 绑定会话上下文。切换角色、会话或分支时，系统完整导航并初始化对应实例；同页历史查看使用 history API。角色自行创建的普通 JavaScript 数据由作者管理，API 登记资源由 Runtime 管理。

1. | code                        | 情况                                  | 作者可采取的动作                                                       |
   | --------------------------- | ------------------------------------- | ---------------------------------------------------------------------- |
   | INVALID_REQUEST             | 参数类型、scope、筛选或回调不合法     | 按方法签名修正                                                         |
   | UI_REGISTRATION_INVALID     | 布局 ID、选择器、元素或容器不符合要求 | 核对角色 HTML 与注册声明                                               |
   | UI_UPDATE_INVALID           | 元素更新属性不符合 kind               | 核对 patch 与元素类型                                                  |
   | ASSET_NOT_FOUND             | 资源不存在或类型不匹配                | 使用 assets.list 检查声明                                              |
   | DATA_NOT_FOUND              | 交付数据键缺失或 key 类型错误         | 核对角色 data 和系统交付                                               |
   | CHAT_ALREADY_MOUNTED        | 已有系统聊天组件                      | 复用现有组件或先 destroy                                               |
   | AUDIO_FAILED                | 浏览器播放失败                        | 显示失败，提供用户触发的播放操作                                       |
   | SEND_BUSY                   | 当前正在发送                          | 等待当前调用结束                                                       |
   | ROLE_STATE_UPDATE_FAILED    | 正文后变量更新失败                    | 显示错误，使用系统变量重试入口                                         |
   | ROLE_FLOOR_NOT_FOUND        | 当前会话中不存在该楼层                | 从当前会话历史列表重新选择                                             |
   | ROLE_HISTORY_CURSOR_INVALID | 游标不适用于当前查询                  | 使用相同会话、分支和列表方法重新读取第一页                             |
   | ROLE_HISTORY_LIMIT_INVALID  | 每页数量超出配置范围                  | 按[第 6.2 节](#62-apimessageslistfloors--分页列出对话)的范围调整 limit |
   | ROLE_SNAPSHOT_NOT_FOUND     | 指定历史记录不存在                    | 重新选择现有记录                                                       |
   | IDENTITY_MISMATCH           | 请求和记录身份不一致                  | 从当前会话历史重新选择                                                 |
   | RESULT_UNKNOWN              | 结果接收或关联无法确认                | 刷新当前会话页面，核对最新消息和变量状态                               |
   | FLOOR_VIEW_DISPOSED         | 调用所属视图已释放                    | 结束该视图的后续更新                                                   |

1. 通过角色 api 发起的异步操作在所属视图释放时拒绝 FLOOR_VIEW_DISPOSED。FloorListHandle 已销毁后的调用行为见第 14 章。Runtime 收集受管回调的同步异常和返回 Promise 的拒绝；需要页面反馈时，作者在回调内部或调用处使用 try/catch 更新提示元素。角色前端可显示本章错误码对应的系统 message；其他错误码的底层 message 仅用于诊断，页面根据受影响操作显示重试或核对状态的提示。

## 16. 角色脚本与后端计算的边界

1. 角色脚本通过本文的 api 方法读取变量、发送演绎输入、请求变量重算或初值补全并观察结果。后端变量计算与世界书文本生成使用角色包中的后端模块。

1. 角色包中的后端模块使用单独的 `derive(context)` 与 `validate(context)` 导出函数，由后端调用；签名、上下文及提示词控制器见[角色卡后端 API](backend-api.md)。

## 17. 角色入口示例

1. 以下 HTML 和 JavaScript 配合使用。示例卡的 variables.location 为字符串；错误通过反馈元素显示。参数错误按第15章修正调用参数；视图已释放时结束该视图的操作。

1. ```html
   <div id="location"></div>
   <button id="prepare">填写行动</button>
   <button id="latest">返回最新</button>
   <p id="feedback" role="status"></p>
   <div id="chat"></div>
   ```

1. ```javascript
   export function mount({ api }) {
     const panel = api.ui.register("panel", {
       elements: {
         location: { selector: "#location", kind: "text" },
         prepare: { selector: "#prepare", kind: "control" },
         latest: { selector: "#latest", kind: "control" },
         feedback: { selector: "#feedback", kind: "text" },
         chat: { selector: "#chat", kind: "container" },
       },
     });
     panel.bind("view", (record) => ({
       location: { text: String(record.variables.location) },
     }));
     const showError = (error) => {
       console.error(error.code, error.message);
       panel.update({
         feedback: { text: "操作未完成，请检查当前输入和会话状态。" },
       });
     };
     panel.on("prepare", "click", async () => {
       try {
         await api.chat.setDraft("沿着码头继续向前走。");
       } catch (error) {
         showError(error);
       }
     });
     panel.on("latest", "click", async () => {
       try {
         await api.history.latest();
       } catch (error) {
         showError(error);
       }
     });
     api.widgets.mountChat(panel, "chat");
   }
   ```

1. 可见结果：状态栏显示地点；点击“填写行动”后系统输入框出现文字；用户发送时输入立即显示，回复与变量由系统交付；点击“返回最新”时，地点显示会话最新状态。
