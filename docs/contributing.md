---
文档用途: 说明仓库分层、开发协作和交付要求。
读取时机: 开始修改仓库或准备提交时读取。
---

# 协作指南

## 目录

1. [开发环境](#1-开发环境)
2. [项目结构与分层](#2-项目结构与分层)
3. [依赖方向与公开边界](#3-依赖方向与公开边界)
4. [官方集成层协作规则](#4-官方集成层协作规则)
5. [开发工作流](#5-开发工作流)
6. [Commit 与分支规范](#6-commit-与分支规范)
7. [Pull Request 流程](#7-pull-request-流程)
8. [代码风格](#8-代码风格)
9. [文档维护规则](#9-文档维护规则)
10. [验证要求](#10-验证要求)
11. [Issue 与发布](#11-issue-与发布)

---

## 1. 开发环境

1. 按[原生环境操作手册](environment-operations.md)安装固定软件、初始化 dev 并配置独立密钥。
2. 环境目录遵循根 `AGENTS.md` 的“三环境目录约定”。
3. 从 dev 根目录执行 `node scripts/environments/cli.mjs --help` 查看统一入口。
4. 验证要求见[第 10 节](#10-验证要求)。

## 2. 项目结构与分层

```text
TavernHeadless/
├── apps/
│   ├── api/
│   ├── web/
│   ├── user-web/
│   └── studio/
├── packages/
│   ├── core/
│   ├── adapters-sillytavern/
│   ├── shared/
│   └── official-integration-kit/
│       ├── sdk/
│       └── client-helpers/
├── docs/
├── vitepress/
├── scripts/
└── README.md
```

### 分层说明

1. `packages/core`：纯引擎逻辑。
1. `packages/adapters-sillytavern`：兼容导入与兼容编排。
1. `packages/shared`：内部共享类型、OpenAPI 生成物、类型化 API Client。
1. `packages/official-integration-kit/sdk`：官方第一方 HTTP / SSE
   / 错误 / 资源接入层。
1. `packages/official-integration-kit/client-helpers`：官方第一方语义辅助层。
1. `apps/api`：Fastify 后端服务，对外提供 API。
1. `apps/web`：Vue 管理前端。
1. `apps/user-web`：角色浏览、用户登录和演绎前端。
1. `apps/studio`：以 NodeGraph 编辑器为核心的实验前端。
1. `docs`：仓库级文档。
1. `vitepress`：文档站。
1. `scripts`：根脚本。

---

## 3. 依赖方向与公开边界

### 依赖方向

1. 必须遵守下面的依赖方向：

   ```text
   apps/api  ──→  packages/core  ──→  packages/shared
      │               │
      └──────────→  packages/adapters-sillytavern ──→ packages/shared

   apps/web  ──→  packages/official-integration-kit/*
   apps/web  ──→  packages/shared
   ```

### 几条硬规则

1. `packages/core` 不允许依赖 `apps/api`、`apps/web` 或任何前端框架。
1. `packages/shared` 不允许依赖 `core` 或
   `adapters-*`。`packages/shared` 只放共享类型、内部工具和生成物。
1. `apps/api` 可以依赖 `core`、`shared`、`adapters-*`。
1. `apps/web` 的可复用接入逻辑遵循[第 4.4 节](#44-可复用逻辑的归属)。
1. 依赖方向只能是 `apps -> packages`，不能反过来。

### 公开边界

1. 官方公开接入包为 `@tavern/sdk` 和 `@tavern/client-helpers`。
2. `@tavern/shared` 用于内部共享类型、工具和生成物。
3. 新增公开接入能力必须放入第 1 项所列包之一，不得另建官方接入包。

---

## 4. 官方集成层协作规则

### 4.1 官方集成层的职责

#### `@tavern/sdk` 的职责

1. HTTP 请求
1. 默认请求头
1. 错误归一化
1. SSE 读取
1. 第一方资源包装

#### `@tavern/client-helpers` 的职责

1. usage 归一化
1. timeline 构建
1. 流式状态 reducer
1. active page 选择
1. API 错误到界面状态的映射

### 4.2 不允许混淆边界

1. 不允许把下面这些内容放进官方包：
   1. Vue 组件
   1. React hooks
   1. Pinia store
   1. Zustand store
   1. TanStack Query 绑定
   1. 只服务于一个页面的界面逻辑

### 4.3 公开行为变更后的同步核对

1. 下列内容发生变化时，必须同时核对第 2 项：
   1. 核心引擎的对外可见行为
   1. `apps/api` 的路由、请求体、响应体、错误语义
   1. SSE 事件结构
   1. OpenAPI 生成结果
   1. Tool Calling 或 MCP 的接入语义
   1. 会影响 `apps/web` 已迁入官方包的逻辑

2. 判断以下内容是否需要同步改动：
   1. `@tavern/sdk`
   2. `@tavern/client-helpers`
   3. 包内文档和外部文档

### 4.4 可复用逻辑的归属

1. 新增或调整下列逻辑时，必须按[第 4.1 节](#41-官方集成层的职责)判断归属。
   1. 多个接入方共用的逻辑。
   2. 客户端接入与后端资源读写。
   3. HTTP 请求、SSE 解析与归一化、通用错误映射。
   4. 与框架无关的 timeline、usage 和流式状态处理。

2. 属于官方包职责的逻辑必须在对应包中维护。

### 4.5 文档同步顺序

1. 只要官方包发生变化，文档更新顺序应保持一致：
   1. 先更新包内文档
      1. `packages/official-integration-kit/sdk/README.md`
      1. `packages/official-integration-kit/client-helpers/README.md`
   2. 再更新外部文档
      1. `vitepress/guide/integration-kit.md`
      1. `vitepress/guide/introduction.md`
      1. `vitepress/reference/api.md`
      1. `README.md`
   3. 如果边界、流程或协作方式也变了，再更新协作文档
      1. `docs/contributing.md`
      1. `vitepress/development/contributing.md`
      1. `.github/CONTRIBUTING.md`

### 4.6 `apps/web` 的处理原则

1. `apps/web` 可保留以下界面逻辑：
   1. 组件和页面逻辑。
   1. 本地表单状态。
   1. 只在一个界面里使用的显示映射。
   1. 菜单和交互行为。
2. 可复用逻辑的归属见[第 4.4 节](#44-可复用逻辑的归属)。

---

## 5. 开发工作流

### 分支结构

```text
main
 └── dev
      ├── feat/xxx
      ├── fix/yyy
      └── chore/zzz
```

### 分支职责

1. `main`：稳定发布分支，仅接受 `dev → main` 的 PR。
2. `dev`：日常集成分支，接受功能、修复与维护分支的 PR。
3. `feat/*`、`fix/*`、`chore/*`：开发者从 `dev` 创建并维护的功能、修复与维护分支。
4. 维护者确认 `dev` 的代码交付验证通过后，按第 1 项发起集成 PR。

### 日常流程

1. 从 dev 拉新分支
2. 在分支上开发
3. 按[分支职责](#分支职责)提交 PR
4. PR 作者按[第 10 节](#10-验证要求)执行适用验证。
5. 评审者按[第 7 节](#7-pull-request-流程)审阅 PR。
6. 维护者在所需 CI 通过且评审批准后合并 PR。
7. PR 作者删除已合并的功能、修复或维护分支。

### main 合并后的 dev 安全回补

1. 同步入口为[dev 同步工作流](../.github/workflows/sync-dev-with-main.yml)。
2. 仓库管理员在 `Settings → Actions → General → Workflow permissions`
   启用 `Allow GitHub Actions to create and approve pull requests`。
3. 仓库管理员启用 `Allow auto-merge`，供同步 PR 在所需检查通过后自动合并。
4. 维护者在 Actions 中查看同步结果，处理失败作业。

### 禁止事项

1. 不要直接推送到 `main` 或 `dev`
1. 不要在共享分支上强制推送
1. 不要把无关改动塞进同一个 PR
1. 不要把代码改动和本应同步更新的文档拆成两个长期分离的 PR

### GitHub 分支保护（Ruleset）

1. 仓库通过 GitHub Rulesets 保护 `main` 和 `dev`，规则如下：
   1. 禁止删除分支
   1. 禁止 non-fast-forward push（即禁止 force push）
   1. 所有改动必须通过 PR 合入
   1. PR 合入前必须通过仓库规则要求的检查。检查命令与结果处理见
      [测试与 CI 第 7 节](testing-and-ci.md#7-ci-流水线)，作业定义见
      [CI 工作流](../.github/workflows/ci.yml)。

---

## 6. Commit 与分支规范

### Commit 格式

1. 使用 Conventional Commits：

   ```text
   <类型>(<范围>): <描述>
   ```

### 类型

| 类型       | 用途             |
| ---------- | ---------------- |
| `feat`     | 新功能           |
| `fix`      | 修复问题         |
| `refactor` | 重构             |
| `docs`     | 只改文档         |
| `test`     | 只改测试         |
| `chore`    | 构建、依赖、配置 |
| `style`    | 格式调整         |
| `perf`     | 性能改进         |

### 范围

1. 建议直接使用真实模块名。常见范围：
   1. `core`
   1. `api`
   1. `web`
   1. `shared`
   1. `sdk`
   1. `client-helpers`
   1. `integration-kit`
   1. `docs`
   1. `mcp`
   1. `tools`
   1. `memory`
   1. `llm`

### 示例

```text
feat(sdk): add exports tools and mcp resources
fix(api): keep tool permission patch merge semantics
docs(integration-kit): refresh sdk surface and collaboration rules
refactor(web): migrate workspace api callers to sdk resources
```

### 分支命名

```text
<类型>/<简短描述>
```

1. `feat/sdk-batch4-resources`
1. `fix/mcp-status-mapping`
1. `docs/integration-kit-refresh`
1. `refactor/web-use-sdk-resources`

---

## 7. Pull Request 流程

### PR 标题

1. 与 commit 一样使用 Conventional 格式。

### PR 描述至少应说明

1. 做了什么
1. 为什么要做
1. 影响了哪些模块
1. 如何验证
1. 是否更新了文档
1. 是否影响了官方包边界

### 如果涉及引擎、后端契约或官方包，请额外说明

1. 是否影响 `@tavern/sdk`
1. 是否影响 `@tavern/client-helpers`
1. 是否影响 `apps/web`
1. 是否影响 OpenAPI 生成物
1. 是否需要迁移已有接入代码

### 如果 PR 只改文档

1. 在 PR 描述中写明文档改动范围，并记录[第 10 节](#10-验证要求)的验证结果。
2. CI 触发条件和结果见[测试与 CI 第 7 节](testing-and-ci.md#7-ci-流水线)。

### Review 规则

1. 每个 PR 至少需要 1 人 approve 才能合并
1. 评审者将存在争议的设计问题整理为独立讨论，并在 PR 中引用讨论结论。
1. 合并方式优先使用 `Squash and Merge`

---

## 8. 代码风格

### 基本原则

1. TypeScript 使用严格模式，类型约束以现有 ESLint 配置为准。
1. 代码格式以现有 Prettier 配置为准。
1. 同一概念使用同一名称。
1. 新增资源包装沿用既有方法名：`list`、`getDetail`、`create`、`update`、`remove`。

### 概念命名边界

1. `Runtime` 只用于平台层运行时能力及其既有公开面，例如
   `Background Job Runtime`、`Mutation Runtime`、`runtime_job`、`runtime_scope_state`、`/sessions/:id/tools/runtime`。
1. `Run` 用于聊天业务流程中的一次业务运行快照，例如
   `floor run`、`active run`、`runId`、`runType`、`attemptNo`。
1. `Execution` 用于运行中的子级执行记录，例如
   `tool execution`、`tool_execution_record`。
1. 临时对话的类型与服务统一使用 `TemporaryConversation` 命名，不要写成
   `TemporaryConversationRuntime`、`TemporaryConversationRun` 或
   `TemporaryConversationExecution`。
1. 新增命名不得把这三层概念混用。尤其不要用 `runtime`
   命名 turn 进度快照、楼层进度接口或其持久化表。

### 命名风格

1. 文件名：`kebab-case`
1. 类型、接口、类：`PascalCase`
1. 变量、函数：`camelCase`
1. 常量：`UPPER_SNAKE_CASE`
1. 数据库表与列：`snake_case`
1. API 协议字段：以后端为准，通常是 `snake_case`
1. SDK 对外返回字段：遵循当前资源文件的映射风格

### 导入顺序

```ts
// 1. Node.js 内置模块
import { readFile } from "node:fs/promises";

// 2. 第三方库
import { eq } from "drizzle-orm";

// 3. 仓库内部包
import type { OpenApiPaths } from "@tavern/shared";

// 4. 当前包内相对导入
import { mapRecord } from "./utils.js";
```

### 注释

1. 不写重复代码含义的注释
1. 注释主要说明为什么这样做
1. 公共 API 和复杂逻辑使用 JSDoc
1. 协议兼容、返回语义保持、历史包袱处理要写清楚原因

---

## 9. 文档维护规则

### 文档放置位置

1. 仓库级文档：`docs/`
1. 文档站页面：`vitepress/`
1. 包级说明：各自包目录下的 `README.md`
1. 对外入口：根 `README.md`

### 文档更新的硬要求

1. 出现下面任意情况，必须更新文档：
   1. 改了公共 API
   1. 改了 OpenAPI
   1. 改了官方包导出面
   1. 改了资源覆盖范围
   1. 改了依赖边界
   1. 改了协作流程
   1. 改了发布与验证要求

### 代码和文档必须同 PR 提交的情况

1. 下面这些情况，代码与文档必须放在同一个 PR：
   1. 新增或删除官方资源方法
   1. 调整 `@tavern/sdk` 或 `@tavern/client-helpers` 的职责边界
   1. 后端语义变化导致接入层变化
   1. `apps/web` 从本地逻辑迁移到官方包
   1. 文档中已经公开承诺的行为发生变化

### 文档风格

1. 用简单直接的文字
1. 先讲边界，再讲细节
1. 用表格和例子说明规则
1. 只记录已实现的行为与已采用的流程

---

## 10. 验证要求

1. 开发期间，运行受影响模块的类型检查和针对性测试。
2. 代码交付前，执行[代码交付验证](#代码交付验证)。
3. 纯文档变更，执行[文档验证](#文档验证)中的适用检查。

### 开发期间的模块验证

#### 改 `apps/api`

```bash
pnpm --filter @tavern/api typecheck
pnpm --filter @tavern/api test
```

#### 改 `@tavern/sdk`

```bash
pnpm --filter @tavern/sdk typecheck
pnpm --filter @tavern/sdk test
```

1. 如果改动会影响前端接入，还应运行：

   ```bash
   pnpm --filter @tavern/web typecheck
   ```

#### 改 OpenAPI 或官方包生成面

```bash
pnpm sdk:generate
pnpm sdk:check
pnpm --filter @tavern/sdk typecheck
pnpm --filter @tavern/sdk test
```

### 文档验证

1. 对变更文档运行 markdownlint 和 Prettier。
2. 修改文档站页面或其引用时，运行 `pnpm docs:build`。
3. CI 结果的处理方式见[测试与 CI 第 7 节](testing-and-ci.md#7-ci-流水线)。

### 代码交付验证

```bash
node scripts/environments/cli.mjs verify --env dev --suite full
```

---

## 11. Issue 与发布

### Issue 标题

1. 标题要能直接说明问题，不要写空泛标题。示例如下：
   1. `tools call records query ignores floor_id when page_id is absent`
   1. `sdk export resource should preserve raw response semantics`
   1. `web timeline flow still duplicates sdk behavior`

### 标签建议

| 标签              | 用途       |
| ----------------- | ---------- |
| `bug`             | 已确认问题 |
| `feature`         | 新需求     |
| `discussion`      | 需要讨论   |
| `docs`            | 文档更新   |
| `integration-kit` | 官方包     |
| `help wanted`     | 需要协助   |

### 发布原则

1. 公开行为变更按[第 4.3 节](#43-公开行为变更后的同步核对)核对；需要迁移接入代码时，提供迁移说明。

### 发版前检查

1. [代码交付验证](#代码交付验证)通过。
2. 官方包导出面与文档一致。
3. `apps/web` 使用更新后的接入语义。
4. PR 已说明接入代码的迁移要求。
