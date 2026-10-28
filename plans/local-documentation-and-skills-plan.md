# TavernHeadless 独立文档站与开发 Skill 方案

## 必须要实现的目标

实施 Agent 必须复用当前仓库的文档源文件，在用户自己的 GitHub Pages 发布本仓库文档站，
并交付两个可由 Codex 识别的开发 Skill。用户通过网站阅读，开发 Agent 按当前 worktree 读取源文件。
文档、Skill 和代码必须随同一仓库版本保存。

本方案的“独立文档站”指由用户仓库构建、发布和维护的 GitHub Pages 网站。
文档源文件继续保存在仓库中，本地构建用于发布前验证。现有正文主要为中文。

交付目标包括：独立文档站、Pages 发布工作流、设计文档导航、代码与文档版本记录、
两个仓库级 Skill、使用说明，以及通过的验收记录。

## 已核实的基础

2026-09-14 检查的工作目录为 `TavernHeadless-inspect-20260914`，
分支为 `codex/inspect-20260914`，
HEAD 为 `5061b3cc2b0a1007beb59b7943cc61812255b83d`。该 worktree 还带有未提交改动，
因此 HEAD 只标识提交基线。

| 现有对象 | 位置及用途 |
| --- | --- |
| 文档站源文件 | `vitepress/`，包含指南、参考、SDK、Agent 和 Skill 页面 |
| 仓库设计资料 | `docs/`，包含架构、数据库、协作、测试、Studio 演进等资料 |
| 文档站配置 | `vitepress/.vitepress/config.ts` |
| Pages 发布工作流 | `.github/workflows/deploy-docs.yml` |
| Skill 页面 | `vitepress/agent/skills/`，包含客户端接入和项目贡献两个工作流 |
| Skill JSON 生成器 | `scripts/generate-skill-artifacts.ts` |
| Agent 发布资料生成器 | `scripts/generate-agent-artifacts.ts` |

在线 `agent/latest.json` 记录的提交为 `654dd1979cf872403bea874559ab0edd6cfaebf9`，
发布时间为 `2026-07-05T12:18:24.544Z`。在线提交与本地 HEAD 不同；
实施 Agent 必须在来源盘点阶段核对两者的 Git 包含关系，并写入 `sources.json`。
在线 latest 只能证明该站点声明的发布版本。

现有 Skill 提供人读页面和机器 JSON，对应的 Codex `SKILL.md` 列为本方案的新建产物。
Codex 的本地 Skill 需要独立目录和包含 `name`、`description` 的 `SKILL.md`，
因此实施 Agent 需要完成格式适配。来源见文末。

仓库 `origin` 为 `https://github.com/fzfz/TavernHeadless.git`，
`upstream` 为 `https://github.com/HerSophia/TavernHeadless`。
现有发布工作流支持 CI 完成事件和手动触发，发布条件针对 `main`。

## 文档组织与权威来源

实施 Agent 必须保留 `vitepress/` 和 `docs/` 的现有文件位置，
在 `docs/development-index.md` 新增总入口。总入口只说明阅读条件、主题和来源位置，完整正文由原文件维护。

本文的“快速开始”指 `vitepress/guide/getting-started.md`。
网站架构页面继续使用 `vitepress/guide/architecture.md`，站内路径为 `guide/architecture`；
实施 Agent 必须保留现有导航并验证该页面。`docs/architecture.md` 继续作为仓库内设计参考。

| 开发问题 | 优先查阅对象 | 用代码核对的内容 |
| --- | --- | --- |
| 安装配置启动 | 快速开始、`.env.example`、`package.json` | 启动、构建和配置加载 |
| 系统分层 | `docs/architecture.md` | `apps/`、`packages/` 职责与依赖 |
| 公开能力 | `vitepress/sdk/`、`vitepress/reference/` | SDK、OpenAPI 和路由 |
| 数据如何保存 | `docs/database.md` | `apps/api` 中的 schema、迁移和数据库实现 |
| Studio 演进 | `docs/nodegraph-studio-evolution.md` | Studio、后端和测试 |
| 验证提交 | `docs/contributing.md`、`docs/testing-and-ci.md` | 脚本和 CI |

