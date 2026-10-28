---
文档用途: 指导维护负责人执行已批准的角色卡转换 Skill 维护任务，并定位当前进度。
读取时机: 维护负责人开始工作或恢复上下文时。
---

<!-- markdownlint-disable MD013 -->

# 角色卡转换维护执行计划

## 必须要实现的目标

主代理执行 [已批准主计划](../../docs/plans/native-card-converter/maintenance-skill-plan.md)，交付仓库内维护 Skill、确定性工具、完整内置 API 文档、逐轮评估及全部 117 项输入的逐卡记录，完成适用卡的核心转换验收。用户最新明确的语义识别与架构转换要求优先适用，主计划的其余完成条件继续适用。

主代理仅在当前 worktree `/srv/tavern/TavernHeadless-remove-preview-credentials` 和分支 `codex/native-card-converter-design` 工作，按初始基线保留已有修改。当前记录集中保存于本目录，其他任务的规划文件保持原样。

## 执行阶段

| 阶段              | 执行主体与产物                                                                                                                      | 完成条件                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 最小 Skill 与工具 | 主代理交付 `.agents/skills/native-card-conversion/` 和 `scripts/native-card-conversion/`                                            | 满足主计划第3章契约及启动检查。                                                           |
| 每轮收尾          | 主代理保存逐卡结论、公开执行记录及评估页面                                                                                          | 本轮所有派发均有阶段结果、问题分类和证据；台账同步。                                      |
| 修订与回归        | 主代理修改并检查 Skill 或工具，新子代理复测受影响卡                                                                                 | 相关静态检查通过；独立新轮次结果及主代理验收齐备。                                        |
| 核心逻辑核对      | 主代理对照源字段及使用这些字段的源实现证据，核对原生目标文件中的核心状态、计算和提示行为                                            | 每部分核心内容具有准确原生文件、字段、格式及绑定，实际检查符合源逻辑。                    |
| 完整语料测试      | 主代理按 docs/plans/native-card-converter/acceptance-cards.json 的 priority 字段所列优先顺序，再按 cards 字段所列其余输入派发并验收 | 117项均有逐卡结论；用户排除项记录跳过依据，其余卡具有核心阶段证据且全部适用核心要求通过。 |
| 检查、审阅与提交  | 主代理运行项目检查、独立语义审阅、team-mode 简化及 code-review                                                                      | 问题修复，精确提交本次文件，并遵守本文件的工作范围要求。                                  |

维护开发者按主计划第4章建立、检查并迭代 Skill 与工具。执行 Skill 的 Agent 按同章的使用步骤建立本轮任务、阅读来源与 API、生成原生文件、校验、正式导入、回读并验收；具体调用契约见主计划第3章。

## 验收清单

主代理依据 [验收标准](../../docs/plans/native-card-converter/maintenance-acceptance-standard.md) 执行逐卡检查并记录分项及整卡结论。

- 主代理每轮使用主计划指定的 implement、team-mode、skill-creator 和 writing-for-agents，并保存检查及评估结果。
- 主代理按验收标准“执行边界”项创建和派发验收子代理，保存输入与只读边界证据。
- 主代理按验收标准的“有效功能”“职责归属”“包与模块”“导入与保存”“核心运行”项执行检查并保存结果。
- 主代理保存请求、响应、产物、可见执行记录与核心判断；修订影响已通过行为时重新派发回归。
- 主代理将每张卡新发现的语义问题整理为 Skill 内的参考案例，记录源内容作用、误判、原生落点及区分对错的事实；原始证据和逐卡结论保存在对应轮次。
- 主代理按验收标准记录真实模型验证与 API 缺口，等待批准期间继续独立工作。
- 主代理在指定 worktree 内核对旧草稿及本次文件归属，完成最终代码审阅及精确提交；用户级旧草稿的仓库外文件保持原样，按用户限定的工作位置记录范围。

## 非本次目标

本轮维持已批准的通用 API 边界。API 扩充进入单独批准流程；新依赖安装、源项目运行及自动启动方式分别按用户授权执行。原始卡和源用户数据作为只读输入。呈现范围按验收标准“逐卡验收项”章执行。

## 已获得的授权

用户已批准维护 Skill、工具、硬编码清理、117项逐轮黑盒测试、正式格式联调、验收及当前分支提交，并要求使用 planning-with-files 持续记录。用户最新明确由 Agent 完成字段语义识别、删除决策和原生文件格式归属，并要求停止 UI 复现上的投入。

用户本轮批准世界书深度条目的消息角色透传修复，具体工作与完成条件见 [修复计划](api-depth-role-fix/task_plan.md)。语料范围按该计划调整；117项清单保留全部输入，排除项记录为用户决定跳过，原测试证据保留。角色透传修复已提交为 `2a9c11a`。用户已恢复完整维护任务：主代理收尾第19轮，审阅并发布第20轮草案，重新派发回归，再继续其余输入及最终检查、审阅和精确提交。

主代理执行源项目与角色脚本前，准备具体命令、写入目录和停止方式，按用户提供的外部运行规则核对授权。

## 当前文档修订阶段

主代理先完成 Skill 全部文档的用途、结构、层次、标题与正文检查，按独立审阅结果修订并保留有效约束。原生 API 资料只保留完整当前使用契约，宿主历史记录保存在审计目录。文档复核及相关检查通过后，恢复原计划的干净上下文转换测试；逐卡目标和完成条件保持本计划规定。

## 状态与错误记录

主代理在 [进度](progress.md) 保存各阶段状态及操作，在 [发现](findings.md) 保存问题、证据与处理结果，每轮结束后更新本目录总台账 cards.json。

## 系统预置工具方案的下一阶段

