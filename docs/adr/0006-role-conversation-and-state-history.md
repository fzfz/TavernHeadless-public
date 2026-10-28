---
status: accepted
---

# 分别查询对话记录与变量状态历史

一轮正文可以先保存，变量更新随后成功或失败。因此，角色卡 API 分别提供对话记录列表和变量状态列表：`messages.listFloors` 以已保存的可见消息为依据，`history.listSnapshots` 以已提交的显示快照为依据。系统聊天组件读取前者，状态回看选择器读取后者；相关术语见[角色显示领域](../../packages/shared/CONTEXT.md)。

历史变量详情统一通过 `variables.getSnapshot(snapshotId)` 读取。比较前后状态时，调用者用该方法读取目标记录及其 `parentSnapshotId`；处理刚完成的提交时，调用者使用 `onTurnCommitted` 已提供的 `before` 和 `after`。页面回看通过 `history.select` 更新 `view`，返回实时状态通过 `history.latest` 恢复跟随 `current`。完整签名、字段、时序和调用示例统一定义在[角色卡 JavaScript API](../character-authoring/script-api.md)。

两个列表均由后端按记录序号倒序执行游标分页，数据库每次至多读取请求条数加一条，用于判断后续页是否存在。前端首次加载一页，在用户继续浏览时加载下一页；刷新最新内容时重新请求第一页。用户浏览旧对话期间，聊天组件保留当前位置，回到末尾时刷新最新页。分页默认条数、上限和游标长度由 `packages/shared/src/config/role-runtime-history-pagination.json` 统一配置。

会话初始化只提供初始快照与当前快照。对话楼层标识用于读取消息，快照标识用于读取变量；消息查询参数为会话、分支和楼层，流式消息事件继续携带实际生成尝试标识。这样，正文与变量各自的保存结果能够独立查询和显示。
