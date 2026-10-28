<!-- markdownlint-disable MD013 -->

# 管理 Web 端与原型的功能差异核对

恢复后的逐项复查见 [管理 Web 端原型恢复复查](admin-web-restoration-review.md)。本文保留提交 `1109bab` 的差异记录。

## 核对对象与结论

本文将已有 `apps/web/src` 应用称为“管理 Web 端”，将独立的面向用户演绎的应用称为“用户 Web 端”。对照对象是管理 Web 端的 Vue 组件及其事件处理代码，与 `apps/web/prototypes/admin-workspace.prototype.html` 在提交 `1109bab` 的页面和操作。核对采用代码阅读，未运行真实接口联调或浏览器验收。

原型漏掉了管理 Web 端的已有功能，也改变了部分操作的作用对象。此前没有取得用户对这些删减的允许。管理 Web 端业务源代码仍然保留；本次问题发生在原型的功能覆盖和设计表达中。

下表的“遗漏”表示原型没有对应操作，“简化”表示仍有部分展示或操作，但无法完成管理 Web 端已有任务。“保留”仅表示交互设计存在；原型中的内存数据不代表真实接口已经接通。

## 被遗漏、简化及改变的功能

证据路径均相对于 `apps/web/src/`。原因栏说明原型采用的简化方式及其影响；缺少明确记录的删减原因标为“理由未记录”。

| 项目             | 管理 Web 端已有内容及证据                                                                                                                                                                                                | 原型差异                                                                                                              | 原因及核对结论                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 消息操作         | `components/workspace/canvas/WorkspaceCanvasTimelineRow.vue` 提供编辑、删除、用户消息编辑后重新生成，以及带 floorId 的助手消息重新生成                                                                                   | 遗漏编辑、删除、编辑后重新生成；重新生成简化为最新失败轮次的重试                                                      | 原型只实现发送和失败恢复，未记录删减理由。这是遗漏，失败重试无法替代已有消息操作           |
| 消息呈现和输入   | 上述组件、`MarkdownBlock.vue`、`composables/workspace/messages/canvas-messages.ts` 展示 Markdown、不同消息角色、时间、耗时、Token 和来源；`assets/runtime-actions.ts` 处理流响应；`WorkspaceCanvas.vue` 处理输入键盘事件 | 简化为固定角色的纯文本与等待状态，缺少逐段流式呈现和逐消息指标；输入没有原有键盘事件处理                              | 独立消息模板采用固定样例，丢失已有呈现与操作细节；删减理由未记录                           |
| 工具管理         | `composables/workspace/tools/tool-manager-dialog.ts` 提供定义列表、创建、编辑、启停、删除、会话权限保存，以及会话可用工具与调用记录加载                                                                                  | 整个管理页面遗漏；只剩运行开关、Agent 策略字段和轮次工具标签                                                          | 边界文档明确要求保留现有工具管理，原型没有落实；这些开关无法替代工具定义和权限管理         |
| MCP 管理         | `composables/workspace/mcp/mcp-manager-dialog.ts` 提供服务器创建、编辑、启停、删除、stdio/HTTP 配置、连接、断开、测试和运行信息                                                                                          | 整个管理页面遗漏；Agent 编辑器中的 MCP JSON 配置仍在                                                                  | 原型保留配置引用，但缺少服务器生命周期操作；删减理由未记录                                 |
| LLM 实例作用域   | `composables/workspace/llm/instance-manager-dialog.ts` 提供 global/session 切换、绑定及解绑、从预设提取生成参数、参数重置、运行时刷新；对应对话框提供 Profile 状态筛选                                                   | 槽位、Profile、参数编辑保留，但改成角色草稿配置；缺少 global/session 管理、预设参数导入、状态筛选和相应运行时操作流程 | 原型采用角色应用发布快照，只覆盖新应用配置，遗漏原来的全局与会话配置能力；删减理由未记录   |
| 提示词模式       | `components/workspace/inspector/WorkspaceInspectorPromptModePanel.vue` 与 `composables/workspace/inspector/prompt-mode.ts` 支持继承、compat_strict、compat_plus、native，展示生效模式和来源并保存会话设置                | 遗漏整个模式控制                                                                                                      | 没有记录删减理由；演绎槽位配置无法替代提示词运行模式                                       |
| 变量调试         | `components/workspace/inspector/WorkspaceInspectorVariablesPanel.vue` 展示解析值、作用域、来源、暂存写入、晋升分组、状态及证据                                                                                           | 简化为“变量与记忆”标签及缺失记录说明；没有原有数据表和详情结构                                                        | 上一轮只恢复了按轮次访问的外壳，尚未恢复已有变量观察能力；不能算恢复完成                   |
| 记忆调试         | `components/workspace/inspector/WorkspaceInspectorMemoryPanel.vue` 展示类型统计、条目内容、重要性/置信度、来源轮次/任务、覆盖范围、作用域状态、任务尝试和错误                                                            | 缺少这些列表和详情，仅显示开关与缺失记录说明                                                                          | 原型补充了逐轮入口，但缺少已有记忆详情；删减理由未记录                                     |
| 分支与历史解释   | `components/workspace/inspector/WorkspaceInspectorVcPanel.vue` 与 `composables/workspace/inspector/vc.ts` 展示分支、差异摘要、谱系、历史 Explain、提示词摘要、Token 估算、诊断、分段统计及操作日志                       | 仅有固定 main 分支的轮次列表、配置副本与本地事件；缺少多分支差异、谱系和完整历史解释详情                              | 固定样例模型过窄；新增历史配置副本无法替代后端保存的 Explain                               |
| 实时工具调试     | `components/workspace/inspector/WorkspaceInspectorToolsPanel.vue` 按调用组织实时事件、活动工具及告警                                                                                                                     | 仅显示启停状态或没有调用记录；缺少运行中的工具事件布局                                                                | 上一轮恢复不完整。无调用样例不能作为移除运行中状态展示的依据                               |
| 全局事件区       | `components/workspace/WorkspaceInspector.vue` 底部常驻 `WorkspaceInspectorEventsPanel.vue`，记录资源、绑定、请求、同步失败等工作区事件                                                                                   | 遗漏常驻事件区；仅保留提示通知及选中轮次的少量本地事件                                                                | 将工作区事件缩成轮次日志，遗漏了轮次之外的操作排查                                         |
| 资源导入         | `lib/asset-import.ts`、`composables/workspace/assets/asset-import-dialog.ts` 及导入面板支持角色 JSON/PNG/WebP、批量预检、进度和逐文件失败结果                                                                            | 简化为单个 JSON 文件导入；缺少图片角色卡、批量预检和失败列表                                                          | 独立 HTML 采用单文件 JSON 导入，缩减了已有导入范围；删减理由未记录                         |
| 资源库浏览       | `components/workspace/WorkspaceAssetBrowser.vue` 提供搜索、类型筛选、名称/更新时间排序、收藏                                                                                                                             | 类型入口保留，搜索、排序、收藏遗漏                                                                                    | 原型使用少量固定样例，未覆盖真实资源数量下的查找操作；这只是样例局限，不能作为删减理由     |
| 角色卡删除恢复   | `composables/workspace/assets/asset-menu-actions.ts` 将已删除角色的操作转为 restore；角色管理对话框支持恢复                                                                                                              | 原型从内存资源数组移除，只有引用阻止删除，没有角色卡恢复入口                                                          | 通用资源删除错误地取代了角色卡独有的删除恢复生命周期                                       |
| 当前会话资源绑定 | `composables/workspace/assets/runtime-actions.ts`、`asset-menu-actions.ts`、`stores/workspace/actions/worldbook.ts` 支持向当前会话应用资源、绑定及解绑世界书；预设操作也针对当前会话                                     | 变成先保存角色草稿，再创建固定配置试聊；不能在已有试聊上执行原来的绑定调整                                            | 原型为保持发布配置稳定而固定试聊配置，同时缩小了已有会话的调试能力；这两类会话需要分别设计 |
| 账号与语言       | `components/workspace/WorkspaceTopBar.vue`、`WorkspaceInspector.vue` 提供多账号模式下的账号切换与中英文切换                                                                                                              | 两项入口遗漏，原型固定单一上下文和中文                                                                                | 原型固定单角色样例上下文；删减理由未记录。用户人设无法替代账号切换                         |
| 工作区布局       | `composables/workspace/shell/pane-layout.ts` 支持左右面板拖拽宽度；TopBar 和 Inspector 支持窄屏抽屉                                                                                                                      | 三栏视觉保留，但没有拖拽；窄屏改成纵向堆叠                                                                            | 独立 HTML 采用固定列宽和窄屏堆叠，改变了已有交互；取舍理由未记录，也未经浏览器验证         |

