---
文档用途: 规定 TavernHeadless
  三环境原生运行的实施对象、步骤和验收依据，供审批与后续实施使用。
读取时机: 审批环境方案，以及执行环境配置、发布、数据迁移或恢复工作前读取。
---

<!-- markdownlint-disable MD013 -->

# dev、staging、prod 原生环境流程实施计划

## 1. 名词定义

1. **环境**：一组独立的配置、进程、端口和持久数据。dev 用于开发；staging 用于发布前验收；prod 用于生产运行。
2. **环境根目录**：环境全部本地文件的归属目录。下文用 `E`
   表示当前命令所选环境的根目录。
3. **发布版本**：由 Git 标签和完整提交号确定的一组源码。
4. **构建产物**：从发布版本构建的 API、运行依赖和 3 个前端静态目录。产物同时携带迁移文件和发布清单。
5. **发布标识（`releaseId`）**：一次构建的唯一名称。格式为
   `<tag>-<commit12>-<UTC时间>`，时间格式为 `YYYYMMDDTHHmmssZ`。
6. **应用版本回退**：切换到已保存的构建产物，继续使用当前业务数据。
7. **数据库恢复**：用选定备份恢复 SQLite 数据库及同批角色文件，并配套恢复配置和密钥。
8. **操作记录**：一次命令的参数摘要、阶段结果、退出码和日志引用。下文用
   `operationId` 表示操作记录的唯一编号。
9. **备份标识（`backupId`）**：操作者为同一环境内的一次完整备份选定的唯一名称。命名约束见 `scripts/environments/release.mjs` 的 `assertIdentifier()`。
10. **后续执行者**：取得第 6.2 节对应操作授权后，实施本计划的人或 Agent。
11. **示例环境信息**：本文中的绝对路径、主机名和主机地址采用示例值。实际值以 dev 的本机配置 `config/environments.json` 为准。

## 2. 总目标

1. 后续执行者交付 1 份环境配置和 1 套 Node.js
   ESM 管理脚本。操作者用同一命令入口管理三个环境。
2. dev 运行 TypeScript 源码和 Vite 开发服务。staging 与 prod 运行同一份构建产物。
3. 每个环境独立运行 1 个 Nginx
   master 和 1 个 API 实例。dev 额外运行 3 个前端开发服务。
4. 后续执行者交付原生发布验证工作流、数据迁移工具和恢复流程。工作流复用本地脚本。
5. 后续执行者交付 `docs/environment-operations.md`，并更新
   `docs/development-index.md` 的入口。最终目录约定写入仓库根 `AGENTS.md`。
6. 后续执行者用第 7 节验收三环境隔离、手动进程管理、产物发布和数据恢复。

## 3. 现状调研

### 3.1 调研基线与证据范围

1. 本次只读调研日期为 2026-10-24。源码基线为主目录的本地
   `main`：`4f8af49ef96807201c3df8fed5beb28a2df0d727`。
2. 主目录另有 23 个已暂存的文件改动，包含 Docker 发布草案和 OpenAPI 生成物。依据为
   `git status --short` 与
   `git diff --cached --stat`。第 3.3 节将这些文件标为“暂存草案”。
3. 调研基线的源码路径相对于 dev 源码根目录。
4. 当前实施文件位于本次独立 worktree。第 3.5–3.7 节的依赖与验收状态以该 worktree 为准。
5. 函数名和配置键作为定位依据；后续执行者必须在实施提交重新核对。
6. 数据归属采用 `apps/user-web/CONTEXT.md` 的用户账号与演绎会话术语。
7. 应用运行行为的调研结论来自源码阅读。主机观察覆盖当前目录、目标目录、当前监听端口和可见软件路径。

### 3.2 调研基线的应用入口、配置与持久数据

1. **启动入口。** 根 `package.json` 的 `dev` 调用
   `scripts/dev-select.mjs`。该脚本的 `MODES`
   只有 API、管理 Web 及两者组合。API 的 `dev` 使用 `tsx watch src/index.ts`。
2. **应用依赖。** 各应用的 `package.json` 确认以下运行关系。

   | 应用     | 工作区包           | 运行依赖与目标用途                                                                       |
   | -------- | ------------------ | ---------------------------------------------------------------------------------------- |
   | API      | `@tavern/api`      | 依赖 core、shared、SillyTavern adapter、SQLite 和 Drizzle；提供业务接口及进程内 worker。 |
   | 管理 Web | `@tavern/web`      | Vue、Vite 6、SDK、client-helpers；管理账号、角色和资源。                                 |
   | 用户 Web | `@tavern/user-web` | Vue、Vite 6、SDK、shared；提供注册、登录、角色浏览和演绎会话。                           |
   | Studio   | `@tavern/studio`   | Vue、Vite 8、SDK、client-helpers 及 core 的浏览器入口；提供图编辑与调试界面。            |

3. **服务配置。** `apps/api/src/index.ts` 从源码位置向上查找根
   `.env`。`loadConfig()` 位于 `apps/api/src/config.ts`，读取
   `process.env`。API 当前监听 `0.0.0.0`，默认端口为 `3000`。
4. **数据路径。** `apps/api/src/storage-config.ts` 的 `loadStorageConfig()` 读取
   `apps/api/config/storage.json`。`DATA_DIR` 控制数据根目录；`DATABASE_URL`
   优先于 `DB_PATH`。相对路径以进程工作目录解析。
5. **文件存储。**
   上述配置声明数据库、`role-assets`、`role-asset-staging`、`chat-transfer-artifacts`
   和 `backup-artifacts`。`docs/adr/0005-role-resource-file-storage.md`
   要求数据库与角色文件成批备份、成批恢复。
6. **数据库入口。** `apps/api/src/db/client.ts` 的 `createDatabase()`
   在打开 SQLite 后执行 Drizzle 迁移、结构修复和数据回填。`apps/api/src/db/migrate.ts`
   也调用该函数。`apps/api/src/app.ts` 的 `buildApp()` 在服务启动时调用该函数。
7. **密钥关联。** `apps/api/src/services/llm-profile-service.ts` 使用
   `APP_SECRETS_MASTER_KEY`
   解密模型档案。复制数据库后，档案密钥仍依赖原加密主密钥。
8. **调试日志。** `apps/api/src/debug/configure-debug.ts` 支持 `logDir`
   参数，默认写入工作目录下的日志目录。当前启动入口未传入环境专属日志路径。
9. **前端地址。** 管理 Web 与 Studio 使用 `VITE_API_BASE_URL`。用户 Web 的
   `bootstrapRoleApplication()` 读取 `/config/application.json` 和
   `/config/runtime-policy.json`。当前 `application.json` 的管理入口为
   `http://localhost:5173`。
10. **开发端口。** `apps/web/vite.config.ts` 使用
    `5173`。用户 Web 与 Studio 的 Vite 配置均使用
    `5174`，同时启动时存在端口冲突。
11. **登录隔离。** `apps/api/src/services/user-identity-service.ts`
    定义 Cookie 名称 `tavern_session`。`routes/user-identity.ts` 设置
    `Path=/`，未设置 `Domain`。环境入口设计见第 5.3 节。
12. **健康接口。** `apps/api/src/app.ts` 的 `GET /health` 返回 `200`，正文为
    `{"ok":true,"service":"@tavern/api","database":"ready"}`。该接口作为启动探针；业务可用性另按第 7.3 节验证。

### 3.3 调研基线的构建、发布与持续集成

1. **已有构建。** 根 `pnpm build`
   递归执行各包构建。API 使用 TypeScript 编译，并由
   `apps/api/scripts/copy-native-module-worker.mjs` 复制 `.mjs` worker。
2. **模块格式。** `tsconfig.base.json` 当前使用
   `moduleResolution: Bundler`。API 与工作区包输出 ESM；发布路径需要验证普通 Node.js 能加载全部运行入口。
3. **暂存草案。** `docker/Dockerfile.api` 用
   `pnpm --filter @tavern/api --prod deploy`
   收集依赖，然后修补包导出、补写导入扩展名和裁剪文件。原生构建方案见第 5.7 节。
4. **暂存草案。** `docker/Dockerfile.web`
   只构建管理 Web。`docker/compose.prod.yml` 使用 Docker volume 保存数据库，配置
   `restart: unless-stopped`。`docker/nginx.conf` 尚未关闭 SSE 代理缓冲。
5. **暂存草案。** `scripts/verify-release.sh`
   安装依赖，执行 lint、类型检查、测试、构建和生成物验证，再启动源码 API。该脚本写入
   `.tmp/docker-verify`，并修改 pnpm store 配置。
6. **暂存草案。** `scripts/docker-verify.sh`
   调用 Compose；`.github/workflows/docker-verify-release.yml`
   包装该调用；暂存的 `ci.yml` 增加 `docker-audit`
   作业。替代入口见第 5.9 节。
7. **可复用检查。** `docs/agents/development-checks.json`
   提供 lint、typecheck、test:ci、SDK 生成检查和文档构建命令。根 Vitest 排除了 Studio；`ci.yml`
   单独执行 Studio 覆盖率测试。
8. **可复用断言。** `scripts/check-generated-artifacts.sh`
   核对 OpenAPI 生成物；`scripts/check-production-auth-guard.sh`
   核对生产认证约束。断言迁移见第 5.9 节。

### 3.4 分支、标签与环境关系

1. `docs/contributing.md` 规定功能分支先合入 `dev`，再通过 `dev → main`
   发布集成改动。
2. `.github/workflows/sync-dev-with-main.yml` 在 `main`
   推送或手动触发时检查提交差异。仅当 `dev`
   没有独有提交且落后时，工作流更新同步分支并创建指向 `dev` 的 PR。
3. 2026-10-24 调研时，本地远端引用为：`origin/main=b036330231592422d516e49894b495fafc49c2c4`，`origin/dev=3af385acc3e222c2f2b26560423d025056a1c9cb`。当时本地
   `main` 落后本地 `origin/main` 引用 4 个提交，`git tag --list` 输出为空。
