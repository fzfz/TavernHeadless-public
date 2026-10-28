<!-- markdownlint-disable MD013 -->

# OpenRouter 免费模型联调

## 必须要实现的目标

联调人员使用 OpenRouter 免费模型验证“角色正文流式生成 → 变量更新 Agent → 后端校验 → 提交楼层快照 → 角色页面更新”的完整链路。真实调用通过独立端口启动，现有 43872 原型继续使用原来的数据。

## 已获得的授权

用户已授权配置 OpenRouter 免费模型，并由 Agent 实际联调整个流程。凭证保存在仓库外；联调程序只调用 `openrouter/free` 或以 `:free` 结尾的模型。

## 用户配置步骤

1. 打开 [OpenRouter 密钥管理](https://openrouter.ai/settings/keys)，创建 API Key。
2. 打开 `/Users/developer/.config/tavern-headless/openrouter-test.json`，填写 `apiKey` 并保存。该文件权限为 0600。
3. 设置 `baseUrl` 为 `https://openrouter.ai/api/v1`，模型槽位使用 `openrouter/free` 或当前可用的 `:free` 模型。
4. 回复“已配置”，由 Agent 检查密钥、可用额度及实际调用结果。

OpenRouter 提供 OpenAI 兼容接口；`openrouter/free` 在免费模型中选择提供者。[接口文档](https://openrouter.ai/docs/quickstart)、[免费路由模型](https://openrouter.ai/openrouter/free)。

## 已准备的程序与边界

以下路径均相对于仓库根目录。

| 对象 | 当前实现 |
| --- | --- |
| `apps/web/prototypes/checks/openrouter-live.mjs` | 读取凭证、接收真实 SSE 文本流、调用独立变量更新模型、校验更新提案与完整候选状态 |
| `apps/web/prototypes/checks/openrouter-live.schema.json` | 定义联调角色配置结构；错误提示由 `shared/card-errors.json` 统一提供 |
| `apps/web/prototypes/characters/gushengman/live-model.json` | 顾声慢的联调提示词、可写路径、变量结构；用于音乐交流、时间、地点和角色数值更新 |
| `apps/web/prototypes/checks/serve-script-prototype.mjs` | 设置 `OPENROUTER_CONFIG` 后，向模型发送正文请求；提交变量前检查基础快照；通过已有 Runtime 协议推送文本和提交结果 |
| `GET /script-api/sessions/:id/live-evidence` | 返回本会话实际模型、变量提案、前后快照 ID 和最近一次失败码 |

这一实现验证原型的数据流。角色配置由隔离后端从文件读取，会话和快照保存在内存中。它尚未接入正式后端的 RuntimeWorker、数据库事务和 LLM Profile 凭证管理。

顾声慢配置是明确编写的联调用例，尚未覆盖其全部世界书规则。林茜的 MVU 转换与主回复后的两次 Agent 更新已通过真实调用，见[林茜验收记录](linqian-live-results.md)。缺少 `live-model.json` 的角色会返回配置错误。

## 联调步骤与完成条件

| 执行主体 | 工作 | 产物与完成条件 |
| --- | --- | --- |
| 用户 | 按上述步骤保存密钥 | 本地凭证文件包含有效密钥 |
| Agent | 查询密钥状态，调用免费模型 | 记录响应状态和实际模型名，排除凭证内容 |
| Agent | 在独立端口启动真实调用后端 | 顾声慢页面连接真实调用；原有原型服务继续可用 |
| Agent | 连续提交至少三轮音乐交流，包含明确的时间与地点变化 | 浏览器显示逐段正文；变量提案依据实际正文；当前状态和历史楼层快照分别正确 |
| Agent | 对照林茜原卡逐项转换变量结构、更新规则与确定性计算 | 转换表、角色配置和对应测试覆盖原规则；新增配置使用统一 schema |
| Agent | 验证变量输出错误、限流、断流与更新失败重试 | 失败期间变量不提交；单独重试更新器保留原正文与基础快照 |
| Agent | 接入后续 Agent 输出，再次更新同一楼层变量 | 页面收到独立更新通知；旧快照保持可读；重复和过期更新不会覆盖新状态 |
| Agent | 复查页面与后端记录 | 保存请求结果、变量差异、浏览器截图与验收结论 |

本次联调使用本地凭证副本 `/Users/developer/.config/tavern-headless/openrouter-linqian-test.json`，两类模型槽位均指定为 `nex-agi/nex-n2.5-mini:free`。副本权限为 0600，原凭证文件保持不变。

Agent 在本 worktree 根目录运行以下命令，使用独立端口 43873：

```sh
OPENROUTER_CONFIG=/Users/developer/.config/tavern-headless/openrouter-linqian-test.json \
/srv/tavern/TavernHeadless/node_modules/.bin/tsx \
apps/web/prototypes/checks/serve-script-prototype.mjs \
/srv/tavern/TavernHeadless 43873 \
/srv/tavern/TavernHeadless-inspect-20260914/node_modules/.pnpm/better-sqlite3@12.8.0/node_modules/better-sqlite3
```

服务启动后打开 `http://127.0.0.1:43873/prototype/apps/user-web/prototypes/script-roleplay.prototype.html?session=script-gushengman`。凭证仅由后端读取。免费模型返回限流或不可用时，Agent 记录具体失败原因和后续操作。

## 验收清单

- [x] 传输单元测试覆盖中文跨字节分块、完成、截断、服务端错误和 429。
- [x] 隔离后端集成测试覆盖两轮连续提交、真实调用分支的分段传输与无效状态拒绝；模型提供者由测试替身承担。
- [x] 提案单元测试覆盖正常更新、无变化、越权路径、无效证据、类型错误、范围错误和删除必填字段。
- [x] 真实免费模型完成三轮生成，结果见[真实联调记录](openrouter-live-results.md)。
- [x] 浏览器确认文本流和已提交变量分别驱动角色容器。
- [x] 林茜规则映射、确定性结算和真实模型更新通过，范围见林茜验收记录。
- [x] 更新失败单独重试通过真实模型验证。
- [x] 同一楼层的两次后续 Agent 更新、独立快照和历史隔离通过。

## 非本次目标

本次先验收真实模型链路与 MVU 转换可行性。正式数据库持久化、生产部署和管理 Web 配置编辑器按照[双端实施计划](role-app-dual-web-plan.md)实施。