用户与 Agent 必须区分三类信息：设计文档解释意图，代码与测试说明当前行为，已接受的变更要求说明本次目标。三者冲突时，
Agent 必须记录具体差异和涉及文件，再依据任务目标判断应修改代码还是文档。

实施 Agent 必须逐项阅读相关设计资料，在总入口标明“已核对实现”“设计提案”或“待核对”，并注明核对提交。
实施 Agent 在变更模块边界、持久化模型或公开协议时，必须将设计决定写入 `docs/adr/`，
说明背景、决定、取舍和影响。配置说明继续使用现有快速开始和环境变量模板。

## 目标目录与版本记录

以下目录树是实施产物规划；已有目录继续使用，新文件在实施阶段创建。

```text
AGENTS.md
.github/workflows/deploy-docs.yml
.agents/skills/
  tavern-project-contributing/
    SKILL.md
    references/workflow.json
    references/workflow.schema.json
  tavern-client-integration/
    SKILL.md
    references/workflow.json
    references/workflow.schema.json
docs/
  development-index.md
  adr/
  provenance/
    sources.schema.json
    sources.json
    site.schema.json
    site.json
    skill-mapping.schema.json
    skill-mapping.json
    acceptance.md
    upstream/<published-commit>/agent/
vitepress/
  guide/
  reference/
  sdk/
  agent/
```

`AGENTS.md` 负责项目规则和按任务查阅的入口。实施 Agent 必须保留已有工作约定，将正文规则留在对应权威文档中。

`sources.schema.json` 必须统一定义 `sources.json` 的结构。后者记录本地基线提交、未提交文件清单、核对时间，
以及每个来源的本地路径、源 URL、来源提交、类型和核对状态。来源提交未知时必须记录为空并标明待核对。

在线 JSON 快照保存到提交命名的目录；每次手动同步都保留旧快照。
实施 Agent 必须保存本次读取的 latest、catalog、对应 manifest 和两个 Skill JSON，并在来源记录中逐项关联。
已存在于当前 Git 提交的 Markdown 直接通过 Git 留存。

## 独立站点与 GitHub Pages 发布

### 发布目标与配置来源

实施 Agent 必须保留 `fzfz/TavernHeadless` 为私有源码仓库，
使用公开仓库 `fzfz/TavernHeadless-docs` 托管构建后的静态文档。
目标地址为 `https://fzfz.github.io/TavernHeadless-docs/`。
两个仓库均使用 `main` 分支，Agent 资料中的源码提交仍属于私有仓库。

实施 Agent 必须在 `docs/provenance/site.schema.json` 定义站点配置结构，
并在 `docs/provenance/site.json` 保存以下配置。

| 字段 | 值或用途 |
| --- | --- |
| `repository` | `fzfz/TavernHeadless` |
| `siteUrl` | `https://fzfz.github.io/TavernHeadless-docs/` |
| `basePath` | `/TavernHeadless-docs/` |
| `publishBranch` | 私有源码仓库的 `main` |
| `publicationRepository` | `fzfz/TavernHeadless-docs` |
| `publicationBranch` | 公开文档仓库的 `main` |
| `title` | `TavernHeadless · fzfz` |
| `upstreamRepository` | `HerSophia/TavernHeadless`，用于标注来源 |
| `upstreamSiteUrl` | 上游网站地址，用于来源链接和手动同步 |

VitePress 配置、发布工作流和 Agent 生成器必须读取同一站点配置。
实施 Agent 必须同步修改站点标题、仓库入口、编辑链接、页面元数据及生成器中的发布标识。
站点首页必须说明该文档对应用户维护的仓库版本，并保留上游来源、许可证和署名。

### 构建与发布流程

