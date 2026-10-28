---
outline: [2, 3]
---

# 本地开发入口

本仓库的开发 Agent 必须从当前 worktree 读取项目规则、设计状态和代码。在线站点提供发布版本资料，不能替代本地文件。

## 开始任务

1. 读取仓库根目录的 `AGENTS.md`。
2. 读取 `docs/development-index.md`，选择任务主题并查看“已核对实现”“设计提案”或“待核对”状态。
3. 确认当前分支、HEAD 和未提交改动。
4. 读取任务涉及的设计、接口、schema、测试和实现。
5. 按改动范围完成验证，并报告仍未验证的内容。

[快速开始](/guide/getting-started)提供安装与启动说明，
[协作指南](/development/contributing)和[测试与 CI](/development/testing)提供开发约束。
开发文档入口记录了快速开始相关配置与命令的核对范围。

## 使用仓库级 Skill

仓库在 `.agents/skills/` 提供两个 Skill：

| Skill | 任务 |
| --- | --- |
| `tavern-project-contributing` | 修改项目代码、接口、数据库、Studio 或文档 |
| `tavern-client-integration` | 新接入或升级 Web、桌面与脚本客户端 |

[Skill 索引](/agent/skills/)说明如何选择工作流。各 Skill 的输入、步骤和版本选择以其执行文档为准。

上游来源快照位于 `docs/provenance/upstream/`。

## 相关入口

- [项目贡献 Skill](/agent/skills/tavern-project-contributing)
- [客户端接入 Skill](/agent/skills/tavern-client-integration)
- [官方集成层](/guide/integration-kit)
- [SDK 总览](/sdk/)
- [API 参考](/reference/api)