## 已保留的内容与原有占位内容

会话创建、打开、改名、归档恢复和删除在原型中有操作。角色卡、预设、世界书的编辑入口与字段得到扩展，资源复制及导出也有对应入口。LLM Profile 的创建编辑、凭证更新、模型发现与测试入口，以及各模型槽位和参数编辑存在。原型新加了正则样本测试、角色应用发布和 Agent 配置；这些新增项不能抵消上表中的遗漏。

管理 Web 端也包含尚未实现的入口和静态展示，应与真实能力分开核对：

- `WorkspaceTopBar.vue` 的用户、设置和通知按钮没有动作处理；原型移除了这些入口，但这不等于删除了已经完成的用户管理、设置或通知功能。
- `WorkspaceInspectorImpactPanel.vue` 的影响计数和图表包含静态数据；原型遗漏了 Impact 面板，不能据此声称已删除真实影响分析引擎。
- 顶栏的 `WS: 45ms` 与部分模型进度条是固定展示；API 状态则有传入值。移除固定数值与遗漏真实状态提示需要分别处理。
- 世界书绑定面板中的两个书名是静态展示，但资源库绑定/解绑确实有事件处理。应保留实际操作，并改进绑定列表的数据来源。

这些占位入口同样属于本次差异清单，后续按下一节的变更约束处理。

## 后续执行约束

设计执行者必须以管理 Web 端已有页面和操作作为增量改进的基线。需要删除、缩小操作范围或用其他功能替代时，执行者必须先提交具体项目、理由、影响和替代方案，并在用户允许后修改。此次清单中的项目均应作为待补回或待用户决定的差异，用户对新增功能的认可应仅用于对应新增功能。

在本差异核对阶段，执行者只核对差异并记录结论，原型页面和管理 Web 端业务源代码保持当时状态。后续逐项验收必须同时核对入口、操作对象、正常结果、失败处理及后端调用；同名标签或“暂无记录”文字只表示入口和空态已经设计。
