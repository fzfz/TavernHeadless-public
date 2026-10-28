# 角色卡交互与作者工具样本

本文记录 2026-09-28 读取的公开源文件。范围是作者卡片前端、配套工具与协议机制；本文没有安装、运行或导入外部代码，也没有验证实际模型输出。下文的“可声明式表达”和价值、复杂度均为研究判断，不表示 TavernHeadless 已实现相应能力。

## 样本口径

本文的价值分级针对保留作品核心行为：高表示影响核心流程，中表示扩展展示或可选体验；复杂度针对目标系统改造：低表示已有接口的字段或视图映射，中表示新增局部契约，高表示跨状态、生成或宿主生命周期协作。分级为本轮源码判断。

本次覆盖五个独立作者仓库：三份角色卡前端源码与两套作者发布的 Quick Reply 工具。前端源码可以证明对应作品的调用需求，但没有完整卡包导入证据，因此不能确认这些作品最终分发文件的 V2/V3 版本。Quick Reply 工具是用户导入的配套工具，不能计为角色卡内置脚本。官方 Eldoria 世界书与 V3 规范另列为基准，不计入独立作者作品数。各条证据见下文链接。

## 作者作品与实际调用

### 1. moxiaov：绿主匹配所开局表单

`src/绿主匹配所/界面/开局表单/App.vue` 在候选为空时创建四名候选，“换一批”重新生成候选。选择候选后，`onSelect` 依次写入姓名、性别、年龄、外貌、背景、已选定标志和剧情阶段，再调用 `createChatMessages` 写入用户消息，成功后调用 `triggerSlash('/trigger')`。这是一份实际作品目录中的 Vue 源码，不是仓库的 `示例/` 目录。[开局表单源码](https://github.com/moxiaov/tavern-cards/blob/7de0f16c70a896fcf8eebbf5d5aaf107aebfa68d/src/绿主匹配所/界面/开局表单/App.vue)

`界面/store.ts` 用 `defineMvuDataStore` 绑定 `type: 'message'` 与 `getCurrentMessageId()`。因此，这个样本的状态后端确实依赖 MVU；本报告从中抽取的是与变量解析格式无关的“界面动作修改状态并发送回合”需求，不能把它统计为纯非 MVU 卡。[状态绑定源码](https://github.com/moxiaov/tavern-cards/blob/7de0f16c70a896fcf8eebbf5d5aaf107aebfa68d/src/绿主匹配所/界面/store.ts)

研究判断：候选选择、字段赋值、阶段切换和消息模板可以表达为声明式动作；保持原有交互需要带回执的状态写入与发送顺序，单纯只读 watch 或填输入框不能完成。源码的连续赋值与 Promise 链只证明动作顺序，不能据此认定状态写入与回合提交具有事务性。价值高，固定动作转换的复杂度中，兼容原脚本的复杂度高。

### 2. LiarMTTT：星月 3.9.6 控制中心

`runtime/xingyue/3.9.6/control-center.js` 的 `commitTransactionNow` 处理世界书 upsert、删除、替换和版本前提，并通过 `host.updateWorldbookWith` 写入当前角色绑定的世界书。其 `getWorldbook` 读取与绑定检查位于同一实际发行目录，证明该前端有世界书编辑需求，而不仅是展示世界书。[世界书操作源码，约 4185 行](https://github.com/LiarMTTT/rolecard-diy-workshop/blob/af075318c0881451b46e088d0452b369c5ccd79f/runtime/xingyue/3.9.6/control-center.js#L4185)

同文件 `injectGenerationPrompts` 将界面设置生成的内容以 `role: 'system'`、`position: 'in_chat'`、`depth: 0`、`should_scan: false` 和 `{ once: true }` 注入；事件绑定涵盖 `GENERATION_AFTER_COMMANDS`、开始、结束和停止，结束时清理注入。[生成注入源码，约 547 行](https://github.com/LiarMTTT/rolecard-diy-workshop/blob/af075318c0881451b46e088d0452b369c5ccd79f/runtime/xingyue/3.9.6/control-center.js#L547)

研究判断：确定的开关到提示词映射可以声明式表达，但完整控制中心还需要世界书 CRUD、当前绑定读取、版本冲突语义和生成生命周期 API。原样兼容的复杂度高；限定为单轮提示词修饰的价值高、复杂度中。本次读取了上述具体函数，未通读百万字符文件全部功能，也未验证远程开局页或媒体链路。

### 3. Samueras：Guided Generations

`Guided Generations.json` 是作者发布的 Quick Reply 集合。`SysState` 与 `SysClothes` 读取既有注入，将其移动到 depth 4，保存当前预设并切到 `GGSytemPrompt`，通过 `/gen` 独立生成场景状态说明，再把新说明注入 depth 1，最后恢复原预设。`SysThinking` 在群聊分支读取 `{{group}}`，显示成员选择按钮，再对选中成员独立生成并注入。这证明独立模型调用与成员定向生成的需求；它没有证明完整的群聊轮流调度。[Quick Reply 源文件](https://github.com/Samueras/Guided-Generations/blob/9b6caa63a1b92b7d56687c67749c07b441994861/Guided%20Generations.json)

该集合的重生成按钮使用 `ephemeral=true` 注入和 `/swipes-swipe`；人称改写按钮使用 `/impersonate await=true` 与输入框恢复。上述三个 `Sys*` 条目的 `executeOnUser` 在读取版本中均为 false，集合另有 `/qr-update` 修改开关的脚本，因此不能声称导入后默认逐轮自动执行。[同一 Quick Reply 源文件](https://github.com/Samueras/Guided-Generations/blob/9b6caa63a1b92b7d56687c67749c07b441994861/Guided%20Generations.json)

研究判断：固定的“辅助生成→保存结果→下一轮注入”可以做成声明式流程节点；只有状态条件与赋值的事件系统无法覆盖 `/gen`、临时预设、重生成分支和成员选择。需要独立生成 API、注入生命周期与结果归属；价值高，复杂度高。此样本是正式作者工具，不是卡包或库演示。

### 4. multianimus：Jacks-Silly-QuickReplies

`Auto-impersonate.json` 包含设置循环次数、调用 `/imp`、等待输入、发送消息及等待生成的脚本，循环默认配置为 30，并用变量协调 TTS 延时与图片生成等待。`Img Gen.json` 则读取 `{{lastMessage}}`、拼接前缀、裁剪 token，再调用 `/imagine`；其中 “Imagine last” 条目的 `executeOnAi` 为 true。这是作者发布的实际 QR 工具集合，不是嵌入角色卡的代码。[自动代写源码](https://github.com/multianimus/Jacks-Silly-QuickReplies/blob/5bb50e06d5a8cf091d19cbc0206c85bd128fcaf0/Auto-impersonate.json)、[图片生成源码](https://github.com/multianimus/Jacks-Silly-QuickReplies/blob/5bb50e06d5a8cf091d19cbc0206c85bd128fcaf0/Img%20Gen.json)

研究判断：事件触发图片生成可声明式表达，但图片展示接口无法代替生成服务；自动多轮还需要生成任务完成事件、停止语义与循环编排。图片生成价值中、复杂度中高；自动代写循环价值取决于用户工作流、复杂度高。源码存在等待循环不等于已证明可靠的并发处理，本次未运行这些脚本。

### 5. Aerivsky：万界商店状态栏

`src/万界商店/界面/状态栏/App.vue` 读取当前世界、场景、行商阶段、通行证、人物状态与世界足迹，通过 `computed` 选择徽章样式并遍历列表。读取的组件没有发起状态写入、独立生成或消息发送；`store.ts` 使用当前消息的 `defineMvuDataStore`。它属于实际作品的只读前端，并且有 MVU 状态依赖。[组件源码](https://github.com/Aerivsky/tavern-cards/blob/aaed2019cf5f5bc8c448130367c61c71c4a7e590/src/万界商店/界面/状态栏/App.vue)、[状态绑定源码](https://github.com/Aerivsky/tavern-cards/blob/aaed2019cf5f5bc8c448130367c61c71c4a7e590/src/万界商店/界面/状态栏/store.ts)

研究判断：该组件适合映射为只读状态视图、条件样式和列表渲染；不能用这个样本论证需要通用写入 API。展示价值中，组件映射复杂度低。这个对照样本说明，采用同一框架的卡片可能有完全不同的宿主能力需求。

## 原生机制与 V3 的边界

### 世界书与 timed effects

SillyTavern 官方 `Eldoria.json` 提供实际默认世界书：读取的前三项以关键词激活，`constant: false`，概率为 100，`sticky/cooldown/delay` 均为 0。因此它能作为原生关键词激活样本，不能充当计时效果已被作品使用的证据。[官方默认世界书](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/default/content/Eldoria.json)

官方 `world-info.js` 的 `WorldInfoTimedEffects` 使用 `chat_metadata.timedWorldInfo` 保存 sticky/cooldown，sticky 结束会进入 cooldown；检查代码对 dry-run 与正式调用分别处理。原生源码还将卡内 `extensions.sticky/cooldown/delay` 映射到运行字段。这些是消息计数与聊天状态的语义，不是页面墙钟倒计时。[计时源码](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/world-info.js#L479)

研究判断：原生计时适合引擎内声明式状态机，需要在分支、重生成和 dry-run 下确定更新时机，价值高、复杂度中。本轮没有找到并读取能够确认启用了非零计时值的独立作者卡；因此，独立作者作品中非零计时值的使用仍是样本缺口。

### V3 decorators、assets 与 group

V3 规范定义 assets、`group_only_greetings` 和世界书 decorators。assets 涉及头像、背景、用户头像和表情等类型，规范把资产存储和对应显示能力分别描述；群聊开场是额外开场列表，不能推出成员调度器已存在。decorators 包含轮数条件、曾激活状态、插入位置、角色与开场索引等语义。[V3 规范固定版本](https://github.com/kwaroran/character-card-spec-v3/blob/f3a86af019fbd99f788f7a1155f399655b34ab35/SPEC_V3.md)

本次读取的 SillyTavern `world-info.js` 将 `KNOWN_DECORATORS` 列为 `@@activate` 与 `@@dont_activate`，不能据 V3 文件可导入就认定所有规范 decorators 均由该运行时执行。[SillyTavern decorator 定义](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/world-info.js#L101)

研究判断：decorators 大多可转换为提示词组装条件，但必须逐条比较语义；assets 首先需要资源索引和渲染映射，发送给多模态模型还需要独立请求能力。群聊开场选择与群聊轮次调度应分别评估。本轮没有取得可直接阅读、同时实际使用 V3 assets、完整 decorators 与 group 字段的作者卡 JSON，因此不能报告这些字段的普及率或完成兼容结论。

## 对能力优先级的研究结论

1. 状态动作应与状态显示分别验收。绿主匹配所证明了多字段修改与回合发送的组合需求；万界商店只证明只读展示需求。前者需要可等待的写入结果，后者可以复用只读视图。依据见作者样本 1、5。
2. 独立生成不能归入普通消息发送。Guided Generations 把辅助生成结果作为后续注入，并具有群聊成员选择；完整支持需要生成任务、结果存储及提示词注入的协同。依据见作者样本 3。
3. 世界书管理属于持久资源操作。星月实际执行世界书更新；只把条目展开为 UI 或提示词不足以保持编辑行为。依据见作者样本 2。
4. 媒体显示与媒体生成、群聊开场与多角色调度、页面定时器与消息计时必须分别记录覆盖。依据见作者样本 4、原生计时源码与 V3 规范。

这些判断面向上述具体样本，不代表生态统计。本轮没有新增实现、依赖、执行权限或兼容承诺。