实施 Agent 必须复用 `.github/workflows/deploy-docs.yml`，
在私有仓库构建 `vitepress/.vitepress/dist`，并通过 `scripts/publish-docs.sh`
将该目录同步到公开文档仓库。公开仓库仅保存静态产物、许可证和 `.nojekyll`。
仓库管理员必须将公开仓库的 Pages 来源设置为 `main` 分支根目录。

发布工作流的构建任务必须检出通过 CI 的准确提交，按锁文件安装依赖，
执行项目要求的检查和文档构建，再同步静态文件。
手动发布必须核对目标提交对应的成功 CI 结果。
站点和 Agent JSON 必须显示实际构建提交，CI 状态必须引用真实运行结果。

实施 Agent 必须为公开仓库创建专用可写部署密钥，
将私钥保存为私有仓库的 `DOCS_DEPLOY_KEY` Actions secret。
发布工作流必须使用该密钥检出并推送公开仓库。

自动发布目标为本仓库 `main` 的成功 CI 提交；启用事件触发的授权条件见“已获得的授权”。
发布失败时，实施 Agent 必须保留失败记录并检查此前站点的可用状态。
需要回退时，实施 Agent 必须选择已成功发布的本仓库提交，重新构建并发布，记录回退提交。

本地验证保留以下现有命令：

```bash
pnpm docs:build
```

根级命令会依次生成 Agent 资料、Skill JSON 和 VitePress 站点。
实施 Agent 必须先完成下一节规定的生成器来源调整，再执行此命令。
方案以构建检查和部署后浏览作为验收方式。

### Agent 发布资料与上游隔离

现有 Agent 生成器会请求在线历史并重建 `vitepress/public/agent/`，
Skill 生成器随后重建其中的 `skills/`。
实施 Agent 必须把归档资料保存在 `docs/provenance/`，
并将 `public/agent/` 作为可重新生成的站点产物。

本仓库的 `latest.json`、history、manifest 和 Skill 目录必须引用本仓库的提交、
站点路径及发布记录。生成器读取发布历史时必须使用 `siteUrl`，
上游资料通过 `upstreamSiteUrl` 手动获取并保存到来源快照目录。
首次发布尚无本仓库历史时，生成器必须明确记录首次发布并只生成当前提交记录。

实施 Agent 必须核对 `AGENT_REPOSITORY`、`AGENT_PUBLIC_SITE_URL`、
`AGENT_BASE_PATH` 与站点配置一致，并核对本地构建和 CI 构建的配置加载结果。
页面及 Agent JSON 必须区分当前发布提交和上游参考提交。

## Skill 适配与使用

### 实施 Agent 的开发工作

实施 Agent 必须首先阅读上游两个人读页面和 JSON，将工作流适配为两个仓库级 Skill：

| Skill | 触发任务 | 主要工作 |
| --- | --- | --- |
| `tavern-project-contributing` | 修改项目模块 | 边界、公开语义、测试和文档 |
| `tavern-client-integration` | 接入或升级客户端 | SDK、协议和流式行为 |

Skill 正文只定义适用条件、输入、执行步骤、参考资源和完成条件。上游的分支策略、CI 要求等项目流程由 `AGENTS.md` 和仓库协作文档维护；
Skill 通过显式输入获得当前项目的规则文件和文档入口。

每个 Skill 的 `references/workflow.json` 保存经审阅的任务决策资料，
由同目录 `workflow.schema.json` 定义结构和约束。
实施 Agent 必须从现有 JSON 获取结构化输入，再由 Agent 阅读 Markdown 判断语义；
转换脚本只处理确定性的 JSON 字段和目录操作。引用 Skill 自身资源时必须使用相对于 Skill 目录的路径，目标仓库路径通过任务输入提供。

第一版采用纯文档 Skill。实施 Agent 必须在 `docs/provenance/skill-mapping.json`
逐条记录上游约束及本地对应位置，由 `skill-mapping.schema.json` 定义字段。
业务代码的静态依赖必须指向 Skill 目录以外的代码包。

### 执行 Skill 的 Agent 的使用步骤

