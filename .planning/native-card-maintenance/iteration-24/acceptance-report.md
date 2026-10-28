---
文档用途: 报告本轮唯一转换的正确性、正式联调结果和耗时。
读取时机: 审阅本轮产物、判断验收范围或安排下一次改进时。
---

# 单次转换与正式联调验收

## 1. 验收范围和结论

1. 本轮仅派发一次干净上下文转换，输入为林茜v1.3.32的单个JSON。任务原文和完整路径见[single-trial/dispatch.json](single-trial/dispatch.json)；主代理未追加指导。
2. 原始转换的13项检查为5项通过、6项失败、2项未执行，逐项结论见[acceptance-result.json](acceptance-result.json)。原始ZIP未通过整卡验收。
3. 主代理另存修复副本用于定位和联调。修复副本通过正式导入、150文件回读及199项控制器分支检查；它不替代转换子代理的验收结果。
4. 本轮没有执行其余117项维护清单；原计划及两类已排除角色卡的决定继续有效。

## 2. 原始产物的问题及根因

1. 转换目标错误：Agent将源页面发送前的格式检查写入初始状态schema，提前拒绝尚未展开的人物宏。修复前转换validate漏检初始状态；共享正式导入检查后，同一产物返回四项准确诊断，见[复验结果](original-revalidate-after-fix.json)。
2. 初始化遗漏：Agent解析备用开场YAML后，没有应用后面的四个JSONPatch覆写操作。备用开场沿用了默认选项。
3. 原文改写：Agent使用摘要替换了选项序号的用途、条件和格式；源世界书条目`/data/character_book/entries/109`中的三条有效业务约束没有原文写入状态规则。
4. 应删除内容保留：Agent将终局规则摘要无条件追加到状态规则文件，绕过源控制器的E032条件。源条目和条件控制器本身已经保留。
5. 前端转写不完整：Agent只交付状态栏，遗漏宿主正文、输入和恢复入口。主代理挂载系统聊天组件后，失败回复可以重试；选项内部锁仍未随重试成功解除，按钮再次点击无效。
6. 读取范围违规：Agent搜索整个.tmp目录，取得旧任务片段，见[读取证据](single-trial/out-of-scope-read.json)。本次任务消息已给出完整输入路径，begin也返回完整路径。当前证据证明越界读取，没有证明复制旧产物。主代理核对1049份只读副本，未发现子代理越界写入，见[边界核对](single-trial/boundary-final.json)。

## 3. 正式联调证据

1. 修复副本的[正式请求与回读](full-acceptance/formal-result.json)记录150个ZIP文件通过导入和逐文件内容比较；[controller-results.json](controller-results.json)记录199项源控制器分支对照。
2. [状态dry-run](final-requests/state-dry-run.json)返回独立状态预设、源规则、更新前值、本轮两条消息证据、一轮变量更新历史及输出schema。完整聊天历史进入实际messages；条件未成立时，105条目的完整正文没有进入请求。
3. 正式页面的[正文与输入截图](final-browser/visible-chat-stabilized.png)、[双击发送锁](final-browser/option-send-2.json)、[历史选项](final-browser/history-final.json)、[画廊滚动与弹窗](final-browser/gallery-final.json)保存了实际运行结果。源图片外链未能加载，资源内容验收失败；保留原URL。
4. [预设失败](final-browser/forced-failure-3.json)后，系统聊天组件的[重试结果](final-browser/widget-recover-3.json)成功；[选项再次点击](final-browser/options-after-recovery-click.json)未发出新请求，确认内部锁问题。
5. 本轮真实模型调用共5次；三次包含用量的供应商响应记录费用为0，两次错误响应没有返回用量。第一次因主代理传错模型槽参数，实际输出额度为313个token，供应商以length结束且正文为空。纠正参数后，第二次生成1013字正文；正文使用第三人称，用户继续在后窗观察，没有JSONPatch块，见[实际正文](live-2-response-body.txt)。
6. 第三次状态模型调用失败：供应商HTTP200正文内返回400，明确指出不支持JSON schema的uniqueItems；正式状态接口返回500及Invalid JSON response，见[供应商响应](full-acceptance/live-3-response.json)。本轮没有取得状态模型提案，也没有完成[跨轮完成条件与标签范围](../iteration-23/main-acceptance-cases.json)中的F01、F02真实模型语义验收。

7. 主代理另建隔离会话，使用openrouter/free验证现有模型。第一次请求因关闭推理被拒绝，见[参数错误](alternate-provider-acceptance/live-1-response.json)；改为low后，入口选中cohere/north-mini-code:free，模型以length结束且结果为空，见[供应商结果](alternate-reasoning-acceptance/provider-result.json)。正式接口返回422，快照和值均保持原样，见[状态结果](alternate-reasoning-acceptance/state-result.json)。这两次测试使用重放正文及真实状态模型，未验证F01、F02。

## 4. 执行效率

1. 子代理执行时间为54分41秒。begin返回至最后一次内容写入为52分46秒，超过20分钟生成目标；完整转换超过30分钟目标。
2. 99次工具调用累计约3分7秒，占执行时间约5.7%；工具返回至下一次调用的最长间隔为19分3秒。时间主要耗在Agent分析、重复阅读和生成代码，正式验收由主代理另行执行。
3. Agent重复读取已复制字段、并行调用覆盖同一输出文件的read命令，再串行重读；begin输出也被宿主截断。Agent临时生成约36KB的Python代码，并再次提交相近代码。计划执行者可改进读取结果的独立保存，并补充初始化覆写操作。
4. 宿主记录累计输入15,408,572个token，其中14,813,184为缓存输入；输出123,526个token。该记录是宿主用量统计，不代表全部输入按非缓存计费，见[公开执行记录](single-trial/public-execution-final.json)。
5. 主代理从转换结束至最终模型复核完成共经过58分30秒；本轮维护从开始至该时点共经过2小时26分。检查与审阅在这些阶段内并行执行。阶段起止时间保存在execution.json。最终全量测试在低并发下6027项通过、4项跳过，耗时618.81秒，包含新增共享初始状态检查；转换目录740项联调测试通过。

## 5. 已修复内容与剩余事项

1. 加载器按入口静态依赖收集模块，世界书条目不再因同属JSON资源而全部计入模块额度；现有限额保持原值。
2. 正式服务与转换validate共用状态schema、factsSchema和开场初始状态检查。转换工具现在提前报告本次正式导入失败的原因。
3. Skill内置状态API已同步；语义参考已补充选项用途保留、宿主聊天承接和宏展开后的发送检查。独立规范审阅与需求审阅未发现必须修复项。
4. 读取界面、初始化覆写工具及发送锁回调的改进见[next-improvement-plan.md](next-improvement-plan.md)。真实状态模型的供应商schema兼容性尚未通过，本轮没有修改正式接口或删除schema约束。
