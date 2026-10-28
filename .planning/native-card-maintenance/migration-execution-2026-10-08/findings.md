---
文档用途: 记录本轮发现的问题、证据与处理结果。
读取时机: 开始执行、阶段切换及上下文压缩后。
---

# 问题记录

## 1. 工作区基线

1. 目标工作区存在执行前修改，副本位于 before，Git 差异位于 initial-diff.patch。
2. [历史执行进度](../next-improvement-execution-2026-10-08/progress.md)第82、83章表明此前修改已回滚，本轮从统一迁移开始。

## 2. 工具读取

1. 首次批量读取输出被截断；后续按文件和章节读取。

## 3. 迁移路径验证

1. 专用测试发现了测试夹具中保留的旧runtime.json目录，错误为 ENOENT；已将夹具目录同步到Skill。
2. Vitest可以发现Skill隐藏目录中的测试，当前无需增加测试发现规则。

## 4. 测试重跑

1. preview.test.ts 的预设夹具路径仍按旧层级定位，已同步调整；正式导入的首次超时未在单独复跑中出现。

## 5. 清单展开

1. 初次内容对照将fixtures目录当作文件读取，出现IsADirectoryError；现已递归枚举文件并生成完整清单。

## 6. C078正式预览输入

1. 验收启动脚本首次使用错误的模块相对路径，已按记录目录层级修正。
2. C078未配置变量更新任务，主Agent的初始场景却绑定状态预设，正式接口返回ROLE_RELEASE_STATE_PROFILE_MISSING。已移除测试场景中的状态预设后重试；原始请求和响应保存在C078/acceptance/preview-runs。

## 7. C043显示行为

1. 包内保留的后台日志正则将带summary的details块替换为“后台日志已封录”。离线回复经正式发送后，role-messages接口返回的summary标签已被移除，页面显示draft_notes与details原文；证据为C043/acceptance/message-responses.json和page-after-send.txt。
2. 此项未通过。下一步核对保存正文、公开正文处理和聊天组件的正则消费路径，区分宿主处理与转换缺失。

## 8. 宿主显示处理依据

1. C043模型调用记录中的原文含summary标签，保存的message.content已移除该标签，公开role-messages响应与保存正文一致。
2. packages/core/src/generation/generation-pipeline.ts第140行在后处理前调用extractSummaries；summary-extractor.ts默认移除summary标签。apps/user-web/src/features/chat/session-controller.ts第685行使用textContent显示正文。
3. C043显示失败涉及上述宿主行为，原始测试包保持不变；修复范围由用户决定。

## 9. HTML 标题与摘要提取冲突

1. C043源世界书条目13第2.7节提供details与summary结构，显示正则匹配整个后台日志块；这套格式来自源卡。验收回复中的简短日志正文由主Agent填写。
2. 用户已授权转换时重命名这类冲突标签，并同步处理关联引用与显示行为。主Agent将在当前独立转换结束后修改Skill，再从源卡重新测试。

## 10. C011误判能力缺口

1. [前端API](../../../.agents/skills/native-card-conversion/references/api/script-api.md#123-apidataget--读取角色预置数据)第12.3节明确提供api.data.get("performerName")，role-view-service.ts第137行写入绑定姓名；独立转换队员仅查阅到第10章，遗漏该入口。
2. display-snapshot-service.ts的initialize方法展开初值字符串宏；C034正式预览中的地址已展开为裴修远。C011停止依据不成立，原始产物保持不变。

## 11. 新版C043复测

1. 新队员识别summary是显示标题，提出同步改写标签和正则；随后确认公开消息显示入口缺少角色显示正则消费，按Skill第5.2节停止。证据为C043-tag-retest/result.json。
2. 正式摘要提取器的原标签与新标签对照结果保存在tag-extraction-comparison.json；新标签内容未被提取。

## 12. 迁移代码检查

1. tool.test.ts迁移后的长路径已格式化；入口夹具的重复目录创建已合并，9项入口测试通过。

## 13. C034状态请求

1. 状态dry-run首次缺少expected_snapshot_id，接口返回400；已按正式schema补齐参数，重试返回200，证据为C034/acceptance/state-dry-run.json。

## 14. USER002转换停止

1. 停止依据及源事件字段矛盾保存在USER002/result.json，运行验收未完成。