1. Agent 确认当前仓库、分支、HEAD 和未提交改动，读取项目规则和设计文档总入口。
2. Agent 根据用户任务选择 Skill，并读取对应 `SKILL.md` 和必要参考。
3. Agent 读取本次涉及模块的设计、接口和实现，指出设计状态及需要落实的约束。
4. Agent 完成已授权改动；公开语义变化时同步核对 OpenAPI、SDK、helper 和文档。
5. Agent 运行改动涉及的测试与项目规定检查，报告结果和仍未验证的内容。

使用在线发布 manifest 的条件是“跟进发布或升级接入”。
普通本地开发按本地版本读取资料；接入本项目时查询本仓库站点，
同步上游时查询已记录的上游地址，并明确比较的两个版本。

### 用户如何调用

安装验收后，用户可以在该仓库任务中选择对应 Skill，或直接写出名称，例如：

```text
使用 tavern-project-contributing，基于当前 worktree 修改会话分支功能。
先读取本地设计文档入口，核对当前实现，再完成代码、测试和文档更新。
```

```text
使用 tavern-client-integration，为当前前端接入聊天流式返回。
按当前后端版本核对 SDK、SSE 事件和错误处理。
```

Codex CLI/IDE 支持 `$tavern-project-contributing` 形式的显式调用。
桌面端以当前 Skill 选择器可见结果为准。Codex 会从仓库 `.agents/skills/` 发现 Skill；安装到独立 worktree 后，
应在该 worktree 对应的任务中检查发现结果。其他工作树需取得包含这些文件的提交。

## 日常开发与手动同步

日常开发按“执行 Skill 的 Agent 的使用步骤”进行。
开发完成后，同一改动提交必须包含受影响的文档和必要的来源状态更新。

用户仓库的文档必须描述本项目接受的设计与当前实现。
需要同步上游时，Agent 必须先记录当前本地版本及已保存发布快照，再读取指定发布的 JSON。
Agent 依据 Git 差异和实际文件判断受影响的设计与 Skill；manifest 用于定位检查点。Agent 必须在独立分支审阅变更，
再更新本地文档与 Skill，并完成本方案的相关验收。

Skill 的本地工作流发生变化时，
Agent 必须同时检查来源记录与 `docs/provenance/skill-mapping.json`。版本回退使用对应 Git 提交和来源快照，
运行中的本地数据继续由各环境独立维护。

## 实施顺序与完成条件

| 阶段 | 执行主体与动作 | 产物 | 完成条件 |
| --- | --- | --- | --- |
| 1. 来源盘点 | 实施 Agent 盘点来源 | schema、清单、快照 | 入口有位置及版本 |
| 2. 文档入口 | 实施 Agent 整理导航 | 设计索引、项目入口规则 | 按任务找到来源 |
| 3. 独立站点 | 实施 Agent 配置并发布 Pages | 网站、工作流、发布记录 | 发布验收通过 |
| 4. Skill 适配 | 实施 Agent 编写工作流 | Skill、JSON、约束映射 | 发现、触发和引用通过 |
| 5. 验收交付 | 审阅 Agent 审阅，实施 Agent 修正 | 验收记录、示例 | 下节各项通过 |

## 验收范围与预期结果

实施 Agent 必须将验收结果保存到 `docs/provenance/acceptance.md`。
每项结果使用“通过”或“未通过”；全部通过才完成交付。未通过项必须写明阻碍和待完成动作。

网站验收范围为目标 Pages 地址的首页、快速开始、架构、API 参考入口、SDK 总览、
两个 Skill 页面，以及这些页面的图片、字体、深层页面刷新和搜索。
实施 Agent 必须确认指定页面可访问且正文正确显示，图片与字体资源加载成功，
深层链接直接打开及刷新后仍显示目标页面。
搜索已收录的“快速开始”和“tavern-client-integration”时，必须返回可打开的对应页面。
实施 Agent 必须将逐项浏览结果、搜索词和命中页面记录到上述验收文件。
Agent 验收范围为当前 worktree 的设计入口、对应正文、schema 和两个 Skill 的本地引用。

