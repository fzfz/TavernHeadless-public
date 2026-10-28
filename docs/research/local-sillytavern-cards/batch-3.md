# 本地角色卡调研：第 3 组

本组完成 38 张卡的 JSON 结构盘点，并深入阅读 8 张机制不同的卡。原始资料来自 `/srv/data/mac bookpro old/AI/SillyTavern`；逐卡原 PNG、缓存路径、mtime 与提取副本均见 [结构结果](batch-3-results.json)。缓存中的 `chara_card_v3` 只能说明本次缓存形态，不能证明原 PNG 的初始制作规格。

## 逐卡结构盘点

世界书列写总数/启用数；正则、助手脚本和任务列写实际数组长度。EJS、浏览器代码及发送调用列来自字段原文的字面检索，只用于定位进一步阅读的对象。空扩展不计为已实现功能。每张卡均可通过 ID 对应结构结果中的绝对本地路径与 JSON pointer。

| ID   | 卡名                     | 世界书  | 正则 | 助手脚本 | 任务 | 字面机制                            |
| ---- | ------------------------ | ------- | ---- | -------- | ---- | ----------------------------------- |
| C003 | Ava Kensington           | 0/0     | 0    | 0        | 0    | 未见所列标记                        |
| C006 | IVORY\_七色光\_v1.6.51   | 41/27   | 9    | 2        | 0    | EJS、MVU、浏览器代码                |
| C009 | 《Lost Good Things》     | 113/105 | 0    | 0        | 0    | 未见所列标记                        |
| C012 | 七色光\_AMBER_v1.6.39    | 45/27   | 9    | 2        | 0    | EJS、MVU、浏览器代码                |
| C015 | 七色光v1.5(魔改)         | 43/27   | 7    | 2        | 0    | EJS、MVU、浏览器代码、发送/生成调用 |
| C018 | 人妻公寓                 | 13/8    | 5    | 2        | 0    | 浏览器代码                          |
| C021 | 共妻法案                 | 8/8     | 1    | 0        | 0    | 浏览器代码                          |
| C024 | 双面恋人v1.0             | 12/12   | 0    | 0        | 0    | 未见所列标记                        |
| C027 | 城破十日记               | 43/43   | 7    | 2        | 0    | MVU、浏览器代码、发送/生成调用      |
| C030 | 备胎女友1.1              | 36/35   | 6    | 2        | 0    | MVU、浏览器代码                     |
| C033 | 妻心如刀-林茜            | 0/0     | 0    | 0        | 0    | 未见所列标记                        |
| C036 | 完蛋我被熟女包围了！     | 19/19   | 0    | 0        | 0    | 未见所列标记                        |
| C039 | 成人博主模拟器           | 46/45   | 0    | 0        | 0    | 未见所列标记                        |
| C042 | 我的姐姐李玉青           | 13/13   | 0    | 0        | 0    | 未见所列标记                        |
| C045 | 扬州一梦                 | 41/41   | 4    | 2        | 0    | MVU、浏览器代码                     |
| C048 | 扬州一梦1.6.1            | 109/84  | 9    | 2        | 0    | EJS、MVU、浏览器代码、发送/生成调用 |
| C051 | 抽卡江湖·二改            | 43/35   | 7    | 2        | 0    | MVU、浏览器代码                     |
| C054 | 教坊司                   | 69/28   | 7    | 3        | 0    | EJS、MVU、浏览器代码                |
| C057 | 教堂拆除计划 1.5         | 17/15   | 2    | 0        | 0    | 未见所列标记                        |
| C060 | 早川凛音                 | 3/3     | 0    | 0        | 0    | 未见所列标记                        |
| C063 | 极乐庄混浴物语           | 14/13   | 1    | 0        | 0    | 浏览器代码                          |
| C066 | 林茜                     | 45/44   | 1    | 0        | 0    | 浏览器代码                          |
| C069 | 林茜\_妻心如刀\_v1.3.32  | 138/49  | 8    | 2        | 0    | EJS、MVU、浏览器代码、发送/生成调用 |
| C072 | 楚昭昭                   | 5/5     | 0    | 0        | 0    | 未见所列标记                        |
| C075 | 沈听雪｜盛唐清音         | 33/32   | 4    | 2        | 0    | EJS、MVU、浏览器代码                |
| C078 | 爱如雨止                 | 18/18   | 0    | 0        | 0    | 未见所列标记                        |
| C081 | 百合露出1.1              | 17/16   | 10   | 2        | 0    | MVU、浏览器代码、发送/生成调用      |
| C084 | 真爱背后                 | 70/54   | 6    | 2        | 0    | EJS、MVU、浏览器代码                |
| C087 | 穗并町                   | 15/11   | 1    | 2        | 0    | MVU、浏览器代码                     |
| C090 | 结婚后，前女友找上门来了 | 19/19   | 0    | 0        | 0    | 未见所列标记                        |
| C093 | 群友们                   | 7/7     | 4    | 0        | 0    | 未见所列标记                        |
| C096 | 萧曦月                   | 31/31   | 0    | 0        | 0    | 未见所列标记                        |
| C099 | 蚌埠夜话-梁文峰版        | 19/16   | 3    | 0        | 3    | 浏览器代码、发送/生成调用           |
| C102 | 调教老婆王予璇           | 23/19   | 6    | 2        | 0    | EJS、MVU、浏览器代码                |
| C105 | 遠坂家ノ家計事情         | 26/26   | 18   | 0        | 0    | 未见所列标记                        |
| C108 | 陈乖乖                   | 4/4     | 0    | 0        | 0    | 未见所列标记                        |
| C111 | 顾声慢                   | 21/17   | 8    | 3        | 0    | EJS、MVU、浏览器代码、发送/生成调用 |
| C114 | 林茜\_妻心如刀\_v1.3.31  | 133/49  | 8    | 2        | 0    | EJS、MVU、浏览器代码、发送/生成调用 |

