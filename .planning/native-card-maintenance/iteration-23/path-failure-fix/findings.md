---
文档用途: 记录本次路径错误与失败误报的具体根因。
读取时机: 主代理核对修复范围或验收结果时。
---

# 路径错误与失败误报

## 1. 路径错误

1. 原 prepareTarget 拒绝所有绝对路径，本次转换 Agent 传入了 packageDirectory 内的绝对目标路径，133次调用均失败。

## 2. 失败误报

1. 原 printResult 在异常时返回 error 并退出1；转换 Agent 的汇总只统计 issues 和 remaining，未处理 error 和退出状态，将失败误报为零问题。
