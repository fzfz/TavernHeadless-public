---
name: tavern-project-contributing
description: 修改 TavernHeadless 引擎、后端、共享模块或项目文档时，按当前版本判断模块边界、公开语义影响及验证范围。
---

# TavernHeadless 项目开发

## 输入

任务必须提供目标仓库根目录、项目规则文件、开发文档入口和 `projectChecks` 检查命令表。
Agent 必须从任务输入或项目规则取得上述输入。
项目规则文件和开发文档入口以目标仓库根目录为基址解析。
普通开发必须从开发文档入口读取本地参考文件。
跟进发布时，任务还必须提供目标站点 URL；Agent 必须以该 URL 解析工作流中的
`relatedDocs.path`、`humanPage` 和 `json` 三个站内字段。

## 执行

Agent 必须读取项目规则、开发文档入口，以及
[工作流](references/workflow.json)，按工作流中的适用条件、决策规则和步骤完成任务。
工作流的 `checks.command` 是 `projectChecks` 的键，Agent 必须读取其对应命令后执行。

必需输入或参考文件缺失时，Agent 必须报告准确的字段或路径，完成可独立执行的步骤，
并将依赖缺失资料的步骤标记为未完成。

## 完成条件

Agent 必须完成全部必要的已授权步骤，并使适用检查全部通过，才能报告任务完成。
存在失败检查或必要的未验证项时，Agent 必须报告未完成项及原因。