## 深读样本与调用证据

本节的 pointer 均指向 `.tmp/local-card-research/<ID>.json`。正文引用的函数来自卡内原文；“预期时机”表示代码注册的事件或调用位置，实际执行仍取决于宿主扩展。所有远程 import、图片、音频和字体仅记录引用，均未请求。

### C015：开局初始化、数值约束与展示解锁

[本地副本](../../../.tmp/local-card-research/C015.json) 的 `/data/extensions/regex_scripts/6/replaceString` 定义 `startOpening(id)`。用户选择开局后，函数读取 `openingData[id]`，把 `outline` 和 `initVar` 序列化为 `<UpdateVariable><initvar>…`，通过 `triggerSlash('/send ' + content + '|/trigger')` 发送并请求主回复。因此，初始化既有前端构造的数据，也有后续 MVU 对标签的处理依赖。

`/data/character_book/entries/15` 名为 `[initvar]变量初始化勿开`，实际 `enabled=false`；该条不能直接当作常驻提示词。`/data/extensions/tavern_helper/scripts/0/content` 在 DOM ready 时调用 `registerMvuSchema(Schema)`，为数值定义 `z.coerce.number()`、`_.clamp` 和 `prefault`。脚本 1 仅 import 远程 MVU beta，卡内没有其初始化解释器实现。

`/data/extensions/regex_scripts/5/replaceString` 在 `Mvu.events.VARIABLE_UPDATE_ENDED` 后调用 `populateCharacterData()`。其中作弊按钮只切换当前页面的 `cheatFlags[type]` 并重绘，已读点击处理函数没有写入剧情变量。迁移时应分别保留开局状态、持久状态和局部展示状态，不能把“解锁”按钮名称解释为服务端状态写入。

### C027：表单生成 JSON Patch 初始化请求

[本地副本](../../../.tmp/local-card-research/C027.json) 的 `/data/extensions/regex_scripts/1` 至 `/5` 把五种 `<start_panel_N>` 标签替换成 HTML 开局界面。`/1/replaceString` 的按钮处理构造 `patches`，通过 `JSON.stringify(patches)` 序列化变更，并将其放入 `<JSONPatch>` 标签。按钮处理函数把这段标签文本加入发给模型的初始化提示，要求模型在回复末尾输出该初始化内容，最后调用 `triggerSlash(prompt)`；`prompt` 含 `/send …|/trigger`。这是“前端提出初始化内容—模型复述更新—MVU处理”的链路，卡内没有直接提交该 patch 的调用。