4. 上述远端引用来自本地 Git 状态，远端实时提交和保护规则仍待实施时核对。

### 3.5 主机条件与软件审计

1. 2026-10-24 的主机快照中，`sw_vers` 返回 macOS `27.0.1`；`uname -m` 返回 `arm64`。`node --version` 返回
   `v24.14.0`；`pnpm --version` 返回 `9.15.4`。Node.js 由当前用户的 nvm 管理。
2. 上述主机快照中，`command -v nginx` 无输出。`brew` 位于
   `/opt/homebrew/bin/brew`。2026-10-25 已按本节固定版本安装 Nginx 及其主机依赖，安装证据见第 3.7 节。
3. `lsof -nP -iTCP -sTCP:LISTEN` 显示占用端口包括
   `5000`、`7000`、`8002`、`9090`、`18092`、`18093` 和
   `18943`。第 5.3 节推荐端口在该次快照中均未出现；启动前仍须重新检查。
4. 2026-10-24 的目录快照显示，staging 与 prod 根目录均不存在。dev 的 `data`、`logs` 目录为空；根
   `.env` 与 `apps/api/.env` 均不存在。
5. 仓库目录扫描发现 `apps/api/.tmp/docker-verify/runtime.sqlite`，大小为
   `1519616` 字节。`sqlite3 -readonly` 查询得到
   `account=1`、`session=0`。文件位置显示其来自验证流程；已确认的数据归属见第 9 节。
6. 调研基线声明 Node.js `>=22.22.2`、pnpm `9.15.4`。实施清单已固定为下表版本。
   2026-10-25 已通过当前用户的 nvm 安装 Node.js `22.23.4`；安装包通过官方校验。项目依赖已按锁文件安装，本次复用本机 pnpm `10.34.5`。better-sqlite3 已在 Node ABI `127` 下完成内存数据库读写，SQLite 版本为 `3.51.3`。

   | 软件            | 计划固定版本 | 安装范围与审计意见                                                                           |
   | --------------- | ------------ | -------------------------------------------------------------------------------------------- |
   | Node.js         | `22.23.4`    | 三环境及构建共用。满足上述版本约束，且为 2026-10-21 的安全发布；已完成本机原生模块读写验收。 |
   | pnpm            | `10.34.5`    | 开发和构建使用。`packageManager` 已固定该版本；官方路径穿越通告覆盖调研基线的 `9.15.4`。     |
   | Nginx           | `1.31.8`     | 主机安装一份二进制，各环境独立配置与进程。该版本高于官方通告列出的 `1.31.7` 修复下限。       |
   | OpenSSL         | `4.0.3`      | 所选 Nginx bottle 的依赖。官方发布说明确认包含安全修复。                                     |
   | PCRE2           | `10.49`      | 所选 Nginx bottle 的依赖。官方发布说明确认修复越界写入。                                     |
   | ca-certificates | `2026-10-20` | 所选 OpenSSL bottle 的依赖。已核对 Homebrew 官方来源与 bottle 依赖清单。                     |

