---
文档用途: 说明测试配置、核心检查和验收结果的记录方法。
读取时机: 维护负责人准备运行检查或填写验收结论时。
---

<!-- markdownlint-disable MD013 -->

# 核心验收

## 1. 验收记录

1. 维护负责人在输出目录填写 `acceptance.json`，记录每项检查的实际结果。完整格式见[验收记录 schema](../../scripts/native-card-conversion/acceptance.schema.json)。

   | 字段       | 填写内容                                                                            |
   | ---------- | ----------------------------------------------------------------------------------- |
   | `taskId`   | `taskFile`所在目录的名称。                                                          |
   | `checks[]` | 每项检查的名称 `name`、结果 `status`、证据路径数组 `evidence` 和结论 `conclusion`。 |
   | `zip`      | 本次交付 ZIP 的路径；尚未生成时填 `null`。                                          |
   | `overall`  | 整卡结论。                                                                          |

2. `checks[].status` 和 `overall` 使用 `passed`、`failed` 或 `not_executed`，分别表示通过、失败和未执行。维护负责人分别记录语义判断、格式检查、正式导入回读和核心运行结果。

3. 实际结果符合该项要求时，维护负责人记录通过；已经执行但结果不符合要求时，记录失败及具体差异，修复后重新执行受影响检查并保留两次证据；缺少执行条件时，记录未执行及缺少的条件。

## 2. 正式页面与离线重放

