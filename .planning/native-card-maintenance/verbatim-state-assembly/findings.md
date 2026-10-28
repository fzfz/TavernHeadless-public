<!-- markdownlint-disable MD013 -->

# 本次发现

本文件供维护者定位当前错误及可复用的系统入口。

## 原文承接

原 Skill 的“改写为目标表达”“最小可编辑实现”和装饰删除说明，与本次原文保留要求冲突。修订文件及原文在 `scope.json` 和 `before/` 中保存；转换记录与实际消费者内容分别定义。

## 状态组装

`StateUpdateService.prompt/generate` 直接拼接包内指令、规则与 JSON 数据，没有调用正文使用的系统组装器。`assemblePrompt` 已有预设覆盖、历史、世界书、宏、预算和 contributor 入口；状态接入需要增加绑定及状态数据源。

`DisplaySnapshotService.listPage` 按快照分页，前 n 轮变量历史必须另外按有效聊天楼层组织。主代理在 `architecture-proposal.md` 定义上下文检查，在 Skill 验收说明中要求核对转换原文；真实模型理解作为后续验收项，本次未执行。
