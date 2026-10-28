<!-- markdownlint-disable MD013 -->

# HTML 状态栏：SillyTavern 实现与当前架构调研

## 必须要实现的目标

本次调研回答三个问题：正则生成 HTML 状态栏的优缺点是什么，当前架构能够复用哪些能力，以及图片、变量和选项按钮应如何接入。截图中的状态栏包括地点、日期、时间、人物图片、数值进度条、文本和四个操作选项。截图只能证明布局，按钮行为与变量来源需要源码证据。

调研对象为本地 SillyTavern 仓库 `/srv/data/mac bookpro old/AI/SillyTavern`（HEAD `51ad27fb8`），以及当前独立 worktree 的业务源码（HEAD `6e3ba46`）。本文中的实施顺序是建议，尚未变成已实现功能。

## 本地 SillyTavern 的实际实现

本节路径均相对于上述 SillyTavern 仓库。源码与导出配置证明了实现方式；当前运行中的扩展启用状态与截图对应的精确卡片尚未确认。

普通消息的显示流程位于 `public/script.js:1804`：先执行 `getRegexedString(..., isMarkdown: true, depth)`，再调用 Markdown 转换器，最后经过 DOMPurify。样式标签另由 `public/scripts/chats.js:536` 起的处理函数解析、添加消息选择器前缀并过滤部分规则。因此普通消息支持 HTML/CSS 美化，但普通消息中的脚本不会因此自动获得执行能力。`public/scripts/extensions/regex/engine.js:98` 起合并全局、预设和角色卡规则；角色内规则读取自 `data.extensions.regex_scripts`，实际参与执行还受允许状态影响。

本地安装目录包含酒馆助手插件 `public/scripts/extensions/third-party/JS-Slash-Runner`。本段以下四个 `src/` 路径均相对于该插件目录。它在 `src/panel/render/Iframe.vue:39` 读取代码块中的 HTML，经 `createSrcContent` 包装后写入 iframe 的 srcdoc 或 Blob URL。`src/panel/render/iframe.ts:78` 起构造页面环境；`src/function/variables.ts:58` 起提供变量读取，其中消息变量按消息与 swipe_id（候选回复编号）取得；`src/function/slash.ts:3` 的 triggerSlash 调用宿主命令执行器。完整 HTML 卡片中的 iframe 由插件创建，不能以卡片模板里没有 iframe 标签判断其渲染方式。

