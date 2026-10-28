<!-- markdownlint-disable MD013 -->

# 角色卡交互 API v1

> 本文保留旧 v1 原型契约，供核对既有实现。新的目标架构改用角色 JavaScript，作者规范见[模板与入口](script-template-api.md)及[脚本 API](script-api.md)。本文 actions/completion 不再作为新版作者接口。

本版职责与后续扩展边界见 [角色 Runtime 架构](runtime-architecture.md)。未来游戏玩法用于检查模块扩展可能，其业务模型按具体需求另行设计。

## 必须要实现的目标

系统向角色作者提供声明式动作 API。角色作者在 card_view.actions 中定义动作，模板按钮通过 action 字段引用。系统统一管理动作权限、聊天提交及本地显示状态。[模板规范](template-api.md)定义数据作用域与条件表达式。

## 动作声明

动作必须提供 type，可提供 when 条件。条件在点击时重新判断。系统提供以下操作：

| type             | 参数          | 行为                                                                 |
| ---------------- | ------------- | -------------------------------------------------------------------- |
| `ui.toggle`      | target        | 反转 ui 中已声明的布尔值，用于面板、标签内容及正文显隐               |
| `chat.fill`      | text 值表达式 | 将文本覆盖到输入框；保留为草稿，等待用户发送                         |
| `chat.send`      | text 值表达式 | 提交所声明的指令；已有输入草稿保留，动作与手动输入调用同一聊天控制器 |
| `history.prev`   | 无            | 回看前一个已提交显示快照；初始快照处禁用                             |
| `history.latest` | 无            | 回到最新显示快照，并恢复跟随提交                                     |
| `reading.prev`   | 无            | 显示上一段已提交正文；首段禁用，自动阅读行为见“阅读与媒体行为”       |
| `reading.next`   | 无            | 显示下一段；末段禁用                                                 |
| `reading.latest` | 无            | 跳到最后一段，自动阅读行为见“阅读与媒体行为”                         |
| `reading.auto`   | intervalMs    | 切换自动阅读，间隔至少 500ms；播放生命周期见“阅读与媒体行为”         |
| `audio.toggle`   | asset         | 播放或暂停已声明 audio 资源；生命周期见“阅读与媒体行为”              |

chat 动作只在会话活动、当前无运行且无失败待处理时开放；动作的 when 使用 current 与 literal，文本使用 literal 或 current。后端根据角色固定版本与最新快照重新解析 chat.send 的指令，前端提交动作 ID。生成中重复点击与携带旧快照的请求必须拒绝。历史画面的按钮仍按当前能力判断；作者需要引用旧数据时使用展示节点。

系统在本地动作执行后重新绑定模板。本地显示状态与业务变量的职责遵循模板规范“每轮更新与历史”章节。

## 调用、返回值与结果处理

本节定义动作完成契约。结构的唯一来源为 [action-completion.schema.json](action-completion.schema.json)：definitions.invocation 定义调用参数，definitions.completion 定义动作的 completion 字段，definitions.result 定义宿主返回值，definitions.effect 定义结果处理步骤。这是本规范已确定的新增契约；现有原型的动作 schema 与执行器尚未接入，运行验证范围仍见原型核对记录。

Runtime 调用宿主的 `invoke({ invocationId, actionId }): Promise<ActionResult>`。Runtime 为每次调用生成 invocationId 并通过调用参数传入宿主，宿主返回相同 invocationId 和 actionId。运行中，同一动作按钮禁用；用户再次主动操作才创建新调用。Runtime 的动作参数来自角色包，执行前重新检查动作条件和会话权限。

返回值 status 有三种：success、error、cancelled。success 表示下表的完成条件已满足；error 包含错误 code、outcome 和可选字段 path；cancelled 表示宿主确认本次操作取消且没有完成。outcome 为 not-applied 时操作没有生效，为 unknown 时后端结果尚无法确认。网络断开属于 error/unknown，宿主显示查询或恢复入口，用户操作经宿主确认结果后再开放。

| 动作                     | success 的完成条件                               |
| ------------------------ | ------------------------------------------------ |
| ui.toggle                | UI 值已更新，并完成本次模板更新                  |
| chat.fill                | 宿主输入框已写入文本                             |
| chat.send                | 对应回复及显示快照提交成功，Runtime 已应用该快照 |
| history.prev/latest      | 目标显示快照已应用                               |
| reading.prev/next/latest | 阅读位置已更新                                   |
| reading.auto             | 自动阅读已启动或停止；后续翻页不重复完成本次调用 |
| audio.toggle             | 播放请求已被媒体控制器接受，或音轨已暂停         |

请求被后端接收、收到第一个流式片段都属于 chat.send 进行中。生成失败返回 error；主动停止只有在宿主确认取消后返回 cancelled。用户停止与提交同时发生时，以宿主确认的执行结果为准。宿主将参数错误、条件不满足、请求失败和媒体播放拒绝统一转换为 error；错误 code 使用统一错误对照表，角色包无需编写错误提示。

动作可提供 completion，其中 onSuccess、onError、onCancel 分别对应三种终态。Runtime 只执行匹配的一组步骤，按数组顺序执行并等待每一步完成。省略处理组表示没有额外显示动作，宿主的错误提示和生成状态仍正常显示。