`/data/extensions/tavern_helper/scripts/1/content` 的 Zod schema 对生命、体力等数值 clamp，并通过 `_.pickBy(data, ({数量}) => 数量 > 0)` 清除数量不大于零的行囊记录。该行为超出 JSON Schema 的结构验证；需要派生或规范化函数才能保留。`/data/extensions/regex_scripts/6/replaceString` 监听变量更新事件刷新状态栏。动态行囊和 NPC 对象是实际结构需求，迁移时应核对新增键与删除键的提交能力。

### C048：EJS 选择知识、开局切换与历史变量修改

[本地副本](../../../.tmp/local-card-research/C048.json) 的 `/data/character_book/entries/9/content` 以 `@@preprocessing` 开头，读取 `getvar(...)` 和 `getChatMessages()`，只有历史长度大于一才进入剧情条件分支；分支根据地点、任务存在性、声望及 `Math.random() < 0.5` 调用 `await getwi(...)`。`/entries/41/content` 则按好感度 `<=40`、`<=80` 与更高值选择三个阶段知识。随机选择发生在模板求值过程，不是世界书 `probability` 字段。

`/data/extensions/regex_scripts/0/replaceString` 的开局界面调用 `setChatMessages([{message_id:0, swipe_id:index+1}], {refresh:'all'})`；`/1/replaceString` 的自定义表单调用 `/send …|/trigger`。这两种开局动作分别修改零号消息选项和创建新用户输入。

`/data/extensions/regex_scripts/8/replaceString` 的 `removeMvuItem(path, successMsg)` 从最新消息倒序读取 `Mvu.getMvuData({type:'message', message_id:i})`，执行 `_.unset` 后逐层 `Mvu.replaceMvuData`，连续 30 层没有目标键才停止。删除人物、物品、情报、账目和任务的按钮都会调用此函数。它会改写多个历史消息的状态快照，迁移不能仅接成当前状态的 remove。`cm_manager` 在 `/data/extensions/cm_manager` 仅为 `{}`，本卡没有提供该扩展的执行机制证据。

### C054：收到回复后修改保存消息

[本地副本](../../../.tmp/local-card-research/C054.json) 的 `/data/extensions/tavern_helper/scripts/1/content` 是单行压缩但直接可读的脚本，本次只阅读原文。它在 DOM ready 注册 `tavern_events.MESSAGE_RECEIVED`，读取 `getChatMessages(n)`，只处理 assistant 消息；原文逻辑修正 `<thinking>` 与 `<content>` 的位置和数量，并移除 thinking 范围内的变量标签。发生变化时，它调用 `setChatMessages([{message_id:n,message:t}], {refresh:'affected'})`。

这不是单纯正则显示替换，而是消息接收后的正文改写。`/data/extensions/regex_scripts/6/replaceString` 又在 MVU 更新后刷新状态栏。正文改写与变量解析的实际先后取决于扩展事件调度，本次没有运行验证。`/data/extensions/xiaobaix-tasks/tasks` 是空数组，不能从扩展名推断该卡存在辅助模型任务。

### C069：从历史恢复选项并分开处理发送与生成

[本地副本](../../../.tmp/local-card-research/C069.json) 的 `/data/extensions/regex_scripts/5/replaceString` 提供 `optionMessageHistory`、`currentOptionValues`、`mergeOptionEvidence`、`renderInlineOptions`。它读取至当前楼层的 assistant 历史，校验消息 ID 顺序、首条完整选项及后续证据，再生成按钮。按钮只有在 `getCurrentMessageId() === getLastMessageId()` 时可用。

点击后，`createOptionUserMessage` 先调用 `createChatMessages([{role:'user',message:text}], {refresh:'affected'})`；成功后禁用全部选项，再由 `triggerOptionReply` 调用 `/trigger`。写消息失败会解锁当前按钮，生成失败只展示另一类反馈。该卡明确区分“用户输入已保存”和“模型回复已开始”，前端 API 应保留这种可观察结果。变量 schema 与 MVU beta 分别位于 `/data/extensions/tavern_helper/scripts/0/content`、`/1/content`；后者只有远程 import。

### C081：社交界面的动作并非全部持久化