1. 维护负责人按[preview 命令](#52-preview在正式页面测试角色卡)启动正式页面，取得页面地址及证据文件。维护负责人使用宿主浏览器工具打开 `url`，通过页面执行适用操作。进程以前台方式保持运行；维护负责人完成检查后发送 SIGINT 或 SIGTERM；工具保存关闭记录。

### 2.1 测试配置

1. `narrator` 指剧情正文生成任务；`state_updater` 指状态变化提议任务。

   | 配置字段                               | 用途与填写依据                                                                                                                                                                                     |
   | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `version`                              | 配置格式，值为 `1`                                                                                                                                                                                 |
   | `persona.name`、`persona.description`  | 实际测试用户的姓名与完整人设；从本卡开场和身份关系确定                                                                                                                                             |
   | `preset.name`、`preset.data`           | 实际参与组装的完整预设快照；明确叙述人称、人物节点、历史节点、姓名前缀及顺序                                                                                                                       |
   | `statePreset.name`、`statePreset.data` | 状态更新使用的独立预设名称与完整数据；角色含变量更新配置时填写，预览工具据此创建并绑定状态预设版本。                                                                                               |
   | `modelParams`                          | narrator 与 state_updater 的生成参数；显式填写 `max_context_tokens`，核对组装结果中的人物、历史和当前输入都进入请求                                                                                |
   | `sessionType`、`openingId`             | 单聊或群聊及要选择的原生开场 ID；省略 ID 时核对正式接口按会话类型选择的默认开场；包中没有适用开场时核对无开场结果                                                                                  |
   | `modelCapabilities`                    | 可选的系统能力配置；按[启用能力](../../docs/character-authoring/model-capabilities.md#启用能力)选择获准工具、协议和额度，`preview` 创建隔离测试会话时，将 `modelCapabilities` 提交给正式配置入口。 |
   | `testMessages[]`                       | `id` 定位测试；`message` 接续开场与历史；可指定 `branch_id`、`prompt_intent`、`debug_options.include_worldbook_matches`                                                                            |
   | `offlineReplay.steps[]`                | 可选的离线响应序列，结构由[离线响应格式](../../scripts/native-card-conversion/replay-fixture.schema.json)定义                                                                                      |

### 2.2 实际请求检查

1. `preview` 逐条调用正式 dry-run，保存完整请求、响应、实际消息及人设检查结果。维护负责人阅读结果，分别判断完整人设、历史身份、当前输入身份、人称与说话者、宏、世界书和提示控制器。上下文裁剪影响有效内容时，维护负责人调整测试配置的实际预算并保存对应证据。

### 2.3 离线响应

1. 维护负责人按实际请求到达顺序提供离线响应，并将每步的 `purpose` 填为 `narrator` 或 `state_updater`。
2. 维护负责人在 `model` 中填写对应任务使用的离线模型名称；同一任务的全部步骤使用同一个名称。
3. 维护负责人在 narrator 的 `text` 中填写剧情正文，在 state_updater 的 `agentOutput` 中填写正式 `changes`、`evidenceMessageIds` 及适用的 `facts`、`evidenceExecutionIds`。
4. `$sourceMessageId[n]` 引用实际更新请求中的 `sources[n].messageId`；`n` 从 `0` 开始。
5. 维护负责人使用 `failure.statusCode`、`failure.type`、`failure.code`、`failure.message` 配置失败响应的 HTTP 状态、错误类型、错误码和消息，并在后续步骤中配置恢复响应。
6. 配置离线重放后，preview 返回 `generationMode: offline_replay`；未配置离线重放时，preview 返回 `generationMode: unavailable`，生成及其后续状态提交检查记为未执行；维护负责人继续执行 dry-run 和包检查。维护负责人根据本卡源状态、已发生事实、可写路径和计算规则制定响应。重放用于检查确定性链路；状态规则能否表达源条件由维护负责人阅读实际请求判断。
7. 测试系统工具的同轮回传时，维护负责人使用 `text_protocol`，在 narrator 响应序列中先提供符合[调用格式](../../docs/character-authoring/agent-tools-api.md#4-模型调用格式与执行时序)的调用块，随后提供读取结果后的正文。维护负责人检查实际后续请求包含原执行结果，并通过执行记录接口核对最终正文关联的执行记录，以及状态请求和模块取得的 `toolEvidence`。
8. 维护负责人将模型自行选择正确参数的能力单列为真实模型验证项。

### 2.4 页面操作与结果

1. 维护负责人确认角色模块成功挂载，再通过实际入口触发核心操作，核对请求及状态结果。维护负责人使用连续对话回合，分别检查适用功能的正文保存、状态更新、解锁、历史查看和失败恢复，并保存直接接口调用与页面操作各自的证据。

### 2.5 发送状态与历史快照

1. 维护负责人从各实际发送入口发起请求，在响应返回前和正文流期间检查发送锁；成功或失败后检查释放与重试。

2. 维护负责人查看历史时，核对 view 是否显示所选快照、current 是否保留当前分支的最新状态，以及页面操作是否按源功能读取对应状态。维护负责人按[前端 API](../../docs/character-authoring/script-api.md)核对页面订阅的变量、正文流和提交事件。

## 3. 原文与代码等价核对

1. 维护负责人按[原文承接原则](../../.agents/skills/native-card-conversion/SKILL.md#转换最高原则原文承接)对照每项保留内容的源片段、目标文件及实际读取位置。JSON 中的字符串按解析后的值比较。

2. 维护负责人从源代码的完整条件确定各分支成立与不成立的测试输入，再检查目标模块的执行结果。判定源分支不可达时，列出源条件之间的具体矛盾。

3. 维护负责人阅读实际正文与状态请求，确认判定所需原文及事实进入对应模型。文件中存在原文与模型实际取得原文分别验收。

## 4. 操作反馈

1. 维护负责人核对原生模块的失败反馈：文案写清实际失败操作、涉及的状态或输入，以及用户可采取的修正或重试动作。输入校验反馈写明实际字段、范围、上限或可选值；错误来源按已经取得的证据说明。

## 5. 验收工具

1. 维护负责人在仓库根目录调用：

   ```sh
   node .agents/skills/native-card-conversion/scripts/convert.mjs <formal或preview> "<taskFile>" --archive "<pack返回的archive>"
   ```

2. 维护负责人按[转换工具第1章](../../.agents/skills/native-card-conversion/references/tools.md#1-调用入口与结果读取)读取命令结果。`preview`与独立回放前台运行，启动结果位于当前调用目录的`ready/result.json`，关闭结果位于`closed/result.json`。
3. `formal`、`preview`和独立回放支持`--request-id "<UUID>"`。重试同一次创建时沿用ID和原参数；输入变化、失败创建或已关闭服务重新执行时使用新ID。

### 5.1. `formal`：验证 ZIP 的正式导入和保存结果

1. 转换 Agent 交付 ZIP 后，维护负责人调用 `formal`。脚本将指定 ZIP 提交给正式检查与导入接口，再通过正式接口读取保存的各个文件，与 ZIP 内容逐一比较。
2. 维护负责人查看返回的 `status` 和 `readbackPath` 指定的逐文件比较结果。实际请求与响应保存在返回的 `evidenceDirectory/formal.json`。
3. 接口调用失败时，维护负责人记录本次正式导入失败，按诊断修正包或测试配置后重新调用 `formal`。所需修复涉及正式 API 改动时，维护负责人提出具体接口修改方案，等待用户批准。

4. 需要从打包结果直接执行正式导入时，维护负责人使用：

   ```sh
   node .agents/skills/native-card-conversion/scripts/convert.mjs pack "<taskFile>" | node .agents/skills/native-card-conversion/scripts/convert.mjs formal -
   ```

### 5.2. `preview`：在正式页面测试角色卡

1. 维护负责人需要验证实际提示请求、状态更新或用户操作时，按[核心验收第2.1节](#21-测试配置)在`taskFile`所在目录填写 `preview.json`，再调用 `preview`。
2. 脚本在隔离测试环境中导入指定 ZIP，启动正式后端与用户页面，执行配置中的 dry-run，并返回页面地址 `url`、接口地址 `apiUrl`、会话 ID `sessionId`、卡 ID `cardId` 和证据目录 `evidenceDirectory`。
3. 返回的 `dryRuns` 列出各项请求的 ID、通过状态、HTTP 状态及诊断。证据目录中的 `dry-runs.json` 保存各项结果及提示组装内容，`requests.json` 保存正式接口请求与响应，`page.json` 保存页面入口资料。

### 5.3. `replay-fixture`：运行独立离线回放

1. 维护负责人在仓库根目录调用：

   ```sh
   node .agents/skills/native-card-conversion/scripts/convert.mjs replay-fixture "<fixture.json>" "<证据父目录>"
   ```

2. 每个实例创建独立证据子目录。维护负责人从启动结果取得`baseUrl`和`evidenceDirectory`，结束检查时发送SIGINT或SIGTERM，读取关闭结果及该实例的`summary.json`。
