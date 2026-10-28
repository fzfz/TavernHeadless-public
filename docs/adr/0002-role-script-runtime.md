---
status: proposed
---

<!-- markdownlint-disable MD013 -->

# 角色前端执行作者 JavaScript

角色卡与脚本由项目自己编写和维护，作为受信任的应用代码运行。目标方案采用同页面 JavaScript 模块执行自定义函数，Shadow DOM 封装角色样式，api 函数对象直接连接当前会话控制器；具体契约见[Runtime 架构](../character-authoring/runtime-architecture.md)。

这一决策保留 [0001](0001-role-display-template-and-snapshot.md) 的样式封装、后端快照和统一聊天职责，将作者 JavaScript 纳入本版执行模型。角色自定义函数处理计算与交互规则；系统通过命名空间 API 封装变量、布局、资源、事件、媒体与计时器。开发范围以自编角色为前提，不建设第三方脚本平台。

Runtime 自动登记 API 创建的资源，历史楼层离屏时释放对应范围；角色切换采用整页导航，由新页面初始化 Runtime，生命周期契约见上述架构文档；角色入口只负责注册布局与回调。脚本 Runtime 已有隔离原型，系统组件、变量回调与生命周期的验证范围见[脚本原型验收](../character-authoring/script-prototype-acceptance.md)。未来游戏业务规则保持独立需求范围。