[本地副本](../../../.tmp/local-card-research/C081.json) 的 `/data/extensions/regex_scripts/6/replaceString` 实现发布、评论和点赞界面。`handleCommentSubmit()` 先调用 `displayComment` 修改当前 DOM，再用 `/send …|/trigger` 发送评论；发布处理把输入转成 `<朋友圈>` 格式后发送同类命令。`toggleLike()` 只修改 DOM 内点赞名单、图标和声音，已读函数没有持久化写入或生成调用。

因此，发布和评论产生新一轮对话，而点赞是当前页面交互。直接把界面上全部变化同步为角色状态会增加原卡没有展示的行为。`/data/extensions/regex_scripts/0/replaceString` 的状态栏监听 `Mvu.events.VARIABLE_UPDATE_ENDED`。音效来自外部 URL，其可访问性和加载结果未核对。

### C099：周期性辅助生成与世界书写回

[本地副本](../../../.tmp/local-card-research/C099.json) 的 `/data/extensions/xiaobaix-tasks/tasks/0` 名为 RUBY分析，配置为 `disabled=false`、`floorType='llm'`、`interval=1`、`triggerTiming='after_ai'`。注释声称依靠操作面板和周期计数；可见函数给出了更具体的执行链。

`/tasks/0/commands` 中，外部触发进入 `ensureSelfDriveDaemon()`；它建立 `MutationObserver` 监听聊天 DOM，等待默认 1200 毫秒静默，并在没有运行锁、流式任务空闲、出现更新的 AI 消息 ID 时调用 `/xbqte RUBY分析`。它也监听 `xiaobaix_streaming_completed`。代码读取宿主聊天上下文的语句属于卡内功能证据，本次调研没有读取实际聊天文件。

`callAI(taskType,prompt)` 组装 `/xbgenraw` 并调用 `STscript`，流式分支等待 `waitForStream`，非流式分支通过 `extractText` 取正文。代码自行编码传输参数；本次没有执行编码、解码或该命令。任务循环逐项 `await callAI(...)`，生成结果经 `/createentry` 和 `/setentryfield` 写入会话世界书，设置 constant、disable、位置、深度及递归属性；`disableCharEntry()` 关闭角色世界书同名条目，`outputValues` 保留结果供后续任务引用，末尾尝试 `saveWorldInfo`。

`/tasks/0/x/RubyAnalyzer/presets/0/tasks` 有两个启用任务，二者 `cyclePositions=[10]`，输出为两个关系分析条目，`position=4`、`depth=4`、`order=100/101`。这证明配置支持一个周期点顺序执行两个额外模型任务并将结果用于后续提示。真实是否调用成功、计数是否准确以及写回是否持久化，仍需宿主运行验证。`tasks/1` 和 `tasks/2` 为按钮激活的面板与格式修复任务，不能与每轮自动生成混计。

### C111：完整消息播放器与生成事件生命周期

[本地副本](../../../.tmp/local-card-research/C111.json) 的 `/data/extensions/tavern_helper/scripts/2/content` 包含完整 GAL 播放器。`parseScript` 解析对白与命令，`processNextScene` 推进场景，`processCommand` 处理背景、角色、CG、音乐和等待；`performSkip` 跳过到选项时停止。`renderChoices` 根据当前消息 MVU 状态和正文中的事件标记添加、删除或锁定选项，点击后依次执行 `/send` 与 `/trigger`。

`setupEventListeners` 监听 `CHARACTER_MESSAGE_RENDERED`、`MESSAGE_UPDATED`、`MESSAGE_DELETED`、`CHAT_CHANGED`、`STREAM_TOKEN_RECEIVED`、`MESSAGE_RECEIVED`、`GENERATION_ENDED` 与 `GENERATION_STOPPED`。变量初始化和更新事件刷新状态面板，聊天切换清除消息播放器状态并停止音频。`saveCGUnlockRecord` 和显示设置通过 `updateVariablesWith(...,{type:'global'})` 保存 CG 解锁、字体大小、角色缩放及音量；这些数据并非剧情 `stat_data`。

`/data/extensions/regex_scripts/5` 在显示侧去除 `<gametext>`，真正可见内容依赖助手脚本播放器。仅保留这条正则而丢失播放器会丢失正文显示。`/data/character_book/entries/0` 是关闭的初始化条目，其创作完成度为 0，而 schema 默认值为 10；二者的实际优先级需要 MVU 初始化实现与运行记录判断。

