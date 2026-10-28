<!-- markdownlint-disable MD013 -->

# 第三批补充计划：Agent 模型调用记录

## 必须要实现的目标

执行 Agent 必须在[分批总计划](generation-trace-foundation.md#批次安排与独立可视验收)第三批，将 Director、Verifier 和记忆处理 Agent 的实际模型请求接入已有 `model_call_records` 表及调用查询链。本文件细化第三批的 Agent 记录工作；任务关系、公开状态和记忆注入的其他要求继续引用总计划。

楼层是数据库中承载会话轮次的记录，来源楼层指触发任务的轮次所对应的楼层。

Director 是生成叙事指令的模块，Verifier 是检查生成内容一致性的模块；本文件的记忆处理 Agent 包括记忆摄取、压缩与整合模块中实际调用模型的路径。

### 接入对象与产物

| 执行 Agent 必须检查和修改的对象 | 动作与产物 |
| --- | --- |
| `packages/core/src/orchestration/director.ts`、`verifier.ts`、`turn-orchestrator.ts` | 为 Director 和 Verifier 的模型请求传入独立记录上下文，关联所属轮次、运行、生成尝试及调用用途。产出对应实现和测试。 |
| `packages/core/src/memory/memory-ingest-processor.ts`、`memory-compaction-processor.ts`、`memory-consolidator.ts` | 为记忆摄取、压缩和整合的每次模型请求传入记录上下文，关联所属任务及来源。产出三类处理器的实现和测试。 |
| `apps/api/src/services/orchestration-factory.ts`、`chat/turn-memory-service.ts`、`memory-runtime-job-processor.ts`、`memory-maintenance-service.ts` | 沿实际调度入口传递记录依赖和任务来源，覆盖同步、后台和任务重试路径。执行 Agent 必须核对这些入口调用的其他记忆服务，并将其实际模型调用纳入接入清单。 |
| `packages/shared/src/schemas/model-call.ts`、`packages/core/src/llm/model-call-recorder.ts`、`apps/api/src/services/model-call-record-service.ts`、`db/model-call-schema.ts` | 在共享 schema 统一定义 Agent 用途、任务及来源关联，按实际需要扩展已有存储与记录接口。异步任务在来源轮次完成后仍能保存调用；独立记忆维护任务按其实际会话和任务范围保存，来源楼层在确实存在时关联。 |
| `apps/api/src/routes/model-calls.ts`、`packages/official-integration-kit/sdk/src/resources/`、`apps/web/src/pages/GenerationDetailView.vue` | 扩展查询契约及管理端展示，按轮次或任务定位 Agent、尝试和逐次调用，展开请求、响应及错误。任务跨多轮时，展示全部实际来源关系。产出 OpenAPI、SDK、页面实现和接入文档。 |

执行 Agent 必须在实施前逐项登记上述模块中的模型调用入口、启用条件、记录上下文来源和对应测试，使用该清单核对覆盖范围。纯脚本计算和工具执行按任务或工具记录保存；只有进入供应商请求边界的模型调用才生成模型请求记录。

### 记录粒度与保存规则

执行 Agent 必须复用[首批调用记录契约](generation-trace-batch-1.md#调用记录与查询契约)和[保存顺序与失败传播](generation-trace-batch-1.md#保存顺序与失败传播)。一条记录对应一次实际供应商请求；同一楼层、任务或生成尝试内的多次请求分别保存，供应商重试与任务重试保留各自关联。数据库写入重试继续更新原调用记录。

请求体、模型参数、工具定义、原始响应或流式累计响应、用量、错误及时间字段采用总计划[已确认的完整目标](generation-trace-foundation.md#已确认的完整目标)。Agent 的任务成功、模型请求成功与结果实际提交必须分别表达；已有失败记录在后续重试成功后继续可查。

### 实施顺序

1. 执行 Agent 登记调用入口及同步、后台任务来源，明确无来源楼层和多来源轮次的现有场景，完成共享关联契约。
2. 执行 Agent 接通表中各类调用和依赖传递，完成记录、失败传播及重试测试。
3. 执行 Agent 同步查询接口、OpenAPI、SDK 和管理端详情，与第三批任务关系展示同步实现并关联调用记录。
4. 执行 Agent 完成下列专项验收及总计划第三批联合验收，将逐项结果保存到 `docs/plans/evidence/generation-trace/batch-3/`。

## 验收清单

- [ ] 调用入口清单中的 Director、Verifier、记忆摄取、记忆压缩和记忆整合路径均有正常请求测试；实际请求次数与独立调用记录数量一致，每条记录可定位到 Agent 用途及真实来源。
- [ ] 同一楼层内包含多个 Agent 调用及同一 Agent 多次调用时，各次请求与响应分别可查，正文和角色变量更新的原有记录保持可查。
- [ ] 各接入路径覆盖供应商错误、超时、取消、响应解析失败和适用的重试分支；失败记录保留已收到内容与错误。供应商重试、任务重试和数据库写入重试按“记录粒度与保存规则”核对。
- [ ] 请求保存失败时尚未发送模型请求；结果保存失败时错误沿调用链传回任务或轮次；模型成功但 Agent 结果校验或提交失败时，页面能分别显示两种结果。
- [ ] 来源轮次已结束的后台任务仍能保存调用；独立记忆维护任务及多来源任务能按其实际范围查询。禁用、跳过或通过纯脚本完成的步骤，其模型调用数量符合实际发送次数。
- [ ] 管理端可从轮次详情进入关联任务并逐次展开请求和响应；独立任务具有可用的查询入口。失败后重试、页面刷新及服务重启后，历史记录与关联保持一致。
- [ ] 记忆提交后继续下一轮，执行 Agent 通过 dry-run 阅读实际注入内容，核对其来源任务和模型调用；需要判断真实回复时，按仓库演绎验收规范及已有模型授权采样。
- [ ] 执行 Agent 使用合成供应商响应、故障注入及响应重放验证确定性逻辑；真实模型测试按已有授权执行，分别记录离线验证与真实生成结论。
- [ ] 受影响模块的测试、类型检查、Lint、构建、SDK 生成检查及文档检查通过；总计划第三批的两端联合验收完成，新增文档与文案通过独立语义审阅。

## 非本次目标

本轮只补充计划，业务实现属于第三批。新增 Agent 业务能力、替换既有记忆算法、补造旧请求历史、登录与会员权限方案均留待用户另行确定需求。持续实时展示与执行中重新连接按总计划第四批实施。

## 已获得的授权

用户已明确要求将 Director、Verifier 和记忆处理 Agent 的调用记录接入工作补入后续计划。本轮授权产物为本补充计划及分批总计划中的对应安排；第三批业务实现按用户后续的执行指令开展，依赖安装和外部程序启动按已有授权或专项授权执行。
