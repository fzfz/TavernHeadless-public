---
文档用途: "说明 dev、staging、prod 原生环境的手动操作、发布、备份与恢复流程。"
读取时机: "准备环境、操作进程、构建发布版本或处理环境故障前读取。"
---

<!-- markdownlint-disable MD013 -->

# 原生环境操作手册

## 1. 操作入口与配置来源

1. 在 dev 源码根目录执行
   `node scripts/environments/cli.mjs <command> --env <dev|staging|prod>`。`pnpm environment`
   调用相同入口。后文中的子命令均接在 `node scripts/environments/cli.mjs` 后执行。
2. 目录规范见根
   [AGENTS.md](../AGENTS.md#三环境目录约定)。关联 worktree 从 Git 主工作区读取
   `config/environments.json`。
3. 执行 `node scripts/environments/cli.mjs --help` 查看子命令。执行
   `<command> --help` 查看参数类型、必填项、默认值和示例。参数定义位于
   `scripts/environments/commands.json`。
4. `--input <JSON文件>` 读取同名参数；`--input -`
   从标准输入读取。文件与命令行重复定义同一参数时返回 `2`。
5. 独立 worktree 使用 `--sandbox <绝对目录>` 验证。该模式读取公开模板 `config/environments.example.json`，把运行目录重定位到验证目录。验证目录必须与源码及实际三环境目录分离。实际环境操作使用第 1 项的统一入口。

## 2. 软件与依赖准备

1. 从根 `package.json` 的 `engines.node`、`packageManager`
   读取 Node.js 和 pnpm 固定版本。从环境配置的 `tools`
   读取主机软件版本：首次配置前读取 `config/environments.example.json`，已有配置时读取 `config/environments.json`。命令会拒绝版本不符的工具。
2. 安装前取得依赖安装授权。授权范围包括固定版本、项目锁文件，以及 `package.json`
   和 `pnpm-workspace.yaml` 声明的安装生命周期脚本。
3. 本机工具安装后，从 dev 根目录执行
   `pnpm install --frozen-lockfile`。锁文件格式需要升级时，先在独立 worktree 生成并审阅锁文件，再重新执行冻结安装。
4. 执行
   `pnpm --filter '@tavern/api^...' --filter '@tavern/web^...' --filter '@tavern/user-web^...' --filter '@tavern/studio^...' run build`，生成工作区依赖与前端配置契约。
5. 运行
   `pnpm audit --json --registry=https://registry.npmjs.org`，把报告保存到本次操作证据目录。按生产依赖、浏览器依赖和构建测试工具分别评估可触发路径；生产发布前处理未接受的风险。
6. 原生模块 ABI 不匹配时，在固定 Node.js 下重新安装获批依赖并重新构建产物。发布环境通过完整归档接收依赖。
7. 本机 Nginx 与 OpenSSL 由 `tavern/native-environments` 本地 Homebrew tap 提供。固定公式来源、安装命令和链接结果见 [依赖审计快照](provenance/native-dependency-audit.json) 的 `hostToolInstallation`。重装或升级前，先执行 Homebrew 安装预览，核对解析出的全部依赖版本，再取得对应安装授权。

## 3. 首次初始化与配置

1. 创建本机环境配置并初始化 dev：

   1. 在 dev 源码根目录执行 `cp -n config/environments.example.json config/environments.json`，创建缺失的本机配置并保留已有文件。
   2. 填写三环境的绝对根目录、主机名、访问别名和工具路径。dev 根目录填写当前源码目录；staging 与 prod 使用独立目录。模板中的根目录和地址仅供示例，其他配置字段按模板维护。
   3. 执行 `init --env dev`，预期创建缺失目录和环境变量模板，保留已有配置与数据。

2. 编辑目标环境的 `config/application.env` 和
   `config/secrets.env`。模板位于 `config/environments/`；文件职责与权限见第 1 节引用的目录规范。
3. 配置每个环境独立的认证凭据和 `APP_SECRETS_MASTER_KEY`。`AUTH_MODE=api_key`
   时填写 `AUTH_API_KEYS`；JWT 模式填写 `AUTH_JWT_SECRET`。其他认证要求以
   `apps/api/src/config.ts` 为准。用户 Web 注册与登录需要 `ACCOUNT_MODE=multi`；API Key 模式同时填写 `AUTH_API_KEY_ACCOUNTS`，将管理凭据映射到本环境的 `default-admin`。
4. 环境文件每行定义 1 个变量，变量名唯一。
5. 配置覆盖与继承规则见[实施计划第 5.3 节](../plans/dev-staging-prod-native-environments-plan.md#53-配置来源与覆盖规则)。
6. 执行 `migrate --env dev`
   初始化空库。已有数据库先按第 6 节备份，再传入 `--backup <backupId>`。
7. staging 和 prod 按第 5 节对应的初始化步骤创建 worktree，随后按本节第 2–5 项填写各环境配置。
8. 首次初始化时，dev 保留该目录内的业务数据，staging 使用独立验收数据，prod 从空库初始化。
9. 环境地址只写入运行配置。`config/public`
   由命令生成：管理 Web 的角色入口、用户 Web 的 API 与管理入口，以及用户 Web 运行策略。API 地址统一为
   `/api`。

## 4. 手动进程操作

1. 执行
   `start --env dev`。预期数据库预检通过后启动 API、3 个 Vite 和该环境的 Nginx。发布模式启动 API 与 Nginx，Nginx 提供归档中的 3 个静态站点。
2. 执行 `status --env dev`。预期状态为
   `running`，API 和 3 个浏览器入口健康。`--probe false`
   只核对进程身份和端口归属。
3. 执行
   `stop --env dev`。预期先停止 Nginx，再结束目标环境 API 与开发服务，并确认端口释放。
4. 执行
   `restart --env dev`。预期停止成功后重新启动目标环境，其他环境继续运行。启动等待时间可通过
   `--timeout-seconds` 调整。
5. 只有正常停止超时且进程身份仍匹配时，使用
   `stop --env dev --force`。身份不匹配时先读取结果文件，核对 PID、启动时间、UID、工作目录、命令和进程组。
6. 重复启动已经健康运行的同一配置，或重复停止已经退出的环境，预期返回
   `0`。运行期间有组件退出时，`status` 返回 `degraded`；操作者读取组件日志后执行目标环境的 `restart`。
7. 浏览器入口由环境配置中的 `hostname` 或 `hostAliases` 与各前端 `http` 端口组成。`/healthz`
   预期返回 `204`，`/api/health`
   预期返回 API 健康 JSON。开发热更新连接经过同一 Nginx 入口。

8. 主机地址变化后，先更新 `config/environments.json`，再逐个重启环境。

## 5. 构建、验收与发布

1. 完成代码检查并确定已批准标签。[发布标识](../plans/dev-staging-prod-native-environments-plan.md#1-名词定义)须唯一，发布归档与标签提交绑定。
2. 执行 `node scripts/environments/installation-approval.mjs --ref <tag> --output <授权JSON>` 生成安装授权草案。核对草案中的标签、提交、工具版本和生命周期脚本。`approved` 默认值为 `false`；取得对应授权后，使用同一命令增加 `--approved`。
3. 执行
   `build --env dev --ref <tag> --release <releaseId> --installation-approval <授权JSON>`。预期在隔离目录导出标签源码、安装冻结依赖并构建，输出包含运行依赖的归档、清单和验证结果。
4. 执行
   `verify --env dev --suite release --release <releaseId>`。预期归档文件、原生模块、迁移入口和前端构建完整，依赖解析留在归档解包目录内。首次部署 staging 时，执行 `init --env staging --release <releaseId>`，再按第 3 节第 2–5 项填写 staging 配置。
5. 执行 `stop --env staging`。已有数据时，执行 `backup --env staging --backup <backupId>`。随后执行
   `migrate --env staging --release <releaseId>`，已有库同时传入 `--backup <backupId>`。
6. 执行 `deploy --env staging --release <releaseId>`，再执行
   `start --env staging`。部署预期保持停止状态；启动由操作者显式执行。
7. 按[原生环境实施计划第 7 节](../plans/dev-staging-prod-native-environments-plan.md#7-计划验收清单)执行环境、页面和业务验收。将人工操作证据整理为验收索引，执行
   `verify --env staging --suite acceptance --release <releaseId> --evidence <索引JSON>`。
8. 代码或依赖变化后使用另一发布标识，重新经过 staging 验收。同名归档输入冲突时，先查清归档来源。

### 5.1 prod 发布

1. 确认已有授权覆盖本次 prod 发布；尚未覆盖时，取得本次发布授权。首次部署时，执行 `init --env prod --release <releaseId>`，再按第 3 节第 2–5 项填写 prod 配置。
2. 执行 `stop --env prod`。
3. 已有数据时，执行 `backup --env prod --backup <backupId>`。
4. 执行 `migrate --env prod --release <releaseId>`。已有库同时传入 `--backup <backupId>`。
5. 执行 `deploy --env prod --release <releaseId> --acceptance <staging验收文件>`，并在发布记录中保存发布标识和 staging 验收文件。
6. 执行 `start --env prod`。按实施计划第 7.1 节第 5–6 项完成 prod 部署后验收，再执行 `verify --env prod --suite acceptance --release <releaseId> --evidence <索引JSON>`。证据格式见第 8 节。
7. 比较 staging 与 prod 保存的原归档。预期逐字节相同，部署日志中没有重新构建或安装步骤。

## 6. 备份、回退与恢复

1. 数据操作前执行
   `stop --env <name>`。备份命令通过 SQLite 备份接口保存数据库，并保存同批文件、配置和密钥。
2. 执行
   `backup --env <name> --backup <backupId>`。预期完整性和外键检查通过，备份清单包含迁移序列、表行数、文件清单及密钥标识。完整备份目录权限为
   `0700`。
3. 按第 6.1 节完成兼容性验收并保存记录。随后执行
   `rollback --env <staging|prod> --release <目标版本> --backup <操作前备份> --compatibility <兼容性记录>`。应用回退保持业务数据原样。
4. 迁移改变了目标应用所需的数据结构或含义时，使用配套备份恢复。恢复会以备份时间点的数据替换当前数据。dev 先执行 `restore --env dev --backup <backupId> --preview`；staging 和 prod 执行 `restore --env <staging|prod> --backup <backupId> --release <匹配版本> --preview`。核对预览中的数据时间点、替换目录和匹配版本。
5. 取得使用备份替换目标环境当前数据的授权后，按第 6.2 节保存授权记录。将对应预览命令中的 `--preview` 替换为
   `--authorization <授权JSON>`，再执行恢复命令。dev 恢复要求源码提交与备份一致，且受版本控制的文件无未提交改动。
6. 恢复成功后，当前数据与所选备份一致，服务保持停止。结果中的 `previousSnapshot` 给出操作前原始快照的目录与清单路径。
7. 确认原始快照已保存后，执行
   `start --env <name>`，再执行健康、登录、角色文件读取、模型档案读取和会话验收。
8. 产物与备份保留规则见[实施计划第 5.8.4 节](../plans/dev-staging-prod-native-environments-plan.md#584-产物备份与操作记录保留)。清理前确认保留的备份仍有配套发布归档、配置和密钥，记录被清理的标识和对应授权。

### 6.1 应用回退兼容性记录

1. 确认目标应用支持当前完整迁移序列，并使用目标应用在当前数据副本上完成读写验收。保存请求、结果和数据库查询证据，再填写下表中的 JSON 字段。将记录放在目标环境的操作证据目录，以其绝对路径传给 `--compatibility`。

   | 字段                | 值的来源                                                              |
   | ------------------- | --------------------------------------------------------------------- |
   | `fromRelease`       | 目标环境当前发布标识。                                                |
   | `release`           | 本次回退的目标发布标识。                                              |
   | `backup`            | 本次操作前 `backup` 命令返回的备份标识。                              |
   | `readWrite`         | 读写验收全部通过后填写字符串 `passed`。                               |
   | `migrationSequence` | 原样复制目标产物 `manifest.json` 中的同名数组，保留字段、类型与顺序。 |

2. 保存读写验收证据与记录的对应关系。回退命令核对字段、当前备份和迁移序列；操作者负责确认读写验收结果。

### 6.2 数据恢复授权记录

1. 将第 6 节第 5 项取得的授权来源与以下 JSON 保存在目标环境的操作证据目录；以 JSON 文件的绝对路径传给 `--authorization`。

   ```json
   {
     "approved": true,
     "environment": "staging",
     "backup": "<预览中的备份标识>",
     "release": "<预览中的发布标识>"
   }
   ```

2. 按预览结果填写字段。dev 的 `release` 填写 JSON 值 `null`。授权记录只对应这次确认的恢复对象。

## 7. 日志与故障处理

1. 命令标准输出返回 `operationId`、状态、退出码和
   `resultPath`。完整结果与命令日志保存在目标环境操作目录。环境初始化完成前的状态、日志查询及初始化失败记录位于返回的临时目录。
2. 执行 `logs --env <name> --component operations --operation <operationId>`
   查看操作结果路径。省略操作标识时选择最近一次记录。
3. 执行 `logs --env <name> --component api --follow`
   持续读取进程日志。正常数据写入标准输出，诊断写入标准错误。日志写入前隐藏已配置密钥。
4. 按退出码处理故障。

   | 退出码（定义见实施计划第 5.5 节第 5 项） | 处理动作                                           |
   | ---------------------------------------- | -------------------------------------------------- |
   | `2`                                      | 使用对应子命令的 `--help` 修正参数或配置。         |
   | `3`                                      | 补齐工具、归档、备份、迁移状态或授权输入。         |
   | `4`                                      | 查询目标环境状态，核对进程身份与端口占用。         |
   | `5`                                      | 检查构建日志、归档清单、依赖和原生模块平台。       |
   | `6`                                      | 查看迁移或恢复阶段，选择修复后重试或恢复配套备份。 |
   | `7`                                      | 查看失败探针和测试证据，修复后重跑对应验收。       |
   | `130`                                    | 确认中断后的进程和数据状态，再决定重试步骤。       |

5. 迁移失败时，保持环境停止，并从迁移结果文件中确认最后完成的阶段。
6. 部署失败时核对 `current`
   与源码提交。数据库已经迁移时，只有兼容性验收通过的应用才可重新启动。
7. `/healthz` 成功而 `/api/health`
   失败时，检查 API 进程、迁移预检和代理日志。前端资源返回 `404`
   时，检查当前归档和对应站点路径。

## 8. 验证与持续集成

1. 按[实施计划第 7.4 节](../plans/dev-staging-prod-native-environments-plan.md#74-测试顺序与全量检查)安排测试顺序。环境模块使用
   `node --test scripts/environments/*.test.mjs`；API 与客户端使用各自现有测试入口。
2. 交付前执行 `verify --env dev --suite full`。检查来源为
   `docs/agents/development-checks.json`，并包含环境测试与 Studio 独立测试。
3. 在 GitHub Actions 手动运行 `CI`，选择待验收分支，填写 `release_ref`、`release_id`，并将 `installation_approved` 设为 `true`。该入口调用 `.github/workflows/native-environments.yml`，在 macOS runner 执行同一 `verify` 和 `build` 命令。CI 归档用于验证；本机 prod 的候选归档由当前 macOS 主机构建。
4. 验收索引使用 `schemaVersion: 1`，填写 `environment`、`release`、`commit`、`operatorConfirmed: true`，以及 `checks: [{ id, evidencePath }]`。必需验收编号见 `scripts/environments/acceptance.json`。
5. 每个证据文件使用以下字段。将文件保存到目标环境的操作证据目录，并把路径填入索引的 `evidencePath`；相对路径从索引所在目录解析。操作者逐项确认结果后提交索引。字段与入口探针的验证规则见 `scripts/environments/verify.mjs`。

   | 字段                                                | 填写要求                                                                               |
   | --------------------------------------------------- | -------------------------------------------------------------------------------------- |
   | `schemaVersion`、`environment`、`release`、`commit` | 与第 4 项索引的同名字段一致。                                                          |
   | `id`                                                | 与索引中对应验收项的编号一致。                                                         |
   | `status`                                            | 通过填 `passed`，失败填 `failed`。                                                     |
   | `commands`                                          | 非空数组；每项为 `{ file, args }`。程序路径 `file` 为非空字符串，`args` 为字符串数组。 |
   | `preconditions`、`expected`、`actual`               | 分别记录前置条件、预期结果和实际结果，各字段均须填写。                                 |
   | `logs`                                              | 非空的日志文件路径数组；相对路径从当前证据文件所在目录解析。                           |

6. 通过的验收文件保存在本次操作目录，名称为 `<environment>-acceptance.json`。prod 部署读取 staging 的该文件。
7. 真实模型验收须先确认供应商、模型、样本数和预算。离线夹具负责确定性的组装、协议和持久化验收。

8. 文档检查与基线维护见[测试与 CI 规范](testing-and-ci.md#文档检查基线)。
