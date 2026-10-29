---
文档用途: 说明仓库测试策略、验证命令与 CI 作业配置。
读取时机: 编写测试、执行验证或维护 CI 时。
---

# 测试与 CI 规范

## 目录

1. [测试策略总览](#1-测试策略总览)
2. [测试分层与职责](#2-测试分层与职责)
3. [覆盖率指标](#3-覆盖率指标)
4. [测试工具链](#4-测试工具链)
5. [测试文件组织](#5-测试文件组织)
6. [编写规范](#6-编写规范)
7. [CI 流水线](#7-ci-流水线)
8. [本地开发怎么跑测试](#8-本地开发怎么跑测试)
9. [常见问题](#9-常见问题)

---

## 1. 测试策略总览

1. `packages/core`：测试覆盖引擎逻辑与状态流转。
2. `packages/adapters-sillytavern`：通过回归样例验证导入与编排兼容性。
3. `apps/api`：接口层做集成测试，确保请求进来、响应正确。
4. `packages/shared`：工具函数和类型守卫要有单元测试。
5. `apps/web`：前端暂时不强制，但鼓励对关键交互写测试。
6. 根 Vitest 的测试发现与覆盖率排除环境运行目录，保留包内同名源码目录。
   目录路径取自[环境模板](../config/environments.example.json)的 `defaults.layout`；
   排除项见[根 Vitest 配置](../vitest.config.ts)。

---

## 2. 测试分层与职责

### 单元测试（Unit）

1. 单元测试验证单个函数、单个类或单个模块。测试不依赖数据库、网络或文件系统。

#### 单元测试适用范围

1. 变量系统的读取优先级逻辑
1. 提示词模板渲染
1. 正则规则匹配和替换
1. 摘要标签提取（SummaryExtractor）
1. Token 计数和预算分配
1. 楼层状态机流转
1. 工具函数（`packages/shared`）

#### 单元测试要求

1. 每个测试用例只验证一件事。
1. 需要 mock 5 个以上依赖时，先核对模块边界并重构依赖。
1. 执行时间：单个用例不超过 100 ms。整个单元测试套件不超过 30 秒。

### 集成测试（Integration）

1. 集成测试验证多个模块协作的结果。

#### 集成测试适用范围

1. 创建会话 → 创建楼层 → 写入消息 → 提交楼层的完整流程
1. 世界书导入 → 触发匹配 → 注入提示词的流程
1. 变量从 page 提升到 floor/chat 的流程
1. 记忆提取 → 归一化 → 落库的流程
1. API 路由的请求/响应（用 Fastify 的 `inject` 方法，不需要真的起 HTTP 服务器）

#### 集成测试要求

1. LLM 调用必须使用返回固定内容的 mock/stub，不得调用真实 LLM API。
1. 数据库用内存模式的 SQLite（`:memory:`），每个测试套件独立建库，测完即弃。
1. 执行时间：单个用例不超过 2 秒。整个集成测试套件不超过 3 分钟。

### 回归测试（Regression / Golden Test）

1. 回归测试用于保证酒馆兼容性。准备一组“输入 → 期望输出”的样例，每次跑测试确认结果没变。

#### 回归测试适用范围

1. 酒馆预设导入后的 Prompt IR 输出
1. 酒馆正则规则的替换结果
1. 酒馆世界书的触发和拼接结果
1. 摘要标签提取的各种边界情况

#### 回归测试要求

1. 样例数据使用 JSON 文件，并与所属包的测试一同维护。
1. 每个样例文件需要注明来源（从哪个酒馆版本导出、什么预设）。
1. 如果要更新期望输出，必须在 PR 描述里说明为什么变了。

### 端到端测试（E2E）

1. 当前不强制端到端测试。需要验证完整浏览器流程时，启动真实后端与前端，
   使用 Playwright 执行浏览器自动化。

---

## 3. 覆盖率指标

### 各包覆盖率指标

1. 下表用于代码评审与测试补充。
2. 根 Vitest 配置当前未将表中数值设为失败阈值。
3. CI 作业入口见[第 7 节](#7-ci-流水线)。

| 包                              | 行覆盖率 | 分支覆盖率 | 函数覆盖率 |
| ------------------------------- | -------- | ---------- | ---------- |
| `packages/core`                 | ≥ 80%    | ≥ 70%      | ≥ 85%      |
| `packages/adapters-sillytavern` | ≥ 75%    | ≥ 65%      | ≥ 80%      |
| `packages/shared`               | ≥ 90%    | ≥ 80%      | ≥ 90%      |
| `apps/api`                      | ≥ 60%    | ≥ 50%      | ≥ 65%      |
| `apps/web`                      | 暂不要求 | 暂不要求   | 暂不要求   |

### 增量覆盖率（每个 PR）

1. 新增代码的行覆盖率不低于 **80%**。
2. PR 导致整体覆盖率下降超过 **2%** 时，Reviewer 应核对下降位置与对应测试。

### 覆盖率报告

1. 本地生成与查看报告的命令见[第 8 节](#8-本地开发怎么跑测试)。

---

## 4. 测试工具链

| 用途       | 工具                      | 说明                   |
| ---------- | ------------------------- | ---------------------- |
| 测试框架   | Vitest                    | 支持 TypeScript 和 ESM |
| 断言       | Vitest 内置断言           | 兼容 Chai              |
| Mock       | `vi.fn()` / `vi.mock()`   | 函数与模块替身         |
| 覆盖率     | `@vitest/coverage-v8`     | V8 覆盖率报告          |
| HTTP 测试  | Fastify `inject()`        | 直接注入请求           |
| 数据库测试 | better-sqlite3 `:memory:` | 独立内存数据库         |
| 快照测试   | `toMatchSnapshot()`       | 对比期望输出           |

---

## 5. 测试文件组织

### 文件位置

1. TypeScript 模块的测试文件使用 `.test.ts` 或 `.spec.ts` 后缀。环境脚本测试入口见[操作手册第 8 节](environment-operations.md#8-验证与持续集成)。与被测代码相邻的目录布局示例：

   ```text
   packages/core/
   ├── src/
   │   ├── floor/
   │   │   ├── floor-state-machine.ts
   │   │   └── floor-state-machine.test.ts    ← 单元测试
   │   ├── memory/
   │   │   ├── summary-extractor.ts
   │   │   └── summary-extractor.test.ts
   │   └── variables/
   │       ├── variable-resolver.ts
   │       └── variable-resolver.test.ts
   ├── tests/
   │   └── integration/                        ← 集成测试
   │       ├── session-lifecycle.test.ts
   │       └── prompt-assembly.test.ts
   ```

### 测试夹具与工具函数

1. API 集成测试位于 `apps/api/test/`，共享夹具位于该目录的 `fixtures/`。
2. API 测试工具函数位于 `apps/api/test/helpers/`。数据库工具的使用见
   [数据库 schema 变更](#q我改了数据库-schema测试怎么办)。

---

## 6. 编写规范

### 命名

1. 用中文或英文都行，但要描述清楚“在什么条件下、做什么操作、期望什么结果”：

   ```typescript
   // ✅ 好的
   describe('VariableResolver', () => {
     it('读取变量时优先返回 page 级别的值', () => { ... });
     it('page 级别没有时回退到 floor 级别', () => { ... });
     it('所有级别都没有时返回 undefined', () => { ... });
   });

   // ❌ 不好的
   describe('VariableResolver', () => {
     it('test1', () => { ... });
     it('should work', () => { ... });
   });
   ```

### 结构

1. 每个测试用例遵循 AAA 模式：

   ```typescript
   it("楼层状态从 draft 转到 generating 时记录时间戳", () => {
     // Arrange - 准备
     const floor = createFloor({ state: "draft" });

     // Act - 执行
     floor.transition("generating");

     // Assert - 验证
     expect(floor.state).toBe("generating");
     expect(floor.updatedAt).toBeGreaterThan(floor.createdAt);
   });
   ```

### 禁止事项

1. **不要写依赖执行顺序的测试**。每个 `it` 块必须能独立运行。用 `beforeEach` 做初始化，不要依赖前一个用例的副作用。
1. **不要在测试里用 `setTimeout` 等真实定时器**。用 Vitest 的 `vi.useFakeTimers()`。
1. LLM 调用遵循[集成测试要求](#集成测试要求)。
1. **不要忽略失败的测试**。如果确实需要临时跳过，用 `it.skip()` 并附上原因和 Issue 链接。
1. **不要在测试里 hardcode 绝对路径**。用 `import.meta.url` 或测试工具函数来定位 fixture 文件。

### LLM Mock 约定

1. LLM 测试夹具应提供固定正文、流式分块和失败响应。以下为工厂接口示例：

   ```typescript
   import { vi } from "vitest";

   export function createMockLLM(options?: {
     response?: string;
     streamChunks?: string[];
     shouldFail?: boolean;
   }) {
     // 返回一个符合 LLM 实例接口的 mock 对象
     // 默认返回固定文本，可配置流式分块、失败场景
   }
   ```

2. 在测试中使用：

   ```typescript
   const mockNarrator = createMockLLM({
     response: "从前有座山，山上有座庙。<summary>叙述者开始讲故事</summary>",
   });

   const mockMemory = createMockLLM({
     response: JSON.stringify({
       turn_summary: "叙述者开始讲故事",
       facts_add: [{ key: "故事状态", value: "已开始", scope: "chat" }],
     }),
   });
   ```

---

## 7. CI 流水线

### 工作流入口与结果处理

1. [CI 工作流](../.github/workflows/ci.yml)定义触发条件、作业依赖、命令和超时。
   文档与代码的变更分类见[路径过滤配置](../.github/filters/ci-paths.yaml)。
2. PR 作者在 Checks 中查看作业结果。作业失败时，按日志中的命令复现并修正失败项。
   本地测试命令见[第 8 节](#8-本地开发怎么跑测试)。
3. CI 作业接近超时时，先测量各步骤耗时，再优化最耗时的步骤。

### 根覆盖率执行与报告

1. PR 作者在 Actions 中手动触发 CI，并设置 `run_coverage=true`，可运行根覆盖率作业。
2. `Coverage` 作业合并分片报告。PR 作者可下载 `coverage-summary` 产物查看覆盖率摘要。
3. 分片测试失败、报告缺失或多出报告时，`Coverage` 作业返回失败。
   PR 作者按失败作业的日志修复问题，再重新运行失败作业。

### 文档检查基线

1. PR 作者在仓库根目录执行 `pnpm docs:lint --report <证据 JSON 的绝对路径>`。
   报告分别列出既有问题、新增问题和待裁剪条目。CI 报告位于 `docs-lint-report` 产物。
2. 用户批准的既有问题保存在 `docs/provenance/markdownlint-baseline.json`。
   PR 作者修复新增问题后重新执行文档检查。
3. PR 作者修复既有问题后，从对应基线条目的 `count` 扣除报告中的 `stale.count`；
   计数为零时删除条目，再执行文档检查。

### 分支同步与原生环境验证

1. dev 同步的操作要求见[协作指南第 5 节](contributing.md#main-合并后的-dev-安全回补)，
   执行入口为[dev 同步工作流](../.github/workflows/sync-dev-with-main.yml)。
2. [原生环境工作流](../.github/workflows/native-environments.yml)在 macOS 上复用
   `scripts/environments/cli.mjs`。工具版本来自根 `package.json`，验证命令来自
   `docs/agents/development-checks.json` 与各包的 `package.json`。
3. 环境操作与验收步骤见[原生环境操作手册](environment-operations.md)。

## 8. 本地开发怎么跑测试

### 跑所有测试

1. Vitest 默认进入 watch 模式，修改代码后自动重跑受影响的测试。

   ```bash
   pnpm test
   ```

### 只跑某个包的测试

```bash
# 只跑 core 的测试
pnpm --filter core test

# 只跑 adapters-sillytavern 的测试
pnpm --filter adapters-sillytavern test
```

### 只跑某个文件

```bash
pnpm test -- floor-state-machine
```

### 看覆盖率报告

```bash
pnpm test:coverage
# 然后用浏览器打开 coverage/index.html
```

### 跑 CI 分片测试

```bash
pnpm exec vitest run --reporter=verbose --shard=1/6
pnpm exec vitest run --reporter=verbose --shard=2/6
pnpm exec vitest run --reporter=verbose --shard=3/6
pnpm exec vitest run --reporter=verbose --shard=4/6
pnpm exec vitest run --reporter=verbose --shard=5/6
pnpm exec vitest run --reporter=verbose --shard=6/6
```

### 只改文档时的最小验证

1. 按[协作指南的文档验证要求](contributing.md#文档验证)选择检查。

### 跑 CI 覆盖率任务

```bash
pnpm test:ci:coverage
```

### 代码交付验证

1. 按[协作指南的代码交付验证要求](contributing.md#代码交付验证)执行全量检查。

### 跑 API 冒烟测试

1. 按[原生环境操作手册第 3 节](environment-operations.md#3-首次初始化与配置)
   完成初始化、配置与迁移。
2. 按[第 4 节](environment-operations.md#4-手动进程操作)启动并确认 dev 环境健康。
3. 按 `config/environments.json` 的 dev `listenHost` 与 `ports.api`
   设置 `API_BASE_URL`。默认配置的命令如下。

   ```bash
   API_BASE_URL=http://127.0.0.1:4010 pnpm smoke:api
   ```

---

## 9. 常见问题

### Q：我加了个工具函数，需要写测试吗？

1. `packages/shared` 的测试要求见第 1 节。
2. 模块内部的私有函数通过公共接口间接测试。

### Q：我改了数据库 schema，测试怎么办？

1. 修改 schema 时同步生成迁移文件。
2. API 集成测试通过
   [`apps/api/test/helpers/create-test-db.ts`](../apps/api/test/helpers/create-test-db.ts)
   的 `createTestDatabase()` 创建隔离数据库，并执行同一套迁移。

### Q：测试太慢了怎么办？

1. 检查测试是否包含不必要的 I/O 或真实网络请求。
2. 对 token 计数等计算密集型测试，在保留边界覆盖的前提下减少测试数据量。互不共享可变状态的测试可使用 `describe.concurrent` 并行执行。

### Q：覆盖率未达到指标怎么办？

1. 根据覆盖率报告，为未覆盖的公开行为与边界补充测试。
2. 当前测试平台无法执行的回退分支可用 `/* v8 ignore next */` 排除，并在 PR 中说明平台限制。

### Q：我想加新的测试工具 / 插件？

1. 先在 Issue 中说明现有工具无法覆盖的测试需求。
2. 取得依赖安装授权后，再引入测试框架依赖。
