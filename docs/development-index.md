---
文档用途: 作为开发文档导航入口，列出各主题的优先资料、实现依据和资料核对状态。
读取时机: 开始仓库开发或需要定位具体设计、接口、持久化和测试资料时读取。
---

<!-- markdownlint-disable MD013 -->

# 开发文档入口

1. 基线核对提交为 `5061b3cc2b0a1007beb59b7943cc61812255b83d`，
   核对日期为 2026-09-14。
2. 2026-09-14 的未提交文件清单见 `docs/provenance/sources.json`。

## 1. 状态含义

1. **已核对实现**：主题写明的范围已经与所列来源的代码、配置或测试对照。
   未单列来源的主题采用文首的基线核对提交；单列提交或工作区日期的主题采用所列来源。
2. **设计提案**：资料描述目标或路线，实施前仍需在当前代码中确认落点。
3. **待核对**：资料与所列代码来源存在差异，或验证证据尚未齐备。
4. 状态仅适用于主题写明的核对范围。Agent 采用资料前，必须读取任务涉及的接口、schema、测试和模块文档。

## 2. 主题导航

### 2.1 安装、配置与启动

1. 状态：**待核对**。2026-10-24 工作区的源码入口与确定性测试已核对；
   固定 Node.js 与 Nginx 的三环境运行结果尚待验收。
2. 优先读取[原生环境操作手册](environment-operations.md)。
3. 目录规范见根 `AGENTS.md` 的“三环境目录约定”节。
4. 实现入口为 `scripts/environments/cli.mjs`、本机配置 `config/environments.json`、公开模板 `config/environments.example.json` 和
   `apps/api/src/db/environment-command.ts`。
5. 软件版本分别由根 `package.json`
   和环境配置声明。验证范围与发布证据由操作手册说明。

### 2.2 系统分层

1. 状态：**已核对实现**。
2. 优先资料：`docs/architecture.md`、`docs/contributing.md`。
3. 实现证据：`apps/`、`packages/`、各包 `package.json`。
4. 核对范围：`apps/api`、`apps/web`、`apps/studio`、核心包和两个官方集成包的位置。
   架构文档中的具体运行语义仍需按对应模块代码确认。

### 2.3 公开 API 与客户端能力

1. 状态：**已核对实现**。
2. 优先资料：`vitepress/reference/`、`vitepress/sdk/`、
   `vitepress/guide/integration-kit.md`。
3. 实现证据：`apps/api/openapi/openapi.json`、`packages/official-integration-kit/`、
   `scripts/check-sdk-generated.ts`。
4. 核对范围：OpenAPI、SDK、client-helpers 及生成检查入口。
   具体路由与事件行为以当前 OpenAPI、源码和测试为准。

### 2.4 数据持久化

1. 状态：**待核对**。
2. 优先资料：`docs/database.md`。
3. 实现证据：`apps/api/src/db/schema.ts`、`apps/api/src/db/client.ts`、
   `apps/api/drizzle/`。
4. 核对范围：SQLite、Drizzle、schema 和迁移入口。数据字典把
   `0060_workspace_phase_5_agentic_readiness.sql` 写成最新迁移，基线迁移目录已到
   `0088_session_todo_list.sql`。

### 2.5 Studio 与 NodeGraph 演进

1. 状态：**待核对**。
2. 优先资料：`docs/nodegraph-studio-evolution.md`。
3. 实现证据：`apps/studio/src/modules/graph/`、`apps/studio/src/stores/graph-editor.ts`。
4. 核对差异：路线文档包含设计提案；控制边、schema v2、撤销重做、diff
   和服务端校验等未勾选项已出现实现证据。Agent 必须逐项对照代码后再采用清单状态。

### 2.6 原生角色包、编辑器与运行接入

1. 状态：**已核对实现**。2026-09-29 核对提交 `8f85a4fc`
   中的原生 ZIP、编辑器与正式运行接入。

2. 优先资料：[正式联调计划](plans/role-runtime-core/native-card-production-integration.md)、
   [原生包接口](plans/role-runtime-core/native-card-io.md)、
   [角色脚本 API](character-authoring/script-api.md)。

3. 原生包实现入口：`apps/api/src/routes/native-cards.ts`、`apps/api/src/services/native-card/`、
   `apps/api/src/services/native-card-runtime/`、`apps/web/src/features/native-card-editor/`。

4. 正文模型系统能力的来源为 2026-10-02 提交 `ca60aa0b`。
   能力配置、同轮结果和状态证据见[正文模型系统能力](character-authoring/model-capabilities.md)。实现入口为
   `apps/api/src/services/role-model-capabilities.ts`、核心系统能力提供者及正文编排；契约位于
   `packages/shared/src/schemas/role-model-capabilities.schema.json` 和
   `role-tool-evidence.schema.json`。

5. 共享包格式与文件规则分别位于
   `packages/shared/src/schemas/native-card-package/` 和
   `packages/shared/src/config/native-card-file-rules.json`；官方 SDK 通过
   `client.nativeCards` 调用。

6. 2026-09-29 已核对真实存储、固定版本、受控 SSE 和独立 ZIP 往返的实现入口。I01–I15 与视觉结果见[正式实现验收](plans/role-runtime-core/native-card-production-acceptance.md)。OpenRouter 免费模型的真实流程、语义失败及供应商错误见[外部模型验收](plans/role-runtime-core/native-card-openrouter-acceptance.md)。