| 本地明文配置                                            | 已确认的实现                                                                                                                                                                                                                                                      |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cards/regex-状态栏改.json:2`                           | 显示正则匹配 `<StatusData>…</StatusData>`，替换为带 HTML 围栏的完整页面。模板脚本通过 `getChatMessages(getCurrentMessageId())` 读取原始消息，解析状态键值，生成进度条与选择项。点击时通过 `triggerSlash` 依次调用 `/send` 和 `/trigger`，由宿主发送并生成下一轮。 |
| `cards/fzfz_lx.json:65`                                 | 林茜角色卡包含 `[显示]状态面板-林茜V2`，正则捕获 `<StatusPlaceHolderImpl>…</StatusPlaceHolderImpl>`，完整 HTML 模板用 `var D=$1` 取得捕获数据，再用 JavaScript 计算阶段和百分比。其 tavern_helper.scripts 为空，不能将这张导出卡直接称为 MVU 驱动。               |
| `cards/天龙小段誉.json:29`                              | 同时包含显示美化规则、对模型隐藏状态栏的 promptOnly 规则，以及按深度裁剪变量更新的规则；tavern_helper 中另有 MVUbeta 脚本配置。MVU 在此指角色卡使用的变量更新脚本，其远程模块尚未读取或执行。                                                                     |
| `mycode/status-placeholder-tavern-helper-import.json:1` | 导出配置中的 enabled 为 true，脚本监听 MESSAGE_RECEIVED，使用 getChatMessages/setChatMessages 补齐消息状态占位，并声明手动按钮。导出文件的 enabled 不代表当前会话已经加载它。                                                                                     |

这些配置展示了三种数据来源：正则捕获消息中的状态数据、插件读取原始消息、变量插件保存的消息变量。这些是参考仓库的数据来源差异；本项目的接入路径由下文链接的自有架构方案定义。截图中的布局可以用这些机制构建，但上述证据尚未定位到与截图完全相同的模板。PNG 卡内数据未提取，卡片脚本及其外部依赖均未执行。

## 当前项目的能力与缺口

| 能力         | 源码事实                                                                                                                                                 | 实施含义                                                                         |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 显示正则     | `packages/adapters-sillytavern/src/regex/regex-engine.ts` 的 display 通道选择 `markdownOnly` 规则，按数组顺序处理位置、深度与替换；替换字符串可以含 HTML | 复用现有引擎，接入唯一用户 Web 聊天渲染器                                        |
| 正式消息渲染 | `apps/web/src/components/workspace/MarkdownBlock.vue:14` 设置 `html: false`，只调用 MarkdownIt 与 DOMPurify                                              | 正式前端尚未接入显示正则和 HTML 状态栏，修改一个配置开关不足以完成变量与按钮功能 |
| 规则来源     | `apps/api/src/services/prompt-assembler.ts:933` 从绑定的 regexProfile 读取规则；角色解析器保留 extensions                                                | 若复用卡内规则，需要显式识别并绑定资源；保留扩展字段不等于执行正则或插件         |
| 变量写入     | `packages/core/src/tools/builtin-provider.ts:29` 的 `set_variable` 暂存当前页面变量，默认在页面获接受时晋升到楼层                                        | 状态变化复用后端变量提交链路；渲染动作本身不修改演绎变量                         |
| 变量读取     | `apps/api/src/services/variables/variable-service.ts:366` 的 resolveSnapshot 调用作用域解析器，读取 page、floor、branch、chat、global 当前可见值         | 方法名中的 snapshot 不代表历史时点快照                                           |
| 历史基础     | `apps/api/src/services/branch-local-variable-snapshot-service.ts:217` 保存楼层的分支可见局部变量；同文件 writeSnapshot 按 floorId 更新已有行             | 已有快照可复用，但不足以直接承诺每个页面、每次生成的全部显示变量永远固定         |
| 宏替换       | `apps/api/src/services/prompt-runtime/regex/runtime-facade.ts` 的替换器支持完整键名 `{{key}}`；`{{scene.location}}` 查找同名键                           | 此处尚未接入 SillyTavern 的完整宏、对象路径或第三方变量插件 API                  |
| 后端顺序     | `apps/api/src/services/prompt-assembler.ts:1281` 用提示词组装时的变量处理回复持久化正则                                                                  | 显示模块在本轮变量提交后读取对应回复的显示值                                     |

此前版本方案中的“第一版采用 Markdown 表格”属于当时确定的交付范围，不是架构限制。现行方案已改为[独立显示模板与提交快照](role-status-rendering.md)，HTML/CSS 状态栏在现有后端基础上接入。

## 优点与代价

正则模板可以把简短状态标记或结构化文本转换为图片、网格、进度条和折叠区域。不同角色使用不同模板，前端无需为每张卡写一套页面。显示通道保留已保存消息，使美化模板不必进入模型上下文；这一点以模板仅在显示通道启用为前提。SillyTavern 官方文档明确支持在替换内容中使用 HTML/CSS，并区分显示、提示词与持久化效果。[官方正则文档](https://docs.sillytavern.app/extensions/regex/)

这种方案的代价也具体可见：模型输出格式变化可能导致正则失配；规则的顺序与深度会影响最终结果；正则本身不负责变量存储、数值运算或按钮发送消息。模板中的动态文本、图片地址、样式与动作需要明确处理，否则会出现文本破坏标签、图片路径失效、样式影响外层页面和按钮无实际行为等问题。依赖插件 API 的角色卡还需要对应运行接口。

## 自有架构方案

上述内容保留为源码调研依据。后续设计采用[角色状态栏与前端渲染架构](role-status-rendering.md)：后端提供提交后的显示快照，独立版本化模板负责布局，用户 Web 统一执行动作。该方案替代本调研初稿中默认以 iframe 执行角色脚本、逐项适配酒馆 API 的建议。

## 验收清单

本次调研的完成条件：三个问题均有结论，源码事实可定位，尚未确认的能力明确标注。后续实施的纵向验收条件统一见[自有架构方案的验收清单](role-status-rendering.md#验收清单)。

## 非本次目标

本次交付调研与实现建议。完整移植 SillyTavern、安装或执行第三方插件、运行角色卡脚本以及修改正式业务代码，均留待用户确定实施范围。

## 已获得的授权

用户要求分析截图状态栏的优缺点与当前架构可行性，并授权读取指定本地 SillyTavern 仓库的源码、插件和角色卡实现。本次在已有独立 worktree 保存调研文档。
