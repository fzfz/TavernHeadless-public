---
文档用途: 保存测试归属调查证据与现有覆盖对应关系。
读取时机: 核对迁移范围和测试覆盖时。
---
# 调查记录

## 1. 已确认事实

1. 7772307提交了mvu-regressions.test.ts；其导入的mvu-schema.ts和mvu-state.ts保存在原工作区的网页原型目录，Git状态为未跟踪。
2. 网页原型converter.ts调用prepareMvuState()，后者调用compileMvuSchema()。Skill生产代码使用自己的状态写入命令。

## 2. 原型用例与Skill覆盖

1. 原型第1至4项用例验证Zod数值转换、有限值判断及生成代码执行顺序，保留在原型测试。
   Skill的state-write-constraints.test.ts验证目标JSON Schema的数值类型和边界。
   本次已补充整数约束拒绝小数、数值低于下界时校验失败，以及数值等于上下界时校验通过的用例。
2. 原型第5项用例验证MVU迁移时处理条目开关，保留在原型测试。
   Skill由Agent选择条目用途，map-entry测试验证脚本按选择写入条目。
3. 原型第6至9项用例验证InitVar识别、开场覆盖、错误内容和多初值选择，保留在原型测试。
   Skill由Agent选定初值来源，state-write.test.ts验证各开场初值、Schema一致性和源字段覆盖；write-parse.test.ts验证选定原文的解析与替换。

## 3. 交付验证环境

1. 交付工作区的源码来自40601ef和本次修改；网页原型实现仅保留在原工作区。
2. 验证环境复用本机已安装的外部依赖；仓库内各包由交付工作区的源码构建，包链接指向交付工作区中的对应包。