```json
{
  "type": "chat.send",
  "text": { "source": "literal", "value": "前往灯塔。" },
  "completion": {
    "onSuccess": [
      { "type": "ui.set", "target": "choicesOpen", "value": false },
      { "type": "audio.play", "asset": "arrival" }
    ],
    "onError": [{ "type": "ui.set", "target": "choicesOpen", "value": true }]
  }
}
```

此例在回复和快照提交成功后关闭 choicesOpen 面板，再播放 arrival 音轨；失败时展开该面板。choicesOpen 必须是包内声明的布尔 UI 字段，arrival 必须引用 audio 资源。

结果步骤限定为 ui.set、audio.play、audio.stop。ui.set 为已声明布尔 UI 字段赋值；audio.play 从资源开头播放，音轨正在播放时保持播放位置；audio.stop 停止指定资源并回到开头。播放遵守宿主音量、静音及浏览器播放权限。步骤失败时停止本组剩余步骤，由宿主显示具体错误；原动作的结果和已经完成的步骤保持原结果。

一次 invocationId 的结果处理仅执行一次。切换角色、会话、分支或卸载页面后，原实例的完成处理失效；宿主继续记录所属会话的后端结果。重新进入或回看历史只恢复数据绑定。completion 使用本地显示步骤，业务请求继续由用户动作触发。

## 系统事件与数据契约

系统提供以下生命周期：后端校验角色包并准备会话渲染数据、前端挂载显示配置及初始快照、开始生成、提交成功快照、报告生成失败、切换历史及卸载。角色通过值绑定和条件响应这些事件，无需编写事件脚本。

显示提交记录包含 snapshotId、sessionId、branchId、floorId、attemptId、versionId、variables、text、input。variables 是本轮成功提交的完整值，text 是与该记录关联的已提交正文，input 是服务端解析后的用户指令。记录格式与动作请求由 `card-contract.schema.json` 中的 definitions 定义。后端提交前校验变量类型、必需键、数值范围与资源引用；校验失败时保留旧显示记录并报告具体字段。

正式聊天链路须在同一提交中保存回复、变量和显示快照；重试关联同一个 floorId 和新的 attemptId。正式后端读取接口根据 sessionId、branchId、floorId 和 attemptId 返回该次执行保存的显示记录，并使用 versionId 读取对应角色模板。后端失败结果、分支快照查询和权限能力响应沿用并扩展正式会话契约；本轮原型仅验证初始记录与顺序提交。

## 隔离验证接口

这些路径由原型服务提供，属于新增契约的模拟传输，正式产品路由须在 OpenAPI 中另行注册。真实角色包仍经现有 `/characters/:id/versions` 写入并从 `/characters/:id` 读取。

`POST /prototype-runtime/respond` 接受 sessionId、branchId、floorId、attemptId、cardId、versionId、expectedSnapshotId，以及 text 或 actionId 二者之一。服务按固定角色版本读取 card_view，并校验当前快照身份。手动输入使用 text；角色发送按钮使用 actionId，服务从声明中解析文本。响应为 `{data: 显示提交记录}`。

原型服务从独立的 `card-turns.fixture.json` 读取逐轮结果，该文件属于验证输入，角色作者提交的包内只包含模板和配置。服务按顺序消费各会话的结果，拒绝过期快照、非法动作和无效变量。失败响应包含 error.code 和 error.message。原型验证范围涵盖正常两轮与结构错误；实际 LLM 推理和正式事务提交由产品实施阶段验证。

## 阅读与媒体行为

v1 将每条已提交正文按空行分段，段落身份由消息身份和段落索引组成。首次进入显示第一段；新回复到达时保留已有阅读位置。作者可使用 reading.latest 提供继续入口。阅读进度与显示快照回看分别管理，作者通过 view 展示状态、通过 read 展示正文，两者的按钮必须给出对应的操作名称。

打开任意面板不会自动推进剧情。自动阅读只读取已有正文，在末段、回到上一段、跳至最新、切换角色及卸载时停止。音乐在切换角色或离开会话时停止。音乐由用户点击开始；资源读取或播放失败时系统显示重试提示。画廊由 repeat、image、when 与 ui.toggle 组合，图片是否显示由变量决定；永久收藏与跨分支解锁属于后续能力。

## 验收清单

验收者逐项操作包内声明的动作，检查参数、启用条件、界面效果与后端请求。检查必须证明 ui 开关保持变量不变、fill 覆盖草稿而不生成、send 在后端解析动作并保留原草稿、旧快照被拒绝、每轮变量改变状态与布局、历史回看和当前行动选项分别读取正确记录。新增角色只修改包和验证数据，解释器代码保持不变。

## 非本次目标

本次交付声明式 API、解释器原型和契约验证。正式鉴权、发布解析、事务存储、流式恢复和完整分支持久化仍按两端开发计划实施。

## 已获得的授权

用户要求面向未来角色卡制定模板与交互 API，并对照规范验证现有原型及逐轮变量变化。用户已授权隔离后端与 mock 数据验证；正式生产部署另行安排。
