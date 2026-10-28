# 公开角色卡中的脚本、变量与交互样本

本报告记录 2026-09-28 实际阅读的六张公开角色卡，来自四位仓库作者。六份成品 JSON 都声明 `chara_card_v3`。研究者通过 GitHub 和 raw 源文件读取 JSON、TypeScript、JavaScript、HTML 与世界书正文，使用本机标准库提取字段，逐段阅读相关逻辑；本次运行范围仅含读取与报告写入。转换方向属于源码分析所得的候选方案，运行效果仍待隔离环境验证。

## 样本及来源

S1—S6 的链接固定到本次查询到的仓库提交。正文最初通过对应默认分支读取，随后记录 HEAD；本次未逐文件比较读取期间的分支变动。

| 编号 | 实际卡与作者                         | 成品源文件                                                                                                                                               | 直接确认的组成                                                                                          |
| ---- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| S1   | 黑桃宫，yjlovegy                     | [黑桃宫.json](https://github.com/yjlovegy/heitaogong-card/blob/2e5fa8ca60f4d29eb0a374d13806d9e1faee863d/cards/黑桃宫/黑桃宫.json)                        | 10 个世界书条目，MVU 与 Zod 角色脚本，显示与提示词分别生效的正则。                                      |
| S2   | 心愿社，yjlovegy                     | [心愿社.json](https://github.com/yjlovegy/xinyuanshe-card/blob/85da3df036e0720a6d76e58047c24e35be66964a/cards/心愿社/心愿社.json)                        | 6 个世界书条目，任务、论坛、商城变量，MVU 与 Zod 角色脚本。                                             |
| S3   | 梅卿／卡内名梅绛雪，kilng235         | [梅卿.json](https://github.com/kilng235/baishezhuan-rolecard/blob/e538e0d0d2411a9352823f880f589b387ea4045b/cards/梅卿/梅卿.json)                         | 15 个世界书条目，两个开场，两个开场各含初始化变量。                                                     |
| S4   | 白蛇传，kilng235                     | [白蛇传.json](https://github.com/kilng235/baishezhuan-rolecard/blob/e538e0d0d2411a9352823f880f589b387ea4045b/cards/白蛇传/白蛇传.json)                   | 22 个世界书条目，双角色变量，MVU 与 Zod 角色脚本，状态栏替换正则。                                      |
| S5   | 毒师宇宙·沙盒 [SAUL-OS]，ddsadasfdxc | [角色卡 JSON](https://github.com/ddsadasfdxc/heisenberg-sandbox/blob/b8f668db8966b96d9da8d7985f719fb3b23bbe60/card/毒师宇宙_沙盒_SAUL-OS_MVU角色卡.json) | 建号开场标记，内嵌向导，`tavern_helper`、`mvu`、`cot_increment`、`regex_scripts`、`frontend` 扩展字段。 |
| S6   | 官场模拟器，sage1717                 | [dist/card.json](https://github.com/sage1717/guanchang-simulator/blob/2db53134c67402810ab53ba1269599aa24c056c6/dist/card.json)                           | 42 个世界书条目，MVU、变量验证、人物世界书自动同步三个角色脚本。                                        |

上述六项均有实际成品卡 JSON。另行读到的 [StageDog 状态栏 App.vue](https://github.com/StageDog/tavern_helper_template/blob/main/示例/角色卡示例/界面/状态栏/App.vue) 属于库的角色卡示例：它通过组件展示人物和物品，并用 `useLocalStorage` 保存页签选择。本报告将其作为模板对照，实际卡数量仅按 S1—S6 计算。

## S1：EJS 世界书与前端结算共同驱动叙事

实际机制：世界书的阶段条目含 `@@private` 和 EJS，使用 `getvar('stat_data.赌局.阶段', …)`、玩法变量与条件分支，分别输出空闲、待开局、进行中、待续写的提示。卡内该条目的扩展指定 `position: 4`、`depth: 0`、`role: 0`，并设置递归控制字段。[阶段条目](https://github.com/yjlovegy/heitaogong-card/blob/2e5fa8ca60f4d29eb0a374d13806d9e1faee863d/cards/黑桃宫/世界书/阶段指导/赌局阶段指导.txt)、[成品卡](https://github.com/yjlovegy/heitaogong-card/blob/2e5fa8ca60f4d29eb0a374d13806d9e1faee863d/cards/黑桃宫/黑桃宫.json)。

功能诉求：玩家在界面操作五种玩法，程序先确定结果并写账本，模型接续现场叙述。`useGameActions.ts` 使用 `Schema.parse` 校验快照，向指定消息楼层写入 `stat_data`，随后通过 `createChatMessages` 添加结算消息，再调用 `triggerSlash('/trigger')`。代码还区分历史楼层与当前楼层，并记录结算和回传标志。[交互源码](https://github.com/yjlovegy/heitaogong-card/blob/2e5fa8ca60f4d29eb0a374d13806d9e1faee863d/src/黑桃宫/界面/状态栏/composables/useGameActions.ts)。

转换方向：可分别研究阶段条件模板、权威结算动作和生成触发桥接。候选验收需要覆盖结算只记一次、回传失败后的重试和历史楼层操作。EJS 的执行时机、`@@private` 的宿主含义以及外部 MVU 模块行为仍待验证。

## S2：状态栏承担任务平台业务

实际机制：卡内 Zod 脚本包含 `z.record`、`z.discriminatedUnion`、`z.coerce.number`、`.transform` 与集合裁剪。任务大厅会保留已参与任务，同时限制其他任务数量；这些转换包含可执行计算语义。[成品卡内 Zod 脚本](https://github.com/yjlovegy/xinyuanshe-card/blob/85da3df036e0720a6d76e58047c24e35be66964a/cards/心愿社/心愿社.json)。

功能诉求：玩家接任务、发帖、私聊、购物和提交证明。`acceptTask` 检查重复接取、本人发布、人数与未结束任务上限，随后以任务 ID 在 `心愿社.我接取的` 新建对象，并初始化其中的 `互动人物` 和 `私聊` 字典；通知和操作日志也以新 ID 增添记录。`narrative` 创建用户消息并触发生成；其他操作可直接修改界面状态。[动作源码](https://github.com/yjlovegy/xinyuanshe-card/blob/85da3df036e0720a6d76e58047c24e35be66964a/src/心愿社/界面/状态栏/composables/useAppActions.ts)。

状态绑定采用 `defineMvuDataStore`，消息 ID 来自界面挂载楼层；最新楼层利用 `sessionStorage` 标记清理待处理日志。[store.ts](https://github.com/yjlovegy/xinyuanshe-card/blob/85da3df036e0720a6d76e58047c24e35be66964a/src/心愿社/界面/状态栏/store.ts)。转换方向是保留明确的业务动作、状态作用域和日志消费时机。Zod 转为声明式 schema 时，转换函数与保留规则需要另行表达；仅保存字段类型不足以复现这些行为。数据存储工具内部的监听与持久化时序尚未验证。

## S3：开场选择同时选择初始状态

实际机制：`first_mes` 和一个 `alternate_greetings` 各包含 `<UpdateVariable><initvar>` 区段。两个区段分别把 `系统变量.时空切片` 设置为古代和现代，并设置不同日期、时间段及当前位置。卡内另有禁用的 `[InitVar]` 世界书条目、注册 Zod schema 的脚本，以及区分 `promptOnly` 和 `markdownOnly` 的变量、状态栏正则。[成品卡](https://github.com/kilng235/baishezhuan-rolecard/blob/e538e0d0d2411a9352823f880f589b387ea4045b/cards/梅卿/梅卿.json)。

功能诉求：玩家切换开场时进入相应时空与初始状态。转换方向是把开场文本、初始化覆盖值和选中开场的关系一起保存。初始化标签的实际执行者、禁用初值条目与开场初值的覆盖顺序、开场切换后的重置范围仍待运行验证。

## S4：双角色状态显示与变量更新事件

实际机制：Zod 脚本定义两名角色的嵌套状态，好感度通过数值强制转换和范围限制处理。正则把 `<StatusPlaceHolderImpl/>` 替换为 HTML，并另外从提示词通道隐藏标记。HTML 读取 `stat_data`，渲染时间、天气、双角色位置与状态；初始化等待 `Mvu`，随后监听 `Mvu.events.VARIABLE_UPDATE_ENDED` 重新填充界面。[成品卡](https://github.com/kilng235/baishezhuan-rolecard/blob/e538e0d0d2411a9352823f880f589b387ea4045b/cards/白蛇传/白蛇传.json)、[状态栏 HTML](https://github.com/kilng235/baishezhuan-rolecard/blob/e538e0d0d2411a9352823f880f589b387ea4045b/cards/白蛇传/正则/状态栏界面.html)。

功能诉求：同一条回复显示可切换的双角色面板，并随变量更新刷新。转换方向是结构化状态视图加变量事件订阅；保留原 HTML 则还需验证 jQuery、Lodash、全局 API 和消息作用域。源码中的当前取值路径能否始终展示所属历史楼层，需要实际会话检验。

## S5：建号向导直接操作宿主页面

实际机制：开场使用 `<SAUL建号/>`，显示正则替换为内嵌界面。角色脚本寻找父窗口，使用 jQuery、`#chat`、`send_textarea` 与 `send_but`，收集身份、姓名等字段后拼接配置文本并触发发送。名为 MVU 的脚本引用 `Mag-Mixtape/toolkit@main/vars/module.mjs`；S1—S4 引用的是 `MagicalAstrogy/MagVarUpdate/artifact/bundle.js`。[SAUL-OS 成品卡](https://github.com/ddsadasfdxc/heisenberg-sandbox/blob/b8f668db8966b96d9da8d7985f719fb3b23bbe60/card/毒师宇宙_沙盒_SAUL-OS_MVU角色卡.json)、[S1 成品卡](https://github.com/yjlovegy/heitaogong-card/blob/2e5fa8ca60f4d29eb0a374d13806d9e1faee863d/cards/黑桃宫/黑桃宫.json)。

功能诉求：玩家通过表单建立初始身份，再把配置提交给模型。转换方向是独立开场表单和明确的提交动作。向导源码与配置解析正则之间的换行、字段顺序及逐项覆盖需要配对验证；DOM 名称依赖也需要单独适配。脚本注释提及的变量标签解析能力属于作者声明，本次证据仅确认模块引用与调用代码。

## S6：变量变化反向更新世界书

实际机制：`npc_lorebook_autosync.js` 等待 MVU，订阅 `SINGLE_VARIABLE_UPDATED`，经过 800 毫秒防抖读取聊天作用域的 `stat_data.人物库`。脚本调用 `getChatLorebook`、`getLorebookEntries`，选择已有的人物条目，按姓名构建新正文，仅对正文有变化的条目调用 `setLorebookEntries`。[同步源码](https://github.com/sage1717/guanchang-simulator/blob/2db53134c67402810ab53ba1269599aa24c056c6/source/scripts/npc_lorebook_autosync.js)。

功能诉求：人物当前资料随状态变化进入后续提示词。转换方向是把该同步过程作为状态更新后的独立动作，并定义它修改的聊天世界书范围。分支切换、重试、消息重放与世界书写入之间的一致性仍待验证。成品使用 V3 包装；仓库的 `source/card.json` 是拆分的基础字段文件，统计成品能力时需要配合 `dist/card.json`。[基础文件](https://github.com/sage1717/guanchang-simulator/blob/2db53134c67402810ab53ba1269599aa24c056c6/source/card.json)、[成品卡](https://github.com/sage1717/guanchang-simulator/blob/2db53134c67402810ab53ba1269599aa24c056c6/dist/card.json)。

## 样本对转换范围的启示

| 待区分的能力           | 样本证据                                       | 后续验证对象                               |
| ---------------------- | ---------------------------------------------- | ------------------------------------------ |
| 数据格式与脚本协议     | 六卡都使用 V3，S5 与 S1—S4 的 MVU 模块引用不同 | 按实际模块、标签和 API 调用确定转换边界。  |
| 显示与提示词处理       | S3、S4 同时使用显示正则和提示词正则            | 分别比较页面正文、保存正文和实际模型请求。 |
| 声明式约束与执行式变换 | S2 的 Zod 同时包含类型约束、计算和集合裁剪     | 分别验证输入校验与更新后的最终状态。       |
| 状态显示与业务操作     | S4 监听刷新；S1、S2 还修改状态并触发生成       | 分别验证只读面板、写入动作和生成事件。     |
| 初始状态与持续状态     | S3 开场初始化；S6 持续同步世界书               | 分别验证新建、切换开场、分支与重放。       |

这些结论仅覆盖上述公开源码样本。六卡分布于五个仓库、四位作者，且 S1—S4 共享部分工具链，因此该集合可以证明机制确实存在，不能推算整个角色卡生态的使用比例。本次已确认 Zod `transform`，`refine`／`superRefine` 的实际卡用例仍待调研；本次没有得到 V2 成品的同等脚本样本，也没有验证任一候选方向在目标系统中的实现状态。

## 追加查询：V2 成品 JSON 的证据缺口

2026-09-28 的有界追加查询继续以作者仓库中的可直接读取 JSON 为目标。查询结果仍未补足可以明确计入 `chara_card_v2` 的实际成品。以下候选已经阅读或检查文件列表，其结论仅限所列文件。这组追加来源使用 main/master 可变分支链接，尚未固定到读取提交；其证据强度与 S1—S6 分开记录：

| 候选                      | 本次读取结果                                                                                                                   | 样本归类                                                                                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| teknium1 的 Dr. Alectrona | JSON 直接包含 `name`、`world_scenario`、`description`、`personality`、`first_mes`、`mes_example`，没有 `spec` 与 `data` 包装。 | 实际角色资料；本次保留为平铺旧式结构，V2 成品计数仍为零。[源 JSON](https://github.com/teknium1/character-cards/blob/main/ai%20council/dralectrona.json)             |
| Shrnkd 的角色卡目录       | 本次目录列出 Disgraced & Dismissed、Gentle Ninja、Goldie、Grandfather clock、Pax Romeo 等 PNG。                                | 文件列表证据；本次读取范围保留为公开文本，PNG 内的卡格式与机制继续待确认。[作者目录](https://github.com/Shrnkd/Character-cards-n-stuff/tree/main/character%20cards) |
| lide4144 的《爱》         | 成品 JSON 实际声明 `chara_card_v3`，含 27 个世界书条目及 `regex_scripts`、`tavern_helper` 扩展。                               | 额外 V3 成品候选；本次仅核对结构，脚本正文机制留待后续阅读。[源 JSON](https://github.com/lide4144/sillytavern-character-cards/blob/master/cards/爱/爱.json)         |

查询过程中部分 GitHub API 返回限流，研究者随后改用仓库页面和 raw 文件继续读取。该结果反映本次查询与读取范围；V2 脚本卡的存在、流行程度和机制分布仍需更多直接样本支持。S1—S6 的已核对事实保持原范围。
