---
文档用途: 记录剩余步骤发现的问题及处理依据。
读取时机: 维护负责人复盘或恢复未完成事项时。
---

# 剩余步骤问题记录

## 1. 已有命令接口差异

1. 清理前，begin 已采用简化任务文件；validate、pack、formal、preview 和 resume 按旧任务 schema 读取，无法接续新工具产物。实际拒绝结果见 legacy-before.json。主代理已按[已批准方案](../execution-improvement-plan.md)第4.1.8节统一任务读取。
2. 清理前，validate 校验行为映射及字段覆盖记录。主代理已按[已批准方案](../execution-improvement-plan.md)第4章实施约束删除这些检查。

## 2. 状态规则的现有入口

1. 内置 backend-api.md 第5章规定，状态规则通过 updaterPrompt 和 ruleFiles 进入模型；第7章的 updaterEntries 在正文组装副本中停用世界书条目。

## 3. 未完成的状态组装

1. 状态 Agent 的独立预设、完整聊天历史、前 n 轮变量更新历史及世界书组装尚未接入；[状态组装架构方案](../../verbatim-state-assembly/architecture-proposal.md)的实施待批准。

## 4. 单次测试发现

1. 转换队员误判路径错误的批量命令结果，复制旧试产卡，并临时修改应用模块上限。主代理已中止测试并确认配置恢复；详见[单次复盘](single-trial/retrospective.md)第1至3章。
2. 当前加载器将包内全部世界书 JSON 计入模块资源，默认会话创建受128文件上限阻断。改为收集入口的静态依赖需要用户批准；方案见[下一次迭代方案](next-iteration-plan.md)第4.5节。