## 宿主资源与非空字段的解释边界

C030 的 `/data/character_book/entries/*/extensions/group` 有 26 个非空值，26 个值各自唯一；`group_weight=100`，未发现同组多成员竞争。它们的命名像角色与章节分类，但作者意图没有额外说明。当前证据只能证明保存了分组字符串，不能据此要求随机抽选或断言作者误用了目录功能。

[绑定世界书索引](linked-worlds.json) 指向原宿主文件。本组另外核对了 C018 与 C105 的差异：C018 卡内 13 条正文全部存在于 `data/default-user/worlds/人妻公寓.json`，绑定文件另有 7 条 `TavernDB-ACU-*` 导出条目，包含纪要包装、纪要索引和可读数据表。它们反映宿主的记忆导出状态，不能作为卡初始设定自动合入。C105 内嵌 26 条而绑定的 `data/default-user/worlds/_________________遠坂家ノ家計事情.json` 有 24 条；差异是内嵌 `/data/character_book/entries/21` 与 `/22` 的两个空正文条目，其余正文对应。条目数差异因此不等于丢失两段知识。本次只比较 JSON 条目内容与字段，未把其中 Markdown 表格解析为结构化业务数据。

## 对 API、卡格式与 Agent 扩展的研究建议

以下是样本导出的能力需求，尚不是实施计划。当前项目能力依据 [API 核对记录](../character-card-compatibility/api-findings.md)，本组未重复审计生产源码。

| 方向                 | 本地证据                             | 建议保留的明确语义                                                                                                                                    |
| -------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 卡格式保存           | C015 初始化、C111 播放器、C099任务   | 分别描述初始化数据、状态结构及派生函数、显示模板、事件脚本、辅助任务与远程资源；未知扩展保留原始字段并报告运行依赖。                                  |
| 状态提交 API         | C027 动态行囊、C048历史删除          | 核对动态键插入删除与多个消息状态版本的修改范围；状态动作应返回实际影响的消息与路径。当前精确 writablePaths 的 set/remove 不能直接证明等价。           |
| 前端消息与生成       | C069发送后单独触发、C048切换开场     | 分别表达创建输入、请求生成、切换开场与编辑消息，给出保存成功和生成失败的独立结果。现有角色前端的发送入口不能据此推定已有全部编辑能力。                |
| 控制器与随机选择     | C048 EJS/getwi/Math.random           | 请求组装记录应保留输入状态、知识引用、随机选择结果与求值时机，供同一轮重放比较；随机模板选择和世界书分组选择应分别建模。                              |
| 辅助 Agent           | C099周期任务                         | 复用已有 Agent 编排与模型调用记录，表达主回复后触发、周期位置、顺序依赖、输出世界书位置及持久化结果。任务内容是语义关系分析，不能替换成字面匹配脚本。 |
| 客户端生命周期       | C111流式播放与C054接收后改写         | 明确原始回复、保存正文、解析状态、显示内容和生成完成事件的顺序；保留消息删除、切换与停止时的清理动作。                                                |
| 变量作用域           | C015展示标记、C081点赞、C111全局设置 | 分别保存页面临时数据、全局偏好和消息剧情状态，避免把所有 UI 变化写成剧情事实。                                                                        |
| 作者声明与可运行能力 | 多张卡的远程 MVU import              | 记录声明、内嵌实现、外部依赖三个证据层；导入成功、字段保存与端到端功能通过应分别报告。                                                                |

## 证据范围与待验证项

本组完成确定性 JSON 字段盘点和八张卡的机制阅读；其余卡的机制标记仅代表字符串出现，不能代替语义验收。清单初始 `signals.timed` 等粗计数没有用于判断实际定时器，因为字段名和普通文本也可能命中。

本次没有运行卡脚本、扩展、真实模型或网络请求，没有解码 base64 或混淆内容，也没有读取聊天文件和 secrets。远程 MVU、Zod 辅助库及资源的内容和版本没有展开核对。初始化、消息改写、变量解析和显示事件之间的实际顺序，以及多轮生成的预算、失败恢复与持久化效果，仍属于运行验收问题。所有“可见逻辑”结论只覆盖本次缓存副本与明确列出的本地绑定世界书。
