<!-- markdownlint-disable MD013 -->

# 首批实施决策与执行状态

## 必须要实现的目标

执行 Agent 在独立工作树实施首批计划。本文件记录已获准的共享校验器依赖清单，并记录用户确定的本机直接访问范围。

### 校验器依赖

执行 Agent 将以下准确版本写入根 `package.json` 的 `devDependencies`，由 `scripts/generate-role-runtime-validators.mjs` 使用，并更新 `pnpm-lock.yaml`。生成器产出的浏览器校验器包含所需代码。执行 Agent 同时将已获准的 `ajv@8.18.0` 写入 `apps/api/package.json` 的 `dependencies`，供 `StateUpdateService` 校验角色版本携带的变量 schema。

| 包 | 准确版本 | 用途 | 安全审计意见 |
| --- | --- | --- | --- |
| ajv | 8.18.0 | 将共享 JSON Schema 编译为独立校验器，并在后端校验角色变量 schema | [官方发布说明](https://github.com/ajv-validator/ajv/releases/tag/v8.18.0)记录了 CVE-2025-69873 的修复。本生成器使用仓库内 schema，保持 `$data` 关闭。 |
| esbuild | 0.28.1 | 将独立校验器打包为浏览器模块 | [官方发布说明](https://github.com/evanw/esbuild/releases/tag/v0.28.1)记录了 Windows 开发服务器路径问题及 Deno 下载校验问题的修复。本生成器只调用 Node 构建 API。 |

审计日期为 2026-09-24。上述结论针对所列官方公告；执行 Agent 安装后还须审计锁文件中的传递依赖，并提交实际结果。安装仅发生在本工作树，原工作树的依赖目录保持原状。

### 角色导入 YAML 依赖（已获授权）

角色卡的世界书初始条目及开场 `initvar` 使用 YAML。原型从未声明的传递依赖加载解析器；正式 `RoleImportService` 需要直接依赖。用户已批准安装 `yaml@2.9.1`。执行 Agent 已在 `apps/api/package.json` 的 `dependencies` 中声明该准确版本，更新锁文件，并在本工作树使用 `--ignore-scripts` 完成安装，供 `RoleImportService` 解析初始变量和开场数据。

安全审计日期为 2026-09-24。[官方安全公告](https://github.com/eemeli/yaml/security/advisories/GHSA-48c2-rrv3-qjmp)将 CVE-2026-33532 的 2.x 受影响范围列为 `>=2.0.0 <2.8.3`；所选版本高于修复版本。[2.9.1 发布说明](https://github.com/eemeli/yaml/releases/tag/v2.9.1)包含递归合并别名限制修正。npm 元数据表明该版本没有运行时依赖；npm 安全公告接口对该准确版本的查询返回空结果，记录见本目录 `yaml-dependency-audit.json`。执行 Agent 在导入错误处理中保留解析异常，并向管理员返回修正 YAML 数据的指引。

### 本机访问范围

用户已明确当前应用在本机开发与部署，打开页面即可聊天，身份方案另议。执行 Agent 必须以会话标识连接角色配置页与用户聊天页，保留草稿修订信息，并将身份入口留待用户另行确定。

执行 Agent 必须删除创建 `role_preview_handoff` 和 `role_preview_access` 两张表的 `apps/api/drizzle/0094_role_preview_access.sql`、迁移清单中的对应项，以及依赖这两张表的接口、SDK 方法和前端凭据逻辑。用户已明确该迁移尚未执行，本次直接删除原迁移。

本节取代首批计划及两端总计划中关于试聊交接码、凭据兑换和正式身份入口的本批实施要求。其他已获授权的角色配置、演绎、调用记录和显示功能继续按原计划执行。

## 验收清单

- [x] 执行 Agent 已完成 YAML 准确版本声明、锁文件更新及安装；12 项解析与角色准备测试和 4 项正式 API 导入测试通过，覆盖正常 YAML、解析异常、空值、非对象初始变量和两套完整角色。结果记录在本目录的 `execution-status.json`，安装审计保存在 `yaml-installation-audit.json`。

- [x] 执行 Agent 已安装获准的两个版本，完成 7 项生成校验器测试与共享包编译；安装目录的依赖审计结果保存在本目录的 `dependency-audit.json`。
- [x] 执行 Agent 已核对工作区锁文件，仅保留获准准确版本及用户端已有依赖的声明，结果保存在本目录的 `lockfile-review.json`。
- [ ] 执行 Agent 验证用户端按会话标识直接打开与刷新恢复，并检查新建数据库中只保留本批所需的角色与演绎数据表。
- [x] 执行 Agent 已使用迁入基线提交 `80865e3` 作为首批新增实现的审阅比较点，并将审阅结果保存到本目录的 [code-review.md](code-review.md)。

## 非本次目标

用户注册、登录、会员权限、进入码、访问凭据和线上部署由用户另行确定需求。

## 已获得的授权

用户已要求建立独立 worktree 并执行首批计划，implement 技能要求完成测试、代码审阅与提交。原型当前源码和资源已复制并提交为实施基线。用户已确认安装上述两个准确版本的依赖。正式使用者身份方案继续等待另行讨论与确认。用户随后明确批准安装 `yaml@2.9.1`。