### 2.7 状态任务提示词组装

1. **状态：已核对实现。** 核对日期为 2026-10-05，来源提交为
   `32df2e5d0354f76180f5cf742c99304d133d5e12`。
   核对范围为状态任务提示词绑定、来源读取、变量历史、请求组装和正式预览入口。
2. **资料：**
   [状态提示词组装](character-authoring/state-prompt-assembly.md)与[角色变量更新 API](character-authoring/state-update-api.md)。
3. **实现：**
   `apps/api/src/services/role-runtime/state-prompt-service.ts`、`apps/api/src/services/role-runtime/state-update-service.ts`、`apps/api/src/routes/role-view.ts`、`apps/api/src/services/chat/source-context.ts`、`apps/api/src/services/chat/chat-service.ts`、`apps/api/src/services/turn-commit-service.ts`、`apps/api/src/services/role-release-service.ts`、`apps/api/src/db/schema.ts`、`apps/api/drizzle/0103_state_prompt_and_source_context.sql`
   和 `packages/shared/src/config/state-prompt-sources.json`。正式预览使用
   `POST /sessions/:id/role-state/updates/dry-run`。
4. **核对依据：** `apps/api/src/routes/__tests__/state-prompt-assembly.test.ts`
   对两个状态预设、三种提示模式和五组变量历史组合执行预览与提交矩阵；`apps/api/src/services/role-runtime/__tests__/state-prompt-service.test.ts`
   验证分支祖先历史；`apps/api/src/services/__tests__/role-release-service.test.ts`
   核对发布配置保存预设覆盖和历史轮数；`apps/api/src/services/__tests__/turn-commit-service.test.ts`、`apps/api/src/services/__tests__/chat-service-session-state.test.ts`
   与 `apps/api/src/services/chat/__tests__/source-context.test.ts`
   核对正文来源上下文的事务保存、请求注入和按输出页读取。

### 2.8 测试、协作与文档

1. 状态：**已核对实现**。核对对象为 2026-10-24 工作区的检查命令和工作流入口。
2. 优先资料：`docs/testing-and-ci.md`、`docs/contributing.md`、
   `docs/documentation-standards.md`。
3. 实现证据：`package.json`、`.github/workflows/ci.yml`、各包测试文件。
4. 核对范围：lint、typecheck、test、SDK 生成检查和 docs build 命令。
   Agent 必须按改动范围执行项目规则要求的检查。

### 2.9 用户 Web

1. 状态：**已核对实现**。来源为 2026-10-20 提交 `48fdeb95`。用户 Web 位于
   `apps/user-web`，账号、公开角色和会话接口的消费路径见[功能依据](ixd/user-web/feature-basis.md)，运行与验收范围见[实现验收](ixd/user-web/implementation-acceptance.md)。
2. 设计入口：
   1. [阶段 1 产品背景](ixd/user-web/phase1-context.md)
   2. [阶段 2 信息架构](ixd/user-web/phase2-architecture.md)
   3. [阶段 3 任务流程](ixd/user-web/phase3-userflows.md)
   4. [阶段 4 页面交互规格](ixd/user-web/phase4-page-specs/README.md)
   5. [阶段 5 组件规范](ixd/user-web/phase5-components.md)
   6. [阶段 6 视觉设计](ixd/user-web/phase6-visual.md)
   7. [阶段 7 原型验收](ixd/user-web/phase7-review-master.md)
   8. [阶段 8 设计交付](ixd/user-web/phase8-document.md)
3. 规格入口：[用户 Web 需求规格](ixd/user-web/user-web-requirements.md)。
4. 术语入口：[用户演绎领域](../apps/user-web/CONTEXT.md)。
5. 原型入口见需求规格第 1 节，实现与验收入口见[需求规格第 5 节](ixd/user-web/user-web-requirements.md#5-当前实现与验收入口)，验收要求见第 6 节；设计阶段由
   [progress.json](ixd/user-web/progress.json) 记录。
6. 管理 Web 位于 `apps/web`；用户 Web 的设计产物位于 `docs/ixd/user-web`。

## 3. 按任务阅读

1. Agent 先读取根目录 `AGENTS.md`；探索代码时再按其入口读取领域文档。
2. Agent 从上述主题选择任务主题，读取优先资料并检查对应状态和差异。
3. Agent 在修改模块边界、持久化模型或公开协议前，核对所改模块的代码、测试与已有 ADR。
4. Agent 处理仓库代码或文档改动时，可以使用仓库级 `tavern-project-contributing`
   Skill。
5. Agent 处理客户端接入或升级时，可以使用仓库级 `tavern-client-integration`
   Skill。

## 4. 版本与来源

1. `docs/provenance/sources.json` 记录 2026-09-14 核对的本地基线、未提交文件和外部来源。
2. `docs/provenance/upstream/` 保存上游发布 JSON 的原始快照。
3. `docs/provenance/skill-mapping.json`
   记录上游工作流约束在本地 Skill 与项目文档中的对应位置。

4. 设计资料解释意图，代码与测试说明当前行为，用户已接受的任务要求确定任务目标。
   Agent 发现三者冲突时，必须记录具体差异和涉及文件，再依据任务目标修改代码或文档。