7. 软件依据为
   [Node.js 发布说明](https://nodejs.org/en/blog/release/v22.23.4)、[pnpm 安全通告](https://github.com/pnpm/pnpm/security/advisories/GHSA-c59q-g84q-2gj5)、[pnpm 修复发布](https://github.com/pnpm/pnpm/releases/tag/v10.34.5)、[Nginx 安全通告](https://nginx.org/en/security_advisories.html)及
   [Homebrew Nginx 清单](https://formulae.brew.sh/api/formula/nginx.json)。依赖依据为
   [OpenSSL 发布说明](https://github.com/openssl/openssl/releases/tag/openssl-4.0.3)、[PCRE2 发布说明](https://github.com/PCRE2Project/pcre2/releases/tag/pcre2-10.49)和
   [CA 清单](https://formulae.brew.sh/api/formula/ca-certificates.json)。
8. npm 官方审计接口对实施锁文件返回 0 项漏洞。该结果包含开发依赖；审计基线为 9 项 critical、94 项 high、126 项 moderate 和 26 项 low。统计与依赖路径见 [审计快照](../docs/provenance/native-dependency-audit.json)。
9. 各包 `package.json` 已固定直接依赖版本，`pnpm-lock.yaml` 固定完整依赖树，`pnpm-workspace.yaml` 固定 npm 官方 registry。2026-10-25 的安装使用 `--frozen-lockfile`；验收结果见第 3.7 节。

### 3.6 依赖修复与安装验收范围

1. 当前修复清单包括 Fastify `5.12.7`、JWT 插件 `10.2.5`、DOMPurify `3.4.17`、Zod `4.6.7`、Vitest `4.1.12` 和 Mermaid `12.2.0`。完整版本以各包清单为准。
2. Zod 迁移涉及字典键、类型参数、默认输入和错误对象。执行者须验证导入、导出、HTTP 错误详情及 JSON Schema 生成物。执行者须核对枚举与格式错误代码分别为 `invalid_value`、`invalid_format`，并验证安全整数边界和 UUID 的 RFC variant 校验行为。依据为 [Zod 迁移文档](https://zod.dev/v4/changelog)和[安全修复](https://github.com/colinhacks/zod/commit/a0ebf97)。
3. Vitest 迁移须验证构造器替身、测试重置行为、测试发现范围和覆盖率范围。构建目录 `dist` 从测试发现和覆盖率统计中排除。依据为 [Vitest 4 迁移文档](https://v4.vitest.dev/guide/migration.html)。
4. Mermaid 升级保留 `dagre` 布局和 `classic` 外观。执行者须验证 Studio 的图形渲染、明暗主题和流式源码展示。该依赖要求 Safari 17.4 及以上；浏览器范围见 [Mermaid 12 发布说明](https://github.com/mermaid-js/mermaid/releases/tag/mermaid%4012.0.0)。
5. `pnpm-workspace.yaml` 对以下父包设置版本覆盖。覆盖超出父包原声明范围；执行者须逐项验证实际行为。兼容依据见 [Vite 6 迁移指南](https://v6.vite.dev/guide/migration.html)、[selector-parser 变更记录](https://raw.githubusercontent.com/postcss/postcss-selector-parser/7.1.7/CHANGELOG.md)和 [KaTeX 迁移指南](https://katex.org/docs/migration)。

   | 父包与子依赖                                 | 验证操作与预期结果                                                                                                                     |
   | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
   | VitePress → Vite                             | 构建全部文档；启动仅监听本机的文档服务。页面、资源路径与热更新可用。                                                                   |
   | `@esbuild-kit/core-utils` → esbuild          | 用 Drizzle 已安装的 `esm-loader` 加载实际配置，追踪确认调用 `core-utils` 与目标 esbuild；另在隔离副本执行 Drizzle 迁移生成及重复调用。 |
   | Tailwind 3 → `postcss-selector-parser`       | 构建管理 Web 和用户 Web；运行固定 CSS 夹具；按验收脚本核对 `group`、`peer`、任意变体及 `:merge()` 的选择器、声明与顺序。               |
   | `postcss-nested` → `postcss-selector-parser` | 编译嵌套选择器、`&`、逗号组合和嵌套 at-rule；输出符合验收脚本规定的选择器与声明。                                                      |
   | `micromark-extension-math` → KaTeX           | 检查数学语法 token；调用 `mathHtml()` 渲染行内、块级与非法公式。核对返回内容、错误行为及匹配的 CSS。                                   |

6. 父包版本变化时，执行者须核对覆盖是否仍命中。父包声明已包含修复版本时，执行者删除对应覆盖，并重跑第 5 项验证与全量审计。
7. 第 3.5 节软件和锁定项目依赖已获批安装，范围见第 9 节。pnpm 已阻止未获授权的 msw 和 vue-demi 生命周期脚本。

### 3.7 目标依赖与原生环境的实际验收

1. 本节记录 2026-10-25 在独立 worktree、Node.js `22.23.4` 和锁定项目依赖下的结果。依赖验证日志根目录为 `logs/operations/20261025-dependency-validation/`；结构化索引见 [审计快照](../docs/provenance/native-dependency-audit.json)。
2. `pnpm test:dependencies` 的 23 项兼容测试全部通过；npm 全量审计返回 0 项漏洞。`pnpm lint`、`pnpm typecheck`、全部应用构建和文档构建通过。
3. 管理 Web 的 279 项测试与 Studio 的 769 项测试通过，Studio 覆盖率达到配置门槛。根全量测试通过 621 个文件中的 6411 项测试。原生环境测试通过 110 项，包含实际 Nginx 配置测试。
4. 浏览器已验证 VitePress 页面和资源加载，以及同一标签页的热更新。Drizzle 在隔离副本中首次生成迁移，再次执行返回无 schema 变化；默认生成路径直接调用 esbuild。单独调用 Drizzle 已安装的 `esm-loader` 后，追踪确认 `core-utils` 调用了目标 esbuild。该 loader 调用有 Node.js 实验性接口警告。
5. Studio 的实际 `AssistantMarkdown.vue` 已通过浏览器验证：明暗主题分别生成 SVG，流式状态显示源码，生成完成后恢复图表。测试使用独立页面夹具。
6. Zod 的可选字段类型、聊天文件可选元数据和 JSON Schema 导出适配已通过针对性测试。角色文件 API 的写入、移动、删除和无效输入拒绝行为已通过验证；导出测试已验证输入字段和分支匹配约束。完整检查结果由审计快照记录。
7. 2026-10-25 的仓库文档 lint 报告包含 194 个文件中的 3919 项问题。基线授权见第 9 节第 14 项。
8. `.agents/skills/native-card-conversion/scripts/` 中的 `source-format.ts`、`state-write.ts` 已完成适配，输入诊断、状态写入及其约束和事务的 83 项测试通过。该 Skill 的脚本项目类型检查仍有 50 项既有测试错误，位置与日志见审计快照。
9. Nginx 的 108 项隔离协议验收通过，覆盖开发与发布模式。验收项包括 API、SSE、WebSocket、前端资源、公开配置和实例启停隔离。隔离 dev 已通过统一入口启动实际 API、3 个 Vite 与 Nginx。浏览器验证了 3 个前端的原位热更新；API 源码修改触发重载后，健康接口返回 `200`。证据索引见审计快照的 `validation.checks.nginxProtocols` 和 `nativeLiveDev`。

## 4. 面临的问题

1. 调研基线的启动入口未覆盖用户 Web 和 Studio，且两个前端默认端口冲突。该入口缺少统一的进程归属记录。
2. 调研基线的 `.env` 查找与相对数据路径依赖启动位置。主机 shell 中的环境变量可能改变该版本的启动结果。
3. 调研基线的 API 启动同时执行数据库迁移和修复。操作者无法独立批准该入口的数据库变更，也难以区分启动失败与迁移失败。
4. 第 3.3 节的 Docker 草案把构建、依赖安装和运行验证混在容器流程中。该草案的发布测试未覆盖携带依赖的全部前端与 API 产物。
5. 调研基线的用户 Web 管理地址固定为开发端口。环境地址若进入构建内容，staging 与 prod 将需要分别构建。
6. 数据库、角色文件和加密主密钥存在关联。仅恢复数据库文件会遗漏角色资源或失去模型档案的解密能力。
7. 第 3.7 节已记录软件安装与隔离验收结果。实际三环境的初始化、发布和业务验收仍待执行。
8. 第 3.5 节记录的数据证据仅覆盖验证数据库；三个环境的停机窗口尚待用户决定。

## 5. 问题的解决和实施方案

### 5.1 架构与进程职责

1. 操作者在 dev 根目录执行
   `node scripts/environments/cli.mjs <command> --env <name>`。命令解析、配置加载、生命周期、构建和数据操作分别由共用模块负责。
2. 下图适用于三个环境。实线表示调用或数据流；虚线表示发布产物传递。

   ```mermaid
   flowchart TB
     O[操作者：手动执行命令] --> C[cli.mjs 与共用模块]
     J[config/environments.json] --> C
     K[目标环境配置与密钥] --> C
     C --> P[目标环境进程启动与身份记录]
     P --> N[Nginx：目标环境独立 master]
     P --> A[API：开发模式运行源码；发布模式运行 current/api/dist]
     P --> V[仅开发模式：管理 Web、用户 Web、Studio 的 Vite]
     B[浏览器：主机地址或别名与环境端口] --> N
     N -->|API、SSE、WebSocket| A
     N -->|开发模式：页面、资源、HMR WebSocket| V
     N -->|发布模式：页面与静态文件| F[current 下的 3 个前端目录]
     A --> Q[目标环境 data：SQLite]
     A --> U[目标环境 data：角色文件与传输产物]
     C -->|停止写入后备份与恢复| Q
     C -->|同批备份与恢复| U
     C --> Z[目标环境 backups、logs、run]
     C --> R[在 dev 构建一次：发布标识与完整依赖]
     R -.-> S[staging 部署与验收记录]
     S -.-> T[同一产物部署到 prod]
   ```

3. API 进程负责启动和停止聊天转移、备份 worker。整环境备份按第 5.6.10 节执行。
4. `process-runner.mjs`
   仅转发信号、记录退出结果和回收本次创建的子进程。应用崩溃后，操作者根据状态与日志手动重启。

### 5.2 三环境共用目录

1. 环境根目录映射示例如下。配置方法见[操作手册第 3 节](../docs/environment-operations.md#3-首次初始化与配置)。

   | 环境    | 根目录                               | 模式          |
   | ------- | ------------------------------------ | ------------- |
   | dev     | `/srv/tavern/TavernHeadless`         | `development` |
   | staging | `/srv/tavern/TavernHeadless-staging` | `release`     |
   | prod    | `/srv/tavern/TavernHeadless-prod`    | `release`     |

2. 三个根目录采用以下名称和职责。dev 保持当前 monorepo 源码布局；staging 与 prod 保存发布提交的 detached
   worktree。

   ```text
   E/
   ├── apps/、packages/          源码；dev 可编辑，发布环境仅用于定位源码
   ├── scripts/environments/    管理脚本源码
   ├── docs/                    源码版本对应的操作与开发文档
   ├── config/
   │   ├── environments.example.json 受版本控制的配置模板
   │   ├── environments.json    本机环境配置，由 Git 忽略
   │   ├── application.env      当前环境的业务开关
   │   ├── secrets.env          当前环境的密钥，文件权限为 0600
   │   ├── public/              派生的前端运行配置
   │   └── nginx/nginx.conf     派生的当前环境 Nginx 配置
   ├── build/
   │   ├── work/<operationId>/  隔离的构建源码与依赖
   │   └── artifacts/<releaseId>/  原始发布归档与发布清单
   ├── releases/<releaseId>/
   │   ├── api/                dist、config、drizzle、package.json、node_modules
   │   ├── web/                管理 Web 静态文件
   │   ├── user-web/           用户 Web 静态文件
   │   ├── studio/             Studio 静态文件
   │   └── manifest.json       发布清单
   ├── current                 指向本环境已启用的 releases/<releaseId>
   ├── data/
   │   ├── tavern-headless.db
   │   ├── role-assets/
   │   ├── role-asset-staging/
   │   ├── chat-transfer-artifacts/
   │   └── backup-artifacts/
   ├── run/                    进程身份、部署阶段及 Nginx 临时文件
   ├── logs/
   │   ├── processes/          API、Vite、Nginx 和调试日志
   │   └── operations/<operationId>/  命令结果与验收证据
   └── backups/
       ├── <backupId>/         同批数据、配置、密钥及备份清单
       └── .restore-<operationId>-*/  恢复操作前的原始快照与故障诊断
   ```

3. 三环境均创建上述目录。dev 的 `current` 仅在产物验证时使用；staging 与 prod 的
   `build/work` 保持为空。
4. 管理命令始终读取 dev 的配置与脚本。staging、prod
   worktree 中的同名文件仅保存源码版本，执行者通过操作手册进入统一命令入口。
5. `.gitignore`
   排除环境专属配置、密钥、生成的 Nginx 配置及全部运行目录。发布环境的源码切换必须先确认受版本控制的文件没有人工改动。
6. `releases` 内文件不得引用环境外的 `node_modules` 或文件存储。`current`
   的目标必须位于本环境根目录内。运行数据和备份目录的真实路径必须分别归属于目标环境。
7. 发布归档先保存在 dev 的
   `build/artifacts`。部署命令将原归档复制到目标环境同名目录，并解包到该环境的
   `releases`。prod 使用 staging 已验收的原归档。
8. 后续执行者在仓库根 `AGENTS.md` 的“三环境目录约定”节注明环境根目录的配置来源，并列明共用子目录的名称、职责及归属限制。该节引用操作手册第 3 节的初始化方法；操作手册与开发索引引用该目录约定。
9. `AGENTS.md`
   同时规定读取顺序。Agent 处理环境初始化、启停、发布、数据迁移或恢复前，必须读取目录约定和操作手册。目录规则调整时，执行者同步更新配置与该节。

### 5.3 配置来源与覆盖规则

1. 本机文件 `config/environments.json` 由 Git 忽略，保存 `defaults`、`environments`、`tools` 和
   `verification`。结构由同目录 `environments.schema.json`
   校验；运行参数的默认值写在 JSON 配置中。
2. `environments`
   保存环境名称、绝对根目录、主机名、端口、进程前缀、会话 Cookie 配置和模式。默认端口从 `4000`
   起分组，具体分配如下。

   | 环境    | 主机名       | Nginx：管理／用户／Studio | API    | Vite：管理／用户／Studio | 进程前缀         |
   | ------- | ------------ | ------------------------- | ------ | ------------------------ | ---------------- |
   | dev     | `192.0.2.31` | `4000/4001/4002`          | `4010` | `4020/4021/4022`         | `tavern:dev`     |
   | staging | `192.0.2.31` | `4100/4101/4102`          | `4110` | `4120/4121/4122`，保留   | `tavern:staging` |
   | prod    | `192.0.2.31` | `4200/4201/4202`          | `4210` | `4220/4221/4222`，保留   | `tavern:prod`    |

3. `defaults.gatewayListenHost=0.0.0.0` 使 Nginx 接收本机和局域网请求。API 与 Vite 使用 `defaults.listenHost=127.0.0.1`。`defaults.hostAliases` 允许 `127.0.0.1`、`localhost` 和 `tavern.local`；Nginx 拒绝其他 Host。浏览器可通过主机名或别名配合目标环境端口访问服务。
4. 配置合并顺序为：共用默认值 → 所选环境配置。脚本据此生成
   `PORT`、`HOST`、`NODE_ENV`、绝对
   `DATA_DIR`、数据库路径、日志路径和 `USER_SESSION_COOKIE_NAME`、`USER_SESSION_COOKIE_SECURE`。这些字段由管理配置独占。三个环境分别使用 `tavern_dev_session`、`tavern_staging_session`、`tavern_prod_session`，避免同一主机不同端口的会话覆盖。当前 HTTP 入口设置 `sessionCookieSecure=false`；切换 HTTPS 时改为 `true`。
5. 应用业务开关按应用自身默认值 → `E/config/application.env` 合并。密钥只从
   `E/config/secrets.env`
   读取。字段重复、未知管理字段或业务文件覆盖管理字段时，命令返回配置错误。
6. 子进程只继承经过明确列举的主机变量，如所选工具路径、临时目录和语言设置。管理脚本显式传入应用配置；API 入口停止自动向上搜索
   `.env`。运行密钥不得传入 Vite 或构建进程。
7. 初始化只写缺失的模板。发布环境必填认证模式、对应凭据和
   `APP_SECRETS_MASTER_KEY`。生成验收另需模型配置或本地模型夹具；缺少时，记录验收未完成。
8. 构建阶段将管理 Web 与 Studio 的 API 地址固定为相对 `/api`。用户 Web 的
   `apiBaseUrl` 同样固定为 `/api`。环境主机名、管理跳转地址和业务开关通过
   `config/public` 的运行配置提供。
9. Nginx 通过精确路径提供 `/config/application.json`
   等公开配置。开发模式也由 Nginx 提供相同路径。公开配置须通过独立的允许字段 schema 校验，密钥字段不得进入该文件。
10. `config/public`
    是派生产物；默认模板与环境配置是写入来源。启动和部署时生成配置，`Cache-Control: no-store`
    防止前端复用上一环境配置。
11. 超时、日志保留和停止等待秒数统一放入 `defaults`。推荐启动等待 `60`
    秒、优雅停止等待 `30` 秒、SSE 与 WebSocket 空闲等待 `3600`
    秒。工具版本按本节第 12 项读取；软件审计依据见第 3.5 节。

12. 新增或调整的依赖使用精确版本。Node.js 和 pnpm 分别以根 `engines.node` 与 `packageManager` 为唯一版本声明；主机软件及其固定依赖记录在 `config/environments.json`。SQLite 使用 better-sqlite3 携带的版本。预编译包不可用时，执行者另行提交 Python、编译器等所需构建工具的固定版本与安装申请。

### 5.4 Nginx 与前端模式

1. 每个环境启动独立 Nginx
   master。脚本使用目标环境的配置文件、PID 文件、日志和临时目录；先运行配置测试，再启动前台模式的 Nginx。
2. 3 个 Nginx server 分别服务管理 Web、用户 Web 和 Studio。每个 server 将
   `/api/` 去掉此前缀后转发到本环境 API，将 `/ws` 转发到 API 的同名路径。
3. API 代理显式使用 HTTP/1.1，并关闭响应缓冲与缓存。WebSocket 转发 `Upgrade` 和
   `Connection`。SSE、WebSocket 的超时读取第 5.3 节配置。依据为
   [Nginx 代理文档](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_buffering)和
   [WebSocket 文档](https://nginx.org/en/docs/http/websocket.html)。
4. 开发模式将页面、模块资源及 HMR 连接代理给对应 Vite。Vite 使用固定端口、`strictPort`
   和本环境主机名；HMR 的浏览器端口指向 Nginx 入口。配置时，执行者分别验证 Vite 6 和 Vite 8 能通过对应 Nginx 入口加载页面、模块资源并完成 HMR 更新。
5. 发布模式直接服务 `current/web`、`current/user-web` 和
   `current/studio`。页面路由回退到各自 `index.html`；静态资源缺失返回
   `404`；API 错误继续返回 API 正文。
6. `/healthz` 返回 `204`，表示 Nginx 入口可达。`/api/health`
   验证反向代理与 API；业务验收按第 7.3 节执行。
7. 执行者依据 `apps/api/src/app.ts` 的路由注册入参，以及
   `apps/api/src/routes/native-cards.ts`、`apps/api/src/routes/role-assets.ts` 和 `apps/api/src/routes/imports.ts` 的 `bodyLimit`，确定各上传入口的有效上限。
   Nginx 的 `client_max_body_size` 必须大于或等于各上传入口有效上限中的最大值；API 按各路由约束拒绝超限请求。
8. Nginx 静态根目录仅指向前端产物。角色文件仍通过 API 的
   `/role-assets/:versionId/*` 读取，以保留账号与版本校验。

### 5.5 命令的共用契约

1. 命令入口为 `scripts/environments/cli.mjs`。`--env` 必填，可选值为
   `dev|staging|prod`。`--help`
   和各子命令帮助展示参数类型、必填性、默认值及示例。
2. 所有路径参数均转换为绝对路径后校验。命令从脚本位置定位 dev 源码根目录，操作者工作目录不改变数据归属。
3. 命令支持
   `--input <file|->`，从文件或 stdin 读取结构化参数。参数 schema 与命令行共用；同一字段同时出现时，命令返回
   `2`，避免不同调用方式产生覆盖差异。
4. 除 `logs --follow` 外，stdout 返回
   `operationId`、结果状态和结果文件绝对路径。`logs --follow`
   的输出见第 5.6.6 节。大 JSON 和命令日志写入
   `E/logs/operations/<operationId>/`。诊断写入 stderr，包含失败参数、有效值和可重试示例。
5. 共用退出码为：`0` 完成；`2` 参数或配置错误；`3` 前置条件缺失；`4`
   进程、端口或并发状态冲突；`5` 构建或产物错误；`6` 迁移、备份或恢复错误；`7`
   健康或验收失败。中断返回 `130`。
6. 每次调用使用独立操作目录和临时目录。不同环境可以并发执行；同一环境的变更操作必须核对开始时记录的进程身份、部署阶段和当前版本。检测到状态改变时返回
   `4`，保留操作记录。管理脚本不得新增并发锁。
7. 重复构建、复制和解包通过发布标识识别已有完整结果。命令先将结果写入临时文件或临时目录，写入完成后再发布。结果与已有内容冲突时返回 `5`。数据库备份使用独立备份标识。
8. 进程记录保存环境、组件、PID、进程组、UID 和启动时间。记录同时保存工作目录、可执行文件、发布标识和本次启动编号。启动前通过操作系统进程信息核对记录。
9. 停止时必须再次核对进程身份。仅向目标环境本次识别的进程或进程组发送信号；不得通过端口占用、进程名模糊匹配或全局
   `pkill` 选择停止对象。
10. API 收到 `SIGTERM` 后使用现有 `app.close()`
    回收 worker。Nginx 使用定向优雅停止。等待期限结束仍未退出时，命令返回
    `4`；操作者可在核对记录后使用 `stop --force`。
11. 启动命令按第 5.6.5 节执行启用探针的状态查询，结果为 `running`
    时报告启动完成。任一组件失败时，命令回收本次新建的进程，并保存失败阶段。

### 5.6 各命令的参数与行为

#### 5.6.1 初始化 `init`

1. 参数：`--env`；发布环境另需
   `--release <releaseId>`。dev 使用现有源码目录；发布环境从发布清单的提交创建 detached
   worktree。
2. 输入：环境配置、已存在的工具和发布清单。输出：第 5.2 节目录、缺失配置模板及初始化记录。
3. 重复执行保留已有配置、密钥和数据；返回
   `0`。目录属于其他项目、工具缺失或版本不符时返回 `3`。
4. 失败记录列明已创建路径。操作者补齐条件后重试；命令不安装软件、不生成业务账号、不迁移数据库。

#### 5.6.2 启动 `start`

1. 参数：`--env`，`--timeout-seconds <正整数>`
   可选，默认取共用配置。输入为环境配置、源码或 `current` 产物和已迁移的数据库。
2. 顺序：检查路径与数据库状态；启动 API；开发模式启动 3 个 Vite；测试并启动 Nginx；验证入口。输出进程记录及探针结果。
3. 同一配置下全部组件已运行时返回
   `0`。组件未全部退出、端口由其他进程占用或记录身份不符时返回
   `4`。诊断给出目标环境的状态查询命令。
4. 未部署或未迁移时返回 `3`。健康等待失败返回 `7`；清理范围按第 5.5 节执行。

#### 5.6.3 停止 `stop`

1. 参数：`--env`，`--force`
   可选且默认关闭。输入为进程记录与操作系统当前身份信息；输出各组件退出状态。
2. 顺序：停止 Nginx 接收请求；停止 API 和进程内 worker；开发模式停止 Vite 与源码 watcher。确认监听释放后返回
   `0`。
3. 已停止且没有存活组件时重复执行返回
   `0`。过期 PID 记录与同 PID 的其他进程分别处理，身份不匹配返回 `4`。
4. `--force`
   只强制结束再次验证身份后的目标进程。超时或身份冲突时保留记录，供操作者定位。

#### 5.6.4 重启 `restart`

1. 参数：`--env`，可选
   `--timeout-seconds`。输入为当前环境配置；输出停止与启动两个阶段的记录。
2. 按 `stop → start` 执行。停止失败立即返回 `4`；启动失败沿用 `start` 的退出码。
3. 重复执行会再次重启目标环境。配置与数据保持当前值；其他环境的进程身份保持不变。

#### 5.6.5 状态 `status`

1. 参数：`--env`，`--probe <true|false>` 可选，默认
   `true`。输入为进程记录、端口和健康接口；输出结构化状态文件。
2. 全部组件停止时，状态为 `stopped`。全部组件身份与监听归属正确时，状态可判定为
   `running`；启用探针时还须确认 API 健康接口及 3 个前端入口均通过。
3. `--probe false` 按第 2 项判定进程状态，健康字段输出
   `not-checked`。组件不全或探针失败时，状态为 `degraded`；身份不匹配时，状态为
   `identity-conflict`。
4. `stopped` 和 `running` 返回 `0`，`degraded` 返回 `7`，`identity-conflict`
   返回 `4`。每次查询追加一份操作记录。

#### 5.6.6 日志 `logs`

1. 参数：`--env`；`--component api|nginx|web|user-web|studio|debug|operations`，默认
   `operations`；可选 `--operation <operationId>`、`--follow`。
2. 输入为目标组件或操作记录。默认输出日志路径和最近一次结果摘要；`--follow`
   持续输出选定日志，适用于管道消费。
3. 找到日志时返回 `0`；无对应日志时返回 `3`。日志中的密钥必须在写入时脱敏。

#### 5.6.7 构建 `build`

1. 参数：`--env dev --ref <tag> --release <releaseId> --installation-approval <授权JSON>`。输入为已批准标签、精确工具版本、锁文件和安装授权记录。
2. 在 `build/work/<operationId>` 导出干净源码并构建。产物保存到
   `build/artifacts/<releaseId>`，输出发布清单与构建验证结果。
3. 相同标识且完整产物已存在时返回 `0` 并复用；输入冲突返回
   `5`。隔离目录的源码与标签不符，或缺少安装授权时返回 `3`。
4. 构建失败返回
   `5`，保留失败日志与隔离目录。重试使用新的操作目录；产物目录仅在完整验证后出现。

#### 5.6.8 部署 `deploy`

1. 参数：`--env staging|prod --release <releaseId>`。prod 另需
   `--acceptance <staging验收文件>`。输入为原始发布归档和对应清单。
2. 命令先核对目标环境已停止、目标版本迁移已完成。随后复制归档、解包、验证原生依赖和切换源码提交，再原子替换
   `current`，输出部署记录，最终保持停止状态。
3. 同一版本已部署且文件完整时返回 `0`。目标仍运行返回
   `4`；缺少验收记录或迁移状态不符返回 `3`。
4. 解包、依赖加载或文件比较失败返回 `5`。切换前失败保留原
   `current`；切换后失败按记录恢复原指针和源码提交，并保持停止状态。
5. 部署不安装依赖、不重建前端、不执行迁移。操作者按第 5.7 节启动并验收。

#### 5.6.9 迁移 `migrate`

1. 参数：`--env`；发布环境必填 `--release <releaseId>`；`--backup <backupId>`
   对已有数据库必填。dev 从当前源码读取迁移。
2. 输入为目标版本迁移目录、目标数据库和迁移前备份。输出迁移前后记录、完整性查询和逐阶段结果。
3. 空库由该命令初始化。已有库按迁移记录应用未执行项；再次执行且无待执行项时返回
   `0`。
4. API 或 worker 仍打开数据库时返回 `4`。迁移或数据修复失败返回
   `6`，保持服务停止，保留原备份，记录最后完成阶段。
5. 迁移失败后，操作者按第 5.8 节选择修复后重试或恢复备份。启动命令必须拒绝迁移状态未完成的数据库。

#### 5.6.10 备份 `backup`

1. 参数：`--env --backup <backupId>`。输入为停止写入后的数据库、文件存储、配置和密钥。输出
   `backups/<backupId>` 及备份清单。
2. 命令通过 SQLite 备份接口生成数据库副本，再复制同批角色文件与配置。对副本执行完整性查询，成功后发布备份目录。
3. 已有同标识完整备份时返回 `0`。目标仍有写入进程返回 `4`；备份失败返回
   `6`，保留失败阶段，完整备份列表排除临时目录。
4. 备份清单记录环境、时间、发布标识或 dev 源码提交。清单还保存迁移记录、各表行数、文件路径与字节数及密钥标识。备份目录权限为
   `0700`；密钥文件权限为 `0600`。

#### 5.6.11 恢复 `restore`

1. 参数：`--env --backup <backupId>`；发布环境必填 `--release <releaseId>`。可选
   `--preview`，默认关闭；执行恢复时必填 `--authorization <授权JSON>`。输入为同环境完整备份及匹配的产物或 dev 源码。
2. 预览输出恢复对象、数据时间点和将被替换的目录；返回
   `0`。执行恢复前必须已取得覆盖数据的授权。
3. 无论当前数据是否存在故障，恢复命令均先保存操作前的数据、配置和故障诊断。随后在临时目录恢复所选备份。完整性、文件引用与配套密钥验证通过后替换目标目录；发布环境同时切换到匹配产物和源码提交。
4. 重复恢复同一备份仍保存操作前原始快照，恢复后数据与所选备份一致。服务保持停止，操作者随后执行
   `start`。
5. dev 恢复前，执行者先提交或另存受版本控制文件的未提交改动。随后，执行者将源码切换到备份清单记录的提交。恢复命令核对提交一致且受版本控制文件无未提交改动后，执行恢复。
6. 环境归属、版本或备份配套密钥不匹配返回 `3`；正在写入返回 `4`；恢复失败返回
   `6`。中途失败通过阶段记录还原操作前目录、产物指针和源码提交。

#### 5.6.12 应用版本回退 `rollback`

1. 参数：`--env staging|prod --release <目标releaseId> --backup <操作前backupId> --compatibility <验收文件路径>`。输入为目标产物和回退兼容性验收记录。
2. 命令要求目标环境已停止。数据库迁移序列及数据读写验收满足第 5.8 节条件后，切换
   `current` 和源码提交；输出切换前后的发布标识。
3. 已指向目标版本时返回 `0`。兼容性证据缺失返回 `3`；运行中返回
   `4`；产物校验失败返回 `5`。
4. 命令保持业务数据原样并保持服务停止。失败时恢复原指针和源码提交；数据库需要恢复时使用
   `restore`。

#### 5.6.13 验证 `verify`

1. 参数：`--env --suite unit|release|acceptance|full`；发布环境另需
   `--release <releaseId>`。CI 可指定
   `--sandbox <绝对目录>`，在该目录派生临时三环境配置。
2. 输入为源码或产物、测试夹具和已批准测试范围。输出测试日志、结构化结果和验收记录。
3. `--sandbox` 指定验证根目录；各环境子目录和端口按 `verification`
   配置生成。CLI 必须拒绝与三个实际环境根目录重叠的测试目录。
4. 每次验证使用新的操作目录。全部目标项通过返回 `0`；测试或业务验收失败返回
   `7`；缺少授权的真实模型或数据操作返回 `3`。
5. `acceptance`
   按第 7.1 节区分 staging 发布准入与 prod 部署后验收。对应阶段通过后，命令生成该阶段验收文件。

### 5.7 构建与发布顺序

1. 后续执行者先确认已批准的 `main` 提交和不可移动的发布标签，再完成工具版本和依赖授权。构建脚本在隔离构建目录中，按锁文件安装已批准的精确版本依赖，并启用冻结锁文件模式。安装生命周期范围见第 9 节第 8 项。
2. 构建流程先生成 shared 的派生文件，再构建工作区依赖、API 和 3 个前端。服务端源码修正为可由 Node.js 直接解析的 ESM；前端保留 Vite 构建模式。
3. 服务端包导出直接指向编译输出。开发条件指向源码，以支持 API 与共享包修改后的热更新；Vite 读取相同的开发条件。
4. 产物打包复用 pnpm 的 production deploy 能力。pnpm 10 使用
   `injectWorkspacePackages`
   和构建后同步注入包的配置；具体设置先通过确定性产物测试。依据为
   [pnpm 10 deploy 文档](https://pnpm.io/10.x/cli/deploy)。
5. API 包必须携带全部生产依赖、原生 `.node` 文件、JSON 配置、Drizzle 迁移和
   `.mjs` worker。运行时需要的 TypeScript 等依赖继续纳入生产依赖闭包。
6. 发布清单记录发布标识、标签、完整提交和包版本。清单同时记录工具版本、macOS 版本、arm64 平台及 Node
   ABI，并附迁移序列和文件清单。归档内不包含环境配置、密钥或业务数据。
7. 构建验证在脱离源码 `node_modules`
   的目录执行。验证项包括 API 启动、迁移入口、角色 worker、3 个静态站点和依赖路径归属。
8. 产物一致性通过原归档的逐字节比较、解包文件清单和原生模块平台信息验证。staging 与 prod 均保留同一原归档；部署阶段禁止修改归档或重新安装依赖。
9. staging 的首次流程为
   `init → stop → backup（已有数据时）→ migrate → deploy → start → verify acceptance`。迁移命令从原归档预备目录读取迁移入口；部署随后复用该预备目录。
10. prod 的流程采用同一顺序，并要求 staging 验收文件。prod 迁移使用 prod 自身备份；staging 数据不随构建产物进入 prod。
11. staging 验收后，代码、依赖或前端构建内容变化时，执行者必须生成新发布标识。该产物须重新经过 staging 验收。
12. CI 复用 `verify` 和 `build`
    的内部模块。CI 临时构建只用于检查；向本机 prod 发布的唯一候选归档由当前 macOS
    arm64 主机构建。后续执行者在 D6 确认的 macOS runner 上验证原生流程。
13. CI 的 Build 作业与原生 `verify --suite full` 均调用 `pnpm test:dependencies`。CI 的 Build 作业同时构建全部文档，验证 VitePress 的实际调用。

### 5.8 数据归属、迁移与恢复

#### 5.8.1 现有数据的接收

1. 执行者按第 9 节已确认的数据归属准备三环境数据。
2. 用户若另行指定已有业务数据，必须同时指定数据库、角色文件、业务配置与加密主密钥的来源。
3. 执行者先记录源目录、数据库迁移序列、各表行数和资源文件清单，再停止源写入进程。执行者保留源数据库和配套文件，直至迁移验收完成。
4. 执行者通过 SQLite 备份接口获取数据库副本，并复制同批文件。SQLite 备份依据见[官方备份文档](https://www.sqlite.org/backup.html)。
5. 执行者在目标环境临时目录应用迁移，再核对行数变化与迁移预期。随后验证角色文件引用、固定版本、账号登录和模型档案可读性。
6. 跨环境测试数据使用目标环境新建的凭据。若复制的数据库包含加密模型档案，执行者须获得重设凭据或在隔离副本重新加密的授权；prod 主密钥保留在 prod 配置与其备份中。
7. 验证通过后切换目标数据目录，并执行第 7.3 节业务操作。迁移记录保存源路径、目标路径、授权引用和验证结果。

#### 5.8.2 数据库职责调整

1. 将 `createDatabase()`
   中的迁移、结构修复及回填集中到显式迁移服务。数据库打开函数只负责连接与连接级设置。
2. API、独立 worker 与迁移 CLI 复用同一数据库工厂。dev 启动预检读取当前源码的迁移序列；发布模式读取发布清单的序列。数据库存在待执行迁移或迁移失败时，启动预检拒绝启动。数据库的迁移序列超出当前源码或发布清单声明的范围时，启动预检也拒绝启动。
3. 新增共用测试数据库工厂，显式执行迁移服务。现有测试改用该工厂；各调用方不得复制 SQL、修复规则或迁移判断。
4. 数据修复若跨越多个事务，迁移服务记录各阶段结果。失败记录列明已提交、已回滚和尚未执行的阶段。

#### 5.8.3 回退与恢复的选择

1. **只回退应用。** 目标产物支持当前完整迁移序列，且回退读写测试通过时，执行
   `stop → backup → rollback → start → verify`。验收记录必须包含当前数据副本上的测试结果。
2. **恢复数据库。** 数据迁移改变了目标产物需要的结构或数据含义时，执行
   `stop → restore配套备份与产物 → start → verify`。恢复步骤见第 5.6.11 节。
3. **部署失败。**
   产物尚未切换时保留原指针；数据库若已经迁移，原应用只有满足第 1 项条件才可重新启动。否则按第 2 项恢复。
4. **迁移失败。**
   保持目标环境停止，核对事务与阶段记录。在数据副本上复现并修复后再迁移；需要回到迁移前状态时按第 2 项恢复。
5. **恢复时间点。**
   恢复会用所选备份替换目标环境的当前数据。操作者必须确认备份时间点和替换范围。

#### 5.8.4 产物、备份与操作记录保留

1. 建议保留当前产物及前 2 个已验收产物，并保留各自迁移前备份。首次实施期间保留全部操作记录。
2. 操作者按 D5 确认的保留期限手动清理产物、备份和操作记录。

### 5.9 文件变更清单

1. 下表规定本计划新增文件的最终交付范围与职责。

   | 文件                                                                         | 职责                                                       |
   | ---------------------------------------------------------------------------- | ---------------------------------------------------------- |
   | `scripts/environments/cli.mjs`                                               | 参数解析、逐级帮助、退出码与子命令分派。                   |
   | `scripts/environments/config.mjs`                                            | 配置校验、路径解析和环境变量组装。                         |
   | `scripts/environments/processes.mjs`                                         | 进程身份、启动、停止、重启与状态。                         |
   | `scripts/environments/process-runner.mjs`                                    | 运行单个组件并记录信号与退出结果。                         |
   | `scripts/environments/release.mjs`                                           | 构建、打包、部署、产物验证与回退。                         |
   | `scripts/environments/data.mjs`                                              | 迁移调用、备份、恢复及数据清单。                           |
   | `scripts/environments/verify.mjs`                                            | 本地与 CI 共用的检查编排、隔离夹具和证据生成。             |
   | `scripts/environments/nginx.mjs`                                             | 从结构化配置生成 Nginx 配置并测试语法。                    |
   | `scripts/environments/operations.mjs`                                        | 操作记录与日志脱敏。                                       |
   | `scripts/environments/*.test.mjs`                                            | 与上述模块相邻的确定性行为测试。                           |
   | `config/environments.example.json`                                           | 公开配置模板与隔离验证参数。                               |
   | `config/environments.json`                                                   | 本机环境映射、端口、模式、软件与操作参数，由 Git 忽略。    |
   | `config/environments.schema.json`                                            | 环境配置的结构与字段约束。                                 |
   | `config/environments/application.env.example`                                | 可配置的业务开关模板。                                     |
   | `config/environments/secrets.env.example`                                    | 密钥变量名模板。                                           |
   | `apps/api/src/db/migrations.ts`                                              | 显式数据库迁移服务。                                       |
   | `apps/api/src/db/__tests__/migration-lifecycle.test.ts`                      | 打开、迁移、失败和重复迁移的行为测试。                     |
   | `apps/api/test/helpers/create-test-db.ts`                                    | 创建并迁移测试数据库，供 API 测试共用。                    |
   | `.github/workflows/native-environments.yml`                                  | 手动原生发布验证与证据上传。                               |
   | `docs/environment-operations.md`                                             | 操作者手册。                                               |
   | `scripts/environments/commands.json`、`acceptance.json`                      | 命令参数与必需验收编号。                                   |
   | `scripts/environments/installation-policy.json`、`installation-approval.mjs` | 定义安装脚本授权结构，并为指定发布标签生成安装授权记录。   |
   | `scripts/environments/api-command.mjs`                                       | 统一调用源码或构建产物中的数据库命令。                     |
   | `scripts/environments/initialize.mjs`、`tools.mjs`                           | 环境目录初始化与固定工具版本验证。                         |
   | `scripts/environments/public-config.mjs`                                     | 生成公开配置。                                             |
   | `packages/shared/src/config/public-configuration-files.json`                 | 定义公开配置文件名与所属前端，供生成器、Nginx 和前端共用。 |
   | `scripts/environments/errors.mjs`                                            | 定义命令错误与退出码。                                     |
   | `apps/api/src/db/environment-command.ts`、`backup.ts`                        | 数据库管理命令与 SQLite 备份。                             |
   | `apps/api/src/db/repairs.ts`、`file-references.ts`、`profile-secrets.ts`     | 修复阶段、文件引用和模型档案密钥验证。                     |
   | `scripts/dependency-compatibility.node-test.mjs`                             | 验证第 3.6 节依赖覆盖的调用行为。                          |
   | `docs/provenance/native-dependency-audit.json`                               | 保存锁文件审计、覆盖路径及逐文件适配清单。                 |

2. 下表规定本计划修改文件的最终交付范围与职责。

   | 文件或目录                                                                                                                                                                                                                     | 修改职责                                                                |
   | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
   | 根 `package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`                                                                                                                                                                     | 固定工具版本、配置受批准安装脚本、增加统一命令别名。                    |
   | `.gitignore`                                                                                                                                                                                                                   | 排除第 5.2 节环境文件。                                                 |
   | `apps/api/src/index.ts`、`apps/api/src/config.ts`、`apps/api/src/storage-config.ts`                                                                                                                                            | 显式配置入口、监听地址和绝对数据路径。                                  |
   | `apps/api/src/debug/configure-debug.ts` 及其启动调用                                                                                                                                                                           | 将调试日志归入目标环境。                                                |
   | `apps/api/src/db/client.ts`、`apps/api/src/db/migrate.ts`、`apps/api/src/app.ts`                                                                                                                                               | 分离打开数据库与迁移，接入启动预检。                                    |
   | `apps/api/src/chat-transfer-worker.ts`、`apps/api/src/backup-worker.ts` 及 API 中调用 `createDatabase()` 的测试                                                                                                                | worker 复用连接工厂；测试改用共用测试数据库工厂。                       |
   | `apps/api/`、`packages/core/`、`packages/shared/`、`packages/adapters-sillytavern/` 下的 `package.json`、`tsconfig.json` 及 ESM 导入源码                                                                                       | 形成直接可运行的服务端产物和开发条件导出。                              |
   | `apps/api/scripts/copy-native-module-worker.mjs`                                                                                                                                                                               | 将运行文件复制纳入 API 构建单一入口。                                   |
   | `apps/web/vite.config.ts`、`apps/user-web/vite.config.ts`、`apps/studio/vite.config.ts`                                                                                                                                        | 环境端口、监听地址、HMR 和源码条件。                                    |
   | `apps/web/src/lib/api.ts`、`apps/studio/src/lib/backend/active.ts`                                                                                                                                                             | 使用环境内相对 API 地址。                                               |
   | `apps/user-web/src/lib/bootstrap.ts`、`apps/web/src/pages/RoleAppsView.vue`、`apps/web/src/features/native-card-editor/NativeCardEditorPage.vue`、`apps/web/src/lib/return-to-role-session.ts`、`packages/shared/src/index.ts` | 使用共享文件名契约读取 Nginx 提供的公开配置。                           |
   | `.github/workflows/ci.yml`、`.github/workflows/deploy-docs.yml`                                                                                                                                                                | 使用同一工具版本来源，调用共用检查模块。                                |
   | `.github/filters/ci-paths.yaml`                                                                                                                                                                                                | 将 `config/**` 纳入代码检查；将 `plans/**` 纳入文档检查。               |
   | 根 `AGENTS.md`                                                                                                                                                                                                                 | 写入第 5.2 节规定的目录约定和读取条件；补齐文档用途与读取时机 YAML 头。 |
   | `docs/development-index.md`、`docs/contributing.md`、`docs/testing-and-ci.md`、`vitepress/guide/getting-started.md`                                                                                                            | 更新命令入口并引用操作手册。                                            |
   | `.agents/skills/native-card-conversion/scripts/formal.ts`、`preview.ts`                                                                                                                                                        | 隔离资料准备阶段显式迁移数据库，再启动 API。                            |
   | `.agents/skills/native-card-conversion/scripts/convert.mjs`                                                                                                                                                                    | 按开发条件解析工作区源码，保持独立调用目录。                            |
   | 同一 Skill 的 `formal.test.ts`、`preview.test.ts`、`cli-bootstrap.test.ts`、`cli-flow.test.ts`、`cli-process.test.ts`                                                                                                          | 验证隔离数据库初始化、源码依赖解析及命令调用结果。                      |
   | Zod 消费者与直接测试，逐文件位置见审计快照的 `sourceAdaptations`                                                                                                                                                               | 适配 Zod 4 的字典、类型、默认输入与错误接口。                           |
   | `vitest.config.ts`、`apps/api/src/mcp/__tests__/mcp-connection.test.ts`、`mcp-connection-manager.test.ts`                                                                                                                      | 保持覆盖率范围，并适配可构造的测试替身。                                |
   | `apps/studio/src/modules/graph/assistant/AssistantMarkdown.vue`                                                                                                                                                                | 明确图形布局与外观配置。                                                |

3. 上表的 worker 与测试调用点，由执行者在数据库职责拆分前通过 `createDatabase`
   引用搜索列出。ESM 导入文件由编译诊断确定；实施记录必须保存最终文件清单。
4. 对应替代功能的针对性验收通过后，删除下列被替代入口。当前暂存草案中的删除须先取得 D7 授权。

   | 文件                                                                                                                                                      | 接替位置                                     |
   | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
   | `docker/Dockerfile.api`、`docker/Dockerfile.web`、`docker/Dockerfile.verify`、`docker/compose.prod.yml`、`docker/compose.verify.yml`、`docker/nginx.conf` | `release.mjs`、`verify.mjs` 与 `nginx.mjs`。 |
   | `.dockerignore`、`.env.production.example`                                                                                                                | 环境排除规则与密钥模板。                     |
   | `apps/web/public/config/role-apps.json`、`apps/user-web/public/config/application.json`                                                                   | `public-config.mjs` 按目标环境生成。         |
   | `.github/workflows/docker-verify-release.yml`                                                                                                             | 原生发布验证工作流。                         |
   | `scripts/docker-verify.sh`、`scripts/verify-release.sh`                                                                                                   | 统一 CLI 与验证模块。                        |
   | `scripts/audit-install-surface.sh`、`scripts/check-generated-artifacts.sh`、`scripts/check-production-auth-guard.sh`                                      | 原生验证模块中的安装清单与行为断言。         |
   | `scripts/patch-production-package-exports.mjs`、`scripts/patch-esm-relative-specifiers.mjs`、`scripts/prune-production-api-artifacts.mjs`                 | 包导出、编译配置与包文件清单。               |
   | `scripts/sync-openapi-generated.sh`                                                                                                                       | 现有 SDK 生成入口与同源 OpenAPI 输出。       |
   | `scripts/dev-select.mjs`、`scripts/run-with-local-node.mjs`、`scripts/local-node-env.mjs`、`scripts/use-local-node.ps1`、`dev-select.bat`                 | 统一环境命令和工具路径配置。                 |
   | `docs/docker-release.md`、`plans/docker-environment-release-plan.md`                                                                                      | 原生操作手册与本计划。                       |

5. 删除入口时，同时清理根脚本别名、CI 作业和文档引用。暂存的
   `apps/api/openapi/openapi.json` 改动单独核对，原生环境替换不自动撤销该改动。

### 5.10 实施步骤

1. S1 以列明的授权与输入齐备为通过条件；S2–S7 以本步骤产出完成、对应确定性测试通过为条件。
2. 各步骤末尾列出最终验收关联项。后续执行者在 S8 统一执行这些项目。

#### 5.10.1 S1：确认授权与冻结输入

1. 前置条件：本计划获批，第 6.1 节中影响当前步骤的事项已确认。
2. 文件：第 5.9 节的配置文件、根包管理文件和锁文件。
3. 动作：记录实施提交及当前未提交文件归属。核对实施提交对应的第 3.7 节验收证据，并按第 3.6 节确认待验收项。执行者核对第 9 节的安装授权，并按第 6.2 节申请超出范围的授权。
4. 执行者在对应操作记录中保存依赖安装、全量检查和三环境运行的授权依据。
5. 产出：批准的版本清单、数据来源清单、测试范围和停机窗口。最终验收关联项：A01、A15。

#### 5.10.2 S2：先定义配置与命令行为

1. 前置条件：S1 完成；使用已有本地工具编写测试。
2. 文件：`config.mjs`、`cli.mjs`、`operations.mjs`、环境 JSON/schema 及相邻测试。
3. 动作：先写配置覆盖、跨环境路径拒绝、参数解析和结果文件测试，再编写命令分派代码。
4. 产出：共用配置、帮助信息和操作记录格式。最终验收关联项：A01、A02、A14。

#### 5.10.3 S3：拆分迁移与连接职责

1. 前置条件：S2 完成；迁移测试只使用隔离数据库。
2. 文件：第 5.9 节的数据库文件、worker 调用点和测试数据库工厂。
3. 动作：先写“打开连接不迁移”“重复迁移”“事务失败”“修复阶段失败”测试，再迁移现有逻辑到显式服务。
4. 产出：受命令控制的数据库变更和启动预检。最终验收关联项：A08、A11。

#### 5.10.4 S4：编写原生构建入口

1. 前置条件：S1 的软件安装与依赖调整已获授权；S3 完成。
2. 文件：`release.mjs`、服务端包导出与编译配置、运行文件复制入口、前端 API 地址入口。
3. 动作：先写独立目录运行和依赖完整性测试，再编写 ESM 构建与 production
   deploy 打包代码。
4. 动作：后续执行者重新安装依赖后，先运行 `pnpm test:dependencies`，再完成第 3.6 节第 2 至第 5 项的构建与热更新验证。交付前按第 7.4 节运行全量检查。证据写入 dev 的 `logs/operations/<operationId>/dependency-validation/`。
5. 产出：第 5.7 节的归档与发布清单。最终验收关联项：A06、A07。

#### 5.10.5 S5：编写三环境进程与代理模块

1. 前置条件：S2、S4 完成；Nginx 安装和主机名映射已获授权。
2. 文件：`processes.mjs`、`process-runner.mjs`、`nginx.mjs`、API 启动配置和 3 个 Vite 配置。
3. 动作：先写 PID 复用、端口冲突、重复启停和组件启动失败测试，再接入真实进程验收。
4. 产出：两种运行模式和三个环境的手动生命周期。最终验收关联项：A03、A04、A05、A14。

#### 5.10.6 S6：编写部署、备份与恢复模块

1. 前置条件：S3、S4、S5 完成；数据覆盖与演练范围已获授权。
2. 文件：`data.mjs`、`release.mjs`、`verify.mjs` 及相邻测试。
3. 动作：先写损坏归档、磁盘写入失败、迁移失败、恢复中断和回退条件测试。随后编写阶段记录与恢复代码。
4. 产出：可重复执行的发布流程及配套备份。最终验收关联项：A08、A09、A10、A11、A12。

#### 5.10.7 S7：接入工作流并清理替代入口

1. 前置条件：S2–S6 的针对性测试通过；暂存草案清理已获授权。
2. 文件：第 5.9 节 CI 文件、过滤器、根命令别名及删除清单。
3. 动作：让本地命令与 CI 调用共用模块。保留现有 required
   check 名称，再删除 Docker 和分散启动入口。
4. 产出：原生验证工作流与唯一操作入口。最终验收关联项：A13、A15。

#### 5.10.8 S8：完成操作文档与交付验收

1. 前置条件：S7 完成；S2–S7 的针对性测试通过。
2. 文件：根 `AGENTS.md`、`docs/environment-operations.md` 及第 5.9 节文档入口。
3. 动作：后续执行者在操作手册中写明首次初始化、发布、回退和恢复的完整命令顺序。各流程包含执行目录、预期结果和日志位置；参数定义引用 CLI 帮助，配置字段定义引用 schema。
4. 动作：后续执行者编写故障处理方法，覆盖身份冲突、端口占用、迁移失败、部署失败和恢复中断。
5. 动作：后续执行者核对实施后的目录与配置，将第 5.2 节规定的内容写入根
   `AGENTS.md`，并在操作手册与开发索引中引用“三环境目录约定”节。
6. 动作：后续执行者按第 7.4 节执行独立文字审计。
7. 产出：目录约定、操作手册、全量检查结果和三环境验收证据。最终验收关联项：第 7 节全部必需项。

## 6. 方案待决策项清单

### 6.1 缺失事实与用户决策

1. **D1：局域网地址保持方式。** 操作者可在路由器保留本机配置所用的局域网地址；主机地址变化后，需更新环境配置并逐个重启环境。公网访问的域名、证书和入口范围须另行确认。
2. **D5：停机与保留。**
   用户需指定迁移、备份和恢复演练的停机窗口，以及可接受的数据恢复时间点。建议先采用第 5.8 节保留策略；备份空间和最终保留期限待确认。
3. **D6：CI 执行主机。** 当前 `.github/workflows/native-environments.yml` 已配置 macOS runner。本机发布归档由本机 macOS arm64 构建；工作流指定 runner 的可用额度与固定软件安装结果仍待远端验证。
4. **D7：实施基线与草案归属。**
   独立 worktree 以第 3.1 节的提交为基线。用户需确认是否批准清理主目录中第 5.9 节的暂存 Docker 草案。

### 6.2 后续实施需要取得的授权

1. 清理主目录中第 5.9 节的暂存 Docker 草案。
2. 安装第 9 节范围以外的依赖版本，或执行范围以外的安装生命周期脚本。
3. 修改主机名解析，或扩大第 9 节已批准的访问范围。
4. 读取其他数据来源，或停止写入并迁移已有业务数据。覆盖实际环境数据的恢复演练需单独授权。空库初始化范围见第 9 节。
5. 超出第 9 节第 13 项仓库及工作流范围的推送或远端执行操作，须另行取得授权。
6. 调用真实模型时，须明确供应商、模型、样本数和预算。

## 7. 计划验收清单

### 7.1 证据保存规则

1. 后续执行者将每项证据写入
   `E/logs/operations/<operationId>/acceptance/<验收编号>/`。每项包含命令参数、前置状态、预期结果、实际结果和引用日志。
2. 跨环境验收在 staging 操作记录中汇总三环境证据路径。数据库、角色内容和密钥仅保存在环境内的授权目录；汇总报告只引用脱敏结果。
3. staging 发布准入要求 A01–A06、A08–A15 和 B01–B09 通过。涉及三环境同时运行或故障注入的项目先在隔离三环境完成；dev 与 staging 的实际入口还须完成 B01–B09。A07 的 prod 比较在部署后完成。
4. 准入通过后生成
   `staging-acceptance.json`。文件保存发布标识、原归档位置、配置摘要、验收项结论和操作者确认。prod 部署必须读取该文件并核对原归档内容。
5. prod 部署后，执行者在实际三环境复验 A01、A03、A04、A07、A14，并在 prod 执行 B01–B09。结果保存为
   `prod-acceptance.json`。
6. 全部交付要求上述两个阶段通过。涉及覆盖数据和失败注入的项目使用隔离副本，并在证据中标明目标目录。B01、B07 的故障操作按第 7.3 节指定的环境执行。

### 7.2 环境与发布验收

1. **A01：目录与配置。** 对三个环境执行 `init`
   和配置验证。预期目录名称与职责符合第 5.2 节，绝对数据路径各自独立。默认端口分配符合第 5.3 节。证据：目录树、脱敏配置和路径归属结果。
2. **A02：统一命令。**
   从 dev 根目录及另一工作目录分别执行帮助、状态和配置验证。预期同一环境得到同一解析结果；非法参数返回
   `2`。证据：帮助输出、参数 schema 和结果文件。
3. **A03：同时运行与隔离。**
   启动三个环境，再各自创建独立账号、角色和文件。预期其他环境查不到测试记录，Cookie、密钥、日志、数据库和备份路径独立。证据：3 组浏览器入口、API 响应及存储清单。
4. **A04：目标环境启停。**
   依次启动、停止、重启每个环境。预期只有目标环境 PID、端口和健康结果改变。其他环境连续请求成功，进程身份保持不变。证据：操作前后进程表和连续探针日志。
5. **A05：开发热更新。**
   修改 API 源码、shared 源码及 3 个前端的测试页面，再恢复测试改动。预期 API 和页面均反映修改，HMR 连接经过 Nginx，目标端口保持固定。证据：浏览器网络记录、页面结果和 watcher 日志。
6. **A06：独立产物。**
   在无法访问构建目录依赖的位置运行产物。预期 API、迁移入口、角色 `.mjs`
   worker 和 3 个前端可用；依赖路径全部位于归档解包目录。证据：Node
   ABI、加载结果和目录引用扫描。
7. **A07：一次构建与同产物发布。**
   将 staging 已验收归档部署至 prod。预期原归档逐字节相同，发布清单一致，部署期间没有构建或安装步骤。证据：比较结果、两端清单与部署记录。
8. **A08：迁移失败与重试。** 在隔离库注入失败迁移和失败修复阶段。预期返回
   `6`，API 启动被拒绝，阶段记录明确；修复或恢复后可重试，成功迁移重复执行不重复写入。证据：迁移记录、表行数与失败阶段。
9. **A09：部署失败。**
   分别使用损坏归档、缺失依赖、错误 ABI 和解包中断夹具。预期返回
   `5`，运行指针保持或恢复到原值，数据目录未被产物覆盖。证据：指针、归档检查与操作日志。
10. **A10：应用回退。**
    用允许回退的数据副本切换至前一产物。预期数据保留、业务读取和写入通过；迁移序列不支持时返回
    `3`。证据：回退前后发布标识和业务结果。
11. **A11：恢复演练。**
    备份包含角色文件和加密模型档案的隔离数据，修改数据后恢复。预期数据库完整性通过、外键检查无错误、文件引用完整、模型档案可读。分别构造当前数据库外键错误和角色文件缺失，确认仍可从完整备份恢复。中断恢复后可按记录回到操作前状态。证据：备份清单、原始快照、恢复阶段和查询结果。
12. **A12：现有数据迁移。**
    按第 9 节已确认的数据归属准备隔离目标。预期表行数变化符合迁移声明，角色文件数量与内容相符，源数据仍可恢复。证据：来源清单、授权引用与目标业务验收。
13. **A13：CI 复用。**
    本地与 CI 运行同一验证入口。预期断言和退出码一致，工作流上传结果目录，现有 required
    check 名称保留。证据：命令列表和 CI 运行链接。
14. **A14：重复调用与状态冲突。**
    重复执行初始化、启动、停止、构建、部署、迁移和备份；并发执行不同环境操作。另模拟 PID 复用与同环境版本变化。预期无重复进程、无目录串用，身份冲突返回
    `4`，其他环境继续运行。证据：进程身份与操作记录。
15. **A15：完整交付。**
    执行第 7.4 节全量检查，核对替代入口和文档引用。逐项对照实际目录、配置和根
    `AGENTS.md`
    的“三环境目录约定”。预期三者一致、文档引用有效、删除清单完成，且全量检查和语义审计通过。证据：目录对照结果、全量报告、引用搜索和审计结论。

### 7.3 页面、协议与业务验收

1. **B01：健康接口。** 在实际环境请求三个入口的 `/healthz` 和
   `/api/health`。预期分别返回 `204`
   及第 3.2 节 JSON。在隔离环境仅停止 API 时，`/healthz` 继续返回
   `204`，`/api/health` 返回代理失败。
2. **B02：前端页面。**
   打开管理 Web、用户 Web 和 Studio，并刷新 Studio 的内部路由。预期页面、JS、CSS 均成功加载，刷新仍可进入页面，资源缺失返回
   `404`。
3. **B03：用户身份。** 在用户 Web 完成注册、登录、读取 `/api/auth/me`
   和退出。预期账号归属正确，退出后会话失效；另一环境保持其原登录状态。
4. **B04：资源持久化。** 通过管理 Web 导入原生角色包，读取
   `/api/role-assets/:versionId/*`，重启后再次读取。预期版本、字节内容和账号归属一致。
5. **B05：演绎会话。**
   选择角色、具名演绎人格和开场，建立会话并调用 dry-run。逐项核对人格完整描述、历史说话者、当前输入和预设人称；证据引用实际
   `messages` 与追踪字段。
6. **B06：SSE。** 使用仓库本地模型夹具调用
   `/api/sessions/:id/respond/stream`。预期浏览器在生成完成前收到多个事件，正文保存后可再次读取。分别记录首个事件、后续事件和完成时间。
7. **B07：WebSocket。** 通过 Nginx 连接
   `/ws`，使用接口要求的认证信息。预期返回协议升级并收到目标会话事件。在隔离三环境中关闭目标 API，预期其他环境连接继续工作。
8. **B08：Studio。**
   保存一份测试图并重新载入；使用本地夹具执行受支持的测试节点。预期 API 请求指向本环境，保存内容一致，执行结果和服务端记录一致。
9. **B09：上传边界。**
   对第 5.4 节涉及的上传入口提交有效边界与超限样本。预期有效样本通过代理到达 API，超限请求返回对应错误，错误正文可被前端显示。
10. 执行者按第 7.1 节安排业务验收。prod 使用专属验收账号与获批夹具，验收后保存证据并清理验收数据。真实模型输出质量按第 6.2 节授权单独采样。

### 7.4 测试顺序与全量检查

1. 实施使用测试驱动开发（TDD）：先写能稳定失败的行为测试，再编写功能代码，最后整理结构。测试只判断配置、文件、进程、协议和数据等确定性结果。
2. S2–S7 只运行变更模块及直接消费者的针对性测试。数据库测试使用隔离库，进程测试使用临时根目录和本地夹具。
3. 全部代码完成后，在隔离验证源码目录按[操作手册第 8 节](../docs/environment-operations.md#8-验证与持续集成)执行全量检查。检查命令由该节指定的结构化配置维护。
4. 执行第 7.2–7.3 节环境与业务验收。人工操作记录和真实模型样本分别保存证据。
5. 生成检查完成后比较 OpenAPI、类型和派生配置文件，确认受版本控制的生成物没有未提交差异。失败项记录准确命令、退出码与日志路径。
6. 执行者通过 team-mode 派发干净上下文队员，按仓库文字规范逐行审计 `AGENTS.md`、操作手册及改动文案。每项问题修正并复核通过后，文案验收完成。

## 8. 非本次目标

1. 系统服务托管，包括 launchd、PM2 和 Homebrew services。
2. 开机自启、定时启动及崩溃自动拉起。
3. Docker、Docker Compose 和容器部署路径。
4. 多主机部署、零停机切换、自动扩缩容和数据库高可用。
5. 仓库业务功能改造；依赖升级范围以第 9 节已获得的授权为准。

## 9. 已获得的授权

1. 用户已授权创建独立 worktree，并只读调研源码、配置、工作流、主机软件、监听端口和目标目录。
2. 用户已授权在独立 worktree 编写本计划，并交付到用户指定的 dev 源码目录下的 `plans/dev-staging-prod-native-environments-plan.md`。
3. 用户已授权派发独立队员逐行审计本计划，并修正文档问题。
4. 用户已确认 dev 保留现有数据，staging 使用独立验收数据，prod 从空库初始化。验证数据库保留为 dev 测试资料。
5. 用户已通过 `implement` 授权在独立 worktree 实施本计划，包括源码、包管理文件、CI、操作文档与根 `AGENTS.md` 的修改。执行第 6.2 节所列操作前，执行者须取得对应授权。
6. 用户已授权先修复依赖风险，再决定安装范围。该授权覆盖依赖清单、锁文件和必要的源码适配；安装授权见本节第 8 项。
7. 用户已授权修改角色卡转换 Skill 的 `formal.ts`、`preview.ts`、`convert.mjs` 及对应测试。
8. 用户已批准安装 Node.js `22.23.4`、复用 pnpm `10.34.5`，并在独立 worktree 安装锁定项目依赖。允许执行的生命周期为根 `postinstall`、`prepare`、better-sqlite3 的 `install` 和 esbuild 的 `postinstall`。
9. 用户已批准修改角色卡转换 Skill 的 `source-format.ts`、`state-write.ts` 及对应测试，以适配 Zod 4 的输入诊断和校验路径类型。
10. 用户已批准安装第 3.5 节的 Nginx 及其固定主机依赖，并在隔离目录执行 Nginx 验收。

11. 用户已授权本机和局域网访问及三环境部署。执行者可初始化独立运行目录、配置和密钥，安装获批固定依赖。执行者可创建本地发布标签、手动控制进程并迁移空库。既有 dev 数据按本节第 4 项保留。
12. 用户已批准修复 SSE 连接的关闭流程，并继续定位和修复 staging 停止超时。
13. 用户已批准将实施分支与发布标签推送到 `fzfz/TavernHeadless`，并运行远端 CI 和原生发布验证。
14. 用户已批准将 194 份源码文档中的 3919 项既有 Markdown 检查问题登记为基线。文档检查必须继续拒绝新增问题，并移除已修复问题对应的基线条目。