用户已批准[架构方案](../../docs/plans/native-card-converter/model-tool-architecture-proposal.md)及其中的参数契约，并要求新建独立worktree和会话执行。独立会话从main建立工作区，按方案完成系统实现、正式API资料、检查、PR及合入；源计划和结构契约从当前worktree只读取得，当前Skill及其维护文件由本会话负责。

当前主代理核对独立会话的验收和合入证据。确认PR已合入main后，在本会话worktree的 `codex/native-card-converter-design` 分支保留已有修改，取得已合入实现，核对并同步完整Skill内置API资料，恢复第20轮及剩余117项迭代。受影响已通过卡重新派发回归；只读边界、干净上下文最小派发、逐卡核心验收和最终审阅提交要求继续适用。

独立实施的会话、工作区、PR和阶段保存于iteration-20/system-capability-handoff.json。

## 当前执行状态：文档重构验收与逐卡恢复

用户要求先完成 Skill 文档和流程重构。主代理暂停新增角色卡派发，保留第20轮现有产物；C006、C001 中断，USER002 的完整验收继续记录为待收尾。系统 random/calculate 已合入并接入当前分支，转换 Agent 按[API 资料入口](../../.agents/skills/native-card-conversion/references/sources.md)读取内置参考。

主代理核对[语义改进方案](../../docs/plans/native-card-converter/semantic-skill-redesign.md)第1.1至1.4节：两套架构分章、语义判断先行、具体经验、目标目录及文件责任、命令说明、记录格式分离和 API 资料用途。独立审阅者逐份审阅 `.agents/skills/native-card-conversion/` 内的20篇 Markdown 文档；主代理修正后完成链接、格式、来源副本和启动检查，并保存重构收尾记录。文档重构通过后，再按原计划恢复全新上下文卡测试；117项完整转换验收按本计划“状态与错误记录”章保存。

文档与流程修订、独立审阅和相关检查的结果见[重构验收记录](document-restructure-closeout/results.md)。

## 当前优先任务：原文保留与状态组装方案

主代理先完成 [原文保留修订与状态组装方案](verbatim-state-assembly/task_plan.md)。本次 [Skill 最高原则](../../.agents/skills/native-card-conversion/SKILL.md#转换最高原则原文承接)优先于本计划中先前的 UI 范围。主代理随后提交状态 Agent 复用系统组装机制的具体架构方案，后端改动待批准后实施；当前先完成文档修订与检查。117项总任务继续保留，本次新增卡派发为零。

## 2026-10-06：执行改进方案的剩余步骤

1. 主代理已按[已批准方案](iteration-23/execution-improvement-plan.md)完成 copy、parse、index、已有命令及工作流文档修订；各步已与前序步骤联调、复盘并修正。
2. 当前状态及恢复位置见 iteration-23/execution-improvement-progress.json 的 remainingSteps；详细进度见[剩余步骤进度](iteration-23/remaining/progress.md)，问题见[剩余步骤记录](iteration-23/remaining/findings.md)。
3. 唯一一次干净上下文转换测试已中止。主代理已完成验收与耗时复盘：13项源行为检查为6项通过、3项失败、4项未执行；正式导入和155文件回读通过，默认会话创建失败。见[单次复盘](iteration-23/remaining/single-trial/retrospective.md)。
4. 主代理已完成[下一次迭代方案](iteration-23/remaining/next-iteration-plan.md)，应用模块加载改动待用户批准。本次实施、审阅和提交已完成。主代理继续本任务前，先读取 iteration-23/remaining/commit-result.json；主代理不再恢复或重新派发本次转换测试。

## 2026-10-06：修复实际路径错误与失败误报

1. 主代理按用户要求实施 map-entry 路径与失败处理修复，进度见[路径错误修复进度](iteration-23/path-failure-fix/progress.md)。
2. 主代理恢复上下文时先读取 iteration-23/path-failure-fix/status.json，再按上述进度文档继续执行。

## 2026-10-06：修订六项问题方案

1. 用户要求修订读取与写入范围、ZIP 交付流程、当前模块 API 改写要求和下一阶段方案，主代理正在完成文档检查与独立语义审计。
2. 当前方案见[单卡转换 Skill 改进方案](iteration-23/remaining/next-iteration-plan.md)，恢复进度见[方案修订进度](iteration-23/remaining/plan-revision-progress.md)。PR #13 已合入 main，接入步骤按方案第4.2节执行；先前“完整状态上下文待批准”的状态已被本节替代。

## 2026-10-06：同步 main 到当前分支

1. 主代理已在当前 worktree 的 `codex/native-card-converter-design` 分支合入 main 的 `88722f3`，合并提交为 `595bf26`。
2. 主代理已恢复54份既有修改：51份未重叠文件保持原样；状态更新服务和两份 API 文档已合并新实现与本地修改。检查及恢复位置见 main-sync-2026-10-06/status.json。
3. Skill 内置状态 API、schema 和架构说明的同步继续按下一次迭代方案第4.2节执行。

## 2026-10-06：执行单卡转换改进与模块依赖修复

1. 用户已批准执行iteration-23/remaining/next-iteration-plan.md，包括第4.6节的模块加载改动；此前待批准状态由本节替代。
2. 后端静态依赖加载、共享初始状态校验及Skill状态资料同步已完成。单次原始转换仍未通过验收，逐项结论及后续方案见iteration-24。
3. 压缩后先读取[本次实施计划](iteration-24/task_plan.md)、[执行状态](iteration-24/execution.json)及[进度](iteration-24/progress.md)，再继续未完成阶段。

## 2026-10-07 CLI实施结果

1. CLI改进实施及全量检查完成；恢复此任务时读取[当前实施状态](cli-implementation/task_plan.md)，再读取其中指定的下一步方案。
2. 本轮117项为begin结构检查，原始117卡语义验收状态不因该结果改变。