| 黑盒场景 | 预期结果 |
| --- | --- |
| 后端路由改动 | 选择贡献 Skill，定位 API 模块并检查公开语义联动 |
| 客户端流式接入 | 选择接入 Skill，核对 SDK 和 SSE，并列明对应验证 |
| 在线与本地版本不同 | 普通开发引用本地版本；升级任务明确比较的两个版本 |
| 必需参考文件缺失 | 报告准确路径，完成可独立工作，将依赖该文件的步骤标为未完成 |
| 纯页面视觉调整 | 定位前端设计资料，按相关项目规则执行视觉任务 |

## 验收清单

- [ ] 文档源文件、在线快照和当前代码的版本均有记录，未提交状态单独标明。
- [ ] 设计导航覆盖安装配置、架构、数据、公开接口、Studio 和测试协作，并逐项注明设计状态。
- [ ] 目标 GitHub Pages 网站通过上述网站验收范围。
- [ ] 仓库链接、页面元数据及 Agent JSON 指向本项目；上游链接明确用于来源引用。
- [ ] 网站版本、Agent JSON 提交、构建提交及成功 CI 结果一致。
- [ ] 首次发布、后续发布与手动发布条件均有验证记录。
- [ ] 当前 worktree 的 Agent 验收通过，开发资料可以直接从仓库读取。
- [ ] 两个 Skill 在目标 worktree 的 Codex 任务中可发现，所有本地引用可读取。
- [ ] Agent 已逐项判定上述黑盒场景达到预期结果。
- [ ] 实施 Agent 核对宿主 Skill 启动检查项，并以相同通过条件补齐黑盒用例；独立审阅 Agent 完成文档语义验收。
- [ ] 文档改动通过项目规定构建及对应 Markdown 检查；若新增转换程序，其正常、异常和边界分支均有测试。
- [ ] 原有项目约束逐项保留或移到明确权威来源，所有变更均在 Git diff 中可审阅。

## 非本次目标

本方案聚焦独立 GitHub Pages 文档站与两个仓库级开发工作流。
长期运行本地文档服务、离线静态网站交付和上游站点维护属于范围外工作。
全文翻译、向量数据库、RAG 服务、MCP 服务、全局插件分发、自动定时同步、业务功能改造和依赖升级属于后续独立需求。

## 已获得的授权

用户已授权实施文档和 Skill 方案，并批准保留私有源码仓库、另建公开文档仓库发布。
本次授权覆盖公开文档仓库创建、Pages 设置、部署密钥配置、
发布流程修改、必要源码提交推送，以及 CI 成功后自动发布静态文档。
此前创建 worktree、安装依赖和启动业务前后端的授权已经执行。

涉及新增外部依赖时，实施 Agent 必须按用户工作约定先提交准确版本、用途和安全审计意见。
本方案优先复用现有 VitePress 1.6.4、锁文件工具及现有 Pages 工作流。

## 来源

- [GitHub Pages 自定义工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [项目文档站](https://hersophia.github.io/TavernHeadless/)
- [上游 Skill 索引](https://hersophia.github.io/TavernHeadless/agent/skills/)
- [项目贡献工作流](https://hersophia.github.io/TavernHeadless/agent/skills/tavern-project-contributing)
- [在线发布版本](https://hersophia.github.io/TavernHeadless/agent/latest.json)
- [在线 Skill 目录](https://hersophia.github.io/TavernHeadless/agent/skills/catalog.json)
- [OpenAI：Skill 格式、发现位置和调用方式](https://learn.chatgpt.com/docs/build-skills)
- 本地证据：`package.json`、`vitepress/package.json`、`vitepress/.vitepress/config.ts`、`scripts/generate-agent-artifacts.ts`、`scripts/generate-skill-artifacts.ts`、`docs/documentation-standards.md`、`vitepress/agent/`。
