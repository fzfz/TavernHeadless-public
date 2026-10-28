---
status: proposed
---

<!-- markdownlint-disable MD013 -->

# 角色显示使用独立模板与提交快照

角色需要可自定义的消息内布局与整屏演绎页面，并且管理员试聊与正式用户聊天共用实现。本提案将布局、历史显示数据和聊天动作分别归入版本化模板、后端提交快照和用户 Web 聊天控制器，具体契约见[角色状态栏与前端渲染架构](../plans/role-status-rendering.md)。相比在正则替换结果中执行角色脚本，这一选择增加模板规范和编辑工具的维护成本，但使历史值、变量提交和选项发送可以通过明确接口验证；原生渲染采用 Shadow DOM 样式封装，任意脚本插件留作独立需求评估。

角色作者可用的契约由[附加模板规范](../character-authoring/template-api.md)与[交互 API](../character-authoring/interaction-api.md)定义。布局采用通用节点组合，作者通过条件和字段绑定表达变化。

本提案的 Shadow DOM 模板执行边界已由 [角色脚本执行决策](0002-role-script-runtime.md)修订；后端快照与统一聊天控制器的职责保留。
