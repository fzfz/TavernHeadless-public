<!-- markdownlint-disable MD013 -->

# 原型人设与宏处理核查

## 正式后端已有能力

正式后端的 `prompt-runtime/macro/context-builder.ts` 从会话人设快照和角色数据建立 `user`、`char`、`persona` 等宏值；`st-macros/runtime.ts` 执行宏并返回展开结果、警告及暂存写入。正式 `turn-commit-service.ts` 接收 `macroStagedMutations`，处理对应变量变更。[宏上下文](../../apps/api/src/services/prompt-runtime/macro/context-builder.ts#L215)、[宏执行](../../apps/api/src/services/st-macros/runtime.ts#L681)、[提交](../../apps/api/src/services/turn-commit-service.ts#L698)。

正式 `/users` 保存演绎人设；`POST /sessions` 支持 `user_id`、`user_snapshot` 和各资源版本绑定。[人设接口](../../apps/api/src/routes/users.ts#L273)、[会话字段](../../apps/api/src/routes/sessions.ts#L67)。因此，人设选择和基本身份宏属于已有能力的接入工作。

## 当前原型各阶段

| 阶段 | 实际实现 | 当前边界 |
| --- | --- | --- |
| 人设绑定 | `bound-prompt.mjs` 把 `bundle.performer` 写入 `userSnapshotJson`。 | 原型未读取用户选择的 `/users` 资源。 |
| 林茜正文 | `bound-prompt.mjs` 调用正式 `assemblePrompt`，传入固定人设、角色快照、预设及变量上下文。 | 该阶段复用现有宏引擎；不能据此声明所有角色和阶段都已接通。 |
| 开场 | `import-openings.js` 在启动导入时用 `performerName` 替换 `{{user}}`。 | 该文件没有调用完整宏引擎；开场与所选会话人设尚未联动。 |
| 顾声慢正文 | `openrouter-live.mjs` 的非绑定分支直接组合 `narratorPrompt`、变量和历史。 | 未经过与林茜相同的正式提示词组装流程。 |
| 变量更新 Agent | `openrouter-live.mjs` 直接拼接 `updaterPrompt` 与 `rulesText`。 | 这条路径没有调用正式宏引擎。 |
| 宏变量写入 | `bound-prompt.mjs` 保留组装 trace，但专用服务将结果提交到内存对象。 | 未把宏暂存写入交给正式提交服务，不能由文本展开成功推断写入成功。 |
| 未知宏 | 正式宏执行器产生 `macro_unknown` 警告并保留原始宏文本。 | 原型测试检查过林茜当次请求无未知宏；这不是所有预设、开场和分支的覆盖证明。 |

源码依据：[原型组装](../../apps/web/prototypes/checks/bound-prompt.mjs#L101)、[开场导入](../../apps/web/prototypes/shared/import-openings.js#L21)、[正文分支](../../apps/web/prototypes/checks/openrouter-live.mjs#L248)、[更新请求](../../apps/web/prototypes/checks/openrouter-live.mjs#L371)、[原型提交](../../apps/web/prototypes/checks/serve-script-prototype.mjs#L1172)、[未知宏](../../apps/api/src/services/st-macros/runtime.ts#L1001)、[已有局部检查](../../apps/web/prototypes/checks/bound-prompt-unit.mjs#L51)。

## 接入与验收依据

后端和前端负责人的纠正工作由[开发计划 C1–C6](../plans/role-app-dual-web-plan.md#原型后端接入约束与纠正任务)定义。验收负责人必须通过正式会话和生成接口检查不同人设、不同开场下的宏展开值、变量写入结果及失败后的变量状态。当前核查没有逐个执行宏，也没有验证所有正则替换宏和所有原卡分支。
