---
outline: [2, 3]
---

# Skill 索引

仓库级 Skill 把当前项目资料组织成可执行工作流。Agent 在当前 worktree 中读取 `.agents/skills/`，
网站提供同一工作流的人读页面与发布 JSON。

## 当前 Skill

| Skill | 任务 | 人读页面 | 发布 JSON |
| --- | --- | --- | --- |
| `tavern-project-contributing` | 修改项目代码、接口、数据库、Studio 或文档 | [项目贡献](/agent/skills/tavern-project-contributing) | [JSON](/agent/skills/tavern-project-contributing.json) |
| `tavern-client-integration` | 新接入或升级 Web、桌面与脚本客户端 | [客户端接入](/agent/skills/tavern-client-integration) | [JSON](/agent/skills/tavern-client-integration.json) |

[机器目录](/agent/skills/catalog.json)列出发布站点中的 Skill 标识、状态、人读页面和 JSON 地址。

## 本地使用

用户可以在包含 `.agents/skills/` 的 worktree 对应任务中选择 Skill，或在请求中写出 Skill 名称。
Codex 的实际可见列表以当前任务环境的发现结果为准。

各 Skill 的 `SKILL.md` 定义输入与完成条件，`references/workflow.json` 定义步骤和版本选择规则。

## 相关入口

- [本地开发入口](/development/local-development)
- [Agent 资料](/agent/)
- [官方集成层](/guide/integration-kit)
- [协作指南](/development/contributing)
- [SDK 总览](/sdk/)
- [API 参考](/reference/api)
