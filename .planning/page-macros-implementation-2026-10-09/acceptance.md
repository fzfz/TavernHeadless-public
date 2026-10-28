---
文档用途: 汇总页面宏公共模块的实施范围、计划验收结果和五张随机角色卡的逐卡结果。
读取时机: 核对本次交付范围、测试证据及尚未通过的验收项目时。
---

# 页面宏公共模块验收结果

## 1. 实施范围

1. 本次验收依据[《Skill页面宏展开公共函数方案》](../native-card-maintenance/root-cause-research-2026-10-08/session-name-plan.md)。
2. 本次交付位于 `codex/native-card-converter-design` 分支，目标工作区为 `/srv/tavern/TavernHeadless-remove-preview-credentials`。
3. [宏注册表](../../.agents/skills/native-card-conversion/config/page-macros.json)登记 98 个主宏、27 个别名和 9 种旧名称或写法。公共模块实现 36 个主宏，其中 17 个要求满足各自 `condition` 字段规定的用途条件；其余 62 个主宏返回宿主能力诊断。
4. 根目录登记 `moment=2.31.0`、`seedrandom=3.0.5` 和 `bowser=2.12.1`；浏览器构建复用已有 esbuild。

## 2. 计划验收项目

1. 宏专项包采用第 3 节所列五张随机卡的角色名称和单独登记的受控正文，用于验收本节的宏功能。随机卡的整卡结果见第 3 节。
2. 当前结果及证据如下。

   | 计划项目                           | 当前结果                                                  | 证据                                                                                            |
   | ---------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
   | 注册表、别名、旧写法及宏语义       | 162 项宏测试通过，规范审查与方案审查均通过                | `final-macro-repair-progress.json`、`final-spec-followup.json`、`final-standards-followup.json` |
   | 公共函数的姓名、缺键和普通文字处理 | 焦点测试及实际页面通过                                    | `final-focused-tests.log`、`preview-acceptance.json`                                            |
   | 36 项受控宏语义对照                | 五份专项包的 180 项对照通过                               | `browser-acceptance.json`                                                                       |
   | 绑定位置、去重、错误和并发产物     | 30 项焦点回归通过；并发失败保留父包及另一成功产物         | `concurrency-repair-progress.json`                                                              |
   | 模块、ZIP 与正式导入               | 五份专项包通过正式导入及逐文件读取                        | `macro-fixtures.json`                                                                           |
   | C011 整卡及双人设页面              | 当前 Skill 独立转换通过；两种开场与双人设共四个会话通过   | `C011-acceptance.json`、`conversions/C011-final/result.json`                                    |
   | 页面生命周期                       | 十次 runtime 挂载通过状态通知、消息通知、卸载和重新挂载   | `browser-acceptance.json`                                                                       |
   | 初值字符串                         | 十个实际会话的嵌套对象和数组均使用各自姓名与角色名        | `preview-acceptance.json`                                                                       |
   | 转换职责                           | 绑定请求由转换 Agent 提交，文件、入口及资料登记由命令生成 | `conversions/C011-final/commands.json`                                                          |

3. 实际 user-web 的十个专项会话已通过姓名、固定资料、初值、已保存开场消息及页面显示验收。当前 dry-run 输入只参与组装，`lastUserMessage` 仍为空；`lastMessage` 与 `lastCharMessage` 均显示已保存的开场。
4. 时间、随机和 UA 的精确文字使用受控输入验收；实际会话页面读取当前浏览器环境。

## 3. 五张随机角色卡

1. 抽取候选为 117 张本机角色卡。固定抽取结果为 C005、C063、C013、C072、C025，候选、种子及源文件路径保存在 `card-selection.json`。
2. 原始 PNG 的 begin 结果保存在 `original-begin-evidence.json`。C005 通过格式校验，其余四张因源结构字段缺失被拒绝。单独登记的合法测试输入仅补齐空结构字段，登记见 `positive-inputs.json`。
3. 独立转换和整卡联调结果如下。

   | 角色卡 | 独立转换结果                                               | 整卡联调结果                         |
   | ------ | ---------------------------------------------------------- | ------------------------------------ |
   | C005   | 源卡涉及未成年性内容，转换队员结束转换，未生成 ZIP         | 转换未完成                           |
   | C063   | 源卡涉及未成年性内容，转换队员结束转换，未生成 ZIP         | 转换未完成                           |
   | C013   | `format_message_variable` 返回 `UNKNOWN_MACRO`，未生成 ZIP | 转换未完成                           |
   | C072   | 合法测试输入生成 ZIP，包校验和 ZIP 校验通过                | 正式导入、双人设页面和刷新重挂载通过 |
   | C025   | 合法测试输入生成 ZIP，包校验和 ZIP 校验通过                | 正式导入、双人设页面和刷新重挂载通过 |

4. 逐卡转换轨迹保存在 `conversions/<卡号>/result.json` 和 `conversions/<卡号>/commands.json`。两份完整 ZIP 的四个实际会话证据保存在 `random-card-acceptance.json`。

## 4. 完整检查

1. 当前完整静态检查返回零错误及四项已有警告；工作区类型检查、Skill 类型检查、SDK 生成核对、文档构建和 user-web 的 96 项测试均通过。
2. 最终完整测试使用 maxWorkers=4、minWorkers=1 并保留原测试时限，600 个文件、6,357 项测试通过，3 个文件、4 项测试跳过；日志见 `final-full-tests-bounded.log`。

## 5. 尚未通过的补充验收

1. 本机 respond/stream 回放已保存正文，`pendingStateFloorId` 仍记录待更新楼层，`score` 保持初值。回放配置包含正文响应和状态更新响应，调用记录显示正文响应已被读取，状态更新响应尚未被读取。当前端到端状态更新验收尚未通过，证据见 `preview-stream-acceptance.json`。
2. 《Skill页面宏展开公共函数方案》第 8 节将宿主改动排除在本次范围之外。当前尚未确认该状态任务未执行的原因。
